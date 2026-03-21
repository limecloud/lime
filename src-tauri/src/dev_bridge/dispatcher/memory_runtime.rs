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
        "memory_get_effective_sources" => {
            let app_handle = require_app_handle(state)?;
            let args = args_or_default(args);
            let working_dir = args
                .get("workingDir")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let active_relative_path = args
                .get("activeRelativePath")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let global_config = app_handle.state::<crate::config::GlobalConfigManagerState>();
            serde_json::to_value(
                crate::commands::memory_management_cmd::memory_get_effective_sources(
                    global_config,
                    working_dir,
                    active_relative_path,
                )
                .await
                .map_err(|e| format!("获取有效记忆来源失败: {e}"))?,
            )?
        }
        "memory_get_auto_index" => {
            let app_handle = require_app_handle(state)?;
            let args = args_or_default(args);
            let working_dir = args
                .get("workingDir")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let global_config = app_handle.state::<crate::config::GlobalConfigManagerState>();
            serde_json::to_value(
                crate::commands::memory_management_cmd::memory_get_auto_index(
                    global_config,
                    working_dir,
                )
                .await
                .map_err(|e| format!("获取自动记忆索引失败: {e}"))?,
            )?
        }
        "memory_toggle_auto" => {
            let app_handle = require_app_handle(state)?;
            let args = args_or_default(args);
            let enabled = args
                .get("enabled")
                .and_then(|value| value.as_bool())
                .ok_or_else(|| "缺少参数: enabled".to_string())?;
            let global_config = app_handle.state::<crate::config::GlobalConfigManagerState>();
            serde_json::to_value(
                crate::commands::memory_management_cmd::memory_toggle_auto(global_config, enabled)
                    .await
                    .map_err(|e| format!("切换自动记忆失败: {e}"))?,
            )?
        }
        "memory_update_auto_note" => {
            let app_handle = require_app_handle(state)?;
            let args = args_or_default(args);
            let working_dir = args
                .get("workingDir")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let note = args
                .get("note")
                .and_then(|value| value.as_str())
                .map(ToString::to_string)
                .ok_or_else(|| "缺少参数: note".to_string())?;
            let topic = args
                .get("topic")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let global_config = app_handle.state::<crate::config::GlobalConfigManagerState>();
            serde_json::to_value(
                crate::commands::memory_management_cmd::memory_update_auto_note(
                    global_config,
                    working_dir,
                    note,
                    topic,
                )
                .await
                .map_err(|e| format!("更新自动记忆失败: {e}"))?,
            )?
        }
        "memory_scaffold_runtime_agents_template" => {
            let args = args_or_default(args);
            let target = serde_json::from_value(
                args.get("target")
                    .cloned()
                    .ok_or_else(|| "缺少参数: target".to_string())?,
            )?;
            let working_dir = args
                .get("workingDir")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let overwrite = args.get("overwrite").and_then(|value| value.as_bool());
            serde_json::to_value(
                crate::commands::memory_management_cmd::memory_scaffold_runtime_agents_template(
                    target,
                    working_dir,
                    overwrite,
                )
                .await
                .map_err(|e| format!("生成运行时 AGENTS 模板失败: {e}"))?,
            )?
        }
        "memory_ensure_workspace_local_agents_gitignore" => {
            let args = args_or_default(args);
            let working_dir = args
                .get("workingDir")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            serde_json::to_value(
                crate::commands::memory_management_cmd::memory_ensure_workspace_local_agents_gitignore(
                    working_dir,
                )
                .await
                .map_err(|e| format!("更新 .gitignore 失败: {e}"))?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
