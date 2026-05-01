use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use async_stream::try_stream;
use futures::stream::StreamExt;
use serde_json::{json, Value};
use tracing::debug;

use super::super::agents::Agent;
use crate::conversation::message::{Message, MessageContent, ToolRequest};
use crate::conversation::Conversation;
use crate::model::ModelConfig;
use crate::providers::base::{stream_from_single_message, MessageStream, Provider, ProviderUsage};
use crate::providers::errors::ProviderError;
use crate::providers::toolshim::{
    augment_message_with_tool_calls, convert_tool_messages_to_text,
    modify_system_prompt_for_tool_json, OllamaInterpreter,
};
use crate::session_context::current_turn_context;

use crate::agents::code_execution_extension::EXTENSION_NAME as CODE_EXECUTION_EXTENSION;
use crate::agents::subagent_tool::AGENT_TOOL_NAME;
use crate::session::{apply_session_update, query_session, SessionStore, TokenStatsUpdate};
#[cfg(test)]
use crate::session::{SessionManager, SessionType, TurnContextOverride};
use rmcp::model::Tool;

const LIME_RUNTIME_METADATA_KEY: &str = "lime_runtime";
const LIME_RUNTIME_TOOL_SURFACE_KEY: &str = "tool_surface";
const LIME_RUNTIME_IMAGE_INPUT_POLICY_KEY: &str = "image_input_policy";
const TURN_TOOL_SURFACE_DIRECT_ANSWER: &str = "direct_answer";
const TURN_TOOL_SURFACE_LOCAL_WORKSPACE: &str = "local_workspace";
const LOCAL_WORKSPACE_TOOL_NAMES: &[&str] = &["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
const DIRECT_ANSWER_TURN_GUIDANCE: &str = "【当前回合执行约束】本回合应优先直接回答。除非信息明显不足或用户明确要求，否则不要调用工具，也不要把简单回复扩展成多阶段流程。";
const LOCAL_WORKSPACE_TURN_GUIDANCE: &str = "【当前回合执行约束】本回合只允许使用本地工作区工具。先用最少的侦查动作定位关键文件，优先小范围目录/文件列表与精确搜索；通常先控制在 3 到 6 次工具调用内拿到关键证据，只有前一步明确暴露新线索时再继续深入。若需要连续侦查，请把相互独立的读取/搜索收敛成一批，并在同一条回复里一起发起 2 到 4 个彼此独立的只读工具调用，让运行时并行执行；先完成这一批，再直接输出 1 到 2 句用户可见的结论正文，说明已经确认了什么、还缺什么、为什么还要继续，不要额外输出“阶段结论”标题，再决定是否继续下一批。如果用户消息里已经点名绝对路径、仓库根或具体文件，就把这些显式路径当作本回合唯一优先入口；第一批只围绕这些路径展开，不要先扫描当前默认工作区或无关目录。读取文件时聚焦与问题直接相关的入口、注册表、配置和代码片段，避免重复枚举大目录、避免一次性展开超长目录或整文件全文，也不要把大段原文直接抄回最终回答，改用结论加文件路径。";

fn image_input_policy_disables_provider_images() -> bool {
    let Some(turn_context) = current_turn_context() else {
        return false;
    };
    let Some(Value::Object(runtime_metadata)) =
        turn_context.metadata.get(LIME_RUNTIME_METADATA_KEY)
    else {
        return false;
    };
    let Some(Value::Object(policy)) = runtime_metadata
        .get(LIME_RUNTIME_IMAGE_INPUT_POLICY_KEY)
        .or_else(|| runtime_metadata.get("imageInputPolicy"))
    else {
        return false;
    };

    let provider_supports_vision = policy
        .get("providerSupportsVision")
        .or_else(|| policy.get("provider_supports_vision"))
        .and_then(Value::as_bool);
    let dropped_image_count = policy
        .get("droppedImageCount")
        .or_else(|| policy.get("dropped_image_count"))
        .and_then(Value::as_u64)
        .unwrap_or(0);

    provider_supports_vision == Some(false) || dropped_image_count > 0
}

fn strip_images_for_text_only_provider(messages: &[Message]) -> Conversation {
    let mut removed_total = 0usize;
    let stripped_messages = messages
        .iter()
        .cloned()
        .map(|mut message| {
            let mut removed_from_message = 0usize;
            message.content.retain(|content| {
                if matches!(content, MessageContent::Image(_)) {
                    removed_from_message += 1;
                    false
                } else {
                    true
                }
            });

            if removed_from_message > 0 {
                removed_total += removed_from_message;
                message = message.with_text(format!(
                    "[系统提示] 这条历史消息包含 {} 张图片，但当前模型不支持图片输入；图片已在发送给模型前省略。",
                    removed_from_message
                ));
            }

            message
        })
        .collect::<Vec<_>>();

    if removed_total > 0 {
        tracing::warn!(
            removed_total,
            "[AsterAgent] 当前模型不支持图片输入，已在 provider 请求前省略图片内容"
        );
    }

    Conversation::new_unvalidated(stripped_messages)
}

fn coerce_value(s: &str, schema: &Value) -> Value {
    let type_str = schema.get("type");

    match type_str {
        Some(Value::String(t)) => match t.as_str() {
            "number" | "integer" => try_coerce_number(s),
            "boolean" => try_coerce_boolean(s),
            _ => Value::String(s.to_string()),
        },
        Some(Value::Array(types)) => {
            // Try each type in order
            for t in types {
                if let Value::String(type_name) = t {
                    match type_name.as_str() {
                        "number" | "integer" if s.parse::<f64>().is_ok() => {
                            return try_coerce_number(s)
                        }
                        "boolean" if matches!(s.to_lowercase().as_str(), "true" | "false") => {
                            return try_coerce_boolean(s)
                        }
                        _ => continue,
                    }
                }
            }
            Value::String(s.to_string())
        }
        _ => Value::String(s.to_string()),
    }
}

fn try_coerce_number(s: &str) -> Value {
    if let Ok(n) = s.parse::<f64>() {
        if n.fract() == 0.0 && n >= i64::MIN as f64 && n <= i64::MAX as f64 {
            json!(n as i64)
        } else {
            json!(n)
        }
    } else {
        Value::String(s.to_string())
    }
}

fn try_coerce_boolean(s: &str) -> Value {
    match s.to_lowercase().as_str() {
        "true" => json!(true),
        "false" => json!(false),
        _ => Value::String(s.to_string()),
    }
}

fn resolve_turn_tool_surface_mode() -> Option<String> {
    current_turn_context()?
        .metadata
        .get(LIME_RUNTIME_METADATA_KEY)
        .and_then(|value| value.get(LIME_RUNTIME_TOOL_SURFACE_KEY))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn is_local_workspace_tool(tool_name: &str) -> bool {
    LOCAL_WORKSPACE_TOOL_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(tool_name))
}

fn normalize_turn_metadata_tool_list(value: Option<&Value>) -> Vec<String> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut normalized = Vec::new();
    for item in items {
        let Some(name) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if normalized
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(name))
        {
            continue;
        }
        normalized.push(name.to_string());
    }
    normalized
}

