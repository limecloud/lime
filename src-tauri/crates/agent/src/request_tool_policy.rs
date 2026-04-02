//! 请求级工具策略与统一回复执行链
//!
//! 该模块沉淀“请求级工具策略（例如联网搜索）”与统一流式执行逻辑，
//! 供 aster_agent_cmd、scheduler、gateway 等入口复用同一条执行主链。

use crate::protocol::{AgentEvent as RuntimeAgentEvent, AgentRuntimeStatus, AgentToolResult};
use crate::protocol_projection::project_runtime_event;
use crate::write_artifact_events::WriteArtifactEventEmitter;
use aster::agents::{Agent, AgentEvent as AsterAgentEvent};
use aster::conversation::message::{Message, MessageContent, SystemNotificationType};
use aster::tools::ToolContext;
use chrono::{Datelike, Local, NaiveDate};
use futures::{stream, StreamExt};
use lime_core::env_compat;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub const REQUEST_TOOL_POLICY_MARKER: &str = "【请求级工具策略】";
pub const WEB_SEARCH_PREFETCH_CONTEXT_MARKER: &str = "【联网预检索上下文】";
pub const WEB_SEARCH_SYNTHESIS_MARKER: &str = "【预检索后输出要求】";

const DEFAULT_REQUIRED_TOOLS: &[&str] = &["WebSearch"];
const DEFAULT_ALLOWED_TOOLS: &[&str] = &["WebSearch", "WebFetch"];
const WEB_SEARCH_REQUIRED_TOOLS_ENV_KEYS: &[&str] = &[
    "LIME_WEB_SEARCH_REQUIRED_TOOLS",
    "PROXYCAST_WEB_SEARCH_REQUIRED_TOOLS",
];
const WEB_SEARCH_ALLOWED_TOOLS_ENV_KEYS: &[&str] = &[
    "LIME_WEB_SEARCH_ALLOWED_TOOLS",
    "PROXYCAST_WEB_SEARCH_ALLOWED_TOOLS",
];
const WEB_SEARCH_DISALLOWED_TOOLS_ENV_KEYS: &[&str] = &[
    "LIME_WEB_SEARCH_DISALLOWED_TOOLS",
    "PROXYCAST_WEB_SEARCH_DISALLOWED_TOOLS",
];
const WEB_SEARCH_PREFLIGHT_ENABLED_ENV_KEYS: &[&str] = &[
    "LIME_WEB_SEARCH_PREFLIGHT_ENABLED",
    "PROXYCAST_WEB_SEARCH_PREFLIGHT_ENABLED",
];
const STREAM_EVENT_DIAG_WARN_TEXT_DELTA_CHARS: usize = 2_000;
const STREAM_EVENT_DIAG_WARN_TOOL_OUTPUT_CHARS: usize = 8_000;
const STREAM_EVENT_DIAG_WARN_CONTEXT_STEPS: usize = 24;
const NEWS_PREFLIGHT_QUERY_LIMIT: usize = 4;
const NEWS_PREFLIGHT_QUERY_PARALLELISM: usize = 4;
const NEWS_PREFLIGHT_QUERY_OUTPUT_CHAR_LIMIT: usize = 1_600;
const NEWS_PREFLIGHT_CONTEXT_CHAR_LIMIT: usize = 6_000;
const NEWS_PREFLIGHT_RESULT_LINES: usize = 18;
const WEB_SEARCH_EMPTY_REPLY_RETRY_PROMPT: &str = "请继续。你已经完成本回合所需的 WebSearch 预检索，现在必须直接给出最终答复，不要再次调用 WebSearch 或 WebFetch。请至少输出：1. 结论摘要；2. 主题归纳；3. 关键信息；4. 如有分歧，说明来源差异。";
const ASTER_AUTO_COMPACTION_START_PREFIX: &str = "Exceeded auto-compact threshold of ";
const ASTER_AUTO_COMPACTION_COMPLETE_TEXT: &str = "Compaction complete";
const ASTER_AUTO_COMPACTION_THINKING_TEXT: &str = "aster is compacting the conversation...";
const ASTER_AUTO_COMPACTION_ERROR_PREFIX: &str = "Ran into this error trying to compact:";
const ASTER_AUTO_COMPACTION_DISABLED_TEXT: &str = "Automatic compaction is disabled for this turn. The conversation reached the context limit. Compact the session manually or start a new session before retrying.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RequestToolPolicyMode {
    #[default]
    Disabled,
    Allowed,
    Required,
}

impl RequestToolPolicyMode {
    pub fn enables_web_search(self) -> bool {
        !matches!(self, Self::Disabled)
    }

