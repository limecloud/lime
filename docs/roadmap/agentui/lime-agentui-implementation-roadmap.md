# Lime AgentUI 实施路线图

> 状态：实施路线图
> 更新时间：2026-04-30
> 目标：把 AgentUI 架构落成可分批交付的工程任务，优先解决旧会话恢复慢、首字慢、tab 卡顿、流式重复吐字和过程信息噪声。

## 1. 阶段目标

| 阶段 | 目标 | 用户体感 |
| --- | --- | --- |
| P0 | 稳住当前对话主链和性能热点 | 旧会话能快速显示，首字前有可信反馈，流式不重复吐字 |
| P1 | 建立 task capsule 与 tab 管理 | 多会话、多后台任务不拖慢主页面 |
| P2 | 强化 artifact/workbench/evidence 分层 | 最终产物和证据离开正文，进入可编辑/可审计工作台 |
| P3 | 抽象 AgentUI 子系统 | `AgentChatWorkspace` 从巨石入口变成稳定 shell |

## 2. P0：体验止血

### 2.1 旧会话渐进恢复

目标：

- 点击历史会话后立即显示 shell、tab、标题和 skeleton。
- `getSession(historyLimit=40)` 返回后先 hydrate messages。
- timeline/tool/artifact detail 延迟到 idle 或用户展开。
- 禁止打开旧会话时触发无 limit detail。

代码入口：

- `src/components/agent/chat/hooks/useAgentSession.ts`
- `src/components/agent/chat/components/MessageList.tsx`
- `src/lib/api/agentRuntime/sessionClient.ts`
- `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`

验收：

- 旧会话 click -> shell paint 不依赖 getSession 完成。
- detail 请求带 `historyLimit`。
- MessageList 首屏不等待完整 timeline。
- Playwright E2E 能打开两个历史会话并来回切换。

### 2.2 首字慢分段日志

目标：

- 发送后立刻显示 submitted/routing/preparing。
- 记录 listener bound、submit invoke、first event、first status、first text delta、first paint。
- 后端记录 submit accepted、runtime start、provider request start、first provider event。

代码入口：

- `agentStreamSubmitExecution.ts`
- `agentStreamTurnEventBinding.ts`
- `agentStreamRuntimeHandler.ts`
- `runtime_turn.rs`
- `event_converter.rs`

验收：

- 首字慢时日志能判断慢在 invoke、queue、provider、event bridge、前端 flush 还是渲染。
- Playwright E2E 发送真实 prompt 后能采集首字链路。
- 首字前 UI 不再表现为鼠标 loading + 页面无反馈。

### 2.3 流式重复吐字防线

目标：

- `thinking_delta`、`text_delta`、`final_done` 严格分型。
- `final_done` 只 reconcile，不二次 append 完整正文。
- `<think>`、工具日志、过程 status 不进入最终 Markdown 正文。

代码入口：

- `agentStreamRuntimeHandler.ts`
- `StreamingRenderer.tsx`
- `processDisplayText.ts`
- `StreamingRenderer.test.tsx`
- `agentStreamRuntimeHandler.test.ts`

验收：

- 深度思考模型不会把 thinking 和 final answer 混合重复显示。
- 同一段最终答复不会出现“先流式一次，完成后又整段追加一次”。
- 历史恢复不会把已完成 thinking 当正文重放。

### 2.4 Streaming backlog catch-up

目标：

- 大量 delta 到达时自动进入 catch-up，避免逐字动画拖慢。
- 指标记录 queue depth、oldest unrendered age、flush count。
- MessageList / Markdown 轻量模式对历史和 backlog 区分处理。

代码入口：

- `StreamingRenderer.tsx`
- `agentStreamRuntimeHandler.ts`
- `MarkdownRenderer.tsx`
- `MessageList.tsx`

验收：

- 长回答中途不会出现 UI 越吐越慢。
- CPU 不因逐字动画长期满载。
- catch-up 触发和恢复可从日志看到。

## 3. P1：Tab 与 Task Capsule

### 3.1 浏览器式 tab 管理

目标：

- 新建对话是新增 tab，不跳出当前界面。
- 打开历史会话是新增或激活 tab，不导致已有 tab 全量重渲染。
- 非活跃 tab 只保留 snapshot。
- 关闭 tab 释放重型渲染对象。

代码入口：

- `AgentChatWorkspace.tsx`
- `useAgentSession.ts`
- `TaskCenterTabStrip.tsx`
- sidebar/topic 相关组件

验收：

- 连续打开多个历史会话不再 CPU/内存飙高。
- 可同时保留新建对话和多个旧会话。
- 切回旧 tab 先显示 snapshot，再后台刷新。

### 3.2 Task capsule strip

目标：

- running、queued、needs_input、plan_ready、failed、team/subagent 统一为胶囊。
- 普通 running 低调展示；needs_input/plan_ready/failed 抢注意力。
- 点击胶囊打开 task center 或 process drawer，不跳离上下文。

代码入口：

- `TaskCenterTabStrip.tsx`
- `QueuedTurnsPanel.tsx`
- `InputbarRuntimeStatusLine.tsx`
- `AgentRuntimeStrip.tsx`
- `thread_read` projection

