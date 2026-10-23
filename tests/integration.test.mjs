/**
 * tests/integration.test.mjs — 集成级自检：模拟一次完整的"读状态→写档位→验证"流程。
 * 不起 DSH、不碰真实配置文件，全部在临时目录里跑。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveConfigPath, applyPatch, currentValues, matchingPreset, PRESETS } from '../lib/config.mjs';
import { parseMetrics, readTail } from '../lib/logtail.mjs';

/** 用受控的 env/home 构造一套假环境（配置 + 日志），返回 { env, home }。 */
function fakeEnv() {
  const home = mkdtempSync(join(tmpdir(), 'bilihome-'));
  const env = { XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local', 'state') };
  return { env, home };
}

test('integration: full preset round-trip against a realistic config dir', () => {
  const { env, home } = fakeEnv();
  const cfg = resolveConfigPath(env, home);
  mkdirSync(join(cfg, '..'), { recursive: true });
  // 模拟用户已有配置：含 providers、含我们不认识的未来键
  writeFileSync(cfg, JSON.stringify({
    providers: {},
    passthrough: false,
    compress: { tiers: true },
    futureEngineKey: { nested: [1, 2] },
  }));

  // 1) 应用均衡档
  const r1 = applyPatch(cfg, PRESETS.balanced.values);
  assert.ok(r1.ok);
  const after = JSON.parse(readFileSync(cfg, 'utf8'));
  assert.equal(after.compress.nudgeGrowthTokens, 25000);
  assert.equal(after.compress.reconcile, 'repair');
  assert.equal(after.compress.tiers, true);           // 原有键保留
  assert.equal(after.passthrough, false);              // 顶层键保留
  assert.deepEqual(after.futureEngineKey, [1, 2].length ? { nested: [1, 2] } : undefined); // 未来键透传
  assert.equal(matchingPreset(cfg), 'balanced');

  // 2) 切到激进档
  const r2 = applyPatch(cfg, PRESETS.aggressive.values);
  assert.ok(r2.ok);
  const after2 = JSON.parse(readFileSync(cfg, 'utf8'));
  assert.equal(after2.compress.nudgeGrowthTokens, 20000);
  assert.equal(after2.compress.maxContextLimit, 0.5);
  assert.equal(matchingPreset(cfg), 'aggressive');

  // 3) 手改一个键 → 变自定义
  applyPatch(cfg, { 'compress.nudgeGrowthTokens': 17000 });
  assert.equal(matchingPreset(cfg), null);

  // 4) currentValues 反映全部白名单键
  const v = currentValues(cfg);
  assert.equal(v['compress.reconcile'], 'repair');
  assert.equal(v['compress.maxContextLimit'], 0.5);
});

test('integration: metrics from a realistic log tail', () => {
  const { env, home } = fakeEnv();
  const log = join(home, '.local', 'state', 'billion-context', 'bili.log');
  mkdirSync(join(log, '..'), { recursive: true });
  writeFileSync(log, [
    '2026-10-21T13:56:28.532Z [info] [plugin] [acp-usage] input=77902 cached=76672 (cache hit 98%)',
    '2026-10-21T13:56:31.474Z [info] nudge idle: usage=8% (77902/967232), growth=44404/22500 (ref=33498, interval=50000), pendingT1=33905/50000 model=x, reason="max compressible 33905 < threshold 50000"',
    '2026-10-21T14:10:39.390Z [warn] [fold-reconcile] resent history drifted: 48 covered id(s) missing with no anchor match',
  ].join('\n'));

  const text = readTail(log);
  const m = parseMetrics(text);
  assert.equal(m.usage.pct, 8);
  assert.equal(m.pendingT1.value, 33905);
  assert.equal(m.pendingT1.threshold, 50000);
  assert.equal(m.cacheHit.pct, 98);
  assert.equal(m.driftCount, 1);
});

test('integration: config patch validation blocks the dangerous ones', () => {
  const { env, home } = fakeEnv();
  const cfg = resolveConfigPath(env, home);
  mkdirSync(join(cfg, '..'), { recursive: true });
  writeFileSync(cfg, '{}');

  // 非法类型
  assert.equal(applyPatch(cfg, { 'compress.nudgeGrowthTokens': 'big' }).ok, false);
  // 越界（min 1000）
  assert.equal(applyPatch(cfg, { 'compress.nudgeGrowthTokens': 100 }).ok, false);
  // 未知键
  assert.equal(applyPatch(cfg, { 'compress.evil': 1 }).ok, false);
  // 枚举外
  assert.equal(applyPatch(cfg, { 'compress.reconcile': 'yolo' }).ok, false);
  // 全部失败后文件原样
  assert.equal(readFileSync(cfg, 'utf8'), '{}');
});
