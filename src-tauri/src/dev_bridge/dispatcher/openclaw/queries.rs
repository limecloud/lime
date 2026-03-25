use super::super::{args_or_default, get_db, get_string_arg, parse_optional_nested_arg};
use super::{openclaw_context, DynError};
use crate::dev_bridge::DevBridgeState;
use crate::services::claw_solution_service::{ClawSolutionContext, ClawSolutionService};
use serde_json::Value as JsonValue;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "claw_solution_list" => {
            let db = get_db(state)?;
            serde_json::to_value(ClawSolutionService::default().list(db).await?)?
        }
        "claw_solution_detail" => {
            let args = args_or_default(args);
            let solution_id = get_string_arg(&args, "solutionId", "solution_id")?;
            let db = get_db(state)?;
            serde_json::to_value(
                ClawSolutionService::default()
                    .detail(db, &solution_id)
                    .await?,
            )?
        }
        "claw_solution_check_readiness" => {
            let args = args_or_default(args);
            let solution_id = get_string_arg(&args, "solutionId", "solution_id")?;
            let _: Option<ClawSolutionContext> = parse_optional_nested_arg(&args, "context")?;
            let db = get_db(state)?;
            serde_json::to_value(
                ClawSolutionService::default()
                    .check_readiness(db, &solution_id)
                    .await?,
            )?
        }
        "claw_solution_prepare" => {
            let args = args_or_default(args);
            let solution_id = get_string_arg(&args, "solutionId", "solution_id")?;
            let context: Option<ClawSolutionContext> = parse_optional_nested_arg(&args, "context")?;
            let db = get_db(state)?;
            serde_json::to_value(
                ClawSolutionService::default()
                    .prepare(db, &solution_id, context)
                    .await?,
            )?
        }
        "openclaw_check_installed" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let service = service.lock().await;
            let result = service.check_installed().await?;
            serde_json::to_value(result)?
        }
        "openclaw_get_environment_status" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let service = service.lock().await;
            let result = service.get_environment_status().await?;
            serde_json::to_value(result)?
        }
        "openclaw_check_node_version" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let service = service.lock().await;
            let result = service.check_node_version().await?;
            serde_json::to_value(result)?
        }
        "openclaw_check_git_available" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let service = service.lock().await;
            let result = service.check_git_available().await?;
            serde_json::to_value(result)?
        }
        "openclaw_get_node_download_url" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let service = service.lock().await;
            let result = service.get_node_download_url();
            serde_json::json!(result)
        }
        "openclaw_get_git_download_url" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let service = service.lock().await;
            let result = service.get_git_download_url();
            serde_json::json!(result)
        }
        "openclaw_get_status" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            serde_json::to_value(service.get_status().await?)?
        }
        "openclaw_check_health" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            serde_json::to_value(service.check_health().await?)?
        }
        "openclaw_get_dashboard_url" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            serde_json::json!(service.get_dashboard_url())
        }
        "openclaw_get_channels" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let mut service = service.lock().await;
            serde_json::to_value(service.get_channels().await?)?
        }
        "openclaw_get_progress_logs" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let service = service.lock().await;
            let result = service.get_progress_logs();
            serde_json::to_value(result)?
        }
        "openclaw_list_runtime_candidates" => {
            let (_app_handle, service) = openclaw_context(state)?;
            let service = service.lock().await;
            serde_json::to_value(service.list_runtime_candidates().await?)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
