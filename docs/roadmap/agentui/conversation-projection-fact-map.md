# AgentUI 对话事实源地图

> 状态：current fact map
> 更新时间：2026-05-05
> 范围：AgentUI 对话主链 Phase 0，覆盖会话、消息、流式、队列、artifact、历史窗口、性能诊断与 MessageList render window。

## 1. 分类口径

| 分类 | 含义 |
| --- | --- |
| `current` | 当前允许继续演进的事实源或投影边界。 |
| `compat` | 只做适配与委托，不新增业务判断。 |
| `deprecated` | 只允许迁移和下线。 |
| `dead` | 已无入口或与 current 冲突，后续删除或补守卫。 |

`projection_only=true` 表示该状态只服务 UI 展示、订阅或性能诊断，不能反写 runtime、artifact、evidence 或 Warp governance。

## 2. Runtime Identity

| state_key | owner | current_writer | readers | persistence | runtime_fact_source | projection_only | 分类 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `workspaceId` | Workspace / App shell | Workspace selection | AgentUI hooks、runtime commands、sidebar | workspace state | Workspace runtime | false | current |
| `sessionId/topicId` | Agent runtime session | `agent_runtime_*` + session lifecycle controller | tabs、MessageList、stream、artifact、evidence | runtime session repository | `agent_runtime_identity` | false | current |
| `threadId` | Agent runtime thread | runtime event / session detail | MessageList、thread timeline、artifact linking | runtime session detail | thread runtime | false | current |
| `turnId` | Agent runtime turn | runtime event stream | stream reducer、MessageList、task capsule | runtime event / thread_read | runtime event | false | current |
| `taskId` | Task / Warp task index | runtime event / task index | capsule、workbench、evidence | task index / artifact graph | Warp task index | false | current |

约束：AgentUI projection store 可以保存这些 id 的引用，但不能生成新的 runtime identity。

## 3. Session And History

| state_key | owner | current_writer | readers | persistence | runtime_fact_source | projection_only | 分类 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `topics` | topic list controller | `agent_runtime_list_sessions` | sidebar、tab strip、initial navigation | runtime session list | runtime session index | false | current |
| `activeSessionShell` | session lifecycle controller | topic click / new task / draft materialize | workspace shell、tab strip | memory + route | runtime session id | true | current |
| `cachedSessionSnapshot` | session hydration controller | cached detail / recent messages | pending shell、MessageList | memory cache | runtime session detail | true | current |
| `sessionHistoryWindow` | session hydration controller | `getSession(historyLimit)` / paged history | MessageList、performance metrics | memory state | runtime session detail | true | current |
| `restoreCandidate` | session lifecycle controller | workspace restore logic | first load / homepage send | local storage / runtime | runtime session id | false | current |
| `detachedSessionDetail` | session hydration controller | detail hydrate for sessions not in initial list | tab、MessageList | memory | runtime session detail | true | current |

约束：所有 `getSession` 主链必须带 `historyLimit` 或分页 cursor；完整历史只能通过显式分页或用户动作加载。

## 4. Messages And Thread Projection

| state_key | owner | current_writer | readers | persistence | runtime_fact_source | projection_only | 分类 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `messages` | session hydration + stream reducer | session detail / user draft / runtime event | MessageList、workspace send、artifact sync | runtime detail + memory drafts | runtime session detail / stream | false | current |
| `threadTurns` | runtime event reducer | runtime events / session detail | MessageList、timeline、task status | runtime detail | thread runtime | false | current |
| `threadItems` | runtime event reducer | runtime events / thread_read | MessageList、tool timeline、artifact cards | runtime detail / thread_read | thread runtime | false | current |
| `threadRead` | thread read projection | runtime command / thread_read | Process drawer、artifact card、diagnostics | runtime projection | thread_read | false | current |
| `messageRenderWindow` | message render projection | MessageList selector / history window selector | MessageList | memory only | derived from messages/history | true | current |
| `timelineRenderProjection` | message render projection | timeline projection / idle hydrate | MessageList timeline cards | memory only | derived from threadItems | true | current |

下一阶段目标：`MessageList` 逐步只消费 `messageRenderWindow`、`timelineRenderProjection`、`artifactSummaryProjection`，不再同步扫描全部历史数据。

## 5. Stream, Queue And Actions

| state_key | owner | current_writer | readers | persistence | runtime_fact_source | projection_only | 分类 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `streamRequest` | stream submission controller | send preparation / submit execution | inputbar、MessageList、diagnostics | memory | submit operation | true | current |
| `streamDiagnostics` | Conversation Projection Store | `recordAgentStreamPerformanceMetric` | E2E、debug panel、future diagnostics UI | memory ring / projection store | performance trace | true | current |
| `queuedTurns` | stream queue controller | runtime queue event / local queue | inputbar、task capsule | runtime queue / memory | runtime event | false | current |
| `pendingActions` | action request controller | runtime event / A2UI | inputbar、pending panel、capsule | runtime action request | runtime event | false | current |
| `childSubagentSessions` | task / subagent projection | runtime event / session detail | task capsule、process drawer | runtime session detail | runtime event | false | current |

首个代码 slice 选择 `streamDiagnostics`，原因是它是纯 UI/诊断 projection，不改变 runtime 行为，适合验证 Projection Store 和 selector 边界。

## 6. Artifact And Evidence

| state_key | owner | current_writer | readers | persistence | runtime_fact_source | projection_only | 分类 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `artifact_snapshot` | runtime / artifact service | runtime event / artifact command | MessageList summary、Workbench | artifact service | Artifact Graph | false | current |
| `ArtifactDocument` | artifact service | artifact writer / workbench save | Workbench、viewer、evidence | filesystem / artifact db | Artifact Graph | false | current |
| `artifactSummaryProjection` | message render projection | artifact graph / thread_read selector | MessageList card | memory only | Artifact Graph reference | true | current |
| `evidencePack` | harness engine | evidence export command | Harness panel、review、replay | evidence pack storage | Evidence / Replay | false | current |
| `reviewDecision` | harness engine | review command | Harness panel | review service | Evidence / Review | false | current |

约束：MessageList 只能展示 artifact 摘要和入口，不能从正文文本猜 artifact kind，也不能成为 artifact/evidence owner。

## 7. 当前 Phase 1 接入点

本轮进入 Phase 1 的最小闭环：

```text
recordAgentStreamPerformanceMetric
  -> recordConversationStreamDiagnostic
  -> Conversation Projection Store: streamDiagnostics
  -> selector tests
```

该闭环只新增 projection 写入，不改变现有 `window.__LIME_AGENTUI_PERF__`、E2E summary、runtime event 或 UI 展示行为。
