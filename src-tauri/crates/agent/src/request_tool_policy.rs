//! 请求级工具策略与统一回复执行链
//!
//! 该模块沉淀“请求级工具策略（例如联网搜索）”与统一流式执行逻辑，
//! 供 aster_agent_cmd、scheduler、gateway 等入口复用同一条执行主链。

use crate::event_converter::{convert_agent_event, TauriAgentEvent, TauriToolResult};
use aster::agents::{Agent, AgentEvent};
use aster::conversation::message::Message;
use aster::tools::ToolContext;
use futures::StreamExt;
use std::collections::HashMap;
use std::path::Path;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub const REQUEST_TOOL_POLICY_MARKER: &str = "【请求级工具策略】";

const DEFAULT_REQUIRED_TOOLS: &[&str] = &["WebSearch"];
const DEFAULT_ALLOWED_TOOLS: &[&str] = &["WebSearch", "WebFetch"];
const WEB_SEARCH_REQUIRED_TOOLS_ENV: &str = "PROXYCAST_WEB_SEARCH_REQUIRED_TOOLS";
const WEB_SEARCH_ALLOWED_TOOLS_ENV: &str = "PROXYCAST_WEB_SEARCH_ALLOWED_TOOLS";
const WEB_SEARCH_DISALLOWED_TOOLS_ENV: &str = "PROXYCAST_WEB_SEARCH_DISALLOWED_TOOLS";
const WEB_SEARCH_PREFLIGHT_ENABLED_ENV: &str = "PROXYCAST_WEB_SEARCH_PREFLIGHT_ENABLED";
const STREAM_EVENT_DIAG_WARN_TEXT_DELTA_CHARS: usize = 2_000;
const STREAM_EVENT_DIAG_WARN_TOOL_OUTPUT_CHARS: usize = 8_000;
const STREAM_EVENT_DIAG_WARN_CONTEXT_STEPS: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestToolPolicy {
    /// 本次请求是否开启联网搜索策略
    pub effective_web_search: bool,
    /// 必须至少成功一次的工具（默认 WebSearch）
    pub required_tools: Vec<String>,
    /// 允许的联网工具集合（默认 WebSearch/WebFetch）
    pub allowed_tools: Vec<String>,
    /// 禁止工具集合（可配置）
    pub disallowed_tools: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolAttemptRecord {
    pub tool_id: String,
    pub tool_name: String,
    pub success: Option<bool>,
    pub error: Option<String>,
}

#[derive(Debug, Default)]
pub struct WebSearchExecutionTracker {
    ordered_tool_ids: Vec<String>,
    attempts_by_id: HashMap<String, ToolAttemptRecord>,
}

impl WebSearchExecutionTracker {
    pub fn record_tool_start(
        &mut self,
        policy: &RequestToolPolicy,
        tool_id: &str,
        tool_name: &str,
    ) {
        if !policy.effective_web_search || tool_id.trim().is_empty() || tool_name.trim().is_empty()
        {
            return;
        }

        if !self.attempts_by_id.contains_key(tool_id) {
            self.ordered_tool_ids.push(tool_id.to_string());
            self.attempts_by_id.insert(
                tool_id.to_string(),
                ToolAttemptRecord {
                    tool_id: tool_id.to_string(),
                    tool_name: tool_name.to_string(),
                    success: None,
                    error: None,
                },
            );
        }
    }

    pub fn record_tool_end(
        &mut self,
        policy: &RequestToolPolicy,
        tool_id: &str,
        success: bool,
        error: Option<&str>,
    ) {
        if !policy.effective_web_search || tool_id.trim().is_empty() {
            return;
        }
        if let Some(record) = self.attempts_by_id.get_mut(tool_id) {
            record.success = Some(success);
            record.error = error
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());
        }
    }

    pub fn validate_web_search_requirement(
        &self,
        policy: &RequestToolPolicy,
    ) -> Result<(), String> {
        if !policy.effective_web_search {
            return Ok(());
        }

        let disallowed_attempts: Vec<&ToolAttemptRecord> = self
            .ordered_tool_ids
            .iter()
            .filter_map(|tool_id| self.attempts_by_id.get(tool_id))
            .filter(|record| matches_tool_list(&record.tool_name, &policy.disallowed_tools))
            .collect();
        if !disallowed_attempts.is_empty() {
            let disallowed_names = disallowed_attempts
                .iter()
                .map(|record| record.tool_name.clone())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "联网搜索策略阻止了禁止工具调用: {}。\n尝试记录: {}",
                disallowed_names,
                self.format_attempts()
            ));
        }

        let required_attempts: Vec<&ToolAttemptRecord> = self
            .ordered_tool_ids
            .iter()
            .filter_map(|tool_id| self.attempts_by_id.get(tool_id))
            .filter(|record| policy.matches_any_required_tool(&record.tool_name))
            .collect();

        if required_attempts.is_empty() {
            return Err(format!(
                "联网搜索已开启，但未检测到必需工具调用。必须先调用 {} 至少一次后再给出最终答复。\n尝试记录: {}",
                policy.required_tools.join(", "),
                self.format_attempts()
            ));
        }

        if required_attempts
            .iter()
            .any(|record| record.success.unwrap_or(false))
        {
            return Ok(());
        }

        Err(format!(
            "联网搜索已开启，但必需工具调用全部失败，无法给出符合约束的最终答复。\n失败原因与尝试记录: {}",
            self.format_attempts()
        ))
    }

    pub fn format_attempts(&self) -> String {
        if self.ordered_tool_ids.is_empty() {
            return "无工具调用".to_string();
        }

        self.ordered_tool_ids
            .iter()
            .filter_map(|tool_id| self.attempts_by_id.get(tool_id))
            .map(|record| {
                let status = match record.success {
                    Some(true) => "success".to_string(),
                    Some(false) => {
                        format!("failed({})", record.error.as_deref().unwrap_or("unknown"))
                    }
                    None => "pending".to_string(),
                };
                format!("{}#{}:{}", record.tool_name, record.tool_id, status)
            })
            .collect::<Vec<_>>()
            .join("; ")
    }
}

