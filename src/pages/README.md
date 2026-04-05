# pages

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

页面级组件，每个文件对应一个独立的路由页面。
页面组件负责组合 components 中的业务组件。

## 文件索引

- `smart-input.tsx` - 截图对话悬浮窗口页面（独立 Tauri 窗口）
- `smart-input.css` - 截图对话悬浮窗口样式
- `browser-runtime-debugger.tsx` - 浏览器运行时调试页面（可独立窗口打开）
- `update-notification.tsx` - 更新提醒悬浮窗口页面（独立 Tauri 窗口，轻量 Toast 交互，支持 1/3/7 天稍后提醒）
- `update-notification.css` - 更新提醒窗口样式（底部 Toast + 进入/退出动画）
- `index.ts` - 页面导出入口

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
