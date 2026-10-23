/**
 * tests/contract.test.mjs — Host↔Client 契约测试。
 * 钉死两半身之间的接口形状：路由路径、请求/响应字段、词典键。
 * 防止以后改 index.js 忘了同步 client.js（或反过来）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(join(ROOT, 'client.js'), 'utf8');
const host = readFileSync(join(ROOT, 'index.js'), 'utf8');
const zh = JSON.parse(readFileSync(join(ROOT, 'locale', 'zh.json'), 'utf8'));

test('contract: route path identical on both halves', () => {
  // Host: const ROUTE = '/bili-config'
  assert.match(host, /const ROUTE = '\/bili-config'/);
  // Client: const API = '/bili-config'
  assert.match(client, /const API = '\/bili-config'/);
});

test('contract: every client fetch endpoint exists in host handler', () => {
  const endpoints = [...client.matchAll(/fetch\(`\$\{API\}([^`]*)`\)/g)].map((m) => m[1]);
  assert.ok(endpoints.length >= 2, 'expected at least /state and /stats fetches');
  for (const ep of endpoints) {
    const literal = ep.replace(/\$\{[^}]*\}/g, '.*');
    assert.ok(
      new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, (s) => (s === '.*' ? '.*' : '\\' + s))).test(host),
      `client fetches ${ep} but host does not handle it`,
    );
  }
});

test('contract: host apply accepts { preset } and { patch }', () => {
  assert.match(host, /body\.preset/);
  assert.match(host, /body\.patch/);
  assert.match(client, /applyBody\(\{ preset: id \}\)/);
  assert.match(client, /applyBody\(\{ patch:/);
});

test('contract: metrics keys produced by lib are the keys client renders', () => {
  const libSrc = readFileSync(join(ROOT, 'lib', 'logtail.mjs'), 'utf8');
  // lib 里产出的指标名
  for (const key of ['usage', 'pendingT1', 'growth', 'cacheHit', 'driftCount', 'degenerateCount', 'shrinkCount', 'lastShrink']) {
    assert.ok(new RegExp('\\b' + key + '\\b').test(libSrc), `lib missing metric: ${key}`);
    assert.ok(new RegExp('\\b' + key + '\\b').test(client), `client never renders metric: ${key}`);
  }
});

test('contract: whitelist keys host↔client consistent', () => {
  // client 的 keyHelp 只覆盖主要键，但出现的键必须在白名单里
  const libSrc = readFileSync(join(ROOT, 'lib', 'config.mjs'), 'utf8');
  const wlBlock = libSrc.match(/WHITELIST = Object\.freeze\(\{([\s\S]*?)\n\}\)/)?.[1] ?? '';
  const clientKeys = [...client.matchAll(/'(compress\.[a-zA-Z.]+)'/g)].map((m) => m[1]);
  const unique = [...new Set(clientKeys)];
  assert.ok(unique.length >= 3, 'client references almost no whitelist keys?');
  for (const k of unique) {
    assert.ok(wlBlock.includes(k), `client references key not in WHITELIST: ${k}`);
  }
});

test('contract: locale zh.json tab key matches client dict', () => {
  // client 内置 zh.tab 应与 locale 文件一致（宿主词典优先，内置兜底）
  const clientTab = client.match(/tab: '([^']+)'/)?.[1];
  assert.equal(clientTab, zh.tab);
});

test('contract: presets labels appear in client dict', () => {
  for (const id of ['Conservative', 'Balanced', 'Aggressive']) {
    assert.ok(client.includes(`preset${id}`), `client missing preset${id} label`);
  }
  assert.ok(client.includes('presetHint'));
});

test('contract: dsh bundle id matches cordis.patch.yml', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
  assert.equal(pkg.dsh.id, 'dsh-bili-config');
  assert.ok(patch.includes("name: 'dsh-bili-config'"), 'patch must insert name dsh-bili-config');
  assert.equal(pkg.exports['./client'], './client.js');
  assert.equal(pkg.main, './index.js');
});
