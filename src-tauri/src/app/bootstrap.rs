//! 应用启动引导模块
//!
//! 包含配置验证、状态初始化等启动逻辑。

use std::sync::Arc;
use tokio::sync::RwLock;

use crate::agent::{initialize_aster_runtime, AsterAgentState};
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::commands::connect_cmd::ConnectStateWrapper;
use crate::commands::context_memory::ContextMemoryServiceState;
use crate::commands::machine_id_cmd::MachineIdState;
use crate::commands::model_registry_cmd::ModelRegistryState;
use crate::commands::plugin_cmd::PluginManagerState;
use crate::commands::plugin_install_cmd::PluginInstallerState;
use crate::commands::session_files_cmd::SessionFilesState;
use crate::commands::skill_cmd::SkillServiceState;
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
use lime_core::config::{Config, ConfigManager};
use lime_scheduler::AgentScheduler;
use lime_server as server;
use lime_services::api_key_provider_service::ApiKeyProviderService;
use lime_services::context_memory_service::{ContextMemoryConfig, ContextMemoryService};
use lime_services::skill_service::SkillService;
use lime_services::update_check_service::UpdateCheckServiceState;

use super::types::{AppState, LogState};

pub use lime_core::app_bootstrap::{load_and_validate_config, ConfigError};

/// 应用状态集合
pub struct AppStates {
    pub state: AppState,
    pub logs: LogState,
    pub db: DbConnection,
    pub skill_service: SkillServiceState,
    pub api_key_provider_service: ApiKeyProviderServiceState,
    pub machine_id_service: MachineIdState,
    pub plugin_manager: PluginManagerState,
    pub plugin_installer: PluginInstallerState,
    pub plugin_rpc_manager: crate::commands::plugin_rpc_cmd::PluginRpcManagerState,
    pub telemetry: crate::commands::telemetry_cmd::TelemetryState,
    pub aster_agent: AsterAgentState,
    pub connect_state: ConnectStateWrapper,
    pub model_registry: ModelRegistryState,
    pub global_config_manager: GlobalConfigManagerState,
    pub webview_manager: WebviewManagerWrapper,
    pub chrome_profile_manager: ChromeProfileManagerWrapper,
    pub update_check_service: UpdateCheckServiceState,
    pub session_files: SessionFilesState,
    pub context_memory_service: ContextMemoryServiceState,
    pub recording_service: RecordingServiceState,
    pub mcp_manager: McpManagerState,
    pub automation_service: AutomationServiceState,
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
    lime_core::tool_calling::apply_tool_calling_runtime_config(config);

    // 首次升级到 Lime 后，启动即自动迁移旧 ProxyCast 存储根的数据。
    lime_core::app_paths::migrate_legacy_install_data()
        .map_err(|e| format!("启动期历史数据迁移失败: {e}"))?;

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

    {
        let conn = database::lock_db(&db).map_err(|e| format!("Failed to lock database: {e}"))?;
        let seeded_profiles =
            crate::services::browser_profile_service::ensure_default_browser_profiles(&conn)
                .map_err(|error| format!("初始化默认浏览器资料失败: {error}"))?;
        let seeded_environment_presets = crate::services::browser_environment_service::ensure_default_browser_environment_presets(&conn)
            .map_err(|error| format!("初始化默认浏览器环境预设失败: {error}"))?;
        if seeded_profiles || seeded_environment_presets {
            tracing::info!(
                "[Bootstrap] 默认浏览器资源已就绪: profiles_seeded={}, presets_seeded={}",
                seeded_profiles,
                seeded_environment_presets
            );
        }
    }

    initialize_aster_runtime(db.clone()).map_err(|e| format!("Aster 运行时初始化失败: {e}"))?;

    // 服务状态
    let skill_service = SkillService::new().map_err(|e| format!("SkillService 初始化失败: {e}"))?;
    let skill_service_state = SkillServiceState(Arc::new(skill_service));

    let api_key_provider_service = ApiKeyProviderService::new();
    match api_key_provider_service.migrate_legacy_api_key_encryption(&db) {
        Ok(0) => {
            tracing::info!("[Bootstrap] API Key 加密格式无需迁移");
        }
        Ok(count) => {
            tracing::info!("[Bootstrap] 已自动迁移 {} 条旧版 API Key 加密数据", count);
        }
        Err(error) => {
            tracing::warn!(
                "[Bootstrap] API Key 加密迁移失败，继续使用兼容读取: {}",
                error
            );
        }
    }
    let api_key_provider_service_state =
        ApiKeyProviderServiceState(Arc::new(api_key_provider_service));

    let machine_id_service = lime_services::machine_id_service::MachineIdService::new()
        .map_err(|e| format!("MachineIdService 初始化失败: {e}"))?;
    let machine_id_service_state: MachineIdState = Arc::new(RwLock::new(machine_id_service));

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
    let aster_agent_state = AsterAgentState::new();

    // 初始化 Connect 状态（延迟初始化，在 setup hook 中完成）
    let connect_state = ConnectStateWrapper(Arc::new(RwLock::new(None)));

    // 初始化 Model Registry 状态（延迟初始化，在 setup hook 中完成）
    let model_registry_state: ModelRegistryState = Arc::new(RwLock::new(None));

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
    let context_memory_service_state = ContextMemoryServiceState(Arc::new(context_memory_service));

    // 录音服务（使用独立线程 + channel 通信解决 cpal::Stream 不是 Send 的问题）
    let recording_service_state = create_recording_service_state();

    // 初始化 MCP 客户端管理器（延迟设置 AppHandle，在 setup hook 中完成）
    let mcp_manager = crate::mcp::McpClientManager::new(None);
    let mcp_manager_state: McpManagerState = Arc::new(tokio::sync::Mutex::new(mcp_manager));

    // 初始化自动化调度服务
    let mut automation_service = AutomationService::new(config.automation.clone());
    automation_service.set_db(db.clone());
    let automation_status_state = automation_service.status_handle();
    let automation_service_state = AutomationServiceState(
        Arc::new(RwLock::new(automation_service)),
        automation_status_state,
    );

    Ok(AppStates {
        state,
        logs,
        db,
        skill_service: skill_service_state,
        api_key_provider_service: api_key_provider_service_state,
        machine_id_service: machine_id_service_state,
        plugin_manager: plugin_manager_state,
        plugin_installer: plugin_installer_state,
        plugin_rpc_manager: plugin_rpc_manager_state,
        telemetry: telemetry_state,
        aster_agent: aster_agent_state,
        connect_state,
        model_registry: model_registry_state,
        global_config_manager: global_config_manager_state,
        webview_manager: webview_manager_state,
        chrome_profile_manager: chrome_profile_manager_state,
        update_check_service: update_check_service_state,
        session_files: session_files_state,
        context_memory_service: context_memory_service_state,
        recording_service: recording_service_state,
        mcp_manager: mcp_manager_state,
        automation_service: automation_service_state,
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
    let plugins_dir = lime_core::app_paths::best_effort_runtime_subdir("plugins");
    let temp_dir = std::env::temp_dir().join("lime_plugin_install");

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
            let fallback_plugins_dir = std::env::temp_dir().join("lime_plugins_fallback");
            let fallback_temp_dir = std::env::temp_dir().join("lime_plugin_install_fallback");
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
