/**
 * tests/config.test.mjs — lib/config.mjs 的离线测试。
 * 全部用临时目录，不碰真实配置。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WHITELIST,
  PRESETS,
  resolveConfigPath,
  readConfig,
  isValidValue,
  applyPatch,
  currentValues,
  matchingPreset,
  writeAtomic,
} from '../lib/config.mjs';

function freshPath() {
  return join(mkdtempSync(join(tmpdir(), 'bilicfg-')), 'billion-context.json');
}

test('resolveConfigPath: BILI_CONFIG_FILE wins', () => {
  const p = resolveConfigPath({ BILI_CONFIG_FILE: 'C:/x/y.json' }, 'H');
  assert.equal(p, 'C:/x/y.json');
});

test('resolveConfigPath: XDG_CONFIG_HOME honored', () => {
  const p = resolveConfigPath({}, '/home/u');
  assert.equal(p, join('/home/u', '.config', 'billion-context', 'billion-context.json'));
  const p2 = resolveConfigPath({ XDG_CONFIG_HOME: '/xdg' }, '/home/u');
  assert.equal(p2, join('/xdg', 'billion-context', 'billion-context.json'));
});

test('readConfig: missing file → {}', () => {
  assert.deepEqual(readConfig(join(freshPath(), 'nope.json')), {});
});

test('readConfig: broken JSON → {}', () => {
  const p = freshPath();
  writeFileSync(p, '{ broken');
  assert.deepEqual(readConfig(p), {});
});

test('isValidValue: whitelist gate', () => {
  assert.ok(isValidValue('compress.nudgeGrowthTokens', 20000));
  assert.ok(!isValidValue('compress.nudgeGrowthTokens', 'x'));
  assert.ok(!isValidValue('compress.nudgeGrowthTokens', 0)); // 低于 min
  assert.ok(isValidValue('compress.maxContextLimit', '50%'));
  assert.ok(isValidValue('compress.maxContextLimit', 0.5));
  assert.ok(!isValidValue('not.a.key', 1));
  assert.ok(isValidValue('compress.reconcile', 'repair'));
  assert.ok(!isValidValue('compress.reconcile', 'sometimes'));
});

test('applyPatch: key-level merge preserves unknown keys', () => {
  const p = freshPath();
  writeFileSync(p, JSON.stringify({ providers: { 'https://api.example.com': { models: {} } }, passthrough: false, customFuture: { deep: true } }));
  const r = applyPatch(p, { 'compress.nudgeGrowthTokens': 20000 });
  assert.ok(r.ok);
  const saved = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(saved.compress.nudgeGrowthTokens, 20000);
  assert.equal(saved.passthrough, false);
  assert.deepEqual(saved.customFuture, { deep: true });
  assert.equal(saved.providers['https://api.example.com'].models !== undefined, true);
});

test('applyPatch: rejects unknown or invalid keys atomically', () => {
  const p = freshPath();
  writeFileSync(p, JSON.stringify({ providers: {} }));
  const before = readFileSync(p, 'utf8');
  const r = applyPatch(p, { 'compress.nudgeGrowthTokens': 20000, 'evil.key': 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.invalidKeys, ['evil.key']);
  assert.equal(readFileSync(p, 'utf8'), before); // 原文件未被碰
});

test('applyPatch: creates backup before first write', () => {
  const p = freshPath();
  writeFileSync(p, JSON.stringify({ providers: {} }));
  const r = applyPatch(p, { 'compress.reconcile': 'repair' });
  assert.ok(r.ok);
  assert.ok(r.backup && existsSync(r.backup));
  assert.deepEqual(JSON.parse(readFileSync(r.backup, 'utf8')), { providers: {} });
});

test('applyPatch: no backup when file did not exist', () => {
  const p = freshPath();
  const r = applyPatch(p, { 'compress.reconcile': 'repair' });
  assert.ok(r.ok);
  assert.equal(r.backup, null);
});

test('applyPatch: percent string written as given (engine accepts both)', () => {
  const p = freshPath();
  const r = applyPatch(p, { 'compress.maxContextLimit': '50%' });
  assert.ok(r.ok);
  const saved = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(saved.compress.maxContextLimit, '50%');
});

test('currentValues + matchingPreset', () => {
  const p = freshPath();
  applyPatch(p, PRESETS.balanced.values);
  const values = currentValues(p);
  assert.equal(values['compress.nudgeGrowthTokens'], 25000);
  assert.equal(matchingPreset(p), 'balanced');

  applyPatch(p, { 'compress.nudgeGrowthTokens': 20000, 'compress.maxContextLimit': 0.5 });
  assert.equal(matchingPreset(p), 'aggressive');

  applyPatch(p, { 'compress.nudgeGrowthTokens': 12345 });
  assert.equal(matchingPreset(p), null);
});

test('writeAtomic: tmp file renamed, no leftover', () => {
  const p = freshPath();
  writeAtomic(p, '{"a":1}');
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), { a: 1 });
  const leftovers = readdirSync(join(p, '..')).filter((f) => f.includes('.tmp-'));
  assert.equal(leftovers.length, 0);
});

test('backup pruning keeps at most 10', () => {
  const p = freshPath();
  writeFileSync(p, '{}');
  for (let i = 0; i < 14; i += 1) applyPatch(p, { 'compress.nudgeGrowthTokens': 20000 + i });
  const dir = join(p, '..');
  const baks = readdirSync(dir).filter((f) => f.startsWith('billion-context.json.bak-'));
  assert.ok(baks.length <= 10, `expected ≤10 backups, got ${baks.length}`);
});
