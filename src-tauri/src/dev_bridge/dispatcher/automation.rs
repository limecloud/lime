use super::{
    args_or_default, get_string_arg, parse_nested_arg, parse_optional_nested_arg,
    require_app_handle,
};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use tauri::Manager;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    if !matches!(
        cmd,
        "get_automation_scheduler_config"
            | "update_automation_scheduler_config"
            | "get_automation_status"
            | "get_automation_jobs"
            | "get_automation_job"
            | "create_automation_job"
            | "update_automation_job"
            | "delete_automation_job"
            | "run_automation_job_now"
            | "get_automation_health"
            | "get_automation_run_history"
            | "preview_automation_schedule"
            | "validate_automation_schedule"
    ) {
        return Ok(None);
    }

    let app_handle = require_app_handle(state)?;
    let app_state = app_handle.state::<crate::app::AppState>();
    let automation_state =
        app_handle.state::<crate::services::automation_service::AutomationServiceState>();

    let result = match cmd {
        "get_automation_scheduler_config" => serde_json::to_value(
            crate::commands::automation_cmd::get_automation_scheduler_config(app_state).await?,
        )?,
        "update_automation_scheduler_config" => {
            let config = parse_nested_arg::<
                crate::commands::automation_cmd::AutomationSchedulerConfigResponse,
            >(&args_or_default(args), "config")?;
            crate::commands::automation_cmd::update_automation_scheduler_config(
                app_state,
                automation_state,
                config,
                app_handle.clone(),
            )
            .await?;
            JsonValue::Null
        }
        "get_automation_status" => serde_json::to_value(
            crate::commands::automation_cmd::get_automation_status(automation_state).await?,
        )?,
        "get_automation_jobs" => serde_json::to_value(
            crate::commands::automation_cmd::get_automation_jobs(automation_state).await?,
        )?,
        "get_automation_job" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            serde_json::to_value(
                crate::commands::automation_cmd::get_automation_job(automation_state, id).await?,
            )?
        }
        "create_automation_job" => {
            let request = parse_nested_arg::<crate::commands::automation_cmd::AutomationJobRequest>(
                &args_or_default(args),
                "request",
            )?;
            serde_json::to_value(
                crate::commands::automation_cmd::create_automation_job(automation_state, request)
                    .await?,
            )?
        }
        "update_automation_job" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let request = parse_nested_arg::<
                crate::commands::automation_cmd::UpdateAutomationJobRequest,
            >(&args, "request")?;
            serde_json::to_value(
                crate::commands::automation_cmd::update_automation_job(
                    automation_state,
                    id,
                    request,
                )
                .await?,
            )?
        }
        "delete_automation_job" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            serde_json::to_value(
                crate::commands::automation_cmd::delete_automation_job(automation_state, id)
                    .await?,
            )?
        }
        "run_automation_job_now" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            serde_json::to_value(
                crate::commands::automation_cmd::run_automation_job_now(automation_state, id)
                    .await?,
            )?
        }
        "get_automation_health" => {
            let query = parse_optional_nested_arg::<
                crate::services::automation_service::health::AutomationHealthQuery,
            >(&args_or_default(args), "query")?;
            serde_json::to_value(
                crate::commands::automation_cmd::get_automation_health(automation_state, query)
                    .await?,
            )?
        }
        "get_automation_run_history" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let limit = args
                .get("limit")
                .and_then(|value| value.as_u64())
                .map(|value| value as usize);
            serde_json::to_value(
                crate::commands::automation_cmd::get_automation_run_history(
                    automation_state,
                    id,
                    limit,
                )
                .await?,
            )?
        }
        "preview_automation_schedule" => {
            let schedule = parse_nested_arg::<lime_core::config::TaskSchedule>(
                &args_or_default(args),
                "schedule",
            )?;
            serde_json::to_value(
                crate::commands::automation_cmd::preview_automation_schedule(schedule).await?,
            )?
        }
        "validate_automation_schedule" => {
            let schedule = parse_nested_arg::<lime_core::config::TaskSchedule>(
                &args_or_default(args),
                "schedule",
            )?;
            serde_json::to_value(
                crate::commands::automation_cmd::validate_automation_schedule(schedule).await?,
            )?
        }
        _ => unreachable!("已通过前置 matches! 过滤 automation 命令"),
    };

    Ok(Some(result))
}
