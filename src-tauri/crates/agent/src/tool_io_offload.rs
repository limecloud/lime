use aster::context::{
    analyze_tool_io_text_payload as analyze_text_payload_stats,
    analyze_tool_io_value_payload as analyze_value_payload_stats,
    build_tool_io_history_eviction_plan as build_aster_tool_io_history_eviction_plan,
    build_tool_io_notice_text as build_aster_tool_io_notice_text,
    build_tool_io_payload_envelope as build_aster_tool_io_payload_envelope,
    build_tool_io_preview as build_aster_tool_io_preview,
    estimate_tool_io_tokens as estimate_text_token_count,
    resolve_tool_io_eviction_policy as resolve_aster_tool_io_eviction_policy,
    resolve_tool_io_offload_decision as resolve_aster_tool_io_offload_decision,
    ToolIoEvictionConfig, ToolIoEvictionPolicy,
    ToolIoHistoryEvictionCandidate as AsterToolIoHistoryEvictionCandidate,
    ToolIoHistoryMessageAnalysis as AsterToolIoHistoryMessageAnalysis, ToolIoOffloadThresholds,
    ToolIoOffloadTrigger, ToolIoPayloadStats, ToolIoPreviewConfig,
    DEFAULT_CONTEXT_WINDOW_KEEP_RECENT_MESSAGES, DEFAULT_CONTEXT_WINDOW_MAX_INPUT_TOKENS,
    DEFAULT_CONTEXT_WINDOW_TRIGGER_RATIO, DEFAULT_TOOL_IO_PREVIEW_MAX_CHARS,
    DEFAULT_TOOL_IO_PREVIEW_MAX_LINES, DEFAULT_TOOL_TOKEN_LIMIT_BEFORE_EVICT,
};
use chrono::Utc;
use proxycast_core::agent::types::AgentMessage;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

const TOOL_IO_OFFLOAD_DIR: &str = "harness/tool-io";
const TOOL_ARGUMENTS_DIR: &str = "inputs";
const TOOL_RESULTS_DIR: &str = "results";
const TOOL_RESULT_SAFETY_TRIGGER_BYTES: usize = 64 * 1024;
const TOOL_ARGUMENTS_SAFETY_TRIGGER_BYTES: usize = 128 * 1024;
const TOOL_RESULT_SAFETY_TRIGGER_CHARS: usize = 24_000;
const TOOL_ARGUMENTS_SAFETY_TRIGGER_CHARS: usize = 32_000;
const ESTIMATED_OFFLOADED_PREVIEW_TOKENS: usize = 256;
const TOOL_ARGUMENTS_OFFLOAD_THRESHOLDS: ToolIoOffloadThresholds = ToolIoOffloadThresholds {
    max_bytes: TOOL_ARGUMENTS_SAFETY_TRIGGER_BYTES,
    max_chars: TOOL_ARGUMENTS_SAFETY_TRIGGER_CHARS,
};
const TOOL_RESULT_OFFLOAD_THRESHOLDS: ToolIoOffloadThresholds = ToolIoOffloadThresholds {
    max_bytes: TOOL_RESULT_SAFETY_TRIGGER_BYTES,
    max_chars: TOOL_RESULT_SAFETY_TRIGGER_CHARS,
};
const TOOL_OFFLOAD_PREVIEW_CONFIG: ToolIoPreviewConfig = ToolIoPreviewConfig {
    max_lines: DEFAULT_TOOL_IO_PREVIEW_MAX_LINES,
    max_chars: DEFAULT_TOOL_IO_PREVIEW_MAX_CHARS,
};
const PROVIDER_NAME_HINTS: &[&str] = &[
    "openai",
    "anthropic",
    "google",
    "azure",
    "bedrock",
    "gcpvertexai",
    "ollama",
    "fal",
    "codex",
    "xai",
    "grok",
];

pub const PROXYCAST_TOOL_ARGUMENTS_OFFLOAD_KEY: &str = "__proxycast_offload";
pub const PROXYCAST_TOOL_TOKEN_LIMIT_BEFORE_EVICT_ENV: &str =
    "PROXYCAST_TOOL_TOKEN_LIMIT_BEFORE_EVICT";
