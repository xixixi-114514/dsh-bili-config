/**
 * dsh-bili-config — Client 半（浏览器侧）。
 *
 * 视觉照 dsh-workspace-gate 的规格：单列行式、颜色只用 --dsh-alias-* 主题 token。
 * 数据：Host 半身注册的 /bili-config/state|apply|stats，同源 fetch。
 */
window.__ModuleLoader__.load({
  id: 'dsh-bili-config',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback } = React;
    const h = React.createElement;

    const NS = 'bili-config';
    const API = '/bili-config';

    const zh = {
      tab: 'bili 压缩',
      lead: '调 billion-context（ACP 压缩引擎）的触发阈值，看实时指标。配置写入即热生效，无需重启。',
      presets: '档位',
      presetConservative: '保守',
      presetBalanced: '均衡（推荐）',
      presetAggressive: '激进',
      presetHint: {
        conservative: '只钉住 reconcile=repair，阈值全用引擎默认。',
        balanced: '增长门槛 50000→25000：中等会话也能触发折叠。',
        aggressive: '增长门槛 20000 + 50% 压力线：长会话持续瘦身。',
      },
      currentPreset: '当前档位',
      noPreset: '（自定义）',
      metrics: '实时指标（日志尾部 512KB 窗口）',
      usage: '上下文占用',
      pendingT1: '待压缩积压',
      growth: '增长量',
      cacheHit: '缓存命中',
      drift: '折叠漂移',
      degenerate: '退化折叠',
      shrink: '实际压缩',
      lastShrink: '最近一次压缩',
      never: '（窗口内没有）',
      save: '保存',
      saving: '保存中…',
      saved: '已保存（热生效）',
      failed: '操作失败：',
      loadFailed: '读取失败：',
      loading: '读取中…',
      engineVersion: '引擎版本',
      configPath: '配置文件',
      logPath: '日志文件',
      keyHelp: {
        'compress.nudgeGrowthTokens': '增长门槛：新增内容达到该 token 数就触发折叠。默认 50000；会话攒不够就一直不压。',
        'compress.maxContextLimit': '压力线：占用超过窗口该比例时强制压缩。默认 75%。',
        'compress.emergencyThresholdPercent': '紧急线：超大工具输出紧急截断。默认 95%。',
        'compress.reconcile': '折叠漂移修复：repair=自动把掉出折叠的内容重新锚定。',
        'compress.minPressureBenefitTokens': '压力带触发所需的最小可回收 token 数。',
        'compress.preserveRecentMessages': '最近 N 条消息不参与折叠。',
        'compress.injectNudge': '是否注入压缩提醒消息。',
      },
      advanced: '逐键调整（白名单）',
      refresh: '刷新指标',
    };

    const en = {
      tab: 'bili fold',
      lead: 'Tune billion-context (ACP compression) thresholds and watch live metrics. Writes are hot-applied — no restart.',
      presets: 'Presets',
      presetConservative: 'Conservative',
      presetBalanced: 'Balanced (recommended)',
      presetAggressive: 'Aggressive',
      presetHint: {
        conservative: 'Pin reconcile=repair only; everything else stays at engine defaults.',
        balanced: 'Growth gate 50000→25000: mid-size sessions start folding too.',
        aggressive: 'Growth gate 20000 + 50% pressure line: long sessions keep slim.',
      },
      currentPreset: 'Current preset',
      noPreset: '(custom)',
      metrics: 'Live metrics (512KB log tail)',
      usage: 'Context usage',
      pendingT1: 'Pending fold',
      growth: 'Growth',
      cacheHit: 'Cache hit',
      drift: 'Fold drifts',
      degenerate: 'Degenerate folds',
      shrink: 'Folds done',
      lastShrink: 'Last fold',
      never: '(none in window)',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved (hot-applied)',
      failed: 'Failed: ',
      loadFailed: 'Load failed: ',
      loading: 'Loading…',
      engineVersion: 'Engine version',
      configPath: 'Config file',
      logPath: 'Log file',
      keyHelp: {
        'compress.nudgeGrowthTokens': 'Growth gate: fold once this many new tokens accumulate. Default 50000.',
        'compress.maxContextLimit': 'Pressure line: force-fold above this window fraction. Default 75%.',
        'compress.emergencyThresholdPercent': 'Emergency line: truncate huge tool outputs. Default 95%.',
        'compress.reconcile': 'Fold-drift repair: repair re-anchors content that fell out of folds.',
        'compress.minPressureBenefitTokens': 'Minimum reclaimable tokens before a pressure-band nudge.',
        'compress.preserveRecentMessages': 'Recent messages exempt from folding.',
        'compress.injectNudge': 'Inject fold-nudge messages.',
      },
      advanced: 'Per-key (whitelist)',
      refresh: 'Refresh',
    };

    const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);
    const num = (n) => (n === null || n === undefined ? '—' : String(n));

    function MetricRow({ label, value, hint }) {
      return h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--dsw-alias-border)' } },
        h('span', null, label),
        h('span', { title: hint || '', style: { fontFamily: 'var(--dsw-alias-font-mono, monospace)' } }, value),
      );
    }

    function buildPanel(_ctx, t) {
      const Panel = () => {
        const [state, setState] = useState(null);
        const [stats, setStats] = useState(null);
        const [busy, setBusy] = useState(false);
        const [msg, setMsg] = useState(null);

        const load = useCallback(async () => {
          try {
            const [s, st] = await Promise.all([
              fetch(`${API}/state`).then((r) => r.json()),
              fetch(`${API}/stats`).then((r) => r.json()),
            ]);
            setState(s);
            setStats(st);
            setMsg(null);
          } catch (e) {
            setMsg(t('loadFailed') + String(e?.message ?? e));
          }
        }, []);

        useEffect(() => {
          void load();
          const timer = setInterval(() => void load(), 5000);
          return () => clearInterval(timer);
        }, [load]);

        const applyBody = async (body) => {
          setBusy(true);
          try {
            const r = await fetch(`${API}/apply`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            });
            const j = await r.json();
            if (!r.ok) setMsg(t('failed') + (j?.error ?? r.status));
            else { setMsg(t('saved')); await load(); }
          } catch (e) {
            setMsg(t('failed') + String(e?.message ?? e));
          } finally {
            setBusy(false);
          }
        };

        if (!state) {
          return h('div', null, msg || h('p', null, t('loading')));
        }

        const preset = state.preset || t('noPreset');
        const keyRows = ['compress.nudgeGrowthTokens', 'compress.maxContextLimit', 'compress.reconcile', 'compress.minPressureBenefitTokens'];
        const editable = ['compress.nudgeGrowthTokens', 'compress.maxContextLimit'];

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          h('p', { style: { color: 'var(--dsw-alias-text-secondary)' } }, t('lead')),
          h('p', { style: { fontSize: '0.85em', color: 'var(--dsw-alias-text-secondary)' } },
            `${t('engineVersion')}: ${state.engineVersion ?? '—'} · ${t('configPath')}: ${state.configPath}`),

          // —— 档位 ——
          h('div', null,
            h('h3', { style: { margin: '0 0 6px' } }, `${t('presets')} · ${t('currentPreset')}: ${preset}`),
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              ['conservative', 'balanced', 'aggressive'].map((id) =>
                h('button', {
                  key: id,
                  disabled: busy,
                  title: t(`presetHint.${id}`),
                  onClick: () => void applyBody({ preset: id }),
                  style: {
                    padding: '6px 14px',
                    border: '1px solid var(--dsw-alias-border)',
                    borderRadius: '6px',
                    background: state.preset === id ? 'var(--dsw-alias-primary)' : 'var(--dsw-alias-surface)',
                    color: state.preset === id ? 'var(--dsw-alias-on-primary)' : 'var(--dsw-alias-text)',
                    cursor: 'pointer',
                  },
                }, t(id === 'conservative' ? 'presetConservative' : id === 'balanced' ? 'presetBalanced' : 'presetAggressive')),
              ),
            ),
          ),

          // —— 指标 ——
          h('div', null,
            h('h3', { style: { margin: '0 0 6px' } }, t('metrics')),
            h(MetricRow, { label: t('usage'), value: stats?.usage ? `${stats.usage.pct}% (${stats.usage.used}/${stats.usage.window})` : '—' }),
            h(MetricRow, { label: t('pendingT1'), value: stats?.pendingT1 ? `${stats.pendingT1.value}/${stats.pendingT1.threshold}` : '—' }),
            h(MetricRow, { label: t('growth'), value: stats?.growth ? `${stats.growth.value}/${stats.growth.gate}` : '—' }),
            h(MetricRow, { label: t('cacheHit'), value: stats?.cacheHit ? `${stats.cacheHit.pct}%` : '—' }),
            h(MetricRow, { label: t('drift'), value: num(stats?.driftCount) }),
            h(MetricRow, { label: t('degenerate'), value: num(stats?.degenerateCount) }),
            h(MetricRow, { label: t('shrink'), value: num(stats?.shrinkCount) }),
            h(MetricRow, { label: t('lastShrink'), value: stats?.lastShrink ? `${stats.lastShrink.ratio}% (~${stats.lastShrink.fromTok} tok)` : t('never') }),
          ),

          // —— 逐键 ——
          h('div', null,
            h('h3', { style: { margin: '0 0 6px' } }, t('advanced')),
            keyRows.filter((k) => editable.includes(k)).map((k) => {
              const v = state.values?.[k];
              const isPct = typeof v === 'string' && v.includes('%');
              return h('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' } },
                h('label', { style: { flex: 1, title: t(`keyHelp.${k}`) || '' } }, k),
                h('input', {
                  type: 'number',
                  defaultValue: isPct ? parseFloat(v) : typeof v === 'number' ? v : '',
                  disabled: busy,
                  style: {
                    width: '120px',
                    padding: '4px 8px',
                    border: '1px solid var(--dsw-alias-border)',
                    borderRadius: '4px',
                    background: 'var(--dsh-alias-surface, transparent)',
                    color: 'var(--dsw-alias-text)',
                  },
                  onBlur: (e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    const value = k.endsWith('maxContextLimit') ? `${raw}%` : raw;
                    void applyBody({ patch: { [k]: value } });
                  },
                }),
              );
            }),
          ),

          msg ? h('p', { style: { margin: 0, color: 'var(--dsw-alias-text-secondary)' } }, msg) : null,
        );
      };
      return Panel;
    }

    return {
      name: NS,
      inject: ['slots'],
      apply(ctx) {
        const builtin = () => (String(navigator.language || '').toLowerCase().startsWith('zh') ? zh : en);
        const t = (key, ...args) => {
          const table = builtin();
          const value = table[key];
          if (value === undefined) return key;
          return typeof value === 'function' ? value(...args) : value;
        };
        const Panel = buildPanel(ctx, t);
        try {
          ctx.slots.inject('plugins.tab', () =>
            ctx.slots.register(
              {
                name: 'plugins.tab',
                id: NS,
                order: 50,
                label: () => t('tab'),
                locale: NS,
                inject: () => ({ t }),
              },
              Panel,
            ),
          );
        } catch (error) {
          console.error('[bili-config] register plugins.tab failed:', error);
        }
      },
    };
  },
});
