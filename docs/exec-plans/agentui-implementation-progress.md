# AgentUI 实施进度

> 状态：进行中
> 更新时间：2026-05-05
> 路线图：`docs/roadmap/agentui/lime-agentui-implementation-roadmap.md`

## 主目标

逐步实现 Lime AgentUI 下一阶段主线，优先解决旧会话恢复慢、首字慢、tab 卡顿、流式重复吐字和过程信息噪声。

## 当前阶段

P1：Tab 与 Task Capsule 已完成多轮性能止血；结构主线进入 P3 的前置闭环，先做对话事实源盘点与最小 Projection Store，不再继续把状态堆进 `AgentChatWorkspace` / `useAgentSession` / `MessageList`。

当前结构收敛口径：

```text
Warp runtime fact sources
  -> Conversation Projection Store
  -> Session / Stream / Queue / Render controllers
  -> selectors
  -> UI
```

`Conversation Projection Store` 是 UI projection，不是 runtime fact source；Warp 仍是 `ModalityRuntimeContract`、`Execution Profile`、`Artifact Graph`、`Evidence / Replay / Task Index` 的事实源。

## 本轮执行准则更新：旧 UI 顺路清理

主线仍以旧会话性能数值分析和首字/流式体验优化为优先级；遇到现有 UI 老旧、不适合继续承载 AgentUI 主链时，可以顺路清理，但清理必须直接服务当前交付，不能偏航成纯治理或视觉翻新。

### 准入条件

仅当旧 UI 满足以下任一条件时，本轮允许顺路清理：

- 直接造成旧会话打开、切换、新建对话或流式输出卡顿，例如重复渲染非活跃会话、旧面板抢占 hydrate、旧入口触发额外查询。
- 直接造成用户路径错误，例如新建对话被旧界面跳走、无法同时打开多个历史对话、输入区/对话区位置与 AgentUI 规划冲突。
- 直接造成重复事实源，例如同一状态同时由旧 tab、旧任务面板和新 capsule 独立维护，导致状态不同步或额外 render。
- 直接违反当前 Lime UI 规范并影响可用性，例如半透明主表面、多层套卡、重复标题、伪交互、中文排版被压缩。

### 分类与动作

- `current`：继续沿 AgentUI 当前主链演进；性能采样、消息窗口、tab/capsule、新建对话入口都应向这里收敛。
- `compat`：只允许委托和适配，不新增状态、查询、渲染分支；如果旧 UI 仍被调用，必须写清退出条件。
- `deprecated`：只允许迁移和下线；遇到影响主线的旧 UI，优先从主入口摘除，再登记后续删除。
- `dead`：确认无入口或与 current 规划冲突时直接删除或补治理守卫，防止后续重新接回主链。

### 清理边界

- 每一刀最多顺路清理一个直接阻塞主线的旧 UI surface，其余旧面先登记，不连续深挖。
- 不新增平行的新旧两套组件；能收敛到现有 AgentUI current 组件时，不再补新的 compat 包装层。
- 清理后仍需保持桌面 GUI 气质：实体主表面、清晰边界、中文优先、按钮层级明确，避免半透明主体和过度嵌套套卡。
- 如果清理会触及 Tauri command、Bridge、mock 或 session 数据事实源，必须另起命令边界检查，不把 UI 清理伪装成纯样式改动。

### 验收口径

- 性能侧：用 `window.__LIME_AGENTUI_PERF__.summary()` 对比清理前后，至少看 `clickToMessageListPaintMs`、`runtimeGetSessionDurationMs`、`finalRenderedMessagesCount`、`hiddenHistoryCount`。
- 交互侧：覆盖新建对话、打开旧会话 A、打开旧会话 B、旧会话间切换、发送短句看首字和流式输出。
- UI 侧：补稳定回归或 snapshot，必要时复用现有 Lime 页签做 Playwright E2E；不使用会新开 isolated profile 或 `--no-sandbox` 临时浏览器的验证方式。
- 治理侧：如果删除或下线旧入口，补 `current / compat / deprecated / dead` 分类说明；必要时运行 `npm run governance:legacy-report` 或 `npm run test:contracts`。

## 进度日志

### 2026-04-30：P0 第一刀，流式主链观测与渲染降频

已完成：

- 在 stream request state 中补齐首字慢分段字段：
  - listener bound
  - submit dispatched / accepted / failed
  - first event
  - first runtime status
  - first text delta
  - first text paint
  - text render flush / backlog
- 在 `agentStreamTurnEventBinding.ts` 记录 listener bound 和 first event。
- 在 `agentStreamSubmitExecution.ts` 记录 submit dispatched / accepted / failed。
- 在 `agentStreamRuntimeHandler.ts` 记录 first runtime status、first text delta、first text paint、text render flush。
- 保留并补齐已有 text_delta 低频刷新策略，避免每个字符都刷新消息树。
- 保留并补齐已有 thinking 关闭策略，`thinking_delta` 不再污染最终正文。
- 保留并补齐已有 `final_done` reconcile 防线，避免最终文本整段重复追加。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/components/StreamingRenderer.test.tsx"
npm run typecheck
npm run verify:gui-smoke
```

结果：

- 流式定向测试：通过，`17` 个测试通过。
- AgentUI P0 定向测试：通过，`131` 个测试通过。
- TypeScript：通过。
- GUI smoke：通过。

下一步：

1. 跑 touched files 的 lint/type 校验。
2. 继续 P0 旧会话渐进恢复：确认 active tab 与非 active tab 的 hydrate 边界，减少旧会话打开时 MessageList/timeline 同步负担。
3. 再进入 P1 tab/capsule：避免多历史会话同时全量渲染。

### 2026-04-30：P0 第二刀复核，旧会话渐进恢复现状

已确认当前工作区已有以下旧会话恢复优化：

- `useAgentSession.ts`：
  - `getSession` 恢复路径统一带 `historyLimit: 40`。
  - recent session prefetch 使用 `SESSION_DETAIL_PREFETCH_HISTORY_LIMIT = 40`。
  - cached snapshot fresh 时延迟 detail hydrate。
  - detail hydrate 进入 `startTransition`，降低切换时主线程抢占。
  - “加载更多历史”改为分页：`SESSION_HISTORY_LOAD_PAGE_SIZE = 50`，使用 `historyOffset` / `historyBeforeMessageId`。
- `MessageList.tsx`：
  - 旧会话只先渲染最近消息窗口。
  - 旧会话隐藏历史不自动逐批补齐，必须用户点击展开。
  - 历史 timeline 延迟到 idle，完成历史 timeline 可先折叠为轻量摘要。
  - 超长历史助手消息和较长历史助手消息先展示纯文本预览。
  - 历史 Markdown 使用 light render mode，避免首帧挂载重 Markdown。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/components/StreamingRenderer.test.tsx"
npm run typecheck
npm run verify:gui-smoke
```

结果：通过，`MessageList` / `StreamingRenderer` 定向测试共 `114` 个通过，TypeScript 检查通过，GUI smoke 通过。

下一步：

1. 进入 P1 tab/capsule 前，先用 Playwright 复测真实多历史会话打开路径，采集 `runtimeGetSession.*`、`switchTopic.*`、`AgentStream.*` 日志。
2. 若 E2E 仍出现切换卡顿，下一刀优先做非活跃 tab snapshot/freeze，而不是继续压 MessageList 单点。

### 2026-04-30：P1 第一刀，旧会话切换期间延迟运行轨迹投影

已完成：

- 在 `useWorkspaceConversationSceneRuntime.tsx` 增加 session runtime projection defer：
  - 旧会话恢复首帧继续立即透传 `messages`，保证正文和输入区先可交互。
  - `turns`、`threadItems`、`threadRead`、`pendingActions`、`queuedTurns`、`childSubagentSessions` 延迟到 idle 后再挂载，减少点击历史会话时的同步投影和 timeline 构建压力。
  - 延迟状态按 `sessionId + 首尾 message + 尾部 turn/item` 绑定，避免从一个历史会话切到另一个同长度历史会话时复用上一会话的“已投影”状态。
  - 正在发送、聚焦 timeline、存在 pending A2UI 表单时不延迟，避免影响运行中反馈和用户待处理动作。
- 在 `useWorkspaceConversationSceneRuntime.test.ts` 补回归：
  - 恢复旧会话首帧应先透传消息，并延迟运行轨迹投影。
  - 切换到另一条同长度旧会话时应重新延迟运行轨迹投影。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.test.ts" "src/components/agent/chat/workspace/WorkspaceConversationScene.test.tsx" "src/components/agent/chat/components/MessageList.test.tsx"
npm run typecheck
```

结果：

- Workspace / MessageList 定向回归：通过，`96` 个测试通过。
- TypeScript：通过。

未完成验证：

- `npm run verify:gui-smoke` 本轮未完成。原因是本地 `DevBridge` 3030 未就绪，smoke 复用/拉起 headless 链路时触发新的 Rust 编译链，持续数分钟占用 CPU；继续等待会污染“旧会话打开是否卡顿”的真实判断。已清理本轮 `verify-gui-smoke` 派生的临时编译链，未清理用户已有的长期 `tauri:dev:headless` / 其他 Rust 校验进程。
- 真实 Chrome 页签 E2E 续测暂未完成。当前前端 `http://127.0.0.1:1420/` 可访问，但 `http://127.0.0.1:3030/health` 未监听；需先恢复 DevBridge 后再复测多历史会话切换。

下一步：

1. 恢复 DevBridge 3030 后，用现有 Chrome 页签复测：新建对话、打开两个历史会话、来回切换、观察控制台 error 和 `switchTopic.*` 日志。
2. 若旧会话仍有体感卡顿，继续 P1：把 tab/shell 层的 running/queued/needs_input 胶囊化，并进一步降低非当前过程面板的更新频率。

### 2026-04-30：P1 第二刀，覆盖 history window hydrate 后的重投影卡顿

已完成：

- 扩展 `useWorkspaceConversationSceneRuntime.tsx` 的旧会话运行轨迹延迟投影触发条件：
  - 不再只依赖 `isAutoRestoringSession`。
  - 当 `sessionHistoryWindow.totalMessages > sessionHistoryWindow.loadedMessages` 时，也按旧会话窗口处理，覆盖 cached snapshot 已显示、detail hydrate 后恢复大量 `turns/threadItems` 的场景。
  - 同一个 session 尾部追加新消息时不重新延迟投影，避免首字和流式输出被 700ms 延迟误伤。
  - 继续保持发送中、timeline 聚焦、存在 pending A2UI 表单时不延迟，保护实时反馈和用户待处理动作。
  - 延迟投影状态写入改为“值未变化则返回当前 state”，避免 ready/pending 状态重复写入造成额外 render。
- 补齐 `useWorkspaceConversationSceneRuntime.test.ts` 回归：
  - `isAutoRestoringSession=false` 但存在截断历史窗口时，首帧仍先显示消息、延迟运行轨迹。
  - 发送中会话不延迟运行轨迹。
  - 聚焦 timeline 或存在 A2UI 表单时不延迟运行轨迹。
- 顺手补齐语音快捷键相关测试 fixture 的 `fn_*` 字段，修复当前工作区 `typecheck` 阻塞；该修复只闭合测试 mock 类型，不扩展语音功能面。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.test.ts"
npm exec -- vitest run "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.test.ts" "src/components/agent/chat/workspace/WorkspaceConversationScene.test.tsx" "src/components/agent/chat/components/MessageList.test.tsx"
npm exec -- vitest run "src/components/onboarding/steps/VoiceShortcutTestStep.test.tsx" "src/components/settings-v2/general/hotkeys/hotkeyCatalog.test.ts"
npm run typecheck
curl -fsS "http://127.0.0.1:3030/health"
```

结果：

- Workspace 单测：通过，`13` 个测试通过。
- Workspace / MessageList 组合回归：通过，`99` 个测试通过。
- 语音 fixture 定向回归：通过，`4` 个测试通过。
- TypeScript：通过。
- DevBridge 健康检查：失败，`127.0.0.1:3030` 未监听；当前只确认 `127.0.0.1:1420` 前端 dev server 在监听。第二轮 render 收紧后复查结果一致。

未完成验证：

- 真实 Chrome 页签 E2E 暂未执行。原因是 DevBridge 3030 未就绪，强行启动 `verify:gui-smoke` 会触发新的 Rust 编译链并污染旧会话卡顿判断。

下一步：

1. 恢复 DevBridge 3030 后，复用现有 Chrome/Lime 页签做多历史会话切换 E2E。
2. 若体感卡顿仍明显，下一刀进入 tab/shell 层：冻结非活跃 tab 的重运行时投影，只保留标题、状态、未读和最后预览。

### 2026-04-30：P1 第三刀，收紧 tab/shell 同步小开销与验证阻塞

已完成：

- `AgentChatWorkspace.tsx` 为 `topics` 建立单次 `topicById` Map：
  - 初始会话切换策略、任务中心打开旧会话、detached 判断和顶部 tab item 生成复用 Map 查询。
  - 减少旧会话切换路径里多处 `topics.find/some` 扫描；当前非活跃 tab 本身只渲染标题/状态/未读，不渲染正文或 timeline。
- `useWorkspaceConversationSceneRuntime.tsx` 收紧延迟投影状态更新：
  - 空投影数组改为模块级稳定常量，避免下游 `useMemo` 因每次新建 `[]` 失效。
  - 延迟投影 ready/pending 写入保持“值未变则返回当前 state”，避免无意义二次 render。
- 修复当前工作区两个验证阻塞：
  - 语音快捷键测试 fixture 补齐 `fn_*` 字段。
  - 媒体任务测试 fixture 与浏览器 mock 输出补齐 transcript 汇总字段，保持 `MediaTaskModalityRuntimeContractIndex` 契约一致。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/index.test.tsx" -t "任务中心初始会话标签"
npm exec -- vitest run "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.test.ts" "src/components/agent/chat/workspace/WorkspaceConversationScene.test.tsx" "src/components/agent/chat/components/MessageList.test.tsx"
npm exec -- vitest run "src/components/agent/chat/workspace/useWorkspaceAudioTaskPreviewRuntime.test.tsx" "src/components/agent/chat/workspace/useWorkspaceImageTaskPreviewRuntime.test.tsx" "src/lib/tauri-mock/core.test.ts"
npx eslint "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.tsx" "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.test.ts" "src/components/agent/chat/workspace/useWorkspaceAudioTaskPreviewRuntime.test.tsx" "src/components/agent/chat/workspace/useWorkspaceImageTaskPreviewRuntime.test.tsx" "src/lib/tauri-mock/core.ts" "src/components/onboarding/steps/VoiceShortcutTestStep.test.tsx" "src/components/settings-v2/general/hotkeys/hotkeyCatalog.test.ts" --max-warnings 0
npm run typecheck
npm run test:contracts
curl -fsS "http://127.0.0.1:3030/health"
```

结果：

- 任务中心定向回归：通过，`11` 个测试通过。
- Workspace / MessageList 组合回归：通过，`99` 个测试通过。
- 媒体任务 / mock 回归：通过，`54` 个测试通过。
- ESLint touched files：通过。
- TypeScript：通过。
- Contract：通过。
- DevBridge 健康检查：失败，`127.0.0.1:3030` 未监听；`127.0.0.1:1420` 前端 dev server 仍在监听。

未完成验证：

- 真实 Chrome 页签 E2E 仍未执行。原因同上一刀：DevBridge 3030 未就绪，当前不应启动新的 Playwright profile 或强行触发重编译链。

下一步：

1. 待 DevBridge 恢复后，复用现有 Chrome/Lime 页签采样：打开旧会话、打开第二个旧会话、来回切换、发送 DeepSeek 短句，看首字前占位、真实 first text delta 和 long task。
2. 若旧会话仍慢，下一刀不再继续做 tab 微调，优先做 MessageList 动态高度虚拟化或 `agent_runtime_get_session` 分块返回方案评估。

### 2026-04-30：P1 第四刀，旧会话首帧推迟 Prompt Cache 配置扫描

已完成：

- `MessageList.tsx` 推迟旧会话恢复首帧的 Provider 配置自动加载：
  - 旧会话恢复或历史窗口 hydrate 阶段，`useConfiguredProviders` 先以 `autoLoad: false` 运行。
  - 首帧消息可见后再在 idle 阶段允许 Provider 配置加载，避免 Prompt Cache 提示为了历史消息扫描抢占旧会话打开主链。
  - 保留实时发送、当前会话和普通新会话的 Provider 能力提示，不影响新 token 到达后的说明能力。
- `MessageList.tsx` 同步收紧最新助手消息定位：
  - `lastAssistantMessageId` 与当前 timeline 映射不再复制数组反向查找。
  - 减少旧会话窗口里消息列表重算时的短期内存峰值。
- `MessageList.test.tsx` 补回归：
  - 旧会话恢复首帧应关闭 Provider 配置自动加载。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" --max-warnings 0
npm exec -- vitest run "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.test.ts" "src/components/agent/chat/workspace/WorkspaceConversationScene.test.tsx" "src/components/agent/chat/components/MessageList.test.tsx"
npm run typecheck
npm run test:contracts
curl -fsS "http://127.0.0.1:3030/health"
```

结果：

- MessageList 定向回归：通过，`85` 个测试通过。
- MessageList ESLint：通过。
- Workspace / MessageList 组合回归：通过，`100` 个测试通过。
- TypeScript：通过。
- Contract：通过。
- DevBridge 健康检查：通过，返回 `status=ok`。

未完成验证：

- 真实 Chrome 页签 E2E 仍需复用现有 Lime 页签继续；当前 Chrome DevTools MCP 被已有 `chrome-profile` 占用，不能按工具提示启动 isolated 新实例，也不应启用 `--no-sandbox` 的临时 Playwright profile。

下一步：

1. 复用现有 Lime 页签或恢复 Chrome DevTools MCP 会话后，执行旧会话 A / 旧会话 B / 新建对话切换采样。
2. 如果旧会话仍有明显鼠标 loading、CPU 或内存峰值，优先评估 MessageList 动态高度虚拟化，避免继续在 tab shell 做边际优化。

### 2026-04-30：P1 第五刀，点击旧会话不再即时预取抢占切换链路

已完成：

- `AppSidebarConversationShelf.tsx` 取消点击路径上的即时预取：
  - 移除 `onPointerDown` 的立即 prefetch。
  - `onFocus` 改为延迟预取，并在 `onClick` / `onBlur` / `onPointerLeave` 时取消尚未触发的预取。
  - 保留真正悬停或键盘聚焦停留时的旧会话预热，但避免“鼠标按下 -> 预取 hydrate -> 正式切换复用同一 promise”造成点击后主链多做一次旧会话 hydrate。
- `MessageList.tsx` 继续减少热路径小分配：
  - `renderGroups` 从 `assistantMessages.map(...).find(...)` 改为单次循环，避免每个消息组创建临时数组。

主线收益：

- 用户点击旧会话时，正式切换链路直接进入 `switchTopic.fetchDetail`，不再先被侧栏 prefetch 的 snapshot hydrate 抢占。
- 只有用户悬停停留足够久时才做预热，符合“后台预取不能拖慢明确点击”的优先级。

已验证：

```bash
npm exec -- vitest run "src/components/AppSidebar.test.tsx" -t "旧会话预取|已有会话"
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "旧会话恢复首帧|复杂任务完成后"
npx eslint "src/components/app-sidebar/AppSidebarConversationShelf.tsx" "src/components/AppSidebar.test.tsx" "src/components/agent/chat/components/MessageList.tsx" --max-warnings 0
npm run typecheck
git diff --check -- "docs/exec-plans/agentui-implementation-progress.md" "src/components/app-sidebar/AppSidebarConversationShelf.tsx" "src/components/AppSidebar.test.tsx" "src/components/agent/chat/components/MessageList.tsx"
npm exec -- vitest run "src/components/AppSidebar.test.tsx"
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx"
```

结果：

- AppSidebar 定向回归：通过，`4` 个测试通过。
- MessageList 定向回归：通过，`2` 个测试通过。
- ESLint touched files：通过。
- TypeScript：通过。
- diff whitespace：通过。
- AppSidebar 全量回归：通过，`38` 个测试通过。
- MessageList 全量回归：通过，`85` 个测试通过。

未完成验证：

- `npm run verify:gui-smoke` 本轮执行到 `smoke:agent-runtime-tool-surface-page` 时失败：`launch_browser_session` 对 DevBridge 的请求连续返回 `fetch failed`，随后 `3030` DevBridge 端口不可用。当前 `tauri dev` 正在重新编译 Rust 侧，暂不能继续真实 E2E。
- Chrome DevTools MCP 仍被既有 `chrome-profile` 占用；不能按工具提示启动 isolated 新实例，也不应使用带 `--no-sandbox` 的临时 Playwright profile。

下一步：

1. 等 DevBridge 3030 恢复后，先只做真实页签 E2E，不再重复触发会重启/重编 Rust 的 GUI smoke。
2. E2E 重点采样：点击旧会话是否还出现鼠标 loading、打开第二个旧会话是否并发卡住、新建对话 tab 是否立即可打开。
3. 若仍慢，下一刀进入真正的 MessageList 虚拟化或后端 `getSession` 分块返回，不继续做 prefetch / tab shell 边际优化。

### 2026-04-30：P1 第六刀，补 AgentUI 性能数值采集

已完成：

- 新增 `src/lib/agentUiPerformanceMetrics.ts`：
  - 浏览器内维护 `AgentUI` 性能 ring buffer，最多保留 `500` 条。
  - 自动暴露 `window.__LIME_AGENTUI_PERF__`，E2E 可直接读取：
    - `window.__LIME_AGENTUI_PERF__.entries()`
    - `window.__LIME_AGENTUI_PERF__.summary()`
    - `window.__LIME_AGENTUI_PERF__.clear()`
  - `summary()` 按 `sessionId` 汇总旧会话打开关键耗时：
    - `clickToSwitchStartMs`
    - `clickToCachedSnapshotMs`
    - `clickToPendingShellMs`
    - `clickToFetchStartMs`
    - `fetchDetailDurationMs`
    - `runtimeGetSessionDurationMs`
    - `clickToSwitchSuccessMs`
    - `clickToMessageListPaintMs`
    - `finalRenderedMessagesCount / hiddenHistoryCount / persistedHiddenHistoryCount`
    - 可用时同步采集 `usedJSHeapSize / totalJSHeapSize`
- 采样点已接入：
  - `AppSidebarConversationShelf.tsx`：旧会话 hover/focus 预取 schedule / cancel / fire、点击旧会话。
  - `sessionClient.ts`：`agentRuntime.listSessions`、`agentRuntime.getSession` start / success / error 及 duration。
  - `useAgentSession.ts`：session prefetch、switch start、cached snapshot、pending shell、fetch detail、switch success。
  - `MessageList.tsx`：旧会话恢复 / 分页历史窗口 commit 与 post-paint 消息数、turn 数、timeline defer 状态。
- E2E 读取建议：

```ts
await page.evaluate(() => window.__LIME_AGENTUI_PERF__?.clear());
// 执行：点击旧会话 A -> 点击旧会话 B -> 新建对话 -> 切回旧会话
const snapshot = await page.evaluate(() => window.__LIME_AGENTUI_PERF__?.summary());
console.table(snapshot?.sessions ?? []);
```

已验证：

```bash
npm exec -- vitest run "src/lib/agentUiPerformanceMetrics.test.ts" "src/components/agent/chat/components/MessageList.test.tsx" -t "agentUiPerformanceMetrics|旧会话首帧应记录|旧会话恢复首帧"
npm exec -- vitest run "src/components/AppSidebar.test.tsx" -t "旧会话预取|已有会话"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "thread timeline|hydrate|switchTopic"
npm exec -- vitest run "src/lib/api/agent.test.ts" -t "getSession|listSessions|runtime"
npx eslint "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" "src/lib/api/agentRuntime/sessionClient.ts" "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/app-sidebar/AppSidebarConversationShelf.tsx" "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" --max-warnings 0
npm run typecheck
```

结果：

- 性能采集器 / MessageList 定向回归：通过，`4` 个测试通过。
- AppSidebar 旧会话点击 / 预取回归：通过，`4` 个测试通过。
- useAsterAgentChat 定向回归：通过，`9` 个测试通过。
- Agent Runtime API 定向回归：通过，`15` 个测试通过。
- ESLint touched files：通过。
- TypeScript：通过。

下一步：

1. 复用现有 Lime 页签时先执行 `window.__LIME_AGENTUI_PERF__.clear()`。
2. 完成多旧会话切换后导出 `summary().sessions`，用 `clickToMessageListPaintMs`、`runtimeGetSessionDurationMs`、`finalRenderedMessagesCount` 判断瓶颈是在桥接、后端查询还是前端渲染。
3. 如果 `runtimeGetSessionDurationMs` 低但 `clickToMessageListPaintMs` 高，下一刀优先 MessageList 虚拟化；如果两者都高，优先后端 `getSession` 分块/缓存。

## 风险记录

- 当前工作区已有多处未提交改动，本计划只记录本轮 AgentUI 主线增量；合并前需继续保护用户已有改动，不做回滚。
- 本轮没有新增 Tauri command，不需要同步 command catalog / mock；后续若新增 session snapshot 或 timeline page command，必须按命令边界四侧同步。

### 2026-04-30：P1 第七刀，旧会话列表分页降载与路由追平去重

采集事实：

- 首轮 Playwright 性能探针显示，点击新建 / 旧会话附近仍有侧边栏 `agent_runtime_list_sessions(limit=37)` 在 DevBridge 通道内运行：浏览器侧记录约 `10.2s`，同时 `workspace_get` 出现 `timeout after 5000ms`，导致旧会话列表和新建任务入口体感卡顿。
- 后端日志对比显示，降载前异常环境下 `limit=37` / `limit=60` 最高可到数秒级；降载后同一工作区常规请求收敛到 `limit=11` / `limit=21`，最近采样约 `47-218ms`。
- 二次 Playwright 探针发现“侧栏打开旧会话 -> 路由追平”会让同一历史会话出现 `switchStartCount=2` / `runtimeGetSessionStartCount=2`，即同一次用户意图触发两次 `getSession`。

已完成：

- `AppSidebar.tsx`：最近 / 归档会话列表改成可见数量 `+1` 的哨兵分页：
  - 最近会话首屏请求从强制 `37` 降到 `11`。
  - 归档首屏请求从 `17` 降到 `9`。
  - 点击“查看更多”时再按当前可见数量继续增加请求窗口，避免首页一次性预取两页以上历史。
- `useAgentSession.ts`：任务中心内部 topics 初始列表请求从 `60` 降到 `21`，保留 `topicsListMayBeTruncatedRef` 作为旧会话不在首屏列表时的 detached 恢复兜底。
- `AppSidebarConversationShelf.tsx`：hover/focus 预取延迟从 `140ms` 提高到 `900ms`，点击路径仍会取消未触发预取，减少鼠标扫过列表时的隐性 `getSession`。
- `useWorkspaceInitialSessionNavigation.ts` / `AgentChatWorkspace.tsx`：新增“外部任务打开已启动”去重标记；侧栏/任务中心事件已经触发 `switchTopic` 后，2s 内路由 `initialSessionId` 追平不再重复打开同一会话。
- `.tmp/agentui-perf-probe.mjs` 临时探针增强：只从侧栏会话 shelf 取目标、记录 invoke command、采集 CDP CPU/heap delta、long task 与 detail 阶段 summary。

Playwright 复测摘要：

- 页面：`http://127.0.0.1:1420/`，Chrome 持久化 profile `.tmp/lime-agentui-e2e-chrome-profile`，DevBridge `3030` 健康检查通过。
- 旧会话 A `AI网关MVP规划`：`switchStartCount=1`，`runtimeGetSessionStartCount=1`，`runtimeGetSessionDurationMs≈82ms`，`clickToSwitchSuccessMs≈685ms`，`clickToMessageListPaintMs≈626ms`，`longTask=0`。
- 旧会话 B `PPT大纲规划`：去重后目标会话 `switchStartCount=1`，`runtimeGetSessionStartCount=1`；`agent_runtime_get_session` 最慢约 `157ms`。
- 切回旧会话 A：目标会话 `switchStartCount=1`，`runtimeGetSessionStartCount=1`，`clickToMessageListPaintMs≈18ms`，`longTask=0`。
- 控制台：`0 error / 1 warning`；warning 为 `useAgentTopicSnapshot.skipWithoutActiveTopic`，不阻塞主链，但提示后续 topics 截断后仍可继续优化 topic snapshot 噪音。
- 网络：最慢 `/invoke` 从上一轮 `agent_runtime_get_session≈6.1s` / `agent_runtime_list_sessions≈10.2s`，恢复到本轮 `agent_runtime_get_session≤157ms`、`agent_runtime_list_sessions≤218ms`；上一轮 6s 主要由探针未等待 detail、连续发起多个旧会话请求叠加当时 Rust 编译负载污染，已用直接 curl 与等待 detail 的探针复核。

已验证：

```bash
npx eslint "src/components/AppSidebar.tsx" "src/components/AppSidebar.test.tsx" "src/components/app-sidebar/AppSidebarConversationShelf.tsx" "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" --max-warnings 0
npm exec -- vitest run "src/components/AppSidebar.test.tsx" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "最近对话|窗口重新聚焦|打开已有会话|归档动作|加载话题时应后台预热"
npx eslint "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/workspace/useWorkspaceInitialSessionNavigation.ts" "src/components/agent/chat/index.test.tsx" --max-warnings 0
npm exec -- vitest run "src/components/agent/chat/index.test.tsx" "src/components/agent/chat/workspace/useWorkspaceInitialSessionNavigation.test.tsx" -t "外层侧边栏通知打开历史会话|初始会话|dedupe|连续打开历史会话|任务中心初始会话标签"
npm run typecheck
node ".tmp/agentui-perf-probe.mjs" > ".tmp/agentui-perf-probe-latest.json"
```

结果：

- AppSidebar / useAsterAgentChat 定向回归：通过，`8` 个测试通过。
- AgentChatWorkspace / initial session navigation 定向回归：通过，`16` 个测试通过。
- ESLint touched files：通过。
- TypeScript：通过。
- Playwright 性能探针：完成，旧会话切换不再出现同一目标重复 `switchTopic` / 重复 `getSession`；列表请求窗口已降到 `11/21`。

下一步：

1. 修复或降噪 `useAgentTopicSnapshot.skipWithoutActiveTopic`：在 topics 初始窗口被截断时，active session 已由 detail 恢复，不应持续警告。
2. 新建任务探针当前用性能事件等待会超时，应改成 DOM 空态断言（`home-start-surface` / `青柠一下，灵感即来`）后再纳入数值汇总，避免把探针等待超时误判为产品卡顿。
3. 如果用户继续反馈“打开后消息正文仍慢”，下一刀不要再扩 AppSidebar；优先进入 `agent_runtime_get_session` 首包/分块返回或 MessageList 真虚拟化。

### 2026-04-30：P1 第八刀，新建页旧会话本地打开与探针降噪

采集事实：

- 上一轮 Playwright 探针只剩 `0 error / 1 warning`，warning 来自旧会话 pending shell 阶段：`sessionId` 已切到目标会话，但 topics 还没等 `getSession` detail upsert，`useAgentTopicSnapshot` 误判为 active topic 缺失。
- 新建任务按钮探针此前仍等待 `session.switch.*` / `messageList.paint` 性能事件；新建首页本身不会触发旧会话切换事件，导致 14s 超时被误算成产品卡顿。
- 从新建页点击旧会话时，侧栏原先只在 `agentEntry=claw` 时走任务中心本地事件；在 `new-task` 首页会回到路由跳转路径，容易触发页面切换、路由追平和首刀延迟。

已完成：

- `useAsterAgentChat.ts`：`useAgentTopicSnapshot` 在 `isSessionHydrating=true` 时抑制 active topic 暂缺 warning；真实缺失仍会在非 hydrating 阶段继续暴露。
- `AppSidebar.tsx`：新建任务首页点击已有会话改走 `TASK_CENTER_OPEN_TASK_EVENT`，交给当前 Agent workspace 本地新增/切换标签，不再跳出当前页面做 claw 路由导航。
- `AppSidebar.test.tsx`：更新新建任务首页点击历史会话的回归，断言发出本地 open event 且不调用 `onNavigate`。
- `.tmp/agentui-perf-probe.mjs`：新建任务改为等待 `home-start-surface` / `青柠一下，灵感即来` DOM 就绪；会话选择避开已标记 active 的侧栏项，避免把 no-op 点击计入旧会话恢复耗时。

Playwright 复测摘要：

