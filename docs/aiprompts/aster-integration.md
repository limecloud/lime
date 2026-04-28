# Aster 框架集成

## 集成状态 ✅

Lime 已完整集成 aster-rust 框架。Provider 配置桥接已收敛到 API Key Provider。

## 当前事实源

- `Aster thread / turn / item runtime` 是运行态事实源。
- Aster shared runtime store 与全局 session store 必须在 Lime bootstrap 启动期显式初始化；启动恢复时由 runtime support 统一完成 legacy queue 迁移与 queued session 枚举。
- 运行时命令与 service 只允许读取已准备好的 shared store / shared queue service，不再在热路径偷偷 fallback 到默认路径。
- Lime 只负责事件映射、数据库投影和 UI 派生，不再伪造核心 runtime item。
- 会话删除统一收口到存储边界；命令层和 Dev Bridge 不应直接调用 `AgentDao::delete_session`。
- 需要恢复运行态时，优先从 Aster runtime 恢复，再映射到 Lime timeline。

**后端模块** (`src-tauri/src/agent/`):

- `aster_state.rs` - Agent 状态管理
- `aster_agent.rs` - Agent 包装器
- `event_converter.rs` - 事件转换器
- `credential_bridge.rs` - API Key Provider 桥接

**Tauri 命令** (`src-tauri/src/commands/aster_agent_cmd.rs`):

- `aster_agent_init` - 初始化 Agent
- `aster_agent_configure_provider` - 手动配置 Provider
- `aster_agent_status` - 获取状态
- `agent_runtime_submit_turn` - 统一提交 turn
- `agent_runtime_interrupt_turn` - 统一中断 turn
- `agent_runtime_create/list/get/update/delete_session` - 统一会话管理
- `agent_runtime_respond_action` - 统一响应工具确认 / ask / elicitation

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      前端 (React)                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  useAsterAgentChat / agentRuntime.ts / configureAsterProvider ││
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
│  │     Lime Provider 配置              │                        │
│  │  - ApiKeyProviderService            │                        │
│  │  - ModelRegistryService             │                        │
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

## Provider 桥接

### 支持的凭证类型映射

| Lime 凭证类型         | Aster Provider |
| -------------------------- | -------------- |
| OpenAIKey                  | openai         |
| ClaudeKey / AnthropicKey   | anthropic      |
| GeminiApiKey               | google         |
| VertexKey                  | gcpvertexai    |
| Codex API Key              | codex          |

Kiro / Gemini OAuth / Codex OAuth / Claude OAuth / Antigravity OAuth 均已退役，不再作为 Aster Provider 配置来源。

### 使用方式

> 治理约定：前端业务层不要直接 `invoke('aster_*')`，统一通过 `src/lib/api/agentRuntime.ts` 调用现役 Aster API。历史 `src/lib/api/agentCompat.ts` 已删除。
>
> 删除治理约定：会话删除统一走 `agent_runtime_delete_session`，不要再暴露旧 Aster/Dev Bridge 删除边界。

```typescript
import {
  createAgentRuntimeSession,
  configureAsterProvider,
  submitAgentRuntimeTurn,
} from "@/lib/api/agentRuntime";

const sessionId = await createAgentRuntimeSession("workspace-id");

// 配置 Provider
const status = await configureAsterProvider(
  {
    provider_name: "openai",
    model_name: "gpt-4",
  },
  sessionId,
);

// 流式对话
await submitAgentRuntimeTurn({
  message: "Hello",
  session_id: sessionId,
  event_name: "agent_stream",
  workspace_id: "workspace-id",
});
```

## 相关文档

- [overview.md](overview.md) - 项目架构
- [providers.md](providers.md) - Provider 系统
- [credential-pool.md](credential-pool.md) - 凭证池退役说明
