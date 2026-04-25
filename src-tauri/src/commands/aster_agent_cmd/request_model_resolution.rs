use super::*;
use crate::commands::aster_agent_cmd::service_skill_launch::extract_service_scene_launch_context;
use crate::commands::model_registry_cmd::ModelRegistryState;
use crate::config::GlobalConfigManagerState;
use lime_core::database::dao::api_key_provider::{ApiProviderType, ProviderGroup};
use lime_core::models::model_registry::{
    EnhancedModelMetadata, ModelCapabilities, ModelDeploymentSource, ModelManagementPlane,
    ModelModality, ModelPricing, ModelRuntimeFeature, ModelSource, ModelTaskFamily, ModelTier,
    ProviderAliasConfig,
};
use std::collections::HashSet;
use tauri::Manager;

const LIME_RUNTIME_METADATA_KEY: &str = "lime_runtime";

#[derive(Debug, Clone)]
struct ProviderResolutionContext {
    provider_selector: String,
    aster_provider_name: String,
    compatibility_provider_key: String,
    registry_provider_ids: Vec<String>,
    alias_key: String,
    custom_models: Vec<String>,
    is_custom_provider: bool,
    provider_type: Option<ApiProviderType>,
    provider_group: Option<ProviderGroup>,
    configured_api_host: Option<String>,
    has_credentials: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RuntimeProviderConfigurationStrategy {
    Manual { base_url: Option<String> },
    CredentialPool,
}

#[derive(Debug, Clone)]
pub(super) struct RuntimeRequestProviderResolution {
    pub provider_config: Option<ConfigureProviderRequest>,
    pub task_profile: lime_agent::SessionExecutionRuntimeTaskProfile,
    pub routing_decision: lime_agent::SessionExecutionRuntimeRoutingDecision,
    pub limit_state: lime_agent::SessionExecutionRuntimeLimitState,
    pub cost_state: lime_agent::SessionExecutionRuntimeCostState,
    pub limit_event: Option<lime_agent::SessionExecutionRuntimeLimitEvent>,
    pub oem_policy: Option<lime_agent::SessionExecutionRuntimeOemPolicy>,
    pub runtime_summary: lime_agent::SessionExecutionRuntimeSummary,
}

#[derive(Debug, Clone)]
struct ResolvedRuntimeProviderSelection {
    provider_config: ConfigureProviderRequest,
    provider_selector: String,
    requested_model: String,
    resolved_model: String,
    candidate_count: u32,
    estimated_cost_class: Option<String>,
    pricing: Option<ModelPricing>,
    capability_gap: Option<String>,
    fallback_chain: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RequestOemRoutingContext {
    pub tenant_id: String,
    pub provider_source: Option<String>,
    pub provider_key: Option<String>,
    pub default_model: Option<String>,
    pub config_mode: Option<String>,
    pub offer_state: Option<String>,
    pub quota_status: Option<String>,
    pub fallback_to_local_allowed: Option<bool>,
    pub can_invoke: Option<bool>,
}

fn normalize_identifier(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn canonical_provider_selector(provider_selector: &str) -> String {
    match normalize_identifier(provider_selector).as_str() {
        "mimo" | "xiaomimimo" => "xiaomi".to_string(),
        normalized => normalized.to_string(),
    }
}

const XIAOMI_HOST_KEYWORDS: [&str; 1] = ["xiaomimimo.com"];

fn provider_alias_config_key(provider_key: &str) -> String {
    match normalize_identifier(provider_key).as_str() {
        "gemini_api_key" => "gemini".to_string(),
        normalized => normalized.to_string(),
    }
}

fn provider_registry_id_from_key(provider_key: &str) -> String {
    match normalize_identifier(provider_key).as_str() {
        "openai" => "openai".to_string(),
        "anthropic" | "anthropic-compatible" | "claude" | "claude_oauth" => "anthropic".to_string(),
        "gemini" | "gemini_api_key" => "gemini".to_string(),
        "azure-openai" => "openai".to_string(),
        "vertexai" => "google".to_string(),
        "ollama" => "ollama".to_string(),
        "fal" => "fal".to_string(),
        "kiro" => "kiro".to_string(),
        "qwen" => "alibaba".to_string(),
        "codex" => "codex".to_string(),
        "antigravity" => "antigravity".to_string(),
        "iflow" => "openai".to_string(),
        normalized => normalized.to_string(),
    }
}

fn provider_type_from_key(provider_key: &str) -> Option<ApiProviderType> {
    match normalize_identifier(provider_key).as_str() {
        "openai" | "iflow" => Some(ApiProviderType::Openai),
        "anthropic" | "claude" | "claude_oauth" => Some(ApiProviderType::Anthropic),
        "anthropic-compatible" => Some(ApiProviderType::AnthropicCompatible),
        "gemini" | "gemini_api_key" => Some(ApiProviderType::Gemini),
        "azure-openai" => Some(ApiProviderType::AzureOpenai),
        "vertexai" => Some(ApiProviderType::Vertexai),
        "aws-bedrock" | "bedrock" => Some(ApiProviderType::AwsBedrock),
        "ollama" => Some(ApiProviderType::Ollama),
        "fal" => Some(ApiProviderType::Fal),
        "new-api" => Some(ApiProviderType::NewApi),
        "gateway" => Some(ApiProviderType::Gateway),
        "codex" => Some(ApiProviderType::Codex),
        _ => None,
    }
}

fn normalize_runtime_provider_base_url(
    provider_type: Option<ApiProviderType>,
    base_url: Option<String>,
) -> Option<String> {
    let normalized = normalize_optional_text(base_url)?;
    if provider_type != Some(ApiProviderType::Ollama) {
        return Some(normalized);
    }

    let trimmed = normalized.trim_end_matches('/').to_string();
    if let Some(without_version) = trimmed.strip_suffix("/v1") {
        return normalize_optional_text(Some(without_version.to_string())).or_else(|| {
            Some(
                ApiProviderType::Ollama
                    .runtime_spec()
                    .default_api_host
                    .to_string(),
            )
        });
    }

    Some(trimmed)
}

fn resolve_runtime_provider_configuration_strategy(
    context: &ProviderResolutionContext,
) -> RuntimeProviderConfigurationStrategy {
    let configured_base_url = normalize_runtime_provider_base_url(
        context.provider_type,
        context.configured_api_host.clone(),
    );
    let is_credentialless_local_provider =
        matches!(context.provider_group, Some(ProviderGroup::Local)) && !context.has_credentials;
    let should_use_manual_provider =
        is_credentialless_local_provider || context.provider_type == Some(ApiProviderType::Ollama);

    if !should_use_manual_provider {
        return RuntimeProviderConfigurationStrategy::CredentialPool;
    }

    let fallback_base_url = context.provider_type.map(|provider_type| {
        normalize_runtime_provider_base_url(
            Some(provider_type),
            Some(provider_type.runtime_spec().default_api_host.to_string()),
        )
        .unwrap_or_else(|| provider_type.runtime_spec().default_api_host.to_string())
    });

    RuntimeProviderConfigurationStrategy::Manual {
        base_url: configured_base_url.or(fallback_base_url),
    }
}

fn infer_reasoning_capability(model_id: &str) -> bool {
    let normalized = normalize_identifier(model_id);
    normalized.contains("thinking") || normalized.contains("reasoning")
}

fn text_contains_any(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| text.contains(keyword))
}

fn infer_vision_capability(
    model_id: &str,
    provider_id: Option<&str>,
    family: Option<&str>,
    description: Option<&str>,
) -> bool {
    let text = [
        normalize_identifier(model_id),
        family.map(normalize_identifier).unwrap_or_default(),
        description.map(normalize_identifier).unwrap_or_default(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    if text.is_empty() {
        return false;
    }

    let provider = provider_id.map(normalize_identifier).unwrap_or_default();

    if text_contains_any(
        &text,
        &[
            "embedding",
            "embed",
            "rerank",
            "tts",
            "stt",
            "transcribe",
            "transcription",
            "speech",
            "audio",
            "moderation",
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
        ],
    ) {
        return false;
    }

    if text_contains_any(
        &text,
        &[
            "vision",
            "multimodal",
            "multi-modal",
            "omni",
            "image-input",
            "image understanding",
        ],
    ) {
        return true;
    }

    let openai_like = text.contains("gpt-5")
        || text.contains("gpt-4o")
        || text.contains("gpt-4.1")
        || text.contains("gpt-4.5")
        || text.contains("codex");
    if provider == "openai" || provider == "codex" {
        return openai_like;
    }

    if provider == "gemini" {
        return text.contains("gemini");
    }

    if provider == "anthropic" || provider == "claude" {
        return text.contains("claude");
    }

    if provider == "qwen" || provider == "alibaba" {
        return (text.contains("qwen") && (text.contains("vl") || text.contains("vision")))
            || text.contains("qvq");
    }

    if provider == "zhipuai" {
        return text.contains("glm-") && text.contains('v');
    }

    openai_like
        || text.contains("gemini")
        || text.contains("claude")
        || text.contains("qvq")
        || (text.contains("qwen") && (text.contains("vl") || text.contains("vision")))
        || (text.contains("glm-") && text.contains('v'))
}

fn infer_model_capabilities(
    model_id: &str,
    provider_id: Option<&str>,
    task_families: &[ModelTaskFamily],
    family: Option<&str>,
    description: Option<&str>,
) -> ModelCapabilities {
    let specialized_only = task_families.iter().any(|family| {
        matches!(
            family,
            ModelTaskFamily::ImageGeneration
                | ModelTaskFamily::ImageEdit
                | ModelTaskFamily::SpeechToText
                | ModelTaskFamily::TextToSpeech
                | ModelTaskFamily::Embedding
                | ModelTaskFamily::Rerank
        )
    });

    ModelCapabilities {
        vision: task_families.contains(&ModelTaskFamily::VisionUnderstanding)
            || infer_vision_capability(model_id, provider_id, family, description),
        tools: !task_families.contains(&ModelTaskFamily::ImageGeneration),
        streaming: true,
        json_mode: !specialized_only,
        function_calling: !task_families.contains(&ModelTaskFamily::ImageGeneration)
            && !task_families.contains(&ModelTaskFamily::ImageEdit)
            && !task_families.contains(&ModelTaskFamily::SpeechToText)
            && !task_families.contains(&ModelTaskFamily::TextToSpeech)
            && !task_families.contains(&ModelTaskFamily::Embedding)
            && !task_families.contains(&ModelTaskFamily::Rerank),
        reasoning: task_families.contains(&ModelTaskFamily::Reasoning)
            || infer_reasoning_capability(model_id)
            || provider_id.map(normalize_identifier).as_deref() == Some("codex"),
    }
}

fn infer_model_task_families(
    model_id: &str,
    provider_id: Option<&str>,
    family: Option<&str>,
    description: Option<&str>,
) -> Vec<ModelTaskFamily> {
    let text = [
        normalize_identifier(model_id),
        family.map(normalize_identifier).unwrap_or_default(),
        description.map(normalize_identifier).unwrap_or_default(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    let inferred_vision = infer_vision_capability(model_id, provider_id, family, description);
    let inferred_reasoning = infer_reasoning_capability(model_id);
    let is_embedding = text_contains_any(&text, &["embedding", "embed", "text-embedding"]);
    let is_rerank = text_contains_any(&text, &["rerank", "re-rank"]);
    let is_moderation = text_contains_any(&text, &["moderation"]);
    let is_speech_to_text = text_contains_any(
        &text,
        &[
            "stt",
            "asr",
            "speech-to-text",
            "speech to text",
            "transcribe",
            "transcription",
            "whisper",
        ],
    );
    let is_text_to_speech = text_contains_any(
        &text,
        &[
            "tts",
            "text-to-speech",
            "text to speech",
            "speech synthesis",
            "voice-synth",
        ],
    );
    let is_image_generation = text_contains_any(
        &text,
        &[
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
        ],
    );
    let is_image_edit = text_contains_any(
        &text,
        &[
            "edit",
            "inpaint",
            "outpaint",
            "img2img",
            "image-edit",
            "image_edit",
            "image edits",
        ],
    );

    let mut families = Vec::new();
    if is_embedding {
        families.push(ModelTaskFamily::Embedding);
    }
    if is_rerank {
        families.push(ModelTaskFamily::Rerank);
    }
    if is_moderation {
        families.push(ModelTaskFamily::Moderation);
    }
    if is_speech_to_text {
        families.push(ModelTaskFamily::SpeechToText);
    }
    if is_text_to_speech {
        families.push(ModelTaskFamily::TextToSpeech);
    }
    if is_image_generation {
        families.push(ModelTaskFamily::ImageGeneration);
    }
    if is_image_edit {
        families.push(ModelTaskFamily::ImageEdit);
    }
    if inferred_vision && !is_image_generation {
        families.push(ModelTaskFamily::VisionUnderstanding);
    }
    if inferred_reasoning {
        families.push(ModelTaskFamily::Reasoning);
    }

    let specialized_only = families.iter().any(|family| {
        matches!(
            family,
            ModelTaskFamily::Embedding
                | ModelTaskFamily::Rerank
                | ModelTaskFamily::Moderation
                | ModelTaskFamily::SpeechToText
                | ModelTaskFamily::TextToSpeech
                | ModelTaskFamily::ImageGeneration
                | ModelTaskFamily::ImageEdit
        )
    });
    if !specialized_only || inferred_vision || inferred_reasoning {
        families.push(ModelTaskFamily::Chat);
    }

    families
}

fn infer_input_modalities(task_families: &[ModelTaskFamily]) -> Vec<ModelModality> {
    let mut modalities = vec![ModelModality::Text];
    if task_families.contains(&ModelTaskFamily::SpeechToText) {
        modalities.push(ModelModality::Audio);
    }
    if task_families.contains(&ModelTaskFamily::ImageEdit)
        || task_families.contains(&ModelTaskFamily::VisionUnderstanding)
    {
        modalities.push(ModelModality::Image);
    }
    modalities
}

fn infer_output_modalities(
    task_families: &[ModelTaskFamily],
    capabilities: &ModelCapabilities,
) -> Vec<ModelModality> {
    let mut modalities = Vec::new();
    if task_families.iter().any(|family| {
        matches!(
            family,
            ModelTaskFamily::Chat
                | ModelTaskFamily::Reasoning
                | ModelTaskFamily::VisionUnderstanding
                | ModelTaskFamily::SpeechToText
                | ModelTaskFamily::Rerank
                | ModelTaskFamily::Moderation
        )
    }) {
        modalities.push(ModelModality::Text);
    }
    if task_families.contains(&ModelTaskFamily::ImageGeneration)
        || task_families.contains(&ModelTaskFamily::ImageEdit)
    {
        modalities.push(ModelModality::Image);
    }
    if task_families.contains(&ModelTaskFamily::TextToSpeech) {
        modalities.push(ModelModality::Audio);
    }
    if task_families.contains(&ModelTaskFamily::Embedding) {
        modalities.push(ModelModality::Embedding);
    }
    if capabilities.json_mode && !task_families.contains(&ModelTaskFamily::SpeechToText) {
        modalities.push(ModelModality::Json);
    }
    modalities
}

fn infer_runtime_features(
    provider_id: &str,
    task_families: &[ModelTaskFamily],
    capabilities: &ModelCapabilities,
) -> Vec<ModelRuntimeFeature> {
    let mut features = vec![ModelRuntimeFeature::Streaming];
    if capabilities.tools || capabilities.function_calling {
        features.push(ModelRuntimeFeature::ToolCalling);
    }
    if capabilities.json_mode {
        features.push(ModelRuntimeFeature::JsonSchema);
    }
    if capabilities.reasoning || task_families.contains(&ModelTaskFamily::Reasoning) {
        features.push(ModelRuntimeFeature::Reasoning);
    }
    match normalize_identifier(provider_id).as_str() {
        "codex" => features.push(ModelRuntimeFeature::ResponsesApi),
        "openai" | "new-api" | "azure-openai" | "gateway" => {
            features.push(ModelRuntimeFeature::ChatCompletionsApi)
        }
        _ => {}
    }
    if task_families.contains(&ModelTaskFamily::ImageGeneration)
        || task_families.contains(&ModelTaskFamily::ImageEdit)
    {
        features.push(ModelRuntimeFeature::ImagesApi);
    }
    features
}

fn infer_deployment_source(provider_id: &str) -> ModelDeploymentSource {
    let normalized = normalize_identifier(provider_id);
    if text_contains_any(
        &normalized,
        &["ollama", "lmstudio", "gpustack", "ovms", "comfyui"],
    ) {
        return ModelDeploymentSource::Local;
    }
    ModelDeploymentSource::UserCloud
}

fn build_inferred_model_metadata(
    model_id: &str,
    provider_id: &str,
    family: Option<String>,
    description: Option<String>,
) -> EnhancedModelMetadata {
    let now = chrono::Utc::now().timestamp();
    let task_families = infer_model_task_families(
        model_id,
        Some(provider_id),
        family.as_deref(),
        description.as_deref(),
    );
    let capabilities = infer_model_capabilities(
        model_id,
        Some(provider_id),
        &task_families,
        family.as_deref(),
        description.as_deref(),
    );
    let input_modalities = infer_input_modalities(&task_families);
    let output_modalities = infer_output_modalities(&task_families, &capabilities);
    let runtime_features = infer_runtime_features(provider_id, &task_families, &capabilities);
    let deployment_source = infer_deployment_source(provider_id);
    EnhancedModelMetadata {
        id: model_id.to_string(),
        display_name: model_id.to_string(),
        provider_id: provider_id.to_string(),
        provider_name: provider_id.to_string(),
        family: family.clone(),
        tier: ModelTier::Pro,
        capabilities,
        task_families,
        input_modalities,
        output_modalities,
        runtime_features,
        deployment_source,
        management_plane: ModelManagementPlane::LocalSettings,
        canonical_model_id: None,
        provider_model_id: Some(model_id.to_string()),
        alias_source: None,
        pricing: None,
        limits: Default::default(),
        status: Default::default(),
        release_date: None,
        is_latest: false,
        description,
        source: ModelSource::Custom,
        created_at: now,
        updated_at: now,
    }
}

fn merge_model_catalog(
    target: &mut Vec<EnhancedModelMetadata>,
    incoming: impl IntoIterator<Item = EnhancedModelMetadata>,
) {
    for candidate in incoming {
        let normalized_id = normalize_identifier(&candidate.id);
        if let Some(existing_index) = target
            .iter()
            .position(|model| normalize_identifier(&model.id) == normalized_id)
        {
            target[existing_index] = candidate;
        } else {
            target.push(candidate);
        }
    }
}

fn build_provider_resolution_context(
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    provider_selector: &str,
) -> Result<ProviderResolutionContext, String> {
    let provider_selector = canonical_provider_selector(provider_selector);
    let is_custom_provider =
        lime_core::models::provider_type::is_custom_provider_id(&provider_selector);
    let mut provider_type = provider_type_from_key(&provider_selector);
    let mut aster_provider_name = provider_type
        .map(|provider_type| provider_type.runtime_spec().aster_provider_name.to_string())
        .unwrap_or_else(|| provider_selector.clone());
    let mut compatibility_provider_key = provider_selector.clone();
    let mut registry_provider_ids = vec![
        provider_selector.clone(),
        provider_registry_id_from_key(&provider_selector),
    ];
    let mut custom_models = Vec::new();
    let mut provider_group = None;
    let mut configured_api_host = None;
    let mut has_credentials = false;

    if let Some(provider_with_keys) = api_key_provider_service
        .0
        .get_provider(db, &provider_selector)?
    {
        provider_type = Some(provider_with_keys.provider.provider_type);
        aster_provider_name = provider_with_keys
            .provider
            .provider_type
            .runtime_spec()
            .aster_provider_name
            .to_string();
        provider_group = Some(provider_with_keys.provider.group);
        configured_api_host =
            normalize_optional_text(Some(provider_with_keys.provider.api_host.clone()));
        has_credentials = !provider_with_keys.api_keys.is_empty();

        if is_custom_provider {
            compatibility_provider_key = provider_with_keys.provider.provider_type.to_string();
            registry_provider_ids.push(provider_registry_id_from_key(&compatibility_provider_key));
            custom_models = provider_with_keys.provider.custom_models;
        }
    }

    let mut seen = HashSet::new();
    registry_provider_ids.retain(|provider_id| {
        !provider_id.trim().is_empty() && seen.insert(normalize_identifier(provider_id))
    });

    let mut context = ProviderResolutionContext {
        aster_provider_name,
        alias_key: provider_alias_config_key(&provider_selector),
        compatibility_provider_key,
        custom_models,
        configured_api_host,
        has_credentials,
        is_custom_provider,
        provider_group,
        provider_type,
        provider_selector,
        registry_provider_ids,
    };
    context.custom_models = canonicalize_provider_custom_models(&context, &context.custom_models);

    Ok(context)
}

async fn load_model_registry_catalog(
    app: &AppHandle,
    context: &ProviderResolutionContext,
) -> (Vec<EnhancedModelMetadata>, Option<ProviderAliasConfig>) {
    let mut catalog = context
        .custom_models
        .iter()
        .map(|model_id| {
            build_inferred_model_metadata(model_id, &context.provider_selector, None, None)
        })
        .collect::<Vec<_>>();

    let model_registry_state = app.state::<ModelRegistryState>();
    let guard = model_registry_state.read().await;
    let Some(service) = guard.as_ref() else {
        return (catalog, None);
    };

    let all_models = service.get_all_models().await;
    let alias_config = service.get_provider_alias_config(&context.alias_key).await;
    drop(guard);

    if let Some(config) = alias_config.as_ref() {
        merge_model_catalog(
            &mut catalog,
            config.models.iter().map(|model_id| {
                let alias = config.aliases.get(model_id);
                build_inferred_model_metadata(
                    model_id,
                    &context.provider_selector,
                    alias.and_then(|item| item.provider.clone()),
                    alias.and_then(|item| item.description.clone()),
                )
            }),
        );
    }

    let registry_models = all_models.into_iter().filter(|model| {
        context
            .registry_provider_ids
            .iter()
            .any(|provider_id| provider_id == &normalize_identifier(&model.provider_id))
    });
    merge_model_catalog(&mut catalog, registry_models);

    (catalog, alias_config)
}

fn normalize_base_model_key(model_id: &str) -> String {
    let normalized_model_id = normalize_identifier(model_id);
    let tokens = normalized_model_id
        .split(|ch| ['.', '_', '-', '/'].contains(&ch))
        .filter(|token| !token.is_empty() && *token != "thinking" && *token != "reasoning")
        .collect::<Vec<_>>();
    tokens.join("-")
}

fn find_model_meta<'a>(
    model_id: &str,
    models: &'a [EnhancedModelMetadata],
) -> Option<&'a EnhancedModelMetadata> {
    let normalized = normalize_identifier(model_id);
    models
        .iter()
        .find(|model| normalize_identifier(&model.id) == normalized)
}

fn is_xiaomi_like_provider_context(context: &ProviderResolutionContext) -> bool {
    let provider_selector = normalize_identifier(&context.provider_selector);
    let compatibility_provider = normalize_identifier(&context.compatibility_provider_key);
    let provider_type = context
        .provider_type
        .map(|provider_type| normalize_identifier(&provider_type.to_string()))
        .unwrap_or_default();
    let api_host = context
        .configured_api_host
        .as_deref()
        .map(normalize_identifier)
        .unwrap_or_default();

    matches!(provider_selector.as_str(), "xiaomi" | "mimo" | "xiaomimimo")
        || matches!(
            compatibility_provider.as_str(),
            "xiaomi" | "mimo" | "xiaomimimo"
        )
        || matches!(provider_type.as_str(), "xiaomi" | "mimo" | "xiaomimimo")
        || XIAOMI_HOST_KEYWORDS
            .iter()
            .any(|keyword| api_host.contains(keyword))
}

fn canonicalize_xiaomi_model_id(model_id: &str) -> String {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    match normalize_identifier(trimmed).as_str() {
        "mimo-v2-pro" | "mimo-v2.5" | "mimo-v2.5-pro" => "mimo-v2.5-pro".to_string(),
        _ => trimmed.to_string(),
    }
}

fn canonicalize_known_provider_model_id(
    context: &ProviderResolutionContext,
    model_id: &str,
) -> String {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if is_xiaomi_like_provider_context(context) {
        return canonicalize_xiaomi_model_id(trimmed);
    }

    trimmed.to_string()
}

fn canonicalize_provider_custom_models(
    context: &ProviderResolutionContext,
    model_ids: &[String],
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for model_id in model_ids {
        let canonical = canonicalize_known_provider_model_id(context, model_id);
        if canonical.is_empty() {
            continue;
        }

        if seen.insert(normalize_identifier(&canonical)) {
            result.push(canonical);
        }
    }

    result
}

fn model_has_reasoning_capability(
    model: Option<&EnhancedModelMetadata>,
    fallback_model_id: &str,
) -> bool {
    model
        .map(|item| {
            item.capabilities.reasoning || item.supports_task_family(&ModelTaskFamily::Reasoning)
        })
        .unwrap_or(false)
        || infer_reasoning_capability(fallback_model_id)
}

fn compare_release_date_desc(left: &EnhancedModelMetadata, right: &EnhancedModelMetadata) -> i32 {
    match (left.release_date.as_deref(), right.release_date.as_deref()) {
        (Some(left_date), Some(right_date)) => right_date.cmp(left_date) as i32,
        (Some(_), None) => -1,
        (None, Some(_)) => 1,
        (None, None) => 0,
    }
}

fn sort_reasoning_candidates<'a>(
    mut candidates: Vec<&'a EnhancedModelMetadata>,
    current_model_id: &str,
) -> Vec<&'a EnhancedModelMetadata> {
    let normalized_current_id = normalize_identifier(current_model_id);
    let exact_preferred_ids = [
        format!("{normalized_current_id}-thinking"),
        format!("{normalized_current_id}_thinking"),
        format!("{normalized_current_id}-reasoning"),
        format!("{normalized_current_id}_reasoning"),
    ];

    candidates.sort_by(|left, right| {
        let left_exact = exact_preferred_ids
            .iter()
            .any(|candidate| candidate == &normalize_identifier(&left.id));
        let right_exact = exact_preferred_ids
            .iter()
            .any(|candidate| candidate == &normalize_identifier(&right.id));
        left_exact
            .cmp(&right_exact)
            .reverse()
            .then(left.is_latest.cmp(&right.is_latest).reverse())
            .then(compare_release_date_desc(left, right).cmp(&0))
            .then(left.id.cmp(&right.id))
    });

    candidates
}

fn resolve_thinking_model_id(current_model_id: &str, models: &[EnhancedModelMetadata]) -> String {
    let current_model = find_model_meta(current_model_id, models);
    if model_has_reasoning_capability(current_model, current_model_id) {
        return current_model
            .map(|model| model.id.clone())
            .unwrap_or_else(|| current_model_id.to_string());
    }

    let current_base_key = normalize_base_model_key(current_model_id);
    let candidates = models
        .iter()
        .filter(|candidate| {
            model_has_reasoning_capability(Some(candidate), &candidate.id)
                && normalize_base_model_key(&candidate.id) == current_base_key
        })
        .collect::<Vec<_>>();
    sort_reasoning_candidates(candidates, current_model_id)
        .into_iter()
        .next()
        .map(|model| model.id.clone())
        .unwrap_or_else(|| current_model_id.to_string())
}

fn resolve_base_model_on_thinking_off(
    current_model_id: &str,
    models: &[EnhancedModelMetadata],
) -> String {
    let current_model = find_model_meta(current_model_id, models);
    if !model_has_reasoning_capability(current_model, current_model_id) {
        return current_model
            .map(|model| model.id.clone())
            .unwrap_or_else(|| current_model_id.to_string());
    }

    let current_base_key = normalize_base_model_key(current_model_id);
    let candidates = models
        .iter()
        .filter(|candidate| {
            !model_has_reasoning_capability(Some(candidate), &candidate.id)
                && normalize_base_model_key(&candidate.id) == current_base_key
        })
        .collect::<Vec<_>>();

    sort_reasoning_candidates(candidates, current_model_id)
        .into_iter()
        .next()
        .map(|model| model.id.clone())
        .unwrap_or_else(|| current_model_id.to_string())
}

fn normalize_model_lineage_key(model_id: &str) -> String {
    let normalized = normalize_identifier(model_id);
    let primary = normalized
        .split('/')
        .find(|part| !part.is_empty())
        .unwrap_or(normalized.as_str());

    let mut lineage = String::new();
    for ch in primary.chars() {
        if ch.is_ascii_alphabetic() {
            lineage.push(ch);
            continue;
        }
        if !lineage.is_empty() {
            break;
        }
    }

    if !lineage.is_empty() {
        return lineage;
    }

    primary
        .split(|ch| ['.', '_', '-'].contains(&ch))
        .find(|part| !part.is_empty())
        .unwrap_or(primary)
        .to_string()
}

fn is_likely_non_chat_model(model: &EnhancedModelMetadata) -> bool {
    let has_specialized_non_chat_family = model.task_families.iter().any(|family| {
        matches!(
            family,
            ModelTaskFamily::Embedding
                | ModelTaskFamily::Rerank
                | ModelTaskFamily::Moderation
                | ModelTaskFamily::SpeechToText
                | ModelTaskFamily::TextToSpeech
                | ModelTaskFamily::ImageGeneration
                | ModelTaskFamily::ImageEdit
        )
    });
    if has_specialized_non_chat_family
        && !model.supports_task_family(&ModelTaskFamily::Chat)
        && !model.supports_task_family(&ModelTaskFamily::Reasoning)
        && !model.supports_task_family(&ModelTaskFamily::VisionUnderstanding)
    {
        return true;
    }

    let text = [
        normalize_identifier(&model.id),
        normalize_identifier(&model.display_name),
        model
            .family
            .as_deref()
            .map(normalize_identifier)
            .unwrap_or_default(),
        model
            .description
            .as_deref()
            .map(normalize_identifier)
            .unwrap_or_default(),
    ]
    .join(" ");

    is_likely_image_generation_model(model)
        || text_contains_any(
            &text,
            &[
                "embedding",
                "embed",
                "rerank",
                "tts",
                "stt",
                "transcribe",
                "transcription",
                "speech",
                "audio",
                "moderation",
            ],
        )
}

fn resolve_catalog_fallback_model_id(
    current_model_id: &str,
    models: &[EnhancedModelMetadata],
    prefer_reasoning: bool,
    prefer_vision: bool,
) -> String {
    if let Some(current_model) = find_model_meta(current_model_id, models) {
        return current_model.id.clone();
    }

    let current_base_key = normalize_base_model_key(current_model_id);
    let current_lineage_key = normalize_model_lineage_key(current_model_id);
    let mut candidates = models
        .iter()
        .filter(|candidate| !is_likely_non_chat_model(candidate))
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        let left_same_base = normalize_base_model_key(&left.id) == current_base_key;
        let right_same_base = normalize_base_model_key(&right.id) == current_base_key;
        let left_same_lineage = !current_lineage_key.is_empty()
            && normalize_model_lineage_key(&left.id) == current_lineage_key;
        let right_same_lineage = !current_lineage_key.is_empty()
            && normalize_model_lineage_key(&right.id) == current_lineage_key;
        let left_reasoning_match =
            model_has_reasoning_capability(Some(left), &left.id) == prefer_reasoning;
        let right_reasoning_match =
            model_has_reasoning_capability(Some(right), &right.id) == prefer_reasoning;
        let left_vision_match = supports_vision(Some(left), &left.id) == prefer_vision;
        let right_vision_match = supports_vision(Some(right), &right.id) == prefer_vision;

        left_same_base
            .cmp(&right_same_base)
            .reverse()
            .then(left_same_lineage.cmp(&right_same_lineage).reverse())
            .then(left_reasoning_match.cmp(&right_reasoning_match).reverse())
            .then(left_vision_match.cmp(&right_vision_match).reverse())
            .then(
                capability_score(left)
                    .cmp(&capability_score(right))
                    .reverse(),
            )
            .then(left.is_latest.cmp(&right.is_latest).reverse())
            .then(
                tier_weight(&left.tier)
                    .cmp(&tier_weight(&right.tier))
                    .reverse(),
            )
            .then(compare_release_date_desc(left, right).cmp(&0))
            .then(left.id.cmp(&right.id))
    });

