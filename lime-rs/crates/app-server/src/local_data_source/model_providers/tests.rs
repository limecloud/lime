use super::*;
use lime_core::database::schema;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn setup_model_provider_db() -> DbConnection {
    let conn = Connection::open_in_memory().expect("open db");
    schema::create_tables(&conn).expect("create schema");
    Arc::new(Mutex::new(conn))
}

async fn spawn_models_fixture() -> (String, tokio::task::JoinHandle<String>) {
    spawn_models_fixture_body(r#"{"models":[{"name":"qwen3:14b","details":{"family":"qwen3"}}]}"#)
        .await
}

async fn spawn_models_fixture_body(
    body: &'static str,
) -> (String, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind models fixture");
    let address = listener.local_addr().expect("models fixture address");
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept models request");
        let mut request = [0_u8; 4096];
        let size = stream
            .read(&mut request)
            .await
            .expect("read models request");
        let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write models response");
        String::from_utf8_lossy(&request[..size]).into_owned()
    });
    (format!("http://{address}"), server)
}

#[tokio::test]
async fn declared_catalog_order_uses_discovered_metadata_like_runtime_routing() {
    let db = setup_model_provider_db();
    let service = ApiKeyProviderService::new();
    let registry = ModelRegistryService::new(db.clone());
    let (host, server) = spawn_models_fixture_body(r#"{"data":[
        {"id":"discovered","task_families":["chat"]},
        {"id":"declared","task_families":["chat"],"service_tiers":[{"id":"priority"},{"id":"flex"}],"default_service_tier":"priority"}
    ]}"#).await;
    insert_typed_provider_with_host(
        &db,
        "tier-provider",
        "openai",
        &host,
        true,
        &["fallback", "declared"],
    );
    let key = service
        .add_api_key(&db, "tier-provider", "fixture-tier-key", None, true)
        .unwrap();
    fetch_model_provider_models(
        &db,
        &service,
        &registry,
        ModelProviderFetchModelsParams {
            provider_id: "tier-provider".into(),
        },
    )
    .await
    .unwrap();
    server.await.unwrap();
    let catalogs = model_catalog(
        &db,
        &service,
        &registry,
        crate::ModelCatalogQuery {
            provider_id: Some("tier-provider".into()),
        },
    )
    .unwrap();
    let models = &catalogs[0].models;
    assert_eq!(
        models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        ["fallback", "declared", "discovered"]
    );
    assert_eq!(models[1].default_service_tier.as_deref(), Some("priority"));
    assert_eq!(
        models[1]
            .service_tiers
            .iter()
            .map(|tier| tier.id.as_str())
            .collect::<Vec<_>>(),
        ["priority", "flex"]
    );
    let credential = service
        .select_runtime_credential_by_ref(
            &db,
            "tier-provider",
            &runtime_api_key_credential_uuid(&key.id),
        )
        .unwrap()
        .unwrap();
    let provider = service.get_provider(&db, "tier-provider").unwrap().unwrap();
    let runtime = registry
        .resolve_provider_model_metadata(
            Some(&provider),
            "tier-provider",
            "declared",
            ProviderModelCacheAccess::Credential(&credential),
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(runtime.model.as_ref().unwrap()).unwrap(),
        serde_json::to_value(&models[1]).unwrap()
    );
}