- 页面：`http://127.0.0.1:1420/`，Chrome 持久化 profile `.tmp/lime-agentui-e2e-chrome-profile`，DevBridge `3030` 健康检查通过。
- 旧会话 B `PPT大纲规划`：`clickToSwitchStartMs≈3ms`，`runtimeGetSessionDurationMs≈71ms`，`clickToSwitchSuccessMs≈81ms`，`switchStartCount=1`，`runtimeGetSessionStartCount=1`，`longTask=0`。
- 切回旧会话 A `AI网关MVP规划`：`clickToSwitchStartMs≈1ms`，`runtimeGetSessionDurationMs≈108ms`，`clickToSwitchSuccessMs≈113ms`，`switchStartCount=1`，`runtimeGetSessionStartCount=1`，`longTaskMax≈51ms`。
- 新建任务：`clickToHomeMs≈83ms`，`home-start-surface=true`，`0` 次 `getSession`，`longTask=0`。
- 控制台：`0 error / 0 warning`；上一轮 `useAgentTopicSnapshot.skipWithoutActiveTopic` 已消失。
- 网络：最慢有效 `/invoke` 为 `agent_runtime_list_sessions≈413ms`，`agent_runtime_get_session≤113ms`；长连接类 `/events` 在浏览器关闭时出现 `ERR_ABORTED`，为探针关闭上下文产生的非阻塞噪音。

已验证：

```bash
node --check ".tmp/agentui-perf-probe.mjs"
npx eslint "src/components/agent/chat/hooks/useAsterAgentChat.ts" --max-warnings 0
npm exec -- vitest run "src/components/agent/chat/hooks/useAgentTopicSnapshot.test.tsx" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "detached 会话缺少活动话题|切换到无本地快照的话题"
npx eslint "src/components/AppSidebar.tsx" "src/components/AppSidebar.test.tsx" "src/components/agent/chat/hooks/useAsterAgentChat.ts" --max-warnings 0
npm exec -- vitest run "src/components/AppSidebar.test.tsx" "src/components/agent/chat/index.test.tsx" -t "新建任务首页点击已有会话|new-task 首页收到外层侧栏打开历史会话|任务中心内点击已有会话|打开已有会话时若导航已有缓存任务"
npm run typecheck
npm run bridge:health -- --timeout-ms 120000
node ".tmp/agentui-perf-probe.mjs" > ".tmp/agentui-perf-probe-latest.json"
```

结果：

- Hook 定向回归：通过，`2` 个测试通过。
- AppSidebar / AgentChatPage 定向回归：通过，`4` 个测试通过。
- ESLint touched files：通过。
- TypeScript：通过。
- Playwright 性能探针：完成，旧会话点击到 switch start 已收敛到 `1-3ms`；新建任务首页首帧收敛到 `~83ms`；控制台 warning 清零。

下一步：

1. 如果用户继续感知“旧会话正文慢”，优先看真实重历史会话的 `messageList.paint` 是否稳定产出；当前小会话 detail 很快，但首个 no-op 样本说明探针还需要进一步区分“已在内存中的会话”与“真实冷打开”。
2. 对大历史会话继续采 `renderedMessagesCount / threadItemsCount / timelineGroupsCount / longTaskMaxMs`，若 `getSession≤150ms` 但 paint 或 long task 高，下一刀进入 MessageList 虚拟化 / timeline worker。
3. 当前磁盘空间不足时不跑 `npm run tauri:dev:headless` / `verify:gui-smoke` 这类会触发 Rust 编译的重验证；本轮以已就绪 DevBridge + 浏览器实测覆盖主路径。

### 2026-04-30：P1 第九刀，旧会话 pending shell 直接进入会话布局

采集事实：

- 上一轮探针中，旧会话 `switch.success` 与 `agent_runtime_get_session` 已较快返回，但部分样本 `messageList.paintCount=0`，探针等待到超时，体感上等同“打开旧会话后仍停在新建首页 / 空态”。
- 代码复核发现 `chatLayoutVisibility` 已支持 `isSessionHydrating`，但 `AgentChatWorkspace` 还没有把该状态传入 `shouldShowChatLayout`；同时 `effectiveShowChatPanel` 的 `new-task` 分支也没有把 hydrating 算作会话活动。
- 这会导致旧会话 pending shell 阶段虽然已进入 session switch 主链，但布局层仍按空白新建页处理，MessageList 无法及时挂载并产生 paint 指标。

已完成：

- `AgentChatWorkspace.tsx`：
  - `shouldShowChatLayout(...)` 调用补入 `isSessionHydrating`。
  - `effectiveShowChatPanel` 在 `agentEntry="new-task"` 时把 `isSessionHydrating` 计入会话活动，旧会话恢复的 pending shell 不再被空白首页分支吞掉。
- `chatLayoutVisibility.ts` / `chatLayoutVisibility.test.ts`：保留第八刀新增的 hydrating 可见性参数与回归，确保旧会话恢复 pending shell 阶段直接进入会话布局。

已验证：

```bash
npx eslint "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/utils/chatLayoutVisibility.ts" "src/components/agent/chat/utils/chatLayoutVisibility.test.ts" "src/components/agent/chat/index.test.tsx" "src/components/AppSidebar.tsx" "src/components/AppSidebar.test.tsx" "src/components/agent/chat/taskCenterDraftTaskEvents.ts" --max-warnings 0
npm exec -- vitest run "src/components/agent/chat/utils/chatLayoutVisibility.test.ts" "src/components/agent/chat/index.test.tsx" "src/components/AppSidebar.test.tsx" -t "旧会话恢复 pending shell|new-task 首页收到外层侧栏打开历史会话|新建任务首页点击已有会话|任务中心内点击已有会话|空白新建任务首页应保留浏览器式工作区顶栏"
npm run typecheck
```

结果：

- ESLint touched files：通过。
- AgentUI 布局 / 新建页 / 侧栏打开历史会话定向回归：通过，`5` 个测试通过。
- TypeScript：通过。

Playwright / DevBridge 状态：

- 下一次真实复测必须继续按仓库规则使用 Chrome 持久化 profile：`.tmp/lime-agentui-e2e-chrome-profile`，不使用 isolated 临时 profile，不传 `--no-sandbox`。
- 本轮真实 E2E 暂未完成：`npm run bridge:health -- --timeout-ms 5000` 多次失败，`http://127.0.0.1:3030/health` 未监听。
- 尝试拉起 `npm run tauri:dev:headless` 时，当前机器已有其它 Rust / GUI smoke / cargo test 编译链占用 Cargo lock，输出持续停在 `Blocking waiting for file lock on package cache / artifact directory`；同时磁盘可用空间约 `8.8-9.3GiB`，继续叠加编译会污染旧会话卡顿采样。
- 已停止本轮自己拉起的 headless 链路，未清理用户已有的长期 Tauri / cargo 校验进程；待 DevBridge 恢复后再复跑真实旧会话多标签性能探针。

下一步：

1. DevBridge 3030 恢复后，复测：新建任务首页 -> 打开旧会话 A -> 打开旧会话 B -> 切回旧会话 A -> 新建空白任务标签。
2. 采集并对比 `clickToSwitchStartMs`、`runtimeGetSessionDurationMs`、`clickToSwitchSuccessMs`、`messageListPaintCount`、`clickToMessageListPaintMs`、`longTaskMaxMs`。
3. 如果 `messageList.paintCount` 仍为 `0`，下一刀继续查 `WorkspaceShellScene` / `MessageList` 条件渲染；如果 paint 正常但 `longTaskMaxMs` 高，转入 MessageList 虚拟化或 timeline worker。

### 2026-04-30：P1 第十刀，旧会话首帧延后底部运行状态行重计算

采集事实：

- 第九刀修复布局后，旧会话 pending shell 能进入会话布局；下一处首帧风险集中在 `MessageList` 首帧仍会为了最后一条 assistant 的底部运行状态行同步扫描 `threadItems`。
- 已分页旧会话或历史窗口里，timeline 本体虽然已经延后，但 `buildInputbarRuntimeStatusLineModel` / `buildAgentTaskRuntimeCardModel` 仍可能在首帧扫描并过滤大量历史 `threadItems`，造成 CPU 峰值和短期数组分配。
- 这些底部完成态状态行不是旧会话首帧正文可见的必要条件；等待 historical timeline idle 后再补上，不影响发送中、等待输入、排队或 active turn 的实时反馈。

已完成：

- `MessageList.tsx`：
  - 对旧会话恢复窗口增加 `shouldDeferTailRuntimeStatusLine`。
  - 当旧会话历史 timeline 正在 idle 延后、且没有发送中 / active turn / pending action / queued turn / pending request 时，首帧不再构建底部运行状态行。
  - `messageList.commit/paint` 指标增加 `tailRuntimeStatusDeferred`，后续 E2E 可直接判断首帧是否成功避开这段同步计算。
- `MessageList.test.tsx`：旧会话消息少但执行过程多的场景，新增断言：首帧不渲染 `inputbar-runtime-status-line`，idle 后再恢复。
- `inputbarRuntimeStatusLine.ts` / `agentTaskRuntime.ts`：把多处 `[...array].reverse()` 与 `filter(...).find(...)` 改为从尾部循环或单次扫描，减少旧会话打开时的短期数组复制。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "旧会话消息较少但执行过程很多时也应延后构建 timeline|旧会话首帧应记录可汇总的渲染采样数值|复杂任务完成后应把运行状态"
npm exec -- vitest run "src/components/agent/chat/components/Inputbar/components/InputbarRuntimeStatusLine.test.tsx" "src/components/agent/chat/components/MessageList.test.tsx" -t "旧会话消息较少但执行过程很多时也应延后构建 timeline|复杂任务完成后应把运行状态|InputbarRuntimeStatusLine"
npm exec -- vitest run "src/components/agent/chat/utils/agentTaskRuntime.test.ts"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/utils/agentTaskRuntime.ts" "src/components/agent/chat/utils/inputbarRuntimeStatusLine.ts" --max-warnings 0
npm run typecheck
npm run bridge:health -- --timeout-ms 5000
```

结果：

- MessageList 定向回归：通过，`3` 个测试通过。
- Inputbar / MessageList 组合回归：通过，`4` 个测试通过。
- Agent task runtime 单测：通过，`4` 个测试通过。
- ESLint touched files：通过。
- TypeScript：通过。
- DevBridge 健康检查：失败，`http://127.0.0.1:3030/health` 仍未监听；因此本轮仍未做真实 Playwright 多旧会话采样。

下一步：

1. DevBridge 恢复后，优先复测旧会话 A/B 切换，确认 `messageList.paint` 中 `tailRuntimeStatusDeferred=true` 的首帧是否降低 `longTaskMaxMs`。
2. 如果 E2E 仍显示 `longTaskMaxMs` 高，下一刀继续把 historical `threadItems` 的摘要计算改成按 `latestTurnId` 建索引或移入 idle/worker。
3. 如果 E2E 显示 `runtimeGetSessionDurationMs` 高于渲染耗时，回到后端 `getSession` 分块/缓存，不再继续前端微调。

### 2026-04-30：P1 第十一刀，旧会话按可见 turns 精确裁剪 threadItems

采集事实：

- 第十刀已把旧会话首帧的底部运行状态行延后，但 `MessageList` 仍会在历史窗口首帧按消息数量粗略截取尾部 `threadItems`。
- 对“消息少、工具过程多”的旧会话，粗略按 `messageCount * factor` 截取容易把与当前可见消息无关的 turn item 也带入 `buildMessageTurnTimeline` / runtime status 计算，继续造成短期 CPU 与数组分配峰值。
- 旧会话分页窗口的首帧只需要渲染尾部可见 assistant 关联的 turns；其它历史 turns 可以等待“加载完整历史”或后续展开再参与计算。

已完成：

- `MessageList.tsx`：
  - 移除按消息数倍数裁剪 `threadItems` 的粗略常量。
  - 根据当前实际渲染的 assistant 消息数推导旧会话恢复窗口的 `renderedTurns` tail window，并额外保留 `currentTurnId`，避免进行中 turn 被裁掉。
  - 在分页旧会话 / hidden history 场景下构建 `renderedTurnIdSet`，`renderedThreadItems` 只保留这些 turns 对应的 `threadItems`。
- `MessageList.test.tsx`：新增“已分页旧会话首帧应只把尾部相关 turns 的 threadItems 纳入计算”回归，覆盖 8 个 turns、40 个 threadItems、首帧只渲染 2 条消息的场景；断言首帧只纳入尾部 2 个 turns / 10 个 threadItems。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "已分页旧会话首帧应只把尾部相关 turns 的 threadItems 纳入计算|旧会话消息较少但执行过程很多时也应延后构建 timeline|已分页旧会话的完成执行过程应先折叠为轻量摘要"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" --max-warnings 0
python3 - <<'PY'
# 120s wrapper for npm run typecheck
PY
```

结果：

- MessageList 定向回归：通过，`3` 个测试通过。
- ESLint touched files：通过。
- TypeScript：本轮 wrapper 在 `120s` 超时后终止；未看到类型错误输出。当前机器仍有其它 Rust / cargo 编译链与编辑器 tsserver 占用 CPU，先记录为环境性未完成，不继续叠加新的全量 typecheck。
- DevBridge / Playwright：尚未复测；需先确认 `3030` 恢复，避免在 bridge 未就绪时把前端优化误判为 GUI 卡顿。

下一步：

1. DevBridge 恢复后，复测多旧会话切换并采集 `messageList.commit/paint`，重点看 `threadItemsCount` 是否随可见 turn 数下降，而不是随全量历史增长。
2. 如果 `getSession≤150ms` 但 `clickToMessageListPaintMs` 或 `longTaskMaxMs` 仍高，下一刀继续把 `buildMessageTurnTimeline` 的历史 mapping / sort 移到 idle 或建立 `turn_id -> items` 索引。
3. 如果 `runtimeGetSessionDurationMs` 高于渲染耗时，转回后端 `getSession` 分块 / 缓存，不再继续前端微调。

### 2026-04-30：P1 第十二刀，旧会话首帧完全跳过 threadItems 扫描

采集事实：

- 第十一刀已经把旧会话恢复窗口的 `threadItems` 从“按消息数粗略截尾”改成“按可见 turns 精确裁剪”，但首帧仍需要遍历全量 `threadItems` 才能筛出尾部 turns。
- 对工具轨迹特别多的旧会话，哪怕最终只渲染 10 条相关 items，首帧的全量数组扫描仍会造成鼠标 loading、CPU 峰值和短期内存分配。
- 旧会话首帧的核心目标是先让消息文本和吸顶布局可见；完成态历史 timeline / 底部运行状态行可以继续等 idle 后补齐。

已完成：

- `MessageList.tsx`：
  - `shouldDeferHistoricalTimeline` 改为基于原始 `threadItems.length` 与恢复窗口判断，避免为了判断是否延后而先扫描 / 裁剪 `threadItems`。
  - 新增 `shouldDeferThreadItemsScan`：旧会话历史 timeline 尚未 idle-ready、且没有 active turn 时，`renderedThreadItems` 首帧直接返回空数组，不再遍历全量历史 items。
  - `timelineHydrationKey` 改用原始 `threadItems.length + lastItemId`，确保后台 item 变化仍能触发 idle hydrate。
  - `messageList.commit/paint` 指标增加 `threadItemsScanDeferred`，后续 Playwright 能直接看到首帧是否跳过了全量扫描。
- `MessageList.test.tsx`：更新旧会话窗口测试，首帧断言 `threadItemsScanDeferred=true` 且 `threadItemsCount=0`；idle 后再断言精确裁剪到尾部 2 个 turns / 10 个 `threadItems`。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "已分页旧会话首帧应只把尾部相关 turns 的 threadItems 纳入计算|旧会话消息较少但执行过程很多时也应延后构建 timeline|已分页旧会话的完成执行过程应先折叠为轻量摘要"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" --max-warnings 0
npm run bridge:health -- --timeout-ms 5000
python3 - <<'PY'
# 180s wrapper for npm run typecheck
PY
```

结果：

- MessageList 定向回归：通过，`3` 个测试通过。
- ESLint touched files：通过。
- DevBridge 健康检查：失败，`http://127.0.0.1:3030/health` 未监听；本轮没有进入 Playwright 真实旧会话采样。
- TypeScript：本轮 wrapper 未超时，但 `tsc --noEmit` 约 `40s` 后以 code `241` 退出且无错误诊断；检查后未发现残留 `tsc` 进程。当前仍有其它 `run-vitest-smart` / Vite 进程占用 CPU，先记录为环境性未闭环，避免继续叠加重校验影响用户本机性能。

下一步：

1. DevBridge 3030 恢复后复测旧会话 A/B 切换，重点读取 `messageList.commit/paint` 的 `threadItemsScanDeferred`、`threadItemsCount`、`clickToMessageListPaintMs` 和 `longTaskMaxMs`。
2. 若首帧 `threadItemsScanDeferred=true` 后仍卡顿，下一刀优先检查 `StreamingRenderer` / Markdown light render 的长文本成本，而不是继续优化 timeline。
3. 若 idle 后 timeline hydrate 才出现长任务，则把 `buildMessageTurnTimeline` 的 grouping / sort 继续放到 worker 或分片 idle 队列。

### 2026-04-30：P1 第十三刀，旧会话首帧延后 contentParts 细节扫描 + 流式首字立即可见

采集事实：

- DevBridge `3030` 仍未监听，当前无法用 Playwright 复测真实旧会话 A/B 切换；同时本机已有多条 Rust 编译链占用 CPU，继续启动 `tauri:dev:headless` 会污染“卡顿”采样。
- 第十二刀已经让旧会话首帧跳过全量 `threadItems` 扫描，但 `MessageList` 在渲染每条历史 assistant 时仍会同步 `sanitizeContentPartsForDisplay`、过滤工具/思考片段、计算 inline process coverage。
- 对已完成的旧会话，这些 `contentParts` 细节不是首帧文本可见的必要条件；可以等 historical timeline idle 后再恢复。
- 流式纯文本首次挂载时，`StreamingText` 之前以空字符串作为首帧，必须等下一次 `requestAnimationFrame` 才开始吐字；在模型已有首个分片时，这会放大“首字慢”的体感。

已完成：

- `MessageList.tsx`：
  - 增加 `shouldDeferHistoricalAssistantMessageDetails`，旧会话恢复窗口、historical timeline 尚未 ready、没有 active turn / sending / action request / toolCalls / thinking 时，首帧不再处理历史 assistant 的 `contentParts` 细节。
  - 增加 `historicalContentPartsDeferredCount` 指标，后续 E2E 可判断是否命中旧会话首帧轻量路径。
  - 保留文本正文优先渲染；idle 后再恢复 contentParts / timeline 细节，避免首帧被旧工具过程拖慢。
- `MessageList.test.tsx`：新增“旧会话首帧应延后历史助手 contentParts 细节扫描”回归，断言首帧 `data-content-parts=0`、`historicalContentPartsDeferredCount=1`，idle 后指标恢复为 `0`。
- `StreamingRenderer.tsx`：
  - 增加 `STREAMING_TEXT_INITIAL_VISIBLE_CHARS` 和 `resolveInitialStreamingDisplayText`。
  - 流式纯文本首次挂载时立即显示前 `12` 个字符；结构化内容仍保持空首帧，避免把未完整的 A2UI / write_file 协议直接露出。
  - 当流式文本发生非 append 替换时，也立即种下同样的纯文本前缀，减少重置后的空白等待。
- `StreamingRenderer.test.tsx`：新增“流式纯文本首帧应立即显示前缀”回归，并保留大 backlog 追赶测试。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "旧会话首帧应延后历史助手 contentParts 细节扫描|已分页旧会话首帧应只把尾部相关 turns 的 threadItems 纳入计算|旧会话消息较少但执行过程很多时也应延后构建 timeline"
npm exec -- vitest run "src/components/agent/chat/components/StreamingRenderer.test.tsx" -t "流式纯文本首帧应立即显示前缀|流式正文积压较多时应快速追上最新目标文本|纯文本内容应短路跳过结构化解析"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/components/StreamingRenderer.tsx" "src/components/agent/chat/components/StreamingRenderer.test.tsx" --max-warnings 0
npm run bridge:health -- --timeout-ms 5000
```

结果：

- MessageList 定向回归：通过，`3` 个测试通过。
- StreamingRenderer 定向回归：通过，`3` 个测试通过。
- ESLint touched files：通过。
- DevBridge 健康检查：失败，`http://127.0.0.1:3030/health` 未监听。
- TypeScript：本轮暂不追加全量 typecheck；当前机器已有多条 Rust 编译链高负载运行，继续叠加全量 TS 校验会影响用户正在反馈的 CPU/鼠标 loading 问题。待编译链空闲后补跑。

下一步：

1. DevBridge 恢复后复测真实旧会话：读取 `threadItemsScanDeferred`、`historicalContentPartsDeferredCount`、`clickToMessageListPaintMs`、`longTaskMaxMs`。
2. 如果旧会话首帧仍慢，下一刀只看 `MarkdownRenderer` 本体：把 restored history 的短正文也先走纯文本预览 / idle 后 Markdown hydrate，避免 ReactMarkdown 在首帧解析多条历史短回复。
3. 如果流式仍首字慢，下一步看后端事件到达时间：区分“前端首帧空白”与“runtime 第一段 delta 到达慢”。

第十三刀补充：

- `agentUiPerformanceMetrics.ts`：summary 增加 `historicalContentPartsDeferredMax` 与 `threadItemsScanDeferredCount`，让 Playwright 不只读 raw entries，也能在 session summary 里直接看到旧会话首帧轻量路径命中次数。
- `agentUiPerformanceMetrics.test.ts`：补充 summary 断言，覆盖 contentParts 延后最大值与 threadItems 扫描延后次数。
- 追加验证：

```bash
npm exec -- vitest run "src/lib/agentUiPerformanceMetrics.test.ts"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/components/StreamingRenderer.tsx" "src/components/agent/chat/components/StreamingRenderer.test.tsx" "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" --max-warnings 0
```

结果：性能指标汇总单测通过，ESLint touched files 继续通过。

### 2026-04-30：P1 第十四刀，旧会话首帧延后 Markdown hydrate

采集事实：

- DevBridge `3030` 仍未监听，真实 Playwright 多旧会话切换暂不可测。
- 当前机器已有 `tsc --noEmit` 与多条 `rustc` 高 CPU 进程，继续启动 Tauri / GUI smoke 会污染用户反馈的鼠标 loading 与 CPU 飙高采样。
- 第十三刀已跳过旧会话首帧的 `contentParts` 细节扫描，但短历史 assistant 正文仍会进入 `StreamingRenderer -> MarkdownRenderer -> ReactMarkdown`，即使 `renderMode=light` 也会同步解析多条历史 Markdown。
- 旧会话首帧的产品目标是“先看到消息文本与布局”，Markdown 标题、列表、代码高亮、表格等可等 idle 后恢复。

已完成：

- `MessageList.tsx`：
  - 增加 `MESSAGE_LIST_STRUCTURED_HISTORY_CONTENT_RE` 与 `hasStructuredHistoricalContentHint`，避免把 A2UI / write_file / document 这类结构化协议用纯文本提前露出。
  - 增加 `HistoricalMarkdownHydrationPreview`，旧会话首帧用 `whitespace-pre-wrap` 纯文本直接展示 assistant 正文，不挂载 `StreamingRenderer` / `ReactMarkdown`。
  - 增加 `historicalMarkdownDeferredCount` 指标，记录旧会话首帧被延后的 Markdown hydrate 数量。
  - 当 historical timeline idle-ready 后，自动恢复原有 `StreamingRenderer` / light Markdown 渲染。
- `MessageList.test.tsx`：更新旧会话首帧回归，断言首帧出现 `message-list-historical-markdown-preview`、不挂载 `streaming-renderer`，idle 后移除 preview 并恢复 renderer。
- `agentUiPerformanceMetrics.ts` / `.test.ts`：summary 增加 `historicalMarkdownDeferredMax`，方便 Playwright summary 直接读取 Markdown hydrate 延后命中量。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "旧会话首帧应延后历史助手 contentParts 与 Markdown 细节扫描|已分页旧会话首帧应只把尾部相关 turns 的 threadItems 纳入计算|旧会话消息较少但执行过程很多时也应延后构建 timeline|旧会话里的长助手回复应先展示纯文本预览"
npm exec -- vitest run "src/lib/agentUiPerformanceMetrics.test.ts"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" --max-warnings 0
npm run bridge:health -- --timeout-ms 5000
```

结果：

- MessageList 定向回归：通过，`4` 个测试通过。
- 性能指标汇总单测：通过，`2` 个测试通过。
- ESLint touched files：通过。
- DevBridge 健康检查：失败，`http://127.0.0.1:3030/health` 未监听。
- TypeScript：本轮未追加全量 typecheck；本机已有其它 `tsc --noEmit` 高 CPU 进程在运行，避免重复启动。

下一步：

1. DevBridge 恢复后复测真实旧会话，读取 `historicalMarkdownDeferredMax`、`historicalContentPartsDeferredMax`、`threadItemsScanDeferredCount`、`clickToMessageListPaintMs`、`longTaskMaxMs`。
2. 若首帧仍慢，下一刀优先看 `visibleMessages.filter` / `buildMessageTurnGroups` 是否需要基于 sessionId 做更强 memo 或窗口化。
3. 若首帧已快但 idle 后出现卡顿，把 Markdown hydrate / timeline hydrate 拆成分批 idle，而不是一次性恢复完整历史。

### 2026-04-30：P1 第十五刀，旧会话 Markdown idle 分批 hydrate

采集事实：

- 第十四刀已经让旧会话首帧不挂载 `ReactMarkdown`，但 historical timeline idle-ready 后，所有短历史 assistant 会在同一轮恢复 `StreamingRenderer / MarkdownRenderer`。
- 对消息窗口里有多条短 Markdown 回复的旧会话，一次性恢复仍可能在首帧之后造成第二段 CPU 峰值，表现为鼠标短暂 loading 或滚动卡顿。
- 真实 Playwright 仍不可用：`DevBridge 3030` 未监听；本机同时存在 `rustc` 高 CPU 编译链，继续拉 GUI smoke 会污染性能采样。

已完成：

- `MessageList.tsx`：
  - 增加 `MESSAGE_LIST_RESTORED_MARKDOWN_HYDRATION_INITIAL_COUNT / BATCH_SIZE / DELAY_MS`。
  - 将旧会话 Markdown hydrate 从“timeline ready 后全量恢复”改为“先恢复 2 条，再按 idle 每批 +2 条”。
  - 复用 `scheduleMinimumDelayIdleTask` 分片恢复，避免一次性挂载多个 `StreamingRenderer / ReactMarkdown`。
  - `historicalMarkdownDeferredCount` 现在表示尚未 hydrate 的历史 Markdown 数量；ready 后会随批次递减，而不是直接归零。
  - `historicalContentPartsDeferredCount` 也跟随未 hydrate 的消息保持延后，避免 Markdown 未恢复但 contentParts 细节先被扫描。
- `MessageList.test.tsx`：新增“旧会话 idle 后应分批恢复历史 Markdown hydrate”回归，覆盖 5 条历史 assistant：首帧 `0/5` hydrated，第一次 idle `2/5`，第二次 idle `4/5`，第三次 idle `5/5`。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "旧会话 idle 后应分批恢复历史 Markdown hydrate|旧会话首帧应延后历史助手 contentParts 与 Markdown 细节扫描|已分页旧会话首帧应只把尾部相关 turns 的 threadItems 纳入计算|旧会话消息较少但执行过程很多时也应延后构建 timeline"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" --max-warnings 0
npm run bridge:health -- --timeout-ms 5000
```

结果：

- MessageList 定向回归：通过，`4` 个测试通过。
- ESLint touched files：通过。
- DevBridge 健康检查：失败，`http://127.0.0.1:3030/health` 未监听。
- TypeScript：本轮未追加全量 typecheck；当前已有外部 `tsc --noEmit` 与 `rustc` 高 CPU 进程，避免重复启动影响用户本机。

下一步：

1. DevBridge 恢复后跑真实 E2E，确认 `historicalMarkdownDeferredMax` 是否命中，且 `longTaskMaxMs` 是否下降。
2. 若 idle 后仍有峰值，继续把 timeline hydrate 与 Markdown hydrate 分开调度，或给 Markdown hydrate 增加“仅当前视口附近消息优先”。
3. 若真实卡顿转移到会话切换前，则回到 sidebar/list_sessions 与 getSession 并发争抢治理。

### 2026-04-30：P1 第十六刀，旧会话 E2E 长任务指标内建采集

采集事实：

- 旧会话卡顿反馈里，`clickToMessageListPaintMs` 只能说明首屏是否出现，不能说明首屏后是否有第二段主线程峰值。
- 之前 Playwright 复测依赖临时脚本读取 `PerformanceObserver(longtask)`，不够稳定；真实复测一旦 DevBridge 恢复，应能直接从 `window.__LIME_AGENTUI_PERF__.summary()` 读取 long task 指标。
- 当前 DevBridge 仍未监听 `3030`，且本机有 `rustc / clang / vite` 高 CPU 进程；本刀只补内建采集与单测，不启动 GUI smoke。

已完成：

- `agentUiPerformanceMetrics.ts`：
  - 在浏览器支持 `PerformanceObserver` 且支持 `longtask` entry 时，自动注册 long task observer。
  - observer 会把长任务写入 `agentUi.longTask` phase，并绑定最近一次有 `sessionId` 的会话上下文。
  - summary 增加 `longTaskCount / longTaskMaxMs`，避免 E2E 还要自行维护临时 long task 数组。
  - 保持 WebView / jsdom 不支持 longtask 时静默降级，不阻塞页面。
- `agentUiPerformanceMetrics.test.ts`：补充 summary 断言，确保 `session.switch.success.durationMs` 不会污染 `longTaskMaxMs`，只统计 `agentUi.longTask.durationMs`。

已验证：

```bash
npm exec -- vitest run "src/lib/agentUiPerformanceMetrics.test.ts"
npx eslint "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" --max-warnings 0
npx tsc --noEmit --pretty false --target ES2020 --module ESNext --moduleResolution node --skipLibCheck --lib DOM,ES2020 "src/lib/agentUiPerformanceMetrics.ts"
npm run bridge:health -- --timeout-ms 5000
```

结果：

- 性能指标汇总单测：通过，`2` 个测试通过。
- ESLint touched metrics files：通过。
- `agentUiPerformanceMetrics.ts` 聚焦类型检查：通过。
- DevBridge 健康检查：失败，`http://127.0.0.1:3030/health` 未监听。
- GUI / Playwright：本刀未执行，原因仍是 `DevBridge 3030` 未就绪且本机已有高 CPU 编译链，贸然启动会污染卡顿采样。

下一步：

1. DevBridge 恢复后，Playwright 复测只需读取 `window.__LIME_AGENTUI_PERF__.summary()`，重点看 `longTaskCount / longTaskMaxMs / historicalMarkdownDeferredMax / threadItemsScanDeferredCount`。
2. 若 `longTaskMaxMs` 仍高但首屏快，下一刀继续把 historical timeline summary 构建或展开 hydrate 做视口优先 / idle 分批。
3. 若 long task 主要出现在 `getSession` 返回前后，转后端分页/缓存和 sidebar refresh 优先级治理，不再只做 MessageList 微调。

### 2026-04-30：P1 第十七刀，旧会话 threadItems 展开前不扫描

采集事实：

- 第十五刀已经把 Markdown hydrate 改为分批，但 historical timeline ready 后仍会对大 `threadItems` 数组做一次同步过滤与 timeline 构建。
- 用户反馈的“打开旧对话后鼠标 loading、CPU/内存飙高”更像首屏之后的主线程峰值；如果用户没有展开历史执行过程，立即扫描完整工具轨迹不是首屏必要工作。
- 当前真实 E2E 仍受 DevBridge `3030` 未就绪阻塞，本刀先把可确定的前端同步扫描从自动 idle 路径移到用户展开路径。

已完成：

- `MessageList.tsx`：
  - 增加 `shouldDeferRestoredThreadItemsUntilExpand`，旧会话在没有聚焦 timeline、没有活动回合、没有用户展开历史执行过程时，即使 timeline ready 也继续保持 `renderedThreadItems=[]`。
  - 旧会话仍会用轻量 turn/message 映射渲染“执行过程已折叠”按钮，但按钮文案改为“点击展开后加载执行细节”，避免空 timeline 直接消失。
  - 用户点击折叠按钮后，才解除 `threadItems` 扫描，且继续只按当前渲染窗口相关 turns 过滤，避免全历史全部挂载。
- `MessageList.test.tsx`：
  - 更新已分页旧会话回归：首帧与 idle 后都保持 `threadItemsCount=0 / threadItemsScanDeferred=true`，点击执行过程折叠按钮后才出现 `threadItemsCount=10 / threadItemsScanDeferred=false`。
  - 保留 contentParts / Markdown 分批回归，确认正文 hydrate 不再强制带动工具轨迹扫描。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "旧会话 idle 后应分批恢复历史 Markdown hydrate|旧会话首帧应延后历史助手 contentParts 与 Markdown 细节扫描|已分页旧会话展开执行过程前不应扫描 threadItems，展开后只纳入尾部相关 turns|旧会话消息较少但执行过程很多时也应延后构建 timeline"
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "旧会话|已分页旧会话|历史"
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx"
npm exec -- vitest run "src/lib/agentUiPerformanceMetrics.test.ts"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" --max-warnings 0
npm run bridge:health -- --timeout-ms 5000
```

结果：

- MessageList 关键旧会话回归：通过，`4` 个测试通过。
- MessageList 旧会话相关回归：通过，`15` 个测试通过。
- MessageList 全量组件单测：通过，`91` 个测试通过。
- 性能指标汇总单测：通过，`2` 个测试通过。
- ESLint touched files：通过。
- DevBridge 健康检查：失败，`http://127.0.0.1:3030/health` 未监听。

