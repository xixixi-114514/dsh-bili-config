/**
 * tests/compatibility.test.mjs — 冲突检测的离线测试。
 * 钉死：检测逻辑、多个冲突的列出、人话渲染、未知插件不误报。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { COMPAT, checkCompatibility, formatFindings } from '../lib/compatibility.mjs';

test('checkCompatibility: empty list → no findings', () => {
  const r = checkCompatibility([]);
  assert.equal(r.hasFindings, false);
  assert.equal(r.findings.length, 0);
});

test('checkCompatibility: unknown plugin → not flagged (never guess)', () => {
  const r = checkCompatibility(['totally-unknown-plugin']);
  assert.equal(r.hasFindings, false);
});

test('checkCompatibility: single conflict detected with target', () => {
  const r = checkCompatibility(['mosaic-memory-compress']);
  assert.equal(r.hasFindings, true);
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.name, 'mosaic-memory-compress');
  assert.equal(f.level, 'conflict');
  assert.deepEqual(f.with, ['billion-context']);
  assert.ok(f.reason.length > 10);
});

test('checkCompatibility: multiple conflicts all listed (the user-facing case)', () => {
  const r = checkCompatibility([
    'dshmarket',                 // 无记录 → 不报
    'mosaic-memory-compress',    // conflict
    'dsh-sieve',                 // incompatible
    'dsh-cost-meter',            // overlap
    'smart-compaction',          // overlap
  ]);
  assert.equal(r.hasFindings, true);
  assert.equal(r.findings.length, 4);
  const names = r.findings.map((f) => f.name);
  assert.deepEqual(names, ['mosaic-memory-compress', 'dsh-sieve', 'dsh-cost-meter', 'smart-compaction']);
  // 每条都带明确的“与谁冲突”
  const sieve = r.findings.find((f) => f.name === 'dsh-sieve');
  assert.ok(sieve.with.length >= 1);
  assert.ok(sieve.with.includes('DSH 0.2.1-rc.2 宿主'));
});

test('checkCompatibility: multi-target conflict joins both names', () => {
  const r = checkCompatibility(['@zoria-lind/dsh-token-optimizer']);
  const f = r.findings[0];
  assert.equal(f.with.length, 2); // 宿主 + billion-context
  assert.ok(f.with.includes('billion-context'));
});

test('checkCompatibility: complementary entries never flagged', () => {
  const r = checkCompatibility(['dsh-model-failover', '@2jumpsina/dsh-context-guard', 'dsh-workspace-gate']);
  assert.equal(r.hasFindings, false);
});

test('formatFindings: renders human sentence with target plugin names', () => {
  const r = checkCompatibility(['mosaic-memory-compress']);
  const t = (k, ...a) => {
    const map = {
      'level.conflict': '冲突',
      'level.incompatible': '不兼容',
      'level.overlap': '功能重叠',
      itemPrefix: '⚠️',
      conflictsWith: '与',
      listJoin: '、',
    };
    const v = map[k];
    return v !== undefined ? v : k;
  };
  const text = formatFindings(r, t);
  assert.ok(text.includes('mosaic-memory-compress'));
  assert.ok(text.includes('billion-context'));
  assert.ok(text.includes('冲突'));
});

test('formatFindings: multiple findings → multiple lines', () => {
  const r = checkCompatibility(['mosaic-memory-compress', 'dsh-sieve']);
  const t = (k) => ({ 'level.conflict': '冲突', 'level.incompatible': '不兼容', itemPrefix: '⚠️', conflictsWith: '与', listJoin: '、' }[k] || k);
  const text = formatFindings(r, t);
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
});

test('formatFindings: no findings → empty string', () => {
  assert.equal(formatFindings({ hasFindings: false, findings: [] }), '');
});

test('COMPAT knowledge base: every entry well-formed', () => {
  for (const [name, e] of Object.entries(COMPAT)) {
    assert.ok(['conflict', 'incompatible', 'overlap', 'complementary'].includes(e.level), `${name} bad level`);
    assert.ok(Array.isArray(e.with) && e.with.length >= 1, `${name} must name at least one counterpart`);
    assert.ok(typeof e.reason === 'string' && e.reason.length >= 10, `${name} needs a human reason`);
  }
});
