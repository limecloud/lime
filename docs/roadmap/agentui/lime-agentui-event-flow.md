# Lime AgentUI 事件流程

> 状态：流程设计
> 更新时间：2026-04-30
> 目标：固定 AgentUI 的关键运行流，避免 UI 层用局部状态猜测 runtime 行为。

## 1. 事件事实源

AgentUI 的运行事实来自五类投影：

| 投影 | 入口 | UI 消费 |
| --- | --- | --- |
| AgentEvent stream | `src/lib/api/agentProtocol.ts` | 流式文本、thinking、tool、artifact、runtime status、queue、done |
| Session detail | `getAgentRuntimeSession` / `agent_runtime_get_session` | 打开旧会话、历史窗口、thread items、queued turns、thread read |
| Thread read | `getAgentRuntimeThreadRead` / session detail 内联 | pending requests、last outcome、incident、interrupt、queue |
| Timeline | `AgentTimelineRecorder` 持久化的 turn/item | Process layer、Evidence layer |
| Artifact/Evidence files | `.lime/artifacts`、`.lime/harness` | Workbench、Harness、Review、Replay |

事件流原则：

1. 新 UI 只新增投影或 selector，不新增第二条 runtime event。
2. 对话正文只消费 `text` 和最终答复相关 preview。
3. thinking/tool/status/action/artifact 必须分型，不拼接进同一个 Markdown 字符串。
4. 历史恢复消费 session detail，流式执行消费 AgentEvent，两者最终进入同一前端 state shape。

## 2. 发送消息流程

```mermaid
flowchart TB
  Start([用户点击发送]) --> Validate[Inputbar 校验 prompt / attachments / model / access mode]
  Validate --> Optimistic[前端创建乐观 user message 和 assistant placeholder]
  Optimistic --> Bind[注册 AgentEvent listener]
  Bind --> Submit[submitAgentRuntimeTurn]
  Submit --> Command[agent_runtime_submit_turn]
  Command --> Queue{runtime queue 是否忙}
  Queue -->|空闲| StartTurn[启动 turn]
  Queue -->|忙碌且允许排队| Enqueue[写入 queued turn 并发 queue_added]
  Queue -->|忙碌且 steer| Steer[注入当前 turn 或 pending input]

  StartTurn --> EarlyStatus[尽早发 runtime_status preparing/routing]
  EarlyStatus --> Runtime[Aster Agent Runtime]
  Runtime --> Events[turn_started / thinking_delta / text_delta / tool / artifact / action_required]
  Events --> FrontendReducer[handleTurnStreamEvent 更新前端状态]
  FrontendReducer --> UI[Conversation / Process / Task / Artifact UI]
  Events --> Recorder[AgentTimelineRecorder]
  Recorder --> TimelineDb[(timeline DB)]
  Runtime --> Done[done / final_done]
  Done --> Reconcile[reconcileFinalContentParts 防重复吐字]
  Reconcile --> Complete[停止 sending，收起 transient status]
```

关键约束：

- listener 必须先于 submit 注册，避免首事件丢失。
- `runtime_status` 应早于首个 `text_delta`，用于首字前反馈。
- `text_delta` 只进入 text part；`thinking_delta` 只进入 thinking part。
- `final_done` 只能 reconcile，不应把完整 final text 再追加一遍。
- tool/artifact/action 事件进入 process/task/artifact 投影，不污染最终正文。

## 3. 打开旧会话流程

```mermaid
flowchart TB
  Click([用户打开历史会话]) --> Tab[创建或激活 topic/tab]
  Tab --> Snapshot{有 cached snapshot?}
  Snapshot -->|有| ApplySnapshot[立即应用标题/最近消息/运行态快照]
  Snapshot -->|无| Shell[渲染 workspace shell + skeleton]
  ApplySnapshot --> Shell
  Shell --> Detail[getSession historyLimit=40]
  Detail --> Command[agent_runtime_get_session]
  Command --> Store[SessionStore tail window + turns/items]
  Store --> ThreadRead[构建 thread_read / queue snapshots / history cursor]
  ThreadRead --> HydrateMessages[优先 hydrate messages]
  HydrateMessages --> RenderLight[MessageList 轻量渲染最近消息]
  RenderLight --> DeferTimeline[延迟 timeline/tool/artifact detail]
  DeferTimeline --> Idle[空闲时补过程层]
  RenderLight --> HistoryCursor{history_truncated?}
  HistoryCursor -->|是| LoadMore[显示加载更早历史入口]
  HistoryCursor -->|否| Done[完成恢复]
```

关键约束：

- 不等待全量历史再挂载 UI。
- 不在打开旧会话时同时触发无 `historyLimit` 的 `getSession`。
- sidebar list 刷新应低优先级，不能抢 session detail 主链。
- 非活跃 tab 只保留 snapshot，不构建完整 MessageList/timeline。
- full history 只能分页，不回退到 `historyLimit: 0` 的默认路径。

## 4. Queue / Steer 流程

```mermaid
flowchart TB
  Input([当前 turn 运行中用户继续输入]) --> Mode{用户选择模式}
  Mode -->|Queue| QueueSubmit[submitTurn queueIfBusy=true]
  Mode -->|Steer| SteerSubmit[submitTurn steer/current-turn intent]
  QueueSubmit --> QueueAdded[queue_added]
  QueueAdded --> TaskCapsule[Task capsule 显示排队数量和下一条摘要]
  TaskCapsule --> QueuePanel[QueuedTurnsPanel 支持 promote/remove/edit]
  SteerSubmit --> PendingPreview[pending steer preview]
  PendingPreview --> Runtime[当前 runtime 消费 steer]
  Runtime --> Status[queue_started / queue_removed / runtime_status]
  Status --> UI[Task layer + Process layer 更新]
```

