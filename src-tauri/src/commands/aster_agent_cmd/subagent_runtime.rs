use super::*;
use chrono::Utc;
use lime_agent::restore_aster_runtime_queued_turns;
use lime_agent::AgentEvent as RuntimeAgentEvent;
use serde_json::json;
use std::ffi::OsStr;
use std::process::Output;
use tokio::process::Command;

const SUBAGENT_RUNTIME_EVENT_PREFIX: &str = "agent_subagent_stream";
const SUBAGENT_STATUS_EVENT_PREFIX: &str = "agent_subagent_status";
const SUBAGENT_CONTROL_CLOSE_REASON: &str = "close_agent";
const DEFAULT_MANAGED_SESSION_EVENT_NAME: &str = "agent_stream";
const DEFAULT_WAIT_AGENT_TIMEOUT_MS: i64 = 30_000;
const MIN_WAIT_AGENT_TIMEOUT_MS: i64 = 1_000;
const MAX_WAIT_AGENT_TIMEOUT_MS: i64 = 300_000;

fn resolve_spawn_working_dir(
    parent_working_dir: &std::path::Path,
    requested_cwd: Option<String>,
) -> Result<std::path::PathBuf, String> {
    let Some(cwd) = normalize_optional_text(requested_cwd) else {
        return Ok(parent_working_dir.to_path_buf());
    };

    let path = std::path::PathBuf::from(&cwd);
    if !path.is_absolute() {
        return Err("cwd 必须是绝对路径".to_string());
    }
    if !path.is_dir() {
        return Err(format!("cwd 不是有效目录: {cwd}"));
    }

    Ok(path)
}

fn resolve_subagent_session_bootstrap_working_dir(
    _parent_working_dir: &Path,
    execution_working_dir: &Path,
    _effective_isolation: Option<&str>,
) -> PathBuf {
    execution_working_dir.to_path_buf()
}

#[derive(Debug, Clone, Serialize)]
struct SubagentStatusChangedEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    session_id: String,
    root_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_session_id: Option<String>,
    status: SubagentRuntimeStatusKind,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RuntimeControlMessage {
    PlanApprovalRequest {
        from: String,
        #[serde(alias = "requestId")]
        request_id: String,
        #[serde(alias = "planFilePath")]
        plan_file_path: String,
        #[serde(alias = "planContent")]
        plan_content: String,
        timestamp: Option<String>,
    },
    PlanApprovalResponse {
        #[serde(alias = "requestId")]
        request_id: String,
        #[serde(alias = "approved")]
        approve: bool,
        #[serde(default)]
        feedback: Option<String>,
        #[serde(default, alias = "permissionMode")]
        permission_mode: Option<String>,
        timestamp: Option<String>,
    },
    ShutdownResponse {
        #[serde(alias = "requestId")]
        request_id: String,
        approve: bool,
        #[serde(default)]
        reason: Option<String>,
    },
    ShutdownApproved {
        from: String,
        #[serde(alias = "requestId")]
        request_id: String,
        timestamp: Option<String>,
    },
    ShutdownRejected {
        from: String,
        #[serde(alias = "requestId")]
        request_id: String,
        reason: String,
        timestamp: Option<String>,
    },
}

fn parse_runtime_control_message(message: &str) -> Option<RuntimeControlMessage> {
    serde_json::from_str::<RuntimeControlMessage>(message).ok()
}

fn reject_unsupported_managed_session_control_message(message: &str) -> Option<String> {
    match parse_runtime_control_message(message) {
        Some(RuntimeControlMessage::ShutdownResponse { .. }) => Some(
            "当前 runtime 尚未支持把 shutdown_response 路由给 managed session lead；目前仅 teammate 的 plan_approval_request 与 plain-text / xml-wrapped peer messages 已进入 current".to_string(),
        ),
        Some(RuntimeControlMessage::PlanApprovalResponse { .. }) => Some(
            "plan_approval_response 必须发送回等待审批的 teammate session，不能发给 managed session".to_string(),
        ),
        _ => None,
    }
}

pub(crate) struct SubagentControlRuntime {
    app_handle: AppHandle,
    state: AsterAgentState,
    pub(crate) db: DbConnection,
    api_key_provider_service: ApiKeyProviderServiceState,
    logs: LogState,
    config_manager: GlobalConfigManagerState,
    mcp_manager: McpManagerState,
    automation_state: AutomationServiceState,
}

impl std::fmt::Debug for SubagentControlRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SubagentControlRuntime")
            .field("app_handle", &"<tauri-app-handle>")
            .field("state", &"<aster-agent-state>")
            .field("db", &"<db-connection>")
            .field("api_key_provider_service", &"<api-key-provider-service>")
            .field("logs", &"<log-state>")
            .field("config_manager", &"<global-config-manager>")
            .field("mcp_manager", &"<mcp-manager>")
            .field("automation_state", &"<automation-state>")
            .finish()
    }
}

impl Clone for SubagentControlRuntime {
    fn clone(&self) -> Self {
        Self {
            app_handle: self.app_handle.clone(),
            state: self.state.clone(),
            db: self.db.clone(),
            api_key_provider_service: ApiKeyProviderServiceState(
                self.api_key_provider_service.0.clone(),
            ),
            logs: self.logs.clone(),
            config_manager: GlobalConfigManagerState(self.config_manager.0.clone()),
            mcp_manager: self.mcp_manager.clone(),
            automation_state: self.automation_state.clone(),
        }
    }
}

impl SubagentControlRuntime {
    pub(crate) fn new(
        app_handle: AppHandle,
        state: &AsterAgentState,
        db: &DbConnection,
        api_key_provider_service: &ApiKeyProviderServiceState,
        logs: &LogState,
        config_manager: &GlobalConfigManagerState,
        mcp_manager: &McpManagerState,
        automation_state: &AutomationServiceState,
    ) -> Self {
        Self {
            app_handle,
            state: state.clone(),
            db: db.clone(),
            api_key_provider_service: ApiKeyProviderServiceState(
                api_key_provider_service.0.clone(),
            ),
            logs: logs.clone(),
            config_manager: GlobalConfigManagerState(config_manager.0.clone()),
            mcp_manager: mcp_manager.clone(),
            automation_state: automation_state.clone(),
        }
    }

    async fn ensure_initialized(&self) -> Result<(), String> {
        self.state.init_agent_with_db(&self.db).await
    }

    fn runtime_command_context(&self) -> RuntimeCommandContext {
        RuntimeCommandContext::new(
            self.app_handle.clone(),
            &self.state,
            &self.db,
            &self.api_key_provider_service,
            &self.logs,
            &self.config_manager,
            &self.mcp_manager,
            &self.automation_state,
        )
    }
}

fn normalize_required_text(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        Err(format!("{field_name} 不能为空"))
    } else {
        Ok(trimmed)
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let count = value.chars().count();
    if count <= max_chars {
        return value.to_string();
    }
    if max_chars <= 3 {
        return value.chars().take(max_chars).collect();
    }
    let truncated = value.chars().take(max_chars - 3).collect::<String>();
    format!("{truncated}...")
}

fn build_subagent_task_summary(message: &str) -> Option<String> {
    let normalized = normalize_whitespace(message);
    if normalized.is_empty() {
        None
    } else {
        Some(truncate_chars(&normalized, 120))
    }
}

fn normalize_optional_vec(values: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();

    for value in values {
        let Some(item) = normalize_optional_text(Some(value.clone())) else {
            continue;
        };
        if seen.insert(item.clone()) {
            normalized.push(item);
        }
    }

    normalized
}

