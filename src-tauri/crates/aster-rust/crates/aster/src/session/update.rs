use crate::conversation::Conversation;
use crate::session::extension_data::ExtensionData;
use crate::session::{Session, SessionManager, SessionType, SessionUpdateBuilder};
use anyhow::Result;
use std::path::PathBuf;

pub async fn apply_session_update(
    session_id: &str,
    configure: impl FnOnce(SessionUpdateBuilder) -> SessionUpdateBuilder,
) -> Result<()> {
    configure(SessionManager::update_session(session_id))
        .apply()
        .await
}

pub async fn delete_managed_session(session_id: &str) -> Result<()> {
    SessionManager::delete_session(session_id).await
}

pub async fn create_managed_session(
    working_dir: PathBuf,
    session_name: String,
    session_type: SessionType,
) -> Result<Session> {
    SessionManager::create_session(working_dir, session_name, session_type).await
}

pub async fn create_subagent_session(
    working_dir: PathBuf,
    session_name: String,
) -> Result<Session> {
    create_managed_session(working_dir, session_name, SessionType::SubAgent).await
}

pub async fn replace_session_conversation(
    session_id: &str,
    conversation: &Conversation,
) -> Result<()> {
    SessionManager::replace_conversation(session_id, conversation).await
}

pub async fn persist_session_extension_data(
    session_id: &str,
    extension_data: ExtensionData,
) -> Result<()> {
    apply_session_update(session_id, |update| update.extension_data(extension_data)).await
}