pub const PROXYCAST_CONTEXT_MAX_INPUT_TOKENS_ENV: &str = "PROXYCAST_CONTEXT_MAX_INPUT_TOKENS";
pub const PROXYCAST_CONTEXT_WINDOW_TRIGGER_RATIO_ENV: &str =
    "PROXYCAST_CONTEXT_WINDOW_TRIGGER_RATIO";
pub const PROXYCAST_CONTEXT_KEEP_RECENT_MESSAGES_ENV: &str =
    "PROXYCAST_CONTEXT_KEEP_RECENT_MESSAGES";

#[derive(Debug, Clone)]
pub struct ToolOutputOffload {
    pub output: String,
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Default)]
pub struct HistoryToolIoEvictionPlan {
    pub request_ids: HashSet<String>,
    pub response_ids: HashSet<String>,
    pub total_tokens: usize,
    pub trigger_tokens: usize,
    pub projected_tokens: usize,
    pub keep_recent_messages: usize,
}

#[derive(Debug, Clone)]
struct OffloadInfo {
    file_path_string: String,
    payload_bytes: usize,
    original_chars: usize,
    original_tokens: usize,
}

#[derive(Debug, Clone)]
struct HistoryEvictionCandidate {
    kind: HistoryEvictionCandidateKind,
    reduction_tokens: usize,
}

#[derive(Debug, Clone)]
enum HistoryEvictionCandidateKind {
    Request(String),
    Response(String),
}

fn sanitize_identifier(input: &str) -> String {
    let mut normalized = input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    normalized.truncate(64);
    let normalized = normalized.trim_matches('_');
    if normalized.is_empty() {
        "tool".to_string()
    } else {
        normalized.to_string()
    }
}

fn stable_hash(value: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn parse_optional_usize_env(names: &[&str]) -> Option<usize> {
    names
        .iter()
        .find_map(|name| std::env::var(name).ok())
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
}

fn parse_usize_env(names: &[&str], default: usize) -> usize {
    parse_optional_usize_env(names).unwrap_or(default)
}

fn parse_f64_env(names: &[&str], default: f64) -> f64 {
    names
        .iter()
        .find_map(|name| std::env::var(name).ok())
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.1 && *value <= 1.0)
        .unwrap_or(default)
}

pub fn resolve_tool_io_eviction_policy() -> ToolIoEvictionPolicy {
    resolve_tool_io_eviction_policy_for_model(None)
}

fn normalize_model_hint(model_name: Option<&str>) -> Option<&str> {
    let trimmed = model_name
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if trimmed.eq_ignore_ascii_case("agent:default") {
        return None;
    }

    let normalized = trimmed.to_ascii_lowercase();
    if PROVIDER_NAME_HINTS
        .iter()
        .any(|provider_name| normalized == *provider_name)
    {
        return None;
    }

    Some(trimmed)
}

pub fn resolve_tool_io_eviction_policy_for_model(model_name: Option<&str>) -> ToolIoEvictionPolicy {
    let explicit_context_max_input_tokens = parse_optional_usize_env(&[
        PROXYCAST_CONTEXT_MAX_INPUT_TOKENS_ENV,
        "PROXYCAST_MAX_INPUT_TOKENS",
    ]);
    let config = ToolIoEvictionConfig {
        token_limit_before_evict: parse_usize_env(
            &[
                PROXYCAST_TOOL_TOKEN_LIMIT_BEFORE_EVICT_ENV,
                "PROXYCAST_TOOL_IO_TOKEN_LIMIT_BEFORE_EVICT",
            ],
            DEFAULT_TOOL_TOKEN_LIMIT_BEFORE_EVICT,
        ),
        fallback_context_max_input_tokens: explicit_context_max_input_tokens
            .unwrap_or(DEFAULT_CONTEXT_WINDOW_MAX_INPUT_TOKENS),
        context_window_trigger_ratio: parse_f64_env(
            &[PROXYCAST_CONTEXT_WINDOW_TRIGGER_RATIO_ENV],
            DEFAULT_CONTEXT_WINDOW_TRIGGER_RATIO,
        ),
        keep_recent_messages: parse_usize_env(
            &[PROXYCAST_CONTEXT_KEEP_RECENT_MESSAGES_ENV],
            DEFAULT_CONTEXT_WINDOW_KEEP_RECENT_MESSAGES,
        ),
    };
    let resolved_model_name = if explicit_context_max_input_tokens.is_some() {
        None
    } else {
        normalize_model_hint(model_name)
    };

    resolve_aster_tool_io_eviction_policy(resolved_model_name, config)
}

