use super::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubAgentTaskToolInput {
    pub(crate) prompt: String,
    pub(crate) task_type: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) role: Option<String>,
    pub(crate) timeout_secs: Option<u64>,
    pub(crate) model: Option<String>,
    pub(crate) return_summary: Option<bool>,
    pub(crate) allowed_tools: Option<Vec<String>>,
    pub(crate) denied_tools: Option<Vec<String>>,
    pub(crate) max_tokens: Option<usize>,
}

pub(crate) fn parse_subagent_role(raw: Option<&str>) -> Result<SubAgentRole, ToolError> {
    let normalized = raw
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "executor".to_string());

    match normalized.as_str() {
        "" | "executor" | "execute" | "code" => Ok(SubAgentRole::Executor),
        "planner" | "plan" => Ok(SubAgentRole::Planner),
        "explorer" | "explore" | "research" => Ok(SubAgentRole::Explorer),
        _ => Err(ToolError::invalid_params(format!(
            "未知 SubAgent 角色: {}，支持 explorer/planner/executor",
            normalized
        ))),
    }
}

fn default_subagent_task_type(role: SubAgentRole) -> &'static str {
    match role {
        SubAgentRole::Explorer => "explore",
        SubAgentRole::Planner => "plan",
        SubAgentRole::Executor => "code",
    }
}

pub(crate) fn build_subagent_task_definition(
    input: &SubAgentTaskToolInput,
    role: SubAgentRole,
) -> Result<SubAgentTask, ToolError> {
    let prompt = input.prompt.trim();
    if prompt.is_empty() {
        return Err(ToolError::invalid_params(
            "SubAgentTask.prompt 不能为空".to_string(),
        ));
    }

    let task_type = input
        .task_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_subagent_task_type(role));

    let mut task = SubAgentTask::new(uuid::Uuid::new_v4().to_string(), task_type, prompt);

    if let Some(description) = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        task = task.with_description(description.to_string());
    }

    if let Some(timeout_secs) = input.timeout_secs.filter(|value| *value > 0) {
        task = task.with_timeout(Duration::from_secs(timeout_secs));
    }

    if let Some(model) = input
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        task = task.with_model(model.to_string());
    }

    if let Some(return_summary) = input.return_summary {
        task = task.with_summary(return_summary);
    }

    if let Some(allowed_tools) = input
        .allowed_tools
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        task = task.with_allowed_tools(allowed_tools.clone());
    }

    if let Some(denied_tools) = input
        .denied_tools
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        task = task.with_denied_tools(denied_tools.clone());
    }

    if let Some(max_tokens) = input.max_tokens.filter(|value| *value > 0) {
        task = task.with_max_tokens(max_tokens);
    }

    Ok(task)
}

pub(crate) fn build_subagent_task_runtime_message(
    input: &SubAgentTaskToolInput,
    task: &SubAgentTask,
    role: SubAgentRole,
) -> String {
    let mut sections = Vec::new();

    if let Some(description) = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(format!("任务标题：{description}"));
    }

    sections.push(format!("子代理角色：{role}"));

    if let Some(task_type) = input
        .task_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(format!("任务类型：{task_type}"));
    }

    if let Some(allowed_tools) = input
        .allowed_tools
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        sections.push(format!(
            "工具偏好：优先仅使用这些工具：{}",
            allowed_tools.join(", ")
        ));
    }

    if let Some(denied_tools) = input
        .denied_tools
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        sections.push(format!("避免使用这些工具：{}", denied_tools.join(", ")));
    }

    if let Some(max_tokens) = input.max_tokens.filter(|value| *value > 0) {
        sections.push(format!(
            "输出控制：请尽量将最终输出控制在 {max_tokens} tokens 内。"
        ));
    }

    sections.push(
        "协作约束：你不是唯一工作线程。请只处理当前明确分配的子任务，不要重复主线程或其他子代理的工作，不要再创建新的子代理。"
            .to_string(),
    );

    sections.push("任务说明：".to_string());
    sections.push(task.prompt.clone());

    sections.join("\n")
}

