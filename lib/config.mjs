/**
 * lib/config.mjs — billion-context 配置文件的键级读写。
 *
 * 安全规则（承重，别放松）：
 *  1. 键级合并，绝不整文件覆盖 —— 引擎两天升了三版（0.1.202→0.1.204），
 *     用户配置里可能有我们不认识的键，一律原样保留。
 *  2. 每次写入前自动备份到同目录 `.bak-<timestamp>`，保留最近 10 份。
 *  3. 原子写：先写 `<path>.tmp-<pid>-<rand>` 再 rename，防半截文件。
 *  4. 只允许白名单键被本插件修改；其它键（包括嵌套在白名单键对象里、
 *     但不在子白名单里的子键）透传不动。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, readdirSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

/** 本插件允许修改的键。键面来自 billion-context 0.1.204 的 CONFIGURATION.zh-CN.md。 */
export const WHITELIST = Object.freeze({
  // 顶层标量
  passthrough: { type: 'boolean' },
  // compress 块
  'compress.nudgeGrowthTokens': { type: 'number', min: 1000, max: 1000000 },
  'compress.maxContextLimit': { type: 'percent', min: 0.1, max: 1 },
  'compress.emergencyThresholdPercent': { type: 'percent', min: 0.1, max: 1 },
  'compress.minPressureBenefitTokens': { type: 'number', min: 0, max: 1000000 },
  'compress.preserveRecentMessages': { type: 'number', min: 0, max: 100 },
  'compress.preserveRecentTokens': { type: 'number', min: 0, max: 1000000 },
  'compress.minCompressRangeChars': { type: 'number', min: 100, max: 1000000 },
  'compress.injectTool': { type: 'boolean' },
  'compress.injectNudge': { type: 'boolean' },
  'compress.tiers': { type: 'boolean' },
  'compress.nudgeModelDecided': { type: 'boolean' },
  'compress.outputHeadroomMaxPct': { type: 'percent', min: 0, max: 1 },
  // reconcile（"off" | "warn" | "repair"）
  'compress.reconcile': { type: 'enum', values: ['off', 'warn', 'repair'] },
  // 档位预设会用到的 absorb 开关
  'compress.absorb.enabled': { type: 'boolean' },
});

/**
 * 档位会触碰的全部键（并集）。切档时这些键先回到 null（删除），
 * 再写档位自己的值——避免上一个档位留下的键残留（比如从激进
 * 切回均衡时 maxContextLimit:0.5 仍在，压力线语义与档位不符）。
 */
const PRESET_TOUCHED_KEYS = Object.freeze([
  'compress.nudgeGrowthTokens',
  'compress.maxContextLimit',
  'compress.reconcile',
]);

/** 档位预设：一键写入的白名单键组合。 */
export const PRESETS = Object.freeze({
  conservative: {
    label: '保守',
    values: {
      'compress.reconcile': 'repair',
    },
  },
  balanced: {
    label: '均衡',
    values: {
      'compress.nudgeGrowthTokens': 25000,
      'compress.reconcile': 'repair',
    },
  },
  aggressive: {
    label: '激进',
    values: {
      'compress.nudgeGrowthTokens': 20000,
      'compress.maxContextLimit': 0.5,
      'compress.reconcile': 'repair',
    },
  },
});

const MAX_BACKUPS = 10;

/** billion-context 配置文件路径：BILI_CONFIG_FILE 显式指定 > XDG_CONFIG_HOME > ~/.config。 */
export function resolveConfigPath(env = process.env, home = homedir()) {
  const explicit = String(env.BILI_CONFIG_FILE ?? '').trim();
  if (explicit) return explicit;
  const xdg = String(env.XDG_CONFIG_HOME ?? '').trim();
  const base = xdg || join(home, '.config');
  return join(base, 'billion-context', 'billion-context.json');
}

/** 读整个配置；文件不存在或 JSON 坏了都返回 {}（引擎自己的行为也是空模板起步）。 */
export function readConfig(path) {
  try {
    const text = readFileSync(path, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* 缺失或损坏都按空配置处理 */
  }
  return {};
}

/** 校验一个白名单键的取值。返回 true/false；非白名单键一律 false。 */
export function isValidValue(key, value) {
  const spec = WHITELIST[key];
  if (!spec) return false;
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= spec.min && value <= spec.max;
    case 'percent':
      if (typeof value === 'string') {
        const m = /^(\d+(?:\.\d+)?)\s*%$/.exec(value);
        if (!m) return false;
        value = Number(m[1]) / 100;
      }
      return typeof value === 'number' && Number.isFinite(value) && value >= spec.min && value <= spec.max;
    case 'enum':
      return spec.values.includes(value);
    default:
      return false;
  }
}

