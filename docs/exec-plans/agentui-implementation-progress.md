# AgentUI 实施进度

> 状态：进行中
> 更新时间：2026-04-30
> 路线图：`docs/roadmap/agentui/lime-agentui-implementation-roadmap.md`

## 主目标

逐步实现 Lime AgentUI 下一阶段主线，优先解决旧会话恢复慢、首字慢、tab 卡顿、流式重复吐字和过程信息噪声。

## 当前阶段

P1：Tab 与 Task Capsule，先落旧会话切换期间的轻量投影。

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