    candidates
        .into_iter()
        .next()
        .map(|candidate| candidate.id.clone())
        .unwrap_or_else(|| current_model_id.to_string())
}

fn is_likely_image_generation_model(model: &EnhancedModelMetadata) -> bool {
    if model.supports_task_family(&ModelTaskFamily::ImageGeneration)
        || model.supports_task_family(&ModelTaskFamily::ImageEdit)
        || model.has_output_modality(&ModelModality::Image)
    {
        return true;
    }

    let text = [
        normalize_identifier(&model.id),
        normalize_identifier(&model.display_name),
        model
            .family
            .as_deref()
            .map(normalize_identifier)
            .unwrap_or_default(),
        model
            .description
            .as_deref()
            .map(normalize_identifier)
            .unwrap_or_default(),
    ]
    .join(" ");

    text_contains_any(
        &text,
        &[
            "imagen",
            "dall-e",
            "dalle",
            "stable-diffusion",
            "stable diffusion",
            "sdxl",
            "sd3",
            "midjourney",
            "image generation",
            "image-generation",
            "image-gen",
            "image-preview",
            "flux",
        ],
    ) && !model.capabilities.tools
        && !model.capabilities.function_calling
        && !model.capabilities.json_mode
}

fn supports_vision(model: Option<&EnhancedModelMetadata>, fallback_model_id: &str) -> bool {
    if let Some(item) = model {
        return item.capabilities.vision
            || item.supports_task_family(&ModelTaskFamily::VisionUnderstanding)
            || item.has_input_modality(&ModelModality::Image);
    }

    infer_vision_capability(fallback_model_id, None, None, None)
}

