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

fn extract_runtime_message_text(message: &AgentMessage) -> Option<String> {
    let parts = message
        .content
        .iter()
        .filter_map(|content| match content {
            AgentMessageContent::Text { text } => {
                let trimmed = text.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            }
            AgentMessageContent::ToolResponse {
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
        .and_then(extract_runtime_message_text)
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
        "兼容入口。仅用于兼容仍输出旧 SubAgentTask schema 的历史提示词或旧技能；内部会退化为串行 team runtime 调用，不适合作为新的多代理并发主路径。新实现优先直接使用 Agent / TeamCreate / TeamDelete / SendMessage / ListPeers。"
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
                name: None,
                team_name: None,
                agent_type: Some(role.to_string()),
                model: input.model.clone(),
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
                mode: None,
                isolation: None,
                cwd: None,
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
                team_phase: None,
                team_parallel_budget: None,
                team_active_count: None,
                team_queued_count: None,
                provider_concurrency_group: None,
                provider_parallel_budget: None,
                queue_reason: None,
                retryable_overload: false,
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
            "compat_mode": "SubAgentTask->Agent",
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

fn build_agent_control_tool_config(
    runtime: SubagentControlRuntime,
) -> aster::tools::AgentControlToolConfig {
    let spawn_runtime = runtime.clone();
    let send_runtime = runtime;

    aster::tools::AgentControlToolConfig::new()
        .with_spawn_agent_callback(Arc::new(move |request| {
            let runtime = spawn_runtime.clone();
            Box::pin(async move {
                let response = agent_runtime_spawn_subagent_internal(
                    &runtime,
                    AgentRuntimeSpawnSubagentRequest {
                        parent_session_id: request.parent_session_id,
                        message: request.message,
                        name: request.name,
                        team_name: request.team_name,
                        agent_type: request.agent_type,
                        model: request.model,
                        run_in_background: false,
                        reasoning_effort: request.reasoning_effort,
                        fork_context: request.fork_context,
                        blueprint_role_id: request.blueprint_role_id,
                        blueprint_role_label: request.blueprint_role_label,
                        profile_id: request.profile_id,
                        profile_name: request.profile_name,
                        role_key: request.role_key,
                        skill_ids: request.skill_ids,
                        skill_directories: request.skill_directories,
                        team_preset_id: request.team_preset_id,
                        theme: request.theme,
                        system_overlay: request.system_overlay,
                        output_contract: request.output_contract,
                        mode: None,
                        isolation: None,
                        cwd: request.cwd,
                    },
                )
                .await?;

                Ok(aster::tools::SpawnAgentResponse {
                    agent_id: response.agent_id,
                    nickname: response.nickname,
                    extra: std::collections::BTreeMap::new(),
                })
            })
        }))
        .with_send_input_callback(Arc::new(move |request| {
            let runtime = send_runtime.clone();
            Box::pin(async move {
                let response = agent_runtime_send_subagent_input_internal(
                    &runtime,
                    AgentRuntimeSendSubagentInputRequest {
                        id: request.id,
                        message: request.message,
                        interrupt: request.interrupt,
                    },
                )
                .await?;

                Ok(aster::tools::SendInputResponse {
                    submission_id: response.submission_id,
                    extra: std::collections::BTreeMap::new(),
                })
            })
        }))
}

fn remove_duplicate_current_surface_agent_tool(registry: &mut aster::tools::ToolRegistry) {
    registry.unregister("Agent");
}

pub(super) fn register_subagent_runtime_tools(
    registry: &mut aster::tools::ToolRegistry,
    runtime: SubagentControlRuntime,
) {
    registry.register(Box::new(SubAgentTaskTool::new(runtime.clone())));
    aster::tools::register_agent_control_tools(registry, &build_agent_control_tool_config(runtime));
    // 本地联调中的 Aster current surface 会在 Agent::list_tools() 里额外注入一份 `Agent`。
    // 如果这里继续保留 registry 侧的同名 `Agent`，provider 在格式化 tools 时会直接报重名。
    // 保留 registry 侧的 SendMessage，并把 current-surface `Agent` 统一交给 Aster 自身处理。
    remove_duplicate_current_surface_agent_tool(registry);
    registry.register(Box::new(aster::tools::TeamCreateTool::new()));
    registry.register(Box::new(aster::tools::TeamDeleteTool::new()));
    registry.register(Box::new(aster::tools::ListPeersTool::new()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_remove_duplicate_current_surface_agent_tool_keeps_send_message() {
        let mut registry = aster::tools::ToolRegistry::new();
        let spawn_callback: aster::tools::SpawnAgentCallback = Arc::new(|request| {
            Box::pin(async move {
                Ok(aster::tools::SpawnAgentResponse {
                    agent_id: request.parent_session_id,
                    nickname: None,
                    extra: std::collections::BTreeMap::new(),
                })
            })
        });
        let send_input_callback: aster::tools::SendInputCallback = Arc::new(|request| {
            Box::pin(async move {
                Ok(aster::tools::SendInputResponse {
                    submission_id: request.id,
                    extra: std::collections::BTreeMap::new(),
                })
            })
        });

        aster::tools::register_agent_control_tools(
            &mut registry,
            &aster::tools::AgentControlToolConfig::new()
                .with_spawn_agent_callback(spawn_callback)
                .with_send_input_callback(send_input_callback),
        );

        assert!(registry.contains("Agent"));
        assert!(registry.contains("SendMessage"));

        remove_duplicate_current_surface_agent_tool(&mut registry);

        assert!(!registry.contains("Agent"));
        assert!(registry.contains("SendMessage"));
    }
}
