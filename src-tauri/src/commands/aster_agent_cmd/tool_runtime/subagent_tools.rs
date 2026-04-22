use super::*;

#[cfg(test)]
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

#[cfg(test)]
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
                    map_spawn_agent_request_to_runtime_request(request),
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

fn map_spawn_agent_request_to_runtime_request(
    request: aster::tools::SpawnAgentRequest,
) -> AgentRuntimeSpawnSubagentRequest {
    AgentRuntimeSpawnSubagentRequest {
        parent_session_id: request.parent_session_id,
        message: request.message,
        name: request.name,
        team_name: request.team_name,
        agent_type: request.agent_type,
        model: request.model,
        run_in_background: request.run_in_background,
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
        hooks: request.hooks,
        allowed_tools: request.allowed_tools,
        disallowed_tools: request.disallowed_tools,
        mode: request.mode,
        isolation: request.isolation,
        cwd: request.cwd,
    }
}

fn remove_duplicate_current_surface_agent_tool(registry: &mut aster::tools::ToolRegistry) {
    registry.unregister("Agent");
}

pub(super) fn register_subagent_runtime_tools(
    registry: &mut aster::tools::ToolRegistry,
    runtime: SubagentControlRuntime,
) {
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

    #[test]
    fn test_map_spawn_agent_request_to_runtime_request_preserves_current_surface_fields() {
        let runtime_request =
            map_spawn_agent_request_to_runtime_request(aster::tools::SpawnAgentRequest {
                parent_session_id: "parent-1".to_string(),
                message: "请继续排查 runtime 差异".to_string(),
                name: Some("diag".to_string()),
                team_name: Some("runtime-team".to_string()),
                agent_type: Some("explorer".to_string()),
                model: Some("gpt-5.4".to_string()),
                run_in_background: true,
                reasoning_effort: Some("high".to_string()),
                fork_context: true,
                blueprint_role_id: Some("runtime-explorer".to_string()),
                blueprint_role_label: Some("分析".to_string()),
                profile_id: Some("code-explorer".to_string()),
                profile_name: Some("代码分析员".to_string()),
                role_key: Some("explorer".to_string()),
                skill_ids: vec!["repo-exploration".to_string()],
                skill_directories: vec!["./skills".to_string()],
                team_preset_id: Some("code-triage-team".to_string()),
                theme: Some("engineering".to_string()),
                system_overlay: Some("只输出结论与证据".to_string()),
                output_contract: Some("json".to_string()),
                hooks: None,
                allowed_tools: vec!["Read".to_string(), "Bash".to_string()],
                disallowed_tools: vec!["WebSearch".to_string()],
                mode: Some("acceptEdits".to_string()),
                isolation: Some("worktree".to_string()),
                cwd: Some("/tmp/workspace".to_string()),
            });

        assert_eq!(runtime_request.parent_session_id, "parent-1");
        assert_eq!(runtime_request.message, "请继续排查 runtime 差异");
        assert_eq!(runtime_request.name.as_deref(), Some("diag"));
        assert_eq!(runtime_request.team_name.as_deref(), Some("runtime-team"));
        assert_eq!(runtime_request.agent_type.as_deref(), Some("explorer"));
        assert_eq!(runtime_request.model.as_deref(), Some("gpt-5.4"));
        assert!(runtime_request.run_in_background);
        assert_eq!(runtime_request.reasoning_effort.as_deref(), Some("high"));
        assert!(runtime_request.fork_context);
        assert_eq!(
            runtime_request.blueprint_role_id.as_deref(),
            Some("runtime-explorer")
        );
        assert_eq!(runtime_request.profile_id.as_deref(), Some("code-explorer"));
        assert_eq!(runtime_request.role_key.as_deref(), Some("explorer"));
        assert_eq!(runtime_request.skill_ids, vec!["repo-exploration"]);
        assert_eq!(runtime_request.skill_directories, vec!["./skills"]);
        assert_eq!(
            runtime_request.team_preset_id.as_deref(),
            Some("code-triage-team")
        );
        assert_eq!(runtime_request.theme.as_deref(), Some("engineering"));
        assert_eq!(
            runtime_request.system_overlay.as_deref(),
            Some("只输出结论与证据")
        );
        assert_eq!(runtime_request.output_contract.as_deref(), Some("json"));
        assert_eq!(runtime_request.allowed_tools, vec!["Read", "Bash"]);
        assert_eq!(runtime_request.disallowed_tools, vec!["WebSearch"]);
        assert_eq!(runtime_request.mode.as_deref(), Some("acceptEdits"));
        assert_eq!(runtime_request.isolation.as_deref(), Some("worktree"));
        assert_eq!(runtime_request.cwd.as_deref(), Some("/tmp/workspace"));
    }
}