fn capability_score(model: &EnhancedModelMetadata) -> u8 {
    let mut score = 0;
    if model.capabilities.tools {
        score += 5;
    }
    if model.capabilities.function_calling {
        score += 4;
    }
    if model.capabilities.json_mode {
        score += 3;
    }
    if model.capabilities.reasoning {
        score += 2;
    }
    if model.capabilities.streaming {
        score += 1;
    }
    score
}

fn estimated_cost_rank(cost_class: Option<&str>) -> u8 {
    match cost_class.map(normalize_identifier).as_deref() {
        Some("low") => 3,
        Some("medium") => 2,
        Some("high") => 1,
        _ => 0,
    }
}

fn choose_best_multi_candidate_model(
    current_model_id: &str,
    models: &[EnhancedModelMetadata],
    thinking_enabled: bool,
    has_images: bool,
) -> Option<String> {
    let current_model = find_model_meta(current_model_id, models);
    let current_family = current_model
        .and_then(|model| model.family.as_deref())
        .map(normalize_identifier)
        .unwrap_or_else(|| normalize_model_lineage_key(current_model_id));
    let current_lineage = normalize_model_lineage_key(current_model_id);

    let mut candidates = models
        .iter()
        .filter(|candidate| is_compatible_candidate_model(candidate, thinking_enabled, has_images))
        .filter(|candidate| !is_likely_non_chat_model(candidate))
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        return None;
    }

    candidates.sort_by(|left, right| {
        let left_same_family = !current_family.is_empty()
            && left.family.as_deref().map(normalize_identifier) == Some(current_family.clone());
        let right_same_family = !current_family.is_empty()
            && right.family.as_deref().map(normalize_identifier) == Some(current_family.clone());
        let left_same_lineage =
            !current_lineage.is_empty() && normalize_model_lineage_key(&left.id) == current_lineage;
        let right_same_lineage = !current_lineage.is_empty()
            && normalize_model_lineage_key(&right.id) == current_lineage;
        let left_reasoning = model_has_reasoning_capability(Some(left), &left.id);
        let right_reasoning = model_has_reasoning_capability(Some(right), &right.id);
        let left_vision = supports_vision(Some(left), &left.id);
        let right_vision = supports_vision(Some(right), &right.id);
        let left_cost = estimated_cost_rank(estimate_cost_class(&left.id, Some(left)).as_deref());
        let right_cost =
            estimated_cost_rank(estimate_cost_class(&right.id, Some(right)).as_deref());

        left_same_family
            .cmp(&right_same_family)
            .reverse()
            .then(left_same_lineage.cmp(&right_same_lineage).reverse())
            .then(
                (left_reasoning == thinking_enabled)
                    .cmp(&(right_reasoning == thinking_enabled))
                    .reverse(),
            )
            .then(
                (left_vision == has_images)
                    .cmp(&(right_vision == has_images))
                    .reverse(),
            )
            .then(
                capability_score(left)
                    .cmp(&capability_score(right))
                    .reverse(),
            )
            .then(left_cost.cmp(&right_cost).reverse())
            .then(left.is_latest.cmp(&right.is_latest).reverse())
            .then(
                tier_weight(&left.tier)
                    .cmp(&tier_weight(&right.tier))
                    .reverse(),
            )
            .then(compare_release_date_desc(left, right).cmp(&0))
            .then(left.id.cmp(&right.id))
    });

    candidates.first().map(|model| model.id.clone())
}

fn should_auto_reselect_multi_candidate_model(context: &ProviderResolutionContext) -> bool {
    !context.is_custom_provider
}

fn choose_provider_permission_recovery_model(
    context: &ProviderResolutionContext,
    current_model_id: &str,
    models: &[EnhancedModelMetadata],
    thinking_enabled: bool,
    has_images: bool,
) -> Option<String> {
    if !context.is_custom_provider || !is_xiaomi_like_provider_context(context) {
        return None;
    }

    let normalized_current_id = normalize_identifier(current_model_id);
    let current_model = find_model_meta(current_model_id, models);
    let current_family = current_model
        .and_then(|model| model.family.as_deref())
        .map(normalize_identifier)
        .unwrap_or_else(|| normalize_model_lineage_key(current_model_id));
    let current_lineage = normalize_model_lineage_key(current_model_id);

    let mut candidates = models
        .iter()
        .filter(|candidate| normalize_identifier(&candidate.id) != normalized_current_id)
        .filter(|candidate| is_compatible_candidate_model(candidate, thinking_enabled, has_images))
        .filter(|candidate| !is_likely_non_chat_model(candidate))
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        return None;
    }

    candidates.sort_by(|left, right| {
        let left_same_family = !current_family.is_empty()
            && left.family.as_deref().map(normalize_identifier) == Some(current_family.clone());
        let right_same_family = !current_family.is_empty()
            && right.family.as_deref().map(normalize_identifier) == Some(current_family.clone());
        let left_same_lineage =
            !current_lineage.is_empty() && normalize_model_lineage_key(&left.id) == current_lineage;
        let right_same_lineage = !current_lineage.is_empty()
            && normalize_model_lineage_key(&right.id) == current_lineage;
        let left_non_flash = !normalize_identifier(&left.id).contains("flash");
        let right_non_flash = !normalize_identifier(&right.id).contains("flash");
        let left_reasoning_match =
            model_has_reasoning_capability(Some(left), &left.id) == thinking_enabled;
        let right_reasoning_match =
            model_has_reasoning_capability(Some(right), &right.id) == thinking_enabled;
        let left_vision_match = supports_vision(Some(left), &left.id) == has_images;
        let right_vision_match = supports_vision(Some(right), &right.id) == has_images;

        left_same_family
            .cmp(&right_same_family)
            .reverse()
            .then(left_same_lineage.cmp(&right_same_lineage).reverse())
            .then(left_non_flash.cmp(&right_non_flash).reverse())
            .then(left_reasoning_match.cmp(&right_reasoning_match).reverse())
            .then(left_vision_match.cmp(&right_vision_match).reverse())
            .then(
                capability_score(left)
                    .cmp(&capability_score(right))
                    .reverse(),
            )
            .then(left.is_latest.cmp(&right.is_latest).reverse())
            .then(
                tier_weight(&left.tier)
                    .cmp(&tier_weight(&right.tier))
                    .reverse(),
            )
            .then(compare_release_date_desc(left, right).cmp(&0))
            .then(left.id.cmp(&right.id))
    });

    candidates.first().map(|candidate| candidate.id.clone())
}

fn tier_weight(tier: &ModelTier) -> u8 {
    match tier {
        ModelTier::Mini => 1,
        ModelTier::Pro => 2,
        ModelTier::Max => 3,
    }
}

fn resolve_vision_model_id(
    current_model_id: &str,
    models: &[EnhancedModelMetadata],
) -> Result<String, String> {
    let current_model = find_model_meta(current_model_id, models);
    if supports_vision(current_model, current_model_id) {
        return Ok(current_model
            .map(|model| model.id.clone())
            .unwrap_or_else(|| current_model_id.to_string()));
    }

    let current_family = current_model
        .and_then(|model| model.family.as_deref())
        .map(normalize_identifier)
        .unwrap_or_default();
    let mut candidates = models
        .iter()
        .filter(|candidate| {
            supports_vision(Some(candidate), &candidate.id)
                && !is_likely_image_generation_model(candidate)
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        let left_same_family = !current_family.is_empty()
            && left.family.as_deref().map(normalize_identifier) == Some(current_family.clone());
        let right_same_family = !current_family.is_empty()
            && right.family.as_deref().map(normalize_identifier) == Some(current_family.clone());

        left_same_family
            .cmp(&right_same_family)
            .reverse()
            .then(
                capability_score(left)
                    .cmp(&capability_score(right))
                    .reverse(),
            )
            .then(left.is_latest.cmp(&right.is_latest).reverse())
            .then(
                tier_weight(&left.tier)
                    .cmp(&tier_weight(&right.tier))
                    .reverse(),
            )
            .then(compare_release_date_desc(left, right).cmp(&0))
            .then(left.id.cmp(&right.id))
    });

    candidates
        .into_iter()
        .next()
        .map(|model| model.id.clone())
        .ok_or_else(|| {
            "当前 Provider 没有可用的多模态模型，请切换到支持多模态的 Provider 或模型后再发送图片"
                .to_string()
        })
}

fn resolve_provider_model_compatibility(
    context: &ProviderResolutionContext,
    model_id: &str,
) -> String {
    let normalized_provider = normalize_identifier(&context.compatibility_provider_key);
    let canonical_model = canonicalize_known_provider_model_id(context, model_id);
    let normalized_model = normalize_identifier(&canonical_model);

    if normalized_provider == "codex" && normalized_model == "gpt-5.3-codex" {
        return "gpt-5.2-codex".to_string();
    }

    canonical_model
}

fn extract_request_thinking_enabled(request: &AsterChatRequest) -> Option<bool> {
    request.thinking_enabled.or_else(|| {
        extract_harness_bool(
            request.metadata.as_ref(),
            &["thinking_enabled", "thinkingEnabled"],
        )
    })
}

