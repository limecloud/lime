# general-chat

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

通用对话功能模块，提供简洁高效的 AI 对话体验。
采用三栏布局架构：左侧会话列表 + 中间聊天区域 + 右侧画布面板。

> 治理说明：`GeneralChatPage` 仍是现役页面容器，但已不鼓励业务代码继续直接 import 页面入口；
> 新逻辑优先走统一对话链路（如 `@/hooks/useUnifiedChat`）或现有工作台/路由接入。
> 如必须跨模块复用 `general-chat` 的少量能力，请优先走 `bridge.ts`，不要直接深导入内部目录。

**多模态支持**: 完整支持图片上传、显示和处理，包括：

- 图片上传（拖拽、点击上传）
- 图片预览和下载
- 支持 JPEG、PNG、GIF、WebP 格式
- 文件大小限制（10MB）和数量限制（5张）
- 与 AI 的多模态对话交互

### 技术栈

- React 18 + TypeScript
- Zustand 状态管理
- TailwindCSS 样式
- react-markdown + remark-gfm (Markdown 渲染)
- react-syntax-highlighter (代码高亮)
- KaTeX (数学公式)
- @tanstack/react-virtual (虚拟滚动)

## 文件索引

- `index.tsx` - 兼容根入口，仅导出 `GeneralChatPage`
- `bridge.ts` - 对外桥接层，仅暴露少量跨模块允许复用的稳定能力
- `GeneralChatPage.tsx` - 页面容器（三栏布局）
- `types.ts` - 核心类型定义
  - Session、Message、ContentBlock 等数据类型
  - MessageRole、MessageStatus、CanvasContentType 等枚举类型
  - UIState、StreamingState、CanvasState 等状态类型
  - ErrorInfo、ErrorCode 错误相关类型
  - ImageData、ImagePreviewState 图片相关类型
  - createErrorInfo、parseApiError 错误处理工具函数
  - fileToImageData、isSupportedImageType 图片处理工具函数
  - 组件 Props 类型定义
  - 默认值常量

### 复用组件

- `ChatSidebar` - 复用 `agent/chat/components/ChatSidebar.tsx`
  - 侧边栏容器
  - 会话列表
  - 技能管理

### 子目录

- `chat/` - 中间聊天区域组件
  - `ChatPanel.tsx` - 聊天面板容器（含无 Provider 提示功能、重试功能、多模态图片上传支持）
  - `MessageList.tsx` - 消息列表（使用 @tanstack/react-virtual 实现虚拟滚动，支持动态高度、自动滚动到底部、重试支持）
  - `MessageItem.tsx` - 单条消息（支持错误状态和重试）
  - `UserMessage.tsx` - 用户消息组件（支持图片显示）
  - `AssistantMessage.tsx` - AI 消息组件（支持错误状态显示、图片显示）
  - `ImageMessage.tsx` - 图片消息组件（支持预览、下载、键盘操作）
  - `CodeBlock.tsx` - 代码块组件
  - `ErrorDisplay.tsx` - 错误显示组件（支持不同错误类型、重试按钮、倒计时）
  - `ErrorBoundary.tsx` - Error Boundary 组件（捕获渲染错误、显示降级 UI、错误日志记录）
  - `InputBar.tsx` - 输入栏（支持图片上传、拖拽、预览）
  - `CompactModelSelector.tsx` - 紧凑型模型选择器（复用 useProvider Hook）
  - `StreamingIndicator.tsx` - 流式加载指示器
  - `MessageRenderer.test.ts` - 消息渲染属性测试 (Property 7)

- `canvas/` - 右侧画布面板组件
  - `CanvasPanel.tsx` - 画布容器
  - `CodePreview.tsx` - 代码预览
  - `FilePreview.tsx` - 文件预览
  - `MarkdownPreview.tsx` - Markdown 预览
  - `CanvasToolbar.tsx` - 画布工具栏

- `store/` - 状态管理
  - `useGeneralChatStore.ts` - 主 Store（只消费 compat API 网关与现役 `agentRuntime`，不再直连 `general_chat_*` / `aster_*` 命令）
  - `sessionSlice.ts` - 会话状态切片
  - `messageSlice.ts` - 消息状态切片
  - `uiSlice.ts` - UI 状态切片

- `src/lib/api/generalChatCompat.ts` - general-chat compat API 网关（前端唯一允许直连 `general_chat_*` 命令的地方）
- `src/lib/api/agentRuntime.ts` - Aster 运行时 API（general-chat 发送/停止流式响应统一走这里）

- `hooks/` - 自定义 Hooks
  - `useChat.ts` - 旧对话逻辑 Hook（兼容层，不再从 barrel/root 导出）
  - `useStreaming.ts` - 旧流式响应 Hook（兼容层，不再从 barrel/root 导出）
  - `useSession.ts` - 旧会话管理 Hook（兼容层，不再从 barrel/root 导出）
  - `useCanvas.ts` - 画布控制 Hook
  - `useProvider.ts` - Provider 选择逻辑 Hook（复用 ProviderPool 系统）
    - 自动选择可用 Provider
    - 故障切换逻辑
    - Provider 配置管理

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
