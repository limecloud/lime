//! 已知模型描述直接取自上游 models-manager/models.json，不依赖代理域名。
//! 消费模型运行参数与基础指令；账号、服务控制面不进入本目录。

use lime_core::models::model_registry::{
    EnhancedModelMetadata, ModelCapabilityProvenance, ModelModality, ModelReasoningEffortSource,
    ModelReasoningEffortSupport, ModelRuntimeFeature, ModelTaskFamily,
};
use serde::Deserialize;
use std::sync::LazyLock;

pub const BASE_INSTRUCTIONS: &str = include_str!("prompt.md");

#[derive(Deserialize)]
struct ModelInfo {
    slug: String,
    model_messages: Option<serde_json::Value>,
    input_modalities: Vec<String>,
    context_window: Option<usize>,
    max_context_window: Option<usize>,
    default_reasoning_level: Option<String>,
    #[serde(default)]
    supported_reasoning_levels: Vec<ReasoningEffortPreset>,
    #[serde(default)]
    supports_reasoning_summary_parameter: bool,
    #[serde(default)]
    support_verbosity: bool,
}

#[derive(Deserialize)]
struct ReasoningEffortPreset {
    effort: String,
}

#[derive(Deserialize)]
struct ModelsResponse {
    models: Vec<ModelInfo>,
}

static MODELS: LazyLock<ModelsResponse> = LazyLock::new(|| {
    serde_json::from_str(include_str!("models.json"))
        .expect("bundled upstream model descriptors must be valid")
});

fn model_info_from_slug(slug: &str) -> Option<&'static ModelInfo> {
    let slug = slug.trim().strip_prefix("openai/").unwrap_or(slug.trim());
    MODELS.models.iter().find(|model| model.slug == slug)
}

pub(super) fn apply_model_info(metadata: &mut EnhancedModelMetadata) {
    let Some(model) = model_info_from_slug(&metadata.id) else {
        return;
    };
    metadata.model_messages = model.model_messages.clone();
    metadata.capability_provenance = ModelCapabilityProvenance::Canonical;
    metadata.input_modalities = model
        .input_modalities
        .iter()
        .filter_map(|value| match value.as_str() {
            "text" => Some(ModelModality::Text),
            "image" => Some(ModelModality::Image),
            _ => None,
        })
        .collect();
    metadata.output_modalities = vec![ModelModality::Text];
    metadata.task_families = vec![ModelTaskFamily::Chat];
    metadata.runtime_features = vec![
        ModelRuntimeFeature::Streaming,
        ModelRuntimeFeature::ToolCalling,
    ];
    let caps = &mut metadata.capabilities;
    caps.tools = true;
    caps.function_calling = true;
    caps.streaming = true;
    caps.vision = metadata.input_modalities.contains(&ModelModality::Image);
    caps.reasoning = !model.supported_reasoning_levels.is_empty();
    caps.supports_reasoning_summaries = model.supports_reasoning_summary_parameter;
    caps.support_verbosity = model.support_verbosity;
    if caps.vision {
        metadata
            .task_families
            .push(ModelTaskFamily::VisionUnderstanding);
    }
    if caps.reasoning {
        metadata.task_families.push(ModelTaskFamily::Reasoning);
        metadata
            .runtime_features
            .push(ModelRuntimeFeature::Reasoning);
        caps.reasoning_effort = Some(ModelReasoningEffortSupport {
            supported: true,
            levels: model
                .supported_reasoning_levels
                .iter()
                .map(|preset| preset.effort.clone())
                .collect(),
            options: Vec::new(),
            default: model.default_reasoning_level.clone(),
            source: Some(ModelReasoningEffortSource::Registry),
        });
    }
    metadata.limits.context_length = model.context_window.and_then(|value| value.try_into().ok());
    metadata.limits.max_context_length = model
        .max_context_window
        .and_then(|value| value.try_into().ok());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_registry_service::ModelRegistryService;

    #[test]
    fn custom_endpoint_model_uses_exact_upstream_descriptor_without_manual_capabilities() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let service = ModelRegistryService::new(std::sync::Arc::new(std::sync::Mutex::new(conn)));
        let metadata = service.build_declared_model_metadata_for_endpoint(
            "custom-gateway",
            "https://gateway.example/v1",
            &lime_core::models::model_registry::ProviderModelConfig::hint("gpt-6.1-sol"),
        );
        assert_eq!(metadata.provider_id, "custom-gateway");
        assert_eq!(
            metadata.capability_provenance,
            ModelCapabilityProvenance::Canonical
        );
        assert!(metadata.capabilities.tools && metadata.capabilities.streaming);
        assert!(metadata.capabilities.supports_reasoning_summaries);
        let instructions = metadata
            .model_messages
            .as_ref()
            .and_then(|messages| messages.get("instructions_template"))
            .and_then(serde_json::Value::as_str)
            .expect("model instructions");
        assert!(instructions.starts_with("You are Lime, an agent based on GPT-6."));
        assert!(instructions.contains("When to ask the user for permission"));
        assert!(!instructions.contains("memory.soul"));
        let effort = metadata.capabilities.reasoning_effort.unwrap();
        assert_eq!(effort.default.as_deref(), Some("low"));
        assert!(effort.levels.contains(&"high".to_string()));
        assert!(effort.levels.contains(&"ultra".to_string()));
    }

    #[test]
    fn exact_lookup_does_not_invent_capabilities_for_similarly_named_models() {
        assert!(model_info_from_slug("gpt-6.1-sol").is_some());
        assert!(model_info_from_slug("openai/gpt-6.1-sol").is_some());
        assert!(model_info_from_slug("not-gpt-6.1-sol").is_none());
        assert!(model_info_from_slug("gpt-6.1-sol-fake").is_none());
    }

    #[test]
    fn explicit_provider_limits_override_the_bundled_descriptor() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let service = ModelRegistryService::new(std::sync::Arc::new(std::sync::Mutex::new(conn)));
        let config = lime_core::models::model_registry::ProviderModelConfig {
            id: "gpt-6.1-sol".to_string(),
            capability: Some(lime_core::models::model_registry::ProviderModelCapability {
                task_families: vec![ModelTaskFamily::Chat],
                input_modalities: vec![ModelModality::Text],
                output_modalities: vec![ModelModality::Text],
                ..Default::default()
            }),
            ..Default::default()
        };
        let model = service.build_declared_model_metadata_for_endpoint(
            "custom-gateway",
            "https://gateway.example/v1",
            &config,
        );
        assert_eq!(
            model.capability_provenance,
            ModelCapabilityProvenance::ProviderExplicit
        );
        assert!(!model.capabilities.tools && !model.capabilities.streaming);
        assert!(model.capabilities.reasoning_effort.is_none());
        assert_eq!(model.input_modalities, [ModelModality::Text]);
    }
}