下一步：

1. DevBridge 恢复后真实复测：如果 `longTaskMaxMs` 仍高，优先看 `buildMessageTurnGroups(renderedMessages)` 与大量 Markdown 视口外 hydrate；如果 `threadItemsScanDeferredCount` 命中且 long task 下降，则本刀有效。
2. 若用户展开历史执行过程仍卡，下一刀把展开后的 timeline 也做分批/worker 化，而不是在展开瞬间一次性挂完整工具轨迹。
3. 若真实卡顿已转移到 `getSession` 或 sidebar list 并发，回到后端分页/缓存与 sidebar refresh 优先级治理。

### 2026-05-01：P1 第十八刀，DevBridge 事件流断线停止自动重连风暴

采集事实：

- 登录完成后，DevBridge `3030 /health` 一度恢复，旧会话可真实打开。
- Playwright 真实采样：
  - `PPT大纲规划`：`runtimeGetSessionDurationMs≈201ms`、`clickToMessageListPaintMs≈506ms`、`longTaskCount=2`、`longTaskMaxMs≈114ms`、`messages=2`、`threadItems=4`。
  - `AI网关MVP规划`：`runtimeGetSessionDurationMs≈359ms`、`clickToMessageListPaintMs≈507ms`、`longTaskCount=1`、`longTaskMaxMs≈53ms`、`messages=2`、`threadItems=5`。
- 这两个 recent 样本都不是大历史，无法验证第十七刀的大 `threadItems` 展开前延后收益。
- 继续点击/加载更多时，DevBridge 再次掉线；页面产生大量 `/events?...` 的 `ERR_CONNECTION_REFUSED`，控制台 error 瞬间上涨到 `175+`。根因是浏览器 `EventSource` 在已打开事件流断线后自动重连，而 `listenViaHttpEvent` 之前选择保留连接。
- 这类事件流重连风暴会直接放大 CPU、console 噪音与“鼠标 loading”体感，且与消息渲染优化无关，必须先止血。

已完成：

- `src/lib/dev-bridge/http-client.ts`：
  - `listenViaHttpEvent` 在事件流已建立后遇到 `onerror` 时，改为关闭 `EventSource`、删除 hub，并停止浏览器自动重连。
  - 保持“不把一次已建立事件流断开误标记为整体桥不可用”，避免单个 SSE 结束影响普通 invoke。
  - 下次调用 `safeListen/listenViaHttpEvent` 时仍可重新建新连接，但不会由同一个 EventSource 在后台无限刷 `/events`。
- `src/lib/dev-bridge/http-client.test.ts`：
  - 更新回归为“已建立事件流断开后应关闭连接，避免自动重连风暴”。
  - 保留“事件流结束不影响后续 invoke”的回归。

已验证：

```bash
npm exec -- vitest run "src/lib/dev-bridge/http-client.test.ts"
npm exec -- vitest run "src/lib/dev-bridge/http-client.test.ts" "src/lib/dev-bridge/safeInvoke.test.ts"
npx eslint "src/lib/dev-bridge/http-client.ts" "src/lib/dev-bridge/http-client.test.ts" --max-warnings 0
npm run test:contracts
npm run bridge:health -- --timeout-ms 5000
```

结果：

- DevBridge HTTP / safeInvoke 定向回归：通过，`28` 个测试通过。
- ESLint touched bridge files：通过。
- 命令契约：通过。
- DevBridge 健康检查：最后再次失败，`http://127.0.0.1:3030/health` 未监听；因此本刀代码热更新后的真实浏览器复测未能闭环。

下一步：

1. DevBridge 稳定恢复后，刷新页面重测 `/events` 断线场景，确认 console 不再出现同一个事件的无限 `ERR_CONNECTION_REFUSED`。
2. 再用 `Slow typing E2E` / `AI Trends Task` 这两个 40 消息样本做真实打开测试，读取 `historicalMarkdownDeferredMax`、`threadItemsScanDeferredCount`、`longTaskMaxMs`。
3. 如果大历史仍有 long task，下一刀优先看 Markdown 视口外 hydrate 和展开后的 timeline 分批；如果 long task 主要来自 DevBridge 掉线/事件流，则继续治理事件桥生命周期。

### 2026-05-01：P1 第十九刀，侧栏会话加载去重与导航后延迟

采集事实：

- DevBridge 稳定时的 Playwright 采样显示，打开 `Slow typing E2E` / `AI Trends Task` 这类旧会话时，`agent_runtime_get_session(historyLimit: 40)` 本身可在约 `172-364ms` 返回，但同一窗口内仍会出现 `agent_runtime_list_sessions(limit 21/31/41)`、`workspace_*` 和 `agent_runtime_update_session` 抢占 invoke 通道。
- 侧栏搜索 / 加载更多路径会在旧会话点击前后继续触发 recent / archived list reload；在 invoke 单通道或 DevBridge 忙时，会放大“点击后鼠标 loading、CPU/内存飙高”的体感。
- 搜索弹窗点击历史会话此前没有统一写入 `sidebar.conversation.click`，导致 E2E 只能看最终 paint，难以稳定还原 click-to-paint 链路。

已完成：

- `AppSidebar.tsx`：
  - 搜索结果点击历史会话时记录 `sidebar.conversation.click`，补上 `source=sidebar_search / sessionId / workspaceId`。
  - recent / archived 会话列表加载增加 in-flight 去重与 pending reload 合并，避免加载更多或焦点刷新同时发起多次 list invoke。
  - 点击会话后设置 `conversationNavigationDeferUntilRef`，在已有缓存可展示时把侧栏列表刷新延后 `12s`，优先把 invoke 通道留给旧会话 `getSession`。
  - 搜索结果在 `sidebarSessionsLoading` 时禁用并显示 progress 光标，避免用户在 list reload 中重复点击造成并发导航。
- `AppSidebar.test.tsx`：补充搜索结果点击埋点断言，确保 search 来源的旧会话导航可被 E2E 采样。

已验证：

```bash
npm exec -- vitest run "src/components/AppSidebar.test.tsx" -t "搜索弹窗|搜索结果"
npx eslint "src/components/AppSidebar.tsx" "src/components/AppSidebar.test.tsx" --max-warnings 0
```

结果：

- AppSidebar 搜索相关回归：通过，`5` 个测试通过。
- ESLint touched sidebar files：通过。
- DevBridge / Playwright：中途曾采到 `Slow typing E2E` 打开首屏约 `232ms`、`runtimeGetSessionDurationMs≈172ms`、`longTaskMaxMs≈69ms`；随后 `3030 /health` 再次掉线，无法把本刀做成稳定 E2E 结论。

下一步：

1. DevBridge 恢复后，复测加载更多后点击旧会话，确认点击后 `12s` 内不再出现侧栏 list reload 抢占 `getSession`。
2. 如果仍看到 `agent_runtime_update_session` 与下一次旧会话切换重叠，继续治理 `AgentChatWorkspace` 的 background recent metadata sync。
3. 如果 list reload 已延后但首屏仍慢，回到 `useAgentSession.getSession` 和 MessageList 首帧分片继续看 long task。

### 2026-05-01：P1 第二十刀，会话切换期间延后 background recent metadata 回填

采集事实：

- 第十九刀后，侧栏 list reload 已经可以延后；但一次 Playwright trace 仍显示在连续打开旧会话时，`AgentChatWorkspace` 的 `agent_runtime_update_session` background 回填可能在约 `12-18s` 后与下一次 `getSession` 撞车。
- 这类 `recent_preferences / recent_team_selection` 回填不是首屏必须项；它应该服务后续恢复体验，而不能和旧会话打开主链抢 DevBridge invoke 通道。
- 本轮开始前，当前浏览器页签仍停留在 `http://127.0.0.1:1420/`，但 DevBridge `http://127.0.0.1:3030/health` 不可用；Playwright console 明确为 `ERR_CONNECTION_REFUSED`、`bridge cooldown active`、`workspace_get / agent_runtime_list_sessions / aster_agent_init` 失败。因此本刀先做可验证的前端调度治理，E2E 只记录阻塞原因，不宣布交互可交付。

已完成：

- `AgentChatWorkspace.tsx`：
  - 新增 `SESSION_RECENT_METADATA_NAVIGATION_DEFER_MS=20s` 与 `sessionRecentMetadataNavigationDeferUntilRef`。
  - 任意会话切换、子代理会话打开、返回父会话前，先标记 recent metadata background sync 的导航保护窗口。
  - background priority 的 recent metadata flush 若命中导航保护窗口，不再立刻调用 `updateAgentRuntimeSession`，而是按剩余保护时间重新 idle 调度；immediate priority 不受影响。
  - 保留“如果 background flush 触发时已经不是当前 session，则直接 resolve 并跳过更新”的原有保护。
- `useWorkspaceTopicSwitch.ts`：
  - 增加 `onBeforeTopicSwitch` 回调，并确保在项目解析后端查询前发出导航信号。
  - `runTopicSwitch` 直接调用路径也会发出导航信号；`switchTopic` 内部 fast path 不重复发。
- `useWorkspaceTopicSwitch.test.tsx`：新增 3 个回归，覆盖 current-project fast path、需要项目解析路径、直接 `runTopicSwitch` 路径的导航信号顺序。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/workspace/useWorkspaceTopicSwitch.test.tsx"
npm exec -- vitest run "src/components/AppSidebar.test.tsx" -t "搜索弹窗|搜索结果" "src/components/agent/chat/workspace/useWorkspaceTopicSwitch.test.tsx"
npx eslint "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/workspace/useWorkspaceTopicSwitch.ts" "src/components/agent/chat/workspace/useWorkspaceTopicSwitch.test.tsx" --max-warnings 0
npm run bridge:health -- --timeout-ms 5000
```

结果：

- `useWorkspaceTopicSwitch` 定向回归：通过，`3` 个测试通过。
- AppSidebar 搜索相关回归复跑：通过，`5` 个测试通过；同命令中的 `useWorkspaceTopicSwitch` 因 `-t` 过滤被跳过，已由上一条单独覆盖。
- ESLint touched workspace files：通过。
- DevBridge 健康检查：失败，`http://127.0.0.1:3030/health` 未监听。
- Playwright 当前页：`http://127.0.0.1:1420/`，console 仍是 bridge 断线类错误；当前环境不能给出旧会话真实交互闭环。
- Playwright 污染态数值：`traceCount=240`，最新 trace 包含 `aster_agent_init / sceneapp_list_catalog / workspace_get / get_provider_ui_state` bridge 失败；`window.__LIME_AGENTUI_PERF__.summary()` 捕获到 `agentRuntime.listSessions(limit=21)` 失败耗时约 `1635ms`，且 bridge 掉线状态下存在最高约 `4935ms` long task，因此这组数值只用于证明环境已污染，不用于判断旧会话优化效果。

下一步：

1. 先恢复 DevBridge，再刷新页面清空 `window.__LIME_AGENTUI_PERF__` 和 `lime_invoke_trace_buffer_v1`，重测 `Slow typing E2E` 与 `AI Trends Task`。
2. 复测重点看 `agent_runtime_get_session` 前后 `20s` 内是否还出现 `agent_runtime_update_session` / `agent_runtime_list_sessions` 抢占。
3. 如果 invoke 争抢消失但仍卡，下一刀转向 MessageList 视口外 Markdown hydrate 与 timeline 展开后的分批 / worker 化。

### 2026-05-01：P1 第二十一刀，搜索弹窗预取延迟与点击取消

采集事实：

- 第十九刀已经让侧栏 conversation shelf 的 hover 预取延迟触发，但搜索弹窗结果仍在 `focus / pointerenter` 时立即调用 `notifyTaskCenterTaskPrefetch`。
- 用户在搜索弹窗里快速移动鼠标或准备点击旧会话时，立即预取会先发 `agent_runtime_get_session(historyLimit=40)`；如果随后立刻点击同一会话，预取与切换链路会争抢同一 DevBridge invoke 通道。
- 旧会话打开主线只需要“点击后尽快切换”；搜索 hover 预取是优化项，不能抢占点击链路。

已完成：

- `AppSidebar.tsx`：
  - 搜索结果 hover / focus 改为 `900ms` dwell 后再预取，与 conversation shelf 保持一致。
  - 搜索结果 `blur / pointerleave / click / 关闭弹窗 / 卸载` 会取消待触发预取。
  - 搜索预取事件 source 改为 `sidebar_search`，便于和 conversation shelf E2E 指标区分。
- `taskCenterDraftTaskEvents.ts`：补充 `sidebar_search` 事件来源类型。
- `AppSidebar.test.tsx`：新增搜索结果延迟预取、快速点击取消预取并直接导航的回归。

已验证：

```bash
npm exec -- vitest run "src/components/AppSidebar.test.tsx" -t "搜索结果|搜索弹窗|任务中心内悬停已有会话|点击已有会话时不应先触发旧会话预取"
npx eslint "src/components/AppSidebar.tsx" "src/components/AppSidebar.test.tsx" "src/components/agent/chat/taskCenterDraftTaskEvents.ts" --max-warnings 0
```

结果：

- AppSidebar 预取 / 搜索相关回归：通过，`9` 个测试通过。
- ESLint touched sidebar/event files：通过。

下一步：

1. DevBridge 稳定后，在搜索弹窗中 hover 旧会话不足 `900ms` 后点击，确认 trace 中不出现点击前 `agent_runtime_get_session` 预取。
2. 如果用户长停留后预取已完成，再点击同一会话，应走 prefetch 结果而不是再发重复 getSession。

### 2026-05-01：P1 第二十二刀，旧会话恢复命令绕过短退避重新探测 DevBridge

采集事实：

- DevBridge 短暂恢复后，Playwright 点击 `Slow typing E2E`：
  - `sidebar.conversation.click -> session.switch.start` 约 `324ms`。
  - 新缓存快照立即应用，页面先显示最近 `1 / 170` 条消息。
  - deferred hydration 在约 `1.26s` 后发 `agent_runtime_get_session(historyLimit=40)`，但前端 DevBridge client 仍处于 `bridge cooldown active`，导致 `getSession` 直接失败。
  - 该次污染态中 `longTaskMaxMs≈397ms`、`threadItemsScanDeferredCount=7`；由于真实 getSession 失败，这组数值不能用作最终性能结论，但明确暴露了“后端已短暂恢复，前端 cooldown 仍挡住用户主链”的问题。
- CLI `bridge:health` 曾返回 `status=ok (1398ms)`，说明后端可恢复；但浏览器端在 cooldown 内不会重新探测，用户点击旧会话时仍可能被短退避误伤。

已完成：

- `http-client.ts`：
  - 新增 DevBridge cooldown bypass 命令集合。
  - `agent_runtime_get_session / agent_runtime_submit_turn / agent_runtime_create_session / agent_runtime_send_subagent_input` 这类用户主链命令在 cooldown 窗口内允许重新发起 `/health` 探测。
  - 普通后台命令仍保留 cooldown 快速失败，避免 bridge 掉线时继续刷大量后台请求。
- `http-client.test.ts`：新增“旧会话恢复命令应允许绕过短退避重新探测”的回归。

已验证：

```bash
npm exec -- vitest run "src/lib/dev-bridge/http-client.test.ts"
npm exec -- vitest run "src/lib/dev-bridge/http-client.test.ts" "src/lib/dev-bridge/safeInvoke.test.ts"
npx eslint "src/lib/dev-bridge/http-client.ts" "src/lib/dev-bridge/http-client.test.ts" --max-warnings 0
```

结果：

- DevBridge HTTP 定向回归：通过，`13` 个测试通过。
- DevBridge HTTP + safeInvoke 回归：通过，`29` 个测试通过。
- ESLint touched bridge files：通过。
- E2E：本刀发现问题时 DevBridge 曾短暂恢复，随后 `3030 /health` 再次超时；因此真实旧会话闭环仍未稳定完成。

下一步：

1. 等 DevBridge 再次稳定后刷新页面重测 `Slow typing E2E`：重点看 `agent_runtime_get_session` 是否能在 cooldown 污染后重新探测并成功。
2. 若 `getSession` 成功且 trace 中无 `agent_runtime_update_session / agent_runtime_list_sessions` 抢占，再转向剩余前端 long task（当前污染态最高约 `397ms`）。
3. 若 `getSession` 仍失败但 CLI health 正常，继续检查 browser client health cache 与 cooldown 状态暴露，必要时增加可视化 bridge 状态或手动 reset 入口。

### 2026-05-01：P1 第二十三刀，DevBridge 瞬断后的旧会话恢复快速失败与读命令重试

采集事实：

- 复用现有 Playwright Lime 页签，刷新后点击 `Slow typing E2E`：
  - `sidebar.conversation.click -> session.switch.start` 约 `60ms`。
  - `click -> cachedSnapshotApplied` 约 `60ms`。
  - `click -> messageList.paint` 约 `1700ms`，首屏先展示缓存窗口 `1 / 170` 条。
  - `longTaskMaxMs` 从上一轮污染态约 `119ms` 降到约 `72ms`。
- 但 `agent_runtime_get_session(historyLimit=40)` 在浏览器侧被 `net::ERR_ABORTED`，最终按 `60s` 超时失败；后续 `agent_runtime_list_sessions` 与 `agent_runtime_update_session` 也各自挂到约 `60s`。
- 同一时间用命令行直接 POST DevBridge `agent_runtime_get_session(historyLimit=40)` 可在约 `236ms` 返回，说明不是会话数据必然需要 60s，而是浏览器端在 DevBridge 瞬断 / cooldown / 后台 invoke 叠加后把用户恢复链路拖进长超时。
- 页面刷新基线还暴露：一次非关键 `get_config` 瞬断会把 HTTP client 标记进 `3s` cooldown，随后 `agent_runtime_list_sessions / workspace_get` 这类首页与侧栏真相命令会 `0-5ms` 快速失败，导致侧栏短暂显示“还没有开始对话”。

已完成：

- `src/lib/dev-bridge/http-client.ts`：
  - `agent_runtime_get_session / agent_runtime_list_sessions` 从泛化 `agent_runtime_* = 60s` 收敛为 `8s` 读超时，并对连接类失败做一次强制 `/health` 探测后重试。
  - `agent_runtime_update_session` 收敛为 `5s` 后台 patch 超时，避免 recent metadata 回填占住 DevBridge 通道一分钟。
  - `agent_runtime_create_session` 单独保留 `15s` 用户主链窗口；`agent_runtime_submit_turn` 等真正长链路仍保留 `60s`。
  - `agent_runtime_list_sessions` 与 `workspace_list / workspace_get_default / workspace_get / workspace_ensure_ready` 允许绕过短退避重新探测，避免一次瞬断把首页和侧栏恢复命令挡在 cooldown 里。
- `src/components/AppSidebar.tsx`：旧会话点击后，侧栏 recent / archived 后台刷新保护窗口从 `12s` 延长到 `30s`，降低恢复期间 list 与 getSession 抢通道概率。
- `src/components/agent/chat/AgentChatWorkspace.tsx`：recent metadata 后台回填导航保护窗口从 `20s` 延长到 `45s`，避免 `agent_runtime_update_session` 在旧会话恢复尚未稳定时启动。
- `src/lib/dev-bridge/http-client.test.ts`：补充读命令短超时、读命令强制健康探测重试、首页 / 侧栏命令绕过 cooldown、后台 patch 快速超时回归。

已验证：

```bash
npm exec -- vitest run "src/lib/dev-bridge/http-client.test.ts"
npm exec -- vitest run "src/lib/dev-bridge/http-client.test.ts" "src/lib/dev-bridge/safeInvoke.test.ts"
npm exec -- vitest run "src/components/AppSidebar.test.tsx" -t "搜索结果|搜索弹窗|任务中心内悬停已有会话|点击已有会话时不应先触发旧会话预取" "src/components/agent/chat/workspace/useWorkspaceTopicSwitch.test.tsx"
npm exec -- vitest run "src/components/agent/chat/workspace/useWorkspaceTopicSwitch.test.tsx"
npx eslint "src/lib/dev-bridge/http-client.ts" "src/lib/dev-bridge/http-client.test.ts" "src/components/AppSidebar.tsx" "src/components/agent/chat/AgentChatWorkspace.tsx" --max-warnings 0
```

结果：

- DevBridge HTTP 定向回归：通过，`17` 个测试通过。
- DevBridge HTTP + safeInvoke 回归：通过，`33` 个测试通过。
- AppSidebar 预取 / 搜索相关回归：通过，`9` 个测试通过。
- `useWorkspaceTopicSwitch` 回归：通过，`3` 个测试通过。
- ESLint touched files：通过。
- Playwright 交互复测：当前浏览器页签可复用，但 DevBridge 在 Rust/Tauri rebuild 期间未监听 `3030`；`bridge:health --timeout-ms 10000` 超时。已记录为环境阻塞，不能把本轮 E2E 闭环宣称为完全通过。

下一步：

1. 等 Tauri rebuild 完成、`bridge:health` 稳定后，再刷新页签清空 `window.__LIME_AGENTUI_PERF__` 与 invoke trace，重复点击 `Slow typing E2E`。
2. 复测重点：`agent_runtime_get_session` 若再次瞬断，应在约 `8s` 内失败并重试，而不是挂到 `60s`；侧栏 `agent_runtime_list_sessions` 与 recent metadata `agent_runtime_update_session` 不应在点击后 `30-45s` 内抢通道。
3. 若 DevBridge 稳定时 `getSession(historyLimit=40)` 仍超过 `8s`，下一刀应查 Rust 侧 `agent_runtime_get_session` 的 DB 查询、items/messages 组装与序列化耗时。

### 2026-05-01：P1 第二十四刀，旧会话 hydration 超时不再立即重试并延后非关键后台抢占

采集事实：

- 复用现有 Playwright Lime 页签点击 `Slow typing E2E` 后，旧会话首屏已经能在缓存窗口先显示：
  - `click -> switch.start` 约 `89ms`。
  - `click -> cachedSnapshotApplied` 约 `89ms`。
  - `click -> messageList.paint` 约 `1807ms`。
  - `fetchDetailStartCount=1`、`runtimeGetSessionStartCount=1`。
- 同轮 trace 中 `agent_runtime_get_session(historyLimit=40)` 在浏览器侧约 `8004ms` 超时；之前的立即重试会继续抢占 DevBridge，使旧会话恢复、侧栏刷新和后续操作一起变慢。
- `get_or_create_default_project` 曾在短退避或 mock fallback 下返回空对象，触发 `normalizeProject(undefined)` 类重复错误；这类错误不阻塞主链，但会污染恢复期间 CPU 和日志。

已完成：

- `useAgentSession.ts` / `agentSessionDetailHydrationError.ts`：
  - 将旧会话 deferred hydration 错误分为 `timeout / abort / bridge cooldown / bridge health / connection / other`。
  - 对 `timeout after 8000ms` 与 abort 类错误不再立即重试，只记录 `session.switch.fetchDetail.retrySkipped`。
  - 只对 bridge health / cooldown / 硬连接失败保留最多 `1` 次、`15s` 后的低优先级重试。
- `http-client.ts` / `mockPriorityCommands.ts` / `tauri-mock/core.ts`：
  - `get_or_create_default_project` 加入 cooldown bypass 与 bridge truth command 集合。
  - 浏览器 bridge 失败时不再把该命令落到空 mock；默认 mock 返回完整可 normalize 的 workspace 对象。
- `ProjectSelector.tsx`：被动展示 + `deferProjectListLoad` 时，项目摘要请求延迟到 `12s idle` 后触发，减少旧会话切换瞬间的 `workspace_get/default/list` 抢占。
- `AgentChatWorkspace.tsx`：旧会话直达时 topics/listSessions 后台加载延迟从 `12s` 提高到 `45s`。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentSessionDetailHydrationError.test.ts" "src/lib/dev-bridge/http-client.test.ts" "src/lib/dev-bridge/safeInvoke.test.ts" "src/lib/dev-bridge/mockPriorityCommands.test.ts" "src/lib/tauri-mock/core.test.ts"
npm exec -- vitest run "src/components/projects/ProjectSelector.ui.test.tsx" "src/components/agent/chat/components/ChatNavbar.test.tsx" "src/lib/dev-bridge/http-client.test.ts" "src/lib/dev-bridge/mockPriorityCommands.test.ts"
npm exec -- vitest run "src/components/agent/chat/index.test.tsx" "src/components/projects/ProjectSelector.ui.test.tsx" "src/components/agent/chat/components/ChatNavbar.test.tsx"
npm run test:contracts
```

结果：

- hydration 错误分类 / DevBridge / mock 定向回归：通过。
- ProjectSelector / AgentChatWorkspace 相关 UI 回归：通过。
- 契约检查：通过。
- E2E 污染态结论：浏览器侧 `getSession` 仍会 timeout，但已从多次重试收敛为单次失败并跳过即时 retry；下一刀需要解释“CLI 同命令快、浏览器页面内慢”的差异。

下一步：

1. 不再继续盲目优化 SQL；先验证浏览器同源连接池是否被 DevBridge SSE 长连接占满。
2. 如果页面内直接 `fetch('/invoke', agent_runtime_get_session)` 仍明显慢于 Node/CLI，优先收敛 `/events` 连接数。

### 2026-05-01：P1 第二十五刀，DevBridge SSE 事件流 multiplex，释放浏览器 invoke 连接槽

采集事实：

- timeout 污染态中，CLI/Node 直连同一 `agent_runtime_get_session(historyLimit=40)` 可在约 `222-1196ms` 返回；浏览器页面内 `fetch('http://127.0.0.1:3030/invoke')` 曾出现 `12s/20s` timeout。
- Playwright network 曾多次看到 `GET /events?event=lime%3A%2F%2Fcreation_task_submitted => 200 OK` 常驻，以及大量 `/invoke => net::ERR_ABORTED`。
- 这说明主要瓶颈不是 Rust handler 固定慢，而是浏览器同源 HTTP/1.1 连接槽容易被多个 EventSource/SSE 长连接占住，导致 POST `/invoke` 排队超时。

已完成：

- `src-tauri/src/dev_bridge.rs`：
  - `/events` 保留兼容 `?event=...`，新增 `?events=[...]` multiplex 查询。
  - 单条 SSE 连接可同时监听多个 Tauri event，并在每条消息中继续携带 `{ event, payload }`。
  - 仍使用 `app_handle.listen(...)` 只监听 AppHandle 目标，避免退回 `listen_any` 后再次出现逐 token 重复吐字。
  - `DevBridgeEventListenerGuard` 改为持有多个 `EventId`，连接关闭时成组释放监听。
- `src/lib/dev-bridge/http-client.ts`：
  - 前端 HTTP event bridge 从“每个事件一条 EventSource”收敛为“当前页面一条 multiplex EventSource”。
  - 多个 `safeListen(...)` 并发注册时复用同一个 in-flight 连接初始化，按事件名分发 payload。
  - 事件流已打开后断开仍会关闭连接并停止浏览器自动重连风暴，不把整个 bridge 误标记为 unavailable。
- `src/lib/dev-bridge/http-client.test.ts` / `src-tauri/src/dev_bridge.rs`：
  - 新增多事件共用一条 SSE 连接的前端回归。
  - 新增 Rust 查询解析回归，覆盖单事件、JSON array multiplex 与逗号分隔调试格式。

已验证：

```bash
npm exec -- vitest run "src/lib/dev-bridge/http-client.test.ts" "src/lib/dev-bridge/safeInvoke.test.ts" "src/lib/dev-bridge/mockPriorityCommands.test.ts"
npx eslint "src/lib/dev-bridge/http-client.ts" "src/lib/dev-bridge/http-client.test.ts"
cargo test --manifest-path "src-tauri/Cargo.toml" dev_bridge::tests::parses_
npm run test:contracts
git diff --check -- "src/lib/dev-bridge/http-client.ts" "src/lib/dev-bridge/http-client.test.ts" "src-tauri/src/dev_bridge.rs"
npm run bridge:health -- --timeout-ms 10000
```

结果：

- DevBridge HTTP / safeInvoke / mockPriority 定向回归：通过，`40` 个测试通过。
- Rust DevBridge event query 解析回归：通过，`2` 个测试通过。
- ESLint touched bridge files：通过。
- 命令契约检查：通过。
- diff 空白检查：通过。
- DevBridge health：`41ms` 就绪。

Playwright E2E 复测（复用现有 Lime 页签，点击 `Slow typing E2E`）：

- `click -> session.switch.start`: `102ms`。
- `click -> cachedSnapshotApplied`: `103ms`。
- 首次可见 `messageList.paint`: 约 `216ms`（缓存窗口先显示最近消息）。
- deferred hydration `fetchDetail.start`: `1305ms`。
- `agent_runtime_get_session(historyLimit=40)`: 成功，`471ms`，`messages=40 / total=170`。
- `click -> session.switch.success`: `1779ms`。
- `runtimeGetSessionErrorCount=0`，`fetchDetailErrorCount=0`，invoke error buffer 为空。
- `longTaskCount=1`，`longTaskMaxMs=129ms`，`maxUsedJSHeapSize≈499MB`。
- 页面内直接 `fetch('/invoke', agent_runtime_get_session historyLimit=40)`：成功，`946ms`，`messages=40 / total=170`。
- 控制台 error：`2` 条，均为 `user.limeai.run ... /client/skills 401`，属于云端目录鉴权噪音，非本地旧会话恢复阻塞。

下一步：

1. 继续把 “summary 中 clickToMessageListPaintMs 取最后一次 paint” 与“用户首屏已在约 216ms 出现”区分开，补一个首屏 paint 指标，避免后续误判。
2. 针对 `longTaskMaxMs≈129ms` 与 `JSHeap≈499MB`，下一刀优先看 MessageList 首屏 restored-window 的 markdown / turn timeline 同步计算和 sidebar 常驻列表渲染，而不是继续加大 getSession 超时。
3. 多开旧会话 / 新建对话后再复测 EventSource 数量，确认内部 tab 增多时仍不会回到每个事件一条长连接。

### 2026-05-01：P1 第二十六刀，补齐首屏 paint 指标避免误判旧会话体感

采集事实：

- 第二十五刀 Playwright 复测中，旧会话实际首屏缓存窗口约 `216ms` 可见，但 `summary.clickToMessageListPaintMs` 取最后一次 `messageList.paint`，显示为约 `2704ms`。
- 该字段容易把“首屏可见”与“hydration 后最终稳定 paint”混为一谈，后续分析会误判体感慢点。

已完成：

- `agentUiPerformanceMetrics.ts`：新增 `clickToFirstMessageListPaintMs`，保留原 `clickToMessageListPaintMs` 作为最后一次 paint 兼容字段。
- `agentUiPerformanceMetrics.test.ts`：补两次 `messageList.paint` 的回归，确保 first paint 小于等于 final paint，且 final message 指标仍来自最后一次 paint。

已验证：

```bash
npm exec -- vitest run "src/lib/agentUiPerformanceMetrics.test.ts"
npm exec -- vitest run "src/lib/dev-bridge/http-client.test.ts" "src/lib/dev-bridge/safeInvoke.test.ts" "src/lib/dev-bridge/mockPriorityCommands.test.ts" "src/lib/agentUiPerformanceMetrics.test.ts"
npx eslint "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts"
git diff --check -- "src/lib/dev-bridge/http-client.ts" "src/lib/dev-bridge/http-client.test.ts" "src-tauri/src/dev_bridge.rs" "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- AgentUI perf metrics 定向回归：通过，`2` 个测试通过。
- DevBridge + AgentUI metrics 组合回归：通过，`42` 个测试通过。
- ESLint touched metrics files：通过。
- diff 空白检查：通过。

下一步：

1. 后续 Playwright 汇报同时看 `clickToFirstMessageListPaintMs` 与 `clickToMessageListPaintMs`，前者代表用户首屏，后者代表最终稳定 paint。
2. 若首屏仍偶发超过 `500ms`，优先查 sidebar click 期间 long task；若 final paint 慢但首屏快，优先查 hydration 后 MessageList timeline / markdown 懒加载。

### 2026-05-01：P1 第二十七刀，多 tab / 新建 / 两个历史对话复测 multiplex 效果

采集事实：