#[derive(Debug, Clone)]
pub struct PreflightToolExecution {
    pub events: Vec<TauriAgentEvent>,
}

impl PreflightToolExecution {
    fn none() -> Self {
        Self { events: Vec::new() }
    }
}

#[derive(Debug, Clone)]
pub struct ReplyAttemptError {
    pub message: String,
    pub emitted_any: bool,
}

#[derive(Debug, Default)]
struct StreamEventDiagnostics {
    text_delta_count: usize,
    tool_start_count: usize,
    tool_end_count: usize,
    error_count: usize,
    context_trace_events: usize,
    max_text_delta_chars: usize,
    max_tool_output_chars: usize,
    max_context_trace_steps: usize,
}

fn update_stream_event_diagnostics(
    diagnostics: &mut StreamEventDiagnostics,
    event: &TauriAgentEvent,
) {
    match event {
        TauriAgentEvent::TextDelta { text } => {
            diagnostics.text_delta_count += 1;
            let char_count = text.chars().count();
            diagnostics.max_text_delta_chars = diagnostics.max_text_delta_chars.max(char_count);
            if char_count >= STREAM_EVENT_DIAG_WARN_TEXT_DELTA_CHARS {
                tracing::warn!(
                    "[AsterAgent][Diag] large text_delta observed: chars={}",
                    char_count
                );
            }
        }
        TauriAgentEvent::ToolStart { .. } => {
            diagnostics.tool_start_count += 1;
        }
        TauriAgentEvent::ToolEnd { tool_id, result } => {
            diagnostics.tool_end_count += 1;
            let output_chars = result.output.chars().count();
            diagnostics.max_tool_output_chars = diagnostics.max_tool_output_chars.max(output_chars);
            if output_chars >= STREAM_EVENT_DIAG_WARN_TOOL_OUTPUT_CHARS {
                tracing::warn!(
                    "[AsterAgent][Diag] large tool_end output observed: tool_id={}, output_chars={}, success={}",
                    tool_id,
                    output_chars,
                    result.success
                );
            }
        }
        TauriAgentEvent::ContextTrace { steps } => {
            diagnostics.context_trace_events += 1;
            diagnostics.max_context_trace_steps =
                diagnostics.max_context_trace_steps.max(steps.len());
            if steps.len() >= STREAM_EVENT_DIAG_WARN_CONTEXT_STEPS {
                tracing::warn!(
                    "[AsterAgent][Diag] large context_trace observed: steps={}",
                    steps.len()
                );
            }
        }
        TauriAgentEvent::Error { .. } => {
            diagnostics.error_count += 1;
        }
        _ => {}
    }
}