fn extract_turn_scoped_tool_scope(metadata: &HashMap<String, Value>) -> (Vec<String>, Vec<String>) {
    let scope = metadata
        .get("tool_scope")
        .or_else(|| metadata.get("toolScope"))
        .and_then(Value::as_object)
        .or_else(|| metadata.get("subagent").and_then(Value::as_object));

    let allowed_tools = normalize_turn_metadata_tool_list(scope.and_then(|value| {
        value
            .get("allowed_tools")
            .or_else(|| value.get("allowedTools"))
    }));
    let disallowed_tools = normalize_turn_metadata_tool_list(scope.and_then(|value| {
        value
            .get("disallowed_tools")
            .or_else(|| value.get("disallowedTools"))
    }));

    (allowed_tools, disallowed_tools)
}

fn matches_turn_tool_scope(tool_name: &str, scope: &[String]) -> bool {
    scope
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(tool_name))
}

fn resolve_turn_tool_scope() -> (Vec<String>, Vec<String>) {
    current_turn_context()
        .map(|context| extract_turn_scoped_tool_scope(&context.metadata))
        .unwrap_or_default()
}

fn filter_tools_for_turn_scope(
    mut tools: Vec<Tool>,
    allowed_tools: &[String],
    disallowed_tools: &[String],
) -> Vec<Tool> {
    if !allowed_tools.is_empty() {
        tools.retain(|tool| matches_turn_tool_scope(&tool.name, allowed_tools));
    }
    if !disallowed_tools.is_empty() {
        tools.retain(|tool| !matches_turn_tool_scope(&tool.name, disallowed_tools));
    }
    tools
}

fn filter_tools_for_turn_surface(
    mut tools: Vec<Tool>,
    tool_surface_mode: Option<&str>,
) -> Vec<Tool> {
    match tool_surface_mode {
        Some(TURN_TOOL_SURFACE_DIRECT_ANSWER) => Vec::new(),
        Some(TURN_TOOL_SURFACE_LOCAL_WORKSPACE) => {
            tools.retain(|tool| is_local_workspace_tool(&tool.name));
            tools
        }
        _ => tools,
    }
}

fn should_strip_extension_prompt_context(tool_surface_mode: Option<&str>) -> bool {
    matches!(
        tool_surface_mode,
        Some(TURN_TOOL_SURFACE_DIRECT_ANSWER | TURN_TOOL_SURFACE_LOCAL_WORKSPACE)
    )
}

fn turn_surface_prompt_guidance(tool_surface_mode: Option<&str>) -> Option<&'static str> {
    match tool_surface_mode {
        Some(TURN_TOOL_SURFACE_DIRECT_ANSWER) => Some(DIRECT_ANSWER_TURN_GUIDANCE),
        Some(TURN_TOOL_SURFACE_LOCAL_WORKSPACE) => Some(LOCAL_WORKSPACE_TURN_GUIDANCE),
        _ => None,
    }
}

fn coerce_tool_arguments(
    arguments: Option<serde_json::Map<String, Value>>,
    tool_schema: &Value,
) -> Option<serde_json::Map<String, Value>> {
    let args = arguments?;

    let properties = tool_schema.get("properties").and_then(|p| p.as_object())?;

    let mut coerced = serde_json::Map::new();

    for (key, value) in args.iter() {
        let coerced_value =
            if let (Value::String(s), Some(prop_schema)) = (value, properties.get(key)) {
                coerce_value(s, prop_schema)
            } else {
                value.clone()
            };
        coerced.insert(key.clone(), coerced_value);
    }

    Some(coerced)
}

fn normalize_response_tool_requests(response: &Message, tool_requests: &[ToolRequest]) -> Message {
    let mut normalized_response = response.clone();
    let mut normalized_content = Vec::with_capacity(response.content.len());
    let mut tool_request_index = 0;

    for content in &response.content {
        match content {
            MessageContent::ToolRequest(_) => {
                if let Some(request) = tool_requests.get(tool_request_index) {
                    normalized_content.push(MessageContent::ToolRequest(request.clone()));
                }
                tool_request_index += 1;
            }
            _ => normalized_content.push(content.clone()),
        }
    }

    debug_assert_eq!(
        tool_request_index,
        tool_requests.len(),
        "normalized tool request count should match response tool request count",
    );

    normalized_response.content = normalized_content;
    normalized_response
}

async fn toolshim_postprocess(
    response: Message,
    toolshim_tools: &[Tool],
    toolshim_model: Option<&str>,
) -> Result<Message, ProviderError> {
    let interpreter = OllamaInterpreter::new_with_model(toolshim_model.map(str::to_string))
        .map_err(|e| {
            ProviderError::ExecutionError(format!("Failed to create OllamaInterpreter: {}", e))
        })?;

    augment_message_with_tool_calls(&interpreter, response, toolshim_tools)
        .await
        .map_err(|e| ProviderError::ExecutionError(format!("Failed to augment message: {}", e)))
}