- 复用现有 Playwright Lime 页签，注入 EventSource 统计后执行：`new-task-1 -> open-history(Slow typing E2E) -> open-history(配置 Lime API Key...) -> new-task-2`。
- 最终活跃 EventSource 数：`1`，最终 URL 为 multiplex `/events?events=[...]`，说明第二十五刀已避免“每个事件一条 SSE 长连接”回流。
- `agent_runtime_get_session(historyLimit=40)` 三次成功耗时约 `670ms / 299ms / 234ms`，invoke trace 无 error。
- `Slow typing E2E`：`clickToFirstMessageListPaintMs≈95ms`、`runtimeGetSessionDurationMs≈235ms`、`longTaskMaxMs≈58ms`。
- 第二个历史会话仍出现一次 `longTaskMaxMs≈228ms`，但不是 DevBridge 连接槽阻塞；下一步应继续看 MessageList / sidebar 渲染主线程负载。

结论：

- 多 tab 与两个历史对话已能打开，不再因为 EventSource 数量导致 `/invoke` 连接槽被占满。
- 剩余体感慢点从“网络/bridge 排队”转向“局部主线程 long task + 后端模型首字”。

### 2026-05-01：P0 第二十八刀，修复新建任务 createSession 失败后的永久创建锁

采集事实：

- Playwright 中复现：DevBridge 曾在 Tauri rebuild 瞬间不可用，第一次 `agent_runtime_create_session` 失败后，用户继续点击发送只反复出现：
  - `AgentChatPage.taskCenter.draftTab.materialize.start`
  - 不再出现 `useAgentSession.createFreshSession.start`
  - invoke trace 为空，textarea 保留原文，页面看起来“点击无效 / 卡住”。
- 源码定位到 `useAgentSession.ts`：`createFreshSessionPromiseRef.current` 保存的是 `trackedCreationPromise`，但 `finally` 中比较的是原始 `creationPromise`，因此无论成功还是失败都不会清空 ref；如果首次失败返回 `null`，后续新建任务会永久复用这个已失败 promise。

已完成：

- `src/components/agent/chat/hooks/useAgentSession.ts`：创建锁释放改为比较当前保存的 `trackedCreationPromise`，确保成功 / 失败后都能清空 `createFreshSessionPromiseRef`。
- `src/components/agent/chat/hooks/useAsterAgentChat.test.tsx`：新增“新建任务失败后应释放创建锁，允许恢复桥接后再次新建”回归；覆盖首次 bridge error、第二次恢复成功。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "新建任务失败后应释放创建锁|从旧会话新建任务时应立即清空当前消息"
npx eslint "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx"
```

结果：

- 定向回归通过：`2` 个测试通过。
- ESLint touched send/session files：通过。

Playwright E2E 复测（刷新后新建任务发送短 prompt）：

- `agent_runtime_create_session`: 成功，`168ms`。
- `AgentStream.listenerBound`: 点击后约 `500ms`。
- `agent_runtime_submit_turn`: 成功，`623ms`。
- `AgentStream.submitAccepted`: 点击后约 `1124ms`。
- `AgentStream.firstEvent/runtime_status`: 点击后约 `1257ms`。
- `AgentStream.firstTextPaint`: 点击后约 `10246ms`，页面最终只输出一次“好”，未复现重复吐字。
- invoke error buffer：空；long task：`0`。

结论：

- “新建任务点击无效 / 不能恢复 / 只能 materialize.start”已修复。
- 前端发送链路在 `~1.1s` 内完成提交和 runtime status；首字剩余 `~9s` 主要落在模型侧首 token，而非按钮、createSession 或 listener 绑定。

### 2026-05-01：P1 第二十九刀，首字路径裁掉默认占位记忆并启用通用紧凑 Prompt

采集事实：

- 首字 E2E 里 `turn_config.system_prompt` 混入默认项目记忆占位：`默认主角 / 待补充角色设定 / 待补充世界观背景与规则 / 第一章：待补充章节内容`。
- 这些占位内容不会帮助回答，但会污染 prompt、增加 token 与模型路由成本。
- 通用对话默认 Browser Assist 全量协议使首轮 system prompt 约 `4.4K` 字符；对“请只回复一个字”这类直接回答任务过重。

已完成：

- `src/lib/workspace/projectPrompt.ts`：过滤默认占位项目记忆；只有角色、世界观、大纲存在真实内容时才注入 `## 项目背景`。
- `src/lib/workspace/projectPrompt.test.ts`：新增占位记忆不注入、真实记忆保留且过滤占位字段的回归。
- `src/components/agent/chat/utils/generalAgentPrompt.ts`：新增 `compact` prompt 变体，保留核心边界、WebSearch / Browser Assist / `lime_site_run` 约束，但移除长篇重复协议。
- `src/components/agent/chat/AgentChatWorkspace.tsx`：通用对话在默认轻量能力态（未开启 webSearch / thinking / task / subagent，且无 contentId）使用 compact prompt；重型能力或工作区上下文继续使用完整 prompt。
- `src/components/agent/chat/utils/generalAgentPrompt.test.ts`：新增 compact prompt 回归，确保体积下降且核心边界保留。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" "src/components/agent/chat/utils/generalAgentPrompt.test.ts" "src/lib/workspace/projectPrompt.test.ts" -t "新建任务失败后应释放创建锁|从旧会话新建任务时应立即清空当前消息|generalAgentPrompt|generateProjectMemoryPrompt"
npm exec -- vitest run "src/components/agent/chat/utils/generalAgentPrompt.test.ts" "src/lib/workspace/projectPrompt.test.ts"
npx eslint "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" "src/components/agent/chat/utils/generalAgentPrompt.ts" "src/components/agent/chat/utils/generalAgentPrompt.test.ts" "src/components/agent/chat/AgentChatWorkspace.tsx" "src/lib/workspace/projectPrompt.ts" "src/lib/workspace/projectPrompt.test.ts"
npm exec -- tsc --noEmit --pretty false --project tsconfig.json --incremental false
git diff --check -- "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" "src/components/agent/chat/utils/generalAgentPrompt.ts" "src/components/agent/chat/utils/generalAgentPrompt.test.ts" "src/components/agent/chat/AgentChatWorkspace.tsx" "src/lib/workspace/projectPrompt.ts" "src/lib/workspace/projectPrompt.test.ts"
```

结果：

- 定向 vitest：通过，`12` 个匹配测试通过。
- prompt / projectPrompt 回归：通过，`10` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit`：通过。
- diff 空白检查：通过。

Playwright E2E 复测：

- 占位记忆过滤后：`systemPromptHasPlaceholderMemory=false`，首次 `firstTextPaint≈4849ms`，`agent_runtime_create_session≈114ms`，`agent_runtime_submit_turn≈569ms`。
- compact prompt 启用后：`systemPromptLength=938`（从约 `4431` 字符降到 `938`），`systemPromptHasPlaceholderMemory=false`。
- compact prompt 同轮：`createSession≈97ms`，`listenerBound≈401ms`，`submitAccepted≈931ms`，`firstEvent≈1096ms`，`firstTextPaint≈5425ms`，long task `0`，invoke error buffer 空。
- 旧会话再复测 `Slow typing E2E`：`clickToFirstMessageListPaintMs≈79ms`，`runtimeGetSessionDurationMs≈298ms`，`clickToSwitchSuccessMs≈1541ms`，long task `0`，invoke error buffer 空。

结论：

- 新建任务前端发送链路已恢复，首屏 runtime status 能在约 `1.1s` 出现。
- 首字真实文本仍受当前 `gpt-5.5` 模型首 token 影响，当前实测约 `4.8-5.4s`；如需继续压到 `2s` 内，下一刀应做“低延迟模型 / DeepSeek 快速模式”与 UI 模型选择的自动化对比，而不是继续在 React 侧盲改。

### 2026-05-01：P1 第三十刀，首字快速响应路由落地

采集事实：

- 上一轮 Playwright 对比显示，前端发送链路已在约 `0.1s` 收到 runtime status，慢点主要在模型首 token。
- `lime-hub / gpt-5.5` 首字约 `4.1s`，`deepseek / deepseek-chat` 首字约 `1.6s`；同样 compact prompt 下均未复现重复吐字。
- 因此本刀不继续盲改 React 渲染，而是在“首轮轻量普通对话”里做可回退、可观测的低延迟模型路由。

已完成：

- `src/components/agent/chat/utils/fastResponseModel.ts`：新增快速响应 resolver。仅当满足以下条件时自动生效：mappedTheme 为 general 的首轮轻量对话、无图片、无 contentId、无 webSearch / thinking / task / subagent、无团队/角色/上下文/技能/显式模型覆盖、当前模型为已知慢首字的 `lime-hub / gpt-5.5|gpt-5.4`，且已配置 DeepSeek provider。
- `src/components/agent/chat/workspace/useWorkspaceSendActions.ts`：发送前注入 `providerOverride=deepseek`、`modelOverride=deepseek-chat`，并把 `harness.fast_response_routing` 写入 metadata，便于后续 E2E 从 turn_config/日志追踪。
- `src/components/agent/chat/hooks/handleSendTypes.ts`：允许 Workspace send options 携带 `assistantDraft`，让快速响应在等待阶段显示“快速响应已启用/处理中”，不是隐式降级。
- `src/components/agent/chat/AgentChatWorkspace.tsx`：仅在空白普通对话且当前为 `lime-hub / gpt-5.5|gpt-5.4` 时预热配置 provider 列表，避免旧会话恢复路径额外争抢 provider 加载。
- `src/components/agent/chat/utils/fastResponseModel.test.ts`、`src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx`：补 resolver 与发送链集成回归。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/utils/fastResponseModel.test.ts"
npm exec -- vitest run "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx" -t "快速响应|普通发送不应把当前工作区模型当成 modelOverride|mappedTheme|自定义模型"
npx eslint "src/components/agent/chat/utils/fastResponseModel.ts" "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/hooks/handleSendTypes.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx" "src/components/agent/chat/AgentChatWorkspace.tsx"
npm exec -- tsc --noEmit --pretty false --project tsconfig.json --incremental false
```

结果：

- 快速响应 resolver 单测：通过，`7` 个测试通过。
- 发送链定向回归：通过，`6` 个匹配测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit`：通过。

下一步：

1. Playwright 复测真实新建对话，确认 `turn_config.provider_preference=deepseek`、`turn_config.model_preference=deepseek-chat`，并重新采集 `listenerBound / submitAccepted / firstEvent / firstTextDelta / firstTextPaint`。
2. 若首字降到约 `1.6s`，保留当前“首轮轻量普通对话”范围；若仍慢，继续从 DevBridge trace 与 provider 返回事件排队排查。
3. 后续再补可配置 UI 开关，把 `lime:agent-fast-response-mode=off` 暴露到设置或模型胶囊菜单。

Playwright E2E 复测：

- 复用现有 Lime 页签，先临时把当前工作区偏好切到 `lime-hub / gpt-5.5` 以触发快速响应，测试后已恢复到原始 `deepseek / deepseek-v4-flash` 偏好。
- 第一次复测发现 DeepSeek provider 的 `custom_models` 只有 `deepseek-v4-pro / deepseek-v4-flash`，按自定义列表选择 `deepseek-v4-flash` 后虽然成功路由，但输出出现“已完成思考 / 我们被要求...”推理说明泄漏，且 `firstTextPaint≈4.6s`，不符合“只输出好”的流式体验。
- 已调整 resolver：DeepSeek 快速响应固定使用非推理 `deepseek-chat`，不跟随自定义 flash/pro 列表，避免 reasoning UI 泄漏与排版回归。
- 最终复测 `turn_config.provider_preference=deepseek`、`turn_config.model_preference=deepseek-chat`，`harness.fast_response_routing` 已写入 metadata。
- 最终复测数据：`agent_runtime_create_session=96ms`，`agent_runtime_submit_turn=396ms`，`listenerBound=12ms`，`submitAccepted=410ms`，`firstEvent=652ms`，`firstRuntimeStatus=653ms`，`firstTextDelta=2962ms`，`firstTextPaint=2962ms`（从 requestStarted 计），脚本侧 click-to-first-paint 约 `4019ms`。
- 可见输出只剩一个“好”，未复现重复吐字；invoke error buffer 为 `0`；测试期间无新增控制台 error，刷新基线仍有 `user.limeai.run /client/skills 401` 鉴权噪音。

结论：

- 快速响应路由已经按真实 turn_config 生效，并规避了 `deepseek-v4-flash` 的思考文本泄漏。
- 首字较 `lime-hub / gpt-5.5` 的 `~5.4s` 有改善到 `~3.0s`（runtime 口径），但未稳定达到早前单独 DeepSeek 测试的 `~1.6s`；下一刀如果继续压首字，优先补“新建空白会话发送前预建 session / 减少 click->listenerBound 约 1s”的数据点，而不是再换模型。

补充验证：

```bash
npm run verify:gui-smoke
```

结果：通过。已复用现有 headless Tauri / DevBridge，覆盖 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface 与页面级 tool surface smoke。

### 2026-05-01：P1 第三十一刀，后端直发事件去重，收敛重复吐字风险

采集事实：

- 流式事件在 `record_runtime_stream_event` 中会对 `text_delta` / `runtime_status` 等低延迟事件先直发给前端。
- 同一事件随后又会从 `stream_reply_once` 的统一 `app.emit` 路径再次发送，形成同一 `text_delta` 被前端处理两次的高风险路径。
- `ItemStarted / ItemUpdated / ItemCompleted` 已由 `AgentTimelineRecorder` 持久化并发出等价 item 事件，也不应再由统一 emit 重复补发。
- `Warning / Error / ArtifactSnapshot / ContextCompaction*` 会投影为不同 item 或保留原始语义，不能粗暴吞掉原始事件。

已完成：

- `src-tauri/src/commands/aster_agent_cmd/reply_runtime.rs`：`stream_reply_once` 的 `on_event` 回调改为返回 `bool`，表示当前事件是否已由更低层发送；已发送时跳过统一 `app.emit`。
- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`：`record_runtime_stream_event` 返回已发送状态；直接直发事件返回 `true`，timeline-owned item 事件在 recorder 成功后也返回 `true`。
- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`：新增 `timeline_recorder_emits_equivalent_runtime_event`，只对 runtime item 三类事件去重；warning/error/artifact 等继续保留原始 emit。
- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`：补充 warning 场景回归，防止把 timeline item 投影和原始 warning 语义混为一类。

已验证：

```bash
rustfmt --edition 2021 --check "src-tauri/src/commands/aster_agent_cmd/reply_runtime.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs"
npm exec -- vitest run "src/components/agent/chat/hooks/agentChatHistory.test.ts" -t "重复吐字|累计快照"
cargo test --manifest-path "src-tauri/Cargo.toml" -p lime runtime_stream_ --no-fail-fast
```

结果：

- Rust touched files 格式检查：通过。
- 前端重复吐字/累计快照回归：通过，`2` 个匹配测试通过。
- Rust runtime stream 定向测试：通过，`4` 个匹配测试通过；`1131` 个过滤。

结论：

- 后端低延迟直发事件不再被统一 emit 二次发送，重复吐字主风险路径已收敛。
- 保留 warning/error/artifact 原始语义，不因去重破坏前端错误、告警或 artifact 处理。

### 2026-05-01：P1 第三十二刀，快速响应专用短 Prompt 与真实 E2E 复测

采集事实：

- 后端去重后，真实 E2E 新建对话输出只出现一次“好”，未再复现重复吐字。
- 同一轮采集显示前端链路已很快：`listenerBound≈121ms`、`submitAccepted≈253ms`、`firstRuntimeStatus≈287ms`。
- 首字仍慢在模型首 token：快速响应路由命中 `deepseek / deepseek-chat` 后，普通 compact prompt 下 `firstTextPaint≈4665ms`。
- 该请求仍携带通用 compact prompt、Browser Assist 协议和 harness 说明；对“只回答一个字”这类轻量首轮对话仍偏重。

已完成：

- `src/components/agent/chat/utils/fastResponseModel.ts`：新增 `buildAgentFastResponseSystemPrompt`，为快速响应路由生成约 `163` 字符的短系统提示词，强调直接回答、严格遵守单字/格式要求、不输出思维链、不主动联网/工具/落盘。
- `src/components/agent/chat/hooks/agentChatShared.ts`、`src/components/agent/chat/hooks/handleSendTypes.ts`、`src/components/agent/chat/hooks/agentStreamUserInputSendPreparation.ts`：新增单次发送级 `systemPromptOverride`，避免把全局通用 prompt 改短，保证只影响快速响应命中的轻量首轮。
- `src/components/agent/chat/workspace/useWorkspaceSendActions.ts`：快速响应命中时同时注入 `providerOverride`、`modelOverride`、`harness.fast_response_routing`、assistant draft 和短 prompt override。
- `src/components/agent/chat/utils/fastResponseModel.test.ts`、`src/components/agent/chat/hooks/agentStreamUserInputSendPreparation.test.ts`、`src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx`：补齐短 prompt、单次 prompt override、发送链注入回归。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/hooks/agentStreamUserInputSendPreparation.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx"
npx eslint "src/components/agent/chat/utils/fastResponseModel.ts" "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/hooks/agentChatShared.ts" "src/components/agent/chat/hooks/handleSendTypes.ts" "src/components/agent/chat/hooks/agentStreamUserInputSendPreparation.ts" "src/components/agent/chat/hooks/agentStreamUserInputSendPreparation.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx"
npm exec -- tsc --noEmit --pretty false --project tsconfig.json --incremental false
git diff --check -- "src/components/agent/chat/utils/fastResponseModel.ts" "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/hooks/agentChatShared.ts" "src/components/agent/chat/hooks/handleSendTypes.ts" "src/components/agent/chat/hooks/agentStreamUserInputSendPreparation.ts" "src/components/agent/chat/hooks/agentStreamUserInputSendPreparation.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx" "src-tauri/src/commands/aster_agent_cmd/reply_runtime.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs"
npm run bridge:health -- --timeout-ms 120000
npm run verify:gui-smoke
```

结果：

- 定向 vitest：通过，`134` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit`：通过。
- diff 空白检查：通过。
- DevBridge 健康检查：通过，`72ms` 就绪。
- GUI smoke：通过，覆盖 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface 与页面级 tool surface。

Playwright E2E 复测：

- 复用现有 `http://127.0.0.1:1420/` Lime 页签，设置 `lime:agent-debug=1`、`lime:agent-fast-response-mode=auto`、`lime:onboarding-completed=true`。
- 新建首轮轻量对话，输入 `只回答一个字：好 <timestamp>`。
- 网络请求确认 `turn_config.provider_preference=deepseek`、`turn_config.model_preference=deepseek-chat`。
- 网络请求确认 `turn_config.system_prompt` 已切为快速响应短 prompt，内容以“你是 Lime 的快速响应助手”开头，不再携带 Browser Assist 长协议。
- 采集结果：`listenerBound≈7ms`、`submitAccepted≈215ms`、`firstEvent≈336ms`、`firstRuntimeStatus≈337ms`、`firstTextDelta≈3645ms`、`firstTextPaint≈3646ms`。
- 可见输出只出现一次“好”；`textRenderFlush` 仅一次，`accumulatedChars=1`、`backlogChars=1`。
- 控制台 error/warning：本轮复测后 `0`。

结论：

- 重复吐字风险已从后端 emit 层和前端累计文本层双向验证。
- 快速响应短 prompt 把同环境首字从 `~4.7s` 压到 `~3.6s`，前端提交链路稳定在 `~0.3s` 内，剩余主要是 DeepSeek provider 首 token 波动。
- 下一步若继续追 `2s` 内首字，不应再盲改 React；优先做 provider/model A/B（例如可控地评估非推理低延迟模型）和“首 token 到达前的可感知 UI”优化。

### 2026-05-01：P1 第三十三刀，DeepSeek 推理模型首轮降级与 E2E 反证

采集事实：

- 复用现有 `http://127.0.0.1:1420/` Lime 页签，刷新后控制台基线为 `0` error / `0` warning。
- 连续 4 轮新建首轮轻量对话（`只回答一个字：好 E2E-*`）显示前端链路仍快：`listenerBound=33-56ms`、`submitAccepted=160-298ms`、`firstRuntimeStatus=196-352ms`、`firstTextPaint=1581-4073ms`。
- 但当当前模型是 `deepseek-v4-flash` 时，快速响应短 prompt 没有命中，真实请求仍为 `provider=deepseek`、`model=deepseek-v4-flash`、通用长 prompt。
- 该路径复现了用户反馈的排版/吐字问题：可见“已完成思考 / 我们被要求...”推理文本，且 1 轮输出成 `好 E2E-*`，没有严格遵守单字输出。
- 补丁首版后再次测到当前模型变为 `deepseek-reasoner` 时，仍未命中快速响应；原因是页面只在 `lime-hub / gpt-5.x` 预加载快速响应 Provider，DeepSeek 当前 Provider 场景会因为 Provider 列表尚未加载而走 `fast-provider-unavailable`。

已完成：

- `src/components/agent/chat/utils/fastResponseModel.ts`：把快速响应触发条件从“只识别 lime-hub 慢首字模型”扩展为“lime-hub gpt-5.x 或 DeepSeek 推理/flash/pro/r1 类模型”。
- `src/components/agent/chat/utils/fastResponseModel.ts`：当前 Provider 已经是 DeepSeek 时，不再依赖 Provider 列表预加载；直接使用当前 `providerType` 作为本轮 `providerOverride`，并把模型降级到非推理 `deepseek-chat`。
- `src/components/agent/chat/AgentChatWorkspace.tsx`：Provider 预加载条件改为复用同一个快速响应候选判断，避免 UI 层与发送层判断漂移。
- `src/components/agent/chat/utils/fastResponseModel.test.ts`：新增 DeepSeek `deepseek-v4-flash`、`deepseek-reasoner` 与无需 Provider 列表的降级回归。
- `src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx`：新增发送链回归，覆盖 DeepSeek 推理模型不等待 Provider 列表也能注入 `providerOverride=deepseek`、`modelOverride=deepseek-chat` 和快速响应短 prompt。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx"
npx eslint "src/components/agent/chat/utils/fastResponseModel.ts" "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx"
git diff --check -- "src/components/agent/chat/utils/fastResponseModel.ts" "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx"
```

结果：

- 定向 vitest：通过，`133` 个测试通过。
- ESLint touched files：通过。
- diff 空白检查：通过。

补充验证：

```bash
npm exec -- vitest run "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx"
npx eslint "src/components/agent/chat/utils/fastResponseModel.ts" "src/components/agent/chat/utils/fastResponseModel.test.ts" "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx"
npm exec -- tsc --noEmit --pretty false --project tsconfig.json --incremental false
npm run bridge:health -- --timeout-ms 120000
npm run verify:gui-smoke
npm run verify:local
```

结果：

- 定向 vitest：通过，`133` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit`：通过。
- DevBridge 健康检查：通过，首轮约 `26ms`，后续约 `2ms`。
- GUI smoke：通过，覆盖 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface 与页面级 tool surface。
- 完整 `npm run verify:local`：通过；包含 app version、lint、typecheck、vitest smart、contracts、Rust cargo test 与 GUI smoke。既有 warning 未阻塞：`runtime_evidence_pack_service.rs` unused imports、`modality_runtime_contracts.rs` dead_code、update 测试里的 signature mismatch / 404 diagnostic 文案。

Playwright E2E 修复后复测：

- 复用现有 `http://127.0.0.1:1420/` Lime 页签，设置 `lime:agent-debug=1`、`lime:agent-fast-response-mode=auto`、`lime:onboarding-completed=true`。
- 当前 UI 仍显示 `deepseek-v4-flash` 属于预期；本轮只做单次发送降级，不修改全局模型选择。
- 连续 2 轮输入 `只回答一个字：好 E2E-DEEPSEEK-DOWNGRADE-*`，请求体均确认 `turn_config.provider_preference=deepseek`、`turn_config.model_preference=deepseek-chat`。
- 请求体均确认 `turn_config.system_prompt` 已切为快速响应短 prompt，开头为“你是 Lime 的快速响应助手”；`harness.fast_response_routing` 已写入 metadata。
- Run 1：`listenerBound=24ms`、`submitAccepted=130ms`、`firstEvent=151ms`、`firstRuntimeStatus=151ms`、`firstTextDelta=1656ms`、`firstTextPaint=1657ms`、`flushCount=1`。
- Run 2：`listenerBound=16ms`、`submitAccepted=95ms`、`firstEvent=114ms`、`firstRuntimeStatus=114ms`、`firstTextDelta=829ms`、`firstTextPaint=830ms`、`flushCount=1`。
- 两轮可见输出都只包含“好”，未出现“已完成思考 / 我们被 / 推理”等思考文本或 marker 回显；控制台 error/warning 为 `0`。

结论：

- DeepSeek 推理/Flash 模型轻量首轮现在会自动走单次发送降级：`deepseek-v4-flash|reasoner -> deepseek-chat`，同时套用短 prompt。
- 真实 E2E 已证明修复后不再泄漏思考文本、不再重复吐字，首字从此前 `1.5-5s` 波动收敛到 `0.83s / 1.66s` 两轮。
- 完整 `npm run verify:local` 已通过，本刀达到 GUI 主路径可交付门槛。
- 下一刀继续压旧会话恢复卡顿：优先采集会话打开 CPU/内存峰值与 `MessageList` timeline 主线程计算，不再在本刀内扩大快速响应逻辑范围。

### 2026-05-01：P1 第三十四刀，旧会话 MessageList 同步计算细分采集

采集事实：

- 第三十三刀后，首字快速响应主链已收口；剩余用户体感慢点回到旧会话打开后的 CPU / 内存峰值与局部主线程 long task。
- 现有 `agentUiPerformanceMetrics` 已能看到 `clickToFirstMessageListPaintMs`、`longTaskMaxMs`、JS heap 与是否延后 timeline / Markdown，但还不能区分 MessageList 内部是 `threadItems` 扫描、timeline 构建、消息分组还是 render group 拼装在耗时。
- DevBridge 当前未就绪：`npm run bridge:health -- --timeout-ms 120000` 超时，`3030` 未监听；本机同时有 Tauri/Rust watch 编译链高 CPU，真实 Playwright 采样会被污染，本刀先补内建细分采集，不扩大 UI 行为。

已完成：

- `src/components/agent/chat/components/MessageList.tsx`：新增 `measureMessageListComputation`，在不引入渲染副作用的前提下记录同步计算耗时。
- `MessageList` 旧会话 metric context 新增：
  - `messageListThreadItemsScanMs`
  - `messageListTimelineBuildMs`
  - `messageListGroupBuildMs`
  - `messageListRenderGroupsMs`
  - `messageListHistoricalMarkdownTargetScanMs`
  - `messageListHistoricalContentPartsScanMs`
  - `messageListComputeMs`
- `src/lib/agentUiPerformanceMetrics.ts`：summary 新增对应 max 字段，Playwright 可直接通过 `window.__LIME_AGENTUI_PERF__.summary()` 判断下一刀该打哪个热点，而不是只看 long task 总值。
- `src/components/agent/chat/components/MessageList.test.tsx`、`src/lib/agentUiPerformanceMetrics.test.ts`：补旧会话 commit metric 与 summary 聚合回归。

已验证：

```bash
npm exec -- vitest run "src/lib/agentUiPerformanceMetrics.test.ts" "src/components/agent/chat/components/MessageList.test.tsx" -t "agentUiPerformanceMetrics|旧会话首帧应延后历史助手 contentParts"
npm exec -- vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "旧会话|已分页旧会话|历史"
npx eslint "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" --max-warnings 0
git diff --check -- "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- 定向性能汇总与旧会话 contentParts 回归：通过，`3` 个测试通过。
- MessageList 旧会话 / 已分页旧会话 / 历史回归：通过，`15` 个测试通过。
- ESLint touched files：通过。
- diff 空白检查：通过。

暂未完成验证：

- TypeScript 全量 `tsc --noEmit`：已启动但超过数分钟无输出；本机同时存在多路 `rustc` / Tauri watch 编译高 CPU，为避免继续污染用户反馈的 CPU 飙高场景，已停止本轮发起的 typecheck。上一刀完整 `npm run verify:local` 已通过；本刀后续在 DevBridge 稳定时补一次统一验证。
- Playwright 旧会话真实采样：当前 DevBridge `3030` 未就绪，不能给出可信 E2E 数值。

下一步：

1. 等 DevBridge 恢复后，用 Playwright 连续打开 2-3 个旧会话，读取 `window.__LIME_AGENTUI_PERF__.summary()` 中新增的 MessageList 细分 max 字段。
2. 若 `messageListTimelineBuildMaxMs` 或 `messageListThreadItemsScanMaxMs` 占主因，再继续把 timeline 构建移动到展开后或 Worker；若 `messageListRenderGroupsMaxMs` 占主因，优先看历史消息窗口和 DOM 虚拟化。
3. 若细分项都低但 `longTaskMaxMs / maxUsedJSHeapSize` 仍高，下一刀转向常驻 sidebar/tab DOM 数量和 DevBridge/Rust watch 环境干扰，而不是继续改 MessageList。

### 2026-05-01：P1 第三十五刀，首页回车首帧会话壳去阻塞

采集事实：

- 复用现有 `http://127.0.0.1:1420/` Lime 页签，不新启违规 Playwright 浏览器。
- 修复前在 DevBridge 未就绪场景下复现：输入后按 Enter，`homeInputToPendingShellMs=11ms` 只是状态已入队，真实用户输入文本约 `1331ms` 才可见；同一请求出现 `542ms / 556ms` long task，`homeInputToSendDispatchMs=458ms`，体感会出现鼠标 busy。
- 复现时还看到输入框内容变化后会触发空白首页后台 `ensureSession()` 预热；这会在用户尚未发送时就创建/恢复会话，容易和 Enter 后的发送链路、侧边栏 list、DevBridge invoke 抢主线程与桥接通道。

已完成：

- `src/components/agent/chat/AgentChatWorkspace.tsx`：移除空白首页输入后的自动 `ensureSession()` 预热；输入文字不再提前创建会话，避免未发送就触发 CPU / 内存峰值与空会话副作用。
- `src/components/agent/chat/AgentChatWorkspace.tsx`：首页首发改为先写入轻量 `homePendingPreviewMessages`，立即渲染用户消息 + “正在进入对话”助手占位；真实 `handleSend` 延后到下一次 paint 后再派发。
- `src/components/agent/chat/AgentChatWorkspace.tsx`：非草稿首页首发、以及已为空的草稿发送，不再调用重型 `clearMessages()`，避免在空白态重复 `applySessionSnapshot`、清 transient storage 与 reset streaming refs。
- `src/lib/agentUiPerformanceMetrics.ts`：新增 `homeInput.pendingPreviewPaint` 与 `homeInputToPendingPreviewPaintMs`，Playwright 可直接区分“状态入队”与“用户可见预览已绘制”。
- `src/components/agent/chat/index.test.tsx`：把旧的“输入即后台预热会话”回归改为“不应后台创建会话”，并新增“发送后立即展示轻量对话预览”回归。

Playwright E2E 修复后复测：

- 输入后停留 `500ms`，`window.__LIME_AGENTUI_PERF__.entries()` 仍为空，证明单纯输入不再触发会话创建/发送相关预热。
- 按 Enter 后：`homeInputToPendingShellMs=0ms`、`homeInputToPendingPreviewPaintMs=63ms`、`homeInputToSendDispatchMs=64ms`。
- 用户输入文本可见约 `110ms`；首页空态已退出，进入对话流预览。
- 本轮请求 `longTaskMaxMs` 从修复前约 `556ms` 降到 `59ms`；同页 heap 未再出现 Enter 后瞬时大幅攀升。
- 真实后端随后继续处理；本刀目标是“毫秒级先到达对话页面/壳”，不改变后端首 token 质量链。

已验证：

```bash
npx eslint "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/index.test.tsx" "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" --max-warnings 0
npm exec -- vitest run "src/lib/agentUiPerformanceMetrics.test.ts" "src/components/agent/chat/index.test.tsx" -t "首页输入|空白新建任务|草稿标签输入后应预热创建会话" --hookTimeout 180000 --testTimeout 120000
npm run typecheck -- --pretty false
npm run bridge:health -- --timeout-ms 120000
npm run verify:gui-smoke
git diff --check -- "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/index.test.tsx" "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- ESLint touched files：通过。
- 定向 vitest：通过，`7` 个测试通过，`101` 个测试按过滤条件跳过。
- TypeScript `tsc --noEmit`：通过。
- DevBridge 健康检查：通过，`1710ms` 就绪。
- GUI smoke：通过，覆盖 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface 与页面级 tool surface。
- diff 空白检查：通过。

下一步：

1. 若仍觉得 Enter 后模型首字慢，继续看 `AgentStream.firstTextDelta / firstTextPaint`，不要再把“先进入对话页”与“后端首 token”混成同一个问题。
2. 若首页打开后内存基线仍高，下一刀应从常驻 tab/sidebar DOM、历史对话列表与 keep-alive 页面裁剪入手。

### 2026-05-01：P1 第三十六刀，首页首发流式首字链路拆段与跳过旧会话恢复

采集事实：

- 复用现有 `http://127.0.0.1:1420/` Lime 页签，不新启违规 Playwright 浏览器；先清空 `window.__LIME_AGENTUI_PERF__`，再从首页输入框发起真实首轮请求。
- 复测样本 1：`homeInputToPendingPreviewPaintMs=49ms`、`homeInputToSubmitAcceptedMs=303ms`、`homeInputToFirstEventMs=331ms`、`homeInputToFirstTextPaintMs=2040ms`、`streamEnsureSessionDurationMs=91ms`、`streamSubmitInvokeDurationMs=119ms`、`firstEventToFirstTextDeltaMs=1674ms`、`longTaskCount=0`。
- 复测样本 2：`homeInputToPendingPreviewPaintMs=17ms`、`homeInputToSubmitAcceptedMs=176ms`、`homeInputToFirstEventMs=199ms`、`homeInputToFirstTextPaintMs=2100ms`、`streamEnsureSessionDurationMs=35ms`、`streamSubmitInvokeDurationMs=86ms`、`firstEventToFirstTextDeltaMs=1879ms`、`longTaskCount=0`。
- 结论：当前前端从 Enter 到会话壳 / 状态事件已经稳定在几十到两百毫秒；仍然约 `1.7-1.9s` 的等待主要发生在后端/Provider 从首个 `runtime_status` 到首个 `text_delta` 的阶段，不再是首页切壳、MessageList 或主线程 long task。

