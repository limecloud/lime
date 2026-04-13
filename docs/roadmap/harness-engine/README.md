# Lime Harness Engine 对照路线图与长期检查表

> 状态：进行中，P0 已完成首刀收口
> 更新时间：2026-04-13
> 对照基线：LangChain 博文《The Anatomy of an Agent Harness》
> 目标：把 Lime 当前已经具备的 Harness 能力、真实缺口、后续建设优先级和长期复查口径收敛到一份可执行文档，而不是继续停留在抽象口号层。

配套图纸：

- `docs/roadmap/harness-engine/diagrams.md`

## 1. 先给结论

按 LangChain 这篇文章的标准看，Lime **已经不是“只有模型壳”的产品**，而是已经具备较完整 Harness 底座的 Agent 工作台。

但更准确的判断不是“已经完全成熟”，而是：

- **底座型 Harness：已基本成形**
- **闭环型 Harness：仍是部分完成**
- **长时自治型 Harness Engine：还没有完全收口**

一句话总结：

**Lime 当前最大的短板，不是“没有工具”或“没有运行时”，而是“证据闭环、长期执行闭环、动态装配闭环还不够强”。**

---

## 2. 本文使用的判断标准

LangChain 这篇文章把 Harness 定义为：

> 模型之外的一切代码、配置、执行环境、工具、约束、状态与编排逻辑。

因此本文不只看 prompt，也不只看 tool 数量，而是按下面这些维度对 Lime 做判断：

1. 系统提示词与规则注入
2. 文件系统与 durable state
3. Bash / code execution
4. sandbox / approval / execution policy
5. tools / skills / MCP / browser runtime
6. memory / search / AGENTS 注入
7. context rot 治理
8. long-horizon execution
9. verification / replay / review / evidence
10. just-in-time tool/context assembly
11. trace-driven harness self-improvement

---

## 3. Lime 当前总判断

### 3.1 已经成立的部分

Lime 当前已经明确具备以下 Harness 基础设施：

- system prompt 与 memory prompt 注入
- workspace / filesystem / artifact 持久化边界
- bash 与通用代码执行入口
- sandbox / approval / restriction profile
- skills / MCP / browser / workspace tools
- 子代理委派、handoff、evidence、replay 基础链
- context compaction、tool output compression、tool io offload

这说明 Lime 的主问题已经不是“缺零件”，而是“怎样把这些零件收敛成更强的闭环”。

### 3.2 仍然偏弱的部分

Lime 当前仍然缺少下面三类关键闭环：

1. **证据闭环不够强**
   `runtime -> evidence -> verification outcome -> review -> regression -> promote`
   这条链已经有雏形，但还没有形成默认强约束。

2. **长时执行闭环不够强**
   当前已有 queue / resume / provider continuation / auto continue / subagent，但还没有把“任务未完成时必须继续推进到完成标准”变成统一的 runtime 纪律。

3. **动态装配闭环不够强**
   当前有 catalog、surface、skill progressive disclosure，但 tool/context 仍偏“预配置”，而不是更强的 per-turn JIT 组装。

---

## 4. 对照矩阵

