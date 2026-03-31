//! 业务服务模块
//!
//! 核心业务逻辑已迁移到 lime-services crate。
//! 本模块保留 Tauri 相关服务。

// 保留在主 crate 的 Tauri 相关服务
pub mod agent_timeline_service;
pub mod artifact_diff_service;
pub mod artifact_document_service;
pub mod artifact_document_validator;
pub mod artifact_ops_service;
pub mod artifact_output_schema_service;
pub mod artifact_prompt_service;
pub mod artifact_request_metadata_service;
pub mod auto_memory_service;
pub mod automation_service;
pub mod browser_connector_service;
pub mod browser_environment_service;
pub mod browser_profile_service;
pub mod browser_runtime_window;
pub mod chat_history_service;
pub mod claw_solution_service;
pub mod conversation_statistics_service;
pub mod environment_service;
pub mod execution_tracker_service;
pub mod file_browser_service;
pub mod memory_import_parser_service;
pub mod memory_profile_prompt_service;
pub mod memory_rules_loader_service;
pub mod memory_source_resolver_service;
pub mod openclaw_service;
pub mod runtime_agents_template_service;
pub mod runtime_analysis_handoff_service;
pub mod runtime_evidence_pack_service;
pub mod runtime_handoff_artifact_service;
pub mod runtime_replay_case_service;
pub mod runtime_review_decision_service;
pub mod site_adapter_import_service;
pub mod site_adapter_registry;
pub mod site_capability_service;
pub mod sysinfo_service;
pub mod thread_reliability_projection_service;
pub mod update_check_service;
pub mod update_window;
pub mod web_search_prompt_service;
pub mod web_search_runtime_service;
pub mod workspace_health_service;
