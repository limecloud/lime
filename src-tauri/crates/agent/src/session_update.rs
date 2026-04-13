use aster::conversation::Conversation;
use aster::session::extension_data::ExtensionData;
use aster::session::{Session, SessionManager, SessionType};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactionSessionMetricsUpdate {
    pub schedule_id: Option<String>,
    pub current_window_tokens: i32,
    pub cached_input_tokens: Option<i32>,
    pub cache_creation_input_tokens: Option<i32>,
    pub accumulated_total_tokens: Option<i32>,
    pub accumulated_input_tokens: Option<i32>,
    pub accumulated_output_tokens: Option<i32>,
}

/// 收口 session extension_data 的持久化边界，避免散落 direct builder 调用。
pub async fn persist_session_extension_data(
    session_id: &str,
    extension_data: ExtensionData,
    action_label: &str,
) -> Result<(), String> {
    SessionManager::update_session(session_id)
        .extension_data(extension_data)
        .apply()
        .await
        .map_err(|error| format!("{action_label}失败: {error}"))
}

/// 收口 subagent session 创建边界，避免业务层直接持有 create_session 调用。
pub async fn create_subagent_session(
    working_dir: PathBuf,
    session_name: String,
) -> Result<Session, String> {
    SessionManager::create_session(working_dir, session_name, SessionType::SubAgent)
        .await
        .map_err(|error| format!("创建 subagent session 失败: {error}"))
}

/// 收口 session conversation 整体替换边界，避免业务层直接持有 replace_conversation 调用。
pub async fn replace_session_conversation(
    session_id: &str,
    conversation: &Conversation,
    action_label: &str,
) -> Result<(), String> {
    SessionManager::replace_conversation(session_id, conversation)
        .await
        .map_err(|error| format!("{action_label}失败: {error}"))
}

/// 收口 compaction 后 session token 指标写回边界，避免业务层直接持有 builder 链。
pub async fn persist_compaction_session_metrics_update(
    session_id: &str,
    update: &CompactionSessionMetricsUpdate,
) -> Result<(), String> {
    SessionManager::update_session(session_id)
        // 显式保留已有 schedule_id，避免把保留旧值的行为隐含在 store 的 COALESCE 语义里。
        .schedule_id(update.schedule_id.clone())
        .total_tokens(Some(update.current_window_tokens))
        .input_tokens(Some(update.current_window_tokens))
        .output_tokens(Some(0))
        .cached_input_tokens(update.cached_input_tokens)
        .cache_creation_input_tokens(update.cache_creation_input_tokens)
        .accumulated_total_tokens(update.accumulated_total_tokens)
        .accumulated_input_tokens(update.accumulated_input_tokens)
        .accumulated_output_tokens(update.accumulated_output_tokens)
        .apply()
        .await
        .map_err(|error| format!("更新压缩后的 token 统计失败: {error}"))
}
