use super::{args_or_default, get_string_arg, require_app_handle};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use tauri::Manager;

type DynError = Box<dyn std::error::Error>;

fn get_optional_string_arg(args: &JsonValue, primary: &str, secondary: &str) -> Option<String> {
    args.get(primary)
        .or_else(|| args.get(secondary))
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
}

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
                .unwrap_or("lime")
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
                .unwrap_or("lime")
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
                .unwrap_or("lime")
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
                .unwrap_or("lime")
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
                .unwrap_or("lime")
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
        "list_executable_skills" => serde_json::to_value(
            crate::commands::skill_exec_cmd::list_executable_skills()
                .await
                .map_err(|e| format!("获取可执行 Skill 列表失败: {e}"))?,
        )?,
        "get_skill_detail" => {
            let args = args_or_default(args);
            let skill_name = get_string_arg(&args, "skillName", "skill_name")
                .or_else(|_| get_string_arg(&args, "skill_name", "skillName"))?;
            serde_json::to_value(
                crate::commands::skill_exec_cmd::get_skill_detail(skill_name)
                    .await
                    .map_err(|e| format!("获取 Skill 详情失败: {e}"))?,
            )?
        }
        "execute_skill" => {
            let app_handle = require_app_handle(state)?;
            let args = args_or_default(args);
            let skill_name = get_string_arg(&args, "skillName", "skill_name")
                .or_else(|_| get_string_arg(&args, "skill_name", "skillName"))?;
            let user_input = get_string_arg(&args, "userInput", "user_input")
                .or_else(|_| get_string_arg(&args, "user_input", "userInput"))?;
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            serde_json::to_value(
                crate::commands::skill_exec_cmd::execute_skill(
                    app_handle.clone(),
                    db,
                    api_key_provider_service,
                    config_manager,
                    aster_state,
                    skill_name,
                    user_input,
                    get_optional_string_arg(&args, "providerOverride", "provider_override"),
                    get_optional_string_arg(&args, "modelOverride", "model_override"),
                    get_optional_string_arg(&args, "executionId", "execution_id"),
                    get_optional_string_arg(&args, "sessionId", "session_id"),
                )
                .await
                .map_err(|e| format!("执行 Skill 失败: {e}"))?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
