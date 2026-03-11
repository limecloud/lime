//! 命令分发器
//!
//! 将 HTTP 请求路由到现有的 Tauri 命令函数。

use crate::commands::content_cmd::{
    parse_theme_workbench_document_state, ContentDetail, ContentListItem,
    CreateContentRequest as BridgeCreateContentRequest,
    ListContentRequest as BridgeListContentRequest, ThemeWorkbenchDocumentState,
    UpdateContentRequest as BridgeUpdateContentRequest,
};
use crate::commands::workspace_cmd::{
    CreateWorkspaceRequest, UpdateWorkspaceRequest, WorkspaceEnsureResult, WorkspaceListItem,
};
use crate::content::{
    ContentCreateRequest, ContentListQuery, ContentManager, ContentUpdateRequest,
};
use crate::dev_bridge::DevBridgeState;
use crate::services::workspace_health_service::{
    ensure_workspace_ready_with_auto_relocate, ensure_workspace_root_ready,
};
use crate::workspace::{WorkspaceManager, WorkspaceType, WorkspaceUpdate};
use proxycast_memory::{MemoryCategory, MemoryMetadata, MemorySource, MemoryType, UnifiedMemory};
use proxycast_server_utils::load_model_registry_provider_ids_from_resources;
use rusqlite::{params_from_iter, types::Value};
use serde::de::DeserializeOwned;
use serde_json::Value as JsonValue;
use std::path::PathBuf;
use tauri::Manager;

fn load_model_registry_provider_ids_from_db(
    state: &DevBridgeState,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let Some(db) = &state.db else {
        return Ok(vec![]);
    };

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT provider_id FROM model_registry WHERE provider_id IS NOT NULL ORDER BY provider_id",
    )?;

    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut provider_ids = Vec::new();
    for row in rows {
        provider_ids.push(row?);
    }

    Ok(provider_ids)
}

fn get_db(
    state: &DevBridgeState,
) -> Result<&crate::database::DbConnection, Box<dyn std::error::Error>> {
    state
        .db
        .as_ref()
        .ok_or_else(|| "Database not initialized".into())
}

fn get_string_arg(
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

fn get_optional_bool_arg(args: &JsonValue, primary: &str, secondary: &str) -> Option<bool> {
    args.get(primary)
        .or_else(|| args.get(secondary))
        .and_then(|value| value.as_bool())
}

fn parse_nested_arg<T: DeserializeOwned>(
    args: &JsonValue,
    key: &str,
) -> Result<T, Box<dyn std::error::Error>> {
    let payload = args.get(key).cloned().unwrap_or_else(|| args.clone());
    Ok(serde_json::from_value(payload)?)
}

fn parse_optional_nested_arg<T: DeserializeOwned>(
    args: &JsonValue,
    key: &str,
) -> Result<Option<T>, Box<dyn std::error::Error>> {
    match args.get(key).cloned() {
        Some(value) if value.is_null() => Ok(None),
        Some(value) => Ok(Some(serde_json::from_value(value)?)),
        None => Ok(None),
    }
}

fn get_workspace_projects_root_dir() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "无法获取主目录".to_string())?;
    let root_dir = home_dir.join(".proxycast").join("projects");

    std::fs::create_dir_all(&root_dir).map_err(|e| format!("创建 workspace 目录失败: {e}"))?;

    Ok(root_dir)
}

fn mask_api_key_for_display(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 12 {
        "****".to_string()
    } else {
        let prefix: String = chars[..6].iter().collect();
        let suffix: String = chars[chars.len() - 4..].iter().collect();
        format!("{prefix}****{suffix}")
    }
}

fn api_key_provider_with_keys_to_display(
    provider_with_keys: &crate::database::dao::api_key_provider::ProviderWithKeys,
    service: &proxycast_services::api_key_provider_service::ApiKeyProviderService,
) -> crate::commands::api_key_provider_cmd::ProviderWithKeysDisplay {
    let api_keys = provider_with_keys
        .api_keys
        .iter()
        .map(|key| {
            let masked = match service.decrypt_api_key(&key.api_key_encrypted) {
                Ok(decrypted) => mask_api_key_for_display(&decrypted),
                Err(_) => "****".to_string(),
            };

            crate::commands::api_key_provider_cmd::ApiKeyDisplay {
                id: key.id.clone(),
                provider_id: key.provider_id.clone(),
                api_key_masked: masked,
                alias: key.alias.clone(),
                enabled: key.enabled,
                usage_count: key.usage_count,
                error_count: key.error_count,
                last_used_at: key.last_used_at.map(|value| value.to_rfc3339()),
                created_at: key.created_at.to_rfc3339(),
            }
        })
        .collect();

    crate::commands::api_key_provider_cmd::ProviderWithKeysDisplay {
        provider: crate::commands::api_key_provider_cmd::ProviderDisplay {
            id: provider_with_keys.provider.id.clone(),
            name: provider_with_keys.provider.name.clone(),
            provider_type: provider_with_keys.provider.provider_type.to_string(),
            api_host: provider_with_keys.provider.api_host.clone(),
            is_system: provider_with_keys.provider.is_system,
            group: provider_with_keys.provider.group.to_string(),
            enabled: provider_with_keys.provider.enabled,
            sort_order: provider_with_keys.provider.sort_order,
            api_version: provider_with_keys.provider.api_version.clone(),
            project: provider_with_keys.provider.project.clone(),
            location: provider_with_keys.provider.location.clone(),
            region: provider_with_keys.provider.region.clone(),
            custom_models: provider_with_keys.provider.custom_models.clone(),
            api_key_count: provider_with_keys.api_keys.len(),
            created_at: provider_with_keys.provider.created_at.to_rfc3339(),
            updated_at: provider_with_keys.provider.updated_at.to_rfc3339(),
        },
        api_keys,
    }
}

