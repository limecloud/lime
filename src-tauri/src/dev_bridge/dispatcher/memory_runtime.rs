use super::{args_or_default, require_app_handle};
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
        "memory_runtime_get_overview" => {
            let args = args_or_default(args);
            let limit = args
                .get("limit")
                .and_then(|value| value.as_u64())
                .map(|value| value as u32);
            serde_json::to_value(
                crate::commands::memory_management_cmd::memory_runtime_get_overview(limit)
                    .await
                    .map_err(|e| format!("获取对话记忆总览失败: {e}"))?,
            )?
        }
        "memory_runtime_get_stats" => serde_json::to_value(
            crate::commands::memory_management_cmd::memory_runtime_get_stats()
                .await
                .map_err(|e| format!("获取对话记忆统计失败: {e}"))?,
        )?,
        "memory_runtime_request_analysis" => {
            let app_handle = require_app_handle(state)?;
            let args = args_or_default(args);
            let from_timestamp = args.get("fromTimestamp").and_then(|value| value.as_i64());
            let to_timestamp = args.get("toTimestamp").and_then(|value| value.as_i64());
            let memory_service =
                app_handle.state::<crate::commands::context_memory::ContextMemoryServiceState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let global_config = app_handle.state::<crate::config::GlobalConfigManagerState>();
            serde_json::to_value(
                crate::commands::memory_management_cmd::memory_runtime_request_analysis(
                    memory_service,
                    db,
                    global_config,
                    from_timestamp,
                    to_timestamp,
                )
                .await
                .map_err(|e| format!("请求记忆分析失败: {e}"))?,
            )?
        }
        "memory_runtime_cleanup" => {
            let app_handle = require_app_handle(state)?;
            let memory_service =
                app_handle.state::<crate::commands::context_memory::ContextMemoryServiceState>();
            let global_config = app_handle.state::<crate::config::GlobalConfigManagerState>();
            serde_json::to_value(
                crate::commands::memory_management_cmd::memory_runtime_cleanup(
                    memory_service,
                    global_config,
                )
                .await
                .map_err(|e| format!("清理记忆失败: {e}"))?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
