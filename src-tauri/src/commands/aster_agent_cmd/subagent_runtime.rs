use super::*;
use lime_agent::restore_aster_runtime_queued_turns;
use lime_agent::AgentEvent as RuntimeAgentEvent;

const SUBAGENT_RUNTIME_EVENT_PREFIX: &str = "agent_subagent_stream";
const SUBAGENT_STATUS_EVENT_PREFIX: &str = "agent_subagent_status";
const SUBAGENT_CONTROL_CLOSE_REASON: &str = "close_agent";
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

fn validate_spawn_request_surface(
    request: &AgentRuntimeSpawnSubagentRequest,
) -> Result<(), String> {
    if normalize_optional_text(request.mode.clone()).is_some() {
        return Err("mode is not supported in the current runtime".to_string());
    }
    if normalize_optional_text(request.isolation.clone()).is_some() {
        return Err("isolation is not supported in the current runtime".to_string());
    }

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

pub(crate) fn build_subagent_customization_state(
    request: &AgentRuntimeSpawnSubagentRequest,
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
        system_overlay: normalize_optional_text(request.system_overlay.clone())
            .or_else(|| profile.map(|descriptor| descriptor.system_overlay.to_string())),
        skill_ids,
        skills,
    };

    if state.is_empty() {
        Ok(None)
    } else {
        Ok(Some(state))
    }
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

#[derive(Debug, Clone)]
struct PreparedRuntimeSubagentSession {
    session: aster::session::Session,
    customization: Option<SubagentCustomizationState>,
    system_prompt: Option<String>,
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
    manager
        .get_by_path(working_dir)
        .map_err(|error| format!("解析 workspace 失败: {error}"))?
        .map(|workspace| workspace.id)
        .ok_or_else(|| {
            format!(
                "无法根据 working_dir 解析 workspace: {}",
                working_dir.to_string_lossy()
            )
        })
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
    let teammate_name = normalize_optional_text(request.name.clone());
    let team_name = normalize_optional_text(request.team_name.clone());
    if team_name.is_some() && teammate_name.is_none() {
        return Err("team_name 需要同时提供 name".to_string());
    }
    enforce_team_spawn_limits(&parent_session_id).await?;
    let parent_session = read_session(&parent_session_id, false, "读取父会话失败").await?;
    let customization = build_subagent_customization_state(request)?;
    let system_prompt = build_subagent_customization_system_prompt(customization.as_ref())?;
    let profile_name = customization
        .as_ref()
        .and_then(|state| state.profile_name.as_deref());
    let role_hint = resolve_subagent_role_hint(request, customization.as_ref());
    let working_dir =
        resolve_spawn_working_dir(parent_session.working_dir.as_path(), request.cwd.clone())?;

    let session = create_subagent_session(
        working_dir,
        build_subagent_session_name(
            teammate_name.as_deref(),
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
    if let (Some(team_name), Some(teammate_name)) = (team_name, teammate_name.clone()) {
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
        request.model.as_deref(),
    )
    .await?;

    Ok(PreparedRuntimeSubagentSession {
        session,
        customization,
        system_prompt,
    })
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
            approval_policy: None,
            sandbox_policy: None,
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
                    "team_name": request.team_name,
                    "agent_type": request.agent_type,
                    "run_in_background": request.run_in_background,
                    "reasoning_effort": request.reasoning_effort,
                    "fork_context": request.fork_context,
                    "mode": request.mode,
                    "isolation": request.isolation,
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

    let (session, _) = read_subagent_control_state(&session_id).await?;
    let customization = SubagentCustomizationState::from_session(&session);
    let system_prompt = build_subagent_customization_system_prompt(customization.as_ref())?;
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
        event_name: build_subagent_runtime_event_name(&session_id),
        images: None,
        provider_config: None,
        provider_preference: None,
        model_preference: None,
        thinking_enabled: None,
        approval_policy: None,
        sandbox_policy: None,
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
        if control_state.closed {
            continue;
        }

        let _ = runtime.state.cancel_session(&target_id).await;
        let cleared_queued_turns = runtime_command_context
            .clear_runtime_queue(&target_id)
            .await
            .unwrap_or_default();
        let next_state = SubagentControlState::closed(
            Some(SUBAGENT_CONTROL_CLOSE_REASON.to_string()),
            merge_stashed_queued_turns(control_state.stashed_queued_turns, cleared_queued_turns),
        );
        write_subagent_control_state(&session, &next_state).await?;
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
    fn test_validate_spawn_request_surface_rejects_mode_and_isolation() {
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
            mode: Some("plan".to_string()),
            isolation: None,
            cwd: None,
        };

        assert_eq!(
            validate_spawn_request_surface(&request).unwrap_err(),
            "mode is not supported in the current runtime"
        );

        let isolation_request = AgentRuntimeSpawnSubagentRequest {
            mode: None,
            isolation: Some("worktree".to_string()),
            ..request
        };

        assert_eq!(
            validate_spawn_request_surface(&isolation_request).unwrap_err(),
            "isolation is not supported in the current runtime"
        );
    }
}
