use super::{args_or_default, parse_nested_arg};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

fn parse_save_config_args(args: Option<&JsonValue>) -> Result<lime_core::config::Config, DynError> {
    let args = args_or_default(args);
    parse_nested_arg::<lime_core::config::Config>(&args, "config")
}

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "get_config" => {
            let config_path = lime_core::config::ConfigManager::default_config_path();
            let manager = lime_core::config::ConfigManager::load(&config_path)?;
            serde_json::to_value(manager.config())?
        }
        "save_config" => {
            let mut config = parse_save_config_args(args)?;
            config.normalize_local_server_surface();
            config.normalize_workspace_preferences();
            lime_core::config::save_config(&config)?;
            crate::services::environment_service::apply_configured_environment(&config).await;
            serde_json::json!({ "success": true })
        }
        "get_environment_preview" => {
            let config_path = lime_core::config::ConfigManager::default_config_path();
            let manager = lime_core::config::ConfigManager::load(&config_path)?;
            let preview =
                crate::services::environment_service::build_environment_preview(manager.config())
                    .await;
            serde_json::to_value(preview)?
        }
        "get_default_provider" => {
            let default_provider_ref = { state.server.read().await.default_provider_ref.clone() };
            let provider = default_provider_ref.read().await.clone();
            serde_json::json!(provider)
        }
        "get_endpoint_providers" => {
            let providers = { state.server.read().await.config.endpoint_providers.clone() };
            serde_json::to_value(providers)?
        }
        "get_server_diagnostics" => {
            let (status, capability_routing, response_cache, request_dedup, idempotency) = {
                let server = state.server.read().await;
                (
                    server.status(),
                    server.capability_routing_metrics_store.snapshot(),
                    server.response_cache_store.clone(),
                    server.request_dedup_store.clone(),
                    server.idempotency_store.clone(),
                )
            };

            let telemetry_summary = state.shared_stats.read().summary(None);
            let diagnostics = lime_server::build_server_diagnostics(
                status.running,
                status.host,
                status.port,
                telemetry_summary,
                capability_routing,
                response_cache.as_ref(),
                request_dedup.as_ref(),
                idempotency.as_ref(),
            );
            serde_json::to_value(diagnostics)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}

#[cfg(test)]
mod tests {
    use super::parse_save_config_args;

    #[test]
    fn parse_save_config_args_supports_wrapped_tauri_payload() {
        let args = serde_json::json!({
            "config": {
                "default_provider": "claude",
                "workspace_preferences": {
                    "media_defaults": {
                        "image": {
                            "preferredProviderId": "airgate-openai-images",
                            "allowFallback": false
                        }
                    }
                }
            }
        });

        let config = parse_save_config_args(Some(&args)).expect("wrapped config should parse");

        assert_eq!(
            config
                .workspace_preferences
                .media_defaults
                .image
                .preferred_provider_id
                .as_deref(),
            Some("airgate-openai-images")
        );
        assert!(
            !config
                .workspace_preferences
                .media_defaults
                .image
                .allow_fallback
        );
    }

    #[test]
    fn parse_save_config_args_supports_raw_bridge_payload() {
        let args = serde_json::json!({
            "default_provider": "claude",
            "workspace_preferences": {
                "media_defaults": {
                    "image": {
                        "preferredProviderId": "airgate-openai-images",
                        "allowFallback": false
                    }
                }
            }
        });

        let config = parse_save_config_args(Some(&args)).expect("raw config should parse");

        assert_eq!(
            config
                .workspace_preferences
                .media_defaults
                .image
                .preferred_provider_id
                .as_deref(),
            Some("airgate-openai-images")
        );
        assert!(
            !config
                .workspace_preferences
                .media_defaults
                .image
                .allow_fallback
        );
    }
}
