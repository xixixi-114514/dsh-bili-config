/**
 * tests/logtail.test.mjs — lib/logtail.mjs 的离线测试。
 * 用真实日志行形状做夹具（取自本机 0.1.202–0.1.204 的 bili.log）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveLogPath, readTail, parseMetrics, collectMetrics } from '../lib/logtail.mjs';

const SAMPLE = [
  '2026-10-21T13:56:28.532Z [info] [sess=session-x] [v=0.1.202] [session-x] [plugin] [acp-usage] input=77902 cached=76672 (cache hit 98%)',
  '2026-10-21T13:56:31.474Z [info] [sess=session-x] [v=0.1.202] [session-x] nudge idle: usage=8% (77902/967232), growth=44404/22500 (ref=33498, interval=50000), pendingT1=33905/50000 model=deepseek-v4.1-flash-free, reason="max compressible 33905 < threshold 50000"',
  '2026-10-21T13:56:41.467Z [info] [sess=session-x] [v=0.1.202] [session-x] request: 341 msgs, inbound=1.1MiB, outbound=269.7KiB, local=257ms',
  '2026-10-21T14:10:39.390Z [warn] [sess=session-x] [v=0.1.202] [session-x] [fold-reconcile] resent history drifted: 48 covered id(s) missing with no anchor match — mutation (content edit invalidates content-hash refs, fold silently lost) or client-side deletion/truncation (benign, message no longer on the wire) (#1921) (~291 tok unfolded in churn region)',
  '2026-10-21T15:48:12.878Z [info] [v=0.1.202] [session-48da] [plugin] [acp-compress-obs] shrink 91% (~681567/746857 tok) foldPoint=m00001 blocks=1 anchor≈1597 tok (1 active blocks, sys excluded)',
  '2026-10-21T15:48:12.879Z [info] [v=0.1.202] [session-48da] [plugin] [warn: degenerate-fold] [acp-compress-obs] covers 91% of the live context (~681567/746857 tok) leaving 1 active block(s), anchor≈1597 tok',
  '2026-10-21T15:48:20.000Z [info] [sess=session-x] [v=0.1.202] [session-x] nudge idle: usage=9% (88176/967232), growth=44814/22500 (ref=33498, interval=50000), pendingT1=34800/50000 model=x, reason="max compressible 34800 < threshold 50000"',
].join('\n');

test('resolveLogPath: BILI_LOG_FILE wins, default under ~/.local/state', () => {
  assert.equal(resolveLogPath({ BILI_LOG_FILE: '/tmp/b.log' }, '/home/u'), '/tmp/b.log');
  assert.equal(resolveLogPath({}, '/home/u'), join('/home/u', '.local', 'state', 'billion-context', 'bili.log'));
  assert.equal(
    resolveLogPath({ XDG_STATE_HOME: '/st' }, '/home/u'),
    join('/st', 'billion-context', 'bili.log'),
  );
});

test('parseMetrics: extracts the latest nudge/usage/pendingT1/growth', () => {
  const m = parseMetrics(SAMPLE);
  assert.deepEqual(m.usage, { pct: 9, used: 88176, window: 967232 });
  assert.deepEqual(m.pendingT1, { value: 34800, threshold: 50000 });
  assert.deepEqual(m.growth, { value: 44814, gate: 22500 });
});

test('parseMetrics: cache hit from the last acp-usage line', () => {
  const m = parseMetrics(SAMPLE);
  assert.deepEqual(m.cacheHit, { pct: 98, input: 77902, cached: 76672 });
});

test('parseMetrics: counts drift and degenerate lines in window', () => {
  const m = parseMetrics(SAMPLE);
  assert.equal(m.driftCount, 1);
  assert.equal(m.degenerateCount, 1);
  assert.equal(m.shrinkCount, 1);
});

test('parseMetrics: lastShrink parsed with timestamp', () => {
  const m = parseMetrics(SAMPLE);
  assert.equal(m.lastShrink.ratio, 91);
  assert.equal(m.lastShrink.fromTok, 681567);
  assert.equal(m.lastShrink.toTok, 746857);
  assert.equal(m.lastShrink.at, '2026-10-21T15:48:12.878Z');
});

test('parseMetrics: empty input → zeros/nulls, never lies', () => {
  const m = parseMetrics('');
  assert.equal(m.samples, 0);
  assert.equal(m.usage, null);
  assert.equal(m.cacheHit, null);
  assert.equal(m.driftCount, 0);
});

test('readTail + collectMetrics on a temp file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bililog-'));
  const p = join(dir, 'bili.log');
  writeFileSync(p, SAMPLE);
  const text = readTail(p);
  assert.ok(text.includes('pendingT1'));
  const m = collectMetrics(p);
  assert.equal(m.usage.pct, 9);
  assert.equal(m.shrinkCount, 1);
});

test('readTail: missing file → null', () => {
  assert.equal(readTail(join(tmpdir(), 'definitely-not-here.log')), null);
  const m = collectMetrics(join(tmpdir(), 'definitely-not-here.log'));
  assert.equal(m.samples, 0);
  assert.equal(m.usage, null);
  assert.equal(m.driftCount, 0);
});
