# AgentUI 对话投影实施计划

> 状态：current planning source
> 更新时间：2026-05-05
> 目标：按 Warp 路线图的“事实源、阶段、验收、机器检查”写法，推进对话主链瘦身，解决旧会话恢复慢、首字慢、流式错乱和 MessageList 重渲染难排查问题。

## 0. 排序修正

本计划不能从“拆文件”开始。正确顺序是：

```text
对话事实源盘点
  -> Projection Store 边界
  -> Session lifecycle / hydration
  -> Stream submission / queue / event reducer
  -> Message render projection
  -> Workspace shell 瘦身
  -> 性能与治理守卫
```

固定原则：

1. projection 先服务现有 `useAsterAgentChat` public API，不一次性改穿所有调用方。
2. store 只做 UI projection，不成为 runtime fact source。
3. 每一刀必须能解释它如何降低首屏、首字、旧会话或 MessageList 的排查复杂度。
4. 与 Warp 事实源冲突时，以 `docs/roadmap/warp` 为准。

## Phase 0：对话事实源盘点

### 目标

把当前对话链路里的事实源、投影、UI 状态分清楚，避免继续把所有状态都塞进 hook 或组件。

### 范围

盘点：

1. `sessionId / threadId / turnId / taskId`
2. `messages / threadTurns / threadItems`
3. `thread_read / runtime_summary / permission_state`
4. `queuedTurns / pendingActions / childSubagentSessions`
5. `artifact_snapshot / ArtifactDocument / task artifact index`
6. `sessionHistoryWindow / cached snapshot / restore candidate`
7. stream performance trace
8. MessageList render window / hidden history / timeline projection

### 输出

更新或新增事实源表，字段至少包括：

1. `state_key`
2. `owner`
3. `current_writer`
4. `readers`
5. `persistence`
6. `runtime_fact_source`
7. `projection_only`
8. `current / compat / deprecated / dead`

### 验收

1. 每个对话状态能说明唯一 owner。
2. UI-only projection 与 runtime fact source 区分清楚。
3. 不能解释 owner 的状态不得继续扩展新逻辑。

## Phase 1：Projection Store 边界

### 目标

建立 `Conversation Projection Store`，用于 UI 切片订阅和轻量投影。

### 改动面

优先新增：

1. store 类型与 selector helper。
2. session / stream / queue / render / diagnostics 初始 slice。
3. `useAsterAgentChat` 内部适配层。

暂不改：

1. Tauri command。
2. agent runtime event protocol。
3. Warp governance JSON。

### 验收

1. `useAsterAgentChat` 对外返回 shape 不变。
2. selector 只在对应切片变化时触发。
3. store action 不写 runtime contract、artifact graph、evidence export。
4. 新增测试证明无关切片更新不触发订阅者。

## Phase 2：Session lifecycle / hydration 拆分

### 目标

把 `useAgentSession` 中的新建、切换、恢复、hydrate、列表、持久化拆成可单测 controller。

### 改动面

目标模块：

1. `sessionLifecycleController`
2. `sessionHydrationController`
3. `topicListController`
4. `sessionPersistenceController`

### 行为要求

1. 新建会话：先更新 shell 和内存状态，非关键本地持久化后台化。
2. 打开旧会话：先显示 target shell / cached snapshot / recent messages。
3. detail hydrate：统一带 `historyLimit`，完整历史分页。
4. 过期结果：统一通过 request version 丢弃。
5. sidebar list：低优先级，不阻塞 target session detail。

### 验收

1. 点击旧会话到 shell paint 不依赖 `getSession` 完成。
2. 打开两个历史会话来回切换不会互相覆盖。
3. 无 limit `getSession` 不再回到主链。
4. 相关测试能单独覆盖 lifecycle 与 hydration，不必挂载完整 workspace。

## Phase 3：Stream submission / queue / event reducer 拆分

### 目标

把首字链路拆成可观测、可定位、可测试的阶段。

### 改动面

目标模块：

1. `streamSubmissionController`
2. `streamEventReducer`
3. `streamQueueController`
4. `streamPerformanceTrace`

### 行为要求

1. 首轮无 session 时，UI shell 和 waiting status 先出现。
2. listener bound 早于 submit dispatch。
3. `thinking_delta`、`text_delta`、`tool_*`、`final_done` 严格分型。
4. `final_done` 只 reconcile，不二次 append。
5. queue / steer / follow-up 不绕过 runtime 主链。

