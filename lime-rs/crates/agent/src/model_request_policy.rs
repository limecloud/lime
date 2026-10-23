use crate::turn_context_configuration::AgentTurnContext;
use agent_protocol::truncation::TruncationPolicy;
use model_provider::provider_stream::{
    RuntimeReplyModelRequestPolicy, RuntimeReplyReasoningOutputPolicy, RuntimeReplyResponsesPolicy,
    RuntimeReplyToolCallPolicy,
};
use serde_json::Value;

mod output;
mod truncation;

const REQUEST_METADATA_KEYS: [&str; 5] = [
    "runtime_options",
    "runtimeOptions",
    "runtime_request",
    "runtimeRequest",
    "config",
];

const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT: i64 = 95;
const AUTO_COMPACT_CONTEXT_WINDOW_RATIO_NUMERATOR: i64 = 9;
const AUTO_COMPACT_CONTEXT_WINDOW_RATIO_DENOMINATOR: i64 = 10;
pub const MODEL_NATIVE_SHELL_TOOL_NAME: &str = "exec_command";
pub const MODEL_NATIVE_STDIN_TOOL_NAME: &str = "write_stdin";
pub const MODEL_NATIVE_APPLY_PATCH_TOOL_NAME: &str = "apply_patch";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModelRequestPolicySnapshot {
    pub source: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub responses_policy: Option<ModelResponsesPolicySnapshot>,
    pub tool_call_policy: Option<ModelToolCallPolicySnapshot>,
    pub input_modality_policy: Option<ModelInputModalityPolicySnapshot>,
    pub context_policy: Option<ModelContextPolicySnapshot>,
    pub reasoning_output_policy: Option<ModelReasoningOutputPolicySnapshot>,
    pub truncation_policy: Option<ModelTruncationPolicySnapshot>,
    pub native_tool_policy: Option<ModelNativeToolPolicySnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelResponsesPolicySnapshot {
    pub use_responses_lite: bool,
    pub request_mode: String,
    pub instructions_location: String,
    pub tools_location: String,
    pub reasoning_context: String,
    pub parallel_tool_calls_allowed: bool,
    pub requires_responses_lite_header: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelToolCallPolicySnapshot {
    pub supports_parallel_tool_calls: bool,
    pub parallel_tool_calls: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelInputModalityPolicySnapshot {
    pub input_modalities: Vec<String>,
    pub send_gate_modalities: Vec<String>,
    pub unknown_input_modalities: Vec<String>,
    pub supports_text_input: bool,
    pub supports_media_input: bool,
    pub supports_image_input: bool,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelContextPolicySnapshot {
    pub context_window: Option<i64>,
    pub max_context_window: Option<i64>,
    pub resolved_context_window: Option<i64>,
    pub effective_context_window_percent: i64,
    pub model_context_window: Option<i64>,
    pub auto_compact_token_limit: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelReasoningOutputPolicySnapshot {
    pub default_reasoning_summary: String,
    pub support_verbosity: bool,
    pub default_verbosity: Option<String>,
    pub can_set_verbosity: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelTruncationPolicySnapshot {
    pub mode: String,
    pub limit: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelNativeToolPolicySnapshot {
    pub shell_type: Option<String>,
    pub shell_tool_enabled: bool,
    pub preferred_shell_surface: Option<String>,
    pub apply_patch_tool_type: Option<String>,
    pub apply_patch_tool_enabled: bool,
    pub experimental_supported_tools: Vec<String>,
}

pub fn model_request_policy_from_turn_context(
    context: Option<&AgentTurnContext>,
) -> Option<ModelRequestPolicySnapshot> {
    let metadata = Value::Object(serde_json::Map::from_iter(context?.metadata.clone()));
    let mut snapshot = REQUEST_METADATA_KEYS
        .into_iter()
        .filter_map(|key| metadata.get(key))
        .filter_map(model_request_policy_value)
        .map(model_request_policy_from_value)
        .find(ModelRequestPolicySnapshot::has_policy_payload)
        .or_else(|| model_request_policy_value(&metadata).map(model_request_policy_from_value))
        .unwrap_or_default();
    snapshot.truncation_policy = truncation::resolve(&metadata);
    output::apply(&mut snapshot, &metadata);
    snapshot.has_policy_payload().then_some(snapshot)
}

pub fn model_request_policy_from_metadata(metadata: &Value) -> Option<ModelRequestPolicySnapshot> {
    let mut snapshot = model_request_policy_value(metadata)
        .map(model_request_policy_from_value)
        .unwrap_or_default();
    snapshot.truncation_policy = truncation::resolve(metadata);
    output::apply(&mut snapshot, metadata);
    snapshot.has_policy_payload().then_some(snapshot)
}

fn model_request_policy_from_value(policy: &Value) -> ModelRequestPolicySnapshot {
    ModelRequestPolicySnapshot {
        source: string_field(policy, &["source"]),
        provider_id: string_field(policy, &["provider_id", "providerId"]),
        model_id: string_field(policy, &["model_id", "modelId"]),
        responses_policy: object_field(policy, &["responses_policy", "responsesPolicy"])
            .map(responses_policy_from_value),
        tool_call_policy: object_field(policy, &["tool_call_policy", "toolCallPolicy"])
            .map(tool_call_policy_from_value),
        input_modality_policy: object_field(
            policy,
            &["input_modality_policy", "inputModalityPolicy"],
        )
        .map(input_modality_policy_from_value),
        context_policy: object_field(policy, &["context_policy", "contextPolicy"])
            .map(context_policy_from_value),
        reasoning_output_policy: object_field(
            policy,
            &["reasoning_output_policy", "reasoningOutputPolicy"],
        )
        .map(reasoning_output_policy_from_value),
        truncation_policy: object_field(policy, &["truncation_policy", "truncationPolicy"])
            .map(truncation_policy_from_value),
        native_tool_policy: object_field(policy, &["native_tool_policy", "nativeToolPolicy"])
            .map(native_tool_policy_from_value),
    }
}

pub fn runtime_reply_model_request_policy_from_turn_context(
    context: Option<&AgentTurnContext>,
) -> Option<RuntimeReplyModelRequestPolicy> {
    model_request_policy_from_turn_context(context)
        .and_then(|policy| runtime_reply_model_request_policy_from_snapshot(&policy))
}

pub fn runtime_reply_model_request_policy_from_metadata(
    metadata: &Value,
) -> Option<RuntimeReplyModelRequestPolicy> {
    model_request_policy_from_metadata(metadata)
        .and_then(|policy| runtime_reply_model_request_policy_from_snapshot(&policy))
}

pub fn native_tool_policy_from_metadata(metadata: &Value) -> Option<ModelNativeToolPolicySnapshot> {
    model_request_policy_from_metadata(metadata).and_then(|policy| policy.native_tool_policy)
}

pub fn native_tool_policy_from_turn_context(
    context: Option<&AgentTurnContext>,
) -> Option<ModelNativeToolPolicySnapshot> {
    model_request_policy_from_turn_context(context).and_then(|policy| policy.native_tool_policy)
}

pub fn input_modality_policy_from_turn_context(
    context: Option<&AgentTurnContext>,
) -> Option<ModelInputModalityPolicySnapshot> {
    model_request_policy_from_turn_context(context).and_then(|policy| policy.input_modality_policy)
}

pub fn input_modality_policy_allows_image_input(
    policy: Option<&ModelInputModalityPolicySnapshot>,
) -> bool {
    policy
        .map(|policy| policy.supports_image_input)
        .unwrap_or(true)
}

pub fn native_tool_policy_disallowed_tool_names(
    policy: Option<&ModelNativeToolPolicySnapshot>,
) -> Vec<&'static str> {
    let Some(policy) = policy else {
        return Vec::new();
    };

    let mut names = Vec::new();
    if !policy.shell_tool_enabled {
        names.push(MODEL_NATIVE_SHELL_TOOL_NAME);
        names.push(MODEL_NATIVE_STDIN_TOOL_NAME);
    }
    let apply_patch_available = policy.apply_patch_tool_enabled
        && policy.apply_patch_tool_type.as_deref() == Some("freeform");
    if !apply_patch_available {
        names.push(MODEL_NATIVE_APPLY_PATCH_TOOL_NAME);
    }
    names
}

impl ModelRequestPolicySnapshot {
    fn has_policy_payload(&self) -> bool {
        self.responses_policy.is_some()
            || self.tool_call_policy.is_some()
            || self.input_modality_policy.is_some()
            || self.context_policy.is_some()
            || self.reasoning_output_policy.is_some()
            || self.truncation_policy.is_some()
            || self.native_tool_policy.is_some()
    }
}

pub fn runtime_reply_model_request_policy_from_snapshot(
    snapshot: &ModelRequestPolicySnapshot,
) -> Option<RuntimeReplyModelRequestPolicy> {
    let responses = snapshot
        .responses_policy
        .as_ref()
        .map(runtime_reply_responses_policy);
    let tool_call = snapshot
        .tool_call_policy
        .as_ref()
        .map(|policy| runtime_reply_tool_call_policy(policy, responses.as_ref()));
    let reasoning_output = snapshot
        .reasoning_output_policy
        .as_ref()
        .map(runtime_reply_reasoning_output_policy);

    let truncation = snapshot.truncation_policy.as_ref().and_then(|policy| {
        let limit = usize::try_from(policy.limit).unwrap_or(usize::MAX);
        match policy.mode.as_str() {
            "tokens" => Some(TruncationPolicy::Tokens(limit)),
            "bytes" => Some(TruncationPolicy::Bytes(limit)),
            _ => None,
        }
    });
    RuntimeReplyModelRequestPolicy::new(responses, tool_call, reasoning_output, truncation)
}

fn runtime_reply_responses_policy(
    policy: &ModelResponsesPolicySnapshot,
) -> RuntimeReplyResponsesPolicy {
    RuntimeReplyResponsesPolicy {
        use_responses_lite: policy.use_responses_lite,
        request_mode: policy.request_mode.clone(),
        instructions_location: policy.instructions_location.clone(),
        tools_location: policy.tools_location.clone(),
        reasoning_context: policy.reasoning_context.clone(),
        parallel_tool_calls_allowed: policy.parallel_tool_calls_allowed,
        requires_responses_lite_header: policy.requires_responses_lite_header,
    }
}

fn runtime_reply_tool_call_policy(
    policy: &ModelToolCallPolicySnapshot,
    responses: Option<&RuntimeReplyResponsesPolicy>,
) -> RuntimeReplyToolCallPolicy {
    let responses_allows_parallel = responses
        .map(|policy| policy.parallel_tool_calls_allowed && !policy.use_responses_lite)
        .unwrap_or(true);

    RuntimeReplyToolCallPolicy {
        supports_parallel_tool_calls: policy.supports_parallel_tool_calls,
        parallel_tool_calls: policy.parallel_tool_calls && responses_allows_parallel,
    }
}

fn runtime_reply_reasoning_output_policy(
    policy: &ModelReasoningOutputPolicySnapshot,
) -> RuntimeReplyReasoningOutputPolicy {
    RuntimeReplyReasoningOutputPolicy {
        default_reasoning_summary: policy.default_reasoning_summary.clone(),
        support_verbosity: policy.support_verbosity,
        default_verbosity: policy.default_verbosity.clone(),
        can_set_verbosity: policy.can_set_verbosity,
    }
}

fn model_request_policy_value(value: &Value) -> Option<&Value> {
    direct_model_request_policy_value(value)
        .or_else(|| nested_metadata_value(value).and_then(model_request_policy_value))
        .or_else(|| {
            REQUEST_METADATA_KEYS
                .into_iter()
                .filter_map(|key| value.get(key))
                .find_map(model_request_policy_value)
        })
        .or_else(|| looks_like_policy_value(value).then_some(value))
}

fn direct_model_request_policy_value(value: &Value) -> Option<&Value> {
    value
        .pointer("/harness/model_request_policy")
        .or_else(|| value.pointer("/harness/modelRequestPolicy"))
        .or_else(|| value.get("model_request_policy"))
        .or_else(|| value.get("modelRequestPolicy"))
}

fn nested_metadata_value(value: &Value) -> Option<&Value> {
    value
        .get("metadata")
        .or_else(|| value.get("request_metadata"))
        .or_else(|| value.get("requestMetadata"))
}

fn looks_like_policy_value(value: &Value) -> bool {
    value.as_object().is_some_and(|object| {
        [
            "responses_policy",
            "responsesPolicy",
            "tool_call_policy",
            "toolCallPolicy",
            "input_modality_policy",
            "inputModalityPolicy",
            "context_policy",
            "contextPolicy",
            "reasoning_output_policy",
            "reasoningOutputPolicy",
            "truncation_policy",
            "truncationPolicy",
            "native_tool_policy",
            "nativeToolPolicy",
        ]
        .iter()
        .any(|key| object.contains_key(*key))
    })
}

fn responses_policy_from_value(value: &Value) -> ModelResponsesPolicySnapshot {
    let use_responses_lite =
        bool_field(value, &["use_responses_lite", "useResponsesLite"]).unwrap_or(false);
    ModelResponsesPolicySnapshot {
        use_responses_lite,
        request_mode: enum_field(
            value,
            &["request_mode", "requestMode"],
            &["responses", "responses_lite"],
        )
        .unwrap_or_else(|| {
            if use_responses_lite {
                "responses_lite".to_string()
            } else {
                "responses".to_string()
            }
        }),
        instructions_location: enum_field(
            value,
            &["instructions_location", "instructionsLocation"],
            &["request_field", "input_prefix"],
        )
        .unwrap_or_else(|| {
            if use_responses_lite {
                "input_prefix".to_string()
            } else {
                "request_field".to_string()
            }
        }),
        tools_location: enum_field(
            value,
            &["tools_location", "toolsLocation"],
            &["request_field", "input_prefix"],
        )
        .unwrap_or_else(|| {
            if use_responses_lite {
                "input_prefix".to_string()
            } else {
                "request_field".to_string()
            }
        }),
        reasoning_context: enum_field(
            value,
            &["reasoning_context", "reasoningContext"],
            &["default", "all_turns"],
        )
        .unwrap_or_else(|| {
            if use_responses_lite {
                "all_turns".to_string()
            } else {
                "default".to_string()
            }
        }),
        parallel_tool_calls_allowed: bool_field(
            value,
            &["parallel_tool_calls_allowed", "parallelToolCallsAllowed"],
        )
        .unwrap_or(!use_responses_lite),
        requires_responses_lite_header: bool_field(
            value,
            &[
                "requires_responses_lite_header",
                "requiresResponsesLiteHeader",
            ],
        )
        .unwrap_or(use_responses_lite),
    }
}

fn tool_call_policy_from_value(value: &Value) -> ModelToolCallPolicySnapshot {
    let supports_parallel_tool_calls = bool_field(
        value,
        &["supports_parallel_tool_calls", "supportsParallelToolCalls"],
    )
    .unwrap_or(false);
    ModelToolCallPolicySnapshot {
        supports_parallel_tool_calls,
        parallel_tool_calls: bool_field(value, &["parallel_tool_calls", "parallelToolCalls"])
            .unwrap_or(supports_parallel_tool_calls),
    }
}

fn input_modality_policy_from_value(value: &Value) -> ModelInputModalityPolicySnapshot {
    let input_modalities =
        string_array_field_preserve_order(value, &["input_modalities", "inputModalities"]);
    let send_gate_modalities =
        string_array_field_preserve_order(value, &["send_gate_modalities", "sendGateModalities"]);
    let unknown_input_modalities = string_array_field_preserve_order(
        value,
        &["unknown_input_modalities", "unknownInputModalities"],
    );
    let supports_image_input = bool_field(value, &["supports_image_input", "supportsImageInput"])
        .unwrap_or_else(|| input_modalities.iter().any(|modality| modality == "image"));
    let supports_text_input = bool_field(value, &["supports_text_input", "supportsTextInput"])
        .unwrap_or_else(|| input_modalities.iter().any(|modality| modality == "text"));
    let supports_media_input = bool_field(value, &["supports_media_input", "supportsMediaInput"])
        .unwrap_or_else(|| {
            input_modalities.iter().any(|modality| {
                matches!(
                    modality.as_str(),
                    "image" | "audio" | "video" | "file" | "pdf"
                )
            })
        });

    ModelInputModalityPolicySnapshot {
        input_modalities,
        send_gate_modalities,
        unknown_input_modalities,
        supports_text_input,
        supports_media_input,
        supports_image_input,
        source: enum_field(value, &["source"], &["codex_default", "explicit"])
            .unwrap_or_else(|| "explicit".to_string()),
    }
}

fn context_policy_from_value(value: &Value) -> ModelContextPolicySnapshot {
    let context_window = positive_i64_field(value, &["context_window", "contextWindow"]);
    let max_context_window = positive_i64_field(value, &["max_context_window", "maxContextWindow"]);
    let configured_auto_compact_token_limit = positive_i64_field(
        value,
        &["auto_compact_token_limit", "autoCompactTokenLimit"],
    );
    let effective_context_window_percent = effective_context_window_percent(value);
    let resolved_context_window = context_window.or(max_context_window);
    let model_context_window =
        model_context_window(resolved_context_window, effective_context_window_percent);
    let auto_compact_token_limit =
        auto_compact_token_limit(resolved_context_window, configured_auto_compact_token_limit);

    ModelContextPolicySnapshot {
        context_window,
        max_context_window,
        resolved_context_window,
        effective_context_window_percent,
        model_context_window,
        auto_compact_token_limit,
    }
}

fn model_context_window(
    resolved_context_window: Option<i64>,
    effective_context_window_percent: i64,
) -> Option<i64> {
    resolved_context_window
        .map(|context_window| context_window.saturating_mul(effective_context_window_percent) / 100)
}

fn auto_compact_token_limit(
    resolved_context_window: Option<i64>,
    configured_limit: Option<i64>,
) -> Option<i64> {
    let Some(resolved_context_window) = resolved_context_window else {
        return configured_limit;
    };
    let context_limit = resolved_context_window
        .saturating_mul(AUTO_COMPACT_CONTEXT_WINDOW_RATIO_NUMERATOR)
        / AUTO_COMPACT_CONTEXT_WINDOW_RATIO_DENOMINATOR;
    Some(configured_limit.map_or(context_limit, |limit| limit.min(context_limit)))
}

fn effective_context_window_percent(value: &Value) -> i64 {
    positive_i64_field(
        value,
        &[
            "effective_context_window_percent",
            "effectiveContextWindowPercent",
        ],
    )
    .filter(|percent| *percent <= 100)
    .unwrap_or(DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT)
}

fn reasoning_output_policy_from_value(value: &Value) -> ModelReasoningOutputPolicySnapshot {
    let support_verbosity =
        bool_field(value, &["support_verbosity", "supportVerbosity"]).unwrap_or(false);
    let default_verbosity = support_verbosity
        .then(|| {
            enum_field(
                value,
                &["default_verbosity", "defaultVerbosity"],
                &["low", "medium", "high"],
            )
        })
        .flatten();

    ModelReasoningOutputPolicySnapshot {
        default_reasoning_summary: enum_field(
            value,
            &["default_reasoning_summary", "defaultReasoningSummary"],
            &["auto", "concise", "detailed", "none"],
        )
        .unwrap_or_else(|| "auto".to_string()),
        support_verbosity,
        default_verbosity,
        can_set_verbosity: support_verbosity,
    }
}

fn truncation_policy_from_value(value: &Value) -> ModelTruncationPolicySnapshot {
    let inner = object_field(value, &["truncation_policy", "truncationPolicy"]).unwrap_or(value);
    let mode = enum_field(inner, &["mode"], &["bytes", "tokens"]);
    let limit = mode
        .as_ref()
        .and_then(|_| inner.get("limit"))
        .and_then(Value::as_u64)
        .unwrap_or_else(|| TruncationPolicy::default().byte_budget() as u64);
    ModelTruncationPolicySnapshot {
        mode: mode.unwrap_or_else(|| "bytes".into()),
        limit,
    }
}

fn native_tool_policy_from_value(value: &Value) -> ModelNativeToolPolicySnapshot {
    let shell_type = enum_field(
        value,
        &["shell_type", "shellType"],
        &[
            "default",
            "local",
            "unified_exec",
            "disabled",
            "shell_command",
        ],
    )
    .map(|shell_type| match shell_type.as_str() {
        "default" | "local" | "shell_command" => "unified_exec".to_string(),
        _ => shell_type,
    });
    let preferred_shell_surface = shell_type
        .as_deref()
        .filter(|shell_type| *shell_type == "unified_exec")
        .map(str::to_string);
    let apply_patch_tool_type = enum_field(
        value,
        &["apply_patch_tool_type", "applyPatchToolType"],
        &["freeform"],
    );
    ModelNativeToolPolicySnapshot {
        shell_type,
        shell_tool_enabled: preferred_shell_surface.is_some()
            && bool_field(value, &["shell_tool_enabled", "shellToolEnabled"]).unwrap_or(true),
        preferred_shell_surface,
        apply_patch_tool_enabled: bool_field(
            value,
            &["apply_patch_tool_enabled", "applyPatchToolEnabled"],
        )
        .unwrap_or(apply_patch_tool_type.is_some()),
        apply_patch_tool_type,
        experimental_supported_tools: string_array_field(
            value,
            &["experimental_supported_tools", "experimentalSupportedTools"],
        ),
    }
}

fn object_field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .filter_map(|key| value.get(*key))
        .find(|candidate| candidate.is_object())
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| value.get(*key))
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn bool_field(value: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .filter_map(|key| value.get(*key))
        .find_map(Value::as_bool)
}

fn positive_i64_field(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .filter_map(|key| value.get(*key))
        .filter_map(Value::as_i64)
        .find(|limit| *limit > 0)
}

fn enum_field(value: &Value, keys: &[&str], allowed: &[&str]) -> Option<String> {
    string_field(value, keys).and_then(|text| {
        let normalized = normalize_token(&text);
        allowed.contains(&normalized.as_str()).then_some(normalized)
    })
}

fn string_array_field(value: &Value, keys: &[&str]) -> Vec<String> {
    let Some(values) = keys
        .iter()
        .filter_map(|key| value.get(*key))
        .find_map(Value::as_array)
    else {
        return Vec::new();
    };
    let mut tokens = values
        .iter()
        .filter_map(Value::as_str)
        .map(normalize_token)
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    tokens.sort();
    tokens.dedup();
    tokens
}

fn string_array_field_preserve_order(value: &Value, keys: &[&str]) -> Vec<String> {
    let Some(values) = keys
        .iter()
        .filter_map(|key| value.get(*key))
        .find_map(Value::as_array)
    else {
        return Vec::new();
    };
    let mut tokens = Vec::new();
    for token in values
        .iter()
        .filter_map(Value::as_str)
        .map(normalize_token)
        .filter(|token| !token.is_empty())
    {
        if !tokens.contains(&token) {
            tokens.push(token);
        }
    }
    tokens
}

fn normalize_token(value: &str) -> String {
    value.trim().replace('-', "_").to_lowercase()
}

#[cfg(test)]
mod tests;
