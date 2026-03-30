# AI Agent 聊天模块

> 版本: 1.1.0
> 更新: 2026-01-10

## 模块说明

AI Agent 聊天页面，支持通用对话和内容创作两种模式。集成了布局过渡、步骤引导等内容创作功能。

## 文件索引

| 文件                           | 说明                                       |
| ------------------------------ | ------------------------------------------ |
| `index.tsx`                    | AgentChatPage 主组件，集成布局过渡和工作流 |
| `types.ts`                     | 类型定义（Message、Provider 配置等）       |
| `utils/canvasWorkbenchDiff.ts` | 画布工作台的文本 diff 计算工具             |

### components/

| 文件                        | 说明                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| `ChatNavbar.tsx`            | 顶部导航栏（模型选择、设置等）                                               |
| `ChatSidebar.tsx`           | 侧边栏（任务列表）                                                           |
| `MessageList.tsx`           | 消息列表组件                                                                 |
| `Inputbar.tsx`              | 输入栏组件                                                                   |
| `EmptyState.tsx`            | 空状态引导（主题选择、模式选择）                                             |
| `CanvasWorkbenchLayout.tsx` | 画布响应式工作台，宽屏侧栏与窄屏底部面板均支持产物、文件树、变更、预览与下载 |

### hooks/

| 文件                   | 说明                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `useAsterAgentChat.ts` | 现役 Aster 聊天主 Hook                                           |
| `index.ts`             | `useAgentChatUnified` 统一入口与 Hook 导出，旧 `useAgentChat` 已删除 |

## 核心功能

### 1. 通用对话

- 多轮对话上下文
- 流式响应
- Markdown 渲染
- 代码高亮

### 2. 内容创作模式

- 6 种工作区主题（知识探索、计划规划、社媒内容、图文海报、办公文档、短视频）
- 4 种创作模式（引导/快速/混合/框架）
- 步骤进度条（仅内容工作区主题）
- 布局过渡（对话 ↔ 对话+画布）

### 3. 画布内工作台

- 宽屏使用右侧内嵌工作台，窄屏自动切换为底部工作台，均支持 `产物 / 全部文件 / 变更 / 预览`
- 支持画布面板折叠/展开
- 支持复制路径、系统打开、定位与文本下载

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
