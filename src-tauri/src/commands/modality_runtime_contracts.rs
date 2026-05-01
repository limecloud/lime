use lime_core::models::model_registry::{EnhancedModelMetadata, ModelModality, ModelTaskFamily};
use serde_json::{json, Map, Value};

pub(crate) const IMAGE_GENERATION_CONTRACT_KEY: &str = "image_generation";
pub(crate) const IMAGE_GENERATION_MODALITY: &str = "image";
pub(crate) const IMAGE_GENERATION_ROUTING_SLOT: &str = "image_generation_model";
pub(crate) const IMAGE_GENERATION_EXECUTOR_BINDING_KEY: &str = "image_generate";
pub(crate) const IMAGE_GENERATION_EXECUTION_PROFILE_KEY: &str = "image_generation_profile";
pub(crate) const IMAGE_GENERATION_EXECUTOR_ADAPTER_KEY: &str = "skill:image_generate";
pub(crate) const IMAGE_GENERATION_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "image_generation", "vision_input"];
pub(crate) const IMAGE_GENERATION_LIMECORE_POLICY_REFS: &[&str] =
    &["model_catalog", "provider_offer", "tenant_feature_flags"];
pub(crate) const BROWSER_CONTROL_CONTRACT_KEY: &str = "browser_control";
pub(crate) const BROWSER_CONTROL_MODALITY: &str = "browser";
pub(crate) const BROWSER_CONTROL_ROUTING_SLOT: &str = "browser_reasoning_model";
pub(crate) const BROWSER_CONTROL_EXECUTOR_BINDING_KEY: &str = "browser_assist";
pub(crate) const BROWSER_CONTROL_EXECUTION_PROFILE_KEY: &str = "browser_control_profile";
pub(crate) const BROWSER_CONTROL_EXECUTOR_ADAPTER_KEY: &str = "browser:browser_assist";
pub(crate) const BROWSER_CONTROL_REQUIRED_CAPABILITIES: &[&str] = &[
    "text_generation",
    "browser_reasoning",
    "browser_control_planning",
];
pub(crate) const BROWSER_CONTROL_LIMECORE_POLICY_REFS: &[&str] =
    &["tenant_feature_flags", "gateway_policy"];
pub(crate) const PDF_EXTRACT_CONTRACT_KEY: &str = "pdf_extract";
pub(crate) const PDF_EXTRACT_MODALITY: &str = "document";
pub(crate) const PDF_EXTRACT_ROUTING_SLOT: &str = "base_model";
pub(crate) const PDF_EXTRACT_EXECUTOR_BINDING_KEY: &str = "pdf_read";
pub(crate) const PDF_EXTRACT_EXECUTION_PROFILE_KEY: &str = "pdf_extract_profile";
pub(crate) const PDF_EXTRACT_EXECUTOR_ADAPTER_KEY: &str = "skill:pdf_read";
pub(crate) const PDF_EXTRACT_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "local_file_read", "long_context"];
pub(crate) const PDF_EXTRACT_LIMECORE_POLICY_REFS: &[&str] = &["tenant_feature_flags"];
pub(crate) const VOICE_GENERATION_CONTRACT_KEY: &str = "voice_generation";
pub(crate) const VOICE_GENERATION_MODALITY: &str = "audio";
pub(crate) const VOICE_GENERATION_ROUTING_SLOT: &str = "voice_generation_model";
pub(crate) const VOICE_GENERATION_EXECUTOR_BINDING_KEY: &str = "voice_runtime";
pub(crate) const VOICE_GENERATION_EXECUTION_PROFILE_KEY: &str = "voice_generation_profile";
pub(crate) const VOICE_GENERATION_EXECUTOR_ADAPTER_KEY: &str = "service_skill:voice_runtime";
pub(crate) const VOICE_GENERATION_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "voice_generation"];
pub(crate) const VOICE_GENERATION_LIMECORE_POLICY_REFS: &[&str] =
    &["client_scenes", "tenant_feature_flags", "provider_offer"];
pub(crate) const AUDIO_TRANSCRIPTION_CONTRACT_KEY: &str = "audio_transcription";
pub(crate) const AUDIO_TRANSCRIPTION_MODALITY: &str = "audio";
pub(crate) const AUDIO_TRANSCRIPTION_ROUTING_SLOT: &str = "audio_transcription_model";
pub(crate) const AUDIO_TRANSCRIPTION_EXECUTOR_BINDING_KEY: &str = "transcription_generate";
pub(crate) const AUDIO_TRANSCRIPTION_EXECUTION_PROFILE_KEY: &str = "audio_transcription_profile";
pub(crate) const AUDIO_TRANSCRIPTION_EXECUTOR_ADAPTER_KEY: &str = "skill:transcription_generate";
pub(crate) const AUDIO_TRANSCRIPTION_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "audio_transcription"];
pub(crate) const AUDIO_TRANSCRIPTION_LIMECORE_POLICY_REFS: &[&str] =
    &["model_catalog", "provider_offer", "tenant_feature_flags"];
pub(crate) const WEB_RESEARCH_CONTRACT_KEY: &str = "web_research";
pub(crate) const WEB_RESEARCH_MODALITY: &str = "mixed";
pub(crate) const WEB_RESEARCH_ROUTING_SLOT: &str = "report_generation_model";
pub(crate) const WEB_RESEARCH_EXECUTOR_BINDING_KEY: &str = "research";
pub(crate) const WEB_RESEARCH_EXECUTION_PROFILE_KEY: &str = "web_research_profile";
pub(crate) const WEB_RESEARCH_EXECUTOR_ADAPTER_KEY: &str = "skill:research";
pub(crate) const WEB_RESEARCH_REQUIRED_CAPABILITIES: &[&str] = &[
    "text_generation",
    "web_search",
    "structured_document_generation",
    "long_context",
];
pub(crate) const WEB_RESEARCH_LIMECORE_POLICY_REFS: &[&str] =
    &["gateway_policy", "tenant_feature_flags", "model_catalog"];
pub(crate) const TEXT_TRANSFORM_CONTRACT_KEY: &str = "text_transform";
pub(crate) const TEXT_TRANSFORM_MODALITY: &str = "document";
pub(crate) const TEXT_TRANSFORM_ROUTING_SLOT: &str = "base_model";
pub(crate) const TEXT_TRANSFORM_EXECUTOR_BINDING_KEY: &str = "text_transform";
pub(crate) const TEXT_TRANSFORM_EXECUTION_PROFILE_KEY: &str = "text_transform_profile";
pub(crate) const TEXT_TRANSFORM_EXECUTOR_ADAPTER_KEY: &str = "skill:text_transform";
pub(crate) const TEXT_TRANSFORM_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "local_file_read", "long_context"];
pub(crate) const TEXT_TRANSFORM_LIMECORE_POLICY_REFS: &[&str] =
    &["tenant_feature_flags", "model_catalog"];
pub(crate) const LIMECORE_POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED: &str =
    "local_defaults_evaluated";
pub(crate) const LIMECORE_POLICY_SNAPSHOT_STATUS_POLICY_INPUTS_EVALUATED: &str =
    "policy_inputs_evaluated";
pub(crate) const LIMECORE_POLICY_DECISION_ALLOW: &str = "allow";
pub(crate) const LIMECORE_POLICY_DECISION_ASK: &str = "ask";
pub(crate) const LIMECORE_POLICY_DECISION_DENY: &str = "deny";
pub(crate) const LIMECORE_POLICY_DECISION_SOURCE_LOCAL_DEFAULT: &str = "local_default_policy";
pub(crate) const LIMECORE_POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR: &str =
    "policy_input_evaluator";
pub(crate) const LIMECORE_POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY: &str = "local_defaults_only";
pub(crate) const LIMECORE_POLICY_DECISION_SCOPE_RESOLVED_POLICY_INPUTS: &str =
    "resolved_policy_inputs";
pub(crate) const LIMECORE_POLICY_DECISION_REASON_NO_LOCAL_DENY: &str =
    "declared_policy_refs_with_no_local_deny_rule";
pub(crate) const LIMECORE_POLICY_DECISION_REASON_POLICY_INPUTS_MISSING: &str =
    "declared_policy_refs_missing_inputs";
pub(crate) const LIMECORE_POLICY_DECISION_REASON_ALL_INPUTS_RESOLVED: &str =
    "resolved_policy_inputs_with_no_deny_or_ask_signal";
pub(crate) const LIMECORE_POLICY_DECISION_REASON_ASK_SIGNAL: &str =
    "resolved_policy_inputs_require_user_action";
pub(crate) const LIMECORE_POLICY_DECISION_REASON_DENY_SIGNAL: &str =
    "resolved_policy_inputs_contain_deny_signal";