fn resolve_offload_root() -> Result<PathBuf, String> {
    if let Ok(override_dir) = std::env::var("PROXYCAST_TOOL_IO_OFFLOAD_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    #[cfg(test)]
    {
        Ok(std::env::temp_dir()
            .join("proxycast-tests")
            .join(TOOL_IO_OFFLOAD_DIR))
    }

    #[cfg(not(test))]
    {
        Ok(proxycast_core::app_paths::preferred_data_dir()?.join(TOOL_IO_OFFLOAD_DIR))
    }
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("创建目录失败 {}: {e}", path.display()))
}

fn write_offload_payload(
    root: &Path,
    subdir: &str,
    key: &str,
    payload: &Value,
    stats: ToolIoPayloadStats,
) -> Result<OffloadInfo, String> {
    let target_dir = root.join(subdir);
    ensure_dir(&target_dir)?;

    let payload_text = serde_json::to_string_pretty(payload)
        .map_err(|e| format!("序列化 offload 载荷失败: {e}"))?;
    let file_name = format!(
        "{}-{:016x}.json",
        sanitize_identifier(key),
        stable_hash(&payload_text)
    );
    let file_path = target_dir.join(file_name);

    if !file_path.exists() {
        fs::write(&file_path, payload_text.as_bytes())
            .map_err(|e| format!("写入 offload 文件失败 {}: {e}", file_path.display()))?;
    }

    Ok(OffloadInfo {
        file_path_string: file_path.to_string_lossy().to_string(),
        payload_bytes: payload_text.len(),
        original_chars: stats.chars,
        original_tokens: stats.tokens,
    })
}

fn merge_metadata(
    base: Option<HashMap<String, Value>>,
    extra: HashMap<String, Value>,
) -> HashMap<String, Value> {
    let mut merged = base.unwrap_or_default();
    merged.extend(extra);
    merged
}

fn scalar_or_short_value(value: &Value) -> Option<Value> {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => Some(value.clone()),
        Value::String(text) => {
            if text.chars().count() <= 200 {
                Some(Value::String(text.clone()))
            } else {
                None
            }
        }
        _ => None,
    }
}

fn build_compact_arguments_value(
    arguments: &Value,
    info: &OffloadInfo,
    preview: &str,
    trigger: ToolIoOffloadTrigger,
) -> Value {
    let mut compact = Map::new();
    compact.insert(
        PROXYCAST_TOOL_ARGUMENTS_OFFLOAD_KEY.to_string(),
        json!({
            "kind": "tool_arguments",
            "file": info.file_path_string,
            "preview_lines": DEFAULT_TOOL_IO_PREVIEW_MAX_LINES,
            "original_chars": info.original_chars,
            "original_tokens": info.original_tokens,
            "payload_bytes": info.payload_bytes,
            "trigger": trigger.as_str(),
        }),
    );

    if let Some(record) = arguments.as_object() {
        for key in [
            "path",
            "file_path",
            "filePath",
            "command",
            "pattern",
            "query",
            "task_id",
            "taskId",
            "id",
            "tool",
        ] {
            if compact.contains_key(key) {
                continue;
            }
            if let Some(value) = record.get(key).and_then(scalar_or_short_value) {
                compact.insert(key.to_string(), value);
            }
        }
    }

    compact.insert("preview".to_string(), Value::String(preview.to_string()));
    Value::Object(compact)
}

fn resolve_argument_offload_trigger(
    stats: ToolIoPayloadStats,
    policy: ToolIoEvictionPolicy,
) -> Option<ToolIoOffloadTrigger> {
    resolve_aster_tool_io_offload_decision(stats, policy, TOOL_ARGUMENTS_OFFLOAD_THRESHOLDS)
        .map(|decision| decision.trigger)
}

