# 灵感库 / 记忆系统实施计划

> 状态：current rollout plan  
> 更新时间：2026-05-01  
> 目标：用小步收口方式，把当前混合型 MemoryPage 演进成普通用户灵感库与高级记忆诊断两层，而不打断 current 记忆主链。

## 1. 实施原则

1. 先分层，不重写底层。
2. 先用户控制，再自动保存。
3. 先稳定结果闭环，再扩多模态导入。
4. 先隐藏诊断默认入口，不删除诊断能力。
5. 每一刀都必须继续收敛到 `unified_memory_*` / `memory_runtime_*`。
6. Active memory、raw hit layer、auto organization、external provider 先走开发者面板，默认关闭。

## 2. Phase 0：口径和路线图落盘

目标：

1. 固定 Claude Code 架构参考与 Lime 前台差异。
2. 建立 research 与 roadmap 双事实源。
3. 明确普通用户层和高级诊断层。
4. 明确 Ribbi 是产品形态北极星，Claude Code / OpenClaw / Hermes 是底层架构参考。
5. 明确高级记忆能力默认关闭，而不是不建设。

主产物：

1. `docs/research/memory/README.md`
2. `docs/research/memory/inspiration-library-memory-research.md`
3. `docs/roadmap/memory/README.md`
4. `docs/roadmap/memory/prd.md`
5. `docs/roadmap/memory/architecture.md`
6. `docs/roadmap/memory/diagrams.md`
7. `docs/roadmap/memory/rollout-plan.md`
8. `docs/roadmap/memory/acceptance.md`

验收：

- research 只解释竞品与方向判断。
- roadmap 给出 PRD、架构、图谱、实施和验收。
- 文档只把 `docs/research/memory` 当 current research 路径。

## 3. Phase 1：普通灵感库与高级诊断 IA 分离

目标：

1. `MemoryPage` 默认只展示灵感库前台层。
2. 底层来源链、working memory、Team Memory、compaction、命中历史移入开发者面板 / 高级入口或折叠诊断面。
3. active memory recall preview、raw source / hit layer、auto organization experiments 默认关闭。
4. 侧栏 / 主导航继续只叫 `灵感库`。

建议改动：

1. 增加普通模式 section：`home / style / reference / outcome / preference / collection / pending`。
2. 增加高级模式入口：`diagnostics` 或设置页高级开关。
3. 增加开发者面板开关：`memory diagnostics`、`active memory recall preview`、`auto organization experiments`、`raw source / hit layer`。
4. 保留旧诊断组件，但从普通默认路径移出。
5. 更新测试，断言普通页面不出现底层术语，且高级开关默认关闭。

不做：

1. 不改 `memory_runtime_*`。
2. 不改 `unified_memory_*` 数据模型。
3. 不删除诊断能力。
4. 不默认启用 active recall 或自动整理实验。

验证：

```bash
npm exec vitest run "src/components/memory/MemoryPage.test.tsx"
npx eslint "src/components/memory/MemoryPage.tsx" "src/components/memory/MemoryPage.test.tsx"
```

如果主导航或 GUI 主路径明显变化，再补：

```bash
npm run verify:gui-smoke
```

## 4. Phase 2：用户控制闭环

目标：

1. 灵感条目支持编辑、删除、禁用。
2. 禁用条目不进入默认 reference selection。
3. 删除条目不再被推荐信号引用。
4. 每条灵感展示普通用户可理解的影响说明。

建议改动：

1. 在 projection view model 增加 `influenceState`、`influenceReason`、`nextActions`。
2. 给 `UnifiedMemory` 增加统一 metadata 状态约定，或先在现有 metadata 中保守承接。
3. 更新 `buildCuratedTaskReferenceEntries(...)` 过滤 disabled / archived / pending。
4. 删除后清理或忽略关联 recommendation signal。

风险：

- 如果状态仅存在前端缓存，会与 runtime recall 分叉。
- 因此状态必须进入统一持久层或统一 metadata 约定。

验证：

```bash
npm exec vitest run "src/components/memory/MemoryPage.test.tsx" "src/components/agent/chat/utils/curatedTaskReferenceSelection.test.ts"
npx eslint "src/components/memory/MemoryPage.tsx" "src/components/agent/chat/utils/curatedTaskReferenceSelection.ts"
```

如新增命令或改变 `unified_memory_*` 协议，补：

```bash
npm run test:contracts
```

## 5. Phase 3：自动整理待确认队列

目标：

1. 自动抽取候选先进入待整理。
2. 用户确认后才进入正式灵感库。
3. 支持新建、合并、更新、忽略、删除候选。
4. 候选显示来源摘要与建议理由。

建议改动：