pub(crate) fn collect_subagent_task_compat_warnings(input: &SubAgentTaskToolInput) -> Vec<String> {
    let mut warnings = Vec::new();

    if input
        .allowed_tools
        .as_ref()
        .is_some_and(|items| !items.is_empty())
    {
        warnings
            .push("allowedTools 已降级为对子代理的提示，不再由旧 scheduler 做硬限制".to_string());
    }

    if input
        .denied_tools
        .as_ref()
        .is_some_and(|items| !items.is_empty())
    {
        warnings
            .push("deniedTools 已降级为对子代理的提示，不再由旧 scheduler 做硬限制".to_string());
    }

    if input.max_tokens.is_some_and(|value| value > 0) {
        warnings.push("maxTokens 已降级为输出提示，当前 team runtime 不做强制截断".to_string());
    }

    warnings
}

fn extract_tauri_message_text(message: &TauriMessage) -> Option<String> {
    let parts = message
        .content
        .iter()
        .filter_map(|content| match content {
            TauriMessageContent::Text { text } => {
                let trimmed = text.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            }
            TauriMessageContent::ToolResponse {
                output, success, ..
            } if *success => {
                let trimmed = output.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            }
            _ => None,
        })
        .collect::<Vec<_>>();

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

pub(crate) fn extract_runtime_subagent_result_text(detail: &SessionDetail) -> Option<String> {
    detail
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "assistant")
        .and_then(extract_tauri_message_text)
        .or_else(|| {
            detail.items.iter().rev().find_map(|item| {
                match &item.payload {
                lime_core::database::dao::agent_timeline::AgentThreadItemPayload::TurnSummary {
                    text,
                }
                | lime_core::database::dao::agent_timeline::AgentThreadItemPayload::Plan { text }
                | lime_core::database::dao::agent_timeline::AgentThreadItemPayload::AgentMessage {
                    text,
                    ..
                }
                | lime_core::database::dao::agent_timeline::AgentThreadItemPayload::Reasoning {
                    text,
                    ..
                } => {
                    let trimmed = text.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                }
                lime_core::database::dao::agent_timeline::AgentThreadItemPayload::Error {
                    message,
                } => {
                    let trimmed = message.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                }
                lime_core::database::dao::agent_timeline::AgentThreadItemPayload::SubagentActivity {
                    summary,
                    ..
                } => summary
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string),
                _ => None,
            }
            })
        })
        .or_else(|| {
            detail
                .turns
                .iter()
                .rev()
                .find_map(|turn| turn.error_message.clone())
                .map(|message| message.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

fn summarize_runtime_subagent_execution(
    role: SubAgentRole,
    status: &SubagentRuntimeStatus,
    detail: Option<&SessionDetail>,
) -> String {
    let result_text = detail
        .and_then(extract_runtime_subagent_result_text)
        .unwrap_or_else(|| "未返回摘要".to_string());

    match status.kind {
        SubagentRuntimeStatusKind::Completed => {
            format!("子代理({role}) 已通过 team runtime 完成任务。\n\n{result_text}")
        }
        SubagentRuntimeStatusKind::Failed | SubagentRuntimeStatusKind::Aborted => {
            format!("子代理({role}) 执行失败。\n\n{result_text}")
        }
        SubagentRuntimeStatusKind::Closed => {
            format!("子代理({role}) 已关闭。\n\n{result_text}")
        }
        SubagentRuntimeStatusKind::NotFound => {
            format!("子代理({role}) 未找到，无法获取结果。")
        }
        _ => format!(
            "子代理({role}) 当前状态为 {:?}。\n\n{result_text}",
            status.kind
        ),
    }
}

#[derive(Debug, Clone)]
struct SubAgentTaskTool {
    runtime: SubagentControlRuntime,
}

impl SubAgentTaskTool {
    fn new(runtime: SubagentControlRuntime) -> Self {
        Self { runtime }
    }
}

#[async_trait]
impl Tool for SubAgentTaskTool {
    fn name(&self) -> &str {
        "SubAgentTask"
    }

    fn description(&self) -> &str {
        "兼容入口。仅用于兼容仍输出旧 SubAgentTask schema 的历史提示词或旧技能；内部会退化为串行的 spawn_agent + wait_agent，不适合作为新的多代理并发主路径。新实现优先直接使用 spawn_agent / send_input / wait_agent / resume_agent / close_agent。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "子代理要执行的任务说明"
                },
                "taskType": {
                    "type": "string",
                    "description": "任务类型，例如 explore、plan、code、review"
                },
                "description": {
                    "type": "string",
                    "description": "展示给用户的任务标题"
                },
                "role": {
                    "type": "string",
                    "description": "子代理角色：explorer、planner、executor"
                },
                "timeoutSecs": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "单个子任务超时时间（秒）"
                },
                "model": {
                    "type": "string",
                    "description": "可选模型名"
                },
                "returnSummary": {
                    "type": "boolean",
                    "description": "是否优先返回摘要"
                },
                "allowedTools": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "显式允许的工具列表"
                },
                "deniedTools": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "显式拒绝的工具列表"
                },
                "maxTokens": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "子代理最大 token 限制"
                }
            },
            "required": ["prompt"],
            "additionalProperties": false
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(0)
            .with_base_timeout(Duration::from_secs(900))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: SubAgentTaskToolInput = serde_json::from_value(params)
            .map_err(|err| ToolError::invalid_params(format!("SubAgentTask 参数无效: {err}")))?;
        let role = parse_subagent_role(input.role.as_deref())?;
        let task = build_subagent_task_definition(&input, role)?;
        let task_id = task.id.clone();
        let parent_session_id = normalize_required_text(&context.session_id, "session_id")
            .map_err(ToolError::invalid_params)?;
        let compat_warnings = collect_subagent_task_compat_warnings(&input);
        let response = agent_runtime_spawn_subagent_internal(
            &self.runtime,
            AgentRuntimeSpawnSubagentRequest {
                parent_session_id,
                message: build_subagent_task_runtime_message(&input, &task, role),
                agent_type: Some(role.to_string()),
                model: input.model.clone(),
                reasoning_effort: None,
                fork_context: false,
                profile_id: None,
                profile_name: None,
                role_key: None,
                skill_ids: Vec::new(),
                skill_directories: Vec::new(),
                team_preset_id: None,
                theme: None,
                system_overlay: None,
                output_contract: None,
            },
        )
        .await
        .map_err(|error| {
            ToolError::execution_failed(format!(
                "SubAgentTask 已切到 team runtime，但创建子代理失败: {error}"
            ))
        })?;

        let timeout_ms = input
            .timeout_secs
            .unwrap_or(900)
            .saturating_mul(1000)
            .min(i64::MAX as u64) as i64;
        let wait_result = agent_runtime_wait_subagents_internal(
            &self.runtime,
            AgentRuntimeWaitSubagentsRequest {
                ids: vec![response.agent_id.clone()],
                timeout_ms: Some(timeout_ms),
            },
        )
        .await
        .map_err(|error| {
            ToolError::execution_failed(format!(
                "SubAgentTask 已创建子代理，但等待结果失败: {error}"
            ))
        })?;

        let detail =
            AsterAgentWrapper::get_runtime_session_detail(&self.runtime.db, &response.agent_id)
                .await
                .ok();
        let status = wait_result
            .status
            .get(&response.agent_id)
            .cloned()
            .unwrap_or(SubagentRuntimeStatus {
                session_id: response.agent_id.clone(),
                kind: if wait_result.timed_out {
                    SubagentRuntimeStatusKind::Running
                } else {
                    SubagentRuntimeStatusKind::NotFound
                },
                latest_turn_id: None,
                latest_turn_status: None,
                queued_turn_count: 0,
                closed: false,
            });

        let summary = if wait_result.timed_out {
            format!(
                "子代理({role}) 已创建，但在 {} 秒内未完成。可以继续通过 team workspace 跟踪: {}",
                input.timeout_secs.unwrap_or(900),
                response.agent_id
            )
        } else {
            summarize_runtime_subagent_execution(role, &status, detail.as_ref())
        };
        let metadata = serde_json::json!({
            "task_id": task_id,
            "agent_id": response.agent_id,
            "nickname": response.nickname,
            "role": role.to_string(),
            "status": status,
            "timed_out": wait_result.timed_out,
            "compat_mode": "subagent_task->spawn_agent",
            "compat_warnings": compat_warnings,
        });

        let success = !wait_result.timed_out && status.kind == SubagentRuntimeStatusKind::Completed;
        let result = if success {
            ToolResult::success(summary)
        } else {
            ToolResult::error(summary)
        };

        Ok(result
            .with_metadata("subagent", metadata)
            .with_metadata("role", serde_json::json!(role.to_string())))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnAgentToolInput {
    message: String,
    agent_type: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    fork_context: Option<bool>,
    profile_id: Option<String>,
    profile_name: Option<String>,
    role_key: Option<String>,
    #[serde(default)]
    skill_ids: Vec<String>,
    #[serde(default)]
    skill_directories: Vec<String>,
    team_preset_id: Option<String>,
    theme: Option<String>,
    system_overlay: Option<String>,
    output_contract: Option<String>,
}