fn parse_unified_memory_row(row: &rusqlite::Row) -> Result<UnifiedMemory, rusqlite::Error> {
    let id: String = row.get(0)?;
    let session_id: String = row.get(1)?;
    let memory_type_json: String = row.get(2)?;
    let category_json: String = row.get(3)?;
    let title: String = row.get(4)?;
    let content: String = row.get(5)?;
    let summary: String = row.get(6)?;
    let tags_json: String = row.get(7)?;
    let confidence: f32 = row.get(8)?;
    let importance: i64 = row.get(9)?;
    let access_count: i64 = row.get(10)?;
    let last_accessed_at: Option<i64> = row.get(11)?;
    let source_json: String = row.get(12)?;
    let created_at: i64 = row.get(13)?;
    let updated_at: i64 = row.get(14)?;
    let archived: i64 = row.get(15)?;

    let memory_type: MemoryType = serde_json::from_str(&memory_type_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let category: MemoryCategory = serde_json::from_str(&category_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let tags: Vec<String> = serde_json::from_str(&tags_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let source: MemorySource = serde_json::from_str(&source_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    Ok(UnifiedMemory {
        id,
        session_id,
        memory_type,
        category,
        title,
        content,
        summary,
        tags,
        metadata: MemoryMetadata {
            confidence,
            importance: importance.clamp(0, 10) as u8,
            access_count: access_count.max(0) as u32,
            last_accessed_at,
            source,
            embedding: None,
        },
        created_at,
        updated_at,
        archived: archived != 0,
    })
}

fn unified_memory_category_to_key(category: &MemoryCategory) -> &'static str {
    match category {
        MemoryCategory::Identity => "identity",
        MemoryCategory::Context => "context",
        MemoryCategory::Preference => "preference",
        MemoryCategory::Experience => "experience",
        MemoryCategory::Activity => "activity",
    }
}

fn ordered_unified_categories() -> [&'static str; 5] {
    [
        "identity",
        "context",
        "preference",
        "experience",
        "activity",
    ]
}

fn normalize_unified_category_value(value: &str) -> Option<&'static str> {
    if let Ok(category) = serde_json::from_str::<MemoryCategory>(value) {
        return Some(unified_memory_category_to_key(&category));
    }

    match value.trim_matches('"').to_lowercase().as_str() {
        "identity" | "身份" => Some("identity"),
        "context" | "情境" | "上下文" => Some("context"),
        "preference" | "偏好" => Some("preference"),
        "experience" | "经验" => Some("experience"),
        "activity" | "活动" => Some("activity"),
        _ => None,
    }
}

fn normalize_unified_sort_by(sort_by: Option<&str>) -> &'static str {
    match sort_by.unwrap_or("updated_at") {
        "created_at" => "created_at",
        "importance" => "importance",
        "access_count" => "access_count",
        _ => "updated_at",
    }
}

fn normalize_unified_sort_order(order: Option<&str>) -> &'static str {
    match order.unwrap_or("desc").to_lowercase().as_str() {
        "asc" => "ASC",
        _ => "DESC",
    }
}

fn sanitize_project_dir_name(name: &str) -> String {
    let sanitized: String = name
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ if ch.is_control() => '_',
            _ => ch,
        })
        .collect();

    let trimmed = sanitized.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "未命名项目".to_string()
    } else {
        trimmed
    }
}

