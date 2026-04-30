use lime_core::models::model_registry::{EnhancedModelMetadata, ModelModality, ModelTaskFamily};
use serde_json::{json, Map, Value};

pub(crate) const IMAGE_GENERATION_CONTRACT_KEY: &str = "image_generation";
pub(crate) const IMAGE_GENERATION_MODALITY: &str = "image";
pub(crate) const IMAGE_GENERATION_ROUTING_SLOT: &str = "image_generation_model";
pub(crate) const IMAGE_GENERATION_EXECUTOR_BINDING_KEY: &str = "image_generate";
pub(crate) const IMAGE_GENERATION_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "image_generation", "vision_input"];
pub(crate) const BROWSER_CONTROL_CONTRACT_KEY: &str = "browser_control";
pub(crate) const BROWSER_CONTROL_MODALITY: &str = "browser";
pub(crate) const BROWSER_CONTROL_ROUTING_SLOT: &str = "browser_reasoning_model";
pub(crate) const BROWSER_CONTROL_EXECUTOR_BINDING_KEY: &str = "browser_assist";
pub(crate) const BROWSER_CONTROL_REQUIRED_CAPABILITIES: &[&str] = &[
    "text_generation",
    "browser_reasoning",
    "browser_control_planning",
];
pub(crate) const PDF_EXTRACT_CONTRACT_KEY: &str = "pdf_extract";
pub(crate) const PDF_EXTRACT_MODALITY: &str = "document";
pub(crate) const PDF_EXTRACT_ROUTING_SLOT: &str = "base_model";
pub(crate) const PDF_EXTRACT_EXECUTOR_BINDING_KEY: &str = "pdf_read";
pub(crate) const PDF_EXTRACT_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "local_file_read", "long_context"];
pub(crate) const VOICE_GENERATION_CONTRACT_KEY: &str = "voice_generation";
pub(crate) const VOICE_GENERATION_MODALITY: &str = "audio";
pub(crate) const VOICE_GENERATION_ROUTING_SLOT: &str = "voice_generation_model";
pub(crate) const VOICE_GENERATION_EXECUTOR_BINDING_KEY: &str = "voice_runtime";
pub(crate) const VOICE_GENERATION_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "voice_generation"];
pub(crate) const AUDIO_TRANSCRIPTION_CONTRACT_KEY: &str = "audio_transcription";
pub(crate) const AUDIO_TRANSCRIPTION_MODALITY: &str = "audio";
pub(crate) const AUDIO_TRANSCRIPTION_ROUTING_SLOT: &str = "audio_transcription_model";
pub(crate) const AUDIO_TRANSCRIPTION_EXECUTOR_BINDING_KEY: &str = "transcription_generate";
pub(crate) const AUDIO_TRANSCRIPTION_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "audio_transcription"];
pub(crate) const WEB_RESEARCH_CONTRACT_KEY: &str = "web_research";
pub(crate) const WEB_RESEARCH_MODALITY: &str = "mixed";
pub(crate) const WEB_RESEARCH_ROUTING_SLOT: &str = "report_generation_model";
pub(crate) const WEB_RESEARCH_EXECUTOR_BINDING_KEY: &str = "research";
pub(crate) const WEB_RESEARCH_REQUIRED_CAPABILITIES: &[&str] = &[
    "text_generation",
    "web_search",
    "structured_document_generation",
    "long_context",
];
pub(crate) const TEXT_TRANSFORM_CONTRACT_KEY: &str = "text_transform";
pub(crate) const TEXT_TRANSFORM_MODALITY: &str = "document";
pub(crate) const TEXT_TRANSFORM_ROUTING_SLOT: &str = "base_model";
pub(crate) const TEXT_TRANSFORM_EXECUTOR_BINDING_KEY: &str = "text_transform";
pub(crate) const TEXT_TRANSFORM_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "local_file_read", "long_context"];
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImageGenerationModelCapabilityAssessment {
    pub model_id: String,
    pub provider_id: Option<String>,
    pub source: &'static str,
    pub supports_image_generation: bool,
    pub reason: &'static str,
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

pub(crate) fn image_generation_runtime_contract() -> Value {
    json!({
        "contract_key": IMAGE_GENERATION_CONTRACT_KEY,
        "modality": IMAGE_GENERATION_MODALITY,
        "required_capabilities": IMAGE_GENERATION_REQUIRED_CAPABILITIES,
        "routing_slot": IMAGE_GENERATION_ROUTING_SLOT,
        "executor_binding": {
            "executor_kind": "skill",
            "binding_key": IMAGE_GENERATION_EXECUTOR_BINDING_KEY
        },
        "truth_source": ["image_task_artifact", "runtime_timeline_event"],
        "artifact_kinds": ["image_task", "image_output"],
        "viewer_surface": ["image_workbench"],
        "owner_surface": "agent_runtime"
    })
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