impl Agent {
    pub async fn prepare_tools_and_prompt(
        &self,
        working_dir: &std::path::Path,
        session_prompt: Option<&str>,
        session_prompt_override: bool,
        model_config: &ModelConfig,
    ) -> Result<(Vec<Tool>, Vec<Tool>, String)> {
        let started_at = Instant::now();
        // Get tools from extension manager
        let mut tools = self.list_tools(None).await;

        // Add frontend tools
        let frontend_tools = self.frontend_tools.lock().await;
        for frontend_tool in frontend_tools.values() {
            tools.push(frontend_tool.tool.clone());
        }

        let code_execution_active = self
            .extension_manager
            .is_extension_enabled(CODE_EXECUTION_EXTENSION)
            .await;
        if code_execution_active {
            let code_exec_prefix = format!("{CODE_EXECUTION_EXTENSION}__");
            tools.retain(|tool| tool.name.starts_with(&code_exec_prefix));
        }

        let turn_tool_surface_mode = resolve_turn_tool_surface_mode();
        tools = filter_tools_for_turn_surface(tools, turn_tool_surface_mode.as_deref());
        let (turn_allowed_tools, turn_disallowed_tools) = resolve_turn_tool_scope();
        tools = filter_tools_for_turn_scope(tools, &turn_allowed_tools, &turn_disallowed_tools);
        let subagents_enabled = tools.iter().any(|tool| tool.name == AGENT_TOOL_NAME);

        // Stable tool ordering is important for multi session prompt caching.
        tools.sort_by(|a, b| a.name.cmp(&b.name));

        // Prepare system prompt
        let mut extensions_info = self.extension_manager.get_extensions_info().await;
        let (mut extension_count, mut tool_count) =
            self.extension_manager.get_extension_and_tool_counts().await;
        if should_strip_extension_prompt_context(turn_tool_surface_mode.as_deref()) {
            extensions_info.clear();
            extension_count = 0;
            tool_count = tools.len();
        }

        let final_output_instruction = self
            .final_output_tool
            .lock()
            .await
            .as_ref()
            .map(|tool| tool.system_prompt());

        let prompt_manager = self.prompt_manager.lock().await;
        let mut system_prompt = prompt_manager
            .builder()
            .with_extensions(extensions_info.into_iter())
            .with_frontend_instructions(self.frontend_instructions.lock().await.clone())
            .with_additional_instruction(final_output_instruction)
            .with_extension_and_tool_counts(extension_count, tool_count)
            .with_code_execution_mode(code_execution_active)
            .with_hints(working_dir)
            .with_enable_subagents(subagents_enabled)
            .with_session_prompt(session_prompt.map(|s| s.to_string()))
            .with_session_prompt_override(session_prompt_override)
            .build();
        if let Some(guidance) = turn_surface_prompt_guidance(turn_tool_surface_mode.as_deref()) {
            system_prompt.push_str("\n\n");
            system_prompt.push_str(guidance);
        }

        // Handle toolshim if enabled
        let mut toolshim_tools = vec![];
        if model_config.toolshim {
            // If tool interpretation is enabled, modify the system prompt
            system_prompt = modify_system_prompt_for_tool_json(&system_prompt, &tools);
            // Make a copy of tools before emptying
            toolshim_tools = tools.clone();
            // Empty the tools vector for provider completion
            tools = vec![];
        }

        tracing::info!(
            "[AsterAgent][TTFT] tools/prompt prepared: model={}, tool_surface={:?}, tools={}, toolshim_tools={}, system_chars={}, elapsed_ms={}",
            model_config.model_name,
            turn_tool_surface_mode,
            tools.len(),
            toolshim_tools.len(),
            system_prompt.chars().count(),
            started_at.elapsed().as_millis()
        );

        Ok((tools, toolshim_tools, system_prompt))
    }

    /// Stream a response from the LLM provider.
    /// Handles toolshim transformations if needed
    pub(crate) async fn stream_response_from_provider(
        provider: Arc<dyn Provider>,
        model_config: &ModelConfig,
        system_prompt: &str,
        messages: &[Message],
        tools: &[Tool],
        toolshim_tools: &[Tool],
    ) -> Result<MessageStream, ProviderError> {
        let started_at = Instant::now();
        // Convert tool messages to text if toolshim is enabled
        let messages_for_provider = if model_config.toolshim {
            convert_tool_messages_to_text(messages)
        } else {
            Conversation::new_unvalidated(messages.to_vec())
        };
        let messages_for_provider = if image_input_policy_disables_provider_images() {
            strip_images_for_text_only_provider(messages_for_provider.messages())
        } else {
            messages_for_provider
        };

        // Clone owned data to move into the async stream
        let model_config = model_config.clone();
        let system_prompt = system_prompt.to_owned();
        let tools = tools.to_owned();
        let toolshim_tools = toolshim_tools.to_owned();
        let provider = provider.clone();

        // Capture errors during stream creation and return them as part of the stream
        // so they can be handled by the existing error handling logic in the agent
        let stream_result = if provider.supports_streaming() {
            tracing::info!(
                "[AsterAgent][TTFT] provider stream request start: provider={}, model={}, messages={}, tools={}, system_chars={}",
                provider.get_name(),
                model_config.model_name,
                messages_for_provider.messages().len(),
                tools.len(),
                system_prompt.chars().count()
            );
            debug!("WAITING_LLM_STREAM_START");
            let result = provider
                .stream_with_model(
                    &model_config,
                    system_prompt.as_str(),
                    messages_for_provider.messages(),
                    &tools,
                )
                .await;
            let elapsed_ms = started_at.elapsed().as_millis();
            match &result {
                Ok(_) => tracing::info!(
                    "[AsterAgent][TTFT] provider stream response headers received: provider={}, model={}, elapsed_ms={}",
                    provider.get_name(),
                    model_config.model_name,
                    elapsed_ms
                ),
                Err(error) => tracing::warn!(
                    "[AsterAgent][TTFT] provider stream request failed before body: provider={}, model={}, elapsed_ms={}, error={}",
                    provider.get_name(),
                    model_config.model_name,
                    elapsed_ms,
                    error
                ),
            }
            debug!("WAITING_LLM_STREAM_END");
            result
        } else {
            tracing::info!(
                "[AsterAgent][TTFT] provider non-stream request start: provider={}, model={}, messages={}, tools={}, system_chars={}",
                provider.get_name(),
                model_config.model_name,
                messages_for_provider.messages().len(),
                tools.len(),
                system_prompt.chars().count()
            );
            debug!("WAITING_LLM_START");
            let complete_result = provider
                .complete_with_model(
                    &model_config,
                    system_prompt.as_str(),
                    messages_for_provider.messages(),
                    &tools,
                )
                .await;
            tracing::info!(
                "[AsterAgent][TTFT] provider non-stream response complete: provider={}, model={}, elapsed_ms={}",
                provider.get_name(),
                model_config.model_name,
                started_at.elapsed().as_millis()
            );
            debug!("WAITING_LLM_END");

            match complete_result {
                Ok((message, usage)) => Ok(stream_from_single_message(message, usage)),
                Err(e) => Err(e),
            }
        };

        // If there was an error creating the stream, return a stream that yields that error
        let mut stream = match stream_result {
            Ok(s) => s,
            Err(e) => {
                // Return a stream that immediately yields the error
                // This allows the error to be caught by existing error handling in agent.rs
                return Ok(Box::pin(try_stream! {
                    yield Err(e)?;
                }));
            }
        };

        Ok(Box::pin(try_stream! {
            let mut first_provider_message_seen = false;
            while let Some(next) = stream.next().await {
                let (mut message, usage) = next?;
                if !first_provider_message_seen {
                    first_provider_message_seen = true;
                    tracing::info!(
                        "[AsterAgent][TTFT] first provider stream message decoded: provider={}, model={}, elapsed_ms={}",
                        provider.get_name(),
                        model_config.model_name,
                        started_at.elapsed().as_millis()
                    );
                }
                // Store the model information in the global store
                if let Some(usage) = usage.as_ref() {
                    crate::providers::base::set_current_model(&usage.model);
                }

                // Post-process / structure the response only if tool interpretation is enabled
                if message.is_some() && model_config.toolshim {
                    message = Some(
                        toolshim_postprocess(
                            message.unwrap(),
                            &toolshim_tools,
                            model_config.toolshim_model.as_deref(),
                        )
                        .await?,
                    );
                }

                yield (message, usage);
            }
        }))
    }

