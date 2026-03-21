use super::*;

pub(crate) async fn inject_mcp_extensions(
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> (usize, usize) {
    let manager = mcp_manager.lock().await;
    let running_servers = manager.get_running_servers().await;

    if running_servers.is_empty() {
        tracing::debug!("[AsterAgent] 没有运行中的 MCP servers，跳过注入");
        return (0, 0);
    }

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = match guard.as_ref() {
        Some(a) => a,
        None => {
            tracing::warn!("[AsterAgent] Agent 未初始化，无法注入 MCP extensions");
            return (0, running_servers.len());
        }
    };

    let all_tools = match manager.list_tools().await {
        Ok(tools) => tools,
        Err(error) => {
            tracing::warn!("[AsterAgent] 读取 MCP 工具列表失败，跳过注入: {}", error);
            return (0, running_servers.len());
        }
    };
    let mut tools_by_server: HashMap<String, Vec<crate::mcp::McpToolDefinition>> = HashMap::new();
    for tool in all_tools {
        tools_by_server
            .entry(tool.server_name.clone())
            .or_default()
            .push(tool);
    }

    let clients_handle = manager.clients();
    let clients = clients_handle.read().await;
    let mut success_count = 0usize;
    let mut fail_count = 0usize;

    for server_name in &running_servers {
        // 检查是否已注册（避免重复注册）
        let ext_configs = agent.get_extension_configs().await;
        if ext_configs.iter().any(|c| c.name() == *server_name) {
            tracing::debug!("[AsterAgent] MCP extension '{}' 已注册，跳过", server_name);
            success_count += 1;
            continue;
        }

        let Some(wrapper) = clients.get(server_name) else {
            tracing::warn!("[AsterAgent] MCP server '{}' 无连接包装器", server_name);
            fail_count += 1;
            continue;
        };

        let Some(running_service) = wrapper.running_service_arc() else {
            tracing::warn!("[AsterAgent] MCP server '{}' 无运行中 service", server_name);
            fail_count += 1;
            continue;
        };

        let server_tools = tools_by_server
            .get(server_name)
            .cloned()
            .unwrap_or_default();
        let surface = build_mcp_extension_surface(
            server_name,
            format!("Lime MCP Bridge: {server_name}"),
            &server_tools,
        );

        let extension = ExtensionConfig::Builtin {
            name: server_name.clone(),
            display_name: Some(server_name.clone()),
            description: surface.description.clone(),
            timeout: None,
            bundled: Some(false),
            available_tools: surface.available_tools.clone(),
            deferred_loading: surface.deferred_loading,
            always_expose_tools: surface.always_expose_tools.clone(),
            allowed_caller: surface.allowed_caller.clone(),
        };

        let bridge_client = McpBridgeClient::new(
            server_name.clone(),
            running_service.clone(),
            wrapper.handler(),
            running_service.peer_info().cloned(),
        );
        let client: Arc<tokio::sync::Mutex<Box<dyn aster::agents::mcp_client::McpClientTrait>>> =
            Arc::new(tokio::sync::Mutex::new(Box::new(bridge_client)));

        agent
            .extension_manager
            .add_client(
                server_name.clone(),
                extension,
                client,
                running_service.peer_info().cloned(),
                None,
            )
            .await;

        tracing::info!(
            "[AsterAgent] 已桥接 MCP extension: name={}, tool_count={}, deferred={}, always_expose={}",
            server_name,
            surface.available_tools.len(),
            surface.deferred_loading,
            surface.always_expose_tools.len()
        );
        success_count += 1;
    }

    drop(clients);

    if fail_count > 0 {
        tracing::warn!(
            "[AsterAgent] MCP 注入结果: {} 成功, {} 失败",
            success_count,
            fail_count
        );
    } else {
        tracing::info!(
            "[AsterAgent] MCP 注入完成: {} 个 extension 全部成功",
            success_count
        );
    }

    (success_count, fail_count)
}

/// 确保 Lime 可用的 MCP servers 已启动
///
/// 启动启用了 `enabled_lime` 的服务器。
pub(crate) async fn ensure_lime_mcp_servers_running(
    db: &DbConnection,
    mcp_manager: &McpManagerState,
) -> (usize, usize) {
    let servers = match McpService::get_all(db) {
        Ok(items) => items,
        Err(e) => {
            tracing::warn!("[AsterAgent] 读取 MCP 配置失败，跳过自动启动: {}", e);
            return (0, 0);
        }
    };

    if servers.is_empty() {
        return (0, 0);
    }

    let candidates: Vec<&crate::models::mcp_model::McpServer> =
        servers.iter().filter(|s| s.enabled_lime).collect();

    if candidates.is_empty() {
        return (0, 0);
    }

    let manager = mcp_manager.lock().await;
    let mut success_count = 0usize;
    let mut fail_count = 0usize;

    for server in candidates {
        if manager.is_server_running(&server.name).await {
            continue;
        }

        let parsed = server.parse_config();
        let config = McpServerConfig {
            command: parsed.command,
            args: parsed.args,
            env: parsed.env,
            cwd: parsed.cwd,
            timeout: parsed.timeout,
        };

        match manager.start_server(&server.name, &config).await {
            Ok(_) => {
                tracing::info!("[AsterAgent] MCP server 已自动启动: {}", server.name);
                success_count += 1;
            }
            Err(e) => {
                tracing::error!(
                    "[AsterAgent] MCP server 自动启动失败: {} => {}",
                    server.name,
                    e
                );
                fail_count += 1;
            }
        }
    }

    (success_count, fail_count)
}
