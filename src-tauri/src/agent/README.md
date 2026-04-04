# Agent 模块

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

AI Agent 集成模块，基于 aster-rust 框架实现。

### 设计决策

- **Aster 框架**：使用 aster-rust 框架获得多 Provider、工具系统、会话管理等能力
- **凭证池桥接**：自动从 Lime 凭证池选择凭证配置 Aster Provider
- **流式响应**：通过 Tauri 事件系统向前端推送流式内容
- **Skills 集成**：自动加载 Lime Skills 到 aster-rust，使 AI 能够自动调用

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块入口，导出公共类型 |
| `types.rs` | Agent 相关类型定义 |
| `aster_state.rs` | Aster Agent 状态管理（主状态桥接；会话配置/项目上下文/身份配置/Skills 加载辅助逻辑委托 `crates/agent/src/aster_state_support.rs`） |
| `aster_agent.rs` | Aster Agent 包装器（流式桥接，会话存储逻辑委托 `crates/agent/src/session_store.rs`） |
| `event_converter.rs` | Aster 事件到 Tauri 事件转换 |
| `credential_bridge.rs` | 重导出层（纯逻辑已迁移到 `crates/agent/src/credential_bridge.rs`） |
| `mcp_bridge.rs` | MCP 服务桥接 |
| `subagent_scheduler.rs` | Tauri 事件桥接层（纯逻辑已迁移到 `crates/agent/src/subagent_scheduler.rs`） |

## Skills 集成

### 自动加载机制

Agent 初始化时自动加载 `~/.lime/skills/` 目录下的 Skills：

```rust
// init_agent_with_db() 内部调用
lime_agent::reload_lime_skills();
```

### AI 自动调用

aster-rust 的 `SkillTool` 会从 `global_registry` 读取可用 Skills，AI 可以：
- 根据用户意图自动选择合适的 Skill
- 通过 `/skill-name` 命令显式调用 Skill

### 动态刷新

安装/卸载 Skills 后自动刷新：

```rust
// skill_cmd.rs 中调用
AsterAgentState::reload_lime_skills();
```

## 使用方式

### 从凭证池配置（推荐）

```rust
// 初始化（同时加载 Skills）
state.init_agent_with_db(&db).await?;

// 从凭证池自动选择凭证并配置 Provider
let config = state
    .configure_provider_from_pool(&db, "openai", "gpt-4", &session_id)
    .await?;
```

### 手动配置

```rust
// 初始化
state.init_agent_with_db(&db).await?;

// 手动配置 Provider
let config = ProviderConfig {
    provider_name: "openai".to_string(),
    model_name: "gpt-4".to_string(),
    api_key: Some("sk-...".to_string()),
    base_url: None,
    credential_uuid: None,
};
state.configure_provider(config, &session_id, &db).await?;
```

### 发送消息

```rust
let user_message = Message::user().with_text("Hello");
let session_config = SessionConfigBuilder::new(&session_id).build();
let stream = agent.reply(user_message, session_config, Some(cancel_token)).await?;
```

## Tauri 命令

| 命令 | 说明 |
|------|------|
| `aster_agent_init` | 初始化 Agent |
| `aster_agent_configure_provider` | 手动配置 Provider |
| `aster_agent_configure_from_pool` | 从凭证池配置 Provider（推荐） |
| `agent_runtime_submit_turn` | 统一提交 turn |
| `agent_runtime_interrupt_turn` | 统一中断 turn |
| `agent_runtime_create/list/get/update/delete_session` | 统一会话管理 |
| `agent_runtime_spawn_subagent / agent_runtime_send_subagent_input / agent_runtime_wait_subagents / agent_runtime_resume_subagent / agent_runtime_close_subagent` | subagent 控制面 |
| `agent_runtime_respond_action` | 统一响应工具确认 / ask / elicitation |

## 凭证池桥接

`credential_bridge.rs` 在主 crate 中仅作为兼容导出，核心逻辑位于 `crates/agent/src/credential_bridge.rs`：

- 自动从凭证池选择可用凭证
- 支持 OAuth 和 API Key 两种凭证类型
- 自动刷新过期的 OAuth Token
- 记录凭证使用和健康状态

详见 [aster-integration.md](../../../docs/aiprompts/aster-integration.md)
