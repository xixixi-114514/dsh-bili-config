# dsh-bili-config — 开发计划

## 一句话
给 billion-context（ACP 上下文压缩引擎）做一个图形化配置插件：设置页调阈值、看实时压缩指标、一键档位，发 GitHub + npm + 插件市场。

## 目标用户
装了 billion-context 的 DSH 用户（这个引擎在 DSH 用户里装机量极高——你的 profile 就装着），痛点：328KB 的 CONFIGURATION.md 没人读得完；阈值太保守导致"压缩从来不触发"（你的会话就是实例：usage 5%、pendingT1 33905 < 50000 门槛）；配置改了不知道有没有生效。

## 与 @indexyz/dsh-autocompact 的关系
**不重复。** autocompact 管 DSH 原生 compaction（dsh-compaction 服务，/compact 链路）；本插件管 billion-context 独立代理（~/.config/billion-context/billion-context.json，ACP fold 链路）。两者是"客厅空调遥控器"和"卧室空调遥控器"的关系，唯一交集是 UI 上给个"两台都别调太狠"的提示。

## 架构（模板：dsh-workspace-gate 0.1.1 —— engines 与我们宿主完全一致，目录结构已实读）

```
dsh-bili-config/
├── package.json          # engines.dsh ^0.2.1-rc.2；peer 只声明 cordis（模板同款宽松法）
├── cordis.patch.yml      # - insert: id: bili-config, name: 'dsh-bili-config', config: {}
├── index.js              # Host 半身
├── client.js             # 浏览器半身（window.__ModuleLoader__.load({...})）
├── lib/
│   ├── config.mjs        # 配置读写：键级合并、未知键透传、原子写、备份
│   └── logtail.mjs       # bili.log 尾部解析：usage%、pendingT1、cache hit、drift 计数
├── locale/zh.json, en.json
├── icon.svg
├── tests/config.test.mjs # 键级合并/未知键保留/备份/回滚的离线测试
├── README.md / README.en.md
└── LICENSE (MIT)
```

## Host 半身（index.js）要点（照抄模板的机制位）
1. `export const name = 'bili-config'; export const inject = ['tools'];`
2. webServer 前缀路由 `/bili-config`（模板 L768-778 的写法）：GET /state、POST /apply、GET /stats
3. 配置路径解析：优先 `BILI_CONFIG_FILE` env → `~/.config/billion-context/billion-context.json`（XDG_CONFIG_HOME 覆盖）
4. 写入策略（安全核心）：
   - 键级合并，**绝不整文件覆盖**（引擎两天升三版 0.1.202→0.1.204，键面在变）
   - 未知键 100% 原样保留
   - 每次写入前自动备份 `.bak-<ts>`（今晚已手工做过一次，同款命名）
   - 原子写：临时文件 + rename（防写坏）
5. 指标解析（bili.log 尾部 512KB 足够）：
   - `nudge idle: usage=X% (N/W), growth=G/22500, pendingT1=P/50000` → usage、pendingT1、growth
   - `[acp-usage] input=N cached=C (hit H%)` → 缓存命中率
   - `fold-reconcile.*drifted` / `degenerate-fold` → 漂移/退化折叠计数（带时间窗口）
6. 档位预设：
   - 保守：不动阈值，只开 reconcile:repair（=默认）
   - 均衡：nudgeGrowthTokens 50000→25000
   - 激进：nudgeGrowthTokens 20000 + maxContextLimit 50%
   全部映射到白名单键，档位=多个键的一次性写入

## Client 半身（client.js）要点
1. `window.__ModuleLoader__.load({ id: 'dsh-bili-config', factory(require){...} })`
2. `inject: ['slots']` → `ctx.slots.inject('plugins.tab', ...)` 注册到插件页 tab（模板 L1079-1091 同款）
3. 颜色只用 `--dsh-alias-*` 主题 token（模板硬规矩，明暗主题自动跟）
4. UI：三块 —— 档位三按钮、白名单键表单（数字输入+说明）、指标条（usage%/pendingT1/cache hit/drift 计数，5s 轮询 /bili-config/stats）
5. 中英词典内置 + locale 服务晚绑定（模板 L1063-1076 同款）

## 发布渠道（按 dshmarket README 的现实）
1. GitHub 仓库（先开源，README 双语 + 截图）
2. npm publish（name: dsh-bili-config）——市场索引 dsh-plugin-catalog 的 source.type:npm 会自动收录
3. 插件市场里可被"发现"页搜到；用户 `dsh plugin --profile desktop add dsh-bili-config` 一键装

## 已验证的坑（写进 README 的"已知边界"）
- /__bili__/ 管理面直接 curl 是 403（trust fence），所以走"写配置文件"而不是"调管理面 API"——billion-context 文档明说配置是"纯覆盖层+热更新"，写文件即生效，无需重启
- bili.log 10MB 自动轮转，读尾部即可，别全量读
- Windows 下配置目录是 ~/.config/billion-context（不是 AppData），因为 DSH 自带 git-bash 风格 HOME
- billion-context 自动升版（0.1.202→0.1.204 已发生过），所以"键白名单"要跟版本走：白名单外一律透传不修改

## 测试与验收
- `node --test tests/config.test.mjs`：键级合并/未知键保留/备份/原子写/路径解析（BILI_CONFIG_FILE 覆盖）
- 真机验收：装进 profile → 设置页出 tab → 切档位 → bili.log 里 nudge idle 行的 threshold 从 50000 变成 20000 → 发一句话 → 观察压缩实际触发
