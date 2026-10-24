//! Construct request futures separately from their async polling stack.

use super::super::{ConnectionRequestId, RequestProcessor, RpcDispatch};
use app_server_protocol::protocol::v2;
use app_server_protocol::*;
use futures::{future::ready, future::BoxFuture, FutureExt};
use serde_json::Value;

impl RequestProcessor {
    // Release branch-construction temporaries before polling the selected handler.
    #[inline(never)]
    pub(super) fn dispatch_request<'a>(
        &'a self,
        method: &str,
        params: Option<Value>,
        connection_request_id: Option<ConnectionRequestId>,
    ) -> BoxFuture<'a, Result<RpcDispatch, JsonRpcError>> {
        match method {
            v2::METHOD_ROLLOUT_COMPRESS => self.handle_rollout_compress().boxed(),
            v2::METHOD_ACCOUNT_LOGIN_START => self.handle_account_login_start(params).boxed(),
            v2::METHOD_CLOUD_REQUEST => self.handle_cloud_request(params).boxed(),
            v2::METHOD_ACCOUNT_READ => self.handle_account_read(params).boxed(),
            v2::METHOD_ACCOUNT_LOGOUT => self.handle_account_logout(params).boxed(),
            METHOD_INITIALIZE => self.handle_initialize(params).boxed(),
            METHOD_CAPABILITY_LIST => ready(self.handle_capability_list(params)).boxed(),
            METHOD_ARTIFACT_READ => ready(self.handle_artifact_read(params)).boxed(),
            app_server_protocol::protocol::v2::METHOD_ARTIFACT_WRITE => {
                self.handle_artifact_write_v2_impl(params).boxed()
            }
            v2::METHOD_FUZZY_FILE_SEARCH => self.handle_fuzzy_file_search_impl(params).boxed(),
            v2::METHOD_FS_READ_FILE => self.handle_fs_read_file_impl(params).boxed(),
            v2::METHOD_FS_WRITE_FILE => self.handle_fs_write_file_impl(params).boxed(),
            v2::METHOD_FS_CREATE_DIRECTORY => self.handle_fs_create_directory_impl(params).boxed(),
            v2::METHOD_FS_GET_METADATA => self.handle_fs_get_metadata_impl(params).boxed(),
            v2::METHOD_FS_READ_DIRECTORY => self.handle_fs_read_directory_impl(params).boxed(),
            v2::METHOD_FS_REMOVE => self.handle_fs_remove_impl(params).boxed(),
            v2::METHOD_FS_COPY => self.handle_fs_copy_impl(params).boxed(),
            v2::METHOD_FS_WATCH => self
                .handle_fs_watch_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_FS_UNWATCH => self
                .handle_fs_unwatch_impl(params, connection_request_id.clone())
                .boxed(),
            METHOD_STORAGE_READ => self.handle_storage_read(params, false).boxed(),
            METHOD_STORAGE_REFRESH => self.handle_storage_read(params, true).boxed(),
            METHOD_STORAGE_REVIEW => self.handle_storage_review(params).boxed(),
            METHOD_STORAGE_DELETE => self.handle_storage_delete(params).boxed(),
            v2::METHOD_PROCESS_SPAWN => self
                .handle_process_spawn_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_PROCESS_WRITE_STDIN => self
                .handle_process_write_stdin_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_PROCESS_RESIZE_PTY => self
                .handle_process_resize_pty_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_PROCESS_KILL => self
                .handle_process_kill_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_COMMAND_EXEC => self
                .handle_command_exec_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_COMMAND_EXEC_WRITE => self
                .handle_command_exec_write_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_COMMAND_EXEC_RESIZE => self
                .handle_command_exec_resize_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_COMMAND_EXEC_TERMINATE => self
                .handle_command_exec_terminate_impl(params, connection_request_id.clone())
                .boxed(),
            METHOD_AGENT_SESSION_HANDOFF_BUNDLE_EXPORT => {
                self.handle_handoff_bundle_export(params).boxed()
            }
            METHOD_AGENT_SESSION_REPLAY_CASE_EXPORT => {
                self.handle_replay_case_export(params).boxed()
            }
            METHOD_AGENT_SESSION_ANALYSIS_HANDOFF_EXPORT => {
                self.handle_analysis_handoff_export(params).boxed()
            }
            METHOD_AGENT_SESSION_REVIEW_DECISION_TEMPLATE_EXPORT => {
                self.handle_review_decision_template_export(params).boxed()
            }
            METHOD_AGENT_SESSION_REVIEW_DECISION_SAVE => {
                self.handle_review_decision_save(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_COMPACT_START => {
                self.handle_thread_compact_start_v2(params).boxed()
            }
            METHOD_THREAD_RESUME => self
                .handle_thread_resume_v2(params, connection_request_id.clone())
                .boxed(),
            app_server_protocol::protocol::v2::METHOD_THREAD_REVERT => {
                self.handle_thread_revert_v2(params).boxed()
            }
            METHOD_AGENT_SESSION_FILE_CHECKPOINT_LIST => {
                self.handle_file_checkpoint_list_impl(params).boxed()
            }
            METHOD_AGENT_SESSION_FILE_CHECKPOINT_GET => {
                self.handle_file_checkpoint_get_impl(params).boxed()
            }
            METHOD_AGENT_SESSION_FILE_CHECKPOINT_DIFF => {
                self.handle_file_checkpoint_diff_impl(params).boxed()
            }
            METHOD_AGENT_SESSION_FILE_CHECKPOINT_RESTORE => {
                self.handle_file_checkpoint_restore_impl(params).boxed()
            }
            METHOD_SESSION_FILE_GET_OR_CREATE => {
                self.handle_session_file_get_or_create_impl(params).boxed()
            }
            METHOD_SESSION_FILE_UPDATE_META => {
                self.handle_session_file_update_meta_impl(params).boxed()
            }
            METHOD_SESSION_FILE_SAVE => self.handle_session_file_save_impl(params).boxed(),
            METHOD_SESSION_FILE_READ => self.handle_session_file_read_impl(params).boxed(),
            METHOD_SESSION_FILE_RESOLVE_PATH => {
                self.handle_session_file_resolve_path_impl(params).boxed()
            }
            METHOD_SESSION_FILE_DELETE => self.handle_session_file_delete_impl(params).boxed(),
            METHOD_SESSION_FILE_LIST => self.handle_session_file_list_impl(params).boxed(),
            METHOD_THREAD_START => self
                .handle_thread_start_v2(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_THREAD_FORK => self.handle_thread_fork_v2(params).boxed(),
            METHOD_THREAD_READ => self.handle_thread_read_impl(params).boxed(),
            METHOD_THREAD_LIST => self.handle_thread_list_impl(params).boxed(),
            v2::METHOD_THREAD_SECTION_MOVE => self.handle_section_move(params).boxed(),
            v2::METHOD_THREAD_SECTION_LIST => self.handle_section_list(params).boxed(),
            v2::METHOD_THREAD_SECTION_CREATE => self.handle_section_create(params).boxed(),
            v2::METHOD_THREAD_SECTION_UPDATE => self.handle_section_update(params).boxed(),
            v2::METHOD_THREAD_SECTION_DELETE => self.handle_section_delete(params).boxed(),
            v2::METHOD_THREAD_LOADED_LIST => self.handle_thread_loaded_list_v2(params).boxed(),
            app_server_protocol::protocol::v2::METHOD_THREAD_UNSUBSCRIBE => self
                .handle_thread_unsubscribe_v2(params, connection_request_id)
                .boxed(),
            app_server_protocol::protocol::v2::METHOD_THREAD_INCREMENT_ELICITATION => {
                self.handle_thread_increment_elicitation_v2(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_DECREMENT_ELICITATION => {
                self.handle_thread_decrement_elicitation_v2(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_ARCHIVE => {
                self.handle_thread_archive_v2(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_DELETE => {
                self.handle_thread_delete_v2(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_UNARCHIVE => {
                self.handle_thread_unarchive_v2(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_NAME_SET => {
                self.handle_thread_name_set_v2(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_METADATA_UPDATE => {
                self.handle_thread_metadata_update_v2(params).boxed()
            }
            METHOD_THREAD_TURNS_LIST => self.handle_thread_turns_list_impl(params).boxed(),
            METHOD_THREAD_ITEMS_LIST => self.handle_thread_items_list_impl(params).boxed(),
            app_server_protocol::protocol::v2::METHOD_THREAD_INJECT_ITEMS => {
                self.handle_thread_inject_items_v2(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_SEARCH => {
                self.handle_thread_search_v2(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_SEARCH_OCCURRENCES => {
                self.handle_thread_search_occurrences_v2(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_SETTINGS_UPDATE => {
                self.handle_thread_settings_update_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_MEMORY_MODE_SET => {
                self.handle_thread_memory_mode_set_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_MEMORY_RESET => {
                self.handle_memory_reset_impl().boxed()
            }
            app_server_protocol::protocol::v2::METHOD_MEMORY_STATUS => {
                self.handle_memory_status_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_SHELL_COMMAND => {
                self.handle_thread_shell_command_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_APPROVE_GUARDIAN_DENIED_ACTION => self
                .handle_thread_approve_guardian_denied_action_v2(params)
                .boxed(),
            app_server_protocol::protocol::v2::METHOD_THREAD_BACKGROUND_TERMINALS_CLEAN => self
                .handle_thread_background_terminals_clean_v2(params)
                .boxed(),
            app_server_protocol::protocol::v2::METHOD_THREAD_BACKGROUND_TERMINALS_LIST => self
                .handle_thread_background_terminals_list_v2(params)
                .boxed(),
            app_server_protocol::protocol::v2::METHOD_THREAD_BACKGROUND_TERMINALS_TERMINATE => self
                .handle_thread_background_terminals_terminate_v2(params)
                .boxed(),
            app_server_protocol::protocol::v2::METHOD_THREAD_GOAL_SET => {
                self.handle_thread_goal_set(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_GOAL_GET => {
                self.handle_thread_goal_get(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_THREAD_GOAL_CLEAR => {
                self.handle_thread_goal_clear(params).boxed()
            }
            v2::METHOD_THREAD_QUEUE_LIST => self.handle_thread_queue_list_impl(params).boxed(),
            v2::METHOD_THREAD_QUEUE_UPDATE => self.handle_thread_queue_update_impl(params).boxed(),
            v2::METHOD_THREAD_QUEUE_DELETE => self.handle_thread_queue_delete_impl(params).boxed(),
            v2::METHOD_THREAD_QUEUE_REORDER => {
                self.handle_thread_queue_reorder_impl(params).boxed()
            }
            v2::METHOD_THREAD_QUEUE_START => self.handle_thread_queue_start_impl(params).boxed(),
            v2::METHOD_PROMPT_HISTORY_READ => self.handle_prompt_history_read_impl(params).boxed(),
            v2::METHOD_PROMPT_HISTORY_APPEND => {
                self.handle_prompt_history_append_impl(params).boxed()
            }
            v2::METHOD_PROJECT_LIST => self.handle_project_list_impl(params).boxed(),
            v2::METHOD_PROJECT_READ => self.handle_project_read_impl(params).boxed(),
            v2::METHOD_PROJECT_CREATE => self.handle_project_create_impl(params).boxed(),
            v2::METHOD_PROJECT_IMPORT => self.handle_project_import_impl(params).boxed(),
            v2::METHOD_PROJECT_UPDATE => self.handle_project_update_impl(params).boxed(),
            v2::METHOD_PROJECT_MOVE => self.handle_project_move_impl(params).boxed(),
            v2::METHOD_PROJECT_DELETE => self.handle_project_delete_impl(params).boxed(),
            METHOD_WORKFLOW_READ => self.handle_workflow_read_impl(params).boxed(),
            METHOD_WORKFLOW_CANCEL => self.handle_workflow_cancel_impl(params).boxed(),
            METHOD_WORKFLOW_RETRY => self.handle_workflow_retry_impl(params).boxed(),
            METHOD_WORKFLOW_RESPOND => self.handle_workflow_respond_impl(params).boxed(),
            METHOD_WORKSPACE_LIST => self.handle_workspace_list_impl().boxed(),
            METHOD_WORKSPACE_READ => self.handle_workspace_read_impl(params).boxed(),
            METHOD_WORKSPACE_UPDATE => self.handle_workspace_update_impl(params).boxed(),
            METHOD_WORKSPACE_DELETE => self.handle_workspace_delete_impl(params).boxed(),
            METHOD_WORKSPACE_ENSURE => self.handle_workspace_ensure_impl(params).boxed(),
            METHOD_WORKSPACE_BY_PATH_READ => {
                self.handle_workspace_by_path_read_impl(params).boxed()
            }
            METHOD_WORKSPACE_DEFAULT_READ => self.handle_workspace_default_read_impl().boxed(),
            METHOD_WORKSPACE_DEFAULT_ENSURE => self.handle_workspace_default_ensure_impl().boxed(),
            METHOD_WORKSPACE_PROJECTS_ROOT_READ => {
                self.handle_workspace_projects_root_read_impl().boxed()
            }
            METHOD_WORKSPACE_PROJECT_PATH_RESOLVE => self
                .handle_workspace_project_path_resolve_impl(params)
                .boxed(),
            METHOD_WORKSPACE_ENSURE_READY => {
                self.handle_workspace_ensure_ready_impl(params).boxed()
            }
            METHOD_GATEWAY_CHANNEL_START => self.handle_gateway_channel_start_impl(params).boxed(),
            METHOD_GATEWAY_CHANNEL_STOP => self.handle_gateway_channel_stop_impl(params).boxed(),
            METHOD_GATEWAY_CHANNEL_STATUS => {
                self.handle_gateway_channel_status_impl(params).boxed()
            }
            METHOD_GATEWAY_TUNNEL_PROBE => self.handle_gateway_tunnel_probe_impl().boxed(),
            METHOD_GATEWAY_TUNNEL_CLOUDFLARED_DETECT => {
                self.handle_gateway_tunnel_cloudflared_detect_impl().boxed()
            }
            METHOD_GATEWAY_TUNNEL_CLOUDFLARED_INSTALL => self
                .handle_gateway_tunnel_cloudflared_install_impl(params)
                .boxed(),
            METHOD_GATEWAY_TUNNEL_CREATE => self.handle_gateway_tunnel_create_impl(params).boxed(),
            METHOD_GATEWAY_TUNNEL_START => self.handle_gateway_tunnel_start_impl().boxed(),
            METHOD_GATEWAY_TUNNEL_STOP => self.handle_gateway_tunnel_stop_impl().boxed(),
            METHOD_GATEWAY_TUNNEL_RESTART => self.handle_gateway_tunnel_restart_impl().boxed(),
            METHOD_GATEWAY_TUNNEL_STATUS => self.handle_gateway_tunnel_status_impl().boxed(),
            METHOD_GATEWAY_TUNNEL_SYNC_WEBHOOK_URL => self
                .handle_gateway_tunnel_sync_webhook_url_impl(params)
                .boxed(),
            METHOD_TELEGRAM_CHANNEL_PROBE => self.handle_telegram_channel_probe(params).boxed(),
            METHOD_FEISHU_CHANNEL_PROBE => self.handle_feishu_channel_probe(params).boxed(),
            METHOD_DISCORD_CHANNEL_PROBE => self.handle_discord_channel_probe(params).boxed(),
            METHOD_WECHAT_CHANNEL_PROBE => self.handle_wechat_channel_probe_impl(params).boxed(),
            METHOD_WECHAT_CHANNEL_LOGIN_START => {
                self.handle_wechat_channel_login_start_impl(params).boxed()
            }
            METHOD_WECHAT_CHANNEL_LOGIN_WAIT => {
                self.handle_wechat_channel_login_wait_impl(params).boxed()
            }
            METHOD_WECHAT_CHANNEL_ACCOUNT_LIST => {
                self.handle_wechat_channel_account_list_impl().boxed()
            }
            METHOD_WECHAT_CHANNEL_ACCOUNT_REMOVE => self
                .handle_wechat_channel_account_remove_impl(params)
                .boxed(),
            METHOD_WECHAT_CHANNEL_RUNTIME_MODEL_SET => self
                .handle_wechat_channel_runtime_model_set_impl(params)
                .boxed(),
            METHOD_MEDIA_TASK_ARTIFACT_IMAGE_CREATE => self
                .handle_media_task_artifact_image_create_impl(params)
                .boxed(),
            METHOD_MEDIA_TASK_ARTIFACT_AUDIO_CREATE => self
                .handle_media_task_artifact_audio_create_impl(params)
                .boxed(),
            METHOD_MEDIA_TASK_ARTIFACT_TRANSCRIPTION_CREATE => self
                .handle_media_task_artifact_transcription_create_impl(params)
                .boxed(),
            METHOD_MEDIA_TASK_ARTIFACT_VIDEO_CREATE => self
                .handle_media_task_artifact_video_create_impl(params)
                .boxed(),
            METHOD_MEDIA_TASK_ARTIFACT_AUDIO_COMPLETE => self
                .handle_media_task_artifact_audio_complete_impl(params)
                .boxed(),
            METHOD_MEDIA_TASK_ARTIFACT_IMAGE_COMPLETE => self
                .handle_media_task_artifact_image_complete_impl(params)
                .boxed(),
            METHOD_MEDIA_TASK_ARTIFACT_GET => {
                self.handle_media_task_artifact_get_impl(params).boxed()
            }
            METHOD_MEDIA_TASK_ARTIFACT_LIST => {
                self.handle_media_task_artifact_list_impl(params).boxed()
            }
            METHOD_MEDIA_TASK_ARTIFACT_CANCEL => {
                self.handle_media_task_artifact_cancel_impl(params).boxed()
            }
            METHOD_VOICE_ASR_CREDENTIAL_LIST => {
                self.handle_voice_asr_credential_list_impl().boxed()
            }
            METHOD_VOICE_ASR_CREDENTIAL_CREATE => {
                self.handle_voice_asr_credential_create_impl(params).boxed()
            }
            METHOD_VOICE_ASR_CREDENTIAL_UPDATE => {
                self.handle_voice_asr_credential_update_impl(params).boxed()
            }
            METHOD_VOICE_ASR_CREDENTIAL_DELETE => {
                self.handle_voice_asr_credential_delete_impl(params).boxed()
            }
            METHOD_VOICE_ASR_CREDENTIAL_DEFAULT_SET => self
                .handle_voice_asr_credential_default_set_impl(params)
                .boxed(),
            METHOD_VOICE_ASR_CREDENTIAL_TEST => {
                self.handle_voice_asr_credential_test_impl(params).boxed()
            }
            METHOD_VOICE_INSTRUCTION_LIST => self.handle_voice_instruction_list_impl().boxed(),
            METHOD_VOICE_INSTRUCTION_SAVE => {
                self.handle_voice_instruction_save_impl(params).boxed()
            }
            METHOD_VOICE_INSTRUCTION_DELETE => {
                self.handle_voice_instruction_delete_impl(params).boxed()
            }
            METHOD_VOICE_MODEL_DEFAULT_SET => {
                self.handle_voice_model_default_set_impl(params).boxed()
            }
            METHOD_VOICE_MODEL_TEST_TRANSCRIBE_FILE => self
                .handle_voice_model_test_transcribe_file_impl(params)
                .boxed(),
            METHOD_INSTRUCTIONS_READ => self.handle_read_instructions_impl().boxed(),
            METHOD_INSTRUCTIONS_WRITE => self.handle_write_instructions_impl(params).boxed(),
            METHOD_DICTATION_HISTORY_LIST => self.handle_list_dictation_history_impl().boxed(),
            METHOD_DICTATION_HISTORY_START => {
                self.handle_start_dictation_history_impl(params).boxed()
            }
            METHOD_DICTATION_HISTORY_APPEND_AUDIO => self
                .handle_append_dictation_history_audio_impl(params)
                .boxed(),
            METHOD_DICTATION_HISTORY_FINISH => {
                self.handle_finish_dictation_history_impl(params).boxed()
            }
            METHOD_DICTATION_HISTORY_READ_AUDIO => self
                .handle_read_dictation_history_audio_impl(params)
                .boxed(),
            METHOD_DICTATION_HISTORY_SET_TRANSCRIPT => self
                .handle_set_dictation_history_transcript_impl(params)
                .boxed(),
            METHOD_DICTATION_HISTORY_DELETE => {
                self.handle_delete_dictation_history_impl(params).boxed()
            }
            METHOD_VOICE_TRANSCRIPTION_TRANSCRIBE_AUDIO => self
                .handle_voice_transcription_transcribe_audio_impl(params)
                .boxed(),
            METHOD_VOICE_TRANSCRIPTION_POLISH_TEXT => self
                .handle_voice_transcription_polish_text_impl(params)
                .boxed(),
            METHOD_WORKSPACE_RIGHT_SURFACE_REQUEST => self
                .handle_workspace_right_surface_request_impl(params)
                .boxed(),
            METHOD_WORKSPACE_RIGHT_SURFACE_PENDING_LIST => self
                .handle_workspace_right_surface_pending_list_impl(params)
                .boxed(),
            METHOD_WORKSPACE_RIGHT_SURFACE_PENDING_CONSUME => self
                .handle_workspace_right_surface_pending_consume_impl(params)
                .boxed(),
            METHOD_WORKSPACE_RIGHT_SURFACE_PENDING_DISMISS => self
                .handle_workspace_right_surface_pending_dismiss_impl(params)
                .boxed(),
            app_server_protocol::protocol::v2::METHOD_MARKETPLACE_ADD => {
                self.handle_marketplace_add_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_MARKETPLACE_REMOVE => {
                self.handle_marketplace_remove_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_MARKETPLACE_UPGRADE => {
                self.handle_marketplace_upgrade_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_LIST => {
                self.handle_plugin_list_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_APP_LIST => {
                self.handle_app_list_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_APP_READ => {
                self.handle_app_read_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_APP_INSTALLED => {
                self.handle_app_installed_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_HOOKS_LIST => {
                self.handle_hooks_list_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_SEARCH => {
                self.handle_plugin_search_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_SKILL_READ => {
                self.handle_plugin_skill_read_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_READ => {
                self.handle_plugin_read_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_INSTALL => {
                self.handle_plugin_install_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_UNINSTALL => {
                self.handle_plugin_uninstall_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_INSTALLED => {
                self.handle_plugin_installed_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_RECONCILE => {
                self.handle_plugin_reconcile_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_SHARE_SAVE => {
                self.handle_plugin_share_save_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_SHARE_LIST => {
                self.handle_plugin_share_list_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_SHARE_UPDATE_TARGETS => {
                self.handle_plugin_share_update_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_SHARE_CHECKOUT => {
                self.handle_plugin_share_checkout_v2_impl(params).boxed()
            }
            app_server_protocol::protocol::v2::METHOD_PLUGIN_SHARE_DELETE => {
                self.handle_plugin_share_delete_v2_impl(params).boxed()
            }
            METHOD_SOUL_STYLE_PACK_INSTALL => {
                self.handle_soul_style_pack_install_impl(params).boxed()
            }
            METHOD_SOUL_STYLE_PACK_LIST => self.handle_soul_style_pack_list_impl(params).boxed(),
            METHOD_SOUL_STYLE_PACK_STATUS_SET => {
                self.handle_soul_style_pack_status_set_impl(params).boxed()
            }
            METHOD_SOUL_STYLE_PACK_UNINSTALL => {
                self.handle_soul_style_pack_uninstall_impl(params).boxed()
            }
            METHOD_SCHEDULED_TASK_LIST => self.handle_scheduled_task_list_impl(params).boxed(),
            METHOD_SCHEDULED_TASK_READ => self.handle_scheduled_task_read_impl(params).boxed(),
            METHOD_SCHEDULED_TASK_CREATE => self.handle_scheduled_task_create_impl(params).boxed(),
            METHOD_SCHEDULED_TASK_UPDATE => self.handle_scheduled_task_update_impl(params).boxed(),
            METHOD_SCHEDULED_TASK_DELETE => self.handle_scheduled_task_delete_impl(params).boxed(),
            METHOD_SCHEDULED_TASK_ENABLED_SET => {
                self.handle_scheduled_task_enabled_set_impl(params).boxed()
            }
            METHOD_SCHEDULED_TASK_RUN_START => {
                self.handle_scheduled_task_run_start_impl(params).boxed()
            }
            METHOD_SCHEDULED_TASK_RUN_LIST => {
                self.handle_scheduled_task_run_list_impl(params).boxed()
            }
            METHOD_SCHEDULED_TASK_SCHEDULE_PREVIEW => self
                .handle_scheduled_task_schedule_preview_impl(params)
                .boxed(),
            METHOD_MCP_SERVER_LIST => self.handle_mcp_server_list_impl().boxed(),
            METHOD_MCP_SERVER_CREATE => self.handle_mcp_server_create_impl(params).boxed(),
            METHOD_MCP_SERVER_UPDATE => self.handle_mcp_server_update_impl(params).boxed(),
            METHOD_MCP_SERVER_DELETE => self.handle_mcp_server_delete_impl(params).boxed(),
            METHOD_MCP_SERVER_ENABLED_SET => {
                self.handle_mcp_server_enabled_set_impl(params).boxed()
            }
            METHOD_MCP_SERVER_IMPORT_FROM_APP => {
                self.handle_mcp_server_import_from_app_impl(params).boxed()
            }
            METHOD_MCP_SERVER_SYNC_ALL_TO_LIVE => {
                self.handle_mcp_server_sync_all_to_live_impl().boxed()
            }
            METHOD_MCP_SERVER_OAUTH_LOGIN => {
                self.handle_mcp_server_oauth_login_impl(params).boxed()
            }
            METHOD_MCP_SERVER_OAUTH_LOGOUT => {
                self.handle_mcp_server_oauth_logout_impl(params).boxed()
            }
            METHOD_MCP_SERVER_START => self.handle_mcp_server_start_impl(params).boxed(),
            METHOD_MCP_SERVER_STOP => self.handle_mcp_server_stop_impl(params).boxed(),
            METHOD_MCP_TOOL_LIST => self.handle_mcp_tool_list_impl().boxed(),
            METHOD_MCP_TOOL_LIST_FOR_CONTEXT => {
                self.handle_mcp_tool_list_for_context_impl(params).boxed()
            }
            METHOD_MCP_TOOL_SEARCH => self.handle_mcp_tool_search_impl(params).boxed(),
            v2::METHOD_MCP_SERVER_RESOURCE_READ => {
                self.handle_mcp_server_resource_read_impl(params).boxed()
            }
            v2::METHOD_MCP_SERVER_STATUS_LIST => {
                self.handle_mcp_server_status_list_v2_impl(params).boxed()
            }
            v2::METHOD_MCP_SERVER_EVENT_STREAM_START => self
                .handle_mcp_server_event_stream_start_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_MCP_SERVER_EVENT_STREAM_STOP => self
                .handle_mcp_server_event_stream_stop_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_MCP_SERVER_TOOL_CALL => {
                self.handle_mcp_server_tool_call_impl(params).boxed()
            }
            v2::METHOD_ENVIRONMENT_ADD => self.handle_environment_add_impl(params).boxed(),
            v2::METHOD_ENVIRONMENT_INFO => self.handle_environment_info_impl(params).boxed(),
            v2::METHOD_ENVIRONMENT_STATUS => self.handle_environment_status_impl(params).boxed(),
            METHOD_MCP_PROMPT_LIST => self.handle_mcp_prompt_list_impl().boxed(),
            METHOD_MCP_PROMPT_GET => self.handle_mcp_prompt_get_impl(params).boxed(),
            METHOD_MCP_RESOURCE_LIST => self.handle_mcp_resource_list_impl().boxed(),
            METHOD_MCP_RESOURCE_SUBSCRIBE => {
                self.handle_mcp_resource_subscribe_impl(params).boxed()
            }
            METHOD_MCP_RESOURCE_UNSUBSCRIBE => {
                self.handle_mcp_resource_unsubscribe_impl(params).boxed()
            }
            METHOD_PROJECT_MEMORY_READ => self.handle_project_memory_read_impl(params).boxed(),
            METHOD_MEMORY_STORE_LIST => self.handle_memory_store_list_impl(params).boxed(),
            METHOD_MEMORY_STORE_READ => self.handle_memory_store_read_impl(params).boxed(),
            METHOD_MEMORY_STORE_SEARCH => self.handle_memory_store_search_impl(params).boxed(),
            METHOD_MEMORY_STORE_ADD_NOTE => self.handle_memory_store_add_note_impl(params).boxed(),
            METHOD_MEMORY_STORE_CONSOLIDATE => {
                self.handle_memory_store_consolidate_impl(params).boxed()
            }
            METHOD_MEMORY_STORE_REVIEW_LIST => {
                self.handle_memory_store_review_list_impl(params).boxed()
            }
            METHOD_MEMORY_STORE_REVIEW_RESOLVE => {
                self.handle_memory_store_review_resolve_impl(params).boxed()
            }
            METHOD_MEMORY_STORE_HEALTH => self.handle_memory_store_health_impl(params).boxed(),
            METHOD_MEMORY_STORE_INDEX_REBUILD => {
                self.handle_memory_store_index_rebuild_impl(params).boxed()
            }
            METHOD_LOG_LIST => self.handle_log_list_impl().boxed(),
            METHOD_LOG_PERSISTED_TAIL => self.handle_log_persisted_tail_impl(params).boxed(),
            METHOD_LOG_CLEAR => self.handle_log_clear_impl().boxed(),
            METHOD_LOG_DIAGNOSTIC_HISTORY_CLEAR => {
                self.handle_log_diagnostic_history_clear_impl().boxed()
            }
            METHOD_DIAGNOSTICS_LOG_STORAGE_READ => {
                self.handle_diagnostics_log_storage_read_impl().boxed()
            }
            METHOD_DIAGNOSTICS_SUPPORT_BUNDLE_EXPORT => self
                .handle_diagnostics_support_bundle_export_impl(params)
                .boxed(),
            METHOD_DIAGNOSTICS_SERVER_READ => self.handle_diagnostics_server_read_impl().boxed(),
            METHOD_DIAGNOSTICS_WINDOWS_STARTUP_READ => {
                self.handle_diagnostics_windows_startup_read_impl().boxed()
            }
            METHOD_DIAGNOSTICS_TRACE_LIST => {
                self.handle_diagnostics_trace_list_impl(params).boxed()
            }
            METHOD_DIAGNOSTICS_TRACE_READ => {
                self.handle_diagnostics_trace_read_impl(params).boxed()
            }
            METHOD_DIAGNOSTICS_TRACE_EXPORT => {
                self.handle_diagnostics_trace_export_impl(params).boxed()
            }
            v2::METHOD_COLLABORATION_MODE_LIST => {
                self.handle_collaboration_mode_list_impl(params).boxed()
            }
            v2::METHOD_EXPERIMENTAL_FEATURE_LIST => {
                self.handle_experimental_feature_list_impl(params).boxed()
            }
            v2::METHOD_EXPERIMENTAL_FEATURE_ENABLEMENT_SET => self
                .handle_experimental_feature_enablement_set_impl(params)
                .boxed(),
            v2::METHOD_PERMISSION_PROFILE_LIST => {
                self.handle_permission_profile_list_impl(params).boxed()
            }
            v2::METHOD_WINDOWS_SANDBOX_READINESS => {
                self.handle_windows_sandbox_readiness_impl(params).boxed()
            }
            v2::METHOD_WINDOWS_SANDBOX_SETUP_START => self
                .handle_windows_sandbox_setup_start_impl(params, connection_request_id.clone())
                .boxed(),
            v2::METHOD_PRIMARY_RUNTIME_DIAGNOSE_DEPENDENCIES => {
                self.handle_diagnose_dependencies(params).boxed()
            }
            v2::METHOD_PRIMARY_RUNTIME_RUN_UPDATE_NOW => {
                self.handle_run_update_now(params, false).boxed()
            }
            v2::METHOD_PRIMARY_RUNTIME_RESET_DEPENDENCIES => {
                self.handle_run_update_now(params, true).boxed()
            }
            v2::METHOD_PRIMARY_RUNTIME_CANCEL_INSTALL => self.handle_cancel_install(params).boxed(),
            v2::METHOD_CONFIG_READ => self.handle_config_read_impl(params).boxed(),
            v2::METHOD_CONFIG_REQUIREMENTS_READ => {
                self.handle_config_requirements_read_impl(params).boxed()
            }
            v2::METHOD_CONFIG_VALUE_WRITE => self.handle_config_value_write_impl(params).boxed(),
            v2::METHOD_CONFIG_BATCH_WRITE => self.handle_config_batch_write_impl(params).boxed(),
            METHOD_CONNECT_DEEP_LINK_RESOLVE => {
                self.handle_connect_deep_link_resolve_impl(params).boxed()
            }
            METHOD_CONNECT_OPEN_DEEP_LINK_RESOLVE => self
                .handle_connect_open_deep_link_resolve_impl(params)
                .boxed(),
            METHOD_CONNECT_RELAY_API_KEY_SAVE => {
                self.handle_connect_relay_api_key_save_impl(params).boxed()
            }
            METHOD_CONNECT_CALLBACK_SEND => self.handle_connect_callback_send_impl(params).boxed(),
            METHOD_TURN_INTERRUPT => self.handle_turn_interrupt_v2_impl(params).boxed(),
            v2::METHOD_REVIEW_START => self.handle_review_start_v2_impl(params).boxed(),
            METHOD_AGENT_SESSION_ACTION_RESPOND => self.handle_action_respond(params).boxed(),
            METHOD_AGENT_SESSION_TOOL_INVENTORY_READ => {
                self.handle_tool_inventory_read_impl(params).boxed()
            }
            _ => ready(Err(JsonRpcError::new(
                error_codes::METHOD_NOT_FOUND,
                format!("method not found: {method}"),
            )))
            .boxed(),
        }
    }
}
