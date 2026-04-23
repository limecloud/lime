use super::*;
use crate::commands::aster_agent_cmd::service_skill_launch::extract_service_scene_launch_context;
use crate::commands::model_registry_cmd::ModelRegistryState;
use lime_core::database::dao::api_key_provider::{ApiProviderType, ProviderGroup};
use lime_core::models::model_registry::{
    EnhancedModelMetadata, ModelCapabilities, ModelDeploymentSource, ModelManagementPlane,
    ModelModality, ModelRuntimeFeature, ModelSource, ModelTaskFamily, ModelTier,
    ProviderAliasConfig,
};
use std::collections::HashSet;
use tauri::Manager;

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

fn normalize_identifier(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

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
    let provider_selector = normalize_identifier(provider_selector);
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

    Ok(ProviderResolutionContext {
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
    })
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

fn resolve_provider_model_compatibility(provider_key: &str, model_id: &str) -> String {
    let normalized_provider = normalize_identifier(provider_key);
    let normalized_model = normalize_identifier(model_id);

    if normalized_provider == "codex" && normalized_model == "gpt-5.3-codex" {
        return "gpt-5.2-codex".to_string();
    }

    model_id.to_string()
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestPreferenceSource {
    Request,
    ServiceSceneLaunch,
    Session,
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
) -> Result<ConfigureProviderRequest, String> {
    let context =
        build_provider_resolution_context(db, api_key_provider_service, provider_selector)?;
    let (catalog, _alias_config) = load_model_registry_catalog(app, &context).await;
    let thinking_enabled = resolve_request_thinking_enabled(request).await?;
    let has_images = request
        .images
        .as_ref()
        .map(|images| !images.is_empty())
        .unwrap_or(false);

    let mut resolved_model = if thinking_enabled {
        resolve_thinking_model_id(model_preference, &catalog)
    } else {
        resolve_base_model_on_thinking_off(model_preference, &catalog)
    };
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
            resolved_model = fallback_model;
        }
    }
    resolved_model =
        resolve_provider_model_compatibility(&context.compatibility_provider_key, &resolved_model);
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
    let model_capabilities = find_model_meta(&resolved_model, &catalog)
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

    Ok(ConfigureProviderRequest {
        provider_id: Some(context.provider_selector.clone()),
        provider_name: context.aster_provider_name,
        model_name: resolved_model,
        api_key: None,
        base_url,
        model_capabilities: Some(model_capabilities),
        tool_call_strategy: None,
        toolshim_model: None,
    })
}

pub(super) async fn resolve_runtime_request_provider_config(
    app: &AppHandle,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    request: &AsterChatRequest,
) -> Result<Option<ConfigureProviderRequest>, String> {
    if request.provider_config.is_some() {
        return Ok(None);
    }

    let service_scene_preference =
        resolve_service_scene_model_preference(request.metadata.as_ref());
    let session_context =
        if request.provider_preference.is_some() && request.model_preference.is_some() {
            None
        } else {
            Some(load_session_provider_model_context(request).await?)
        };

    if request.provider_preference.is_some() || request.model_preference.is_some() {
        let Some((provider_selector, provider_preference_source)) =
            resolve_provider_preference_with_session_fallback(
                request.provider_preference.clone(),
                session_context.as_ref(),
            )
        else {
            return Ok(None);
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

        return Ok(Some(
            build_runtime_request_provider_config_from_preference(
                app,
                db,
                api_key_provider_service,
                request,
                &provider_selector,
                &model_preference,
                model_preference_source,
                matches!(model_preference_source, RequestPreferenceSource::Session),
            )
            .await?,
        ));
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
            Ok(config) => {
                tracing::info!(
                    "[AsterAgent] 后端从 service_scene_launch 恢复 provider/model 偏好: session={}, provider={}, model={}, allow_fallback={}",
                    request.session_id,
                    scene_preference.provider_selector,
                    scene_preference.model_name,
                    scene_preference.allow_fallback
                );
                return Ok(Some(config));
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
            }
        }
    }

    let Some((provider_selector, provider_preference_source)) =
        resolve_provider_preference_with_session_fallback(None, session_context.as_ref())
    else {
        return Ok(None);
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

    Ok(Some(
        build_runtime_request_provider_config_from_preference(
            app,
            db,
            api_key_provider_service,
            request,
            &provider_selector,
            &model_preference,
            model_preference_source,
            true,
        )
        .await?,
    ))
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
        assert_eq!(
            resolve_provider_model_compatibility("codex", "gpt-5.3-codex"),
            "gpt-5.2-codex"
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
}