    /// Categorize tool requests from the response into different types
    /// Returns:
    /// - frontend_requests: Tool requests that should be handled by the frontend
    /// - other_requests: All other tool requests (including requests to enable extensions)
    /// - filtered_message: The original message with frontend tool requests removed
    pub(crate) async fn categorize_tool_requests(
        &self,
        response: &Message,
        tools: &[Tool],
    ) -> (Vec<ToolRequest>, Vec<ToolRequest>, Message, Message) {
        // First collect all tool requests with coercion applied
        let tool_requests: Vec<ToolRequest> = response
            .content
            .iter()
            .filter_map(|content| {
                if let MessageContent::ToolRequest(req) = content {
                    let mut coerced_req = req.clone();

                    if let Ok(ref mut tool_call) = coerced_req.tool_call {
                        if let Some(tool) = tools.iter().find(|t| t.name == tool_call.name) {
                            let schema_value = Value::Object(tool.input_schema.as_ref().clone());
                            tool_call.arguments =
                                coerce_tool_arguments(tool_call.arguments.clone(), &schema_value);

                            if let Some(ref meta) = tool.meta {
                                coerced_req.tool_meta = serde_json::to_value(meta).ok();
                            }
                        }
                    }

                    Some(coerced_req)
                } else {
                    None
                }
            })
            .collect();

        // Create a filtered message with frontend tool requests removed
        let mut filtered_content = Vec::new();
        let mut tool_request_index = 0;

        for content in &response.content {
            match content {
                MessageContent::ToolRequest(_) => {
                    if tool_request_index < tool_requests.len() {
                        let coerced_req = &tool_requests[tool_request_index];
                        tool_request_index += 1;

                        let should_include = if let Ok(tool_call) = &coerced_req.tool_call {
                            !self.is_frontend_tool(&tool_call.name).await
                        } else {
                            true
                        };

                        if should_include {
                            filtered_content.push(MessageContent::ToolRequest(coerced_req.clone()));
                        }
                    }
                }
                _ => {
                    filtered_content.push(content.clone());
                }
            }
        }

        let mut filtered_message =
            Message::new(response.role.clone(), response.created, filtered_content);

        // Preserve the ID if it exists
        if let Some(id) = response.id.clone() {
            filtered_message = filtered_message.with_id(id);
        }

        let normalized_response = normalize_response_tool_requests(response, &tool_requests);

        // Categorize tool requests
        let mut frontend_requests = Vec::new();
        let mut other_requests = Vec::new();

        for request in tool_requests {
            if let Ok(tool_call) = &request.tool_call {
                if self.is_frontend_tool(&tool_call.name).await {
                    frontend_requests.push(request);
                } else {
                    other_requests.push(request);
                }
            } else {
                // If there's an error in the tool call, add it to other_requests
                other_requests.push(request);
            }
        }

        (
            frontend_requests,
            other_requests,
            filtered_message,
            normalized_response,
        )
    }

