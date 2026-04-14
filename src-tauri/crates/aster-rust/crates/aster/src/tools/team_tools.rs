use crate::session::{
    require_shared_session_runtime_queue_service, resolve_team_context, save_team_membership,
    save_team_state, ExtensionState, SessionManager, SessionRuntimeQueueService, SessionType,
    TeamMember, TeamMembershipState, TeamSessionState, TEAM_LEAD_NAME,
};
use crate::tools::{
    base::Tool,
    context::{ToolContext, ToolResult},
    error::ToolError,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::paths::Paths;

const TEAM_CREATE_TOOL_NAME: &str = "TeamCreate";
const TEAM_DELETE_TOOL_NAME: &str = "TeamDelete";
const LIST_PEERS_TOOL_NAME: &str = "ListPeers";
const TEAM_CREATE_TOOL_ALIASES: &[&str] = &["TeamCreateTool"];
const TEAM_DELETE_TOOL_ALIASES: &[&str] = &["TeamDeleteTool"];
const LIST_PEERS_TOOL_ALIASES: &[&str] = &["ListPeersTool"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct TeamCreateInput {
    #[serde(alias = "team_name")]
    team_name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, alias = "agent_type")]
    agent_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct TeamCreateOutput {
    #[serde(rename = "team_name")]
    team_name: String,
    #[serde(rename = "team_file_path")]
    team_file_path: String,
    #[serde(rename = "lead_agent_id")]
    lead_agent_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct TeamDeleteInput {}

#[derive(Debug, Clone, Serialize)]
struct TeamDeleteOutput {
    success: bool,
    message: String,
    #[serde(rename = "team_name", skip_serializing_if = "Option::is_none")]
    team_name: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct ListPeersInput {}

#[derive(Debug, Clone, Serialize)]
struct PeerDescriptor {
    name: String,
    #[serde(rename = "agent_id")]
    agent_id: String,
    #[serde(rename = "agent_type", skip_serializing_if = "Option::is_none")]
    agent_type: Option<String>,
    #[serde(rename = "is_lead")]
    is_lead: bool,
    #[serde(rename = "send_to")]
    send_to: String,
}

#[derive(Debug, Clone, Serialize)]
struct ListPeersOutput {
    #[serde(rename = "team_name", skip_serializing_if = "Option::is_none")]
    team_name: Option<String>,
    peers: Vec<PeerDescriptor>,
}

#[derive(Debug, Clone)]
struct ResolvedTeamMemberState {
    member: TeamMember,
    is_active: bool,
}

fn format_team_agent_id(name: &str, team_name: &str) -> String {
    format!("{name}@{team_name}")
}

fn sanitize_team_name(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

fn team_config_file_path(team_name: &str) -> String {
    Paths::in_config_dir(&format!(
        "teams/{}/config.json",
        sanitize_team_name(team_name)
    ))
    .to_string_lossy()
    .to_string()
}

fn generate_team_name_slug() -> String {
    const ADJECTIVES: &[&str] = &[
        "amber", "brisk", "clear", "cosmic", "eager", "gentle", "lively", "mellow", "nimble",
        "solar", "steady", "vivid",
    ];
    const VERBS: &[&str] = &[
        "building", "charting", "crafting", "drifting", "guiding", "mapping", "racing", "shaping",
        "sparking", "spinning", "tracking", "weaving",
    ];
    const NOUNS: &[&str] = &[
        "anchor",
        "atlas",
        "beacon",
        "bridge",
        "comet",
        "harbor",
        "lighthouse",
        "meadow",
        "orbit",
        "signal",
        "summit",
        "voyager",
    ];

    let seed = Uuid::new_v4().into_bytes();
    let adjective = ADJECTIVES[usize::from(seed[0]) % ADJECTIVES.len()];
    let verb = VERBS[usize::from(seed[1]) % VERBS.len()];
    let noun = NOUNS[usize::from(seed[2]) % NOUNS.len()];
    format!("{adjective}-{verb}-{noun}")
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

    fn aliases(&self) -> &'static [&'static str] {
        TEAM_CREATE_TOOL_ALIASES
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
        let team_name = resolve_available_team_name(&team_name, &session.id).await?;

        let lead_agent_type =
            normalize_optional_text(input.agent_type).or_else(|| Some(TEAM_LEAD_NAME.to_string()));
        let team_state = TeamSessionState::new(
            team_name.clone(),
            session.id.clone(),
            normalize_optional_text(input.description),
            lead_agent_type,
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
            team_file_path: team_config_file_path(&team_name),
            lead_agent_id: format_team_agent_id(TEAM_LEAD_NAME, &team_name),
        };

        Ok(ToolResult::success(pretty_json(&output)?)
            .with_metadata("teamName", json!(output.team_name))
            .with_metadata("leadAgentId", json!(output.lead_agent_id))
            .with_metadata("taskListId", json!(team_name)))
    }
}

#[async_trait]
impl Tool for TeamDeleteTool {
    fn name(&self) -> &str {
        TEAM_DELETE_TOOL_NAME
    }

    fn aliases(&self) -> &'static [&'static str] {
        TEAM_DELETE_TOOL_ALIASES
    }

    fn description(&self) -> &str {
        "删除当前 team 协作上下文；仅 team lead 可执行。若仍有活跃成员，工具会拒绝删除，要求先逐个关闭这些成员。"
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

        let reachable_members = resolve_reachable_team_members(&team_context.team_state).await?;
        let active_members = reachable_members
            .iter()
            .filter(|member| !member.member.is_lead && member.is_active)
            .map(|member| &member.member)
            .collect::<Vec<_>>();
        if !active_members.is_empty() {
            let member_names = active_members
                .iter()
                .map(|member| member.name.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            let output = TeamDeleteOutput {
                success: false,
                message: format!(
                    "Cannot cleanup team with {} active member(s): {}. Use requestShutdown to gracefully terminate teammates first.",
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

        for member in reachable_members
            .iter()
            .filter(|member| !member.member.is_lead && !member.is_active)
        {
            save_team_membership(&member.member.agent_id, None)
                .await
                .map_err(|error| {
                    ToolError::execution_failed(format!(
                        "清理 team 成员 {} 的 membership 失败: {error}",
                        member.member.name
                    ))
                })?;
        }

        save_team_state(&team_context.lead_session_id, None)
            .await
            .map_err(|error| ToolError::execution_failed(format!("删除 team 状态失败: {error}")))?;
        let output = TeamDeleteOutput {
            success: true,
            message: format!(
                "Cleaned up directories and worktrees for team \"{}\"",
                team_context.team_state.team_name
            ),
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

    fn aliases(&self) -> &'static [&'static str] {
        LIST_PEERS_TOOL_ALIASES
    }

    fn description(&self) -> &str {
        "列出当前 team 中可通过 SendMessage 直接通信的 peers。当前 Lime runtime 只返回 team 内可达成员的名字与 `name@team` display id，不枚举上游 `uds:` / `bridge:` 这类跨会话 peer surface。"
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
            let team_name = team_context.team_state.team_name.clone();
            let peer_team_name = team_name.clone();
            let reachable_members =
                resolve_reachable_team_members(&team_context.team_state).await?;
            ListPeersOutput {
                team_name: Some(team_name),
                peers: reachable_members
                    .into_iter()
                    .filter(|member| member.member.agent_id != team_context.current_agent_id)
                    .map(|member| {
                        let name = member.member.name;
                        PeerDescriptor {
                            send_to: name.clone(),
                            agent_id: format_team_agent_id(&name, &peer_team_name),
                            name,
                            agent_type: member.member.agent_type,
                            is_lead: member.member.is_lead,
                        }
                    })
                    .collect(),
            }
        } else {
            ListPeersOutput {
                team_name: None,
                peers: Vec::new(),
            }
        };

        let peer_metadata = peers
            .peers
            .iter()
            .map(|peer| {
                json!({
                    "name": peer.name,
                    "agentId": peer.agent_id,
                    "agentType": peer.agent_type,
                    "isLead": peer.is_lead,
                    "sendTo": peer.send_to,
                })
            })
            .collect::<Vec<_>>();

        Ok(ToolResult::success(pretty_json(&peers)?)
            .with_metadata("teamName", json!(peers.team_name))
            .with_metadata("peers", json!(peer_metadata)))
    }
}

async fn resolve_available_team_name(
    team_name: &str,
    current_session_id: &str,
) -> Result<String, ToolError> {
    let sessions = SessionManager::list_sessions_by_types(&[
        SessionType::User,
        SessionType::Scheduled,
        SessionType::SubAgent,
        SessionType::Hidden,
        SessionType::Terminal,
    ])
    .await
    .map_err(|error| ToolError::execution_failed(format!("列出 sessions 失败: {error}")))?;
    let existing_names = sessions
        .into_iter()
        .filter(|session| session.id != current_session_id)
        .filter_map(|session| {
            TeamSessionState::from_extension_data(&session.extension_data)
                .map(|state| state.team_name)
        })
        .collect::<std::collections::HashSet<_>>();

    if !existing_names.contains(team_name) {
        return Ok(team_name.to_string());
    }

    for _ in 0..1000 {
        let candidate = generate_team_name_slug();
        if !existing_names.contains(&candidate) {
            return Ok(candidate);
        }
    }

    Err(ToolError::execution_failed(format!(
        "team_name \"{team_name}\" 已存在，且未能生成可用别名"
    )))
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

async fn resolve_reachable_team_members(
    team_state: &TeamSessionState,
) -> Result<Vec<ResolvedTeamMemberState>, ToolError> {
    let runtime_queue_service = require_shared_session_runtime_queue_service().ok();
    let mut resolved_members = Vec::new();

    for member in &team_state.members {
        if let Some(resolved) =
            resolve_team_member_state(member, team_state, runtime_queue_service.as_deref()).await?
        {
            resolved_members.push(resolved);
        }
    }

    Ok(resolved_members)
}

async fn resolve_team_member_state(
    member: &TeamMember,
    team_state: &TeamSessionState,
    runtime_queue_service: Option<&SessionRuntimeQueueService>,
) -> Result<Option<ResolvedTeamMemberState>, ToolError> {
    let session = match SessionManager::get_session(&member.agent_id, false).await {
        Ok(session) => session,
        Err(_) => return Ok(None),
    };

    if member.is_lead {
        let Some(lead_state) = TeamSessionState::from_extension_data(&session.extension_data)
        else {
            return Ok(None);
        };
        if session.id != team_state.lead_session_id
            || member.agent_id != team_state.lead_session_id
            || lead_state.team_name != team_state.team_name
            || lead_state.lead_session_id != team_state.lead_session_id
        {
            return Ok(None);
        }

        return Ok(Some(ResolvedTeamMemberState {
            member: member.clone(),
            is_active: false,
        }));
    }

    let Some(membership) = TeamMembershipState::from_extension_data(&session.extension_data) else {
        return Ok(None);
    };
    if membership.team_name != team_state.team_name
        || membership.lead_session_id != team_state.lead_session_id
        || membership.agent_id != member.agent_id
        || membership.name != member.name
    {
        return Ok(None);
    }

    let is_active = match runtime_queue_service {
        Some(runtime_queue_service) => {
            runtime_queue_service.has_active_turn(&member.agent_id)
                || !runtime_queue_service
                    .list_queued_turns(&member.agent_id)
                    .await
                    .map_err(|error| {
                        ToolError::execution_failed(format!(
                            "读取 team 成员 {} 的运行队列失败: {error}",
                            member.name
                        ))
                    })?
                    .is_empty()
        }
        None => true,
    };

    Ok(Some(ResolvedTeamMemberState {
        member: member.clone(),
        is_active,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{
        initialize_shared_thread_runtime_store, require_shared_session_runtime_queue_service,
        save_team_membership, InMemoryThreadRuntimeStore, QueuedTurnRuntime, SessionType,
        TeamMember, TEAM_LEAD_NAME,
    };
    use std::collections::HashMap;
    use std::sync::Arc;
    use tempfile::tempdir;
    use uuid::Uuid;

    fn queued_turn(session_id: &str, queued_turn_id: &str) -> QueuedTurnRuntime {
        QueuedTurnRuntime {
            queued_turn_id: queued_turn_id.to_string(),
            session_id: session_id.to_string(),
            message_preview: format!("preview-{queued_turn_id}"),
            message_text: format!("message-{queued_turn_id}"),
            created_at: 1,
            image_count: 0,
            payload: json!({ "queuedTurnId": queued_turn_id }),
            metadata: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn team_create_persists_team_state() -> anyhow::Result<()> {
        let temp_dir = tempdir()?;
        let team_name = format!("alpha-{}", Uuid::new_v4().simple());
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
                    "team_name": team_name,
                    "description": "协作测试",
                    "agent_type": "leader"
                }),
                &context,
            )
            .await?;

        assert!(result.success);
        let output: Value = serde_json::from_str(result.output.as_deref().unwrap())?;
        assert_eq!(
            output["lead_agent_id"],
            json!(format!("team-lead@{team_name}"))
        );
        let team_file_path = output["team_file_path"]
            .as_str()
            .expect("team_file_path should be a string")
            .replace('\\', "/");
        assert!(team_file_path.ends_with(&format!(
            "/teams/{}/config.json",
            sanitize_team_name(&team_name)
        )));
        let updated = SessionManager::get_session(&session.id, false).await?;
        let team_state = TeamSessionState::from_extension_data(&updated.extension_data)
            .expect("team state should exist");
        assert_eq!(team_state.team_name, team_name);
        assert_eq!(team_state.members[0].name, TEAM_LEAD_NAME);
        Ok(())
    }

    #[tokio::test]
    async fn team_create_generates_slug_when_team_name_conflicts() -> anyhow::Result<()> {
        let temp_dir = tempdir()?;
        let team_name = format!("alpha-{}", Uuid::new_v4().simple());
        let first = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-create-collision-first-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;
        let second = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-create-collision-second-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;

        let first_context =
            ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&first.id);
        let second_context =
            ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&second.id);

        TeamCreateTool::new()
            .execute(json!({ "team_name": team_name }), &first_context)
            .await?;

        let result = TeamCreateTool::new()
            .execute(json!({ "team_name": team_name }), &second_context)
            .await?;

        let output: Value = serde_json::from_str(result.output.as_deref().unwrap())?;
        let generated_name = output["team_name"]
            .as_str()
            .expect("team_name should be a string");
        assert_ne!(generated_name, team_name);
        assert!(!generated_name.starts_with(&format!("{team_name}-")));
        assert_eq!(
            output["lead_agent_id"],
            json!(format!("team-lead@{generated_name}"))
        );
        Ok(())
    }

    #[tokio::test]
    async fn team_create_defaults_lead_agent_type_to_team_lead() -> anyhow::Result<()> {
        let temp_dir = tempdir()?;
        let team_name = format!("alpha-default-{}", Uuid::new_v4().simple());
        let session = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-create-default-type-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;
        let context = ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&session.id);

        TeamCreateTool::new()
            .execute(
                json!({
                    "team_name": team_name
                }),
                &context,
            )
            .await?;

        let updated = SessionManager::get_session(&session.id, false).await?;
        let team_state = TeamSessionState::from_extension_data(&updated.extension_data)
            .expect("team state should exist");
        assert_eq!(
            team_state.members[0].agent_type.as_deref(),
            Some(TEAM_LEAD_NAME)
        );
        Ok(())
    }

    #[tokio::test]
    async fn team_delete_refuses_when_members_remain() -> anyhow::Result<()> {
        let temp_dir = tempdir()?;
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-delete-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;
        let child = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-delete-child-{}", Uuid::new_v4()),
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

        require_shared_session_runtime_queue_service()?
            .submit_turn(
                queued_turn(&child.id, &format!("queued-{}", Uuid::new_v4())),
                true,
            )
            .await?;

        let context = ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&lead.id);
        let result = TeamDeleteTool::new().execute(json!({}), &context).await?;

        assert!(result.success);
        assert_eq!(result.metadata["success"], json!(false));
        assert_eq!(result.metadata["activeMembers"], json!(["researcher"]));
        Ok(())
    }

    #[tokio::test]
    async fn team_delete_succeeds_when_members_are_idle_and_clears_membership() -> anyhow::Result<()>
    {
        let temp_dir = tempdir()?;
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-delete-idle-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;
        let child = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-delete-idle-child-{}", Uuid::new_v4()),
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

        let context = ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&lead.id);
        let result = TeamDeleteTool::new().execute(json!({}), &context).await?;

        assert!(result.success);
        assert_eq!(result.metadata["success"], json!(true));

        let updated_lead = SessionManager::get_session(&lead.id, false).await?;
        assert!(TeamSessionState::from_extension_data(&updated_lead.extension_data).is_none());

        let updated_child = SessionManager::get_session(&child.id, false).await?;
        assert!(TeamMembershipState::from_extension_data(&updated_child.extension_data).is_none());
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
        assert_eq!(peers[0]["agentId"], json!("team-lead@alpha"));
        Ok(())
    }

    #[tokio::test]
    async fn list_peers_skips_stale_members_without_membership() -> anyhow::Result<()> {
        let temp_dir = tempdir()?;
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-list-stale-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;
        let child = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-list-stale-child-{}", Uuid::new_v4()),
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

        let context = ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&lead.id);
        let result = ListPeersTool::new().execute(json!({}), &context).await?;

        assert!(result.success);
        let peers = result.metadata["peers"]
            .as_array()
            .expect("peers metadata should be an array");
        assert!(peers.is_empty());
        Ok(())
    }
}
