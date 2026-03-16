//! 应用启动引导模块
//!
//! 包含配置验证、状态初始化等启动逻辑。

use std::sync::Arc;
use tokio::sync::RwLock;

use crate::agent::AsterAgentState;
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::commands::connect_cmd::ConnectStateWrapper;
use crate::commands::context_memory::ContextMemoryServiceState;
use crate::commands::machine_id_cmd::MachineIdState;
use crate::commands::model_registry_cmd::ModelRegistryState;
use crate::commands::orchestrator_cmd::OrchestratorState;
use crate::commands::plugin_cmd::PluginManagerState;
use crate::commands::plugin_install_cmd::PluginInstallerState;
use crate::commands::provider_pool_cmd::{CredentialSyncServiceState, ProviderPoolServiceState};
use crate::commands::resilience_cmd::ResilienceConfigState;
use crate::commands::session_files_cmd::SessionFilesState;
use crate::commands::skill_cmd::SkillServiceState;
use crate::commands::terminal_cmd::TerminalManagerState;
use crate::commands::tool_hooks::ToolHooksServiceState;
use crate::commands::webview_cmd::{
    ChromeProfileManagerWrapper, WebviewManagerState, WebviewManagerWrapper,
};
use crate::config::{GlobalConfigManager, GlobalConfigManagerState};
use crate::database::{self, DbConnection};
use crate::logger;
use crate::mcp::McpManagerState;
use crate::plugin;
use crate::services::automation_service::{AutomationService, AutomationServiceState};
use crate::skills::ensure_default_local_skills;
use crate::telemetry;
use crate::voice::recording_service::{create_recording_service_state, RecordingServiceState};
use proxycast_core::config::{Config, ConfigManager};
use proxycast_scheduler::AgentScheduler;
use proxycast_server as server;
use proxycast_services::api_key_provider_service::ApiKeyProviderService;
use proxycast_services::aster_session_store::ProxyCastSessionStore;
use proxycast_services::context_memory_service::{ContextMemoryConfig, ContextMemoryService};
use proxycast_services::provider_pool_service::ProviderPoolService;
use proxycast_services::skill_service::SkillService;
use proxycast_services::token_cache_service::TokenCacheService;
use proxycast_services::tool_hooks_service::ToolHooksService;
use proxycast_services::update_check_service::UpdateCheckServiceState;

use super::types::{AppState, LogState, TokenCacheServiceState};

pub use proxycast_core::app_bootstrap::{load_and_validate_config, ConfigError};

/// 应用状态集合
pub struct AppStates {
    pub state: AppState,
    pub logs: LogState,
    pub db: DbConnection,
    pub skill_service: SkillServiceState,
    pub provider_pool_service: ProviderPoolServiceState,
    pub api_key_provider_service: ApiKeyProviderServiceState,
    pub credential_sync_service: CredentialSyncServiceState,
    pub token_cache_service: TokenCacheServiceState,
    pub machine_id_service: MachineIdState,
    pub resilience_config: ResilienceConfigState,
    pub plugin_manager: PluginManagerState,
    pub plugin_installer: PluginInstallerState,
    pub plugin_rpc_manager: crate::commands::plugin_rpc_cmd::PluginRpcManagerState,
    pub telemetry: crate::commands::telemetry_cmd::TelemetryState,
    pub aster_agent: AsterAgentState,
    pub orchestrator: OrchestratorState,
    pub connect_state: ConnectStateWrapper,
    pub model_registry: ModelRegistryState,
    pub global_config_manager: GlobalConfigManagerState,
    pub terminal_manager: TerminalManagerState,
    pub webview_manager: WebviewManagerWrapper,
    pub chrome_profile_manager: ChromeProfileManagerWrapper,
    pub update_check_service: UpdateCheckServiceState,
    pub session_files: SessionFilesState,
    pub context_memory_service: ContextMemoryServiceState,
    pub tool_hooks_service: ToolHooksServiceState,
    pub recording_service: RecordingServiceState,
    pub mcp_manager: McpManagerState,
    pub automation_service: AutomationServiceState,
    pub workflow_service: Arc<RwLock<proxycast_services::content_creator::WorkflowService>>,
    pub progress_store: Arc<RwLock<proxycast_services::content_creator::ProgressStore>>,
    // 用于 setup hook 的共享实例
    pub shared_stats: Arc<parking_lot::RwLock<telemetry::StatsAggregator>>,
    pub shared_tokens: Arc<parking_lot::RwLock<telemetry::TokenTracker>>,
    pub shared_logger: Arc<telemetry::RequestLogger>,
}