已完成：

- `src/components/agent/chat/hooks/agentStreamPerformanceMetrics.ts`：新增首页首发 trace 元数据，允许后续 stream 阶段继续按草稿请求维度汇总，而不是被真实 sessionId 打散。
- `src/components/agent/chat/AgentChatWorkspace.tsx`：首页首发派发时写入 trace，并设置 `skipSessionRestore: true`；新对话首发不再先恢复上一次会话，避免误入旧会话 hydration 与历史消息拉取。
- `src/components/agent/chat/hooks/useAgentSession.ts` 与 stream 发送链路：`ensureSession` 支持按请求跳过 restore candidate；普通恢复路径不变，仅首页新对话首发显式走创建新会话。
- `src/components/agent/chat/hooks/agentStreamSubmitContext.ts`、`agentStreamSubmitExecution.ts`、`agentStreamTurnEventBinding.ts`、`agentStreamRuntimeHandler.ts`：新增 `agentStream.ensureSession.*`、`request.start`、`listenerBound`、`submitDispatched`、`submitAccepted`、`firstEvent`、`firstRuntimeStatus`、`firstTextDelta`、`firstTextRenderFlush`、`firstTextPaint` 采集。
- `src/lib/agentUiPerformanceMetrics.ts`：summary 新增 `homeInputToFirstEventMs`、`homeInputToFirstRuntimeStatusMs`、`homeInputToFirstTextDeltaMs`、`homeInputToFirstTextPaintMs`、`streamEnsureSessionDurationMs`、`streamSubmitInvokeDurationMs` 等字段，Playwright 可直接读出前端、桥接、后端首 token 分段。

已验证：

```bash
npx eslint "src/components/agent/chat/AgentChatWorkspace.tsx" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.ts" "src/components/agent/chat/hooks/agentStreamPreparedSendEnv.ts" "src/components/agent/chat/hooks/useAgentStream.ts" "src/components/agent/chat/hooks/agentStreamUserInputSendPreparation.ts" "src/components/agent/chat/hooks/agentStreamUserInputSubmission.ts" "src/components/agent/chat/hooks/agentStreamSubmissionLifecycle.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/agent/chat/hooks/handleSendTypes.ts" "src/components/agent/chat/hooks/agentChatShared.ts" "src/lib/agentUiPerformanceMetrics.ts" "src/lib/agentUiPerformanceMetrics.test.ts" --max-warnings 0
npm run typecheck -- --pretty false
npm exec -- vitest run "src/lib/agentUiPerformanceMetrics.test.ts" "src/components/agent/chat/index.test.tsx" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "agentUiPerformanceMetrics|空白新建任务|首页输入|sendMessage 后在首个流事件前应先注入本地回合占位" --hookTimeout 180000 --testTimeout 120000
npm run bridge:health -- --timeout-ms 120000
npm run verify:gui-smoke
```

结果：

- ESLint touched files：通过。
- TypeScript `tsc --noEmit`：通过。
- 定向 vitest：通过，`9` 个测试通过。
- DevBridge 健康检查：通过，`21ms` 就绪。
- GUI smoke：通过，覆盖 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface 与页面级 tool surface。
- Playwright 真实 GUI：两次首页新建对话首发均可快速进入对话壳；控制台 error 为 `0`；本轮链路没有 long task。

下一步：

1. 若要继续压缩真实首字，需要转向后端 runtime/provider：记录 submitOp 到 provider request、provider first byte、provider first text delta 的服务端分段。
2. 前端侧可继续做感知优化：把 `firstEventToFirstTextDeltaMs > 1000` 时的运行态文案改成更明确的“模型正在生成首字”，但不要伪造模型文本。
3. 若同一页面连续打开多个标签后仍卡顿，下一刀回到 tab/sidebar keep-alive DOM 裁剪与历史标签卸载策略。

### 2026-05-05：P3 前置，AgentUI 对话投影计划落库

已完成：

- 新增 [conversation-projection-architecture.md](../roadmap/agentui/conversation-projection-architecture.md)，声明对话层只做 UI projection，不新增 runtime / artifact / evidence 事实源。
- 新增 [conversation-projection-implementation-plan.md](../roadmap/agentui/conversation-projection-implementation-plan.md)，把后续结构瘦身拆成：
  - Phase 0：对话事实源盘点
  - Phase 1：Projection Store 边界
  - Phase 2：Session lifecycle / hydration 拆分
  - Phase 3：Stream submission / queue / event reducer 拆分
  - Phase 4：Message render projection
  - Phase 5：Workspace shell 瘦身
  - Phase 6：性能与治理守卫
- 新增 [conversation-projection-acceptance.md](../roadmap/agentui/conversation-projection-acceptance.md)，固定首页输入、新建对话、打开两个历史会话、大历史 MessageList、流式输出、Artifact 恢复的验收场景。
- 更新 [AgentUI README](../roadmap/agentui/README.md) 和 [AgentUI 实施路线图](../roadmap/agentui/lime-agentui-implementation-roadmap.md)，把 projection plan 纳入 current planning source。

主线收益：

- 后续不再以“继续拆大文件”作为默认目标，而是按 `fact source -> projection store -> controllers -> selectors -> UI` 收敛。
- P0/P1 已做的性能采集可以继续用于 Phase 2 / Phase 4 验收，避免架构瘦身和性能排查脱节。
- 与 `docs/roadmap/warp` 对齐，避免 AgentUI 再长出第二套 runtime / artifact / evidence 事实源。

下一刀：

1. 执行 Phase 0，对 `sessionId/threadId/turnId/taskId`、`messages/threadItems/threadTurns`、`thread_read`、`queuedTurns/pendingActions`、`artifact_snapshot`、`sessionHistoryWindow`、stream trace、MessageList render window 建 fact map。
2. 从低风险 slice 开始 Phase 1，优先选择 `stream diagnostics` 或 `message render window` 接入最小 Projection Store。
3. 补 selector 测试，证明无关切片更新不会触发 MessageList / Workspace 重渲染。

### 2026-05-05：P3 第一刀，Phase 0 fact map 与最小 Projection Store

已完成：

- 新增 [conversation-projection-fact-map.md](../roadmap/agentui/conversation-projection-fact-map.md)，把对话状态按 runtime identity、session/history、messages/thread projection、stream/queue/actions、artifact/evidence 分组，标明 owner、writer、readers、persistence、runtime fact source、projection-only 与 `current` 分类。
- 新增 `src/components/agent/chat/projection/conversationProjectionStore.ts`：
  - 定义 `Conversation Projection Store` 的最小 state shape。
  - 先落 `diagnostics.streamDiagnostics` slice。
  - 保留 `session / stream / queue / render` slice 占位，但只保存版本，不写 runtime 事实。
  - 提供 `selectConversationStreamDiagnostics` 与 `selectLatestConversationStreamDiagnostic` selector。
- `recordAgentStreamPerformanceMetric` 同步写入原有 `agentUiPerformanceMetrics` 与新的 projection store。
- 新增 projection store 与 stream diagnostics 回归，证明 diagnostics 更新不会改变其它 slice 引用。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/projection/conversationProjectionStore.test.ts" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitDraft.test.ts"
npx eslint "src/components/agent/chat/projection/conversationProjectionStore.ts" "src/components/agent/chat/projection/conversationProjectionStore.test.ts" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.ts" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.test.ts" --max-warnings 0
git diff --check -- "docs/roadmap/agentui/conversation-projection-fact-map.md" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/roadmap/agentui/README.md" "docs/exec-plans/agentui-implementation-progress.md" "src/components/agent/chat/projection/conversationProjectionStore.ts" "src/components/agent/chat/projection/conversationProjectionStore.test.ts" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.ts" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.test.ts"
rg "conversation-projection-fact-map|conversationProjectionStore|recordConversationStreamDiagnostic|selectLatestConversationStreamDiagnostic" "docs" "src/components/agent/chat"
```

结果：

- Projection Store / stream diagnostics 定向回归：通过，`9` 个测试通过。
- ESLint touched files：通过。
- diff 空白检查：通过。
- 引用检查：通过。

暂未完成验证：

- TypeScript 全量 `npm run typecheck -- --pretty false` 本轮运行超过约 1 分钟仍无输出；为避免继续占用本机 CPU，已停止本轮发起的 `tsc --noEmit --pretty false` 进程。新增代码为窄边界 TS 文件，已由定向 vitest 与 ESLint 覆盖；下一轮接入 `messageRenderWindow` 前补跑统一 typecheck。

主线收益：

- Phase 0 不再只是计划，已有可维护的 fact map。
- Phase 1 有了第一个低风险 current slice，后续可按同一模式迁 `messageRenderWindow`。
- 当前实现只新增 UI projection，不新增 Tauri command、不改 runtime event、不改 artifact/evidence 事实源。

下一刀：

1. 用现有 E2E 性能指标确认 MessageList 是否仍是热点。
2. 若热点成立，接入 Phase 4 的最小 `messageRenderWindow` selector，而不是继续让 `MessageList` 内部同步推导窗口。
3. 若热点转向后端首字，则先补 runtime/provider 服务端分段，不扩大前端 projection。

### 2026-05-05：P3 第二刀，MessageList render window 投影外移

已完成：

- 新增 `src/components/agent/chat/projection/messageRenderWindowProjection.ts`：
  - `filterVisibleConversationMessages`
  - `resolveConversationMessageRenderWindowSettings`
  - `resolveInitialConversationRenderedMessageCount`
  - `buildConversationMessageRenderWindowProjection`
- `MessageList.tsx` 改为消费 `messageRenderWindowProjection` 输出的：
  - `visibleMessages`
  - `renderedMessages`
  - `hiddenHistoryCount`
  - `shouldAutoHydrateHiddenHistory`
  - 渐进渲染阈值、首帧数量、批量数量与 idle delay
- 新增 `messageRenderWindowProjection.test.ts` 覆盖：
  - 空白 user 消息过滤
  - 普通会话尾部窗口
  - 旧会话更小首帧与禁止自动补齐
  - 发送中不裁剪

主线收益：

- `MessageList` 不再直接散落“可见消息过滤 + 渐进渲染窗口 + 旧会话隐藏历史”推导，后续可以继续把 `renderedTurns / renderedThreadItems / timelineByMessageId` 外移。
- 这是 Phase 4 的最小入口，不改变 runtime event、session detail、artifact/evidence 事实源，也不引入第二套 message 数据源。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/projection/messageRenderWindowProjection.test.ts" "src/components/agent/chat/projection/conversationProjectionStore.test.ts" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.test.ts" "src/components/agent/chat/components/MessageList.test.tsx" -t "messageRenderWindowProjection|conversationProjectionStore|agentStreamPerformanceMetrics|旧会话首帧|已分页旧会话|历史"
npx eslint "src/components/agent/chat/projection/conversationProjectionStore.ts" "src/components/agent/chat/projection/conversationProjectionStore.test.ts" "src/components/agent/chat/projection/messageRenderWindowProjection.ts" "src/components/agent/chat/projection/messageRenderWindowProjection.test.ts" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.ts" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.test.ts" "src/components/agent/chat/components/MessageList.tsx" --max-warnings 0
git diff --check -- "src/components/agent/chat/projection" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.ts" "src/components/agent/chat/hooks/agentStreamPerformanceMetrics.test.ts" "src/components/agent/chat/components/MessageList.tsx" "docs/roadmap/agentui" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Projection / MessageList 定向回归：通过，`19` 个测试通过。
- ESLint touched files：通过。
- diff 空白检查：通过。
- 完整 MessageList 回归：通过，`97` 个测试通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

下一刀：

1. 补跑完整 `MessageList.test.tsx` 与 TypeScript。
2. 如果通过，继续把 `renderedTurns / renderedThreadItems` 提取为 `threadTimelineWindowProjection`，并用 `messageListThreadItemsScanMs` / `messageListTimelineBuildMs` 判断收益。
3. 如果 TypeScript 或完整 MessageList 回归暴露旧行为差异，先修 projection selector，不继续扩展。

### 2026-05-05：P3 第三刀，Thread timeline window 投影外移

已完成：

- 新增 `src/components/agent/chat/projection/threadTimelineWindowProjection.ts`：
  - `resolveConversationRenderedTurns`
  - `resolveConversationRenderedTurnIdSet`
  - `filterConversationThreadItemsForRenderedTurns`
  - `buildConversationThreadTimelineWindowProjection`
- `MessageList.tsx` 改为从 projection 层获取：
  - `renderedTurns`
  - `renderedTurnIdSet`
  - `renderedThreadItems`
- 新增 `threadTimelineWindowProjection.test.ts` 覆盖：
  - 无隐藏历史时保留全部 turns / threadItems
  - 旧会话按可见 assistant 数裁剪尾部 turns
  - 当前 turn 不在尾部窗口时额外保留
  - 按 rendered turn 精确裁剪 threadItems
  - 延迟扫描时返回空 threadItems

主线收益：

- `MessageList` 的旧会话历史窗口逻辑进一步收敛到 projection 层。
- 后续可以继续把 `timelineByMessageId / messageGroups / renderGroups` 外移，并用现有 `messageListTimelineBuildMs / messageListRenderGroupsMs` 指标判断是否值得 worker 化。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/projection/threadTimelineWindowProjection.test.ts" "src/components/agent/chat/projection/messageRenderWindowProjection.test.ts" "src/components/agent/chat/components/MessageList.test.tsx"
npx eslint "src/components/agent/chat/projection/threadTimelineWindowProjection.ts" "src/components/agent/chat/projection/threadTimelineWindowProjection.test.ts" "src/components/agent/chat/projection/messageRenderWindowProjection.ts" "src/components/agent/chat/projection/messageRenderWindowProjection.test.ts" "src/components/agent/chat/components/MessageList.tsx" --max-warnings 0
git diff --check -- "src/components/agent/chat/projection" "src/components/agent/chat/components/MessageList.tsx"
```

结果：

- Thread / Message render projection + MessageList 回归：通过，`102` 个测试通过。
- ESLint touched files：通过。
- diff 空白检查：通过。

下一刀：

1. 补跑 TypeScript。
2. 继续外移 `timelineByMessageId / messageGroups / renderGroups` 为 `messageTimelineRenderProjection`。
3. 再评估是否需要把 `buildMessageTurnTimeline` 移入 idle / worker。

### 2026-05-05：P3 第四刀，Message timeline render 投影外移

已完成：

- 新增 `src/components/agent/chat/projection/messageTimelineRenderProjection.ts`：
  - `buildTimelineByMessageIdProjection`
  - `resolveLastAssistantMessage`
  - `buildCurrentTurnTimelineProjection`
  - `buildMessageGroupsProjection`
  - `buildMessageRenderGroupsProjection`
- `MessageList.tsx` 改为从 projection 层获取：
  - `timelineByMessageId`
  - `lastAssistantMessage`
  - `currentTurnTimeline`
  - `messageGroups`
  - `renderGroups`
- 保留原有 `measureMessageListComputation` 分段，`messageListTimelineBuildMs / messageListRenderGroupsMs` 等指标仍可用于判断下一刀是否需要 worker 化。

主线收益：

- `MessageList` 中“数据投影”和“React 渲染”边界更清晰。
- Phase 4 的主要同步投影已形成独立纯函数层，后续性能优化可以优先移动 projection，而不是继续在组件内部堆判断。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/projection/messageTimelineRenderProjection.test.ts" "src/components/agent/chat/projection/threadTimelineWindowProjection.test.ts" "src/components/agent/chat/components/MessageList.test.tsx"
npx eslint "src/components/agent/chat/projection/messageTimelineRenderProjection.ts" "src/components/agent/chat/projection/messageTimelineRenderProjection.test.ts" "src/components/agent/chat/projection/threadTimelineWindowProjection.ts" "src/components/agent/chat/projection/threadTimelineWindowProjection.test.ts" "src/components/agent/chat/components/MessageList.tsx" --max-warnings 0
git diff --check -- "src/components/agent/chat/projection" "src/components/agent/chat/components/MessageList.tsx"
```

结果：

- Message timeline projection / thread window projection / MessageList 回归：通过，`102` 个测试通过。
- ESLint touched files：通过。
- diff 空白检查：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

暂未完成验证：

- Playwright MCP 当前无法进入复用页签：MCP Chrome profile 被占用，工具提示需 `--isolated`，但仓库规则禁止为本地续测新开 isolated profile。
- `npm run verify:gui-smoke` 已尝试；第一次被既有脏改阻塞，随后阻塞文件已恢复到可编译状态并通过 TypeScript。第二次 smoke 触发独立 Cargo target 全量重编，约 `8` 分钟推进到 `836/1098` 后进程退出并停止 headless Tauri，未得到最终 GUI smoke 结论；已确认未留下本轮 `verify-gui-smoke` / 临时 target 编译进程。

下一刀：

1. DevBridge / headless Tauri 稳定后，先复跑 `npm run verify:gui-smoke`。
2. 再做真实 E2E，读取 `messageListTimelineBuildMs / messageListRenderGroupsMs / longTaskMaxMs`，决定是否 worker 化。

### 2026-05-05：P3 第五刀，历史消息 hydration 投影外移

已完成：

- 新增 `src/components/agent/chat/projection/historicalMessageHydrationProjection.ts`：
  - `hasStructuredHistoricalContentHint`
  - `isHistoricalAssistantMessageHydrationCandidate`
  - `buildHistoricalMarkdownHydrationTargets`
  - `buildHistoricalMarkdownHydrationIndexByMessageId`
  - `shouldDeferHistoricalAssistantMessageDetails`
  - `countDeferredHistoricalContentParts`
  - `countDeferredHistoricalMarkdown`
- `MessageList.tsx` 改为从 projection 层获取旧会话历史 markdown hydration 目标、hydration index、消息细节延迟判断、延迟 contentParts 计数和延迟 markdown 数量。
- 新增 `historicalMessageHydrationProjection.test.ts`，覆盖结构化历史内容识别、旧会话 assistant hydration 候选、目标筛选、hydration 计数和延迟统计。

主线收益：

- Phase 4 中仍留在 `MessageList` 内的历史消息 hydration 扫描被移到纯 projection，后续如果 E2E 证明 `messageListHistoricalMarkdownTargetScanMs` 或 `messageListHistoricalContentPartsScanMs` 仍高，可以直接对 projection 做 idle / worker 化。
- `MessageList` 继续向“只编排状态与渲染”收敛，不新增 runtime、artifact 或 evidence 事实源。
- 结构化历史内容识别成为可单测 selector，不再散落在组件内部。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/projection/historicalMessageHydrationProjection.test.ts" "src/components/agent/chat/projection/messageTimelineRenderProjection.test.ts" "src/components/agent/chat/components/MessageList.test.tsx"
npx eslint "src/components/agent/chat/projection/historicalMessageHydrationProjection.ts" "src/components/agent/chat/projection/historicalMessageHydrationProjection.test.ts" "src/components/agent/chat/components/MessageList.tsx" --max-warnings 0
git diff --check -- "src/components/agent/chat/projection/historicalMessageHydrationProjection.ts" "src/components/agent/chat/projection/historicalMessageHydrationProjection.test.ts" "src/components/agent/chat/components/MessageList.tsx"
npm run typecheck -- --pretty false
```

结果：

- Historical hydration projection / Message timeline projection / MessageList 回归：通过，`102` 个测试通过。
- ESLint touched files：通过。
- diff 空白检查：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- `npm run verify:gui-smoke` 已尝试，但脚本检测到 sqlite 构建缓存损坏并切换到新的独立 Cargo target `/var/folders/.../lime-gui-smoke-target-rebuild-1777945025159-2866`，开始 `1098` 个 crate 的全量重编；为避免继续造成 CPU/鼠标繁忙，已在约 `113/1098` 时停止本轮 smoke。
- 停止 headless Tauri 后，`npm run bridge:health -- --timeout-ms 30000` 返回 `3030` 未就绪；当前仍不把 GUI smoke 记为通过。
- Playwright MCP 仍因既有 Chrome profile 占用无法进入复用页签，工具提示要求 `--isolated`，但仓库规则禁止本地续测使用 isolated profile，因此本轮未绕规则新开浏览器。

下一刀：

1. 等 DevBridge / Playwright profile 恢复后，先按验收路径采集 `messageListHistoricalMarkdownTargetScanMs / messageListHistoricalContentPartsScanMs / messageListTimelineBuildMs / messageListRenderGroupsMs / longTaskMaxMs`。
2. 如果历史 hydration 或 timeline projection 仍是热点，再把对应 projection 放到 idle / worker；否则不要盲目 worker 化。
3. 若继续结构主线，进入 Phase 2，把 `useAgentSession` 的 lifecycle / hydration controller 拆成可单测模块，减少旧会话恢复链路继续堆在 hook 内。

### 2026-05-05：P3 第六刀，Session hydration controller 最小化

已完成：

- 新增 `src/components/agent/chat/hooks/sessionHydrationController.ts`：
  - `SESSION_DETAIL_HISTORY_LIMIT`
  - `normalizeSessionDetailHistoryLimit`
  - `buildSessionDetailHydrationOptions`
  - `buildSessionDetailPrefetchKey`
  - `buildSessionDetailPrefetchSignature`
  - `isCurrentSessionHydrationRequest`
- `useAgentSession.ts` 中旧会话详情、prefetch、静默 turn 恢复、missing-from-topics 校验的 `runtime.getSession` 统一通过 `buildSessionDetailHydrationOptions()` 构造请求参数。
- `useAgentSession.ts` 中 switch finalize、deferred hydrate catch、metadata sync、load full history、silent recovery、missing session verify 的 stale/session guard 改为 `isCurrentSessionHydrationRequest()`。
- 新增 `sessionHydrationController.test.ts`，固定 `historyLimit: 40`、`resumeSessionStartHooks` 合并、prefetch key/signature 和过期 hydrate 丢弃逻辑。

主线收益：

- Phase 2 开始从 `useAgentSession` 抽出可单测 controller，先把最容易回归成“无 limit getSession / 过期结果覆盖当前 tab”的逻辑收敛到单一入口。
- 不改变 runtime 协议、不新增 Tauri command、不改变对外 hook shape；本刀只降低旧会话恢复链路的重复与排查成本。
- 后续拆 `sessionLifecycleController / topicListController` 时，可以继续复用同一 stale guard，而不是在 hook 内复制判断。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionHydrationController.test.ts" "src/components/agent/chat/projection/historicalMessageHydrationProjection.test.ts" "src/components/agent/chat/components/MessageList.test.tsx"
npx eslint "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/projection" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Session hydration controller / historical hydration projection / MessageList 回归：通过，`102` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- diff 空白检查：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因仍是上一轮已确认 smoke 会因 sqlite 构建缓存损坏切到独立 Cargo target 并触发全量重编，容易复现用户反馈的 CPU/鼠标繁忙。
- Playwright MCP 仍需等待既有 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionDetailFetchController`，把 `loadRuntimeSessionDetail` 的 prefetch 命中、fetch start/success/error metrics 和 retry 决策从 hook 中移出。
2. 或等待 GUI 环境恢复后，先采集旧会话 A/B 打开和切换指标，再决定是否优先 worker 化 MessageList projection。

### 2026-05-05：P3 第七刀，Session detail fetch controller

已完成：

- 新增 `src/components/agent/chat/hooks/sessionDetailFetchController.ts`：
  - `createSessionDetailPrefetchRegistry`
  - `loadSessionDetailWithPrefetch`
  - `SessionDetailFetchEvent`
  - `SessionDetailFetchMode`
- `useAgentSession.ts` 中 `loadRuntimeSessionDetail` 改为委托 `loadSessionDetailWithPrefetch`：
  - 保留 `session.switch.fetchDetail.start / prefetch / success / error` 性能指标。
  - 保留 `switchTopic.fetchDetail.*` AgentDebug 日志。
  - prefetch 命中、prefetch fallback、resume 跳过 prefetch、registry 只删除当前 promise 进入 controller 单测。
- `sessionDetailPrefetchRegistry` 从裸 `Map` 改为 controller registry，避免 future prefetch 清理误删较新 promise。

主线收益：

- Phase 2 继续把 `useAgentSession` 从“状态 + 请求 + metrics + retry + registry”巨石里拆开；本刀先收敛 detail fetch 和 prefetch 复用，不改变 UI 行为。
- 旧会话打开时最关键的 detail fetch 分段现在有单独 controller 测试，后续要做取消、优先级或批量请求时不用再直接改 hook 主体。
- 继续保持 `historyLimit: 40` 由 `sessionHydrationController` 单一入口提供，避免 prefetch / switch / recovery 重新分叉。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts" "src/components/agent/chat/projection/historicalMessageHydrationProjection.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "预取|stale 快照" --hookTimeout 180000 --testTimeout 120000
npx eslint "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Fetch / hydration controller / historical hydration projection：通过，`13` 个测试通过。
- `useAsterAgentChat` 旧会话预取和 stale 快照定向：通过，`3` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- diff 空白检查：通过。

GUI / E2E 状态：

- 本刀仍未复跑 `verify:gui-smoke`，理由同上一刀：当前 smoke 会触发独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用 hook / controller 单测覆盖行为。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionHydrationRetryController`，把 deferred hydrate retry / transient skip / error fallback 从 `switchTopic` 内联函数里移出。
2. 或恢复 GUI 环境后先做旧会话 A/B 打开与切换采样，确认是否还需要优先处理 MessageList worker 化。

### 2026-05-05：P3 第八刀，Deferred hydration retry controller

已完成：

- 新增 `src/components/agent/chat/hooks/sessionHydrationRetryController.ts`：
  - `resolveDeferredSessionHydrationErrorAction`
  - `DeferredSessionHydrationErrorAction`
  - `DeferredSessionHydrationRetryContext`
  - `DeferredSessionHydrationSkipContext`
- `useAgentSession.ts` 中 deferred cached topic hydrate 的 catch 分支改为委托 retry controller：
  - retryable transient 且未达上限：返回 `retry`，继续写 `session.switch.fetchDetail.retryScheduled` 并调度 idle retry。
  - transient 且不再重试：返回 `skip`，保留缓存快照并写 `session.switch.fetchDetail.retrySkipped`。
  - fatal unknown：返回 `fail`，继续走 `handleSwitchTopicError(..., preserveCurrentSnapshot: true)`。
- 新增 `sessionHydrationRetryController.test.ts`，覆盖 bridge health retry、connection retry 达上限跳过、timeout 直接跳过、unknown fatal fallback。

主线收益：

- Phase 2 继续把 `switchTopic` 的旧会话恢复分支从“请求 + stale guard + retry 分类 + metrics + 调度”拆开；本刀只抽 retry 决策，不改变调度行为。
- deferred hydrate 的错误处理有纯函数测试，后续如果要调整 retry 次数、退避策略或按错误类型降级，不需要在 `useAgentSession` 巨石里改条件。
- 继续保护旧会话打开体验：短暂 bridge / network 问题只保留 cached snapshot，不把用户已经看到的旧会话清空。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "stale 快照|预取" --hookTimeout 180000 --testTimeout 120000
npx eslint "src/components/agent/chat/hooks/sessionHydrationRetryController.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/sessionHydrationRetryController.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Retry / fetch / hydration controller：通过，`12` 个测试通过。
- `useAsterAgentChat` 旧会话预取和 stale 快照定向：通过，`3` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- diff 空白检查：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionSwitchSnapshotController`，把 cached snapshot apply、pending shell、localSnapshotOverride 判断从 `switchTopic` 主体中移出。
2. 或恢复 GUI 环境后先采集旧会话 A/B 打开和切换指标，决定是否进入 MessageList projection idle / worker 化。

### 2026-05-05：P3 第九刀，Session switch snapshot controller

已完成：

- 新增 `src/components/agent/chat/hooks/sessionSwitchSnapshotController.ts`：
  - `shouldLoadCachedTopicSnapshot`
  - `shouldApplyCachedTopicSnapshot`
  - `shouldRefreshCachedSnapshotImmediately`
  - `shouldApplyPendingSessionShell`
  - `buildSessionSwitchStartMetricContext`
  - `buildSessionSwitchDeferHydrationMetricContext`
  - `buildPendingSessionShellMetricContext`
  - `buildSessionSwitchLocalSnapshotOverride`
- `useAgentSession.ts` 中 `switchTopic` 的 cached snapshot 加载/应用、stale/running 立即刷新、defer metric、pending shell metric、`localSnapshotOverride` 引用判定改为委托 controller。
- 新增 `sessionSwitchSnapshotController.test.ts`，覆盖当前会话不重复加载 snapshot、stale/running/waiting 立即刷新、无 snapshot 时应用 pending shell、指标上下文和 local snapshot 引用匹配。

主线收益：

- Phase 2 继续瘦 `switchTopic`：snapshot 相关判断不再与 detail fetch、retry、metadata sync 混在同一个长函数里。
- `localSnapshotOverride` 的引用匹配规则有单测保护，避免后续改动误把 stale cached snapshot 与当前 UI 状态错配，导致旧会话恢复覆盖当前 tab。
- pending shell 的触发条件可单测，继续保护“打开无缓存旧会话先显示壳，不等 getSession 完成”的体验。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "stale 快照|预取|pendingShell|pending shell|空白" --hookTimeout 180000 --testTimeout 120000
npx eslint "src/components/agent/chat/hooks/sessionSwitchSnapshotController.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/sessionSwitchSnapshotController.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Snapshot / retry / fetch / hydration controller：通过，`17` 个测试通过。
- `useAsterAgentChat` 旧会话预取、stale 快照和相关空白消息定向：通过，`7` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- diff 空白检查：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionMetadataSyncController`，把 finalize 后的 accessMode / provider / executionStrategy fallback patch 与低优先级 sync 决策从 `finalizeResolvedTopicDetail` 中移出。
2. 或恢复 GUI 环境后先采集旧会话 A/B 打开和切换指标，决定是否进入 MessageList projection idle / worker 化。

### 2026-05-05：P3 第十刀，Session metadata sync controller

已完成：

- 新增 `src/components/agent/chat/hooks/sessionMetadataSyncController.ts`：
  - `buildSessionMetadataSyncPlan`
  - `buildSessionSwitchSuccessMetricContext`
  - `resolveSessionExecutionStrategySource`
  - `executeSessionMetadataSync`
- `useAgentSession.ts` 中 `finalizeResolvedTopicDetail` 的 metadata fallback 决策改为委托 controller：
  - accessMode 来源解析与是否本地持久化。
  - provider/model fallback patch。
  - executionStrategy fallback patch。
  - switch success metric 的 source 字段。
  - 优先 `updateSessionMetadata`，缺少批量命令时回退到 `setSessionAccessMode / setSessionProviderSelection / setSessionExecutionStrategy`。
- 新增 `sessionMetadataSyncController.test.ts`，覆盖 runtime source 不回填、session storage fallback patch、workspace default patch、metric context、批量 sync、分散 sync fallback。

主线收益：

