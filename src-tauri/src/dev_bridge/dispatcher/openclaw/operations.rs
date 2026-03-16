use super::super::{args_or_default, get_db, get_string_arg, parse_nested_arg};
use super::{openclaw_context, DynError};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "openclaw_get_command_preview" => {
            let (app_handle, service) = openclaw_context(state)?;
            let args = args_or_default(args);
            let operation = get_string_arg(&args, "operation", "operation")?;
            let port = args
                .get("port")
                .and_then(|value| value.as_u64())
                .map(|value| value as u16);
            let mut service = service.lock().await;
            serde_json::to_value(
                service
                    .get_command_preview(&app_handle, &operation, port)
                    .await?,
            )?
        }
        "openclaw_install" => {
            let (app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            service.clear_progress_logs();
            serde_json::to_value(service.install(&app_handle).await?)?
        }
        "openclaw_install_dependency" => {
            let (app_handle, service) = openclaw_context(state)?;
            let args = args_or_default(args);
            let kind = get_string_arg(&args, "kind", "kind")?;
            let mut service = service.lock().await;
            service.clear_progress_logs();
            serde_json::to_value(service.install_dependency(&app_handle, &kind).await?)?
        }
        "openclaw_uninstall" => {
            let (app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            service.clear_progress_logs();
            serde_json::to_value(service.uninstall(&app_handle).await?)?
        }
        "openclaw_check_update" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let service = service.lock().await;
            serde_json::to_value(service.check_update().await?)?
        }
        "openclaw_cleanup_temp_artifacts" => {
            let (app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            serde_json::to_value(service.cleanup_temp_artifacts(Some(&app_handle)).await?)?
        }
        "openclaw_perform_update" => {
            let (app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            service.clear_progress_logs();
            serde_json::to_value(service.perform_update(&app_handle).await?)?
        }
        "openclaw_start_gateway" => {
            let (app_handle, service) = openclaw_context(state)?;
            let port = args
                .and_then(|value| value.get("port"))
                .and_then(|value| value.as_u64())
                .map(|value| value as u16);
            let mut service = service.lock().await;
            service.clear_progress_logs();
            serde_json::to_value(service.start_gateway(Some(&app_handle), port).await?)?
        }
        "openclaw_stop_gateway" => {
            let (app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            service.clear_progress_logs();
            serde_json::to_value(service.stop_gateway(Some(&app_handle)).await?)?
        }
        "openclaw_restart_gateway" => {
            let (app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            service.clear_progress_logs();
            serde_json::to_value(service.restart_gateway(&app_handle).await?)?
        }
        "openclaw_sync_provider_config" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let args = args_or_default(args);
            let request: crate::commands::openclaw_cmd::OpenClawSyncConfigRequest =
                parse_nested_arg(&args, "request")?;
            let db = get_db(state)?;
            let provider = state
                .api_key_provider_service
                .get_provider(db, &request.provider_id)?
                .ok_or_else(|| "未找到指定 Provider。".to_string())?;

            if !provider.provider.enabled {
                return Ok(Some(serde_json::json!({
                    "success": false,
                    "message": "该 Provider 已被禁用。"
                })));
            }

            let api_key = state
                .api_key_provider_service
                .get_next_api_key(db, &request.provider_id)?
                .unwrap_or_default();
            let mut service = service.lock().await;
            serde_json::to_value(service.sync_provider_config(
                &provider.provider,
                &api_key,
                &request.primary_model_id,
                &request.models,
            )?)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