#[test]
fn provider_model_config_to_core_preserves_explicit_capability() {
    let input = serde_json::json!({
        "id": "grok-4.5",
        "displayName": "Grok 4.5",
        "capability": {
            "taskFamilies": ["chat", "reasoning"],
            "inputModalities": ["text", "image"],
            "outputModalities": ["text"],
            "runtimeFeatures": ["streaming", "tool_calling"],
            "capabilities": {
                "vision": true,
                "tools": true,
                "streaming": true,
                "jsonMode": true,
                "functionCalling": true,
                "reasoning": true,
                "reasoningEffort": {
                    "supported": true,
                    "levels": ["medium", "xhigh"],
                    "options": [{
                        "id": "deep",
                        "value": "xhigh",
                        "label": "Deep",
                        "description": "Maximum reasoning",
                        "default": true
                    }],
                    "default": "xhigh",
                    "source": "api"
                }
            }
        }
    });
    for declared in [None, Some(false), Some(true)] {
        let mut input = input.clone();
        if let Some(supported) = declared {
            input["capability"]["capabilities"]["supportsReasoningSummaries"] =
                serde_json::json!(supported);
            input["capability"]["capabilities"]["supportVerbosity"] = serde_json::json!(supported);
        }
        let model: ProtocolProviderModelConfig =
            serde_json::from_value(input).expect("deserialize typed provider model");

        let model = provider_model_config_to_core(model).expect("convert provider model");

        assert_eq!(model.id, "grok-4.5");
        assert_eq!(model.display_name.as_deref(), Some("Grok 4.5"));
        assert_eq!(
            serde_json::to_value(model.capability.expect("explicit capability"))
                .expect("serialize capability"),
            serde_json::json!({
                "task_families": ["chat", "reasoning"],
                "input_modalities": ["text", "image"],
                "output_modalities": ["text"],
                "runtime_features": ["streaming", "tool_calling"],
                "capabilities": {
                    "vision": true,
                    "tools": true,
                    "streaming": true,
                    "json_mode": true,
                    "function_calling": true,
                    "reasoning": true,
                    "supports_reasoning_summaries": declared.unwrap_or(false),
                    "support_verbosity": declared.unwrap_or(false),
                    "reasoning_effort": {
                        "supported": true,
                        "levels": ["medium", "xhigh"],
                        "options": [{
                            "id": "deep",
                            "value": "xhigh",
                            "label": "Deep",
                            "description": "Maximum reasoning",
                            "default": true
                        }],
                        "default": "xhigh",
                        "source": "api"
                    }
                }
            })
        );
    }
}

#[test]
fn provider_model_config_to_core_rejects_unknown_capability_taxonomy() {
    let model: ProtocolProviderModelConfig = serde_json::from_value(serde_json::json!({
        "id": "unknown-model",
        "capability": {
            "taskFamilies": ["unknown_task"],
            "inputModalities": [],
            "outputModalities": [],
            "runtimeFeatures": [],
            "capabilities": {
                "vision": false,
                "tools": false,
                "streaming": false,
                "jsonMode": false,
                "functionCalling": false,
                "reasoning": false
            }
        }
    }))
    .expect("deserialize protocol model");

    let error = provider_model_config_to_core(model).expect_err("reject unknown taxonomy");
    let message = error.to_string();
    assert!(message.contains("taskFamilies"));
    assert!(message.contains("unknown_task"));
}

fn insert_provider(db: &DbConnection, provider_id: &str, enabled: bool, models: &[&str]) {
    insert_typed_provider(db, provider_id, "openai", enabled, models);
}

fn insert_typed_provider(
    db: &DbConnection,
    provider_id: &str,
    provider_type: &str,
    enabled: bool,
    models: &[&str],
) {
    insert_typed_provider_with_host(
        db,
        provider_id,
        provider_type,
        "https://llm.limeai.run#lime_tenant_id=tenant-0001",
        enabled,
        models,
    );
}

fn insert_typed_provider_with_host(
    db: &DbConnection,
    provider_id: &str,
    provider_type: &str,
    api_host: &str,
    enabled: bool,
    models: &[&str],
) {
    let models = models
        .iter()
        .map(|model| CoreProviderModelConfig::hint(*model))
        .collect::<Vec<_>>();
    let models = serde_json::to_string(&models).expect("serialize models");
    let conn = db.lock().expect("lock db");
    conn.execute(
        "INSERT INTO api_key_providers (
                id, name, type, api_host, is_system, group_name, enabled, sort_order,
                models, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 0, 'cloud', ?5, 0, ?6, ?7, ?7)",
        params![
            provider_id,
            provider_id,
            provider_type,
            api_host,
            if enabled { 1 } else { 0 },
            models,
            "2026-07-06T00:00:00Z",
        ],
    )
    .expect("insert provider");
}

#[tokio::test]
async fn model_catalog_includes_enabled_provider_declared_models() {
    let db = setup_model_provider_db();
    insert_provider(&db, "lime-hub", true, &["gpt-5.1", "gpt-5.1"]);
    let api_key_provider_service = ApiKeyProviderService::new();
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery {
            provider_id: Some("lime-hub".to_string()),
        },
    )
    .expect("list models");

    assert_eq!(catalogs.len(), 1);
    assert_eq!(catalogs[0].models.len(), 1);
    assert_eq!(catalogs[0].models[0].id, "gpt-5.1");
    assert_eq!(catalogs[0].provider_id, "lime-hub");
}

