//! MCP Tauri 命令
//!
//! 本模块提供 MCP 相关的 Tauri 命令接口，包括：
//! - 服务器配置 CRUD 操作
//! - 服务器生命周期管理（启动、停止）
//! - 服务器状态查询
//! - 工具管理（列表、调用）
//! - 提示词管理（列表、获取内容）
//! - 资源管理（列表、读取内容）
//!
//! # 命令分类
//!
//! ## 配置管理命令
//! - `get_mcp_servers`: 获取所有 MCP 服务器配置
//! - `add_mcp_server`: 添加新的 MCP 服务器配置
//! - `update_mcp_server`: 更新 MCP 服务器配置
//! - `delete_mcp_server`: 删除 MCP 服务器配置
//! - `toggle_mcp_server`: 切换服务器在特定应用中的启用状态
//!
//! ## 生命周期管理命令
//! - `mcp_list_servers_with_status`: 获取所有服务器及其运行状态
//! - `mcp_start_server`: 启动指定的 MCP 服务器
//! - `mcp_stop_server`: 停止指定的 MCP 服务器
//!
//! ## 工具管理命令
//! - `mcp_list_tools`: 获取所有可用工具
//! - `mcp_list_tools_for_context`: 按调用方获取可见工具
//! - `mcp_search_tools`: 搜索工具
//! - `mcp_call_tool`: 调用指定工具
//! - `mcp_call_tool_with_caller`: 带调用方权限检查的工具调用
//!
//! ## 提示词管理命令
//! - `mcp_list_prompts`: 获取所有可用提示词
//! - `mcp_get_prompt`: 获取提示词内容
//!
//! ## 资源管理命令
//! - `mcp_list_resources`: 获取所有可用资源
//! - `mcp_read_resource`: 读取资源内容

use crate::database::DbConnection;
use crate::mcp::{
    McpManagerState, McpPromptDefinition, McpPromptResult, McpResourceContent,
    McpResourceDefinition, McpServerConfig, McpServerInfo, McpToolDefinition, McpToolResult,
};
use crate::models::mcp_model::McpServer;
use lime_services::mcp_service::McpService;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, error, info, Instrument};

#[derive(Debug, Serialize)]
struct McpServerStartedPayload {
    server_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    server_info: Option<McpServerCapabilitiesPayload>,
}

#[derive(Debug, Serialize)]
struct McpServerStoppedPayload {
    server_name: String,
}

#[derive(Debug, Serialize)]
struct McpServerErrorPayload {
    server_name: String,
    error: String,
}

#[derive(Debug, Serialize)]
struct McpServerCapabilitiesPayload {
    name: String,
    version: String,
    supports_tools: bool,
    supports_prompts: bool,
    supports_resources: bool,
}

#[derive(Debug, Serialize)]
struct McpToolsUpdatedPayload {
    tools: Vec<McpToolDefinition>,
}

fn emit_mcp_event<T>(app: &AppHandle, event_name: &str, payload: &T)
where
    T: Serialize,
{
    if let Err(error) = app.emit(event_name, payload) {
        error!(event_name, error = %error, "发送 MCP 事件失败");
    }
}

fn emit_mcp_server_error(app: &AppHandle, server_name: &str, message: &str) {
    emit_mcp_event(
        app,
        "mcp:server_error",
        &McpServerErrorPayload {
            server_name: server_name.to_string(),
            error: message.to_string(),
        },
    );
}

#[tauri::command]
pub fn get_mcp_servers(db: State<'_, DbConnection>) -> Result<Vec<McpServer>, String> {
    McpService::get_all(&db)
}

#[tauri::command]
pub fn add_mcp_server(db: State<'_, DbConnection>, server: McpServer) -> Result<(), String> {
    McpService::add(&db, server)
}

#[tauri::command]
pub fn update_mcp_server(db: State<'_, DbConnection>, server: McpServer) -> Result<(), String> {
    McpService::update(&db, server)
}

#[tauri::command]
pub fn delete_mcp_server(db: State<'_, DbConnection>, id: String) -> Result<(), String> {
    McpService::delete(&db, &id)
}