#[derive(Debug, Clone, Default)]
pub struct StreamReplyExecution {
    pub text_output: String,
    pub event_errors: Vec<String>,
    pub emitted_any: bool,
    pub attempts_summary: String,
}

impl RequestToolPolicy {
    pub fn matches_any_required_tool(&self, tool_name: &str) -> bool {
        matches_tool_list(tool_name, &self.required_tools)
    }

    pub fn matches_any_allowed_tool(&self, tool_name: &str) -> bool {
        matches_tool_list(tool_name, &self.allowed_tools)
    }
}

/// 解析请求级工具策略
///
/// 规则：
/// - `effective_web_search = request_web_search.unwrap_or(mode_default)`
/// - 白/黑名单支持环境变量覆盖：
///   - `PROXYCAST_WEB_SEARCH_REQUIRED_TOOLS`
///   - `PROXYCAST_WEB_SEARCH_ALLOWED_TOOLS`
///   - `PROXYCAST_WEB_SEARCH_DISALLOWED_TOOLS`
pub fn resolve_request_tool_policy(
    request_web_search: Option<bool>,
    mode_default: bool,
) -> RequestToolPolicy {
    let effective_web_search = request_web_search.unwrap_or(mode_default);
    let required_tools = parse_tool_list_env(WEB_SEARCH_REQUIRED_TOOLS_ENV, DEFAULT_REQUIRED_TOOLS);
    let mut allowed_tools =
        parse_tool_list_env(WEB_SEARCH_ALLOWED_TOOLS_ENV, DEFAULT_ALLOWED_TOOLS);
    let disallowed_tools = parse_tool_list_env(WEB_SEARCH_DISALLOWED_TOOLS_ENV, &[]);

    for required in &required_tools {
        if !allowed_tools
            .iter()
            .any(|candidate| is_same_tool(candidate, required))
        {
            allowed_tools.push(required.clone());
        }
    }

    RequestToolPolicy {
        effective_web_search,
        required_tools,
        allowed_tools,
        disallowed_tools,
    }
}

/// 合并请求级工具策略到系统提示词
///
/// - `effective_web_search=false`：保持原始 system prompt 不变
/// - 已包含 marker 时：不重复追加
pub fn merge_system_prompt_with_request_tool_policy(
    base_prompt: Option<String>,
    policy: &RequestToolPolicy,
) -> Option<String> {
    if !policy.effective_web_search {
        return base_prompt;
    }

    let disallowed_line = if policy.disallowed_tools.is_empty() {
        "无".to_string()
    } else {
        policy.disallowed_tools.join(", ")
    };

    let policy_prompt = format!(
        "{REQUEST_TOOL_POLICY_MARKER}\n\
- 用户在本次请求中已开启“联网搜索”开关。\n\
- 必须先调用 {} 至少一次（必要时再调用 WebFetch），再输出最终答复。\n\
- 若工具调用失败，必须返回失败原因与尝试记录；不要在未完成必需工具调用前直接给最终结论。\n\
- 允许工具: {}\n\
- 禁止工具: {}",
        policy.required_tools.join(", "),
        policy.allowed_tools.join(", "),
        disallowed_line
    );

    match base_prompt {
        Some(base) => {
            if base.contains(REQUEST_TOOL_POLICY_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(policy_prompt)
            } else {
                Some(format!("{base}\n\n{policy_prompt}"))
            }
        }
        None => Some(policy_prompt),
    }
}

fn parse_tool_list_env(key: &str, default_values: &[&str]) -> Vec<String> {
    let from_env = std::env::var(key)
        .ok()
        .map(|raw| parse_tool_list(&raw))
        .filter(|tools| !tools.is_empty());

    let values =
        from_env.unwrap_or_else(|| default_values.iter().map(|item| item.to_string()).collect());
    dedup_tools(values)
}

fn parse_tool_list(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .collect()
}

fn dedup_tools(values: Vec<String>) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for value in values {
        if !result.iter().any(|existing| is_same_tool(existing, &value)) {
            result.push(value);
        }
    }
    result
}

fn matches_tool_list(tool_name: &str, list: &[String]) -> bool {
    list.iter()
        .any(|candidate| is_same_tool(tool_name, candidate))
}

