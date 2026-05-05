# AgentUI 对话投影验收标准

> 状态：current acceptance source
> 更新时间：2026-05-05
> 目标：为对话架构瘦身提供固定验收场景、性能指标和回归口径，避免后续只凭体感判断。

## 1. 固定验收场景

### 1.1 首页输入回车

步骤：

1. 打开首页。
2. 在首页输入框输入短 prompt。
3. 按 Enter。

验收：

1. 对话 shell 在毫秒级出现，不露出旧 Hero。
2. 进入对话页后立即显示用户消息或 pending preview。
3. 首字前有 submitted / routing / preparing / waiting provider 中至少一个可信状态。
4. 鼠标不长时间保持系统繁忙状态。

指标：

1. `homeEnterToRouteMs`
2. `routeToConversationShellMs`
3. `ensureSessionDurationMs`
4. `submitTurnInvokeDurationMs`
5. `firstRuntimeStatusMs`
6. `firstTextDeltaMs`
7. `firstTextPaintMs`

### 1.2 新建对话

步骤：

1. 当前已有一个对话 tab。
2. 点击新建对话。
3. 输入短 prompt 并发送。

验收：

1. 新建对话是新增或激活 tab，不跳出工作台。
2. 旧 tab 不全量重渲染。
3. 新 tab 先显示 shell 和输入区。
4. 发送后不等待非关键本地持久化。

### 1.3 打开两个历史会话

步骤：

1. 打开历史会话 A。
2. 打开历史会话 B。
3. 在 A/B 之间切换。

验收：

1. 每个会话先显示 shell / cached snapshot / recent messages。
2. detail hydrate 完成前 UI 不空白。
3. A 的过期 hydrate 结果不能覆盖 B。
4. 非活跃 tab 不持有重型 timeline/render projection。
5. CPU/内存不因打开多个历史会话持续飙高。

指标：

1. `clickToShellPaintMs`
2. `clickToRecentMessagesPaintMs`
3. `runtimeGetSessionDurationMs`
4. `messageProjectionDurationMs`
5. `messageRenderDurationMs`
6. `hiddenHistoryCount`
7. `deferredTimelineCount`

### 1.4 大历史 MessageList

步骤：

1. 打开包含大量 messages / threadItems / turns 的旧会话。
2. 观察首屏。
3. 展开历史或 timeline 详情。

验收：

1. 首屏不构建完整 timeline。
2. 历史 Markdown 使用轻量模式或纯文本预览。
3. tool output / artifact detail 默认摘要化。
4. 展开详情时才构建对应 projection。

### 1.5 流式输出

步骤：

1. 发送会产生 thinking、tool、text、final_done 的 prompt。
2. 观察流式过程。
3. 等完成后恢复历史。

验收：

1. `thinking_delta` 不污染最终正文。
2. `text_delta` 不重复追加。
3. `final_done` 只 reconcile。
4. 工具日志不混入最终 Markdown 正文。
5. 历史恢复不把完成 thinking 当正文重放。

### 1.6 Artifact 恢复

步骤：

1. 触发图片、转写、browser snapshot 或报告类 artifact。
2. 等任务完成。
3. 重新打开会话。

验收：

1. MessageList 只显示 artifact 摘要卡。
2. Workbench / viewer 从 artifact graph、thread_read 或 task index 恢复。
3. 不从正文文本猜 artifact kind。
4. artifact 能回到原 session / thread / turn / task / evidence。

## 2. 最低测试集合

普通 projection 改动：

```bash
npm test -- "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx"
npm test -- "src/components/agent/chat/components/MessageList.test.tsx"
```

stream 改动：

```bash
npm test -- "src/components/agent/chat/hooks/agentStreamRuntimeHandler.test.ts" "src/components/agent/chat/hooks/agentStreamTurnEventBinding.test.ts"
```

workspace / tab 改动：

```bash
npm test -- "src/components/agent/chat/index.test.tsx" "src/components/agent/chat/workspace/WorkspaceConversationScene.test.tsx"
```

命令 / Bridge / mock 改动：

```bash
npm run test:contracts
```

GUI 主路径改动：

```bash
npm run verify:gui-smoke
```

如果 DevBridge 不可用，必须明确记录：

1. 停留页面。
2. `3030/health` 状态。
3. 已完成的非 GUI 验证。
4. 下一次恢复 DevBridge 后要续测的场景。

## 3. Playwright 续测口径

遵守 `docs/aiprompts/playwright-e2e.md`：

1. 优先复用已有 Lime 页签。
2. 不新开 isolated profile。
3. 不使用会暴露自动化横幅或 `--no-sandbox` 的临时浏览器方式。
4. 不用固定 sleep 代替状态判断。
5. 每次记录控制台 error 增量与关键性能日志。

最低 E2E 路径：

```text
首页输入短 prompt
  -> 进入对话 shell
  -> 等 first runtime status / first text
  -> 新建对话
  -> 打开历史会话 A
  -> 打开历史会话 B
  -> A/B 切换
  -> 发送短 prompt 检查流式
```

## 4. 完成判定

一次 AgentUI 对话瘦身改动只有同时满足以下条件，才算可交付：

1. 说明推进了哪个 Phase。
2. 没有新增 UI fact source 与 Warp 冲突。
3. 有定向单测或 projection 测试。
4. GUI 主路径已验证，或明确记录 DevBridge 阻塞与续测步骤。
5. 性能指标能解释本次优化前后的关键链路。