#[derive(Debug, Clone)]
struct SpawnAgentTool {
    runtime: SubagentControlRuntime,
}

impl SpawnAgentTool {
    fn new(runtime: SubagentControlRuntime) -> Self {
        Self { runtime }
    }
}

#[async_trait]
impl Tool for SpawnAgentTool {
    fn name(&self) -> &str {
        "spawn_agent"
    }

    fn description(&self) -> &str {
        "仅在任务需要拆成多个独立子范围、并行评审/验证，或用户明确要求多代理时使用。先判断当前关键路径：如果下一步立即依赖结果，不要把阻塞工作委派出去；优先把可并行推进的 sidecar 子任务交给子代理，同时主线程继续做不重叠的工作。创建真实子代理会话，并异步开始执行首条任务。不要对简单任务创建子代理；多个子代理必须分工明确，避免修改同一片文件；当前 team runtime 默认不允许子代理继续创建新的子代理。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "发送给子代理的首条任务消息。应是边界清晰、可独立完成、不会与其他并发子代理写入范围重叠的子任务。"
                },
                "agentType": {
                    "type": "string",
                    "description": "子代理角色提示，例如 explorer/planner/executor，也可以是 Image #1 这类展示标签"
                },
                "model": {
                    "type": "string",
                    "description": "可选模型覆盖"
                },
                "reasoningEffort": {
                    "type": "string",
                    "description": "保留字段，当前仅记录到 metadata"
                },
                "forkContext": {
                    "type": "boolean",
                    "description": "保留字段，当前仅记录到 metadata"
                },
                "profileId": {
                    "type": "string",
                    "description": "可选内置 profile id，例如 code-explorer / code-executor / code-verifier"
                },
                "profileName": {
                    "type": "string",
                    "description": "可选 profile 展示名称，用于 Team Workspace 与子代理 prompt"
                },
                "roleKey": {
                    "type": "string",
                    "description": "可选角色键，例如 explorer / executor / verifier / researcher"
                },
                "skillIds": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "可选 builtin skill id 列表，用于附加子代理技能提示"
                },
                "skillDirectories": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "可选本地已安装 skill 目录名；会读取对应 SKILL.md 注入子代理 prompt"
                },
                "teamPresetId": {
                    "type": "string",
                    "description": "可选 team preset id，例如 code-triage-team / research-team / content-creation-team"
                },
                "theme": {
                    "type": "string",
                    "description": "可选子代理主题标签，用于 GUI 展示与 prompt 约束"
                },
                "systemOverlay": {
                    "type": "string",
                    "description": "附加给该子代理的额外系统约束"
                },
                "outputContract": {
                    "type": "string",
                    "description": "要求子代理遵循的输出契约"
                }
            },
            "required": ["message"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: SpawnAgentToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("spawn_agent 参数无效: {error}")))?;
        let response = agent_runtime_spawn_subagent_internal(
            &self.runtime,
            AgentRuntimeSpawnSubagentRequest {
                parent_session_id: context.session_id.clone(),
                message: input.message,
                agent_type: input.agent_type,
                model: input.model,
                reasoning_effort: input.reasoning_effort,
                fork_context: input.fork_context.unwrap_or(false),
                profile_id: input.profile_id,
                profile_name: input.profile_name,
                role_key: input.role_key,
                skill_ids: input.skill_ids,
                skill_directories: input.skill_directories,
                team_preset_id: input.team_preset_id,
                theme: input.theme,
                system_overlay: input.system_overlay,
                output_contract: input.output_contract,
            },
        )
        .await
        .map_err(ToolError::execution_failed)?;

        Ok(
            ToolResult::success(format!("子代理已创建: {}", response.agent_id)).with_metadata(
                "spawn_agent",
                serde_json::to_value(&response).unwrap_or_default(),
            ),
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
struct SendInputToolInput {
    id: String,
    message: String,
    #[serde(default)]
    interrupt: bool,
}

#[derive(Debug, Clone)]
struct SendInputTool {
    runtime: SubagentControlRuntime,
}

impl SendInputTool {
    fn new(runtime: SubagentControlRuntime) -> Self {
        Self { runtime }
    }
}

#[async_trait]
impl Tool for SendInputTool {
    fn name(&self) -> &str {
        "send_input"
    }

    fn description(&self) -> &str {
        "向已存在的子代理追加输入。对强依赖既有上下文的后续任务，优先复用已有子代理而不是重复 spawn；interrupt=true 时会先中断当前执行并清空旧队列。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "子代理 session id"
                },
                "message": {
                    "type": "string",
                    "description": "要发送给子代理的输入"
                },
                "interrupt": {
                    "type": "boolean",
                    "description": "是否先中断当前执行"
                }
            },
            "required": ["id", "message"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: SendInputToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("send_input 参数无效: {error}")))?;
        let response = agent_runtime_send_subagent_input_internal(
            &self.runtime,
            AgentRuntimeSendSubagentInputRequest {
                id: input.id,
                message: input.message,
                interrupt: input.interrupt,
            },
        )
        .await
        .map_err(ToolError::execution_failed)?;

        Ok(
            ToolResult::success(format!("子代理输入已提交: {}", response.submission_id))
                .with_metadata(
                    "send_input",
                    serde_json::to_value(&response).unwrap_or_default(),
                ),
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
struct WaitAgentToolInput {
    ids: Vec<String>,
    #[serde(default, alias = "timeoutMs")]
    timeout_ms: Option<i64>,
}

#[derive(Debug, Clone)]
struct WaitAgentTool {
    runtime: SubagentControlRuntime,
}

impl WaitAgentTool {
    fn new(runtime: SubagentControlRuntime) -> Self {
        Self { runtime }
    }
}

#[async_trait]
impl Tool for WaitAgentTool {
    fn name(&self) -> &str {
        "wait_agent"
    }

    fn description(&self) -> &str {
        "等待一个或多个子代理进入最终状态。只有在主线程确实被结果阻塞、下一步必须依赖这些结果时才调用；可以同时等待多个 id，任一子代理先完成就会返回。不要反复机械 wait，优先在等待前继续做不重叠的本地工作；timeout_ms 应与任务规模匹配，避免过短轮询。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "要等待的子代理 session id 列表"
                },
                "timeoutMs": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "最长等待时间（毫秒）"
                }
            },
            "required": ["ids"],
            "additionalProperties": false
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(0)
            .with_base_timeout(Duration::from_secs(310))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: WaitAgentToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("wait_agent 参数无效: {error}")))?;
        let response = agent_runtime_wait_subagents_internal(
            &self.runtime,
            AgentRuntimeWaitSubagentsRequest {
                ids: input.ids,
                timeout_ms: input.timeout_ms,
            },
        )
        .await
        .map_err(ToolError::execution_failed)?;
        let summary = if response.timed_out {
            "wait_agent 超时，未观测到最终状态".to_string()
        } else {
            format!("已观测到 {} 个子代理进入最终状态", response.status.len())
        };

        Ok(ToolResult::success(summary).with_metadata(
            "wait_agent",
            serde_json::to_value(&response).unwrap_or_default(),
        ))
    }
}

