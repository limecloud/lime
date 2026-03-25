# 截图对话组件 (screenshot-chat)

截图对话功能的前端组件模块，提供截图预览、对话输入、消息展示等功能。

## 文件索引

| 文件                       | 描述                                |
| -------------------------- | ----------------------------------- |
| `index.ts`                 | 模块导出入口                        |
| `types.ts`                 | 类型定义（配置、消息、组件 Props）  |
| `useScreenshotChat.ts`     | 核心 Hook，管理消息、图片和 AI 通信 |
| `ScreenshotPreview.tsx`    | 截图预览组件，支持缩放和拖拽查看    |
| `ChatInput.tsx`            | 聊天输入框组件，支持 Enter 发送     |
| `ChatMessages.tsx`         | 消息列表组件，支持 Markdown 渲染    |
| `ScreenshotChatWindow.tsx` | 悬浮窗主组件，组合所有子组件        |
| `ShortcutSettings.tsx`     | 快捷键设置组件，支持录制模式        |
| `screenshot-chat.css`      | 截图对话组件样式                    |

## 组件说明

### ScreenshotChatWindow

悬浮窗主组件，组合截图预览、消息列表和输入框。

**功能特性:**

- 组合 ScreenshotPreview, ChatInput, ChatMessages
- 支持 ESC 键关闭窗口
- 支持窗口拖动（通过 header 区域）
- 显示错误信息和重试按钮

**Props:**

- `imagePath`: 截图文件路径
- `onClose`: 关闭窗口回调（可选）

### ScreenshotPreview

截图预览组件，用于在悬浮对话窗口中显示截图。

**功能特性:**

- 显示截图图片
- 支持滚轮缩放 (50% - 300%)
- 支持拖拽平移（放大后）
- 工具栏提供缩放和重置按钮

**Props:**

- `src`: 图片路径或 Base64 编码
- `alt`: 图片 alt 文本（可选）
- `className`: 自定义类名（可选）
- `maxHeight`: 最大高度，默认 300px（可选）

### ChatInput

聊天输入框组件。

**功能特性:**

- 文本输入框
- 发送按钮
- Enter 键发送支持
- 加载状态显示

**Props:**

- `value`: 输入框值
- `onChange`: 值变化回调
- `onSend`: 发送消息回调
- `disabled`: 是否禁用（可选）
- `isLoading`: 是否正在加载（可选）
- `placeholder`: 占位符文本（可选）

### ChatMessages

消息列表组件。

**功能特性:**

- 显示用户消息和 AI 回复
- Markdown 渲染支持
- 自动滚动到最新消息
- 显示消息时间戳

**Props:**

- `messages`: 消息列表
- `className`: 自定义类名（可选）

### ShortcutSettings

快捷键设置组件，用于在设置页面中配置截图快捷键。

**功能特性:**

- 显示当前快捷键（用户友好格式）
- 快捷键录制模式
- 保存/取消按钮
- 错误提示

**Props:**

- `currentShortcut`: 当前快捷键
- `onShortcutChange`: 快捷键变更回调
- `onValidate`: 验证快捷键回调（可选）
- `disabled`: 是否禁用（可选）

## Hook 说明

### useScreenshotChat

核心 Hook，管理截图对话的状态和 AI 通信。

**返回值:**

- `messages`: 消息列表
- `isLoading`: 是否正在加载
- `error`: 错误信息
- `imagePath`: 当前截图路径
- `imageBase64`: 当前截图的 Base64 编码
- `sendMessage(message)`: 发送消息到 AI
- `setImagePath(path)`: 设置截图路径
- `clearMessages()`: 清空消息历史
- `clearError()`: 清除错误
- `retry()`: 重试上一条消息

## 依赖关系

- 使用项目统一的 CSS 变量（terminal 主题）
- 使用 `@tauri-apps/api/core` 进行 Tauri 通信
- 使用 `react-markdown` 和 `remark-gfm` 进行 Markdown 渲染
- 使用 `@/lib/api/agentRuntime` 发起 Agent/Aster 请求
- 使用 `@/lib/api/agentProtocol` 解析 AI 流式事件
- 使用 `@/lib/api/project` 获取默认工作区

## 相关需求

- 需求 4.1: 悬浮窗口以无边框、置顶的方式打开
- 需求 4.2: 悬浮窗口应显示截图预览
- 需求 4.3: 悬浮窗口应提供文本输入框
- 需求 4.4: 支持 Enter 键发送
- 需求 4.5: 在可滚动区域显示 AI 回复
- 需求 4.6: 支持 ESC 关闭
- 需求 4.7: 支持窗口拖动
- 需求 5.1: 将图片编码为 base64
- 需求 5.2: 使用现有的 Agent API 进行 AI 通信
- 需求 5.3: 显示加载指示器
- 需求 5.4: 以 Markdown 格式渲染回复内容
- 需求 5.5: 显示错误信息并提供重试选项
- 需求 6.3: 显示当前快捷键和修改按钮
- 需求 6.4: 支持快捷键录制模式
