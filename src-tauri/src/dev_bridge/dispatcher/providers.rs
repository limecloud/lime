use super::{args_or_default, get_string_arg};
use crate::connect::RelayRegistry;
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use std::sync::Arc;

type DynError = Box<dyn std::error::Error>;

fn mask_api_key_for_display(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 12 {
        "****".to_string()
    } else {
        let prefix: String = chars[..6].iter().collect();
        let suffix: String = chars[chars.len() - 4..].iter().collect();
        format!("{prefix}****{suffix}")
    }
}

fn api_key_provider_with_keys_to_display(
    provider_with_keys: &crate::database::dao::api_key_provider::ProviderWithKeys,
    service: &proxycast_services::api_key_provider_service::ApiKeyProviderService,
) -> crate::commands::api_key_provider_cmd::ProviderWithKeysDisplay {
    let api_keys = provider_with_keys
        .api_keys
        .iter()
        .map(|key| {
            let masked = match service.decrypt_api_key(&key.api_key_encrypted) {
                Ok(decrypted) => mask_api_key_for_display(&decrypted),
                Err(_) => "****".to_string(),
            };

            crate::commands::api_key_provider_cmd::ApiKeyDisplay {
                id: key.id.clone(),
                provider_id: key.provider_id.clone(),
                api_key_masked: masked,
                alias: key.alias.clone(),
                enabled: key.enabled,
                usage_count: key.usage_count,
                error_count: key.error_count,
                last_used_at: key.last_used_at.map(|value| value.to_rfc3339()),
                created_at: key.created_at.to_rfc3339(),
            }
        })
        .collect();

    crate::commands::api_key_provider_cmd::ProviderWithKeysDisplay {
        provider: crate::commands::api_key_provider_cmd::ProviderDisplay {
            id: provider_with_keys.provider.id.clone(),
            name: provider_with_keys.provider.name.clone(),
            provider_type: provider_with_keys.provider.provider_type.to_string(),
            api_host: provider_with_keys.provider.api_host.clone(),
            is_system: provider_with_keys.provider.is_system,
            group: provider_with_keys.provider.group.to_string(),
            enabled: provider_with_keys.provider.enabled,
            sort_order: provider_with_keys.provider.sort_order,
            api_version: provider_with_keys.provider.api_version.clone(),
            project: provider_with_keys.provider.project.clone(),
            location: provider_with_keys.provider.location.clone(),
            region: provider_with_keys.provider.region.clone(),
            custom_models: provider_with_keys.provider.custom_models.clone(),
            api_key_count: provider_with_keys.api_keys.len(),
            created_at: provider_with_keys.provider.created_at.to_rfc3339(),
            updated_at: provider_with_keys.provider.updated_at.to_rfc3339(),
        },
        api_keys,
    }
}

async fn relay_registry(state: &DevBridgeState) -> Option<Arc<RelayRegistry>> {
    let state_guard = state.connect_state.read().await;
    state_guard
        .as_ref()
        .map(|connect_state| connect_state.registry.clone())
}

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "get_provider_pool_overview" => {
            if let Some(db) = &state.db {
                serde_json::to_value(state.pool_service.get_overview(db)?)?
            } else {
                serde_json::json!([])
            }
        }
        "get_api_key_providers" => {
            if let Some(db) = &state.db {
                let providers = state.api_key_provider_service.get_all_providers(db)?;
                let items: Vec<_> = providers
                    .iter()
                    .map(|provider| {
                        api_key_provider_with_keys_to_display(
                            provider,
                            state.api_key_provider_service.as_ref(),
                        )
                    })
                    .collect();
                serde_json::to_value(items)?
            } else {
                serde_json::json!([])
            }
        }
        "get_system_provider_catalog" => {
            let catalog = crate::commands::api_key_provider_cmd::get_system_provider_catalog()
                .map_err(|e| format!("获取系统 Provider Catalog 失败: {e}"))?;
            serde_json::to_value(catalog)?
        }
        "get_provider_pool_credentials" => {
            if let Some(db) = &state.db {
                let conn = db.lock().map_err(|e| e.to_string())?;
                let credentials =
                    crate::database::dao::provider_pool::ProviderPoolDao::get_all(&conn)
                        .unwrap_or_default();
                serde_json::to_value(credentials)?
            } else {
                serde_json::json!([])
            }
        }
        "get_provider_ui_state" => {
            let args = args_or_default(args);
            let key = get_string_arg(&args, "key", "key")?;

            if let Some(db) = &state.db {
                serde_json::to_value(state.api_key_provider_service.get_ui_state(db, &key)?)?
            } else {
                JsonValue::Null
            }
        }
        "set_provider_ui_state" => {
            let args = args_or_default(args);
            let key = get_string_arg(&args, "key", "key")?;
            let value = get_string_arg(&args, "value", "value")?;

            if let Some(db) = &state.db {
                state
                    .api_key_provider_service
                    .set_ui_state(db, &key, &value)
                    .map_err(|e| format!("设置 Provider UI 状态失败: {e}"))?;
                serde_json::json!({ "success": true })
            } else {
                return Err("Database not initialized".into());
            }
        }
        "list_relay_providers" => {
            if let Some(registry) = relay_registry(state).await {
                serde_json::to_value(registry.list())?
            } else {
                serde_json::json!([])
            }
        }
        "refresh_relay_registry" => {
            if let Some(registry) = relay_registry(state).await {
                registry
                    .load_from_remote()
                    .await
                    .map_err(|e| format!("刷新中转商注册表失败: {e}"))?;
                serde_json::json!(registry.len())
            } else {
                return Err("Connect 模块未初始化".into());
            }
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
