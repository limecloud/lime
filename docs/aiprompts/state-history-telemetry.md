# State / History / Telemetry 主链

## 这份文档回答什么

本文件定义 Lime 当前 `State / History / Telemetry` 的唯一主链，主要回答：

- 哪些路径负责持久会话历史、线程稳定读模型、pending request / outcome / incident 投影
- `SessionDetail`、`AgentRuntimeThreadReadModel`、`RequestLog`、`agent_runtime_export_*`、`history-record` 分别属于哪一层
- 哪些页面、报表和导出只是消费这条主链，而不是继续定义另一套“真实线程状态”
- 哪些旧专题计划、原始遥测浏览面或旧 observability 语义只能作为附属层或退场面

它是 **当前 session / thread / turn / request / evidence / history 边界的 current 文档**，不是某个专题计划，也不是单独的 harness 或 reliability 页面说明。

## 什么时候先读

遇到以下任一情况时，先读本文件：

- 调整 `agent_runtime_get_session`、`agent_runtime_get_thread_read`、`agent_runtime_replay_request`
- 调整 `SessionDetail`、`AgentRuntimeSessionDetail`、`AgentRuntimeThreadReadModel`
- 调整 `build_pending_requests(...)`、`build_last_outcome(...)`、`build_incidents(...)`
- 调整 request correlation headers、`RequestLog`、`requestTelemetry`
- 调整 `agent_runtime_export_*`、handoff bundle、evidence pack、replay case、analysis handoff、review decision
- 调整 `scripts/harness-eval-history-record.mjs`、cleanup/dashboard、`HarnessStatusPanel.tsx`、`AgentThreadReliabilityPanel.tsx`
- 讨论“状态模型”“可靠性”“证据链”“历史窗口”这几个词时，发现大家已经在混用不同层的语言

如果一个需求同时碰到“会话历史 + 线程状态”“request telemetry + evidence 导出”“history-record + cleanup/dashboard”中的两项以上，默认属于本主链。

## 固定主链

后续 Lime 的 `State / History / Telemetry` 只允许向下面这条主链收敛：

`agent_sessions / agent_messages -> SessionDetail -> AgentRuntimeThreadReadModel -> RequestLog 关联键 -> handoff / evidence / replay / analysis / review -> history-record / trend / cleanup / dashboard -> HarnessStatusPanel / AgentThreadReliabilityPanel`

这条主链的固定判断是：

1. `SessionDetail` 是当前会话、回合、时间线 item 的唯一持久读模型入口。
2. `AgentRuntimeThreadReadModel` 是当前线程状态、pending request、最近 outcome、active incident 的唯一稳定线程读模型。
3. `RequestLog` 只有在带上 `session/thread/turn/pending/queued/subagent` 关联键后，才算当前线程的 request telemetry 事实源。
4. `agent_runtime_export_*` 与 `agent_runtime_save_review_decision` 是当前交接、证据、回放、分析、审核的唯一派生导出链。
5. `history-record / trend / cleanup / dashboard` 与 GUI 面板都是下游消费层，不允许反向定义 session 或 thread 真相。

固定规则只有一句：

**后续新增状态、历史或遥测能力时，只允许接到 `SessionDetail -> AgentRuntimeThreadReadModel -> RequestLog -> export/history` 这组 current 边界；不允许再造并列状态真相。**

## 代码入口地图

### 1. 持久会话与历史事实源

- `src-tauri/crates/agent/src/session_store.rs`
- `src-tauri/src/agent/aster_agent.rs` 的 `get_runtime_session_detail(...)`
- `agent_sessions / agent_messages`

当前这里负责：

1. 会话创建、列表、详情与最近消息预览。
2. 把消息、turn、timeline item、todo、子会话信息统一投影成 `SessionDetail`。
3. 为 `get_session`、`get_thread_read`、`replay_request`、`export_*` 提供同一份历史事实源。

固定规则：

- 持久会话历史统一收口到 `session_store.rs` 与 `SessionDetail`，不要让 UI 或脚本再各自重扫数据库拼第二套历史。
- 如果一个需求要解释“这一线程真实发生了什么”，先回到 `SessionDetail.messages / turns / items`，不要从页面状态或导出文件反推。

### 2. 线程稳定读模型与 reliability projection

- `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`
  - `agent_runtime_get_session`
  - `agent_runtime_get_thread_read`
  - `load_runtime_export_context(...)`
- `src-tauri/src/commands/aster_agent_cmd/dto.rs`
  - `AgentRuntimeSessionDetail`
  - `AgentRuntimeThreadReadModel`
  - `build_pending_requests(...)`
  - `build_last_outcome(...)`
  - `build_incidents(...)`
- `src-tauri/src/services/thread_reliability_projection_service.rs`

当前这里负责：

1. 从 `SessionDetail` 派生 pending request、最近 outcome、active incident。
2. 把派生结果同步到线程 reliability 投影表，再回读成稳定线程状态。
3. 统一组装线程状态、interrupt 状态、queued turn、diagnostics、latest compaction boundary。
4. 让 `get_session`、`get_thread_read` 与所有 `export_*` 共享同一份线程读模型加载前奏。

