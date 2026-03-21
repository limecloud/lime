# AI Agent 指南

本文件为 AI Agent 在此代码库中工作时提供指导。
仅用于开发 Lime 源码仓库本身，不作为 Lime 应用运行时 agent 会话的指令来源。

## 基本规则

1. **始终使用中文输出** - 所有回复、注释、文档都使用中文
2. **文件超过 20 行，分批输出** - 避免一次性输出过长内容
3. **先读后写** - 修改文件前必须先读取现有内容

## 跨平台兼容约束

1. **默认双平台** - 所有新增功能、脚本、文档默认同时考虑 macOS 与 Windows；若只支持单平台，必须明确标注原因、影响范围和降级方案
2. **避免硬编码平台细节** - 路径分隔符、可执行文件后缀、换行符、大小写敏感性、文件权限等差异必须通过跨平台 API 或统一封装处理，不要直接写死平台判断分支
3. **优先平台无关入口** - 优先使用 `npm`、`cargo`、Tauri 命令和项目内封装，避免新增只适用于 Bash/zsh 的开发流程；如果文档示例包含 shell 特性，需补充 Windows 可执行方式
4. **目录定位走系统 API** - 用户数据、日志、缓存、凭证等落盘位置必须通过应用目录 API 或统一工具函数解析，禁止在实现中写死 `~/Library/...`、`C:/Users/...` 之类路径
5. **变更前做兼容性自检** - 涉及文件系统、进程启动、终端、快捷键、窗口、托盘、权限、路径解析的改动时，提交前必须检查 macOS/Windows 的行为差异；未验证的平台假设要明确说明
6. **不确定先查文档** - 对 Tauri、Rust、Node.js 或系统 API 的平台行为拿不准时，先查官方文档；可以优先使用 Context7 MCP 获取最新资料

## AGENTS.md 维护原则

1. **根 AGENTS.md 只放仓库级规则** - 保留全局约束、高频命令、文档索引，避免塞入过长操作手册
2. **长流程拆到独立文档** - 像 Playwright E2E、内容创作工作流这类步骤型说明，放到 `docs/aiprompts/`，根 AGENTS 只保留入口
3. **谨慎新增子目录 AGENTS.md** - 仅当某个目录树存在长期稳定、只对该子树生效的规则时才新增；临时排障说明不要新增 AGENTS
4. **优先索引化而不是堆叠说明** - 根 AGENTS 更适合作为目录与约定入口，详细上下文交给专门文档

## UI 全局指导

1. **界面改动先看视觉规范** - 涉及配色、渐变、卡片布局、设置页重排、工作台改版时，先读 `docs/aiprompts/design-language.md`
2. **宽度按页面类型选** - 表单页保持窄阅读宽度，卡片/工作台页面使用更宽的自适应内容区，不要整仓统一 `max-width`
3. **中文排版优先** - 避免过大英文 tracking、重复标题和挤压式统计卡文案
4. **渐变只做氛围层** - 禁止用互相打架的多层渐变制造分割感，背景存在感必须弱于内容
5. **默认禁用半透明主表面** - 弹窗、浮层、工作台容器、主卡片默认使用实体底色，避免 `bg-white/80`、`backdrop-blur` 一类设计造成层级混乱与内容遮挡错觉

## 详细文档

模块级详细文档位于 `docs/aiprompts/`：

| 文档 | 说明 |
|------|------|
| [overview.md](docs/aiprompts/overview.md) | 项目架构概览 |
| [providers.md](docs/aiprompts/providers.md) | Provider 系统 |
| [credential-pool.md](docs/aiprompts/credential-pool.md) | 凭证池管理 |
| [converter.md](docs/aiprompts/converter.md) | 协议转换 |
| [server.md](docs/aiprompts/server.md) | HTTP 服务器 |
| [components.md](docs/aiprompts/components.md) | 组件系统 |
| [design-language.md](docs/aiprompts/design-language.md) | 全局 UI 视觉语言 |
| [hooks.md](docs/aiprompts/hooks.md) | React Hooks |
| [services.md](docs/aiprompts/services.md) | 业务服务 |
| [commands.md](docs/aiprompts/commands.md) | Tauri 命令 |
| [mcp.md](docs/aiprompts/mcp.md) | MCP 服务器 |
| [database.md](docs/aiprompts/database.md) | 数据库层 |
| [terminal.md](docs/aiprompts/terminal.md) | 内置终端 |
| [plugins.md](docs/aiprompts/plugins.md) | 插件系统 |
| [lib.md](docs/aiprompts/lib.md) | 工具库 |
| [workspace.md](docs/aiprompts/workspace.md) | Workspace 设计文档 |
| [content-creator.md](docs/aiprompts/content-creator.md) | 内容创作系统 |
| [aster-integration.md](docs/aiprompts/aster-integration.md) | Aster 集成方案 |
| [playwright-e2e.md](docs/aiprompts/playwright-e2e.md) | Playwright MCP 续测与 E2E 指南 |

