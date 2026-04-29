# 凭证池退役说明

## 当前状态

凭证池管理系统已退役，分类为 `dead`。

后续 Provider 凭证与模型选择只允许收敛到以下 `current` 主路径：

- API Key Provider：应用内 Provider 配置、连接测试、模型发现与默认模型选择
- configured providers：用户已配置 Provider 的事实源
- 模型注册表：Provider / model 目录与协议能力事实源
- 协议转换器：请求协议适配能力，例如 coding plan 仍可使用 `openai_to_antigravity`

旧凭证池不再提供多凭证轮询、OAuth 登录、本地 CLI 凭证导入、健康检查、Token 自动刷新、使用量统计或管理页面。

## 已下线范围

- 前端凭证池管理页、旧凭证卡片、OAuth / 本地凭证表单、`useProviderPool` 与 `providerPool` API 网关
- Rust `ProviderPoolService`、`TokenCacheService`、Kiro 事件服务、OAuth 命令与旧 provider pool 命令
- Kiro / Qwen / Antigravity / Codex OAuth / Claude OAuth / Gemini OAuth 这类登录型或本地 CLI 凭证运行时
- `provider_pool_credentials` 的运行时读取、健康写回与 fallback 选择
- 旧 `provider_pool_model` 运行时 / 展示 DTO 与凭证状态示例插件
- server 内部 `/v1/credentials/*` 完整凭证 HTTP API；Provider 调用只允许通过 API Key Provider current 服务选择 `Runtime*` 凭证
- 托盘里的旧 Token 刷新、凭证健康检查与凭证池计数入口
- 旧 `scripts/playwright-login/` Provider OAuth 授权码自动化脚本及其 Tauri bundle include
- 旧 `src/components/provider-pool/api-key/` 目录名；当前 API Key Provider 组件已迁到 `src/components/api-key-provider/`

## 数据处理

启动期迁移会清理 Lime 管理的旧凭证池数据：

- 清空 `provider_pool_credentials`
- 删除 Lime 应用数据目录下托管的 `credentials/` 副本

这只处理 Lime 自己复制和管理过的数据，不删除用户外部 CLI 原始目录，例如 `~/.codex`、`~/.gemini` 或其它第三方工具目录。

## 保留边界

以下内容不是凭证池功能，仍可继续演进：

- API Key Provider 中的 OpenAI、Anthropic、Gemini API Key、OpenRouter、GitHub、Azure 等配置
- 模型名或模型系列中出现的 `codex`、`gemini`、`qwen` 等字符串
- 协议转换器，尤其是 `src-tauri/crates/providers/src/converter/openai_to_antigravity.rs`
- `lime_core::models::runtime_provider_model` 暴露的 `Runtime*` DTO；它只能承载 current API Key Provider 数据，`RuntimeProviderType` 也不得别名回含旧凭证池 Provider 的历史 `ProviderType`
- API Key Provider 运行时凭证使用 `runtime-api-key-` 临时 UUID 前缀；不得恢复 `fallback-` 或 `[降级]` 这类旧凭证池选择语义
- `retry.auto_switch_provider` 表示 current 的 Provider 自动切换，不代表旧凭证池 fallback；运行时文案不得再把它称为“自动降级”

## 守卫

旧 UI / Hook / API / 脚本文件路径已登记到 `src/lib/governance/legacySurfaceCatalog.json`，不允许重新接回前端入口、打包资源或运行时兜底。

涉及 Provider 或命令边界时，至少执行：

```bash
npm run test:contracts
npm run governance:legacy-report
```

如果改动影响设置页或 Agent 运行主路径，再补：

```bash
npm run verify:local
npm run verify:gui-smoke
```

## 相关文档

- [providers.md](providers.md) - Provider current 主路径
- [commands.md](commands.md) - Tauri 命令边界
- [database.md](database.md) - 数据库层与启动迁移
- [converter.md](converter.md) - 协议转换