#[tokio::test]
async fn model_catalog_orders_providers_by_sort_order_then_id() {
    let db = setup_model_provider_db();
    insert_typed_provider_with_host(
        &db,
        "provider-z",
        "openai",
        "https://llm.limeai.run#lime_tenant_id=tenant-0001",
        true,
        &["model-z"],
    );
    insert_typed_provider_with_host(
        &db,
        "provider-a",
        "openai",
        "https://llm.limeai.run#lime_tenant_id=tenant-0001",
        true,
        &["model-a"],
    );
    {
        let conn = db.lock().expect("lock db");
        conn.execute(
            "UPDATE api_key_providers SET sort_order = 20 WHERE id = 'provider-a'",
            [],
        )
        .expect("update provider sort order");
        conn.execute(
            "UPDATE api_key_providers SET sort_order = 10 WHERE id = 'provider-z'",
            [],
        )
        .expect("update provider sort order");
    }
    let api_key_provider_service = ApiKeyProviderService::new();
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery::default(),
    )
    .expect("list ordered model catalog");

    assert_eq!(
        catalogs
            .iter()
            .map(|catalog| catalog.provider_id.as_str())
            .collect::<Vec<_>>(),
        vec!["provider-z", "provider-a"]
    );
}

#[tokio::test]
async fn model_catalog_skips_disabled_provider_declared_models() {
    let db = setup_model_provider_db();
    insert_provider(&db, "disabled-hub", false, &["gpt-disabled"]);
    let api_key_provider_service = ApiKeyProviderService::new();
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery::default(),
    )
    .expect("list models");

    assert!(catalogs.is_empty());
}

#[tokio::test]
async fn model_catalog_skips_provider_without_required_key() {
    let db = setup_model_provider_db();
    insert_typed_provider_with_host(
        &db,
        "missing-key-route",
        "openai",
        "https://api.openai.com/v1",
        true,
        &["gpt-unready"],
    );
    let api_key_provider_service = ApiKeyProviderService::new();
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery {
            provider_id: Some("missing-key-route".to_string()),
        },
    )
    .expect("list models without required key");

    assert!(catalogs.is_empty());
}

#[tokio::test]
async fn model_catalog_includes_provider_with_enabled_key() {
    let db = setup_model_provider_db();
    insert_typed_provider_with_host(
        &db,
        "ready-openai-route",
        "openai",
        "https://api.openai.com/v1",
        true,
        &["gpt-ready"],
    );
    let api_key_provider_service = ApiKeyProviderService::new();
    api_key_provider_service
        .add_api_key(&db, "ready-openai-route", "sk-test", None, true)
        .expect("add enabled OpenAI key");
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery {
            provider_id: Some("ready-openai-route".to_string()),
        },
    )
    .expect("list models with enabled key");

    assert_eq!(catalogs.len(), 1);
    assert_eq!(catalogs[0].models.len(), 1);
    assert_eq!(catalogs[0].models[0].id, "gpt-ready");
}

#[tokio::test]
async fn model_catalog_uses_official_agnes_endpoint_capabilities() {
    let db = setup_model_provider_db();
    insert_typed_provider_with_host(
        &db,
        "custom-agnes",
        "openai",
        "https://apihub.agnes-ai.com/v1",
        true,
        &["agnes-2.5-pro"],
    );
    let api_key_provider_service = ApiKeyProviderService::new();
    api_key_provider_service
        .add_api_key(&db, "custom-agnes", "sk-agnes", None, true)
        .expect("add enabled Agnes key");
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery {
            provider_id: Some("custom-agnes".to_string()),
        },
    )
    .expect("list Agnes models");

    assert_eq!(catalogs.len(), 1);
    assert_eq!(catalogs[0].models.len(), 1);
    let model = &catalogs[0].models[0];
    assert_eq!(model.id, "agnes-2.5-pro");
    assert_eq!(
        model.capability_provenance,
        lime_core::models::model_registry::ModelCapabilityProvenance::Canonical
    );
    assert_eq!(
        model.canonical_model_id.as_deref(),
        Some("agnes/agnes-2.5-pro")
    );
    assert!(model.capabilities.vision);
    assert!(model.capabilities.tools);
    assert!(model.capabilities.streaming);
    assert!(model.capabilities.reasoning);
}