#[derive(Debug, Clone, Deserialize)]
struct ResumeAgentToolInput {
    id: String,
}

#[derive(Debug, Clone)]
struct ResumeAgentTool {
    runtime: SubagentControlRuntime,
}

impl ResumeAgentTool {
    fn new(runtime: SubagentControlRuntime) -> Self {
        Self { runtime }
    }
}

#[async_trait]
impl Tool for ResumeAgentTool {
    fn name(&self) -> &str {
        "resume_agent"
    }

    fn description(&self) -> &str {
        "恢复之前关闭的子代理；若子代理未关闭则返回当前状态"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "子代理 session id"
                }
            },
            "required": ["id"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ResumeAgentToolInput = serde_json::from_value(params).map_err(|error| {
            ToolError::invalid_params(format!("resume_agent 参数无效: {error}"))
        })?;
        let response = agent_runtime_resume_subagent_internal(
            &self.runtime,
            AgentRuntimeResumeSubagentRequest { id: input.id },
        )
        .await
        .map_err(ToolError::execution_failed)?;

        let changed_count = response.changed_session_ids.len();
        let success_message = if changed_count > 1 {
            format!("子代理已恢复，并级联恢复 {changed_count} 个会话")
        } else if changed_count == 1 {
            "子代理已恢复".to_string()
        } else {
            format!("子代理当前状态: {:?}", response.status.kind)
        };

        Ok(ToolResult::success(success_message).with_metadata(
            "resume_agent",
            serde_json::to_value(&response).unwrap_or_default(),
        ))
    }
}

