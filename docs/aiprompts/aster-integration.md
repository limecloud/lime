# Aster 框架集成

## 集成状态 ✅

ProxyCast 已完整集成 aster-rust 框架，包括凭证池桥接。

**后端模块** (`src-tauri/src/agent/`):

- `aster_state.rs` - Agent 状态管理
- `aster_agent.rs` - Agent 包装器
- `event_converter.rs` - 事件转换器
- `credential_bridge.rs` - 凭证池桥接

**Tauri 命令** (`src-tauri/src/commands/aster_agent_cmd.rs`):

- `aster_agent_init` - 初始化 Agent
- `aster_agent_configure_provider` - 手动配置 Provider
- `aster_agent_configure_from_pool` - 从凭证池配置 Provider（推荐）
- `aster_agent_status` - 获取状态
- `aster_agent_chat_stream` - 流式对话
- `aster_agent_stop` - 停止会话
- `aster_session_create/list/get` - 会话管理

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      前端 (React)                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  sendAsterMessageStream / configureAsterProvider            ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Tauri Commands                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  aster_agent_cmd.rs                                          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Agent 模块                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ aster_state │  │ credential  │  │ event_converter         │  │
│  │ (状态管理)  │  │ _bridge     │  │ (事件转换)              │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────┘  │
│         │                │                                      │
│         ▼                ▼                                      │
│  ┌─────────────────────────────────────┐                        │
│  │     ProxyCast 凭证池                 │                        │
│  │  - ProviderPoolService              │                        │
│  │  - ApiKeyProviderService            │                        │
│  └─────────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Aster 框架                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Agent       │  │ Provider    │  │ Session                 │  │
│  │ (核心)      │  │ (多种)      │  │ (会话)                  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 凭证池桥接

### 支持的凭证类型映射

| ProxyCast 凭证类型         | Aster Provider |
| -------------------------- | -------------- |
| OpenAIKey                  | openai         |
| ClaudeKey / AnthropicKey   | anthropic      |
| KiroOAuth                  | bedrock        |
| GeminiOAuth / GeminiApiKey | google         |
| VertexKey                  | gcpvertexai    |
| CodexOAuth                 | codex          |
| ClaudeOAuth                | anthropic      |
| AntigravityOAuth           | google         |

### 使用方式

> 治理约定：前端业务层不要直接 `invoke('aster_*')`，统一通过 `src/lib/api/agentRuntime.ts` 调用现役 Aster API。

```typescript
import {
  configureAsterProvider,
  sendAsterMessageStream,
} from "@/lib/api/agentRuntime";

// 配置 Provider
const status = await configureAsterProvider(
  {
    provider_name: "openai",
    model_name: "gpt-4",
  },
  "my-session",
);

// 流式对话
await sendAsterMessageStream(
  "Hello",
  "my-session",
  "agent_stream",
  "workspace-id",
);
```

## 相关文档

- [overview.md](overview.md) - 项目架构
- [providers.md](providers.md) - Provider 系统
- [credential-pool.md](credential-pool.md) - 凭证池管理
