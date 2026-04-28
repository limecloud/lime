# providers

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

各 LLM Provider 的 API 实现。认证事实源已经收敛到 API Key Provider；旧 OAuth / 本地 CLI 凭证 provider runtime 已退役。

## 文件索引

- `mod.rs` - 模块入口和 Provider 枚举
- `traits.rs` - Provider trait 定义
- `error.rs` - 错误类型定义
- `gemini.rs` - Gemini API Key 请求支持
- `claude_custom.rs` - Claude API Key 认证
- `openai_custom.rs` - OpenAI API Key 认证
- `codex.rs` - OpenAI Responses / Codex 兼容请求支持
- `vertex.rs` - Vertex AI Provider
- `tests.rs` - 单元测试

Kiro、Antigravity OAuth、Claude OAuth、Gemini OAuth、Codex OAuth 属于旧凭证池功能，不应重新加入本目录编译图。Antigravity 仅保留 `converter/openai_to_antigravity.rs` 协议转换能力。

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
