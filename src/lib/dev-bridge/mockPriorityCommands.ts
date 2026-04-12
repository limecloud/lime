/**
 * 浏览器模式下优先走 mock 的命令集合。
 *
 * 这些命令要么依赖当前 DevBridge 尚未桥接的原生能力，
 * 要么即使缺少真实后端也不应阻塞默认页面渲染。
 */

const mockPriorityCommands = new Set<string>([
  "agent_runtime_export_analysis_handoff",
  "agent_runtime_export_handoff_bundle",
  "agent_runtime_export_evidence_pack",
  "agent_runtime_export_review_decision_template",
  "agent_runtime_save_review_decision",
  "agent_runtime_export_replay_case",
  "connection_list",
  "companion_get_pet_status",
  "companion_launch_pet",
  "companion_send_pet_command",
  "terminal_create_session",
  "list_dir",
  "get_plugin_status",
  "get_plugins",
  "list_installed_plugins",
  "list_plugin_tasks",
  "get_plugin_queue_stats",
  "subscribe_sysinfo",
  "unsubscribe_sysinfo",
  "session_files_get_or_create",
  "session_files_update_meta",
  "session_files_list_files",
  "session_files_save_file",
  "session_files_read_file",
  "session_files_delete_file",
  "save_exported_document",
  "execution_run_get_general_workbench_state",
  "get_hint_routes",
  "memory_runtime_get_working_memory",
  "memory_runtime_get_extraction_status",
  "memory_runtime_prefetch_for_turn",
  "openclaw_check_installed",
  "openclaw_get_environment_status",
  "openclaw_check_node_version",
  "openclaw_check_git_available",
  "openclaw_get_node_download_url",
  "openclaw_get_git_download_url",
  "openclaw_install",
  "openclaw_install_dependency",
  "openclaw_get_command_preview",
  "openclaw_uninstall",
  "openclaw_cleanup_temp_artifacts",
  "openclaw_start_gateway",
  "openclaw_stop_gateway",
  "openclaw_restart_gateway",
  "openclaw_get_status",
  "openclaw_check_health",
  "openclaw_get_dashboard_url",
  "openclaw_get_channels",
  "openclaw_get_progress_logs",
  "openclaw_sync_provider_config",
  "close_webview_panel",
  "get_webview_panels",
  "focus_webview_panel",
  "navigate_webview_panel",
  "get_browser_connector_settings_cmd",
  "set_browser_connector_install_root_cmd",
  "set_browser_connector_enabled_cmd",
  "set_system_connector_enabled_cmd",
  "set_browser_action_capability_enabled_cmd",
  "get_browser_connector_install_status_cmd",
  "install_browser_connector_extension_cmd",
  "open_browser_extensions_page_cmd",
  "open_browser_remote_debugging_page_cmd",
  "disconnect_browser_connector_session",
  "launch_browser_session",
  "launch_browser_profile_runtime_assist_cmd",
  "get_browser_action_audit_logs",
]);

/**
 * 浏览器模式下必须以桥接后端为真相源的命令集合。
 *
 * 这些命令一旦桥接失败，就必须直接暴露错误；
 * 不能再静默回退到 mock，把“后端未连上 / 命令失败”伪装成“只是没有数据”。
 */
const bridgeTruthCommands = new Set<string>([
  "aster_agent_init",
  "aster_agent_status",
  "get_default_provider",
  "get_provider_pool_overview",
  "get_api_key_providers",
  "get_model_registry",
  "get_model_registry_provider_ids",
  "get_models_for_provider",
  "get_models_by_tier",
  "get_provider_alias_config",
  "get_all_alias_configs",
  "refresh_model_registry",
  "fetch_provider_models_auto",
]);

export function shouldPreferMockInBrowser(cmd: string): boolean {
  return mockPriorityCommands.has(cmd);
}

export function shouldDisallowMockFallbackInBrowser(cmd: string): boolean {
  return bridgeTruthCommands.has(cmd);
}
