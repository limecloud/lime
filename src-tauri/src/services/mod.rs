//! 业务服务模块
//!
//! 核心业务逻辑已迁移到 proxycast-services crate。
//! 本模块保留 Tauri 相关服务。

// 保留在主 crate 的 Tauri 相关服务
pub mod auto_memory_service;
pub mod conversation_statistics_service;
pub mod environment_service;
pub mod execution_tracker_service;
pub mod file_browser_service;
pub mod heartbeat_service;
pub mod memory_import_parser_service;
pub mod memory_profile_prompt_service;
pub mod memory_rules_loader_service;
pub mod memory_source_resolver_service;
pub mod novel_service;
pub mod openclaw_service;
pub mod request_tool_policy_prompt_service;
pub mod sysinfo_service;
pub mod update_check_service;
pub mod update_window;
pub mod web_search_prompt_service;
pub mod web_search_runtime_service;
pub mod workspace_health_service;
