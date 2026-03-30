//! 应用运行器模块
//!
//! 包含 Tauri 应用的主入口函数和命令注册。

use std::sync::Arc;
use tauri::{Emitter, Manager};

#[cfg(desktop)]
use tauri::Listener;

use crate::commands;
use crate::tray::{TrayIconStatus, TrayManager, TrayStateSnapshot};

use super::bootstrap::{self, AppStates};
use super::commands as app_commands;
use super::types::{AppState, TrayManagerState};

const MAIN_WINDOW_LABEL: &str = "main";
const SKIP_STARTUP_WINDOW_REVEAL_ENV: &str = "LIME_SKIP_STARTUP_WINDOW_REVEAL";

fn env_flag_enabled(key: &str) -> bool {
    matches!(
        std::env::var(key)
            .ok()
            .as_deref()
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("1") | Some("true") | Some("yes") | Some("on")
    )
}

fn should_reveal_main_window_on_startup() -> bool {
    !env_flag_enabled(SKIP_STARTUP_WINDOW_REVEAL_ENV)
}

fn compiled_updater_public_key() -> Option<&'static str> {
    option_env!("LIME_UPDATER_PUBLIC_KEY")
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn should_minimize_to_tray(window_label: &str, minimize_to_tray: bool) -> bool {
    minimize_to_tray && window_label == MAIN_WINDOW_LABEL
}

fn reveal_main_window(window: &tauri::WebviewWindow) {
    let run_action = |action: &str, operation: &dyn Fn() -> tauri::Result<()>| {
        if let Err(error) = operation() {
            tracing::warn!("[启动] 主窗口{}失败: {}", action, error);
        }
    };

    run_action("取消最小化", &|| window.unminimize());
    run_action("最大化", &|| window.maximize());
    run_action("显示", &|| window.show());
    run_action("聚焦", &|| window.set_focus());
}