    pub fn requires_web_search(self) -> bool {
        matches!(self, Self::Required)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Allowed => "allowed",
            Self::Required => "required",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestToolPolicy {
    /// 本次请求的联网搜索语义
    pub search_mode: RequestToolPolicyMode,
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
        if !policy.requires_web_search() {
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
    pub events: Vec<RuntimeAgentEvent>,
    pub planned_queries: Vec<String>,
    pub system_prompt_appendix: Option<String>,
    pub coverage_summary: Option<String>,
    pub expanded_news_search: bool,
}

impl PreflightToolExecution {
    fn none() -> Self {
        Self {
            events: Vec::new(),
            planned_queries: Vec::new(),
            system_prompt_appendix: None,
            coverage_summary: None,
            expanded_news_search: false,
        }
    }
}

#[derive(Debug, Clone)]
struct PlannedWebSearchQuery {
    index: usize,
    query: String,
    tool_id: String,
    arguments: Option<String>,
}

#[derive(Debug, Clone)]
struct PreflightSearchOutcome {
    index: usize,
    query: String,
    tool_id: String,
    success: bool,
    output: String,
    error: Option<String>,
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
    event: &RuntimeAgentEvent,
) {
    match event {
        RuntimeAgentEvent::TextDelta { text } => {
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
        RuntimeAgentEvent::ToolStart { .. } => {
            diagnostics.tool_start_count += 1;
        }
        RuntimeAgentEvent::ToolEnd { tool_id, result } => {
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
        RuntimeAgentEvent::ContextTrace { steps } => {
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
        RuntimeAgentEvent::Error { .. } => {
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

#[derive(Debug, Default)]
struct AutoCompactionProjectionState;

impl AutoCompactionProjectionState {
    fn project_event(&mut self, agent_event: &AsterAgentEvent) -> Option<Vec<RuntimeAgentEvent>> {
        match agent_event {
            AsterAgentEvent::Message(message) => self.project_message(message),
            _ => None,
        }
    }

    fn project_message(&mut self, message: &Message) -> Option<Vec<RuntimeAgentEvent>> {
        let Some((notification_type, notification_text)) =
            extract_single_system_notification(message)
        else {
            let error_message = extract_auto_compaction_failure(message)?;
            return Some(vec![RuntimeAgentEvent::Error {
                message: error_message,
            }]);
        };

        match notification_type {
            SystemNotificationType::InlineMessage
                if notification_text.starts_with(ASTER_AUTO_COMPACTION_START_PREFIX) =>
            {
                Some(vec![])
            }
            SystemNotificationType::ThinkingMessage
                if notification_text == ASTER_AUTO_COMPACTION_THINKING_TEXT =>
            {
                Some(vec![])
            }
            SystemNotificationType::InlineMessage
                if notification_text == ASTER_AUTO_COMPACTION_COMPLETE_TEXT =>
            {
                Some(vec![])
            }
            SystemNotificationType::InlineMessage
                if notification_text == ASTER_AUTO_COMPACTION_DISABLED_TEXT =>
            {
                Some(vec![RuntimeAgentEvent::Error {
                    message:
                        "当前会话已达到上下文上限，但当前工作区已关闭自动压缩。请先手动压缩上下文或新建会话后重试。"
                            .to_string(),
                }])
            }
            _ => None,
        }
    }
}

fn extract_single_system_notification(message: &Message) -> Option<(SystemNotificationType, &str)> {
    if message.content.len() != 1 {
        return None;
    }

    match message.content.first()? {
        MessageContent::SystemNotification(notification) => Some((
            notification.notification_type.clone(),
            notification.msg.trim(),
        )),
        _ => None,
    }
}

fn extract_auto_compaction_failure(message: &Message) -> Option<String> {
    let text = message.as_concat_text();
    let trimmed = text.trim();
    if !trimmed.starts_with(ASTER_AUTO_COMPACTION_ERROR_PREFIX) {
        return None;
    }

    let detail = trimmed
        .trim_start_matches(ASTER_AUTO_COMPACTION_ERROR_PREFIX)
        .trim()
        .split_once("\n\nPlease try again or create a new session")
        .map(|(left, _)| left.trim())
        .unwrap_or_else(|| {
            trimmed
                .trim_start_matches(ASTER_AUTO_COMPACTION_ERROR_PREFIX)
                .trim()
        })
        .trim_end_matches('.');

    let message = if detail.is_empty() {
        "自动压缩上下文失败，请重试或新建会话。".to_string()
    } else {
        format!("自动压缩上下文失败，请重试或新建会话：{detail}")
    };

    Some(message)
}

impl RequestToolPolicy {
    pub fn allows_web_search(&self) -> bool {
        self.search_mode.enables_web_search()
    }

    pub fn requires_web_search(&self) -> bool {
        self.search_mode.requires_web_search()
    }

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
///   - `LIME_WEB_SEARCH_REQUIRED_TOOLS`（兼容 `PROXYCAST_WEB_SEARCH_REQUIRED_TOOLS`）
///   - `LIME_WEB_SEARCH_ALLOWED_TOOLS`（兼容 `PROXYCAST_WEB_SEARCH_ALLOWED_TOOLS`）
///   - `LIME_WEB_SEARCH_DISALLOWED_TOOLS`（兼容 `PROXYCAST_WEB_SEARCH_DISALLOWED_TOOLS`）
pub fn resolve_request_tool_policy(
    request_web_search: Option<bool>,
    mode_default: bool,
) -> RequestToolPolicy {
    resolve_request_tool_policy_with_mode(request_web_search, None, mode_default)
}

pub fn resolve_request_tool_policy_with_mode(
    request_web_search: Option<bool>,
    request_search_mode: Option<RequestToolPolicyMode>,
    mode_default: bool,
) -> RequestToolPolicy {
    let search_mode = match (request_web_search, request_search_mode) {
        (Some(false), _) => RequestToolPolicyMode::Disabled,
        (_, Some(mode)) => mode,
        (Some(true), None) => RequestToolPolicyMode::Allowed,
        (None, None) if mode_default => RequestToolPolicyMode::Allowed,
        _ => RequestToolPolicyMode::Disabled,
    };
    let effective_web_search = search_mode.enables_web_search();
    let required_tools =
        parse_tool_list_env(WEB_SEARCH_REQUIRED_TOOLS_ENV_KEYS, DEFAULT_REQUIRED_TOOLS);
    let mut allowed_tools =
        parse_tool_list_env(WEB_SEARCH_ALLOWED_TOOLS_ENV_KEYS, DEFAULT_ALLOWED_TOOLS);
    let disallowed_tools = parse_tool_list_env(WEB_SEARCH_DISALLOWED_TOOLS_ENV_KEYS, &[]);

    for required in &required_tools {
        if !allowed_tools
            .iter()
            .any(|candidate| is_same_tool(candidate, required))
        {
            allowed_tools.push(required.clone());
        }
    }

    RequestToolPolicy {
        search_mode,
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
    if !policy.allows_web_search() {
        return base_prompt;
    }

    let disallowed_line = if policy.disallowed_tools.is_empty() {
        "无".to_string()
    } else {
        policy.disallowed_tools.join(", ")
    };

    let policy_prompt = match policy.search_mode {
        RequestToolPolicyMode::Disabled => return base_prompt,
        RequestToolPolicyMode::Allowed => format!(
            "{REQUEST_TOOL_POLICY_MARKER}\n\
- 用户在本次请求中允许你使用联网搜索，但这不代表本回合必须联网。\n\
- 你必须先理解用户意图，优先判断应该直接回答、深度思考、规划、后台任务、多代理，还是联网核实。\n\
- 只有在用户明确要求搜索，或问题涉及最新、实时、价格、政策、规则、版本、新闻、日期敏感信息，或高风险信息需要核实时，才调用 {}（必要时再调用 WebFetch）。\n\
- 若无需联网即可可靠完成，就直接回答，不要为了展示工具能力而搜索。\n\
- 允许工具: {}\n\
- 禁止工具: {}",
            policy.required_tools.join(", "),
            policy.allowed_tools.join(", "),
            disallowed_line
        ),
        RequestToolPolicyMode::Required => format!(
            "{REQUEST_TOOL_POLICY_MARKER}\n\
- 用户在本次请求中已明确要求联网搜索。\n\
- 必须先调用 {} 至少一次（必要时再调用 WebFetch），再输出最终答复。\n\
- 若工具调用失败，必须返回失败原因与尝试记录；不要在未完成必需工具调用前直接给最终结论。\n\
- 允许工具: {}\n\
- 禁止工具: {}",
            policy.required_tools.join(", "),
            policy.allowed_tools.join(", "),
            disallowed_line
        ),
    };

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

fn parse_tool_list_env(keys: &[&str], default_values: &[&str]) -> Vec<String> {
    let from_env = env_compat::var(keys)
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

pub fn message_suggests_news_expansion(message: &str) -> bool {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return false;
    }

    let normalized = trimmed.to_ascii_lowercase();
    let has_news_keyword = [
        "新闻",
        "快讯",
        "头条",
        "要闻",
        "news",
        "headline",
        "headlines",
        "briefing",
        "roundup",
        "recap",
        "digest",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword));
    if !has_news_keyword {
        return false;
    }

    let has_time_keyword = [
        "今天",
        "今日",
        "昨天",
        "昨晚",
        "最新",
        "实时",
        "本周",
        "这周",
        "today",
        "latest",
        "breaking",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
        "january",
        "february",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword));
    let has_summary_keyword = [
        "汇总",
        "综述",
        "盘点",
        "整理",
        "总结",
        "写一篇",
        "写成",
        "简报",
        "日报",
        "报道",
        "summary",
        "summarize",
        "wrap up",
        "report",
        "brief",
        "briefing",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword));
    let has_explicit_date = Regex::new(r"\d{1,2}月\d{1,2}日")
        .ok()
        .map(|re| re.is_match(trimmed))
        .unwrap_or(false)
        || Regex::new(
            r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b",
        )
        .ok()
        .map(|re| re.is_match(&normalized))
        .unwrap_or(false);

    has_time_keyword || has_summary_keyword || has_explicit_date
}

pub fn merge_system_prompt_with_web_search_preflight_context(
    base_prompt: Option<String>,
    appendix: Option<String>,
) -> Option<String> {
    match (base_prompt, appendix) {
        (Some(base), Some(extra)) => {
            if base.contains(WEB_SEARCH_PREFETCH_CONTEXT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(extra)
            } else {
                Some(format!("{base}\n\n{extra}"))
            }
        }
        (Some(base), None) => Some(base),
        (None, Some(extra)) => Some(extra),
        (None, None) => None,
    }
}

fn should_run_web_search_preflight(policy: &RequestToolPolicy, message_text: &str) -> bool {
    if !is_web_search_preflight_enabled() {
        return false;
    }

    policy.requires_web_search()
        || (policy.allows_web_search() && message_suggests_news_expansion(message_text))
}

fn split_before_followup_clause(message_text: &str) -> String {
    let mut candidate = message_text.trim().replace('\n', " ");
    for delimiter in [
        "，并",
        ",并",
        "并将",
        "并且",
        "然后",
        "再把",
        "再将",
        "再帮我",
        " afterwards ",
        " and then ",
        " then ",
    ] {
        if let Some((head, _)) = candidate.split_once(delimiter) {
            candidate = head.trim().to_string();
            break;
        }
    }
    candidate
}

fn sanitize_news_search_clause(message_text: &str) -> String {
    let mut candidate = split_before_followup_clause(message_text);
    for prefix in [
        "请帮我",
        "帮我",
        "麻烦你",
        "请你",
        "请",
        "帮忙",
        "替我",
        "能否",
        "可以",
    ] {
        candidate = candidate.trim_start_matches(prefix).trim().to_string();
    }
    for verb in [
        "找一下",
        "搜一下",
        "搜索",
        "查一下",
        "查找",
        "检索",
        "收集",
        "整理",
        "找",
        "搜",
        "查",
    ] {
        candidate = candidate.trim_start_matches(verb).trim().to_string();
    }

    let collapsed = candidate
        .replace(['？', '?', '。', '，', ','], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if collapsed.is_empty() {
        derive_preflight_query(message_text)
    } else {
        collapsed
    }
}

fn month_name(month: u32) -> &'static str {
    match month {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        12 => "December",
        _ => "March",
    }
}

fn resolve_topic_labels(message_text: &str) -> (&'static str, &'static str) {
    let normalized = message_text.to_ascii_lowercase();
    if normalized.contains("国际")
        || normalized.contains("international")
        || normalized.contains("world")
    {
        ("国际新闻", "international news")
    } else if normalized.contains("国内") || normalized.contains("china") {
        ("国内新闻", "china news")
    } else if normalized.contains("科技")
        || normalized.contains("ai ")
        || normalized.contains("ai新闻")
    {
        ("科技新闻", "technology news")
    } else {
        ("新闻", "news")
    }
}

fn resolve_absolute_news_date(message_text: &str, today: NaiveDate) -> Option<(String, String)> {
    let normalized = message_text.to_ascii_lowercase();
    if normalized.contains("今天") || normalized.contains("今日") || normalized.contains("today")
    {
        return Some((
            format!("{}年{}月{}日", today.year(), today.month(), today.day()),
            format!(
                "{} {} {}",
                month_name(today.month()),
                today.day(),
                today.year()
            ),
        ));
    }

    if let Ok(re) = Regex::new(r"(?P<month>\d{1,2})月(?P<day>\d{1,2})日") {
        if let Some(captures) = re.captures(message_text) {
            let month = captures
                .name("month")
                .and_then(|value| value.as_str().parse::<u32>().ok())?;
            let day = captures
                .name("day")
                .and_then(|value| value.as_str().parse::<u32>().ok())?;
            if (1..=12).contains(&month) && (1..=31).contains(&day) {
                return Some((
                    format!("{}年{}月{}日", today.year(), month, day),
                    format!("{} {} {}", month_name(month), day, today.year()),
                ));
            }
        }
    }

    None
}

fn dedup_queries(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        let key = normalized.to_ascii_lowercase();
        if seen.insert(key) {
            result.push(normalized.to_string());
        }
    }
    result
}

fn build_news_preflight_queries_with_reference(
    message_text: &str,
    today: NaiveDate,
) -> Vec<String> {
    let base_clause = sanitize_news_search_clause(message_text);
    let (zh_topic, en_topic) = resolve_topic_labels(message_text);
    let mut queries = vec![derive_preflight_query(&base_clause)];

    if let Some((zh_date, en_date)) = resolve_absolute_news_date(message_text, today) {
        queries.push(format!("{zh_date} {zh_topic}"));
        queries.push(format!("{en_date} {en_topic}"));
        queries.push(format!("{en_date} world headlines"));
    } else {
        queries.push(format!("{base_clause} {zh_topic}"));
        queries.push(format!("{base_clause} {en_topic}"));
        queries.push(format!("{base_clause} latest headlines"));
    }

    dedup_queries(queries)
        .into_iter()
        .take(NEWS_PREFLIGHT_QUERY_LIMIT)
        .collect()
}

fn build_preflight_queries(message_text: &str, policy: &RequestToolPolicy) -> Vec<String> {
    if message_suggests_news_expansion(message_text) && policy.allows_web_search() {
        return build_news_preflight_queries_with_reference(
            message_text,
            Local::now().date_naive(),
        );
    }

    vec![derive_preflight_query(message_text)]
}

fn normalize_url_candidate(raw_url: &str) -> String {
    raw_url
        .trim()
        .trim_end_matches([',', '.', ';', ')', ']', '>'])
        .to_string()
}

fn extract_urls_from_output(output: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut seen = HashSet::new();
    if let Ok(re) = Regex::new(r#"https?://[^\s<>"')\]]+"#) {
        for capture in re.find_iter(output) {
            let url = normalize_url_candidate(capture.as_str());
            if !url.is_empty() && seen.insert(url.clone()) {
                urls.push(url);
            }
        }
    }
    urls
}

fn extract_domain(url: &str) -> String {
    let without_protocol = url
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    without_protocol
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(without_protocol)
        .trim_start_matches("www.")
        .to_string()
}

fn truncate_output_for_context(output: &str, max_chars: usize) -> String {
    let normalized = output
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .take(NEWS_PREFLIGHT_RESULT_LINES)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if normalized.chars().count() <= max_chars {
        normalized
    } else {
        normalized.chars().take(max_chars).collect::<String>() + "…"
    }
}

fn build_coverage_summary(
    planned_queries: &[String],
    outcomes: &[PreflightSearchOutcome],
) -> Option<String> {
    if planned_queries.is_empty() {
        return None;
    }

    let successful = outcomes.iter().filter(|item| item.success).count();
    let mut unique_urls = HashSet::new();
    let mut unique_domains = HashSet::new();
    for outcome in outcomes {
        for url in extract_urls_from_output(&outcome.output) {
            unique_domains.insert(extract_domain(&url));
            unique_urls.insert(url);
        }
    }

    Some(format!(
        "已并发预检索 {} 组查询，成功 {} 组，提取 {} 条去重链接，覆盖 {} 个站点。",
        planned_queries.len(),
        successful,
        unique_urls.len(),
        unique_domains.len()
    ))
}

fn build_preflight_prompt_appendix(
    planned_queries: &[String],
    outcomes: &[PreflightSearchOutcome],
) -> Option<String> {
    let successful = outcomes
        .iter()
        .filter(|item| item.success && !item.output.trim().is_empty())
        .collect::<Vec<_>>();
    if successful.is_empty() {
        return None;
    }

    let mut sections = vec![
        WEB_SEARCH_PREFETCH_CONTEXT_MARKER.to_string(),
        "本回合已先使用统一的 WebSearch 工具完成预检索。请优先基于以下结果做主题聚类、交叉验证和来源整合，不要退回到一次浅层搜索。".to_string(),
        "除非这些结果明显不足以回答用户问题，否则不要再次调用 WebSearch 或 WebFetch，也不要重复同一组查询；下一步应直接输出最终总结，而不是停留在工具轨迹。".to_string(),
    ];
    if let Some(summary) = build_coverage_summary(planned_queries, outcomes) {
        sections.push(summary);
    }
    sections.push("整理要求：先归纳主题，再写结论；优先采用多来源一致信息；若只来自单一来源，要在回答里显式说明。".to_string());

    let mut remaining_chars = NEWS_PREFLIGHT_CONTEXT_CHAR_LIMIT;
    for outcome in successful {
        if remaining_chars == 0 {
            break;
        }
        let excerpt_limit = remaining_chars.min(NEWS_PREFLIGHT_QUERY_OUTPUT_CHAR_LIMIT);
        let excerpt = truncate_output_for_context(&outcome.output, excerpt_limit);
        if excerpt.trim().is_empty() {
            continue;
        }
        remaining_chars = remaining_chars.saturating_sub(excerpt.chars().count());
        sections.push(format!(
            "### Query {}: {}\n{}",
            outcome.index + 1,
            outcome.query,
            excerpt
        ));
    }

    Some(sections.join("\n\n"))
}

fn merge_system_prompt_with_web_search_synthesis_instruction(
    base_prompt: Option<String>,
) -> Option<String> {
    let synthesis_prompt = format!(
        "{WEB_SEARCH_SYNTHESIS_MARKER}\n\
- 你已经完成本回合所需的 WebSearch 预检索。\n\
- 现在必须直接输出最终答复，不要再次调用 WebSearch 或 WebFetch。\n\
- 至少给出：结论摘要、主题归纳、关键信息、来源分歧说明。\n\
- 绝不能只停留在搜索轨迹或工具状态。"
    );

    match base_prompt {
        Some(base) => {
            if base.contains(WEB_SEARCH_SYNTHESIS_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(synthesis_prompt)
            } else {
                Some(format!("{base}\n\n{synthesis_prompt}"))
            }
        }
        None => Some(synthesis_prompt),
    }
}

fn build_web_search_synthesis_runtime_status(coverage_summary: Option<&str>) -> AgentRuntimeStatus {
    let mut checkpoints = vec![
        "已完成 WebSearch 预检索".to_string(),
        "正在把检索结果整理为最终答复".to_string(),
        "本阶段不再重复执行搜索".to_string(),
    ];
    if let Some(summary) = coverage_summary
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        checkpoints.push(summary.to_string());
    }

    AgentRuntimeStatus {
        phase: "synthesizing".to_string(),
        title: "正在整理联网结果".to_string(),
        detail: "已完成前置扩搜，正在基于已有 WebSearch 结果输出最终总结，不再重复检索。"
            .to_string(),
        checkpoints,
        metadata: None,
    }
}

fn duplicate_session_config(config: &aster::agents::SessionConfig) -> aster::agents::SessionConfig {
    aster::agents::SessionConfig {
        id: config.id.clone(),
        thread_id: config.thread_id.clone(),
        turn_id: config.turn_id.clone(),
        schedule_id: config.schedule_id.clone(),
        max_turns: config.max_turns,
        retry_config: config.retry_config.clone(),
        system_prompt: config.system_prompt.clone(),
        include_context_trace: config.include_context_trace,
        turn_context: config.turn_context.clone(),
    }
}

async fn emit_runtime_status_with_projection<F>(
    agent: &Agent,
    session_config: &aster::agents::SessionConfig,
    status: AgentRuntimeStatus,
    on_event: &mut F,
) where
    F: FnMut(&RuntimeAgentEvent),
{
    match agent
        .upsert_runtime_status_item(
            session_config,
            status.phase.clone(),
            status.title.clone(),
            status.detail.clone(),
            status.checkpoints.clone(),
        )
        .await
    {
        Ok(agent_event) => {
            for event in project_runtime_event(agent_event) {
                on_event(&event);
            }
        }
        Err(error) => {
            tracing::warn!(
                "[AsterAgent][RuntimeStatus] 写入 runtime item 失败，降级仅发 transient 事件: {}",
                error
            );
        }
    }

    let event = RuntimeAgentEvent::RuntimeStatus { status };
    on_event(&event);
}

fn should_retry_after_empty_reply(
    preflight_execution: &PreflightToolExecution,
    current_text_output: &str,
    tracker: &WebSearchExecutionTracker,
) -> bool {
    if !current_text_output.trim().is_empty() {
        return false;
    }

    preflight_execution.system_prompt_appendix.is_some()
        || preflight_execution.expanded_news_search
        || !tracker.ordered_tool_ids.is_empty()
}

#[allow(clippy::too_many_arguments)]
async fn stream_agent_reply_once<F>(
    agent: &Agent,
    user_message: Message,
    session_config: aster::agents::SessionConfig,
    cancel_token: Option<CancellationToken>,
    request_tool_policy: &RequestToolPolicy,
    web_search_tracker: &mut WebSearchExecutionTracker,
    write_artifact_emitter: &mut WriteArtifactEventEmitter,
    emitted_any: &mut bool,
    text_chunks: &mut Vec<String>,
    event_errors: &mut Vec<String>,
    diagnostics: &mut StreamEventDiagnostics,
    on_event: &mut F,
) -> Result<(), ReplyAttemptError>
where
    F: FnMut(&RuntimeAgentEvent),
{
    let mut auto_compaction_projection = AutoCompactionProjectionState;
    let mut stream = agent
        .reply(user_message, session_config, cancel_token)
        .await
        .map_err(|e| ReplyAttemptError {
            message: format!("Agent error: {e}"),
            emitted_any: *emitted_any,
        })?;

    while let Some(event_result) = stream.next().await {
        match event_result {
            Ok(agent_event) => {
                *emitted_any = true;
                let inline_provider_error = match &agent_event {
                    AsterAgentEvent::Message(message) => {
                        extract_inline_agent_provider_error(message)
                    }
                    _ => None,
                };
                let runtime_events = auto_compaction_projection
                    .project_event(&agent_event)
                    .unwrap_or_else(|| project_runtime_event(agent_event));
                for mut runtime_event in runtime_events {
                    let extra_events = write_artifact_emitter.process_event(&mut runtime_event);
                    for extra_event in &extra_events {
                        update_stream_event_diagnostics(diagnostics, extra_event);
                        on_event(extra_event);
                    }

                    match &runtime_event {
                        RuntimeAgentEvent::TextDelta { text } => {
                            if !text.is_empty() {
                                text_chunks.push(text.clone());
                            }
                        }
                        RuntimeAgentEvent::Error { message } => {
                            if !message.trim().is_empty() {
                                event_errors.push(message.clone());
                            }
                        }
                        RuntimeAgentEvent::ToolStart {
                            tool_name, tool_id, ..
                        } => web_search_tracker.record_tool_start(
                            request_tool_policy,
                            tool_id,
                            tool_name,
                        ),
                        RuntimeAgentEvent::ToolEnd { tool_id, result } => {
                            web_search_tracker.record_tool_end(
                                request_tool_policy,
                                tool_id,
                                result.success,
                                result.error.as_deref(),
                            );
                        }
                        _ => {}
                    }
                    update_stream_event_diagnostics(diagnostics, &runtime_event);
                    on_event(&runtime_event);
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
                    emitted_any: *emitted_any,
                });
            }
        }
    }

    Ok(())
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

/// 当开启联网搜索时，在正式回复前执行 WebSearch 预检索。
///
/// 目标：
/// - 在需要时通过执行层主动完成新闻类扩搜，而不是只依赖模型自己多次调用搜索。
/// - 统一生成 tool_start/tool_end 事件，供前端 harness 展示。
/// - 将预检索结果压缩注入 system prompt，帮助模型做更深的事实整合。
/// - 若本回合被明确要求必须先搜索，且预检索全部失败，则由上层中断本次回答。
pub async fn execute_web_search_preflight_if_needed(
    agent: &Agent,
    session_id: &str,
    message_text: &str,
    working_directory: Option<&Path>,
    cancel_token: Option<CancellationToken>,
    policy: &RequestToolPolicy,
    tracker: &mut WebSearchExecutionTracker,
) -> Result<PreflightToolExecution, String> {
    if !should_run_web_search_preflight(policy, message_text) {
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
    let preflight_tool_name = preflight_tool.name.clone();
    drop(registry);

    let planned_queries = build_preflight_queries(message_text, policy)
        .into_iter()
        .enumerate()
        .map(|(index, query)| {
            let params = serde_json::json!({ "query": query });
            PlannedWebSearchQuery {
                index,
                query,
                tool_id: format!("preflight-websearch-{}-{}", index + 1, Uuid::new_v4()),
                arguments: serde_json::to_string(&params).ok(),
            }
        })
        .collect::<Vec<_>>();
    let expanded_news_search = planned_queries.len() > 1;

    let working_directory = working_directory
        .map(Path::to_path_buf)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_default();
    let mut events = Vec::new();
    for planned in &planned_queries {
        tracker.record_tool_start(policy, &planned.tool_id, &preflight_tool_name);
        events.push(RuntimeAgentEvent::ToolStart {
            tool_name: preflight_tool_name.clone(),
            tool_id: planned.tool_id.clone(),
            arguments: planned.arguments.clone(),
        });
    }

    #[allow(clippy::redundant_iter_cloned)]
    let mut outcomes = stream::iter(planned_queries.iter().cloned().map(|planned| {
        let registry_arc = registry_arc.clone();
        let preflight_tool_name = preflight_tool_name.clone();
        let session_id = session_id.to_string();
        let working_directory = working_directory.clone();
        let cancel_token = cancel_token.clone();
        async move {
            let query = planned.query.clone();
            let params = serde_json::json!({ "query": query });
            let mut context = ToolContext::new(working_directory).with_session_id(session_id);
            if let Some(token) = cancel_token {
                context = context.with_cancellation_token(token);
            }
            let result = {
                let registry = registry_arc.read().await;
                registry
                    .execute(&preflight_tool_name, params, &context, None)
                    .await
            };
            match result {
                Ok(tool_result) => PreflightSearchOutcome {
                    index: planned.index,
                    query: planned.query,
                    tool_id: planned.tool_id,
                    success: tool_result.success,
                    output: tool_result.output.unwrap_or_default(),
                    error: tool_result.error,
                },
                Err(error) => PreflightSearchOutcome {
                    index: planned.index,
                    query: planned.query,
                    tool_id: planned.tool_id,
                    success: false,
                    output: String::new(),
                    error: Some(format!("执行 WebSearch 预调用失败: {}", error)),
                },
            }
        }
    }))
    .buffer_unordered(NEWS_PREFLIGHT_QUERY_PARALLELISM)
    .collect::<Vec<_>>()
    .await;
    outcomes.sort_by_key(|item| item.index);

    for outcome in &outcomes {
        tracker.record_tool_end(
            policy,
            &outcome.tool_id,
            outcome.success,
            outcome.error.as_deref(),
        );
        events.push(RuntimeAgentEvent::ToolEnd {
            tool_id: outcome.tool_id.clone(),
            result: AgentToolResult {
                success: outcome.success,
                output: outcome.output.clone(),
                error: outcome.error.clone(),
                images: None,
                metadata: None,
            },
        });
    }

    let planned_query_texts = planned_queries
        .iter()
        .map(|item| item.query.clone())
        .collect::<Vec<_>>();
    let successful_required = outcomes.iter().any(|item| item.success);
    let coverage_summary = build_coverage_summary(&planned_query_texts, &outcomes);
    let system_prompt_appendix = build_preflight_prompt_appendix(&planned_query_texts, &outcomes);

    if policy.requires_web_search() && !successful_required {
        let failure_details = outcomes
            .iter()
            .map(|item| {
                format!(
                    "{} => {}",
                    item.query,
                    item.error.clone().unwrap_or_else(|| "unknown".to_string())
                )
            })
            .collect::<Vec<_>>()
            .join(" | ");
        Err(format!("联网搜索预调用失败: {failure_details}"))
    } else {
        Ok(PreflightToolExecution {
            events,
            planned_queries: planned_query_texts,
            system_prompt_appendix,
            coverage_summary,
            expanded_news_search,
        })
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
    on_event: F,
) -> Result<StreamReplyExecution, ReplyAttemptError>
where
    F: FnMut(&RuntimeAgentEvent),
{
    stream_message_reply_with_policy(
        agent,
        Message::user().with_text(message_text),
        working_directory,
        session_config,
        cancel_token,
        request_tool_policy,
        on_event,
    )
    .await
}

pub async fn stream_message_reply_with_policy<F>(
    agent: &Agent,
    user_message: Message,
    working_directory: Option<&Path>,
    mut session_config: aster::agents::SessionConfig,
    cancel_token: Option<CancellationToken>,
    request_tool_policy: &RequestToolPolicy,
    mut on_event: F,
) -> Result<StreamReplyExecution, ReplyAttemptError>
where
    F: FnMut(&RuntimeAgentEvent),
{
    let message_text = user_message.as_concat_text();
    let mut web_search_tracker = WebSearchExecutionTracker::default();
    let preflight = execute_web_search_preflight_if_needed(
        agent,
        &session_config.id,
        &message_text,
        working_directory,
        cancel_token.clone(),
        request_tool_policy,
        &mut web_search_tracker,
    )
    .await;
    let preflight_execution = match preflight {
        Ok(preflight_execution) => {
            session_config.system_prompt = merge_system_prompt_with_web_search_preflight_context(
                session_config.system_prompt.take(),
                preflight_execution.system_prompt_appendix.clone(),
            );
            for event in &preflight_execution.events {
                on_event(event);
            }
            preflight_execution
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
    };

    let mut write_artifact_emitter = WriteArtifactEventEmitter::new(session_config.id.clone());
    let mut emitted_any = false;
    let mut text_chunks: Vec<String> = Vec::new();
    let mut event_errors: Vec<String> = Vec::new();
    let mut diagnostics = StreamEventDiagnostics::default();
    stream_agent_reply_once(
        agent,
        user_message,
        duplicate_session_config(&session_config),
        cancel_token.clone(),
        request_tool_policy,
        &mut web_search_tracker,
        &mut write_artifact_emitter,
        &mut emitted_any,
        &mut text_chunks,
        &mut event_errors,
        &mut diagnostics,
        &mut on_event,
    )
    .await?;

    let current_text_output = text_chunks.join("");
    if should_retry_after_empty_reply(
        &preflight_execution,
        &current_text_output,
        &web_search_tracker,
    ) {
        tracing::warn!(
            "[AsterAgent][WebSearchPrefetch] empty final text after preflight, retrying synthesis: session={}, attempts={}",
            session_config.id,
            web_search_tracker.format_attempts()
        );
        emit_runtime_status_with_projection(
            agent,
            &session_config,
            build_web_search_synthesis_runtime_status(
                preflight_execution.coverage_summary.as_deref(),
            ),
            &mut on_event,
        )
        .await;
        session_config.system_prompt = merge_system_prompt_with_web_search_synthesis_instruction(
            session_config.system_prompt.take(),
        );
        stream_agent_reply_once(
            agent,
            Message::user().with_text(WEB_SEARCH_EMPTY_REPLY_RETRY_PROMPT),
            duplicate_session_config(&session_config),
            cancel_token,
            request_tool_policy,
            &mut web_search_tracker,
            &mut write_artifact_emitter,
            &mut emitted_any,
            &mut text_chunks,
            &mut event_errors,
            &mut diagnostics,
            &mut on_event,
        )
        .await?;
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

    let final_text_output = text_chunks.join("");
    if final_text_output.trim().is_empty() {
        if let Some(last_error) = event_errors.last() {
            return Err(ReplyAttemptError {
                message: last_error.clone(),
                emitted_any,
            });
        }
        return Err(ReplyAttemptError {
            message: format!(
                "已完成当前回合的工具执行，但模型未输出最终答复。\n尝试记录: {}",
                web_search_tracker.format_attempts()
            ),
            emitted_any,
        });
    }

    Ok(StreamReplyExecution {
        text_output: final_text_output,
        event_errors,
        emitted_any,
        attempts_summary: web_search_tracker.format_attempts(),
    })
}

fn is_web_search_preflight_enabled() -> bool {
    match env_compat::var(WEB_SEARCH_PREFLIGHT_ENABLED_ENV_KEYS) {
        Some(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "0" | "false" | "no" | "off" => false,
            _ => true,
        },
        None => true,
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
    use aster::providers::base::{Provider, ProviderMetadata, ProviderUsage};
    use aster::providers::errors::ProviderError;
    use aster::session::{SessionManager, SessionType, TurnContextOverride};
    use async_trait::async_trait;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;

    struct ContextLengthExceededProvider;

    #[async_trait]
    impl Provider for ContextLengthExceededProvider {
        fn metadata() -> ProviderMetadata
        where
            Self: Sized,
        {
            ProviderMetadata::empty()
        }

        fn get_name(&self) -> &str {
            "context-length-exceeded-provider"
        }

        async fn complete_with_model(
            &self,
            _model_config: &aster::model::ModelConfig,
            _system: &str,
            _messages: &[Message],
            _tools: &[rmcp::model::Tool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            Err(ProviderError::ContextLengthExceeded(
                "mock context overflow".to_string(),
            ))
        }

        fn get_model_config(&self) -> aster::model::ModelConfig {
            aster::model::ModelConfig::new("gpt-5.3-codex").expect("test model config")
        }
    }

    fn build_auto_compaction_disabled_turn_context() -> TurnContextOverride {
        let mut metadata = HashMap::new();
        metadata.insert(
            "lime_runtime".to_string(),
            serde_json::json!({
                "auto_compact": false,
            }),
        );
        TurnContextOverride {
            metadata,
            ..TurnContextOverride::default()
        }
    }

    #[test]
    fn resolves_effective_web_search_with_request_override() {
        let policy = resolve_request_tool_policy(Some(false), true);
        assert!(!policy.effective_web_search);
        assert_eq!(policy.search_mode, RequestToolPolicyMode::Disabled);

        let policy = resolve_request_tool_policy(Some(true), false);
        assert!(policy.effective_web_search);
        assert_eq!(policy.search_mode, RequestToolPolicyMode::Allowed);
    }

    #[test]
    fn resolves_effective_web_search_with_mode_default() {
        let policy = resolve_request_tool_policy(None, true);
        assert!(policy.effective_web_search);
        assert_eq!(policy.search_mode, RequestToolPolicyMode::Allowed);

        let policy = resolve_request_tool_policy(None, false);
        assert!(!policy.effective_web_search);
        assert_eq!(policy.search_mode, RequestToolPolicyMode::Disabled);
    }

    #[test]
    fn resolves_required_mode_when_explicitly_requested() {
        let policy = resolve_request_tool_policy_with_mode(
            Some(true),
            Some(RequestToolPolicyMode::Required),
            false,
        );
        assert!(policy.effective_web_search);
        assert!(policy.requires_web_search());
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
        assert!(merged.contains("不代表本回合必须联网"));
        assert!(merged.contains("先理解用户意图"));
        assert!(merged.contains("WebSearch"));
    }

    #[test]
    fn appends_required_policy_prompt_when_required() {
        let policy = resolve_request_tool_policy_with_mode(
            Some(true),
            Some(RequestToolPolicyMode::Required),
            false,
        );
        let merged =
            merge_system_prompt_with_request_tool_policy(Some("base".to_string()), &policy)
                .expect("merged prompt should exist");
        assert!(merged.contains("必须先调用"));
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
    fn tracker_does_not_require_websearch_when_only_allowed() {
        let policy = resolve_request_tool_policy(Some(true), false);
        let mut tracker = WebSearchExecutionTracker::default();
        tracker.record_tool_start(&policy, "tool-1", "WebFetch");
        tracker.record_tool_end(&policy, "tool-1", true, None);
        assert!(tracker.validate_web_search_requirement(&policy).is_ok());
    }

    #[test]
    fn tracker_accepts_successful_required_websearch() {
        let policy = resolve_request_tool_policy_with_mode(
            Some(true),
            Some(RequestToolPolicyMode::Required),
            false,
        );
        let mut tracker = WebSearchExecutionTracker::default();
        tracker.record_tool_start(&policy, "tool-1", "WebSearch");
        tracker.record_tool_end(&policy, "tool-1", true, None);
        assert!(tracker.validate_web_search_requirement(&policy).is_ok());
    }

    #[test]
    fn tracker_reports_failure_record() {
        let policy = resolve_request_tool_policy_with_mode(
            Some(true),
            Some(RequestToolPolicyMode::Required),
            false,
        );
        let mut tracker = WebSearchExecutionTracker::default();
        tracker.record_tool_start(&policy, "tool-1", "WebSearch");
        tracker.record_tool_end(&policy, "tool-1", false, Some("network timeout"));
        let err = tracker
            .validate_web_search_requirement(&policy)
            .expect_err("failed required tool should fail");
        assert!(err.contains("network timeout"));
        assert!(err.contains("尝试记录"));
    }

    #[test]
    fn detects_news_expansion_for_daily_news_summary_requests() {
        assert!(message_suggests_news_expansion("帮我汇总3月13日国际新闻"));
        assert!(message_suggests_news_expansion(
            "Please summarize the latest world news for March 13"
        ));
        assert!(!message_suggests_news_expansion("帮我解释一下牛顿第二定律"));
    }

    #[test]
    fn builds_news_preflight_queries_with_absolute_date_variants() {
        let queries = build_news_preflight_queries_with_reference(
            "帮我汇总3月13日国际新闻",
            NaiveDate::from_ymd_opt(2026, 3, 13).expect("valid date"),
        );

        assert_eq!(queries[0], "汇总3月13日国际新闻");
        assert!(queries.contains(&"2026年3月13日 国际新闻".to_string()));
        assert!(queries.contains(&"March 13 2026 international news".to_string()));
        assert!(queries.contains(&"March 13 2026 world headlines".to_string()));
    }

    #[test]
    fn merges_web_search_preflight_context_without_duplication() {
        let merged = merge_system_prompt_with_web_search_preflight_context(
            Some("base".to_string()),
            Some(format!("{WEB_SEARCH_PREFETCH_CONTEXT_MARKER}\ncontext")),
        )
        .expect("merged prompt should exist");
        assert!(merged.contains(WEB_SEARCH_PREFETCH_CONTEXT_MARKER));

        let preserved = merge_system_prompt_with_web_search_preflight_context(
            Some(merged.clone()),
            Some(format!("{WEB_SEARCH_PREFETCH_CONTEXT_MARKER}\nother")),
        )
        .expect("prompt should be preserved");
        assert_eq!(preserved, merged);
    }

    #[test]
    fn appends_synthesis_instruction_without_duplication() {
        let merged =
            merge_system_prompt_with_web_search_synthesis_instruction(Some("base".to_string()))
                .expect("merged prompt should exist");
        assert!(merged.contains(WEB_SEARCH_SYNTHESIS_MARKER));
        assert!(merged.contains("不要再次调用 WebSearch"));

        let preserved =
            merge_system_prompt_with_web_search_synthesis_instruction(Some(merged.clone()))
                .expect("prompt should be preserved");
        assert_eq!(preserved, merged);
    }

    #[test]
    fn auto_compaction_projection_swallows_aster_compaction_system_notifications() {
        let mut state = AutoCompactionProjectionState::default();

        let start_events = state.project_event(&AsterAgentEvent::Message(
            Message::assistant().with_system_notification(
                SystemNotificationType::InlineMessage,
                "Exceeded auto-compact threshold of 80%. Performing auto-compaction...",
            ),
        ));
        assert!(matches!(start_events, Some(events) if events.is_empty()));

        let thinking_events = state
            .project_event(&AsterAgentEvent::Message(
                Message::assistant().with_system_notification(
                    SystemNotificationType::ThinkingMessage,
                    ASTER_AUTO_COMPACTION_THINKING_TEXT,
                ),
            ))
            .expect("应识别自动压缩 thinking 通知");
        assert!(thinking_events.is_empty());

        let complete_events = state
            .project_event(&AsterAgentEvent::Message(
                Message::assistant().with_system_notification(
                    SystemNotificationType::InlineMessage,
                    ASTER_AUTO_COMPACTION_COMPLETE_TEXT,
                ),
            ))
            .expect("应识别自动压缩完成通知");
        assert!(complete_events.is_empty());
    }

    #[test]
    fn auto_compaction_projection_surfaces_compaction_failure_as_error() {
        let mut state = AutoCompactionProjectionState::default();
        let _ = state.project_event(&AsterAgentEvent::Message(
            Message::assistant().with_system_notification(
                SystemNotificationType::InlineMessage,
                "Exceeded auto-compact threshold of 80%. Performing auto-compaction...",
            ),
        ));

        let failure_events = state
            .project_event(&AsterAgentEvent::Message(Message::assistant().with_text(
                "Ran into this error trying to compact: context window exceeded.\n\nPlease try again or create a new session",
            )))
            .expect("应识别自动压缩失败事件");

        assert_eq!(failure_events.len(), 1);
        match &failure_events[0] {
            RuntimeAgentEvent::Error { message } => {
                assert_eq!(
                    message,
                    "自动压缩上下文失败，请重试或新建会话：context window exceeded"
                );
            }
            other => panic!("Expected compaction error event, got {other:?}"),
        }
    }

    #[test]
    fn auto_compaction_projection_surfaces_disabled_auto_compaction_limit_as_error() {
        let mut state = AutoCompactionProjectionState::default();

        let events = state
            .project_event(&AsterAgentEvent::Message(
                Message::assistant().with_system_notification(
                    SystemNotificationType::InlineMessage,
                    ASTER_AUTO_COMPACTION_DISABLED_TEXT,
                ),
            ))
            .expect("应识别自动压缩禁用后的上下文上限提示");

        assert_eq!(events.len(), 1);
        match &events[0] {
            RuntimeAgentEvent::Error { message } => {
                assert_eq!(
                    message,
                    "当前会话已达到上下文上限，但当前工作区已关闭自动压缩。请先手动压缩上下文或新建会话后重试。"
                );
            }
            other => panic!("Expected compaction disabled error event, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn stream_message_reply_with_policy_should_surface_disabled_auto_compaction_limit_from_aster(
    ) {
        let session = SessionManager::create_session(
            PathBuf::default(),
            "lime-auto-compact-disabled".to_string(),
            SessionType::Hidden,
        )
        .await
        .expect("应创建测试 session");
        let agent = Agent::new();
        agent
            .update_provider(Arc::new(ContextLengthExceededProvider), &session.id)
            .await
            .expect("应配置测试 provider");

        let session_config = aster::agents::SessionConfig {
            id: session.id.clone(),
            thread_id: None,
            turn_id: Some("turn-auto-compact-disabled".to_string()),
            schedule_id: None,
            max_turns: None,
            retry_config: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: Some(build_auto_compaction_disabled_turn_context()),
        };
        let policy = resolve_request_tool_policy(Some(false), false);
        let mut runtime_events = Vec::new();

        let error = stream_message_reply_with_policy(
            &agent,
            Message::user().with_text("继续处理"),
            None,
            session_config,
            None,
            &policy,
            |event| runtime_events.push(event.clone()),
        )
        .await
        .expect_err("禁用自动压缩时应透出上下文上限错误");

        assert_eq!(
            error.message,
            "当前会话已达到上下文上限，但当前工作区已关闭自动压缩。请先手动压缩上下文或新建会话后重试。"
        );
        assert!(
            runtime_events.iter().any(|event| matches!(
                event,
                RuntimeAgentEvent::Error { message }
                    if message
                        == "当前会话已达到上下文上限，但当前工作区已关闭自动压缩。请先手动压缩上下文或新建会话后重试。"
            )),
            "应向前端投影显式错误"
        );
        assert!(
            !runtime_events
                .iter()
                .any(|event| matches!(event, RuntimeAgentEvent::ContextCompactionStarted { .. })),
            "禁用自动压缩后，不应再投影 compaction started"
        );
        assert!(
            !runtime_events
                .iter()
                .any(|event| matches!(event, RuntimeAgentEvent::ContextCompactionCompleted { .. })),
            "禁用自动压缩后，不应再投影 compaction completed"
        );
    }
}
