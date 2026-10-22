# Agent Chat 组件

Agent 聊天界面的 UI 组件集合。

## 文件索引

| 文件                        | 说明                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `ChatNavbar.tsx`            | 聊天顶部导航栏                                               |
| `CanvasWorkbenchLayout.tsx` | 待迁出的文件／Artifact 预览壳；Summary 由页头当前 owner 展示 |
| `EmptyState.tsx`            | 空状态占位组件                                               |
| `MarkdownRenderer.tsx`      | Markdown 渲染组件                                            |
| `MessageList.tsx`           | 消息列表组件                                                 |
| `StreamingRenderer.tsx`     | 流式消息渲染（支持思考内容、工具调用）                       |
| `TokenUsageDisplay.tsx`     | Token 使用量显示                                             |
| `ToolCallDisplay.tsx`       | 工具调用显示（状态、参数、日志、结果）                       |

## 核心组件

### CanvasWorkbenchLayout

- 只承接尚未迁出的文件／Artifact 预览、文件操作与审阅；旧 Files/Terminal 工具标签、独立序号状态、新建菜单、项目文件专用分栏及其拖拽 hook 已删除。对应能力由当前右侧面 New tab、Files 和 Terminal 承接。
- Summary、Sources、Subagents 与后台进程由现有页头 Summary owner 展示，Canvas 不再有 Summary slot、tab 或独立状态分支。
- 当存在默认文件时聚焦文件预览；空面板收到新文件后按同一投影身份切换，保存前导航继续经过原文件 controller。
- 旧目录fallback、结果目录表格、目录读取/缓存接线及专用copy producer已删除；无文档时显示已有审阅空态，文件浏览统一使用New tab → Files。
- current Files 的目录读取与缓存统一归 `workspace/right-surface/useFileTreeState`；文件树和路径面包屑菜单共享该 owner，显示真实目录及隐藏文件，不按 Lime 内部产物名称排除入口。预览投影和模式归 `workspace/filePreviewTarget`、`filePreviewModel`，Files 不反向依赖 Canvas selection。

### ToolCallDisplay

参考 agent UI 设计，提供完整的工具调用可视化：

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