fn is_same_tool(a: &str, b: &str) -> bool {
    let normalized_a = normalize_tool_name(a);
    let normalized_b = normalize_tool_name(b);
    if normalized_a.is_empty() || normalized_b.is_empty() {
        return false;
    }
    normalized_a == normalized_b
        || normalized_a.contains(&normalized_b)
        || normalized_b.contains(&normalized_a)
}

fn normalize_tool_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect::<String>()
}

fn extract_inline_agent_provider_error(message: &Message) -> Option<String> {
    let text = message.as_concat_text();
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if !text.contains("Ran into this error:") {
        return None;
    }
    if !text.contains("Please retry if you think this is a transient or recoverable error.") {
        return None;
    }

    let after_prefix = text.split_once("Ran into this error:")?.1.trim();
    let detail = after_prefix
        .split_once("\n\nPlease retry if you think this is a transient or recoverable error.")
        .map(|(left, _)| left.trim())
        .unwrap_or(after_prefix)
        .trim_end_matches('.');

    if detail.is_empty() {
        return Some("Agent provider execution failed".to_string());
    }

    Some(format!("Agent provider execution failed: {detail}"))
}

/// 当开启联网搜索时，在正式回复前执行一次 WebSearch 预调用。
///
/// 目标：
/// - 通过执行层保证至少一次 WebSearch 调用（而非仅依赖提示词）
/// - 统一生成 tool_start/tool_end 事件，供前端落地
/// - 若预调用失败，返回失败原因并由上层中断本次回答
pub async fn execute_web_search_preflight_if_needed(
    agent: &Agent,
    session_id: &str,
    message_text: &str,
    working_directory: Option<&Path>,
    cancel_token: Option<CancellationToken>,
    policy: &RequestToolPolicy,
    tracker: &mut WebSearchExecutionTracker,
) -> Result<PreflightToolExecution, String> {
    if !policy.effective_web_search || !is_web_search_preflight_enabled() {
        return Ok(PreflightToolExecution::none());
    }

    let registry_arc = agent.tool_registry().clone();
    let registry = registry_arc.read().await;
    let available_tools = registry.get_definitions();
    let preflight_tool = available_tools
        .iter()
        .find(|definition| {
            policy.matches_any_required_tool(&definition.name)
                && normalize_tool_name(&definition.name).contains("websearch")
        })
        .ok_or_else(|| {
            format!(
                "联网搜索已开启，但未找到可执行的必需工具定义。required_tools={}, available_tools={}",
                policy.required_tools.join(", "),
                available_tools
                    .iter()
                    .map(|definition| definition.name.clone())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;

    let query = derive_preflight_query(message_text);
    let params = serde_json::json!({ "query": query });
    let arguments = serde_json::to_string(&params).ok();
    let tool_id = format!("preflight-websearch-{}", Uuid::new_v4());
    tracker.record_tool_start(policy, &tool_id, &preflight_tool.name);

    let mut context = ToolContext::new(
        working_directory
            .map(Path::to_path_buf)
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_default(),
    )
    .with_session_id(session_id.to_string());
    if let Some(token) = cancel_token {
        context = context.with_cancellation_token(token);
    }

    let mut events = vec![TauriAgentEvent::ToolStart {
        tool_name: preflight_tool.name.clone(),
        tool_id: tool_id.clone(),
        arguments,
    }];

    let result = registry
        .execute(&preflight_tool.name, params, &context, None)
        .await
        .map_err(|error| format!("执行 WebSearch 预调用失败: {}", error.to_string()));

    match result {
        Ok(tool_result) => {
            tracker.record_tool_end(
                policy,
                &tool_id,
                tool_result.success,
                tool_result.error.as_deref(),
            );
            let event = TauriAgentEvent::ToolEnd {
                tool_id,
                result: TauriToolResult {
                    success: tool_result.success,
                    output: tool_result.output.unwrap_or_default(),
                    error: tool_result.error,
                    images: None,
                    metadata: None,
                },
            };
            events.push(event);

            if events
                .last()
                .and_then(|event| match event {
                    TauriAgentEvent::ToolEnd { result, .. } => Some(result.success),
                    _ => None,
                })
                .unwrap_or(false)
            {
                Ok(PreflightToolExecution { events })
            } else {
                let failure = events.last().and_then(|event| match event {
                    TauriAgentEvent::ToolEnd { result, .. } => result.error.clone(),
                    _ => None,
                });
                Err(format!(
                    "联网搜索预调用失败: {}",
                    failure.unwrap_or_else(|| "unknown".to_string())
                ))
            }
        }
        Err(error) => {
            tracker.record_tool_end(policy, &tool_id, false, Some(error.as_str()));
            events.push(TauriAgentEvent::ToolEnd {
                tool_id,
                result: TauriToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(error.clone()),
                    images: None,
                    metadata: None,
                },
            });
            Err(error)
        }
    }
}

/// 统一流式执行器：执行 preflight + reply 流，并复用统一的策略校验。
pub async fn stream_reply_with_policy<F>(
    agent: &Agent,
    message_text: &str,
    working_directory: Option<&Path>,
    session_config: aster::agents::SessionConfig,
    cancel_token: Option<CancellationToken>,
    request_tool_policy: &RequestToolPolicy,
    mut on_event: F,
) -> Result<StreamReplyExecution, ReplyAttemptError>
where
    F: FnMut(&TauriAgentEvent),
{
    let mut web_search_tracker = WebSearchExecutionTracker::default();
    let preflight = execute_web_search_preflight_if_needed(
        agent,
        &session_config.id,
        message_text,
        working_directory,
        cancel_token.clone(),
        request_tool_policy,
        &mut web_search_tracker,
    )
    .await;
    match preflight {
        Ok(preflight_execution) => {
            for event in preflight_execution.events {
                on_event(&event);
            }
        }
        Err(error) => {
            return Err(ReplyAttemptError {
                message: format!(
                    "{error}\n尝试记录: {}",
                    web_search_tracker.format_attempts()
                ),
                emitted_any: false,
            });
        }
    }

    let user_message = Message::user().with_text(message_text);
    let mut stream = agent
        .reply(user_message, session_config, cancel_token)
        .await
        .map_err(|e| ReplyAttemptError {
            message: format!("Agent error: {e}"),
            emitted_any: false,
        })?;

    let mut emitted_any = false;
    let mut text_chunks: Vec<String> = Vec::new();
    let mut event_errors: Vec<String> = Vec::new();
    let mut diagnostics = StreamEventDiagnostics::default();

    while let Some(event_result) = stream.next().await {
        match event_result {
            Ok(agent_event) => {
                emitted_any = true;
                let inline_provider_error = match &agent_event {
                    AgentEvent::Message(message) => extract_inline_agent_provider_error(message),
                    _ => None,
                };
                let tauri_events = convert_agent_event(agent_event);
                for tauri_event in tauri_events {
                    match &tauri_event {
                        TauriAgentEvent::TextDelta { text } => {
                            if !text.is_empty() {
                                text_chunks.push(text.clone());
                            }
                        }
                        TauriAgentEvent::Error { message } => {
                            if !message.trim().is_empty() {
                                event_errors.push(message.clone());
                            }
                        }
                        TauriAgentEvent::ToolStart {
                            tool_name, tool_id, ..
                        } => web_search_tracker.record_tool_start(
                            request_tool_policy,
                            tool_id,
                            tool_name,
                        ),
                        TauriAgentEvent::ToolEnd { tool_id, result } => {
                            web_search_tracker.record_tool_end(
                                request_tool_policy,
                                tool_id,
                                result.success,
                                result.error.as_deref(),
                            );
                        }
                        _ => {}
                    }
                    update_stream_event_diagnostics(&mut diagnostics, &tauri_event);
                    on_event(&tauri_event);
                }
                if let Some(message) = inline_provider_error {
                    return Err(ReplyAttemptError {
                        message,
                        emitted_any: true,
                    });
                }
            }
            Err(e) => {
                return Err(ReplyAttemptError {
                    message: format!("Stream error: {e}"),
                    emitted_any,
                });
            }
        }
    }

    if let Err(validation_error) =
        web_search_tracker.validate_web_search_requirement(request_tool_policy)
    {
        return Err(ReplyAttemptError {
            message: validation_error,
            emitted_any,
        });
    }

    tracing::info!(
        "[AsterAgent][Diag] stream summary: text_deltas={}, tool_starts={}, tool_ends={}, context_traces={}, errors={}, max_text_delta_chars={}, max_tool_output_chars={}, max_context_trace_steps={}",
        diagnostics.text_delta_count,
        diagnostics.tool_start_count,
        diagnostics.tool_end_count,
        diagnostics.context_trace_events,
        diagnostics.error_count,
        diagnostics.max_text_delta_chars,
        diagnostics.max_tool_output_chars,
        diagnostics.max_context_trace_steps
    );

    Ok(StreamReplyExecution {
        text_output: text_chunks.join(""),
        event_errors,
        emitted_any,
        attempts_summary: web_search_tracker.format_attempts(),
    })
}

fn is_web_search_preflight_enabled() -> bool {
    match std::env::var(WEB_SEARCH_PREFLIGHT_ENABLED_ENV) {
        Ok(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "0" | "false" | "no" | "off" => false,
            _ => true,
        },
        Err(_) => true,
    }
}

fn derive_preflight_query(message_text: &str) -> String {
    let trimmed = message_text.trim();
    if trimmed.chars().count() >= 2 {
        return trimmed.to_string();
    }
    if trimmed.is_empty() {
        return "最新信息".to_string();
    }

    // 兜底补齐最短长度，避免触发 WebSearch.query minLength 校验失败
    let mut fallback = trimmed.to_string();
    while fallback.chars().count() < 2 {
        fallback.push_str(" 信息");
    }
    fallback
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_effective_web_search_with_request_override() {
        let policy = resolve_request_tool_policy(Some(false), true);
        assert!(!policy.effective_web_search);

        let policy = resolve_request_tool_policy(Some(true), false);
        assert!(policy.effective_web_search);
    }

    #[test]
    fn resolves_effective_web_search_with_mode_default() {
        let policy = resolve_request_tool_policy(None, true);
        assert!(policy.effective_web_search);

        let policy = resolve_request_tool_policy(None, false);
        assert!(!policy.effective_web_search);
    }

    #[test]
    fn keeps_original_prompt_when_disabled() {
        let base = Some("base".to_string());
        let policy = resolve_request_tool_policy(Some(false), false);
        assert_eq!(
            merge_system_prompt_with_request_tool_policy(base.clone(), &policy),
            base
        );
    }

    #[test]
    fn appends_policy_prompt_when_enabled() {
        let policy = resolve_request_tool_policy(Some(true), false);
        let merged =
            merge_system_prompt_with_request_tool_policy(Some("base".to_string()), &policy)
                .expect("merged prompt should exist");
        assert!(merged.contains(REQUEST_TOOL_POLICY_MARKER));
        assert!(merged.contains("必须先调用"));
        assert!(merged.contains("WebSearch"));
    }

    #[test]
    fn no_duplicate_when_marker_exists() {
        let base = Some(format!("{REQUEST_TOOL_POLICY_MARKER}\nexists"));
        let policy = resolve_request_tool_policy(Some(true), false);
        assert_eq!(
            merge_system_prompt_with_request_tool_policy(base.clone(), &policy),
            base
        );
    }

    #[test]
    fn tracker_requires_websearch_when_enabled() {
        let policy = resolve_request_tool_policy(Some(true), false);
        let mut tracker = WebSearchExecutionTracker::default();
        tracker.record_tool_start(&policy, "tool-1", "WebFetch");
        tracker.record_tool_end(&policy, "tool-1", true, None);
        let err = tracker
            .validate_web_search_requirement(&policy)
            .expect_err("missing web search should fail");
        assert!(err.contains("未检测到必需工具调用"));
    }

    #[test]
    fn tracker_accepts_successful_websearch() {
        let policy = resolve_request_tool_policy(Some(true), false);
        let mut tracker = WebSearchExecutionTracker::default();
        tracker.record_tool_start(&policy, "tool-1", "WebSearch");
        tracker.record_tool_end(&policy, "tool-1", true, None);
        assert!(tracker.validate_web_search_requirement(&policy).is_ok());
    }

    #[test]
    fn tracker_reports_failure_record() {
        let policy = resolve_request_tool_policy(Some(true), false);
        let mut tracker = WebSearchExecutionTracker::default();
        tracker.record_tool_start(&policy, "tool-1", "WebSearch");
        tracker.record_tool_end(&policy, "tool-1", false, Some("network timeout"));
        let err = tracker
            .validate_web_search_requirement(&policy)
            .expect_err("failed required tool should fail");
        assert!(err.contains("network timeout"));
        assert!(err.contains("尝试记录"));
    }
}