- Phase 2 继续瘦 `finalizeResolvedTopicDetail`：会话详情应用、成功指标、metadata fallback、低优先级 sync 不再全部堆在一个长函数里。
- P1 里提出的“三个迁移回填 invoke 合并或去重”现在有了明确 controller 边界；当前仍优先使用已有 `updateSessionMetadata` 批量命令，fallback 分散命令只在批量命令不存在时使用。
- 模型、权限、执行策略恢复来源有单测保护，降低旧会话切换后选择器错恢复的风险。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "模型|权限|执行策略|metadata|stale 快照|预取" --hookTimeout 180000 --testTimeout 120000
npx eslint "src/components/agent/chat/hooks/sessionMetadataSyncController.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/sessionMetadataSyncController.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Metadata / snapshot / retry / fetch / hydration controller：通过，`23` 个测试通过。
- `useAsterAgentChat` 模型、权限、metadata、stale 快照、预取定向：通过，`25` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- diff 空白检查：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionFinalizeController`，把 workspace mismatch、runtime/topic/shadow source 汇总和 apply detail plan 从 `finalizeResolvedTopicDetail` 中继续移出。
2. 或恢复 GUI 环境后先采集旧会话 A/B 打开和切换指标，决定是否进入 MessageList projection idle / worker 化。

### 2026-05-05：P3 第十一刀，Session finalize controller

已完成：

- 新增 `src/components/agent/chat/hooks/sessionFinalizeController.ts`：
  - `resolveSessionKnownWorkspaceId`
  - `isCrossWorkspaceSessionDetail`
  - `buildCrossWorkspaceSessionRestoreContext`
  - `buildSessionWorkspaceRestorePlan`
  - `resolveShadowSessionExecutionStrategyFallback`
  - `resolveSessionExecutionStrategyOverride`
- `useAgentSession.ts` 中 `finalizeResolvedTopicDetail` 的跨 workspace restore guard、runtime/topic/shadow workspace 汇总、shadow execution strategy fallback 与最终 `executionStrategyOverride` 改为委托 controller。
- 新增 `sessionFinalizeController.test.ts`，覆盖 workspace 优先级、跨 workspace 拒绝条件、拒绝日志上下文、shadow execution strategy fallback 与最终执行策略优先级。

主线收益：

- Phase 2 继续瘦 `finalizeResolvedTopicDetail`：会话详情应用前的 restore guard 与执行策略恢复规则不再和 UI state apply、metadata sync、topic upsert 混在一起。
- 旧会话恢复的 workspace 保护有单测覆盖，降低多 tab / 多 workspace 切换时旧会话错误覆盖当前工作区的风险。
- 执行策略恢复的 `runtime -> topic -> shadow -> react` 优先级有独立测试，后续排查首字慢或策略错恢复时可以直接定位到 finalize controller。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionFinalizeController.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "模型|权限|执行策略|metadata|stale 快照|预取|workspace|跨工作区" --hookTimeout 180000 --testTimeout 120000
npx eslint "src/components/agent/chat/hooks/sessionFinalizeController.ts" "src/components/agent/chat/hooks/sessionFinalizeController.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Finalize / metadata / snapshot / retry / fetch / hydration controller：通过，`28` 个测试通过。
- `useAsterAgentChat` 模型、权限、metadata、stale 快照、预取、workspace 定向：通过，`29` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionPostFinalizePersistenceController` 或 `sessionFinalizeMetadataScheduler`，把 workspace 保存、topic workspace upsert、provider preference apply、metadata idle scheduler 从 `finalizeResolvedTopicDetail` 主体继续移出。
2. 恢复 GUI 环境后按 `conversation-projection-acceptance.md` 采集旧会话 A/B 打开、切换与首字指标，决定是否进入 MessageList idle / worker 化。

### 2026-05-05：P3 第十二刀，Session metadata sync scheduler

已完成：

- 新增 `src/components/agent/chat/hooks/sessionMetadataSyncScheduler.ts`：
  - `buildSessionMetadataSyncBrowserSkipEvent`
  - `buildSessionMetadataSyncStaleSkipEvent`
  - `scheduleSessionMetadataSync`
- `useAgentSession.ts` 中 `finalizeResolvedTopicDetail` 的 metadata idle 调度改为委托 scheduler：
  - 浏览器桥接下跳过低优先级 runtime invoke。
  - 调度前取消上一条 pending metadata sync。
  - idle 执行时统一 stale request/session guard。
  - 成功后回写 provider preference / execution strategy 同步标记。
  - 失败时保留现有 warn 行为。
- 新增 `sessionMetadataSyncScheduler.test.ts`，覆盖无 patch 不调度、无 invoke 跳过、取消旧调度、按 idle 参数调度、stale 跳过与失败回调。

主线收益：

- Phase 2 继续瘦 `finalizeResolvedTopicDetail`：metadata patch 的“是否调度、何时调度、如何判过期、如何执行”不再内联在会话详情应用主链里。
- P1 的“三个回填 invoke 占用 invoke 通道”现在被明确约束在低优先级 scheduler 边界内；后续如果继续合并、降频或批处理，只需要改 scheduler/controller，不再穿透 hook 主体。
- 旧会话切换时 metadata sync 的 stale guard 有单测保护，避免 A/B 历史会话快速切换后旧调度写回当前会话。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionFinalizeController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "模型|权限|执行策略|metadata|stale 快照|预取|workspace|跨工作区" --hookTimeout 180000 --testTimeout 120000
npx eslint "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.ts" "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.ts" "src/components/agent/chat/hooks/sessionFinalizeController.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Scheduler / finalize / metadata / snapshot / retry / fetch / hydration controller：通过，`33` 个测试通过。
- `useAsterAgentChat` 模型、权限、metadata、stale 快照、预取、workspace 定向：通过，`29` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 scheduler/controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionPostFinalizePersistenceController`，把 workspace 保存、topic workspace upsert、provider preference apply 从 `finalizeResolvedTopicDetail` 主体继续移出。
2. 恢复 GUI 环境后按 `conversation-projection-acceptance.md` 采集旧会话 A/B 打开、切换与首字指标，决定是否进入 MessageList idle / worker 化。

### 2026-05-05：P3 第十三刀，Session post-finalize persistence controller

已完成：

- 新增 `src/components/agent/chat/hooks/sessionPostFinalizePersistenceController.ts`：
  - `resolveSessionDetailTopicWorkspaceId`
  - `resolvePersistedSessionWorkspaceId`
  - `buildSessionPostFinalizePersistencePlan`
- `useAgentSession.ts` 中 `finalizeResolvedTopicDetail` 的 post-finalize 后处理决策改为委托 controller：
  - `mapSessionDetailToTopic` 使用的 topic workspace 来源。
  - `agent_session_workspace` 映射持久化 workspace 来源。
  - runtime workspace 回写 topic 字段的条件和值。
  - provider preference apply 的目标 preference。
- 新增 `sessionPostFinalizePersistenceController.test.ts`，覆盖 topic workspace 优先级、持久化 workspace 来源和完整 post-finalize plan。

主线收益：

- Phase 2 继续瘦 `finalizeResolvedTopicDetail`：会话详情 apply 后的 workspace / provider 后处理不再散落在 hook 主体里。
- workspace 相关恢复规则进一步可单测，降低旧会话恢复慢问题排查时“到底是 runtime workspace、topic snapshot 还是 shadow cache 生效”的定位成本。
- provider preference apply 的决策进入同一个 post-finalize plan，为后续继续拆 `finalizeResolvedTopicDetail` 或把 post-apply side effects 降优先级打基础。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionPostFinalizePersistenceController.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionFinalizeController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "模型|权限|执行策略|metadata|stale 快照|预取|workspace|跨工作区" --hookTimeout 180000 --testTimeout 120000
npx eslint "src/components/agent/chat/hooks/sessionPostFinalizePersistenceController.ts" "src/components/agent/chat/hooks/sessionPostFinalizePersistenceController.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.ts" "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.ts" "src/components/agent/chat/hooks/sessionFinalizeController.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.ts" "src/components/agent/chat/hooks/sessionHydrationController.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Post-finalize / scheduler / finalize / metadata / snapshot / retry / fetch / hydration controller：通过，`36` 个测试通过。
- `useAsterAgentChat` 模型、权限、metadata、stale 快照、预取、workspace 定向：通过，`29` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionSwitchErrorController`，把 session not found、preserve current snapshot、toast/error metric 等错误恢复判断从 `useAgentSession` 中移出。
2. 或抽 `sessionHistoryPaginationController`，把完整历史分页窗口计算、stale guard 与 merge 计划从主 hook 中移出。

### 2026-05-05：P3 第十四刀，Session switch error controller

已完成：

- 新增 `src/components/agent/chat/hooks/sessionSwitchErrorController.ts`：
  - `buildSessionSwitchErrorLogContext`
  - `buildSessionSwitchErrorToastMessage`
  - `resolveSessionSwitchErrorAction`
- `useAgentSession.ts` 中 `handleSwitchTopicError` 的错误恢复分支改为委托 controller：
  - session not found：清空当前快照、刷新 topics、不弹 toast。
  - 普通错误：默认清空当前快照并弹 toast。
  - `preserveCurrentSnapshot`：保留当前快照，只弹 toast。
- 新增 `sessionSwitchErrorController.test.ts`，覆盖 session not found、普通错误、保留快照错误和非 `Error` 文案。

主线收益：

- Phase 2 继续瘦 `useAgentSession`：旧会话切换失败的恢复策略不再散落在 hook 主体里。
- `preserveCurrentSnapshot` 的行为有单测保护，避免 deferred hydration 失败时误清空当前缓存快照，造成旧会话 UI 闪空或用户误以为卡死。
- session not found 的清理与 topics 刷新路径可单测，后续排查旧会话恢复失败时能直接定位到错误 controller。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionSwitchErrorController.test.ts" "src/components/agent/chat/hooks/sessionPostFinalizePersistenceController.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionFinalizeController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "模型|权限|执行策略|metadata|stale 快照|预取|workspace|跨工作区|错误|not found|not found" --hookTimeout 180000 --testTimeout 120000
```

结果：

- Switch error / post-finalize / scheduler / finalize / metadata / snapshot / retry / fetch / hydration controller：通过，`40` 个测试通过。
- `useAsterAgentChat` 模型、权限、metadata、stale 快照、预取、workspace、错误定向：通过，`30` 个测试通过。

GUI / E2E 状态：

- 本刀暂未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionHistoryPaginationController`，把完整历史分页窗口计算、分页 options、stale guard、merge 计划从 `useAgentSession` 主体中移出。
2. 恢复 GUI 环境后按 `conversation-projection-acceptance.md` 采集旧会话 A/B 打开、切换与首字指标。

### 2026-05-05：P3 第十五刀，Session history pagination controller

已完成：

- 新增 `src/components/agent/chat/hooks/sessionHistoryPaginationController.ts`：
  - `normalizePositiveInteger`
  - `normalizeNonNegativeInteger`
  - `resolveDetailHistoryLoadedMessages`
  - `resolveSessionHistoryWindowFromDetail`
  - `buildSessionHistoryPageRequestPlan`
  - `buildSessionHistoryPageResultPlan`
- `useAgentSession.ts` 中 `resolveSessionHistoryWindow` 与 `loadFullSessionHistory` 的分页窗口计算改为委托 controller：
  - 首次 detail 截断窗口计算。
  - “加载更早历史”的 `historyLimit / historyOffset / historyBeforeMessageId` 请求参数。
  - loading window 状态。
  - 分页返回后的 `loadedMessages / totalMessages / cursor` 下一轮窗口。
- 新增 `sessionHistoryPaginationController.test.ts`，覆盖整数归一化、detail loaded count、截断窗口、重复 loading 防护、分页请求计划与分页结果计划。

主线收益：

- Phase 2 继续瘦 `useAgentSession`：完整历史分页不再在主 hook 内手写多段窗口计算。
- P2 “`loadFullSessionHistory` 用全量拉取改分页”的主线现在有独立 controller 和回归保护，避免后续误退回无分页或重复触发。
- 旧会话打开慢的排查边界更清晰：首帧 detail hydrate、分页请求参数、分页 merge 可以分别测，不再必须挂载完整 workspace 才能验证窗口算法。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionHistoryPaginationController.test.ts" "src/components/agent/chat/hooks/sessionSwitchErrorController.test.ts" "src/components/agent/chat/hooks/sessionPostFinalizePersistenceController.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionFinalizeController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "加载更早历史" --hookTimeout 180000 --testTimeout 120000
npx eslint "src/components/agent/chat/hooks/sessionHistoryPaginationController.ts" "src/components/agent/chat/hooks/sessionHistoryPaginationController.test.ts" "src/components/agent/chat/hooks/sessionSwitchErrorController.ts" "src/components/agent/chat/hooks/sessionSwitchErrorController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- History pagination / switch error / post-finalize / scheduler / finalize / metadata / snapshot / retry / fetch / hydration controller：通过，`46` 个测试通过。
- `useAsterAgentChat` 完整历史分页定向：通过，`1` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 2：抽 `sessionHistoryMergeController`，把完整历史分页返回后的 messages / turns / items merge 计划从 `loadFullSessionHistory` 中移出。
2. 或进入 Phase 3：抽 `streamSubmissionController`，把首字链路的 ensure / listener / submit 分段进一步收口。

### 2026-05-05：P3 第十六刀，Session history merge controller

已完成：

- 新增 `src/components/agent/chat/hooks/sessionHistoryMergeController.ts`：
  - `buildSessionHistoryMergePlan`
- `useAgentSession.ts` 中 `loadFullSessionHistory` 的分页返回 merge 改为委托 controller：
  - detail messages -> UI messages hydrate。
  - incoming messages 与本地 messages 合并。
  - detail turns 与本地 turns 合并。
  - detail items 经过 legacy normalization、merge、conversation filter。
  - 根据合并后的 turns 恢复 `currentTurnId`。
- 新增 `sessionHistoryMergeController.test.ts`，覆盖分页 detail 的 messages / turns / threadItems 合并，以及无 incoming turns 时保留当前 turnId。

主线收益：

- Phase 2 中 `loadFullSessionHistory` 的分页请求、分页窗口、分页 merge 已拆成独立 controller；完整历史加载不再把请求参数、窗口状态、消息合并全部堆在 hook 主体中。
- P2 的“Cursor 分页 + 防止全量拉取”现在有分页窗口和 merge 两层单测保护，后续若旧会话加载仍慢，可以明确区分慢在 runtime page fetch、hydrate/merge，还是 MessageList render。
- `threadItems` 的 legacy normalization 和 conversation filter 被收进 merge controller，减少后续修分页时漏掉工具过程过滤的风险。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/sessionHistoryMergeController.test.ts" "src/components/agent/chat/hooks/sessionHistoryPaginationController.test.ts" "src/components/agent/chat/hooks/sessionSwitchErrorController.test.ts" "src/components/agent/chat/hooks/sessionPostFinalizePersistenceController.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionFinalizeController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "加载更早历史" --hookTimeout 180000 --testTimeout 120000
npx eslint "src/components/agent/chat/hooks/sessionHistoryMergeController.ts" "src/components/agent/chat/hooks/sessionHistoryMergeController.test.ts" "src/components/agent/chat/hooks/sessionHistoryPaginationController.ts" "src/components/agent/chat/hooks/sessionHistoryPaginationController.test.ts" "src/components/agent/chat/hooks/sessionSwitchErrorController.ts" "src/components/agent/chat/hooks/sessionSwitchErrorController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- History merge / pagination / switch error / post-finalize / scheduler / finalize / metadata / snapshot / retry / fetch / hydration controller：通过，`48` 个测试通过。
- `useAsterAgentChat` 完整历史分页定向：通过，`1` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 进入 Phase 3：抽 `streamSubmissionController`，把首页/对话发送首字链路的 ensure session、listener readiness、submit invoke 分段继续收口。
2. 恢复 GUI 环境后按 `conversation-projection-acceptance.md` 采集旧会话 A/B 打开、切换与首字指标。

### 2026-05-05：P3 第十七刀，Agent stream submission controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamSubmissionController.ts`：
  - `resolveAgentStreamSubmitErrorMessage`
  - `buildAgentStreamSubmitDispatchedContext`
  - `buildAgentStreamSubmitAcceptedContext`
  - `buildAgentStreamSubmitFailedContext`
  - `buildAgentStreamSubmitFailedLogContext`
- `agentStreamSubmitExecution.ts` 中 submit dispatched / accepted / failed 的 metric/log context 改为委托 controller：
  - listener bound 到 submit dispatched 的 delta。
  - request start 到 dispatched / accepted / failed 的 elapsed。
  - submit invoke 耗时。
  - metric error message 与 debug 原始 error 分离。
- 新增 `agentStreamSubmissionController.test.ts`，覆盖 dispatched、accepted、failed metric context 与 failed debug context。

主线收益：

- Phase 3 开始把首字链路拆成可测试边界：提交阶段耗时不再内联在 `executeAgentStreamSubmit` 主体里。
- `executeAgentStreamSubmit` 继续保持 current runtime 协议，只串接 ensure session、listener binding 和 runtime `submitOp`；submit 分段指标由 controller 统一生成，方便后续 E2E 对比 `ensureSession / listenerBound / submitDispatched / submitAccepted / firstEvent / firstText`。
- failed metric 与 debug log 的 error 形态被单测固定，避免为了日志可读性破坏 performance summary 的 JSON 友好字段。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/sessionHistoryMergeController.test.ts" "src/components/agent/chat/hooks/sessionHistoryPaginationController.test.ts" "src/components/agent/chat/hooks/sessionSwitchErrorController.test.ts" "src/components/agent/chat/hooks/sessionPostFinalizePersistenceController.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncScheduler.test.ts" "src/components/agent/chat/hooks/sessionMetadataSyncController.test.ts" "src/components/agent/chat/hooks/sessionFinalizeController.test.ts" "src/components/agent/chat/hooks/sessionSwitchSnapshotController.test.ts" "src/components/agent/chat/hooks/sessionHydrationRetryController.test.ts" "src/components/agent/chat/hooks/sessionDetailFetchController.test.ts" "src/components/agent/chat/hooks/sessionHydrationController.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamSubmissionController.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.ts" "src/components/agent/chat/hooks/sessionHistoryMergeController.ts" "src/components/agent/chat/hooks/sessionHistoryMergeController.test.ts" "src/components/agent/chat/hooks/useAgentSession.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Agent stream submission / submit execution / submit context / turn event binding：通过，`13` 个测试通过。
- Session controller 回归：通过，`48` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`，原因同前：当前 smoke 会切到独立 Rust target 全量重编，容易造成 CPU 和鼠标繁忙；本刀是纯前端 controller 抽取，先用定向行为测试收口。
- Playwright MCP 仍等待 profile 释放；不使用 isolated profile 绕过仓库规则。

下一刀：

1. 继续 Phase 3：抽 `agentStreamSubmitOpController`，把 runtime `submitOp` 的参数组装从 `agentStreamSubmitExecution` 中移出。
2. 或抽 `agentStreamListenerReadinessController`，把 listener bound / first event timeout / silent recovery guard 继续拆成可测试 controller。

### 2026-05-05：P3 第十八刀，Agent stream submit op controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamSubmitOpController.ts`：
  - `buildAgentStreamSubmitOp`
- `agentStreamSubmitExecution.ts` 中 runtime `submitOp` payload 组装改为委托 controller：
  - `activeSessionId -> sessionId`。
  - `submitWorkspaceId -> workspaceId`。
  - `requestTurnId -> turnId`。
  - 统一固定 `queueIfBusy: true`，避免 stream submit 主链到处重复声明 busy queue 语义。
- 新增 `agentStreamSubmitOpController.test.ts`，覆盖首页首发快路径 payload 与底层 `buildUserInputSubmitOp` payload 等价性。

主线收益：

- Phase 3 继续瘦 `executeAgentStreamSubmit`：执行函数现在更接近 `ensure session -> bind listener -> dispatch submit -> record result`，不再同时承担 runtime payload 拼装职责。
- 首页输入回车后的首字链路更容易分段排查：后续若 `submitInvokeMs` 异常，可直接区分是 submit lifecycle、payload compaction 还是 runtime bridge 慢。
- `queueIfBusy` 的当前 stream 语义进入单测保护，避免后续修队列/首字时误把 busy 会话变成阻塞式提交。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/utils/buildUserInputSubmitOp.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamSubmitOpController.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/agentStreamSubmitOpController.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.ts"
```

结果：

- Agent stream submit op / submit execution / user input builder：通过，`7` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀未复跑 `verify:gui-smoke`。本刀是纯前端 controller 抽取，不改 UI 壳、Bridge、Tauri command 或 runtime event protocol；同时继续避免触发会污染 CPU / 鼠标繁忙现象判断的独立 Rust rebuild。
- 真实 Playwright E2E 仍按既有规则等待稳定 Lime 页签 / DevBridge 环境，不使用 isolated profile 绕过仓库约束。

下一刀：

1. 继续 Phase 3：抽 `agentStreamListenerReadinessController`，把 listener bound、first event guard、silent recovery 前置条件继续从 submit execution / turn event binding 中拆出。
2. 或抽 `agentStreamSubmitLifecycleController`，把 dispatched / accepted / failed 记录与 runtime submit invoke 包装成一个可测 lifecycle plan，为 TTFT 阶段日志做更细分的单元边界。

### 2026-05-05：P3 第十九刀，Agent stream listener readiness controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamListenerReadinessController.ts`：
  - `extractAgentStreamRuntimeEventType`
  - `buildAgentStreamListenerBoundContext`
  - `buildAgentStreamFirstEventContext`
  - `buildAgentStreamFirstEventDeferredContext`
  - `shouldDeferAgentStreamFirstEventTimeout`
  - `shouldScheduleAgentStreamInactivityWatchdog`
  - `shouldIgnoreAgentStreamInactivityResult`
- `agentStreamTurnEventBinding.ts` 中 listener / first event / inactivity guard 改为委托 controller：
  - listener bound metric/log context。
  - recognized / unknown first event metric/log context。
  - submit 已派发但首包暂未到达时的 deferred context。
  - inactivity watchdog 是否调度、过期结果是否丢弃的判断。
- 新增 `agentStreamListenerReadinessController.test.ts`，覆盖 runtime event type 提取、listener bound context、first event context、first event deferred context、first event timeout defer guard、inactivity watchdog guard。

主线收益：

- Phase 3 的 TTFT readiness 分段进入独立单测边界；首字慢现在能更清楚区分 listener 未绑定、submit 已派发但 runtime 无首包、首包后长时间静默等阶段。
- `agentStreamTurnEventBinding` 继续瘦身，事件绑定主函数不再内联所有 metric context 与 watchdog guard 判断。
- 未识别但结构合法 runtime event 的首包活跃态继续被测试保护，避免后续 runtime projection/bootstrap 事件导致 UI 误失败。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamListenerReadinessController.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/agentStreamListenerReadinessController.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Listener readiness controller / turn event binding：通过，`11` 个测试通过。
- Agent stream readiness / submit / context 回归：通过，`20` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀暂未复跑 `verify:gui-smoke`。本刀仍是纯前端 stream controller 抽取，不改 Tauri command、Bridge、runtime event protocol 或用户可见 UI；继续避免因独立 Rust rebuild 干扰 CPU / 鼠标繁忙问题判断。

下一刀：

1. 继续 Phase 3：抽 `agentStreamSubmitLifecycleController`，把 submit dispatched / accepted / failed metric 记录与 runtime `submitOp` invoke 包装成可测生命周期边界。
2. 或抽 `agentStreamRequestStartController`，把 request start metric 与 activity log payload 从 `agentStreamTurnEventBinding` 中移出，进一步降低事件绑定主函数职责。

### 2026-05-05：P3 第二十刀，Agent stream submit lifecycle controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.ts`：
  - `runAgentStreamSubmitLifecycle`
- `agentStreamSubmitExecution.ts` 中 submit dispatched / accepted / failed 的记录和 `runtime.submitOp` invoke 包装改为委托 controller：
  - submit dispatched 时写入 `requestState.submissionDispatchedAt`。
  - submit accepted 时记录 `submitInvokeMs`。
  - submit failed 时 metric 记录可 JSON 化错误文案，debug log 保留原始 error，并继续抛出原始错误。
- 新增 `agentStreamSubmitLifecycleController.test.ts`，覆盖成功和失败两条生命周期，固定 metric/log 顺序与 requestState 更新时间。

主线收益：

- Phase 3 的 submit invoke 生命周期进入独立单测边界，`executeAgentStreamSubmit` 进一步收敛为 ensure session、bind listener、构造 submit op、交给 lifecycle 执行。
- 首页输入回车后若首字慢，可以更明确地区分：listener bound 慢、submit invoke 慢、runtime 首包慢，还是后续 render 慢。
- submit 失败链路保留原始错误抛出，不改变现有错误传播语义，同时确保性能 metric 的 error 字段继续适合汇总分析。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Submit lifecycle / submission context / submit execution / submit op：通过，`9` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`22` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀暂未复跑 `verify:gui-smoke`。本刀仍是纯前端 stream controller 抽取，不改 Tauri command、Bridge、runtime event protocol 或用户可见 UI；继续避免因独立 Rust rebuild 干扰 CPU / 鼠标繁忙问题判断。

下一刀：

1. 继续 Phase 3：抽 `agentStreamRequestStartController`，把 request start metric 与 activity log payload 从 `agentStreamTurnEventBinding` 中移出。
2. 或抽更细的 `agentStreamUnknownEventController`，把未知 runtime event 活跃态、告警去重与 watchdog 调度从事件绑定主函数中移出。

### 2026-05-05：P3 第二十一刀，Agent stream request start controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamRequestStartController.ts`：
  - `buildAgentStreamRequestStartMetricContext`
  - `buildAgentStreamRequestStartActivityLog`
  - `startAgentStreamRequest`
- `agentStreamTurnEventBinding.ts` 中 request start 阶段改为委托 controller：
  - 统一写入 `requestState.requestStartedAt`。
  - 统一记录 `agentStream.request.start` metric。
  - 统一创建 activity log，并写回 `requestState.requestLogId`。
- 新增 `agentStreamRequestStartController.test.ts`，覆盖 metric context、activity log payload、requestState 写入和 metric/activity 依赖调用。

主线收益：

- Phase 3 的首字链路起点进入独立单测边界；request start、listener bound、submit lifecycle、first event readiness 已分别有 controller。
- `agentStreamTurnEventBinding` 不再直接拼 activity log payload，后续排查首页输入回车慢时可以稳定比较 request start 到 listener / submit / first event 的阶段日志。
- activity log 的 provider 映射、队列标记、auto continue 元数据继续保持原语义，并由单测固定。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamRequestStartController.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/agentStreamRequestStartController.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Request start controller / turn event binding：通过，`9` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`25` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀暂未复跑 `verify:gui-smoke`。本刀仍是纯前端 stream controller 抽取，不改 Tauri command、Bridge、runtime event protocol 或用户可见 UI；继续避免因独立 Rust rebuild 干扰 CPU / 鼠标繁忙问题判断。

下一刀：

1. 继续 Phase 3：抽 `agentStreamUnknownEventController`，把未知 runtime event 活跃态、告警去重与首包标记策略移出。
2. 或抽 `agentStreamInactivityController`，把首包超时、silent recovery、inactivity timeout 的调度与恢复策略进一步收口。

### 2026-05-05：P3 第二十二刀，Agent stream unknown event controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamUnknownEventController.ts`：
  - `buildAgentStreamUnknownEventWarningMessage`
  - `resolveAgentStreamUnknownEventPlan`
  - `rememberAgentStreamUnknownEventWarning`
- `agentStreamTurnEventBinding.ts` 中未知 runtime event 分支改为委托 controller：
  - 无结构化 `type` 时继续忽略。
  - 有 `type` 但 `parseAgentEvent` 不识别时继续标记首包、激活流、调度 inactivity watchdog。
  - 告警文案与去重状态由 controller 统一生成与记录。
- 新增 `agentStreamUnknownEventController.test.ts`，覆盖告警文案、空 event type、首次未知事件计划、重复未知事件去重与告警状态记录。

主线收益：

- Phase 3 继续瘦 `agentStreamTurnEventBinding`：未知 runtime event 的活跃态保留策略不再内联在事件绑定主函数中。
- runtime projection/bootstrap 这类未来扩展事件即使暂未被 parser 识别，也能继续保留首包活跃态，避免 UI 误判首包超时失败。
- 告警去重进入单测保护，避免 provider 高频心跳或 runtime projection 事件刷屏并干扰首字慢日志分析。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamUnknownEventController.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/agentStreamUnknownEventController.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Unknown event controller / turn event binding：通过，`10` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`29` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀暂未复跑 `verify:gui-smoke`。本刀仍是纯前端 stream controller 抽取，不改 Tauri command、Bridge、runtime event protocol 或用户可见 UI；继续避免因独立 Rust rebuild 干扰 CPU / 鼠标繁忙问题判断。

下一刀：

1. 继续 Phase 3：抽 `agentStreamInactivityController`，把首包超时、silent recovery、inactivity timeout 的调度与恢复策略进一步收口。
2. 完成 Phase 3 controller 主链后，回到真实 E2E 指标采集，验证首页输入回车到 first status / first text 的阶段耗时。

### 2026-05-05：P3 第二十三刀，Agent stream inactivity controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamInactivityController.ts`：
  - `AGENT_STREAM_FIRST_EVENT_TIMEOUT_MESSAGE`
  - `AGENT_STREAM_INACTIVITY_TIMEOUT_MESSAGE`
  - `buildAgentStreamFirstEventSilentRecoveryWarning`
  - `buildAgentStreamFirstEventDeferredWarning`
  - `buildAgentStreamInactivitySilentRecoveryWarning`
  - `resolveAgentStreamFirstEventTimeoutAction`
  - `resolveAgentStreamInactivityTimeoutAction`
- `agentStreamTurnEventBinding.ts` 中首包超时和 inactivity timeout 恢复策略改为委托 controller：
  - 首包超时后按 `ignore / recover / defer / fail` 执行动作。
  - inactivity timeout 后按 `ignore / recover / fail` 执行动作。
  - silent recovery 与 deferred warning 文案统一从 controller 生成。
  - 用户可见失败文案统一从 controller 常量读取。
- 新增 `agentStreamInactivityController.test.ts`，覆盖用户文案、warning 文案、首包超时动作决策与 inactivity timeout 动作决策。

主线收益：

- Phase 3 的首字慢异常恢复链路进一步可测试：首包无事件、后台已恢复、提交已派发但首包暂未到达、首包后长时间静默都进入明确 action plan。
- `agentStreamTurnEventBinding` 不再内联 silent recovery / timeout 文案与动作优先级，后续调整 TTFT 阈值或恢复策略时风险更小。
- 首包 deferred 与 inactivity synthetic error 的用户文案保持原语义，避免本轮结构拆分改变用户可见行为。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamInactivityController.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/agentStreamInactivityController.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Inactivity controller / turn event binding：通过，`10` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`33` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀暂未复跑 `verify:gui-smoke`。本刀仍是纯前端 stream controller 抽取，不改 Tauri command、Bridge、runtime event protocol 或用户可见 UI；继续避免因独立 Rust rebuild 干扰 CPU / 鼠标繁忙问题判断。

下一刀：

1. Phase 3 controller 主链完成后，回到真实 E2E 指标采集，验证首页输入回车到 first status / first text 的阶段耗时。
2. 若 E2E 仍显示首字慢在事件处理后段，再进入 `streamEventReducer` 拆分；若慢在 render，再进入 Phase 4 render projection。

### 2026-05-05：P3 E2E 指标采集准备与阻塞记录

已完成：

- 确认现有前端壳与 DevBridge 已就绪，未启动新的 GUI / Rust 进程：

```bash
curl -fsS "http://127.0.0.1:1420/"
npm run bridge:health -- --timeout-ms 120000
```

结果：

- 前端 `http://127.0.0.1:1420/` 可访问。
- DevBridge `http://127.0.0.1:3030/health` 就绪，`status=ok`，健康检查耗时 `33ms`。

阻塞：

- Playwright MCP 当前无法接管浏览器，报错为 profile 已被 `/Users/coso/Library/Caches/ms-playwright/mcp-chrome-348597d` 占用；按仓库规则未使用 `--isolated` 绕过。
- 已检查 Chrome 现有页签，存在 `http://127.0.0.1:1420/` 的 `Lime` 页签。
- AppleScript 可读取 Chrome 页签 URL / title，但 Chrome 未开启“允许 Apple 事件中的 JavaScript”，无法执行 `window.__LIME_AGENTUI_PERF__?.summary()` 采集页面指标。
- 未结束或清理现有 MCP / Chrome 进程，避免破坏用户或其他 agent 的浏览器会话。

下一次续测条件：

1. 关闭占用 `mcp-chrome-348597d` 的旧 Playwright MCP 会话，或由用户确认允许清理这些 MCP 进程。
2. 或在现有 Chrome 中开启 `查看 -> 开发者 -> 允许 Apple 事件中的 JavaScript`，允许只读执行 `window.__LIME_AGENTUI_PERF__?.summary()`。
3. 恢复后按 `docs/roadmap/agentui/conversation-projection-acceptance.md` 采集：首页短 prompt -> conversation shell -> first runtime status -> first text delta/paint。

### 2026-05-05：P3 第二十四刀，Agent stream runtime metrics controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.ts`：
  - `shouldRecordAgentStreamFirstRuntimeStatus`
  - `shouldRecordAgentStreamFirstTextDelta`
  - `buildAgentStreamFirstRuntimeStatusMetricContext`
  - `buildAgentStreamFirstTextDeltaMetricContext`
