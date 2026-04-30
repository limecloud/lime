use super::{args_or_default, get_string_arg, parse_nested_arg, require_app_handle};
use crate::connect::RelayRegistry;
use crate::database::dao::api_key_provider::{
    ApiKeyEntry, ApiKeyProvider, ApiProviderPromptCacheMode, ApiProviderType,
};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use std::sync::Arc;
use tauri::Manager;

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
    service: &lime_services::api_key_provider_service::ApiKeyProviderService,
) -> crate::commands::api_key_provider_cmd::ProviderWithKeysDisplay {
    let api_keys: Vec<crate::commands::api_key_provider_cmd::ApiKeyDisplay> = provider_with_keys
        .api_keys
        .iter()
        .map(|key| api_key_to_display(key, service))
        .collect();

    crate::commands::api_key_provider_cmd::ProviderWithKeysDisplay {
        provider: api_key_provider_to_display(&provider_with_keys.provider, api_keys.len()),
        api_keys,
    }
}

fn api_key_provider_to_display(
    provider: &ApiKeyProvider,
    api_key_count: usize,
) -> crate::commands::api_key_provider_cmd::ProviderDisplay {
    crate::commands::api_key_provider_cmd::ProviderDisplay {
        id: provider.id.clone(),
        name: provider.name.clone(),
        provider_type: provider.effective_provider_type().to_string(),
        api_host: provider.api_host.clone(),
        is_system: provider.is_system,
        group: provider.group.to_string(),
        enabled: provider.enabled,
        sort_order: provider.sort_order,
        api_version: provider.api_version.clone(),
        project: provider.project.clone(),
        location: provider.location.clone(),
        region: provider.region.clone(),
        custom_models: provider.custom_models.clone(),
        prompt_cache_mode: provider
            .effective_prompt_cache_mode()
            .map(|mode| mode.to_string()),
        api_key_count,
        created_at: provider.created_at.to_rfc3339(),
        updated_at: provider.updated_at.to_rfc3339(),
    }
}