验收：

- 当前 turn 状态不再只靠按钮 spinner。
- pending action 可从胶囊快速定位。
- queue 和 steer 的视觉、文案和行为区分清楚。

### 3.3 Sidebar list 降优先级

目标：

- 点击历史会话时 session detail 优先。
- recent list / archived list 刷新低优先级、可取消、可 debounce。
- list summary 不携带重型 detail。

代码入口：

- sidebar refresh 逻辑
- `sessionClient.ts`
- `session_runtime.rs`

验收：

- 打开历史会话时不因 sidebar list 刷新阻塞 detail。
- invoke 通道没有 list 与 getSession 串行抢占。

## 4. P2：Artifact / Evidence 分层

### 4.1 Artifact 从正文迁移到 Workbench

目标：

- `artifact_snapshot` 在正文只显示摘要卡。
- Workbench 自动选择最新关键 artifact 或显示建议。
- 大 artifact 按 preview 加载，不塞入 message。

代码入口：

- `StreamingRenderer.tsx`
- `AgentThreadTimelineArtifactCard.tsx`
- `useWorkspaceArtifactPreviewActions.ts`
- artifact services

验收：

- 长文档/代码/报告不会让消息列表卡顿。
- artifact 能从 timeline、message card、workbench 三处指向同一 id/path。

### 4.2 Evidence / Review 后台化

目标：

- evidence export 显示为后台任务。
- 完成后进入 harness panel，不阻塞当前聊天。
- review decision 和 replay 与 evidence pack 同源。

代码入口：

- `HarnessStatusPanel.tsx`
- `runtime_evidence_pack_service.rs`
- `runtime_review_decision_service.rs`
- `runtime_replay_case_service.rs`

验收：

- 导出期间仍可继续查看/发送消息。
- evidence/review 路径和状态来自后端返回，不由前端猜。

## 5. P3：结构收敛

### 5.1 拆分 AgentChatWorkspace

目标结构：

```text
AgentChatWorkspace
  AgentWorkspaceShell
  SessionChrome
  ConversationPane
  WorkbenchPane
  ProcessDrawer
  TaskCapsuleStrip
```

拆分原则：

- 每次只拆一个职责边界。
- 不改变用户行为时先补 snapshot/interaction 测试。
- 不把视觉重构和协议重构混在一刀。

### 5.2 拆分 useAgentSession

建议目标：

```text
useAgentSession
  useTopicTabs
  useSessionHistoryWindow
  useRuntimeStream
  useRuntimeProjection
  useQueuedTurns
  usePendingActions
```

收益：

- 性能日志能按子系统归因。
- 单元测试更容易覆盖 stream / history / queue。
- 后续 worker 化 timeline 不需要改整个 hook。

### 5.3 Worker / Virtualization

目标：

- timeline 构建可移到 worker 或 idle task。
- 历史 MessageList 可虚拟化。
- 大 tool/artifact 详情按需加载。

触发条件：

- 旧会话 messages > 200。
- threadItems > 500。
- 单条 assistant content > 24k。
- tool output preview > 64k。

## 6. 验证矩阵

| 改动类型 | 最低验证 |
| --- | --- |
| 文档变更 | markdown 格式检查、`git status --short` |
| 前端 UI/Hook | 受影响 `*.test.tsx` / `*.test.ts`，默认 `npm run verify:local` |
| 流式事件逻辑 | `agentStreamRuntimeHandler.test.ts`、`agentStreamTurnEventBinding.test.ts` |
| Tauri command / bridge | `npm run verify:local` + `npm run test:contracts` |
| GUI 主路径 | `npm run verify:local` + `npm run verify:gui-smoke` |
| 真实交互 | Playwright E2E：新建对话、打开两个历史会话、发送消息、queue/steer、pending action |

## 7. E2E 场景清单

优先补这些 Playwright 场景：

1. 新建对话：点击新任务后新增 tab，输入区立即可用。
2. 打开旧会话：历史消息快速显示，输入区吸顶/吸底行为符合目标设计。
3. 多历史会话：连续打开两个旧会话，二者都能切换，不卡死。
4. 发送消息：首字前出现 runtime status，首字后流式稳定。
5. 深度思考模型：thinking 折叠，不重复吐字，不污染 final answer。
6. Queue：当前 turn 运行中发送下一条，进入 queue capsule。
7. Steer：当前 turn 运行中修正当前任务，显示 pending steer。
8. Artifact：生成 artifact 后正文显示卡片，workbench 可打开。
9. Evidence：导出 evidence 后 harness panel 能打开文件。

## 8. 完成定义

AgentUI 下一阶段不能用“组件做出来了”作为完成标准。完成标准应同时满足：

1. 当前用户主路径更快：旧会话恢复、首字、tab 切换有日志和 E2E 证明。
2. UI 分层更清楚：正文、过程、任务、产物、证据不混在一个 Markdown 流里。
3. 后端事实源更稳定：summary、detail、timeline、artifact、evidence 各自有清晰接口。
4. 代码边界更小：新增能力不继续扩大 `AgentChatWorkspace` 和 `useAgentSession` 的职责。
5. 验证可重复：单元测试、GUI smoke、Playwright 覆盖核心流程。
