use super::{args_or_default, get_string_arg};
use crate::dev_bridge::DevBridgeState;
use lime_server_utils::load_model_registry_provider_ids_from_resources;
use lime_services::model_registry_service::ModelRegistryService;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result: JsonValue = match cmd {
        "get_models" => serde_json::json!({
            "data": [
                {"id": "claude-sonnet-4-20250514", "object": "model", "owned_by": "anthropic"},
                {"id": "claude-opus-4-20250514", "object": "model", "owned_by": "anthropic"},
                {"id": "claude-haiku-4-20250514", "object": "model", "owned_by": "anthropic"},
                {"id": "gpt-4o", "object": "model", "owned_by": "openai"},
                {"id": "gpt-4o-mini", "object": "model", "owned_by": "openai"},
            ]
        }),
        "get_model_registry" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;
            serde_json::to_value(service.get_all_models().await)?
        }
        "get_model_preferences" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;
            serde_json::to_value(service.get_all_preferences().await?)?
        }
        "get_model_sync_state" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;
            serde_json::to_value(service.get_sync_state().await)?
        }
        "get_all_alias_configs" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;
            serde_json::to_value(service.get_all_alias_configs().await)?
        }
        "refresh_model_registry" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;
            serde_json::json!(service.force_reload().await?)
        }
        "get_model_registry_provider_ids" => {
            serde_json::to_value(load_model_registry_provider_ids_from_resources()?)?
        }
        "fetch_provider_models_auto" => {
            let args = args_or_default(args);
            let provider_id = get_string_arg(&args, "providerId", "provider_id")?;
            let db = state
                .db
                .as_ref()
                .ok_or_else(|| "Database not initialized".to_string())?;
            let provider = state
                .api_key_provider_service
                .get_provider(db, &provider_id)?
                .ok_or_else(|| format!("Provider 不存在: {provider_id}"))?;

            let api_host = provider.provider.api_host.clone();
            if api_host.is_empty() {
                return Err("Provider 没有配置 API Host".into());
            }

            let provider_type = provider.provider.provider_type;
            let requires_api_key = ModelRegistryService::requires_api_key_for_model_fetch(
                &provider_id,
                &api_host,
                provider_type,
            );
            let api_key = if requires_api_key {
                state
                    .api_key_provider_service
                    .get_next_api_key(db, &provider_id)?
                    .ok_or_else(|| format!("Provider {provider_id} 没有可用的 API Key"))?
            } else {
                state
                    .api_key_provider_service
                    .get_next_api_key(db, &provider_id)?
                    .unwrap_or_default()
            };

            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;

            serde_json::to_value(
                service
                    .fetch_models_from_api_with_hints(
                        &provider_id,
                        &api_host,
                        &api_key,
                        Some(provider_type),
                        &provider.provider.custom_models,
                    )
                    .await?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
