use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

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
            let mut config: lime_core::config::Config =
                serde_json::from_value(args.cloned().unwrap_or_default())?;
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