| LangChain Harness 能力                | Lime 当前状态 | 当前事实源                                                                                                                                                                                                                                                     | 结论                                                                                                                                                                                                          |
| ------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System Prompts / 规则注入             | 已落地        | `src-tauri/src/services/memory_profile_prompt_service.rs`、`src-tauri/src/services/memory_source_resolver_service.rs`                                                                                                                                          | Lime 已把 profile、memory source、project rule 注入到 system prompt 主链，不是裸 prompt 模式                                                                                                                  |
| Filesystem / Durable Storage          | 已落地        | `docs/aiprompts/overview.md`、`src-tauri/src/commands/aster_agent_cmd/tool_runtime/workspace_tools.rs`                                                                                                                                                         | Workspace、artifact、项目目录、文件工具都已经进入主链                                                                                                                                                         |
| Bash / Code Execution                 | 已落地        | `src-tauri/src/agent_tools/catalog.rs`、`src-tauri/src/agent_tools/execution.rs`                                                                                                                                                                               | Lime 已具备通用执行能力，不依赖“预先定义完所有工具”                                                                                                                                                           |
| Sandbox / Approval / Policy           | 已落地        | `src-tauri/src/agent_tools/execution.rs`、`docs/aiprompts/commands.md`                                                                                                                                                                                         | restriction profile、sandbox profile、warning policy 都已进入 runtime 主链                                                                                                                                    |
| Tools / Skills / MCP / Browser        | 已落地        | `docs/aiprompts/skill-standard.md`、`docs/aiprompts/command-runtime.md`、`src-tauri/src/agent_tools/catalog.rs`                                                                                                                                                | Lime 已有较完整 capability surface，不是单一 chat tool 模型                                                                                                                                                   |
| Memory / Search / AGENTS 注入         | 已落地        | `src-tauri/src/services/memory_source_resolver_service.rs`、`docs/aiprompts/overview.md`                                                                                                                                                                       | 记忆与规则文件已进入生产链，Web/MCP/search 也已存在                                                                                                                                                           |
| Context Rot 治理                      | 部分落地      | `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`、`src-tauri/crates/aster-rust/crates/aster/src/context_mgmt/mod.rs`、`src-tauri/crates/agent/src/tool_io_offload.rs`、`src-tauri/crates/aster-rust/crates/aster/src/context/compressor.rs` | 已有 compact、tool output compression、tool offload，但产品侧可见性与默认治理还不够强                                                                                                                         |
| Long-Horizon Execution                | 部分落地      | `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`、`src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs`、`src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`                                                         | 已有 auto continue、provider continuation、subagent、queue/resume，但还没形成统一 completion loop                                                                                                             |
| Verification / Replay / Review        | 部分落地      | `docs/aiprompts/harness-engine-governance.md`、`src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`、`src/lib/agentRuntime/harnessVerificationPresentation.ts`、`src-tauri/src/services/runtime_review_decision_service.rs`                     | evidence / replay / analysis / review 已成链；前端 verification 展示语义已收敛到共享 helper，review template 也开始直接携带同一份 structured verification summary，但验证结果尚未成为所有后续动作的默认硬约束 |
| Just-in-Time Tool / Context Assembly  | 待加强        | `src-tauri/src/agent_tools/catalog.rs`、`docs/aiprompts/skill-standard.md`、`docs/aiprompts/command-runtime.md`                                                                                                                                                | 已有 surface/profile/skill progressive disclosure，但仍偏静态 catalog，不够按任务即时裁剪                                                                                                                     |
| Trace-Driven Harness Self-Improvement | 待建设        | `docs/aiprompts/harness-engine-governance.md`、现有 evidence/replay/export 主链                                                                                                                                                                                | 已经具备取证底座，但还未形成“基于 trace 自动发现缺口并推进治理”的稳定平台能力                                                                                                                                 |

---

## 5. 关键事实源与它们分别证明了什么

### 5.1 Prompt / Memory / Rules

- `src-tauri/src/services/memory_profile_prompt_service.rs`
  证明 Lime 已把用户画像与 memory prompt 合并进 system prompt，而不是只靠前端临时拼接。
- `src-tauri/src/services/memory_source_resolver_service.rs`
  证明 Lime 已支持 user memory、durable memory、project rule、多层目录记忆来源解析。

### 5.2 Workspace / Tool Surface / Execution

- `src-tauri/src/agent_tools/catalog.rs`
  证明 Lime 已有 tool catalog、surface profile、capability、lifecycle、permission plane 这些 Harness 级抽象。
- `src-tauri/src/agent_tools/execution.rs`
  证明 Lime 已把 warning policy、restriction profile、sandbox profile 做成统一执行策略，而不是 scattered 规则。
- `src-tauri/src/commands/aster_agent_cmd/tool_runtime/workspace_tools.rs`
  证明 workspace tool 不只是文件读写，还承担 output summary、metadata、observability 编码职责。

### 5.3 Skills / Scene / Browser / MCP

- `docs/aiprompts/skill-standard.md`
  证明 Lime 对 skill 的理解已经是 bundle，而不是单一 Markdown 提示词。
- `docs/aiprompts/command-runtime.md`
  证明 Lime 已把 `@`、`/`、`scene`、`ServiceSkill`、tool/runtime binding 做成明确产品主链。
- `docs/aiprompts/overview.md`
  证明 browser runtime、plugin、MCP、terminal、artifact、workspace 都已进入总架构。

### 5.4 Context Rot / Offload / Continuation

- `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`
  证明 Lime 已有 `agent_runtime_compact_session`、resume thread、thread read model、evidence export 这类 runtime 操作主链。