pub(crate) const LIMECORE_POLICY_INPUT_STATUS_DECLARED_ONLY: &str = "declared_only";
pub(crate) const LIMECORE_POLICY_INPUT_STATUS_RESOLVED: &str = "resolved";
pub(crate) const LIMECORE_POLICY_INPUT_VALUE_SOURCE_LIMECORE_PENDING: &str = "limecore_pending";
pub(crate) const LIMECORE_POLICY_VALUE_HIT_STATUS_RESOLVED: &str = "resolved";
const IMAGE_GENERATION_MODEL_KEYWORDS: &[&str] = &[
    "gpt-image",
    "gpt-images",
    "imagen",
    "dall-e",
    "dalle",
    "stable diffusion",
    "stable-diffusion",
    "sdxl",
    "sd3",
    "midjourney",
    "image generation",
    "image-generation",
    "image-gen",
    "image-preview",
    "flux",
    "nano-banana",
    "recraft",
    "ideogram",
    "seedream",
    "cogview",
];
const TEXT_MODEL_KEYWORDS: &[&str] = &[
    "gpt-5",
    "gpt-4",
    "claude",
    "sonnet",
    "haiku",
    "opus",
    "gemini",
    "deepseek",
    "reasoner",
    "qwen",
    "llama",
    "mistral",
    "kimi",
    "doubao",
    "codex",
    "chat",
    "embedding",
    "rerank",
];
const LIMECORE_POLICY_REF_MODEL_CATALOG: &str = "model_catalog";
const LIMECORE_POLICY_VALUE_SOURCE_LOCAL_MODEL_CATALOG: &str = "local_model_catalog";
const LIMECORE_POLICY_REF_PROVIDER_OFFER: &str = "provider_offer";
const LIMECORE_POLICY_VALUE_SOURCE_LOCAL_PROVIDER_OFFER: &str = "local_provider_offer";
const LIMECORE_POLICY_REF_GATEWAY_POLICY: &str = "gateway_policy";
const LIMECORE_POLICY_VALUE_SOURCE_REQUEST_OEM_ROUTING: &str = "request_oem_routing";
const LIMECORE_POLICY_REF_TENANT_FEATURE_FLAGS: &str = "tenant_feature_flags";
const LIMECORE_POLICY_VALUE_SOURCE_OEM_CLOUD_BOOTSTRAP_FEATURES: &str =
    "oem_cloud_bootstrap_features";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImageGenerationModelCapabilityAssessment {
    pub model_id: String,
    pub provider_id: Option<String>,
    pub source: &'static str,
    pub supports_image_generation: bool,
    pub reason: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RequestOemRoutingPolicyContext {
    tenant_id: String,
    provider_source: Option<String>,
    provider_key: Option<String>,
    default_model: Option<String>,
    config_mode: Option<String>,
    offer_state: Option<String>,
    quota_status: Option<String>,
    fallback_to_local_allowed: Option<bool>,
    can_invoke: Option<bool>,
}

#[derive(Debug, Clone, PartialEq)]
struct RequestTenantFeatureFlagsPolicyContext {
    tenant_id: String,
    source: String,
    flags: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LimeCorePolicyDecisionEvaluation {
    status: &'static str,
    decision: &'static str,
    decision_source: &'static str,
    decision_scope: &'static str,
    decision_reason: &'static str,
    blocking_refs: Vec<String>,
    ask_refs: Vec<String>,
    pending_refs: Vec<String>,
}

fn normalize_optional_contract_string(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_expected_contract_string(
    value: Option<String>,
    expected: &str,
    field_name: &str,
) -> Result<String, String> {
    match normalize_optional_contract_string(value) {
        Some(value) if value == expected => Ok(expected.to_string()),
        Some(value) => Err(format!(
            "图片生成任务 {field_name} 必须是 {expected}，收到 {value}"
        )),
        None => Ok(expected.to_string()),
    }
}

pub(crate) fn image_generation_required_capabilities() -> Vec<String> {
    IMAGE_GENERATION_REQUIRED_CAPABILITIES
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub(crate) fn browser_control_required_capabilities() -> Vec<String> {
    BROWSER_CONTROL_REQUIRED_CAPABILITIES
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub(crate) fn pdf_extract_required_capabilities() -> Vec<String> {
    PDF_EXTRACT_REQUIRED_CAPABILITIES
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub(crate) fn voice_generation_required_capabilities() -> Vec<String> {
    VOICE_GENERATION_REQUIRED_CAPABILITIES
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub(crate) fn audio_transcription_required_capabilities() -> Vec<String> {
    AUDIO_TRANSCRIPTION_REQUIRED_CAPABILITIES
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub(crate) fn web_research_required_capabilities() -> Vec<String> {
    WEB_RESEARCH_REQUIRED_CAPABILITIES
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub(crate) fn text_transform_required_capabilities() -> Vec<String> {
    TEXT_TRANSFORM_REQUIRED_CAPABILITIES
        .iter()
        .map(|value| (*value).to_string())
        .collect()
}

pub(crate) fn normalize_image_generation_contract_key(
    value: Option<String>,
) -> Result<String, String> {
    normalize_expected_contract_string(
        value,
        IMAGE_GENERATION_CONTRACT_KEY,
        "modality_contract_key",
    )
}

pub(crate) fn normalize_image_generation_modality(value: Option<String>) -> Result<String, String> {
    normalize_expected_contract_string(value, IMAGE_GENERATION_MODALITY, "modality")
}

pub(crate) fn normalize_image_generation_routing_slot(
    value: Option<String>,
) -> Result<String, String> {
    normalize_expected_contract_string(value, IMAGE_GENERATION_ROUTING_SLOT, "routing_slot")
}

pub(crate) fn normalize_image_generation_required_capabilities(
    values: Vec<String>,
) -> Result<Vec<String>, String> {
    let expected = image_generation_required_capabilities();
    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        if !expected.iter().any(|item| item == normalized) {
            return Err(format!(
                "图片生成任务 required_capabilities 包含不属于 image_generation contract 的能力: {normalized}"
            ));
        }
    }
    Ok(expected)
}

fn normalize_expected_voice_generation_contract_string(
    value: Option<String>,
    expected: &str,
    field_name: &str,
) -> Result<String, String> {
    match normalize_optional_contract_string(value) {
        Some(value) if value == expected => Ok(expected.to_string()),
        Some(value) => Err(format!(
            "配音任务 {field_name} 必须是 {expected}，收到 {value}"
        )),
        None => Ok(expected.to_string()),
    }
}

pub(crate) fn normalize_voice_generation_contract_key(
    value: Option<String>,
) -> Result<String, String> {
    normalize_expected_voice_generation_contract_string(
        value,
        VOICE_GENERATION_CONTRACT_KEY,
        "modality_contract_key",
    )
}

pub(crate) fn normalize_voice_generation_modality(value: Option<String>) -> Result<String, String> {
    normalize_expected_voice_generation_contract_string(
        value,
        VOICE_GENERATION_MODALITY,
        "modality",
    )
}

pub(crate) fn normalize_voice_generation_routing_slot(
    value: Option<String>,
) -> Result<String, String> {
    normalize_expected_voice_generation_contract_string(
        value,
        VOICE_GENERATION_ROUTING_SLOT,
        "routing_slot",
    )
}

pub(crate) fn normalize_voice_generation_required_capabilities(
    values: Vec<String>,
) -> Result<Vec<String>, String> {
    let expected = voice_generation_required_capabilities();
    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        if !expected.iter().any(|item| item == normalized) {
            return Err(format!(
                "配音任务 required_capabilities 包含不属于 voice_generation contract 的能力: {normalized}"
            ));
        }
    }
    Ok(expected)
}

fn normalize_expected_audio_transcription_contract_string(
    value: Option<String>,
    expected: &str,
    field_name: &str,
) -> Result<String, String> {
    match normalize_optional_contract_string(value) {
        Some(value) if value == expected => Ok(expected.to_string()),
        Some(value) => Err(format!(
            "转写任务 {field_name} 必须是 {expected}，收到 {value}"
        )),
        None => Ok(expected.to_string()),
    }
}

pub(crate) fn normalize_audio_transcription_contract_key(
    value: Option<String>,
) -> Result<String, String> {
    normalize_expected_audio_transcription_contract_string(
        value,
        AUDIO_TRANSCRIPTION_CONTRACT_KEY,
        "modality_contract_key",
    )
}

pub(crate) fn normalize_audio_transcription_modality(
    value: Option<String>,
) -> Result<String, String> {
    normalize_expected_audio_transcription_contract_string(
        value,
        AUDIO_TRANSCRIPTION_MODALITY,
        "modality",
    )
}

pub(crate) fn normalize_audio_transcription_routing_slot(
    value: Option<String>,
) -> Result<String, String> {
    normalize_expected_audio_transcription_contract_string(
        value,
        AUDIO_TRANSCRIPTION_ROUTING_SLOT,
        "routing_slot",
    )
}

pub(crate) fn normalize_audio_transcription_required_capabilities(
    values: Vec<String>,
) -> Result<Vec<String>, String> {
    let expected = audio_transcription_required_capabilities();
    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        if !expected.iter().any(|item| item == normalized) {
            return Err(format!(
                "转写任务 required_capabilities 包含不属于 audio_transcription contract 的能力: {normalized}"
            ));
        }
    }
    Ok(expected)
}

fn normalize_policy_hit_ref(value: &Value) -> Option<String> {
    value
        .get("ref_key")
        .or_else(|| value.get("refKey"))
        .or_else(|| value.get("ref"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_policy_hit_status(value: &Value) -> Option<String> {
    value
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_policy_hit_value_source(value: &Value) -> Option<String> {
    value
        .get("value_source")
        .or_else(|| value.get("valueSource"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn policy_hit_value_object(hit: &Value) -> Option<&Map<String, Value>> {
    hit.get("value").and_then(Value::as_object)
}

fn read_policy_hit_value_bool(hit: &Value, keys: &[&str]) -> Option<bool> {
    let value = policy_hit_value_object(hit)?;
    keys.iter()
        .filter_map(|key| value.get(*key))
        .find_map(Value::as_bool)
}

fn read_policy_hit_value_text(hit: &Value, keys: &[&str]) -> Option<String> {
    let value = policy_hit_value_object(hit)?;
    read_contract_text(value, keys)
}

fn read_policy_hit_feature_flag(hit: &Value, key: &str) -> Option<bool> {
    policy_hit_value_object(hit)?
        .get("flags")
        .and_then(Value::as_object)
        .and_then(|flags| flags.get(key))
        .and_then(Value::as_bool)
}

fn push_unique_policy_ref(refs: &mut Vec<String>, ref_key: &str) {
    if !refs.iter().any(|item| item == ref_key) {
        refs.push(ref_key.to_string());
    }
}

fn policy_refs_contain(policy_refs: &[String], ref_key: &str) -> bool {
    policy_refs.iter().any(|item| item == ref_key)
}

fn collect_policy_hit_deny_refs(policy_refs: &[String], hit: &Value) -> Vec<String> {
    let mut deny_refs = Vec::new();
    match normalize_policy_hit_ref(hit).as_deref() {
        Some(LIMECORE_POLICY_REF_MODEL_CATALOG) => {
            if matches!(
                read_policy_hit_value_bool(
                    hit,
                    &["supports_image_generation", "supportsImageGeneration"]
                ),
                Some(false)
            ) {
                push_unique_policy_ref(&mut deny_refs, LIMECORE_POLICY_REF_MODEL_CATALOG);
            }
        }
        Some(LIMECORE_POLICY_REF_PROVIDER_OFFER) => {
            if read_policy_hit_value_text(hit, &["credential_state", "credentialState"])
                .as_deref()
                .is_some_and(|state| state != "configured")
            {
                push_unique_policy_ref(&mut deny_refs, LIMECORE_POLICY_REF_PROVIDER_OFFER);
            }
        }
        Some(LIMECORE_POLICY_REF_GATEWAY_POLICY) => {
            if matches!(
                read_policy_hit_value_bool(hit, &["can_invoke", "canInvoke"]),
                Some(false)
            ) {
                push_unique_policy_ref(&mut deny_refs, LIMECORE_POLICY_REF_GATEWAY_POLICY);
            }
            if matches!(
                read_policy_hit_value_text(hit, &["offer_state", "offerState"]).as_deref(),
                Some("blocked" | "unavailable")
            ) {
                push_unique_policy_ref(&mut deny_refs, LIMECORE_POLICY_REF_GATEWAY_POLICY);
            }
        }
        Some(LIMECORE_POLICY_REF_TENANT_FEATURE_FLAGS) => {
            if policy_refs_contain(policy_refs, LIMECORE_POLICY_REF_GATEWAY_POLICY)
                && matches!(
                    read_policy_hit_feature_flag(hit, "gatewayEnabled"),
                    Some(false)
                )
            {
                push_unique_policy_ref(&mut deny_refs, LIMECORE_POLICY_REF_TENANT_FEATURE_FLAGS);
            }
        }
        _ => {}
    }
    deny_refs
}

fn collect_policy_hit_ask_refs(hit: &Value) -> Vec<String> {
    let mut ask_refs = Vec::new();
    if normalize_policy_hit_ref(hit).as_deref() == Some(LIMECORE_POLICY_REF_GATEWAY_POLICY) {
        if matches!(
            read_policy_hit_value_bool(hit, &["quota_low", "quotaLow"]),
            Some(true)
        ) || matches!(
            read_policy_hit_value_text(hit, &["quota_status", "quotaStatus"]).as_deref(),
            Some("low")
        ) || matches!(
            read_policy_hit_value_text(hit, &["offer_state", "offerState"]).as_deref(),
            Some("available_quota_low" | "available_subscribe_required" | "available_logged_out")
        ) {
            push_unique_policy_ref(&mut ask_refs, LIMECORE_POLICY_REF_GATEWAY_POLICY);
        }
    }
    ask_refs
}

fn evaluate_limecore_policy_decision(
    policy_refs: &[String],
    policy_value_hits: &[Value],
    pending_hit_refs: &[String],
) -> LimeCorePolicyDecisionEvaluation {
    if !pending_hit_refs.is_empty() {
        return LimeCorePolicyDecisionEvaluation {
            status: "input_gap",
            decision: LIMECORE_POLICY_DECISION_ASK,
            decision_source: LIMECORE_POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR,
            decision_scope: "pending_policy_inputs",
            decision_reason: LIMECORE_POLICY_DECISION_REASON_POLICY_INPUTS_MISSING,
            blocking_refs: Vec::new(),
            ask_refs: pending_hit_refs.to_vec(),
            pending_refs: pending_hit_refs.to_vec(),
        };
    }

    let mut blocking_refs = Vec::new();
    let mut ask_refs = Vec::new();
    for hit in policy_value_hits {
        for ref_key in collect_policy_hit_deny_refs(policy_refs, hit) {
            push_unique_policy_ref(&mut blocking_refs, &ref_key);
        }
        for ref_key in collect_policy_hit_ask_refs(hit) {
            push_unique_policy_ref(&mut ask_refs, &ref_key);
        }
    }

    if !blocking_refs.is_empty() {
        return LimeCorePolicyDecisionEvaluation {
            status: "evaluated",
            decision: LIMECORE_POLICY_DECISION_DENY,
            decision_source: LIMECORE_POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR,
            decision_scope: LIMECORE_POLICY_DECISION_SCOPE_RESOLVED_POLICY_INPUTS,
            decision_reason: LIMECORE_POLICY_DECISION_REASON_DENY_SIGNAL,
            blocking_refs,
            ask_refs: Vec::new(),
            pending_refs: Vec::new(),
        };
    }

    if !ask_refs.is_empty() {
        return LimeCorePolicyDecisionEvaluation {
            status: "evaluated",
            decision: LIMECORE_POLICY_DECISION_ASK,
            decision_source: LIMECORE_POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR,
            decision_scope: LIMECORE_POLICY_DECISION_SCOPE_RESOLVED_POLICY_INPUTS,
            decision_reason: LIMECORE_POLICY_DECISION_REASON_ASK_SIGNAL,
            blocking_refs: Vec::new(),
            ask_refs,
            pending_refs: Vec::new(),
        };
    }

    LimeCorePolicyDecisionEvaluation {
        status: "evaluated",
        decision: LIMECORE_POLICY_DECISION_ALLOW,
        decision_source: LIMECORE_POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR,
        decision_scope: LIMECORE_POLICY_DECISION_SCOPE_RESOLVED_POLICY_INPUTS,
        decision_reason: LIMECORE_POLICY_DECISION_REASON_ALL_INPUTS_RESOLVED,
        blocking_refs: Vec::new(),
        ask_refs: Vec::new(),
        pending_refs: Vec::new(),
    }
}

fn limecore_policy_snapshot(policy_refs: &[&str]) -> Value {
    limecore_policy_snapshot_with_value_hits(policy_refs, Vec::new())
}

pub(crate) fn limecore_policy_snapshot_with_value_hits(
    policy_refs: &[&str],
    policy_value_hits: Vec<Value>,
) -> Value {
    let policy_refs = policy_refs
        .iter()
        .map(|policy_ref| (*policy_ref).to_string())
        .collect::<Vec<_>>();
    limecore_policy_snapshot_with_string_refs(&policy_refs, policy_value_hits)
}

fn limecore_policy_snapshot_with_string_refs(
    policy_refs: &[String],
    policy_value_hits: Vec<Value>,
) -> Value {
    let normalized_hits = policy_value_hits
        .into_iter()
        .filter(|hit| {
            normalize_policy_hit_ref(hit)
                .as_deref()
                .is_some_and(|ref_key| policy_refs.iter().any(|policy_ref| policy_ref == &ref_key))
                && normalize_policy_hit_status(hit).is_some()
        })
        .collect::<Vec<_>>();
    let evaluated_refs = policy_refs
        .iter()
        .filter(|policy_ref| {
            normalized_hits.iter().any(|hit| {
                normalize_policy_hit_ref(hit).as_deref() == Some(policy_ref.as_str())
                    && normalize_policy_hit_status(hit).as_deref()
                        == Some(LIMECORE_POLICY_VALUE_HIT_STATUS_RESOLVED)
            })
        })
        .cloned()
        .collect::<Vec<_>>();
    let pending_hit_refs = policy_refs
        .iter()
        .filter(|policy_ref| {
            !evaluated_refs
                .iter()
                .any(|evaluated| evaluated == *policy_ref)
        })
        .cloned()
        .collect::<Vec<_>>();
    let policy_value_hit_count = normalized_hits.len();
    let policy_evaluation =
        evaluate_limecore_policy_decision(&policy_refs, &normalized_hits, &pending_hit_refs);
    let policy_inputs_fully_evaluated = policy_evaluation.status == "evaluated";
    let snapshot_status = if policy_inputs_fully_evaluated {
        LIMECORE_POLICY_SNAPSHOT_STATUS_POLICY_INPUTS_EVALUATED
    } else {
        LIMECORE_POLICY_SNAPSHOT_STATUS_LOCAL_DEFAULTS_EVALUATED
    };
    let decision = if policy_inputs_fully_evaluated {
        policy_evaluation.decision
    } else {
        LIMECORE_POLICY_DECISION_ALLOW
    };
    let decision_source = if policy_inputs_fully_evaluated {
        policy_evaluation.decision_source
    } else {
        LIMECORE_POLICY_DECISION_SOURCE_LOCAL_DEFAULT
    };
    let decision_scope = if policy_inputs_fully_evaluated {
        policy_evaluation.decision_scope
    } else {
        LIMECORE_POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY
    };
    let decision_reason = if policy_inputs_fully_evaluated {
        policy_evaluation.decision_reason
    } else {
        LIMECORE_POLICY_DECISION_REASON_NO_LOCAL_DENY
    };

    json!({
        "status": snapshot_status,
        "decision": decision,
        "source": "modality_runtime_contract",
        "decision_source": decision_source,
        "decision_scope": decision_scope,
        "decision_reason": decision_reason,
        "refs": policy_refs,
        "evaluated_refs": evaluated_refs,
        "unresolved_refs": pending_hit_refs.clone(),
        "missing_inputs": pending_hit_refs.clone(),
        "policy_inputs": limecore_policy_inputs(policy_refs, &normalized_hits),
        "pending_hit_refs": pending_hit_refs.clone(),
        "policy_value_hits": normalized_hits,
        "policy_value_hit_count": policy_value_hit_count,
        "policy_evaluation": {
            "status": policy_evaluation.status,
            "decision": policy_evaluation.decision,
            "decision_source": policy_evaluation.decision_source,
            "decision_scope": policy_evaluation.decision_scope,
            "decision_reason": policy_evaluation.decision_reason,
            "blocking_refs": policy_evaluation.blocking_refs,
            "ask_refs": policy_evaluation.ask_refs,
            "pending_refs": policy_evaluation.pending_refs,
        },
    })
}

fn read_contract_text(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn read_contract_bool(object: &Map<String, Value>, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(Value::as_bool)
}

fn read_contract_object<'a>(
    object: &'a Map<String, Value>,
    keys: &[&str],
) -> Option<&'a Map<String, Value>> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(Value::as_object)
}

fn read_policy_ref_array_from_value(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn default_policy_refs_for_contract(contract_key: &str) -> Vec<String> {
    match contract_key {
        IMAGE_GENERATION_CONTRACT_KEY => IMAGE_GENERATION_LIMECORE_POLICY_REFS,
        BROWSER_CONTROL_CONTRACT_KEY => BROWSER_CONTROL_LIMECORE_POLICY_REFS,
        PDF_EXTRACT_CONTRACT_KEY => PDF_EXTRACT_LIMECORE_POLICY_REFS,
        VOICE_GENERATION_CONTRACT_KEY => VOICE_GENERATION_LIMECORE_POLICY_REFS,
        AUDIO_TRANSCRIPTION_CONTRACT_KEY => AUDIO_TRANSCRIPTION_LIMECORE_POLICY_REFS,
        WEB_RESEARCH_CONTRACT_KEY => WEB_RESEARCH_LIMECORE_POLICY_REFS,
        TEXT_TRANSFORM_CONTRACT_KEY => TEXT_TRANSFORM_LIMECORE_POLICY_REFS,
        _ => &[],
    }
    .iter()
    .map(|policy_ref| (*policy_ref).to_string())
    .collect()
}

fn runtime_contract_policy_refs(contract: &Map<String, Value>, contract_key: &str) -> Vec<String> {
    let mut refs = read_policy_ref_array_from_value(
        contract
            .get("limecore_policy_refs")
            .or_else(|| contract.get("limecorePolicyRefs")),
    );
    if refs.is_empty() {
        refs = contract
            .get("limecore_policy_snapshot")
            .or_else(|| contract.get("limecorePolicySnapshot"))
            .and_then(Value::as_object)
            .map(|snapshot| {
                read_policy_ref_array_from_value(
                    snapshot.get("refs").or_else(|| snapshot.get("policy_refs")),
                )
            })
            .unwrap_or_default();
    }
    if refs.is_empty() {
        refs = default_policy_refs_for_contract(contract_key);
    }
    refs
}

fn runtime_contract_policy_value_hits(contract: &Map<String, Value>) -> Vec<Value> {
    contract
        .get("limecore_policy_snapshot")
        .or_else(|| contract.get("limecorePolicySnapshot"))
        .and_then(Value::as_object)
        .and_then(|snapshot| {
            snapshot
                .get("policy_value_hits")
                .or_else(|| snapshot.get("policyValueHits"))
                .and_then(Value::as_array)
                .cloned()
        })
        .unwrap_or_default()
}

fn looks_like_runtime_contract_object(contract: &Map<String, Value>) -> bool {
    [
        "modality",
        "required_capabilities",
        "requiredCapabilities",
        "routing_slot",
        "routingSlot",
        "executor_binding",
        "executorBinding",
        "limecore_policy_refs",
        "limecorePolicyRefs",
        "limecore_policy_snapshot",
        "limecorePolicySnapshot",
    ]
    .iter()
    .any(|key| contract.contains_key(*key))
}

fn extract_request_oem_routing_policy_context(
    request_metadata: Option<&Value>,
) -> Option<RequestOemRoutingPolicyContext> {
    let root = request_metadata?.as_object()?;
    let harness = root
        .get("harness")
        .and_then(Value::as_object)
        .unwrap_or(root);
    let routing = harness
        .get("oem_routing")
        .or_else(|| harness.get("oemRouting"))
        .and_then(Value::as_object)?;
    let tenant_id = read_contract_text(routing, &["tenant_id", "tenantId"])?;

    Some(RequestOemRoutingPolicyContext {
        tenant_id,
        provider_source: read_contract_text(routing, &["provider_source", "providerSource"]),
        provider_key: read_contract_text(routing, &["provider_key", "providerKey"]),
        default_model: read_contract_text(routing, &["default_model", "defaultModel"]),
        config_mode: read_contract_text(routing, &["config_mode", "configMode"]),
        offer_state: read_contract_text(routing, &["offer_state", "offerState"]),
        quota_status: read_contract_text(routing, &["quota_status", "quotaStatus"]),
        fallback_to_local_allowed: read_contract_bool(
            routing,
            &["fallback_to_local_allowed", "fallbackToLocalAllowed"],
        ),
        can_invoke: read_contract_bool(routing, &["can_invoke", "canInvoke"]),
    })
}

fn extract_request_tenant_feature_flags_policy_context(
    request_metadata: Option<&Value>,
) -> Option<RequestTenantFeatureFlagsPolicyContext> {
    let root = request_metadata?.as_object()?;
    let harness = root
        .get("harness")
        .and_then(Value::as_object)
        .unwrap_or(root);
    let feature_flags = harness
        .get("tenant_feature_flags")
        .or_else(|| harness.get("tenantFeatureFlags"))
        .and_then(Value::as_object)?;
    let tenant_id = read_contract_text(feature_flags, &["tenant_id", "tenantId"])?;
    let raw_flags = read_contract_object(feature_flags, &["flags", "features", "featureFlags"])?;
    let flags = raw_flags
        .iter()
        .filter_map(|(key, value)| value.as_bool().map(|flag| (key.clone(), Value::Bool(flag))))
        .collect::<Map<String, Value>>();
    if flags.is_empty() {
        return None;
    }

    Some(RequestTenantFeatureFlagsPolicyContext {
        tenant_id,
        source: read_contract_text(feature_flags, &["source", "value_source", "valueSource"])
            .unwrap_or_else(|| "oem_cloud_bootstrap".to_string()),
        flags,
    })
}

fn gateway_policy_oem_locked(context: &RequestOemRoutingPolicyContext) -> bool {
    matches!(context.config_mode.as_deref(), Some("managed"))
        || matches!(context.fallback_to_local_allowed, Some(false))
}

fn gateway_policy_quota_low(context: &RequestOemRoutingPolicyContext) -> bool {
    matches!(context.quota_status.as_deref(), Some("low"))
        || matches!(context.offer_state.as_deref(), Some("available_quota_low"))
}

fn gateway_policy_oem_routing_value_hit(
    contract_key: &str,
    context: &RequestOemRoutingPolicyContext,
) -> Value {
    let provider_summary = context
        .provider_key
        .as_deref()
        .or(context.provider_source.as_deref())
        .unwrap_or("oem_cloud");

    json!({
        "ref_key": LIMECORE_POLICY_REF_GATEWAY_POLICY,
        "status": LIMECORE_POLICY_VALUE_HIT_STATUS_RESOLVED,
        "source": "harness_oem_routing",
        "value_source": LIMECORE_POLICY_VALUE_SOURCE_REQUEST_OEM_ROUTING,
        "summary": format!(
            "请求 metadata 已命中 gateway_policy 输入: tenant={} provider={provider_summary}",
            context.tenant_id
        ),
        "value": {
            "contract_key": contract_key,
            "tenant_id": context.tenant_id.as_str(),
            "provider_source": context.provider_source.as_deref(),
            "provider_key": context.provider_key.as_deref(),
            "default_model": context.default_model.as_deref(),
            "config_mode": context.config_mode.as_deref(),
            "offer_state": context.offer_state.as_deref(),
            "quota_status": context.quota_status.as_deref(),
            "fallback_to_local_allowed": context.fallback_to_local_allowed,
            "can_invoke": context.can_invoke,
            "oem_locked": gateway_policy_oem_locked(context),
            "quota_low": gateway_policy_quota_low(context),
            "policy_surface": "gateway_routing",
        }
    })
}

fn tenant_feature_flags_value_hit(
    contract_key: &str,
    context: &RequestTenantFeatureFlagsPolicyContext,
) -> Value {
    let mut feature_keys = context.flags.keys().cloned().collect::<Vec<_>>();
    feature_keys.sort();
    let enabled_feature_keys = feature_keys
        .iter()
        .filter(|key| {
            context
                .flags
                .get(*key)
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();

    json!({
        "ref_key": LIMECORE_POLICY_REF_TENANT_FEATURE_FLAGS,
        "status": LIMECORE_POLICY_VALUE_HIT_STATUS_RESOLVED,
        "source": "harness_tenant_feature_flags",
        "value_source": LIMECORE_POLICY_VALUE_SOURCE_OEM_CLOUD_BOOTSTRAP_FEATURES,
        "summary": format!(
            "请求 metadata 已命中 tenant_feature_flags 输入: tenant={} flags={}",
            context.tenant_id,
            feature_keys.len()
        ),
        "value": {
            "contract_key": contract_key,
            "tenant_id": context.tenant_id.as_str(),
            "source": context.source.as_str(),
            "feature_keys": feature_keys,
            "enabled_feature_keys": enabled_feature_keys,
            "flags": context.flags.clone(),
            "policy_surface": "tenant_feature_flags",
        }
    })
}

fn merge_gateway_policy_hit_into_runtime_contract(
    runtime_contract: &mut Value,
    context: &RequestOemRoutingPolicyContext,
) {
    let Some(contract) = runtime_contract.as_object_mut() else {
        return;
    };
    let Some(contract_key) = read_contract_text(contract, &["contract_key", "contractKey"]) else {
        return;
    };
    if !looks_like_runtime_contract_object(contract) {
        return;
    }
    let policy_refs = runtime_contract_policy_refs(contract, contract_key.as_str());
    if !policy_refs
        .iter()
        .any(|policy_ref| policy_ref == LIMECORE_POLICY_REF_GATEWAY_POLICY)
    {
        return;
    }

    let mut policy_value_hits = runtime_contract_policy_value_hits(contract)
        .into_iter()
        .filter(|hit| {
            normalize_policy_hit_ref(hit).as_deref() != Some(LIMECORE_POLICY_REF_GATEWAY_POLICY)
        })
        .collect::<Vec<_>>();
    policy_value_hits.push(gateway_policy_oem_routing_value_hit(
        contract_key.as_str(),
        context,
    ));
    contract.insert(
        "limecore_policy_refs".to_string(),
        json!(policy_refs.clone()),
    );
    contract.insert(
        "limecore_policy_snapshot".to_string(),
        limecore_policy_snapshot_with_string_refs(&policy_refs, policy_value_hits),
    );
}

fn merge_tenant_feature_flags_hit_into_runtime_contract(
    value: &mut Value,
    context: &RequestTenantFeatureFlagsPolicyContext,
) {
    let Some(contract) = value.as_object_mut() else {
        return;
    };
    let Some(contract_key) = read_contract_text(contract, &["contract_key", "contractKey"]) else {
        return;
    };
    if !looks_like_runtime_contract_object(contract) {
        return;
    }
    let policy_refs = runtime_contract_policy_refs(contract, contract_key.as_str());
    if !policy_refs
        .iter()
        .any(|policy_ref| policy_ref == LIMECORE_POLICY_REF_TENANT_FEATURE_FLAGS)
    {
        return;
    }

    let mut policy_value_hits = runtime_contract_policy_value_hits(contract)
        .into_iter()
        .filter(|hit| {
            normalize_policy_hit_ref(hit).as_deref()
                != Some(LIMECORE_POLICY_REF_TENANT_FEATURE_FLAGS)
        })
        .collect::<Vec<_>>();
    policy_value_hits.push(tenant_feature_flags_value_hit(
        contract_key.as_str(),
        context,
    ));
    contract.insert(
        "limecore_policy_refs".to_string(),
        json!(policy_refs.clone()),
    );
    contract.insert(
        "limecore_policy_snapshot".to_string(),
        limecore_policy_snapshot_with_string_refs(&policy_refs, policy_value_hits),
    );
}

fn hydrate_policy_hits_in_value(
    value: &mut Value,
    gateway_context: Option<&RequestOemRoutingPolicyContext>,
    tenant_feature_flags_context: Option<&RequestTenantFeatureFlagsPolicyContext>,
) {
    if let Some(context) = gateway_context {
        merge_gateway_policy_hit_into_runtime_contract(value, context);
    }
    if let Some(context) = tenant_feature_flags_context {
        merge_tenant_feature_flags_hit_into_runtime_contract(value, context);
    }

    match value {
        Value::Array(items) => {
            for item in items {
                hydrate_policy_hits_in_value(item, gateway_context, tenant_feature_flags_context);
            }
        }
        Value::Object(object) => {
            for item in object.values_mut() {
                hydrate_policy_hits_in_value(item, gateway_context, tenant_feature_flags_context);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
pub(crate) fn hydrate_limecore_gateway_policy_hits_from_oem_routing(metadata: &mut Value) {
    let Some(context) = extract_request_oem_routing_policy_context(Some(metadata)) else {
        return;
    };
    hydrate_policy_hits_in_value(metadata, Some(&context), None);
}

pub(crate) fn hydrate_limecore_policy_hits_from_request_metadata(metadata: &mut Value) {
    let gateway_context = extract_request_oem_routing_policy_context(Some(metadata));
    let tenant_feature_flags_context =
        extract_request_tenant_feature_flags_policy_context(Some(metadata));
    if gateway_context.is_none() && tenant_feature_flags_context.is_none() {
        return;
    }
    hydrate_policy_hits_in_value(
        metadata,
        gateway_context.as_ref(),
        tenant_feature_flags_context.as_ref(),
    );
}

#[cfg(test)]
pub(crate) fn runtime_contract_with_gateway_policy_hit_from_oem_routing(
    mut runtime_contract: Value,
    request_metadata: Option<&Value>,
) -> Value {
    if let Some(context) = extract_request_oem_routing_policy_context(request_metadata) {
        merge_gateway_policy_hit_into_runtime_contract(&mut runtime_contract, &context);
    }
    runtime_contract
}

pub(crate) fn runtime_contract_with_policy_hits_from_request_metadata(
    mut runtime_contract: Value,
    request_metadata: Option<&Value>,
) -> Value {
    if let Some(context) = extract_request_oem_routing_policy_context(request_metadata) {
        merge_gateway_policy_hit_into_runtime_contract(&mut runtime_contract, &context);
    }
    if let Some(context) = extract_request_tenant_feature_flags_policy_context(request_metadata) {
        merge_tenant_feature_flags_hit_into_runtime_contract(&mut runtime_contract, &context);
    }
    runtime_contract
}

pub(crate) fn image_generation_model_catalog_policy_value_hit(
    assessment: &ImageGenerationModelCapabilityAssessment,
) -> Value {
    let summary = if assessment.supports_image_generation {
        format!(
            "model registry 命中 {}，声明支持 image_generation",
            assessment.model_id
        )
    } else {
        format!(
            "model registry 命中 {}，但未声明 image_generation 能力",
            assessment.model_id
        )
    };

    json!({
        "ref_key": LIMECORE_POLICY_REF_MODEL_CATALOG,
        "status": LIMECORE_POLICY_VALUE_HIT_STATUS_RESOLVED,
        "source": "local_model_registry",
        "value_source": LIMECORE_POLICY_VALUE_SOURCE_LOCAL_MODEL_CATALOG,
        "summary": summary,
        "value": {
            "contract_key": IMAGE_GENERATION_CONTRACT_KEY,
            "requested_capability": "image_generation",
            "model_id": assessment.model_id.as_str(),
            "provider_id": assessment.provider_id.as_deref(),
            "assessment_source": assessment.source,
            "supports_image_generation": assessment.supports_image_generation,
            "reason": assessment.reason,
        }
    })
}

fn endpoint_policy_surface(endpoint: &str) -> (Option<String>, Option<String>) {
    let parsed = match url::Url::parse(endpoint.trim()) {
        Ok(parsed) => parsed,
        Err(_) => return (None, None),
    };
    let origin = parsed.origin().ascii_serialization();
    let origin = (origin != "null").then_some(origin);
    let path = parsed.path().trim();
    let path = (!path.is_empty()).then(|| path.to_string());
    (origin, path)
}

pub(crate) fn image_generation_provider_offer_policy_value_hit(
    provider_id: Option<&str>,
    model: Option<&str>,
    endpoint: &str,
) -> Value {
    let provider_id = provider_id.map(str::trim).filter(|value| !value.is_empty());
    let model = model.map(str::trim).filter(|value| !value.is_empty());
    let (endpoint_origin, endpoint_path) = endpoint_policy_surface(endpoint);
    let summary = match (provider_id, model) {
        (Some(provider_id), Some(model)) => {
            format!("本地图片执行器已解析 provider_offer: {provider_id}/{model}")
        }
        (Some(provider_id), None) => {
            format!("本地图片执行器已解析 provider_offer: {provider_id}")
        }
        (None, Some(model)) => {
            format!("本地图片执行器已解析 provider_offer model: {model}")
        }
        (None, None) => "本地图片执行器已解析 provider_offer".to_string(),
    };

    json!({
        "ref_key": LIMECORE_POLICY_REF_PROVIDER_OFFER,
        "status": LIMECORE_POLICY_VALUE_HIT_STATUS_RESOLVED,
        "source": "local_image_generation_runner_config",
        "value_source": LIMECORE_POLICY_VALUE_SOURCE_LOCAL_PROVIDER_OFFER,
        "summary": summary,
        "value": {
            "contract_key": IMAGE_GENERATION_CONTRACT_KEY,
            "provider_id": provider_id,
            "model": model,
            "adapter": "local_image_generation_gateway",
            "credential_state": "configured",
            "credential_source": "global_config_server_api_key",
            "endpoint_origin": endpoint_origin,
            "endpoint_path": endpoint_path,
        }
    })
}

fn limecore_policy_inputs(policy_refs: &[String], policy_value_hits: &[Value]) -> Vec<Value> {
    policy_refs
        .iter()
        .map(|policy_ref| {
            let resolved_hit = policy_value_hits.iter().find(|hit| {
                normalize_policy_hit_ref(hit).as_deref() == Some(policy_ref.as_str())
                    && normalize_policy_hit_status(hit).as_deref()
                        == Some(LIMECORE_POLICY_VALUE_HIT_STATUS_RESOLVED)
            });
            json!({
                "ref_key": policy_ref,
                "status": resolved_hit
                    .map(|_| LIMECORE_POLICY_INPUT_STATUS_RESOLVED)
                    .unwrap_or(LIMECORE_POLICY_INPUT_STATUS_DECLARED_ONLY),
                "source": "modality_runtime_contract",
                "value_source": resolved_hit
                    .and_then(normalize_policy_hit_value_source)
                    .unwrap_or_else(|| LIMECORE_POLICY_INPUT_VALUE_SOURCE_LIMECORE_PENDING.to_string()),
            })
        })
        .collect()
}

pub(crate) fn image_generation_runtime_contract_with_policy_value_hits(
    policy_value_hits: Vec<Value>,
) -> Value {
    json!({
        "contract_key": IMAGE_GENERATION_CONTRACT_KEY,
        "modality": IMAGE_GENERATION_MODALITY,
        "required_capabilities": IMAGE_GENERATION_REQUIRED_CAPABILITIES,
        "routing_slot": IMAGE_GENERATION_ROUTING_SLOT,
        "executor_binding": {
            "executor_kind": "skill",
            "binding_key": IMAGE_GENERATION_EXECUTOR_BINDING_KEY
        },
        "execution_profile": {
            "profile_key": IMAGE_GENERATION_EXECUTION_PROFILE_KEY
        },
        "executor_adapter": {
            "adapter_key": IMAGE_GENERATION_EXECUTOR_ADAPTER_KEY
        },
        "limecore_policy_refs": IMAGE_GENERATION_LIMECORE_POLICY_REFS,
        "limecore_policy_snapshot": limecore_policy_snapshot_with_value_hits(
            IMAGE_GENERATION_LIMECORE_POLICY_REFS,
            policy_value_hits
        ),
        "truth_source": ["image_task_artifact", "runtime_timeline_event"],
        "artifact_kinds": ["image_task", "image_output"],
        "viewer_surface": ["image_workbench"],
        "owner_surface": "agent_runtime"
    })
}

pub(crate) fn image_generation_runtime_contract() -> Value {
    image_generation_runtime_contract_with_policy_value_hits(Vec::new())
}

pub(crate) fn browser_control_runtime_contract() -> Value {
    json!({
        "contract_key": BROWSER_CONTROL_CONTRACT_KEY,
        "modality": BROWSER_CONTROL_MODALITY,
        "required_capabilities": BROWSER_CONTROL_REQUIRED_CAPABILITIES,
        "routing_slot": BROWSER_CONTROL_ROUTING_SLOT,
        "executor_binding": {
            "executor_kind": "browser",
            "binding_key": BROWSER_CONTROL_EXECUTOR_BINDING_KEY
        },
        "execution_profile": {
            "profile_key": BROWSER_CONTROL_EXECUTION_PROFILE_KEY
        },
        "executor_adapter": {
            "adapter_key": BROWSER_CONTROL_EXECUTOR_ADAPTER_KEY
        },
        "limecore_policy_refs": BROWSER_CONTROL_LIMECORE_POLICY_REFS,
        "limecore_policy_snapshot": limecore_policy_snapshot(BROWSER_CONTROL_LIMECORE_POLICY_REFS),
        "truth_source": ["browser_action_trace", "runtime_timeline_event"],
        "artifact_kinds": ["browser_session", "browser_snapshot"],
        "viewer_surface": ["browser_replay_viewer"],
        "owner_surface": "browser_runtime"
    })
}

pub(crate) fn pdf_extract_runtime_contract() -> Value {
    json!({
        "contract_key": PDF_EXTRACT_CONTRACT_KEY,
        "modality": PDF_EXTRACT_MODALITY,
        "required_capabilities": PDF_EXTRACT_REQUIRED_CAPABILITIES,
        "routing_slot": PDF_EXTRACT_ROUTING_SLOT,
        "executor_binding": {
            "executor_kind": "skill",
            "binding_key": PDF_EXTRACT_EXECUTOR_BINDING_KEY
        },
        "execution_profile": {
            "profile_key": PDF_EXTRACT_EXECUTION_PROFILE_KEY
        },
        "executor_adapter": {
            "adapter_key": PDF_EXTRACT_EXECUTOR_ADAPTER_KEY
        },
        "limecore_policy_refs": PDF_EXTRACT_LIMECORE_POLICY_REFS,
        "limecore_policy_snapshot": limecore_policy_snapshot(PDF_EXTRACT_LIMECORE_POLICY_REFS),
        "truth_source": ["pdf_extract_artifact", "runtime_timeline_event"],
        "artifact_kinds": ["pdf_extract", "report_document"],
        "viewer_surface": ["document_viewer"],
        "owner_surface": "agent_runtime"
    })
}

pub(crate) fn voice_generation_runtime_contract() -> Value {
    json!({
        "contract_key": VOICE_GENERATION_CONTRACT_KEY,
        "modality": VOICE_GENERATION_MODALITY,
        "required_capabilities": VOICE_GENERATION_REQUIRED_CAPABILITIES,
        "routing_slot": VOICE_GENERATION_ROUTING_SLOT,
        "executor_binding": {
            "executor_kind": "service_skill",
            "binding_key": VOICE_GENERATION_EXECUTOR_BINDING_KEY
        },
        "execution_profile": {
            "profile_key": VOICE_GENERATION_EXECUTION_PROFILE_KEY
        },
        "executor_adapter": {
            "adapter_key": VOICE_GENERATION_EXECUTOR_ADAPTER_KEY
        },
        "limecore_policy_refs": VOICE_GENERATION_LIMECORE_POLICY_REFS,
        "limecore_policy_snapshot": limecore_policy_snapshot(VOICE_GENERATION_LIMECORE_POLICY_REFS),
        "truth_source": ["audio_task_artifact", "runtime_timeline_event"],
        "artifact_kinds": ["audio_task", "audio_output"],
        "viewer_surface": ["audio_player"],
        "owner_surface": "service_skill_runtime"
    })
}

pub(crate) fn audio_transcription_runtime_contract() -> Value {
    json!({
        "contract_key": AUDIO_TRANSCRIPTION_CONTRACT_KEY,
        "modality": AUDIO_TRANSCRIPTION_MODALITY,
        "required_capabilities": AUDIO_TRANSCRIPTION_REQUIRED_CAPABILITIES,
        "routing_slot": AUDIO_TRANSCRIPTION_ROUTING_SLOT,
        "executor_binding": {
            "executor_kind": "skill",
            "binding_key": AUDIO_TRANSCRIPTION_EXECUTOR_BINDING_KEY
        },
        "execution_profile": {
            "profile_key": AUDIO_TRANSCRIPTION_EXECUTION_PROFILE_KEY
        },
        "executor_adapter": {
            "adapter_key": AUDIO_TRANSCRIPTION_EXECUTOR_ADAPTER_KEY
        },
        "limecore_policy_refs": AUDIO_TRANSCRIPTION_LIMECORE_POLICY_REFS,
        "limecore_policy_snapshot": limecore_policy_snapshot(AUDIO_TRANSCRIPTION_LIMECORE_POLICY_REFS),
        "truth_source": ["transcript_artifact", "runtime_timeline_event"],
        "artifact_kinds": ["transcript"],
        "viewer_surface": ["transcript_viewer", "document_viewer"],
        "owner_surface": "agent_runtime"
    })
}

pub(crate) fn web_research_runtime_contract() -> Value {
    json!({
        "contract_key": WEB_RESEARCH_CONTRACT_KEY,
        "modality": WEB_RESEARCH_MODALITY,
        "required_capabilities": WEB_RESEARCH_REQUIRED_CAPABILITIES,
        "routing_slot": WEB_RESEARCH_ROUTING_SLOT,
        "executor_binding": {
            "executor_kind": "skill",
            "binding_key": WEB_RESEARCH_EXECUTOR_BINDING_KEY
        },
        "execution_profile": {
            "profile_key": WEB_RESEARCH_EXECUTION_PROFILE_KEY
        },
        "executor_adapter": {
            "adapter_key": WEB_RESEARCH_EXECUTOR_ADAPTER_KEY
        },
        "limecore_policy_refs": WEB_RESEARCH_LIMECORE_POLICY_REFS,
        "limecore_policy_snapshot": limecore_policy_snapshot(WEB_RESEARCH_LIMECORE_POLICY_REFS),
        "truth_source": ["research_timeline_event", "report_document_artifact"],
        "artifact_kinds": ["report_document", "webpage_artifact"],
        "viewer_surface": ["report_viewer", "webpage_viewer"],
        "owner_surface": "agent_runtime"
    })
}

pub(crate) fn text_transform_runtime_contract() -> Value {
    json!({
        "contract_key": TEXT_TRANSFORM_CONTRACT_KEY,
        "modality": TEXT_TRANSFORM_MODALITY,
        "required_capabilities": TEXT_TRANSFORM_REQUIRED_CAPABILITIES,
        "routing_slot": TEXT_TRANSFORM_ROUTING_SLOT,
        "executor_binding": {
            "executor_kind": "skill",
            "binding_key": TEXT_TRANSFORM_EXECUTOR_BINDING_KEY
        },
        "execution_profile": {
            "profile_key": TEXT_TRANSFORM_EXECUTION_PROFILE_KEY
        },
        "executor_adapter": {
            "adapter_key": TEXT_TRANSFORM_EXECUTOR_ADAPTER_KEY
        },
        "limecore_policy_refs": TEXT_TRANSFORM_LIMECORE_POLICY_REFS,
        "limecore_policy_snapshot": limecore_policy_snapshot(TEXT_TRANSFORM_LIMECORE_POLICY_REFS),
        "truth_source": ["runtime_timeline_event", "report_document_artifact"],
        "artifact_kinds": ["report_document", "generic_file"],
        "viewer_surface": ["document_viewer", "generic_file_viewer"],
        "owner_surface": "agent_runtime"
    })
}

pub(crate) fn looks_like_image_generation_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    !normalized.is_empty()
        && IMAGE_GENERATION_MODEL_KEYWORDS
            .iter()
            .any(|keyword| normalized.contains(keyword))
}

pub(crate) fn looks_like_text_model_for_image_generation(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    !normalized.is_empty()
        && !looks_like_image_generation_model(&normalized)
        && TEXT_MODEL_KEYWORDS
            .iter()
            .any(|keyword| normalized.contains(keyword))
}

fn normalize_model_lookup_key(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn model_candidate_matches(
    metadata: &EnhancedModelMetadata,
    model_id: &str,
    provider_id: Option<&str>,
) -> bool {
    let normalized_model = normalize_model_lookup_key(model_id);
    if normalized_model.is_empty() {
        return false;
    }

    if let Some(provider_id) = provider_id
        .map(normalize_model_lookup_key)
        .filter(|value| !value.is_empty())
    {
        let metadata_provider = normalize_model_lookup_key(&metadata.provider_id);
        if metadata_provider != provider_id {
            return false;
        }
    }

    [
        Some(metadata.id.as_str()),
        metadata.provider_model_id.as_deref(),
        metadata.canonical_model_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|candidate| normalize_model_lookup_key(candidate) == normalized_model)
}

fn metadata_supports_image_generation(metadata: &EnhancedModelMetadata) -> bool {
    metadata.supports_task_family(&ModelTaskFamily::ImageGeneration)
        || metadata.supports_task_family(&ModelTaskFamily::ImageEdit)
        || metadata.has_output_modality(&ModelModality::Image)
}

pub(crate) fn assess_image_generation_model_capability_from_registry(
    catalog: &[EnhancedModelMetadata],
    model_id: &str,
    provider_id: Option<&str>,
) -> Option<ImageGenerationModelCapabilityAssessment> {
    let metadata = catalog
        .iter()
        .find(|metadata| model_candidate_matches(metadata, model_id, provider_id))?;
    let supports_image_generation = metadata_supports_image_generation(metadata);
    Some(ImageGenerationModelCapabilityAssessment {
        model_id: metadata.id.clone(),
        provider_id: Some(metadata.provider_id.clone()),
        source: "model_registry",
        supports_image_generation,
        reason: if supports_image_generation {
            "registry_declares_image_generation"
        } else {
            "registry_missing_image_generation_capability"
        },
    })
}

pub(crate) fn insert_image_generation_contract_fields(record: &mut Map<String, Value>) {
    record.insert(
        "modality_contract_key".to_string(),
        Value::String(IMAGE_GENERATION_CONTRACT_KEY.to_string()),
    );
    record.insert(
        "modality".to_string(),
        Value::String(IMAGE_GENERATION_MODALITY.to_string()),
    );
    record.insert(
        "required_capabilities".to_string(),
        json!(IMAGE_GENERATION_REQUIRED_CAPABILITIES),
    );
    record.insert(
        "routing_slot".to_string(),
        Value::String(IMAGE_GENERATION_ROUTING_SLOT.to_string()),
    );
    record.insert(
        "runtime_contract".to_string(),
        image_generation_runtime_contract(),
    );
}

pub(crate) fn insert_pdf_extract_contract_fields(record: &mut Map<String, Value>) {
    record.insert(
        "modality_contract_key".to_string(),
        Value::String(PDF_EXTRACT_CONTRACT_KEY.to_string()),
    );
    record.insert(
        "modality".to_string(),
        Value::String(PDF_EXTRACT_MODALITY.to_string()),
    );
    record.insert(
        "required_capabilities".to_string(),
        json!(PDF_EXTRACT_REQUIRED_CAPABILITIES),
    );
    record.insert(
        "routing_slot".to_string(),
        Value::String(PDF_EXTRACT_ROUTING_SLOT.to_string()),
    );
    record.insert(
        "runtime_contract".to_string(),
        pdf_extract_runtime_contract(),
    );
}

pub(crate) fn insert_voice_generation_contract_fields(record: &mut Map<String, Value>) {
    record.insert(
        "modality_contract_key".to_string(),
        Value::String(VOICE_GENERATION_CONTRACT_KEY.to_string()),
    );
    record.insert(
        "modality".to_string(),
        Value::String(VOICE_GENERATION_MODALITY.to_string()),
    );
    record.insert(
        "required_capabilities".to_string(),
        json!(VOICE_GENERATION_REQUIRED_CAPABILITIES),
    );
    record.insert(
        "routing_slot".to_string(),
        Value::String(VOICE_GENERATION_ROUTING_SLOT.to_string()),
    );
    record.insert(
        "runtime_contract".to_string(),
        voice_generation_runtime_contract(),
    );
}

pub(crate) fn insert_audio_transcription_contract_fields(record: &mut Map<String, Value>) {
    record.insert(
        "modality_contract_key".to_string(),
        Value::String(AUDIO_TRANSCRIPTION_CONTRACT_KEY.to_string()),
    );
    record.insert(
        "modality".to_string(),
        Value::String(AUDIO_TRANSCRIPTION_MODALITY.to_string()),
    );
    record.insert(
        "required_capabilities".to_string(),
        json!(AUDIO_TRANSCRIPTION_REQUIRED_CAPABILITIES),
    );
    record.insert(
        "routing_slot".to_string(),
        Value::String(AUDIO_TRANSCRIPTION_ROUTING_SLOT.to_string()),
    );
    record.insert(
        "runtime_contract".to_string(),
        audio_transcription_runtime_contract(),
    );
}

pub(crate) fn insert_web_research_contract_fields(record: &mut Map<String, Value>) {
    record.insert(
        "modality_contract_key".to_string(),
        Value::String(WEB_RESEARCH_CONTRACT_KEY.to_string()),
    );
    record.insert(
        "modality".to_string(),
        Value::String(WEB_RESEARCH_MODALITY.to_string()),
    );
    record.insert(
        "required_capabilities".to_string(),
        json!(WEB_RESEARCH_REQUIRED_CAPABILITIES),
    );
    record.insert(
        "routing_slot".to_string(),
        Value::String(WEB_RESEARCH_ROUTING_SLOT.to_string()),
    );
    record.insert(
        "runtime_contract".to_string(),
        web_research_runtime_contract(),
    );
}

pub(crate) fn insert_text_transform_contract_fields(record: &mut Map<String, Value>) {
    record.insert(
        "modality_contract_key".to_string(),
        Value::String(TEXT_TRANSFORM_CONTRACT_KEY.to_string()),
    );
    record.insert(
        "modality".to_string(),
        Value::String(TEXT_TRANSFORM_MODALITY.to_string()),
    );
    record.insert(
        "required_capabilities".to_string(),
        json!(TEXT_TRANSFORM_REQUIRED_CAPABILITIES),
    );
    record.insert(
        "routing_slot".to_string(),
        Value::String(TEXT_TRANSFORM_ROUTING_SLOT.to_string()),
    );
    record.insert(
        "runtime_contract".to_string(),
        text_transform_runtime_contract(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_metadata(id: &str, provider_id: &str) -> EnhancedModelMetadata {
        EnhancedModelMetadata::new(
            id.to_string(),
            id.to_string(),
            provider_id.to_string(),
            provider_id.to_string(),
        )
    }

    #[test]
    fn assess_image_generation_model_capability_should_use_output_modality() {
        let mut model = model_metadata("lime-visual-renderer", "lime");
        model.output_modalities = vec![ModelModality::Image];
        let assessment = assess_image_generation_model_capability_from_registry(
            &[model],
            "lime-visual-renderer",
            Some("lime"),
        )
        .expect("model should match registry");

        assert!(assessment.supports_image_generation);
        assert_eq!(assessment.source, "model_registry");
        assert_eq!(assessment.reason, "registry_declares_image_generation");
    }

    #[test]
    fn limecore_policy_snapshot_with_value_hits_should_mark_resolved_refs() {
        let snapshot = limecore_policy_snapshot_with_value_hits(
            IMAGE_GENERATION_LIMECORE_POLICY_REFS,
            vec![json!({
                "ref_key": "model_catalog",
                "status": "resolved",
                "source": "limecore_policy_hit_resolver",
                "value_source": "local_model_catalog",
                "summary": "命中 gpt-image-1 的 image_generation capability",
                "value": {
                    "model_id": "gpt-image-1",
                    "capability": "image_generation"
                }
            })],
        );

        assert_eq!(snapshot["policy_value_hit_count"], json!(1));
        assert_eq!(snapshot["evaluated_refs"], json!(["model_catalog"]));
        assert_eq!(
            snapshot["pending_hit_refs"],
            json!(["provider_offer", "tenant_feature_flags"])
        );
        assert_eq!(
            snapshot["missing_inputs"],
            json!(["provider_offer", "tenant_feature_flags"])
        );
        assert_eq!(
            snapshot["policy_inputs"][0]["status"],
            json!(LIMECORE_POLICY_INPUT_STATUS_RESOLVED)
        );
        assert_eq!(
            snapshot["policy_inputs"][0]["value_source"],
            json!("local_model_catalog")
        );
        assert_eq!(
            snapshot["policy_inputs"][1]["status"],
            json!(LIMECORE_POLICY_INPUT_STATUS_DECLARED_ONLY)
        );
    }

    #[test]
    fn image_generation_model_catalog_hit_should_feed_runtime_contract_snapshot() {
        let assessment = ImageGenerationModelCapabilityAssessment {
            model_id: "gpt-image-1".to_string(),
            provider_id: Some("openai".to_string()),
            source: "model_registry",
            supports_image_generation: true,
            reason: "registry_declares_image_generation",
        };
        let contract = image_generation_runtime_contract_with_policy_value_hits(vec![
            image_generation_model_catalog_policy_value_hit(&assessment),
        ]);
        let snapshot = &contract["limecore_policy_snapshot"];

        assert_eq!(snapshot["evaluated_refs"], json!(["model_catalog"]));
        assert_eq!(
            snapshot["missing_inputs"],
            json!(["provider_offer", "tenant_feature_flags"])
        );
        assert_eq!(snapshot["policy_value_hit_count"], json!(1));
        assert_eq!(
            snapshot["policy_value_hits"][0]["value_source"],
            json!("local_model_catalog")
        );
        assert_eq!(
            snapshot["policy_value_hits"][0]["value"]["assessment_source"],
            json!("model_registry")
        );
        assert_eq!(
            snapshot["policy_inputs"][0]["status"],
            json!(LIMECORE_POLICY_INPUT_STATUS_RESOLVED)
        );
    }

    #[test]
    fn image_generation_provider_offer_hit_should_feed_runtime_contract_snapshot() {
        let assessment = ImageGenerationModelCapabilityAssessment {
            model_id: "gpt-image-1".to_string(),
            provider_id: Some("openai".to_string()),
            source: "model_registry",
            supports_image_generation: true,
            reason: "registry_declares_image_generation",
        };
        let contract = image_generation_runtime_contract_with_policy_value_hits(vec![
            image_generation_model_catalog_policy_value_hit(&assessment),
            image_generation_provider_offer_policy_value_hit(
                Some("openai"),
                Some("gpt-image-1"),
                "http://127.0.0.1:3456/v1/images/generations?token=secret",
            ),
        ]);
        let snapshot = &contract["limecore_policy_snapshot"];

        assert_eq!(
            snapshot["evaluated_refs"],
            json!(["model_catalog", "provider_offer"])
        );
        assert_eq!(snapshot["missing_inputs"], json!(["tenant_feature_flags"]));
        assert_eq!(
            snapshot["pending_hit_refs"],
            json!(["tenant_feature_flags"])
        );
        assert_eq!(snapshot["policy_value_hit_count"], json!(2));
        assert_eq!(
            snapshot["policy_inputs"][1]["value_source"],
            json!("local_provider_offer")
        );
        assert_eq!(
            snapshot["policy_value_hits"][1]["value"]["endpoint_origin"],
            json!("http://127.0.0.1:3456")
        );
        assert_eq!(
            snapshot["policy_value_hits"][1]["value"]["endpoint_path"],
            json!("/v1/images/generations")
        );
        assert!(!snapshot.to_string().contains("secret"));
        assert!(snapshot["policy_value_hits"][1]["value"]
            .get("api_key")
            .is_none());
    }

    #[test]
    fn gateway_policy_hit_from_oem_routing_should_resolve_web_research_ref() {
        let contract = runtime_contract_with_gateway_policy_hit_from_oem_routing(
            web_research_runtime_contract(),
            Some(&json!({
                "harness": {
                    "oem_routing": {
                        "tenant_id": "tenant-1",
                        "provider_source": "oem_cloud",
                        "provider_key": "lime-hub",
                        "default_model": "gpt-5.4-mini",
                        "config_mode": "managed",
                        "offer_state": "available_quota_low",
                        "quota_status": "low",
                        "fallback_to_local_allowed": false,
                        "can_invoke": true
                    }
                }
            })),
        );
        let snapshot = &contract["limecore_policy_snapshot"];

        assert_eq!(snapshot["evaluated_refs"], json!(["gateway_policy"]));
        assert_eq!(
            snapshot["missing_inputs"],
            json!(["tenant_feature_flags", "model_catalog"])
        );
        assert_eq!(
            snapshot["pending_hit_refs"],
            json!(["tenant_feature_flags", "model_catalog"])
        );
        assert_eq!(snapshot["policy_value_hit_count"], json!(1));
        assert_eq!(
            snapshot["policy_value_hits"][0]["value_source"],
            json!("request_oem_routing")
        );
        assert_eq!(
            snapshot["policy_value_hits"][0]["value"]["tenant_id"],
            json!("tenant-1")
        );
        assert_eq!(
            snapshot["policy_value_hits"][0]["value"]["oem_locked"],
            json!(true)
        );
        assert_eq!(
            snapshot["policy_value_hits"][0]["value"]["quota_low"],
            json!(true)
        );
        assert_eq!(
            snapshot["decision_source"],
            json!(LIMECORE_POLICY_DECISION_SOURCE_LOCAL_DEFAULT)
        );
        assert_eq!(
            snapshot["decision_scope"],
            json!(LIMECORE_POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY)
        );
    }

    #[test]
    fn tenant_feature_flags_hit_from_bootstrap_should_resolve_browser_ref() {
        let contract = runtime_contract_with_policy_hits_from_request_metadata(
            browser_control_runtime_contract(),
            Some(&json!({
                "harness": {
                    "tenant_feature_flags": {
                        "tenant_id": "tenant-1",
                        "source": "oem_cloud_bootstrap",
                        "flags": {
                            "gatewayEnabled": true,
                            "billingEnabled": false,
                            "profileEditable": true
                        }
                    }
                }
            })),
        );
        let snapshot = &contract["limecore_policy_snapshot"];

        assert_eq!(snapshot["evaluated_refs"], json!(["tenant_feature_flags"]));
        assert_eq!(snapshot["missing_inputs"], json!(["gateway_policy"]));
        assert_eq!(snapshot["policy_value_hit_count"], json!(1));
        assert_eq!(
            snapshot["policy_value_hits"][0]["value_source"],
            json!("oem_cloud_bootstrap_features")
        );
        assert_eq!(
            snapshot["policy_value_hits"][0]["value"]["tenant_id"],
            json!("tenant-1")
        );
        assert_eq!(
            snapshot["policy_value_hits"][0]["value"]["flags"]["gatewayEnabled"],
            json!(true)
        );
        assert_eq!(
            snapshot["policy_value_hits"][0]["value"]["enabled_feature_keys"],
            json!(["gatewayEnabled", "profileEditable"])
        );
        assert!(snapshot["policy_value_hits"][0]["value"]
            .get("limecore_policy_snapshot")
            .is_none());
        assert_eq!(
            snapshot["decision_scope"],
            json!(LIMECORE_POLICY_DECISION_SCOPE_LOCAL_DEFAULTS_ONLY)
        );
    }

    #[test]
    fn request_policy_hits_should_resolve_gateway_and_tenant_refs_together() {
        let contract = runtime_contract_with_policy_hits_from_request_metadata(
            web_research_runtime_contract(),
            Some(&json!({
                "harness": {
                    "oem_routing": {
                        "tenant_id": "tenant-1",
                        "provider_source": "oem_cloud",
                        "provider_key": "lime-hub"
                    },
                    "tenant_feature_flags": {
                        "tenant_id": "tenant-1",
                        "flags": {
                            "gatewayEnabled": true,
                            "referralEnabled": false
                        }
                    }
                }
            })),
        );
        let snapshot = &contract["limecore_policy_snapshot"];

        assert_eq!(
            snapshot["evaluated_refs"],
            json!(["gateway_policy", "tenant_feature_flags"])
        );
        assert_eq!(snapshot["missing_inputs"], json!(["model_catalog"]));
        assert_eq!(snapshot["pending_hit_refs"], json!(["model_catalog"]));
        assert_eq!(snapshot["policy_value_hit_count"], json!(2));
        assert_eq!(
            snapshot["policy_inputs"][0]["value_source"],
            json!("request_oem_routing")
        );
        assert_eq!(
            snapshot["policy_inputs"][1]["value_source"],
            json!("oem_cloud_bootstrap_features")
        );
    }

    #[test]
    fn policy_input_evaluator_should_allow_when_all_refs_resolved_without_signals() {
        let contract = runtime_contract_with_policy_hits_from_request_metadata(
            browser_control_runtime_contract(),
            Some(&json!({
                "harness": {
                    "oem_routing": {
                        "tenant_id": "tenant-1",
                        "provider_source": "oem_cloud",
                        "provider_key": "lime-hub",
                        "can_invoke": true
                    },
                    "tenant_feature_flags": {
                        "tenant_id": "tenant-1",
                        "flags": {
                            "gatewayEnabled": true
                        }
                    }
                }
            })),
        );
        let snapshot = &contract["limecore_policy_snapshot"];

        assert_eq!(
            snapshot["status"],
            json!(LIMECORE_POLICY_SNAPSHOT_STATUS_POLICY_INPUTS_EVALUATED)
        );
        assert_eq!(snapshot["decision"], json!(LIMECORE_POLICY_DECISION_ALLOW));
        assert_eq!(
            snapshot["decision_source"],
            json!(LIMECORE_POLICY_DECISION_SOURCE_POLICY_INPUT_EVALUATOR)
        );
        assert_eq!(
            snapshot["decision_scope"],
            json!(LIMECORE_POLICY_DECISION_SCOPE_RESOLVED_POLICY_INPUTS)
        );
        assert_eq!(
            snapshot["decision_reason"],
            json!(LIMECORE_POLICY_DECISION_REASON_ALL_INPUTS_RESOLVED)
        );
        assert_eq!(snapshot["missing_inputs"], json!([]));
        assert_eq!(snapshot["policy_evaluation"]["status"], json!("evaluated"));
        assert_eq!(snapshot["policy_evaluation"]["blocking_refs"], json!([]));
    }

    #[test]
    fn policy_input_evaluator_should_deny_gateway_block_signal() {
        let contract = runtime_contract_with_policy_hits_from_request_metadata(
            browser_control_runtime_contract(),
            Some(&json!({
                "harness": {
                    "oem_routing": {
                        "tenant_id": "tenant-1",
                        "provider_source": "oem_cloud",
                        "provider_key": "lime-hub",
                        "can_invoke": false
                    },
                    "tenant_feature_flags": {
                        "tenant_id": "tenant-1",
                        "flags": {
                            "gatewayEnabled": true
                        }
                    }
                }
            })),
        );
        let snapshot = &contract["limecore_policy_snapshot"];

        assert_eq!(snapshot["decision"], json!(LIMECORE_POLICY_DECISION_DENY));
        assert_eq!(
            snapshot["decision_reason"],
            json!(LIMECORE_POLICY_DECISION_REASON_DENY_SIGNAL)
        );
        assert_eq!(
            snapshot["policy_evaluation"]["blocking_refs"],
            json!(["gateway_policy"])
        );
    }

    #[test]
    fn policy_input_evaluator_should_ask_for_gateway_quota_low() {
        let contract = runtime_contract_with_policy_hits_from_request_metadata(
            browser_control_runtime_contract(),
            Some(&json!({
                "harness": {
                    "oem_routing": {
                        "tenant_id": "tenant-1",
                        "provider_source": "oem_cloud",
                        "provider_key": "lime-hub",
                        "quota_status": "low",
                        "can_invoke": true
                    },
                    "tenant_feature_flags": {
                        "tenant_id": "tenant-1",
                        "flags": {
                            "gatewayEnabled": true
                        }
                    }
                }
            })),
        );
        let snapshot = &contract["limecore_policy_snapshot"];

        assert_eq!(snapshot["decision"], json!(LIMECORE_POLICY_DECISION_ASK));
        assert_eq!(
            snapshot["decision_reason"],
            json!(LIMECORE_POLICY_DECISION_REASON_ASK_SIGNAL)
        );
        assert_eq!(
            snapshot["policy_evaluation"]["ask_refs"],
            json!(["gateway_policy"])
        );
    }

    #[test]
    fn tenant_feature_flags_hydrator_should_not_fake_empty_flags() {
        let mut metadata = json!({
            "harness": {
                "tenant_feature_flags": {
                    "tenant_id": "tenant-1"
                },
                "browser_assist": {
                    "runtime_contract": browser_control_runtime_contract()
                }
            }
        });

        hydrate_limecore_policy_hits_from_request_metadata(&mut metadata);

        let snapshot = metadata
            .pointer("/harness/browser_assist/runtime_contract/limecore_policy_snapshot")
            .expect("browser policy snapshot");
        assert_eq!(snapshot["policy_value_hit_count"], json!(0));
        assert_eq!(snapshot["policy_value_hits"], json!([]));
        assert_eq!(
            snapshot["missing_inputs"],
            json!(["tenant_feature_flags", "gateway_policy"])
        );
    }

    #[test]
    fn gateway_policy_hydrator_should_not_fake_non_gateway_refs() {
        let mut metadata = json!({
            "harness": {
                "oem_routing": {
                    "tenant_id": "tenant-1",
                    "provider_source": "oem_cloud",
                    "provider_key": "lime-hub"
                },
                "image_skill_launch": {
                    "image_task": {
                        "runtime_contract": image_generation_runtime_contract()
                    }
                }
            }
        });

        hydrate_limecore_gateway_policy_hits_from_oem_routing(&mut metadata);

        let snapshot = metadata
            .pointer(
                "/harness/image_skill_launch/image_task/runtime_contract/limecore_policy_snapshot",
            )
            .expect("image policy snapshot");
        assert_eq!(snapshot["policy_value_hit_count"], json!(0));
        assert_eq!(snapshot["policy_value_hits"], json!([]));
        assert_eq!(
            snapshot["missing_inputs"],
            json!(["model_catalog", "provider_offer", "tenant_feature_flags"])
        );
    }

    #[test]
    fn assess_image_generation_model_capability_should_reject_registered_text_model() {
        let mut model = model_metadata("lime-text-router", "lime");
        model.output_modalities = vec![ModelModality::Text];
        model.task_families = vec![ModelTaskFamily::Chat];
        let assessment = assess_image_generation_model_capability_from_registry(
            &[model],
            "lime-text-router",
            Some("lime"),
        )
        .expect("model should match registry");

        assert!(!assessment.supports_image_generation);
        assert_eq!(
            assessment.reason,
            "registry_missing_image_generation_capability"
        );
    }

    #[test]
    fn assess_image_generation_model_capability_should_match_provider_model_id() {
        let mut model = model_metadata("registry-id", "openai");
        model.provider_model_id = Some("gpt-image-1".to_string());
        model.task_families = vec![ModelTaskFamily::ImageGeneration];
        let assessment = assess_image_generation_model_capability_from_registry(
            &[model],
            "gpt-image-1",
            Some("openai"),
        )
        .expect("provider model id should match registry");

        assert_eq!(assessment.model_id, "registry-id");
        assert!(assessment.supports_image_generation);
    }
}
