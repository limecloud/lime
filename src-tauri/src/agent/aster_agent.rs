//! Aster Agent 包装器
//!
//! 提供简化的接口来使用 Aster Agent。
//! 处理会话存储桥接，并为非 Query Loop 主链的专用一次性命令提供最小会话配置 helper。

use crate::agent::aster_state::{AsterAgentState, SessionConfigBuilder};
use crate::database::DbConnection;
use aster::session::TurnContextOverride;
use lime_core::database::dao::agent::SessionArchiveFilter;

pub use lime_agent::{
    PersistedSessionMetadata, SessionDetail, SessionInfo, SessionTitlePreviewMessage,
};

pub(crate) fn build_auxiliary_session_config_with_turn_context(
    session_id: &str,
    system_prompt: Option<String>,
    include_context_trace: bool,
    turn_context: Option<TurnContextOverride>,
) -> aster::agents::SessionConfig {
    let mut session_config_builder =
        SessionConfigBuilder::new(session_id).include_context_trace(include_context_trace);
    if let Some(prompt) = system_prompt {
        session_config_builder = session_config_builder.system_prompt(prompt);
    }
    if let Some(turn_context) = turn_context {
        session_config_builder = session_config_builder.turn_context(turn_context);
    }
    session_config_builder.build()
}

/// 为专用一次性命令构建最小 `SessionConfig`。
///
/// 这类调用不属于 Query Loop current 主链，不携带 submit turn 的 thread / turn /
/// turn context snapshot，只允许显式声明自己的 system prompt 与 trace 开关。
pub(crate) fn build_auxiliary_session_config(
    session_id: &str,
    system_prompt: Option<String>,
    include_context_trace: bool,
) -> aster::agents::SessionConfig {
    build_auxiliary_session_config_with_turn_context(
        session_id,
        system_prompt,
        include_context_trace,
        None,
    )
}

/// Aster Agent 包装器
///
/// 提供与 Tauri 集成的简化接口
pub struct AsterAgentWrapper;

impl AsterAgentWrapper {
    /// 停止当前会话
    pub async fn stop_session(state: &AsterAgentState, session_id: &str) -> bool {
        state.cancel_session(session_id).await
    }

    /// 创建新会话
    pub fn create_session_sync(
        db: &DbConnection,
        name: Option<String>,
        working_dir: Option<String>,
        workspace_id: String,
        execution_strategy: Option<String>,
    ) -> Result<String, String> {
        lime_agent::create_session_sync(db, name, working_dir, workspace_id, execution_strategy)
    }

