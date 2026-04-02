use crate::dev_bridge::DevBridgeState;
use lime_server_utils::load_model_registry_provider_ids_from_resources;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
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
        _ => return Ok(None),
    };

    Ok(Some(result))
}
