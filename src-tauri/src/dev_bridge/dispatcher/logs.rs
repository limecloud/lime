use super::require_app_handle;
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "get_logs" => {
            let logs = state.logs.read().await;
            let entries = logs.get_logs();
            let limit = entries.len().min(100);
            let recent: Vec<_> = entries
                .into_iter()
                .rev()
                .take(limit)
                .map(|entry| {
                    serde_json::json!({
                        "timestamp": entry.timestamp,
                        "level": entry.level,
                        "message": entry.message,
                    })
                })
                .collect();
            serde_json::to_value(recent)?
        }
        "get_persisted_logs_tail" => {
            let requested = args
                .and_then(|value| value.get("lines"))
                .and_then(|value| value.as_u64())
                .map(|value| value as usize)
                .unwrap_or(200)
                .clamp(20, 1000);

            let logs = state.logs.read().await;
            let entries = crate::app::commands::read_persisted_logs_tail_from_path(
                logs.get_log_file_path(),
                requested,
            )?;
            serde_json::to_value(entries)?
        }
        "get_log_storage_diagnostics" => {
            let logs = state.logs.read().await;
            let diagnostics = crate::app::commands::get_log_storage_diagnostics_from_path(
                logs.get_log_file_path(),
                logs.get_logs().len(),
            );
            serde_json::to_value(diagnostics)?
        }
        "get_windows_startup_diagnostics" => {
            let app_handle = require_app_handle(state)?;
            let diagnostics =
                crate::commands::windows_startup_cmd::collect_windows_startup_diagnostics(
                    &app_handle,
                );
            serde_json::to_value(diagnostics)?
        }
        "clear_logs" => {
            state.logs.write().await.clear();
            serde_json::json!({ "success": true })
        }
        "clear_diagnostic_log_history" => {
            let log_file_path = { state.logs.read().await.get_log_file_path() };
            state.logs.write().await.clear();
            crate::app::commands::clear_diagnostic_log_artifacts_from_path(log_file_path)?;
            serde_json::json!({ "success": true })
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