    /// 列出所有会话
    pub fn list_sessions_sync(
        db: &DbConnection,
        archive_filter: SessionArchiveFilter,
        workspace_id: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<SessionInfo>, String> {
        lime_agent::list_sessions_sync(db, archive_filter, workspace_id, limit)
    }

    /// 获取会话详情
    pub fn get_session_sync(db: &DbConnection, session_id: &str) -> Result<SessionDetail, String> {
        lime_agent::get_session_sync(db, session_id)
    }

    pub async fn get_runtime_session_detail(
        db: &DbConnection,
        session_id: &str,
    ) -> Result<SessionDetail, String> {
        lime_agent::get_runtime_session_detail(db, session_id).await
    }

    pub async fn get_runtime_session_detail_with_history_limit(
        db: &DbConnection,
        session_id: &str,
        history_limit: Option<usize>,
    ) -> Result<SessionDetail, String> {
        lime_agent::get_runtime_session_detail_with_history_limit(db, session_id, history_limit)
            .await
    }

    pub async fn get_runtime_session_detail_with_history_window(
        db: &DbConnection,
        session_id: &str,
        history_limit: Option<usize>,
        history_offset: usize,
    ) -> Result<SessionDetail, String> {
        lime_agent::get_runtime_session_detail_with_history_window(
            db,
            session_id,
            history_limit,
            history_offset,
        )
        .await
    }

    pub async fn get_runtime_session_detail_with_history_page(
        db: &DbConnection,
        session_id: &str,
        history_limit: Option<usize>,
        history_offset: usize,
        history_before_message_id: Option<i64>,
    ) -> Result<SessionDetail, String> {
        lime_agent::get_runtime_session_detail_with_history_page(
            db,
            session_id,
            history_limit,
            history_offset,
            history_before_message_id,
        )
        .await
    }

    pub async fn get_runtime_session_execution_runtime(
        db: &DbConnection,
        session_id: &str,
    ) -> Option<lime_agent::SessionExecutionRuntime> {
        Self::get_runtime_session_detail(db, session_id)
            .await
            .ok()
            .and_then(|detail| detail.execution_runtime)
    }

    pub fn get_persisted_session_metadata_sync(
        db: &DbConnection,
        session_id: &str,
    ) -> Result<Option<PersistedSessionMetadata>, String> {
        lime_agent::get_persisted_session_metadata_sync(db, session_id)
    }

    pub fn list_title_preview_messages_sync(
        db: &DbConnection,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<SessionTitlePreviewMessage>, String> {
        lime_agent::list_title_preview_messages_sync(db, session_id, limit)
    }

    /// 重命名会话
    pub fn rename_session_sync(
        db: &DbConnection,
        session_id: &str,
        name: &str,
    ) -> Result<(), String> {
        lime_agent::rename_session_sync(db, session_id, name)
    }

    pub fn update_session_working_dir_sync(
        db: &DbConnection,
        session_id: &str,
        working_dir: &str,
    ) -> Result<(), String> {
        lime_agent::update_session_working_dir_sync(db, session_id, working_dir)
    }

    pub fn update_session_execution_strategy_sync(
        db: &DbConnection,
        session_id: &str,
        execution_strategy: &str,
    ) -> Result<(), String> {
        lime_agent::update_session_execution_strategy_sync(db, session_id, execution_strategy)
    }

    pub fn update_session_provider_config_sync(
        db: &DbConnection,
        session_id: &str,
        provider_name: Option<&str>,
        model_name: Option<&str>,
    ) -> Result<(), String> {
        lime_agent::update_session_provider_config_sync(db, session_id, provider_name, model_name)
    }

    pub fn update_session_archived_state_sync(
        db: &DbConnection,
        session_id: &str,
        archived: bool,
    ) -> Result<(), String> {
        lime_agent::update_session_archived_state_sync(db, session_id, archived)
    }

    pub async fn persist_session_recent_preferences(
        session_id: &str,
        preferences: lime_agent::SessionExecutionRuntimePreferences,
    ) -> Result<(), String> {
        lime_agent::persist_session_recent_preferences(session_id, preferences).await
    }

    pub async fn persist_session_recent_access_mode(
        session_id: &str,
        recent_access_mode: lime_agent::SessionExecutionRuntimeAccessMode,
    ) -> Result<(), String> {
        lime_agent::persist_session_recent_access_mode(session_id, recent_access_mode).await
    }

    pub async fn persist_session_recent_team_selection(
        session_id: &str,
        recent_team_selection: lime_agent::SessionExecutionRuntimeRecentTeamSelection,
    ) -> Result<(), String> {
        lime_agent::persist_session_recent_team_selection(session_id, recent_team_selection).await
    }

    /// 删除会话
    pub async fn delete_session(db: &DbConnection, session_id: &str) -> Result<(), String> {
        lime_agent::delete_session(db, session_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_session_config_builder() {
        let config = SessionConfigBuilder::new("test-session").build();
        assert_eq!(config.id, "test-session");
    }

    #[test]
    fn test_build_auxiliary_session_config_keeps_explicit_prompt_and_trace() {
        let config = build_auxiliary_session_config(
            "aux-session",
            Some("你是一次性助手".to_string()),
            false,
        );

        assert_eq!(config.id, "aux-session");
        assert_eq!(config.system_prompt.as_deref(), Some("你是一次性助手"));
        assert_eq!(config.include_context_trace, Some(false));
        assert!(config.thread_id.is_none());
        assert!(config.turn_id.is_none());
        assert!(config.turn_context.is_none());
    }

    #[test]
    fn test_build_auxiliary_session_config_with_turn_context_keeps_local_metadata() {
        let turn_context = TurnContextOverride {
            metadata: [(
                "lime_runtime".to_string(),
                serde_json::json!({ "task_profile": { "kind": "agent_meta" } }),
            )]
            .into_iter()
            .collect(),
            ..TurnContextOverride::default()
        };
        let config = build_auxiliary_session_config_with_turn_context(
            "aux-session",
            Some("你是一次性助手".to_string()),
            true,
            Some(turn_context),
        );

        assert_eq!(config.id, "aux-session");
        assert_eq!(config.include_context_trace, Some(true));
        assert!(config.turn_context.is_some());
        assert_eq!(
            config
                .turn_context
                .as_ref()
                .and_then(|context| context.metadata.get("lime_runtime"))
                .and_then(serde_json::Value::as_object)
                .and_then(|runtime| runtime.get("task_profile"))
                .and_then(serde_json::Value::as_object)
                .and_then(|profile| profile.get("kind"))
                .and_then(serde_json::Value::as_str),
            Some("agent_meta")
        );
    }
}