type TelemetryInit = (
    crate::commands::telemetry_cmd::TelemetryState,
    Arc<parking_lot::RwLock<telemetry::StatsAggregator>>,
    Arc<parking_lot::RwLock<telemetry::TokenTracker>>,
    Arc<telemetry::RequestLogger>,
);

/// 初始化所有应用状态
pub fn init_states(config: &Config) -> Result<AppStates, String> {
    // 将 Tool Calling 运行时开关与当前配置同步，避免依赖手工环境变量。
    proxycast_core::tool_calling::apply_tool_calling_runtime_config(config);

    // 核心状态
    let state: AppState = Arc::new(RwLock::new(server::ServerState::new(config.clone())));
    let logs: LogState = Arc::new(RwLock::new(logger::create_log_store_from_config(
        &config.logging,
    )));

    // 数据库
    let db = database::init_database().map_err(|e| format!("数据库初始化失败: {e}"))?;

    // Windows 特定：验证数据库可写性
    #[cfg(target_os = "windows")]
    {
        tracing::info!("[Bootstrap] Windows 平台 - 验证数据库文件权限");
        match db.lock() {
            Ok(conn) => {
                // 简单验证：尝试执行 PRAGMA
                if let Err(e) = conn.execute("PRAGMA user_version", []) {
                    tracing::warn!("[Bootstrap] Windows 数据库验证失败: {}", e);
                } else {
                    tracing::info!("[Bootstrap] Windows 数据库验证成功");
                }
            }
            Err(e) => {
                tracing::warn!("[Bootstrap] Windows 数据库锁获取失败: {}", e);
            }
        }
    }

    // 服务状态
    let skill_service = SkillService::new().map_err(|e| format!("SkillService 初始化失败: {e}"))?;
    let skill_service_state = SkillServiceState(Arc::new(skill_service));

    let provider_pool_service = ProviderPoolService::new();
    let provider_pool_service_state = ProviderPoolServiceState(Arc::new(provider_pool_service));

    let api_key_provider_service = ApiKeyProviderService::new();
    let api_key_provider_service_state =
        ApiKeyProviderServiceState(Arc::new(api_key_provider_service));

    let credential_sync_service_state = CredentialSyncServiceState(None);

    let token_cache_service = TokenCacheService::new();
    let token_cache_service_state = TokenCacheServiceState(Arc::new(token_cache_service));

    let machine_id_service = proxycast_services::machine_id_service::MachineIdService::new()
        .map_err(|e| format!("MachineIdService 初始化失败: {e}"))?;
    let machine_id_service_state: MachineIdState = Arc::new(RwLock::new(machine_id_service));

    let resilience_config_state = ResilienceConfigState::default();

    // 插件管理器
    let plugin_manager = plugin::PluginManager::with_defaults();
    let plugin_manager_state = PluginManagerState(Arc::new(RwLock::new(plugin_manager)));

    // 插件安装器
    let plugin_installer_state = init_plugin_installer()?;

    // 插件 RPC 管理器
    let plugin_rpc_manager_state = crate::commands::plugin_rpc_cmd::PluginRpcManagerState::new();

    // 遥测系统
    let (telemetry_state, shared_stats, shared_tokens, shared_logger) = init_telemetry(config)?;

    // 其他状态
    // 设置 Aster 全局 session store（使用 ProxyCast 数据库）
    let session_store = Arc::new(ProxyCastSessionStore::new(db.clone()));

    // 使用 tokio runtime 来设置全局 store
    // 使用 Builder 模式以获得更好的跨平台兼容性
    let rt = tokio::runtime::Handle::try_current().unwrap_or_else(|_| {
        // Windows: IOCP, macOS: kqueue, Linux: epoll/io-uring
        #[cfg(target_os = "windows")]
        tracing::info!("[Bootstrap] Windows 平台 - 创建 Tokio Runtime (IOCP)");

        #[cfg(target_os = "macos")]
        tracing::info!("[Bootstrap] macOS 平台 - 创建 Tokio Runtime (kqueue)");

        #[cfg(target_os = "linux")]
        tracing::info!("[Bootstrap] Linux 平台 - 创建 Tokio Runtime (epoll)");

        // 使用 Builder 模式获得更多控制，提高 Windows 兼容性
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2) // 限制线程数，避免 Windows 资源问题
            .thread_name("proxycast-runtime")
            .enable_io()
            .enable_time()
            .build()
            .expect("Failed to create tokio runtime: 系统资源不足或配置错误")
            .handle()
            .clone()
    });
    rt.block_on(async {
        if let Err(e) = aster::session::set_global_session_store(session_store).await {
            tracing::warn!(
                "[Bootstrap] 设置全局 session store 失败（可能已设置）: {}",
                e
            );
        } else {
            tracing::info!("[Bootstrap] 已设置 Aster 全局 session store");
        }
    });

    let aster_agent_state = AsterAgentState::new();
    let orchestrator_state = OrchestratorState::new();

    // 初始化 Connect 状态（延迟初始化，在 setup hook 中完成）
    let connect_state = ConnectStateWrapper(Arc::new(RwLock::new(None)));

    // 初始化 Model Registry 状态（延迟初始化，在 setup hook 中完成）
    let model_registry_state: ModelRegistryState = Arc::new(RwLock::new(None));

    // 初始化终端管理器状态（延迟初始化，在 setup hook 中完成）
    let terminal_manager_state = TerminalManagerState(Arc::new(RwLock::new(None)));

    // 初始化 Webview 管理器状态
    let webview_manager_state =
        WebviewManagerWrapper(Arc::new(RwLock::new(WebviewManagerState::new())));
    let chrome_profile_manager_state =
        ChromeProfileManagerWrapper(crate::commands::webview_cmd::shared_chrome_profile_manager());

    // 初始化更新检查服务
    let update_check_service_state = UpdateCheckServiceState::new();

    // 初始化会话文件存储
    let session_files_storage = crate::session_files::SessionFileStorage::new()
        .map_err(|e| format!("SessionFileStorage 初始化失败: {e}"))?;
    let session_files_state = SessionFilesState(std::sync::Mutex::new(session_files_storage));

    // 初始化全局配置管理器
    let config_path = ConfigManager::default_config_path();
    let global_config_manager = GlobalConfigManager::new(config.clone(), config_path);
    let global_config_manager_state = GlobalConfigManagerState::new(global_config_manager);

    // 初始化默认技能仓库
    {
        let conn = database::lock_db(&db).map_err(|e| format!("Failed to lock database: {e}"))?;
        database::dao::skills::SkillDao::init_default_skill_repos(&conn)
            .map_err(|e| format!("初始化默认技能仓库失败: {e}"))?;
    }
    match ensure_default_local_skills() {
        Ok(installed) if installed.is_empty() => {
            tracing::info!("[Bootstrap] 默认本地 Skills 已存在，跳过写入");
        }
        Ok(installed) => {
            tracing::info!(
                "[Bootstrap] 默认本地 Skills 安装完成: {}",
                installed.join(", ")
            );
        }
        Err(error) => {
            tracing::warn!("[Bootstrap] 安装默认本地 Skills 失败: {}", error);
        }
    }

    // 初始化调度器表，避免运行期健康检查出现缺表错误
    if let Err(error) = AgentScheduler::init_tables(&db) {
        tracing::error!("[Bootstrap] 调度器表初始化失败: {}", error);
    } else {
        tracing::info!("[Bootstrap] 调度器表初始化成功");
    }

    // 初始化上下文记忆服务
    let context_memory_config = build_context_memory_config(config);
    let context_memory_service = ContextMemoryService::new(context_memory_config)
        .map_err(|e| format!("ContextMemoryService 初始化失败: {e}"))?;
    let context_memory_service_arc = Arc::new(context_memory_service);
    let context_memory_service_state =
        ContextMemoryServiceState(context_memory_service_arc.clone());

    // 初始化工具钩子服务
    let tool_hooks_service = ToolHooksService::new(context_memory_service_arc.clone());
    let tool_hooks_service_state = ToolHooksServiceState(Arc::new(tool_hooks_service));

    // 录音服务（使用独立线程 + channel 通信解决 cpal::Stream 不是 Send 的问题）
    let recording_service_state = create_recording_service_state();

    // 初始化 MCP 客户端管理器（延迟设置 AppHandle，在 setup hook 中完成）
    let mcp_manager = crate::mcp::McpClientManager::new(None);
    let mcp_manager_state: McpManagerState = Arc::new(tokio::sync::Mutex::new(mcp_manager));

    // 初始化自动化调度服务
    let mut automation_service = AutomationService::new(config.automation.clone());
    automation_service.set_db(db.clone());
    let automation_service_state =
        AutomationServiceState(Arc::new(RwLock::new(automation_service)));

    // 初始化工作流服务
    let workflow_service = proxycast_services::content_creator::WorkflowService::new();
    let workflow_service_state = Arc::new(RwLock::new(workflow_service));

    // 初始化进度存储
    let db_path = database::get_db_path().map_err(|e| format!("获取数据库路径失败: {e}"))?;
    let progress_store = proxycast_services::content_creator::ProgressStore::new(db_path)
        .map_err(|e| format!("ProgressStore 初始化失败: {e}"))?;
    let progress_store_state = Arc::new(RwLock::new(progress_store));

    Ok(AppStates {
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
        context_memory_service: context_memory_service_state,
        tool_hooks_service: tool_hooks_service_state,
        recording_service: recording_service_state,
        mcp_manager: mcp_manager_state,
        automation_service: automation_service_state,
        workflow_service: workflow_service_state,
        progress_store: progress_store_state,
        shared_stats,
        shared_tokens,
        shared_logger,
    })
}

