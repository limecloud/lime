# Provider 系统

## 概述

Provider 系统负责与各 LLM 服务商的 API 交互。当前认证事实源是 API Key Provider / configured providers；旧 OAuth 与本地 CLI 凭证池运行时已退役。

如果需求同时涉及“候选模型解析、OEM 与本地 provider 协同、自动与设置平衡、成本/限额事件”，继续补读：

- `docs/roadmap/task/model-routing.md`
- `docs/roadmap/task/oem-and-local-policy.md`

## 目录结构

```
src-tauri/src/providers/
├── mod.rs              # 模块入口和 Provider 枚举
├── traits.rs           # Provider trait 定义
├── error.rs            # 错误类型
├── gemini.rs           # Gemini API Key 请求支持
├── antigravity.rs      # Antigravity 协议兼容支持
├── claude_custom.rs    # Claude API Key
├── openai_custom.rs    # OpenAI API Key
├── codex.rs            # OpenAI Responses / Codex 兼容请求支持
├── vertex.rs           # Vertex AI Provider
└── tests.rs            # 单元测试
```

## Provider 枚举

```rust
pub enum ProviderType {
    ClaudeCustom,   // Claude API Key
    OpenAICustom,   // OpenAI API Key
    GeminiApiKey,   // Gemini API Key
    Codex,          // OpenAI Responses / Codex 兼容 API Key
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

## 已退役 Provider

Kiro / Qwen / Antigravity OAuth / Codex OAuth / Claude OAuth / Gemini OAuth 都属于旧凭证池功能，分类为 `dead`。不得重新接回设置页、Tauri 命令、Token 刷新任务或运行时 fallback。

Antigravity 的协议转换能力不是凭证池功能，`openai_to_antigravity` converter 仍可用于 coding plan。

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

## 添加新 Provider

1. 在 `providers/` 创建新模块文件
2. 实现 `Provider` trait
3. 在 `ProviderType` 枚举添加新类型
4. 同步 API Key Provider schema、模型注册表与连接测试
5. 更新前端 Provider 选择器与文档

## 相关文档

- [credential-pool.md](credential-pool.md) - 凭证池退役说明
- [converter.md](converter.md) - 协议转换
- [server.md](server.md) - HTTP 服务器