fn resolve_result_offload_trigger(
    stats: ToolIoPayloadStats,
    policy: ToolIoEvictionPolicy,
) -> Option<ToolIoOffloadTrigger> {
    resolve_aster_tool_io_offload_decision(stats, policy, TOOL_RESULT_OFFLOAD_THRESHOLDS)
        .map(|decision| decision.trigger)
}

fn offload_output_metadata(
    info: &OffloadInfo,
    kind: &str,
    trigger: ToolIoOffloadTrigger,
) -> HashMap<String, Value> {
    let mut extra = HashMap::new();
    extra.insert("proxycast_offloaded".to_string(), json!(true));
    extra.insert("offload_kind".to_string(), json!(kind));
    extra.insert(
        "offload_file".to_string(),
        json!(info.file_path_string.clone()),
    );
    extra.insert(
        "offload_payload_bytes".to_string(),
        json!(info.payload_bytes),
    );
    extra.insert(
        "offload_original_chars".to_string(),
        json!(info.original_chars),
    );
    extra.insert(
        "offload_original_tokens".to_string(),
        json!(info.original_tokens),
    );
    extra.insert(
        "offload_preview_lines".to_string(),
        json!(DEFAULT_TOOL_IO_PREVIEW_MAX_LINES),
    );
    extra.insert("offload_trigger".to_string(), json!(trigger.as_str()));
    extra
}

fn offload_tool_arguments_internal(
    key: &str,
    arguments: &Value,
    trigger: ToolIoOffloadTrigger,
) -> Value {
    let serialized = match serde_json::to_string(arguments) {
        Ok(value) => value,
        Err(_) => return arguments.clone(),
    };
    let stats = analyze_text_payload_stats(&serialized);
    let preview = build_aster_tool_io_preview(&serialized, TOOL_OFFLOAD_PREVIEW_CONFIG);
    let payload = build_aster_tool_io_payload_envelope("tool_arguments", arguments.clone());
    let Ok(root) = resolve_offload_root() else {
        return arguments.clone();
    };
    let Ok(info) = write_offload_payload(&root, TOOL_ARGUMENTS_DIR, key, &payload, stats) else {
        return arguments.clone();
    };

    build_compact_arguments_value(arguments, &info, &preview, trigger)
}

fn offload_tool_output_internal(
    key: &str,
    preview_source: &str,
    payload: Value,
    stats: ToolIoPayloadStats,
    metadata: Option<HashMap<String, Value>>,
    kind: &str,
    trigger: ToolIoOffloadTrigger,
) -> ToolOutputOffload {
    let Ok(root) = resolve_offload_root() else {
        return ToolOutputOffload {
            output: preview_source.to_string(),
            metadata: metadata.unwrap_or_default(),
        };
    };
    let Ok(info) = write_offload_payload(&root, TOOL_RESULTS_DIR, key, &payload, stats) else {
        return ToolOutputOffload {
            output: preview_source.to_string(),
            metadata: metadata.unwrap_or_default(),
        };
    };

    let preview = build_aster_tool_io_preview(preview_source, TOOL_OFFLOAD_PREVIEW_CONFIG);
    ToolOutputOffload {
        output: build_aster_tool_io_notice_text(
            &preview,
            &format!(
                "[ProxyCast Offload] 完整输出已转存到文件：{}",
                &info.file_path_string
            ),
        ),
        metadata: merge_metadata(metadata, offload_output_metadata(&info, kind, trigger)),
    }
}

pub fn maybe_offload_tool_arguments(key: &str, arguments: &Value) -> Value {
    let stats = analyze_value_payload_stats(arguments);
    let policy = resolve_tool_io_eviction_policy();
    let Some(trigger) = resolve_argument_offload_trigger(stats, policy) else {
        return arguments.clone();
    };

    offload_tool_arguments_internal(key, arguments, trigger)
}

pub fn force_offload_tool_arguments_for_history(key: &str, arguments: &Value) -> Value {
    offload_tool_arguments_internal(key, arguments, ToolIoOffloadTrigger::HistoryContextPressure)
}