### 验收

1. TTFT 日志覆盖 ensure、listener、submit、first event、first status、first delta、first paint。
2. 首字慢能从日志判断慢在 invoke、queue、provider、event bridge、flush 或 render。
3. 重复吐字、thinking 污染正文、空 final_done 均有回归。

## Phase 4：Message render projection

### 目标

让 `MessageList` 只消费预投影 render model，不再同步构建全部 timeline / group / artifact。

### 改动面

目标模块：

1. `messageRenderProjection`
2. `timelineRenderProjection`
3. `artifactSummaryProjection`
4. `messageWindowSelector`

### 行为要求

1. 首屏只投影可见消息窗口。
2. 历史 timeline / tool / artifact detail 延迟到 idle 或展开。
3. artifact kind 从 artifact graph、thread_read 或 task index 恢复。
4. 大 Markdown / 大 tool output 默认摘要化。

### 验收

1. 大历史会话首屏不构建完整 timeline。
2. MessageList render/projection duration 分开记录。
3. 图片、转写、browser snapshot 等不会从正文文本猜类型。
4. 大历史打开不出现长任务卡鼠标。

## Phase 5：Workspace shell 瘦身

### 目标

把 `AgentChatWorkspace` 从巨石入口收敛成 shell 和 panel 编排。

### 目标结构

```text
AgentChatWorkspace
  AgentWorkspaceShell
  SessionChrome
  ConversationPane
  WorkbenchPane
  ProcessDrawer
  TaskCapsuleStrip
```

### 验收

1. `AgentChatWorkspace` 不直接处理 stream event 细节。
2. tab、capsule、conversation、workbench、process drawer 分别有稳定边界。
3. 非活跃 tab 不持有重型 render projection。
4. 新建对话、打开历史会话、切换 tab 不跳出当前工作台。

## Phase 6：性能与治理守卫

### 目标

把“不要再堆回去”变成可检查规则。

### 守卫

后续实现应补：

1. UI projection 层禁止直接写 Warp governance JSON。
2. MessageList 禁止直接调用 runtime command。
3. viewer 禁止从正文文本猜 artifact kind。
4. 新增状态必须声明 owner 和 projection / fact source 分类。

### 验收

1. `npm run governance:modality-contracts` 继续通过。
2. 对话主链改动至少跑定向 hook / projection / MessageList 测试。
3. GUI 主路径改动继续按 `verify:gui-smoke` 或 Playwright 续测证明。
4. 性能采样能输出 shell、ensure、submit、first status、first text、projection、render 分段。

## 当前下一刀建议

优先做 Phase 0 + Phase 1 的最小闭环：

1. 写出对话状态 fact map。
2. 建一个最小 `Conversation Projection Store`。
3. 只接入一个低风险 slice：stream diagnostics 或 message render window。
4. 用 selector 测试证明不会扩大重渲染。

## 当前实施进度

