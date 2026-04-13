# Provider 系统

## 概述

Provider 系统负责与各 LLM 服务商的认证和 API 交互。支持 OAuth 和 API Key 两种认证方式。

## 目录结构

```
src-tauri/src/providers/
├── mod.rs              # 模块入口和 Provider 枚举
├── traits.rs           # Provider trait 定义
├── error.rs            # 错误类型
├── kiro.rs             # Kiro/CodeWhisperer OAuth
├── gemini.rs           # Gemini OAuth
├── qwen.rs             # Qwen OAuth
├── antigravity.rs      # Antigravity OAuth
├── claude_oauth.rs     # Claude OAuth
├── claude_custom.rs    # Claude API Key
├── openai_custom.rs    # OpenAI API Key
├── codex.rs            # Codex Provider
├── iflow.rs            # iFlow Provider
├── vertex.rs           # Vertex AI Provider
└── tests.rs            # 单元测试
```

## Provider 枚举

```rust
pub enum ProviderType {
    Kiro,           // Kiro/CodeWhisperer OAuth
    Gemini,         // Google Gemini OAuth
    Qwen,           // 通义千问 OAuth
    Antigravity,    // Antigravity (Gemini CLI) OAuth
    ClaudeOAuth,    // Claude OAuth
    ClaudeCustom,   // Claude API Key
    OpenAICustom,   // OpenAI API Key
    Codex,          // Codex
    IFlow,          // iFlow
    Vertex,         // Vertex AI
}
```

## Provider Trait

```rust
pub trait Provider: Send + Sync {
    /// 获取 Provider 类型
    fn provider_type(&self) -> ProviderType;
    
    /// 加载凭证
    async fn load_credential(&self, path: &Path) -> Result<CredentialData>;
    
    /// 刷新 Token
    async fn refresh_token(&self, credential: &mut CredentialData) -> Result<()>;
    
    /// 检查 Token 是否过期
    fn is_token_expired(&self, credential: &CredentialData) -> bool;
    
    /// 发送 API 请求
    async fn send_request(&self, credential: &CredentialData, request: &Request) -> Result<Response>;
}
```

## OAuth Provider 实现

### Kiro Provider

```rust
// 凭证文件结构
struct KiroCredential {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    client_id: Option<String>,      // 从 clientIdHash 合并
    client_secret: Option<String>,  // 从 clientIdHash 合并
}

// Token 刷新流程
1. 检查 expires_at 是否过期
2. 使用 refresh_token 请求新 token
3. 更新凭证文件
```

### Gemini Provider

```rust
// OAuth 端点
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

// 凭证文件结构
struct GeminiCredential {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
}
```

## API Key Provider 实现

### OpenAI Custom

```rust
// 凭证结构
struct OpenAICredential {
    api_key: String,
    base_url: Option<String>,  // 自定义端点
}

// 请求头
Authorization: Bearer {api_key}
```

### Claude Custom

```rust
// 凭证结构
struct ClaudeCredential {
    api_key: String,
    base_url: Option<String>,
}

// 请求头
x-api-key: {api_key}
anthropic-version: 2023-06-01
```

## Prompt Cache 能力边界

Lime 当前把 Prompt Cache 能力视为 **Provider 显式声明优先、类型默认兜底**，而不是“请求长得像哪家协议”：

- `anthropic` / `claude` / `claude-oauth`：默认 `automatic`
- `anthropic-compatible`：默认 `explicit_only`，但自定义 Provider 可显式声明为 `automatic`
- 其它 Provider：默认 `not_applicable`

前台提示层额外保留一个**已知官方 Host 例外**：

- 对 `https://open.bigmodel.cn/api/anthropic` 这类智谱官方 Anthropic 兼容 Host，Lime 前台不再把它误报成“仅显式缓存”
- 这只影响 UI 提示与 badge 收口，不代表 Lime 会把该 Host 直接等同于 Anthropic `cache_control` 自动注入语义

这条事实源当前收敛在：

- 前端：`src/lib/model/providerPromptCacheSupport.ts`
- 后端：Provider 类型与运行时能力判断链
- 模型注册表映射：只负责 provider/model 目录归一，不参与 Prompt Cache 能力推断

需要特别注意：

1. `anthropic-compatible` 只表示接入方兼容 Anthropic wire format，不等于上游已经实现 Anthropic Automatic Prompt Caching
2. Lime 不会因为某个自定义渠道“长得像 Anthropic”就默认把它当成官方 Anthropic 自动缓存能力
3. 对自定义 `anthropic-compatible` 渠道，只有在上游明确声明支持 Automatic Prompt Cache 时才应配置为 `automatic`
4. 若未声明自动缓存，Lime 只保留显式 `cache_control` 语义；如果上游没有实现 Automatic Prompt Cache，`cached_input_tokens` 为空不能直接归因到 Lime 没发字段

排查这类问题时，优先确认三件事：

1. 当前 Provider 类型是不是 `anthropic-compatible`
2. 上游服务是否真的声明支持 Anthropic Automatic Prompt Caching
3. 响应 usage 中是否存在 `cache_creation_input_tokens` / `cache_read_input_tokens` / `cached_input_tokens`

## 凭证管理策略

### 方案 B: 独立副本策略

```
原始凭证文件 (用户上传)
       │
       ▼
┌─────────────────────────────────────┐
│  合并 clientIdHash 中的             │
│  client_id / client_secret          │
└─────────────────────────────────────┘
       │
       ▼
副本凭证文件 (credentials/ 目录)
       │
       ▼
独立刷新和管理
```

优点：
- 每个副本完全独立
- 支持多账号场景
- 不影响原始文件

## 健康检查

```rust
// 健康检查逻辑
async fn health_check(&self, credential: &CredentialData) -> HealthStatus {
    // 1. 检查 Token 是否过期
    if self.is_token_expired(credential) {
        return HealthStatus::TokenExpired;
    }
    
    // 2. 尝试刷新 Token
    if let Err(e) = self.refresh_token(credential).await {
        return HealthStatus::RefreshFailed(e);
    }
    
    // 3. 发送测试请求
    match self.send_test_request(credential).await {
        Ok(_) => HealthStatus::Healthy,
        Err(e) => HealthStatus::Unhealthy(e),
    }
}
```

## 添加新 Provider

1. 在 `providers/` 创建新模块文件
2. 实现 `Provider` trait
3. 在 `ProviderType` 枚举添加新类型
4. 在 `ProviderPoolService` 注册健康检查
5. 更新前端 Provider 选择器

## 相关文档

- [credential-pool.md](credential-pool.md) - 凭证池管理
- [converter.md](converter.md) - 协议转换
- [server.md](server.md) - HTTP 服务器
