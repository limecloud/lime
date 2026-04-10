# Agent Chat 组件

Agent 聊天界面的 UI 组件集合。

## 文件索引

| 文件                             | 说明                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `ChatNavbar.tsx`                 | 聊天顶部导航栏                                                                         |
| `ChatSidebar.tsx`                | 聊天侧边栏（会话列表）                                                                 |
| `CanvasWorkbenchLayout.tsx`      | 画布顶部标签壳，统一承载 `Session · Main`、`workspace`、Team 与动态文件标签 |
| `CanvasSessionOverviewPanel.tsx` | 解耦后的会话过程面板，用于从运行时注入 turn、tool、A2UI、queue 等过程视图              |
| `EmptyState.tsx`                 | 空状态占位组件                                                                         |
| `MarkdownRenderer.tsx`           | Markdown 渲染组件                                                                      |
| `MessageList.tsx`                | 消息列表组件                                                                           |
| `team-workspace-board/TeamWorkspaceBoardHeader.tsx` | Team 头部壳，统一承载标题、状态 badge、空 shell 展开和返回主助手入口 |
| `team-workspace-board/TeamWorkspaceCanvasLaneCard.tsx` | Team 自由画布里的 lane 卡片壳，统一承载成员进展、摘要、badge 与 resize handle |
| `team-workspace-board/TeamWorkspaceCanvasStage.tsx` | Team 自由画布 stage 壳，统一承载视口、背景网格、shortcuts、lane 容器与空态 |
| `team-workspace-board/TeamWorkspaceEmptyShellState.tsx` | Team 空 shell 折叠态横条，保持壳层紧凑与展开入口统一 |
| `team-workspace-board/TeamWorkspaceFormationPanels.tsx` | Team 运行时分工 / 计划分工展示壳，避免 Board 内重复 JSX |
| `team-workspace-board/SelectedSessionInlineDetail.tsx` | Team 当前查看成员的详情区与协作操作壳 |
| `team-workspace-board/TeamWorkspaceTeamOverviewChrome.tsx` | Team 顶部 toolbar / 协作动态壳，收口 compact 与非 compact 的重复展示逻辑 |
| `StreamingRenderer.tsx`          | 流式消息渲染（支持思考内容、工具调用）                                                 |
| `TokenUsageDisplay.tsx`          | Token 使用量显示                                                                       |
| `ToolCallDisplay.tsx`            | 工具调用显示（状态、参数、日志、结果）                                                 |

## 核心组件

### CanvasWorkbenchLayout

- 只负责单画布壳、头部标签、文件标签与顶部操作，不直接依赖具体 slash / skill 业务
- 顶部收敛为紧凑标签栏 + 文件操作区，去掉大块摘要头，避免与正文和对话信息重复
- 当存在 `sessionView` 且同时有默认主稿时，默认焦点仍应落在 `Session · Main`，但面板内容优先展示当前主稿/产物预览，避免与对话里的过程区重复
- `workspaceView` 可以由运行时显式注入顶部标签文案和面板文案，工作区文件区是画布里真实文件的唯一事实源
- `workspace` 文件树默认隐藏 `.lime`、`exports`、`output`、`.DS_Store` 和 `output_image.*` 这类内部运行或导出产物入口，避免与真实编辑入口混淆
- `panelCopy` 允许运行时覆盖 workspace / team 面板里的引导文案、空态文案与目录区标题，避免布局壳继续承载场景描述
- `teamView` 与可选的 `tabLabel/tabBadge` 继续由运行时显式提供，布局只消费定义，不再内建 Team 协作语义
- 通过 `sessionView`、`teamView` 等插槽注入不同运行时面板，保持未来场景扩展时的边界稳定

### CanvasSessionOverviewPanel

- 统一展示当前 turn 状态、最近执行轨迹、待处理交互与排队消息
- 顶部改为“执行总览”摘要卡，优先展示当前状态、聚焦事件和 turn 信息，而不是技术性提示文案
- 让 `Session · Main` 成为真实过程页，而不是拿主稿预览兜底

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
