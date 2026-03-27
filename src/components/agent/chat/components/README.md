# Agent Chat 组件

Agent 聊天界面的 UI 组件集合。

## 文件索引

| 文件 | 说明 |
|------|------|
| `ChatNavbar.tsx` | 聊天顶部导航栏 |
| `ChatSidebar.tsx` | 聊天侧边栏（会话列表） |
| `CanvasWorkbenchLayout.tsx` | 画布内工作台布局，宽屏侧栏/窄屏底部工作台均支持产物、全部文件、变更、预览与下载动作 |
| `EmptyState.tsx` | 空状态占位组件 |
| `MarkdownRenderer.tsx` | Markdown 渲染组件 |
| `MessageList.tsx` | 消息列表组件 |
| `StreamingRenderer.tsx` | 流式消息渲染（支持思考内容、工具调用） |
| `TokenUsageDisplay.tsx` | Token 使用量显示 |
| `ToolCallDisplay.tsx` | 工具调用显示（状态、参数、日志、结果） |

## 核心组件

### ToolCallDisplay

参考 aster UI 设计，提供完整的工具调用可视化：

- **状态指示器**：pending/running/completed/failed 四种状态
- **工具描述**：根据工具类型和参数生成人性化描述
- **可展开面板**：参数、日志、输出结果分层展示
- **执行时间**：显示工具执行耗时

### StreamingRenderer

流式消息渲染组件，支持：

- **思考内容**：解析 `<think>` 或 `<thinking>` 标签，折叠显示
- **工具调用**：集成 ToolCallList 显示工具执行状态
- **实时 Markdown**：流式渲染 Markdown 格式
- **流式光标**：显示正在输入的视觉反馈

## 依赖关系

```
MessageList
  └── StreamingRenderer
        ├── ThinkingBlock (思考内容)
        ├── ToolCallList
        │     └── ToolCallDisplay
        │           ├── ToolCallStatusIndicator
        │           ├── ToolCallArguments
        │           ├── ToolLogsView
        │           └── ToolResultView
        └── MarkdownRenderer
```