- `src-tauri/crates/aster-rust/crates/aster/src/context_mgmt/mod.rs`
  证明 Aster 已有 continuation message 与 compact 后续写逻辑，Lime 不是完全没有 continuation。
- `src-tauri/crates/aster-rust/crates/aster/src/context/compressor.rs`
  证明 tool output 已有 head/tail compression。
- `src-tauri/crates/agent/src/tool_io_offload.rs`
  证明 Lime 已有通用 tool arguments/results offload、preview、eviction policy 与 `offload_file` 协议。
- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`
  证明 Lime 已有 auto continue、provider continuation state 恢复与 runtime 级 continuation 配置。

### 5.5 Evidence / Replay / Review / UI

- `docs/aiprompts/harness-engine-governance.md`
  证明 Lime 已明确要求 evidence pack 作为事实源，replay / analysis / review / UI 都应复用它。
- `src/lib/agentRuntime/harnessVerificationPresentation.ts`
  证明前端 verification label / variant / description 已开始从 `HarnessStatusPanel` 本地解释收敛到共享 helper，GUI 消费层不再各自维护一套语义。
- `src-tauri/src/services/runtime_review_decision_service.rs`
  证明 review decision 模板不再只携带 failure / recovered 文本列表，而开始直接透传 structured verification summary，review 消费层可以继续复用 evidence 同一份事实。
- `src/components/agent/chat/components/HarnessStatusPanel.tsx`
  证明前端已经能消费 evidence pack，并开始在 evidence / review 两个消费面直接复用共享 verification presentation helper；但展示仍偏状态卡，不是完整治理闭环。

---

## 6. 当前进度看板

### 6.1 按能力维度统计

- 已落地：6 项
- 部分落地：3 项
- 待加强：1 项
- 待建设：1 项

### 6.2 按建设层次统计

| 层次         | 当前状态 | 说明                                                                                 |
| ------------ | -------- | ------------------------------------------------------------------------------------ |
| 底座层       | 高       | prompt、memory、workspace、tool、sandbox、subagent、artifact 都已进入现役主链        |
| 运行时治理层 | 中高     | catalog、execution policy、compact、offload、evidence 已存在，但默认动作链还不够统一 |
| 闭环验证层   | 中       | replay / review / evidence 已有，verification outcome 到修复决策还不够强绑定         |
| 长时自治层   | 中       | continuation / queue / resume / subagent 已有，但 completion loop 仍偏弱             |
| 自我改进层   | 低       | 已能导出 trace 和证据，但还没有稳定的 trace-driven governance 平台                   |

### 6.3 本文建议的总体评级

- **当前阶段评级：B**
- **更准确描述：Harness 底座较强，闭环能力中等，自治能力未完全收口**

### 6.4 本轮已落地

- `agent_runtime_export_evidence_pack` 现已把 `observabilitySummary` 直接返回到前端消费层，而不再只埋在导出文件里。
- `observabilitySummary.verificationSummary` 现已补充显式 outcome，以及失败 / 恢复焦点列表。
- `HarnessStatusPanel` 现已开始直接展示验证结果、失败焦点和恢复结果，不再只显示 `known_gaps`。
- `analysis handoff` 现已开始显式携带 verification failure / recovered outcomes，外部诊断不再只看到 gap signals。
- `review decision` 模板现已复用 analysis-context 里的 verification failure / recovered outcomes，人工审核不再只靠简报文字猜测。
- `runtime_review_decision_service` 现已补上定向回归测试，覆盖“非空 recovered outcomes 从 evidence / analysis 透传到 review decision”的主链守卫，避免 review 层退回空结果假绿。
- `harness-eval-runner` 现已把 `currentRecoveredObservabilityVerificationOutcomes` 与 `currentRecoveredVerificationCaseCount` 作为 summary 一级事实导出，trend / cleanup / dashboard 不再只能从 `currentObservabilityVerificationOutcomes` 二次筛 recovered。
- `harness-eval-history-record` 现已优先复用 `summary.breakdowns/totals` 与 `trend.classificationDeltas/latest.totals` 里的 verification facts 来写入 failure / recovered 摘要，只把 cleanup 保留为兼容兜底，不再让历史记录层反向依赖 cleanup 作为事实源。
- `scripts/lib/harness-verification-facts.mjs` 现已成为 cleanup core / history record / dashboard 共用的 verification role 判定边界，`blocking_failure / advisory_failure / recovered` 不再在多个脚本里各自维护一套常量与判断。
- `harness-dashboard-core` 现已优先直接消费 `trend.classificationDeltas/latest.totals` 与 `summary.breakdowns` 来渲染 verification 统计卡和 focus table，只把 cleanup 保留给 recommendations / governance / doc freshness 这些真正属于 cleanup 的派生面。
- `generated-slop-report-core` 现已把 verification focus 选择、current/degraded/recovered 切分和 summary 组合收回 `harness-verification-facts` 共享 helper，不再在 cleanup core 内部重复维护一套“从 trend classification deltas 推导 verification 视图”的本地逻辑。
- `generated-slop-report-core` 中原本私有的 verification follow-up 规则，现也已收回 `scripts/lib/harness-verification-facts.mjs` 共享 helper；cleanup recommendation 只负责编排 P0/P1/P2 动作，不再自己维护 `guiSmoke/browserVerification/artifactValidator` 的补证据与回归语义。
- `harness-eval-history-record` 现在也已改为复用 `scripts/lib/harness-verification-facts.mjs` 的共享推导来生成 failure focus、current recovered baseline 和 case counts；history-record 不再自己维护一套 failure/recovered 焦点挑选与 cleanup fallback 计数逻辑。
- `harness-dashboard-core` 现在也已改为复用 `scripts/lib/harness-verification-facts.mjs` 的共享推导来生成 verification focus rows、current recovered baseline 与说明文案；dashboard 不再自己维护一套“trend / summary / cleanup 三选一”的 verification 视图拼装逻辑。
- `generated-slop-report-core` 的 signals / text output 现在也已改为复用 `scripts/lib/harness-verification-facts.mjs` 的共享 compact formatter；cleanup report 不再自己手写 `signal (outcome)` 标签格式，避免 recommendation、signals、dashboard 三处名称再度漂移。
- `generated-slop-report-core` 的 verification summary signals 现在也已改为复用 `scripts/lib/harness-verification-facts.mjs` 的共享 summarizer；cleanup 不再自己维护 failure / advisory / recovered / degraded baseline 的摘要句式，避免 signals、review 口径和后续展示再次漂移。
- `generated-slop-report-core` 的 recommendation rationale 里涉及 verification 的 blocking / advisory / recovered 摘要片段，现也已改为复用 `scripts/lib/harness-verification-facts.mjs` 的共享 builder；cleanup recommendation 不再自己维护 verification 解释句模板。
- `generated-slop-report-core` 的 `observability-evidence-follow-up` 里原本混合 verification / observability 的 rationale 与 backlog 文案，现也已改为复用 `scripts/lib/harness-verification-facts.mjs` 的共享 builder；cleanup recommendation 进一步退回“只编排、不解释”的消费层角色。
- `src/lib/agentRuntime/harnessVerificationPresentation.ts` 现已成为前端 verification label / badge / description 的共享展示边界，`HarnessStatusPanel` 不再自己维护 `blocking_failure / advisory_failure / recovered` 的中文文案与说明句式。
- `analysis-brief.md` 现已直接从 `observability.summary.verificationSummary` 生成紧凑的结构化验证摘要，外部 AI 先读 brief 时就能看到 `Artifact / Browser / GUI Smoke` 的同源 outcome 与统计，不必等到再下钻 `analysis-context.json`。
- `runtime_review_decision_service` 现已把 `analysis-context.json` 中的 structured verification summary 一并透传到 review template / review-decision.json，review 面不再只剩 failure / recovered 文本列表。
- `runtime_review_decision_service` 现已开始基于 `verification_summary + failure/recovered outcomes` 预填 review template 的默认 `followup_actions / regression_requirements`；阻塞失败会直接回挂到 replay / evidence / browser / GUI smoke 等默认动作，而不是继续留空等人工从零编排。
- `runtime_review_decision_service` 现已把 review template 默认动作进一步收口到 verification facts 共享语义：Artifact / Browser / GUI Smoke 的 follow-up 与 regression requirement 现在直接镜像 cleanup helper 的动作链，review 不再继续维护另一套手写句式。
- 前端 tauri mock、API 归一化测试与 `HarnessStatusPanel` 现也已对齐这组 facts-based 默认动作，浏览器 mock / 本地 UI 回归不再停留在“review 模板始终空白动作”的旧语义。
- `HarnessStatusPanel` 的 review decision 区块现已与 evidence pack 区块复用同一段 verification summary 展示，不再在 review 面再维护一套独立的 verification UI 解释。
- `RuntimeReviewDecisionDialog` 现已直接复用同一份 `HarnessVerificationSummarySection`，reviewer 在真正填写审核结论时看到的 verification facts 与 evidence / review 面板保持同源，不再在对话框里丢失事实基线。
- `review-decision.md` 现已直接从 `verification_summary` 生成紧凑的结构化验证摘要，人工审核产物本身也能看到 `Artifact / Browser / GUI Smoke` 的同源 outcome 与统计，不再只剩 failure / recovered 文本列表。

这意味着 Phase A 已从“只有 evidence 文件里有事实”推进到“evidence、analysis、review、GUI 展示开始共享同一份 verification facts”。

---

## 7. 最关键的缺口，不要再发散

### 缺口 1：Verification 还没有真正控制后续动作

当前 Lime 已有：

- evidence pack
- replay case
- analysis handoff
- review decision template
- GUI smoke / contracts / quality workflow

但仍缺：

- 统一的 verification outcome 模型，直接控制 review / promote / cleanup 优先级
- 失败后默认回挂到“补验证 / 重放 / 修复 / 再验证”的固定动作链
- promote / queue continuation / runtime action executor 还没有直接消费这组 outcome，verification 仍未真正成为统一动作调度器

这意味着 Lime 已经能“看见问题”，但还没有完全做到“看见问题以后所有后续动作都按同一事实推进”。

### 缺口 2：Long-horizon completion loop 还不够硬

当前 Lime 已有：

- queue / resume
- subagent runtime
- provider continuation
- auto continue
- compact / overflow recovery

但仍缺：

- 明确的 completion goal 与 exit criteria
- 更强的“未完成不得退出”统一 runtime 纪律
- 长任务中计划、验证、恢复、交接的标准化闭环

这意味着 Lime 现在更像“支持长任务”，还不完全像“强约束地把长任务做完”。

### 缺口 3：Tool / Context 仍偏静态装配

当前 Lime 已有：

- tool surface profile
- skill progressive disclosure
- command runtime 场景分型
- scene / ServiceSkill / browser assist 等收口规则

但仍缺：

- per-turn 动态组装工具面
- 基于任务类型裁剪 detour tools 的统一机制
- evidence 驱动的动态上下文注入，而不是更多静态预配

这意味着 Lime 已经知道“哪些能力存在”，但还没有稳定做到“当前任务只拿到真正需要的那一组能力和上下文”。

---

## 8. 接下来只优先做这 3 件事

### P0：把 Verification Outcome 提升成 Harness 一级事实

目标：

- 让 `evidence pack -> replay -> analysis -> review -> cleanup -> dashboard -> UI` 全部消费同一份 verification outcome

最低动作：

- 统一 verification outcome 字段，不允许下游自己再拼第二套真假判断
- 区分 `current gap`、`degraded gap`、`not_applicable`
- 让 review / promote / cleanup 的推荐动作只基于同一份 outcome 计算

完成标准：

- 同一线程的 failure / recovered / advisory 状态，在 evidence、review、cleanup、UI 中不再出现语义漂移

### P1：把 Long-Horizon 执行从“支持”升级为“约束”

目标：

- 让 Lime 对复杂任务不只是“可以继续”，而是“默认会继续直到满足完成标准”

最低动作：

- 给复杂任务补 completion goal / done criteria
- 把 auto continue、provider continuation、queue resume、subagent handoff 接成统一策略
- 让中断、恢复、交接、继续执行都能回挂到同一条 runtime 事实链

完成标准：

- 长任务出现暂停、压缩、续跑、交接时，仍能在同一 session 语义内解释“还差什么、为什么继续、何时结束”

### P2：把 Tool / Context 装配从 catalog 驱动升级为 task 驱动

目标：

- 让 runtime 在发起 turn 时更像“装配能力包”，而不是“打开一个大工具箱”

最低动作：

- 按任务类型定义基础 tool surface 模板
- 对图片、浏览器、站点、分析、转写、研究等场景，建立 detour tool 剔除规则
- 把 skill、memory、browser preload、verification context 统一成更强的 JIT 注入模型

完成标准：

- 当前任务不再默认暴露明显无关的 tool，且上下文噪音可被稳定压低

---

## 9. 分阶段演进路线

| 阶段    | 目标                          | 状态   | 备注                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase A | Harness 事实源收敛            | 进行中 | `evidence pack / replay / analysis / review` 已成链；verification summary 已回挂到前端导出结果、状态面板与 review template，`HarnessStatusPanel` 的 evidence / review verification 展示语义也已收敛到 `src/lib/agentRuntime/harnessVerificationPresentation.ts`，review decision 已补 structured summary 透传，eval runner 也已导出 current recovered verification 一级 breakdown |
| Phase B | Context rot 治理产品化        | 进行中 | compact、compression、offload 已有；下一步是让 UI、review、自动动作全部懂这些信号                                                                                                                                                                                                                                                                                                 |
| Phase C | Long-horizon 执行约束化       | 未完成 | continuation 能力存在，但 completion loop 还没成为平台纪律                                                                                                                                                                                                                                                                                                                        |
| Phase D | JIT 装配与场景裁剪            | 未完成 | 现阶段仍偏 static catalog + 手工场景约束                                                                                                                                                                                                                                                                                                                                          |
| Phase E | Trace-driven self-improvement | 未完成 | 目前取证能力具备，但还没形成长期治理平台                                                                                                                                                                                                                                                                                                                                          |

---

## 10. 长期检查表

这部分不是“建议”，而是后续每轮治理都应该复查的口径。

### 10.1 每次改 Harness Runtime 都检查

1. 是否继续只有一个事实源，还是又在 UI / analysis / replay 里拼了第二套真相？
2. 新增信号是否区分了 `exported / not_applicable / degraded / missing`？
3. 新增能力是否落在 `current` 主链，而不是又扩了一条 compat 旁路？
4. prompt、tool、sandbox、runtime metadata、UI 展示是否仍是同一条 contract？

### 10.2 每周检查

1. evidence pack 与 review template 是否存在字段漂移
2. known gaps 是否还在错误地把 `not_applicable` 当缺口
3. `output_truncated` 与 `offload_file` 是否能在前端稳定消费
4. context compaction 是否仍能在 thread read / replay / analysis 中一致呈现
5. 子代理、queue、resume、handoff 是否仍按同一 session 语义工作

### 10.3 每月检查

1. 哪些工具在当前任务中是长期噪音源，应该被 JIT 剔除
2. 哪些验证已经真实发生，哪些只是文档里提到但没进入 evidence 主链
3. 哪些 replay case 无法稳定复现，需要补环境、artifact 或 telemetry
4. 哪些 compat / deprecated surface 仍在偷偷长新逻辑
5. 哪些 HarnessStatusPanel、cleanup report、dashboard 文案与后端事实不一致

### 10.4 每季度检查

1. 长任务完成率是否提高，而不是只提高“能力数量”
2. 验证失败后是否更快回挂到补证据、补回放、补修复、补回归
3. 工具面是否比上季度更轻，而不是更重
4. 取证与治理链是否减少了人工判断分歧
5. 是否还在新增并行事实源、旁路协议、临时兼容层

---

## 11. 平台治理红线

后续只要出现下面任一情况，都应视为 Harness Engine 治理倒退：

1. 在 `analysis / replay / review / UI` 各自重新拼装第二套 runtime 真相
2. 为了图省事，把所有线程都写成同一种 known gap 模板
3. 在 `compat / deprecated` 路径继续长新功能
4. 为了“多给模型一点能力”，默认暴露更多无关工具和上下文
5. verification 没真实发生，却在证据层假装发生过
6. evidence 已经修正，展示层和治理层仍沿用旧字段、旧语义

---

## 12. 对 Lime 的最终定位

Lime 后续不应该把自己建设成“更多工具的聊天壳”，而应该明确建设成：

**一个以 workspace、artifact、verification、evidence、review 和长期治理为中心的 Harness Engine 平台。**

换句话说，Lime 的长期竞争力不在“会不会调模型”，而在：

- 是否能把模型接入稳定的执行环境
- 是否能把任务过程沉淀成可追溯证据
- 是否能把失败变成可修复、可回放、可治理的工程对象
- 是否能在长期演进中减少而不是放大系统熵

这才是 Lime 后续对齐 Claude Code / Codex / LangChain Harness 思路时，真正应该抓住的主线。
