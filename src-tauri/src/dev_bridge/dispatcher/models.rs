use crate::dev_bridge::DevBridgeState;
use proxycast_server_utils::load_model_registry_provider_ids_from_resources;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

fn load_model_registry_provider_ids_from_db(
    state: &DevBridgeState,
) -> Result<Vec<String>, DynError> {
    let Some(db) = &state.db else {
        return Ok(vec![]);
    };

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT provider_id FROM model_registry WHERE provider_id IS NOT NULL ORDER BY provider_id",
    )?;

    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut provider_ids = Vec::new();
    for row in rows {
        provider_ids.push(row?);
    }

    Ok(provider_ids)
}

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
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
        "refresh_model_registry" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;
            serde_json::json!(service.force_reload().await?)
        }
        "get_model_registry_provider_ids" => {
            match load_model_registry_provider_ids_from_resources() {
                Ok(provider_ids) => serde_json::to_value(provider_ids)?,
                Err(resource_error) => {
                    let fallback = load_model_registry_provider_ids_from_db(state)?;
                    if fallback.is_empty() {
                        return Err(format!(
                        "获取模型 Provider ID 失败（resources 与数据库均不可用）: {resource_error}"
                    )
                        .into());
                    }
                    serde_json::to_value(fallback)?
                }
            }
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