#[tokio::test]
async fn model_catalog_includes_gemini_with_enabled_key() {
    let db = setup_model_provider_db();
    insert_typed_provider_with_host(
        &db,
        "ready-gemini-route",
        "gemini",
        "https://generativelanguage.googleapis.com",
        true,
        &["gemini-2.5-flash"],
    );
    let api_key_provider_service = ApiKeyProviderService::new();
    api_key_provider_service
        .add_api_key(&db, "ready-gemini-route", "gemini-test", None, true)
        .expect("add enabled Gemini key");
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery {
            provider_id: Some("ready-gemini-route".to_string()),
        },
    )
    .expect("list Gemini models with enabled key");

    assert_eq!(catalogs.len(), 1);
    assert_eq!(catalogs[0].models.len(), 1);
    assert_eq!(catalogs[0].models[0].id, "gemini-2.5-flash");
}

#[tokio::test]
async fn model_catalog_includes_azure_responses_with_enabled_key() {
    let db = setup_model_provider_db();
    insert_typed_provider_with_host(
        &db,
        "ready-azure-route",
        "azure-openai",
        "https://resource.openai.azure.com",
        true,
        &["gpt-5.4"],
    );
    let api_key_provider_service = ApiKeyProviderService::new();
    api_key_provider_service
        .add_api_key(&db, "ready-azure-route", "azure-test", None, true)
        .expect("add enabled Azure key");
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery {
            provider_id: Some("ready-azure-route".to_string()),
        },
    )
    .expect("list Azure models with enabled key");

    assert_eq!(catalogs.len(), 1);
    assert_eq!(catalogs[0].models.len(), 1);
    assert_eq!(catalogs[0].models[0].id, "gpt-5.4");
}

#[tokio::test]
async fn model_catalog_includes_keyless_ollama_responses_adapter() {
    let db = setup_model_provider_db();
    insert_typed_provider_with_host(
        &db,
        "local-ollama",
        "ollama",
        "http://127.0.0.1:11434",
        true,
        &["qwen3:14b"],
    );
    let api_key_provider_service = ApiKeyProviderService::new();
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery {
            provider_id: Some("local-ollama".to_string()),
        },
    )
    .expect("list keyless Ollama models");

    assert_eq!(catalogs.len(), 1);
    assert_eq!(catalogs[0].provider_id, "local-ollama");
    assert_eq!(catalogs[0].models.len(), 1);
    assert_eq!(catalogs[0].models[0].id, "qwen3:14b");
}

#[tokio::test]
async fn model_catalog_skips_non_chat_and_unknown_provider_types() {
    let db = setup_model_provider_db();
    insert_typed_provider(&db, "media-route", "fal", true, &["fal-image"]);
    insert_typed_provider(
        &db,
        "bedrock-route",
        "aws-bedrock",
        true,
        &["bedrock-model"],
    );
    insert_typed_provider(
        &db,
        "unknown-route",
        "future-provider",
        true,
        &["future-model"],
    );
    let api_key_provider_service = ApiKeyProviderService::new();
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery::default(),
    )
    .expect("list filtered provider models");

    assert!(catalogs.is_empty());
}

#[tokio::test]
async fn model_catalog_includes_ready_vertex_declared_models() {
    let db = setup_model_provider_db();
    let api_key_provider_service = ApiKeyProviderService::new();
    let provider = api_key_provider_service
        .add_custom_provider(
            &db,
            "Vertex route".to_string(),
            ApiProviderType::Vertexai,
            String::new(),
            None,
            Some("project-alpha".to_string()),
            Some("us-central1".to_string()),
            None,
            None,
        )
        .expect("create Vertex provider");
    api_key_provider_service
        .update_provider(
            &db,
            &provider.id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(vec![CoreProviderModelConfig::hint("gemini-2.5-flash")]),
        )
        .expect("declare Vertex model");
    api_key_provider_service
        .add_api_key(&db, &provider.id, "vertex-token", None, true)
        .expect("add Vertex access token");
    let model_registry_service = ModelRegistryService::new(db.clone());

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery {
            provider_id: Some(provider.id.clone()),
        },
    )
    .expect("list Vertex models");

    assert_eq!(catalogs.len(), 1);
    assert_eq!(catalogs[0].provider_id, provider.id);
    assert_eq!(catalogs[0].models.len(), 1);
    assert_eq!(catalogs[0].models[0].id, "gemini-2.5-flash");
}

