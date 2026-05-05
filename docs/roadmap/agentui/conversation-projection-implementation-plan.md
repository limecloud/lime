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
- 下一刀建议继续 Phase 2：抽 `sessionSwitchErrorController` 或 `sessionHistoryPaginationController`，把错误恢复与完整历史分页状态继续从 `useAgentSession` 主体中移出；只有 E2E 指标显示 `messageListTimelineBuildMs` 仍高时才进入 worker 化。
