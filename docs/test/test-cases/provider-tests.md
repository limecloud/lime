# Provider 测试用例

> API Key Provider、模型注册表、协议转换与 Provider 调用的测试用例。

## 概述

Provider 当前主链负责：

- API Key Provider 配置、加解密与运行时凭证选择
- 模型注册表候选解析
- OpenAI / Anthropic / Gemini 等协议适配
- Provider 调用错误处理与限流响应

旧 OAuth Provider、Token 刷新、CredentialPool 轮询与健康检查已退役，不再新增测试用例。

## 测试用例

### 1. API Key Provider

#### TC-PROVIDER-001: API Key 凭证选择

```rust
#[tokio::test]
async fn test_select_api_key_provider_credential() {
    let db = create_test_db().await;
    seed_api_key_provider(&db, "openai", "sk-test").await;

    let service = ApiKeyProviderService::new();
    let credential = service
        .select_credential_for_provider(&db, "openai", Some("openai"), None)
        .await
        .unwrap()
        .unwrap();

    assert!(credential.uuid.starts_with("runtime-api-key-"));
}
```

#### TC-PROVIDER-002: 已退役 OAuth 形态不能进入 RuntimeCredentialData

```rust
#[test]
fn test_legacy_oauth_payload_is_rejected() {
    let payload = r#"{
        "type": "kiro_oauth",
        "access_token": "token",
        "refresh_token": "refresh"
    }"#;

    let result = serde_json::from_str::<RuntimeCredentialData>(payload);

    assert!(result.is_err());
}
```

### 2. 模型注册表

#### TC-MODEL-001: disabled provider 不进入候选集

```rust
#[tokio::test]
async fn test_disabled_provider_not_in_candidates() {
    let db = create_test_db().await;
    seed_disabled_provider(&db, "openai").await;

    let registry = ModelRegistryService::new();
    let models = registry
        .get_local_fallback_model_ids_with_hints(&db, "openai", None, None, &[])
        .await
        .unwrap();

    assert!(models.is_empty());
}
```

### 3. 协议转换

#### TC-CONVERTER-001: Antigravity 协议转换保留

```rust
#[test]
fn test_openai_to_antigravity_converter_kept() {
    let request = build_openai_chat_request("hello");

    let converted = convert_openai_to_antigravity(&request).unwrap();

    assert_eq!(converted.messages.len(), 1);
}
```

### 4. Provider 调用错误

#### TC-PROV-ERR-001: 网络错误返回可诊断错误

```rust
#[tokio::test]
async fn test_provider_network_error() {
    let provider = OpenAICustomProvider::with_config(
        "sk-test".to_string(),
        "http://invalid-host:9999".to_string(),
    );

    let result = provider.call_api(&build_openai_chat_request("hello")).await;

    assert!(result.is_err());
}
```

## 测试矩阵

| 测试 ID | 范围 | 场景 | 优先级 |
| --- | --- | --- | --- |
| TC-PROVIDER-001 | API Key Provider | 运行时凭证选择 | P0 |
| TC-PROVIDER-002 | Runtime DTO | 拒绝旧 OAuth payload | P0 |
| TC-MODEL-001 | 模型注册表 | disabled provider 过滤 | P0 |
| TC-CONVERTER-001 | 协议转换 | Antigravity converter 保留 | P0 |
| TC-PROV-ERR-001 | Provider 调用 | 网络错误 | P1 |

## 退役边界

- 不新增 Kiro / Qwen / Codex / Claude / Gemini OAuth 测试。
- 不新增 CredentialPool 轮询、健康检查、Token 刷新测试。
- 不恢复 `/v1/credentials/*` 完整凭证 HTTP API 测试，除非测试目标是确认其保持下线。
