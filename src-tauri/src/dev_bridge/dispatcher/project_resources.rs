use super::{args_or_default, get_db, get_string_arg, parse_nested_arg, parse_optional_nested_arg};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use std::time::Instant;

type DynError = Box<dyn std::error::Error>;

fn with_db_or_json<F>(
    state: &DevBridgeState,
    fallback: JsonValue,
    action: F,
) -> Result<JsonValue, DynError>
where
    F: FnOnce(&crate::database::DbConnection) -> Result<JsonValue, DynError>,
{
    match &state.db {
        Some(db) => action(db),
        None => Ok(fallback),
    }
}

pub(super) fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "list_materials" => {
            let args = args_or_default(args);
            let project_id = get_string_arg(&args, "project_id", "projectId")?;
            let filter: Option<crate::models::project_model::MaterialFilter> =
                parse_optional_nested_arg(&args, "filter")?;

            with_db_or_json(state, serde_json::json!([]), |db| {
                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let materials = lime_services::material_service::MaterialService::list_materials(
                    &conn,
                    &project_id,
                    filter,
                )
                .map_err(|e| format!("获取素材列表失败: {e}"))?;
                Ok(serde_json::to_value(materials)?)
            })?
        }
        "get_material_count" => {
            let args = args_or_default(args);
            let project_id = get_string_arg(&args, "project_id", "projectId")?;

            with_db_or_json(state, serde_json::json!(0), |db| {
                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let count =
                    crate::database::dao::material_dao::MaterialDao::count(&conn, &project_id)
                        .map_err(|e| format!("获取素材数量失败: {e}"))?;
                Ok(serde_json::json!(count))
            })?
        }
        "upload_material" => {
            let args = args_or_default(args);
            let req: crate::models::project_model::UploadMaterialRequest =
                parse_nested_arg(&args, "req")?;
            let conn = get_db(state)?
                .lock()
                .map_err(|e| format!("数据库锁定失败: {e}"))?;
            serde_json::to_value(
                lime_services::material_service::MaterialService::upload_material(&conn, req)
                    .map_err(|e| format!("上传素材失败: {e}"))?,
            )?
        }
        "project_memory_get" => {
            let args = args_or_default(args);
            let project_id = get_string_arg(&args, "project_id", "projectId")?;
            let started_at = Instant::now();
            if let Ok(mut logs) = state.logs.try_write() {
                logs.add(
                    "info",
                    &format!(
                        "[AgentDiag] project_memory_get.devbridge.start project_id={}",
                        crate::logger::sanitize_log_message(&project_id)
                    ),
                );
            }

            match &state.db {
                Some(db) => {
                    let manager = crate::memory::MemoryManager::new(db.clone());
                    let memory = manager.get_project_memory(&project_id).map_err(|e| {
                        if let Ok(mut logs) = state.logs.try_write() {
                            logs.add(
                                "error",
                                &format!(
                                    "[AgentDiag] project_memory_get.devbridge.error project_id={} duration_ms={} error={}",
                                    crate::logger::sanitize_log_message(&project_id),
                                    started_at.elapsed().as_millis(),
                                    crate::logger::sanitize_log_message(&e)
                                ),
                            );
                        }
                        format!("获取项目记忆失败: {e}")
                    })?;
                    if let Ok(mut logs) = state.logs.try_write() {
                        logs.add(
                            "info",
                            &format!(
                                "[AgentDiag] project_memory_get.devbridge.success project_id={} duration_ms={} characters={} outline={}",
                                crate::logger::sanitize_log_message(&project_id),
                                started_at.elapsed().as_millis(),
                                memory.characters.len(),
                                memory.outline.len()
                            ),
                        );
                    }
                    serde_json::to_value(memory)?
                }
                None => return Err("Database not initialized".into()),
            }
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
