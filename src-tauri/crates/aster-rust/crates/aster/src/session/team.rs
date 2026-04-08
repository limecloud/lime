use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::session::extension_data::{ExtensionData, ExtensionState};
use crate::session::{Session, SessionManager};

pub const TEAM_LEAD_NAME: &str = "team-lead";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub agent_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    pub is_lead: bool,
    pub joined_at_ms: i64,
}

impl TeamMember {
    pub fn lead(agent_id: impl Into<String>, agent_type: Option<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            name: TEAM_LEAD_NAME.to_string(),
            agent_type,
            is_lead: true,
            joined_at_ms: Utc::now().timestamp_millis(),
        }
    }

    pub fn teammate(
        agent_id: impl Into<String>,
        name: impl Into<String>,
        agent_type: Option<String>,
    ) -> Self {
        Self {
            agent_id: agent_id.into(),
            name: name.into(),
            agent_type,
            is_lead: false,
            joined_at_ms: Utc::now().timestamp_millis(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamSessionState {
    pub team_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub lead_session_id: String,
    pub members: Vec<TeamMember>,
}

impl ExtensionState for TeamSessionState {
    const EXTENSION_NAME: &'static str = "team_session";
    const VERSION: &'static str = "v0";
}

impl TeamSessionState {
    pub fn new(
        team_name: impl Into<String>,
        lead_session_id: impl Into<String>,
        description: Option<String>,
        lead_agent_type: Option<String>,
    ) -> Self {
        let lead_session_id = lead_session_id.into();
        Self {
            team_name: team_name.into(),
            description,
            members: vec![TeamMember::lead(lead_session_id.clone(), lead_agent_type)],
            lead_session_id,
        }
    }

    pub fn add_or_update_member(&mut self, member: TeamMember) {
        if let Some(existing) = self
            .members
            .iter_mut()
            .find(|existing| existing.agent_id == member.agent_id || existing.name == member.name)
        {
            *existing = member;
            return;
        }

        self.members.push(member);
    }

    pub fn remove_member_by_agent_id(&mut self, agent_id: &str) -> Option<TeamMember> {
        let index = self
            .members
            .iter()
            .position(|member| member.agent_id == agent_id)?;
        Some(self.members.remove(index))
    }

    pub fn find_member_by_name(&self, name: &str) -> Option<&TeamMember> {
        self.members.iter().find(|member| member.name == name)
    }

    pub fn non_lead_members(&self) -> Vec<&TeamMember> {
        self.members
            .iter()
            .filter(|member| !member.is_lead)
            .collect()
    }

    pub fn from_session(session: &Session) -> Option<Self> {
        Self::from_extension_data(&session.extension_data)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamMembershipState {
    pub team_name: String,
    pub lead_session_id: String,
    pub agent_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
}

impl ExtensionState for TeamMembershipState {
    const EXTENSION_NAME: &'static str = "team_membership";
    const VERSION: &'static str = "v0";
}

impl TeamMembershipState {
    pub fn from_session(session: &Session) -> Option<Self> {
        Self::from_extension_data(&session.extension_data)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedTeamContext {
    pub lead_session_id: String,
    pub current_agent_id: String,
    pub current_member_name: String,
    pub is_lead: bool,
    pub team_state: TeamSessionState,
}

pub fn resolve_team_task_list_id(extension_data: &ExtensionData) -> Option<String> {
    TeamSessionState::from_extension_data(extension_data)
        .map(|state| state.team_name)
        .or_else(|| {
            TeamMembershipState::from_extension_data(extension_data).map(|state| state.team_name)
        })
}

pub async fn resolve_team_context(session_id: &str) -> Result<Option<ResolvedTeamContext>> {
    if session_id.trim().is_empty() {
        return Ok(None);
    }

    let session = match SessionManager::get_session(session_id, false).await {
        Ok(session) => session,
        Err(_) => return Ok(None),
    };
    if let Some(team_state) = TeamSessionState::from_session(&session) {
        return Ok(Some(ResolvedTeamContext {
            lead_session_id: session.id.clone(),
            current_agent_id: session.id,
            current_member_name: TEAM_LEAD_NAME.to_string(),
            is_lead: true,
            team_state,
        }));
    }

    let Some(membership) = TeamMembershipState::from_session(&session) else {
        return Ok(None);
    };
    let lead_session = match SessionManager::get_session(&membership.lead_session_id, false).await {
        Ok(session) => session,
        Err(_) => return Ok(None),
    };
    let Some(team_state) = TeamSessionState::from_session(&lead_session) else {
        return Ok(None);
    };

    Ok(Some(ResolvedTeamContext {
        lead_session_id: membership.lead_session_id,
        current_agent_id: membership.agent_id,
        current_member_name: membership.name,
        is_lead: false,
        team_state,
    }))
}

pub async fn save_team_state(
    lead_session_id: &str,
    team_state: Option<TeamSessionState>,
) -> Result<()> {
    let mut session = SessionManager::get_session(lead_session_id, false).await?;
    match team_state {
        Some(team_state) => {
            team_state.to_extension_data(&mut session.extension_data)?;
        }
        None => {
            session.extension_data.remove_extension_state(
                TeamSessionState::EXTENSION_NAME,
                TeamSessionState::VERSION,
            );
        }
    }

    SessionManager::update_session(lead_session_id)
        .extension_data(session.extension_data)
        .apply()
        .await
}

pub async fn save_team_membership(
    session_id: &str,
    membership: Option<TeamMembershipState>,
) -> Result<()> {
    let mut session = SessionManager::get_session(session_id, false).await?;
    match membership {
        Some(membership) => {
            membership.to_extension_data(&mut session.extension_data)?;
        }
        None => {
            session.extension_data.remove_extension_state(
                TeamMembershipState::EXTENSION_NAME,
                TeamMembershipState::VERSION,
            );
        }
    }

    SessionManager::update_session(session_id)
        .extension_data(session.extension_data)
        .apply()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::SessionType;
    use tempfile::tempdir;
    use uuid::Uuid;

    #[test]
    fn resolve_team_task_list_id_prefers_team_state() {
        let mut extension_data = ExtensionData::default();
        TeamSessionState::new(
            "alpha",
            "lead-session",
            Some("测试".to_string()),
            Some("leader".to_string()),
        )
        .to_extension_data(&mut extension_data)
        .unwrap();

        assert_eq!(
            resolve_team_task_list_id(&extension_data).as_deref(),
            Some("alpha")
        );
    }

    #[tokio::test]
    async fn resolve_team_context_reads_membership_from_child_session() -> anyhow::Result<()> {
        let temp_dir = tempdir()?;
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;
        let child = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-child-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await?;

        let team_state = TeamSessionState {
            team_name: "alpha".to_string(),
            description: None,
            lead_session_id: lead.id.clone(),
            members: vec![
                TeamMember::lead(lead.id.clone(), Some("leader".to_string())),
                TeamMember::teammate(child.id.clone(), "researcher", Some("explorer".to_string())),
            ],
        };
        save_team_state(&lead.id, Some(team_state)).await?;
        save_team_membership(
            &child.id,
            Some(TeamMembershipState {
                team_name: "alpha".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: child.id.clone(),
                name: "researcher".to_string(),
                agent_type: Some("explorer".to_string()),
            }),
        )
        .await?;

        let context = resolve_team_context(&child.id)
            .await?
            .expect("child team context should exist");
        assert_eq!(context.lead_session_id, lead.id);
        assert_eq!(context.current_member_name, "researcher");
        assert!(!context.is_lead);
        assert_eq!(context.team_state.members.len(), 2);

        Ok(())
    }
}