#[tokio::test]
async fn keyless_fetch_models_uses_enabled_key_and_preserves_last_success() {
    let db = setup_model_provider_db();
    let api_key_provider_service = ApiKeyProviderService::new();
    let model_registry_service = ModelRegistryService::new(db.clone());
    let (api_host, server) = spawn_models_fixture().await;
    let provider = api_key_provider_service
        .add_custom_provider(
            &db,
            "Keyless Models Fixture".to_string(),
            ApiProviderType::Ollama,
            api_host.clone(),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("create keyless provider");
    api_key_provider_service
        .add_api_key(&db, &provider.id, "scope-keyless-cache", None, false)
        .expect("add keyless provider key");

    let response = fetch_model_provider_models(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        ModelProviderFetchModelsParams {
            provider_id: provider.id.clone(),
        },
    )
    .await
    .expect("fetch keyless models");
    let request = server.await.expect("join models fixture");

    assert_eq!(response.models.len(), 1);
    assert_eq!(response.models[0].id, "qwen3:14b");
    assert!(request.contains("scope-keyless-cache"));
    let last_success = model_registry_service
        .get_cached_provider_models(&provider.id, &api_host, Some(ApiProviderType::Ollama))
        .expect("read unscoped keyless cache")
        .expect("provider last-success cache");
    assert!(last_success.from_cache);
    assert_eq!(last_success.models.len(), 1);
    assert_eq!(last_success.models[0].id, "qwen3:14b");
    let cached = model_registry_service
        .fetch_models_from_api_with_hints(
            &provider.id,
            &api_host,
            "scope-keyless-cache",
            Some(ApiProviderType::Ollama),
            &[],
        )
        .await
        .expect("read scoped keyless cache");
    assert!(cached.from_cache);
    assert_eq!(cached.models.len(), 1);
    assert_eq!(cached.models[0].id, "qwen3:14b");

    let catalogs = model_catalog(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        crate::ModelCatalogQuery {
            provider_id: Some(provider.id.clone()),
        },
    )
    .expect("credential-scoped discovery should enter model catalog");
    assert_eq!(catalogs.len(), 1);
    assert_eq!(catalogs[0].models.len(), 1);
    assert_eq!(catalogs[0].models[0].id, "qwen3:14b");
    assert_eq!(
        catalogs[0].models[0].capability_provenance,
        lime_core::models::model_registry::ModelCapabilityProvenance::InferredHint
    );
}

#[tokio::test]
async fn keyless_fetch_models_without_enabled_key_writes_unscoped_cache() {
    let db = setup_model_provider_db();
    let api_key_provider_service = ApiKeyProviderService::new();
    let model_registry_service = ModelRegistryService::new(db.clone());
    let (api_host, server) = spawn_models_fixture().await;
    let provider = api_key_provider_service
        .add_custom_provider(
            &db,
            "Unscoped Keyless Models Fixture".to_string(),
            ApiProviderType::Ollama,
            api_host.clone(),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("create keyless provider without key");

    let response = fetch_model_provider_models(
        &db,
        &api_key_provider_service,
        &model_registry_service,
        ModelProviderFetchModelsParams {
            provider_id: provider.id.clone(),
        },
    )
    .await
    .expect("fetch keyless models without key");
    let request = server.await.expect("join models fixture");

    assert_eq!(response.models.len(), 1);
    assert_eq!(response.models[0].id, "qwen3:14b");
    assert!(!request.to_ascii_lowercase().contains("authorization:"));
    let cached = model_registry_service
        .get_cached_provider_models(&provider.id, &api_host, Some(ApiProviderType::Ollama))
        .expect("read unscoped keyless cache")
        .expect("unscoped keyless cache");
    assert_eq!(cached.models.len(), 1);
    assert_eq!(cached.models[0].id, "qwen3:14b");
}
