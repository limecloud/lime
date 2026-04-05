# components

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

React 组件层，包含 UI 组件和业务组件。
使用 TailwindCSS 进行样式管理，shadcn/ui 作为基础组件库。

## 文件索引

- `agent/` - AI Agent 工作台组件（当前主实现收口在 `agent/chat/`）
- `connect/` - Lime Connect 组件（中转商 API Key 添加）
- `flow-monitor/` - LLM 流量监控组件
- `mcp/` - MCP 服务器管理组件（配置管理、运行时控制、工具/提示词/资源浏览与调用）
- `plugins/` - 插件管理组件
- `provider-pool/` - Provider 凭证池管理组件
- `routing/` - 路由规则配置组件
- `smart-input/` - 截图/语音浮窗共享组件（当前仅保留快捷键设置）
- `settings-v2/` - 设置页面组件（当前主实现）
- `skills/` - 技能管理组件
- `terminal/` - 内置终端组件（使用 Tauri Commands）
- `tools/` - 工具页面组件
- `widgets/` - 右侧小部件栏组件（移植自 Waveterm）
- `ui/` - 通用 UI 组件（按钮、输入框等）
- `websocket/` - WebSocket 管理组件
- `workspace/` - Workspace 工作目录管理组件
- `AppSidebar.tsx` - 全局图标侧边栏（类似 cherry-studio）
- `ConfirmDialog.tsx` - 确认对话框
- `HelpTip.tsx` - 帮助提示组件
- `Modal.tsx` - 模态框组件
- `SplashScreen.tsx` - 启动画面组件

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