/** 把 "compress.nudgeGrowthTokens" 写入 {compress:{nudgeGrowthTokens:v}}，沿途建对象但不覆盖已有对象。 */
function setPath(obj, key, value) {
  const parts = key.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!node[parts[i]] || typeof node[parts[i]] !== 'object' || Array.isArray(node[parts[i]])) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

function backupPathFor(path) {
  return `${path}.bak-${Date.now()}`;
}

function pruneBackups(path, keep = MAX_BACKUPS) {
  const dir = dirname(path);
  const prefix = `${path.split(/[\\/]/).pop()}.bak-`;
  try {
    const baks = readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .sort()
      .reverse();
    for (const f of baks.slice(keep)) {
      try { unlinkSync(join(dir, f)); } catch { /* 清理失败不阻塞 */ }
    }
  } catch {
    /* 目录读不了就算了 */
  }
}

/**
 * 删除一个点路径上的键（只删最后一级，不动沿途对象）。
 * 键不存在时静默返回。
 */
function deletePath(obj, key) {
  const parts = key.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!node || typeof node !== 'object' || !(parts[i] in node)) return;
    node = node[parts[i]];
  }
  if (node && typeof node === 'object') delete node[parts[parts.length - 1]];
}

/**
 * 键级合并写入。
 * @param {string} path 配置文件路径
 * @param {Record<string, unknown>} patch 键 → 值（键必须是白名单键）
 * @returns {{ok: true, backup: string|null, config: object} | {ok: false, error: string, invalidKeys?: string[]}}
 */
export function applyPatch(path, patch) {
  return applyPatchFull(path, patch, []);
}

/**
 * 带前置删除的写入：先 removeKeys（恢复引擎默认），再写 patch。
 * 档位切换用它，防上档残留；普通逐键写入走 applyPatch（removeKeys 为空）。
 */
export function applyPatchFull(path, patch, removeKeys = []) {
  const rm = removeKeys.filter((k) => k in WHITELIST);
  const entries = Object.entries(patch ?? {});
  const invalid = entries.filter(([k, v]) => !isValidValue(k, v));
  if (invalid.length) {
    return { ok: false, error: 'invalid keys or values', invalidKeys: invalid.map(([k]) => k) };
  }
  const config = readConfig(path);
  for (const k of rm) deletePath(config, k);
  for (const [k, v] of entries) setPath(config, k, v);
  const backup = writeAtomic(path, JSON.stringify(config, null, 2) + '\n');
  pruneBackups(path);
  return { ok: true, backup, config };
}

/** 切档：先把档位会触碰的键全部恢复默认，再写档位自己的值。 */
export function applyPreset(path, presetId) {
  const preset = PRESETS[presetId];
  if (!preset) return { ok: false, error: 'unknown preset' };
  return applyPatchFull(path, preset.values, PRESET_TOUCHED_KEYS);
}

/** 原子写：先备份，再 tmp+rename。返回备份路径（文件原本不存在则返回 null）。 */
export function writeAtomic(path, text) {
  let backup = null;
  if (existsSync(path)) {
    backup = backupPathFor(path);
    writeFileSync(backup, readFileSync(path));
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
  return backup;
}

/** 当前配置里白名单键的现值（用于 UI 回显）。 */
export function currentValues(path) {
  const config = readConfig(path);
  const out = {};
  for (const key of Object.keys(WHITELIST)) {
    const parts = key.split('.');
    let node = config;
    let found = true;
    for (const p of parts) {
      if (node && typeof node === 'object' && p in node) node = node[p];
      else { found = false; break; }
    }
    out[key] = found ? node : null;
  }
  return out;
}

/** 判断某个档位当前是否"整个命中"（用于 UI 高亮当前档）。保守档的键全是引擎默认值，天然命中，所以跳过它。 */
export function matchingPreset(path) {
  const values = currentValues(path);
  for (const [id, preset] of Object.entries(PRESETS)) {
    if (id === 'conservative') continue;
    const hit = Object.entries(preset.values).every(([k, v]) => values[k] === v);
    if (hit) return id;
  }
  return null;
}

/** 引擎版本（读它的包 package.json；找不到返回 null）。 */
export function engineVersion(profileDir) {
  const candidates = [
    join(profileDir ?? '', 'node_modules', 'billion-context', 'package.json'),
    join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'billion-context', 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8'));
      if (pkg && pkg.version) return pkg.version;
    } catch { /* 下一处 */ }
  }
  return null;
}