/// 运行 Tauri 应用
///
/// 这是应用的主入口点，负责：
/// 1. 加载和验证配置
/// 2. 初始化所有应用状态
/// 3. 配置 Tauri Builder（插件、状态管理、事件处理）
/// 4. 注册所有 Tauri 命令
/// 5. 启动应用
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _profiling_guard = crate::profiling::init();

    // 加载并验证配置
    let config = match bootstrap::load_and_validate_config() {
        Ok(cfg) => cfg,
        Err(err) => {
            tracing::error!("{}", err);
            eprintln!("{err}");
            return;
        }
    };

    tauri::async_runtime::block_on(
        crate::services::environment_service::apply_configured_environment(&config),
    );

    // 初始化崩溃上报（保持 guard 生命周期直到应用退出）
    let _crash_reporting_guard = crate::crash_reporting::init_from_config(&config);

    // 初始化所有应用状态
    let states = match bootstrap::init_states(&config) {
        Ok(s) => s,
        Err(err) => {
            tracing::error!("应用状态初始化失败: {}", err);
            eprintln!("应用状态初始化失败: {err}");
            return;
        }
    };

    // 解构状态以便使用
    let AppStates {
        state,
        logs,
        db,
        skill_service: skill_service_state,
        provider_pool_service: provider_pool_service_state,
        api_key_provider_service: api_key_provider_service_state,
        credential_sync_service: credential_sync_service_state,
        token_cache_service: token_cache_service_state,
        machine_id_service: machine_id_service_state,
        resilience_config: resilience_config_state,
        plugin_manager: plugin_manager_state,
        plugin_installer: plugin_installer_state,
        plugin_rpc_manager: plugin_rpc_manager_state,
        telemetry: telemetry_state,
        aster_agent: aster_agent_state,
        orchestrator: orchestrator_state,
        connect_state,
        model_registry: model_registry_state,
        global_config_manager: global_config_manager_state,
        terminal_manager: terminal_manager_state,
        webview_manager: webview_manager_state,
        chrome_profile_manager: chrome_profile_manager_state,
        update_check_service: update_check_service_state,
        session_files: session_files_state,
        context_memory_service,
        recording_service,
        mcp_manager: mcp_manager_state,
        automation_service: automation_service_state,
        shared_stats,
        shared_tokens,
        shared_logger,
    } = states;

    // Clone for setup hook
    let state_clone = state.clone();
    let logs_clone = logs.clone();
    let db_clone = db.clone();
    let pool_service_clone = provider_pool_service_state.0.clone();
    #[cfg(debug_assertions)]
    let api_key_provider_service_clone = api_key_provider_service_state.0.clone();
    #[cfg(debug_assertions)]
    let connect_state_clone = connect_state.0.clone();
    #[cfg(debug_assertions)]
    let model_registry_clone = model_registry_state.clone();
    #[cfg(debug_assertions)]
    let skill_service_clone = skill_service_state.0.clone();
    let token_cache_clone = token_cache_service_state.0.clone();
    let shared_stats_clone = shared_stats.clone();
    let shared_tokens_clone = shared_tokens.clone();
    let shared_logger_clone = shared_logger.clone();
    let update_check_service_clone = update_check_service_state.clone();
    let gateway_tunnel_state = lime_gateway::tunnel::GatewayTunnelState::default();
    let gateway_tunnel_state_for_setup = gateway_tunnel_state.clone();
    let global_config_manager_for_setup = global_config_manager_state.clone();
    let tunnel_logs_clone = logs.clone();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ));

    // 在桌面端注册 Deep Link 插件
    // _Requirements: 1.4_
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_deep_link::init());
    }

    builder = builder
        // 单实例插件：当第二个实例启动时，将 URL 传递给第一个实例
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            tracing::info!("[单实例] 收到来自新实例的参数: {:?}", args);

            // 将窗口带到前台
            if should_reveal_main_window_on_startup() {
                if let Some(window) = app.get_webview_window("main") {
                    reveal_main_window(&window);
                }
            } else {
                tracing::info!("[启动] 已跳过主窗口展示流程（headless smoke 模式）");
            }

            let deep_link_urls: Vec<String> = args
                .iter()
                .filter_map(|arg| {
                    let value = arg.trim();
                    if value.starts_with("lime://") {
                        Some(value.to_string())
                    } else {
                        None
                    }
                })
                .collect();

            if !deep_link_urls.is_empty() {
                tracing::info!("[单实例] 转发 Deep Link URL: {:?}", deep_link_urls);
                if let Err(error) = app.emit("deep-link://new-url", &deep_link_urls) {
                    tracing::error!("[单实例] 转发 Deep Link URL 失败: {}", error);
                }
            }
        }));

    builder
        .manage(state)
        .manage(logs)
        .manage(db)
        .manage(skill_service_state)
        .manage(provider_pool_service_state)
        .manage(api_key_provider_service_state)
        .manage(credential_sync_service_state)
        .manage(token_cache_service_state)
        .manage(machine_id_service_state)
        .manage(resilience_config_state)
        .manage(telemetry_state)
        .manage(plugin_manager_state)
        .manage(plugin_installer_state)
        .manage(plugin_rpc_manager_state)
        .manage(aster_agent_state)
        .manage(orchestrator_state)
        .manage(connect_state)
        .manage(model_registry_state)
        .manage(global_config_manager_state)
        .manage(terminal_manager_state)
        .manage(webview_manager_state)
        .manage(chrome_profile_manager_state)
        .manage(update_check_service_state)
        .manage(session_files_state)
        .manage(context_memory_service)
        .manage(recording_service)
        .manage(mcp_manager_state)
        .manage(automation_service_state)
        .manage(commands::subagent_cmd::SubAgentSchedulerState::default())
        .manage(commands::websocket_cmd::WsServiceState::default())
        .manage(lime_gateway::telegram::TelegramGatewayState::default())
        .manage(lime_gateway::discord::DiscordGatewayState::default())
        .manage(lime_gateway::feishu::FeishuGatewayState::default())
        .manage(lime_gateway::wechat::WechatGatewayState::default())
        .manage(lime_gateway::wechat::WechatLoginState::default())
        .manage(gateway_tunnel_state)
        .manage(crate::services::openclaw_service::OpenClawServiceState::default())
        .manage(commands::telegram_remote_cmd::TelegramRemoteState::default())
        .on_window_event(move |window, event| {
            // 处理窗口关闭事件
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let window_label = window.label().to_string();
                // 获取配置，检查是否启用最小化到托盘
                let app_handle = window.app_handle();
                if let Some(app_state) = app_handle.try_state::<AppState>() {
                    // 使用 block_on 同步获取配置
                    let minimize_to_tray = tauri::async_runtime::block_on(async {
                        let state = app_state.read().await;
                        state.config.minimize_to_tray
                    });

                    if should_minimize_to_tray(&window_label, minimize_to_tray) {
                        // 阻止默认关闭行为
                        api.prevent_close();
                        // 隐藏窗口而不是关闭
                        if let Err(e) = window.hide() {
                            tracing::error!("[窗口] 隐藏窗口失败: {}", e);
                        } else {
                            tracing::info!("[窗口] 窗口已最小化到托盘");
                        }
                    }
                }
            }
        })
        .setup(move |app| {
            #[cfg(desktop)]
            if let Some(public_key) = compiled_updater_public_key() {
                app.handle().plugin(
                    tauri_plugin_updater::Builder::new()
                        .pubkey(public_key)
                        .build(),
                )?;
            } else {
                tracing::info!("[启动] 未注入 updater 公钥，跳过注册 updater 插件");
            }

            // 启动时先最大化再显示，避免用户看到“先小窗后展开”的过程。
            if let Some(main_window) = app.get_webview_window("main") {
                if should_reveal_main_window_on_startup() {
                    reveal_main_window(&main_window);
                } else {
                    tracing::info!("[启动] 已跳过主窗口展示流程（headless smoke 模式）");
                }

                #[cfg(debug_assertions)]
                if env_flag_enabled("LIME_OPEN_WEBVIEW_DEVTOOLS") {
                    main_window.open_devtools();
                    tracing::info!("[Profiling] 已自动打开主窗口 WebView DevTools");
                }
            } else {
                tracing::warn!("[启动] 未找到主窗口，无法执行启动展示流程");
            }

            #[cfg(target_os = "windows")]
            {
                crate::commands::windows_startup_cmd::maybe_show_windows_startup_notice(&app.handle());
            }

            // 初始化托盘管理器
            // Requirements 1.4: 应用启动时显示停止状态图标
            match TrayManager::new(app.handle()) {
                Ok(tray_manager) => {
                    tracing::info!("[启动] 托盘管理器初始化成功");
                    // 将托盘管理器存储到应用状态中
                    let tray_state: TrayManagerState<tauri::Wry> =
                        TrayManagerState(Arc::new(tokio::sync::RwLock::new(Some(tray_manager))));
                    app.manage(tray_state);
                }
                Err(e) => {
                    tracing::error!("[启动] 托盘管理器初始化失败: {}", e);
                    // 即使托盘初始化失败，应用仍然可以运行
                    let tray_state: TrayManagerState<tauri::Wry> =
                        TrayManagerState(Arc::new(tokio::sync::RwLock::new(None)));
                    app.manage(tray_state);
                }
            }

            // 设置 GlobalConfigManager 的事件发射器（用于向前端发送事件）
            if let Some(config_manager) =
                app.try_state::<crate::config::GlobalConfigManagerState>()
            {
                let emitter = std::sync::Arc::new(
                    crate::config::observer::TauriConfigEmitter::new(app.handle().clone()),
                );
                config_manager.0.set_emitter(emitter);
                tracing::info!("[启动] GlobalConfigManager 事件发射器已设置");
            }

            // 设置 MCP Manager 的事件发射器（用于发送 mcp:* 事件）
            if let Some(mcp_manager) = app.try_state::<crate::mcp::McpManagerState>() {
                let app_handle = app.handle().clone();
                let emitter = lime_core::DynEmitter::new(
                    crate::app::TauriEventEmitter(app_handle),
                );
                tauri::async_runtime::block_on(async {
                    let mut manager = mcp_manager.lock().await;
                    manager.set_emitter(emitter);
                });
                tracing::info!("[启动] MCP Manager 事件发射器已设置");
            }

            // 设置 PluginManager 的任务事件发射器（用于发送 plugin-task-event）
            if let Some(plugin_manager) =
                app.try_state::<crate::commands::plugin_cmd::PluginManagerState>()
            {
                let app_handle = app.handle().clone();
                let emitter = lime_core::DynEmitter::new(
                    crate::app::TauriEventEmitter(app_handle),
                );
                tauri::async_runtime::block_on(async {
                    let manager = plugin_manager.0.read().await;
                    manager.set_task_emitter(emitter).await;
                });
                tracing::info!("[启动] PluginManager 任务事件发射器已设置");
            }

            let startup_runtime_resume = {
                let aster_agent_state = app.try_state::<crate::agent::AsterAgentState>();
                let db_state = app.try_state::<crate::database::DbConnection>();
                let api_key_provider_service =
                    app.try_state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
                let log_state = app.try_state::<crate::LogState>();
                let config_manager = app.try_state::<crate::config::GlobalConfigManagerState>();
                let mcp_manager = app.try_state::<crate::mcp::McpManagerState>();
                let automation_state =
                    app.try_state::<crate::services::automation_service::AutomationServiceState>();

                match (
                    aster_agent_state,
                    db_state,
                    api_key_provider_service,
                    log_state,
                    config_manager,
                    mcp_manager,
                    automation_state,
                ) {
                    (
                        Some(aster_agent_state),
                        Some(db_state),
                        Some(api_key_provider_service),
                        Some(log_state),
                        Some(config_manager),
                        Some(mcp_manager),
                        Some(automation_state),
                    ) => Some((
                        app.handle().clone(),
                        aster_agent_state.inner().clone(),
                        db_state.inner().clone(),
                        crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState(
                            api_key_provider_service.0.clone(),
                        ),
                        log_state.inner().clone(),
                        crate::config::GlobalConfigManagerState(
                            config_manager.0.clone(),
                        ),
                        mcp_manager.inner().clone(),
                        automation_state.inner().clone(),
                    )),
                    _ => None,
                }
            };

            if let Some((
                app_handle,
                state,
                db,
                api_key_provider_service,
                logs,
                config_manager,
                mcp_manager,
                automation_state,
            )) = startup_runtime_resume
            {
                tauri::async_runtime::spawn(async move {
                    match crate::commands::aster_agent_cmd::resume_persisted_runtime_queues_on_startup(
                        app_handle,
                        &state,
                        &db,
                        &api_key_provider_service,
                        &logs,
                        &config_manager,
                        &mcp_manager,
                        &automation_state,
                    )
                    .await
                    {
                        Ok(resumed) if resumed > 0 => {
                            tracing::info!("[启动] 已恢复 {} 个会话的排队执行", resumed);
                        }
                        Ok(_) => {
                            tracing::debug!("[启动] 无需恢复持久化排队执行");
                        }
                        Err(error) => {
                            tracing::warn!("[启动] 恢复持久化排队执行失败: {}", error);
                        }
                    }
                });
            }

            #[cfg(debug_assertions)]
            {
                let app_handle = app.handle().clone();
                let server_state = state_clone.clone();
                let logs = logs_clone.clone();
                let db = Some(db_clone.clone());
                let pool_service = pool_service_clone.clone();
                let api_key_provider_service = api_key_provider_service_clone.clone();
                let connect_state = connect_state_clone.clone();
                let model_registry = model_registry_clone.clone();
                let skill_service = skill_service_clone.clone();
                let shared_stats = shared_stats_clone.clone();

                tauri::async_runtime::spawn(async move {
                    match crate::dev_bridge::DevBridgeServer::start(
                        app_handle,
                        server_state,
                        logs,
                        db,
                        pool_service,
                        api_key_provider_service,
                        connect_state,
                        model_registry,
                        skill_service,
                        shared_stats,
                        None,
                    )
                    .await
                    {
                        Ok(()) => tracing::info!("[启动] Dev Bridge 已启动"),
                        Err(error) => tracing::error!("[启动] Dev Bridge 启动失败: {}", error),
                    }
                });
            }

            // 初始化截图对话模块
            // _Requirements: 7.3_
            {
                let app_handle = app.handle();
                match crate::screenshot::init(app_handle) {
                    Ok(()) => {
                        tracing::info!("[启动] 截图对话模块初始化成功");
                    }
                    Err(e) => {
                        tracing::error!("[启动] 截图对话模块初始化失败: {}", e);
                        // 截图模块初始化失败不影响应用运行
                    }
                }
            }

            // 初始化语音输入模块
            {
                let app_handle = app.handle();
                match crate::voice::init(app_handle) {
                    Ok(()) => {
                        tracing::info!("[启动] 语音输入模块初始化成功");
                    }
                    Err(e) => {
                        tracing::error!("[启动] 语音输入模块初始化失败: {}", e);
                        // 语音模块初始化失败不影响应用运行
                    }
                }
            }

            // 初始化 Connect 状态
            // _Requirements: 1.4, 2.1_
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // 获取应用数据目录
                    let app_data_dir = dirs::data_dir()
                        .unwrap_or_else(|| std::path::PathBuf::from("."))
                        .join("lime");

                    // 初始化 Connect 状态
                    match crate::commands::connect_cmd::init_connect_state(app_data_dir).await {
                        Ok(connect_state_inner) => {
                            tracing::info!("[启动] Connect 模块初始化成功");
                            // 更新状态
                            if let Some(state) = app_handle
                                .try_state::<crate::commands::connect_cmd::ConnectStateWrapper>()
                            {
                                let mut guard = state.0.write().await;
                                *guard = Some(connect_state_inner);
                            }
                        }
                        Err(e) => {
                            tracing::error!("[启动] Connect 模块初始化失败: {:?}", e);
                        }
                    }
                });
            }

            // 初始化 Model Registry 服务
            {
                let app_handle = app.handle().clone();
                let db_clone = db_clone.clone();
                // 获取资源目录路径
                let mut resource_dir = app.path().resource_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

                // 检查 resources/models/index.json 是否存在
                let models_index = resource_dir.join("resources/models/index.json");

                if !models_index.exists() {
                    // 开发模式：尝试多个可能的路径
                    let possible_paths = [
                        // 从 target/debug 回退到 src-tauri
                        std::env::current_exe()
                            .ok()
                            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                            .map(|p| p.join("resources")),
                        // 直接使用 target/debug/resources
                        std::env::current_exe()
                            .ok()
                            .and_then(|p| p.parent().map(|p| p.to_path_buf())),
                        // 使用当前工作目录
                        std::env::current_dir().ok().map(|p| p.join("src-tauri")),
                    ];

                    for path in possible_paths.into_iter().flatten() {
                        let test_index = path.join("resources/models/index.json");
                        if test_index.exists() {
                            resource_dir = path;
                            break;
                        }
                    }
                }

                tauri::async_runtime::spawn(async move {
                    // 创建 ModelRegistryService
                    let mut service = lime_services::model_registry_service::ModelRegistryService::new(db_clone);
                    // 设置资源目录路径
                    service.set_resource_dir(resource_dir);

                    // 初始化服务
                    match service.initialize().await {
                        Ok(()) => {
                            tracing::info!("[启动] Model Registry 服务初始化成功");
                            // 更新状态
                            if let Some(state) = app_handle
                                .try_state::<crate::commands::model_registry_cmd::ModelRegistryState>()
                            {
                                let mut guard = state.write().await;
                                *guard = Some(service);
                            }
                        }
                        Err(e) => {
                            tracing::error!("[启动] Model Registry 服务初始化失败: {}", e);
                        }
                    }
                });
            }

            // 初始化终端会话管理器
            {
                let app_handle = app.handle().clone();
                let terminal_manager = lime_terminal::TerminalSessionManager::new(crate::terminal::TauriEmitter(app_handle.clone()));
                if let Some(state) = app_handle.try_state::<crate::commands::terminal_cmd::TerminalManagerState>() {
                    let mut guard = state.inner().0.blocking_write();
                    *guard = Some(terminal_manager);
                    tracing::info!("[启动] 终端会话管理器初始化成功");
                }
            }

            // 注册 Deep Link 事件处理器（桌面端）
            // _Requirements: 1.4_
            #[cfg(desktop)]
            {
                let app_handle = app.handle().clone();
                app.listen("deep-link://new-url", move |event| {
                    let urls = event.payload().to_string();
                    tracing::info!("[Deep Link] 收到 URL: {}", urls);
                    // 解析 URL 并处理
                    let app_handle_clone = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                            // 尝试解析为 JSON 数组（Tauri deep-link 插件返回的格式）
                            if let Ok(url_list) = serde_json::from_str::<Vec<String>>(&urls) {
                                for url in url_list {
                                    if url.starts_with("lime://connect") {
                                        // 调用 handle_deep_link 命令
                                        if let Some(state) = app_handle_clone
                                            .try_state::<crate::commands::connect_cmd::ConnectStateWrapper>()
                                        {
                                            match crate::connect::parse_deep_link(&url) {
                                                Ok(payload) => {
                                                    // 查询中转商信息
                                                    let (relay_info, is_verified) = {
                                                        let state_guard = state.0.read().await;
                                                        if let Some(connect_state) = state_guard.as_ref() {
                                                            let info = connect_state.registry.get(&payload.relay);
                                                            let verified = info.is_some();
                                                            (info, verified)
                                                        } else {
                                                            (None, false)
                                                        }
                                                    };

                                                    let result = crate::commands::connect_cmd::DeepLinkResult {
                                                        payload,
                                                        relay_info,
                                                        is_verified,
                                                    };

                                                    // 发送事件到前端
                                                    if let Err(e) = app_handle_clone.emit("deep-link-connect", &result) {
                                                        tracing::error!("[Deep Link] 发送事件失败: {}", e);
                                                    }
                                                }
                                                Err(e) => {
                                                    tracing::error!("[Deep Link] 解析 URL 失败: {:?}", e);
                                                    // 发送错误事件到前端
                                                    let _ = app_handle_clone.emit("deep-link-error", &format!("{e:?}"));
                                                }
                                            }
                                        }
                                    }
                                }
                            } else if urls.starts_with("lime://connect") {
                                // 直接处理单个 URL
                                if let Some(state) = app_handle_clone
                                    .try_state::<crate::commands::connect_cmd::ConnectStateWrapper>()
                                {
                                    match crate::connect::parse_deep_link(&urls) {
                                        Ok(payload) => {
                                            let (relay_info, is_verified) = {
                                                let state_guard = state.0.read().await;
                                                if let Some(connect_state) = state_guard.as_ref() {
                                                    let info = connect_state.registry.get(&payload.relay);
                                                    let verified = info.is_some();
                                                    (info, verified)
                                                } else {
                                                    (None, false)
                                                }
                                            };

                                            let result = crate::commands::connect_cmd::DeepLinkResult {
                                                payload,
                                                relay_info,
                                                is_verified,
                                            };

                                            if let Err(e) = app_handle_clone.emit("deep-link-connect", &result) {
                                                tracing::error!("[Deep Link] 发送事件失败: {}", e);
                                            }
                                        }
                                        Err(e) => {
                                            tracing::error!("[Deep Link] 解析 URL 失败: {:?}", e);
                                            let _ = app_handle_clone.emit("deep-link-error", &format!("{e:?}"));
                                        }
                                    }
                                }
                            }
                        });
                });
            }

            // 自动启动服务器
            let state = state_clone.clone();
            let logs = logs_clone.clone();
            let db = db_clone.clone();
            let pool_service = pool_service_clone.clone();
            let token_cache = token_cache_clone.clone();
            let shared_stats = shared_stats_clone.clone();
            let shared_tokens = shared_tokens_clone.clone();
            let shared_logger = shared_logger_clone.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut available_credentials = 0usize;
                let mut total_credentials = 0usize;

                // 先加载凭证池中的凭证
                {
                    logs.write().await.add("info", "[启动] 正在加载凭证池...");

                    // 获取凭证池概览信息
                    match pool_service.get_overview(&db) {
                        Ok(overview) => {
                            let mut loaded_types = Vec::new();
                            for provider_overview in overview {
                                let enabled_credentials: Vec<_> = provider_overview
                                    .credentials
                                    .iter()
                                    .filter(|credential| !credential.is_disabled)
                                    .collect();
                                let count = enabled_credentials.len();
                                if count > 0 {
                                    total_credentials += count;
                                    available_credentials += enabled_credentials
                                        .iter()
                                        .filter(|credential| credential.is_healthy)
                                        .count();
                                    let provider_name =
                                        match provider_overview.provider_type.as_str() {
                                            "kiro" => "Kiro",
                                            "gemini" => "Gemini",
                                            "antigravity" => "Antigravity",
                                            "openai" => "OpenAI",
                                            "claude" => "Claude",
                                            "codex" => "Codex",
                                            "claude_oauth" => "Claude OAuth",
                                            _ => &provider_overview.provider_type,
                                        };
                                    loaded_types.push(format!("{provider_name} ({count} 个)"));
                                }
                            }

                            if loaded_types.is_empty() {
                                logs.write().await.add("warn", "[启动] 未找到任何可用凭证");
                            } else {
                                let message = format!(
                                    "[启动] 凭证已加载: {} (共 {} 个)",
                                    loaded_types.join(", "),
                                    total_credentials
                                );
                                logs.write().await.add("info", &message);
                            }
                        }
                        Err(e) => {
                            logs.write()
                                .await
                                .add("warn", &format!("[启动] 获取凭证池信息失败: {e}"));
                        }
                    }

                    // 兼容性：仍然尝试加载旧的 Kiro 凭证（如果存在）
                    let mut s = state.write().await;
                    if let Err(e) = s.kiro_provider.load_credentials().await {
                        logs.write()
                            .await
                            .add("debug", &format!("[启动] 旧版 Kiro 凭证加载失败: {e}"));
                    }
                }
                // 启动服务器（使用共享的遥测实例）
                {
                    let mut s = state.write().await;
                    logs.write()
                        .await
                        .add("info", "[启动] 正在自动启动服务器...");
                    match s
                        .start_with_telemetry(
                            logs.clone(),
                            pool_service,
                            token_cache,
                            Some(db),
                            Some(shared_stats),
                            Some(shared_tokens),
                            Some(shared_logger),
                        )
                        .await
                    {
                        Ok(_) => {
                            // 使用 status() 获取实际使用的地址（可能已经自动切换到有效的 IP）
                            let status = s.status();
                            let host = status.host;
                            let port = status.port;
                            logs.write()
                                .await
                                .add("info", &format!("[启动] 服务器已启动: {host}:{port}"));
                        }
                        Err(e) => {
                            logs.write()
                                .await
                                .add("error", &format!("[启动] 服务器启动失败: {e}"));
                        }
                    }
                }

                // 更新托盘状态
                if let Some(tray_state) = app_handle.try_state::<TrayManagerState<tauri::Wry>>() {
                    let tray_guard = tray_state.0.read().await;
                    if let Some(tray_manager) = tray_guard.as_ref() {
                        let current_state = tray_manager.get_state().await;
                        let icon_status = if total_credentials == 0 || available_credentials == 0 {
                            TrayIconStatus::Error
                        } else if available_credentials < total_credentials {
                            TrayIconStatus::Warning
                        } else {
                            TrayIconStatus::Running
                        };

                        let snapshot = TrayStateSnapshot {
                            icon_status,
                            available_credentials,
                            total_credentials,
                            today_requests: current_state.today_requests,
                            auto_start_enabled: current_state.auto_start_enabled,
                            current_model_provider_type: current_state.current_model_provider_type,
                            current_model_provider_label: current_state
                                .current_model_provider_label,
                            current_model: current_state.current_model,
                            current_theme_label: current_state.current_theme_label,
                            quick_model_groups: current_state.quick_model_groups,
                        };

                        if let Err(e) = tray_manager.update_state(snapshot).await {
                            tracing::error!("[启动] 更新托盘状态失败: {}", e);
                        } else {
                            tracing::info!("[启动] 托盘状态已更新");
                        }
                    }
                }
            });

            // 启动后台更新检查任务
            let app_handle_for_update = app.handle().clone();
            let update_service_for_task = update_check_service_clone.clone();
            tauri::async_runtime::spawn(async move {
                crate::commands::update_cmd::start_background_update_check(
                    app_handle_for_update,
                    update_service_for_task,
                ).await;
            });
            tracing::info!("[启动] 后台更新检查任务已启动");

            // 启动会话文件清理任务（清理 30 天前的过期会话）
            tauri::async_runtime::spawn(async move {
                // 延迟 10 秒执行，避免影响启动性能
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

                match crate::session_files::SessionFileStorage::new() {
                    Ok(storage) => {
                        // 清理过期会话（30 天）
                        match storage.cleanup_expired(30) {
                            Ok(count) if count > 0 => {
                                tracing::info!("[启动] 已清理 {} 个过期会话", count);
                            }
                            Ok(_) => {
                                tracing::debug!("[启动] 无过期会话需要清理");
                            }
                            Err(e) => {
                                tracing::warn!("[启动] 清理过期会话失败: {}", e);
                            }
                        }
                        // 清理空会话
                        match storage.cleanup_empty() {
                            Ok(count) if count > 0 => {
                                tracing::info!("[启动] 已清理 {} 个空会话", count);
                            }
                            Ok(_) => {}
                            Err(e) => {
                                tracing::warn!("[启动] 清理空会话失败: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("[启动] 会话文件存储初始化失败: {}", e);
                    }
                }
            });

            // 初始化自动化调度服务（设置 AppHandle 并根据配置自动启动）
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // 组件监督器：自动化调度服务启动失败时自动重试
                    let max_retries = 3;
                    let mut retry_count = 0;
                    let mut retry_delay = tokio::time::Duration::from_secs(5);

                    loop {
                        if retry_count >= max_retries {
                            tracing::error!("[启动] 自动化调度服务启动重试次数已达上限，放弃启动");
                            break;
                        }

                        tokio::time::sleep(retry_delay).await;

                        if let Some(automation_state) = app_handle
                            .try_state::<crate::services::automation_service::AutomationServiceState>()
                        {
                            let mut service = automation_state.0.write().await;
                            service.set_app_handle(app_handle.clone());

                            if service.get_config().enabled {
                                let self_ref = automation_state.0.clone();
                                match service.start(self_ref).await {
                                    Ok(()) => {
                                        tracing::info!("[启动] 自动化调度服务已自动启动（尝试 {}/{}）", retry_count + 1, max_retries);
                                        break;
                                    }
                                    Err(e) => {
                                        tracing::warn!("[启动] 自动化调度服务启动失败（尝试 {}/{}）: {}", retry_count + 1, max_retries, e);
                                        retry_count += 1;
                                        retry_delay = retry_delay.saturating_mul(2);
                                    }
                                }
                            } else {
                                tracing::info!("[启动] 自动化调度服务已禁用，跳过启动");
                                break;
                            }
                        } else {
                            tracing::error!("[启动] 无法获取 AutomationServiceState");
                            break;
                        }
                    }
                });
            }

            // 启动 Gateway Tunnel 守护（managed 模式自动拉起并持续保活）
            {
                let tunnel_state = gateway_tunnel_state_for_setup.clone();
                let config_manager = global_config_manager_for_setup.clone();
                let logs = tunnel_logs_clone.clone();
                tauri::async_runtime::spawn(async move {
                    let mut round: u64 = 0;
                    loop {
                        let config = config_manager.config();
                        if !config.gateway.tunnel.enabled {
                            round = 0;
                            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                            continue;
                        }

                        let mode = config.gateway.tunnel.mode.trim().to_ascii_lowercase();
                        if mode == "managed" {
                            match lime_gateway::tunnel::status_tunnel_with_config(
                                &tunnel_state,
                                Some(config.clone()),
                            )
                            .await
                            {
                                Ok(status) => {
                                    if status.running {
                                        if round == 0 {
                                            logs.write().await.add(
                                                "info",
                                                &format!(
                                                    "[GatewayTunnel] managed 隧道运行中: pid={:?} local={} public={:?}",
                                                    status.pid, status.local_url, status.public_base_url
                                                ),
                                            );
                                        }
                                    } else if lime_gateway::tunnel::is_manual_stop_error(
                                        status.last_error.as_deref(),
                                    ) {
                                        if round.is_multiple_of(6) {
                                            logs.write().await.add(
                                                "info",
                                                "[GatewayTunnel] managed 隧道处于手动停止状态，守护器不自动拉起",
                                            );
                                        }
                                    } else {
                                        logs.write().await.add(
                                            "warn",
                                            &format!(
                                                "[GatewayTunnel] managed 隧道未运行，守护器尝试拉起: last_exit={:?} last_error={:?}",
                                                status.last_exit, status.last_error
                                            ),
                                        );
                                        if let Err(e) = lime_gateway::tunnel::start_tunnel(
                                            &tunnel_state,
                                            logs.clone(),
                                            config.clone(),
                                        )
                                        .await
                                        {
                                            logs.write().await.add(
                                                "warn",
                                                &format!("[GatewayTunnel] 守护拉起失败: {e}"),
                                            );
                                        }
                                    }
                                }
                                Err(e) => {
                                    logs.write()
                                        .await
                                        .add("warn", &format!("[GatewayTunnel] 守护状态检查失败: {e}"));
                                }
                            }
                        } else if mode == "external" && round.is_multiple_of(6) {
                            match lime_gateway::tunnel::status_tunnel_with_config(
                                &tunnel_state,
                                Some(config),
                            )
                            .await
                            {
                                Ok(status) => {
                                    logs.write().await.add(
                                        "info",
                                        &format!(
                                            "[GatewayTunnel] external 模式诊断: active={:?} detail={:?}",
                                            status.connector_active, status.connector_message
                                        ),
                                    );
                                }
                                Err(e) => {
                                    logs.write().await.add(
                                        "warn",
                                        &format!("[GatewayTunnel] external 模式诊断失败: {e}"),
                                    );
                                }
                            }
                        }

                        round = round.saturating_add(1);
                        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Server commands (from app::commands)
            app_commands::get_server_diagnostics,
            // Config commands (from app::commands)
            app_commands::get_config,
            app_commands::save_config,
            app_commands::get_environment_preview,
            app_commands::get_default_provider,
            app_commands::set_default_provider,
            app_commands::get_endpoint_providers,
            app_commands::set_endpoint_provider,
            app_commands::update_provider_env_vars,
            // Unified OAuth commands (new)
            commands::oauth_cmd::get_oauth_credentials,
            commands::oauth_cmd::reload_oauth_credentials,
            commands::oauth_cmd::refresh_oauth_token,
            commands::oauth_cmd::get_oauth_env_variables,
            commands::oauth_cmd::get_oauth_token_file_hash,
            commands::oauth_cmd::check_and_reload_oauth_credentials,
            commands::oauth_cmd::get_all_oauth_credentials,
            // Legacy Kiro commands (from app::commands, deprecated)
            app_commands::refresh_kiro_token,
            app_commands::reload_credentials,
            app_commands::get_kiro_credentials,
            app_commands::get_env_variables,
            app_commands::get_token_file_hash,
            app_commands::check_and_reload_credentials,
            // Legacy Gemini commands (from app::commands, deprecated)
            app_commands::get_gemini_credentials,
            app_commands::reload_gemini_credentials,
            app_commands::refresh_gemini_token,
            app_commands::get_gemini_env_variables,
            app_commands::get_gemini_token_file_hash,
            app_commands::check_and_reload_gemini_credentials,
            // OpenAI Custom commands (from app::commands)
            app_commands::get_openai_custom_status,
            app_commands::set_openai_custom_config,
            // Claude Custom commands (from app::commands)
            app_commands::get_claude_custom_status,
            app_commands::set_claude_custom_config,
            // Log commands (from app::commands)
            app_commands::get_logs,
            app_commands::get_persisted_logs_tail,
            app_commands::get_log_storage_diagnostics,
            app_commands::export_support_bundle,
            app_commands::clear_logs,
            app_commands::clear_diagnostic_log_history,
            app_commands::report_frontend_crash,
            app_commands::report_frontend_debug_log,
            // API test commands (from app::commands)
            app_commands::get_available_models,
            app_commands::check_api_compatibility,
            // Switch commands
            commands::switch_cmd::get_switch_providers,
            commands::switch_cmd::get_current_switch_provider,
            commands::switch_cmd::add_switch_provider,
            commands::switch_cmd::update_switch_provider,
            commands::switch_cmd::delete_switch_provider,
            commands::switch_cmd::switch_provider,
            commands::switch_cmd::import_default_config,
            commands::switch_cmd::read_live_provider_settings,
            commands::switch_cmd::check_config_sync_status,
            commands::switch_cmd::sync_from_external_config,
            // Config commands
            commands::config_cmd::get_config_status,
            commands::config_cmd::get_config_dir_path,
            commands::config_cmd::open_config_folder,
            commands::config_cmd::get_tool_versions,
            commands::config_cmd::get_auto_launch_status,
            commands::config_cmd::set_auto_launch,
            // Config import/export commands
            commands::config_cmd::export_config,
            commands::config_cmd::validate_config_yaml,
            commands::config_cmd::import_config,
            commands::config_cmd::get_config_paths,
            // Enhanced export/import commands (using ExportService/ImportService)
            commands::config_cmd::export_bundle,
            commands::config_cmd::export_config_yaml,
            commands::config_cmd::validate_import,
            commands::config_cmd::import_bundle,
            // Path utility commands
            commands::config_cmd::expand_path,
            commands::config_cmd::open_auth_dir,
            // OpenClaw commands
            commands::openclaw_cmd::openclaw_check_installed,
            commands::openclaw_cmd::openclaw_get_environment_status,
            commands::openclaw_cmd::openclaw_check_node_version,
            commands::openclaw_cmd::openclaw_check_git_available,
            commands::openclaw_cmd::openclaw_get_node_download_url,
            commands::claw_solution_cmd::claw_solution_list,
            commands::claw_solution_cmd::claw_solution_detail,
            commands::claw_solution_cmd::claw_solution_check_readiness,
            commands::claw_solution_cmd::claw_solution_prepare,
            commands::openclaw_cmd::openclaw_get_git_download_url,
            commands::openclaw_cmd::openclaw_get_command_preview,
            commands::openclaw_cmd::openclaw_get_progress_logs,
            commands::openclaw_cmd::openclaw_list_runtime_candidates,
            commands::openclaw_cmd::openclaw_install,
            commands::openclaw_cmd::openclaw_install_dependency,
            commands::openclaw_cmd::openclaw_check_update,
            commands::openclaw_cmd::openclaw_uninstall,
            commands::openclaw_cmd::openclaw_perform_update,
            commands::openclaw_cmd::openclaw_set_preferred_runtime,
            commands::openclaw_cmd::openclaw_cleanup_temp_artifacts,
            commands::openclaw_cmd::openclaw_start_gateway,
            commands::openclaw_cmd::openclaw_stop_gateway,
            commands::openclaw_cmd::openclaw_restart_gateway,
            commands::openclaw_cmd::openclaw_get_status,
            commands::openclaw_cmd::openclaw_check_health,
            commands::openclaw_cmd::openclaw_get_dashboard_url,
            commands::openclaw_cmd::openclaw_get_channels,
            commands::openclaw_cmd::openclaw_sync_provider_config,
            commands::openclaw_cmd::openclaw_install_event,
            // MCP commands
            commands::mcp_cmd::get_mcp_servers,
            commands::mcp_cmd::add_mcp_server,
            commands::mcp_cmd::update_mcp_server,
            commands::mcp_cmd::delete_mcp_server,
            commands::mcp_cmd::toggle_mcp_server,
            commands::mcp_cmd::import_mcp_from_app,
            commands::mcp_cmd::sync_all_mcp_to_live,
            // MCP 生命周期管理命令
            commands::mcp_cmd::mcp_list_servers_with_status,
            commands::mcp_cmd::mcp_start_server,
            commands::mcp_cmd::mcp_stop_server,
            // MCP 工具管理命令
            commands::mcp_cmd::mcp_list_tools,
            commands::mcp_cmd::mcp_list_tools_for_context,
            commands::mcp_cmd::mcp_search_tools,
            commands::mcp_cmd::mcp_call_tool,
            commands::mcp_cmd::mcp_call_tool_with_caller,
            // MCP 提示词管理命令
            commands::mcp_cmd::mcp_list_prompts,
            commands::mcp_cmd::mcp_get_prompt,
            // MCP 资源管理命令
            commands::mcp_cmd::mcp_list_resources,
            commands::mcp_cmd::mcp_read_resource,
            // Channel commands
            commands::channels_cmd::get_ai_channels,
            commands::channels_cmd::get_ai_channel,
            commands::channels_cmd::create_ai_channel,
            commands::channels_cmd::update_ai_channel,
            commands::channels_cmd::delete_ai_channel,
            commands::channels_cmd::test_ai_channel,
            commands::channels_cmd::get_notification_channels,
            commands::channels_cmd::get_notification_channel,
            commands::channels_cmd::create_notification_channel,
            commands::channels_cmd::update_notification_channel,
            commands::channels_cmd::delete_notification_channel,
            commands::channels_cmd::test_notification_channel,
            // Prompt commands
            commands::prompt_cmd::get_prompts,
            commands::prompt_cmd::upsert_prompt,
            commands::prompt_cmd::add_prompt,
            commands::prompt_cmd::update_prompt,
            commands::prompt_cmd::delete_prompt,
            commands::prompt_cmd::enable_prompt,
            commands::prompt_cmd::import_prompt_from_file,
            commands::prompt_cmd::get_current_prompt_file_content,
            commands::prompt_cmd::auto_import_prompt,
            // Skill commands
            commands::skill_cmd::get_skills,
            commands::skill_cmd::get_skills_for_app,
            commands::skill_cmd::get_local_skills_for_app,
            commands::skill_cmd::install_skill,
            commands::skill_cmd::install_skill_for_app,
            commands::skill_cmd::uninstall_skill,
            commands::skill_cmd::uninstall_skill_for_app,
            commands::skill_cmd::get_skill_repos,
            commands::skill_cmd::add_skill_repo,
            commands::skill_cmd::remove_skill_repo,
            commands::skill_cmd::refresh_skill_cache,
            commands::skill_cmd::get_installed_lime_skills,
            commands::skill_cmd::inspect_local_skill_for_app,
            commands::skill_cmd::create_skill_scaffold_for_app,
            commands::skill_cmd::import_local_skill_for_app,
            commands::skill_cmd::inspect_remote_skill,
            // Skill Execution commands
            commands::skill_exec_cmd::execute_skill,
            commands::skill_exec_cmd::list_executable_skills,
            commands::skill_exec_cmd::get_skill_detail,
            // Execution run commands
            commands::execution_run_cmd::execution_run_list,
            commands::execution_run_cmd::execution_run_get,
            commands::execution_run_cmd::execution_run_get_theme_workbench_state,
            commands::execution_run_cmd::execution_run_list_theme_workbench_history,
            // Ecommerce Review Reply commands
            commands::ecommerce_review_reply_cmd::execute_ecommerce_review_reply,
            // Provider Pool commands
            commands::provider_pool_cmd::get_provider_pool_overview,
            commands::provider_pool_cmd::get_provider_pool_credentials,
            commands::provider_pool_cmd::add_provider_pool_credential,
            commands::provider_pool_cmd::update_provider_pool_credential,
            commands::provider_pool_cmd::delete_provider_pool_credential,
            commands::provider_pool_cmd::toggle_provider_pool_credential,
            commands::provider_pool_cmd::reset_provider_pool_credential,
            commands::provider_pool_cmd::reset_provider_pool_health,
            commands::provider_pool_cmd::check_provider_pool_credential_health,
            commands::provider_pool_cmd::check_provider_pool_type_health,
            commands::provider_pool_cmd::add_kiro_oauth_credential,
            commands::provider_pool_cmd::add_kiro_from_json,
            commands::provider_pool_cmd::add_gemini_oauth_credential,
            commands::provider_pool_cmd::add_antigravity_oauth_credential,
            commands::provider_pool_cmd::add_openai_key_credential,
            commands::provider_pool_cmd::add_claude_key_credential,
            commands::provider_pool_cmd::add_gemini_api_key_credential,
            commands::provider_pool_cmd::add_codex_oauth_credential,
            commands::provider_pool_cmd::add_claude_oauth_credential,
            commands::provider_pool_cmd::refresh_pool_credential_token,
            commands::provider_pool_cmd::get_pool_credential_oauth_status,
            commands::provider_pool_cmd::debug_kiro_credentials,
            commands::provider_pool_cmd::test_user_credentials,
            commands::provider_pool_cmd::migrate_private_config_to_pool,
            commands::provider_pool_cmd::start_antigravity_oauth_login,
            commands::provider_pool_cmd::get_antigravity_auth_url_and_wait,
            commands::provider_pool_cmd::get_codex_auth_url_and_wait,
            commands::provider_pool_cmd::start_codex_oauth_login,
            commands::provider_pool_cmd::get_claude_oauth_auth_url_and_wait,
            commands::provider_pool_cmd::start_claude_oauth_login,
            commands::provider_pool_cmd::exchange_claude_oauth_code,
            commands::provider_pool_cmd::claude_oauth_with_cookie,
            commands::provider_pool_cmd::get_gemini_auth_url_and_wait,
            commands::provider_pool_cmd::start_gemini_oauth_login,
            commands::provider_pool_cmd::exchange_gemini_code,
            commands::provider_pool_cmd::get_kiro_credential_fingerprint,
            commands::provider_pool_cmd::get_credential_health,
            commands::provider_pool_cmd::get_all_credential_health,
            // Kiro Builder ID 登录命令
            commands::provider_pool_cmd::start_kiro_builder_id_login,
            commands::provider_pool_cmd::poll_kiro_builder_id_auth,
            commands::provider_pool_cmd::cancel_kiro_builder_id_login,
            commands::provider_pool_cmd::add_kiro_from_builder_id_auth,
            // Kiro Social Auth 登录命令 (Google/GitHub)
            commands::provider_pool_cmd::start_kiro_social_auth_login,
            commands::provider_pool_cmd::exchange_kiro_social_auth_token,
            commands::provider_pool_cmd::cancel_kiro_social_auth_login,
            commands::provider_pool_cmd::start_kiro_social_auth_callback_server,
            // Playwright 指纹浏览器登录命令
            commands::provider_pool_cmd::check_playwright_available,
            commands::provider_pool_cmd::install_playwright,
            commands::provider_pool_cmd::start_kiro_playwright_login,
            commands::provider_pool_cmd::cancel_kiro_playwright_login,
            commands::browser_runtime_cmd::open_browser_runtime_debugger_window,
            commands::browser_runtime_cmd::close_browser_runtime_debugger_window,
            commands::browser_runtime_cmd::launch_browser_session,
            commands::browser_runtime_cmd::launch_browser_runtime_assist,
            commands::site_capability_cmd::site_list_adapters,
            commands::site_capability_cmd::site_recommend_adapters,
            commands::site_capability_cmd::site_search_adapters,
            commands::site_capability_cmd::site_get_adapter_info,
            commands::site_capability_cmd::site_get_adapter_launch_readiness,
            commands::site_capability_cmd::site_get_adapter_catalog_status,
            commands::site_capability_cmd::site_apply_adapter_catalog_bootstrap,
            commands::site_capability_cmd::site_clear_adapter_catalog_cache,
            commands::site_capability_cmd::site_import_adapter_yaml_bundle,
            commands::site_capability_cmd::site_run_adapter,
            commands::site_capability_cmd::site_debug_run_adapter,
            commands::site_capability_cmd::site_save_adapter_result,
            // API Key Provider commands
            commands::api_key_provider_cmd::get_system_provider_catalog,
            commands::api_key_provider_cmd::get_api_key_providers,
            commands::api_key_provider_cmd::get_api_key_provider,
            commands::api_key_provider_cmd::add_custom_api_key_provider,
            commands::api_key_provider_cmd::update_api_key_provider,
            commands::api_key_provider_cmd::delete_custom_api_key_provider,
            commands::api_key_provider_cmd::add_api_key,
            commands::api_key_provider_cmd::delete_api_key,
            commands::api_key_provider_cmd::toggle_api_key,
            commands::api_key_provider_cmd::update_api_key_alias,
            commands::api_key_provider_cmd::get_next_api_key,
            commands::api_key_provider_cmd::record_api_key_usage,
            commands::api_key_provider_cmd::record_api_key_error,
            commands::api_key_provider_cmd::get_provider_ui_state,
            commands::api_key_provider_cmd::set_provider_ui_state,
            commands::api_key_provider_cmd::update_provider_sort_orders,
            commands::api_key_provider_cmd::export_api_key_providers,
            commands::api_key_provider_cmd::import_api_key_providers,
            // API Key Provider connection test command
            commands::api_key_provider_cmd::test_api_key_provider_connection,
            commands::api_key_provider_cmd::test_api_key_provider_chat,
            // Resilience config commands
            commands::resilience_cmd::get_retry_config,
            commands::resilience_cmd::update_retry_config,
            commands::resilience_cmd::get_failover_config,
            commands::resilience_cmd::update_failover_config,
            commands::resilience_cmd::get_switch_log,
            commands::resilience_cmd::clear_switch_log,
            // Telemetry commands
            commands::telemetry_cmd::get_request_logs,
            commands::telemetry_cmd::get_request_log_detail,
            commands::telemetry_cmd::clear_request_logs,
            commands::telemetry_cmd::get_stats_summary,
            commands::telemetry_cmd::get_stats_by_provider,
            commands::telemetry_cmd::get_stats_by_model,
            commands::telemetry_cmd::get_token_summary,
            commands::telemetry_cmd::get_token_stats_by_provider,
            commands::telemetry_cmd::get_token_stats_by_model,
            commands::telemetry_cmd::get_token_stats_by_day,
            // Injection commands
            commands::injection_cmd::get_injection_config,
            commands::injection_cmd::set_injection_enabled,
            commands::injection_cmd::get_injection_rules,
            commands::injection_cmd::add_injection_rule,
            commands::injection_cmd::remove_injection_rule,
            commands::injection_cmd::update_injection_rule,
            // Security & Performance commands
            commands::security_perf_cmd::get_rate_limit_config,
            commands::security_perf_cmd::update_rate_limit_config,
            commands::security_perf_cmd::get_conversation_config,
            commands::security_perf_cmd::update_conversation_config,
            commands::security_perf_cmd::get_hint_routes,
            commands::security_perf_cmd::update_hint_routes,
            commands::security_perf_cmd::get_pairing_config,
            commands::security_perf_cmd::update_pairing_config,
            // Usage commands
            commands::usage_cmd::get_kiro_usage,
            // Tray commands
            commands::tray_cmd::sync_tray_model_shortcuts,
            // Plugin commands
            commands::plugin_cmd::get_plugin_status,
            commands::plugin_cmd::get_plugins,
            commands::plugin_cmd::get_plugin_info,
            commands::plugin_cmd::enable_plugin,
            commands::plugin_cmd::disable_plugin,
            commands::plugin_cmd::update_plugin_config,
            commands::plugin_cmd::get_plugin_config,
            commands::plugin_cmd::reload_plugins,
            commands::plugin_cmd::unload_plugin,
            commands::plugin_cmd::get_plugins_dir,
            commands::plugin_cmd::list_plugin_tasks,
            commands::plugin_cmd::get_plugin_task,
            commands::plugin_cmd::cancel_plugin_task,
            commands::plugin_cmd::get_plugin_queue_stats,
            // Plugin Install commands
            commands::plugin_install_cmd::install_plugin_from_file,
            commands::plugin_install_cmd::install_plugin_from_url,
            commands::plugin_install_cmd::uninstall_plugin,
            commands::plugin_install_cmd::list_installed_plugins,
            commands::plugin_install_cmd::get_installed_plugin,
            commands::plugin_install_cmd::is_plugin_installed,
            // Plugin UI commands
            commands::plugin_cmd::get_plugins_with_ui,
            commands::plugin_cmd::get_plugin_ui,
            commands::plugin_cmd::handle_plugin_action,
            commands::plugin_cmd::read_plugin_manifest_cmd,
            commands::plugin_cmd::launch_plugin_ui,
            commands::plugin_cmd::frontend_debug_log,
            // Plugin RPC commands
            commands::plugin_rpc_cmd::plugin_rpc_connect,
            commands::plugin_rpc_cmd::plugin_rpc_disconnect,
            commands::plugin_rpc_cmd::plugin_rpc_call,
            // Window control commands
            commands::window_cmd::get_window_size,
            commands::window_cmd::set_window_size,
            commands::window_cmd::center_window,
            commands::window_cmd::toggle_fullscreen,
            commands::window_cmd::is_fullscreen,
            // Auto fix commands
            commands::auto_fix_cmd::auto_fix_configuration,
            // Machine ID commands
            commands::machine_id_cmd::get_current_machine_id,
            commands::machine_id_cmd::set_machine_id,
            commands::machine_id_cmd::generate_random_machine_id,
            commands::machine_id_cmd::validate_machine_id,
            commands::machine_id_cmd::check_admin_privileges,
            commands::machine_id_cmd::get_os_type,
            commands::machine_id_cmd::backup_machine_id_to_file,
            commands::machine_id_cmd::restore_machine_id_from_file,
            commands::machine_id_cmd::format_machine_id,
            commands::machine_id_cmd::detect_machine_id_format,
            commands::machine_id_cmd::convert_machine_id_format,
            commands::machine_id_cmd::get_machine_id_history,
            commands::machine_id_cmd::clear_machine_id_override,
            commands::machine_id_cmd::copy_machine_id_to_clipboard,
            commands::machine_id_cmd::paste_machine_id_from_clipboard,
            commands::machine_id_cmd::get_system_info,
            commands::windows_startup_cmd::get_windows_startup_diagnostics,
            // Kiro Local commands
            commands::kiro_local::switch_kiro_to_local,
            commands::kiro_local::get_kiro_fingerprint_info,
            commands::kiro_local::get_local_kiro_credential_uuid,
            // Agent commands
            commands::agent_cmd::agent_start_process,
            commands::agent_cmd::agent_stop_process,
            commands::agent_cmd::agent_get_process_status,
            commands::agent_cmd::agent_generate_title,
            // Aster Agent commands
            commands::aster_agent_cmd::command_api::provider_api::aster_agent_init,
            commands::aster_agent_cmd::command_api::provider_api::aster_agent_status,
            commands::aster_agent_cmd::command_api::provider_api::aster_agent_reset,
            commands::aster_agent_cmd::command_api::provider_api::aster_agent_configure_provider,
            commands::aster_agent_cmd::command_api::provider_api::aster_agent_configure_from_pool,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_submit_turn,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_interrupt_turn,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_compact_session,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_resume_thread,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_promote_queued_turn,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_remove_queued_turn,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_replay_request,
            commands::aster_agent_cmd::command_api::session_api::agent_runtime_create_session,
            commands::aster_agent_cmd::command_api::session_api::agent_runtime_list_sessions,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_get_session,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_get_thread_read,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_export_analysis_handoff,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_export_handoff_bundle,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_export_evidence_pack,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_export_review_decision_template,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_save_review_decision,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_export_replay_case,
            commands::aster_agent_cmd::command_api::runtime_api::agent_runtime_get_tool_inventory,
            commands::aster_agent_cmd::command_api::subagent_api::agent_runtime_spawn_subagent,
            commands::aster_agent_cmd::command_api::subagent_api::agent_runtime_send_subagent_input,
            commands::aster_agent_cmd::command_api::subagent_api::agent_runtime_wait_subagents,
            commands::aster_agent_cmd::command_api::subagent_api::agent_runtime_resume_subagent,
            commands::aster_agent_cmd::command_api::subagent_api::agent_runtime_close_subagent,
            commands::aster_agent_cmd::command_api::session_api::agent_runtime_update_session,
            commands::aster_agent_cmd::action_runtime::agent_runtime_delete_session,
            commands::aster_agent_cmd::action_runtime::agent_runtime_respond_action,
            commands::aster_agent_cmd::tool_runtime::social_tools::social_generate_cover_image_cmd,
            commands::theme_context_cmd::aster_agent_theme_context_search,
            // Models config commands
            commands::models_cmd::get_models_config,
            commands::models_cmd::save_models_config,
            commands::models_cmd::get_provider_models,
            commands::models_cmd::get_all_provider_models,
            commands::models_cmd::add_model_to_provider,
            commands::models_cmd::remove_model_from_provider,
            commands::models_cmd::toggle_model_enabled,
            commands::models_cmd::add_provider,
            commands::models_cmd::remove_provider,
            // Orchestrator commands
            commands::orchestrator_cmd::init_orchestrator,
            commands::orchestrator_cmd::get_orchestrator_config,
            commands::orchestrator_cmd::update_orchestrator_config,
            commands::orchestrator_cmd::get_pool_stats,
            commands::orchestrator_cmd::get_tier_models,
            commands::orchestrator_cmd::get_all_models,
            commands::orchestrator_cmd::update_orchestrator_credentials,
            commands::orchestrator_cmd::add_orchestrator_credential,
            commands::orchestrator_cmd::remove_orchestrator_credential,
            commands::orchestrator_cmd::mark_credential_unhealthy,
            commands::orchestrator_cmd::mark_credential_healthy,
            commands::orchestrator_cmd::update_credential_load,
            commands::orchestrator_cmd::select_model,
            commands::orchestrator_cmd::quick_select_model,
            commands::orchestrator_cmd::select_model_for_task,
            commands::orchestrator_cmd::list_strategies,
            commands::orchestrator_cmd::list_service_tiers,
            commands::orchestrator_cmd::list_task_hints,
            // Connect commands
            // _Requirements: 1.4, 2.3, 4.1, 5.3_
            commands::connect_cmd::handle_deep_link,
            commands::connect_cmd::get_relay_info,
            commands::connect_cmd::save_relay_api_key,
            commands::connect_cmd::refresh_relay_registry,
            commands::connect_cmd::list_relay_providers,
            commands::connect_cmd::send_connect_callback,
            // Model Registry commands
            commands::model_registry_cmd::get_model_registry,
            commands::model_registry_cmd::get_model_registry_provider_ids,
            commands::model_registry_cmd::refresh_model_registry,
            commands::model_registry_cmd::get_model_host_alias_user_file_info,
            commands::model_registry_cmd::ensure_model_host_alias_user_file,
            commands::model_registry_cmd::search_models,
            commands::model_registry_cmd::get_model_preferences,
            commands::model_registry_cmd::toggle_model_favorite,
            commands::model_registry_cmd::hide_model,
            commands::model_registry_cmd::record_model_usage,
            commands::model_registry_cmd::get_model_sync_state,
            commands::model_registry_cmd::get_models_for_provider,
            commands::model_registry_cmd::get_models_by_tier,
            commands::model_registry_cmd::get_provider_alias_config,
            commands::model_registry_cmd::get_all_alias_configs,
            commands::model_registry_cmd::fetch_provider_models_from_api,
            commands::model_registry_cmd::fetch_provider_models_auto,
            // Model Management commands (动态模型列表)
            commands::model_cmd::get_credential_models,
            commands::model_cmd::refresh_credential_models,
            commands::model_cmd::get_all_models_by_provider,
            commands::model_cmd::get_all_available_models,
            commands::model_cmd::refresh_all_credential_models,
            commands::model_cmd::get_default_models_for_provider,
            // Terminal commands
            commands::terminal_cmd::terminal_create_session,
            commands::terminal_cmd::terminal_write,
            commands::terminal_cmd::terminal_resize,
            commands::terminal_cmd::terminal_close,
            commands::terminal_cmd::terminal_list_sessions,
            commands::terminal_cmd::terminal_get_session,
            // SubAgent commands
            commands::subagent_cmd::init_subagent_scheduler,
            commands::subagent_cmd::execute_subagent_tasks,
            commands::subagent_cmd::cancel_subagent_tasks,
            // Connection commands
            commands::connection_cmd::connection_list,
            commands::connection_cmd::connection_add,
            commands::connection_cmd::connection_update,
            commands::connection_cmd::connection_delete,
            commands::connection_cmd::connection_get,
            commands::connection_cmd::connection_get_config_path,
            commands::connection_cmd::connection_get_raw_config,
            commands::connection_cmd::connection_save_raw_config,
            commands::connection_cmd::connection_test,
            commands::connection_cmd::connection_import_ssh_host,
            // WebSocket commands
            commands::websocket_cmd::get_websocket_status,
            commands::websocket_cmd::get_websocket_connections,
            commands::websocket_cmd::set_websocket_enabled,
            // Browser environment preset commands
            commands::browser_environment_cmd::list_browser_environment_presets_cmd,
            commands::browser_environment_cmd::save_browser_environment_preset_cmd,
            commands::browser_environment_cmd::archive_browser_environment_preset_cmd,
            commands::browser_environment_cmd::restore_browser_environment_preset_cmd,
            // Browser connector commands
            commands::browser_connector_cmd::get_browser_connector_settings_cmd,
            commands::browser_connector_cmd::set_browser_connector_install_root_cmd,
            commands::browser_connector_cmd::set_browser_connector_enabled_cmd,
            commands::browser_connector_cmd::set_system_connector_enabled_cmd,
            commands::browser_connector_cmd::set_browser_action_capability_enabled_cmd,
            commands::browser_connector_cmd::get_browser_connector_install_status_cmd,
            commands::browser_connector_cmd::install_browser_connector_extension_cmd,
            commands::browser_connector_cmd::open_browser_extensions_page_cmd,
            commands::browser_connector_cmd::open_browser_remote_debugging_page_cmd,
            // Browser profile commands
            commands::browser_profile_cmd::list_browser_profiles_cmd,
            commands::browser_profile_cmd::save_browser_profile_cmd,
            commands::browser_profile_cmd::archive_browser_profile_cmd,
            commands::browser_profile_cmd::restore_browser_profile_cmd,
            commands::browser_profile_cmd::launch_browser_profile_runtime_assist_cmd,
            // Sysinfo commands
            crate::services::sysinfo_service::get_sysinfo,
            crate::services::sysinfo_service::subscribe_sysinfo,
            crate::services::sysinfo_service::unsubscribe_sysinfo,
            // File browser commands
            crate::services::file_browser_service::list_dir,
            crate::services::file_browser_service::read_file_preview_cmd,
            crate::services::file_browser_service::get_home_dir,
            crate::services::file_browser_service::create_file,
            crate::services::file_browser_service::create_directory,
            crate::services::file_browser_service::delete_file,
            crate::services::file_browser_service::rename_file,
            crate::services::file_browser_service::get_file_name,
            crate::services::file_browser_service::reveal_in_finder,
            crate::services::file_browser_service::open_with_default_app,
            // Webview commands
            commands::webview_cmd::create_webview_panel,
            commands::webview_cmd::close_webview_panel,
            commands::webview_cmd::navigate_webview_panel,
            commands::webview_cmd::resize_webview_panel,
            commands::webview_cmd::get_webview_panels,
            commands::webview_cmd::focus_webview_panel,
            commands::webview_cmd::open_chrome_profile_window,
            commands::webview_cmd::get_chrome_profile_sessions,
            commands::webview_cmd::close_chrome_profile_session,
            commands::webview_cmd::get_chrome_bridge_endpoint_info,
            commands::webview_cmd::get_chrome_bridge_status,
            commands::webview_cmd::disconnect_browser_connector_session,
            commands::webview_cmd::chrome_bridge_execute_command,
            commands::webview_cmd::get_browser_backends_status,
            commands::webview_cmd::get_browser_backend_policy,
            commands::webview_cmd::set_browser_backend_policy,
            commands::webview_cmd::list_cdp_targets,
            commands::webview_cmd::open_cdp_session,
            commands::webview_cmd::close_cdp_session,
            commands::webview_cmd::start_browser_stream,
            commands::webview_cmd::stop_browser_stream,
            commands::webview_cmd::get_browser_session_state,
            commands::webview_cmd::take_over_browser_session,
            commands::webview_cmd::release_browser_session,
            commands::webview_cmd::resume_browser_session,
            commands::webview_cmd::get_browser_event_buffer,
            commands::webview_cmd::browser_execute_action,
            commands::webview_cmd::get_browser_action_audit_logs,
            // Screenshot Chat commands
            // _Requirements: 1.1, 1.4, 1.5, 2.2, 2.4, 3.1, 5.1_
            commands::screenshot_cmd::get_experimental_config,
            commands::screenshot_cmd::get_screenshot_shortcut_runtime_status,
            commands::screenshot_cmd::save_experimental_config,
            commands::screenshot_cmd::start_screenshot,
            commands::screenshot_cmd::validate_shortcut,
            commands::screenshot_cmd::update_screenshot_shortcut,
            commands::screenshot_cmd::close_screenshot_chat_window,
            commands::screenshot_cmd::open_input_with_text,
            commands::screenshot_cmd::read_image_as_base64,
            commands::screenshot_cmd::send_screenshot_chat,
            // Update Check commands
            commands::update_cmd::check_update,
            commands::update_cmd::check_for_updates,
            commands::update_cmd::download_update,
            commands::update_cmd::get_update_check_settings,
            commands::update_cmd::set_update_check_settings,
            commands::update_cmd::get_update_notification_metrics,
            commands::update_cmd::record_update_notification_action,
            commands::update_cmd::skip_update_version,
            commands::update_cmd::remind_update_later,
            commands::update_cmd::dismiss_update_notification,
            commands::update_cmd::update_last_check_timestamp,
            commands::update_cmd::close_update_window,
            commands::update_cmd::test_update_window,
            // Music commands
            commands::music_cmd::check_python_env,
            commands::music_cmd::analyze_midi,
            commands::music_cmd::convert_mp3_to_midi,
            commands::music_cmd::load_music_resource,
            commands::music_cmd::install_python_dependencies,
            // Session Files commands
            commands::session_files_cmd::session_files_create,
            commands::session_files_cmd::session_files_exists,
            commands::session_files_cmd::session_files_get_or_create,
            commands::session_files_cmd::session_files_delete,
            commands::session_files_cmd::session_files_list,
            commands::session_files_cmd::session_files_get_detail,
            commands::session_files_cmd::session_files_update_meta,
            commands::session_files_cmd::session_files_save_file,
            commands::session_files_cmd::session_files_read_file,
            commands::session_files_cmd::session_files_resolve_file_path,
            commands::session_files_cmd::session_files_delete_file,
            commands::session_files_cmd::session_files_list_files,
            commands::session_files_cmd::session_files_cleanup_expired,
            commands::session_files_cmd::session_files_cleanup_empty,
            // Image Upload commands
            commands::image_upload_cmd::upload_image_to_session,
            commands::image_upload_cmd::read_image_from_session,
            // Document Import commands
            commands::document_import_cmd::import_document,
            commands::document_import_cmd::import_document_to_session,
            commands::document_import_cmd::save_exported_document,
            // Workspace commands
            commands::workspace_cmd::workspace_create,
            commands::workspace_cmd::workspace_list,
            commands::workspace_cmd::workspace_get,
            commands::workspace_cmd::workspace_update,
            commands::workspace_cmd::workspace_delete,
            commands::workspace_cmd::workspace_set_default,
            commands::workspace_cmd::workspace_get_default,
            commands::workspace_cmd::workspace_ensure_ready,
            commands::workspace_cmd::workspace_ensure_default_ready,
            commands::workspace_cmd::workspace_get_by_path,
            commands::workspace_cmd::workspace_get_projects_root,
            commands::workspace_cmd::workspace_resolve_project_path,
            commands::workspace_cmd::get_or_create_default_project,
            commands::workspace_cmd::get_project_context,
            commands::workspace_cmd::build_project_system_prompt,
            // Persona commands
            commands::persona_cmd::create_persona,
            commands::persona_cmd::list_personas,
            commands::persona_cmd::get_persona,
            commands::persona_cmd::update_persona,
            commands::persona_cmd::delete_persona,
            commands::persona_cmd::set_default_persona,
            commands::persona_cmd::list_persona_templates,
            commands::persona_cmd::get_default_persona,
            commands::persona_cmd::generate_persona,
            // Material commands
            commands::material_cmd::upload_material,
            commands::material_cmd::import_material_from_url,
            commands::material_cmd::list_materials,
            commands::material_cmd::get_material,
            commands::material_cmd::update_material,
            commands::material_cmd::delete_material,
            commands::material_cmd::get_material_content,
            commands::material_cmd::get_material_count,
            commands::material_cmd::get_materials_content,
            // Image search commands
            commands::image_search_cmd::search_pixabay_images,
            commands::image_search_cmd::search_web_images,
            // Video generation commands
            commands::video_generation_cmd::create_video_generation_task,
            commands::video_generation_cmd::get_video_generation_task,
            commands::video_generation_cmd::list_video_generation_tasks,
            commands::video_generation_cmd::cancel_video_generation_task,
            // Poster Material commands
            commands::poster_material_cmd::create_poster_metadata,
            commands::poster_material_cmd::get_poster_metadata,
            commands::poster_material_cmd::get_poster_material,
            commands::poster_material_cmd::list_by_image_category,
            commands::poster_material_cmd::list_by_layout_category,
            commands::poster_material_cmd::list_by_mood,
            commands::poster_material_cmd::update_poster_metadata,
            commands::poster_material_cmd::delete_poster_metadata,
            // A2UI Form commands
            commands::a2ui_form_cmd::create_a2ui_form,
            commands::a2ui_form_cmd::get_a2ui_form,
            commands::a2ui_form_cmd::get_a2ui_forms_by_message,
            commands::a2ui_form_cmd::get_a2ui_forms_by_session,
            commands::a2ui_form_cmd::save_a2ui_form_data,
            commands::a2ui_form_cmd::submit_a2ui_form,
            commands::a2ui_form_cmd::delete_a2ui_form,
            // Content commands
            commands::content_cmd::content_create,
            commands::content_cmd::content_get,
            commands::content_cmd::content_get_theme_workbench_document_state,
            commands::content_cmd::content_list,
            commands::content_cmd::content_update,
            commands::content_cmd::content_delete,
            commands::content_cmd::content_reorder,
            commands::content_cmd::content_stats,
            // Novel Orchestrator commands
            commands::novel_cmd::novel_create_project,
            commands::novel_cmd::novel_update_settings,
            commands::novel_cmd::novel_generate_outline,
            commands::novel_cmd::novel_generate_characters,
            commands::novel_cmd::novel_generate_chapter,
            commands::novel_cmd::novel_continue_chapter,
            commands::novel_cmd::novel_rewrite_chapter,
            commands::novel_cmd::novel_polish_chapter,
            commands::novel_cmd::novel_check_consistency,
            commands::novel_cmd::novel_get_project_snapshot,
            commands::novel_cmd::novel_list_runs,
            commands::novel_cmd::novel_delete_character,
            // Memory commands (Character, WorldBuilding, Outline)
            commands::memory_cmd::character_create,
            commands::memory_cmd::character_get,
            commands::memory_cmd::character_list,
            commands::memory_cmd::character_update,
            commands::memory_cmd::character_delete,
            commands::memory_cmd::world_building_get,
            commands::memory_cmd::world_building_update,
            commands::memory_cmd::outline_node_create,
            commands::memory_cmd::outline_node_get,
            commands::memory_cmd::outline_node_list,
            commands::memory_cmd::outline_node_update,
            commands::memory_cmd::outline_node_delete,
            commands::memory_cmd::project_memory_get,
            // Usage Stats commands
            commands::usage_stats_cmd::get_usage_stats,
            commands::usage_stats_cmd::get_model_usage_ranking,
            commands::usage_stats_cmd::get_daily_usage_trends,
            // Memory Management commands
            commands::memory_management_cmd::memory_runtime_get_stats,
            commands::memory_management_cmd::memory_runtime_get_overview,
            commands::memory_management_cmd::memory_runtime_request_analysis,
            commands::memory_management_cmd::memory_runtime_cleanup,
            commands::memory_management_cmd::memory_get_effective_sources,
            commands::memory_management_cmd::memory_get_auto_index,
            commands::memory_management_cmd::memory_toggle_auto,
            commands::memory_management_cmd::memory_update_auto_note,
            commands::memory_management_cmd::memory_scaffold_runtime_agents_template,
            commands::memory_management_cmd::memory_ensure_workspace_local_agents_gitignore,
            // Unified Memory commands
            commands::unified_memory_cmd::unified_memory_list,
            commands::unified_memory_cmd::unified_memory_get,
            commands::unified_memory_cmd::unified_memory_create,
            commands::unified_memory_cmd::unified_memory_update,
            commands::unified_memory_cmd::unified_memory_delete,
            commands::unified_memory_cmd::unified_memory_search,
            commands::unified_memory_cmd::unified_memory_stats,
            commands::unified_memory_cmd::unified_memory_analyze,
            commands::memory_search_cmd::unified_memory_semantic_search,
            commands::memory_search_cmd::unified_memory_hybrid_search,
            commands::memory_feedback_cmd::unified_memory_feedback,
            commands::memory_feedback_cmd::get_memory_feedback_stats,
            // Voice Test commands
            commands::voice_test_cmd::test_tts,
            commands::voice_test_cmd::get_available_voices,
            // File Upload commands
            commands::file_upload_cmd::upload_avatar,
            commands::file_upload_cmd::delete_avatar,
            // ASR commands
            commands::asr_cmd::get_asr_credentials,
            commands::asr_cmd::add_asr_credential,
            commands::asr_cmd::update_asr_credential,
            commands::asr_cmd::delete_asr_credential,
            commands::asr_cmd::set_default_asr_credential,
            commands::asr_cmd::test_asr_credential,
            // External Tools commands (Codex CLI 等外部工具)
            commands::external_tools_cmd::check_codex_cli_status,
            commands::external_tools_cmd::open_codex_cli_login,
            commands::external_tools_cmd::open_codex_cli_logout,
            commands::external_tools_cmd::get_external_tools,
            // Voice Input commands
            crate::voice::commands::get_voice_input_config,
            crate::voice::commands::get_voice_shortcut_runtime_status,
            crate::voice::commands::save_voice_input_config,
            crate::voice::commands::get_voice_instructions,
            crate::voice::commands::save_voice_instruction,
            crate::voice::commands::delete_voice_instruction,
            crate::voice::commands::open_voice_window,
            crate::voice::commands::close_voice_window,
            crate::voice::commands::transcribe_audio,
            crate::voice::commands::polish_voice_text,
            crate::voice::commands::output_voice_text,
            // 录音命令（使用独立线程 + channel 通信）
            crate::voice::commands::start_recording,
            crate::voice::commands::stop_recording,
            crate::voice::commands::cancel_recording,
            crate::voice::commands::get_recording_status,
            crate::voice::commands::list_audio_devices,
            // Automation commands
            commands::automation_cmd::get_automation_scheduler_config,
            commands::automation_cmd::update_automation_scheduler_config,
            commands::automation_cmd::get_automation_status,
            commands::automation_cmd::get_automation_jobs,
            commands::automation_cmd::get_automation_job,
            commands::automation_cmd::create_automation_job,
            commands::automation_cmd::update_automation_job,
            commands::automation_cmd::delete_automation_job,
            commands::automation_cmd::run_automation_job_now,
            commands::automation_cmd::get_automation_health,
            commands::automation_cmd::get_automation_run_history,
            commands::automation_cmd::preview_automation_schedule,
            commands::automation_cmd::validate_automation_schedule,
            // Telegram 远程触发命令
            commands::gateway_channel_cmd::gateway_channel_start,
            commands::gateway_channel_cmd::gateway_channel_stop,
            commands::gateway_channel_cmd::gateway_channel_status,
            commands::gateway_channel_cmd::telegram_channel_probe,
            commands::gateway_channel_cmd::feishu_channel_probe,
            commands::gateway_channel_cmd::discord_channel_probe,
            commands::gateway_channel_cmd::wechat_channel_probe,
            commands::wechat_channel_cmd::wechat_channel_login_start,
            commands::wechat_channel_cmd::wechat_channel_login_wait,
            commands::wechat_channel_cmd::wechat_channel_list_accounts,
            commands::wechat_channel_cmd::wechat_channel_remove_account,
            commands::wechat_channel_cmd::wechat_channel_set_runtime_model,
            commands::gateway_tunnel_cmd::gateway_tunnel_probe,
            commands::gateway_tunnel_cmd::gateway_tunnel_detect_cloudflared,
            commands::gateway_tunnel_cmd::gateway_tunnel_install_cloudflared,
            commands::gateway_tunnel_cmd::gateway_tunnel_create,
            commands::gateway_tunnel_cmd::gateway_tunnel_start,
            commands::gateway_tunnel_cmd::gateway_tunnel_stop,
            commands::gateway_tunnel_cmd::gateway_tunnel_restart,
            commands::gateway_tunnel_cmd::gateway_tunnel_status,
            commands::gateway_tunnel_cmd::gateway_tunnel_sync_webhook_url,
            commands::telegram_remote_cmd::start_telegram_remote,
            commands::telegram_remote_cmd::stop_telegram_remote,
            commands::telegram_remote_cmd::get_telegram_remote_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::should_minimize_to_tray;

    #[test]
    fn should_only_minimize_main_window_to_tray() {
        assert!(should_minimize_to_tray("main", true));
        assert!(!should_minimize_to_tray("openclaw-dashboard", true));
        assert!(!should_minimize_to_tray("main", false));
    }
}