- `agentStreamRuntimeHandler.ts` 中 first runtime status / first text delta 指标记录改为委托 controller：
  - first runtime status 的 elapsed、first event delta、phase、title、session 统一生成。
  - first text delta 的 delta chars、elapsed、first event delta、first runtime status delta、session 统一生成。
  - 一次性记录判断进入单测，避免重复 text delta 或重复 runtime status 污染 TTFT 指标。
- 新增 `agentStreamRuntimeMetricsController.test.ts`，覆盖 first status/text delta 是否记录、指标上下文和缺失前置阶段时的 null delta。

主线收益：

- Phase 3 的首字链路后段继续可测试：`request start -> listener -> submit -> first event -> first runtime status -> first text delta` 的指标上下文已基本从主函数中拆出。
- 后续 E2E 恢复后，`window.__LIME_AGENTUI_PERF__` 的阶段指标更容易对应到 controller 单测，便于判断慢点在 runtime bridge、provider 首包、事件处理还是 render。
- `agentStreamRuntimeHandler` 开始为 `streamEventReducer` 拆分做前置减法，先抽指标与判断，不一次性重写大 switch，降低回归风险。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Runtime metrics controller / runtime handler：通过，`15` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`48` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀仍未做真实页面交互。阻塞同前：Playwright MCP profile 被占用，且 Chrome 未开启 AppleScript JS 执行能力。
- 前端与 DevBridge 健康态已在上一条记录确认；未启动新的 GUI / Rust 进程。

下一刀：

1. 恢复 E2E 后采集 `firstRuntimeStatus / firstTextDelta / firstTextPaint` 指标，确认慢点是否仍在事件处理后段。
2. 若仍无法恢复 E2E，就继续小步拆 `agentStreamRuntimeHandler` 中 text delta flush / runtime status apply 的 reducer 边界。

### 2026-05-05：P3 第二十五刀，Agent stream runtime status controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamRuntimeStatusController.ts`：
  - `buildAgentStreamNormalizedRuntimeStatus`
  - `buildAgentStreamRuntimeStatusApplyPlan`
  - `selectAgentStreamRuntimeSummaryItem`
  - `buildAgentStreamRuntimeSummaryItemUpdate`
- `agentStreamRuntimeHandler.ts` 中 `runtime_status` apply 逻辑改为委托 controller：
  - runtime status title 归一化。
  - runtime summary 文案生成。
  - pending summary item 优先选择。
  - pending item 存在但不是 `turn_summary` 时保持原行为，不回退其他 summary。
  - 无 pending item 时选择同 session 最新 in-progress summary。
- 新增 `agentStreamRuntimeStatusController.test.ts`，覆盖 status apply plan、pending summary 优先级、pending 非 summary 不回退、fallback 最新 summary 与 summary item 更新。

主线收益：

- Phase 3 继续为 `streamEventReducer` 拆分做前置减法：`runtime_status` 的状态归一化与 thread summary 更新策略不再内联在 `agentStreamRuntimeHandler` 大 switch 中。
- 首字前状态展示路径更可测，后续 E2E 若显示 first runtime status 已到但 UI 状态慢，可直接定位到 status apply / render，而不是混在事件处理主函数里。
- 保留 pending 非 summary 不回退的旧行为，避免结构拆分顺手改变 runtime summary 选择语义。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Runtime status controller / runtime handler：通过，`16` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`53` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀仍未做真实页面交互。阻塞同前：Playwright MCP profile 被占用，且 Chrome 未开启 AppleScript JS 执行能力。
- 未启动新的 GUI / Rust 进程，不干扰用户当前浏览器会话。

下一刀：

1. 恢复 E2E 后采集 `firstRuntimeStatus / firstTextDelta / firstTextPaint` 指标，确认首字慢是否仍在事件处理后段。
2. 若 E2E 仍无法恢复，继续拆 `agentStreamRuntimeHandler` 中 text delta flush 或 final_done reconcile 的 reducer 边界。

### 2026-05-05：P3 第二十六刀，Agent stream text delta controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamTextDeltaController.ts`：
  - `buildAgentStreamTextDeltaApplyPlan`
- `agentStreamRuntimeHandler.ts` 中 `text_delta` apply 前半段改为委托 controller：
  - text delta buffer 计数。
  - 首个 text delta 的时间戳和 metric context。
  - accumulated content 的 overlap append 计划。
  - observer 仍收到原始 delta 和合并后的 accumulated content。
  - typewriter sound 与 text render flush 调度保持原位置，不改变渲染节流行为。
- 新增 `agentStreamTextDeltaController.test.ts`，覆盖首个 text delta 指标、非首个 delta 不重复记录、overlap detection 防重复吐字。

主线收益：

- Phase 3 继续为 `streamEventReducer` 拆分做前置减法：`text_delta` 的 buffer / first delta metric / overlap append 逻辑不再内联在 runtime handler 大 switch 中。
- 重复吐字问题的关键防线进入独立 controller 单测，后续调整流式 flush 或 final_done reconcile 时更不容易破坏。
- 首字链路的 first text delta metric 与实际 accumulated content 更新绑定在同一个 apply plan，便于后续 E2E 对齐 `firstTextDelta` 与 `firstTextPaint`。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamTextDeltaController.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/components/agent/chat/hooks/agentStreamTextDeltaController.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Text delta controller / runtime handler：通过，`14` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`56` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀仍未做真实页面交互。阻塞同前：Playwright MCP profile 被占用，且 Chrome 未开启 AppleScript JS 执行能力。
- 未启动新的 GUI / Rust 进程，不干扰用户当前浏览器会话。

下一刀：

1. 恢复 E2E 后采集 `firstTextDelta / firstTextPaint` 指标，确认首字慢是否仍在 text render flush。
2. 若 E2E 仍无法恢复，继续拆 text render flush 或 final_done reconcile 的 reducer 边界。

### 2026-05-05：P3 第二十七刀，Agent stream text render flush controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamTextRenderFlushController.ts`：
  - `resolveAgentStreamPendingRenderedTextDelta`
  - `shouldFlushAgentStreamVisibleFirstText`
  - `shouldScheduleAgentStreamTextRenderTimer`
  - `buildAgentStreamTextRenderFlushPlan`
  - `buildAgentStreamFirstTextPaintContext`
- `agentStreamRuntimeHandler.ts` 中 `flushPendingTextRender / scheduleTextRenderFlush` 改为委托 controller：
  - 首个可见文本继续立即 flush，不等待 32ms timer。
  - 后续 text render flush 继续保持 `TEXT_DELTA_RENDER_FLUSH_MS=32` 节流。
  - first text render flush、first text paint、backlog、flush count、debug dedupe key 由 plan 统一计算。
  - `requestState.renderedContent / textDeltaFlushCount / lastTextRenderFlushAt / maxTextDeltaBacklogChars / firstTextPaintScheduled` 仍在 handler 中作为副作用写回。
- 新增 `agentStreamTextRenderFlushController.test.ts`，覆盖待渲染 delta 解析、首字立即 flush 判定、timer 调度、首个 render flush plan、非首 flush 不重复 first metric、first paint metric context。

主线收益：

- Phase 3 继续为 `streamEventReducer` 拆分做前置减法：文本可见渲染 flush 的决策、指标和日志上下文不再内联在 `agentStreamRuntimeHandler` 大函数中。
- 首字链路后半段现在可单独测试：`firstTextDelta -> firstTextRenderFlush -> firstTextPaint` 的延迟可以从 controller plan 与 E2E 指标对齐分析。
- 保留“首个可见文本立即 flush、后续 32ms 节流”的当前性能语义，不引入 UI 协议变化或新队列。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Text render flush controller / runtime handler：通过，`16` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`61` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未做真实页面交互。它是纯前端 stream controller 抽取，不改 Tauri command、Bridge、runtime event protocol 或用户可见 UI。
- 仍避免启动新的 GUI / Rust 进程，防止干扰用户正在观察的 CPU / 鼠标繁忙问题。

下一刀：

1. 先补本刀 `git diff --check` 后收口；随后恢复 E2E 后采集 `firstTextDelta / firstTextRenderFlush / firstTextPaint / textDeltaFlushCount / maxTextDeltaBacklogChars`。
2. 若 E2E 仍显示慢在事件处理后段，继续拆 `final_done` reconcile / completion reducer；若慢在 render，则进入 Phase 4 render projection 或 Markdown hydrate 分批。

### 2026-05-05：P3 第二十八刀，Agent stream completion controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamCompletionController.ts`：
  - `isAgentStreamEmptyFinalReplyError`
  - `shouldFailAgentStreamMissingFinalReply`
  - `resolveAgentStreamGracefulCompletionContent`
  - `reconcileAgentStreamFinalContentParts`
  - 空最终回复错误文案常量。
- `agentStreamRuntimeHandler.ts` 中 `final_done` 与 empty-final-error 降级分支改为委托 completion controller：
  - 空最终回复失败判定不再在 `final_done` 分支内联计算。
  - graceful completion 内容继续先剥离 assistant protocol residue，再按原逻辑回退 raw / fallback。
  - 最终 `contentParts` reconcile 继续保留过程 part、按 `surfaceThinkingDeltas` 过滤 thinking，并在最终文本变化时重建 text part。
- 新增 `agentStreamCompletionController.test.ts`，覆盖 empty-final-error 识别、空回复失败判定、meaningful completion signal 降级、协议残留 fallback、最终 contentParts reconcile 与 thinking 过滤。

主线收益：

- Phase 3 继续收窄 `agentStreamRuntimeHandler` 大 switch：完成态的纯判断和最终消息内容计划已进入独立 controller，后续再拆副作用 action 时不需要同时搬协议残留和 contentParts 细节。
- 重复吐字 / 排版问题的完成态防线更清晰：`text_delta` 负责 overlap append，`text render flush` 负责可见增量，`completion` 负责最终文本与 contentParts 对齐。
- 保留现有行为，不改变 runtime event protocol、toast 文案或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Completion controller / runtime handler：通过，`16` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`66` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未做真实页面交互。它仍是纯前端 stream controller 抽取，不改 Tauri command、Bridge、runtime event protocol 或用户可见 UI。
- 未启动新的 GUI / Rust 进程，避免干扰用户当前 CPU / 鼠标繁忙观察。

下一刀：

1. 补本刀 `git diff --check` 后，优先恢复 E2E 指标采集，确认首页 Enter 到 `firstRuntimeStatus / firstTextDelta / firstTextPaint` 的真实分段。
2. 若仍无法 E2E，就把 completion/error 的副作用路径包装成更薄的 reducer action，或开始拆 `agentStreamRuntimeHandler` 的 tool event apply 边界。

### 2026-05-05：P3 第二十九刀，Agent stream tool completion signal controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.ts`：
  - `hasMeaningfulAgentStreamToolCompletionSignal`
  - 内部统一把 normalized tool result 转为 record。
  - 复用站点保存信号、图片任务预览、通用任务预览与 artifact 预览作为 meaningful completion signal 判断来源。
- `agentStreamRuntimeHandler.ts` 的 `tool_end` 分支改为委托 tool completion signal controller：
  - handler 不再直接依赖 `siteToolResultSummary` 与 `taskPreviewFromToolResult` 的多种预览构造函数。
  - 仍只在 tool result 真实可展示/可恢复时设置 `requestState.hasMeaningfulCompletionSignal`。
- 新增 `agentStreamToolCompletionSignalController.test.ts`，覆盖站点保存 metadata、图片任务 metadata 与普通空结果。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的横向依赖：tool result 是否能支撑“无最终文本但过程有产物”的完成语义进入独立 controller。
- completion controller 与 tool completion signal controller 分工更清楚：前者处理最终内容/协议残留，后者处理工具产物是否构成可降级完成信号。
- 后续排查“模型未输出最终答复但 UI 是否应显示失败”时，可以单测 tool result 信号，不需要跑完整 stream handler。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
npm run bridge:health -- --timeout-ms 120000
```

结果：

- Tool completion signal / completion / runtime handler：通过，`19` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`69` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- DevBridge health：通过，`77ms` 就绪。

GUI / E2E 状态：

- 已尝试进入 Playwright MCP 续测，但当前 MCP Chrome profile 仍被占用：`Browser is already in use for /Users/coso/Library/Caches/ms-playwright/mcp-chrome-348597d, use --isolated to run multiple instances of the same browser`。
- 按 `docs/aiprompts/playwright-e2e.md` 约束，本轮没有使用 `--isolated`，也没有 kill/清理现有 Chrome 或 MCP 进程。

下一刀：

1. 等 Playwright MCP profile 可复用后，优先采集首页 Enter 到 `firstRuntimeStatus / firstTextDelta / firstTextPaint` 的真实分段。
2. 如果仍无法 E2E，继续把 `agentStreamRuntimeHandler` 的 error/final completion 副作用或 tool event apply 拆成更小 action plan。

### 2026-05-05：P3 第三十刀，Agent stream error controller

已完成：

- 进入 Playwright MCP 前先执行 `npm run bridge:health -- --timeout-ms 120000`，DevBridge `111ms` 就绪。
- 再次尝试复用 Playwright MCP 当前浏览器会话，仍被 MCP Chrome profile lock 阻塞：`Browser is already in use for /Users/coso/Library/Caches/ms-playwright/mcp-chrome-348597d, use --isolated to run multiple instances of the same browser`。
- 按续遵守 `docs/aiprompts/playwright-e2e.md`：没有使用 `--isolated`，没有 kill/清理现有 Chrome 或 MCP 进程。
- 新增 `src/components/agent/chat/hooks/agentStreamErrorController.ts`：
  - `buildAgentStreamErrorToastPlan`
  - `buildAgentStreamFailedAssistantMessagePatch`
- `agentStreamRuntimeHandler.ts` 的 missing final failure 与普通 error 分支改为委托 error controller：
  - rate limit / 429 toast level 与文案不再在 handler 内联判断。
  - 失败 assistant 消息的 `content / runtimeStatus / isThinking / usage` patch 不再在 handler 重复组装。
  - `markFailedTimelineState` 仍保留在 handler 内，继续负责 thread turn / item 的副作用写回。
- 新增 `agentStreamErrorController.test.ts`，覆盖 rate limit warning、普通 error toast、保留局部输出的失败消息 patch、无局部输出时回退 previous content 与 usage 带回。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的 error 分支：展示决策和失败消息 patch 进入纯 controller，handler 只保留必要副作用顺序。
- 首字/流式链路出错时更容易定位：runtime event、completion fallback、tool completion signal、error presentation 已分别可单测。
- 保留现有 UI 文案与失败状态语义，不改变 runtime event protocol、Tauri command 或 Bridge。

已验证：

```bash
npm run bridge:health -- --timeout-ms 120000
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Error controller / runtime handler：通过，`15` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`73` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- DevBridge health：通过，`111ms` 就绪。

GUI / E2E 状态：

- 真实页面交互仍未完成，停留在 MCP profile lock 阶段；当前没有可报告的页面 URL / 控制台 error 增量 / 首页 Enter 指标。
- 本刀是纯前端 stream controller 抽取，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；因此未启动 `verify:gui-smoke`，避免 Rust rebuild 干扰 CPU / 鼠标繁忙观察。

下一刀：

1. 等 Playwright MCP profile 可复用后，优先恢复 E2E 采集首页 Enter 到 `firstRuntimeStatus / firstTextDelta / firstTextPaint` 的真实分段。
2. 若 E2E 继续不可用，继续拆 `agentStreamRuntimeHandler` 中 warning / queued draft / thread item 高频事件的纯 action plan，而不是扩大到 GUI 重构。

### 2026-05-05：P3 第三十一刀，Agent stream warning controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamWarningController.ts`：
  - `buildAgentStreamWarningPlan`
  - 统一 workspace auto-created warning 忽略、warning key 生成、已提示去重、shouldToast 判断与 toast level/message plan。
- `agentStreamRuntimeHandler.ts` 的 `warning` 分支改为委托 warning controller：
  - handler 不再直接依赖 `WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE` 与 `resolveRuntimeWarningToastPresentation`。
  - handler 只保留 `warnedKeysRef` 写入与 `toast.info/error/warning` 副作用。
  - 保留现有语义：不需要 toast 的 warning 仍会标记 warned，避免后续重复处理。
- 新增 `agentStreamWarningController.test.ts`，覆盖 workspace auto-created 忽略、重复 warning 不 toast、普通 warning toast plan、不 toast warning 仍标记 warned。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的低频分支：warning 事件的忽略/去重/展示决策进入纯 controller。
- 当前 stream handler 中首字、运行态、文本增量、渲染 flush、完成态、tool completion signal、error、warning 都已有独立可测边界。
- 保留现有 UI 文案与 warning 去重语义，不改变 runtime event protocol、Tauri command 或 Bridge。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Warning controller / runtime handler：通过，`15` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`77` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未重新进入 Playwright；上一刀已经确认 MCP profile lock 阻塞仍在。
- 本刀是纯前端 stream controller 抽取，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复 E2E 指标采集。
2. 若继续做代码小刀，优先拆 queued draft / thread item 高频事件的 action plan，或开始把 `handleToolStartEvent / handleToolEndEvent` 周边状态写回收敛成更薄边界。

### 2026-05-05：P3 最终收口，stream controller 阶段验证边界

收口结论：

- 本阶段 Phase 3 代码侧已完成一组可测 controller 拆分：submit、listener readiness、request start、unknown event、inactivity、runtime metrics、runtime status、text delta、text render flush、completion、tool completion signal、error、warning。
- `agentStreamRuntimeHandler.ts` 仍保留必要 UI / thread / toast 副作用顺序，但首字链路、重复吐字防线、完成态降级、错误与 warning 展示决策都已从大 switch 中移出。
- 最后一次尝试 Playwright MCP 仍失败于 profile lock：`Browser is already in use for /Users/coso/Library/Caches/ms-playwright/mcp-chrome-348597d, use --isolated to run multiple instances of the same browser`。
- 按续遵守 GUI 续测约束：没有使用 `--isolated`，没有 kill / 清理用户当前 Chrome 或 MCP 进程。

最终验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
```

结果：

- Agent stream Phase 3 定向回归最终复跑：通过，`19` 个测试文件、`77` 个测试通过。
- 本阶段最近一次静态验证已通过：ESLint touched files、TypeScript `tsc --noEmit --pretty false`、`git diff --check`。

未完成边界：

- 真实 GUI / Playwright E2E 仍未完成；缺少首页 Enter 到 `firstRuntimeStatus / firstTextDelta / firstTextPaint` 的最终实测数据。
- 因此本阶段只能判定“stream controller 代码拆分与定向回归完成”，不能判定“GUI 体感性能已最终交付”。

下一步最短路径：

1. 释放或复用 Playwright MCP profile 后，立即采集首页 Enter / 旧会话打开的真实性能 summary。
2. 若 `firstTextPaint` 已快但仍卡，转向 render / Markdown hydrate；若 `firstTextDelta` 慢，转 provider / runtime；若 `submitAccepted` 前慢，回查 session ensure / listener bind。

### 2026-05-05：P3 第三十二刀，Agent stream queue controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamQueueController.ts`：
  - `buildAgentStreamQueuedDraftMessagePatch`
  - `shouldWatchAgentStreamQueuedDraftCleanup`
  - `shouldWatchAgentStreamQueuedDraftCleanupForCleared`
- `agentStreamRuntimeHandler.ts` 的 queued draft / queue removed / queue cleared 分支改为委托 queue controller：
  - queued draft 的 `isThinking=false` 与 queued runtime status patch 不再在 handler 内联组装。
  - queue removed / cleared 后是否继续观察当前 queued draft 的判断不再散落在 switch case 中。
  - handler 仍保留 `requestState.queuedTurnId`、queued turn store、draft cleanup timer 等副作用顺序。
- 新增 `agentStreamQueueController.test.ts`，覆盖 queued message text 优先、content fallback、单个 removed 与 cleared 覆盖当前 draft 的判断。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的 queue 分支：排队态展示与 cleanup watch 判定进入纯 controller。
- 首页 Enter / 多 tab / busy 会话场景依赖 `queueIfBusy` 与 queued draft 展示；该语义现在有独立单测保护，后续排查“新建/旧会话切换后无法继续输入”时更好定位。
- 保留现有 queue 行为，不改变 runtime event protocol、Tauri command、Bridge 或用户可见文案。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamQueueController.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Queue controller / runtime handler：通过，`15` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`20` 个测试文件、`81` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在。
- 本刀仍是纯前端 stream controller 抽取，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复真实 E2E 指标采集。
2. 如果继续代码拆分，下一刀只看 thread item 高频事件的 action plan，不再扩大到无关 UI 重构。

### 2026-05-05：P3 第三十三刀，Agent stream thread item controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamThreadItemController.ts`：
  - `shouldDeferAgentStreamThreadItemUpdate`
  - `buildAgentStreamTurnStartedPendingItemUpdate`
- `agentStreamRuntimeHandler.ts` 的 `turn_started` 与 `item_updated` 分支改为委托 thread item controller：
  - in-progress `reasoning / agent_message` 高频更新延后判断不再内联在 handler。
  - `turn_started` 时 pending item 绑定真实 `thread_id / turn_id / updated_at` 的 patch 不再内联组装。
  - handler 仍保留 `setThreadItems`、remove/upsert 顺序与其它 runtime 副作用。
- 新增 `agentStreamThreadItemController.test.ts`，覆盖 reasoning / agent_message 延后、非文本/已完成 item 不延后、pending item 绑定真实 turn、无 pending item 返回空。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的 thread item 分支：高频更新策略与 turn_started pending patch 进入纯 controller。
- 旧会话恢复与流式过程中 thread item 数量大时，最容易产生同步计算和状态写入压力；这条延后策略现在有独立单测保护。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge 或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamThreadItemController.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Thread item controller / runtime handler：通过，`15` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`21` 个测试文件、`85` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在。
- 本刀仍是纯前端 stream controller 抽取，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复真实 E2E 指标采集。
2. 如果继续代码拆分，只看 tool / artifact / action event apply 的薄 action plan，避免偏离主线。

### 2026-05-05：P3 第三十四刀，Agent stream tool event controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamToolEventController.ts`：
  - `buildAgentStreamToolEndPreApplyPlan`
  - 统一 `tool_end` 前置的 `normalizeIncomingToolResult`、`toolNameByToolId` lookup 与 meaningful completion signal 判断。
- `agentStreamRuntimeHandler.ts` 的 `tool_end` 分支改为委托 tool event controller：
  - handler 不再直接依赖 `normalizeIncomingToolResult` 与 `hasMeaningfulAgentStreamToolCompletionSignal`。
  - handler 仍只在 plan 标记 `hasMeaningfulCompletionSignal` 时写回 `requestState.hasMeaningfulCompletionSignal`。
  - `handleToolEndEvent` 的原始副作用路径保持不变，避免改变工具结果展示、文件写入和消息更新顺序。
- 新增 `agentStreamToolEventController.test.ts`，覆盖 tool name lookup、Lime metadata block 归一化、图片任务 meaningful completion 与普通 result 不标记。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的 tool_end 分支：工具完成前置判断进入纯 controller。
- “有工具产物但模型未输出最终文本”这条降级完成语义现在由 tool completion signal 与 tool event pre-apply plan 共同保护。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、文件写入或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamToolEventController.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Tool event controller / runtime handler：通过，`14` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`22` 个测试文件、`88` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在。
- 本刀仍是纯前端 stream controller 抽取，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复真实 E2E 指标采集。
2. 如果继续代码拆分，只看 artifact / action event apply 的薄 action plan，避免偏离主线。

### 2026-05-05：P3 第三十五刀，Agent stream artifact/action controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamArtifactActionController.ts`：
  - `buildAgentStreamArtifactSnapshotPreApplyPlan`
  - `buildAgentStreamActionRequiredPreApplyPlan`
- `agentStreamRuntimeHandler.ts` 的 `artifact_snapshot / action_required` 分支改为委托 artifact/action controller：
  - `artifact_snapshot` 前置的 activate stream、清 optimistic item、meaningful completion signal 标记进入 plan。
  - `action_required` 前置的 activate stream、清 optimistic item 进入 plan。
  - `handleArtifactSnapshotEvent / handleActionRequiredEvent` 的原始副作用路径保持不变。
- 新增 `agentStreamArtifactActionController.test.ts`，覆盖 artifact snapshot 前置计划、空 artifact 仍保持完成信号语义、action required 前置计划。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的 artifact/action 分支：事件前置副作用决策进入纯 controller。
- artifact snapshot 仍作为 meaningful completion signal，保护“有产物但模型未输出最终文本”的降级完成语义。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、文件写入、权限确认或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamArtifactActionController.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Artifact/action controller / runtime handler：通过，`14` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`23` 个测试文件、`91` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在。
- 本刀仍是纯前端 stream controller 抽取，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复真实 E2E 指标采集。
2. 如果继续代码拆分，只看 context trace / turn context / model change event apply 的薄 action plan，避免偏离主线。

### 2026-05-05：P3 第三十六刀，Agent stream runtime context controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamRuntimeContextController.ts`：
  - `buildAgentStreamContextTracePreApplyPlan`
  - `buildAgentStreamTurnContextPreApplyPlan`
  - `buildAgentStreamModelChangePreApplyPlan`
  - `applyAgentStreamTurnContextExecutionRuntime`
  - `applyAgentStreamModelChangeExecutionRuntime`
- `agentStreamRuntimeHandler.ts` 的 `context_trace / turn_context / model_change` 分支改为委托 runtime context controller：
  - `context_trace` 前置 activate stream / clear optimistic item 进入 plan。
  - `turn_context / model_change` 前置 activate stream 进入 plan。
  - execution runtime apply 通过 controller wrapper 进入 handler，原有 apply 语义不变。
  - `handleContextTraceEvent` 与 `setExecutionRuntime` 副作用顺序保持不变。
- 新增 `agentStreamRuntimeContextController.test.ts`，覆盖 context trace latest stage、turn context runtime apply、model change runtime apply 与当前 turn 状态保留。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的 context/runtime 分支：上下文轨迹与 execution runtime 更新前置决策进入纯 controller。
- 首字链路中 `turn_context / model_change` 到达后，runtime 恢复状态仍受现有 utility 保护，同时可通过 controller 单测定位。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、execution runtime 结构或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamRuntimeContextController.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Runtime context controller / runtime handler：通过，`14` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`24` 个测试文件、`94` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在。
- 本刀仍是纯前端 stream controller 抽取，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复真实 E2E 指标采集。
2. 如果继续代码拆分，只看 thinking delta 或 final side-effect action 的薄 action plan，避免偏离主线。

### 2026-05-05：P3 第三十七刀，Agent stream thinking delta controller

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts`：
  - `buildAgentStreamThinkingDeltaPreApplyPlan`
  - `buildAgentStreamThinkingDeltaMessagePatch`
- `agentStreamRuntimeHandler.ts` 的 `thinking_delta` 分支改为委托 thinking delta controller：
  - 前置 activate stream 与 `surfaceThinkingDeltas` guard 进入 plan。
  - thinkingContent 的 overlap append 与 contentParts thinking append 进入消息 patch。
  - handler 仍保留 `setMessages` 副作用与 assistant message id 过滤顺序。
- 新增 `agentStreamThinkingDeltaController.test.ts`，覆盖 surface guard、overlap append、contentParts 追加和无 contentParts 时的默认追加。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的 thinking 分支：思考流的显示开关与消息 patch 进入纯 controller。
- 重复吐字防线从 text delta 扩展到 thinking delta，thinkingContent 的 overlap append 现在有独立单测保护。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、thinking 展示开关或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Thinking delta controller / runtime handler：通过，`14` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`25` 个测试文件、`97` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在。
- 本刀仍是纯前端 stream controller 抽取，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复真实 E2E 指标采集。
2. 如果继续代码拆分，只看 final side-effect action 的薄 action plan，避免偏离主线。

### 2026-05-05：P3 第三十八刀，Agent stream completion assistant patch 收口

已完成：

- 扩展 `src/components/agent/chat/hooks/agentStreamCompletionController.ts`：
  - 新增 `buildAgentStreamCompletedAssistantMessagePatch`，统一完成态 assistant 消息的 `content / contentParts / usage / runtimeStatus / isThinking` patch。
  - 复用 `reconcileAgentStreamFinalContentParts`，保持协议残留清理、thinking part 过滤与最终 text part 重建语义不变。
- `agentStreamRuntimeHandler.ts` 的 `final_done` 与 empty-final graceful completion 分支改为委托 completion controller 生成 assistant message patch：
  - handler 仍只保留队列清理、request log、observer complete、listener dispose 等副作用编排。
  - 完成态消息 patch 不再在 handler 内联拼装，降低流式完成分支与重复吐字 / 排版回归的耦合。
- `agentStreamCompletionController.test.ts` 新增完成态 assistant patch 回归，覆盖 usage 带回和最终文本重建。
- 验证门禁顺手收口 `src/lib/activeContentTarget.ts` 的输入类型：
  - `setActiveContentTarget` 允许接收任意 canvas type 字符串，再通过既有 `normalizeThemeCanvasType` 收敛到 `document / video / null`。
  - 这只解除 `DesignCanvasState.type === "design"` 对 workspace typecheck 的阻塞，不扩大 active content target 的 current 事实源范围。

主线收益：

- Phase 3 继续压缩 `agentStreamRuntimeHandler` 的完成分支：完成态 assistant 消息归一进入纯 controller，后续排查 final_done 只需区分“消息 patch”与“副作用编排”。
- 重复吐字 / 输出排版的最终态防线继续集中在 completion controller 单测中，避免 final_done 二次 append 或 thinking part 意外混入正文。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、active target 持久化格式或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Agent stream Phase 3 定向回归：通过，`25` 个测试文件、`98` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在，且不能使用 `--isolated` 或 kill 用户 Chrome/MCP。
- 本刀仍是纯前端 stream controller 与类型门禁收口，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复首页首发、旧会话打开、首 token 的真实性能采集。
2. 如果继续代码拆分，只看 `final_done` 日志 / 队列清理 / listener dispose 的 side-effect plan；若 E2E 指标显示慢在 render，则转回 Phase 4 render projection。

### 2026-05-05：P3 第三十九刀，Agent stream final side-effect plan 收口

已完成：

- 继续扩展 `src/components/agent/chat/hooks/agentStreamCompletionController.ts`：
  - 新增 `buildAgentStreamFinalDonePlan`，统一 `final_done` 的空最终回复失败判断、最终内容解析、queued turn 清理 ID 与 request log payload。
  - 新增 `buildAgentStreamEmptyFinalErrorPlan`，统一 empty-final error 在“无真实产物信号 -> 失败”和“已有真实产物信号 -> 软完成”之间的决策。
- `agentStreamRuntimeHandler.ts` 的完成分支继续变薄：
  - `final_done` 不再内联判断 `shouldFailAgentStreamMissingFinalReply`，只消费 completion plan 后执行副作用。
  - empty-final error 不再内联 queued turn / request log / graceful content 组装，软完成与失败分叉由 controller 决定。
- `agentStreamCompletionController.test.ts` 新增 side-effect plan 回归，覆盖：
  - `final_done` 协议残留清理后的完成计划。
  - 缺少最终回复的失败计划和 usage 保留。
  - empty-final error 在无产物信号与有产物信号两种情况下的分叉。

主线收益：

- Phase 3 的 `final_done` 链路进一步拆成“纯决策 plan + handler 副作用执行”，首字 / 流式完成慢点排查时可以把 completion 语义与 React state / listener cleanup 分开看。
- “空 final_done / 工具有产物但无最终文本 / 协议残留清理”继续收敛到同一个 current controller，避免重复吐字、排版错乱或空回复误报在 handler 中回流。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
```

结果：

- Completion controller / runtime handler：通过，`2` 个测试文件、`20` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`25` 个测试文件、`101` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在，且不能使用 `--isolated` 或 kill 用户 Chrome/MCP。
- 本刀仍是纯前端 stream controller 收口，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复首页首发、旧会话打开、首 token 的真实性能采集。
2. 如果继续代码拆分，只看 `error` 分支失败完成 side-effect plan；若 E2E 指标显示慢在 render，则转回 Phase 4 render projection。

### 2026-05-05：P3 第四十刀，Agent stream error failure side-effect plan 收口

已完成：

- 继续扩展 `src/components/agent/chat/hooks/agentStreamErrorController.ts`：
  - 新增 `buildAgentStreamErrorFailurePlan`，统一普通 runtime error 的错误文案、queued turn 清理 ID、request log payload 与 toast plan。
  - 复用既有 `buildAgentStreamErrorToastPlan`，保持 rate limit -> warning toast、普通错误 -> runtime error toast 的展示语义不变。
- `agentStreamRuntimeHandler.ts` 的普通 `error` 分支继续变薄：
  - handler 不再内联 `queuedTurnId ? [queuedTurnId] : []`、`chat_request_error` payload 或 toast plan 组装。
  - handler 只消费 error failure plan 后执行 timeline 标失败、队列清理、request log、observer、toast、assistant message patch 与 listener dispose。
