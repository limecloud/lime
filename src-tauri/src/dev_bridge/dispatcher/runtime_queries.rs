use super::{args_or_default, parse_nested_arg, require_app_handle};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use tauri::Manager;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "execution_run_list" => {
            let args = args_or_default(args);
            let limit = args
                .get("limit")
                .and_then(|value| value.as_u64())
                .map(|value| value as usize);
            let offset = args
                .get("offset")
                .and_then(|value| value.as_u64())
                .map(|value| value as usize);

            if let Some(db) = &state.db {
                let tracker =
                    crate::services::execution_tracker_service::ExecutionTracker::new(db.clone());
                serde_json::to_value(
                    tracker.list_runs(limit.unwrap_or(50).clamp(1, 200), offset.unwrap_or(0))?,
                )?
            } else {
                serde_json::json!([])
            }
        }
        "report_frontend_crash" => {
            let args = args_or_default(args);
            let report: crate::app::commands::FrontendCrashReport =
                parse_nested_arg(&args, "report")?;

            let sanitized_message = crate::logger::sanitize_log_message(&report.message);
            let sanitized_component = report
                .component
                .as_deref()
                .map(crate::logger::sanitize_log_message)
                .unwrap_or_else(|| "unknown".to_string());
            let sanitized_step = report
                .workflow_step
                .as_deref()
                .map(crate::logger::sanitize_log_message)
                .unwrap_or_else(|| "unknown".to_string());
            let sanitized_mode = report
                .creation_mode
                .as_deref()
                .map(crate::logger::sanitize_log_message)
                .unwrap_or_else(|| "unknown".to_string());
            let stack_preview = report
                .stack
                .as_deref()
                .map(crate::logger::sanitize_log_message)
                .map(|stack| stack.lines().take(3).collect::<Vec<_>>().join(" | "))
                .unwrap_or_default();

            state.logs.write().await.add(
                "error",
                &format!(
                    "[FrontendCrash] component={sanitized_component} step={sanitized_step} mode={sanitized_mode} message={sanitized_message} stack={stack_preview}"
                ),
            );

            serde_json::json!({ "success": true })
        }
        "report_frontend_debug_log" => {
            let args = args_or_default(args);
            let report: crate::app::commands::FrontendDebugLogReport =
                parse_nested_arg(&args, "report")?;

            let sanitized_message = crate::logger::sanitize_log_message(&report.message);
            let sanitized_category = report
                .category
                .as_deref()
                .map(crate::logger::sanitize_log_message)
                .unwrap_or_else(|| "general".to_string());
            let level = match report
                .level
                .as_deref()
                .unwrap_or("info")
                .trim()
                .to_ascii_lowercase()
                .as_str()
            {
                "debug" => "debug",
                "warn" | "warning" => "warn",
                "error" => "error",
                _ => "info",
            };
            let context_preview = report
                .context
                .as_ref()
                .and_then(|context| serde_json::to_string(context).ok())
                .map(|value| crate::logger::sanitize_log_message(&value))
                .map(|value| {
                    const MAX_LEN: usize = 1200;
                    if value.len() > MAX_LEN {
                        format!("{}...", &value[..MAX_LEN])
                    } else {
                        value
                    }
                })
                .unwrap_or_default();

            let message = if context_preview.is_empty() {
                format!("[FrontendDebug] category={sanitized_category} message={sanitized_message}")
            } else {
                format!(
                    "[FrontendDebug] category={sanitized_category} message={sanitized_message} context={context_preview}"
                )
            };

            state.logs.write().await.add(level, &message);
            serde_json::json!({ "success": true })
        }
        "wechat_channel_set_runtime_model" => {
            let app_handle = require_app_handle(state)?;
            let args = args_or_default(args);
            let request: crate::commands::wechat_channel_cmd::WechatRuntimeModelRequest =
                parse_nested_arg(&args, "request")?;
            let logs = app_handle.state::<crate::app::LogState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();

            serde_json::to_value(
                crate::commands::wechat_channel_cmd::persist_wechat_runtime_model(
                    &config_manager,
                    &logs,
                    &request,
                )
                .await?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
