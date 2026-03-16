use super::{args_or_default, get_string_arg};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "get_skills_for_app" => {
            let args = args_or_default(args);
            let app = args
                .get("app")
                .and_then(|value| value.as_str())
                .unwrap_or("proxycast")
                .to_string();
            let refresh_remote = args
                .get("refresh_remote")
                .or_else(|| args.get("refreshRemote"))
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let app_type: crate::models::app_type::AppType = app.parse().map_err(|e: String| e)?;

            if let Some(db) = &state.db {
                let skills = crate::commands::skill_cmd::resolve_skills_for_app(
                    db,
                    &state.skill_service,
                    &app_type,
                    refresh_remote,
                )
                .await
                .map_err(|e| e.to_string())?;
                serde_json::to_value(skills)?
            } else {
                serde_json::json!([])
            }
        }
        "get_local_skills_for_app" => {
            let args = args_or_default(args);
            let app = args
                .get("app")
                .and_then(|value| value.as_str())
                .unwrap_or("proxycast")
                .to_string();

            if let Some(db) = &state.db {
                let app_type: crate::models::app_type::AppType =
                    app.parse().map_err(|e: String| e)?;
                let installed_states = {
                    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                    crate::database::dao::skills::SkillDao::get_skills(&conn)
                        .map_err(|e| format!("{e}"))?
                };
                let skills = state
                    .skill_service
                    .list_local_skills(&app_type, &installed_states)
                    .map_err(|e| format!("{e}"))?;
                serde_json::to_value(skills)?
            } else {
                serde_json::json!([])
            }
        }
        "inspect_local_skill_for_app" => {
            let args = args_or_default(args);
            let app = args
                .get("app")
                .and_then(|value| value.as_str())
                .unwrap_or("proxycast")
                .to_string();
            let directory = get_string_arg(&args, "directory", "directory")?;
            let inspection =
                crate::commands::skill_cmd::inspect_local_skill_for_app(app, directory)
                    .map_err(|e| format!("检查本地 Skill 失败: {e}"))?;
            serde_json::to_value(inspection)?
        }
        "create_skill_scaffold_for_app" => {
            let args = args_or_default(args);
            let app = args
                .get("app")
                .and_then(|value| value.as_str())
                .unwrap_or("proxycast")
                .to_string();
            let target = get_string_arg(&args, "target", "target")?;
            let directory = get_string_arg(&args, "directory", "directory")?;
            let name = get_string_arg(&args, "name", "name")?;
            let description = get_string_arg(&args, "description", "description")?;
            let inspection = crate::commands::skill_cmd::create_skill_scaffold_for_app(
                app,
                target,
                directory,
                name,
                description,
            )
            .map_err(|e| format!("创建 Skill 脚手架失败: {e}"))?;
            serde_json::to_value(inspection)?
        }
        "import_local_skill_for_app" => {
            let args = args_or_default(args);
            let app = args
                .get("app")
                .and_then(|value| value.as_str())
                .unwrap_or("proxycast")
                .to_string();
            let source_path = get_string_arg(&args, "source_path", "source_path")
                .or_else(|_| get_string_arg(&args, "sourcePath", "sourcePath"))?;
            let result = crate::commands::skill_cmd::import_local_skill_for_app(app, source_path)
                .map_err(|e| format!("导入本地 Skill 失败: {e}"))?;
            serde_json::to_value(result)?
        }
        "inspect_remote_skill" => {
            let args = args_or_default(args);
            let owner = get_string_arg(&args, "owner", "owner")?;
            let name = get_string_arg(&args, "name", "name")?;
            let branch = get_string_arg(&args, "branch", "branch")?;
            let directory = get_string_arg(&args, "directory", "directory")?;
            let inspection = state
                .skill_service
                .inspect_remote_skill(&owner, &name, &branch, &directory)
                .await
                .map_err(|e| format!("检查远程 Skill 失败: {e}"))?;
            serde_json::to_value(inspection)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
