# 业务服务

## 概述

业务服务层封装核心业务逻辑，被 Tauri 命令调用。

## 目录结构

```
src-tauri/src/services/
├── mod.rs                      # 模块入口
├── api_key_provider_service.rs # API Key Provider 服务
├── model_registry_service.rs   # 模型注册表服务
├── mcp_service.rs              # MCP 服务器管理
├── prompt_service.rs           # Prompt 管理
├── skill_service.rs            # 技能管理
├── usage_service.rs            # 使用量统计
├── backup_service.rs           # 备份服务
├── update_check_service.rs     # 自动更新检查
```

## 核心服务

> 注意：`general_chat/` 兼容壳已删除。
> 新功能与新治理都应直接落到 `agent_runtime_*` 与现役 `agent/chat` 体系，不要重新引回旧入口。
> 旧 `ProviderPoolService`、`TokenCacheService` 与 OAuth/local CLI credential runtime 已退役。凭证选择统一走 `ApiKeyProviderService`。

### ApiKeyProviderService

```rust
impl ApiKeyProviderService {
    /// 选择当前 Provider 可用的 API Key 配置
    pub async fn select_credential_for_provider(&self, provider_id: &str) -> Result<ProviderCredential>;
}
```

### McpService

```rust
pub struct McpService {
    servers: HashMap<String, McpServer>,
}

impl McpService {
    /// 启动 MCP 服务器
    pub async fn start_server(&self, config: McpConfig) -> Result<()>;
    
    /// 停止 MCP 服务器
    pub async fn stop_server(&self, name: &str) -> Result<()>;
    
    /// 列出工具
    pub async fn list_tools(&self, server: &str) -> Result<Vec<Tool>>;
}
```

## 服务注入

```rust
// 服务由 bootstrap / state 注入，命令层不再管理凭证池服务。
```

## 相关文档

- [commands.md](commands.md) - Tauri 命令
- [credential-pool.md](credential-pool.md) - 凭证池退役说明
