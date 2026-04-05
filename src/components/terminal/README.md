# terminal

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

内置终端组件，采用**后端预创建 PTY**架构（参考 WaveTerm）。

**核心原则：**

- 后端是会话的唯一真相来源
- PTY 在后端预创建，使用默认大小 (24x80)
- 前端只是"连接"到会话，不负责创建
- resize 只是同步大小，不触发创建

**数据流：**

```
[用户点击新建终端]
       ↓
[前端调用 terminal_create_session]
       ↓
[后端创建 PTY（默认 24x80）]
       ↓
[返回 session_id 给前端]
       ↓
[前端创建 TermWrap，连接到 session_id]
       ↓
[TermWrap 初始化 xterm，监听事件]
       ↓
[首次 fit 后，同步实际大小到后端]
```

## 核心功能

- **PTY 会话管理**: 后端预创建，前端连接
- **实时输入输出**: 通过 Tauri Events 实现
- **自适应大小**: 自动调整终端尺寸，同步到后端（防抖处理）
- **xterm.js 渲染**: 高性能终端渲染
- **WebGL 渲染**: 可选的 WebGL 加速渲染（默认启用）
- **Unicode 11 支持**: 宽字符正确显示
- **多标签页**: 支持多个终端会话
- **终端搜索**: 支持正则、大小写、全词匹配
- **主题切换**: 多种预设主题
- **IME 支持**: 正确处理输入法组合状态
- **连接状态显示**: 显示连接状态指示器和重连按钮
- **上下文菜单**: 右键菜单支持复制、粘贴、URL 打开
- **多输入模式**: 同时向多个终端发送输入
- **Jotai 状态管理**: 使用 TermViewModel 管理终端状态
- **VDOM 模式**: 支持在终端内嵌入 React 组件
- **贴纸系统**: 支持在终端上显示可定位的贴纸标注
- **分块布局**: 支持在主终端旁添加附加面板（对齐 Waveterm TileLayout）
- **右侧小部件栏**: 快速添加 Terminal/Files/Web/Sysinfo/AI 面板
- **Terminal AI**: 内置 AI 助手，支持终端上下文理解

## 文件索引

- `index.ts` - 模块导出
- `TerminalWorkspace.tsx` - 终端工作区组件（分块布局 + 小部件栏 + AI 面板）
- `TerminalPanel.tsx` - 独立终端面板组件（用于分块布局）
- `TerminalView.tsx` - 终端视图组件（使用 Jotai 原子状态）
- `TerminalSearch.tsx` - 终端搜索组件
- `TerminalContextMenu.tsx` - 终端上下文菜单组件
- `ConnectionStatusIndicator.tsx` - 连接状态指示器组件
- `MultiInputIndicator.tsx` - 多输入模式指示器组件
- `VDomModeSwitch.tsx` - VDOM 模式切换组件
- `VDomView.tsx` - VDOM 视图组件
- `SubBlock.tsx` - VDOM 子块组件
- `Sticker.tsx` - 终端贴纸组件
- `StickerLayer.tsx` - 终端贴纸层组件
- `termwrap.ts` - 终端封装类（连接模式，WebGL/Unicode11 支持）
- `fitaddon.ts` - 自定义 FitAddon
- `terminal.css` - 终端样式（Tokyo Night 主题）
- `ai/` - Terminal AI 模块（AI 助手面板）
- `widgets/` - 小部件系统子目录

## widgets 子目录

小部件系统，包含右侧工具栏和各种面板视图：

- `types.ts` - 类型定义
- `constants.ts` - 常量配置
- `context.ts` - React Context 定义
- `WidgetContext.tsx` - Provider 组件和状态持久化
- `useWidgets.ts` - 小部件相关 Hooks
- `Widget.tsx` - 单个小部件按钮组件
- `WidgetsSidebar.tsx` - 右侧小部件栏组件
- `SettingsFloatingMenu.tsx` - 设置浮动菜单
- `SysinfoView.tsx` - 系统信息监控视图（CPU/内存图表）
- `FileBrowserView.tsx` - 文件浏览器视图
- `WebView.tsx` - 内嵌浏览器视图

## 依赖

- `@xterm/xterm` - 终端渲染
- `@xterm/addon-fit` - 自适应大小
- `@xterm/addon-web-links` - 链接支持
- `@xterm/addon-search` - 搜索功能
- `@xterm/addon-webgl` - WebGL 渲染加速
- `@xterm/addon-unicode11` - Unicode 11 宽字符支持
- `@tauri-apps/plugin-shell` - Tauri Shell 插件（URL 打开）
- `@floating-ui/react` - 浮动菜单定位
- `@observablehq/plot` - 系统信息图表
- `lucide-react` - 图标
- `styled-components` - 样式
- `jotai` - 原子化状态管理
- `@/lib/api/terminal` - Tauri 终端 API
- `@/lib/terminal/themes` - 终端主题配置
- `@/lib/terminal/store` - 终端状态管理
- `@/lib/terminal/vdom` - VDOM 状态管理
- `@/lib/terminal/stickers` - 贴纸状态管理

## 使用方式

```tsx
import { TerminalWorkspace } from "@/components/terminal";

function App() {
  return <TerminalWorkspace onNavigate={(page) => setCurrentPage(page)} />;
}
```

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