fn api_key_to_display(
    key: &ApiKeyEntry,
    service: &lime_services::api_key_provider_service::ApiKeyProviderService,
) -> crate::commands::api_key_provider_cmd::ApiKeyDisplay {
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
        "aster_agent_init" => {
            let app_handle = require_app_handle(state)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::aster_agent_init(
                    app_handle.clone(),
                    aster_state,
                    db,
                    api_key_provider_service,
                    mcp_manager,
                )
                .await?,
            )?
        }
        "aster_agent_status" => {
            let app_handle = require_app_handle(state)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::aster_agent_status(aster_state).await?,
            )?
        }
        "aster_agent_reset" => {
            let app_handle = require_app_handle(state)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::aster_agent_reset(aster_state).await?,
            )?
        }
        "aster_agent_configure_provider" => {
            let app_handle = require_app_handle(state)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let args = args_or_default(args);
            let request = parse_nested_arg::<
                crate::commands::aster_agent_cmd::ConfigureProviderRequest,
            >(&args, "request")?;
            let session_id = get_string_arg(&args, "session_id", "sessionId")?;

            serde_json::to_value(
                crate::commands::aster_agent_cmd::aster_agent_configure_provider(
                    aster_state,
                    db,
                    request,
                    session_id,
                )
                .await?,
            )?
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
        "get_api_key_provider" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "providerId")?;
            let db = state
                .db
                .as_ref()
                .ok_or_else(|| "Database not initialized".to_string())?;
            let provider = state.api_key_provider_service.get_provider(db, &id)?;

            serde_json::to_value(provider.map(|provider| {
                api_key_provider_with_keys_to_display(
                    &provider,
                    state.api_key_provider_service.as_ref(),
                )
            }))?
        }
        "add_custom_api_key_provider" => {
            let args = args_or_default(args);
            let request = parse_nested_arg::<
                crate::commands::api_key_provider_cmd::AddCustomProviderRequest,
            >(&args, "request")?;
            let provider_type: ApiProviderType = request
                .provider_type
                .parse()
                .map_err(|e: String| format!("无效的 Provider 类型: {e}"))?;
            let prompt_cache_mode = request
                .prompt_cache_mode
                .map(|mode| mode.parse::<ApiProviderPromptCacheMode>())
                .transpose()
                .map_err(|e: String| format!("无效的 Prompt Cache 模式: {e}"))?;
            let db = state
                .db
                .as_ref()
                .ok_or_else(|| "Database not initialized".to_string())?;

            let provider = state.api_key_provider_service.add_custom_provider(
                db,
                request.name,
                provider_type,
                request.api_host,
                request.api_version,
                request.project,
                request.location,
                request.region,
                prompt_cache_mode,
            )?;

            serde_json::to_value(api_key_provider_to_display(&provider, 0))?
        }
        "update_api_key_provider" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "providerId")?;
            let request = parse_nested_arg::<
                crate::commands::api_key_provider_cmd::UpdateProviderRequest,
            >(&args, "request")?;
            let provider_type: Option<ApiProviderType> = request
                .provider_type
                .map(|value| value.parse())
                .transpose()
                .map_err(|e: String| format!("无效的 Provider 类型: {e}"))?;
            let prompt_cache_mode = request
                .prompt_cache_mode
                .map(|mode| mode.parse::<ApiProviderPromptCacheMode>())
                .transpose()
                .map_err(|e: String| format!("无效的 Prompt Cache 模式: {e}"))?;
            let db = state
                .db
                .as_ref()
                .ok_or_else(|| "Database not initialized".to_string())?;

            let provider = state.api_key_provider_service.update_provider(
                db,
                &id,
                request.name,
                provider_type,
                request.api_host,
                request.enabled,
                request.sort_order,
                request.api_version,
                request.project,
                request.location,
                request.region,
                prompt_cache_mode,
                request.custom_models,
            )?;
            let api_key_count = state
                .api_key_provider_service
                .get_provider(db, &id)?
                .map(|provider| provider.api_keys.len())
                .unwrap_or(0);

            serde_json::to_value(api_key_provider_to_display(&provider, api_key_count))?
        }
        "add_api_key" => {
            let args = args_or_default(args);
            let request = parse_nested_arg::<
                crate::commands::api_key_provider_cmd::AddApiKeyRequest,
            >(&args, "request")?;
            let db = state
                .db
                .as_ref()
                .ok_or_else(|| "Database not initialized".to_string())?;
            let key = state.api_key_provider_service.add_api_key(
                db,
                &request.provider_id,
                &request.api_key,
                request.alias,
            )?;

            serde_json::to_value(api_key_to_display(
                &key,
                state.api_key_provider_service.as_ref(),
            ))?
        }
        "delete_custom_api_key_provider" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "providerId")?;
            let db = state
                .db
                .as_ref()
                .ok_or_else(|| "Database not initialized".to_string())?;

            serde_json::to_value(
                state
                    .api_key_provider_service
                    .delete_custom_provider(db, &id)?,
            )?
        }
        "get_system_provider_catalog" => {
            let catalog = crate::commands::api_key_provider_cmd::get_system_provider_catalog()
                .map_err(|e| format!("获取系统 Provider Catalog 失败: {e}"))?;
            serde_json::to_value(catalog)?
        }
        "test_api_key_provider_connection" => {
            let args = args_or_default(args);
            let provider_id = get_string_arg(&args, "providerId", "provider_id")?;
            let model_name = args
                .get("modelName")
                .or_else(|| args.get("model_name"))
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let db = state
                .db
                .as_ref()
                .ok_or_else(|| "Database not initialized".to_string())?;
            let provider = state
                .api_key_provider_service
                .get_provider(db, &provider_id)?
                .ok_or_else(|| format!("Provider 不存在: {provider_id}"))?;

            let fallback_models = {
                let guard = state.model_registry.read().await;
                if let Some(model_registry) = guard.as_ref() {
                    model_registry
                        .get_local_fallback_model_ids_with_hints(
                            &provider_id,
                            &provider.provider.api_host,
                            Some(provider.provider.effective_provider_type()),
                            &provider.provider.custom_models,
                        )
                        .await
                } else {
                    Vec::new()
                }
            };

            serde_json::to_value(
                state
                    .api_key_provider_service
                    .test_connection_with_fallback_models(
                        db,
                        &provider_id,
                        model_name,
                        fallback_models,
                    )
                    .await?,
            )?
        }
        "test_api_key_provider_chat" => {
            let args = args_or_default(args);
            let provider_id = get_string_arg(&args, "providerId", "provider_id")?;
            let model_name = args
                .get("modelName")
                .or_else(|| args.get("model_name"))
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let prompt = get_string_arg(&args, "prompt", "prompt")?;
            let db = state
                .db
                .as_ref()
                .ok_or_else(|| "Database not initialized".to_string())?;
            let provider = state
                .api_key_provider_service
                .get_provider(db, &provider_id)?
                .ok_or_else(|| format!("Provider 不存在: {provider_id}"))?;

            let fallback_models = {
                let guard = state.model_registry.read().await;
                if let Some(model_registry) = guard.as_ref() {
                    model_registry
                        .get_local_fallback_model_ids_with_hints(
                            &provider_id,
                            &provider.provider.api_host,
                            Some(provider.provider.effective_provider_type()),
                            &provider.provider.custom_models,
                        )
                        .await
                } else {
                    Vec::new()
                }
            };

            serde_json::to_value(
                state
                    .api_key_provider_service
                    .test_chat_with_fallback_models(
                        db,
                        &provider_id,
                        model_name,
                        prompt,
                        fallback_models,
                    )
                    .await?,
            )?
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

#[cfg(test)]
mod tests {
    use super::api_key_provider_with_keys_to_display;
    use chrono::Utc;
    use lime_core::database::dao::api_key_provider::{
        ApiKeyProvider, ApiProviderType, ProviderGroup, ProviderWithKeys,
    };
    use lime_services::api_key_provider_service::ApiKeyProviderService;

    #[test]
    fn known_anthropic_host_should_display_effective_provider_type() {
        let provider = ApiKeyProvider {
            id: "custom-minimax".to_string(),
            name: "MiniMax".to_string(),
            provider_type: ApiProviderType::Openai,
            api_host: "https://api.minimaxi.com/anthropic".to_string(),
            is_system: false,
            group: ProviderGroup::Custom,
            enabled: true,
            sort_order: 0,
            api_version: None,
            project: None,
            location: None,
            region: None,
            custom_models: vec![],
            prompt_cache_mode: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let provider_with_keys = ProviderWithKeys {
            provider,
            api_keys: vec![],
        };

        let display = api_key_provider_with_keys_to_display(
            &provider_with_keys,
            &ApiKeyProviderService::new(),
        );

        assert_eq!(display.provider.provider_type, "anthropic-compatible");
        assert_eq!(
            display.provider.prompt_cache_mode.as_deref(),
            Some("automatic")
        );
    }
}
