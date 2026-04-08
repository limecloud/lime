use crate::session::{
    resolve_team_context, save_team_state, ExtensionState, SessionManager, TeamMembershipState,
    TeamSessionState,
};
use crate::tools::{
    base::Tool,
    context::{ToolContext, ToolResult},
    error::ToolError,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const TEAM_CREATE_TOOL_NAME: &str = "TeamCreate";
const TEAM_DELETE_TOOL_NAME: &str = "TeamDelete";
const LIST_PEERS_TOOL_NAME: &str = "ListPeers";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamCreateInput {
    #[serde(alias = "team_name")]
    team_name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, alias = "agent_type")]
    agent_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamCreateOutput {
    team_name: String,
    team_file_path: String,
    lead_agent_id: String,
    task_list_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct TeamDeleteInput {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamDeleteOutput {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    team_name: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ListPeersInput {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PeerDescriptor {
    name: String,
    agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_type: Option<String>,
    is_lead: bool,
    send_to: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListPeersOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    team_name: Option<String>,
    peers: Vec<PeerDescriptor>,
}

pub struct TeamCreateTool;

impl TeamCreateTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for TeamCreateTool {
    fn default() -> Self {
        Self::new()
    }
}

pub struct TeamDeleteTool;

impl TeamDeleteTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for TeamDeleteTool {
    fn default() -> Self {
        Self::new()
    }
}

pub struct ListPeersTool;

impl ListPeersTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ListPeersTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for TeamCreateTool {
    fn name(&self) -> &str {
        TEAM_CREATE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建一个共享任务板和多代理协作上下文。只保留当前 team surface：创建后，同一 team 下的子代理会共享 task list，并可通过 SendMessage 用名字互相通信。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "team_name": { "type": "string", "description": "要创建的 team 名称。不能为空，会作为共享 task list id。" },
                "description": { "type": "string", "description": "可选 team 描述。" },
                "agent_type": { "type": "string", "description": "可选 team lead 角色提示。" }
            },
            "required": ["team_name"],
            "additionalProperties": false
        })
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: TeamCreateInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("TeamCreate 参数无效: {error}")))?;
        let session_id = require_session_id(context)?;
        let team_name = normalize_required_text(&input.team_name, "team_name")?;
        let mut session = SessionManager::get_session(&session_id, false)
            .await
            .map_err(|error| ToolError::execution_failed(format!("读取 session 失败: {error}")))?;

        if TeamSessionState::from_extension_data(&session.extension_data).is_some()
            || TeamMembershipState::from_extension_data(&session.extension_data).is_some()
        {
            return Err(ToolError::execution_failed(
                "当前 session 已经属于一个 team；请先退出或删除现有 team",
            ));
        }
        ensure_team_name_available(&team_name, &session.id).await?;

        let team_state = TeamSessionState::new(
            team_name.clone(),
            session.id.clone(),
            normalize_optional_text(input.description),
            normalize_optional_text(input.agent_type),
        );
        team_state
            .to_extension_data(&mut session.extension_data)
            .map_err(|error| ToolError::execution_failed(format!("保存 team 状态失败: {error}")))?;
        SessionManager::update_session(&session.id)
            .extension_data(session.extension_data)
            .apply()
            .await
            .map_err(|error| ToolError::execution_failed(format!("更新 session 失败: {error}")))?;

        let output = TeamCreateOutput {
            team_name: team_name.clone(),
            team_file_path: format!("session://{}/team", session.id),
            lead_agent_id: session.id.clone(),
            task_list_id: team_name.clone(),
        };

        Ok(ToolResult::success(pretty_json(&output)?)
            .with_metadata("teamName", json!(output.team_name))
            .with_metadata("leadAgentId", json!(output.lead_agent_id))
            .with_metadata("taskListId", json!(output.task_list_id)))
    }
}

#[async_trait]
impl Tool for TeamDeleteTool {
    fn name(&self) -> &str {
        TEAM_DELETE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "删除当前 team 协作上下文；仅 team lead 可执行。若仍有已注册成员，工具会拒绝删除，要求先逐个关闭这些成员。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false
        })
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let _: TeamDeleteInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("TeamDelete 参数无效: {error}")))?;
        let session_id = require_session_id(context)?;
        let Some(team_context) = resolve_team_context(&session_id)
            .await
            .map_err(|error| ToolError::execution_failed(format!("读取 team 状态失败: {error}")))?
        else {
            let output = TeamDeleteOutput {
                success: true,
                message: "No team name found, nothing to clean up".to_string(),
                team_name: None,
            };
            return Ok(ToolResult::success(pretty_json(&output)?)
                .with_metadata("success", json!(true))
                .with_metadata("teamName", Value::Null));
        };

        if !team_context.is_lead {
            return Err(ToolError::execution_failed(
                "只有 team lead 可以执行 TeamDelete",
            ));
        }

        let active_members = team_context.team_state.non_lead_members();
        if !active_members.is_empty() {
            let member_names = active_members
                .iter()
                .map(|member| member.name.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            let output = TeamDeleteOutput {
                success: false,
                message: format!(
                    "Cannot cleanup team with {} active member(s): {}. 请先通过 SendMessage 逐个通知这些成员结束当前工作后再重试。",
                    active_members.len(),
                    member_names
                ),
                team_name: Some(team_context.team_state.team_name.clone()),
            };
            return Ok(ToolResult::success(pretty_json(&output)?)
                .with_metadata("success", json!(false))
                .with_metadata("teamName", json!(team_context.team_state.team_name))
                .with_metadata(
                    "activeMembers",
                    json!(active_members
                        .iter()
                        .map(|member| member.name.as_str())
                        .collect::<Vec<_>>()),
                ));
        }

        save_team_state(&team_context.lead_session_id, None)
            .await
            .map_err(|error| ToolError::execution_failed(format!("删除 team 状态失败: {error}")))?;
        let output = TeamDeleteOutput {
            success: true,
            message: format!("Cleaned up team \"{}\"", team_context.team_state.team_name),
            team_name: Some(team_context.team_state.team_name.clone()),
        };
        Ok(ToolResult::success(pretty_json(&output)?)
            .with_metadata("success", json!(true))
            .with_metadata("teamName", json!(output.team_name)))
    }
}

