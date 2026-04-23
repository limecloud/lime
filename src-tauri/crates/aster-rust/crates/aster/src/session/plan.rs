use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::session::extension_data::ExtensionState;
use crate::session::{persist_session_extension_data, query_session, Session};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionPlanModeState {
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_id: Option<String>,
    #[serde(default)]
    pub awaiting_leader_approval: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_request_id: Option<String>,
}

impl ExtensionState for SessionPlanModeState {
    const EXTENSION_NAME: &'static str = "session_plan_mode";
    const VERSION: &'static str = "v0";
}

impl SessionPlanModeState {
    pub fn active(plan_file: Option<String>, plan_id: Option<String>) -> Self {
        Self {
            active: true,
            plan_file,
            plan_id,
            awaiting_leader_approval: false,
            pending_request_id: None,
        }
    }

    pub fn from_session(session: &Session) -> Option<Self> {
        Self::from_extension_data(&session.extension_data)
    }
}

pub async fn save_session_plan_mode_state(
    session_id: &str,
    state: Option<SessionPlanModeState>,
) -> Result<()> {
    let mut session = query_session(session_id, false).await?;
    match state {
        Some(state) => {
            state.to_extension_data(&mut session.extension_data)?;
        }
        None => {
            session.extension_data.remove_extension_state(
                SessionPlanModeState::EXTENSION_NAME,
                SessionPlanModeState::VERSION,
            );
        }
    }

    persist_session_extension_data(session_id, session.extension_data).await
}