## 构建命令

```bash
# 构建 Tauri 应用
cd src-tauri && cargo build

# 构建前端
npm run build

# 开发模式
npm run tauri:dev

# 浏览器 + DevBridge + Playwright MCP 调试模式
npm run tauri:dev:headless
```

## 测试命令

```bash
# 运行 Rust 测试
cd src-tauri && cargo test

# 运行前端测试
npm test

# 运行针对浏览器桥接的前端测试
npm test -- src/lib/dev-bridge/safeInvoke.test.ts src/lib/tauri-mock/core.test.ts
```

## 代码检查

```bash
# Rust 代码检查
cd src-tauri && cargo clippy

# 前端代码检查
npm run lint
```

## Playwright E2E 入口

- 需要继续浏览器 E2E、复用现有 Playwright MCP 会话、排查 DevBridge/console 错误时，先读 `docs/aiprompts/playwright-e2e.md`
- 如果只是仓库级规则，不要继续往本文件堆叠步骤说明

## UI 设计入口

- 需要统一配色、修正渐变、调整页面宽度策略、重排卡片工作台时，先读 `docs/aiprompts/design-language.md`

## 项目架构

### 技术栈
- 前端：React + TypeScript + Vite + TailwindCSS
- 后端：Rust + Tauri
- 数据库：SQLite (rusqlite)

### 核心模块

1. **Provider 系统** (`src-tauri/src/providers/`)
   - Kiro/CodeWhisperer OAuth 认证
   - Gemini OAuth 认证
   - Qwen OAuth 认证
   - Antigravity OAuth 认证
   - OpenAI/Claude API Key 认证

2. **凭证池管理** (`src-tauri/src/services/provider_pool_service.rs`)
   - 多凭证轮询负载均衡
   - 健康检查机制
   - Token 自动刷新

3. **API 服务器** (`src-tauri/src/server.rs`)
   - OpenAI 兼容 API 端点
   - Claude 兼容 API 端点
   - 流式响应支持

4. **协议转换** (`src-tauri/src/converter/`)
   - OpenAI ↔ CodeWhisperer 转换
   - OpenAI ↔ Claude 转换

### 凭证管理策略（方案 B）

Kiro 凭证采用完全独立的副本策略：
- 上传凭证时，自动合并 `clientIdHash` 文件中的 `client_id`/`client_secret` 到副本
- 每个副本文件完全独立，支持多账号场景
- 刷新 Token 时只使用副本文件中的凭证，不依赖原始文件

## 开发指南

### 添加新 Provider

1. 在 `src-tauri/src/providers/` 创建新的 provider 模块
2. 实现凭证加载、Token 刷新、API 调用方法
3. 在 `CredentialData` 枚举中添加新类型
4. 在 `ProviderPoolService` 中添加健康检查逻辑

### 修改凭证管理

- 凭证文件存储在应用数据目录下的 `lime/credentials/`；`~/Library/Application Support/lime/credentials/` 仅作为 macOS 示例，Windows 请使用对应的应用数据目录
- 数据库存储凭证元数据和状态
- Token 缓存在数据库中，避免频繁读取文件

### 调试技巧

- 日志输出使用 `tracing` 宏
- API 请求调试文件保存在应用日志目录；`~/.lime/logs/` 仅作为 macOS 示例，实现与排障时不要写死该路径
- 使用 `debug_kiro_credentials` 命令调试凭证加载

## 文档维护

文档维护规范详见 `.kiro/steering/doc-maintenance.md`（Kiro 自动加载）。