#[tauri::command]
pub fn toggle_mcp_server(
    db: State<'_, DbConnection>,
    id: String,
    app_type: String,
    enabled: bool,
) -> Result<(), String> {
    McpService::toggle_enabled(&db, &id, &app_type, enabled)
}

#[tauri::command]
pub fn import_mcp_from_app(db: State<'_, DbConnection>, app_type: String) -> Result<usize, String> {
    McpService::import_from_app(&db, &app_type)
}

#[tauri::command]
pub fn sync_all_mcp_to_live(db: State<'_, DbConnection>) -> Result<(), String> {
    McpService::sync_all_to_live(&db)
}

// ============================================================================
// 服务器生命周期管理命令
// ============================================================================

/// 获取所有 MCP 服务器配置及其运行状态
///
/// 从数据库获取所有配置的 MCP 服务器，并查询每个服务器的运行状态。
///
/// # Arguments
///
/// * `db` - 数据库连接状态
/// * `mcp_manager` - MCP 管理器状态
///
/// # Returns
///
/// 返回包含运行状态的服务器信息列表。
///
/// # Requirements
///
/// - **9.1**: THE mcp_list_servers command SHALL return all configured MCP servers with status
#[tauri::command]
pub async fn mcp_list_servers_with_status(
    db: State<'_, DbConnection>,
    mcp_manager: State<'_, McpManagerState>,
) -> Result<Vec<McpServerInfo>, String> {
    info!("获取所有 MCP 服务器及状态");

    // 1. 从数据库获取所有服务器配置
    let servers = McpService::get_all(&db)?;

    // 2. 获取管理器锁
    let manager = mcp_manager.lock().await;

    // 3. 构建带状态的服务器信息列表
    let mut result: Vec<McpServerInfo> = Vec::new();

    for server in servers {
        // 解析服务器配置
        let config = parse_server_config(&server.server_config);

        // 检查服务器是否正在运行
        let is_running = manager.is_server_running(&server.name).await;

        // 获取服务器能力信息（如果正在运行）
        let server_info = if is_running {
            manager.get_client_capabilities(&server.name).await
        } else {
            None
        };

        result.push(McpServerInfo {
            id: server.id,
            name: server.name,
            description: server.description,
            config,
            is_running,
            server_info,
            enabled_lime: server.enabled_lime,
            enabled_claude: server.enabled_claude,
            enabled_codex: server.enabled_codex,
            enabled_gemini: server.enabled_gemini,
        });
    }

    debug!(server_count = result.len(), "返回服务器列表");
    Ok(result)
}

/// 启动 MCP 服务器
///
/// 根据服务器名称从数据库获取配置，然后启动服务器进程。
///
/// # Arguments
///
/// * `db` - 数据库连接状态
/// * `mcp_manager` - MCP 管理器状态
/// * `name` - 服务器名称
///
/// # Returns
///
/// 成功返回 Ok(())，失败返回错误信息。
///
/// # Requirements
///
/// - **9.2**: THE mcp_start_server command SHALL start a specified MCP server
#[tracing::instrument(
    name = "mcp_start_server",
    skip(db, mcp_manager),
    fields(server_name = %name)
)]
#[tauri::command]
pub async fn mcp_start_server(
    app: AppHandle,
    db: State<'_, DbConnection>,
    mcp_manager: State<'_, McpManagerState>,
    name: String,
) -> Result<(), String> {
    info!(server_name = %name, "启动 MCP 服务器命令");

    // 1. 从数据库获取服务器配置
    let servers = McpService::get_all(&db)?;
    let server = servers
        .iter()
        .find(|s| s.name == name)
        .ok_or_else(|| format!("服务器配置不存在: {name}"))?;

    // 2. 解析服务器配置
    let config = parse_server_config(&server.server_config);

    // 3. 获取管理器锁并启动服务器
    let manager = async { mcp_manager.lock().await }
        .instrument(tracing::debug_span!("mcp_start_server.acquire_manager"))
        .await;
    manager.start_server(&name, &config).await.map_err(|e| {
        let message = e.to_string();
        error!(server_name = %name, error = %message, "启动 MCP 服务器失败");
        emit_mcp_server_error(&app, &name, &message);
        message
    })?;

    let server_info =
        manager
            .get_client_capabilities(&name)
            .await
            .map(|info| McpServerCapabilitiesPayload {
                name: info.name,
                version: info.version,
                supports_tools: info.supports_tools,
                supports_prompts: info.supports_prompts,
                supports_resources: info.supports_resources,
            });
    let tools = manager.list_tools().await.unwrap_or_default();

    info!(server_name = %name, "MCP 服务器启动成功");
    emit_mcp_event(
        &app,
        "mcp:server_started",
        &McpServerStartedPayload {
            server_name: name.clone(),
            server_info,
        },
    );
    emit_mcp_event(&app, "mcp:tools_updated", &McpToolsUpdatedPayload { tools });
    Ok(())
}