async fn resolve_request_thinking_enabled(request: &AsterChatRequest) -> Result<bool, String> {
    if let Some(thinking_enabled) = extract_request_thinking_enabled(request) {
        return Ok(thinking_enabled);
    }

    Ok(resolve_session_recent_preferences(&request.session_id)
        .await?
        .map(|preferences| preferences.thinking)
        .unwrap_or(false))
}

fn push_unique_profile_trait(traits: &mut Vec<String>, value: &str) {
    let Some(value) = normalize_optional_text(Some(value.to_string())) else {
        return;
    };
    if !traits.iter().any(|existing| existing == &value) {
        traits.push(value);
    }
}

fn extract_metadata_text(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .and_then(|value| normalize_optional_text(Some(value.to_string())))
    })
}

fn extract_metadata_bool(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<bool> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(serde_json::Value::as_bool))
}

fn extract_turn_context_runtime(
    request_metadata: Option<&serde_json::Value>,
) -> Option<&serde_json::Map<String, serde_json::Value>> {
    request_metadata
        .and_then(serde_json::Value::as_object)
        .and_then(|root| root.get(LIME_RUNTIME_METADATA_KEY))
        .and_then(serde_json::Value::as_object)
        .and_then(|runtime| runtime.get("task_profile"))
        .and_then(serde_json::Value::as_object)
}

pub(crate) fn resolve_request_oem_routing_context(
    request_metadata: Option<&serde_json::Value>,
) -> Option<RequestOemRoutingContext> {
    let routing = extract_harness_nested_object(request_metadata, &["oem_routing", "oemRouting"])?;
    let tenant_id = extract_metadata_text(routing, &["tenant_id", "tenantId"])?;

    Some(RequestOemRoutingContext {
        tenant_id,
        provider_source: extract_metadata_text(routing, &["provider_source", "providerSource"]),
        provider_key: extract_metadata_text(routing, &["provider_key", "providerKey"]),
        default_model: extract_metadata_text(routing, &["default_model", "defaultModel"]),
        config_mode: extract_metadata_text(routing, &["config_mode", "configMode"]),
        offer_state: extract_metadata_text(routing, &["offer_state", "offerState"]),
        quota_status: extract_metadata_text(routing, &["quota_status", "quotaStatus"]),
        fallback_to_local_allowed: extract_metadata_bool(
            routing,
            &["fallback_to_local_allowed", "fallbackToLocalAllowed"],
        ),
        can_invoke: extract_metadata_bool(routing, &["can_invoke", "canInvoke"]),
    })
}

pub(crate) fn request_oem_routing_is_locked(context: Option<&RequestOemRoutingContext>) -> bool {
    context.is_some_and(|value| {
        matches!(value.config_mode.as_deref(), Some("managed"))
            || matches!(value.fallback_to_local_allowed, Some(false))
    })
}

fn build_request_oem_policy(
    context: Option<&RequestOemRoutingContext>,
) -> Option<lime_agent::SessionExecutionRuntimeOemPolicy> {
    let context = context?;
    Some(lime_agent::SessionExecutionRuntimeOemPolicy {
        tenant_id: context.tenant_id.clone(),
        provider_source: context.provider_source.clone(),
        provider_key: context.provider_key.clone(),
        default_model: context.default_model.clone(),
        config_mode: context.config_mode.clone(),
        offer_state: context.offer_state.clone(),
        quota_status: context.quota_status.clone(),
        fallback_to_local_allowed: context.fallback_to_local_allowed,
        can_invoke: context.can_invoke,
    })
}

fn build_runtime_summary(
    routing_decision: &lime_agent::SessionExecutionRuntimeRoutingDecision,
    limit_state: &lime_agent::SessionExecutionRuntimeLimitState,
    cost_state: &lime_agent::SessionExecutionRuntimeCostState,
    limit_event: Option<&lime_agent::SessionExecutionRuntimeLimitEvent>,
) -> lime_agent::SessionExecutionRuntimeSummary {
    lime_agent::SessionExecutionRuntimeSummary {
        candidate_count: Some(routing_decision.candidate_count),
        routing_mode: Some(routing_decision.routing_mode.clone()),
        decision_source: Some(routing_decision.decision_source.clone()),
        decision_reason: Some(routing_decision.decision_reason.clone()),
        fallback_chain: routing_decision.fallback_chain.clone(),
        estimated_cost_class: routing_decision
            .estimated_cost_class
            .clone()
            .or_else(|| cost_state.estimated_cost_class.clone()),
        estimated_total_cost: cost_state.estimated_total_cost,
        limit_status: Some(limit_state.status.clone()),
        limit_event_kind: limit_event.map(|event| event.event_kind.clone()),
        limit_event_message: limit_event.map(|event| event.message.clone()),
        capability_gap: routing_decision
            .capability_gap
            .clone()
            .or_else(|| limit_state.capability_gap.clone()),
        single_candidate_only: Some(limit_state.single_candidate_only),
        oem_locked: Some(limit_state.oem_locked),
        quota_low: Some(matches!(
            limit_event.map(|event| event.event_kind.as_str()),
            Some("quota_low")
        )),
    }
}

fn build_request_oem_limit_event(
    context: Option<&RequestOemRoutingContext>,
) -> Option<lime_agent::SessionExecutionRuntimeLimitEvent> {
    let context = context?;
    let quota_low = matches!(context.quota_status.as_deref(), Some("low"))
        || matches!(context.offer_state.as_deref(), Some("available_quota_low"));
    if !quota_low {
        return None;
    }

    let provider_label = context
        .provider_key
        .clone()
        .unwrap_or_else(|| "oem_cloud".to_string());
    Some(lime_agent::SessionExecutionRuntimeLimitEvent {
        event_kind: "quota_low".to_string(),
        message: format!(
            "OEM 云端 provider {provider_label} 当前额度偏低，后续请求可能触发配额风险。"
        ),
        retryable: true,
    })
}

fn resolve_request_service_model_slot(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    if let Some(slot) = extract_turn_context_runtime(request_metadata)
        .and_then(|runtime| extract_metadata_text(runtime, &["service_model_slot"]))
    {
        return Some(slot);
    }

    if extract_harness_nested_object(
        request_metadata,
        &["translation_skill_launch", "translationSkillLaunch"],
    )
    .is_some()
    {
        return Some("translation".to_string());
    }

    if extract_harness_nested_object(
        request_metadata,
        &["resource_search_skill_launch", "resourceSearchSkillLaunch"],
    )
    .is_some()
    {
        return Some("resource_prompt_rewrite".to_string());
    }

    if extract_harness_nested_object(
        request_metadata,
        &["topic_skill_launch", "topicSkillLaunch"],
    )
    .is_some()
    {
        return Some("topic".to_string());
    }

    if extract_harness_nested_object(
        request_metadata,
        &[
            "generation_topic_skill_launch",
            "generationTopicSkillLaunch",
        ],
    )
    .is_some()
    {
        return Some("generation_topic".to_string());
    }

    if extract_harness_nested_object(
        request_metadata,
        &["agent_meta_skill_launch", "agentMetaSkillLaunch"],
    )
    .is_some()
    {
        return Some("agent_meta".to_string());
    }

    if extract_harness_string(request_metadata, &["turn_purpose", "turnPurpose"])
        .as_deref()
        .is_some_and(is_prompt_rewrite_turn_purpose)
    {
        return Some("prompt_rewrite".to_string());
    }

    None
}

fn is_prompt_rewrite_turn_purpose(value: &str) -> bool {
    matches!(value, "style_rewrite" | "style_audit")
}

fn build_runtime_task_profile(
    request: &AsterChatRequest,
) -> lime_agent::SessionExecutionRuntimeTaskProfile {
    let request_metadata = request.metadata.as_ref();
    let service_model_slot = resolve_request_service_model_slot(request_metadata);
    let service_scene_context = extract_service_scene_launch_context(request_metadata);
    let request_oem_routing = resolve_request_oem_routing_context(request_metadata);
    let mut traits = Vec::new();

    if request
        .images
        .as_ref()
        .is_some_and(|images| !images.is_empty())
    {
        push_unique_profile_trait(&mut traits, "vision_input");
    }
    if extract_request_thinking_enabled(request).unwrap_or(false) {
        push_unique_profile_trait(&mut traits, "reasoning_requested");
    }
    if request.web_search.unwrap_or(false) || request.search_mode.is_some() {
        push_unique_profile_trait(&mut traits, "web_search_requested");
    }
    if extract_harness_bool(request_metadata, &["task_mode_enabled", "taskModeEnabled"])
        .unwrap_or(false)
    {
        push_unique_profile_trait(&mut traits, "task_mode_enabled");
    }
    if extract_harness_bool(
        request_metadata,
        &["subagent_mode_enabled", "subagentModeEnabled"],
    )
    .unwrap_or(false)
    {
        push_unique_profile_trait(&mut traits, "subagent_mode_enabled");
    }
    if service_model_slot.is_some() {
        push_unique_profile_trait(&mut traits, "service_model_slot");
    }
    if request_oem_routing.is_some() {
        push_unique_profile_trait(&mut traits, "oem_runtime");
    }

    if let Some(context) = service_scene_context {
        push_unique_profile_trait(&mut traits, "service_scene_launch");
        if request_oem_routing.is_some()
            || context.oem_runtime.scene_base_url.is_some()
            || context.oem_runtime.session_token.is_some()
            || context.oem_runtime.tenant_id.is_some()
        {
            push_unique_profile_trait(&mut traits, "oem_runtime");
        }

        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "service_scene".to_string(),
            source: "service_scene_launch".to_string(),
            traits,
            service_model_slot,
            scene_kind: normalize_optional_text(Some(context.launch_kind)),
            scene_skill_id: normalize_optional_text(Some(context.service_skill_id)),
            entry_source: context.entry_source,
        };
    }

    if extract_harness_nested_object(
        request_metadata,
        &["translation_skill_launch", "translationSkillLaunch"],
    )
    .is_some()
    {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "translation".to_string(),
            source: "translation_skill_launch".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: extract_harness_string(
                request_metadata,
                &["entry_source", "entrySource"],
            ),
        };
    }

    if extract_harness_nested_object(
        request_metadata,
        &["summary_skill_launch", "summarySkillLaunch"],
    )
    .is_some()
    {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "summary".to_string(),
            source: "summary_skill_launch".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: extract_harness_string(
                request_metadata,
                &["entry_source", "entrySource"],
            ),
        };
    }

    if extract_harness_nested_object(
        request_metadata,
        &["resource_search_skill_launch", "resourceSearchSkillLaunch"],
    )
    .is_some()
    {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "resource_search".to_string(),
            source: "resource_search_skill_launch".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: extract_harness_string(
                request_metadata,
                &["entry_source", "entrySource"],
            ),
        };
    }

    if extract_harness_nested_object(
        request_metadata,
        &["topic_skill_launch", "topicSkillLaunch"],
    )
    .is_some()
    {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "topic".to_string(),
            source: "auxiliary_topic".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: extract_harness_string(
                request_metadata,
                &["entry_source", "entrySource"],
            ),
        };
    }

    if extract_harness_nested_object(
        request_metadata,
        &[
            "generation_topic_skill_launch",
            "generationTopicSkillLaunch",
        ],
    )
    .is_some()
    {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "generation_topic".to_string(),
            source: "auxiliary_generation_topic".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: extract_harness_string(
                request_metadata,
                &["entry_source", "entrySource"],
            ),
        };
    }

    if extract_harness_nested_object(
        request_metadata,
        &["agent_meta_skill_launch", "agentMetaSkillLaunch"],
    )
    .is_some()
    {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "agent_meta".to_string(),
            source: "auxiliary_agent_meta".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: extract_harness_string(
                request_metadata,
                &["entry_source", "entrySource"],
            ),
        };
    }

    if extract_harness_string(request_metadata, &["turn_purpose", "turnPurpose"])
        .as_deref()
        .is_some_and(is_prompt_rewrite_turn_purpose)
    {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "prompt_rewrite".to_string(),
            source: "turn_purpose".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: None,
        };
    }

    if extract_harness_nested_object(request_metadata, &["artifact"]).is_some() {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "artifact".to_string(),
            source: "artifact_metadata".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: None,
        };
    }

    if request
        .images
        .as_ref()
        .is_some_and(|images| !images.is_empty())
    {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "vision_chat".to_string(),
            source: "request_images".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: None,
        };
    }

    if request.web_search.unwrap_or(false) || request.search_mode.is_some() {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "search".to_string(),
            source: "request_search".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: None,
        };
    }

    if extract_harness_bool(request_metadata, &["task_mode_enabled", "taskModeEnabled"])
        .unwrap_or(false)
    {
        return lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "task".to_string(),
            source: "task_mode".to_string(),
            traits,
            service_model_slot,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: None,
        };
    }

    lime_agent::SessionExecutionRuntimeTaskProfile {
        kind: "chat".to_string(),
        source: "default_chat".to_string(),
        traits,
        service_model_slot,
        scene_kind: None,
        scene_skill_id: None,
        entry_source: None,
    }
}

fn estimate_cost_class(
    model_id: &str,
    model_meta: Option<&EnhancedModelMetadata>,
) -> Option<String> {
    if let Some(model_meta) = model_meta {
        return Some(
            match model_meta.tier {
                ModelTier::Mini => "low",
                ModelTier::Pro => "medium",
                ModelTier::Max => "high",
            }
            .to_string(),
        );
    }

    let normalized = normalize_identifier(model_id);
    if normalized.contains("mini")
        || normalized.contains("haiku")
        || normalized.contains("flash")
        || normalized.contains("nano")
        || normalized.contains("small")
    {
        return Some("low".to_string());
    }
    if normalized.contains("opus")
        || normalized.contains("max")
        || normalized.contains("ultra")
        || normalized.contains("pro")
    {
        return Some("high".to_string());
    }

    Some("medium".to_string())
}

fn is_compatible_candidate_model(
    model: &EnhancedModelMetadata,
    thinking_enabled: bool,
    has_images: bool,
) -> bool {
    let supports_chat =
        model.task_families.is_empty() || model.task_families.contains(&ModelTaskFamily::Chat);
    let supports_reasoning =
        model.capabilities.reasoning || model.task_families.contains(&ModelTaskFamily::Reasoning);
    let supports_vision = model.capabilities.vision
        || model
            .task_families
            .contains(&ModelTaskFamily::VisionUnderstanding);

    if has_images && !supports_vision {
        return false;
    }
    if thinking_enabled && !supports_reasoning {
        return false;
    }

    supports_chat || (has_images && supports_vision)
}