- `agentStreamErrorController.test.ts` 新增失败 side-effect plan 回归，覆盖普通错误和 rate limit toast 降级。

主线收益：

- Phase 3 的普通错误链路继续收敛到 current controller：error 分支的“失败语义决策”和 handler 的“副作用执行”分离，后续排查首 token / 流式中断时更容易定位慢点或错态来源。
- `agentStreamRuntimeHandler` 中普通 error 分支不再重复拼 queued turn、request log 与 toast，减少后续修空 final / rate limit / provider error 时互相踩语义的风险。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Error controller / runtime handler：通过，`2` 个测试文件、`17` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`25` 个测试文件、`103` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在，且不能使用 `--isolated` 或 kill 用户 Chrome/MCP。
- 本刀仍是纯前端 stream controller 收口，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复首页首发、旧会话打开、首 token 的真实性能采集。
2. 如果继续代码拆分，只看 `warning` toast 执行 plan 或 `markFailedTimelineState` 的 timeline failure plan；若 E2E 指标显示慢在 render，则转回 Phase 4 render projection。

### 2026-05-05：P3 第四十一刀，Agent stream failed timeline plan 收口

已完成：

- 继续扩展 `src/components/agent/chat/hooks/agentStreamErrorController.ts`：
  - 新增 `selectAgentStreamFailedTimelineTurn`，统一 pending turn 优先、当前会话最后一个 running turn 回退的选择策略。
  - 新增 `buildAgentStreamFailedTimelineTurnUpdate`，统一 running turn 失败态 patch。
  - 新增 `buildAgentStreamFailedTimelineItemUpdate`，统一 pending `turn_summary` 失败态 patch 和失败 runtime summary 文案。
- `agentStreamRuntimeHandler.ts` 的 `markFailedTimelineState` 继续变薄：
  - handler 不再内联查找 running turn。
  - handler 不再内联构造 failed runtime status summary。
  - handler 只负责把 controller 产出的 turn / item update 写回 `upsertThreadTurnState` / `upsertThreadItemState`。
- `agentStreamErrorController.test.ts` 新增 failed timeline plan 回归，覆盖：
  - pending turn 优先。
  - pending turn 缺失时回退当前 session 最后一个 running turn。
  - `turn_summary` 失败 patch 保留已有 `completed_at`。
  - pending item 缺失或不是 `turn_summary` 时跳过更新。

主线收益：

- Phase 3 的错误 timeline 更新继续收敛到 current error controller，stream handler 不再同时承担失败语义、timeline 查找与状态 patch 组装。
- 后续排查“流式错误后 timeline 卡在 running / summary 文案不一致 / 错 turn 被标失败”时，可以直接测 controller，不必挂载完整 workspace。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Error controller / runtime handler：通过，`2` 个测试文件、`21` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`25` 个测试文件、`107` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在，且不能使用 `--isolated` 或 kill 用户 Chrome/MCP。
- 本刀仍是纯前端 stream controller 收口，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复首页首发、旧会话打开、首 token 的真实性能采集。
2. 如果继续代码拆分，只看 `warning` toast 执行 plan；若 E2E 指标显示慢在 render，则转回 Phase 4 render projection。

### 2026-05-05：P3 第四十二刀，Agent stream warning toast action 收口

已完成：

- 继续扩展 `src/components/agent/chat/hooks/agentStreamWarningController.ts`：
  - 新增 `buildAgentStreamWarningToastAction`，把 warning plan 的 toast payload 归一为可执行 action。
  - 新增 `applyAgentStreamWarningToastAction`，统一 `info / warning / error` dispatcher 调用。
- `agentStreamRuntimeHandler.ts` 的 `warning` 分支继续变薄：
  - handler 不再内联 `switch (warningPlan.toast.level)`。
  - handler 只负责 warned key 标记，然后把 toast action 交给 warning controller 执行。
- `agentStreamWarningController.test.ts` 新增 warning toast action 回归，覆盖 action 构造、null toast 跳过、不同 level 调用对应 dispatcher。

主线收益：

- Phase 3 的 warning 展示行为继续收敛到 current warning controller，handler 不再承担 toast level 分发细节。
- 后续排查 warning 重复提示、误提示或提示等级不一致时，可以直接测 warning controller，不必进入完整 stream runtime handler。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts" "src/features/knowledge/KnowledgePage.tsx" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts" "src/features/knowledge/KnowledgePage.tsx" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Warning controller / runtime handler：通过，`2` 个测试文件、`17` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`25` 个测试文件、`109` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

附带门禁修复：

- `src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts`：为 `knowledgePackOptions` 显式标注 `InputbarKnowledgePackOption[]`，避免 initial selection fallback 的可选 `status` 被数组推断收窄成必填 string。
- `src/features/knowledge/KnowledgePage.tsx`：移除过期 `getPackTypeLabel` import，保持当前 `getUserFacingPackTypeLabel` 展示路径。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在，且不能使用 `--isolated` 或 kill 用户 Chrome/MCP。
- 本刀仍是纯前端 stream controller 收口，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复首页首发、旧会话打开、首 token 的真实性能采集。
2. 如果继续代码拆分，先盘点 `agentStreamRuntimeHandler` 剩余内部 helper，优先只拆仍影响首字 / 流式错态排查的 current controller plan。

### 2026-05-05：P3 第四十三刀，Agent stream error toast action 收口

已完成：

- 继续扩展 `src/components/agent/chat/hooks/agentStreamErrorController.ts`：
  - 新增 `applyAgentStreamErrorToastPlan`，统一普通 runtime error 的 `warning / error` toast dispatcher 调用。
- `agentStreamRuntimeHandler.ts` 的普通 `error` 分支继续变薄：
  - handler 不再内联 `if (toastPlan.level === "warning")` 判断。
  - handler 只消费 `errorFailurePlan.toast` 并交给 error controller 执行。
- `agentStreamErrorController.test.ts` 新增 error toast dispatcher 回归，覆盖 rate limit warning 与普通 error 两条分发路径。

主线收益：

- Phase 3 的普通 runtime error 展示行为继续收敛到 current error controller，handler 不再承担 toast level 分发细节。
- 后续排查 provider error、rate limit、空 final error 的展示差异时，可以直接测 error / completion controller，而不是进入完整 stream handler。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts" "src/features/knowledge/KnowledgePage.tsx" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts" "src/features/knowledge/KnowledgePage.tsx" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Error controller / runtime handler：通过，`2` 个测试文件、`22` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`25` 个测试文件、`110` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在，且不能使用 `--isolated` 或 kill 用户 Chrome/MCP。
- 本刀仍是纯前端 stream controller 收口，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复首页首发、旧会话打开、首 token 的真实性能采集。
2. 如果继续代码拆分，先盘点 `agentStreamRuntimeHandler` 剩余内部 helper，优先只拆仍影响首字 / 流式错态排查的 current controller plan。

### 2026-05-05：P3 第四十四刀，Agent stream missing final failure plan 收口

已完成：

- 继续扩展 `src/components/agent/chat/hooks/agentStreamCompletionController.ts`：
  - 导出 `AgentStreamMissingFinalReplyPlan`。
  - 新增 `buildAgentStreamMissingFinalReplyFailurePlan`，统一 missing final reply failure 的 `errorMessage / queuedTurnIds / requestLogPayload / toastMessage / usage`。
  - `buildAgentStreamFinalDonePlan` 与 `buildAgentStreamEmptyFinalErrorPlan` 的失败分支改为复用 missing final failure plan。
- `agentStreamRuntimeHandler.ts` 的 `finalizeMissingFinalReplyFailure` 继续变薄：
  - 不再内联 `queuedTurnId ? [queuedTurnId] : []`。
  - 不再内联 `chat_request_error` payload。
  - 不再直接引用空最终回复 toast 常量，只消费 completion controller 产出的 toast message。
- `agentStreamCompletionController.test.ts` 新增 missing final failure plan 回归，覆盖 queued turn 清理、request log payload、toast message 与 usage 保留。

主线收益：

- Phase 3 的空最终回复失败路径继续收敛到 current completion controller；`final_done` 与 empty-final error 的失败副作用参数现在走同一个计划。
- 后续排查“模型无最终文本 / 工具有产物但无 summary / 空 final 误报失败”时，可以直接测 completion controller，不必进入完整 stream handler。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts" "src/features/knowledge/KnowledgePage.tsx" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts" "src/features/knowledge/KnowledgePage.tsx" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Completion controller / runtime handler：通过，`2` 个测试文件、`21` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`25` 个测试文件、`111` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在，且不能使用 `--isolated` 或 kill 用户 Chrome/MCP。
- 本刀仍是纯前端 stream controller 收口，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复首页首发、旧会话打开、首 token 的真实性能采集。
2. 如果继续代码拆分，优先盘点 `markQueuedDraftState` 是否还能以 queued draft controller plan 形式收口。

### 2026-05-05：P3 第四十五刀，Agent stream queued draft state plan 收口

已完成：

- 继续扩展 `src/components/agent/chat/hooks/agentStreamQueueController.ts`：
  - 新增 `buildAgentStreamQueuedDraftStatePlan`，统一 queued draft 进入排队态时的 message patch、active stream 清理、optimistic item / turn 清理与 sending 状态计划。
  - 继续复用 `buildAgentStreamQueuedDraftMessagePatch` 生成排队 runtime status。
- `agentStreamRuntimeHandler.ts` 的 `markQueuedDraftState` 继续变薄：
  - handler 不再内联 queued draft 的 `clearActiveStreamIfMatch / clearOptimisticItem / clearOptimisticTurn / setIsSending(false)` 决策。
  - handler 只消费 queue controller 产出的状态计划并执行副作用。
- `agentStreamQueueController.test.ts` 新增 queued draft state plan 回归，覆盖 message patch 和四个状态副作用开关。

主线收益：

- Phase 3 的排队态转换继续收敛到 current queue controller；首页首发或旧会话中遇到 busy queue 时，queued draft 状态语义可独立测试。
- 后续排查“点击发送后卡在 loading / optimistic 消息残留 / queued draft 没有变为排队态”时，可以直接测 queue controller，不必进入完整 stream handler。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamQueueController.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts" "src/features/knowledge/KnowledgePage.tsx" --max-warnings 0
npm run typecheck -- --pretty false
git diff --check -- "src/lib/activeContentTarget.ts" "src/components/agent/chat/hooks/agentStreamQueueController.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts" "src/features/knowledge/KnowledgePage.tsx" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Queue controller / runtime handler：通过，`2` 个测试文件、`16` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`25` 个测试文件、`112` 个测试通过。
- ESLint touched files：通过。
- TypeScript `tsc --noEmit --pretty false`：通过。
- Diff whitespace check：通过。

GUI / E2E 状态：

- 本刀未进入 Playwright；此前已经确认 MCP profile lock 阻塞仍在，且不能使用 `--isolated` 或 kill 用户 Chrome/MCP。
- 本刀仍是纯前端 stream controller 收口，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI；继续不启动 `verify:gui-smoke`，避免 Rust rebuild 干扰用户观察 CPU / 鼠标繁忙。

下一刀：

1. Playwright MCP 可复用后，优先恢复首页首发、旧会话打开、首 token 的真实性能采集。
2. 如果继续代码拆分，优先盘点 `finishRequestLog` 或 timer cleanup helper 是否还有可测 controller plan。

### 2026-05-05：P3 第四十六刀，Agent stream request log finish plan 收口

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamRequestLogController.ts`：
  - 新增 `buildAgentStreamRequestLogFinishPlan`，统一 request log finish 的重复完成 guard、`duration` 计算与 `activityLogger.updateLog` payload 组装。
  - 明确 `shouldUpdate / nextRequestFinished / logId / updatePayload`，让 request log 完成语义可单测。
- `agentStreamRuntimeHandler.ts` 的 `finishRequestLog` 继续变薄：
  - handler 不再内联 `requestLogId`、`requestFinished` 与 `Date.now() - requestStartedAt` 决策。
  - handler 只消费 request log controller 产出的计划，并执行 `activityLogger.updateLog` 副作用。
- 新增 `agentStreamRequestLogController.test.ts`，覆盖无 log id、已完成去重、success duration、error payload 四类分支。

主线收益：

- Phase 3 的 request log 完成链路继续收敛到 current controller；首字/流式排查时能把“完成态记录是否重复更新”和 runtime event 处理分开测。
- 后续排查 request log duration 异常、重复完成、错误完成状态不一致时，可以直接测 request log controller，不必进入完整 stream handler。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

已验证：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamRequestLogController.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm exec -- tsc --noEmit --pretty false --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler --jsx react-jsx --lib DOM,ES2020 "src/components/agent/chat/hooks/agentStreamRequestLogController.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts"
git diff --check -- "src/components/agent/chat/hooks/agentStreamRequestLogController.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md"
```

结果：

- Request log controller / runtime handler：通过，`2` 个测试文件、`15` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`26` 个测试文件、`116` 个测试通过。
- ESLint touched files：通过。
- Targeted TypeScript check：通过。
- Diff whitespace check：通过。

未完成验证：

- 全量 `npm run typecheck -- --pretty false` 本轮运行超过 `10` 分钟仍无输出；为避免继续占用本机 CPU，已终止本轮自行启动的 `tsc` 进程。上一刀全量 typecheck 有通过记录，本刀额外补了 touched file 的 targeted TypeScript check。
- 本刀未进入 Playwright；仍按既有规则不使用 `--isolated`，也不 kill 用户 Chrome/MCP。当前改动是纯前端 stream controller 收口，不改 GUI 壳、Tauri command、Bridge、mock 或用户可见 UI。

下一刀：

1. Playwright MCP 可复用后，优先恢复首页首发、旧会话打开、首 token 的真实性能采集。
2. 如果继续代码拆分，只看 timer cleanup helper；不要再扩大到无关 GUI / Bridge 面。

### 2026-05-05：P3 第四十七刀，Agent stream timer schedule plan 收口

已完成：

- 新增 `src/components/agent/chat/hooks/agentStreamTimerController.ts`：
  - 新增 `buildAgentStreamTimerClearPlan`，统一 timer clear 的状态计划。
  - 新增 `buildAgentStreamTextRenderTimerSchedulePlan`，统一首个可见文本立即 flush、已有 pending timer 跳过、后续 32ms 低频 flush 的调度决策。
  - 新增 `buildAgentStreamQueuedDraftCleanupTimerSchedulePlan` 与 `buildAgentStreamQueuedDraftCleanupTimerFirePlan`，统一 queued draft cleanup 的旧 timer 清理、1800ms grace 调度与触发时 cleanup guard。
- `agentStreamRuntimeHandler.ts` 的 timer helper 继续变薄：
  - `clearQueuedDraftCleanupTimer` / `clearPendingTextRenderTimer` 不再内联是否清理的判断。
  - `scheduleTextRenderFlush` 不再内联首个可见文本 flush 与 pending timer guard。
  - `scheduleQueuedDraftCleanup` 不再内联 queued draft cleanup 的 schedule/fire guard。
- 新增 `agentStreamTimerController.test.ts`，覆盖 timer clear、text render flush_now/skip/schedule、queued cleanup schedule/fire 分支。

主线收益：

- Phase 3 的 text render timer 与 queued draft cleanup timer 决策继续收敛到 current controller；首字慢或 queued draft 卡住时可以直接区分“调度策略”与 handler 副作用执行。
- 后续排查“首字为什么等 32ms / 为什么排队草稿 1800ms 后消失或残留”时，可以直接测 timer controller，不必进入完整 stream handler。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

待验证：

- 先跑 timer controller / runtime handler 定向回归。
- 再跑 Phase 3 stream controller 定向回归、ESLint、targeted TypeScript check 与 diff whitespace check。

验证结果：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamTimerController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamTimerController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamTimerController.ts" "src/components/agent/chat/hooks/agentStreamTimerController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" --max-warnings 0
npm exec -- tsc --noEmit --pretty false --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler --jsx react-jsx --lib DOM,ES2020 "src/components/agent/chat/hooks/agentStreamTimerController.ts" "src/components/agent/chat/hooks/agentStreamTimerController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts"
git diff --check -- "src/components/agent/chat/hooks/agentStreamTimerController.ts" "src/components/agent/chat/hooks/agentStreamTimerController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Timer controller / runtime handler：通过，`2` 个测试文件、`17` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`27` 个测试文件、`122` 个测试通过。
- ESLint touched files：通过。
- Targeted TypeScript check：通过。
- Diff whitespace check：通过。

未完成验证：

- 本刀仍未进入 Playwright；这是纯前端 stream controller 收口，不改变 GUI 可见行为，也不碰 Tauri command / Bridge / mock。
- 全量 `npm run typecheck` 上一刀已记录超时风险；本刀继续使用 touched file targeted TypeScript check，避免再次长时间占用 CPU。

下一刀：

1. 优先恢复 Playwright MCP 真实性能采集，覆盖首页首发、旧会话打开和首 token 分段。
2. 若仍需要代码收口，只看 missing final / failed timeline helper 的执行层；不继续扩散到无关 Workspace 或 Bridge 面。

### 2026-05-05：P3 第四十八刀，Missing final / failed timeline 执行层计划收口

已完成：

- 继续扩展 `src/components/agent/chat/hooks/agentStreamCompletionController.ts`：
  - 新增 `buildAgentStreamMissingFinalReplyFailureSideEffectPlan`，统一 missing final failure 的 pending text timer 清理、failed timeline 标记、queued turn 清理、request log、observer error、toast、active stream 与 listener dispose 执行计划。
- 继续扩展 `src/components/agent/chat/hooks/agentStreamErrorController.ts`：
  - 新增 `buildAgentStreamFailedTimelineStatePlan`，统一 failed timeline 更新所需的 session、pending turn/item、error 与 failedAt 参数。
- `agentStreamRuntimeHandler.ts` 的失败路径 helper 继续变薄：
  - `finalizeMissingFinalReplyFailure` 不再直接读取 failure plan 的全部字段来拼执行语义，而是消费 completion controller 产出的 side-effect plan。
  - `markFailedTimelineState` 不再内联 failed timeline 参数组装，而是消费 error controller 产出的 state plan。
- 补充 controller 单测：
  - `agentStreamCompletionController.test.ts` 覆盖 missing final failure side-effect plan。
  - `agentStreamErrorController.test.ts` 覆盖 failed timeline state plan。

主线收益：

- Phase 3 的失败完成路径继续收敛到 current controller；空 final、普通 error、timeline failed state 的执行参数不再散落在 runtime handler 内。
- 后续排查“空 final 误报失败 / failed timeline 未落态 / request log 和 toast 不一致”时，可以直接测 completion/error controller，不必进入完整 stream handler。
- 保留现有行为，不改变 runtime event protocol、Tauri command、Bridge、mock、GUI 壳或用户可见 UI。

待验证：

- 先跑 completion/error controller 与 runtime handler 定向回归。
- 再跑 Phase 3 stream controller 定向回归、ESLint、targeted TypeScript check 与 diff whitespace check。

验证结果：

```bash
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
npm exec -- vitest run "src/components/agent/chat/hooks/agentStreamTimerController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" "src/components/agent/chat/hooks/agentStreamThinkingDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeContextController.test.ts" "src/components/agent/chat/hooks/agentStreamArtifactActionController.test.ts" "src/components/agent/chat/hooks/agentStreamToolEventController.test.ts" "src/components/agent/chat/hooks/agentStreamThreadItemController.test.ts" "src/components/agent/chat/hooks/agentStreamQueueController.test.ts" "src/components/agent/chat/hooks/agentStreamWarningController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamToolCompletionSignalController.test.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamTextRenderFlushController.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeStatusController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeMetricsController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamInactivityController.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts" "src/components/agent/chat/hooks/agentStreamUnknownEventController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestStartController.test.ts" "src/components/agent/chat/hooks/agentStreamListenerReadinessController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitLifecycleController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmissionController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitExecution.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitOpController.test.ts" "src/components/agent/chat/hooks/agentStreamSubmitContext.test.ts"
npx eslint "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/hooks/agentStreamTimerController.ts" "src/components/agent/chat/hooks/agentStreamTimerController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" --max-warnings 0
npm exec -- tsc --project "/tmp/lime-agentstream-targeted-tsconfig.json"
git diff --check -- "src/components/agent/chat/hooks/agentStreamCompletionController.ts" "src/components/agent/chat/hooks/agentStreamCompletionController.test.ts" "src/components/agent/chat/hooks/agentStreamErrorController.ts" "src/components/agent/chat/hooks/agentStreamErrorController.test.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/hooks/agentStreamTimerController.ts" "src/components/agent/chat/hooks/agentStreamTimerController.test.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.ts" "src/components/agent/chat/hooks/agentStreamRequestLogController.test.ts" "docs/roadmap/agentui/conversation-projection-implementation-plan.md" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Completion / error controller / runtime handler：通过，`3` 个测试文件、`34` 个测试通过。
- Agent stream Phase 3 定向回归：通过，`27` 个测试文件、`124` 个测试通过。
- ESLint touched files：通过。
- Targeted TypeScript check：通过；使用 `/tmp/lime-agentstream-targeted-tsconfig.json` 继承仓库 `tsconfig.json` 并额外包含 `src/vite-env.d.ts`，避免 CLI 单文件检查丢失 `@/*` 与 `ImportMeta.env` 类型。
- Diff whitespace check：通过。

未完成验证：

- 本刀未进入 Playwright；这是纯前端 stream controller 收口，不改变 GUI 可见行为，也不碰 Tauri command / Bridge / mock。
- 全量 `npm run typecheck` 本轮未重跑；上一刀已记录长时间无输出风险，本刀用贴边界 targeted TypeScript check 验证 touched controller。

下一刀：

1. 优先恢复 Playwright MCP 真实性能采集，覆盖首页首发、旧会话打开和首 token 分段。
2. 若继续代码收口，先盘点 `agentStreamRuntimeHandler.ts` 剩余 helper 是否真的阻塞 Phase 3；否则进入 E2E 或 Phase 4 render projection 验收。

### 2026-05-06：P3 第四十九刀，Thinking 历史恢复与尾部展示污染清理

已完成：

- 对齐 `docs/roadmap/agentui` 的 P0/P1 验收口径，继续收紧 `thinking / text / tool / action` 分型边界：
  - `MessageList` 在尾部 assistant 已完成、但 reasoning timeline 尚未持久化接管时，继续保留 inline thinking，避免最终答复出现后思考块消失。
  - `agentChatHistory` 不再无条件合并相邻 assistant 历史消息；只保留无 thinking 的普通分段合并，或同一工具 / 同一任务 / 同一 action identity 的过程合并。
  - 同会话 hydrate 时，远端纯正文 assistant 已回来后不再继承本地旧 `thinkingContent`；本地工具轨迹、artifact、task preview 仍可按既有规则合并回远端消息。
- 补充回归测试：
  - 相邻 assistant 都带 thinking 时不应盲合并，避免跨轮思考串味。
  - hydrate 宽松匹配不应把本地 thinking 兜底到远端纯正文 assistant。
  - 尾部已完成 assistant 在 reasoning 未持久化时仍传递 thinking 给 renderer。

主线收益：

- 直接命中 AgentUI 验收 `1.5 流式输出`：`thinking_delta` 不污染最终正文、历史恢复不把 completed thinking 重放到下一轮过程层。
- 保留工具轨迹合并，避免为了清理 thinking 丢失 tool / artifact 的过程证据。
- 这刀是 AgentUI projection 清理，不新增 runtime event、Tauri command、Bridge 或 mock 路径。

已验证：

```bash
npx vitest run "src/components/agent/chat/hooks/agentChatHistory.test.ts"
npx vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "当前完成回合缺少持久化 reasoning 时应临时保留本地思考过程|当前尾部 assistant 已完成但 reasoning 尚未持久化时也应继续显示思考内容|持久化 reasoning 已接管时不应重复传递本地思考过程|已完成工具调用应回到消息顶部执行轨迹展示，不再占用正文主视觉|当前回合仍在运行时，即使 assistant 非 streaming 占位也应继续透传工具调用"
npx vitest run "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts"
```

结果：

- `agentChatHistory.test.ts`：通过，`24` 个测试通过。
- `MessageList.test.tsx` 定向：通过，`5` 个测试通过。
- `agentStreamRuntimeHandler.test.ts`：通过，`12` 个测试通过。

待验证：

- Playwright 真实流式路径继续覆盖：thinking 完成后不消失、不串味。
- Playwright 工具调用路径继续覆盖：权限确认 action_required 提交后应恢复执行，并显示 tool / web search 过程轨迹。

### 2026-05-06：P3 第五十刀，首字快照预填与 replay 去重闭环

已完成：

- 继续按 `docs/roadmap/agentui/conversation-projection-acceptance.md` 的 `1.5 流式输出` 口径收紧 stream projection：
  - `message` 快照事件包含 assistant 可见正文时，立即预填 `content / contentParts`，降低首字前空白体感。
  - 后续 `text_delta` 若只是重放已预填快照，不再追加到正文、不再通知 stream observer，也不触发打字音。
  - 若 `text_delta` 分片先完整 replay 快照、再继续输出新正文，只追加快照之外的新内容。
  - 首个 `text_delta` 指标继续按原始 delta 记录，避免 replay 去重后把首字指标误记成 `0` 字符。
- 保留第四十九刀的 thinking 修复：
  - text flush 后继续保留并累积 `thinkingContent`。
  - 已完成尾部 assistant 在 reasoning timeline 尚未持久化接管时，继续显示 inline thinking。
  - hydrate 纯正文 assistant 不再继承本地旧 thinking，避免跨轮串味。

主线收益：

- 直接服务 AgentUI “首字快”和“流式稳”两条验收：首屏可先显示 runtime message 快照，同时 `text_delta` / `final_done` 不重复追加。
- 不新增 runtime fact source；仍只消费 `AgentEvent`，在 frontend projection 内完成快照与 delta 的 reconcile。
- 工具 / action 仍按现有 `tool_start / tool_end / action_required` 过程投影处理，不把工具日志或权限卡混进最终 Markdown 正文。

已验证：

```bash
npx vitest run "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts"
npx vitest run "src/components/agent/chat/hooks/agentChatHistory.test.ts"
npx vitest run "src/components/agent/chat/components/MessageList.test.tsx" -t "当前尾部 assistant 已完成但 reasoning 尚未持久化时也应继续显示思考内容|持久化 reasoning 已接管时不应重复传递本地思考过程|运行中的助手消息应显示 runtime 状态|工具调用|action"
npm run test:contracts
git diff --check -- "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.ts" "src/components/agent/chat/hooks/agentStreamTextDeltaController.test.ts" "src/components/agent/chat/hooks/agentChatHistory.ts" "src/components/agent/chat/hooks/agentChatHistory.test.ts" "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "docs/exec-plans/agentui-implementation-progress.md"
```

结果：

- Stream runtime / text delta controller：通过，`2` 个测试文件、`17` 个测试通过。
- `agentChatHistory.test.ts`：通过，`24` 个测试通过。
- `MessageList.test.tsx` 定向：通过，`7` 个测试通过，覆盖尾部 thinking 保留、持久化 reasoning 接管、工具 / action 相关展示。
- `npm run test:contracts`：通过；前端命令、Rust 注册、mock priority、default mock、harness contract、modality contract 与 cleanup report contract 均通过。
- Diff whitespace check：通过。

Playwright / GUI 续测状态：

- 当前页面：`http://127.0.0.1:1420/`，可加载并能定位到首页 textarea 与 `发送` 按钮。
- DevBridge：`npm run bridge:health -- --timeout-ms 120000` 与后续 `--timeout-ms 30000` 均超时，`http://127.0.0.1:3030/health` 未监听；期间 `tauri:dev:headless` 与多条 Rust 编译 / check 链仍在运行。
- 已尝试刷新页面建立干净基线；页面在 DevBridge 掉线窗口内出现 `workspace_get`、`agent_runtime_list_sessions`、`aster_agent_init` 的 bridge connection / cooldown 错误，因此本轮不把 GUI 流式和工具调用 E2E 判为通过。

下一步：

1. 等 `3030/health` 稳定返回 `ok` 后，复用当前 Lime 页签重跑两轮真实对话：
   - 第一轮会议纪要 prompt，完成后确认 `已完成思考` / thinking block 仍可见。
   - 第二轮 `2+2` prompt，确认 thinking 不含第一轮会议纪要内容，正文不混入 thinking。
2. 再跑工具调用路径：发送 `@搜索 OpenAI 最新模型公告，给我 3 条要点，并附来源`，验证 `action_required` 权限确认、点击允许、`待补 1` 消失、tool / web search 轨迹恢复。
3. 若 DevBridge 继续掉线，优先修 DevBridge 编译期间 3030 不稳定 / cooldown 恢复问题，再谈 AgentUI GUI 可交付。

### 2026-05-07：P3 第五十一刀，runtime 权限确认 E2E 收口

已完成：

- 对齐 `docs/roadmap/agentui/conversation-projection-acceptance.md` 的 `1.5 流式输出` 与权限确认主链口径，收口 runtime permission wait 的用户态投影：
  - `runtimeActionConfirmation.ts` 抽出 thread item 级 runtime confirmation 判断，避免 request id 判断散落在 Timeline、任务卡与尾部运行态里。
  - `AgentThreadTimeline` 继续隐藏 runtime permission wait 内部 error，不再向普通用户暴露 `confirmationStatus` / `askProfileKeys`。
  - `agentTaskRuntime` 与 `inputbarRuntimeStatusLine` 改为只统计可见 pending action；`submitted` 的 runtime confirmation 不再把消息尾部投影成 `失败 · 00:00` 或 `等待补充`。
  - runtime permission wait 未提交时投影为用户态等待确认；提交后保留只读确认回显与继续执行提示，不再把内部等待错误当普通失败展示。
- 补充回归测试：
  - `AgentThreadTimeline.test.tsx` 覆盖 runtime permission wait 不暴露内部字段。
  - `agentTaskRuntime.test.ts` 覆盖 runtime permission wait 未提交 / 已提交两种任务卡投影。
  - `MessageList.test.tsx` 覆盖提交后消息尾部不残留失败状态。
  - `useAsterAgentChat.test.tsx` 覆盖 stream 结束后提交 runtime permission confirmation 仍透传 `event_name`。

主线收益：

- 直接命中本轮用户反馈：思考 / 工具调用过程中出现权限确认时，确认卡不会在提交后消失成内部失败，也不会在消息尾部残留 `失败 · 00:00`。
- 工具确认链路已从真实 DevBridge 页面验证到 `agent_runtime_respond_action`，且请求包含 `event_name` 与 `action_scope`，可以恢复当前执行流。
- 普通用户页面不再暴露 `confirmationStatus`、`askProfileKeys`、`碰到错误`、`执行失败` 这些内部字段或调试词。

已验证：

```bash
npx vitest run "src/components/agent/chat/utils/agentTaskRuntime.test.ts" "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/components/AgentThreadTimeline.test.tsx" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx"
npx tsc --noEmit --pretty false --skipLibCheck
npm run test:contracts
npm run bridge:health -- --timeout-ms 20000
npm run verify:gui-smoke -- --timeout-ms 240000
```

结果：

- AgentUI 定向回归：通过，`4` 个测试文件、`292` 个测试通过。
- TypeScript：通过。
- Contracts：通过；命令契约、harness contract、modality contract 与 cleanup report contract 均通过。
- DevBridge health：通过，`http://127.0.0.1:3030/health` 返回 `ok`。
- GUI smoke：通过；覆盖 workspace-ready、browser-runtime、site-adapters、agent service skill entry、runtime tool surface page、knowledge GUI、design canvas。

Playwright E2E 证据：

- 证据目录：`tmp/e2e-agentui/`
- fixed4 截图：
  - `60-fixed4-before-send.png`
  - `61-fixed4-filled.png`
  - `62-fixed4-after-submit-first-status.png`
  - `63-fixed4-confirmation-or-timeout.png`
  - `64-fixed4-after-submit-answer.png`
  - `65-fixed4-final-or-timeout.png`
- fixed4 JSON：
  - `agentui-tool-permission-e2e-summary-fixed4.json`
  - `agentui-tool-permission-e2e-bridge-calls-fixed4.json`
  - `agentui-tool-permission-e2e-console-fixed4.json`

fixed4 结果摘要：

- `firstStatusOk: true`
- `confirmationOk: true`
- `clickedAllow: true`
- `clickedSubmit: true`
- `createCalls: 1`
- `submitCalls: 1`
- `respondCalls: 1`
- `respondActionHasEventName: true`
- `consoleErrorCount: 0`
- `leakedBeforeAllow: []`
- `leakedAfterSubmit: []`
- `leakedFinal: []`
- `orphanFailureFinal: []`

当前判定：

- runtime 权限确认工具调用 E2E 已达到本轮可交付门槛。
- 仍建议后续单独复测长流式 thinking 展开 / 收起体验，但这不阻塞本轮权限确认和工具调用链路交付。
