# Lime 项目架构概览

## 概述

Lime 是一个以创作为中心的本地优先 AI Agent 交互工作台，基于 Tauri 桌面应用构建，面向创作者、内容团队与轻知识工作者。系统由 Workspace、Skills 编排层、MCP 标准能力层、Claw 渠道层、Artifact 交付层与多模型接入能力共同组成。

可以把它理解为三层结构：

1. **产品层**：Workspace、通用工作区 / Harness、Agent 对话、Skills、Artifact/Canvas、记忆与风格
2. **能力层**：MCP、浏览器运行时、终端、插件、批量/心跳、Claw 渠道
3. **基础设施层**：Aster Agent、Provider 凭证池、协议兼容、路由、服务器、数据库与监控

其中，Provider 接入、协议兼容与运行时服务共同构成底层能力底座。

同时，术语上应与当前 Agent 生态保持一致：

- **Sessions**：长期会话与协作上下文
- **Handoffs**：任务接力与多阶段编排
- **Guardrails**：权限边界、审批与调用限制
- **Tracing**：时间线、步骤与调用轨迹可观测
- **MCP**：tools / resources / prompts / roots 的标准能力接入

在 Lime 中，Skills 处于比 MCP 更贴近产品的一层：它不是底层原语，而是将领域经验、交互方式和执行流程打包后的编排单元。

对 Lime 来说，Skills 还必须继续区分：

- `skill`：产品入口与业务语义
- `adapter / tool`：底层能力工件
- `runtime binding`：最终执行绑定

统一技能标准见 [skill-standard.md](skill-standard.md)，站点工件子标准见 [site-adapter-standard.md](site-adapter-standard.md)，网页 / 浏览器场景的专题设计见 [web-browser-scene-skill.md](web-browser-scene-skill.md)。

## 项目结构

```
lime/
├── src/                 # React 前端
│   ├── components/      # UI 组件
│   ├── pages/           # 页面组件
│   ├── hooks/           # React Hooks
│   ├── lib/             # 工具库
│   └── stores/          # 状态管理
├── src-tauri/           # Rust 后端
│   └── src/
│       ├── commands/    # Tauri 命令
│       ├── providers/   # Provider 实现
│       ├── services/    # 业务服务
│       ├── converter/   # 协议转换
│       ├── server/      # HTTP 服务器
│       └── ...
├── plugins/             # 插件目录
└── docs/                # 文档
```

## 架构分层

### 产品层

| 模块 | 说明 |
|------|------|
| `workspace/` | 工作区与项目边界，承载文件、会话与配置上下文 |
| `components/agent/` | Agent 对话主入口，负责会话、流式事件与交互 |
| `components/workspace/` + `lib/workspace/` | 共享工作区、画布联动、上下文 Harness 与编排兼容能力 |
| `skills/` | 技能加载、标准校验与经验编排能力；统一遵循 `skill-standard.md` |
| `lib/artifact/` | Artifact 解析、状态与轻量渲染器 |
| `memory / personas` | 项目记忆与人设沉淀 |

### 能力层

| 模块 | 说明 |
|------|------|
| `src/features/browser-runtime/` | 浏览器协助运行时与调试工作区 |
| `src-tauri/src/terminal/` | 内置终端与 PTY 会话 |
| `src-tauri/src/services/heartbeat_service/` | 异步调度、周期任务与投递 |
| `src-tauri/src/plugin/` | 插件系统 |
| `src-tauri/src/services/mcp_service.rs` | MCP 服务器与工具管理 |
| `src-tauri/src/commands/gateway_channel_cmd.rs` | Telegram / Feishu / Discord Claw 渠道运行时 |
| `src-tauri/src/commands/telegram_remote_cmd.rs` | Telegram 远程触发入口 |

### 基础设施层

| 模块 | 说明 |
|------|------|
| `src-tauri/src/agent/` | Aster Agent 集成、会话、工具注册与流式桥接 |
| `providers/` | LLM Provider 认证和 API 实现 |
| `services/` | 业务服务层 |
| `converter/` | 协议转换与兼容层 |
| `server/` | HTTP API 服务器 |
| `credential/` | 凭证池管理 |
| `flow_monitor/` | 流量监控 |
| `database/` | 数据持久化与 DAO |

## 核心模块视图

### 后端（`src-tauri/src/`）

| 模块 | 说明 |
|------|------|
| `agent/` | Aster Agent 运行时桥接与会话管理 |
| `skills/` | Skills 标准集成、动态加载与执行回调 |
| `providers/` | 多 Provider 认证与请求发送 |
| `services/` | 心跳、OpenClaw、浏览器窗口、MCP 等业务服务 |
| `converter/` | 协议兼容与转换 |
| `server/` | HTTP Server 与 REST 能力 |
| `terminal/` | 终端与 PTY |
| `plugin/` | 插件加载与运行时 |
| `voice/` | 语音输入输出与 ASR 流程 |