    pub(crate) async fn update_session_metrics(
        session_config: &crate::agents::types::SessionConfig,
        usage: &ProviderUsage,
        is_compaction_usage: bool,
        session_store: Option<&Arc<dyn SessionStore>>,
    ) -> Result<()> {
        let session_id = session_config.id.as_str();
        let session = if let Some(store) = session_store {
            store.get_session(session_id, false).await?
        } else {
            query_session(session_id, false).await?
        };

        let accumulate = |a: Option<i32>, b: Option<i32>| -> Option<i32> {
            match (a, b) {
                (Some(x), Some(y)) => Some(x + y),
                _ => a.or(b),
            }
        };

        let accumulated_total =
            accumulate(session.accumulated_total_tokens, usage.usage.total_tokens);
        let accumulated_input =
            accumulate(session.accumulated_input_tokens, usage.usage.input_tokens);
        let accumulated_output =
            accumulate(session.accumulated_output_tokens, usage.usage.output_tokens);

        let (current_total, current_input, current_output) = if is_compaction_usage {
            // After compaction: summary output becomes new input context
            let new_input = usage.usage.output_tokens;
            (new_input, new_input, None)
        } else {
            (
                usage.usage.total_tokens,
                usage.usage.input_tokens,
                usage.usage.output_tokens,
            )
        };
        let current_cached_input = if is_compaction_usage {
            Some(0)
        } else {
            usage.usage.cached_input_tokens
        };
        let current_cache_creation_input = if is_compaction_usage {
            Some(0)
        } else {
            usage.usage.cache_creation_input_tokens
        };

        if let Some(store) = session_store {
            store
                .update_token_stats(
                    session_id,
                    TokenStatsUpdate {
                        schedule_id: session_config.schedule_id.clone(),
                        total_tokens: current_total,
                        input_tokens: current_input,
                        output_tokens: current_output,
                        cached_input_tokens: current_cached_input,
                        cache_creation_input_tokens: current_cache_creation_input,
                        accumulated_total,
                        accumulated_input,
                        accumulated_output,
                    },
                )
                .await?;
        } else {
            apply_session_update(session_id, |update| {
                update
                    .schedule_id(session_config.schedule_id.clone())
                    .total_tokens(current_total)
                    .input_tokens(current_input)
                    .output_tokens(current_output)
                    .cached_input_tokens(current_cached_input)
                    .cache_creation_input_tokens(current_cache_creation_input)
                    .accumulated_total_tokens(accumulated_total)
                    .accumulated_input_tokens(accumulated_input)
                    .accumulated_output_tokens(accumulated_output)
            })
            .await?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::message::{Message, MessageContent, ToolRequest};
    use crate::model::ModelConfig;
    use crate::providers::base::{Provider, ProviderUsage, Usage};
    use crate::providers::errors::ProviderError;
    use crate::scheduler::{ScheduledJob, SchedulerError};
    use crate::scheduler_trait::SchedulerTrait;
    use crate::session::{Session, TurnContextOverride};
    use async_trait::async_trait;
    use chrono::{DateTime, Utc};
    use rmcp::object;
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[derive(Clone)]
    struct MockProvider {
        model_config: ModelConfig,
        observed_models: Option<std::sync::Arc<std::sync::Mutex<Vec<String>>>>,
    }

    #[async_trait]
    impl Provider for MockProvider {
        fn metadata() -> crate::providers::base::ProviderMetadata {
            crate::providers::base::ProviderMetadata::empty()
        }

        fn get_name(&self) -> &str {
            "mock"
        }

        fn get_model_config(&self) -> ModelConfig {
            self.model_config.clone()
        }

        async fn complete_with_model(
            &self,
            model_config: &ModelConfig,
            _system: &str,
            _messages: &[Message],
            _tools: &[Tool],
        ) -> anyhow::Result<(Message, ProviderUsage), ProviderError> {
            if let Some(observed_models) = &self.observed_models {
                observed_models
                    .lock()
                    .expect("record model override")
                    .push(model_config.model_name.clone());
            }
            Ok((
                Message::assistant().with_text("ok"),
                ProviderUsage::new(model_config.model_name.clone(), Usage::default()),
            ))
        }
    }

    #[derive(Clone)]
    struct RecordingProvider {
        model_config: ModelConfig,
        observed_messages: std::sync::Arc<std::sync::Mutex<Vec<Vec<Message>>>>,
    }

    #[async_trait]
    impl Provider for RecordingProvider {
        fn metadata() -> crate::providers::base::ProviderMetadata {
            crate::providers::base::ProviderMetadata::empty()
        }

        fn get_name(&self) -> &str {
            "recording"
        }

        fn get_model_config(&self) -> ModelConfig {
            self.model_config.clone()
        }

        async fn complete_with_model(
            &self,
            model_config: &ModelConfig,
            _system: &str,
            messages: &[Message],
            _tools: &[Tool],
        ) -> anyhow::Result<(Message, ProviderUsage), ProviderError> {
            self.observed_messages
                .lock()
                .expect("record provider messages")
                .push(messages.to_vec());
            Ok((
                Message::assistant().with_text("ok"),
                ProviderUsage::new(model_config.model_name.clone(), Usage::default()),
            ))
        }
    }

    /// Mock scheduler for testing
    struct MockScheduler;

    #[async_trait]
    impl SchedulerTrait for MockScheduler {
        async fn add_scheduled_job(
            &self,
            _job: ScheduledJob,
            _copy_recipe: bool,
        ) -> Result<(), SchedulerError> {
            Ok(())
        }
        async fn schedule_recipe(
            &self,
            _recipe_path: PathBuf,
            _cron_schedule: Option<String>,
        ) -> anyhow::Result<(), SchedulerError> {
            Ok(())
        }
        async fn list_scheduled_jobs(&self) -> Vec<ScheduledJob> {
            vec![]
        }
        async fn remove_scheduled_job(
            &self,
            _id: &str,
            _remove_recipe: bool,
        ) -> Result<(), SchedulerError> {
            Ok(())
        }
        async fn pause_schedule(&self, _id: &str) -> Result<(), SchedulerError> {
            Ok(())
        }
        async fn unpause_schedule(&self, _id: &str) -> Result<(), SchedulerError> {
            Ok(())
        }
        async fn run_now(&self, _id: &str) -> Result<String, SchedulerError> {
            Ok("mock-session".to_string())
        }
        async fn sessions(
            &self,
            _sched_id: &str,
            _limit: usize,
        ) -> Result<Vec<(String, Session)>, SchedulerError> {
            Ok(vec![])
        }
        async fn update_schedule(
            &self,
            _sched_id: &str,
            _new_cron: String,
        ) -> Result<(), SchedulerError> {
            Ok(())
        }
        async fn kill_running_job(&self, _sched_id: &str) -> Result<(), SchedulerError> {
            Ok(())
        }
        async fn get_running_job_info(
            &self,
            _sched_id: &str,
        ) -> Result<Option<(String, DateTime<Utc>)>, SchedulerError> {
            Ok(None)
        }
    }

    #[tokio::test]
    async fn prepare_tools_sorts_and_includes_frontend_and_list_tools() -> anyhow::Result<()> {
        let agent = crate::agents::Agent::new();

        // 设置 mock scheduler 以便 current cron tools 可用
        agent
            .set_scheduler(std::sync::Arc::new(MockScheduler))
            .await;

        let session = SessionManager::create_session(
            std::path::PathBuf::default(),
            "test-prepare-tools".to_string(),
            SessionType::Hidden,
        )
        .await?;

        let model_config = ModelConfig::new("test-model").unwrap();
        let provider = std::sync::Arc::new(MockProvider {
            model_config,
            observed_models: None,
        });
        agent.update_provider(provider, &session.id).await?;

        // Add unsorted frontend tools
        let frontend_tools = vec![
            Tool::new(
                "frontend__z_tool".to_string(),
                "Z tool".to_string(),
                object!({ "type": "object", "properties": { } }),
            ),
            Tool::new(
                "frontend__a_tool".to_string(),
                "A tool".to_string(),
                object!({ "type": "object", "properties": { } }),
            ),
        ];

        agent
            .add_extension(crate::agents::extension::ExtensionConfig::Frontend {
                name: "frontend".to_string(),
                description: "desc".to_string(),
                tools: frontend_tools,
                instructions: None,
                bundled: None,
                available_tools: vec![],
                deferred_loading: false,
                always_expose_tools: vec![],
                allowed_caller: None,
            })
            .await
            .unwrap();

        let working_dir = std::env::current_dir()?;
        let (tools, _toolshim_tools, _system_prompt) = agent
            .prepare_tools_and_prompt(
                &working_dir,
                None,
                false,
                &ModelConfig::new("test-model").unwrap(),
            )
            .await?;

        // Ensure both current cron tools and frontend tools are present
        let names: Vec<String> = tools.iter().map(|t| t.name.clone().into_owned()).collect();
        assert!(names.iter().any(|n| n == "CronCreate"));
        assert!(names.iter().any(|n| n == "CronList"));
        assert!(names.iter().any(|n| n == "CronDelete"));
        assert!(names.iter().any(|n| n == "EnterWorktree"));
        assert!(names.iter().any(|n| n == "ExitWorktree"));
        assert!(names.iter().any(|n| n == "SendUserMessage"));
        assert!(!names.iter().any(|n| n == "platform__manage_schedule"));
        assert!(names.iter().any(|n| n == "frontend__a_tool"));
        assert!(names.iter().any(|n| n == "frontend__z_tool"));

        // Verify the names are sorted ascending
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted);

        Ok(())
    }

    #[tokio::test]
    async fn prepare_tools_and_prompt_includes_turn_output_instruction() -> anyhow::Result<()> {
        let agent = crate::agents::Agent::new();

        let session = SessionManager::create_session(
            std::path::PathBuf::default(),
            "test-prepare-tools-output-schema".to_string(),
            SessionType::Hidden,
        )
        .await?;

        let model_config = ModelConfig::new("test-model").unwrap();
        let provider = std::sync::Arc::new(MockProvider {
            model_config,
            observed_models: None,
        });
        agent.update_provider(provider, &session.id).await?;
        agent
            .add_final_output_tool(serde_json::json!({
                "type": "object",
                "properties": {
                    "answer": {"type": "string"}
                }
            }))
            .await?;

        let working_dir = std::env::current_dir()?;
        let (_tools, _toolshim_tools, system_prompt) = agent
            .prepare_tools_and_prompt(
                &working_dir,
                None,
                false,
                &ModelConfig::new("test-model").unwrap(),
            )
            .await?;

        assert!(system_prompt.contains("# Structured Output Instructions"));
        assert!(system_prompt.contains("StructuredOutput"));
        assert!(system_prompt.contains("\"answer\""));
        Ok(())
    }

    fn build_turn_context_with_tool_surface(mode: &str) -> TurnContextOverride {
        let mut runtime_metadata = serde_json::Map::new();
        runtime_metadata.insert(
            LIME_RUNTIME_TOOL_SURFACE_KEY.to_string(),
            Value::String(mode.to_string()),
        );

        let mut metadata = HashMap::new();
        metadata.insert(
            LIME_RUNTIME_METADATA_KEY.to_string(),
            Value::Object(runtime_metadata),
        );

        TurnContextOverride {
            metadata,
            ..TurnContextOverride::default()
        }
    }

    fn build_turn_context_with_tool_scope(
        allowed_tools: Vec<&str>,
        disallowed_tools: Vec<&str>,
    ) -> TurnContextOverride {
        let mut metadata = HashMap::new();
        metadata.insert(
            "subagent".to_string(),
            json!({
                "allowed_tools": allowed_tools,
                "disallowed_tools": disallowed_tools,
            }),
        );

        TurnContextOverride {
            metadata,
            ..TurnContextOverride::default()
        }
    }

    fn build_turn_context_with_image_input_policy(
        provider_supports_vision: bool,
    ) -> TurnContextOverride {
        let mut metadata = HashMap::new();
        metadata.insert(
            LIME_RUNTIME_METADATA_KEY.to_string(),
            json!({
                "image_input_policy": {
                    "submittedImageCount": 1,
                    "forwardedImageCount": if provider_supports_vision { 1 } else { 0 },
                    "droppedImageCount": if provider_supports_vision { 0 } else { 1 },
                    "providerSupportsVision": provider_supports_vision,
                }
            }),
        );

        TurnContextOverride {
            metadata,
            ..TurnContextOverride::default()
        }
    }

    #[tokio::test]
    async fn prepare_tools_and_prompt_hides_all_tools_for_direct_answer_turn_surface(
    ) -> anyhow::Result<()> {
        let agent = crate::agents::Agent::new();

        let session = SessionManager::create_session(
            std::path::PathBuf::default(),
            "test-direct-answer-tool-surface".to_string(),
            SessionType::Hidden,
        )
        .await?;

        let model_config = ModelConfig::new("test-model").unwrap();
        let provider = std::sync::Arc::new(MockProvider {
            model_config,
            observed_models: None,
        });
        agent.update_provider(provider, &session.id).await?;

        let working_dir = std::env::current_dir()?;
        let (tools, _toolshim_tools, _system_prompt) = crate::session_context::with_turn_context(
            Some(build_turn_context_with_tool_surface(
                TURN_TOOL_SURFACE_DIRECT_ANSWER,
            )),
            async {
                agent
                    .prepare_tools_and_prompt(
                        &working_dir,
                        None,
                        false,
                        &ModelConfig::new("test-model").unwrap(),
                    )
                    .await
            },
        )
        .await?;

        assert!(tools.is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn prepare_tools_and_prompt_keeps_only_local_workspace_tools_for_local_workspace_turn_surface(
    ) -> anyhow::Result<()> {
        let agent = crate::agents::Agent::new();
        agent
            .set_scheduler(std::sync::Arc::new(MockScheduler))
            .await;

        let session = SessionManager::create_session(
            std::path::PathBuf::default(),
            "test-local-workspace-tool-surface".to_string(),
            SessionType::Hidden,
        )
        .await?;

        let model_config = ModelConfig::new("test-model").unwrap();
        let provider = std::sync::Arc::new(MockProvider {
            model_config,
            observed_models: None,
        });
        agent.update_provider(provider, &session.id).await?;

        let working_dir = std::env::current_dir()?;
        let (tools, _toolshim_tools, _system_prompt) = crate::session_context::with_turn_context(
            Some(build_turn_context_with_tool_surface(
                TURN_TOOL_SURFACE_LOCAL_WORKSPACE,
            )),
            async {
                agent
                    .prepare_tools_and_prompt(
                        &working_dir,
                        None,
                        false,
                        &ModelConfig::new("test-model").unwrap(),
                    )
                    .await
            },
        )
        .await?;

        assert!(!tools.is_empty());
        assert!(tools.iter().all(|tool| is_local_workspace_tool(&tool.name)));
        Ok(())
    }

    #[tokio::test]
    async fn prepare_tools_and_prompt_filters_turn_scoped_allowed_tools() -> anyhow::Result<()> {
        let agent = crate::agents::Agent::new();

        let session = SessionManager::create_session(
            std::path::PathBuf::default(),
            "test-turn-scoped-allowed-tools".to_string(),
            SessionType::Hidden,
        )
        .await?;

        let model_config = ModelConfig::new("test-model").unwrap();
        let provider = std::sync::Arc::new(MockProvider {
            model_config,
            observed_models: None,
        });
        agent.update_provider(provider, &session.id).await?;

        let working_dir = std::env::current_dir()?;
        let (tools, _toolshim_tools, _system_prompt) = crate::session_context::with_turn_context(
            Some(build_turn_context_with_tool_scope(
                vec!["Read", "Grep"],
                Vec::new(),
            )),
            async {
                agent
                    .prepare_tools_and_prompt(
                        &working_dir,
                        None,
                        false,
                        &ModelConfig::new("test-model").unwrap(),
                    )
                    .await
            },
        )
        .await?;

        let names: Vec<String> = tools.iter().map(|tool| tool.name.to_string()).collect();
        assert_eq!(names, vec!["Grep".to_string(), "Read".to_string()]);

        Ok(())
    }

    #[tokio::test]
    async fn prepare_tools_and_prompt_filters_turn_scoped_disallowed_tools() -> anyhow::Result<()> {
        let agent = crate::agents::Agent::new();

        let session = SessionManager::create_session(
            std::path::PathBuf::default(),
            "test-turn-scoped-disallowed-tools".to_string(),
            SessionType::Hidden,
        )
        .await?;

        let model_config = ModelConfig::new("test-model").unwrap();
        let provider = std::sync::Arc::new(MockProvider {
            model_config,
            observed_models: None,
        });
        agent.update_provider(provider, &session.id).await?;

        let working_dir = std::env::current_dir()?;
        let (tools, _toolshim_tools, _system_prompt) = crate::session_context::with_turn_context(
            Some(build_turn_context_with_tool_scope(
                Vec::new(),
                vec!["Read", "Grep"],
            )),
            async {
                agent
                    .prepare_tools_and_prompt(
                        &working_dir,
                        None,
                        false,
                        &ModelConfig::new("test-model").unwrap(),
                    )
                    .await
            },
        )
        .await?;

        let names: Vec<String> = tools.iter().map(|tool| tool.name.to_string()).collect();
        assert!(!names.iter().any(|name| name == "Read"));
        assert!(!names.iter().any(|name| name == "Grep"));

        Ok(())
    }

    #[tokio::test]
    async fn stream_response_from_provider_uses_explicit_model_config() -> anyhow::Result<()> {
        let observed_models = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let provider = std::sync::Arc::new(MockProvider {
            model_config: ModelConfig::new("default-model").unwrap(),
            observed_models: Some(observed_models.clone()),
        });
        let override_model_config = ModelConfig::new("override-model").unwrap();
        let messages = vec![Message::user().with_text("hello")];

        let mut stream = Agent::stream_response_from_provider(
            provider,
            &override_model_config,
            "",
            &messages,
            &[],
            &[],
        )
        .await?;

        let first = stream.next().await.expect("stream item should exist")?;
        let usage = first.1.expect("usage should exist");
        assert_eq!(usage.model, "override-model");
        assert_eq!(
            observed_models
                .lock()
                .expect("read observed model")
                .as_slice(),
            ["override-model"]
        );
        Ok(())
    }

    #[tokio::test]
    async fn stream_response_from_provider_strips_images_when_turn_policy_disables_vision(
    ) -> anyhow::Result<()> {
        let observed_messages = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let provider = std::sync::Arc::new(RecordingProvider {
            model_config: ModelConfig::new("deepseek-reasoner").unwrap(),
            observed_messages: observed_messages.clone(),
        });
        let messages = vec![
            Message::user()
                .with_text("请分析截图")
                .with_image("aGVsbG8=", "image/png"),
            Message::assistant().with_text("上一轮回复"),
        ];

        let mut stream = crate::session_context::with_turn_context(
            Some(build_turn_context_with_image_input_policy(false)),
            async {
                Agent::stream_response_from_provider(
                    provider,
                    &ModelConfig::new("deepseek-reasoner").unwrap(),
                    "",
                    &messages,
                    &[],
                    &[],
                )
                .await
            },
        )
        .await?;
        let _ = stream.next().await.expect("stream item should exist")?;

        let observed = observed_messages
            .lock()
            .expect("read observed messages")
            .clone();
        assert_eq!(observed.len(), 1);
        assert!(observed[0].iter().all(|message| {
            message
                .content
                .iter()
                .all(|content| !matches!(content, MessageContent::Image(_)))
        }));
        assert!(observed[0][0]
            .as_concat_text()
            .contains("当前模型不支持图片输入"));

        Ok(())
    }

    #[derive(Clone)]
    struct MockStreamingErrorProvider {
        model_config: ModelConfig,
    }

    #[async_trait]
    impl Provider for MockStreamingErrorProvider {
        fn metadata() -> crate::providers::base::ProviderMetadata {
            crate::providers::base::ProviderMetadata::empty()
        }

        fn get_name(&self) -> &str {
            "mock-streaming-error"
        }

        fn get_model_config(&self) -> ModelConfig {
            self.model_config.clone()
        }

        fn supports_streaming(&self) -> bool {
            true
        }

        async fn complete_with_model(
            &self,
            _model_config: &ModelConfig,
            _system: &str,
            _messages: &[Message],
            _tools: &[Tool],
        ) -> anyhow::Result<(Message, ProviderUsage), ProviderError> {
            unreachable!("streaming path should be used in this test");
        }

        async fn stream(
            &self,
            _system: &str,
            _messages: &[Message],
            _tools: &[Tool],
        ) -> anyhow::Result<MessageStream, ProviderError> {
            let usage = ProviderUsage::new(self.model_config.model_name.clone(), Usage::default());
            Ok(Box::pin(futures::stream::iter(vec![
                Ok((Some(Message::assistant().with_text("partial")), Some(usage))),
                Err(ProviderError::RequestFailed("stream exploded".to_string())),
            ])))
        }
    }

    #[tokio::test]
    async fn stream_response_from_provider_propagates_stream_errors() -> anyhow::Result<()> {
        let provider = std::sync::Arc::new(MockStreamingErrorProvider {
            model_config: ModelConfig::new("test-model").unwrap(),
        });
        let messages = vec![Message::user().with_text("hello")];

        let mut stream = Agent::stream_response_from_provider(
            provider,
            &ModelConfig::new("test-model").unwrap(),
            "",
            &messages,
            &[],
            &[],
        )
        .await?;

        let first = stream
            .next()
            .await
            .expect("first stream item should exist")?;
        assert_eq!(
            first.0.expect("message should exist").as_concat_text(),
            "partial"
        );

        let error = stream
            .next()
            .await
            .expect("second stream item should exist")
            .expect_err("stream error should be propagated");
        assert_eq!(
            error,
            ProviderError::RequestFailed("stream exploded".to_string())
        );
        Ok(())
    }

    #[test]
    fn normalize_response_tool_requests_keeps_thinking_and_original_request_order() {
        let response = Message::assistant()
            .with_thinking("先分析问题。", "")
            .with_text("准备并行调用两个工具。")
            .with_tool_request(
                "tool-1",
                Ok(rmcp::model::CallToolRequestParam {
                    name: "developer__shell".into(),
                    arguments: Some(object!({"command": "ls"})),
                }),
            )
            .with_tool_request(
                "tool-2",
                Ok(rmcp::model::CallToolRequestParam {
                    name: "developer__read".into(),
                    arguments: Some(object!({"path": "Cargo.toml"})),
                }),
            );

        let normalized = normalize_response_tool_requests(
            &response,
            &[
                ToolRequest {
                    id: "tool-1".to_string(),
                    tool_call: Ok(rmcp::model::CallToolRequestParam {
                        name: "developer__shell".into(),
                        arguments: Some(object!({"command": "ls"})),
                    }),
                    metadata: Some(serde_json::Map::from_iter([(
                        "source".to_string(),
                        Value::String("normalized-1".to_string()),
                    )])),
                    tool_meta: Some(json!({"title": "Shell"})),
                },
                ToolRequest {
                    id: "tool-2".to_string(),
                    tool_call: Ok(rmcp::model::CallToolRequestParam {
                        name: "developer__read".into(),
                        arguments: Some(object!({"path": "Cargo.toml"})),
                    }),
                    metadata: Some(serde_json::Map::from_iter([(
                        "source".to_string(),
                        Value::String("normalized-2".to_string()),
                    )])),
                    tool_meta: Some(json!({"title": "Read"})),
                },
            ],
        );

        assert_eq!(normalized.content.len(), 4);
        assert!(matches!(normalized.content[0], MessageContent::Thinking(_)));
        assert!(matches!(normalized.content[1], MessageContent::Text(_)));

        let MessageContent::ToolRequest(first_request) = &normalized.content[2] else {
            panic!("third content should be the first normalized tool request");
        };
        let MessageContent::ToolRequest(second_request) = &normalized.content[3] else {
            panic!("fourth content should be the second normalized tool request");
        };

        assert_eq!(
            first_request
                .metadata
                .as_ref()
                .and_then(|value| value.get("source"))
                .and_then(|value| value.as_str()),
            Some("normalized-1"),
        );
        assert_eq!(
            second_request
                .metadata
                .as_ref()
                .and_then(|value| value.get("source"))
                .and_then(|value| value.as_str()),
            Some("normalized-2"),
        );
        assert_eq!(
            first_request
                .tool_meta
                .as_ref()
                .and_then(|value| value.get("title"))
                .and_then(|value| value.as_str()),
            Some("Shell"),
        );
        assert_eq!(
            second_request
                .tool_meta
                .as_ref()
                .and_then(|value| value.get("title"))
                .and_then(|value| value.as_str()),
            Some("Read"),
        );
    }
}