pub fn maybe_offload_tool_result_payload<T: Serialize>(
    key: &str,
    preview_source: &str,
    payload: &T,
    metadata: Option<HashMap<String, Value>>,
) -> ToolOutputOffload {
    let payload_value = match serde_json::to_value(payload) {
        Ok(value) => value,
        Err(_) => {
            return ToolOutputOffload {
                output: preview_source.to_string(),
                metadata: metadata.unwrap_or_default(),
            }
        }
    };

    let stats = analyze_value_payload_stats(&payload_value);
    let policy = resolve_tool_io_eviction_policy();
    let Some(trigger) = resolve_result_offload_trigger(stats, policy) else {
        return ToolOutputOffload {
            output: preview_source.to_string(),
            metadata: metadata.unwrap_or_default(),
        };
    };

    offload_tool_output_internal(
        key,
        preview_source,
        build_aster_tool_io_payload_envelope("tool_result", payload_value),
        stats,
        metadata,
        "tool_result",
        trigger,
    )
}

pub fn maybe_offload_plain_tool_output(
    key: &str,
    output: &str,
    metadata: Option<HashMap<String, Value>>,
) -> ToolOutputOffload {
    let stats = analyze_text_payload_stats(output);
    let policy = resolve_tool_io_eviction_policy();
    let Some(trigger) = resolve_result_offload_trigger(stats, policy) else {
        return ToolOutputOffload {
            output: output.to_string(),
            metadata: metadata.unwrap_or_default(),
        };
    };

    offload_tool_output_internal(
        key,
        output,
        build_aster_tool_io_payload_envelope("tool_result_text", Value::String(output.to_string())),
        stats,
        metadata,
        "tool_result_text",
        trigger,
    )
}

pub fn force_offload_plain_tool_output_for_history(
    key: &str,
    output: &str,
    metadata: Option<HashMap<String, Value>>,
) -> ToolOutputOffload {
    offload_tool_output_internal(
        key,
        output,
        build_aster_tool_io_payload_envelope("tool_result_text", Value::String(output.to_string())),
        analyze_text_payload_stats(output),
        metadata,
        "tool_result_text",
        ToolIoOffloadTrigger::HistoryContextPressure,
    )
}

fn parse_tool_arguments_value(arguments: &str) -> Value {
    let trimmed = arguments.trim();
    if trimmed.is_empty() {
        return json!({});
    }
    serde_json::from_str::<Value>(trimmed).unwrap_or_else(|_| json!({ "raw": arguments }))
}

fn estimate_message_tokens(
    message: &AgentMessage,
    policy: ToolIoEvictionPolicy,
) -> (usize, Vec<HistoryEvictionCandidate>) {
    let mut total_tokens = estimate_text_token_count(&message.content.as_text())
        + message
            .reasoning_content
            .as_deref()
            .map(estimate_text_token_count)
            .unwrap_or(0)
        + 4;
    let mut candidates = Vec::new();

    if let Some(tool_calls) = &message.tool_calls {
        for call in tool_calls {
            let arguments = parse_tool_arguments_value(&call.function.arguments);
            let stats = analyze_value_payload_stats(&arguments);
            total_tokens += stats.tokens;
            if stats.tokens > policy.token_limit_before_evict {
                candidates.push(HistoryEvictionCandidate {
                    kind: HistoryEvictionCandidateKind::Request(call.id.clone()),
                    reduction_tokens: stats
                        .tokens
                        .saturating_sub(ESTIMATED_OFFLOADED_PREVIEW_TOKENS)
                        .max(1),
                });
            }
        }
    }

    if let Some(tool_call_id) = &message.tool_call_id {
        let stats = analyze_text_payload_stats(&message.content.as_text());
        if stats.tokens > policy.token_limit_before_evict {
            candidates.push(HistoryEvictionCandidate {
                kind: HistoryEvictionCandidateKind::Response(tool_call_id.clone()),
                reduction_tokens: stats
                    .tokens
                    .saturating_sub(ESTIMATED_OFFLOADED_PREVIEW_TOKENS)
                    .max(1),
            });
        }
    }

    (total_tokens, candidates)
}