固定规则：

- 新的线程健康信号、等待态、重放态，优先落在 `dto.rs` + `thread_reliability_projection_service.rs`，不要先写到面板局部推断逻辑里。
- `get_session`、`get_thread_read` 与 `export_*` 必须复用同一套 `SessionDetail + queued_turns + projection` 组合，不允许各写各的 thread loader。
- `AgentRuntimeSessionDetail` 是“会话详情 + 稳定线程读模型”的组合返回，不是另一套事实源。

### 3. 请求关联键与 request telemetry 事实源

- `src-tauri/crates/server/src/handlers/api.rs` 的 `attach_request_correlation_metadata(...)`
- `src-tauri/crates/server/src/lib.rs` 的 `record_request_telemetry(...)`
- `src-tauri/crates/infra/src/telemetry/types.rs` 的 `RequestLog`

当前这里负责：

1. 从请求头把 `session_id / thread_id / turn_id / pending_request_id / queued_turn_id / subagent_session_id` 注入 `RequestContext.metadata`。
2. 在请求完成后记录统一 `RequestLog`，保留 provider、model、status、duration、token、credential 与上述关联键。
3. 让 evidence pack 可以按会话与线程真实 join 到 request telemetry 摘要。

固定规则：

- 如果当前线程没有匹配的 `RequestLog`，导出空摘要即可；不要再发明 `unlinked` 这一类伪会话级状态。
- request telemetry 的 join 条件优先看关联键，而不是 provider/model/时间戳的模糊猜测。
- 原始日志浏览、统计页、控制台可以展示 `RequestLog`，但不能反向定义 session/thread 的唯一真相。

### 4. 证据、交接与审核派生链

- `src-tauri/src/services/runtime_handoff_artifact_service.rs`
- `src-tauri/src/services/runtime_evidence_pack_service.rs`
- `src-tauri/src/services/runtime_replay_case_service.rs`
- `src-tauri/src/services/runtime_analysis_handoff_service.rs`
- `src-tauri/src/services/runtime_review_decision_service.rs`
- `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs` 的：
  - `agent_runtime_export_handoff_bundle`
  - `agent_runtime_export_evidence_pack`
  - `agent_runtime_export_analysis_handoff`
  - `agent_runtime_export_review_decision_template`
  - `agent_runtime_save_review_decision`
  - `agent_runtime_export_replay_case`

当前这里负责：

1. 统一复用 `load_runtime_export_context(...)` 拿到 `SessionDetail + AgentRuntimeThreadReadModel + workspace_root`。
2. 导出 handoff bundle、evidence pack、replay case、analysis handoff、review decision 模板与保存结果。
3. 把 request telemetry、verification outcomes、recent artifacts、timeline snapshot、review actions 作为下游派生链的共同输入。

固定规则：

- 派生导出层只能消费 `SessionDetail`、`AgentRuntimeThreadReadModel`、`RequestLog` 和现有工作区产物，不得回头再拼第二套 observability summary。
- verification 的适用性、known gaps、current/degraded 角色判断统一由 evidence pack 与 shared verification facts 决定。
- replay / analysis / review 不能跳过 evidence/handoff 直接定义自己的线程真相。

### 5. 历史窗口与下游汇总

- `scripts/harness-eval-history-record.mjs`
- `scripts/lib/harness-verification-facts.mjs`

当前这里负责：

1. 记录 summary 历史窗口，并继续派生 trend、cleanup 与 dashboard。
2. 统一从 summary / trend / cleanup 提炼 verification outcome 焦点与 recovered baseline。
3. 为 nightly report、cleanup recommendation、dashboard 卡片提供共享解释层。

固定规则：

- history-record 只记录当前 summary 窗口，不应回头重建运行时 thread 状态。
- verification outcome 的聚合与文案焦点统一走 `harness-verification-facts.mjs`，不要在 cleanup、dashboard、review 各自再写一套。
- 下游汇总必须区分 `current` 与 `degraded` 样本，不允许继续把两者混成同一种主线回归风险。

### 6. 用户可见稳定消费层

- `src/components/agent/chat/components/HarnessStatusPanel.tsx`
- `src/components/agent/chat/components/AgentThreadReliabilityPanel.tsx`

当前这里负责：

1. 展示 `threadRead`、queued turn、pending request、outcome、incident、handoff / evidence / replay / review 导出动作。
2. 复用会话稳定读模型、记忆预演和 verification 摘要，不自行读取另一套原始状态。
3. 为操作者提供当前线程可继续执行、可回放、可交接、可审核的统一面板。

固定规则：

- 页面层只能消费 `threadRead`、导出结果和 shared verification facts，不自己再扫描 timeline 或 request logs 定义第二套线程状态。
- UI 文案如果和 evidence pack / thread read 冲突，以后端稳定读模型为准。

## current / compat / deprecated / dead

### `current`

