# Terminal AI 模块

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

Terminal AI 是终端内置的 AI 助手功能，参考 Waveterm 的 AI 面板设计。

**核心特性：**

- 复用 AI Agent 的模型选择器和运行时 API
- 支持终端上下文（Widget Context）
- 流式响应显示
- 工具调用支持
- **AI 控制终端**：AI 可以向活动终端发送命令（需用户审批）

## 文件索引

| 文件                         | 说明                             |
| ---------------------------- | -------------------------------- |
| `index.ts`                   | 模块导出                         |
| `types.ts`                   | 类型定义                         |
| `useTerminalAI.ts`           | Terminal AI Hook（含终端控制）   |
| `TerminalAIPanel.tsx`        | AI 面板主组件                    |
| `TerminalAIInput.tsx`        | 输入框组件                       |
| `TerminalAIMessages.tsx`     | 消息列表组件                     |
| `TerminalAIModeSelector.tsx` | 模式/模型选择器                  |
| `TerminalAIWelcome.tsx`      | 欢迎页面组件                     |
| `CommandApproval.tsx`        | 命令审批组件                     |
| `TerminalController.ts`      | 终端控制器（管理 AI 与终端通信） |

## 使用方式

```tsx
import { TerminalAIPanel } from "@/components/terminal/ai";

function MyComponent() {
  const getTerminalOutput = () => {
    // 返回终端输出内容
    return "$ ls -la\ntotal 0\n...";
  };

  // 终端会话 ID（用于 AI 控制终端）
  const terminalSessionId = "session-123";

  return (
    <TerminalAIPanel
      getTerminalOutput={getTerminalOutput}
      terminalSessionId={terminalSessionId}
    />
  );
}
```

## 功能说明

### Widget Context

开启后，AI 可以看到终端的最近输出（默认 50 行），用于：

- 解释命令输出
- 调试错误信息
- 提供上下文相关的建议

### 模型选择

复用 AI Agent 的 Provider/Model 选择器，支持：

- OAuth 凭证（Kiro、Gemini、Antigravity 等）
- API Key 凭证（OpenAI、Claude 等）

### AI 控制终端（新功能）

AI 可以向活动终端发送命令，流程如下：

1. AI 生成命令建议
2. 用户在审批对话框中确认
3. 命令发送到终端执行

参考 Waveterm 的 `sendDataToController()` 机制实现。

### 快捷操作

欢迎页面提供快捷操作按钮：

- 解释命令
- 调试错误
- 写脚本
- 优化命令

## 依赖

- `@/lib/api/agentRuntime` - Agent / Aster 现役运行时 API
- `@/lib/api/agentStream` - 流式事件解析与展示类型
- `@/lib/api/terminal` - 终端 API（用于发送命令）
- `@/hooks/useProviderPool` - Provider 凭证
- `@/hooks/useApiKeyProvider` - API Key 凭证
- `@/hooks/useModelRegistry` - 模型注册表
- `@/components/ui/*` - UI 组件

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