fn build_aster_history_message_analysis(
    total_tokens: usize,
    candidates: &[HistoryEvictionCandidate],
) -> AsterToolIoHistoryMessageAnalysis {
    AsterToolIoHistoryMessageAnalysis {
        total_tokens,
        candidates: candidates
            .iter()
            .map(|candidate| AsterToolIoHistoryEvictionCandidate {
                reduction_tokens: candidate.reduction_tokens,
            })
            .collect(),
    }
}

pub fn build_history_tool_io_eviction_plan(messages: &[AgentMessage]) -> HistoryToolIoEvictionPlan {
    build_history_tool_io_eviction_plan_for_model(messages, None)
}

pub fn build_history_tool_io_eviction_plan_for_model(
    messages: &[AgentMessage],
    model_name: Option<&str>,
) -> HistoryToolIoEvictionPlan {
    let policy = resolve_tool_io_eviction_policy_for_model(model_name);
    let trigger_tokens = policy.context_trigger_tokens();
    let keep_recent_messages = policy.keep_recent_messages.min(messages.len());

    let mut plan = HistoryToolIoEvictionPlan {
        trigger_tokens,
        projected_tokens: 0,
        keep_recent_messages,
        ..HistoryToolIoEvictionPlan::default()
    };

    let mut per_message_candidates = Vec::with_capacity(messages.len());
    let mut analysis = Vec::with_capacity(messages.len());
    for message in messages {
        let (tokens, candidates) = estimate_message_tokens(message, policy);
        plan.total_tokens += tokens;
        analysis.push(build_aster_history_message_analysis(tokens, &candidates));
        per_message_candidates.push(candidates);
    }
    plan.projected_tokens = plan.total_tokens;

    if plan.total_tokens <= trigger_tokens {
        return plan;
    }

    let framework_plan = build_aster_tool_io_history_eviction_plan(&analysis, policy);
    plan.projected_tokens = framework_plan.projected_tokens;

    for selection in framework_plan.selections {
        let Some(candidate) = per_message_candidates
            .get(selection.message_index)
            .and_then(|candidates| candidates.get(selection.candidate_index))
        else {
            continue;
        };

        match &candidate.kind {
            HistoryEvictionCandidateKind::Request(id) => {
                plan.request_ids.insert(id.clone());
            }
            HistoryEvictionCandidateKind::Response(id) => {
                plan.response_ids.insert(id.clone());
            }
        }
    }

    plan
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxycast_core::agent::types::{AgentMessage, FunctionCall, MessageContent, ToolCall};
    use std::ffi::OsString;
    use std::sync::{Mutex, OnceLock};

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "proxycast-tool-io-offload-{name}-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvGuard {
        values: Vec<(&'static str, Option<OsString>)>,
    }

    impl EnvGuard {
        fn set(entries: &[(&'static str, OsString)]) -> Self {
            let mut values = Vec::new();
            for (key, value) in entries {
                values.push((*key, std::env::var_os(key)));
                std::env::set_var(key, value);
            }
            Self { values }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, previous) in self.values.drain(..) {
                if let Some(value) = previous {
                    std::env::set_var(key, value);
                } else {
                    std::env::remove_var(key);
                }
            }
        }
    }

    #[test]
    fn build_compact_arguments_value_should_keep_path_and_preview() {
        let base_dir = unique_test_dir("args");
        let payload = json!({
            "kind": "tool_arguments",
            "payload": {
                "path": "docs/output.md",
                "content": "x".repeat(5000)
            }
        });
        let info = write_offload_payload(
            &base_dir,
            TOOL_ARGUMENTS_DIR,
            "tool-1",
            &payload,
            ToolIoPayloadStats {
                chars: 5000,
                bytes: 5000,
                tokens: 1400,
            },
        )
        .expect("should write offload payload");
        let compact = build_compact_arguments_value(
            &json!({
                "path": "docs/output.md",
                "content": "x".repeat(5000)
            }),
            &info,
            "preview text",
            ToolIoOffloadTrigger::TokenLimitBeforeEvict,
        );

        let record = compact.as_object().expect("should be object");
        assert_eq!(record.get("path"), Some(&json!("docs/output.md")));
        assert_eq!(record.get("preview"), Some(&json!("preview text")));
        assert!(record.contains_key(PROXYCAST_TOOL_ARGUMENTS_OFFLOAD_KEY));
    }

    #[test]
    fn maybe_offload_plain_tool_output_should_emit_metadata() {
        let _lock = env_lock().lock().expect("lock env");
        let _env = EnvGuard::set(&[(
            PROXYCAST_TOOL_TOKEN_LIMIT_BEFORE_EVICT_ENV,
            OsString::from("50"),
        )]);
        let output = "token ".repeat(500);
        let offloaded = maybe_offload_plain_tool_output("tool-plain", &output, None);

        assert!(offloaded.output.contains("[ProxyCast Offload]"));
        assert_eq!(
            offloaded.metadata.get("proxycast_offloaded"),
            Some(&json!(true))
        );
        assert!(offloaded.metadata.contains_key("offload_original_tokens"));
        let offload_file = offloaded
            .metadata
            .get("offload_file")
            .and_then(Value::as_str)
            .expect("offload file should exist");
        assert!(PathBuf::from(offload_file).exists());
    }

    #[test]
    fn build_history_tool_io_eviction_plan_should_mark_old_large_tool_calls() {
        let _lock = env_lock().lock().expect("lock env");
        let _env = EnvGuard::set(&[
            (
                PROXYCAST_TOOL_TOKEN_LIMIT_BEFORE_EVICT_ENV,
                OsString::from("50"),
            ),
            (
                PROXYCAST_CONTEXT_MAX_INPUT_TOKENS_ENV,
                OsString::from("600"),
            ),
            (
                PROXYCAST_CONTEXT_WINDOW_TRIGGER_RATIO_ENV,
                OsString::from("0.5"),
            ),
            (
                PROXYCAST_CONTEXT_KEEP_RECENT_MESSAGES_ENV,
                OsString::from("1"),
            ),
        ]);

        let messages = vec![
            AgentMessage {
                role: "assistant".to_string(),
                content: MessageContent::Text(String::new()),
                timestamp: "2026-03-11T00:00:00Z".to_string(),
                tool_calls: Some(vec![ToolCall {
                    id: "call-1".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "Write".to_string(),
                        arguments: json!({
                            "path": "docs/big.md",
                            "content": "token ".repeat(220),
                        })
                        .to_string(),
                    },
                }]),
                tool_call_id: None,
                reasoning_content: None,
            },
            AgentMessage {
                role: "user".to_string(),
                content: MessageContent::Text("token ".repeat(320)),
                timestamp: "2026-03-11T00:00:01Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
            AgentMessage {
                role: "assistant".to_string(),
                content: MessageContent::Text("最近一条消息".to_string()),
                timestamp: "2026-03-11T00:00:02Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
        ];

        let plan = build_history_tool_io_eviction_plan(&messages);
        assert!(plan.total_tokens > plan.trigger_tokens);
        assert!(plan.request_ids.contains("call-1"));
        assert!(!plan.response_ids.contains("call-1"));
    }

    #[test]
    fn resolve_tool_io_eviction_policy_should_use_aster_model_context_limit() {
        let _lock = env_lock().lock().expect("lock env");
        let policy = resolve_tool_io_eviction_policy_for_model(Some("gpt-4.1"));
        assert_eq!(policy.context_max_input_tokens, 1_000_000);

        let fallback_policy = resolve_tool_io_eviction_policy_for_model(Some("openai"));
        assert_eq!(
            fallback_policy.context_max_input_tokens,
            DEFAULT_CONTEXT_WINDOW_MAX_INPUT_TOKENS
        );
    }

    #[test]
    fn resolve_tool_io_eviction_policy_should_allow_proxycast_env_override() {
        let _lock = env_lock().lock().expect("lock env");
        let _env = EnvGuard::set(&[(
            PROXYCAST_CONTEXT_MAX_INPUT_TOKENS_ENV,
            OsString::from("4096"),
        )]);

        let policy = resolve_tool_io_eviction_policy_for_model(Some("gpt-4.1"));
        assert_eq!(policy.context_max_input_tokens, 4096);
        assert_eq!(policy.context_trigger_tokens(), 3481);
    }
}
