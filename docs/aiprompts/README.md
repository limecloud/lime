# aiprompts

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

AI Agent 专用文档目录，提供模块级别的详细说明。
参考 aster-rust 的 aiprompts 模式设计。

## 文件索引

### 核心系统
- `overview.md` - 项目架构概览
- `governance.md` - **治理第一原则**（新旧并存、迁移收口、禁止回流）
- `providers.md` - Provider 系统（OAuth/API Key 认证）
- `credential-pool.md` - 凭证池管理（负载均衡、健康检查）
- `converter.md` - 协议转换（OpenAI ↔ CW/Claude）
- `server.md` - HTTP 服务器（API 端点）

### 前端模块
- `components.md` - React 组件系统
- `hooks.md` - 自定义 React Hooks
- `lib.md` - 工具库和 API 封装

### 后端模块
- `services.md` - 业务服务层
- `commands.md` - Tauri 命令
- `database.md` - 数据库层（SQLite）

### 功能模块
- `terminal.md` - 内置终端
- `mcp.md` - MCP 服务器管理
- `plugins.md` - 插件系统
- `playwright-e2e.md` - Playwright MCP 续测与 E2E 指南

### Aster 集成
- `aster-integration.md` - **Aster 框架集成方案**
- `workspace.md` - **Workspace 设计文档**（工作目录管理）

### 内容创作
- `content-creator.md` - **内容创作系统**（write_file 标签、画布联动）

## 使用方式

AI Agent 在处理特定模块时，应先阅读对应的 aiprompts 文档：

```
# 处理 Provider 相关任务
→ 先读 docs/aiprompts/providers.md

# 处理新旧并存、迁移、重构、架构收口
→ 先读 docs/aiprompts/governance.md

# 处理凭证池相关任务
→ 先读 docs/aiprompts/credential-pool.md

# 处理 Aster Agent 集成
→ 先读 docs/aiprompts/aster-integration.md

# 处理 Workspace 相关任务
→ 先读 docs/aiprompts/workspace.md

# 处理内容创作、画布联动
→ 先读 docs/aiprompts/content-creator.md

# 处理浏览器 E2E、Playwright MCP 续测
→ 先读 docs/aiprompts/playwright-e2e.md
```

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
