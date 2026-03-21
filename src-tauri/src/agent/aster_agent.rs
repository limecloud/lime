//! Aster Agent 包装器
//!
//! 提供简化的接口来使用 Aster Agent。
//! 处理消息发送、事件流转换，并桥接会话存储服务。

use crate::agent::aster_state::{AsterAgentState, SessionConfigBuilder};
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::services::memory_profile_prompt_service::{
    merge_system_prompt_with_memory_context, MemoryPromptContext,
};
use aster::conversation::message::Message;
use futures::StreamExt;
use lime_agent::{
    convert_agent_event, get_persisted_session_metadata_sync,
    merge_system_prompt_with_runtime_agents, TauriAgentEvent, WriteArtifactEventEmitter,
};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};

pub use lime_agent::{
    PersistedSessionMetadata, SessionDetail, SessionInfo, SessionTitlePreviewMessage,
};

/// Aster Agent 包装器
///
/// 提供与 Tauri 集成的简化接口
pub struct AsterAgentWrapper;

impl AsterAgentWrapper {
    /// 发送消息并获取流式响应
    ///
    /// # Arguments
    /// * `state` - Aster Agent 状态
    /// * `db` - 数据库连接
    /// * `app` - Tauri AppHandle，用于发送事件
    /// * `message` - 用户消息文本
    /// * `session_id` - 会话 ID
    /// * `event_name` - 前端监听的事件名称
    ///
    /// # Returns
    /// 成功时返回 Ok(())，失败时返回错误信息
    pub async fn send_message(
        state: &AsterAgentState,
        db: &DbConnection,
        app: &AppHandle,
        message: String,
        session_id: String,
        event_name: String,
    ) -> Result<(), String> {
        if !state.is_initialized().await {
            state.init_agent_with_db(db).await?;
        }

        let cancel_token = state.create_cancel_token(&session_id).await;

        let user_message = Message::user().with_text(&message);
        let mut session_config_builder =
            SessionConfigBuilder::new(&session_id).include_context_trace(true);
        let persisted_session_metadata = get_persisted_session_metadata_sync(db, &session_id)
            .ok()
            .flatten();
        let persisted_prompt = persisted_session_metadata
            .as_ref()
            .and_then(|session| session.system_prompt.clone());
        let working_dir = persisted_session_metadata
            .as_ref()
            .and_then(|session| session.working_dir.as_deref())
            .filter(|path| !path.trim().is_empty())
            .map(Path::new);

        let merged_prompt =
            if let Some(config_manager) = app.try_state::<GlobalConfigManagerState>() {
                let runtime_config = config_manager.config();
                merge_system_prompt_with_memory_context(
                    merge_system_prompt_with_runtime_agents(persisted_prompt, working_dir),
                    &runtime_config,
                    MemoryPromptContext {
                        working_dir,
                        active_relative_path: None,
                    },
                )
            } else {
                merge_system_prompt_with_runtime_agents(persisted_prompt, working_dir)
            };

        if let Some(prompt) = merged_prompt {
            session_config_builder = session_config_builder.system_prompt(prompt);
        }
        let session_config = session_config_builder.build();

        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;

        let stream_result = agent
            .reply(user_message, session_config, Some(cancel_token.clone()))
            .await;
        let mut write_artifact_emitter = WriteArtifactEventEmitter::new(session_id.clone());

        match stream_result {
            Ok(mut stream) => {
                while let Some(event_result) = stream.next().await {
                    match event_result {
                        Ok(agent_event) => {
                            let tauri_events = convert_agent_event(agent_event);
                            for mut tauri_event in tauri_events {
                                let extra_events =
                                    write_artifact_emitter.process_event(&mut tauri_event);
                                for extra_event in &extra_events {
                                    if let Err(error) = app.emit(&event_name, extra_event) {
                                        tracing::error!(
                                            "[AsterAgentWrapper] 发送补充事件失败: {}",
                                            error
                                        );
                                    }
                                }
                                if let Err(error) = app.emit(&event_name, &tauri_event) {
                                    tracing::error!("[AsterAgentWrapper] 发送事件失败: {}", error);
                                }
                            }
                        }
                        Err(error) => {
                            let error_event = TauriAgentEvent::Error {
                                message: format!("Stream error: {error}"),
                            };
                            let _ = app.emit(&event_name, &error_event);
                        }
                    }
                }

                let done_event = TauriAgentEvent::FinalDone { usage: None };
                let _ = app.emit(&event_name, &done_event);
            }
            Err(error) => {
                let error_event = TauriAgentEvent::Error {
                    message: format!("Agent error: {error}"),
                };
                let _ = app.emit(&event_name, &error_event);
                return Err(format!("Agent error: {error}"));
            }
        }

        state.remove_cancel_token(&session_id).await;

        Ok(())
    }

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
    pub fn list_sessions_sync(db: &DbConnection) -> Result<Vec<SessionInfo>, String> {
        lime_agent::list_sessions_sync(db)
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
}
