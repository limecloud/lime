//! 命令分发器
//!
//! 将 HTTP 请求路由到现有的 Tauri 命令函数。

mod agent_sessions;
mod app_runtime;
mod browser;
mod content;
mod logs;
mod memory;
mod memory_runtime;
mod models;
mod openclaw;
mod project_resources;
mod providers;
mod runtime_queries;
mod skills;
mod workspace;

use crate::dev_bridge::DevBridgeState;
use serde::de::DeserializeOwned;
use serde_json::Value as JsonValue;

pub(super) fn get_db(
    state: &DevBridgeState,
) -> Result<&crate::database::DbConnection, Box<dyn std::error::Error>> {
    state
        .db
        .as_ref()
        .ok_or_else(|| "Database not initialized".into())
}

pub(super) fn get_string_arg(
    args: &JsonValue,
    primary: &str,
    secondary: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    args.get(primary)
        .or_else(|| args.get(secondary))
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .ok_or_else(|| format!("缺少参数: {primary}/{secondary}").into())
}

pub(super) fn parse_nested_arg<T: DeserializeOwned>(
    args: &JsonValue,
    key: &str,
) -> Result<T, Box<dyn std::error::Error>> {
    let payload = args.get(key).cloned().unwrap_or_else(|| args.clone());
    Ok(serde_json::from_value(payload)?)
}

pub(super) fn parse_optional_nested_arg<T: DeserializeOwned>(
    args: &JsonValue,
    key: &str,
) -> Result<Option<T>, Box<dyn std::error::Error>> {
    match args.get(key).cloned() {
        Some(value) if value.is_null() => Ok(None),
        Some(value) => Ok(Some(serde_json::from_value(value)?)),
        None => Ok(None),
    }
}

pub(super) fn args_or_default(args: Option<&JsonValue>) -> JsonValue {
    args.cloned().unwrap_or_default()
}

pub(super) fn require_app_handle(
    state: &DevBridgeState,
) -> Result<tauri::AppHandle, Box<dyn std::error::Error>> {
    state
        .app_handle
        .as_ref()
        .cloned()
        .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string().into())
}

/// 处理 HTTP 桥接命令请求
///
/// 将命令名和参数分发到对应的命令处理函数
pub async fn handle_command(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<serde_json::Value>,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    if let Some(result) = app_runtime::try_handle(state, cmd, args.as_ref()).await? {
        return Ok(result);
    }

    if let Some(result) = logs::try_handle(state, cmd, args.as_ref()).await? {
        return Ok(result);
    }

    if let Some(result) = providers::try_handle(state, cmd, args.as_ref()).await? {
        return Ok(result);
    }

    if let Some(result) = browser::try_handle(state, cmd, args.as_ref()).await? {
        return Ok(result);
    }

    if let Some(result) = models::try_handle(state, cmd).await? {
        return Ok(result);
    }

    if let Some(result) = runtime_queries::try_handle(state, cmd, args.as_ref()).await? {
        return Ok(result);
    }

    if let Some(result) = memory_runtime::try_handle(state, cmd, args.as_ref()).await? {
        return Ok(result);
    }

    if let Some(result) = openclaw::try_handle(state, cmd, args.as_ref()).await? {
        return Ok(result);
    }

    if let Some(result) = agent_sessions::try_handle(state, cmd, args.as_ref())? {
        return Ok(result);
    }

    if let Some(result) = workspace::try_handle(state, cmd, args.as_ref())? {
        return Ok(result);
    }

    if let Some(result) = content::try_handle(state, cmd, args.as_ref())? {
        return Ok(result);
    }

    if let Some(result) = project_resources::try_handle(state, cmd, args.as_ref())? {
        return Ok(result);
    }

    if let Some(result) = memory::try_handle(state, cmd, args.as_ref())? {
        return Ok(result);
    }

    if let Some(result) = skills::try_handle(state, cmd, args.as_ref()).await? {
        return Ok(result);
    }

    Err(format!(
        "[DevBridge] 未知命令: '{cmd}'. 如需此命令，请将其添加到 dispatcher.rs 的 handle_command 函数中。"
    )
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::content_cmd::{ContentDetail, ContentListItem};
    use proxycast_core::{config::Config, database::schema::create_tables};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;
    use tokio::sync::RwLock;

    fn make_test_db() -> crate::database::DbConnection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    fn make_test_state() -> DevBridgeState {
        let config = Config::default();

        DevBridgeState {
            app_handle: None,
            server: Arc::new(RwLock::new(proxycast_server::ServerState::new(
                config.clone(),
            ))),
            logs: Arc::new(RwLock::new(crate::logger::create_log_store_from_config(
                &config.logging,
            ))),
            db: Some(make_test_db()),
            pool_service: Arc::new(
                proxycast_services::provider_pool_service::ProviderPoolService::new(),
            ),
            api_key_provider_service: Arc::new(
                proxycast_services::api_key_provider_service::ApiKeyProviderService::new(),
            ),
            connect_state: Arc::new(RwLock::new(None)),
            model_registry: Arc::new(RwLock::new(None)),
            skill_service: Arc::new(
                proxycast_services::skill_service::SkillService::new().unwrap(),
            ),
            shared_stats: Arc::new(parking_lot::RwLock::new(
                proxycast_infra::telemetry::StatsAggregator::default(),
            )),
        }
    }

    #[tokio::test]
    async fn workspace_commands_roundtrip() {
        let state = make_test_state();
        let temp_dir = TempDir::new().unwrap();
        let root_path = temp_dir.path().join("social-workbench");

        let created_value = handle_command(
            &state,
            "workspace_create",
            Some(serde_json::json!({
                "request": {
                    "name": "社媒项目",
                    "rootPath": root_path.to_string_lossy().to_string(),
                    "workspaceType": "social-media"
                }
            })),
        )
        .await
        .unwrap();
        let created_id = created_value["id"].as_str().unwrap().to_string();

        assert_eq!(created_value["name"], "社媒项目");
        assert_eq!(created_value["workspaceType"], "social-media");

        let list_value = handle_command(&state, "workspace_list", None)
            .await
            .unwrap();
        let list = list_value.as_array().unwrap();

        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["id"], created_id);
    }

    #[tokio::test]
    async fn content_commands_roundtrip() {
        let state = make_test_state();
        let temp_dir = TempDir::new().unwrap();
        let root_path = temp_dir.path().join("content-project");

        let workspace_value = handle_command(
            &state,
            "workspace_create",
            Some(serde_json::json!({
                "request": {
                    "name": "内容项目",
                    "rootPath": root_path.to_string_lossy().to_string(),
                    "workspaceType": "social-media"
                }
            })),
        )
        .await
        .unwrap();
        let workspace_id = workspace_value["id"].as_str().unwrap().to_string();

        let created_value = handle_command(
            &state,
            "content_create",
            Some(serde_json::json!({
                "request": {
                    "project_id": workspace_id.clone(),
                    "title": "首条社媒文稿",
                    "content_type": "post",
                    "body": "正文内容"
                }
            })),
        )
        .await
        .unwrap();
        let created: ContentDetail = serde_json::from_value(created_value).unwrap();

        assert_eq!(created.title, "首条社媒文稿");
        assert_eq!(created.content_type, "post");

        let list_value = handle_command(
            &state,
            "content_list",
            Some(serde_json::json!({
                "projectId": workspace_id,
            })),
        )
        .await
        .unwrap();
        let list: Vec<ContentListItem> = serde_json::from_value(list_value).unwrap();

        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, created.id);
    }
}
