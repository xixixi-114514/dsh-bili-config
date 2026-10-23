/**
 * tests/preset-residue.test.mjs — 档位残留 bug 的回归测试。
 * 背景：真机验收发现"激进→均衡"切换后 maxContextLimit:0.5 残留，
 * 压力线仍是 50% 而不是引擎默认 75%，与档位语义不符。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PRESETS, applyPreset, matchingPreset, currentValues } from '../lib/config.mjs';

function freshPath() {
  return join(mkdtempSync(join(tmpdir(), 'residue-')), 'billion-context.json');
}

test('regression: aggressive → balanced must not keep maxContextLimit', () => {
  const p = freshPath();
  // 1) 激进
  let r = applyPreset(p, 'aggressive');
  assert.ok(r.ok);
  assert.equal(currentValues(p)['compress.maxContextLimit'], 0.5);
  assert.equal(matchingPreset(p), 'aggressive');

  // 2) 切回均衡
  r = applyPreset(p, 'balanced');
  assert.ok(r.ok);
  const values = currentValues(p);
  assert.equal(values['compress.nudgeGrowthTokens'], 25000);
  assert.equal(values['compress.reconcile'], 'repair');
  assert.equal(values['compress.maxContextLimit'], null, 'maxContextLimit must be restored to engine default (removed)');
  assert.equal(matchingPreset(p), 'balanced');
});

test('regression: any → conservative leaves only reconcile', () => {
  const p = freshPath();
  applyPreset(p, 'aggressive');
  applyPreset(p, 'conservative');
  const values = currentValues(p);
  assert.equal(values['compress.nudgeGrowthTokens'], null);
  assert.equal(values['compress.maxContextLimit'], null);
  assert.equal(values['compress.reconcile'], 'repair');
});

test('preset round-trip: aggressive twice is idempotent', () => {
  const p = freshPath();
  applyPreset(p, 'aggressive');
  const r2 = applyPreset(p, 'aggressive');
  assert.ok(r2.ok);
  assert.equal(matchingPreset(p), 'aggressive');
  const values = currentValues(p);
  assert.equal(values['compress.nudgeGrowthTokens'], 20000);
  assert.equal(values['compress.maxContextLimit'], 0.5);
});

test('unknown preset rejected without touching file', () => {
  const p = freshPath();
  const r = applyPreset(p, 'yolo');
  assert.equal(r.ok, false);
});
