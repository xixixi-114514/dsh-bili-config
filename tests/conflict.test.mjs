/**
 * tests/conflict.test.mjs — 与 billion-context 及其它已装插件的冲突面测试。
 *
 * 冲突面 1：配置文件写入 —— billion-context 的 loadConfigFile() 每次调用都
 *   readFileSync + 与缓存 raw 比对；内容变了缓存自动失效（"raw 比对"式缓存）。
 *   → 我们写入后它必然重读，无"陈旧缓存"窗口。测试钉死：我们写的 JSON 必须是
 *   它能 parse 的（JSON.parse 直接过；含尾逗号也能过它的 parse2 兜底，但我们
 *   干脆只产出严格 JSON）。
 * 冲突面 2：白名单键的"inert 键"告警 —— 引擎对已移除的键会打 warnInert*，
 *   我们的白名单必须不含任何 inert/removed 键（防"装了插件反而一堆警告"）。
 * 冲突面 3：路由前缀 /bili-config —— 引擎静态扫描零注册（实测），本测试用
 *   已知引擎路由表钉死不撞。
 * 冲突面 4：工具名 bili_config —— 引擎零工具注册（实测）。
 * 冲突面 5：与 profile 里其它插件的路由/工具名不撞（实测快照）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { WHITELIST, applyPatch, readConfig } from '../lib/config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** billion-context 引擎目录（按 profile 常规位置；不存在则跳过实机检查）。 */
const ENGINE = join(
  process.env.USERPROFILE || process.env.HOME || '.',
  '.dsh', 'profiles', 'desktop', 'node_modules', 'billion-context',
);
const ENGINE_DOC = join(ENGINE, 'CONFIGURATION.zh-CN.md');

/** 已实测：引擎 / 本插件之外，profile 里其它插件注册过的路由前缀（快照）。 */
const TAKEN_ROUTES = new Set([
  '/workspace-gate', '/api', '/plugins', '/__bili__',
  // 宿主与其它插件（来自会话内 58 个工具与已见路由）：
  '/dshmarket', '/our-free-model',
]);

/** 已实测：会话里出现过的全部 58 个工具名（快照，代表"工具名占用"）。 */
const TAKEN_TOOLS = new Set([
  'acp_cache', 'acp_read_original_image', 'acp_status', 'ask_user_question', 'compress',
  'create_goal', 'decompress', 'edit', 'get_expert_team', 'get_goal', 'glob', 'grep',
  'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'list_agents', 'list_experts',
  'list_expert_teams', 'list_mcp_resource_templates', 'list_mcp_resources', 'load_workspace_dependencies',
  'present', 'read', 'read_image', 'read_mcp_resource', 'schedule_create', 'schedule_delete',
  'schedule_list', 'schedule_update', 'search_context', 'send_message', 'skill', 'spawn_teammate',
  'subagent', 'subagent_fork', 'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update',
  'todo_write', 'wait_agent', 'web_fetch', 'web_search', 'workflow', 'working_directory', 'write',
  'pwsh', 'ops_bash', 'ops_discover_tools', 'ops_read_files',
  'modlens_read_image', 'summon_expert', 'summon_expert_team', 'summon_experts',
  'exit_plan_mode', 'update_goal',
  // mcp__ 前缀的 wincu 一族（略记两个代表）
  'mcp__wincu__windows_computer_use_screenshot', 'mcp__wincu__windows_computer_use_click',
]);

test('conflict: our writes produce strict JSON the engine parses on next read', () => {
  const doc = existsSync(ENGINE_DOC);
  // 模拟：任意白名单 patch 写入后，产出必须是 JSON.parse 可读的
  const p = join(mkdtempSync(join(tmpdir(), 'conf-')), 'billion-context.json');
  for (const key of Object.keys(WHITELIST)) {
    const spec = WHITELIST[key];
    // 合法样本值：percent 用中值、number 用 min 与 min*2、boolean true、enum 第一项
    const sample = spec.type === 'boolean' ? true
      : spec.type === 'enum' ? spec.values[0]
      : spec.type === 'percent' ? (spec.min + spec.max) / 2
      : spec.min + 1;
    const r = applyPatch(p, { [key]: sample });
    assert.ok(r.ok, `patch failed for ${key} (sample=${sample})`);
    const raw = readFileSync(p, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw), `written file is not strict JSON after ${key}`);
  }
  if (doc) console.log('   (engine present at ' + ENGINE + ')');
});

test('conflict: whitelist contains no inert/removed engine keys', () => {
  if (!existsSync(ENGINE_DOC)) {
    console.log('   (engine doc not present — skipping live check)');
    return;
  }
  const docText = readFileSync(ENGINE_DOC, 'utf8');
  const REMOVED = ['allowDshCompaction', 'dsh.allowCompaction'];
  const KNOWN = ['nudgeGrowthTokens', 'maxContextLimit', 'emergencyThresholdPercent', 'reconcile',
    'minPressureBenefitTokens', 'preserveRecentMessages', 'preserveRecentTokens',
    'minCompressRangeChars', 'injectTool', 'injectNudge', 'tiers', 'nudgeModelDecided',
    'outputHeadroomMaxPct', 'passthrough', 'absorb'];
  for (const key of Object.keys(WHITELIST)) {
    for (const bad of REMOVED) {
      assert.ok(!key.includes(bad), `${key} looks like a removed engine key`);
    }
    const leaf = key.split('.').pop();
    const found = KNOWN.includes(leaf) || docText.includes(key);
    assert.ok(found, `whitelist key ${key} not found in engine doc — verify before shipping`);
  }
});

test('conflict: route /bili-config does not collide with known routes', () => {
  assert.ok(!TAKEN_ROUTES.has('/bili-config'));
  const host = readFileSync(join(ROOT, 'index.js'), 'utf8');
  assert.match(host, /const ROUTE = '\/bili-config'/);
});

test('conflict: tool name bili_config does not collide with session tool snapshot', () => {
  assert.ok(!TAKEN_TOOLS.has('bili_config'), 'bili_config already taken');
  assert.ok(!TAKEN_TOOLS.has('bili-config'), 'bili-config already taken');
});

test('conflict: presets never write outside whitelist (no clobber of engine defaults)', () => {
  // 再钉一次：三个档位的全部键 ∈ 白名单（防未来加档位时越界）
  const src = readFileSync(join(ROOT, 'lib', 'config.mjs'), 'utf8');
  for (const m of src.matchAll(/values:\s*\{([\s\S]*?)\}/g)) {
    for (const k of m[1].matchAll(/'(compress\.[a-zA-Z.]+)'/g)) {
      assert.ok(k[1] in WHITELIST, `preset uses non-whitelist key ${k[1]}`);
    }
  }
});

test('conflict: config file write does not touch engine-owned state dirs', () => {
  // 我们只写 config 路径；log/index.db/prefix-affinity 等状态目录绝不被写
  const src = readFileSync(join(ROOT, 'lib', 'config.mjs'), 'utf8');
  for (const forbidden of ['bili.log', 'index.db', 'prefix-affinity', 'sessions']) {
    assert.ok(!/write/i.test(src.split(forbidden)[0]?.slice(-40) ?? ''), `config.mjs must not write ${forbidden}`);
  }
  // logtail 只读
  const lt = readFileSync(join(ROOT, 'lib', 'logtail.mjs'), 'utf8');
  for (const ro of ['writeFileSync', 'appendFileSync', 'unlinkSync', 'renameSync']) {
    assert.ok(!lt.includes(ro), `logtail must be read-only, found ${ro}`);
  }
});