- `docs/aiprompts/state-history-telemetry.md`
- `src-tauri/crates/agent/src/session_store.rs`
- `src-tauri/src/agent/aster_agent.rs`
- `src-tauri/src/commands/aster_agent_cmd/dto.rs`
- `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs` 的 `get_session / get_thread_read / replay_request / export_*`
- `src-tauri/src/services/thread_reliability_projection_service.rs`
- `src-tauri/crates/server/src/handlers/api.rs`
- `src-tauri/crates/server/src/lib.rs`
- `src-tauri/crates/infra/src/telemetry/types.rs`
- `src-tauri/src/services/runtime_handoff_artifact_service.rs`
- `src-tauri/src/services/runtime_evidence_pack_service.rs`
- `src-tauri/src/services/runtime_replay_case_service.rs`
- `src-tauri/src/services/runtime_analysis_handoff_service.rs`
- `src-tauri/src/services/runtime_review_decision_service.rs`
- `scripts/harness-eval-history-record.mjs`
- `scripts/lib/harness-verification-facts.mjs`
- `src/components/agent/chat/components/HarnessStatusPanel.tsx`
- `src/components/agent/chat/components/AgentThreadReliabilityPanel.tsx`

这些路径共同构成当前状态 / 历史 / 遥测主链：

- 会话与时间线历史看 `SessionDetail`
- 线程稳定状态看 `AgentRuntimeThreadReadModel`
- request telemetry 看带关联键的 `RequestLog`
- 交接、证据、回放、分析、审核看 `agent_runtime_export_*`
- 历史窗口、cleanup 与 dashboard 只作为下游派生层

### `compat`

- `docs/roadmap/lime-aster-codex-state-model-implementation-plan.md`
- `docs/roadmap/reliability/README.md`
- `docs/roadmap/reliability/*`
- `src-tauri/src/commands/telemetry_cmd.rs`

保留原因：

- 这组路径仍然有用，但它们当前只能作为实现方案、专题排期或原始日志浏览入口。
- 它们可以解释“怎么做专项”，不能再解释“什么是当前唯一状态真相”。

退出条件：

- 新的状态模型判断、分类和导航回写统一落到本文件，不再把专题计划文档当仓库级总入口。
- 原始 request log 浏览面只展示 `RequestLog` 原始事实，并回链到 session / thread / evidence；不再自行扩展会话级状态语义。

### `deprecated`

- `scripts/lib/generated-slop-report-core.mjs` 中仍保留的 `requestTelemetry:unlinked` 权重与同类旧 observability 语义
- 任何在没有匹配 `RequestLog` 时仍然输出全局 request telemetry 缺口的报表、脚本或面板逻辑
- 任何绕过 `AgentRuntimeThreadReadModel`、直接从 timeline / request logs 重新拼 pending request、outcome、incident 的实现

保留原因：

- 这类逻辑会把“没有匹配日志”“旧样本兼容状态”“当前真实缺口”混在一起，继续制造第二事实源。

退出条件：

- cleanup / dashboard / review 统一回到 `evidence pack + shared verification facts` 的 current/degraded 语义。
- `requestTelemetry` 只保留 `exported / known_gap` 等当前可解释状态，不再保留 `unlinked` 旧语义。

### `dead`

当前没有新增确认可立即删除的 `dead` 实现文件。

这轮主问题是并行计划和旧语义残留，而不是零引用代码；后续若 `reliability` 专项文档或旧报表分支完全失去入口，再单独转为 `dead`。

## 最低验证要求

如果本轮改动涉及本主链，至少按边界选择最贴近的验证：

- 纯文档 / 分类回写：`npm run harness:doc-freshness`
- 改 `SessionDetail`、`AgentRuntimeThreadReadModel`、projection 或 `export_*`：相关 Rust 定向测试
- 改 request correlation headers、`RequestLog` 或 cleanup/dashboard verification 语义：相关 Rust / Vitest 测试；必要时补 `npm run harness:cleanup-report:check`
- 改 Tauri 命令边界：额外执行 `npm run test:contracts`
- 改 `HarnessStatusPanel`、`AgentThreadReliabilityPanel` 等用户可见面：补现有 `*.test.tsx` 稳定断言；必要时再补 `npm run verify:gui-smoke`

## 这一步如何服务主线

`M5` 的目标不是一次性重写所有状态代码，而是先把状态、历史和遥测的事实源收成一条 current 主链。

从现在开始：

- 解释会话与历史回放时，回到 `SessionDetail`
- 解释线程当前能否继续、在等什么、最近为什么失败时，回到 `AgentRuntimeThreadReadModel`
- 解释 request telemetry 时，回到带关联键的 `RequestLog`
- 解释 evidence / replay / analysis / review / handoff 时，回到 `agent_runtime_export_*`
- 解释历史窗口、cleanup、dashboard 时，回到 `history-record + harness-verification-facts`

这样后续再做 reliability、history、review 或 operator 视图时，就不会继续在“状态模型”“线程读模型”“证据链”“遥测控制台”之间横跳排期语言。
