use lime_core::models::model_registry::{EnhancedModelMetadata, ModelModality, ModelTaskFamily};
use serde_json::{json, Map, Value};

pub(crate) const IMAGE_GENERATION_CONTRACT_KEY: &str = "image_generation";
pub(crate) const IMAGE_GENERATION_MODALITY: &str = "image";
pub(crate) const IMAGE_GENERATION_ROUTING_SLOT: &str = "image_generation_model";
pub(crate) const IMAGE_GENERATION_EXECUTOR_BINDING_KEY: &str = "image_generate";
pub(crate) const IMAGE_GENERATION_REQUIRED_CAPABILITIES: &[&str] =
    &["text_generation", "image_generation", "vision_input"];
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
