# AI Agent 聊天模块

> 版本: 1.1.0
> 更新: 2026-01-10

## 模块说明

AI Agent 聊天页面，承接新建任务与生成两种入口。当前工作台主题已收口为统一的 `general` 主链，并集成布局过渡、画布工作台与能力面板。

## 文件索引

| 文件                           | 说明                                       |
| ------------------------------ | ------------------------------------------ |
| `index.tsx`                    | AgentChatPage 主组件，集成布局过渡和工作流 |
| `types.ts`                     | 类型定义（Message、Provider 配置等）       |
| `utils/canvasWorkbenchDiff.ts` | 画布工作台的文本 diff 计算工具             |

### components/

| 文件                             | 说明                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `ChatNavbar.tsx`                 | 顶部导航栏（模型选择、设置等）                                                       |
| `ChatSidebar.tsx`                | 侧边栏（任务列表）                                                                   |
| `MessageList.tsx`                | 消息列表组件                                                                         |
| `Inputbar.tsx`                   | 输入栏组件                                                                           |
| `EmptyState.tsx`                 | 空状态引导（主题选择、模式选择）                                                     |
| `CanvasWorkbenchLayout.tsx`      | 画布顶部标签工作台，统一承载 `Session · Main`、`workspace` 与动态文件标签 |
| `CanvasSessionOverviewPanel.tsx` | 会话过程面板，展示 turn、skills / tools、A2UI 与排队状态的统一过程视图               |

### hooks/

| 文件                   | 说明                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `useAsterAgentChat.ts` | 现役 Aster 聊天主 Hook                                               |
| `index.ts`             | `useAgentChatUnified` 统一入口与 Hook 导出，旧 `useAgentChat` 已删除 |

## 核心功能

### 1. 通用对话

- 多轮对话上下文
- 流式响应
- Markdown 渲染
- 代码高亮

### 2. 工作台模式

- 统一 `general` 工作台主题
- 4 种创作模式（引导/快速/混合/框架）
- 布局过渡（对话 ↔ 对话+画布）

### 3. 画布内工作台

- 使用单一大画布容器 + 顶部标签导航，避免右侧工作台与正文分裂成两套心智
- 固定主标签为 `Session · Main`、`workspace`，并按真实文件动态追加文件标签
- 顶部改为紧凑标签栏，保留文件操作，删除大块摘要头，避免把说明文案继续堆在画布最上方
- 当存在自定义 `sessionView` 时，初始化默认落在 `Session · Main`，不再被默认主稿文件标签抢焦点；若已存在主稿，则面板优先打开主稿预览而不是重复显示过程总览
- `CanvasWorkbenchLayout` 仅负责壳层与标签切换，会话过程、顶部主标签语义、工作区摘要与 Team 摘要都通过 `sessionView` / `workspaceView` / `teamView` 插槽注入，避免把 slash / skill / team 逻辑硬编码进画布壳
- 文件标签内支持正文 / 变更切换、复制路径、系统打开、定位与文本下载

## 依赖模块

- `@/lib/workspace/workbenchUi` - 工作台共享 UI（布局过渡、步骤引导）
- `@/lib/workspace/workbenchWorkflow` - 工作流状态

## 使用示例

```tsx
import { AgentChatPage } from "@/components/agent/chat";

function App() {
  return <AgentChatPage onNavigate={(page) => console.log(page)} />;
}
```