- Phase 0 已建立 [conversation-projection-fact-map.md](conversation-projection-fact-map.md)。
- Phase 1 已落最小 `Conversation Projection Store`，首个 slice 为 `streamDiagnostics`。
- `recordAgentStreamPerformanceMetric` 继续写入原有 `window.__LIME_AGENTUI_PERF__`，同时同步写入 projection store；当前不改变 UI 行为和 runtime 协议。
- Phase 4 已落最小 `messageRenderWindow` 纯 projection，`MessageList` 先消费该 selector 产出的 `visibleMessages / renderedMessages / hiddenHistoryCount / shouldAutoHydrateHiddenHistory`。
- Phase 4 已继续落 `threadTimelineWindow` 纯 projection，`MessageList` 消费该 selector 产出的 `renderedTurns / renderedTurnIdSet / renderedThreadItems`。
- Phase 4 已继续落 `messageTimelineRender` 纯 projection，`MessageList` 消费该 selector 产出的 `timelineByMessageId / currentTurnTimeline / messageGroups / renderGroups`。
- Phase 4 已继续落 `historicalMessageHydration` 纯 projection，`MessageList` 消费该 selector 产出的历史 markdown hydration 目标、hydration index、延迟 contentParts 计数与结构化历史内容识别。
- Phase 2 已开始最小 controller 化：`sessionHydrationController` 统一旧会话详情 `historyLimit`、prefetch key/signature 与 request/session stale guard，避免无 limit `getSession` 和过期 hydrate 逻辑继续散落在 `useAgentSession`。
- Phase 2 已继续抽出 `sessionDetailFetchController`，统一 detail fetch / prefetch 复用 / prefetch fallback / fetch metrics / registry 清理，`useAgentSession` 只负责把事件接回现有性能日志与调试日志。
- Phase 2 已继续抽出 `sessionHydrationRetryController`，统一 deferred detail hydrate 失败后的 retry / transient skip / fatal fallback 决策，`switchTopic` 只负责调度重试或调用错误 fallback。
- Phase 2 已继续抽出 `sessionSwitchSnapshotController`，统一 cached snapshot 加载/应用、stale/running 立即刷新、pending shell 指标与 `localSnapshotOverride` 引用判定。
- Phase 2 已继续抽出 `sessionMetadataSyncController`，统一 finalize 后 accessMode / provider / executionStrategy fallback patch、switch success metric source 与批量/分散 metadata sync。
- Phase 2 已继续抽出 `sessionFinalizeController`，统一 finalize 阶段 workspace restore guard、runtime/topic/shadow workspace 汇总、shadow execution strategy fallback 与最终 execution strategy override。
- Phase 2 已继续抽出 `sessionMetadataSyncScheduler`，统一 finalize 后 metadata patch 的 invoke capability guard、旧调度取消、idle 调度、stale guard、成功回写与失败回调。
- Phase 2 已继续抽出 `sessionPostFinalizePersistenceController`，统一 finalize 后 topic workspace、workspace 映射持久化、runtime workspace topic 回写与 provider preference apply 的决策。
- Phase 2 已继续抽出 `sessionSwitchErrorController`，统一切换旧会话失败时的 session not found、保留当前快照、清空快照、刷新 topics 与 toast 决策。
- Phase 2 已继续抽出 `sessionHistoryPaginationController`，统一完整历史分页窗口、分页请求参数、detail loaded count 与下一轮 history window 计算。
- Phase 2 已继续抽出 `sessionHistoryMergeController`，统一完整历史分页 detail 返回后的 messages / turns / threadItems 合并与 currentTurnId 恢复计划。
- Phase 3 已开始最小 controller 化：`agentStreamSubmissionController` 统一 submit dispatched / accepted / failed 的耗时上下文与错误文案，`agentStreamSubmitExecution` 继续只负责串接 ensure session、listener binding 与 runtime `submitOp`。
- Phase 3 已继续抽出 `agentStreamSubmitOpController`，统一首页/对话流式提交的 `user_input` op payload 组装，并固定 `queueIfBusy` 语义；`agentStreamSubmitExecution` 不再直接拼 runtime submit payload。
- Phase 3 已继续抽出 `agentStreamListenerReadinessController`，统一 listener bound、first event、first event deferred、inactivity watchdog guard 的上下文与判断，首字链路 readiness 分段可单测。
- Phase 3 已继续抽出 `agentStreamSubmitLifecycleController`，统一 submit dispatched / accepted / failed metric、debug log 与 `runtime.submitOp` invoke 包装，提交生命周期可独立测试。
- Phase 3 已继续抽出 `agentStreamRequestStartController`，统一 request start metric、activity log payload 与 `requestState.requestStartedAt/requestLogId` 写入，首字链路起点可独立测试。
- Phase 3 已继续抽出 `agentStreamUnknownEventController`，统一未知 runtime event 活跃态保留、告警文案和告警去重计划，runtime projection/bootstrap 类未知事件不再由事件绑定主函数内联处理。
- Phase 3 已继续抽出 `agentStreamInactivityController`，统一首包超时、首包 deferred、silent recovery、inactivity timeout 的用户文案、告警文案与恢复动作决策。
- Phase 3 已继续抽出 `agentStreamRuntimeMetricsController`，统一 first runtime status 与 first text delta 的指标上下文和“一次性记录”判断，首字后段 metric 可独立测试。
- Phase 3 已继续抽出 `agentStreamRuntimeStatusController`，统一 runtime status 归一化、summary 文案、summary item 选择与更新计划，`runtime_status` apply 逻辑可独立测试。
- Phase 3 已继续抽出 `agentStreamTextDeltaController`，统一 text delta buffer 计数、首 delta 指标上下文与 overlap append 计划，重复吐字防线可独立测试。
- Phase 3 已继续抽出 `agentStreamTextRenderFlushController`，统一 pending text delta 解析、首个可见文本立即 flush、后续 32ms 节流、first text render flush / first text paint 指标与 backlog debug plan。
- Phase 3 已继续抽出 `agentStreamCompletionController`，统一空最终回复判定、协议残留清理后的 graceful completion 内容、empty-final-error 识别与最终 `contentParts` reconcile。
- Phase 3 已继续抽出 `agentStreamToolCompletionSignalController`，统一 tool result 是否可作为 meaningful completion signal 的站点保存、图片任务、通用任务与 artifact 预览判断。
- Phase 3 已继续抽出 `agentStreamErrorController`，统一 runtime error toast level / 文案与失败 assistant 消息 patch，error 分支不再内联 rate limit 判断和失败消息内容组装。
- Phase 3 已继续抽出 `agentStreamWarningController`，统一 runtime warning 的忽略、去重、标记与 toast plan，warning 分支只保留 warnedKeys 与 toast 副作用。
- Phase 3 已继续抽出 `agentStreamQueueController`，统一 queued draft 消息 patch 与 queue removed / cleared 后是否继续观察当前草稿的判断。
- Phase 3 已继续抽出 `agentStreamThreadItemController`，统一 thread item 高频更新延后判断与 turn_started 时 pending item 绑定真实 turn 的 patch。
- Phase 3 已继续抽出 `agentStreamToolEventController`，统一 `tool_end` 前置的 result normalize、tool name lookup 与 meaningful completion signal 计划。
- Phase 3 已继续抽出 `agentStreamArtifactActionController`，统一 `artifact_snapshot / action_required` 前置 activate、清 optimistic item 与 meaningful completion signal 计划。
- Phase 3 已继续抽出 `agentStreamRuntimeContextController`，统一 `context_trace / turn_context / model_change` 前置 activate / clear optimistic item 计划与 execution runtime apply wrapper。
- Phase 3 已继续抽出 `agentStreamThinkingDeltaController`，统一 `thinking_delta` 前置 activate / surface guard 与 thinking 消息 patch。
- Phase 3 已继续扩展 `agentStreamCompletionController`，统一完成态 assistant message patch，`final_done` 与 empty-final graceful completion 不再内联拼 `content / contentParts / usage / runtimeStatus`。
- Phase 3 已继续扩展 `agentStreamCompletionController`，统一 `final_done` 与 empty-final error 的 completion side-effect plan，handler 只执行日志、队列清理、observer 与 listener 副作用。
- Phase 3 已继续扩展 `agentStreamErrorController`，统一普通 runtime error 的失败 side-effect plan，error 分支不再内联 queued turn 清理、request log payload 与 toast plan。
- Phase 3 已继续扩展 `agentStreamErrorController`，统一 failed timeline turn / turn_summary 更新计划，handler 不再内联查找 running turn 或拼失败 summary 文案。
- Phase 3 已继续扩展 `agentStreamWarningController`，统一 warning toast action 与 dispatcher 执行，warning 分支不再内联 toast level switch。
- Phase 3 已继续扩展 `agentStreamErrorController`，统一普通 runtime error toast dispatcher 执行，error 分支不再内联 warning/error toast 分发。
- Phase 3 已继续扩展 `agentStreamCompletionController`，统一 missing final reply failure 的 queued turn、request log 与 toast plan，handler 不再内联空最终回复失败副作用参数。
- Phase 3 已继续扩展 `agentStreamQueueController`，统一 queued draft 状态副作用计划，handler 不再内联 queued draft 的 active stream / optimistic / sending 状态决策。
- Phase 3 已继续抽出 `agentStreamRequestLogController`，统一 request log finish 的去重、duration 与 update payload 决策，handler 只保留 `activityLogger.updateLog` 副作用。
- Phase 3 已继续抽出 `agentStreamTimerController`，统一 text render flush timer、queued draft cleanup timer 的调度/触发/清理决策，handler 只保留 `setTimeout/clearTimeout` 与 UI 副作用。
- Phase 3 已继续扩展 `agentStreamCompletionController` 与 `agentStreamErrorController`，统一 missing final failure 执行层副作用计划与 failed timeline state plan，handler 不再内联这两类失败路径的执行参数。
- 下一刀建议先收口 Phase 3 定向 E2E 指标采集；若 E2E 仍显示慢在事件处理后段，再检查 stream handler 剩余执行层 helper；若慢在 render，则进入 Phase 4 render projection。