/// 停止 MCP 服务器
///
/// 根据服务器名称停止正在运行的服务器进程。
///
/// # Arguments
///
/// * `mcp_manager` - MCP 管理器状态
/// * `name` - 服务器名称
///
/// # Returns
///
/// 成功返回 Ok(())，失败返回错误信息。
/// 如果服务器未运行，也返回 Ok()（幂等操作）。
///
/// # Requirements
///
/// - **9.3**: THE mcp_stop_server command SHALL stop a specified MCP server
#[tauri::command]
pub async fn mcp_stop_server(
    app: AppHandle,
    mcp_manager: State<'_, McpManagerState>,
    name: String,
) -> Result<(), String> {
    info!(server_name = %name, "停止 MCP 服务器命令");

    // 获取管理器锁并停止服务器
    let manager = mcp_manager.lock().await;
    manager.stop_server(&name).await.map_err(|e| {
        let message = e.to_string();
        error!(server_name = %name, error = %message, "停止 MCP 服务器失败");
        emit_mcp_server_error(&app, &name, &message);
        message
    })?;
    let tools = manager.list_tools().await.unwrap_or_default();

    info!(server_name = %name, "MCP 服务器已停止");
    emit_mcp_event(
        &app,
        "mcp:server_stopped",
        &McpServerStoppedPayload { server_name: name },
    );
    emit_mcp_event(&app, "mcp:tools_updated", &McpToolsUpdatedPayload { tools });
    Ok(())
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 解析服务器配置 JSON 为 McpServerConfig
///
/// 将数据库中存储的 JSON 配置解析为结构化的 McpServerConfig。
/// 如果解析失败，返回默认配置。
///
/// # Arguments
///
/// * `config_value` - JSON 格式的服务器配置
///
/// # Returns
///
/// 返回解析后的 McpServerConfig，如果解析失败则返回默认值。
fn parse_server_config(config_value: &serde_json::Value) -> McpServerConfig {
    serde_json::from_value(config_value.clone()).unwrap_or_else(|e| {
        debug!(error = %e, "解析服务器配置失败，使用默认值");
        McpServerConfig {
            command: config_value
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            args: config_value
                .get("args")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default(),
            env: config_value
                .get("env")
                .and_then(|v| v.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default(),
            cwd: config_value
                .get("cwd")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            timeout: config_value
                .get("timeout")
                .and_then(|v| v.as_u64())
                .unwrap_or(30),
        }
    })
}

// ============================================================================
// 工具管理命令
// ============================================================================

/// 获取所有可用工具
///
/// 从所有运行中的 MCP 服务器获取工具定义列表。
/// 工具定义包含名称、描述和输入参数 schema。
///
/// # Arguments
///
/// * `mcp_manager` - MCP 管理器状态
///
/// # Returns
///
/// 返回所有可用工具的定义列表。
///
/// # Requirements
///
/// - **9.4**: THE mcp_list_tools command SHALL return all available tools from running servers
#[tracing::instrument(name = "mcp_list_tools", skip(mcp_manager))]
#[tauri::command]
pub async fn mcp_list_tools(
    mcp_manager: State<'_, McpManagerState>,
) -> Result<Vec<McpToolDefinition>, String> {
    info!("获取所有 MCP 工具列表");

    let manager = async { mcp_manager.lock().await }
        .instrument(tracing::debug_span!("mcp_list_tools.acquire_manager"))
        .await;
    let tools = manager
        .list_tools()
        .instrument(tracing::info_span!("mcp_list_tools.list_tools"))
        .await
        .map_err(|e| {
            error!(error = %e, "获取工具列表失败");
            e.to_string()
        })?;

    debug!(tool_count = tools.len(), "返回工具列表");
    Ok(tools)
}

/// 根据调用方获取可见工具（支持 deferred_loading 过滤）
#[tauri::command]
pub async fn mcp_list_tools_for_context(
    mcp_manager: State<'_, McpManagerState>,
    caller: Option<String>,
    include_deferred: Option<bool>,
) -> Result<Vec<McpToolDefinition>, String> {
    let manager = mcp_manager.lock().await;
    let tools = manager
        .list_tools_for_context(caller.as_deref(), include_deferred.unwrap_or(false))
        .await
        .map_err(|e| {
            error!(error = %e, "按上下文获取工具列表失败");
            e.to_string()
        })?;
    Ok(tools)
}

/// 搜索工具（用于 Tool Search 模式）
#[tauri::command]
pub async fn mcp_search_tools(
    mcp_manager: State<'_, McpManagerState>,
    query: String,
    caller: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<McpToolDefinition>, String> {
    let manager = mcp_manager.lock().await;
    let tools = manager
        .search_tools(&query, limit.unwrap_or(10), caller.as_deref())
        .await
        .map_err(|e| {
            error!(error = %e, "搜索工具失败");
            e.to_string()
        })?;
    Ok(tools)
}

/// 调用 MCP 工具
///
/// 根据工具名称和参数调用指定的 MCP 工具。
/// 工具名称可能包含服务器前缀（格式为 "server_toolname"）。
///
/// # Arguments
///
/// * `mcp_manager` - MCP 管理器状态
/// * `tool_name` - 工具名称
/// * `arguments` - 工具参数（JSON 对象）
///
/// # Returns
///
/// 返回工具调用结果，包含内容和错误状态。
///
/// # Requirements
///
/// - **9.5**: THE mcp_call_tool command SHALL call a tool and return the result
#[tracing::instrument(
    name = "mcp_call_tool",
    skip(mcp_manager, arguments),
    fields(tool_name = %tool_name)
)]
#[tauri::command]
pub async fn mcp_call_tool(
    mcp_manager: State<'_, McpManagerState>,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<McpToolResult, String> {
    info!(tool_name = %tool_name, "调用 MCP 工具命令");

    let manager = async { mcp_manager.lock().await }
        .instrument(tracing::debug_span!("mcp_call_tool.acquire_manager"))
        .await;
    let result = manager
        .call_tool(&tool_name, arguments)
        .instrument(tracing::info_span!("mcp_call_tool.call_tool"))
        .await
        .map_err(|e| {
            error!(tool_name = %tool_name, error = %e, "调用工具失败");
            e.to_string()
        })?;

    info!(
        tool_name = %tool_name,
        is_error = result.is_error,
        "工具调用完成"
    );
    Ok(result)
}

/// 带调用方权限检查的 MCP 工具调用
#[tauri::command]
pub async fn mcp_call_tool_with_caller(
    mcp_manager: State<'_, McpManagerState>,
    tool_name: String,
    arguments: serde_json::Value,
    caller: Option<String>,
) -> Result<McpToolResult, String> {
    let manager = mcp_manager.lock().await;
    let result = manager
        .call_tool_with_caller(&tool_name, arguments, caller.as_deref())
        .await
        .map_err(|e| {
            error!(tool_name = %tool_name, error = %e, "带 caller 调用工具失败");
            e.to_string()
        })?;
    Ok(result)
}

// ============================================================================
// 提示词管理命令
// ============================================================================

/// 获取所有可用提示词
///
/// 从所有运行中的 MCP 服务器获取提示词定义列表。
/// 提示词定义包含名称、描述和参数列表。
///
/// # Arguments
///
/// * `mcp_manager` - MCP 管理器状态
///
/// # Returns
///
/// 返回所有可用提示词的定义列表。
///
/// # Requirements
///
/// - **9.6**: THE mcp_list_prompts command SHALL return all available prompts from running servers
#[tauri::command]
pub async fn mcp_list_prompts(
    mcp_manager: State<'_, McpManagerState>,
) -> Result<Vec<McpPromptDefinition>, String> {
    info!("获取所有 MCP 提示词列表");

    let manager = mcp_manager.lock().await;
    let prompts = manager.list_prompts().await.map_err(|e| {
        error!(error = %e, "获取提示词列表失败");
        e.to_string()
    })?;

    debug!(prompt_count = prompts.len(), "返回提示词列表");
    Ok(prompts)
}

/// 获取提示词内容
///
/// 根据提示词名称和参数获取提示词内容。
/// 提示词名称可能包含服务器前缀（格式为 "server_promptname"）。
///
/// # Arguments
///
/// * `mcp_manager` - MCP 管理器状态
/// * `name` - 提示词名称
/// * `arguments` - 提示词参数（JSON 对象）
///
/// # Returns
///
/// 返回提示词内容，包含描述和消息列表。
///
/// # Requirements
///
/// - **9.7**: THE mcp_get_prompt command SHALL return prompt content with argument substitution
#[tauri::command]
pub async fn mcp_get_prompt(
    mcp_manager: State<'_, McpManagerState>,
    name: String,
    arguments: serde_json::Map<String, serde_json::Value>,
) -> Result<McpPromptResult, String> {
    info!(prompt_name = %name, "获取 MCP 提示词内容命令");

    let manager = mcp_manager.lock().await;
    let result = manager.get_prompt(&name, arguments).await.map_err(|e| {
        error!(prompt_name = %name, error = %e, "获取提示词内容失败");
        e.to_string()
    })?;

    info!(
        prompt_name = %name,
        message_count = result.messages.len(),
        "提示词内容获取完成"
    );
    Ok(result)
}

// ============================================================================
// 资源管理命令
// ============================================================================

/// 获取所有可用资源
///
/// 从所有运行中的 MCP 服务器获取资源定义列表。
/// 资源定义包含 URI、名称、描述和 MIME 类型。
///
/// # Arguments
///
/// * `mcp_manager` - MCP 管理器状态
///
/// # Returns
///
/// 返回所有可用资源的定义列表。
///
/// # Requirements
///
/// - **9.8**: THE mcp_list_resources command SHALL return all available resources from running servers
#[tauri::command]
pub async fn mcp_list_resources(
    mcp_manager: State<'_, McpManagerState>,
) -> Result<Vec<McpResourceDefinition>, String> {
    info!("获取所有 MCP 资源列表");

    let manager = mcp_manager.lock().await;
    let resources = manager.list_resources().await.map_err(|e| {
        error!(error = %e, "获取资源列表失败");
        e.to_string()
    })?;

    debug!(resource_count = resources.len(), "返回资源列表");
    Ok(resources)
}

/// 读取资源内容
///
/// 根据资源 URI 读取资源内容。
///
/// # Arguments
///
/// * `mcp_manager` - MCP 管理器状态
/// * `uri` - 资源 URI
///
/// # Returns
///
/// 返回资源内容，包含 URI、MIME 类型和内容（文本或二进制）。
///
/// # Requirements
///
/// - **9.9**: THE mcp_read_resource command SHALL return resource content by URI
#[tauri::command]
pub async fn mcp_read_resource(
    mcp_manager: State<'_, McpManagerState>,
    uri: String,
) -> Result<McpResourceContent, String> {
    info!(uri = %uri, "读取 MCP 资源内容命令");

    let manager = mcp_manager.lock().await;
    let result = manager.read_resource(&uri).await.map_err(|e| {
        error!(uri = %uri, error = %e, "读取资源内容失败");
        e.to_string()
    })?;

    info!(uri = %uri, "资源内容读取完成");
    Ok(result)
}