fn build_context_memory_config(config: &Config) -> ContextMemoryConfig {
    let mut context_config = ContextMemoryConfig::default();
    let memory_config = &config.memory;

    if let Some(max_entries) = memory_config.max_entries {
        context_config.max_entries_per_session = max_entries.clamp(1, 20_000) as usize;
    }

    if let Some(retention_days) = memory_config.retention_days {
        context_config.auto_archive_days = retention_days.clamp(1, 3650);
    }

    if let Some(auto_cleanup) = memory_config.auto_cleanup {
        context_config.auto_cleanup_enabled = auto_cleanup;
    }

    context_config
}

/// 初始化插件安装器
fn init_plugin_installer() -> Result<PluginInstallerState, String> {
    let db_path = database::get_db_path().map_err(|e| format!("获取数据库路径失败: {e}"))?;
    let plugins_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("proxycast")
        .join("plugins");
    let temp_dir = std::env::temp_dir().join("proxycast_plugin_install");

    let _ = std::fs::create_dir_all(&plugins_dir);
    let _ = std::fs::create_dir_all(&temp_dir);

    match plugin::installer::PluginInstaller::from_paths(
        plugins_dir.clone(),
        temp_dir.clone(),
        &db_path,
    ) {
        Ok(installer) => {
            tracing::info!("[启动] 插件安装器初始化成功");
            Ok(PluginInstallerState(Arc::new(RwLock::new(installer))))
        }
        Err(e) => {
            tracing::error!("[启动] 插件安装器初始化失败: {}", e);
            // 使用临时目录作为后备
            let fallback_plugins_dir = std::env::temp_dir().join("proxycast_plugins_fallback");
            let fallback_temp_dir = std::env::temp_dir().join("proxycast_plugin_install_fallback");
            let _ = std::fs::create_dir_all(&fallback_plugins_dir);
            let _ = std::fs::create_dir_all(&fallback_temp_dir);
            let installer = plugin::installer::PluginInstaller::from_paths(
                fallback_plugins_dir,
                fallback_temp_dir,
                &db_path,
            )
            .map_err(|e| format!("后备插件安装器初始化失败: {e}"))?;
            Ok(PluginInstallerState(Arc::new(RwLock::new(installer))))
        }
    }
}

/// 初始化遥测系统
fn init_telemetry(config: &Config) -> Result<TelemetryInit, String> {
    let shared_stats = Arc::new(parking_lot::RwLock::new(
        telemetry::StatsAggregator::with_defaults(),
    ));
    let shared_tokens = Arc::new(parking_lot::RwLock::new(
        telemetry::TokenTracker::with_defaults(),
    ));
    let log_rotation = telemetry::LogRotationConfig {
        max_memory_logs: 10000,
        retention_days: config.logging.retention_days,
        max_file_size: 10 * 1024 * 1024,
        enable_file_logging: config.logging.enabled,
    };
    let shared_logger = Arc::new(
        telemetry::RequestLogger::new(log_rotation)
            .map_err(|e| format!("RequestLogger 初始化失败: {e}"))?,
    );

    let telemetry_state = crate::commands::telemetry_cmd::TelemetryState::with_shared(
        shared_stats.clone(),
        shared_tokens.clone(),
        Some(shared_logger.clone()),
    )
    .map_err(|e| format!("TelemetryState 初始化失败: {e}"))?;

    Ok((telemetry_state, shared_stats, shared_tokens, shared_logger))
}