#[derive(Debug, Clone, Deserialize)]
struct CloseAgentToolInput {
    id: String,
}

#[derive(Debug, Clone)]
struct CloseAgentTool {
    runtime: SubagentControlRuntime,
}

impl CloseAgentTool {
    fn new(runtime: SubagentControlRuntime) -> Self {
        Self { runtime }
    }
}

#[async_trait]
impl Tool for CloseAgentTool {
    fn name(&self) -> &str {
        "close_agent"
    }

    fn description(&self) -> &str {
        "关闭子代理并级联关闭其子树；历史保留，可后续恢复"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "子代理 session id"
                }
            },
            "required": ["id"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: CloseAgentToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("close_agent 参数无效: {error}")))?;
        let response = agent_runtime_close_subagent_internal(
            &self.runtime,
            AgentRuntimeCloseSubagentRequest { id: input.id },
        )
        .await
        .map_err(ToolError::execution_failed)?;

        let changed_count = response.changed_session_ids.len();
        let success_message = if changed_count > 1 {
            format!(
                "子代理已关闭，并级联关闭 {changed_count} 个会话；关闭前状态: {:?}",
                response.previous_status.kind
            )
        } else {
            format!(
                "子代理已关闭，关闭前状态: {:?}",
                response.previous_status.kind
            )
        };

        Ok(ToolResult::success(success_message).with_metadata(
            "close_agent",
            serde_json::to_value(&response).unwrap_or_default(),
        ))
    }
}

pub(super) fn register_subagent_runtime_tools(
    registry: &mut aster::tools::ToolRegistry,
    runtime: SubagentControlRuntime,
) {
    registry.register(Box::new(SubAgentTaskTool::new(runtime.clone())));
    registry.register(Box::new(SpawnAgentTool::new(runtime.clone())));
    registry.register(Box::new(SendInputTool::new(runtime.clone())));
    registry.register(Box::new(WaitAgentTool::new(runtime.clone())));
    registry.register(Box::new(ResumeAgentTool::new(runtime.clone())));
    registry.register(Box::new(CloseAgentTool::new(runtime)));
}
