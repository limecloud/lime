# Lime 集成测试指南

> 测试 current 模块间的协作和数据流。

## 概述

集成测试验证多个模块协同工作的正确性，主要覆盖：

- 本地 HTTP Server 的 OpenAI / Anthropic 兼容端点
- API Key Provider 与模型注册表
- Provider 调用与协议转换
- 数据库迁移、文件系统与运行时状态
- 旧凭证池入口保持下线

## 测试场景

### 1. API 服务器集成

```rust
#[cfg(test)]
mod api_integration_tests {
    use super::*;
    use axum::http::StatusCode;
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_chat_completion_endpoint() {
        let app = create_test_app().await;

        let request = Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer test-key")
            .body(Body::from(r#"{
                "model": "gpt-4",
                "messages": [{"role": "user", "content": "Hello"}]
            }"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_streaming_response() {
        let app = create_test_app().await;

        let request = Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{
                "model": "gpt-4",
                "messages": [{"role": "user", "content": "Hello"}],
                "stream": true
            }"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get("content-type").unwrap(),
            "text/event-stream"
        );
    }
}
```

### 2. API Key Provider 与模型注册表集成

```rust
#[cfg(test)]
mod provider_runtime_tests {
    use super::*;

    #[tokio::test]
    async fn test_api_key_provider_selection_uses_runtime_credential() {
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

    #[tokio::test]
    async fn test_model_registry_filters_disabled_provider() {
        let db = create_test_db().await;
        seed_disabled_provider(&db, "openai").await;

        let registry = ModelRegistryService::new();
        let models = registry
            .get_local_fallback_model_ids_with_hints(&db, "openai", None, None, &[])
            .await
            .unwrap();

        assert!(models.is_empty());
    }
}
```

### 3. 退役凭证入口回归

```rust
#[cfg(test)]
mod retired_credential_api_tests {
    use super::*;
    use axum::http::StatusCode;
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_legacy_credentials_http_api_is_not_registered() {
        let app = create_test_app().await;

        let request = Request::builder()
            .method("POST")
            .uri("/v1/credentials/select")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
```

### 4. Provider 与数据库集成

```rust
#[cfg(test)]
mod provider_db_tests {
    use super::*;

    #[tokio::test]
    async fn test_api_key_provider_persists_usage() {
        let db = create_test_db().await;
        let key_id = seed_api_key_provider(&db, "openai", "sk-test").await;

        let state = create_test_app_state(db.clone()).await;
        state
            .record_credential_usage(&db, &runtime_api_key_credential_uuid(&key_id))
            .unwrap();

        let usage = load_api_key_usage(&db, &key_id).await;
        assert_eq!(usage.total_requests, 1);
    }
}
```

## 测试环境设置

### 测试数据库

```rust
async fn create_test_db() -> DbConnection {
    let db = create_memory_db().await.unwrap();
    run_startup_migrations(&db).await.unwrap();
    db
}
```

### Mock HTTP 服务

```rust
use wiremock::{Mock, MockServer, ResponseTemplate};
use wiremock::matchers::{method, path};

async fn setup_mock_openai_server() -> MockServer {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200)
            .set_body_json(json!({
                "id": "chatcmpl-test",
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "ok"
                    }
                }]
            })))
        .mount(&mock_server)
        .await;

    mock_server
}
```