1. 定义 `pending_review` 状态。
2. 把自动抽取与显式保存区分开。
3. 给 Memory 页面新增待整理视图。
4. 抽取 prompt 明确“不要保存可由当前项目状态推导出的事实”。
5. 敏感候选默认不自动 active。
6. 借鉴 OpenClaw Dreaming：auto organization / dreaming 实验默认 off，开启后也只写待整理候选和可审阅摘要。
7. 借鉴 Hermes：候选写入前做 injection / secret scan。

风险：

- 自动整理容易制造噪音。
- Phase 3 必须先做阈值和去重，不能全量保存历史。

验证：

```bash
npm exec vitest run "src/components/memory/MemoryPage.test.tsx" "src/lib/api/unifiedMemory.test.ts"
```

如改 Rust 抽取逻辑，补相关 `cargo test` 定向测试。

## 6. Phase 4：生成闭环强化

目标：

1. 所有高价值结果都能保存到灵感库。
2. 从灵感库继续生成统一进入 shared launcher。
3. 推荐信号实时影响首页、灵感库和 slash / curated task 推荐。
4. 结果 -> 灵感库 -> 推荐 -> 生成 -> 新结果闭环可解释。

建议改动：

1. 继续统一 `saveSceneAppExecutionAsInspiration(...)` 调用方。
2. 为普通灵感条目增加“推荐下一步”解释。
3. 将成果类灵感与 `我的方法` 草稿建立轻量回流。
4. 给保存后的结果卡展示“下一轮推荐会带上它”。

验证：

```bash
npm exec vitest run "src/components/memory/MemoryPage.test.tsx" "src/components/agent/chat/utils/saveSceneAppExecutionAsInspiration.test.ts" "src/components/agent/chat/utils/curatedTaskRecommendationSignals.test.ts"
```

GUI 相关补：

```bash
npm run verify:gui-smoke
```

## 7. Phase 5：Taste Layer 与我的方法融合

目标：

1. 从风格 / 偏好 / 参考里生成 taste summary。
2. 成果打法可以升级为 `我的方法`。
3. 复盘反馈能反哺灵感库和方法推荐。
4. 多模态参考进入同一 reference projection。

建议改动：

1. `buildInspirationTasteSummary(...)` 从展示摘要升级为可持久、可解释对象。
2. 成果条目提供“整理成我的方法”。
3. 复盘结果写回偏好 / 成果 / 方法候选。
4. 图片、链接、文档、转写等参考统一以 `context` / `reference` 投影。

不做：

1. 不新建 taste 平行事实源，除非后续明确 schema 与同步策略。
2. 不让多模态导入绕过用户确认。

## 8. Phase 6：高级诊断收口

目标：

1. 诊断入口固定到开发者面板、高级设置、线程可靠性或 dev flag。
2. 诊断视图只消费 `memory_runtime_*`。
3. 诊断视图支持 evidence 导出或问题定位。
4. active recall / raw source / hit layer / external provider trace 均受开关控制。
5. 普通灵感库不再承载 runtime 术语。

建议改动：

1. 抽出 `MemoryDiagnosticsPanel`。
2. 普通 `InspirationLibraryPage` 与诊断 panel 共享数据 hook，但分离文案和布局。
3. 抽出统一 feature gate，不让各组件自建诊断开关。
4. 用测试封住普通页面底层术语和默认关闭状态。
5. 文档更新 `docs/aiprompts/memory-compaction.md` 的用户可见层说明。

验证：

```bash
npm exec vitest run "src/components/memory/MemoryPage.test.tsx" "src/components/agent/chat/components/AgentThreadMemoryPrefetchPreview.test.tsx" 2>/dev/null || true
npm run test:contracts
```

## 9. 迁移与兼容

1. 旧 `MemoryPage` 的底层分区先迁到高级入口，不直接删除。
2. 旧 page params 继续兼容 `memory/home`、`memory/experience` 等深链。
3. 新普通 section 不改变 `unified_memory.category`。
4. 旧项目资料 compat 继续留在 `project memory` 附属层。
5. 如果新增状态字段，必须提供旧数据默认 `active` 的解释策略。
6. 外部 provider 只允许作为 experimental / advanced 附加层；同一时刻最多一个 active，关闭后不影响内置 current 主链。

## 10. 每轮完成定义

每个实施阶段完成时必须回答：

1. 普通用户看到的页面是否更简单。
2. 底层事实源是否仍然唯一。
3. 用户是否有足够控制权。
4. 高级诊断是否仍可排障。
5. 保存 / 推荐 / 继续生成闭环是否可验证。
6. 开发者开关默认关闭是否可验证。
7. 开启高级能力后，recalled context 是否 fenced / untrusted，候选是否经过 scan 和待确认。