fn count_compatible_candidate_models(
    catalog: &[EnhancedModelMetadata],
    thinking_enabled: bool,
    has_images: bool,
) -> u32 {
    catalog
        .iter()
        .filter(|model| is_compatible_candidate_model(model, thinking_enabled, has_images))
        .count() as u32
}

fn build_limit_state(
    status: &str,
    candidate_count: u32,
    provider_locked: bool,
    settings_locked: bool,
    oem_locked: bool,
    capability_gap: Option<String>,
    notes: Vec<String>,
) -> lime_agent::SessionExecutionRuntimeLimitState {
    let mut notes = notes;
    if oem_locked
        && !notes
            .iter()
            .any(|value| value.contains("OEM") || value.contains("oem"))
    {
        notes.push("当前回合受 OEM 路由约束，自动策略仅会在 OEM 允许范围内工作。".to_string());
    }
    lime_agent::SessionExecutionRuntimeLimitState {
        status: status.to_string(),
        single_candidate_only: candidate_count <= 1,
        provider_locked,
        settings_locked,
        oem_locked,
        candidate_count,
        capability_gap,
        notes,
    }
}

fn build_cost_state(
    selection: Option<&ResolvedRuntimeProviderSelection>,
    fallback_cost_class: Option<String>,
    status: &str,
) -> lime_agent::SessionExecutionRuntimeCostState {
    let pricing = selection.and_then(|value| value.pricing.as_ref());

    lime_agent::SessionExecutionRuntimeCostState {
        status: status.to_string(),
        estimated_cost_class: selection
            .and_then(|value| value.estimated_cost_class.clone())
            .or(fallback_cost_class),
        input_per_million: pricing.and_then(|value| value.input_per_million),
        output_per_million: pricing.and_then(|value| value.output_per_million),
        cache_read_per_million: pricing.and_then(|value| value.cache_read_per_million),
        cache_write_per_million: pricing.and_then(|value| value.cache_write_per_million),
        currency: pricing.map(|value| value.currency.clone()),
        estimated_total_cost: None,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        cached_input_tokens: None,
        cache_creation_input_tokens: None,
    }
}

fn build_routing_decision(
    task_profile: &lime_agent::SessionExecutionRuntimeTaskProfile,
    decision_source: &str,
    decision_reason: String,
    selection: Option<&ResolvedRuntimeProviderSelection>,
    requested_provider: Option<String>,
    requested_model: Option<String>,
    settings_source: Option<String>,
) -> lime_agent::SessionExecutionRuntimeRoutingDecision {
    let candidate_count = selection.map(|value| value.candidate_count).unwrap_or(0);
    let routing_mode = if candidate_count == 0 {
        "no_candidate"
    } else if candidate_count <= 1 {
        "single_candidate"
    } else {
        "multi_candidate"
    };

    lime_agent::SessionExecutionRuntimeRoutingDecision {
        routing_mode: routing_mode.to_string(),
        decision_source: decision_source.to_string(),
        decision_reason,
        selected_provider: selection.map(|value| value.provider_selector.clone()),
        selected_model: selection.map(|value| value.resolved_model.clone()),
        requested_provider,
        requested_model: requested_model
            .or_else(|| selection.map(|value| value.requested_model.clone())),
        candidate_count,
        estimated_cost_class: selection.and_then(|value| value.estimated_cost_class.clone()),
        capability_gap: selection.and_then(|value| value.capability_gap.clone()),
        fallback_chain: selection
            .map(|value| value.fallback_chain.clone())
            .unwrap_or_default(),
        settings_source,
        service_model_slot: task_profile.service_model_slot.clone(),
    }
}

fn compose_routing_decision_reason(
    base_reason: impl Into<String>,
    selection: Option<&ResolvedRuntimeProviderSelection>,
    oem_locked: bool,
    fallback_note: Option<&str>,
) -> String {
    let mut parts = vec![base_reason.into()];

    if let Some(selection) = selection {
        if selection.candidate_count > 1 {
            parts.push(format!(
                "当前 provider 候选池共有 {} 个兼容候选，已按连续性、能力与成本优选。",
                selection.candidate_count
            ));
        }
        if selection.fallback_chain.len() >= 2 {
            parts.push(format!(
                "回退链为 {}。",
                selection.fallback_chain.join(" -> ")
            ));
        }
        if let Some(gap) = selection.capability_gap.as_deref() {
            parts.push(format!("当前仍存在能力提示：{gap}。"));
        }
    }

    if oem_locked {
        parts.push("当前回合受 OEM 托管约束，自动策略不会越出 OEM 允许范围。".to_string());
    }

    if let Some(note) = fallback_note.map(str::trim).filter(|note| !note.is_empty()) {
        parts.push(note.to_string());
    }

    parts.join(" ")
}