/// 处理 HTTP 桥接命令请求
///
/// 将命令名和参数分发到对应的命令处理函数
pub async fn handle_command(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<serde_json::Value>,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    match cmd {
        // ========== P0 - 核心配置 ==========
        "get_config" => {
            // 从配置文件读取
            let config_path = proxycast_core::config::ConfigManager::default_config_path();
            let manager = proxycast_core::config::ConfigManager::load(&config_path)?;
            let config = manager.config();
            Ok(serde_json::to_value(config)?)
        }

        "save_config" => {
            // 保存配置到文件
            let config: proxycast_core::config::Config = serde_json::from_value(args.unwrap_or_default())?;
            proxycast_core::config::save_config(&config)?;
            crate::services::environment_service::apply_configured_environment(&config).await;
            Ok(serde_json::json!({ "success": true }))
        }

        "get_environment_preview" => {
            let config_path = proxycast_core::config::ConfigManager::default_config_path();
            let manager = proxycast_core::config::ConfigManager::load(&config_path)?;
            let config = manager.config();
            let preview = crate::services::environment_service::build_environment_preview(&config).await;
            Ok(serde_json::to_value(preview)?)
        }

        "get_default_provider" => {
            let default_provider_ref = { state.server.read().await.default_provider_ref.clone() };
            let provider = default_provider_ref.read().await.clone();
            Ok(serde_json::json!(provider))
        }

        "get_endpoint_providers" => {
            let providers = { state.server.read().await.config.endpoint_providers.clone() };
            Ok(serde_json::to_value(providers)?)
        }

        // ========== P0 - 服务器状态 ==========
        "get_server_status" => {
            let status = { state.server.read().await.status() };
            Ok(serde_json::to_value(status)?)
        }

        "get_server_diagnostics" => {
            let (status, capability_routing, response_cache, request_dedup, idempotency) = {
                let server = state.server.read().await;
                (
                    server.status(),
                    server.capability_routing_metrics_store.snapshot(),
                    server.response_cache_store.clone(),
                    server.request_dedup_store.clone(),
                    server.idempotency_store.clone(),
                )
            };

            let telemetry_summary = state.shared_stats.read().summary(None);
            let diagnostics = proxycast_server::build_server_diagnostics(
                status.running,
                status.host,
                status.port,
                telemetry_summary,
                capability_routing,
                response_cache.as_ref(),
                request_dedup.as_ref(),
                idempotency.as_ref(),
            );
            Ok(serde_json::to_value(diagnostics)?)
        }

        // ========== P1 - 日志相关 ==========
        "get_logs" => {
            let logs = state.logs.read().await;
            let entries = logs.get_logs();
            // 限制返回最近 100 条
            let limit = entries.len().min(100);
            let recent: Vec<_> = entries.into_iter().rev().take(limit).map(|e| serde_json::json!({
                "timestamp": e.timestamp,
                "level": e.level,
                "message": e.message,
            })).collect();
            Ok(serde_json::to_value(recent)?)
        }

        "get_persisted_logs_tail" => {
            let requested = args
                .as_ref()
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
            Ok(serde_json::to_value(entries)?)
        }

        "get_log_storage_diagnostics" => {
            let logs = state.logs.read().await;
            let diagnostics = crate::app::commands::get_log_storage_diagnostics_from_path(
                logs.get_log_file_path(),
                logs.get_logs().len(),
            );
            Ok(serde_json::to_value(diagnostics)?)
        }

        "get_windows_startup_diagnostics" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let diagnostics = crate::commands::windows_startup_cmd::collect_windows_startup_diagnostics(app_handle);
            Ok(serde_json::to_value(diagnostics)?)
        }

        "clear_logs" => {
            state.logs.write().await.clear();
            Ok(serde_json::json!({ "success": true }))
        }

        "clear_diagnostic_log_history" => {
            let log_file_path = { state.logs.read().await.get_log_file_path() };
            state.logs.write().await.clear();
            crate::app::commands::clear_diagnostic_log_artifacts_from_path(log_file_path)?;
            Ok(serde_json::json!({ "success": true }))
        }

        // ========== Provider Pool ==========
        "get_provider_pool_overview" => {
            if let Some(db) = &state.db {
                let overview = state.pool_service.get_overview(db)?;
                Ok(serde_json::to_value(overview)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "get_api_key_providers" => {
            if let Some(db) = &state.db {
                let providers = state.api_key_provider_service.get_all_providers(db)?;
                let items: Vec<_> = providers
                    .iter()
                    .map(|provider| {
                        api_key_provider_with_keys_to_display(
                            provider,
                            state.api_key_provider_service.as_ref(),
                        )
                    })
                    .collect();
                Ok(serde_json::to_value(items)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "get_system_provider_catalog" => {
            let catalog = crate::commands::api_key_provider_cmd::get_system_provider_catalog()
                .map_err(|e| format!("获取系统 Provider Catalog 失败: {e}"))?;
            Ok(serde_json::to_value(catalog)?)
        }

        "get_provider_pool_credentials" => {
            // 获取所有凭证详细信息
            if let Some(db) = &state.db {
                let conn = db.lock().map_err(|e| e.to_string())?;
                let credentials = crate::database::dao::provider_pool::ProviderPoolDao::get_all(&conn)
                    .unwrap_or_default();
                Ok(serde_json::to_value(credentials)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "get_provider_ui_state" => {
            let args = args.unwrap_or_default();
            let key = get_string_arg(&args, "key", "key")?;

            if let Some(db) = &state.db {
                let value = state.api_key_provider_service.get_ui_state(db, &key)?;
                Ok(serde_json::to_value(value)?)
            } else {
                Ok(serde_json::Value::Null)
            }
        }

        "set_provider_ui_state" => {
            let args = args.unwrap_or_default();
            let key = get_string_arg(&args, "key", "key")?;
            let value = get_string_arg(&args, "value", "value")?;

            if let Some(db) = &state.db {
                state
                    .api_key_provider_service
                    .set_ui_state(db, &key, &value)
                    .map_err(|e| format!("设置 Provider UI 状态失败: {e}"))?;
                Ok(serde_json::json!({ "success": true }))
            } else {
                Err("Database not initialized".into())
            }
        }

        "list_relay_providers" => {
            let state_guard = state.connect_state.read().await;
            if let Some(connect_state) = state_guard.as_ref() {
                Ok(serde_json::to_value(connect_state.registry.list())?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "refresh_relay_registry" => {
            let state_guard = state.connect_state.read().await;
            if let Some(connect_state) = state_guard.as_ref() {
                connect_state
                    .registry
                    .load_from_remote()
                    .await
                    .map_err(|e| format!("刷新中转商注册表失败: {e}"))?;
                Ok(serde_json::json!(connect_state.registry.len()))
            } else {
                Err("Connect 模块未初始化".into())
            }
        }

        "get_skills_for_app" => {
            let args = args.unwrap_or_default();
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

                Ok(serde_json::to_value(skills)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "get_local_skills_for_app" => {
            let args = args.unwrap_or_default();
            let app = args
                .get("app")
                .and_then(|value| value.as_str())
                .unwrap_or("proxycast")
                .to_string();

            if let Some(db) = &state.db {
                let app_type: crate::models::app_type::AppType = app.parse().map_err(|e: String| e)?;
                let installed_states = {
                    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                    crate::database::dao::skills::SkillDao::get_skills(&conn)
                        .map_err(|e| format!("{e}"))?
                };
                let skills = state
                    .skill_service
                    .list_local_skills(&app_type, &installed_states)
                    .map_err(|e| format!("{e}"))?;
                Ok(serde_json::to_value(skills)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "test_api" => {
            // 测试 API 连接
            // 从 args 获取 provider
            let args = args.ok_or("缺少参数")?;
            let provider = args
                .get("provider")
                .and_then(|v| v.as_str())
                .ok_or("缺少 provider 参数")?;

            // 选择凭证
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
                    state
                        .logs
                        .write()
                        .await
                        .add("info", &format!("[DevBridge] 测试 API 使用凭证: {:?}", cred.name));

                    Ok(serde_json::json!({
                        "success": true,
                        "credential_name": cred.name,
                        "provider_type": cred.provider_type,
                    }))
                }
                None => Ok(serde_json::json!({
                    "success": false,
                    "error": "未找到可用凭证"
                })),
            }
        }

        // ========== Workspace / Content ==========
        "workspace_create" => {
            let args = args.unwrap_or_default();
            let request: CreateWorkspaceRequest = parse_nested_arg(&args, "request")?;

            if request.root_path.contains("[object Promise]") {
                return Err(format!(
                    "无效的 root_path: {}。请确保前端正确 await 了 Promise。",
                    request.root_path
                )
                .into());
            }

            let manager = WorkspaceManager::new(get_db(state)?.clone());
            let workspace_type = request
                .workspace_type
                .map(|workspace_type| WorkspaceType::parse(&workspace_type))
                .unwrap_or_default();
            let root_path = PathBuf::from(&request.root_path);

            ensure_workspace_root_ready(&root_path)?;

            let workspace = manager.create_with_type(request.name, root_path, workspace_type)?;
            Ok(serde_json::to_value(WorkspaceListItem::from(workspace))?)
        }

        "workspace_list" => {
            let manager = WorkspaceManager::new(get_db(state)?.clone());
            let workspaces = manager.list()?;
            let items: Vec<_> = workspaces.into_iter().map(WorkspaceListItem::from).collect();
            Ok(serde_json::to_value(items)?)
        }

        "workspace_get" => {
            let args = args.unwrap_or_default();
            let id = get_string_arg(&args, "id", "id")?;
            let manager = WorkspaceManager::new(get_db(state)?.clone());
            let workspace = manager.get(&id)?;
            Ok(serde_json::to_value(workspace.map(WorkspaceListItem::from))?)
        }

        "workspace_update" => {
            let args = args.unwrap_or_default();
            let id = get_string_arg(&args, "id", "id")?;
            let request: UpdateWorkspaceRequest = parse_nested_arg(&args, "request")?;
            let manager = WorkspaceManager::new(get_db(state)?.clone());

            let new_root_path = if let Some(ref path_str) = request.root_path {
                let path = PathBuf::from(path_str);
                let created = ensure_workspace_root_ready(&path)?;
                if created {
                    tracing::warn!(
                        "[Workspace] 更新路径时检测到目录缺失，已自动创建: {}",
                        path.to_string_lossy()
                    );
                }
                Some(path)
            } else {
                None
            };

            let updates = WorkspaceUpdate {
                name: request.name,
                settings: request.settings,
                icon: request.icon,
                color: request.color,
                is_favorite: request.is_favorite,
                is_archived: request.is_archived,
                tags: request.tags,
                root_path: new_root_path,
            };

            let workspace = manager.update(&id, updates)?;
            Ok(serde_json::to_value(WorkspaceListItem::from(workspace))?)
        }

        "workspace_delete" => {
            let args = args.unwrap_or_default();
            let id = get_string_arg(&args, "id", "id")?;
            let delete_directory =
                get_optional_bool_arg(&args, "deleteDirectory", "delete_directory")
                    .unwrap_or(false);
            let manager = WorkspaceManager::new(get_db(state)?.clone());

            if delete_directory {
                if let Some(workspace) = manager.get(&id)? {
                    let root_path = workspace.root_path;
                    if root_path.exists() && root_path.is_dir() {
                        std::fs::remove_dir_all(&root_path)
                            .map_err(|e| format!("删除目录失败: {e}"))?;
                    }
                }
            }

            Ok(serde_json::to_value(manager.delete(&id)?)?)
        }

        "workspace_set_default" => {
            let args = args.unwrap_or_default();
            let id = get_string_arg(&args, "id", "id")?;
            let manager = WorkspaceManager::new(get_db(state)?.clone());
            manager.set_default(&id)?;
            Ok(serde_json::json!(null))
        }

        "workspace_get_default" => {
            let manager = WorkspaceManager::new(get_db(state)?.clone());
            let workspace = manager.get_default()?;
            Ok(serde_json::to_value(workspace.map(WorkspaceListItem::from))?)
        }

        "workspace_ensure_ready" => {
            let args = args.unwrap_or_default();
            let id = get_string_arg(&args, "id", "id")?;
            let manager = WorkspaceManager::new(get_db(state)?.clone());
            let workspace = manager
                .get(&id)?
                .ok_or_else(|| format!("Workspace 不存在: {id}"))?;
            let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
            let result = WorkspaceEnsureResult {
                workspace_id: workspace.id,
                root_path: ensured.root_path.to_string_lossy().to_string(),
                existed: ensured.existed,
                created: ensured.created,
                repaired: ensured.repaired,
                relocated: ensured.relocated,
                previous_root_path: ensured
                    .previous_root_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string()),
                warning: ensured.warning,
            };
            Ok(serde_json::to_value(result)?)
        }

        "workspace_ensure_default_ready" => {
            let manager = WorkspaceManager::new(get_db(state)?.clone());
            let Some(workspace) = manager.get_default()? else {
                return Ok(serde_json::json!(null));
            };
            let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
            let result = WorkspaceEnsureResult {
                workspace_id: workspace.id,
                root_path: ensured.root_path.to_string_lossy().to_string(),
                existed: ensured.existed,
                created: ensured.created,
                repaired: ensured.repaired,
                relocated: ensured.relocated,
                previous_root_path: ensured
                    .previous_root_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string()),
                warning: ensured.warning,
            };
            Ok(serde_json::to_value(Some(result))?)
        }

        "workspace_get_by_path" => {
            let args = args.unwrap_or_default();
            let root_path = get_string_arg(&args, "rootPath", "root_path")?;
            let manager = WorkspaceManager::new(get_db(state)?.clone());
            let workspace = manager.get_by_path(&PathBuf::from(root_path))?;
            Ok(serde_json::to_value(workspace.map(WorkspaceListItem::from))?)
        }

        "workspace_get_projects_root" => {
            let root_dir = get_workspace_projects_root_dir()?;
            Ok(serde_json::json!(root_dir.to_string_lossy().to_string()))
        }

        "workspace_resolve_project_path" => {
            let args = args.unwrap_or_default();
            let name = get_string_arg(&args, "name", "name")?;
            let root_dir = get_workspace_projects_root_dir()?;
            let dir_name = sanitize_project_dir_name(&name);
            let project_path = root_dir.join(dir_name);
            Ok(serde_json::json!(project_path.to_string_lossy().to_string()))
        }

        "get_or_create_default_project" => {
            let manager = WorkspaceManager::new(get_db(state)?.clone());

            if let Some(workspace) = manager.get_default()? {
                return Ok(serde_json::to_value(WorkspaceListItem::from(workspace))?);
            }

            let default_project_path = get_workspace_projects_root_dir()?.join("default");
            std::fs::create_dir_all(&default_project_path)
                .map_err(|e| format!("创建默认项目目录失败: {e}"))?;

            let workspace = manager.create_with_type(
                "默认项目".to_string(),
                default_project_path,
                WorkspaceType::Persistent,
            )?;
            manager.set_default(&workspace.id)?;
            let workspace = manager.get(&workspace.id)?.ok_or("创建默认项目失败")?;
            Ok(serde_json::to_value(WorkspaceListItem::from(workspace))?)
        }

        "content_create" => {
            let args = args.unwrap_or_default();
            let request: BridgeCreateContentRequest = parse_nested_arg(&args, "request")?;
            let manager = ContentManager::new(get_db(state)?.clone());
            let create_request = ContentCreateRequest {
                project_id: request.project_id,
                title: request.title,
                content_type: request
                    .content_type
                    .map(|value| value.parse::<crate::content::ContentType>().unwrap_or_default()),
                order: request.order,
                body: request.body,
                metadata: request.metadata,
            };
            let content = manager.create(create_request)?;
            Ok(serde_json::to_value(ContentDetail::from(content))?)
        }

        "content_get" => {
            let args = args.unwrap_or_default();
            let id = get_string_arg(&args, "id", "id")?;
            let manager = ContentManager::new(get_db(state)?.clone());
            let content = manager.get(&id)?;
            Ok(serde_json::to_value(content.map(ContentDetail::from))?)
        }

        "content_get_theme_workbench_document_state" => {
            let args = args.unwrap_or_default();
            let id = get_string_arg(&args, "id", "id")?;
            let manager = ContentManager::new(get_db(state)?.clone());
            let content = manager.get(&id)?;
            let document_state: Option<ThemeWorkbenchDocumentState> = content.and_then(|item| {
                parse_theme_workbench_document_state(&item.id, item.metadata.as_ref())
            });
            Ok(serde_json::to_value(document_state)?)
        }

        "content_list" => {
            let args = args.unwrap_or_default();
            let project_id = get_string_arg(&args, "projectId", "project_id")?;
            let query: Option<BridgeListContentRequest> = parse_optional_nested_arg(&args, "query")?;
            let manager = ContentManager::new(get_db(state)?.clone());
            let list_query = query.map(|query| ContentListQuery {
                status: query.status.map(|value| value.parse().unwrap_or_default()),
                content_type: query
                    .content_type
                    .map(|value| value.parse::<crate::content::ContentType>().unwrap_or_default()),
                search: query.search,
                sort_by: query.sort_by,
                sort_order: query.sort_order,
                offset: query.offset,
                limit: query.limit,
            });
            let contents = manager.list_by_project(&project_id, list_query)?;
            let items: Vec<_> = contents.into_iter().map(ContentListItem::from).collect();
            Ok(serde_json::to_value(items)?)
        }

        "content_update" => {
            let args = args.unwrap_or_default();
            let id = get_string_arg(&args, "id", "id")?;
            let request: BridgeUpdateContentRequest = parse_nested_arg(&args, "request")?;
            let manager = ContentManager::new(get_db(state)?.clone());
            let update_request = ContentUpdateRequest {
                title: request.title,
                status: request.status.map(|value| value.parse().unwrap_or_default()),
                order: request.order,
                body: request.body,
                metadata: request.metadata,
                session_id: request.session_id,
            };
            let content = manager.update(&id, update_request)?;
            Ok(serde_json::to_value(ContentDetail::from(content))?)
        }

        "content_delete" => {
            let args = args.unwrap_or_default();
            let id = get_string_arg(&args, "id", "id")?;
            let manager = ContentManager::new(get_db(state)?.clone());
            Ok(serde_json::to_value(manager.delete(&id)?)?)
        }

        "content_reorder" => {
            let args = args.unwrap_or_default();
            let project_id = get_string_arg(&args, "projectId", "project_id")?;
            let content_ids = args
                .get("contentIds")
                .or_else(|| args.get("content_ids"))
                .cloned()
                .ok_or("缺少参数: contentIds/content_ids")?;
            let content_ids: Vec<String> = serde_json::from_value(content_ids)?;
            let manager = ContentManager::new(get_db(state)?.clone());
            manager.reorder(&project_id, content_ids)?;
            Ok(serde_json::json!(null))
        }

        "content_stats" => {
            let args = args.unwrap_or_default();
            let project_id = get_string_arg(&args, "projectId", "project_id")?;
            let manager = ContentManager::new(get_db(state)?.clone());
            Ok(serde_json::to_value(manager.get_project_stats(&project_id)?)?)
        }

        "list_materials" => {
            let args = args.unwrap_or_default();
            let project_id = get_string_arg(&args, "project_id", "projectId")?;
            let filter: Option<crate::models::project_model::MaterialFilter> =
                parse_optional_nested_arg(&args, "filter")?;

            if let Some(db) = &state.db {
                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let materials = proxycast_services::material_service::MaterialService::list_materials(
                    &conn,
                    &project_id,
                    filter,
                )
                .map_err(|e| format!("获取素材列表失败: {e}"))?;
                Ok(serde_json::to_value(materials)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "get_material_count" => {
            let args = args.unwrap_or_default();
            let project_id = get_string_arg(&args, "project_id", "projectId")?;

            if let Some(db) = &state.db {
                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let count = crate::database::dao::material_dao::MaterialDao::count(&conn, &project_id)
                    .map_err(|e| format!("获取素材数量失败: {e}"))?;
                Ok(serde_json::json!(count))
            } else {
                Ok(serde_json::json!(0))
            }
        }

        "project_memory_get" => {
            let args = args.unwrap_or_default();
            let project_id = get_string_arg(&args, "project_id", "projectId")?;

            if let Some(db) = &state.db {
                let manager = crate::memory::MemoryManager::new(db.clone());
                let memory = manager
                    .get_project_memory(&project_id)
                    .map_err(|e| format!("获取项目记忆失败: {e}"))?;
                Ok(serde_json::to_value(memory)?)
            } else {
                Err("Database not initialized".into())
            }
        }

        // ========== 模型相关 ==========
        "get_models" => {
            // 返回可用模型列表
            Ok(serde_json::json!({
                "data": [
                    {"id": "claude-sonnet-4-20250514", "object": "model", "owned_by": "anthropic"},
                    {"id": "claude-opus-4-20250514", "object": "model", "owned_by": "anthropic"},
                    {"id": "claude-haiku-4-20250514", "object": "model", "owned_by": "anthropic"},
                    {"id": "gpt-4o", "object": "model", "owned_by": "openai"},
                    {"id": "gpt-4o-mini", "object": "model", "owned_by": "openai"},
                ]
            }))
        }

        "get_model_registry" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;

            Ok(serde_json::to_value(service.get_all_models().await)?)
        }

        "get_model_preferences" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;

            let preferences = service.get_all_preferences().await?;
            Ok(serde_json::to_value(preferences)?)
        }

        "get_model_sync_state" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;

            Ok(serde_json::to_value(service.get_sync_state().await)?)
        }

        "refresh_model_registry" => {
            let guard = state.model_registry.read().await;
            let service = guard
                .as_ref()
                .ok_or_else(|| "模型注册服务未初始化".to_string())?;

            let count = service.force_reload().await?;
            Ok(serde_json::json!(count))
        }

        "get_model_registry_provider_ids" => {
            match load_model_registry_provider_ids_from_resources() {
                Ok(provider_ids) => Ok(serde_json::to_value(provider_ids)?),
                Err(resource_error) => {
                    let fallback = load_model_registry_provider_ids_from_db(state)?;
                    if fallback.is_empty() {
                        Err(format!(
                            "获取模型 Provider ID 失败（resources 与数据库均不可用）: {resource_error}"
                        )
                        .into())
                    } else {
                        Ok(serde_json::to_value(fallback)?)
                    }
                }
            }
        }

        "unified_memory_stats" => {
            if let Some(db) = &state.db {
                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

                let (total_entries, memory_count, storage_used): (i64, i64, i64) = conn
                    .query_row(
                        "SELECT COUNT(*), COUNT(DISTINCT session_id), COALESCE(SUM(length(title) + length(content) + length(summary) + length(tags)), 0) FROM unified_memory WHERE archived = 0",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .map_err(|e| format!("统计记忆失败: {e}"))?;

                let mut category_counts: std::collections::HashMap<String, u32> =
                    std::collections::HashMap::new();
                let mut stmt = conn
                    .prepare(
                        "SELECT category, COUNT(*) FROM unified_memory WHERE archived = 0 GROUP BY category",
                    )
                    .map_err(|e| format!("构建分类统计查询失败: {e}"))?;

                let rows = stmt
                    .query_map([], |row| {
                        let category_raw: String = row.get(0)?;
                        let count: i64 = row.get(1)?;
                        Ok((category_raw, count))
                    })
                    .map_err(|e| format!("分类统计查询失败: {e}"))?;

                for row in rows.flatten() {
                    if let Some(category) = normalize_unified_category_value(&row.0) {
                        category_counts.insert(category.to_string(), row.1.max(0) as u32);
                    }
                }

                let categories = ordered_unified_categories()
                    .iter()
                    .map(|category| crate::commands::unified_memory_cmd::MemoryCategoryStat {
                        category: (*category).to_string(),
                        count: *category_counts.get(*category).unwrap_or(&0),
                    })
                    .collect();

                let response = crate::commands::unified_memory_cmd::MemoryStatsResponse {
                    total_entries: total_entries.max(0) as u32,
                    storage_used: storage_used.max(0) as u64,
                    memory_count: memory_count.max(0) as u32,
                    categories,
                };

                Ok(serde_json::to_value(response)?)
            } else {
                Ok(serde_json::json!({
                    "total_entries": 0,
                    "storage_used": 0,
                    "memory_count": 0,
                    "categories": [],
                }))
            }
        }

        "unified_memory_list" => {
            let args = args.unwrap_or_default();
            let filters: Option<crate::commands::unified_memory_cmd::ListFilters> =
                parse_optional_nested_arg(&args, "filters")?;
            let filters = filters.unwrap_or_default();

            if let Some(db) = &state.db {
                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

                let archived = filters.archived.unwrap_or(false);
                let sort_by = normalize_unified_sort_by(filters.sort_by.as_deref());
                let order = normalize_unified_sort_order(filters.order.as_deref());
                let limit = filters.limit.unwrap_or(120).clamp(1, 1000) as i64;
                let offset = filters.offset.unwrap_or(0) as i64;

                let mut where_parts = vec!["archived = ?".to_string()];
                let mut values: Vec<Value> = vec![Value::from(if archived { 1 } else { 0 })];

                if let Some(session_id) = filters.session_id.filter(|value| !value.trim().is_empty()) {
                    where_parts.push("session_id = ?".to_string());
                    values.push(Value::from(session_id));
                }

                if let Some(memory_type) = filters.memory_type {
                    let encoded = serde_json::to_string(&memory_type)
                        .map_err(|e| format!("序列化 memory_type 失败: {e}"))?;
                    where_parts.push("memory_type = ?".to_string());
                    values.push(Value::from(encoded));
                }

                if let Some(category) = filters.category {
                    let encoded = serde_json::to_string(&category)
                        .map_err(|e| format!("序列化 category 失败: {e}"))?;
                    where_parts.push("category = ?".to_string());
                    values.push(Value::from(encoded));
                }

                let sql = format!(
                    "SELECT id, session_id, memory_type, category, title, content, summary, tags, confidence, importance, access_count, last_accessed_at, source, created_at, updated_at, archived FROM unified_memory WHERE {} ORDER BY {} {} LIMIT ? OFFSET ?",
                    where_parts.join(" AND "),
                    sort_by,
                    order,
                );

                values.push(Value::from(limit));
                values.push(Value::from(offset));

                let mut stmt = conn
                    .prepare(&sql)
                    .map_err(|e| format!("构建查询失败: {e}"))?;

                let memories = stmt
                    .query_map(params_from_iter(values), parse_unified_memory_row)
                    .map_err(|e| format!("查询记忆失败: {e}"))?
                    .collect::<Result<Vec<_>, rusqlite::Error>>()
                    .map_err(|e| format!("解析记忆失败: {e}"))?;

                Ok(serde_json::to_value(memories)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "execution_run_list" => {
            let args = args.unwrap_or_default();
            let limit = args
                .get("limit")
                .and_then(|value| value.as_u64())
                .map(|value| value as usize);
            let offset = args
                .get("offset")
                .and_then(|value| value.as_u64())
                .map(|value| value as usize);

            if let Some(db) = &state.db {
                let tracker = crate::services::execution_tracker_service::ExecutionTracker::new(
                    db.clone(),
                );
                let runs = tracker.list_runs(limit.unwrap_or(50).clamp(1, 200), offset.unwrap_or(0))?;
                Ok(serde_json::to_value(runs)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "aster_session_get" => {
            let args = args.unwrap_or_default();
            let session_id = get_string_arg(&args, "session_id", "sessionId")?;

            if let Some(db) = &state.db {
                let session = crate::agent::AsterAgentWrapper::get_session_sync(db, &session_id)
                    .map_err(|e| format!("获取 Aster 会话失败: {e}"))?;
                Ok(serde_json::to_value(session)?)
            } else {
                Err("Database not initialized".into())
            }
        }

        "aster_session_list" => {
            if let Some(db) = &state.db {
                let sessions = crate::agent::AsterAgentWrapper::list_sessions_sync(db)
                    .map_err(|e| format!("获取 Aster 会话列表失败: {e}"))?;
                Ok(serde_json::to_value(sessions)?)
            } else {
                Ok(serde_json::json!([]))
            }
        }

        "report_frontend_crash" => {
            let args = args.unwrap_or_default();
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

            Ok(serde_json::json!({ "success": true }))
        }

        "get_conversation_memory_overview" => {
            let args = args.unwrap_or_default();
            let limit = args
                .get("limit")
                .and_then(|value| value.as_u64())
                .map(|value| value as u32);
            let overview = crate::commands::memory_management_cmd::get_conversation_memory_overview(limit)
                .await
                .map_err(|e| format!("获取对话记忆总览失败: {e}"))?;
            Ok(serde_json::to_value(overview)?)
        }

        "get_conversation_memory_stats" => {
            let stats = crate::commands::memory_management_cmd::get_conversation_memory_stats()
                .await
                .map_err(|e| format!("获取对话记忆统计失败: {e}"))?;
            Ok(serde_json::to_value(stats)?)
        }

        // ========== 网络信息 ==========
        "get_network_info" => {
            // 返回网络信息
            Ok(serde_json::json!({
                "localhost": "127.0.0.1",
                "lan_ip": null,
                "all_ips": ["127.0.0.1"]
            }))
        }

        // ========== OpenClaw ==========
        "openclaw_check_installed" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let service = service.0.lock().await;
            Ok(serde_json::to_value(service.check_installed().await?)?)
        }

        "openclaw_get_environment_status" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service =
                app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let service = service.0.lock().await;
            Ok(serde_json::to_value(service.get_environment_status().await?)?)
        }

        "openclaw_check_node_version" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let service = service.0.lock().await;
            Ok(serde_json::to_value(service.check_node_version().await?)?)
        }

        "openclaw_check_git_available" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let service = service.0.lock().await;
            Ok(serde_json::to_value(service.check_git_available().await?)?)
        }

        "openclaw_get_node_download_url" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let service = service.0.lock().await;
            Ok(serde_json::json!(service.get_node_download_url()))
        }

        "openclaw_get_git_download_url" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let service = service.0.lock().await;
            Ok(serde_json::json!(service.get_git_download_url()))
        }

        "openclaw_get_command_preview" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let args = args.unwrap_or_default();
            let operation = get_string_arg(&args, "operation", "operation")?;
            let port = args.get("port").and_then(|value| value.as_u64()).map(|value| value as u16);
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            Ok(serde_json::to_value(service.get_command_preview(app_handle, &operation, port).await?)?)
        }

        "openclaw_install" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            service.clear_progress_logs();
            Ok(serde_json::to_value(service.install(app_handle).await?)?)
        }

        "openclaw_install_dependency" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let args = args.unwrap_or_default();
            let kind = get_string_arg(&args, "kind", "kind")?;
            let service =
                app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            service.clear_progress_logs();
            Ok(serde_json::to_value(service.install_dependency(app_handle, &kind).await?)?)
        }

        "openclaw_uninstall" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            service.clear_progress_logs();
            Ok(serde_json::to_value(service.uninstall(app_handle).await?)?)
        }

        "openclaw_cleanup_temp_artifacts" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service =
                app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            Ok(serde_json::to_value(service.cleanup_temp_artifacts(Some(app_handle)).await?)?)
        }

        "openclaw_start_gateway" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let port = args
                .as_ref()
                .and_then(|value| value.get("port"))
                .and_then(|value| value.as_u64())
                .map(|value| value as u16);
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            service.clear_progress_logs();
            Ok(serde_json::to_value(service.start_gateway(Some(app_handle), port).await?)?)
        }

        "openclaw_stop_gateway" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            service.clear_progress_logs();
            Ok(serde_json::to_value(service.stop_gateway(Some(app_handle)).await?)?)
        }

        "openclaw_restart_gateway" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            service.clear_progress_logs();
            Ok(serde_json::to_value(service.restart_gateway(app_handle).await?)?)
        }

        "openclaw_get_status" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            Ok(serde_json::to_value(service.get_status().await?)?)
        }

        "openclaw_check_health" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            Ok(serde_json::to_value(service.check_health().await?)?)
        }

        "openclaw_get_dashboard_url" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            Ok(serde_json::json!(service.get_dashboard_url()))
        }

        "openclaw_get_channels" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            Ok(serde_json::to_value(service.get_channels().await?)?)
        }

        "openclaw_get_progress_logs" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let service = service.0.lock().await;
            Ok(serde_json::to_value(service.get_progress_logs())?)
        }

        "openclaw_sync_provider_config" => {
            let app_handle = state
                .app_handle
                .as_ref()
                .ok_or_else(|| "Dev Bridge 未持有 AppHandle".to_string())?;
            let request: crate::commands::openclaw_cmd::OpenClawSyncConfigRequest =
                parse_nested_arg(&args.unwrap_or_default(), "request")?;
            let db = get_db(state)?;
            let provider = state
                .api_key_provider_service
                .get_provider(db, &request.provider_id)?
                .ok_or_else(|| "未找到指定 Provider。".to_string())?;

            if !provider.provider.enabled {
                return Ok(serde_json::json!({
                    "success": false,
                    "message": "该 Provider 已被禁用。"
                }));
            }

            let api_key = state
                .api_key_provider_service
                .get_next_api_key(db, &request.provider_id)?
                .unwrap_or_default();
            let service = app_handle.state::<crate::services::openclaw_service::OpenClawServiceState>();
            let mut service = service.0.lock().await;
            Ok(serde_json::to_value(service.sync_provider_config(
                &provider.provider,
                &api_key,
                &request.primary_model_id,
                &request.models,
            )?)?)
        }

        // ========== Agent 会话管理 ==========
        "agent_create_session" => {
            let args = args.unwrap_or_default();
            let provider_type = args["provider_type"].as_str().unwrap_or("").to_string();
            let model = args["model"].as_str().map(|s| s.to_string());
            let system_prompt = args["system_prompt"].as_str().map(|s| s.to_string());
            let execution_strategy = args["execution_strategy"]
                .as_str()
                .map(|s| s.to_string())
                .or_else(|| args["executionStrategy"].as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "react".to_string());

            if let Some(db) = &state.db {
                // 简化版本：直接创建会话，不需要 agent_state
                use crate::database::dao::agent::AgentDao;
                use proxycast_core::agent::types::AgentSession;

                let session_id = uuid::Uuid::new_v4().to_string();
                let model_name = model.clone().unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
                let now = chrono::Utc::now().to_rfc3339();

                let session = AgentSession {
                    id: session_id.clone(),
                    model: model_name.clone(),
                    messages: Vec::new(),
                    system_prompt,
                    title: None, // 初始会话没有标题，后续会自动生成
                    working_dir: None,
                    execution_strategy: Some(execution_strategy.clone()),
                    created_at: now.clone(),
                    updated_at: now,
                };

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                AgentDao::create_session(&conn, &session)
                    .map_err(|e| format!("创建会话失败: {e}"))?;

                Ok(serde_json::json!({
                    "session_id": session_id,
                    "credential_name": "ProxyCast",
                    "credential_uuid": null,
                    "provider_type": provider_type,
                    "model": model_name,
                    "execution_strategy": execution_strategy
                }))
            } else {
                Err("Database not initialized".into())
            }
        }

        "agent_list_sessions" => {
            if let Some(db) = &state.db {
                use crate::database::dao::agent::AgentDao;

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let sessions = AgentDao::list_sessions(&conn)
                    .map_err(|e| format!("获取会话列表失败: {e}"))?;

                let result: Vec<serde_json::Value> = sessions
                    .into_iter()
                    .map(|s| {
                        let messages_count = AgentDao::get_message_count(&conn, &s.id).unwrap_or(0);
                        serde_json::json!({
                            "session_id": s.id,
                            "provider_type": "aster",
                            "model": s.model,
                            "created_at": s.created_at,
                            "last_activity": s.updated_at,
                            "messages_count": messages_count
                        })
                    })
                    .collect();

                Ok(serde_json::json!(result))
            } else {
                Err("Database not initialized".into())
            }
        }

        "agent_get_session" => {
            let args = args.unwrap_or_default();
            // 支持 session_id 和 sessionId 两种格式
            let session_id = args["session_id"].as_str()
                .or_else(|| args["sessionId"].as_str())
                .unwrap_or("").to_string();

            if let Some(db) = &state.db {
                use crate::database::dao::agent::AgentDao;

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let session = AgentDao::get_session(&conn, &session_id)
                    .map_err(|e| format!("获取会话失败: {e}"))?
                    .ok_or("会话不存在")?;

                let messages_count = AgentDao::get_message_count(&conn, &session_id).unwrap_or(0);

                Ok(serde_json::json!({
                    "session_id": session.id,
                    "provider_type": "aster",
                    "model": session.model,
                    "created_at": session.created_at,
                    "last_activity": session.updated_at,
                    "messages_count": messages_count
                }))
            } else {
                Err("Database not initialized".into())
            }
        }

        "agent_delete_session" => {
            let args = args.unwrap_or_default();
            // 支持 session_id 和 sessionId 两种格式
            let session_id = args["session_id"].as_str()
                .or_else(|| args["sessionId"].as_str())
                .unwrap_or("").to_string();

            if let Some(db) = &state.db {
                use crate::database::dao::agent::AgentDao;

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                AgentDao::delete_session(&conn, &session_id)
                    .map_err(|e| format!("删除会话失败: {e}"))?;

                Ok(serde_json::json!({ "success": true }))
            } else {
                Err("Database not initialized".into())
            }
        }

        "agent_get_session_messages" => {
            let args = args.unwrap_or_default();
            // 支持 session_id 和 sessionId 两种格式
            let session_id = args["session_id"].as_str()
                .or_else(|| args["sessionId"].as_str())
                .unwrap_or("").to_string();

            if let Some(db) = &state.db {
                use crate::database::dao::agent::AgentDao;

                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                let messages = AgentDao::get_messages(&conn, &session_id)
                    .map_err(|e| format!("获取消息失败: {e}"))?;

                Ok(serde_json::to_value(messages)?)
            } else {
                Err("Database not initialized".into())
            }
        }

        _ => Err(format!(
            "[DevBridge] 未知命令: '{cmd}'. 如需此命令，请将其添加到 dispatcher.rs 的 handle_command 函数中。"
        )
        .into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
