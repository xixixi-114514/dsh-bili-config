/**
 * dsh-bili-config — Host 半身。
 *
 * 做三件事：
 *  1. webServer 前缀路由 /bili-config：GET /state、POST /apply、GET /stats
 *  2. 配置文件键级读写（lib/config.mjs，白名单 + 备份 + 原子写）
 *  3. bili.log 尾部指标（lib/logtail.mjs）
 *
 * 注册一个 bili_config 工具，让模型侧也能只读查询指标。
 * UI 在 client.js（插件页 tab）。
 */

import { resolveConfigPath, currentValues, applyPatch, matchingPreset, engineVersion, PRESETS, WHITELIST } from './lib/config.mjs';
import { resolveLogPath, collectMetrics } from './lib/logtail.mjs';

export const name = 'bili-config';
export const inject = ['tools'];

const ROUTE = '/bili-config';
const TOOL_NAME = 'bili_config';

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function apply(ctx) {
  const configPath = resolveConfigPath();
  const logPath = resolveLogPath();

  const state = () => ({
    configPath,
    logPath,
    engineVersion: engineVersion(),
    values: currentValues(configPath),
    preset: matchingPreset(configPath),
    whitelist: Object.keys(WHITELIST),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, { label: p.label, values: p.values }])),
  });

  const handle = async (req, res, url) => {
    try {
      if (req.method === 'GET' && (url.pathname === `${ROUTE}/state` || url.pathname === `${ROUTE}`)) {
        return json(res, 200, state());
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE}/stats`) {
        return json(res, 200, collectMetrics(logPath));
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE}/apply`) {
        const body = await readBody(req);
        if (body.preset && PRESETS[body.preset]) {
          const result = applyPatch(configPath, PRESETS[body.preset].values);
          if (!result.ok) return json(res, 400, result);
          return json(res, 200, { ...result, preset: body.preset });
        }
        if (body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)) {
          const result = applyPatch(configPath, body.patch);
          if (!result.ok) return json(res, 400, result);
          return json(res, 200, result);
        }
        return json(res, 400, { error: 'need { preset } or { patch }' });
      }
      return json(res, 404, { error: 'not_found', path: url.pathname });
    } catch (error) {
      return json(res, 500, { error: String(error?.message ?? error) });
    }
  };

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() =>
      scope.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: (req, res) => {
          void handle(req, res, new URL(req.url, 'http://localhost'));
        },
      }),
    );
  });

  ctx.effect(() =>
    ctx.tools.register({
      name: TOOL_NAME,
      description: [
        '查看 billion-context 压缩引擎的实时指标与配置（只读）。',
        'action=stats 看 usage%、pendingT1、缓存命中率、fold 漂移计数；',
        'action=config 看当前配置路径与白名单键现值。',
      ].join(''),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['stats', 'config'], description: 'stats=实时指标；config=配置现值。' },
        },
        required: ['action'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      deferLoading: false,
      async execute(args) {
        if (args?.action === 'config') return state();
        return collectMetrics(logPath);
      },
    }),
  );
}
