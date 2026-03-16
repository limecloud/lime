use super::{args_or_default, get_string_arg, parse_nested_arg};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "get_network_info" => serde_json::to_value(
            crate::commands::network_cmd::get_network_info()
                .map_err(|e| format!("获取网络信息失败: {e}"))?,
        )?,
        "test_api" => {
            let args = args.cloned().ok_or("缺少参数")?;
            let provider = args
                .get("provider")
                .and_then(|value| value.as_str())
                .ok_or("缺少 provider 参数")?;

            let credential = if let Some(db) = &state.db {
                state
                    .pool_service
                    .select_credential(db, provider, None)
                    .ok()
                    .flatten()
            } else {
                None
            };

            match credential {
                Some(cred) => {
                    state.logs.write().await.add(
                        "info",
                        &format!("[DevBridge] 测试 API 使用凭证: {:?}", cred.name),
                    );
                    serde_json::json!({
                        "success": true,
                        "credential_name": cred.name,
                        "provider_type": cred.provider_type,
                    })
                }
                None => serde_json::json!({
                    "success": false,
                    "error": "未找到可用凭证"
                }),
            }
        }
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
        "aster_session_get" => {
            let args = args_or_default(args);
            let session_id = get_string_arg(&args, "session_id", "sessionId")?;

            if let Some(db) = &state.db {
                serde_json::to_value(
                    crate::agent::AsterAgentWrapper::get_session_sync(db, &session_id)
                        .map_err(|e| format!("获取 Aster 会话失败: {e}"))?,
                )?
            } else {
                return Err("Database not initialized".into());
            }
        }
        "aster_session_list" => {
            if let Some(db) = &state.db {
                serde_json::to_value(
                    crate::agent::AsterAgentWrapper::list_sessions_sync(db)
                        .map_err(|e| format!("获取 Aster 会话列表失败: {e}"))?,
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
        _ => return Ok(None),
    };

    Ok(Some(result))
}