fn normalize_frontmatter_hooks(
    hooks: Option<aster::hooks::FrontmatterHooks>,
) -> Option<aster::hooks::FrontmatterHooks> {
    let hooks = hooks?;
    let normalized = hooks
        .into_iter()
        .filter_map(|(event, matchers)| {
            let matchers = matchers
                .into_iter()
                .filter(|matcher| !matcher.hooks.is_empty())
                .collect::<Vec<_>>();
            if matchers.is_empty() {
                None
            } else {
                Some((event, matchers))
            }
        })
        .collect::<aster::hooks::FrontmatterHooks>();

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn register_runtime_subagent_frontmatter_hooks(
    session_id: &str,
    hooks: Option<&aster::hooks::FrontmatterHooks>,
) {
    let Some(hooks) = hooks else {
        return;
    };

    let report = aster::hooks::register_agent_session_frontmatter_hooks(session_id, hooks);
    if report.registered > 0 {
        tracing::info!(
            "[AsterAgent][Subagent] 已为 child session={} 注册 {} 个 agent frontmatter hooks",
            session_id,
            report.registered
        );
    }
    for skipped in report.skipped {
        tracing::warn!(
            "[AsterAgent][Subagent] 跳过 child session={} 的 agent frontmatter hook: {}",
            session_id,
            skipped
        );
    }
}

fn validate_spawn_request_surface(
    request: &AgentRuntimeSpawnSubagentRequest,
) -> Result<(), String> {
    if normalize_optional_text(request.team_name.clone()).is_some()
        && normalize_optional_text(request.name.clone()).is_none()
    {
        return Err("team_name 需要同时提供 name".to_string());
    }

    if spawn_request_requests_plan_mode(request)
        && normalize_optional_text(request.name.clone()).is_some()
    {
        resolve_spawn_request_access_mode_override(
            normalize_optional_text(request.mode.clone()).as_deref(),
            true,
        )?;
        return Ok(());
    }

    resolve_spawn_request_access_mode_override(
        normalize_optional_text(request.mode.clone()).as_deref(),
        false,
    )?;

    Ok(())
}

fn build_subagent_session_name(
    explicit_name: Option<&str>,
    message: &str,
    agent_type: Option<&str>,
    blueprint_role_label: Option<&str>,
    profile_name: Option<&str>,
) -> String {
    normalize_optional_text(explicit_name.map(ToString::to_string))
        .or_else(|| normalize_optional_text(agent_type.map(ToString::to_string)))
        .or_else(|| normalize_optional_text(blueprint_role_label.map(ToString::to_string)))
        .or_else(|| normalize_optional_text(profile_name.map(ToString::to_string)))
        .or_else(|| build_subagent_task_summary(message))
        .unwrap_or_else(|| "子代理".to_string())
}

fn spawn_request_requests_plan_mode(request: &AgentRuntimeSpawnSubagentRequest) -> bool {
    normalize_optional_text(request.mode.clone())
        .as_deref()
        .is_some_and(|mode| mode.eq_ignore_ascii_case("plan"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedTeammateSpawnRequest {
    teammate_name: Option<String>,
    team_name: Option<String>,
    teammate_plan_mode: bool,
}

async fn resolve_effective_teammate_spawn_request(
    parent_session_id: &str,
    request: &AgentRuntimeSpawnSubagentRequest,
) -> Result<ResolvedTeammateSpawnRequest, String> {
    let teammate_name = normalize_optional_text(request.name.clone());
    let explicit_team_name = normalize_optional_text(request.team_name.clone());
    if explicit_team_name.is_some() && teammate_name.is_none() {
        return Err("team_name 需要同时提供 name".to_string());
    }

    let plan_mode_requested = spawn_request_requests_plan_mode(request);
    let team_context = if explicit_team_name.is_some() || teammate_name.is_some() {
        aster::session::resolve_team_context(parent_session_id)
            .await
            .map_err(|error| format!("读取 team 状态失败: {error}"))?
    } else {
        None
    };
    let inferred_team_name = if explicit_team_name.is_none() && teammate_name.is_some() {
        team_context
            .as_ref()
            .filter(|context| context.is_lead)
            .map(|context| context.team_state.team_name.clone())
    } else {
        None
    };
    let effective_team_name = explicit_team_name.or(inferred_team_name);

    if let Some(team_name) = effective_team_name.as_deref() {
        let Some(team_context) = team_context.as_ref() else {
            return Err("当前 session 还没有 team 上下文，请先建立 team".to_string());
        };
        if !team_context.is_lead {
            return Err("当前 runtime 只允许 team lead session 创建 teammate".to_string());
        }
        if team_context.team_state.team_name != team_name {
            return Err(format!(
                "team_name 不匹配：当前 team 为 {}，但请求的是 {}",
                team_context.team_state.team_name, team_name
            ));
        }
    }

    if plan_mode_requested && (teammate_name.is_none() || effective_team_name.is_none()) {
        return Err(
            "mode `plan` is only supported for team teammates in the current runtime".to_string(),
        );
    }

    Ok(ResolvedTeammateSpawnRequest {
        teammate_name,
        team_name: effective_team_name,
        teammate_plan_mode: plan_mode_requested,
    })
}

fn resolve_subagent_role_hint(
    request: &AgentRuntimeSpawnSubagentRequest,
    customization: Option<&SubagentCustomizationState>,
) -> Option<String> {
    normalize_optional_text(request.name.clone())
        .or_else(|| normalize_optional_text(request.agent_type.clone()))
        .or_else(|| customization.and_then(|state| state.blueprint_role_label.clone()))
        .or_else(|| customization.and_then(|state| state.profile_name.clone()))
        .or_else(|| customization.and_then(|state| state.role_key.clone()))
}

async fn register_spawned_teammate(
    parent_session_id: &str,
    child_session_id: &str,
    team_name: String,
    teammate_name: String,
    agent_type: Option<String>,
) -> Result<(), String> {
    let parent_session = read_session(parent_session_id, false, "读取父会话失败").await?;
    let Some(mut team_state) = aster::session::TeamSessionState::from_session(&parent_session)
    else {
        return Err("当前 session 还没有 team 上下文，请先建立 team".to_string());
    };

    if team_state.team_name != team_name {
        return Err(format!(
            "team_name 不匹配：当前 team 为 {}，但请求的是 {}",
            team_state.team_name, team_name
        ));
    }
    if team_state.find_member_by_name(&teammate_name).is_some() {
        return Err(format!("team 中已存在名为 {teammate_name} 的成员"));
    }

    team_state.add_or_update_member(aster::session::TeamMember::teammate(
        child_session_id.to_string(),
        teammate_name.clone(),
        agent_type.clone(),
    ));
    aster::session::save_team_state(parent_session_id, Some(team_state))
        .await
        .map_err(|error| format!("更新 team 状态失败: {error}"))?;
    aster::session::save_team_membership(
        child_session_id,
        Some(aster::session::TeamMembershipState {
            team_name,
            lead_session_id: parent_session_id.to_string(),
            agent_id: child_session_id.to_string(),
            name: teammate_name,
            agent_type,
        }),
    )
    .await
    .map_err(|error| format!("保存 team 成员信息失败: {error}"))?;

    Ok(())
}

fn build_local_subagent_skill_payload(
    directory: &str,
) -> Result<(SubagentSkillSummary, SubagentSkillPromptBlock), String> {
    let inspection = crate::commands::skill_cmd::inspect_local_skill_for_app(
        "lime".to_string(),
        directory.to_string(),
    )
    .map_err(|error| format!("读取本地 skill 失败 `{directory}`: {error}"))?;
    let name = inspection
        .metadata
        .get("name")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(directory)
        .to_string();
    let description = inspection
        .metadata
        .get("description")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let title = format!("local skill · {name} ({directory})");

    Ok((
        SubagentSkillSummary {
            id: format!("local:{directory}"),
            name,
            description,
            source: Some("local".to_string()),
            directory: Some(directory.to_string()),
        },
        SubagentSkillPromptBlock {
            title,
            content: inspection.content,
        },
    ))
}

#[cfg(test)]
pub(crate) fn build_subagent_customization_state(
    request: &AgentRuntimeSpawnSubagentRequest,
) -> Result<Option<SubagentCustomizationState>, String> {
    build_subagent_customization_state_with_plugin_agent(request, None)
}

pub(crate) fn build_subagent_customization_state_with_plugin_agent(
    request: &AgentRuntimeSpawnSubagentRequest,
    plugin_agent: Option<&RuntimePluginAgentDefinition>,
) -> Result<Option<SubagentCustomizationState>, String> {
    let blueprint_role_id = normalize_optional_text(request.blueprint_role_id.clone());
    let blueprint_role_label = normalize_optional_text(request.blueprint_role_label.clone());
    let profile_id = normalize_optional_text(request.profile_id.clone());
    let profile = profile_id
        .as_deref()
        .and_then(builtin_profile_descriptor_by_id);
    let team_preset_id = normalize_optional_text(request.team_preset_id.clone());
    let team_preset = team_preset_id
        .as_deref()
        .and_then(builtin_team_preset_descriptor_by_id);
    let mut skill_ids = profile
        .map(|descriptor| {
            descriptor
                .skill_ids
                .iter()
                .map(|skill_id| (*skill_id).to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    skill_ids.extend(normalize_optional_vec(&request.skill_ids));
    let skill_ids = normalize_optional_vec(&skill_ids);
    let skill_directories = normalize_optional_vec(&request.skill_directories);
    let hooks = normalize_frontmatter_hooks(request.hooks.clone());
    let requested_allowed_tools = normalize_optional_vec(&request.allowed_tools);
    let requested_disallowed_tools = normalize_optional_vec(&request.disallowed_tools);
    let allowed_tools = merge_plugin_agent_allowed_tools(
        plugin_agent.map(|agent| agent.allowed_tools.as_slice()),
        &requested_allowed_tools,
    );
    let disallowed_tools = merge_plugin_agent_disallowed_tools(
        plugin_agent.map(|agent| agent.disallowed_tools.as_slice()),
        &requested_disallowed_tools,
    );

    let mut skills = skill_ids
        .iter()
        .map(|skill_id| {
            summarize_builtin_skill(skill_id).unwrap_or(SubagentSkillSummary {
                id: skill_id.clone(),
                name: skill_id.clone(),
                description: None,
                source: Some("requested".to_string()),
                directory: None,
            })
        })
        .collect::<Vec<_>>();

    for directory in &skill_directories {
        let (summary, _) = build_local_subagent_skill_payload(directory)?;
        skills.push(summary);
    }

    let state = SubagentCustomizationState {
        blueprint_role_id,
        blueprint_role_label,
        profile_id,
        profile_name: normalize_optional_text(request.profile_name.clone())
            .or_else(|| profile.map(|descriptor| descriptor.name.to_string())),
        role_key: normalize_optional_text(request.role_key.clone())
            .or_else(|| profile.map(|descriptor| descriptor.role_key.to_string())),
        team_preset_id,
        theme: normalize_optional_text(request.theme.clone())
            .or_else(|| profile.map(|descriptor| descriptor.theme.to_string()))
            .or_else(|| team_preset.map(|descriptor| descriptor.theme.to_string())),
        output_contract: normalize_optional_text(request.output_contract.clone())
            .or_else(|| profile.map(|descriptor| descriptor.output_contract.to_string())),
        system_overlay: merge_optional_prompt_sections(
            plugin_agent.map(|agent| agent.system_prompt.as_str()),
            normalize_optional_text(request.system_overlay.clone())
                .or_else(|| profile.map(|descriptor| descriptor.system_overlay.to_string()))
                .as_deref(),
        ),
        skill_ids,
        skills,
        hooks,
        allowed_tools,
        disallowed_tools,
    };

    if state.is_empty() {
        Ok(None)
    } else {
        Ok(Some(state))
    }
}

fn merge_optional_prompt_sections(base: Option<&str>, appended: Option<&str>) -> Option<String> {
    let base = base.map(str::trim).filter(|value| !value.is_empty());
    let appended = appended.map(str::trim).filter(|value| !value.is_empty());
    match (base, appended) {
        (Some(base), Some(appended)) => Some(format!("{base}\n\n{appended}")),
        (Some(base), None) => Some(base.to_string()),
        (None, Some(appended)) => Some(appended.to_string()),
        (None, None) => None,
    }
}

fn merge_plugin_agent_allowed_tools(
    plugin_allowed_tools: Option<&[String]>,
    requested_allowed_tools: &[String],
) -> Vec<String> {
    let plugin_allowed_tools = plugin_allowed_tools.unwrap_or(&[]);
    if plugin_allowed_tools.is_empty() {
        return requested_allowed_tools.to_vec();
    }
    if requested_allowed_tools.is_empty() {
        return plugin_allowed_tools.to_vec();
    }

    let requested = requested_allowed_tools.iter().collect::<HashSet<_>>();
    plugin_allowed_tools
        .iter()
        .filter(|tool| requested.contains(tool))
        .cloned()
        .collect()
}

fn merge_plugin_agent_disallowed_tools(
    plugin_disallowed_tools: Option<&[String]>,
    requested_disallowed_tools: &[String],
) -> Vec<String> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();

    for tool in plugin_disallowed_tools.unwrap_or(&[]) {
        if seen.insert(tool.clone()) {
            merged.push(tool.clone());
        }
    }
    for tool in requested_disallowed_tools {
        if seen.insert(tool.clone()) {
            merged.push(tool.clone());
        }
    }

    merged
}

pub(crate) fn build_subagent_customization_system_prompt(
    customization: Option<&SubagentCustomizationState>,
) -> Result<Option<String>, String> {
    let Some(customization) = customization else {
        return Ok(None);
    };

    let mut local_skill_blocks = Vec::new();
    for skill in &customization.skills {
        let Some(directory) = skill.directory.as_deref() else {
            continue;
        };
        let (_, block) = build_local_subagent_skill_payload(directory)?;
        local_skill_blocks.push(block);
    }

    Ok(build_subagent_customization_prompt(
        customization,
        &local_skill_blocks,
    ))
}

fn build_runtime_subagent_system_prompt(
    customization: Option<&SubagentCustomizationState>,
    plan_mode_active: bool,
) -> Result<Option<String>, String> {
    let base_prompt = build_subagent_customization_system_prompt(customization)?;
    if !plan_mode_active {
        return Ok(base_prompt);
    }

    Ok(merge_optional_prompt_sections(
        base_prompt.as_deref(),
        Some(aster::prompt::templates::permission_modes::PLAN),
    ))
}

#[derive(Debug, Clone)]
struct PreparedRuntimeSubagentSession {
    session: aster::session::Session,
    customization: Option<SubagentCustomizationState>,
    system_prompt: Option<String>,
    access_mode: lime_agent::SessionExecutionRuntimeAccessMode,
    effective_run_in_background: bool,
    effective_isolation: Option<String>,
    effective_team_name: Option<String>,
}

fn build_subagent_runtime_event_name(session_id: &str) -> String {
    format!("{SUBAGENT_RUNTIME_EVENT_PREFIX}:{session_id}")
}

fn build_subagent_status_event_name(session_id: &str) -> String {
    format!("{SUBAGENT_STATUS_EVENT_PREFIX}:{session_id}")
}

fn parse_subagent_runtime_event_session_id(event_name: &str) -> Option<&str> {
    event_name
        .strip_prefix(SUBAGENT_RUNTIME_EVENT_PREFIX)
        .and_then(|rest| rest.strip_prefix(':'))
}

fn resolve_subagent_request_access_mode(
    session_id: &str,
    session: &aster::session::Session,
) -> lime_agent::SessionExecutionRuntimeAccessMode {
    lime_agent::build_session_execution_runtime(session_id, Some(session), None, None, None)
        .and_then(|runtime| runtime.recent_access_mode)
        .unwrap_or_else(lime_agent::SessionExecutionRuntimeAccessMode::default_for_session)
}

fn resolve_spawn_request_access_mode_override(
    mode: Option<&str>,
    allow_teammate_plan_mode: bool,
) -> Result<Option<lime_agent::SessionExecutionRuntimeAccessMode>, String> {
    let Some(mode) = mode.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if mode.eq_ignore_ascii_case("default") {
        return Ok(None);
    }
    if mode.eq_ignore_ascii_case("acceptEdits") || mode.eq_ignore_ascii_case("accept_edits") {
        return Ok(Some(lime_agent::SessionExecutionRuntimeAccessMode::Current));
    }
    if mode.eq_ignore_ascii_case("dontAsk") || mode.eq_ignore_ascii_case("dont_ask") {
        return Ok(Some(
            lime_agent::SessionExecutionRuntimeAccessMode::FullAccess,
        ));
    }
    if mode.eq_ignore_ascii_case("plan") {
        if allow_teammate_plan_mode {
            return Ok(None);
        }
        return Err(
            "mode `plan` is only supported for team teammates in the current runtime".to_string(),
        );
    }
    if mode.eq_ignore_ascii_case("bypassPermissions")
        || mode.eq_ignore_ascii_case("bypass_permissions")
    {
        return Err("mode `bypassPermissions` is not supported in the current runtime".to_string());
    }

    Err(format!(
        "mode `{mode}` is not supported in the current runtime; supported values: default, acceptEdits, dontAsk"
    ))
}

fn resolve_spawn_request_access_mode(
    session_id: &str,
    session: &aster::session::Session,
    request_mode: Option<&str>,
    allow_teammate_plan_mode: bool,
) -> Result<lime_agent::SessionExecutionRuntimeAccessMode, String> {
    Ok(
        resolve_spawn_request_access_mode_override(request_mode, allow_teammate_plan_mode)?
            .unwrap_or_else(|| resolve_subagent_request_access_mode(session_id, session)),
    )
}

fn should_emit_subagent_status_for_runtime_event(event: &RuntimeAgentEvent) -> bool {
    matches!(
        event,
        RuntimeAgentEvent::ThreadStarted { .. }
            | RuntimeAgentEvent::TurnStarted { .. }
            | RuntimeAgentEvent::TurnCompleted { .. }
            | RuntimeAgentEvent::TurnFailed { .. }
            | RuntimeAgentEvent::QueueAdded { .. }
            | RuntimeAgentEvent::QueueRemoved { .. }
            | RuntimeAgentEvent::QueueStarted { .. }
            | RuntimeAgentEvent::QueueCleared { .. }
    )
}

pub(crate) async fn emit_subagent_status_changed_events(app: &AppHandle, session_id: &str) {
    let status = match load_subagent_runtime_status(session_id).await {
        Ok(status) => status,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent][Subagent] 读取 team runtime 状态失败: session_id={}, error={}",
                session_id,
                error
            );
            return;
        }
    };
    let scope_ids = list_subagent_status_scope_session_ids(session_id).await;
    let root_session_id = scope_ids
        .last()
        .cloned()
        .unwrap_or_else(|| session_id.to_string());
    let event = SubagentStatusChangedEvent {
        event_type: "subagent_status_changed",
        session_id: session_id.to_string(),
        root_session_id,
        parent_session_id: scope_ids.get(1).cloned(),
        status: status.kind,
    };

    for scope_session_id in scope_ids {
        if let Err(error) = app.emit(&build_subagent_status_event_name(&scope_session_id), &event) {
            tracing::warn!(
                "[AsterAgent][Subagent] 发送 team 状态事件失败: scope_session_id={}, session_id={}, error={}",
                scope_session_id,
                session_id,
                error
            );
        }
    }
}

fn build_target_runtime_event_name(session: &aster::session::Session) -> String {
    if matches!(session.session_type, SessionType::SubAgent) {
        build_subagent_runtime_event_name(&session.id)
    } else {
        DEFAULT_MANAGED_SESSION_EVENT_NAME.to_string()
    }
}

fn build_runtime_control_submission_id(prefix: &str, session_id: &str, request_id: &str) -> String {
    format!("{prefix}:{session_id}:{request_id}")
}

fn escape_xml_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn build_runtime_teammate_message(sender: &str, message: &str) -> String {
    format!(
        "<teammate-message teammate_id=\"{}\">\n{}\n</teammate-message>",
        escape_xml_attribute(sender),
        message
    )
}

fn extract_runtime_request_target(request_id: &str) -> Option<&str> {
    let (_, target) = request_id.rsplit_once('@')?;
    let target = target.trim();
    if target.is_empty() {
        None
    } else {
        Some(target)
    }
}

async fn maybe_handle_plan_approval_request_for_lead(
    runtime: &SubagentControlRuntime,
    session: &aster::session::Session,
    message: &str,
) -> Result<Option<AgentRuntimeSendSubagentInputResponse>, String> {
    let Some(RuntimeControlMessage::PlanApprovalRequest {
        from, request_id, ..
    }) = parse_runtime_control_message(message)
    else {
        return Ok(None);
    };

    let Some(team_context) = aster::session::resolve_team_context(&session.id)
        .await
        .map_err(|error| format!("读取 team 状态失败: {error}"))?
    else {
        return Ok(None);
    };
    if !team_context.is_lead {
        return Ok(None);
    }
    let Some(teammate) = team_context.team_state.find_member_by_name(&from) else {
        return Err(format!(
            "team `{}` 中不存在名为 `{from}` 的成员",
            team_context.team_state.team_name
        ));
    };

    let response_message = serde_json::to_string(&json!({
        "type": "plan_approval_response",
        "request_id": request_id,
        "approve": true,
        "timestamp": Utc::now().to_rfc3339(),
    }))
    .map_err(|error| format!("序列化计划审批响应失败: {error}"))?;
    let response = Box::pin(agent_runtime_send_subagent_input_internal(
        runtime,
        AgentRuntimeSendSubagentInputRequest {
            id: teammate.agent_id.clone(),
            message: response_message,
            interrupt: false,
        },
    ))
    .await?;

    Ok(Some(AgentRuntimeSendSubagentInputResponse {
        submission_id: if response.submission_id.trim().is_empty() {
            build_runtime_control_submission_id("plan_approval_request", &session.id, &request_id)
        } else {
            response.submission_id
        },
    }))
}

async fn maybe_handle_plan_approval_response_for_teammate(
    runtime: &SubagentControlRuntime,
    session: &aster::session::Session,
    message: &str,
) -> Result<Option<AgentRuntimeSendSubagentInputResponse>, String> {
    let Some(RuntimeControlMessage::PlanApprovalResponse {
        request_id,
        approve,
        ..
    }) = parse_runtime_control_message(message)
    else {
        return Ok(None);
    };

    let Some(state) = aster::session::SessionPlanModeState::from_session(session) else {
        return Ok(None);
    };
    if !state.active
        || !state.awaiting_leader_approval
        || state.pending_request_id.as_deref() != Some(request_id.as_str())
    {
        return Ok(None);
    }

    let next_state = if approve {
        None
    } else {
        Some(aster::session::SessionPlanModeState {
            active: true,
            plan_file: state.plan_file.clone(),
            plan_id: state.plan_id.clone(),
            awaiting_leader_approval: false,
            pending_request_id: None,
        })
    };
    aster::session::save_session_plan_mode_state(&session.id, next_state)
        .await
        .map_err(|error| format!("更新 teammate plan mode 状态失败: {error}"))?;
    if matches!(session.session_type, SessionType::SubAgent) {
        emit_subagent_status_changed_events(&runtime.app_handle, &session.id).await;
    }

    Ok(Some(AgentRuntimeSendSubagentInputResponse {
        submission_id: build_runtime_control_submission_id(
            "plan_approval_response",
            &session.id,
            &request_id,
        ),
    }))
}

async fn maybe_handle_shutdown_response_for_lead(
    runtime: &SubagentControlRuntime,
    runtime_command_context: &RuntimeCommandContext,
    session: &aster::session::Session,
    message: &str,
) -> Result<Option<AgentRuntimeSendSubagentInputResponse>, String> {
    let (sender, request_id, should_close) = match parse_runtime_control_message(message) {
        Some(RuntimeControlMessage::ShutdownApproved {
            from, request_id, ..
        }) => (from, request_id, true),
        Some(RuntimeControlMessage::ShutdownRejected {
            from, request_id, ..
        }) => (from, request_id, false),
        _ => return Ok(None),
    };

    let Some(team_context) = aster::session::resolve_team_context(&session.id)
        .await
        .map_err(|error| format!("读取 team 状态失败: {error}"))?
    else {
        return Ok(None);
    };
    if !team_context.is_lead {
        return Ok(None);
    }

    let Some(teammate) = team_context.team_state.find_member_by_name(&sender) else {
        return Err(format!(
            "team `{}` 中不存在名为 `{sender}` 的成员",
            team_context.team_state.team_name
        ));
    };

    if let Some(target) = extract_runtime_request_target(&request_id) {
        if target != sender && target != teammate.agent_id {
            return Err(format!(
                "shutdown response request_id `{request_id}` 与 sender `{sender}` 不匹配"
            ));
        }
    }

    if should_close {
        let _ = agent_runtime_close_subagent_internal(
            runtime,
            AgentRuntimeCloseSubagentRequest {
                id: teammate.agent_id.clone(),
            },
        )
        .await?;
    }

    submit_runtime_message_to_managed_session(
        runtime,
        runtime_command_context,
        session,
        build_runtime_teammate_message(&sender, message),
        false,
    )
    .await
    .map(Some)
}

async fn submit_runtime_message_to_managed_session(
    runtime: &SubagentControlRuntime,
    runtime_command_context: &RuntimeCommandContext,
    session: &aster::session::Session,
    message: String,
    interrupt: bool,
) -> Result<AgentRuntimeSendSubagentInputResponse, String> {
    let session_id = session.id.clone();
    let access_mode = resolve_subagent_request_access_mode(&session_id, session);
    if interrupt {
        let _ = runtime.state.cancel_session(&session_id).await;
        let _ = runtime_command_context
            .clear_runtime_queue(&session_id)
            .await?;
    }

    let workspace_id =
        resolve_workspace_id_for_working_dir(&runtime.db, session.working_dir.as_path())?;
    let queued_task = build_queued_turn_task(AsterChatRequest {
        message,
        session_id: session_id.clone(),
        event_name: build_target_runtime_event_name(session),
        images: None,
        provider_config: None,
        provider_preference: None,
        model_preference: None,
        thinking_enabled: None,
        approval_policy: Some(access_mode.approval_policy().to_string()),
        sandbox_policy: Some(access_mode.sandbox_policy().to_string()),
        project_id: None,
        workspace_id,
        web_search: None,
        search_mode: None,
        execution_strategy: None,
        auto_continue: None,
        system_prompt: None,
        metadata: Some(serde_json::json!({
            "peer_message": {
                "origin_tool": "SendMessage",
                "interrupt": interrupt,
                "target_session_type": format!("{:?}", session.session_type),
            }
        })),
        turn_id: None,
        queue_if_busy: Some(true),
        queued_turn_id: None,
    })?;
    let submission_id = queued_task.queued_turn_id.clone();
    runtime_command_context
        .submit_runtime_turn(queued_task, true)
        .await?;

    Ok(AgentRuntimeSendSubagentInputResponse { submission_id })
}

pub(crate) async fn maybe_emit_subagent_status_for_runtime_event(
    app: &AppHandle,
    event_name: &str,
    event: &RuntimeAgentEvent,
) {
    let Some(session_id) = parse_subagent_runtime_event_session_id(event_name) else {
        return;
    };
    if !should_emit_subagent_status_for_runtime_event(event) {
        return;
    }
    if let Err(error) = maybe_cleanup_subagent_worktree_after_runtime_event(session_id).await {
        tracing::warn!(
            "[AsterAgent][Subagent] runtime 事件后的 worktree 自动清理失败: session_id={}, error={}",
            session_id,
            error
        );
    }
    emit_subagent_status_changed_events(app, session_id).await;
}

fn resolve_action_scope_turn_id(parent_session_id: &str) -> Option<String> {
    let scope = aster::session_context::current_action_scope()?;
    if scope.session_id.as_deref() != Some(parent_session_id) {
        return None;
    }
    normalize_optional_text(scope.turn_id)
}

fn resolve_workspace_id_for_working_dir(
    db: &DbConnection,
    working_dir: &Path,
) -> Result<String, String> {
    let manager = WorkspaceManager::new(db.clone());
    resolve_workspace_for_working_dir(&manager, working_dir)
        .map_err(|error| format!("解析 workspace 失败: {error}"))?
        .map(|workspace| workspace.id)
        .ok_or_else(|| {
            format!(
                "无法根据 working_dir 解析 workspace: {}",
                working_dir.to_string_lossy()
            )
        })
}

fn resolve_workspace_for_working_dir(
    manager: &WorkspaceManager,
    working_dir: &Path,
) -> Result<Option<lime_core::workspace::Workspace>, String> {
    if let Some(workspace) = manager.get_by_path(working_dir)? {
        return Ok(Some(workspace));
    }

    let canonical_working_dir = canonicalize_best_effort(working_dir);
    let matched = manager
        .list()?
        .into_iter()
        .filter_map(|workspace| {
            let canonical_root = canonicalize_best_effort(&workspace.root_path);
            if canonical_working_dir == canonical_root
                || canonical_working_dir.starts_with(&canonical_root)
            {
                Some((canonical_root.components().count(), workspace))
            } else {
                None
            }
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, workspace)| workspace);

    Ok(matched)
}

fn canonicalize_best_effort(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[derive(Debug, Clone)]
struct SubagentWorktreeCwdMapping {
    requested_cwd_display: String,
    relative_path: PathBuf,
}

async fn run_subagent_git<I, S>(cwd: &Path, args: I) -> Result<Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|error| format!("启动 git 失败: {error}"))
}

fn subagent_git_command_failure_text(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }

    "unknown git failure".to_string()
}

async fn subagent_git_stdout<I, S>(cwd: &Path, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = run_subagent_git(cwd, args).await?;
    if !output.status.success() {
        return Err(format!(
            "git 命令失败: {}",
            subagent_git_command_failure_text(&output)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn resolve_subagent_git_worktree_root(path: &Path) -> Result<PathBuf, String> {
    let show_toplevel = subagent_git_stdout(path, ["rev-parse", "--show-toplevel"]).await?;
    Ok(canonicalize_best_effort(Path::new(show_toplevel.trim())))
}

async fn resolve_subagent_canonical_git_root(path: &Path) -> Result<PathBuf, String> {
    let show_toplevel = subagent_git_stdout(path, ["rev-parse", "--show-toplevel"]).await?;
    let git_common_dir = subagent_git_stdout(
        path,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .await?;

    let worktree_root = canonicalize_best_effort(Path::new(show_toplevel.trim()));
    let common_dir = canonicalize_best_effort(Path::new(git_common_dir.trim()));

    Ok(match common_dir.file_name().and_then(OsStr::to_str) {
        Some(".git") => common_dir
            .parent()
            .map(canonicalize_best_effort)
            .unwrap_or(worktree_root),
        _ => worktree_root,
    })
}

async fn resolve_subagent_worktree_cwd_mapping(
    parent_working_dir: &Path,
    requested_working_dir: &Path,
    effective_isolation: Option<&str>,
    requested_cwd: Option<&str>,
) -> Result<Option<SubagentWorktreeCwdMapping>, String> {
    if effective_isolation != Some("worktree") {
        return Ok(None);
    }

    let Some(requested_cwd_display) = requested_cwd
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
    else {
        return Ok(None);
    };

    let parent_git_root = resolve_subagent_canonical_git_root(parent_working_dir)
        .await
        .map_err(|error| {
            format!(
                "cwd 当前只能与 isolation=worktree 组合在父会话同一 Git 仓库内；父会话目录无法解析 Git 根目录: {error}"
            )
        })?;
    let requested_git_root = resolve_subagent_canonical_git_root(requested_working_dir)
        .await
        .map_err(|error| {
            format!(
                "cwd 当前只能与 isolation=worktree 组合在 Git 仓库目录内；当前 cwd 无法解析 Git 根目录: {error}"
            )
        })?;

    if canonicalize_best_effort(parent_git_root.as_path())
        != canonicalize_best_effort(requested_git_root.as_path())
    {
        return Err(format!(
            "cwd 当前只能与 isolation=worktree 组合在父会话同一 Git 仓库内；当前 cwd 不属于同一仓库: {requested_cwd_display}"
        ));
    }

    let source_worktree_root = resolve_subagent_git_worktree_root(requested_working_dir)
        .await
        .map_err(|error| format!("解析 cwd 对应的 worktree 根目录失败: {error}"))?;
    let canonical_requested_working_dir = canonicalize_best_effort(requested_working_dir);
    let canonical_source_worktree_root = canonicalize_best_effort(source_worktree_root.as_path());
    let relative_path = canonical_requested_working_dir
        .strip_prefix(canonical_source_worktree_root.as_path())
        .map_err(|error| format!("计算 cwd 在 worktree 内的相对路径失败: {error}"))?
        .to_path_buf();

    Ok(Some(SubagentWorktreeCwdMapping {
        requested_cwd_display,
        relative_path,
    }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SubagentWorktreeCloseOutcome {
    NotEnabled,
    RemovedClean,
    KeptDirty,
    CleanupFailed,
}

fn build_subagent_worktree_slug(session_id: &str) -> String {
    let suffix = session_id
        .chars()
        .filter(|char| char.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>();
    if suffix.is_empty() {
        "agent-worktree".to_string()
    } else {
        format!("agent-{suffix}")
    }
}

async fn maybe_enter_subagent_worktree(
    session_id: &str,
    working_dir: &Path,
    effective_isolation: Option<&str>,
    cwd_mapping: Option<&SubagentWorktreeCwdMapping>,
) -> Result<(), String> {
    if effective_isolation != Some("worktree") {
        return Ok(());
    }

    let context =
        ToolContext::new(working_dir.to_path_buf()).with_session_id(session_id.to_string());
    aster::tools::EnterWorktreeTool::new()
        .execute(
            serde_json::json!({
                "name": build_subagent_worktree_slug(session_id),
            }),
            &context,
        )
        .await
        .map_err(|error| format!("创建 subagent worktree 失败: {error}"))?;

    if let Some(mapping) = cwd_mapping {
        if let Err(error) = remap_subagent_worktree_cwd_after_enter(session_id, mapping).await {
            if let Err(rollback_error) =
                rollback_subagent_worktree_after_spawn_failure(session_id).await
            {
                return Err(format!(
                    "{error}；另外回滚刚创建的 subagent worktree 失败: {rollback_error}"
                ));
            }
            return Err(error);
        }
    }

    Ok(())
}

fn should_preserve_subagent_worktree_on_close(error_text: &str) -> bool {
    error_text.contains("discard_changes: true") || error_text.contains("use action: \"keep\"")
}

async fn cleanup_subagent_worktree_for_close(
    session: &aster::session::Session,
) -> SubagentWorktreeCloseOutcome {
    if aster::session::WorktreeSessionState::from_extension_data(&session.extension_data).is_none()
    {
        return SubagentWorktreeCloseOutcome::NotEnabled;
    }

    let context = ToolContext::new(session.working_dir.clone()).with_session_id(session.id.clone());
    match aster::tools::ExitWorktreeTool::new()
        .execute(serde_json::json!({ "action": "remove" }), &context)
        .await
    {
        Ok(_) => SubagentWorktreeCloseOutcome::RemovedClean,
        Err(error) => {
            let error_text = error.to_string();
            if should_preserve_subagent_worktree_on_close(&error_text) {
                tracing::info!(
                    "[AsterAgent][Subagent] 关闭 child session={} 时检测到 worktree 有改动，保留现状以便后续恢复",
                    session.id
                );
                SubagentWorktreeCloseOutcome::KeptDirty
            } else {
                tracing::warn!(
                    "[AsterAgent][Subagent] 关闭 child session={} 时清理 worktree 失败，保留现状: {}",
                    session.id,
                    error_text
                );
                SubagentWorktreeCloseOutcome::CleanupFailed
            }
        }
    }
}

fn resolve_subagent_worktree_mapped_working_dir(
    state: &aster::session::WorktreeSessionState,
    mapping: &SubagentWorktreeCwdMapping,
) -> Result<PathBuf, String> {
    let worktree_path = PathBuf::from(&state.worktree_path);
    let mapped_working_dir = if mapping.relative_path.as_os_str().is_empty() {
        worktree_path
    } else {
        worktree_path.join(&mapping.relative_path)
    };

    if !mapped_working_dir.is_dir() {
        return Err(format!(
            "cwd 当前不能与 isolation=worktree 组合：新建 worktree 中缺少对应目录 {}（原 cwd: {}）；当前仅支持仓库内可直接映射的已有目录",
            mapped_working_dir.display(),
            mapping.requested_cwd_display
        ));
    }

    Ok(mapped_working_dir)
}

async fn remap_subagent_worktree_cwd_after_enter(
    session_id: &str,
    mapping: &SubagentWorktreeCwdMapping,
) -> Result<(), String> {
    let session = read_session(
        session_id,
        false,
        "创建 subagent worktree 后读取 child session 失败",
    )
    .await?;
    let Some(state) =
        aster::session::WorktreeSessionState::from_extension_data(&session.extension_data)
    else {
        return Err("创建 subagent worktree 后缺少 worktree session state".to_string());
    };

    let mapped_working_dir = resolve_subagent_worktree_mapped_working_dir(&state, mapping)?;
    if mapped_working_dir == session.working_dir {
        return Ok(());
    }

    aster::session::apply_session_update(session_id, |update| {
        update.working_dir(mapped_working_dir.clone())
    })
    .await
    .map_err(|error| format!("切换 child session 到 worktree 子目录失败: {error}"))
}

async fn rollback_subagent_worktree_after_spawn_failure(session_id: &str) -> Result<(), String> {
    let session = read_session(
        session_id,
        false,
        "回滚 subagent worktree 前读取 child session 失败",
    )
    .await?;

    match cleanup_subagent_worktree_for_close(&session).await {
        SubagentWorktreeCloseOutcome::RemovedClean | SubagentWorktreeCloseOutcome::NotEnabled => {
            Ok(())
        }
        SubagentWorktreeCloseOutcome::KeptDirty => {
            Err("spawn 失败后回滚 subagent worktree 时检测到意外改动".to_string())
        }
        SubagentWorktreeCloseOutcome::CleanupFailed => {
            Err("spawn 失败后回滚 subagent worktree 失败".to_string())
        }
    }
}

struct MissingSubagentWorktreeRestore {
    original_cwd: PathBuf,
    original_cwd_display: String,
    extension_data: aster::session::ExtensionData,
}

fn resolve_missing_subagent_worktree_restore(
    session: &aster::session::Session,
) -> Result<Option<MissingSubagentWorktreeRestore>, String> {
    let Some(state) =
        aster::session::WorktreeSessionState::from_extension_data(&session.extension_data)
    else {
        return Ok(None);
    };

    if Path::new(&state.worktree_path).is_dir() {
        return Ok(None);
    }

    let original_cwd = PathBuf::from(&state.original_cwd);
    if !original_cwd.is_dir() {
        return Err(format!(
            "子代理 worktree 已丢失，且原目录不可用: {}",
            state.original_cwd
        ));
    }

    let mut extension_data = session.extension_data.clone();
    extension_data.remove_extension_state(
        aster::session::WorktreeSessionState::EXTENSION_NAME,
        aster::session::WorktreeSessionState::VERSION,
    );

    Ok(Some(MissingSubagentWorktreeRestore {
        original_cwd,
        original_cwd_display: state.original_cwd,
        extension_data,
    }))
}

async fn restore_missing_subagent_worktree_if_needed(
    session: aster::session::Session,
) -> Result<aster::session::Session, String> {
    let Some(restore) = resolve_missing_subagent_worktree_restore(&session)? else {
        return Ok(session);
    };

    tracing::warn!(
        "[AsterAgent][Subagent] 检测到 child session={} 的 worktree 已被外部移除，回退到原目录 {}",
        session.id,
        restore.original_cwd_display
    );

    aster::session::apply_session_update(&session.id, |update| {
        update
            .working_dir(restore.original_cwd.clone())
            .extension_data(restore.extension_data)
    })
    .await
    .map_err(|error| format!("worktree 丢失后回退子代理目录失败: {error}"))?;

    read_session(&session.id, false, "worktree 丢失后刷新子代理 session 失败").await
}

fn should_auto_cleanup_subagent_worktree(status: SubagentRuntimeStatusKind) -> bool {
    matches!(
        status,
        SubagentRuntimeStatusKind::Completed
            | SubagentRuntimeStatusKind::Failed
            | SubagentRuntimeStatusKind::Aborted
    )
}

async fn maybe_cleanup_subagent_worktree_after_runtime_event(
    session_id: &str,
) -> Result<(), String> {
    let status = load_subagent_runtime_status(session_id).await?;
    if status.closed || !should_auto_cleanup_subagent_worktree(status.kind) {
        return Ok(());
    }

    let session = read_session(
        session_id,
        false,
        "自动清理 subagent worktree 时读取 session 失败",
    )
    .await?;
    let session = restore_missing_subagent_worktree_if_needed(session).await?;
    match cleanup_subagent_worktree_for_close(&session).await {
        SubagentWorktreeCloseOutcome::RemovedClean => tracing::info!(
            "[AsterAgent][Subagent] child session={} 已结束，自动清理干净的 worktree",
            session_id
        ),
        SubagentWorktreeCloseOutcome::KeptDirty => tracing::info!(
            "[AsterAgent][Subagent] child session={} 已结束，但 worktree 含改动，保留现状以便后续继续",
            session_id
        ),
        SubagentWorktreeCloseOutcome::CleanupFailed
        | SubagentWorktreeCloseOutcome::NotEnabled => {}
    }

    Ok(())
}

fn normalize_wait_timeout_ms(timeout_ms: Option<i64>) -> Result<i64, String> {
    match timeout_ms.unwrap_or(DEFAULT_WAIT_AGENT_TIMEOUT_MS) {
        value if value <= 0 => Err("timeout_ms 必须大于 0".to_string()),
        value => Ok(value.clamp(MIN_WAIT_AGENT_TIMEOUT_MS, MAX_WAIT_AGENT_TIMEOUT_MS)),
    }
}

async fn count_active_team_subagents(parent_session_id: &str) -> Result<usize, String> {
    let child_sessions =
        list_child_subagent_sessions(parent_session_id, "读取 team child sessions 失败").await?;
    let mut active_count = 0usize;

    for child_session in child_sessions {
        let status = load_subagent_runtime_status(&child_session.id).await?;
        if subagent_counts_toward_team_limit(status.kind) {
            active_count += 1;
        }
    }

    Ok(active_count)
}

pub(crate) fn subagent_counts_toward_team_limit(status: SubagentRuntimeStatusKind) -> bool {
    matches!(
        status,
        SubagentRuntimeStatusKind::Idle
            | SubagentRuntimeStatusKind::Queued
            | SubagentRuntimeStatusKind::Running
    )
}

async fn enforce_team_spawn_limits(parent_session_id: &str) -> Result<(), String> {
    let parent_session = read_session(parent_session_id, false, "读取父会话失败").await?;

    if parent_session.session_type == SessionType::SubAgent {
        return Err(
            "当前子代理不允许继续创建新的子代理。请返回父会话，由主线程统一编排 team。".to_string(),
        );
    }

    let active_count = count_active_team_subagents(parent_session_id).await?;
    if active_count >= DEFAULT_TEAM_MAX_ACTIVE_SUBAGENTS {
        return Err(format!(
            "当前协作区最多同时保留 {} 位待处理成员；请先关闭已不需要的成员，或复用已有成员继续处理。",
            DEFAULT_TEAM_MAX_ACTIVE_SUBAGENTS
        ));
    }

    Ok(())
}

fn merge_stashed_queued_turns(
    existing: Vec<aster::session::QueuedTurnRuntime>,
    current: Vec<aster::session::QueuedTurnRuntime>,
) -> Vec<aster::session::QueuedTurnRuntime> {
    let mut seen = HashSet::new();
    let mut merged = Vec::new();
    for queued_turn in existing.into_iter().chain(current.into_iter()) {
        if seen.insert(queued_turn.queued_turn_id.clone()) {
            merged.push(queued_turn);
        }
    }
    merged.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.queued_turn_id.cmp(&right.queued_turn_id))
    });
    merged
}

async fn restore_stashed_subagent_queue(
    queued_turns: Vec<aster::session::QueuedTurnRuntime>,
) -> Result<(), String> {
    if queued_turns.is_empty() {
        return Ok(());
    }

    restore_aster_runtime_queued_turns(queued_turns)
        .await
        .map_err(|error| format!("恢复 subagent queued turn 失败: {error}"))
}

async fn inherit_subagent_provider(
    runtime: &SubagentControlRuntime,
    parent_session_id: &str,
    child_session_id: &str,
    model_override: Option<&str>,
) -> Result<(), String> {
    let parent_session =
        read_session(parent_session_id, false, "读取父会话 provider 信息失败").await?;
    let parent_provider_selector = resolve_session_provider_selector(&parent_session)
        .or_else(|| normalize_optional_text(parent_session.provider_name.clone()));

    if let Some(mut provider_config) = runtime.state.get_provider_config().await {
        if let Some(model_name) = normalize_optional_text(model_override.map(ToString::to_string)) {
            provider_config.model_name = model_name;
        }
        if provider_config.provider_selector.is_none() {
            provider_config.provider_selector = parent_provider_selector.clone();
        }
        runtime
            .state
            .configure_provider(provider_config, child_session_id, &runtime.db)
            .await?;
        if let Some(provider_selector) = parent_provider_selector {
            persist_session_provider_routing(child_session_id, &provider_selector).await?;
        }
        return Ok(());
    }

    let provider_selector = parent_provider_selector
        .ok_or_else(|| "当前 provider 未配置，且父会话缺少 provider_name".to_string())?;
    let model_name = normalize_optional_text(model_override.map(ToString::to_string))
        .or_else(|| {
            parent_session
                .model_config
                .as_ref()
                .and_then(|config| normalize_optional_text(Some(config.model_name.clone())))
        })
        .ok_or_else(|| "当前 provider 未配置，且父会话缺少 model_name".to_string())?;

    runtime
        .state
        .configure_provider_from_pool(
            &runtime.db,
            &provider_selector,
            &model_name,
            child_session_id,
        )
        .await
        .map(|_| ())?;
    persist_session_provider_routing(child_session_id, &provider_selector).await?;
    Ok(())
}

async fn create_runtime_subagent_session(
    runtime: &SubagentControlRuntime,
    request: &AgentRuntimeSpawnSubagentRequest,
) -> Result<PreparedRuntimeSubagentSession, String> {
    let parent_session_id =
        normalize_required_text(&request.parent_session_id, "parent_session_id")?;
    let message = normalize_required_text(&request.message, "message")?;
    enforce_team_spawn_limits(&parent_session_id).await?;
    let parent_session = read_session(&parent_session_id, false, "读取父会话失败").await?;
    let resolved_teammate_spawn =
        resolve_effective_teammate_spawn_request(&parent_session_id, request).await?;
    let access_mode = resolve_spawn_request_access_mode(
        &parent_session_id,
        &parent_session,
        normalize_optional_text(request.mode.clone()).as_deref(),
        resolved_teammate_spawn.teammate_plan_mode,
    )?;
    let requested_cwd = normalize_optional_text(request.cwd.clone());
    let execution_working_dir =
        resolve_spawn_working_dir(parent_session.working_dir.as_path(), requested_cwd.clone())?;
    let plugin_agent = resolve_requested_runtime_plugin_agent_definition(
        normalize_optional_text(request.agent_type.clone()).as_deref(),
        execution_working_dir.as_path(),
        dirs::home_dir().as_deref(),
    )?;
    let effective_run_in_background =
        resolve_effective_run_in_background(request, plugin_agent.as_ref());
    let effective_isolation = resolve_effective_isolation(request, plugin_agent.as_ref());
    validate_effective_spawn_isolation(effective_isolation.as_deref(), requested_cwd.as_deref())?;
    let worktree_cwd_mapping = resolve_subagent_worktree_cwd_mapping(
        parent_session.working_dir.as_path(),
        execution_working_dir.as_path(),
        effective_isolation.as_deref(),
        requested_cwd.as_deref(),
    )
    .await?;
    let customization =
        build_subagent_customization_state_with_plugin_agent(request, plugin_agent.as_ref())?;
    let system_prompt = build_runtime_subagent_system_prompt(
        customization.as_ref(),
        resolved_teammate_spawn.teammate_plan_mode,
    )?;
    let profile_name = customization
        .as_ref()
        .and_then(|state| state.profile_name.as_deref());
    let role_hint = resolve_subagent_role_hint(request, customization.as_ref());
    let resolved_model = normalize_optional_text(request.model.clone()).or_else(|| {
        plugin_agent
            .as_ref()
            .and_then(|agent| normalize_optional_text(agent.model.clone()))
    });

    let session = create_subagent_session(
        resolve_subagent_session_bootstrap_working_dir(
            parent_session.working_dir.as_path(),
            execution_working_dir.as_path(),
            effective_isolation.as_deref(),
        ),
        build_subagent_session_name(
            resolved_teammate_spawn.teammate_name.as_deref(),
            &message,
            request.agent_type.as_deref(),
            customization
                .as_ref()
                .and_then(|state| state.blueprint_role_label.as_deref()),
            profile_name,
        ),
    )
    .await?;

    if let Some(parent_metadata) =
        AsterAgentWrapper::get_persisted_session_metadata_sync(&runtime.db, &parent_session_id)?
    {
        if let Some(execution_strategy) =
            normalize_optional_text(parent_metadata.execution_strategy)
        {
            AsterAgentWrapper::update_session_execution_strategy_sync(
                &runtime.db,
                &session.id,
                &execution_strategy,
            )?;
        }
    }

    let mut metadata = SubagentSessionMetadata::new(parent_session_id.clone())
        .with_task_summary(build_subagent_task_summary(&message))
        .with_role_hint(role_hint.clone())
        .with_created_from_turn_id(resolve_action_scope_turn_id(&parent_session_id));
    metadata.origin_tool = "Agent".to_string();
    let mut extension_data = session.extension_data.clone();
    metadata
        .to_extension_data(&mut extension_data)
        .map_err(|error| format!("持久化 subagent metadata 失败: {error}"))?;
    if let Some(customization_state) = customization.as_ref() {
        customization_state
            .to_extension_data(&mut extension_data)
            .map_err(|error| format!("持久化 subagent customization 失败: {error}"))?;
    }
    persist_session_extension_data(
        &session.id,
        extension_data,
        "写入 subagent session metadata",
    )
    .await?;
    maybe_enter_subagent_worktree(
        &session.id,
        session.working_dir.as_path(),
        effective_isolation.as_deref(),
        worktree_cwd_mapping.as_ref(),
    )
    .await?;
    AsterAgentWrapper::persist_session_recent_access_mode(&session.id, access_mode).await?;
    if let (Some(team_name), Some(teammate_name)) = (
        resolved_teammate_spawn.team_name.clone(),
        resolved_teammate_spawn.teammate_name.clone(),
    ) {
        register_spawned_teammate(
            &parent_session_id,
            &session.id,
            team_name,
            teammate_name,
            normalize_optional_text(request.agent_type.clone()),
        )
        .await?;
    }

    inherit_subagent_provider(
        runtime,
        &parent_session_id,
        &session.id,
        resolved_model.as_deref(),
    )
    .await?;
    register_runtime_subagent_frontmatter_hooks(
        &session.id,
        customization
            .as_ref()
            .and_then(|state| state.hooks.as_ref()),
    );
    let mut session = read_session(&session.id, false, "读取子代理 session 失败").await?;
    if resolved_teammate_spawn.teammate_plan_mode {
        aster::session::save_session_plan_mode_state(
            &session.id,
            Some(aster::session::SessionPlanModeState::active(
                Some(session.working_dir.join("PLAN.md").display().to_string()),
                Some(aster::tools::plan_mode_tool::PlanPersistenceManager::generate_plan_id()),
            )),
        )
        .await
        .map_err(|error| format!("持久化 teammate plan mode 状态失败: {error}"))?;
        session = read_session(&session.id, false, "刷新 teammate plan mode session 失败").await?;
    }

    Ok(PreparedRuntimeSubagentSession {
        session,
        customization,
        system_prompt,
        access_mode,
        effective_run_in_background,
        effective_isolation,
        effective_team_name: resolved_teammate_spawn.team_name,
    })
}

fn resolve_effective_run_in_background(
    request: &AgentRuntimeSpawnSubagentRequest,
    plugin_agent: Option<&RuntimePluginAgentDefinition>,
) -> bool {
    request.run_in_background || plugin_agent.map(|agent| agent.background).unwrap_or(false)
}

fn resolve_effective_isolation(
    request: &AgentRuntimeSpawnSubagentRequest,
    plugin_agent: Option<&RuntimePluginAgentDefinition>,
) -> Option<String> {
    normalize_optional_text(request.isolation.clone())
        .or_else(|| plugin_agent.and_then(|agent| agent.isolation.clone()))
}

fn validate_effective_spawn_isolation(
    effective_isolation: Option<&str>,
    _requested_cwd: Option<&str>,
) -> Result<(), String> {
    match effective_isolation
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        None => Ok(()),
        Some("worktree") => Ok(()),
        Some("remote") => {
            Err("isolation `remote` is not supported in the current runtime".to_string())
        }
        Some(other) => Err(format!(
            "isolation `{other}` is not supported in the current runtime; supported value: worktree"
        )),
    }
}

fn spawn_subagent_turn_in_background(
    runtime: SubagentControlRuntime,
    request: AsterChatRequest,
) -> Result<String, String> {
    let queued_task = build_queued_turn_task(request)?;
    let submission_id = queued_task.queued_turn_id.clone();
    let runtime_command_context = runtime.runtime_command_context();
    tokio::spawn(async move {
        if let Err(error) = runtime_command_context
            .submit_runtime_turn(queued_task, false)
            .await
        {
            tracing::warn!("[AsterAgent][Subagent] 后台启动子代理失败: {}", error);
        }
    });
    Ok(submission_id)
}

pub(crate) async fn agent_runtime_spawn_subagent_internal(
    runtime: &SubagentControlRuntime,
    request: AgentRuntimeSpawnSubagentRequest,
) -> Result<AgentRuntimeSpawnSubagentResponse, String> {
    runtime.ensure_initialized().await?;
    validate_spawn_request_surface(&request)?;
    let PreparedRuntimeSubagentSession {
        session: child_session,
        customization,
        system_prompt,
        access_mode,
        effective_run_in_background,
        effective_isolation,
        effective_team_name,
    } = create_runtime_subagent_session(runtime, &request).await?;
    let child_session_id = child_session.id.clone();
    let workspace_id =
        resolve_workspace_id_for_working_dir(&runtime.db, child_session.working_dir.as_path())?;
    let _ = spawn_subagent_turn_in_background(
        runtime.clone(),
        AsterChatRequest {
            message: normalize_required_text(&request.message, "message")?,
            session_id: child_session_id.clone(),
            event_name: build_subagent_runtime_event_name(&child_session_id),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: Some(access_mode.approval_policy().to_string()),
            sandbox_policy: Some(access_mode.sandbox_policy().to_string()),
            project_id: None,
            workspace_id,
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt,
            metadata: Some(serde_json::json!({
                "subagent": {
                    "parent_session_id": request.parent_session_id,
                    "name": request.name,
                    "team_name": effective_team_name,
                    "agent_type": request.agent_type,
                    "run_in_background": effective_run_in_background,
                    "reasoning_effort": request.reasoning_effort,
                    "fork_context": request.fork_context,
                    "mode": request.mode,
                    "isolation": effective_isolation,
                    "cwd": request.cwd,
                    "origin_tool": "Agent",
                    "blueprint_role_id": customization.as_ref().and_then(|state| state.blueprint_role_id.clone()),
                    "blueprint_role_label": customization.as_ref().and_then(|state| state.blueprint_role_label.clone()),
                    "profile_id": customization.as_ref().and_then(|state| state.profile_id.clone()),
                    "profile_name": customization.as_ref().and_then(|state| state.profile_name.clone()),
                    "role_key": customization.as_ref().and_then(|state| state.role_key.clone()),
                    "team_preset_id": customization.as_ref().and_then(|state| state.team_preset_id.clone()),
                    "theme": customization.as_ref().and_then(|state| state.theme.clone()),
                    "output_contract": customization.as_ref().and_then(|state| state.output_contract.clone()),
                    "skill_ids": customization.as_ref().map(|state| state.skill_ids.clone()).unwrap_or_default(),
                    "skills": customization.as_ref().map(|state| state.skills.clone()).unwrap_or_default(),
                    "allowed_tools": customization.as_ref().map(|state| state.allowed_tools.clone()).unwrap_or_default(),
                    "disallowed_tools": customization.as_ref().map(|state| state.disallowed_tools.clone()).unwrap_or_default(),
                }
            })),
            turn_id: None,
            queue_if_busy: Some(false),
            queued_turn_id: None,
        },
    )?;
    emit_subagent_status_changed_events(&runtime.app_handle, &child_session_id).await;

    Ok(AgentRuntimeSpawnSubagentResponse {
        agent_id: child_session_id,
        nickname: normalize_optional_text(Some(child_session.name)),
    })
}

pub(crate) async fn agent_runtime_send_subagent_input_internal(
    runtime: &SubagentControlRuntime,
    request: AgentRuntimeSendSubagentInputRequest,
) -> Result<AgentRuntimeSendSubagentInputResponse, String> {
    runtime.ensure_initialized().await?;
    let runtime_command_context = runtime.runtime_command_context();
    let session_id = normalize_required_text(&request.id, "id")?;
    let message = normalize_required_text(&request.message, "message")?;
    let session = read_session(&session_id, false, "读取目标会话失败")
        .await
        .map_err(|error| format!("目标会话不存在或无法读取: {session_id} ({error})"))?;

    if !matches!(session.session_type, SessionType::SubAgent) {
        if let Some(response) =
            maybe_handle_plan_approval_request_for_lead(runtime, &session, &message).await?
        {
            return Ok(response);
        }
        if let Some(response) = maybe_handle_shutdown_response_for_lead(
            runtime,
            &runtime_command_context,
            &session,
            &message,
        )
        .await?
        {
            return Ok(response);
        }
        if let Some(error) = reject_unsupported_managed_session_control_message(&message) {
            return Err(error);
        }
        return submit_runtime_message_to_managed_session(
            runtime,
            &runtime_command_context,
            &session,
            message,
            request.interrupt,
        )
        .await;
    }

    let status = load_subagent_runtime_status(&session_id).await?;
    match status.kind {
        SubagentRuntimeStatusKind::NotFound => {
            return Err(format!("子代理不存在: {session_id}"));
        }
        SubagentRuntimeStatusKind::Closed => {
            return Err(format!("子代理已关闭，请先恢复: {session_id}"));
        }
        _ => {}
    }

    let session = restore_missing_subagent_worktree_if_needed(session).await?;
    if let Some(response) =
        maybe_handle_plan_approval_response_for_teammate(runtime, &session, &message).await?
    {
        return Ok(response);
    }

    let access_mode = resolve_subagent_request_access_mode(&session_id, &session);
    let customization = SubagentCustomizationState::from_session(&session);
    let system_prompt = build_runtime_subagent_system_prompt(
        customization.as_ref(),
        aster::session::SessionPlanModeState::from_session(&session)
            .is_some_and(|state| state.active),
    )?;
    if request.interrupt {
        let _ = runtime.state.cancel_session(&session_id).await;
        let _ = runtime_command_context
            .clear_runtime_queue(&session_id)
            .await?;
    }

    let workspace_id =
        resolve_workspace_id_for_working_dir(&runtime.db, session.working_dir.as_path())?;
    let queued_task = build_queued_turn_task(AsterChatRequest {
        message,
        session_id: session_id.clone(),
        event_name: build_target_runtime_event_name(&session),
        images: None,
        provider_config: None,
        provider_preference: None,
        model_preference: None,
        thinking_enabled: None,
        approval_policy: Some(access_mode.approval_policy().to_string()),
        sandbox_policy: Some(access_mode.sandbox_policy().to_string()),
        project_id: None,
        workspace_id,
        web_search: None,
        search_mode: None,
        execution_strategy: None,
        auto_continue: None,
        system_prompt,
        metadata: Some(serde_json::json!({
            "subagent": {
                "origin_tool": "SendMessage",
                "interrupt": request.interrupt,
                "blueprint_role_id": customization.as_ref().and_then(|state| state.blueprint_role_id.clone()),
                "blueprint_role_label": customization.as_ref().and_then(|state| state.blueprint_role_label.clone()),
                "profile_id": customization.as_ref().and_then(|state| state.profile_id.clone()),
                "profile_name": customization.as_ref().and_then(|state| state.profile_name.clone()),
                "role_key": customization.as_ref().and_then(|state| state.role_key.clone()),
                "team_preset_id": customization.as_ref().and_then(|state| state.team_preset_id.clone()),
                "theme": customization.as_ref().and_then(|state| state.theme.clone()),
                "output_contract": customization.as_ref().and_then(|state| state.output_contract.clone()),
                "skill_ids": customization.as_ref().map(|state| state.skill_ids.clone()).unwrap_or_default(),
                "skills": customization.as_ref().map(|state| state.skills.clone()).unwrap_or_default(),
                "allowed_tools": customization.as_ref().map(|state| state.allowed_tools.clone()).unwrap_or_default(),
                "disallowed_tools": customization.as_ref().map(|state| state.disallowed_tools.clone()).unwrap_or_default(),
            }
        })),
        turn_id: None,
        queue_if_busy: Some(true),
        queued_turn_id: None,
    })?;
    let submission_id = queued_task.queued_turn_id.clone();
    runtime_command_context
        .submit_runtime_turn(queued_task, true)
        .await?;
    emit_subagent_status_changed_events(&runtime.app_handle, &session_id).await;

    Ok(AgentRuntimeSendSubagentInputResponse { submission_id })
}

pub(crate) async fn agent_runtime_wait_subagents_internal(
    runtime: &SubagentControlRuntime,
    request: AgentRuntimeWaitSubagentsRequest,
) -> Result<AgentRuntimeWaitSubagentsResponse, String> {
    runtime.ensure_initialized().await?;
    let ids = request
        .ids
        .into_iter()
        .map(|id| normalize_required_text(&id, "ids"))
        .collect::<Result<Vec<_>, _>>()?;
    if ids.is_empty() {
        return Err("ids 不能为空".to_string());
    }

    let timeout_ms = normalize_wait_timeout_ms(request.timeout_ms)?;
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms as u64);
    loop {
        let mut final_statuses = HashMap::new();
        for id in &ids {
            let status = load_subagent_runtime_status(id).await?;
            if status.kind.is_final() {
                final_statuses.insert(id.clone(), status);
            }
        }
        if !final_statuses.is_empty() {
            return Ok(AgentRuntimeWaitSubagentsResponse {
                status: final_statuses,
                timed_out: false,
            });
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(AgentRuntimeWaitSubagentsResponse {
                status: HashMap::new(),
                timed_out: true,
            });
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

pub(crate) async fn agent_runtime_resume_subagent_internal(
    runtime: &SubagentControlRuntime,
    request: AgentRuntimeResumeSubagentRequest,
) -> Result<AgentRuntimeResumeSubagentResponse, String> {
    runtime.ensure_initialized().await?;
    let runtime_command_context = runtime.runtime_command_context();
    let session_id = normalize_required_text(&request.id, "id")?;
    let current_status = load_subagent_runtime_status(&session_id).await?;
    if current_status.kind == SubagentRuntimeStatusKind::NotFound
        || current_status.kind != SubagentRuntimeStatusKind::Closed
    {
        return Ok(AgentRuntimeResumeSubagentResponse {
            status: current_status,
            cascade_session_ids: Vec::new(),
            changed_session_ids: Vec::new(),
        });
    }

    let target_ids = list_subagent_cascade_session_ids(&session_id).await?;
    let cascade_session_ids = target_ids.clone();
    let mut changed_ids = Vec::new();
    for target_id in target_ids {
        let (session, control_state) = read_subagent_control_state(&target_id).await?;
        let session = restore_missing_subagent_worktree_if_needed(session).await?;
        if !control_state.closed {
            continue;
        }

        let stashed_queued_turns = control_state.stashed_queued_turns.clone();
        let mut next_state = control_state.opened();
        next_state.stashed_queued_turns.clear();
        write_subagent_control_state(&session, &next_state).await?;
        restore_stashed_subagent_queue(stashed_queued_turns.clone()).await?;
        if !stashed_queued_turns.is_empty() {
            let _ = runtime_command_context
                .resume_runtime_queue_if_needed(target_id.clone())
                .await?;
        }
        changed_ids.push(target_id);
    }

    for changed_id in &changed_ids {
        emit_subagent_status_changed_events(&runtime.app_handle, &changed_id).await;
    }

    Ok(AgentRuntimeResumeSubagentResponse {
        status: load_subagent_runtime_status(&session_id).await?,
        cascade_session_ids,
        changed_session_ids: changed_ids,
    })
}

pub(crate) async fn agent_runtime_close_subagent_internal(
    runtime: &SubagentControlRuntime,
    request: AgentRuntimeCloseSubagentRequest,
) -> Result<AgentRuntimeCloseSubagentResponse, String> {
    runtime.ensure_initialized().await?;
    let runtime_command_context = runtime.runtime_command_context();
    let session_id = normalize_required_text(&request.id, "id")?;
    let previous_status = load_subagent_runtime_status(&session_id).await?;
    if matches!(
        previous_status.kind,
        SubagentRuntimeStatusKind::NotFound | SubagentRuntimeStatusKind::Closed
    ) {
        return Ok(AgentRuntimeCloseSubagentResponse {
            previous_status,
            cascade_session_ids: Vec::new(),
            changed_session_ids: Vec::new(),
        });
    }

    let target_ids = list_subagent_cascade_session_ids(&session_id).await?;
    let cascade_session_ids = target_ids.clone();
    let mut changed_ids = Vec::new();
    for target_id in target_ids {
        let (session, control_state) = read_subagent_control_state(&target_id).await?;
        let session = restore_missing_subagent_worktree_if_needed(session).await?;
        if control_state.closed {
            continue;
        }

        let _ = runtime.state.cancel_session(&target_id).await;
        let cleared_queued_turns = runtime_command_context
            .clear_runtime_queue(&target_id)
            .await
            .unwrap_or_default();
        let worktree_close_outcome = cleanup_subagent_worktree_for_close(&session).await;
        let session = read_session(&target_id, false, "关闭子代理后刷新 session 失败")
            .await
            .unwrap_or(session);
        let next_state = SubagentControlState::closed(
            Some(SUBAGENT_CONTROL_CLOSE_REASON.to_string()),
            merge_stashed_queued_turns(control_state.stashed_queued_turns, cleared_queued_turns),
        );
        write_subagent_control_state(&session, &next_state).await?;
        match worktree_close_outcome {
            SubagentWorktreeCloseOutcome::RemovedClean => tracing::info!(
                "[AsterAgent][Subagent] 关闭 child session={} 时已自动清理干净的 worktree",
                target_id
            ),
            SubagentWorktreeCloseOutcome::KeptDirty => tracing::info!(
                "[AsterAgent][Subagent] 关闭 child session={} 时保留含改动的 worktree，后续 resume 将继续沿用",
                target_id
            ),
            SubagentWorktreeCloseOutcome::CleanupFailed
            | SubagentWorktreeCloseOutcome::NotEnabled => {}
        }
        changed_ids.push(target_id);
    }

    for changed_id in &changed_ids {
        emit_subagent_status_changed_events(&runtime.app_handle, &changed_id).await;
    }

    Ok(AgentRuntimeCloseSubagentResponse {
        previous_status,
        cascade_session_ids,
        changed_session_ids: changed_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aster::session::{SessionType, WorktreeSessionState};
    use lime_core::database::schema::create_tables;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_workspace_test_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        create_tables(&conn).expect("create schema");
        Arc::new(Mutex::new(conn))
    }

    async fn run_subagent_git_ok<const N: usize>(cwd: &Path, args: [&str; N]) {
        let output = run_subagent_git(cwd, args).await.expect("run git command");
        assert!(
            output.status.success(),
            "git command failed: {}",
            subagent_git_command_failure_text(&output)
        );
    }

    async fn init_subagent_git_repo() -> tempfile::TempDir {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        run_subagent_git_ok(temp_dir.path(), ["init"]).await;
        run_subagent_git_ok(
            temp_dir.path(),
            ["config", "user.email", "test@example.com"],
        )
        .await;
        run_subagent_git_ok(temp_dir.path(), ["config", "user.name", "test"]).await;
        std::fs::write(temp_dir.path().join("README.md"), "hello\n").expect("write readme");
        run_subagent_git_ok(temp_dir.path(), ["add", "."]).await;
        run_subagent_git_ok(temp_dir.path(), ["commit", "-m", "init"]).await;
        temp_dir
    }

    #[test]
    fn test_build_subagent_session_name_prefers_explicit_name() {
        let name = build_subagent_session_name(
            Some("verifier"),
            "检查当前 team runtime 差异",
            Some("explorer"),
            Some("分析"),
            Some("代码分析员"),
        );

        assert_eq!(name, "verifier");
    }

    #[test]
    fn test_resolve_subagent_role_hint_prefers_explicit_name() {
        let request = AgentRuntimeSpawnSubagentRequest {
            parent_session_id: "parent-1".to_string(),
            message: "定位当前 team runtime 差异".to_string(),
            name: Some("verifier".to_string()),
            team_name: Some("delivery-team".to_string()),
            agent_type: Some("explorer".to_string()),
            model: None,
            run_in_background: false,
            reasoning_effort: None,
            fork_context: false,
            blueprint_role_id: None,
            blueprint_role_label: Some("分析".to_string()),
            profile_id: None,
            profile_name: Some("代码分析员".to_string()),
            role_key: Some("explorer".to_string()),
            skill_ids: Vec::new(),
            skill_directories: Vec::new(),
            team_preset_id: None,
            theme: None,
            system_overlay: None,
            output_contract: None,
            hooks: None,
            allowed_tools: Vec::new(),
            disallowed_tools: Vec::new(),
            mode: None,
            isolation: None,
            cwd: None,
        };

        assert_eq!(
            resolve_subagent_role_hint(&request, None).as_deref(),
            Some("verifier")
        );
    }

    #[test]
    fn test_resolve_spawn_working_dir_uses_requested_absolute_directory() {
        let parent = tempfile::tempdir().expect("parent tempdir");
        let child = tempfile::tempdir().expect("child tempdir");

        let resolved =
            resolve_spawn_working_dir(parent.path(), Some(child.path().display().to_string()))
                .expect("cwd override should resolve");

        assert_eq!(resolved, child.path());
    }

    #[test]
    fn test_resolve_subagent_session_bootstrap_working_dir_keeps_execution_working_dir() {
        let parent = tempfile::tempdir().expect("parent tempdir");
        let child = tempfile::tempdir().expect("child tempdir");

        assert_eq!(
            resolve_subagent_session_bootstrap_working_dir(
                parent.path(),
                child.path(),
                Some("worktree"),
            ),
            child.path()
        );
        assert_eq!(
            resolve_subagent_session_bootstrap_working_dir(parent.path(), child.path(), None),
            child.path()
        );
    }

    #[test]
    fn test_validate_spawn_request_surface_accepts_supported_modes_and_rejects_unsupported_values()
    {
        let request = AgentRuntimeSpawnSubagentRequest {
            parent_session_id: "parent-1".to_string(),
            message: "定位当前 team runtime 差异".to_string(),
            name: None,
            team_name: None,
            agent_type: None,
            model: None,
            run_in_background: false,
            reasoning_effort: None,
            fork_context: false,
            blueprint_role_id: None,
            blueprint_role_label: None,
            profile_id: None,
            profile_name: None,
            role_key: None,
            skill_ids: Vec::new(),
            skill_directories: Vec::new(),
            team_preset_id: None,
            theme: None,
            system_overlay: None,
            output_contract: None,
            hooks: None,
            allowed_tools: Vec::new(),
            disallowed_tools: Vec::new(),
            mode: Some("acceptEdits".to_string()),
            isolation: None,
            cwd: None,
        };

        validate_spawn_request_surface(&request)
            .expect("acceptEdits should map to current access mode");

        let default_request = AgentRuntimeSpawnSubagentRequest {
            mode: Some("default".to_string()),
            ..request.clone()
        };
        validate_spawn_request_surface(&default_request)
            .expect("default should inherit parent access mode");

        let dont_ask_request = AgentRuntimeSpawnSubagentRequest {
            mode: Some("dontAsk".to_string()),
            ..request.clone()
        };
        validate_spawn_request_surface(&dont_ask_request)
            .expect("dontAsk should map to full access");

        let unsupported_mode_request = AgentRuntimeSpawnSubagentRequest {
            mode: Some("plan".to_string()),
            ..request.clone()
        };
        assert_eq!(
            validate_spawn_request_surface(&unsupported_mode_request).unwrap_err(),
            "mode `plan` is only supported for team teammates in the current runtime"
        );

        let teammate_plan_request = AgentRuntimeSpawnSubagentRequest {
            name: Some("researcher".to_string()),
            mode: Some("plan".to_string()),
            ..request.clone()
        };
        validate_spawn_request_surface(&teammate_plan_request)
            .expect("named team candidate should allow plan mode at surface layer");

        let bypass_request = AgentRuntimeSpawnSubagentRequest {
            mode: Some("bypassPermissions".to_string()),
            ..request
        };
        assert_eq!(
            validate_spawn_request_surface(&bypass_request).unwrap_err(),
            "mode `bypassPermissions` is not supported in the current runtime"
        );
    }

    #[test]
    fn test_resolve_subagent_request_access_mode_defaults_to_full_access() {
        let session = aster::session::Session::default();

        assert_eq!(
            resolve_subagent_request_access_mode("child-1", &session),
            lime_agent::SessionExecutionRuntimeAccessMode::FullAccess
        );
    }

    #[test]
    fn test_resolve_subagent_request_access_mode_prefers_session_recent_access_mode() {
        let mut session = aster::session::Session::default();
        session.id = "child-2".to_string();
        lime_agent::SessionExecutionRuntimeAccessMode::ReadOnly
            .to_extension_data(&mut session.extension_data)
            .expect("persist access mode");

        assert_eq!(
            resolve_subagent_request_access_mode("child-2", &session),
            lime_agent::SessionExecutionRuntimeAccessMode::ReadOnly
        );
    }

    #[test]
    fn test_resolve_spawn_request_access_mode_prefers_supported_mode_override() {
        let mut session = aster::session::Session::default();
        session.id = "child-3".to_string();
        lime_agent::SessionExecutionRuntimeAccessMode::ReadOnly
            .to_extension_data(&mut session.extension_data)
            .expect("persist access mode");

        assert_eq!(
            resolve_spawn_request_access_mode("child-3", &session, Some("acceptEdits"), false)
                .expect("acceptEdits should be supported"),
            lime_agent::SessionExecutionRuntimeAccessMode::Current
        );
        assert_eq!(
            resolve_spawn_request_access_mode("child-3", &session, Some("dontAsk"), false)
                .expect("dontAsk should be supported"),
            lime_agent::SessionExecutionRuntimeAccessMode::FullAccess
        );
        assert_eq!(
            resolve_spawn_request_access_mode("child-3", &session, Some("default"), false)
                .expect("default should inherit"),
            lime_agent::SessionExecutionRuntimeAccessMode::ReadOnly
        );
        assert_eq!(
            resolve_spawn_request_access_mode("child-3", &session, Some("plan"), true)
                .expect("team teammate plan mode should inherit parent access mode"),
            lime_agent::SessionExecutionRuntimeAccessMode::ReadOnly
        );
    }

    #[tokio::test]
    async fn test_resolve_effective_teammate_spawn_request_infers_team_name_from_lead_context() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let lead = aster::session::create_managed_session(
            temp_dir.path().to_path_buf(),
            "team-lead".to_string(),
            SessionType::Hidden,
        )
        .await
        .expect("create lead session");
        aster::session::save_team_state(
            &lead.id,
            Some(aster::session::TeamSessionState::new(
                "delivery-team",
                lead.id.clone(),
                None,
                None,
            )),
        )
        .await
        .expect("save team state");

        let resolved = resolve_effective_teammate_spawn_request(
            &lead.id,
            &AgentRuntimeSpawnSubagentRequest {
                parent_session_id: lead.id.clone(),
                message: "定位当前 team runtime 差异".to_string(),
                name: Some("researcher".to_string()),
                team_name: None,
                agent_type: None,
                model: None,
                run_in_background: false,
                reasoning_effort: None,
                fork_context: false,
                blueprint_role_id: None,
                blueprint_role_label: None,
                profile_id: None,
                profile_name: None,
                role_key: None,
                skill_ids: Vec::new(),
                skill_directories: Vec::new(),
                team_preset_id: None,
                theme: None,
                system_overlay: None,
                output_contract: None,
                hooks: None,
                allowed_tools: Vec::new(),
                disallowed_tools: Vec::new(),
                mode: Some("plan".to_string()),
                isolation: None,
                cwd: None,
            },
        )
        .await
        .expect("lead team context should infer team name");

        assert_eq!(resolved.teammate_name.as_deref(), Some("researcher"));
        assert_eq!(resolved.team_name.as_deref(), Some("delivery-team"));
        assert!(resolved.teammate_plan_mode);
    }

    #[tokio::test]
    async fn test_resolve_effective_teammate_spawn_request_rejects_plan_without_team_context() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let parent = aster::session::create_managed_session(
            temp_dir.path().to_path_buf(),
            "plain-parent".to_string(),
            SessionType::Hidden,
        )
        .await
        .expect("create parent session");

        let error = resolve_effective_teammate_spawn_request(
            &parent.id,
            &AgentRuntimeSpawnSubagentRequest {
                parent_session_id: parent.id.clone(),
                message: "定位当前 team runtime 差异".to_string(),
                name: Some("researcher".to_string()),
                team_name: None,
                agent_type: None,
                model: None,
                run_in_background: false,
                reasoning_effort: None,
                fork_context: false,
                blueprint_role_id: None,
                blueprint_role_label: None,
                profile_id: None,
                profile_name: None,
                role_key: None,
                skill_ids: Vec::new(),
                skill_directories: Vec::new(),
                team_preset_id: None,
                theme: None,
                system_overlay: None,
                output_contract: None,
                hooks: None,
                allowed_tools: Vec::new(),
                disallowed_tools: Vec::new(),
                mode: Some("plan".to_string()),
                isolation: None,
                cwd: None,
            },
        )
        .await
        .expect_err("plan mode without current team context should stay rejected");

        assert_eq!(
            error,
            "mode `plan` is only supported for team teammates in the current runtime"
        );
    }

    #[tokio::test]
    async fn test_resolve_effective_teammate_spawn_request_rejects_non_lead_sessions() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let lead = aster::session::create_managed_session(
            temp_dir.path().to_path_buf(),
            "team-lead".to_string(),
            SessionType::Hidden,
        )
        .await
        .expect("create lead session");
        let child = aster::session::create_managed_session(
            temp_dir.path().to_path_buf(),
            "team-child".to_string(),
            SessionType::SubAgent,
        )
        .await
        .expect("create child session");
        aster::session::save_team_state(
            &lead.id,
            Some(aster::session::TeamSessionState::new(
                "delivery-team",
                lead.id.clone(),
                None,
                None,
            )),
        )
        .await
        .expect("save team state");
        aster::session::save_team_membership(
            &child.id,
            Some(aster::session::TeamMembershipState {
                team_name: "delivery-team".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: child.id.clone(),
                name: "researcher".to_string(),
                agent_type: Some("explorer".to_string()),
            }),
        )
        .await
        .expect("save team membership");

        let error = resolve_effective_teammate_spawn_request(
            &child.id,
            &AgentRuntimeSpawnSubagentRequest {
                parent_session_id: child.id.clone(),
                message: "继续拆分 teammate".to_string(),
                name: Some("planner".to_string()),
                team_name: Some("delivery-team".to_string()),
                agent_type: None,
                model: None,
                run_in_background: false,
                reasoning_effort: None,
                fork_context: false,
                blueprint_role_id: None,
                blueprint_role_label: None,
                profile_id: None,
                profile_name: None,
                role_key: None,
                skill_ids: Vec::new(),
                skill_directories: Vec::new(),
                team_preset_id: None,
                theme: None,
                system_overlay: None,
                output_contract: None,
                hooks: None,
                allowed_tools: Vec::new(),
                disallowed_tools: Vec::new(),
                mode: Some("plan".to_string()),
                isolation: None,
                cwd: None,
            },
        )
        .await
        .expect_err("non-lead sessions should not create teammates");

        assert_eq!(error, "当前 runtime 只允许 team lead session 创建 teammate");
    }

    #[test]
    fn test_build_runtime_subagent_system_prompt_appends_plan_mode_guidance() {
        let prompt = build_runtime_subagent_system_prompt(None, true)
            .expect("build plan prompt")
            .expect("plan prompt should exist");
        assert!(prompt.contains("You are running in plan mode."));
    }

    #[test]
    fn test_parse_runtime_control_message_accepts_upstream_plan_response_shape() {
        let message = parse_runtime_control_message(
            r#"{"type":"plan_approval_response","requestId":"req-1","approved":true,"permissionMode":"default"}"#,
        )
        .expect("should parse upstream approval response");

        assert!(matches!(
            message,
            RuntimeControlMessage::PlanApprovalResponse {
                request_id,
                approve: true,
                ..
            } if request_id == "req-1"
        ));
    }

    #[test]
    fn test_parse_runtime_control_message_accepts_shutdown_approved_shape() {
        let message = parse_runtime_control_message(
            r#"{"type":"shutdown_approved","request_id":"req-1","from":"researcher"}"#,
        )
        .expect("should parse shutdown approved message");

        assert!(matches!(
            message,
            RuntimeControlMessage::ShutdownApproved {
                request_id,
                from,
                ..
            } if request_id == "req-1" && from == "researcher"
        ));
    }

    #[test]
    fn test_extract_runtime_request_target_reads_suffix_after_at() {
        assert_eq!(
            extract_runtime_request_target("shutdown-123@researcher"),
            Some("researcher")
        );
        assert_eq!(extract_runtime_request_target("shutdown-123"), None);
    }

    #[test]
    fn test_reject_unsupported_managed_session_control_message_blocks_shutdown_response() {
        let error = reject_unsupported_managed_session_control_message(
            r#"{"type":"shutdown_response","request_id":"req-1","approve":true}"#,
        )
        .expect("shutdown response should stay fail-closed");

        assert!(error.contains("shutdown_response"));
    }

    #[test]
    fn test_reject_unsupported_managed_session_control_message_allows_wrapped_peer_text() {
        assert!(reject_unsupported_managed_session_control_message(
            "<teammate-message teammate_id=\"researcher\" summary=\"同步结果\">\n继续验证\n</teammate-message>",
        )
        .is_none());
        assert!(reject_unsupported_managed_session_control_message(
            "<cross-session-message from=\"uds:session-a\">\n继续验证\n</cross-session-message>",
        )
        .is_none());
    }

    #[test]
    fn test_build_subagent_customization_state_keeps_frontmatter_hooks() {
        let customization = build_subagent_customization_state(&AgentRuntimeSpawnSubagentRequest {
            parent_session_id: "parent-1".to_string(),
            message: "检查 agent hooks".to_string(),
            name: None,
            team_name: None,
            agent_type: None,
            model: None,
            run_in_background: false,
            reasoning_effort: None,
            fork_context: false,
            blueprint_role_id: None,
            blueprint_role_label: None,
            profile_id: None,
            profile_name: None,
            role_key: None,
            skill_ids: Vec::new(),
            skill_directories: Vec::new(),
            team_preset_id: None,
            theme: None,
            system_overlay: None,
            output_contract: None,
            hooks: Some(
                serde_json::from_value(serde_json::json!({
                    "Stop": [
                        {
                            "hooks": [
                                {
                                    "type": "prompt",
                                    "prompt": "Summarize before exit"
                                }
                            ]
                        }
                    ]
                }))
                .expect("hooks should deserialize"),
            ),
            allowed_tools: Vec::new(),
            disallowed_tools: Vec::new(),
            mode: None,
            isolation: None,
            cwd: None,
        })
        .expect("build customization state")
        .expect("customization should exist");

        assert!(customization
            .hooks
            .as_ref()
            .and_then(|hooks| hooks.get(&aster::hooks::HookEvent::Stop))
            .is_some());
    }

    #[test]
    fn test_register_runtime_subagent_frontmatter_hooks_rewrites_stop_event() {
        aster::hooks::clear_session_hooks("runtime-subagent-hook");
        let hooks: aster::hooks::FrontmatterHooks = serde_json::from_value(serde_json::json!({
            "Stop": [
                {
                    "hooks": [
                        {
                            "type": "prompt",
                            "prompt": "Summarize before exit"
                        }
                    ]
                }
            ]
        }))
        .expect("hooks should deserialize");

        register_runtime_subagent_frontmatter_hooks("runtime-subagent-hook", Some(&hooks));

        assert!(aster::hooks::get_matching_session_hooks(
            "runtime-subagent-hook",
            aster::hooks::HookEvent::Stop,
            None,
        )
        .is_empty());
        assert_eq!(
            aster::hooks::get_matching_session_hooks(
                "runtime-subagent-hook",
                aster::hooks::HookEvent::SubagentStop,
                None,
            )
            .len(),
            1
        );

        aster::hooks::clear_session_hooks("runtime-subagent-hook");
    }

    #[test]
    fn test_build_subagent_customization_state_with_plugin_agent_applies_runtime_overlay_and_tool_scope(
    ) {
        let plugin_agent = RuntimePluginAgentDefinition {
            agent_type: "research-kit:reviewer".to_string(),
            when_to_use: "审查当前实现".to_string(),
            system_prompt: "你是插件里的 reviewer agent。".to_string(),
            model: Some("gpt-5.4".to_string()),
            background: false,
            isolation: None,
            allowed_tools: vec!["Read".to_string(), "Bash".to_string()],
            disallowed_tools: vec!["WebSearch".to_string()],
            plugin_id: "research-kit@market".to_string(),
            plugin_name: "research-kit".to_string(),
            source_file: PathBuf::from("/tmp/reviewer.md"),
        };
        let customization = build_subagent_customization_state_with_plugin_agent(
            &AgentRuntimeSpawnSubagentRequest {
                parent_session_id: "parent-1".to_string(),
                message: "检查 plugin agent".to_string(),
                name: None,
                team_name: None,
                agent_type: Some("research-kit:reviewer".to_string()),
                model: None,
                run_in_background: false,
                reasoning_effort: None,
                fork_context: false,
                blueprint_role_id: None,
                blueprint_role_label: None,
                profile_id: None,
                profile_name: None,
                role_key: None,
                skill_ids: Vec::new(),
                skill_directories: Vec::new(),
                team_preset_id: None,
                theme: None,
                system_overlay: Some("优先输出证据。".to_string()),
                output_contract: None,
                hooks: None,
                allowed_tools: vec!["Read".to_string(), "Edit".to_string()],
                disallowed_tools: vec!["Bash".to_string()],
                mode: None,
                isolation: None,
                cwd: None,
            },
            Some(&plugin_agent),
        )
        .expect("customization build should succeed")
        .expect("customization should exist");

        assert_eq!(customization.allowed_tools, vec!["Read"]);
        assert_eq!(customization.disallowed_tools, vec!["WebSearch", "Bash"]);
        assert!(customization
            .system_overlay
            .as_deref()
            .unwrap_or_default()
            .contains("你是插件里的 reviewer agent。"));
        assert!(customization
            .system_overlay
            .as_deref()
            .unwrap_or_default()
            .contains("优先输出证据。"));
    }

    #[test]
    fn test_resolve_effective_run_in_background_prefers_plugin_agent_background() {
        let request = AgentRuntimeSpawnSubagentRequest {
            parent_session_id: "parent-1".to_string(),
            message: "检查 plugin agent background".to_string(),
            name: None,
            team_name: None,
            agent_type: Some("research-kit:reviewer".to_string()),
            model: None,
            run_in_background: false,
            reasoning_effort: None,
            fork_context: false,
            blueprint_role_id: None,
            blueprint_role_label: None,
            profile_id: None,
            profile_name: None,
            role_key: None,
            skill_ids: Vec::new(),
            skill_directories: Vec::new(),
            team_preset_id: None,
            theme: None,
            system_overlay: None,
            output_contract: None,
            hooks: None,
            allowed_tools: Vec::new(),
            disallowed_tools: Vec::new(),
            mode: None,
            isolation: None,
            cwd: None,
        };
        let plugin_agent = RuntimePluginAgentDefinition {
            agent_type: "research-kit:reviewer".to_string(),
            when_to_use: "审查当前实现".to_string(),
            system_prompt: "你是插件里的 reviewer agent。".to_string(),
            model: None,
            background: true,
            isolation: None,
            allowed_tools: Vec::new(),
            disallowed_tools: Vec::new(),
            plugin_id: "research-kit@market".to_string(),
            plugin_name: "research-kit".to_string(),
            source_file: PathBuf::from("/tmp/reviewer.md"),
        };

        assert!(resolve_effective_run_in_background(
            &request,
            Some(&plugin_agent)
        ));
        assert!(resolve_effective_run_in_background(
            &AgentRuntimeSpawnSubagentRequest {
                run_in_background: true,
                ..request.clone()
            },
            None,
        ));
        assert!(!resolve_effective_run_in_background(&request, None));
    }

    #[test]
    fn test_resolve_effective_isolation_prefers_request_then_plugin_agent() {
        let request = AgentRuntimeSpawnSubagentRequest {
            parent_session_id: "parent-1".to_string(),
            message: "检查 plugin agent isolation".to_string(),
            name: None,
            team_name: None,
            agent_type: Some("research-kit:reviewer".to_string()),
            model: None,
            run_in_background: false,
            reasoning_effort: None,
            fork_context: false,
            blueprint_role_id: None,
            blueprint_role_label: None,
            profile_id: None,
            profile_name: None,
            role_key: None,
            skill_ids: Vec::new(),
            skill_directories: Vec::new(),
            team_preset_id: None,
            theme: None,
            system_overlay: None,
            output_contract: None,
            hooks: None,
            allowed_tools: Vec::new(),
            disallowed_tools: Vec::new(),
            mode: None,
            isolation: None,
            cwd: None,
        };
        let plugin_agent = RuntimePluginAgentDefinition {
            agent_type: "research-kit:reviewer".to_string(),
            when_to_use: "审查当前实现".to_string(),
            system_prompt: "你是插件里的 reviewer agent。".to_string(),
            model: None,
            background: false,
            isolation: Some("worktree".to_string()),
            allowed_tools: Vec::new(),
            disallowed_tools: Vec::new(),
            plugin_id: "research-kit@market".to_string(),
            plugin_name: "research-kit".to_string(),
            source_file: PathBuf::from("/tmp/reviewer.md"),
        };

        assert_eq!(
            resolve_effective_isolation(&request, Some(&plugin_agent)).as_deref(),
            Some("worktree")
        );
        assert_eq!(
            resolve_effective_isolation(
                &AgentRuntimeSpawnSubagentRequest {
                    isolation: Some("remote".to_string()),
                    ..request.clone()
                },
                Some(&plugin_agent),
            )
            .as_deref(),
            Some("remote")
        );
        assert_eq!(resolve_effective_isolation(&request, None), None);
    }

    #[test]
    fn test_validate_effective_spawn_isolation_accepts_worktree_and_rejects_unsupported_values() {
        assert!(validate_effective_spawn_isolation(None, None).is_ok());
        assert!(validate_effective_spawn_isolation(Some("worktree"), None).is_ok());
        assert!(validate_effective_spawn_isolation(Some("worktree"), Some("/tmp/project")).is_ok());
        assert_eq!(
            validate_effective_spawn_isolation(Some("remote"), None).unwrap_err(),
            "isolation `remote` is not supported in the current runtime"
        );
    }

    #[tokio::test]
    async fn test_resolve_subagent_worktree_cwd_mapping_rejects_cross_repo_cwd() {
        let parent_repo = init_subagent_git_repo().await;
        let other_repo = init_subagent_git_repo().await;
        let other_cwd = other_repo.path().display().to_string();

        let error = resolve_subagent_worktree_cwd_mapping(
            parent_repo.path(),
            other_repo.path(),
            Some("worktree"),
            Some(other_cwd.as_str()),
        )
        .await
        .expect_err("cross-repo cwd should fail");

        assert!(error.contains("同一 Git 仓库"));
    }

    #[tokio::test]
    async fn test_maybe_enter_subagent_worktree_remaps_requested_cwd_into_child_worktree() {
        let repo = init_subagent_git_repo().await;
        let nested = repo.path().join("packages/app");
        std::fs::create_dir_all(&nested).expect("create nested dir");
        std::fs::write(nested.join("index.txt"), "hello\n").expect("write nested file");
        run_subagent_git_ok(repo.path(), ["add", "."]).await;
        run_subagent_git_ok(repo.path(), ["commit", "-m", "add nested"]).await;

        let requested_cwd = nested.display().to_string();
        let mapping = resolve_subagent_worktree_cwd_mapping(
            repo.path(),
            nested.as_path(),
            Some("worktree"),
            Some(requested_cwd.as_str()),
        )
        .await
        .expect("resolve mapping should succeed")
        .expect("mapping should exist");
        let session = create_subagent_session(nested.clone(), "subagent-worktree-cwd".to_string())
            .await
            .expect("create child session");

        maybe_enter_subagent_worktree(
            &session.id,
            session.working_dir.as_path(),
            Some("worktree"),
            Some(&mapping),
        )
        .await
        .expect("enter worktree should succeed");

        let session = read_session(&session.id, false, "refresh child session")
            .await
            .expect("refresh child session");
        let state = WorktreeSessionState::from_extension_data(&session.extension_data)
            .expect("worktree state should exist");

        assert_eq!(state.original_cwd, requested_cwd);
        assert_eq!(
            session.working_dir,
            PathBuf::from(&state.worktree_path).join("packages/app")
        );
        assert!(session.working_dir.is_dir());
    }

    #[test]
    fn test_resolve_workspace_id_for_working_dir_prefers_longest_ancestor_workspace() {
        let db = setup_workspace_test_db();
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let root = temp_dir.path().join("repo");
        let nested = root.join("packages/app");
        std::fs::create_dir_all(&nested).expect("create nested dir");
        let worktree_path = root.join(".aster/worktrees/agent-12345678");
        std::fs::create_dir_all(&worktree_path).expect("create worktree dir");

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create("Repo".to_string(), root.clone())
            .expect("create workspace");

        assert_eq!(
            resolve_workspace_id_for_working_dir(&db, nested.as_path()).expect("resolve nested"),
            workspace.id
        );
        assert_eq!(
            resolve_workspace_id_for_working_dir(&db, worktree_path.as_path())
                .expect("resolve worktree"),
            workspace.id
        );
    }

    #[test]
    fn test_build_subagent_worktree_slug_uses_session_prefix() {
        assert_eq!(
            build_subagent_worktree_slug("3d813923-ab29-4109-a2bb-eae7f9b85004"),
            "agent-3d813923"
        );
    }

    #[test]
    fn test_should_preserve_subagent_worktree_on_close_detects_dirty_prompt() {
        assert!(should_preserve_subagent_worktree_on_close(
            "Worktree has 1 uncommitted file. Removing will discard this work permanently. Confirm with the user, then re-invoke with discard_changes: true, or use action: \"keep\" to preserve the worktree."
        ));
        assert!(!should_preserve_subagent_worktree_on_close(
            "No-op: there is no active EnterWorktree session to exit."
        ));
    }

    #[test]
    fn test_should_auto_cleanup_subagent_worktree_only_for_final_runtime_statuses() {
        assert!(should_auto_cleanup_subagent_worktree(
            SubagentRuntimeStatusKind::Completed
        ));
        assert!(should_auto_cleanup_subagent_worktree(
            SubagentRuntimeStatusKind::Failed
        ));
        assert!(should_auto_cleanup_subagent_worktree(
            SubagentRuntimeStatusKind::Aborted
        ));
        assert!(!should_auto_cleanup_subagent_worktree(
            SubagentRuntimeStatusKind::Idle
        ));
        assert!(!should_auto_cleanup_subagent_worktree(
            SubagentRuntimeStatusKind::Running
        ));
        assert!(!should_auto_cleanup_subagent_worktree(
            SubagentRuntimeStatusKind::Closed
        ));
    }

    #[test]
    fn test_resolve_missing_subagent_worktree_restore_falls_back_to_original_cwd() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let repo = temp_dir.path().join("repo");
        std::fs::create_dir_all(&repo).expect("create repo dir");
        let worktree_path = repo.join(".aster/worktrees/agent-test-missing");

        let mut session = aster::session::Session::default();
        session.id = "child-missing-worktree".to_string();
        session.working_dir = worktree_path.clone();
        WorktreeSessionState {
            original_cwd: repo.display().to_string(),
            git_root: repo.display().to_string(),
            worktree_path: worktree_path.display().to_string(),
            worktree_branch: Some("aster/worktree/agent-test-missing".to_string()),
            original_head_commit: Some("deadbeef".to_string()),
            slug: "agent-test-missing".to_string(),
        }
        .to_extension_data(&mut session.extension_data)
        .expect("persist fake worktree state");

        let restore = resolve_missing_subagent_worktree_restore(&session)
            .expect("resolve restore should succeed")
            .expect("missing worktree should require restore");

        assert_eq!(restore.original_cwd, repo);
        assert!(WorktreeSessionState::from_extension_data(&restore.extension_data).is_none());
    }
}
