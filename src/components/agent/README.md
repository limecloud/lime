# Agent 模块

> 版本: 1.0.0
> 更新: 2026-04-05

## 模块说明

AI Agent 相关组件。当前现役页面与运行时实现统一收口在 `chat/` 目录，旧根级页面包装层与旧 Skills 面板已删除。

## 文件索引

### chat/

AI Agent 聊天模块，详见 [chat/README.md](./chat/README.md)

| 文件          | 说明                                                     |
| ------------- | -------------------------------------------------------- |
| `index.tsx`   | AgentChatPage 主组件                                     |
| `types.ts`    | 类型定义                                                 |
| `components/` | 子组件（Navbar、Sidebar、MessageList 等）                |
| `hooks/`      | Hooks（`useAgentChatUnified -> useAsterAgentChat` 唯一主链，旧 compat Hook 已删除） |
