/**
 * lib/logtail.mjs — 解析 bili.log 尾部，产出实时压缩指标。
 *
 * 日志事实（已实测本机 0.1.202–0.1.204）：
 *  - 路径：~/.local/state/billion-context/bili.log（Windows 下同路径，HOME 是用户目录）
 *  - 10MB 自动轮转（bili.log.old），所以只读尾部，绝不全量加载
 *  - 关键行形状：
 *      nudge idle: usage=9% (88176/967232), growth=44404/22500 (ref=33498, interval=50000), pendingT1=33905/50000 model=..., reason="max compressible 33905 < threshold 50000"
 *      [acp-usage] input=88176 cached=87680 (cache hit 99%)
 *      [fold-reconcile] resent history drifted: 48 covered id(s) missing …
 *      [warn: degenerate-fold] [acp-compress-obs] covers 92% of the live context …
 *      [acp-compress-obs] shrink 91% (~681567/746857 tok) foldPoint=…
 */

import { existsSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** 尾部读取窗口：512KB 足够看到最近几十轮的 nudge/usage/drift。 */
const TAIL_BYTES = 512 * 1024;

export function resolveLogPath(env = process.env, home = homedir()) {
  const explicit = String(env.BILI_LOG_FILE ?? '').trim();
  if (explicit) return explicit;
  const xdgState = String(env.XDG_STATE_HOME ?? '').trim();
  const base = xdgState || join(home, '.local', 'state');
  return join(base, 'billion-context', 'bili.log');
}

/** 读文件尾部（最多 TAIL_BYTES），返回字符串；文件缺失返回 null。 */
export function readTail(path, budget = TAIL_BYTES) {
  try {
    if (!existsSync(path)) return null;
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(budget, size);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * 解析尾部文本 → 指标对象。
 * 返回的每一项都允许为 null（没匹配到就不撒谎）。
 */
export function parseMetrics(text) {
  if (!text) {
    return {
      samples: 0,
      usage: null,
      pendingT1: null,
      growth: null,
      cacheHit: null,
      driftCount: 0,
      degenerateCount: 0,
      shrinkCount: 0,
      lastShrink: null,
    };
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out = {
    samples: lines.length,
    usage: null,          // 最近一次上下文占用 { pct, used, window }
    pendingT1: null,      // 最近一次可压积压 { value, threshold }
    growth: null,         // 最近一次增长 { value, gate }
    cacheHit: null,       // 最近一次缓存命中率 { pct, input, cached }
    driftCount: 0,        // 窗口内 fold 漂移行数
    degenerateCount: 0,   // 窗口内退化折叠警告数
    shrinkCount: 0,       // 窗口内实际压缩(shrink)次数
    lastShrink: null,     // { at, ratio, fromTok, toTok }
  };

  const NU = /nudge idle: usage=(\d+(?:\.\d+)?)% \((\d+)\/(\d+)\), growth=(\d+)\/(\d+)(?:.*?), pendingT1=(\d+)\/(\d+)/;
  const CA = /\[acp-usage\] input=(\d+) cached=(\d+) \(cache hit (\d+)%\)/;
  const DRIFT = /fold-reconcile\] (?:resent history drifted|.*missing)/;
  const DEGEN = /degenerate-fold/;
  const SHRINK = /\[acp-compress-obs\] shrink (\d+)% \(~(\d+)\/(\d+) tok\)/;
  const TIME = /^(\S+T\S+?)\s+\[/;

  let sawShrink = false;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i];

    if (out.usage === null) {
      const m = NU.exec(l);
      if (m) {
        out.usage = { pct: Number(m[1]), used: Number(m[2]), window: Number(m[3]) };
        out.growth = { value: Number(m[4]), gate: Number(m[5]) };
        out.pendingT1 = { value: Number(m[6]), threshold: Number(m[7]) };
      }
    }
    if (out.cacheHit === null) {
      const m = CA.exec(l);
      if (m) out.cacheHit = { pct: Number(m[3]), input: Number(m[1]), cached: Number(m[2]) };
    }
    if (!sawShrink) {
      const m = SHRINK.exec(l);
      if (m) {
        sawShrink = true;
        const t = TIME.exec(l);
        out.lastShrink = {
          at: t ? t[1] : null,
          ratio: Number(m[1]),
          fromTok: Number(m[2]),
          toTok: Number(m[3]),
        };
      }
    }
  }
  for (const l of lines) {
    if (DRIFT.test(l)) out.driftCount += 1;
    if (DEGEN.test(l)) out.degenerateCount += 1;
    if (SHRINK.test(l)) out.shrinkCount += 1;
  }
  return out;
}

/** 一步到位：路径 → 指标。 */
export function collectMetrics(path) {
  return parseMetrics(readTail(path));
}