fn build_no_candidate_resolution(
    task_profile: lime_agent::SessionExecutionRuntimeTaskProfile,
    decision_source: &str,
    decision_reason: String,
    oem_locked: bool,
    limit_event: Option<lime_agent::SessionExecutionRuntimeLimitEvent>,
    oem_policy: Option<lime_agent::SessionExecutionRuntimeOemPolicy>,
) -> RuntimeRequestProviderResolution {
    let capability_gap = if task_profile.kind == "vision_chat" {
        Some("vision_candidate_missing".to_string())
    } else {
        None
    };
    let limit_state = build_limit_state(
        "no_candidate",
        0,
        false,
        false,
        oem_locked,
        capability_gap.clone(),
        vec!["当前请求没有可恢复的 provider/model 默认值".to_string()],
    );
    let routing_decision = build_routing_decision(
        &task_profile,
        decision_source,
        decision_reason,
        None,
        None,
        None,
        None,
    );
    let cost_state = build_cost_state(None, None, "unavailable");
    let runtime_summary = build_runtime_summary(
        &routing_decision,
        &limit_state,
        &cost_state,
        limit_event.as_ref(),
    );

    RuntimeRequestProviderResolution {
        provider_config: None,
        task_profile,
        routing_decision,
        limit_state,
        cost_state,
        limit_event,
        oem_policy,
        runtime_summary,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestPreferenceSource {
    Request,
    ServiceSceneLaunch,
    Session,
    ServiceModelSetting,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct SessionProviderModelContext {
    provider_selector: Option<String>,
    provider_name: Option<String>,
    model_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ServiceSceneModelPreferenceContext {
    provider_selector: String,
    model_name: String,
    allow_fallback: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ServiceModelSettingPreferenceContext {
    provider_selector: String,
    model_name: String,
    settings_source: String,
    service_model_slot: String,
}

impl SessionProviderModelContext {
    fn from_session(session: &aster::session::Session) -> Self {
        Self {
            provider_selector: resolve_session_provider_selector(session),
            provider_name: normalize_optional_text(session.provider_name.clone()),
            model_name: session
                .model_config
                .as_ref()
                .and_then(|config| normalize_optional_text(Some(config.model_name.clone()))),
        }
    }
}

fn resolve_service_scene_model_preference(
    request_metadata: Option<&serde_json::Value>,
) -> Option<ServiceSceneModelPreferenceContext> {
    let context = extract_service_scene_launch_context(request_metadata)?;
    let provider_selector = normalize_optional_text(context.preferred_provider_id)?;
    let model_name = normalize_optional_text(context.preferred_model_id)?;

    Some(ServiceSceneModelPreferenceContext {
        provider_selector,
        model_name,
        allow_fallback: context.allow_fallback.unwrap_or(true),
    })
}

fn resolve_service_model_setting_preference(
    app: &AppHandle,
    task_profile: &lime_agent::SessionExecutionRuntimeTaskProfile,
) -> Option<ServiceModelSettingPreferenceContext> {
    let slot = task_profile.service_model_slot.as_deref()?;
    let config_manager = app.try_state::<GlobalConfigManagerState>()?;
    let config = config_manager.config();
    let preference = match slot {
        "history_compress" => &config.workspace_preferences.service_models.history_compress,
        "prompt_rewrite" => &config.workspace_preferences.service_models.prompt_rewrite,
        "resource_prompt_rewrite" => {
            &config
                .workspace_preferences
                .service_models
                .resource_prompt_rewrite
        }
        "translation" => &config.workspace_preferences.service_models.translation,
        _ => return None,
    };

    if !preference.enabled {
        return None;
    }

    Some(ServiceModelSettingPreferenceContext {
        provider_selector: normalize_optional_text(preference.preferred_provider_id.clone())?,
        model_name: normalize_optional_text(preference.preferred_model_id.clone())?,
        settings_source: format!("service_models.{slot}"),
        service_model_slot: slot.to_string(),
    })
}

fn resolve_provider_preference_with_session_fallback(
    requested_provider_preference: Option<String>,
    session_context: Option<&SessionProviderModelContext>,
) -> Option<(String, RequestPreferenceSource)> {
    if let Some(provider_preference) = normalize_optional_text(requested_provider_preference) {
        return Some((provider_preference, RequestPreferenceSource::Request));
    }

    session_context
        .and_then(|context| {
            context
                .provider_selector
                .clone()
                .or_else(|| context.provider_name.clone())
        })
        .map(|provider_selector| (provider_selector, RequestPreferenceSource::Session))
}

fn resolve_model_preference_with_session_fallback(
    requested_model_preference: Option<String>,
    requested_provider_selector: &str,
    session_context: Option<&SessionProviderModelContext>,
) -> Result<(String, RequestPreferenceSource), String> {
    if let Some(model_preference) = normalize_optional_text(requested_model_preference) {
        return Ok((model_preference, RequestPreferenceSource::Request));
    }

    let normalized_requested_provider = normalize_identifier(requested_provider_selector);
    let session_provider_matches = session_context
        .into_iter()
        .flat_map(|context| {
            [
                context.provider_selector.as_deref(),
                context.provider_name.as_deref(),
            ]
        })
        .flatten()
        .any(|candidate| normalize_identifier(candidate) == normalized_requested_provider);
    if !session_provider_matches {
        return Err("model_preference 不能为空；切换 provider 时必须显式提供模型".to_string());
    }

    let Some(session_model_name) = session_context
        .and_then(|context| context.model_name.clone())
        .and_then(|value| normalize_optional_text(Some(value)))
    else {
        return Err("model_preference 不能为空；当前会话尚未持久化模型".to_string());
    };

    Ok((session_model_name, RequestPreferenceSource::Session))
}

async fn load_session_provider_model_context(
    request: &AsterChatRequest,
) -> Result<SessionProviderModelContext, String> {
    let session = read_session(
        &request.session_id,
        false,
        "读取会话 provider/model 上下文失败",
    )
    .await?;
    Ok(SessionProviderModelContext::from_session(&session))
}

async fn build_runtime_request_provider_config_from_preference(
    app: &AppHandle,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    request: &AsterChatRequest,
    provider_selector: &str,
    model_preference: &str,
    model_preference_source: RequestPreferenceSource,
    allow_runtime_fallback: bool,
) -> Result<ResolvedRuntimeProviderSelection, String> {
    let context =
        build_provider_resolution_context(db, api_key_provider_service, provider_selector)?;
    let (catalog, _alias_config) = load_model_registry_catalog(app, &context).await;
    let normalized_model_preference =
        canonicalize_known_provider_model_id(&context, model_preference);
    let thinking_enabled = resolve_request_thinking_enabled(request).await?;
    let has_images = request
        .images
        .as_ref()
        .map(|images| !images.is_empty())
        .unwrap_or(false);
    let compatible_candidate_count =
        count_compatible_candidate_models(&catalog, thinking_enabled, has_images);
    let reasoning_gap = thinking_enabled
        && !catalog.iter().any(|model| {
            model.capabilities.reasoning
                || model.task_families.contains(&ModelTaskFamily::Reasoning)
        });
    let vision_gap = has_images
        && !catalog.iter().any(|model| {
            model.capabilities.vision
                || model
                    .task_families
                    .contains(&ModelTaskFamily::VisionUnderstanding)
        });

    let mut resolved_model = if thinking_enabled {
        resolve_thinking_model_id(&normalized_model_preference, &catalog)
    } else {
        resolve_base_model_on_thinking_off(&normalized_model_preference, &catalog)
    };
    let mut fallback_chain = Vec::new();
    if compatible_candidate_count > 1 && should_auto_reselect_multi_candidate_model(&context) {
        if let Some(best_candidate) = choose_best_multi_candidate_model(
            &resolved_model,
            &catalog,
            thinking_enabled,
            has_images,
        ) {
            if best_candidate != resolved_model {
                fallback_chain.push(format!("{}:{}", context.provider_selector, resolved_model));
                resolved_model = best_candidate;
                fallback_chain.push(format!("{}:{}", context.provider_selector, resolved_model));
            }
        }
    }

    let should_fallback_unknown_model = allow_runtime_fallback
        && !context.is_custom_provider
        && find_model_meta(&resolved_model, &catalog).is_none();
    if should_fallback_unknown_model {
        let fallback_model = resolve_catalog_fallback_model_id(
            &resolved_model,
            &catalog,
            thinking_enabled,
            has_images,
        );
        if fallback_model != resolved_model {
            tracing::info!(
                "[AsterAgent] 偏好模型已失效，自动回落到当前可用模型: session={}, source={:?}, provider={}, stale_model={}, fallback_model={}",
                request.session_id,
                model_preference_source,
                context.provider_selector,
                resolved_model,
                fallback_model
            );
            fallback_chain.push(format!("{}:{}", context.provider_selector, resolved_model));
            resolved_model = fallback_model;
            fallback_chain.push(format!("{}:{}", context.provider_selector, resolved_model));
        }
    }
    resolved_model = resolve_provider_model_compatibility(&context, &resolved_model);
    if has_images {
        resolved_model = resolve_vision_model_id(&resolved_model, &catalog)?;
    }

    if resolved_model != model_preference {
        tracing::info!(
            "[AsterAgent] 后端已解析请求模型: source={:?}, provider={}, requested_model={}, resolved_model={}, thinking_enabled={}, has_images={}",
            model_preference_source,
            context.provider_selector,
            model_preference,
            resolved_model,
            thinking_enabled,
            has_images
        );
    }

    let provider_strategy = resolve_runtime_provider_configuration_strategy(&context);
    let base_url = match provider_strategy {
        RuntimeProviderConfigurationStrategy::Manual { base_url } => base_url,
        RuntimeProviderConfigurationStrategy::CredentialPool => None,
    };
    let model_meta = find_model_meta(&resolved_model, &catalog);
    let model_capabilities = model_meta
        .map(|model| model.capabilities.clone())
        .unwrap_or_else(|| {
            let inferred_task_families = infer_model_task_families(
                &resolved_model,
                Some(&context.provider_selector),
                None,
                None,
            );
            infer_model_capabilities(
                &resolved_model,
                Some(&context.provider_selector),
                &inferred_task_families,
                None,
                None,
            )
        });

    let estimated_cost_class = estimate_cost_class(&resolved_model, model_meta);
    let capability_gap = if vision_gap {
        Some("vision_candidate_missing".to_string())
    } else if reasoning_gap {
        Some("reasoning_candidate_missing".to_string())
    } else {
        None
    };

    Ok(ResolvedRuntimeProviderSelection {
        provider_selector: context.provider_selector.clone(),
        requested_model: model_preference.to_string(),
        resolved_model: resolved_model.clone(),
        candidate_count: compatible_candidate_count.max(1),
        estimated_cost_class,
        pricing: model_meta.and_then(|model| model.pricing.clone()),
        capability_gap,
        fallback_chain,
        provider_config: ConfigureProviderRequest {
            provider_id: Some(context.provider_selector.clone()),
            provider_name: context.aster_provider_name,
            model_name: resolved_model,
            api_key: None,
            base_url,
            model_capabilities: Some(model_capabilities),
            tool_call_strategy: None,
            toolshim_model: None,
        },
    })
}

pub(super) async fn resolve_runtime_provider_auth_recovery_config(
    app: &AppHandle,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    request: &AsterChatRequest,
    provider_selector: &str,
    failed_model: &str,
) -> Result<Option<ConfigureProviderRequest>, String> {
    let context =
        build_provider_resolution_context(db, api_key_provider_service, provider_selector)?;
    let failed_model = canonicalize_known_provider_model_id(&context, failed_model);
    let (catalog, _alias_config) = load_model_registry_catalog(app, &context).await;
    let thinking_enabled = resolve_request_thinking_enabled(request).await?;
    let has_images = request
        .images
        .as_ref()
        .map(|images| !images.is_empty())
        .unwrap_or(false);

    let Some(fallback_model) = choose_provider_permission_recovery_model(
        &context,
        &failed_model,
        &catalog,
        thinking_enabled,
        has_images,
    ) else {
        return Ok(None);
    };

    if normalize_identifier(&fallback_model) == normalize_identifier(&failed_model) {
        return Ok(None);
    }

    let provider_strategy = resolve_runtime_provider_configuration_strategy(&context);
    let base_url = match provider_strategy {
        RuntimeProviderConfigurationStrategy::Manual { base_url } => base_url,
        RuntimeProviderConfigurationStrategy::CredentialPool => None,
    };
    let model_meta = find_model_meta(&fallback_model, &catalog);
    let model_capabilities = model_meta
        .map(|model| model.capabilities.clone())
        .unwrap_or_else(|| {
            let inferred_task_families = infer_model_task_families(
                &fallback_model,
                Some(&context.provider_selector),
                None,
                None,
            );
            infer_model_capabilities(
                &fallback_model,
                Some(&context.provider_selector),
                &inferred_task_families,
                None,
                None,
            )
        });

    Ok(Some(ConfigureProviderRequest {
        provider_id: Some(context.provider_selector.clone()),
        provider_name: context.aster_provider_name,
        model_name: fallback_model,
        api_key: None,
        base_url,
        model_capabilities: Some(model_capabilities),
        tool_call_strategy: None,
        toolshim_model: None,
    }))
}

pub(super) async fn resolve_runtime_request_provider_resolution(
    app: &AppHandle,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    request: &AsterChatRequest,
) -> Result<RuntimeRequestProviderResolution, String> {
    let task_profile = build_runtime_task_profile(request);
    let request_oem_routing = resolve_request_oem_routing_context(request.metadata.as_ref());
    let oem_locked = request_oem_routing_is_locked(request_oem_routing.as_ref());
    let oem_limit_event = build_request_oem_limit_event(request_oem_routing.as_ref());
    let oem_policy = build_request_oem_policy(request_oem_routing.as_ref());

    if request.provider_config.is_some() {
        let explicit_provider = request.provider_config.as_ref().and_then(|config| {
            normalize_optional_text(
                config
                    .provider_id
                    .clone()
                    .or_else(|| Some(config.provider_name.clone())),
            )
        });
        let explicit_model = request
            .provider_config
            .as_ref()
            .and_then(|config| normalize_optional_text(Some(config.model_name.clone())));
        let limit_state = build_limit_state(
            "single_candidate_only",
            1,
            true,
            false,
            oem_locked,
            None,
            vec!["请求已显式传入 provider_config，自动路由不再改选 provider".to_string()],
        );
        let routing_decision = build_routing_decision(
            &task_profile,
            "provider_config",
            compose_routing_decision_reason(
                "请求已显式传入 provider_config，运行时仅补齐能力与工具策略。",
                None,
                oem_locked,
                None,
            ),
            None,
            explicit_provider.clone(),
            explicit_model.clone(),
            None,
        );

        let cost_state = build_cost_state(
            None,
            request
                .provider_config
                .as_ref()
                .and_then(|config| estimate_cost_class(&config.model_name, None)),
            "estimated",
        );
        let runtime_summary = build_runtime_summary(
            &routing_decision,
            &limit_state,
            &cost_state,
            oem_limit_event.as_ref(),
        );

        return Ok(RuntimeRequestProviderResolution {
            provider_config: None,
            task_profile,
            routing_decision: lime_agent::SessionExecutionRuntimeRoutingDecision {
                routing_mode: "single_candidate".to_string(),
                selected_provider: explicit_provider,
                selected_model: explicit_model,
                candidate_count: 1,
                estimated_cost_class: request
                    .provider_config
                    .as_ref()
                    .and_then(|config| estimate_cost_class(&config.model_name, None)),
                ..routing_decision
            },
            limit_state,
            cost_state,
            limit_event: oem_limit_event,
            oem_policy: oem_policy.clone(),
            runtime_summary,
        });
    }

    let service_scene_preference =
        resolve_service_scene_model_preference(request.metadata.as_ref());
    let service_model_setting_preference =
        resolve_service_model_setting_preference(app, &task_profile);
    let session_context =
        if request.provider_preference.is_some() && request.model_preference.is_some() {
            None
        } else {
            Some(load_session_provider_model_context(request).await?)
        };
    let mut fallback_note: Option<String> = None;

    if request.provider_preference.is_some() || request.model_preference.is_some() {
        let Some((provider_selector, provider_preference_source)) =
            resolve_provider_preference_with_session_fallback(
                request.provider_preference.clone(),
                session_context.as_ref(),
            )
        else {
            return Ok(build_no_candidate_resolution(
                task_profile,
                "request_override",
                "当前回合传入了 provider/model 偏好，但没有找到可恢复的 provider 默认值。"
                    .to_string(),
                oem_locked,
                oem_limit_event.clone(),
                oem_policy.clone(),
            ));
        };
        let (model_preference, model_preference_source) =
            resolve_model_preference_with_session_fallback(
                request.model_preference.clone(),
                &provider_selector,
                session_context.as_ref(),
            )?;

        if matches!(provider_preference_source, RequestPreferenceSource::Session) {
            tracing::info!(
                "[AsterAgent] 后端从会话恢复 provider 偏好: session={}, provider={}",
                request.session_id,
                provider_selector
            );
        }

        if matches!(model_preference_source, RequestPreferenceSource::Session) {
            tracing::info!(
                "[AsterAgent] 后端从会话恢复模型偏好: session={}, provider={}, model={}",
                request.session_id,
                provider_selector,
                model_preference
            );
        }

        let selection = build_runtime_request_provider_config_from_preference(
            app,
            db,
            api_key_provider_service,
            request,
            &provider_selector,
            &model_preference,
            model_preference_source,
            matches!(model_preference_source, RequestPreferenceSource::Session),
        )
        .await?;
        let limit_state = build_limit_state(
            if selection.candidate_count <= 1 {
                "single_candidate_only"
            } else {
                "normal"
            },
            selection.candidate_count,
            true,
            false,
            oem_locked,
            selection.capability_gap.clone(),
            vec!["当前回合显式指定了 provider/model 偏好。".to_string()],
        );
        let routing_decision = build_routing_decision(
            &task_profile,
            if matches!(provider_preference_source, RequestPreferenceSource::Request)
                || matches!(model_preference_source, RequestPreferenceSource::Request)
            {
                "request_override"
            } else {
                "session_default"
            },
            "当前回合的 provider/model 选择优先遵循显式偏好，其次回退到会话默认。".to_string(),
            Some(&selection),
            Some(provider_selector.clone()),
            Some(model_preference.clone()),
            None,
        );

        let cost_state = build_cost_state(Some(&selection), None, "estimated");
        let runtime_summary = build_runtime_summary(
            &routing_decision,
            &limit_state,
            &cost_state,
            oem_limit_event.as_ref(),
        );

        return Ok(RuntimeRequestProviderResolution {
            provider_config: Some(selection.provider_config),
            task_profile,
            routing_decision,
            limit_state,
            cost_state,
            limit_event: oem_limit_event,
            oem_policy: oem_policy.clone(),
            runtime_summary,
        });
    }

    if let Some(scene_preference) = service_scene_preference.as_ref() {
        match build_runtime_request_provider_config_from_preference(
            app,
            db,
            api_key_provider_service,
            request,
            &scene_preference.provider_selector,
            &scene_preference.model_name,
            RequestPreferenceSource::ServiceSceneLaunch,
            scene_preference.allow_fallback,
        )
        .await
        {
            Ok(selection) => {
                tracing::info!(
                    "[AsterAgent] 后端从 service_scene_launch 恢复 provider/model 偏好: session={}, provider={}, model={}, allow_fallback={}",
                    request.session_id,
                    scene_preference.provider_selector,
                    scene_preference.model_name,
                    scene_preference.allow_fallback
                );
                let limit_state = build_limit_state(
                    if selection.candidate_count <= 1 {
                        "single_candidate_only"
                    } else {
                        "normal"
                    },
                    selection.candidate_count,
                    true,
                    true,
                    oem_locked,
                    selection.capability_gap.clone(),
                    vec!["命中 service_scene_launch 的 provider/model 约束。".to_string()],
                );
                let routing_decision = build_routing_decision(
                    &task_profile,
                    "service_scene_launch",
                    "当前回合由 service_scene_launch 指定 provider/model，自动仅在允许范围内做能力兼容。"
                        .to_string(),
                    Some(&selection),
                    Some(scene_preference.provider_selector.clone()),
                    Some(scene_preference.model_name.clone()),
                    Some("service_scene_launch".to_string()),
                );
                let cost_state = build_cost_state(Some(&selection), None, "estimated");
                let runtime_summary = build_runtime_summary(
                    &routing_decision,
                    &limit_state,
                    &cost_state,
                    oem_limit_event.as_ref(),
                );

                return Ok(RuntimeRequestProviderResolution {
                    provider_config: Some(selection.provider_config),
                    task_profile,
                    routing_decision,
                    limit_state,
                    cost_state,
                    limit_event: oem_limit_event,
                    oem_policy: oem_policy.clone(),
                    runtime_summary,
                });
            }
            Err(error) => {
                if !scene_preference.allow_fallback {
                    return Err(format!(
                        "service_scene_launch 首选服务不可用，且已关闭自动回退: {error}"
                    ));
                }
                tracing::warn!(
                    "[AsterAgent] service_scene_launch 首选 provider/model 不可用，已回退会话默认: session={}, provider={}, model={}, error={}",
                    request.session_id,
                    scene_preference.provider_selector,
                    scene_preference.model_name,
                    error
                );
                fallback_note = Some(
                    "service_scene_launch 首选 provider/model 不可用，已继续回退默认路由。"
                        .to_string(),
                );
            }
        }
    }

    if let Some(setting_preference) = service_model_setting_preference.as_ref() {
        match build_runtime_request_provider_config_from_preference(
            app,
            db,
            api_key_provider_service,
            request,
            &setting_preference.provider_selector,
            &setting_preference.model_name,
            RequestPreferenceSource::ServiceModelSetting,
            true,
        )
        .await
        {
            Ok(selection) => {
                let mut notes = vec![format!(
                    "命中设置中的 {}，自动仅在当前 provider 候选池内做能力兼容。",
                    setting_preference.settings_source
                )];
                if let Some(note) = fallback_note.clone() {
                    notes.push(note);
                }
                let limit_state = build_limit_state(
                    if selection.candidate_count <= 1 {
                        "single_candidate_only"
                    } else {
                        "normal"
                    },
                    selection.candidate_count,
                    true,
                    true,
                    oem_locked,
                    selection.capability_gap.clone(),
                    notes,
                );
                let routing_decision = build_routing_decision(
                    &task_profile,
                    "service_model_setting",
                    compose_routing_decision_reason(
                        format!(
                            "当前回合命中 {}，优先使用设置中的 provider/model。",
                            setting_preference.settings_source
                        ),
                        Some(&selection),
                        oem_locked,
                        fallback_note.as_deref(),
                    ),
                    Some(&selection),
                    Some(setting_preference.provider_selector.clone()),
                    Some(setting_preference.model_name.clone()),
                    Some(setting_preference.settings_source.clone()),
                );
                let cost_state = build_cost_state(Some(&selection), None, "estimated");
                let runtime_summary = build_runtime_summary(
                    &routing_decision,
                    &limit_state,
                    &cost_state,
                    oem_limit_event.as_ref(),
                );

                return Ok(RuntimeRequestProviderResolution {
                    provider_config: Some(selection.provider_config),
                    task_profile,
                    routing_decision,
                    limit_state,
                    cost_state,
                    limit_event: oem_limit_event,
                    oem_policy: oem_policy.clone(),
                    runtime_summary,
                });
            }
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] service_models 偏好不可用，继续回退会话默认: session={}, source={}, provider={}, model={}, error={}",
                    request.session_id,
                    setting_preference.settings_source,
                    setting_preference.provider_selector,
                    setting_preference.model_name,
                    error
                );
                if fallback_note.is_none() {
                    fallback_note = Some(format!(
                        "{} 不可用，已继续回退会话默认。",
                        setting_preference.settings_source
                    ));
                }
            }
        }
    }

    let Some((provider_selector, provider_preference_source)) =
        resolve_provider_preference_with_session_fallback(None, session_context.as_ref())
    else {
        return Ok(build_no_candidate_resolution(
            task_profile,
            "auto_default",
            fallback_note.unwrap_or_else(|| {
                "当前会话没有 provider/model 默认值，自动路由没有候选可选。".to_string()
            }),
            oem_locked,
            oem_limit_event.clone(),
            oem_policy.clone(),
        ));
    };
    let (model_preference, model_preference_source) =
        resolve_model_preference_with_session_fallback(
            None,
            &provider_selector,
            session_context.as_ref(),
        )?;

    if matches!(provider_preference_source, RequestPreferenceSource::Session) {
        tracing::info!(
            "[AsterAgent] 后端从会话恢复 provider 偏好: session={}, provider={}",
            request.session_id,
            provider_selector
        );
    }
    if matches!(model_preference_source, RequestPreferenceSource::Session) {
        tracing::info!(
            "[AsterAgent] 后端从会话恢复模型偏好: session={}, provider={}, model={}",
            request.session_id,
            provider_selector,
            model_preference
        );
    }

    let selection = build_runtime_request_provider_config_from_preference(
        app,
        db,
        api_key_provider_service,
        request,
        &provider_selector,
        &model_preference,
        model_preference_source,
        true,
    )
    .await?;
    let mut notes = vec!["当前回合沿用会话最近一次持久化的 provider/model 默认值。".to_string()];
    if let Some(note) = fallback_note.as_ref() {
        notes.push(note.clone());
    }
    let limit_state = build_limit_state(
        if selection.candidate_count <= 1 {
            "single_candidate_only"
        } else {
            "normal"
        },
        selection.candidate_count,
        true,
        false,
        oem_locked,
        selection.capability_gap.clone(),
        notes,
    );
    let routing_decision = build_routing_decision(
        &task_profile,
        if matches!(provider_preference_source, RequestPreferenceSource::Session)
            || matches!(model_preference_source, RequestPreferenceSource::Session)
        {
            "session_default"
        } else {
            "auto_default"
        },
        compose_routing_decision_reason(
            "当前回合没有显式指定 provider/model，运行时沿用会话默认并在当前 provider 内做能力兼容。",
            Some(&selection),
            oem_locked,
            fallback_note.as_deref(),
        ),
        Some(&selection),
        Some(provider_selector),
        Some(model_preference),
        None,
    );

    let cost_state = build_cost_state(Some(&selection), None, "estimated");
    let runtime_summary = build_runtime_summary(
        &routing_decision,
        &limit_state,
        &cost_state,
        oem_limit_event.as_ref(),
    );

    Ok(RuntimeRequestProviderResolution {
        provider_config: Some(selection.provider_config),
        task_profile,
        routing_decision,
        limit_state,
        cost_state,
        limit_event: oem_limit_event,
        oem_policy,
        runtime_summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::dao::api_key_provider::ProviderGroup;

    fn build_model(
        id: &str,
        family: Option<&str>,
        reasoning: bool,
        vision: bool,
        is_latest: bool,
        tier: ModelTier,
        release_date: Option<&str>,
    ) -> EnhancedModelMetadata {
        EnhancedModelMetadata {
            id: id.to_string(),
            display_name: id.to_string(),
            provider_id: "openai".to_string(),
            provider_name: "openai".to_string(),
            family: family.map(ToString::to_string),
            tier,
            capabilities: ModelCapabilities {
                vision,
                tools: true,
                streaming: true,
                json_mode: true,
                function_calling: true,
                reasoning,
            },
            task_families: {
                let mut families = vec![ModelTaskFamily::Chat];
                if reasoning {
                    families.push(ModelTaskFamily::Reasoning);
                }
                if vision {
                    families.push(ModelTaskFamily::VisionUnderstanding);
                }
                families
            },
            input_modalities: if vision {
                vec![ModelModality::Text, ModelModality::Image]
            } else {
                vec![ModelModality::Text]
            },
            output_modalities: vec![ModelModality::Text, ModelModality::Json],
            runtime_features: vec![
                ModelRuntimeFeature::Streaming,
                ModelRuntimeFeature::ToolCalling,
                ModelRuntimeFeature::JsonSchema,
            ],
            deployment_source: ModelDeploymentSource::UserCloud,
            management_plane: ModelManagementPlane::LocalSettings,
            canonical_model_id: None,
            provider_model_id: Some(id.to_string()),
            alias_source: None,
            pricing: None,
            limits: Default::default(),
            status: Default::default(),
            release_date: release_date.map(ToString::to_string),
            is_latest,
            description: None,
            source: ModelSource::Embedded,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn thinking_on_prefers_reasoning_variant() {
        let models = vec![
            build_model(
                "gpt-5.4-mini",
                Some("gpt-5.4"),
                false,
                false,
                true,
                ModelTier::Mini,
                Some("2026-01-01"),
            ),
            build_model(
                "gpt-5.4-mini-thinking",
                Some("gpt-5.4"),
                true,
                false,
                true,
                ModelTier::Mini,
                Some("2026-01-02"),
            ),
        ];

        assert_eq!(
            resolve_thinking_model_id("gpt-5.4-mini", &models),
            "gpt-5.4-mini-thinking"
        );
    }

    #[test]
    fn thinking_off_restores_base_variant() {
        let models = vec![
            build_model(
                "gpt-5.4-mini",
                Some("gpt-5.4"),
                false,
                false,
                true,
                ModelTier::Mini,
                Some("2026-01-01"),
            ),
            build_model(
                "gpt-5.4-mini-thinking",
                Some("gpt-5.4"),
                true,
                false,
                true,
                ModelTier::Mini,
                Some("2026-01-02"),
            ),
        ];

        assert_eq!(
            resolve_base_model_on_thinking_off("gpt-5.4-mini-thinking", &models),
            "gpt-5.4-mini"
        );
    }

    #[test]
    fn vision_resolution_prefers_same_family_candidate() {
        let models = vec![
            build_model(
                "gpt-5.4-mini",
                Some("gpt-5.4"),
                false,
                false,
                true,
                ModelTier::Mini,
                Some("2026-01-01"),
            ),
            build_model(
                "gpt-5.4",
                Some("gpt-5.4"),
                true,
                true,
                true,
                ModelTier::Pro,
                Some("2026-01-03"),
            ),
            build_model(
                "gemini-2.5-pro",
                Some("gemini-2.5"),
                true,
                true,
                true,
                ModelTier::Pro,
                Some("2026-01-02"),
            ),
        ];

        assert_eq!(
            resolve_vision_model_id("gpt-5.4-mini", &models).unwrap(),
            "gpt-5.4"
        );
    }

    #[test]
    fn vision_resolution_keeps_unknown_model_when_name_implies_vision() {
        let models = vec![build_model(
            "gpt-5.4",
            Some("gpt-5.4"),
            true,
            true,
            true,
            ModelTier::Pro,
            Some("2026-01-03"),
        )];

        assert_eq!(
            resolve_vision_model_id("gpt-5.4-mini", &models).unwrap(),
            "gpt-5.4-mini"
        );
    }

    #[test]
    fn codex_compatibility_falls_back_to_supported_model() {
        let context = ProviderResolutionContext {
            provider_selector: "codex".to_string(),
            aster_provider_name: "openai".to_string(),
            compatibility_provider_key: "codex".to_string(),
            registry_provider_ids: vec!["codex".to_string()],
            alias_key: "codex".to_string(),
            custom_models: vec![],
            is_custom_provider: false,
            provider_type: Some(ApiProviderType::Codex),
            provider_group: None,
            configured_api_host: Some("https://api.openai.com/v1".to_string()),
            has_credentials: true,
        };

        assert_eq!(
            resolve_provider_model_compatibility(&context, "gpt-5.3-codex"),
            "gpt-5.2-codex"
        );
    }

    #[test]
    fn xiaomi_compatibility_canonicalizes_display_name_and_legacy_alias() {
        let context = ProviderResolutionContext {
            provider_selector: "custom-mimo".to_string(),
            aster_provider_name: "anthropic".to_string(),
            compatibility_provider_key: "anthropic-compatible".to_string(),
            registry_provider_ids: vec!["xiaomi".to_string()],
            alias_key: "custom-mimo".to_string(),
            custom_models: vec![],
            is_custom_provider: true,
            provider_type: Some(ApiProviderType::AnthropicCompatible),
            provider_group: None,
            configured_api_host: Some("https://token-plan-cn.xiaomimimo.com/anthropic".to_string()),
            has_credentials: true,
        };

        assert_eq!(
            resolve_provider_model_compatibility(&context, "MiMo-V2.5-Pro"),
            "mimo-v2.5-pro"
        );
        assert_eq!(
            resolve_provider_model_compatibility(&context, "mimo-v2-pro"),
            "mimo-v2.5-pro"
        );
        assert_eq!(
            canonicalize_provider_custom_models(
                &context,
                &[
                    "MiMo-V2.5-Pro".to_string(),
                    "mimo-v2-pro".to_string(),
                    "mimo-v2-flash".to_string(),
                ],
            ),
            vec!["mimo-v2.5-pro".to_string(), "mimo-v2-flash".to_string()]
        );
    }

    #[test]
    fn catalog_fallback_prefers_latest_same_lineage_chat_model_for_unknown_session_model() {
        let models = vec![
            build_model(
                "embedding-3",
                Some("embedding"),
                false,
                false,
                true,
                ModelTier::Pro,
                Some("2026-01-05"),
            ),
            build_model(
                "glm-4v",
                Some("glm"),
                false,
                true,
                true,
                ModelTier::Pro,
                Some("2026-01-04"),
            ),
            build_model(
                "glm-4.6",
                Some("glm"),
                false,
                false,
                false,
                ModelTier::Pro,
                Some("2026-01-03"),
            ),
            build_model(
                "glm-4.7",
                Some("glm"),
                false,
                false,
                true,
                ModelTier::Pro,
                Some("2026-01-04"),
            ),
        ];

        assert_eq!(
            resolve_catalog_fallback_model_id("glm-5.1", &models, false, false),
            "glm-4.7"
        );
    }

    #[test]
    fn multi_candidate_selection_prefers_same_family_lower_cost_model() {
        let models = vec![
            build_model(
                "gpt-5.4",
                Some("gpt-5.4"),
                false,
                false,
                true,
                ModelTier::Pro,
                Some("2026-01-03"),
            ),
            build_model(
                "gpt-5.4-mini",
                Some("gpt-5.4"),
                false,
                false,
                true,
                ModelTier::Mini,
                Some("2026-01-04"),
            ),
            build_model(
                "gemini-2.5-pro",
                Some("gemini-2.5"),
                false,
                false,
                true,
                ModelTier::Pro,
                Some("2026-01-05"),
            ),
        ];

        assert_eq!(
            choose_best_multi_candidate_model("gpt-5.4", &models, false, false).as_deref(),
            Some("gpt-5.4-mini")
        );
    }

    #[test]
    fn multi_candidate_selection_prefers_reasoning_model_when_thinking_enabled() {
        let mut models = vec![
            build_model(
                "gpt-5.4-mini",
                Some("gpt-5.4"),
                false,
                false,
                true,
                ModelTier::Mini,
                Some("2026-01-03"),
            ),
            build_model(
                "gpt-5.4-mini-thinking",
                Some("gpt-5.4"),
                false,
                false,
                true,
                ModelTier::Mini,
                Some("2026-01-04"),
            ),
        ];
        models[1].capabilities.reasoning = true;
        models[1].task_families.push(ModelTaskFamily::Reasoning);

        assert_eq!(
            choose_best_multi_candidate_model("gpt-5.4-mini", &models, true, false).as_deref(),
            Some("gpt-5.4-mini-thinking")
        );
    }

    #[test]
    fn multi_candidate_selection_prefers_vision_candidate_when_images_present() {
        let models = vec![
            build_model(
                "gpt-5.4-mini",
                Some("gpt-5.4"),
                false,
                false,
                true,
                ModelTier::Mini,
                Some("2026-01-03"),
            ),
            build_model(
                "gpt-5.4",
                Some("gpt-5.4"),
                true,
                true,
                true,
                ModelTier::Pro,
                Some("2026-01-04"),
            ),
        ];

        assert_eq!(
            choose_best_multi_candidate_model("gpt-5.4-mini", &models, false, true).as_deref(),
            Some("gpt-5.4")
        );
    }

    #[test]
    fn custom_provider_multi_candidate_reselection_is_disabled() {
        let context = ProviderResolutionContext {
            provider_selector: "custom-mimo".to_string(),
            aster_provider_name: "anthropic".to_string(),
            compatibility_provider_key: "anthropic-compatible".to_string(),
            registry_provider_ids: vec!["xiaomi".to_string()],
            alias_key: "custom-mimo".to_string(),
            custom_models: vec!["mimo-v2.5-pro".to_string(), "mimo-v2-flash".to_string()],
            is_custom_provider: true,
            provider_type: Some(ApiProviderType::AnthropicCompatible),
            provider_group: None,
            configured_api_host: Some("https://token-plan-cn.xiaomimimo.com/anthropic".to_string()),
            has_credentials: true,
        };

        assert!(!should_auto_reselect_multi_candidate_model(&context));
    }

    #[test]
    fn xiaomi_permission_recovery_prefers_non_flash_candidate() {
        let context = ProviderResolutionContext {
            provider_selector: "custom-mimo".to_string(),
            aster_provider_name: "anthropic".to_string(),
            compatibility_provider_key: "anthropic-compatible".to_string(),
            registry_provider_ids: vec!["xiaomi".to_string()],
            alias_key: "custom-mimo".to_string(),
            custom_models: vec!["mimo-v2.5-pro".to_string(), "mimo-v2-flash".to_string()],
            is_custom_provider: true,
            provider_type: Some(ApiProviderType::AnthropicCompatible),
            provider_group: None,
            configured_api_host: Some("https://token-plan-cn.xiaomimimo.com/anthropic".to_string()),
            has_credentials: true,
        };
        let models = vec![
            build_model(
                "mimo-v2.5-pro",
                Some("mimo-v2"),
                false,
                false,
                true,
                ModelTier::Pro,
                Some("2026-04-01"),
            ),
            build_model(
                "mimo-v2-flash",
                Some("mimo-v2"),
                false,
                false,
                true,
                ModelTier::Mini,
                Some("2026-04-02"),
            ),
        ];

        assert_eq!(
            choose_provider_permission_recovery_model(
                &context,
                "mimo-v2-flash",
                &models,
                false,
                false
            )
            .as_deref(),
            Some("mimo-v2.5-pro")
        );
    }

    #[test]
    fn model_preference_falls_back_to_session_model_when_provider_matches() {
        let resolved = resolve_model_preference_with_session_fallback(
            None,
            "openai",
            Some(&SessionProviderModelContext {
                provider_selector: Some("openai".to_string()),
                provider_name: Some("OpenAI".to_string()),
                model_name: Some("gpt-5.4-mini".to_string()),
            }),
        )
        .unwrap();

        assert_eq!(
            resolved,
            ("gpt-5.4-mini".to_string(), RequestPreferenceSource::Session)
        );
    }

    #[test]
    fn model_preference_requires_explicit_value_when_provider_changes() {
        let error = resolve_model_preference_with_session_fallback(
            None,
            "gemini",
            Some(&SessionProviderModelContext {
                provider_selector: Some("openai".to_string()),
                provider_name: Some("OpenAI".to_string()),
                model_name: Some("gpt-5.4-mini".to_string()),
            }),
        )
        .unwrap_err();

        assert!(
            error.contains("切换 provider"),
            "unexpected error message: {error}"
        );
    }

    #[test]
    fn explicit_model_preference_wins_over_session_fallback() {
        let resolved = resolve_model_preference_with_session_fallback(
            Some("gpt-5.4".to_string()),
            "openai",
            Some(&SessionProviderModelContext {
                provider_selector: Some("openai".to_string()),
                provider_name: Some("OpenAI".to_string()),
                model_name: Some("gpt-5.4-mini".to_string()),
            }),
        )
        .unwrap();

        assert_eq!(
            resolved,
            ("gpt-5.4".to_string(), RequestPreferenceSource::Request)
        );
    }

    #[test]
    fn provider_preference_falls_back_to_session_provider_when_request_missing() {
        let resolved = resolve_provider_preference_with_session_fallback(
            None,
            Some(&SessionProviderModelContext {
                provider_selector: Some("openai".to_string()),
                provider_name: Some("OpenAI".to_string()),
                model_name: Some("gpt-5.4-mini".to_string()),
            }),
        )
        .unwrap();

        assert_eq!(
            resolved,
            ("openai".to_string(), RequestPreferenceSource::Session)
        );
    }

    #[test]
    fn explicit_provider_preference_wins_over_session_fallback() {
        let resolved = resolve_provider_preference_with_session_fallback(
            Some("gemini".to_string()),
            Some(&SessionProviderModelContext {
                provider_selector: Some("openai".to_string()),
                provider_name: Some("OpenAI".to_string()),
                model_name: Some("gpt-5.4-mini".to_string()),
            }),
        )
        .unwrap();

        assert_eq!(
            resolved,
            ("gemini".to_string(), RequestPreferenceSource::Request)
        );
    }

    #[test]
    fn service_scene_model_preference_reads_complete_preference() {
        let metadata = serde_json::json!({
            "harness": {
                "service_scene_launch": {
                    "kind": "local_service_skill",
                    "service_scene_run": {
                        "skill_id": "voice-runtime",
                        "preferred_provider_id": "openai-tts",
                        "preferred_model_id": "gpt-4o-mini-tts",
                        "allow_fallback": false,
                    }
                }
            }
        });

        let resolved = resolve_service_scene_model_preference(Some(&metadata));

        assert_eq!(
            resolved,
            Some(ServiceSceneModelPreferenceContext {
                provider_selector: "openai-tts".to_string(),
                model_name: "gpt-4o-mini-tts".to_string(),
                allow_fallback: false,
            })
        );
    }

    #[test]
    fn service_scene_model_preference_ignores_provider_only_selection() {
        let metadata = serde_json::json!({
            "harness": {
                "service_scene_launch": {
                    "kind": "local_service_skill",
                    "service_scene_run": {
                        "skill_id": "voice-runtime",
                        "preferred_provider_id": "openai-tts"
                    }
                }
            }
        });

        assert!(resolve_service_scene_model_preference(Some(&metadata)).is_none());
    }

    #[test]
    fn runtime_task_profile_marks_translation_service_slot() {
        let request = AsterChatRequest {
            message: "翻译这段内容".to_string(),
            session_id: "session-1".to_string(),
            event_name: "agent-event".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-1".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(serde_json::json!({
                "harness": {
                    "translation_skill_launch": {
                        "source_text": "hello"
                    }
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        let profile = build_runtime_task_profile(&request);

        assert_eq!(profile.kind, "translation");
        assert_eq!(profile.source, "translation_skill_launch");
        assert_eq!(profile.service_model_slot.as_deref(), Some("translation"));
        assert!(profile
            .traits
            .iter()
            .any(|value| value == "service_model_slot"));
    }

    #[test]
    fn runtime_task_profile_maps_more_service_model_slots() {
        let base_request = AsterChatRequest {
            message: "继续处理".to_string(),
            session_id: "session-1".to_string(),
            event_name: "agent-event".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-1".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: None,
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        let mut resource_request = base_request.clone();
        resource_request.metadata = Some(serde_json::json!({
            "harness": {
                "resource_search_skill_launch": {
                    "kind": "resource_search_task",
                    "resource_search_task": {
                        "query": "找几张产品图"
                    }
                }
            }
        }));
        let resource_profile = build_runtime_task_profile(&resource_request);
        assert_eq!(resource_profile.kind, "resource_search");
        assert_eq!(resource_profile.source, "resource_search_skill_launch");
        assert_eq!(
            resource_profile.service_model_slot.as_deref(),
            Some("resource_prompt_rewrite")
        );

        let mut summary_request = base_request.clone();
        summary_request.metadata = Some(serde_json::json!({
            "harness": {
                "summary_skill_launch": {
                    "kind": "summary_request",
                    "summary_request": {
                        "content": "总结这段内容"
                    }
                }
            }
        }));
        let summary_profile = build_runtime_task_profile(&summary_request);
        assert_eq!(summary_profile.kind, "summary");
        assert_eq!(summary_profile.source, "summary_skill_launch");
        assert_eq!(summary_profile.service_model_slot, None);

        let mut topic_request = base_request.clone();
        topic_request.metadata = Some(serde_json::json!({
            "harness": {
                "topic_skill_launch": {
                    "kind": "topic_request"
                }
            }
        }));
        let topic_profile = build_runtime_task_profile(&topic_request);
        assert_eq!(topic_profile.kind, "topic");
        assert_eq!(topic_profile.source, "auxiliary_topic");
        assert_eq!(topic_profile.service_model_slot.as_deref(), Some("topic"));

        let mut generation_topic_request = base_request.clone();
        generation_topic_request.metadata = Some(serde_json::json!({
            "harness": {
                "generation_topic_skill_launch": {
                    "kind": "generation_topic_request"
                }
            }
        }));
        let generation_topic_profile = build_runtime_task_profile(&generation_topic_request);
        assert_eq!(generation_topic_profile.kind, "generation_topic");
        assert_eq!(
            generation_topic_profile.source,
            "auxiliary_generation_topic"
        );
        assert_eq!(
            generation_topic_profile.service_model_slot.as_deref(),
            Some("generation_topic")
        );

        let mut agent_meta_request = base_request.clone();
        agent_meta_request.metadata = Some(serde_json::json!({
            "harness": {
                "agent_meta_skill_launch": {
                    "kind": "agent_meta_request"
                }
            }
        }));
        let agent_meta_profile = build_runtime_task_profile(&agent_meta_request);
        assert_eq!(agent_meta_profile.kind, "agent_meta");
        assert_eq!(agent_meta_profile.source, "auxiliary_agent_meta");
        assert_eq!(
            agent_meta_profile.service_model_slot.as_deref(),
            Some("agent_meta")
        );

        let mut rewrite_request = base_request;
        rewrite_request.metadata = Some(serde_json::json!({
            "harness": {
                "turn_purpose": "style_rewrite"
            }
        }));
        let rewrite_profile = build_runtime_task_profile(&rewrite_request);
        assert_eq!(rewrite_profile.kind, "prompt_rewrite");
        assert_eq!(rewrite_profile.source, "turn_purpose");
        assert_eq!(
            rewrite_profile.service_model_slot.as_deref(),
            Some("prompt_rewrite")
        );
    }

    #[test]
    fn runtime_task_profile_marks_oem_runtime_from_harness_oem_routing() {
        let request = AsterChatRequest {
            message: "继续处理".to_string(),
            session_id: "session-1".to_string(),
            event_name: "agent-event".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-1".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(serde_json::json!({
                "harness": {
                    "oem_routing": {
                        "tenant_id": "tenant-1",
                        "provider_source": "oem_cloud",
                        "provider_key": "lime-hub",
                        "config_mode": "managed",
                        "offer_state": "available_quota_low",
                        "quota_status": "low",
                        "fallback_to_local_allowed": false,
                    }
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        let profile = build_runtime_task_profile(&request);
        let oem_routing = resolve_request_oem_routing_context(request.metadata.as_ref());

        assert!(profile.traits.iter().any(|value| value == "oem_runtime"));
        assert!(request_oem_routing_is_locked(oem_routing.as_ref()));
        assert_eq!(
            build_request_oem_limit_event(oem_routing.as_ref()),
            Some(lime_agent::SessionExecutionRuntimeLimitEvent {
                event_kind: "quota_low".to_string(),
                message: "OEM 云端 provider lime-hub 当前额度偏低，后续请求可能触发配额风险。"
                    .to_string(),
                retryable: true,
            })
        );
    }

    #[test]
    fn explicit_provider_config_resolution_reports_single_candidate_routing() {
        let task_profile = lime_agent::SessionExecutionRuntimeTaskProfile {
            kind: "chat".to_string(),
            source: "default_chat".to_string(),
            traits: Vec::new(),
            service_model_slot: None,
            scene_kind: None,
            scene_skill_id: None,
            entry_source: None,
        };
        let base_decision = build_routing_decision(
            &task_profile,
            "provider_config",
            "请求已显式传入 provider_config，运行时仅补齐能力与工具策略。".to_string(),
            None,
            Some("openai".to_string()),
            Some("gpt-5.4-mini".to_string()),
            None,
        );

        let resolved = lime_agent::SessionExecutionRuntimeRoutingDecision {
            routing_mode: "single_candidate".to_string(),
            selected_provider: Some("openai".to_string()),
            selected_model: Some("gpt-5.4-mini".to_string()),
            candidate_count: 1,
            estimated_cost_class: Some("low".to_string()),
            ..base_decision
        };

        assert_eq!(resolved.routing_mode, "single_candidate");
        assert_eq!(resolved.candidate_count, 1);
        assert_eq!(resolved.selected_provider.as_deref(), Some("openai"));
        assert_eq!(resolved.selected_model.as_deref(), Some("gpt-5.4-mini"));
    }

    #[test]
    fn build_cost_state_should_capture_pricing_snapshot() {
        let selection = ResolvedRuntimeProviderSelection {
            provider_config: ConfigureProviderRequest {
                provider_id: Some("openai".to_string()),
                provider_name: "openai".to_string(),
                model_name: "gpt-5.4-mini".to_string(),
                api_key: None,
                base_url: None,
                model_capabilities: None,
                tool_call_strategy: None,
                toolshim_model: None,
            },
            provider_selector: "openai".to_string(),
            requested_model: "gpt-5.4-mini".to_string(),
            resolved_model: "gpt-5.4-mini".to_string(),
            candidate_count: 1,
            estimated_cost_class: Some("low".to_string()),
            pricing: Some(ModelPricing {
                input_per_million: Some(0.8),
                output_per_million: Some(3.2),
                cache_read_per_million: Some(0.08),
                cache_write_per_million: Some(1.0),
                currency: "USD".to_string(),
            }),
            capability_gap: None,
            fallback_chain: Vec::new(),
        };

        let cost_state = build_cost_state(Some(&selection), None, "estimated");

        assert_eq!(cost_state.status, "estimated");
        assert_eq!(cost_state.estimated_cost_class.as_deref(), Some("low"));
        assert_eq!(cost_state.input_per_million, Some(0.8));
        assert_eq!(cost_state.output_per_million, Some(3.2));
        assert_eq!(cost_state.cache_read_per_million, Some(0.08));
        assert_eq!(cost_state.cache_write_per_million, Some(1.0));
        assert_eq!(cost_state.currency.as_deref(), Some("USD"));
        assert!(cost_state.estimated_total_cost.is_none());
    }

    #[test]
    fn runtime_provider_strategy_prefers_manual_mode_for_credentialless_local_provider() {
        let context = ProviderResolutionContext {
            provider_selector: "ollama".to_string(),
            aster_provider_name: "ollama".to_string(),
            compatibility_provider_key: "ollama".to_string(),
            registry_provider_ids: vec!["ollama".to_string()],
            alias_key: "ollama".to_string(),
            custom_models: vec![],
            is_custom_provider: false,
            provider_type: Some(ApiProviderType::Ollama),
            provider_group: Some(ProviderGroup::Local),
            configured_api_host: Some("http://127.0.0.1:11434".to_string()),
            has_credentials: false,
        };

        assert_eq!(
            resolve_runtime_provider_configuration_strategy(&context),
            RuntimeProviderConfigurationStrategy::Manual {
                base_url: Some("http://127.0.0.1:11434".to_string()),
            }
        );
    }

    #[test]
    fn normalize_runtime_provider_base_url_strips_ollama_v1_suffix() {
        assert_eq!(
            normalize_runtime_provider_base_url(
                Some(ApiProviderType::Ollama),
                Some("http://127.0.0.1:11434/v1/".to_string()),
            ),
            Some("http://127.0.0.1:11434".to_string())
        );
    }

    #[test]
    fn canonical_provider_selector_maps_legacy_mimo_ids() {
        assert_eq!(canonical_provider_selector("mimo"), "xiaomi");
        assert_eq!(canonical_provider_selector("xiaomimimo"), "xiaomi");
        assert_eq!(canonical_provider_selector("xiaomi"), "xiaomi");
    }
}