### 前端（`src/`）

| 模块 | 说明 |
|------|------|
| `components/` | 主 UI 组件与共享工作区 |
| `features/` | 浏览器运行时等较独立特性域 |
| `hooks/` | 业务逻辑 Hooks |
| `lib/api/` | Tauri API 与运行时封装 |
| `lib/artifact/` | Artifact 状态与解析 |
| `pages/` | 独立窗口与页面入口 |

补充约束：

- `开发者中心 -> 处理工作台与信息收集` 由 `config.developer.workspace_harness_enabled` 控制，默认关闭；关闭时通用对话不应显示“处理工作台”入口，也不应继续触发对应运行态信息收集链路。

## 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│      用户请求（工作台 / 对话 / Skills / 飞书 / Telegram）       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                Workspace / Project / Memory Layer                │
│   项目路径、工作区配置、主题、记忆、人设、风格、产物上下文       │
└─────────┬───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Skills / Orchestration Layer                  │
│   经验规则、references、scripts、流程推进、任务接力与阶段切换    │
└─────────┬───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Agent Runtime                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Aster Agent │  │ Session     │  │ Stream / Action         │  │
│  │ 执行        │  │ 状态        │  │ Request                 │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Execution Surface                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ MCP Tools / │  │ Browser /   │  │ Claw Channels /         │  │
│  │ Resources / │  │ Terminal /  │  │ Heartbeat / Plugins     │  │
│  │ Prompts     │  │ Files       │  │                         │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Provider Pool Service                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ 凭证轮询    │  │ 健康检查    │  │ Token 刷新              │  │
│  │ (负载均衡)  │  │ (自动剔除)  │  │ (OAuth)                 │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Providers                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │ Kiro    │  │ Gemini  │  │ Claude  │  │ OpenAI  │  ...       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Artifact / Canvas Layer                      │
│   文档、脚本、海报、版本链、画布状态、导出结果与任务沉淀         │
└─────────────────────────────────────────────────────────────────┘
```

## 关键特性

### 1. Workspace 驱动
- Workspace 既是文件边界，也是 context 边界和配置边界
- 项目、会话、记忆、风格和 Artifact 围绕同一工作区组织

### 2. Skills 驱动
- Skills 是经验交互、流程编排与领域方法沉淀的核心单元
- Skills 可封装 prompt、references、scripts、assets 与调用规则
- Agent 运行时可动态加载、自动发现与调用 Skills

### 3. MCP 标准能力层
- 基于 MCP 管理 tools、resources、prompts 与读取边界
- 为 Agent 提供标准化能力发现、调用与上下文共享方式

### 4. Claw 渠道协作
- 支持 Telegram / Feishu / Discord 等渠道运行时
- 支持远程触发、异步协作、消息回流与外部入口接入

### 5. Agent Runtime
- 基于 Aster Agent，支持会话、流式事件、工具调用与多模型配置
- 支持任务接力、会话持续化、步骤可观测与长期运行

### 6. Artifact First
- 输出不止是聊天文本，还包括文档、草稿、脚本、版本链与画布产物
- `write_file`、画布联动与主题工作流负责把过程沉淀成交付物

### 7. 多 Provider 与兼容层
- OAuth 与 API Key Provider 并存
- 凭证池、模型路由、协议兼容与 HTTP Server 作为底层支撑

### 8. 本地优先与可扩展
- 桌面应用、本地工作区、插件与外部工具扩展
- 允许在不改变产品主形态的前提下向更多执行环境延展

## 文档索引

### 产品与工作台
- [workspace.md](workspace.md) - Workspace 边界与工作区设计
- [skill-standard.md](skill-standard.md) - 统一技能标准、目录与运行边界
- [../../src-tauri/src/skills/README.md](../../src-tauri/src/skills/README.md) - Skills 标准与集成
- [terminal.md](terminal.md) - 终端能力
- [mcp.md](mcp.md) - MCP 服务器
- [plugins.md](plugins.md) - 插件系统
- [aster-integration.md](aster-integration.md) - Agent Runtime 集成

### 基础设施
- [providers.md](providers.md) - Provider 系统
- [credential-pool.md](credential-pool.md) - 凭证池管理
- [converter.md](converter.md) - 协议转换
- [server.md](server.md) - HTTP 服务器

### 前端与公共模块
- [components.md](components.md) - 组件系统
- [hooks.md](hooks.md) - React Hooks
- [lib.md](lib.md) - 工具库

### 配置、服务与数据
- [commands.md](commands.md) - Tauri 命令
- [command-runtime.md](command-runtime.md) - 命令运行时、`@` / `/`、轻卡与 viewer 实施规则
- [site-adapter-standard.md](site-adapter-standard.md) - 站点适配器标准与外部来源接入边界
- [services.md](services.md) - 业务服务
- [database.md](database.md) - 数据库层
- [performance-profiling.md](performance-profiling.md) - 性能分析与火焰图
