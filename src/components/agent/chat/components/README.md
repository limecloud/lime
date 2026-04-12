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
| `team-workspace-board/TeamWorkspaceBoardCanvasSection.tsx` | Team Board 主画布区壳，统一承载 overview chrome、toolbar、canvas stage 与无成员 fallback detail |
| `team-workspace-board/TeamWorkspaceBoardShell.tsx` | Team Board 顶层壳，统一承载 header、body 与主画布区装配 |
| `team-workspace-board/TeamWorkspaceCanvasLaneCard.tsx` | Team 自由画布里的 lane 卡片壳，统一承载成员进展、摘要、badge 与 resize handle |
| `team-workspace-board/TeamWorkspaceCanvasStage.tsx` | Team 自由画布 stage 壳，统一承载视口、背景网格、shortcuts、lane 容器与空态 |
| `team-workspace-board/TeamWorkspaceCanvasToolbar.tsx` | Team 自由画布顶部 toolbar 壳，统一承载缩放信息、成员面板计数与布局控制按钮 |
| `team-workspace-board/TeamWorkspaceEmptyShellState.tsx` | Team 空 shell 折叠态横条，保持壳层紧凑与展开入口统一 |
| `team-workspace-board/TeamWorkspaceFallbackDetailSection.tsx` | Team 在无真实成员画布时的分工展示与当前详情壳，统一承载 notice、计划分工与参考分工 |
| `team-workspace-board/TeamWorkspaceFormationPanels.tsx` | Team 运行时分工 / 计划分工展示壳，避免 Board 内重复 JSX |
| `team-workspace-board/SelectedSessionInlineActivitySection.tsx` | Team 当前成员的完整进展区壳，统一承载活动预览文案与进展记录列表 |
| `team-workspace-board/SelectedSessionInlineCollaborationSection.tsx` | Team 当前成员的继续协作区壳，统一承载等待结果与补充说明输入 |
| `team-workspace-board/TeamWorkspaceTeamOperationsPanel.tsx` | Team 协作动态列表壳，统一承载 compact / 非 compact 的操作项展示与点击跳转 |
| `team-workspace-board/TeamWorkspaceTeamOverviewControls.tsx` | Team 顶部控制按钮与 compact toolbar chip 壳，统一承载等待/收尾/视图控制与 badge 映射 |
| `team-workspace-board/SelectedSessionInlineDetail.tsx` | Team 当前查看成员的详情区与协作操作壳 |
| `team-workspace-board/SelectedSessionInlineHeader.tsx` | Team 当前成员详情头壳，统一承载摘要、状态提示与会话操作按钮 |
| `team-workspace-board/TeamWorkspaceCanvasSelectedInlineDetail.tsx` | Team 画布当前选中成员详情壳，统一承载 inline detail 组合与透传 |
| `team-workspace-board/TeamWorkspaceTeamOverviewChrome.tsx` | Team 顶部 toolbar / 协作动态壳，收口 compact 与非 compact 的重复展示逻辑 |
| `team-workspace-board/teamWorkspaceBoardPropBuilders.ts` | Team Board 壳层 props 组装工具，统一承载 empty shell 与 shell/header/canvas props 映射 |
| `team-workspace-board/teamWorkspaceCanvasControllerState.ts` | Team 画布控制纯状态工具，统一承载视口更新、lane 布局写回与置顶规则 |
| `team-workspace-board/useTeamWorkspaceActivityPreviewSync.ts` | Team 过程预览同步 hook，统一承载请求去重、选中成员轮询与 stale preview 预取 |
| `team-workspace-board/useTeamWorkspaceActivityPreviews.ts` | Team 过程预览 hook，统一承载成员最近过程的预取、轮询与 stale preview 预热 |
| `team-workspace-board/useTeamWorkspaceBoardActions.ts` | Team Board 操作控制 hook，统一承载成员发送/等待/关闭与 Team 级等待/收尾的 pending 状态 |
| `team-workspace-board/useTeamWorkspaceBoardCanvasRuntime.ts` | Team Board 画布运行态组合 hook，统一承载 lane 拼装、stage hint 与自由画布控制接线 |
| `team-workspace-board/useTeamWorkspaceBoardComposer.ts` | Team Board 高阶编排 hook，统一承载 runtime、activity、canvas、presentation 与 shell/empty-shell props 组合 |
| `team-workspace-board/useTeamWorkspaceBoardFormationState.ts` | Team Board 分工展示前置 hook，统一承载 selected team 归一化与 runtime formation / plan display 组装 |
| `team-workspace-board/useTeamWorkspaceBoardRuntimeState.ts` | Team Board 运行态组合 hook，统一承载 team 轨迹、焦点成员、会话控制与交互 action 组装 |
| `team-workspace-board/useTeamWorkspaceBoardShellProps.ts` | Team Board 壳层 props 组合 hook，统一承载 empty shell / shell props 映射与当前选中成员 inline detail 装配 |
| `team-workspace-board/useTeamWorkspaceBoardSessionGraph.ts` | Team Board 会话图组合 hook，统一承载 orchestrator/current child/visible/member canvas/rail 的派生组装 |
| `team-workspace-board/useTeamWorkspaceBoardSelectedInlineDetail.tsx` | Team Board 当前选中成员详情组合 hook，统一承载 inline detail 条件渲染与 props 映射 |
| `team-workspace-board/useTeamWorkspaceBoardPresentation.tsx` | Team Board 展示态 hook，统一承载 chrome 文案、详情展示与壳层样式拼装 |
| `team-workspace-board/useTeamWorkspaceCanvasController.ts` | Team Board 画布控制 hook，统一承载自由画布的布局状态、持久化、lane 布局派生与交互接线 |
| `team-workspace-board/useTeamWorkspaceCanvasInteractionHandlers.ts` | Team 画布交互 hook，统一承载拖拽、resize、平移、缩放、自动布局、fit 与选中行为 |
| `team-workspace-board/useTeamWorkspaceCanvasKeyboardShortcuts.ts` | Team 画布键盘快捷键 hook，统一承载 Space 手型、缩放、适应与方向键平移 |
| `team-workspace-board/useTeamWorkspaceSessionFocus.ts` | Team Board 焦点控制 hook，统一承载当前成员选择、展开状态同步与 team wait 自动聚焦 |
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
