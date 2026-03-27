/**
 * 浏览器模式下优先走 mock 的命令集合。
 *
 * 这些命令要么依赖当前 DevBridge 尚未桥接的原生能力，
 * 要么即使缺少真实后端也不应阻塞默认页面渲染。
 */

const mockPriorityCommands = new Set<string>([
  "aster_agent_init",
  "agent_runtime_export_analysis_handoff",
  "agent_runtime_export_handoff_bundle",
  "agent_runtime_export_evidence_pack",
  "agent_runtime_export_review_decision_template",
  "agent_runtime_export_replay_case",
  "agent_runtime_get_tool_inventory",
  "connection_list",
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
  "execution_run_get_theme_workbench_state",
  "get_hint_routes",
  "content_workflow_get_by_content",
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
  "launch_browser_session",
  "launch_browser_profile_runtime_assist_cmd",
  "get_browser_action_audit_logs",
]);

export function shouldPreferMockInBrowser(cmd: string): boolean {
  return mockPriorityCommands.has(cmd);
}

export { mockPriorityCommands };
