/**
 * lib/compatibility.mjs — 插件冲突知识库 + 检测。
 *
 * 两个用途：
 *  1. 对外（npm 用户）：装本插件时检查已知的不兼容插件并给出人话提示。
 *  2. 对内：给 README / 未来 marketplace 的装机检查复用。
 *
 * 数据是"已知冲突面"的快照（来自对 3213 个目录插件的实际分析，2026-10-23）。
 * 不认识的插件一律视为"未知"——绝不猜"没冲突"。
 *
 * 条目语义：
 *  level: 'conflict'    — 同装会互相破坏（真打架）
 *         'incompatible' — 版本/引擎面不匹配，装不上或加载失败
 *         'overlap'      — 功能重叠，同装不报错但重复/空转（提示性）
 *         'complementary' — 明确互补，可放心同装（默认值，仅收录有说法的）
 *  with: 冲突针对谁（通常是 billion-context 或本插件）
 */

export const COMPAT = Object.freeze({
  // —— 真冲突（同域竞争、互相覆盖状态） ——
  'mosaic-memory-compress': {
    level: 'conflict',
    with: ['billion-context'],
    reason: '就地对话压缩（近/中/远三段折叠）与 billion-context 的 ACP fold 同域竞争：两个引擎对同一段历史各压一遍，互相覆盖对方的折叠状态。',
  },

  // —— 不兼容（版本/引擎面不匹配） ——
  'dsh-sieve': {
    level: 'incompatible',
    with: ['DSH 0.2.1-rc.2 宿主'],
    reason: 'engines/peer 锁 0.2.1-alpha.1 版本线，与 0.2.1-rc.2 宿主不匹配，安装会加载失败。',
  },
  '@zoria-lind/dsh-token-optimizer': {
    level: 'incompatible',
    with: ['DSH 0.2.1-rc.2 宿主', 'billion-context'],
    reason: 'dsh.compatibility 只声明到 >=0.1.7-rc.0 <0.2.0-0，当前宿主可能拒装；且其分层压缩与 billion-context 双管线叠加，有过度压缩丢信息风险。',
  },

  // —— 功能空转（不报错，但服务对象已被 billion-context 禁用） ——
  '@indexyz/dsh-autocompact': {
    level: 'overlap',
    with: ['billion-context'],
    reason: '调 DSH 原生 compaction 的阈值，而 billion-context 的 dsh.bundle.patch.yml 已把 compaction-basic 禁用（auto:false）——同装不报错但功能空转。',
  },
  'smart-compaction': {
    level: 'overlap',
    with: ['billion-context'],
    reason: 'compact_now/context_status 工具走原生 compaction，已被 billion-context 的 patch 禁用；同装大概率无感。',
  },
  'dsh-idle-compact': {
    level: 'overlap',
    with: ['billion-context'],
    reason: 'KV 缓存过期前自动压缩走原生 compaction，已被 billion-context 禁用面覆盖；同装可能无效。',
  },
  'dsh-context-guardian': {
    level: 'overlap',
    with: ['billion-context'],
    reason: '为 compaction-basic 提供兜底编译器，但该服务已被 billion-context 的 patch 禁用——服务对象停摆，功能空转。',
  },

  // —— 同类重复（择一） ——
  'dsh-cost-meter': {
    level: 'overlap',
    with: ['dsh-whale-widget'],
    reason: '余额/费用挂件与 dsh-whale-widget 完全同域；同装会出现两个费用挂件且数字可能不一致（价格表来源不同）。',
  },
  'dsh-tool-manager': {
    level: 'overlap',
    with: ['dsh-workspace-gate'],
    reason: '工具按 preset 分组开关与 dsh-workspace-gate 的按工作区门控功能重叠，二选一即可。',
  },
  'dsh-llm-failover': {
    level: 'overlap',
    with: ['dsh-model-failover'],
    reason: '限流切 provider 与 dsh-model-failover 的熔断路由功能重叠，两者择一。',
  },
  'dsh-keep-running': {
    level: 'overlap',
    with: ['@frog755/dsh-client-auto-retry'],
    reason: '429 配额看门狗与 auto-retry 都做"自动续跑"，功能重叠择一（另依赖 @deepseek-ai/dsh-schedule）。',
  },

  // —— 明确互补（有说法的才收录） ——
  'dsh-model-failover': {
    level: 'complementary',
    with: ['billion-context'],
    reason: '走 llm/stream 层做熔断与备用模型路由，与压缩管线正交；peer ^0.2.1-rc.2 匹配当前宿主。',
  },
  '@2jumpsina/dsh-context-guard': {
    level: 'complementary',
    with: ['billion-context', 'dsh-bili-config'],
    reason: '只读观测（上下文占比/交接草稿/压缩记账），不写任何压缩管线配置，与本插件零重叠。',
  },
  'dsh-workspace-gate': {
    level: 'complementary',
    with: ['billion-context', 'dsh-bili-config'],
    reason: '按工作区摘工具 schema 与提示词段，与压缩完全正交，可实打实省每轮前缀 token。',
  },
  '@frog755/dsh-client-auto-retry': {
    level: 'complementary',
    with: ['billion-context'],
    reason: 'turn/end error 自动续发"继续"，与压缩管线和 failover 均正交。',
  },
  '@michengai/dsh-btw': {
    level: 'complementary',
    with: ['billion-context'],
    reason: '/btw 一次性旁问，独立轻会话，零持久面。',
  },
});

/**
 * 检测一组已装/候选插件名，返回与 billion-context / 本插件相关的冲突提示。
 * @param {string[]} installedNames 已安装（或打算安装）的插件名列表
 * @returns {{ hasFindings: boolean, findings: Array<{name, level, with, reason}> }}
 */
export function checkCompatibility(installedNames) {
  const list = Array.isArray(installedNames) ? installedNames : [];
  const findings = [];
  for (const raw of list) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const entry = COMPAT[name];
    if (entry && (entry.level === 'conflict' || entry.level === 'incompatible' || entry.level === 'overlap')) {
      findings.push({ name, level: entry.level, with: entry.with, reason: entry.reason });
    }
  }
  return { hasFindings: findings.length > 0, findings };
}

/**
 * 把检测结果渲染成一句人话（中文）。
 * 有发现时形如：
 *   ⚠️ mosaic-memory-compress 与 billion-context 冲突：就地对话压缩……
 * 多条时逐行列出。
 */
export function formatFindings(result, t) {
  const T = t || ((k, ...a) => k);
  if (!result || !result.hasFindings) return '';
  const LEVEL_LABEL = {
    conflict: T('level.conflict'),
    incompatible: T('level.incompatible'),
    overlap: T('level.overlap'),
  };
  const lines = [];
  for (const f of result.findings) {
    const who = f.with && f.with.length ? f.with.join(T('listJoin')) : '';
    lines.push(`${T('itemPrefix')} ${f.name} ${T('conflictsWith')} ${who}：${f.reason}（${LEVEL_LABEL[f.level] || f.level}）`);
  }
  return lines.join('\n');
}