UI 规则：

- Queue 表示“本轮结束后执行”，Steer 表示“影响当前执行”。
- 两者必须有不同视觉和文案。
- queue 入口不应该触发新 tab 全量恢复。
- queue 操作应以 `queued_turn_id` 为稳定键，避免列表重排导致操作错位。

## 5. Action Required / Human-in-the-loop 流程

```mermaid
flowchart TB
  Runtime[Agent Runtime] --> ActionEvent[action_required]
  ActionEvent --> ThreadItem[approval_request / request_user_input item]
  ActionEvent --> Frontend[前端 pendingActions]
  Frontend --> Promote{是否提升到输入区 A2UI?}
  Promote -->|是| InputA2UI[Inputbar / bottom pending form]
  Promote -->|否| InlineCard[消息内 action card]
  InputA2UI --> UserDecision[用户批准/拒绝/填写]
  InlineCard --> UserDecision
  UserDecision --> Respond[respondAgentRuntimeAction]
  Respond --> Command[agent_runtime_respond_action]
  Command --> RuntimeResume[Runtime 继续执行]
  RuntimeResume --> Events[后续 text/tool/artifact/done]
```

UI 规则：

- `needs_input` 和 `plan_ready` 是 task capsule 的高优先级状态。
- 高风险动作必须显示明确操作对象、影响范围和确认按钮。
- action card 完成后应收起为历史摘要，不继续占据首屏。
- replay pending request 应从 `thread_read.pending_requests` 进入，不从文本猜测。

## 6. Artifact 流程

```mermaid
flowchart TB
  Runtime[Agent Runtime / Tool] --> ArtifactEvent[artifact_snapshot 或 write_artifact event]
  ArtifactEvent --> Timeline[AgentTimelineRecorder 写入 file_artifact item]
  ArtifactEvent --> ArtifactService[ArtifactDocument / ArtifactOps]
  ArtifactService --> Files[.lime/artifacts]
  ArtifactEvent --> Frontend[前端 artifact signal]
  Frontend --> MessagePreview[消息内简短 preview/card]
  Frontend --> Workbench[Canvas / Artifact Workbench 自动选择或提示]
  Workbench --> UserEdit[用户编辑 / diff / 导出]
```

UI 规则：

- artifact 主体不长期留在正文。
- 消息内 card 只做摘要和打开入口。
- artifact 版本、路径、metadata 应来自 artifact service，不由前端拼路径。
- `artifact_snapshot` 同时属于 process evidence 和 artifact delivery。

## 7. Evidence / Review 流程

```mermaid
flowchart TB
  User[用户或系统触发导出] --> Export[agent_runtime_export_evidence_pack]
  Export --> Detail[读取 session detail + thread_read]
  Detail --> Timeline[读取 timeline]
  Detail --> Artifacts[读取 artifact metadata]
  Timeline --> EvidenceService[runtime_evidence_pack_service]
  Artifacts --> EvidenceService
  EvidenceService --> Files[.lime/harness/sessions/<session>/evidence]
  Files --> HarnessPanel[HarnessStatusPanel 展示]
  HarnessPanel --> Review[导出 review decision template]
  Review --> ReviewService[runtime_review_decision_service]
  ReviewService --> ReviewFiles[.lime/harness/sessions/<session>/review]
```

UI 规则：

- evidence/review 是证据层，不应阻塞聊天流式输出。
- 导出动作应显示后台任务状态，完成后给 capsule/harness 入口。
- evidence 的 summary、timeline、artifact、verification 必须同源，不允许前端伪造通过状态。

## 8. 慢点排查流程

### 8.1 旧会话恢复慢

```mermaid
flowchart LR
  UserClick[click old session] --> UIStart[frontend switchTopic start]
  UIStart --> GetSession[runtimeGetSession.start]
  GetSession --> BackendLog[agent_runtime_get_session total/detail/projection/dto]
  BackendLog --> FrontendHydrate[finalize detail / hydrate messages]
  FrontendHydrate --> MessageCompute[MessageList timeline/group memo]
  MessageCompute --> Paint[first stable paint]
```

需要同时记录：

- click -> shell rendered。
- click -> `runtimeGetSession.start`。
- `runtimeGetSession.start` -> success。
- 后端 `detail_ms/projection_ms/dto_ms`。
- detail success -> messages rendered。
- messages rendered -> historical timeline idle completed。

### 8.2 首字慢

```mermaid
flowchart LR
  Send[send click] --> Bind[event listener bound]
  Bind --> Submit[submit invoke start]
  Submit --> Accepted[submit accepted]
  Accepted --> FirstEvent[first AgentEvent]
  FirstEvent --> FirstStatus[first runtime_status]
  FirstStatus --> FirstText[first text_delta]
  FirstText --> FirstPaint[first text paint]
```

需要同时记录：

- listener bound 时间。
- submit invoke 耗时。
- first event 时间。
- first runtime status 时间。
- first text delta 时间。
- delta flush queue depth。
- oldest unrendered delta age。
- catch-up mode transition。

### 8.3 CPU / 内存飙高

优先检查：

1. 是否多个 tab 同时全量恢复。
2. 是否非活跃会话仍在构建 `MessageList` 和 timeline。
3. 是否 `getSession(historyLimit: 0)` 或无 limit 请求被触发。
4. 是否 sidebar list 与 session detail 抢同一 invoke 通道。
5. 是否 streaming text 逐字动画在 backlog 很大时仍慢速推进。
6. 是否 tool output / artifact preview 被一次性塞入正文渲染。