#[async_trait]
impl Tool for ListPeersTool {
    fn name(&self) -> &str {
        LIST_PEERS_TOOL_NAME
    }

    fn description(&self) -> &str {
        "列出当前 team 中可通过 SendMessage 直接通信的 peers。当前 runtime 返回 team 成员名字与 agent id，不暴露旧 peer surface。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false
        })
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let _: ListPeersInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("ListPeers 参数无效: {error}")))?;
        let session_id = require_session_id(context)?;
        let peers = if let Some(team_context) = resolve_team_context(&session_id)
            .await
            .map_err(|error| ToolError::execution_failed(format!("读取 team 状态失败: {error}")))?
        {
            ListPeersOutput {
                team_name: Some(team_context.team_state.team_name),
                peers: team_context
                    .team_state
                    .members
                    .into_iter()
                    .filter(|member| member.agent_id != team_context.current_agent_id)
                    .map(|member| PeerDescriptor {
                        send_to: member.name.clone(),
                        name: member.name,
                        agent_id: member.agent_id,
                        agent_type: member.agent_type,
                        is_lead: member.is_lead,
                    })
                    .collect(),
            }
        } else {
            ListPeersOutput {
                team_name: None,
                peers: Vec::new(),
            }
        };

        Ok(ToolResult::success(pretty_json(&peers)?)
            .with_metadata("teamName", json!(peers.team_name))
            .with_metadata("peers", json!(peers.peers)))
    }
}

async fn ensure_team_name_available(
    team_name: &str,
    current_session_id: &str,
) -> Result<(), ToolError> {
    let sessions = SessionManager::list_sessions()
        .await
        .map_err(|error| ToolError::execution_failed(format!("列出 sessions 失败: {error}")))?;
    let conflict = sessions.into_iter().any(|session| {
        if session.id == current_session_id {
            return false;
        }

        TeamSessionState::from_extension_data(&session.extension_data)
            .map(|state| state.team_name == team_name)
            .unwrap_or(false)
    });

    if conflict {
        return Err(ToolError::execution_failed(format!(
            "team_name \"{team_name}\" 已存在，请换一个名字"
        )));
    }

    Ok(())
}

fn normalize_required_text(value: &str, field_name: &str) -> Result<String, ToolError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ToolError::invalid_params(format!("{field_name} 不能为空")));
    }

    Ok(trimmed.to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn require_session_id(context: &ToolContext) -> Result<String, ToolError> {
    normalize_required_text(&context.session_id, "session_id")
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| ToolError::execution_failed(format!("序列化结果失败: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{save_team_membership, SessionType, TeamMember, TEAM_LEAD_NAME};
    use tempfile::tempdir;
    use uuid::Uuid;

    #[tokio::test]
    async fn team_create_persists_team_state() -> anyhow::Result<()> {
        let temp_dir = tempdir()?;
        let session = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-create-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;
        let context = ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&session.id);

        let result = TeamCreateTool::new()
            .execute(
                json!({
                    "team_name": "alpha",
                    "description": "协作测试",
                    "agent_type": "leader"
                }),
                &context,
            )
            .await?;

        assert!(result.success);
        let updated = SessionManager::get_session(&session.id, false).await?;
        let team_state = TeamSessionState::from_extension_data(&updated.extension_data)
            .expect("team state should exist");
        assert_eq!(team_state.team_name, "alpha");
        assert_eq!(team_state.members[0].name, TEAM_LEAD_NAME);
        Ok(())
    }

    #[tokio::test]
    async fn team_delete_refuses_when_members_remain() -> anyhow::Result<()> {
        let temp_dir = tempdir()?;
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-delete-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;

        save_team_state(
            &lead.id,
            Some(TeamSessionState {
                team_name: "alpha".to_string(),
                description: None,
                lead_session_id: lead.id.clone(),
                members: vec![
                    TeamMember::lead(lead.id.clone(), Some("leader".to_string())),
                    TeamMember::teammate("child-1", "researcher", Some("explorer".to_string())),
                ],
            }),
        )
        .await?;

        let context = ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&lead.id);
        let result = TeamDeleteTool::new().execute(json!({}), &context).await?;

        assert!(result.success);
        assert_eq!(result.metadata["success"], json!(false));
        Ok(())
    }

    #[tokio::test]
    async fn list_peers_returns_other_team_members() -> anyhow::Result<()> {
        let temp_dir = tempdir()?;
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-list-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;
        let child = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-list-child-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await?;

        save_team_state(
            &lead.id,
            Some(TeamSessionState {
                team_name: "alpha".to_string(),
                description: None,
                lead_session_id: lead.id.clone(),
                members: vec![
                    TeamMember::lead(lead.id.clone(), Some("leader".to_string())),
                    TeamMember::teammate(
                        child.id.clone(),
                        "researcher",
                        Some("explorer".to_string()),
                    ),
                ],
            }),
        )
        .await?;
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

        let context = ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&child.id);
        let result = ListPeersTool::new().execute(json!({}), &context).await?;

        assert!(result.success);
        let peers = result.metadata["peers"]
            .as_array()
            .expect("peers metadata should be an array");
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0]["name"], json!(TEAM_LEAD_NAME));
        Ok(())
    }
}
