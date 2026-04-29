//! 模型注册服务
//!
//! 从内嵌资源加载模型数据，管理本地缓存，提供模型搜索等功能
//! 模型数据在构建时从 aiclientproxy/models 仓库打包进应用

use aster::providers::canonical::{maybe_get_canonical_model, CanonicalModel};
use lime_core::api_host_utils::{
    is_openai_responses_compatible_host, normalize_openai_model_discovery_host,
};
use lime_core::database::dao::api_key_provider::{infer_managed_runtime_spec, ApiProviderType};
use lime_core::database::DbConnection;
use lime_core::models::model_registry::{
    EnhancedModelMetadata, ModelAliasSource, ModelCapabilities, ModelDeploymentSource, ModelLimits,
    ModelManagementPlane, ModelModality, ModelPricing, ModelRuntimeFeature, ModelSource,
    ModelStatus, ModelSyncState, ModelTaskFamily, ModelTier, ProviderAliasConfig,
    UserModelPreference,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;
use url::form_urlencoded;

/// 内嵌的模型资源目录名（相对于 resource_dir）
/// 对应 tauri.conf.json 中的 "resources/models/**/*"
const MODELS_RESOURCE_DIR: &str = "resources/models";
const MODELS_HOST_ALIASES_FILE: &str = "host_aliases.json";
const MODELS_HOST_ALIASES_USER_FILE: &str = "host_aliases.user.json";
const DEFAULT_USER_HOST_ALIASES_TEMPLATE: &str = "{\n  \"rules\": []\n}\n";
const LIME_TENANT_HEADER: &str = "X-Lime-Tenant-ID";
const LIME_TENANT_PARAM: &str = "lime_tenant_id";

/// 仓库索引文件结构
#[derive(Debug, Deserialize)]
struct RepoIndex {
    providers: Vec<String>,
    #[allow(dead_code)]
    total_models: u32,
}

/// 仓库中的 Provider 数据结构
#[derive(Debug, Deserialize)]
struct RepoProviderData {
    provider: RepoProvider,
    models: Vec<RepoModel>,
}

#[derive(Debug, Deserialize)]
struct RepoProvider {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct RepoModel {
    id: String,
    name: String,
    family: Option<String>,
    tier: Option<String>,
    capabilities: Option<RepoCapabilities>,
    pricing: Option<RepoPricing>,
    limits: Option<RepoLimits>,
    status: Option<String>,
    release_date: Option<String>,
    is_latest: Option<bool>,
    description: Option<String>,
    #[serde(default)]
    description_zh: Option<String>,
    #[serde(default)]
    task_families: Vec<String>,
    #[serde(default)]
    input_modalities: Vec<String>,
    #[serde(default)]
    output_modalities: Vec<String>,
    #[serde(default)]
    runtime_features: Vec<String>,
    deployment_source: Option<String>,
    management_plane: Option<String>,
    canonical_model_id: Option<String>,
    provider_model_id: Option<String>,
    alias_source: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct RepoCapabilities {
    #[serde(default)]
    vision: bool,
    #[serde(default)]
    tools: bool,
    #[serde(default)]
    streaming: bool,
    #[serde(default)]
    json_mode: bool,
    #[serde(default)]
    function_calling: bool,
    #[serde(default)]
    reasoning: bool,
}

#[derive(Debug, Deserialize)]
struct RepoPricing {
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
    currency: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RepoLimits {
    context: Option<u32>,
    max_output: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct HostAliasConfig {
    #[serde(default)]
    rules: Vec<HostAliasRule>,
}

#[derive(Debug, Clone, Deserialize)]
struct HostAliasRule {
    contains: String,
    providers: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModelFetchProtocol {
    OpenAiCompatible,
    ResponsesCompatible,
    Anthropic,
    Gemini,
    Ollama,
    Unsupported,
}

#[derive(Debug, Clone)]
struct PreparedModelFetchRequest {
    protocol: ModelFetchProtocol,
    url: String,
    headers: Vec<(String, String)>,
}

fn normalize_identifier(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn build_search_text(parts: &[Option<String>]) -> String {
    parts
        .iter()
        .filter_map(|part| {
            part.as_ref()
                .map(|value| normalize_identifier(value))
                .filter(|value| !value.is_empty())
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn text_contains_any(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| text.contains(keyword))
}

fn push_unique<T: PartialEq>(target: &mut Vec<T>, value: T) {
    if !target.contains(&value) {
        target.push(value);
    }
}

fn parse_task_family(value: &str) -> Option<ModelTaskFamily> {
    match normalize_identifier(value).as_str() {
        "chat" => Some(ModelTaskFamily::Chat),
        "reasoning" => Some(ModelTaskFamily::Reasoning),
        "vision_understanding" => Some(ModelTaskFamily::VisionUnderstanding),
        "image_generation" => Some(ModelTaskFamily::ImageGeneration),
        "image_edit" => Some(ModelTaskFamily::ImageEdit),
        "speech_to_text" => Some(ModelTaskFamily::SpeechToText),
        "text_to_speech" => Some(ModelTaskFamily::TextToSpeech),
        "embedding" => Some(ModelTaskFamily::Embedding),
        "rerank" => Some(ModelTaskFamily::Rerank),
        "moderation" => Some(ModelTaskFamily::Moderation),
        _ => None,
    }
}

fn parse_modality(value: &str) -> Option<ModelModality> {
    match normalize_identifier(value).as_str() {
        "text" => Some(ModelModality::Text),
        "image" => Some(ModelModality::Image),
        "audio" => Some(ModelModality::Audio),
        "video" => Some(ModelModality::Video),
        "file" => Some(ModelModality::File),
        "embedding" => Some(ModelModality::Embedding),
        "json" => Some(ModelModality::Json),
        _ => None,
    }
}

fn parse_runtime_feature(value: &str) -> Option<ModelRuntimeFeature> {
    match normalize_identifier(value).as_str() {
        "streaming" => Some(ModelRuntimeFeature::Streaming),
        "tool_calling" => Some(ModelRuntimeFeature::ToolCalling),
        "json_schema" => Some(ModelRuntimeFeature::JsonSchema),
        "reasoning" => Some(ModelRuntimeFeature::Reasoning),
        "prompt_cache" => Some(ModelRuntimeFeature::PromptCache),
        "responses_api" => Some(ModelRuntimeFeature::ResponsesApi),
        "chat_completions_api" => Some(ModelRuntimeFeature::ChatCompletionsApi),
        "images_api" => Some(ModelRuntimeFeature::ImagesApi),
        _ => None,
    }
}

fn parse_deployment_source(value: &str) -> Option<ModelDeploymentSource> {
    match normalize_identifier(value).as_str() {
        "local" => Some(ModelDeploymentSource::Local),
        "user_cloud" => Some(ModelDeploymentSource::UserCloud),
        "oem_cloud" => Some(ModelDeploymentSource::OemCloud),
        _ => None,
    }
}

fn parse_management_plane(value: &str) -> Option<ModelManagementPlane> {
    match normalize_identifier(value).as_str() {
        "local_settings" => Some(ModelManagementPlane::LocalSettings),
        "oem_control_plane" => Some(ModelManagementPlane::OemControlPlane),
        "hybrid" => Some(ModelManagementPlane::Hybrid),
        _ => None,
    }
}

fn parse_alias_source(value: &str) -> Option<ModelAliasSource> {
    match normalize_identifier(value).as_str() {
        "official" => Some(ModelAliasSource::Official),
        "relay" => Some(ModelAliasSource::Relay),
        "oem" => Some(ModelAliasSource::Oem),
        "local" => Some(ModelAliasSource::Local),
        _ => None,
    }
}

fn parse_task_families(values: &[String]) -> Vec<ModelTaskFamily> {
    let mut families = Vec::new();
    for value in values {
        if let Some(family) = parse_task_family(value) {
            push_unique(&mut families, family);
        }
    }
    families
}

fn parse_modalities(values: &[String]) -> Vec<ModelModality> {
    let mut modalities = Vec::new();
    for value in values {
        if let Some(modality) = parse_modality(value) {
            push_unique(&mut modalities, modality);
        }
    }
    modalities
}

fn parse_runtime_features(values: &[String]) -> Vec<ModelRuntimeFeature> {
    let mut features = Vec::new();
    for value in values {
        if let Some(feature) = parse_runtime_feature(value) {
            push_unique(&mut features, feature);
        }
    }
    features
}

fn infer_reasoning_capability(model_id: &str) -> bool {
    let normalized = normalize_identifier(model_id);
    text_contains_any(&normalized, &["thinking", "reasoning"])
}

fn infer_vision_capability(
    model_id: &str,
    provider_id: Option<&str>,
    family: Option<&str>,
    description: Option<&str>,
) -> bool {
    let text = build_search_text(&[
        Some(model_id.to_string()),
        family.map(ToString::to_string),
        description.map(ToString::to_string),
    ]);
    if text.is_empty() {
        return false;
    }

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
            "nano-banana",
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

    let provider = provider_id.map(normalize_identifier).unwrap_or_default();
    let openai_like = text_contains_any(&text, &["gpt-5", "gpt-4o", "gpt-4.1", "gpt-4.5", "codex"]);
    if provider == "openai" || provider == "codex" {
        return openai_like;
    }
    if provider == "gemini" || provider == "google" {
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

fn infer_image_generation_capability(
    model_id: &str,
    family: Option<&str>,
    description: Option<&str>,
    provider_model_id: Option<&str>,
    canonical_model_id: Option<&str>,
    input_modalities: &[ModelModality],
    output_modalities: &[ModelModality],
) -> bool {
    output_modalities.contains(&ModelModality::Image)
        || text_contains_any(
            &build_search_text(&[
                Some(model_id.to_string()),
                family.map(ToString::to_string),
                description.map(ToString::to_string),
                provider_model_id.map(ToString::to_string),
                canonical_model_id.map(ToString::to_string),
            ]),
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
                "cogview",
            ],
        )
        || (input_modalities.contains(&ModelModality::Image)
            && output_modalities.contains(&ModelModality::Image))
}

fn infer_image_edit_capability(
    model_id: &str,
    family: Option<&str>,
    description: Option<&str>,
    input_modalities: &[ModelModality],
    output_modalities: &[ModelModality],
) -> bool {
    text_contains_any(
        &build_search_text(&[
            Some(model_id.to_string()),
            family.map(ToString::to_string),
            description.map(ToString::to_string),
        ]),
        &[
            "edit",
            "inpaint",
            "outpaint",
            "img2img",
            "image-edit",
            "image_edit",
            "image edits",
        ],
    ) || (input_modalities.contains(&ModelModality::Image)
        && output_modalities.contains(&ModelModality::Image))
}

fn infer_model_task_families(
    model_id: &str,
    provider_id: Option<&str>,
    family: Option<&str>,
    description: Option<&str>,
    capabilities: Option<&ModelCapabilities>,
    explicit_task_families: &[ModelTaskFamily],
    input_modalities: &[ModelModality],
    output_modalities: &[ModelModality],
    provider_model_id: Option<&str>,
    canonical_model_id: Option<&str>,
) -> Vec<ModelTaskFamily> {
    if !explicit_task_families.is_empty() {
        return explicit_task_families.to_vec();
    }

    let text = build_search_text(&[
        Some(model_id.to_string()),
        family.map(ToString::to_string),
        description.map(ToString::to_string),
        provider_model_id.map(ToString::to_string),
        canonical_model_id.map(ToString::to_string),
    ]);
    let inferred_reasoning = capabilities
        .map(|caps| caps.reasoning)
        .unwrap_or_else(|| infer_reasoning_capability(model_id));
    let inferred_vision = capabilities
        .map(|caps| caps.vision)
        .unwrap_or_else(|| infer_vision_capability(model_id, provider_id, family, description));
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
    let is_image_generation = infer_image_generation_capability(
        model_id,
        family,
        description,
        provider_model_id,
        canonical_model_id,
        input_modalities,
        output_modalities,
    );
    let is_image_edit = infer_image_edit_capability(
        model_id,
        family,
        description,
        input_modalities,
        output_modalities,
    );

    let mut families = Vec::new();
    if is_embedding {
        push_unique(&mut families, ModelTaskFamily::Embedding);
    }
    if is_rerank {
        push_unique(&mut families, ModelTaskFamily::Rerank);
    }
    if is_moderation {
        push_unique(&mut families, ModelTaskFamily::Moderation);
    }
    if is_speech_to_text {
        push_unique(&mut families, ModelTaskFamily::SpeechToText);
    }
    if is_text_to_speech {
        push_unique(&mut families, ModelTaskFamily::TextToSpeech);
    }
    if is_image_generation {
        push_unique(&mut families, ModelTaskFamily::ImageGeneration);
    }
    if is_image_edit {
        push_unique(&mut families, ModelTaskFamily::ImageEdit);
    }
    if inferred_vision && !is_image_generation {
        push_unique(&mut families, ModelTaskFamily::VisionUnderstanding);
    }
    if inferred_reasoning {
        push_unique(&mut families, ModelTaskFamily::Reasoning);
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

    if !specialized_only
        || inferred_vision
        || inferred_reasoning
        || capabilities.map(|caps| caps.tools).unwrap_or(false)
        || capabilities
            .map(|caps| caps.function_calling)
            .unwrap_or(false)
        || capabilities.map(|caps| caps.json_mode).unwrap_or(false)
    {
        push_unique(&mut families, ModelTaskFamily::Chat);
    }

    families
}

fn infer_model_capabilities(
    model_id: &str,
    provider_id: Option<&str>,
    task_families: &[ModelTaskFamily],
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
        vision: task_families.contains(&ModelTaskFamily::VisionUnderstanding),
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
            || provider_id.map(normalize_identifier).as_deref() == Some("codex")
            || infer_reasoning_capability(model_id),
    }
}

fn infer_input_modalities(
    task_families: &[ModelTaskFamily],
    explicit_input_modalities: &[ModelModality],
) -> Vec<ModelModality> {
    if !explicit_input_modalities.is_empty() {
        return explicit_input_modalities.to_vec();
    }

    let mut modalities = Vec::new();
    if !task_families.contains(&ModelTaskFamily::SpeechToText) {
        push_unique(&mut modalities, ModelModality::Text);
    }
    if task_families.contains(&ModelTaskFamily::SpeechToText) {
        push_unique(&mut modalities, ModelModality::Audio);
    }
    if task_families.contains(&ModelTaskFamily::ImageEdit)
        || task_families.contains(&ModelTaskFamily::VisionUnderstanding)
    {
        push_unique(&mut modalities, ModelModality::Image);
    }
    if task_families.iter().any(|family| {
        matches!(
            family,
            ModelTaskFamily::Embedding
                | ModelTaskFamily::Rerank
                | ModelTaskFamily::Moderation
                | ModelTaskFamily::TextToSpeech
        )
    }) {
        push_unique(&mut modalities, ModelModality::Text);
    }

    modalities
}

fn infer_output_modalities(
    task_families: &[ModelTaskFamily],
    explicit_output_modalities: &[ModelModality],
    capabilities: Option<&ModelCapabilities>,
) -> Vec<ModelModality> {
    if !explicit_output_modalities.is_empty() {
        return explicit_output_modalities.to_vec();
    }

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
        push_unique(&mut modalities, ModelModality::Text);
    }
    if task_families.contains(&ModelTaskFamily::ImageGeneration)
        || task_families.contains(&ModelTaskFamily::ImageEdit)
    {
        push_unique(&mut modalities, ModelModality::Image);
    }
    if task_families.contains(&ModelTaskFamily::TextToSpeech) {
        push_unique(&mut modalities, ModelModality::Audio);
    }
    if task_families.contains(&ModelTaskFamily::Embedding) {
        push_unique(&mut modalities, ModelModality::Embedding);
    }
    if capabilities.map(|caps| caps.json_mode).unwrap_or(false)
        && !task_families.contains(&ModelTaskFamily::SpeechToText)
    {
        push_unique(&mut modalities, ModelModality::Json);
    }

    modalities
}

fn infer_runtime_features(
    provider_id: Option<&str>,
    capabilities: Option<&ModelCapabilities>,
    task_families: &[ModelTaskFamily],
    explicit_runtime_features: &[ModelRuntimeFeature],
) -> Vec<ModelRuntimeFeature> {
    if !explicit_runtime_features.is_empty() {
        return explicit_runtime_features.to_vec();
    }

    let provider_key = provider_id.map(normalize_identifier).unwrap_or_default();
    let mut features = Vec::new();
    if capabilities.map(|caps| caps.streaming).unwrap_or(true) {
        push_unique(&mut features, ModelRuntimeFeature::Streaming);
    }
    if capabilities
        .map(|caps| caps.tools || caps.function_calling)
        .unwrap_or(false)
    {
        push_unique(&mut features, ModelRuntimeFeature::ToolCalling);
    }
    if capabilities.map(|caps| caps.json_mode).unwrap_or(false) {
        push_unique(&mut features, ModelRuntimeFeature::JsonSchema);
    }
    if capabilities.map(|caps| caps.reasoning).unwrap_or(false)
        || task_families.contains(&ModelTaskFamily::Reasoning)
    {
        push_unique(&mut features, ModelRuntimeFeature::Reasoning);
    }
    if provider_key == "codex" {
        push_unique(&mut features, ModelRuntimeFeature::ResponsesApi);
    }
    if matches!(
        provider_key.as_str(),
        "openai" | "new-api" | "azure-openai" | "gateway"
    ) {
        push_unique(&mut features, ModelRuntimeFeature::ChatCompletionsApi);
    }
    if task_families.contains(&ModelTaskFamily::ImageGeneration)
        || task_families.contains(&ModelTaskFamily::ImageEdit)
    {
        push_unique(&mut features, ModelRuntimeFeature::ImagesApi);
    }

    features
}

fn infer_deployment_source(
    provider_id: Option<&str>,
    description: Option<&str>,
    explicit_deployment_source: Option<ModelDeploymentSource>,
) -> ModelDeploymentSource {
    if let Some(source) = explicit_deployment_source {
        return source;
    }

    let text = build_search_text(&[
        provider_id.map(ToString::to_string),
        description.map(ToString::to_string),
    ]);
    if text_contains_any(
        &text,
        &["ollama", "lmstudio", "gpustack", "ovms", "comfyui"],
    ) {
        return ModelDeploymentSource::Local;
    }
    if text_contains_any(
        &text,
        &["lime-hub", "lime hub", "oem", "partner-hub", "partner hub"],
    ) {
        return ModelDeploymentSource::OemCloud;
    }

    ModelDeploymentSource::UserCloud
}

fn infer_management_plane(
    deployment_source: &ModelDeploymentSource,
    explicit_management_plane: Option<ModelManagementPlane>,
) -> ModelManagementPlane {
    if let Some(plane) = explicit_management_plane {
        return plane;
    }

    match deployment_source {
        ModelDeploymentSource::Local => ModelManagementPlane::LocalSettings,
        ModelDeploymentSource::OemCloud => ModelManagementPlane::OemControlPlane,
        ModelDeploymentSource::UserCloud => ModelManagementPlane::LocalSettings,
    }
}

fn infer_alias_source(
    explicit_alias_source: Option<ModelAliasSource>,
    provider_model_id: Option<&str>,
    canonical_model_id: Option<&str>,
    canonical_model: Option<&CanonicalModel>,
) -> Option<ModelAliasSource> {
    if let Some(alias_source) = explicit_alias_source {
        return Some(alias_source);
    }

    if provider_model_id.is_some() && canonical_model_id.is_some() {
        if canonical_model.is_some() {
            return Some(ModelAliasSource::Official);
        }
        if provider_model_id.map(normalize_identifier)
            != canonical_model_id.map(normalize_identifier)
        {
            return Some(ModelAliasSource::Relay);
        }
    }

    None
}

#[derive(Debug, Clone)]
struct InferredModelTaxonomy {
    task_families: Vec<ModelTaskFamily>,
    input_modalities: Vec<ModelModality>,
    output_modalities: Vec<ModelModality>,
    runtime_features: Vec<ModelRuntimeFeature>,
    deployment_source: ModelDeploymentSource,
    management_plane: ModelManagementPlane,
    canonical_model_id: Option<String>,
    provider_model_id: Option<String>,
    alias_source: Option<ModelAliasSource>,
}

struct ModelTaxonomyInput<'a> {
    model_id: &'a str,
    provider_id: Option<&'a str>,
    family: Option<&'a str>,
    description: Option<&'a str>,
    capabilities: Option<&'a ModelCapabilities>,
    explicit_task_families: &'a [ModelTaskFamily],
    explicit_input_modalities: &'a [ModelModality],
    explicit_output_modalities: &'a [ModelModality],
    explicit_runtime_features: &'a [ModelRuntimeFeature],
    explicit_deployment_source: Option<ModelDeploymentSource>,
    explicit_management_plane: Option<ModelManagementPlane>,
    provider_model_id: Option<&'a str>,
    canonical_model_id: Option<&'a str>,
    explicit_alias_source: Option<ModelAliasSource>,
    canonical_model: Option<&'a CanonicalModel>,
}

fn infer_model_taxonomy(input: ModelTaxonomyInput<'_>) -> InferredModelTaxonomy {
    let canonical_input_modalities = input
        .canonical_model
        .map(|model| parse_modalities(&model.input_modalities))
        .unwrap_or_default();
    let canonical_output_modalities = input
        .canonical_model
        .map(|model| parse_modalities(&model.output_modalities))
        .unwrap_or_default();
    let input_seed = if input.explicit_input_modalities.is_empty() {
        canonical_input_modalities.as_slice()
    } else {
        input.explicit_input_modalities
    };
    let output_seed = if input.explicit_output_modalities.is_empty() {
        canonical_output_modalities.as_slice()
    } else {
        input.explicit_output_modalities
    };
    let task_families = infer_model_task_families(
        input.model_id,
        input.provider_id,
        input.family,
        input.description,
        input.capabilities,
        input.explicit_task_families,
        input_seed,
        output_seed,
        input.provider_model_id,
        input.canonical_model_id,
    );
    let input_modalities = if !input.explicit_input_modalities.is_empty() {
        input.explicit_input_modalities.to_vec()
    } else if !canonical_input_modalities.is_empty() {
        canonical_input_modalities
    } else {
        infer_input_modalities(&task_families, input.explicit_input_modalities)
    };
    let output_modalities = if !input.explicit_output_modalities.is_empty() {
        input.explicit_output_modalities.to_vec()
    } else if !canonical_output_modalities.is_empty() {
        canonical_output_modalities
    } else {
        infer_output_modalities(
            &task_families,
            input.explicit_output_modalities,
            input.capabilities,
        )
    };
    let runtime_features = infer_runtime_features(
        input.provider_id,
        input.capabilities,
        &task_families,
        input.explicit_runtime_features,
    );
    let deployment_source = infer_deployment_source(
        input.provider_id,
        input.description,
        input.explicit_deployment_source,
    );
    let management_plane =
        infer_management_plane(&deployment_source, input.explicit_management_plane);
    let provider_model_id = input
        .provider_model_id
        .map(ToString::to_string)
        .or_else(|| Some(input.model_id.to_string()));
    let canonical_model_id = input
        .canonical_model_id
        .map(ToString::to_string)
        .or_else(|| input.canonical_model.map(|model| model.id.clone()));
    let alias_source = infer_alias_source(
        input.explicit_alias_source,
        provider_model_id.as_deref(),
        canonical_model_id.as_deref(),
        input.canonical_model,
    );

    InferredModelTaxonomy {
        task_families,
        input_modalities,
        output_modalities,
        runtime_features,
        deployment_source,
        management_plane,
        canonical_model_id,
        provider_model_id,
        alias_source,
    }
}

/// 模型注册服务
pub struct ModelRegistryService {
    /// 数据库连接
    db: DbConnection,
    /// 内存缓存的模型数据
    models_cache: Arc<RwLock<Vec<EnhancedModelMetadata>>>,
    /// Provider 别名配置缓存（provider_id -> ProviderAliasConfig）
    aliases_cache: Arc<RwLock<HashMap<String, ProviderAliasConfig>>>,
    /// 同步状态
    sync_state: Arc<RwLock<ModelSyncState>>,
    /// 资源目录路径
    resource_dir: Option<std::path::PathBuf>,
}

impl ModelRegistryService {
    /// 创建新的模型注册服务
    pub fn new(db: DbConnection) -> Self {
        Self {
            db,
            models_cache: Arc::new(RwLock::new(Vec::new())),
            aliases_cache: Arc::new(RwLock::new(HashMap::new())),
            sync_state: Arc::new(RwLock::new(ModelSyncState::default())),
            resource_dir: None,
        }
    }

    /// 设置资源目录路径
    pub fn set_resource_dir(&mut self, path: std::path::PathBuf) {
        self.resource_dir = Some(path);
    }

    /// 获取用户 host_alias 覆盖文件路径
    pub fn resolve_user_host_alias_path() -> Option<std::path::PathBuf> {
        dirs::data_dir().map(|dir| {
            dir.join("lime")
                .join("models")
                .join(MODELS_HOST_ALIASES_USER_FILE)
        })
    }

    /// 确保用户 host_alias 覆盖文件存在
    pub fn ensure_user_host_alias_file() -> Result<std::path::PathBuf, String> {
        let path = Self::resolve_user_host_alias_path()
            .ok_or_else(|| "无法解析用户数据目录".to_string())?;

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建用户模型目录失败: {e}"))?;
        }

        if !path.exists() {
            std::fs::write(&path, DEFAULT_USER_HOST_ALIASES_TEMPLATE)
                .map_err(|e| format!("写入用户 host_alias 模板失败: {e}"))?;
        }

        Ok(path)
    }

    /// 初始化服务 - 从内嵌资源加载模型数据
    pub async fn initialize(&self) -> Result<(), String> {
        tracing::info!("[ModelRegistry] 初始化模型注册服务");

        // 始终从内嵌资源加载，不再回退到数据库
        let (models, aliases) = self.load_from_embedded_resources().await?;

        tracing::info!(
            "[ModelRegistry] 从内嵌资源加载了 {} 个模型, {} 个别名配置",
            models.len(),
            aliases.len()
        );

        // 更新缓存
        {
            let mut cache = self.models_cache.write().await;
            *cache = models.clone();
        }
        {
            let mut cache = self.aliases_cache.write().await;
            *cache = aliases;
        }

        // 更新同步状态
        {
            let mut state = self.sync_state.write().await;
            state.model_count = models.len() as u32;
            state.last_sync_at = Some(chrono::Utc::now().timestamp());
            state.is_syncing = false;
            state.last_error = None;
        }

        // 保存到数据库（仅用于持久化，不影响运行时数据）
        if let Err(e) = self.save_models_to_db(&models).await {
            tracing::warn!("[ModelRegistry] 保存模型到数据库失败: {}", e);
        }

        Ok(())
    }

    /// 从内嵌资源加载模型数据
    async fn load_from_embedded_resources(
        &self,
    ) -> Result<
        (
            Vec<EnhancedModelMetadata>,
            HashMap<String, ProviderAliasConfig>,
        ),
        String,
    > {
        let resource_dir = self
            .resource_dir
            .as_ref()
            .ok_or_else(|| "资源目录未设置".to_string())?;

        tracing::info!("[ModelRegistry] resource_dir: {:?}", resource_dir);

        let models_dir = resource_dir.join(MODELS_RESOURCE_DIR);
        let index_file = models_dir.join("index.json");

        tracing::info!("[ModelRegistry] models_dir: {:?}", models_dir);
        tracing::info!(
            "[ModelRegistry] index_file: {:?}, exists: {}",
            index_file,
            index_file.exists()
        );

        if !index_file.exists() {
            return Err(format!("索引文件不存在: {index_file:?}"));
        }

        // 1. 读取索引文件
        let index_content =
            std::fs::read_to_string(&index_file).map_err(|e| format!("读取索引文件失败: {e}"))?;
        let index: RepoIndex =
            serde_json::from_str(&index_content).map_err(|e| format!("解析索引文件失败: {e}"))?;

        tracing::info!(
            "[ModelRegistry] 索引包含 {} 个 providers",
            index.providers.len()
        );

        // 2. 加载所有 provider 数据
        let mut models = Vec::new();
        let now = chrono::Utc::now().timestamp();
        let providers_dir = models_dir.join("providers");

        tracing::info!("[ModelRegistry] providers_dir: {:?}", providers_dir);

        for provider_id in &index.providers {
            let provider_file = providers_dir.join(format!("{provider_id}.json"));

            if !provider_file.exists() {
                tracing::warn!("[ModelRegistry] Provider 文件不存在: {:?}", provider_file);
                continue;
            }

            match std::fs::read_to_string(&provider_file) {
                Ok(content) => match serde_json::from_str::<RepoProviderData>(&content) {
                    Ok(provider_data) => {
                        tracing::info!(
                            "[ModelRegistry] 加载 Provider: {} ({} 个模型)",
                            provider_id,
                            provider_data.models.len()
                        );
                        for model in provider_data.models {
                            let enhanced = self.convert_repo_model(
                                model,
                                &provider_data.provider.id,
                                &provider_data.provider.name,
                                now,
                            );
                            models.push(enhanced);
                        }
                    }
                    Err(e) => {
                        tracing::warn!("[ModelRegistry] 解析 {} 失败: {}", provider_id, e);
                    }
                },
                Err(e) => {
                    tracing::warn!("[ModelRegistry] 读取 {} 失败: {}", provider_id, e);
                }
            }
        }

        // 去重：优先保留 provider_id 为 "anthropic" 的模型
        // 对于相同 ID 的模型，anthropic 官方的优先级最高
        let mut seen_ids: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        let original_count = models.len();

        let mut to_keep = vec![true; models.len()];
        for (idx, model) in models.iter().enumerate() {
            if let Some(&existing_idx) = seen_ids.get(&model.id) {
                // 已经有相同 ID 的模型
                let existing_model = &models[existing_idx];

                // 如果当前模型是 anthropic 官方的，替换之前的
                if model.provider_id == "anthropic" && existing_model.provider_id != "anthropic" {
                    to_keep[existing_idx] = false;
                    seen_ids.insert(model.id.clone(), idx);
                } else {
                    // 否则保留第一个
                    to_keep[idx] = false;
                }
            } else {
                seen_ids.insert(model.id.clone(), idx);
            }
        }

        models = models
            .into_iter()
            .enumerate()
            .filter_map(|(idx, model)| if to_keep[idx] { Some(model) } else { None })
            .collect();

        if models.len() < original_count {
            tracing::warn!(
                "[ModelRegistry] 发现 {} 个重复 ID，已去重",
                original_count - models.len()
            );
        }

        // 按 provider_id 和 display_name 排序
        models.sort_by(|a, b| {
            a.provider_id
                .cmp(&b.provider_id)
                .then(a.display_name.cmp(&b.display_name))
        });

        // 3. 凭证池 Provider 别名已退役，保留空集合避免旧模型目录回流
        let mut aliases = HashMap::new();
        let aliases_dir = models_dir.join("aliases");
        let alias_files: [&str; 0] = [];

        for alias_name in alias_files {
            let alias_file = aliases_dir.join(format!("{alias_name}.json"));
            if !alias_file.exists() {
                continue;
            }

            match std::fs::read_to_string(&alias_file) {
                Ok(content) => match serde_json::from_str::<ProviderAliasConfig>(&content) {
                    Ok(config) => {
                        tracing::info!(
                            "[ModelRegistry] 加载别名配置: {} ({} 个模型)",
                            config.provider,
                            config.models.len()
                        );
                        aliases.insert(config.provider.clone(), config);
                    }
                    Err(e) => {
                        tracing::warn!("[ModelRegistry] 解析别名配置 {} 失败: {}", alias_name, e);
                    }
                },
                Err(e) => {
                    tracing::warn!("[ModelRegistry] 读取别名配置 {} 失败: {}", alias_name, e);
                }
            }
        }

        tracing::info!("[ModelRegistry] 从内嵌资源加载了 {} 个模型", models.len());

        Ok((models, aliases))
    }

    /// 转换仓库模型格式为内部格式
    fn convert_repo_model(
        &self,
        model: RepoModel,
        provider_id: &str,
        provider_name: &str,
        now: i64,
    ) -> EnhancedModelMetadata {
        let caps = model.capabilities.unwrap_or_default();
        let capabilities = ModelCapabilities {
            vision: caps.vision,
            tools: caps.tools,
            streaming: caps.streaming,
            json_mode: caps.json_mode,
            function_calling: caps.function_calling,
            reasoning: caps.reasoning,
        };
        let canonical_model = maybe_get_canonical_model(provider_id, &model.id);
        let explicit_task_families = parse_task_families(&model.task_families);
        let explicit_input_modalities = parse_modalities(&model.input_modalities);
        let explicit_output_modalities = parse_modalities(&model.output_modalities);
        let explicit_runtime_features = parse_runtime_features(&model.runtime_features);
        let explicit_deployment_source = model
            .deployment_source
            .as_deref()
            .and_then(parse_deployment_source);
        let explicit_management_plane = model
            .management_plane
            .as_deref()
            .and_then(parse_management_plane);
        let explicit_alias_source = model.alias_source.as_deref().and_then(parse_alias_source);
        let taxonomy = infer_model_taxonomy(ModelTaxonomyInput {
            model_id: &model.id,
            provider_id: Some(provider_id),
            family: model.family.as_deref(),
            description: model
                .description_zh
                .as_deref()
                .or(model.description.as_deref()),
            capabilities: Some(&capabilities),
            explicit_task_families: &explicit_task_families,
            explicit_input_modalities: &explicit_input_modalities,
            explicit_output_modalities: &explicit_output_modalities,
            explicit_runtime_features: &explicit_runtime_features,
            explicit_deployment_source,
            explicit_management_plane,
            provider_model_id: model
                .provider_model_id
                .as_deref()
                .or(Some(model.id.as_str())),
            canonical_model_id: model.canonical_model_id.as_deref(),
            explicit_alias_source,
            canonical_model: canonical_model.as_ref(),
        });

        EnhancedModelMetadata {
            id: model.id,
            display_name: model.name,
            provider_id: provider_id.to_string(),
            provider_name: provider_name.to_string(),
            family: model.family,
            tier: model
                .tier
                .and_then(|t| t.parse().ok())
                .unwrap_or(ModelTier::Pro),
            capabilities,
            task_families: taxonomy.task_families,
            input_modalities: taxonomy.input_modalities,
            output_modalities: taxonomy.output_modalities,
            runtime_features: taxonomy.runtime_features,
            deployment_source: taxonomy.deployment_source,
            management_plane: taxonomy.management_plane,
            canonical_model_id: taxonomy.canonical_model_id,
            provider_model_id: taxonomy.provider_model_id,
            alias_source: taxonomy.alias_source,
            pricing: model.pricing.map(|p| ModelPricing {
                input_per_million: p.input,
                output_per_million: p.output,
                cache_read_per_million: p.cache_read,
                cache_write_per_million: p.cache_write,
                currency: p.currency.unwrap_or_else(|| "USD".to_string()),
            }),
            limits: ModelLimits {
                context_length: model.limits.as_ref().and_then(|l| l.context),
                max_output_tokens: model.limits.as_ref().and_then(|l| l.max_output),
                requests_per_minute: None,
                tokens_per_minute: None,
            },
            status: model
                .status
                .and_then(|s| s.parse().ok())
                .unwrap_or(ModelStatus::Active),
            release_date: model.release_date,
            is_latest: model.is_latest.unwrap_or(false),
            description: model.description_zh.or(model.description),
            source: ModelSource::Embedded,
            created_at: now,
            updated_at: now,
        }
    }

    /// 从数据库加载模型（预留，将来实现从数据库加载自定义模型）
    #[allow(dead_code)]
    async fn load_from_db(&self) -> Result<Vec<EnhancedModelMetadata>, String> {
        let (models, sync_rows) = {
            let conn = self.db.lock().map_err(|e| e.to_string())?;

            let mut stmt = conn
                .prepare(
                    "SELECT id, display_name, provider_id, provider_name, family, tier,
                            capabilities, pricing, limits, status, release_date, is_latest,
                            description, source, created_at, updated_at
                     FROM model_registry",
                )
                .map_err(|e| e.to_string())?;

            let models = stmt
                .query_map([], |row| {
                    let capabilities_json: String = row.get(6)?;
                    let pricing_json: Option<String> = row.get(7)?;
                    let limits_json: String = row.get(8)?;
                    let status_str: String = row.get(9)?;
                    let tier_str: String = row.get(5)?;
                    let source_str: String = row.get(13)?;

                    Ok(EnhancedModelMetadata {
                        id: row.get(0)?,
                        display_name: row.get(1)?,
                        provider_id: row.get(2)?,
                        provider_name: row.get(3)?,
                        family: row.get(4)?,
                        tier: tier_str.parse().unwrap_or(ModelTier::Pro),
                        capabilities: serde_json::from_str(&capabilities_json).unwrap_or_default(),
                        task_families: vec![],
                        input_modalities: vec![],
                        output_modalities: vec![],
                        runtime_features: vec![],
                        deployment_source: ModelDeploymentSource::UserCloud,
                        management_plane: ModelManagementPlane::LocalSettings,
                        canonical_model_id: None,
                        provider_model_id: None,
                        alias_source: None,
                        pricing: pricing_json.and_then(|s| serde_json::from_str(&s).ok()),
                        limits: serde_json::from_str(&limits_json).unwrap_or_default(),
                        status: status_str.parse().unwrap_or(ModelStatus::Active),
                        release_date: row.get(10)?,
                        is_latest: row.get::<_, i32>(11)? != 0,
                        description: row.get(12)?,
                        source: source_str.parse().unwrap_or(ModelSource::Local),
                        created_at: row.get(14)?,
                        updated_at: row.get(15)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            // 加载同步状态数据
            let mut sync_stmt = conn
                .prepare("SELECT key, value FROM model_sync_state")
                .map_err(|e| e.to_string())?;

            let sync_rows: Vec<(String, String)> = sync_stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            (models, sync_rows)
        }; // conn 锁在这里释放

        // 更新同步状态（在锁释放后）
        {
            let mut state = self.sync_state.write().await;
            for (key, value) in sync_rows {
                match key.as_str() {
                    "last_sync_at" => {
                        state.last_sync_at = value.parse().ok();
                    }
                    "model_count" => {
                        state.model_count = value.parse().unwrap_or(0);
                    }
                    "last_error" => {
                        state.last_error = if value.is_empty() { None } else { Some(value) };
                    }
                    _ => {}
                }
            }
        }

        Ok(models)
    }

    /// 保存模型到数据库
    async fn save_models_to_db(&self, models: &[EnhancedModelMetadata]) -> Result<(), String> {
        let mut conn = self.db.lock().map_err(|e| e.to_string())?;

        // 使用 rusqlite 的事务 API
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // 清空现有数据
        tx.execute("DELETE FROM model_registry", [])
            .map_err(|e| e.to_string())?;

        // 插入新数据（使用 INSERT OR REPLACE 处理可能的重复 ID）
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR REPLACE INTO model_registry (
                        id, display_name, provider_id, provider_name, family, tier,
                        capabilities, pricing, limits, status, release_date, is_latest,
                        description, source, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .map_err(|e| e.to_string())?;

            for model in models {
                let capabilities_json =
                    serde_json::to_string(&model.capabilities).unwrap_or_default();
                let pricing_json = model
                    .pricing
                    .as_ref()
                    .map(|p| serde_json::to_string(p).unwrap_or_default());
                let limits_json = serde_json::to_string(&model.limits).unwrap_or_default();

                stmt.execute(params![
                    model.id,
                    model.display_name,
                    model.provider_id,
                    model.provider_name,
                    model.family,
                    model.tier.to_string(),
                    capabilities_json,
                    pricing_json,
                    limits_json,
                    model.status.to_string(),
                    model.release_date,
                    model.is_latest as i32,
                    model.description,
                    model.source.to_string(),
                    model.created_at,
                    model.updated_at,
                ])
                .map_err(|e| e.to_string())?;
            }
        }

        // 提交事务
        tx.commit().map_err(|e| e.to_string())?;

        tracing::info!("[ModelRegistry] 保存了 {} 个模型到数据库", models.len());

        Ok(())
    }

    /// 获取所有模型
    pub async fn get_all_models(&self) -> Vec<EnhancedModelMetadata> {
        self.models_cache.read().await.clone()
    }

    /// 获取同步状态
    pub async fn get_sync_state(&self) -> ModelSyncState {
        self.sync_state.read().await.clone()
    }

    /// 强制从内嵌资源重新加载模型数据
    ///
    /// 清除数据库缓存并重新从资源文件加载最新的模型数据
    pub async fn force_reload(&self) -> Result<u32, String> {
        tracing::info!("[ModelRegistry] 强制重新加载模型数据");

        // 从内嵌资源加载
        let (models, aliases) = self.load_from_embedded_resources().await?;

        let model_count = models.len() as u32;
        tracing::info!(
            "[ModelRegistry] 从内嵌资源加载了 {} 个模型, {} 个别名配置",
            models.len(),
            aliases.len()
        );

        // 更新缓存
        {
            let mut cache = self.models_cache.write().await;
            *cache = models.clone();
        }
        {
            let mut cache = self.aliases_cache.write().await;
            *cache = aliases;
        }

        // 更新同步状态
        {
            let mut state = self.sync_state.write().await;
            state.model_count = model_count;
            state.last_sync_at = Some(chrono::Utc::now().timestamp());
            state.is_syncing = false;
            state.last_error = None;
        }

        // 保存到数据库
        self.save_models_to_db(&models).await?;

        Ok(model_count)
    }

    /// 按 Provider 获取模型
    pub async fn get_models_by_provider(&self, provider_id: &str) -> Vec<EnhancedModelMetadata> {
        self.models_cache
            .read()
            .await
            .iter()
            .filter(|m| m.provider_id == provider_id)
            .cloned()
            .collect()
    }

    /// 按服务等级获取模型
    pub async fn get_models_by_tier(&self, tier: ModelTier) -> Vec<EnhancedModelMetadata> {
        self.models_cache
            .read()
            .await
            .iter()
            .filter(|m| m.tier == tier)
            .cloned()
            .collect()
    }

    /// 搜索模型（简单的模糊匹配）
    pub async fn search_models(&self, query: &str, limit: usize) -> Vec<EnhancedModelMetadata> {
        let models = self.models_cache.read().await;

        if query.is_empty() {
            return models.iter().take(limit).cloned().collect();
        }

        let query_lower = query.to_lowercase();
        let mut scored: Vec<(f64, &EnhancedModelMetadata)> = models
            .iter()
            .filter_map(|m| {
                let score = self.calculate_search_score(m, &query_lower);
                if score > 0.0 {
                    Some((score, m))
                } else {
                    None
                }
            })
            .collect();

        // 按分数降序排序
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        scored
            .into_iter()
            .take(limit)
            .map(|(_, m)| m.clone())
            .collect()
    }

    /// 计算搜索匹配分数
    fn calculate_search_score(&self, model: &EnhancedModelMetadata, query: &str) -> f64 {
        let mut score = 0.0;

        // 精确匹配 ID
        if model.id.to_lowercase() == query {
            score += 100.0;
        } else if model.id.to_lowercase().contains(query) {
            score += 50.0;
        }

        // 显示名称匹配
        if model.display_name.to_lowercase().contains(query) {
            score += 30.0;
        }

        // Provider 匹配
        if model.provider_name.to_lowercase().contains(query) {
            score += 20.0;
        }

        // 家族匹配
        if let Some(family) = &model.family {
            if family.to_lowercase().contains(query) {
                score += 15.0;
            }
        }

        // 最新版本加分
        if model.is_latest {
            score += 5.0;
        }

        // 活跃状态加分
        if model.status == ModelStatus::Active {
            score += 3.0;
        }

        score
    }

    // ========== 用户偏好相关方法 ==========

    /// 获取所有用户偏好
    pub async fn get_all_preferences(&self) -> Result<Vec<UserModelPreference>, String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(
                "SELECT model_id, is_favorite, is_hidden, custom_alias,
                        usage_count, last_used_at, created_at, updated_at
                 FROM user_model_preferences",
            )
            .map_err(|e| e.to_string())?;

        let prefs = stmt
            .query_map([], |row| {
                Ok(UserModelPreference {
                    model_id: row.get(0)?,
                    is_favorite: row.get::<_, i32>(1)? != 0,
                    is_hidden: row.get::<_, i32>(2)? != 0,
                    custom_alias: row.get(3)?,
                    usage_count: row.get::<_, i32>(4)? as u32,
                    last_used_at: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(prefs)
    }

    /// 切换收藏状态
    pub async fn toggle_favorite(&self, model_id: &str) -> Result<bool, String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp();

        // 检查是否存在
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM user_model_preferences WHERE model_id = ?",
                params![model_id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if exists {
            // 切换状态
            conn.execute(
                "UPDATE user_model_preferences
                 SET is_favorite = NOT is_favorite, updated_at = ?
                 WHERE model_id = ?",
                params![now, model_id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            // 创建新记录
            conn.execute(
                "INSERT INTO user_model_preferences
                 (model_id, is_favorite, is_hidden, usage_count, created_at, updated_at)
                 VALUES (?, 1, 0, 0, ?, ?)",
                params![model_id, now, now],
            )
            .map_err(|e| e.to_string())?;
        }

        // 返回新状态
        let new_state: bool = conn
            .query_row(
                "SELECT is_favorite FROM user_model_preferences WHERE model_id = ?",
                params![model_id],
                |row| Ok(row.get::<_, i32>(0)? != 0),
            )
            .unwrap_or(false);

        Ok(new_state)
    }

    /// 隐藏模型
    pub async fn hide_model(&self, model_id: &str) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "INSERT INTO user_model_preferences
             (model_id, is_favorite, is_hidden, usage_count, created_at, updated_at)
             VALUES (?, 0, 1, 0, ?, ?)
             ON CONFLICT(model_id) DO UPDATE SET is_hidden = 1, updated_at = ?",
            params![model_id, now, now, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// 记录模型使用
    pub async fn record_usage(&self, model_id: &str) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp();

        conn.execute(
            "INSERT INTO user_model_preferences
             (model_id, is_favorite, is_hidden, usage_count, last_used_at, created_at, updated_at)
             VALUES (?, 0, 0, 1, ?, ?, ?)
             ON CONFLICT(model_id) DO UPDATE SET
                usage_count = usage_count + 1,
                last_used_at = ?,
                updated_at = ?",
            params![model_id, now, now, now, now, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    // ========== Provider 别名相关方法 ==========

    /// 获取指定 Provider 的别名配置
    pub async fn get_provider_alias_config(&self, provider: &str) -> Option<ProviderAliasConfig> {
        self.aliases_cache.read().await.get(provider).cloned()
    }

    /// 检查指定 Provider 是否支持某个模型
    pub async fn provider_supports_model(&self, provider: &str, model: &str) -> bool {
        if let Some(config) = self.aliases_cache.read().await.get(provider) {
            config.supports_model(model)
        } else {
            // 如果没有别名配置，默认支持所有模型
            true
        }
    }

    /// 获取模型在指定 Provider 中的内部名称
    pub async fn get_model_internal_name(&self, provider: &str, model: &str) -> Option<String> {
        self.aliases_cache
            .read()
            .await
            .get(provider)
            .and_then(|config| config.get_internal_name(model).map(|s| s.to_string()))
    }

    /// 获取所有 Provider 别名配置
    pub async fn get_all_alias_configs(&self) -> HashMap<String, ProviderAliasConfig> {
        self.aliases_cache.read().await.clone()
    }

    // ========== 从 Provider API 获取模型 ==========

    pub fn requires_api_key_for_model_fetch(
        provider_id: &str,
        api_host: &str,
        provider_type: ApiProviderType,
    ) -> bool {
        match provider_type {
            ApiProviderType::Ollama => false,
            ApiProviderType::Openai
            | ApiProviderType::OpenaiResponse
            | ApiProviderType::Codex
            | ApiProviderType::NewApi
            | ApiProviderType::Gateway
            | ApiProviderType::Fal => !Self::is_keyless_openai_like_provider(provider_id, api_host),
            ApiProviderType::Anthropic
            | ApiProviderType::AnthropicCompatible
            | ApiProviderType::Gemini
            | ApiProviderType::AzureOpenai
            | ApiProviderType::Vertexai
            | ApiProviderType::AwsBedrock => true,
        }
    }

    /// 从 Provider API 获取模型列表
    ///
    /// 调用 Provider 的 /v1/models 端点获取模型列表，
    /// 如果失败则回退到本地 JSON 文件
    ///
    /// # 参数
    /// - `provider_id`: Provider ID（如 "siliconflow", "openai"）
    /// - `api_host`: API 主机地址
    /// - `api_key`: API Key
    ///
    /// # 返回
    /// - `Ok(FetchModelsResult)`: 获取结果，包含模型列表和来源
    pub async fn fetch_models_from_api(
        &self,
        provider_id: &str,
        api_host: &str,
        api_key: &str,
    ) -> Result<FetchModelsResult, String> {
        self.fetch_models_from_api_with_hints(provider_id, api_host, api_key, None, &[])
            .await
    }

    /// 从 Provider API 获取模型列表（带兜底提示）
    ///
    /// 优先使用 API 实时结果；当 API 不可用时，按以下顺序进行本地兜底：
    /// 1. 精确匹配 custom_models
    /// 2. 按 provider_id / provider_type / api_host 推断候选 provider
    /// 3. 使用本地资源中的候选 provider 模型列表
    ///
    /// 对 Anthropic 兼容 Provider，不执行本地模型兜底，避免误显示其它厂商模型。
    pub async fn fetch_models_from_api_with_hints(
        &self,
        provider_id: &str,
        api_host: &str,
        api_key: &str,
        provider_type: Option<ApiProviderType>,
        custom_models: &[String],
    ) -> Result<FetchModelsResult, String> {
        tracing::info!(
            "[ModelRegistry] 从 API 获取模型: provider={}, host={}",
            provider_id,
            api_host
        );

        let fetch_protocol =
            Self::resolve_model_fetch_protocol(provider_id, api_host, provider_type);
        if fetch_protocol == ModelFetchProtocol::ResponsesCompatible {
            let (scoped_local_models, scoped_local_source) = self
                .resolve_scoped_local_models(provider_id, api_host, custom_models)
                .await;
            let keeps_custom_models = !scoped_local_models.is_empty()
                && scoped_local_source == ModelFetchSource::CustomModels;
            let keeps_catalog_models =
                !scoped_local_models.is_empty() && scoped_local_source == ModelFetchSource::Catalog;
            let error = if keeps_custom_models {
                "当前 Responses 兼容入口未提供标准 /models 接口，已保留当前 Provider 的自定义模型。"
                    .to_string()
            } else if keeps_catalog_models {
                "当前 Responses 兼容入口未提供标准 /models 接口，已回退到内置厂商目录。".to_string()
            } else {
                "当前 Responses 兼容入口未提供标准 /models 接口。".to_string()
            };

            return Ok(FetchModelsResult {
                models: scoped_local_models,
                source: scoped_local_source,
                error: Some(error),
                request_url: None,
                diagnostic_hint: Some(
                    "当前 Base URL 走 `/responses` 主链，Lime 不再探测 `/v1/models`；如需在设置页展示模型，请直接在 Provider 中填写自定义模型。"
                        .to_string(),
                ),
                error_kind: Some(ModelFetchErrorKind::NotFound),
                should_prompt_error: false,
            });
        }

        let api_url = Self::build_diagnostic_models_api_url(provider_id, api_host, provider_type);
        if let Some(url) = api_url.as_ref() {
            tracing::info!("[ModelRegistry] API URL: {}", url);
        }
        let diagnostic_hint = api_url
            .as_ref()
            .and_then(|url| Self::build_models_api_hint(provider_id, api_host, url));

        // 尝试从 API 获取
        match self
            .call_models_api(provider_id, api_host, api_key, provider_type)
            .await
        {
            Ok((api_models, request_url)) => {
                tracing::info!("[ModelRegistry] 从 API 获取到 {} 个模型", api_models.len());

                // 转换为内部格式
                let now = chrono::Utc::now().timestamp();
                let models: Vec<EnhancedModelMetadata> = api_models
                    .into_iter()
                    .map(|m| self.convert_api_model(m, provider_id, now))
                    .collect();

                Ok(FetchModelsResult {
                    models,
                    source: ModelFetchSource::Api,
                    error: None,
                    request_url: Some(request_url),
                    diagnostic_hint: None,
                    error_kind: None,
                    should_prompt_error: false,
                })
            }
            Err(api_error) => {
                tracing::warn!(
                    "[ModelRegistry] API 获取失败: {}, 回退到本地文件",
                    api_error.message
                );

                if Self::should_disable_registry_fallback(api_host, provider_type) {
                    let (scoped_local_models, scoped_local_source) = self
                        .resolve_scoped_local_models(provider_id, api_host, custom_models)
                        .await;
                    let keeps_custom_models = !scoped_local_models.is_empty()
                        && scoped_local_source == ModelFetchSource::CustomModels;
                    let keeps_catalog_models = !scoped_local_models.is_empty()
                        && scoped_local_source == ModelFetchSource::Catalog;
                    let is_anthropic_models_not_found =
                        api_error.kind == ModelFetchErrorKind::NotFound;
                    let adjusted_hint = if is_anthropic_models_not_found {
                        None
                    } else {
                        diagnostic_hint
                    };
                    let error = if is_anthropic_models_not_found {
                        if keeps_custom_models {
                            "当前 Anthropic 兼容入口未提供标准 /models 接口，已保留当前 Provider 的自定义模型。"
                                .to_string()
                        } else if keeps_catalog_models {
                            "当前 Anthropic 兼容入口未提供标准 /models 接口，已回退到内置厂商目录。"
                                .to_string()
                        } else {
                            "当前 Anthropic 兼容入口未提供标准 /models 接口。".to_string()
                        }
                    } else if keeps_custom_models {
                        format!(
                            "API 获取失败: {}，已保留当前 Provider 的自定义模型；同时不再回退通用本地目录，避免误显示其它厂商模型。",
                            api_error.message
                        )
                    } else if keeps_catalog_models {
                        format!(
                            "API 获取失败: {}，已回退到内置厂商目录；同时不再回退通用本地目录，避免误显示其它厂商模型。",
                            api_error.message
                        )
                    } else {
                        format!(
                            "API 获取失败: {}，当前 Provider 不再回退通用本地目录，避免误显示其它厂商模型。",
                            api_error.message
                        )
                    };

                    return Ok(FetchModelsResult {
                        models: scoped_local_models,
                        source: scoped_local_source,
                        error: Some(error),
                        request_url: api_url,
                        diagnostic_hint: adjusted_hint,
                        error_kind: Some(api_error.kind.clone()),
                        should_prompt_error: false,
                    });
                }

                // 回退到本地资源模型（多级匹配）
                let local_models = self
                    .resolve_local_fallback_models(
                        provider_id,
                        api_host,
                        provider_type,
                        custom_models,
                    )
                    .await;

                if local_models.is_empty() {
                    Ok(FetchModelsResult {
                        models: vec![],
                        source: ModelFetchSource::LocalFallback,
                        error: Some(format!("API 获取失败: {}, 本地也无数据", api_error.message)),
                        request_url: api_url.clone(),
                        diagnostic_hint,
                        error_kind: Some(api_error.kind.clone()),
                        should_prompt_error: Self::should_prompt_model_fetch_error(&api_error.kind),
                    })
                } else {
                    Ok(FetchModelsResult {
                        models: local_models,
                        source: ModelFetchSource::LocalFallback,
                        error: Some(format!(
                            "API 获取失败: {}, 已使用本地数据",
                            api_error.message
                        )),
                        request_url: api_url,
                        diagnostic_hint,
                        error_kind: Some(api_error.kind.clone()),
                        should_prompt_error: Self::should_prompt_model_fetch_error(&api_error.kind),
                    })
                }
            }
        }
    }

    pub async fn get_local_fallback_model_ids_with_hints(
        &self,
        provider_id: &str,
        api_host: &str,
        provider_type: Option<ApiProviderType>,
        custom_models: &[String],
    ) -> Vec<String> {
        self.resolve_local_fallback_models(provider_id, api_host, provider_type, custom_models)
            .await
            .into_iter()
            .map(|model| model.id)
            .collect()
    }

    async fn resolve_local_fallback_models(
        &self,
        provider_id: &str,
        api_host: &str,
        provider_type: Option<ApiProviderType>,
        custom_models: &[String],
    ) -> Vec<EnhancedModelMetadata> {
        let (scoped_local_models, scoped_local_source) = self
            .resolve_scoped_local_models(provider_id, api_host, custom_models)
            .await;
        if !scoped_local_models.is_empty() {
            tracing::info!(
                "[ModelRegistry] 本地兜底命中 scoped {}: provider={}, matched={}",
                match scoped_local_source {
                    ModelFetchSource::CustomModels => "custom_models",
                    ModelFetchSource::Catalog => "catalog_models",
                    _ => "local_models",
                },
                provider_id,
                scoped_local_models.len()
            );
            return scoped_local_models;
        }

        if Self::should_disable_registry_fallback(api_host, provider_type) {
            tracing::info!(
                "[ModelRegistry] 当前协议禁用通用本地模型兜底: provider={}, host={}",
                provider_id,
                api_host
            );
            return Vec::new();
        }

        let candidate_provider_ids = self
            .collect_fallback_provider_ids(provider_id, api_host, provider_type, custom_models)
            .await;

        tracing::info!(
            "[ModelRegistry] 本地兜底候选 provider: provider={}, candidates={:?}",
            provider_id,
            candidate_provider_ids
        );

        self.collect_local_models_for_candidates(&candidate_provider_ids)
            .await
    }

    async fn resolve_scoped_local_models(
        &self,
        provider_id: &str,
        api_host: &str,
        custom_models: &[String],
    ) -> (Vec<EnhancedModelMetadata>, ModelFetchSource) {
        let scoped_provider_candidates = self
            .collect_explicit_model_provider_ids(provider_id, api_host)
            .await;
        let matched_custom_models = self
            .match_local_models_by_ids(custom_models, Some(scoped_provider_candidates.as_slice()))
            .await;
        let scoped_catalog_models = self
            .collect_local_models_for_candidates(&scoped_provider_candidates)
            .await;

        if Self::should_prefer_scoped_catalog_for_host(api_host, &scoped_provider_candidates)
            && !scoped_catalog_models.is_empty()
        {
            return (scoped_catalog_models, ModelFetchSource::Catalog);
        }

        if !matched_custom_models.is_empty() {
            return (matched_custom_models, ModelFetchSource::CustomModels);
        }

        // 对未知 relay / 自定义网关场景，显式 custom_models 仍应按“精确模型 ID”保留，
        // 不能因为 provider_id / host 无法映射，就退化成整包通用目录。
        let globally_matched_custom_models =
            self.match_local_models_by_ids(custom_models, None).await;
        if !globally_matched_custom_models.is_empty() {
            return (
                globally_matched_custom_models,
                ModelFetchSource::CustomModels,
            );
        }

        if !scoped_catalog_models.is_empty() {
            return (scoped_catalog_models, ModelFetchSource::Catalog);
        }

        (Vec::new(), ModelFetchSource::LocalFallback)
    }

    fn should_prefer_scoped_catalog_for_host(
        api_host: &str,
        scoped_provider_candidates: &[String],
    ) -> bool {
        if !api_host.to_lowercase().contains("xiaomimimo.com") {
            return false;
        }

        scoped_provider_candidates
            .iter()
            .any(|candidate| candidate == "xiaomi")
    }

    async fn collect_local_models_for_candidates(
        &self,
        candidate_provider_ids: &[String],
    ) -> Vec<EnhancedModelMetadata> {
        let cache = self.models_cache.read().await;
        let mut models = Vec::new();
        let mut seen_ids = HashSet::new();

        for candidate in candidate_provider_ids {
            for model in cache.iter().filter(|m| m.provider_id == *candidate) {
                if seen_ids.insert(model.id.clone()) {
                    models.push(model.clone());
                }
            }
        }

        models
    }

    async fn match_local_models_by_ids(
        &self,
        model_ids: &[String],
        provider_candidates: Option<&[String]>,
    ) -> Vec<EnhancedModelMetadata> {
        if model_ids.is_empty() {
            return Vec::new();
        }

        let target_ids: HashSet<String> = model_ids
            .iter()
            .map(|id| id.trim().to_lowercase())
            .filter(|id| !id.is_empty())
            .collect();

        if target_ids.is_empty() {
            return Vec::new();
        }

        let provider_candidates = provider_candidates.map(|candidates| {
            candidates
                .iter()
                .map(|candidate| candidate.trim().to_lowercase())
                .filter(|candidate| !candidate.is_empty())
                .collect::<HashSet<_>>()
        });

        let cache = self.models_cache.read().await;
        cache
            .iter()
            .filter(|model| {
                target_ids.contains(&model.id.to_lowercase())
                    && provider_candidates.as_ref().is_none_or(|candidates| {
                        candidates.contains(&model.provider_id.to_lowercase())
                    })
            })
            .cloned()
            .collect()
    }

    async fn collect_fallback_provider_ids(
        &self,
        provider_id: &str,
        api_host: &str,
        provider_type: Option<ApiProviderType>,
        custom_models: &[String],
    ) -> Vec<String> {
        let mut candidates = Vec::new();

        Self::push_unique_candidate(&mut candidates, provider_id);

        if let Some(stripped) = provider_id.strip_suffix("_api_key") {
            Self::push_unique_candidate(&mut candidates, stripped);
        }

        // 根据 custom_models 反推 provider（可覆盖 custom-* 场景）
        if !custom_models.is_empty() {
            let target_ids: HashSet<String> = custom_models
                .iter()
                .map(|id| id.trim().to_lowercase())
                .filter(|id| !id.is_empty())
                .collect();

            if !target_ids.is_empty() {
                let cache = self.models_cache.read().await;
                for model in cache.iter() {
                    if target_ids.contains(&model.id.to_lowercase()) {
                        Self::push_unique_candidate(&mut candidates, &model.provider_id);
                    }
                }
            }
        }

        let host_alias_candidates = self.infer_provider_ids_from_host_aliases(api_host);
        let inferred_host_candidates = if host_alias_candidates.is_empty() {
            Self::infer_provider_ids_from_api_host(api_host)
        } else {
            &[]
        };

        if host_alias_candidates.is_empty() {
            for inferred_id in inferred_host_candidates {
                Self::push_unique_candidate(&mut candidates, inferred_id);
            }
        } else {
            for inferred_id in &host_alias_candidates {
                Self::push_unique_candidate(&mut candidates, inferred_id);
            }
        }

        if let Some(provider_type) = provider_type {
            let has_scoped_host_candidates =
                !host_alias_candidates.is_empty() || !inferred_host_candidates.is_empty();
            if Self::should_skip_provider_type_catalog_fallback(
                api_host,
                provider_type,
                has_scoped_host_candidates,
            ) {
                tracing::info!(
                    "[ModelRegistry] 跳过通用 provider_type 目录兜底: provider={}, host={}, type={:?}",
                    provider_id,
                    api_host,
                    provider_type
                );
            } else {
                for mapped_id in Self::map_provider_type_to_registry_ids(provider_type) {
                    Self::push_unique_candidate(&mut candidates, mapped_id);
                }
            }
        }

        candidates
    }

    async fn collect_explicit_model_provider_ids(
        &self,
        provider_id: &str,
        api_host: &str,
    ) -> Vec<String> {
        let mut candidates = Vec::new();

        Self::push_unique_candidate(&mut candidates, provider_id);

        if let Some(stripped) = provider_id.strip_suffix("_api_key") {
            Self::push_unique_candidate(&mut candidates, stripped);
        }

        let host_alias_candidates = self.infer_provider_ids_from_host_aliases(api_host);
        if host_alias_candidates.is_empty() {
            for inferred_id in Self::infer_provider_ids_from_api_host(api_host) {
                Self::push_unique_candidate(&mut candidates, inferred_id);
            }
        } else {
            for inferred_id in host_alias_candidates {
                Self::push_unique_candidate(&mut candidates, &inferred_id);
            }
        }

        candidates
    }

    fn push_unique_candidate(candidates: &mut Vec<String>, candidate: &str) {
        if candidate.trim().is_empty() {
            return;
        }

        let normalized = candidate.trim().to_lowercase();
        if !candidates.iter().any(|existing| existing == &normalized) {
            candidates.push(normalized);
        }
    }

    fn infer_provider_ids_from_host_aliases(&self, api_host: &str) -> Vec<String> {
        let host = api_host.trim().to_lowercase();
        if host.is_empty() {
            return Vec::new();
        }

        let user_path = Self::resolve_user_host_alias_path();
        let user_rules = user_path.as_ref().and_then(|path| {
            if !path.exists() {
                return None;
            }
            Self::load_host_alias_config_from_path(path, "user").map(|config| config.rules)
        });

        let system_path = self.resolve_system_host_alias_path();
        let system_rules = system_path.as_ref().and_then(|path| {
            Self::load_host_alias_config_from_path(path, "system").map(|config| config.rules)
        });

        if let Some((source, matched)) = Self::select_host_alias_candidates(
            &host,
            user_rules.as_deref(),
            system_rules.as_deref(),
        ) {
            match source {
                "user" => tracing::info!(
                    "[ModelRegistry] host_alias 用户规则命中: host={}, providers={:?}, path={:?}",
                    host,
                    matched,
                    user_path
                ),
                "system" => tracing::info!(
                    "[ModelRegistry] host_alias 系统规则命中: host={}, providers={:?}, path={:?}",
                    host,
                    matched,
                    system_path
                ),
                _ => {}
            }
            return matched;
        }

        tracing::debug!("[ModelRegistry] host_alias 未命中: host={}", host);
        Vec::new()
    }

    fn select_host_alias_candidates(
        host: &str,
        user_rules: Option<&[HostAliasRule]>,
        system_rules: Option<&[HostAliasRule]>,
    ) -> Option<(&'static str, Vec<String>)> {
        if let Some(rules) = user_rules {
            let matched = Self::match_host_alias_rules(host, rules);
            if !matched.is_empty() {
                return Some(("user", matched));
            }
        }

        if let Some(rules) = system_rules {
            let matched = Self::match_host_alias_rules(host, rules);
            if !matched.is_empty() {
                return Some(("system", matched));
            }
        }

        None
    }

    fn match_host_alias_rules(host: &str, rules: &[HostAliasRule]) -> Vec<String> {
        let mut matched = Vec::new();

        for rule in rules {
            let pattern = rule.contains.trim().to_lowercase();
            if pattern.is_empty() || !host.contains(&pattern) {
                continue;
            }

            for provider_id in &rule.providers {
                Self::push_unique_candidate(&mut matched, provider_id);
            }
        }

        matched
    }

    fn resolve_system_host_alias_path(&self) -> Option<std::path::PathBuf> {
        let resource_dir = self.resource_dir.as_ref()?;
        Some(
            resource_dir
                .join(MODELS_RESOURCE_DIR)
                .join(MODELS_HOST_ALIASES_FILE),
        )
    }

    fn load_host_alias_config_from_path(
        path: &std::path::Path,
        source: &str,
    ) -> Option<HostAliasConfig> {
        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(e) => {
                tracing::debug!(
                    "[ModelRegistry] 读取 host_aliases 配置失败: source={}, path={:?}, error={}",
                    source,
                    path,
                    e
                );
                return None;
            }
        };

        match serde_json::from_str::<HostAliasConfig>(&content) {
            Ok(config) => Some(config),
            Err(e) => {
                tracing::warn!(
                    "[ModelRegistry] 解析 host_aliases 配置失败: source={}, path={:?}, error={}",
                    source,
                    path,
                    e
                );
                None
            }
        }
    }

    fn infer_provider_ids_from_api_host(api_host: &str) -> &'static [&'static str] {
        let host = api_host.to_lowercase();

        if host.contains("bigmodel.cn") {
            return &["zhipuai"];
        }

        if host.contains("z.ai") || host.contains("zai") {
            return &["zai"];
        }

        if host.contains("moonshot.cn") {
            return &["moonshotai-cn", "moonshotai", "kimi-for-coding"];
        }

        if host.contains("moonshot.ai") {
            return &["moonshotai", "kimi-for-coding"];
        }

        if host.contains("api.kimi.com") {
            return &["kimi-for-coding"];
        }

        if host.contains("minimaxi.com") {
            return &["minimax-cn", "minimax"];
        }

        if host.contains("minimax.io") {
            return &["minimax"];
        }

        if host.contains("coding-intl.dashscope.aliyuncs.com") {
            return &["alibaba", "alibaba-cn"];
        }

        if host.contains("dashscope-intl.aliyuncs.com") {
            return &["alibaba", "alibaba-cn"];
        }

        if host.contains("dashscope.aliyuncs.com") {
            return &["alibaba-cn", "alibaba"];
        }

        if host.contains("anthropic.com") {
            return &["anthropic"];
        }

        if host.contains("openai.com") {
            return &["openai"];
        }

        if host.contains("googleapis.com") {
            return &["google"];
        }

        if host.contains("bedrock") {
            return &["amazon-bedrock"];
        }

        if host.contains("ollama") {
            return &["ollama-cloud"];
        }

        if host.contains("fal.run") {
            return &["fal"];
        }

        &[]
    }

    fn should_skip_provider_type_catalog_fallback(
        api_host: &str,
        provider_type: ApiProviderType,
        has_scoped_host_candidates: bool,
    ) -> bool {
        if has_scoped_host_candidates {
            return false;
        }

        if !matches!(
            provider_type,
            ApiProviderType::Openai
                | ApiProviderType::OpenaiResponse
                | ApiProviderType::Codex
                | ApiProviderType::NewApi
                | ApiProviderType::Gateway
        ) {
            return false;
        }

        let original_host = api_host.trim().trim_end_matches('/');
        if original_host.is_empty() {
            return false;
        }

        let normalized_host = normalize_openai_model_discovery_host(api_host);
        normalized_host.trim_end_matches('/') != original_host
    }

    fn map_provider_type_to_registry_ids(
        provider_type: ApiProviderType,
    ) -> &'static [&'static str] {
        match provider_type {
            ApiProviderType::Openai
            | ApiProviderType::OpenaiResponse
            | ApiProviderType::NewApi
            | ApiProviderType::Gateway
            | ApiProviderType::AzureOpenai => &["openai"],
            ApiProviderType::Anthropic | ApiProviderType::AnthropicCompatible => &["anthropic"],
            ApiProviderType::Gemini => &["google"],
            ApiProviderType::Vertexai => &["google-vertex", "google"],
            ApiProviderType::AwsBedrock => &["amazon-bedrock"],
            ApiProviderType::Ollama => &["ollama-cloud"],
            ApiProviderType::Fal => &["fal", "openai"],
            ApiProviderType::Codex => &["codex"],
        }
    }

    fn is_keyless_openai_like_provider(provider_id: &str, api_host: &str) -> bool {
        let normalized_provider_id = provider_id.trim().to_lowercase();
        if matches!(
            normalized_provider_id.as_str(),
            "ollama" | "lmstudio" | "gpustack" | "ovms"
        ) {
            return true;
        }

        let normalized_host = api_host.trim().to_lowercase();
        matches!(
            normalized_host.as_str(),
            host if host.contains("://localhost")
                || host.contains("://127.0.0.1")
                || host.contains("://0.0.0.0")
                || host.contains("://host.docker.internal")
        )
    }

    fn resolve_model_fetch_protocol(
        provider_id: &str,
        api_host: &str,
        provider_type: Option<ApiProviderType>,
    ) -> ModelFetchProtocol {
        if let Some(provider_type) = provider_type {
            return match provider_type {
                ApiProviderType::Openai
                | ApiProviderType::OpenaiResponse
                | ApiProviderType::NewApi
                | ApiProviderType::Gateway
                | ApiProviderType::Fal => {
                    if is_openai_responses_compatible_host(api_host) {
                        ModelFetchProtocol::ResponsesCompatible
                    } else {
                        ModelFetchProtocol::OpenAiCompatible
                    }
                }
                ApiProviderType::Codex => ModelFetchProtocol::ResponsesCompatible,
                ApiProviderType::Anthropic | ApiProviderType::AnthropicCompatible => {
                    ModelFetchProtocol::Anthropic
                }
                ApiProviderType::Gemini => ModelFetchProtocol::Gemini,
                ApiProviderType::Ollama => ModelFetchProtocol::Ollama,
                ApiProviderType::AzureOpenai
                | ApiProviderType::Vertexai
                | ApiProviderType::AwsBedrock => ModelFetchProtocol::Unsupported,
            };
        }

        let normalized_provider = provider_id.trim().to_lowercase();
        let normalized_host = api_host.trim().to_lowercase();

        if normalized_provider == "ollama"
            || normalized_host.contains("ollama")
            || normalized_host.contains("://localhost:11434")
            || normalized_host.contains("://127.0.0.1:11434")
        {
            return ModelFetchProtocol::Ollama;
        }

        if normalized_provider.contains("gemini")
            || normalized_provider == "google"
            || normalized_host.contains("generativelanguage.googleapis.com")
        {
            return ModelFetchProtocol::Gemini;
        }

        if normalized_provider.contains("anthropic") || normalized_host.contains("anthropic.com") {
            return ModelFetchProtocol::Anthropic;
        }

        if is_openai_responses_compatible_host(api_host) {
            return ModelFetchProtocol::ResponsesCompatible;
        }

        ModelFetchProtocol::OpenAiCompatible
    }

    fn should_disable_registry_fallback(
        api_host: &str,
        provider_type: Option<ApiProviderType>,
    ) -> bool {
        if matches!(provider_type, Some(ApiProviderType::AnthropicCompatible)) {
            return true;
        }

        let host = api_host.trim().to_lowercase();
        host.contains("/anthropic")
    }

    /// 构建模型枚举 API URL
    fn build_models_api_url(api_host: &str) -> String {
        let normalized_host = normalize_openai_model_discovery_host(api_host);
        let host = normalized_host.trim_end_matches('/');

        if host.ends_with("/models") {
            return host.to_string();
        }

        // 检查是否已经包含 /v1 路径
        if host.ends_with("/v1") || host.ends_with("/v1/") {
            format!("{}/models", host.trim_end_matches('/'))
        } else if host.contains("/v1/") {
            // 如果路径中间有 /v1/，直接追加 models
            format!("{}models", host.trim_end_matches('/').to_string() + "/")
        } else if Self::has_versioned_api_suffix(host) {
            format!("{host}/models")
        } else {
            format!("{host}/v1/models")
        }
    }

    fn parse_api_host_url(api_host: &str) -> Option<reqwest::Url> {
        let trimmed = api_host.trim();
        if trimmed.is_empty() {
            return None;
        }

        reqwest::Url::parse(trimmed)
            .or_else(|_| reqwest::Url::parse(&format!("https://{trimmed}")))
            .ok()
    }

    fn api_host_without_query_fragment(api_host: &str) -> String {
        let trimmed = api_host.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            return String::new();
        }

        let had_scheme = trimmed.starts_with("http://") || trimmed.starts_with("https://");
        if let Some(mut url) = Self::parse_api_host_url(trimmed) {
            url.set_query(None);
            url.set_fragment(None);
            let normalized = url.to_string().trim_end_matches('/').to_string();
            return if had_scheme {
                normalized
            } else {
                normalized
                    .trim_start_matches("https://")
                    .trim_end_matches('/')
                    .to_string()
            };
        }

        trimmed
            .split(['?', '#'])
            .next()
            .unwrap_or(trimmed)
            .trim_end_matches('/')
            .to_string()
    }

    fn normalize_lime_tenant_id(value: &str) -> Option<String> {
        let tenant_id = value.trim();
        if tenant_id.is_empty() {
            return None;
        }

        tenant_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
            .then(|| tenant_id.to_string())
    }

    fn parse_lime_tenant_id_from_pairs(value: &str) -> Option<String> {
        form_urlencoded::parse(value.as_bytes()).find_map(|(key, value)| {
            (key == LIME_TENANT_PARAM)
                .then(|| Self::normalize_lime_tenant_id(&value))
                .flatten()
        })
    }

    fn lime_tenant_id_from_api_host(api_host: &str) -> Option<String> {
        let url = Self::parse_api_host_url(api_host)?;

        url.query()
            .and_then(Self::parse_lime_tenant_id_from_pairs)
            .or_else(|| {
                url.fragment()
                    .and_then(Self::parse_lime_tenant_id_from_pairs)
            })
    }

    fn build_gemini_models_api_url(api_host: &str) -> String {
        let host = api_host.trim_end_matches('/');

        if host.ends_with("/models") {
            return host.to_string();
        }

        if host.ends_with("/v1beta") || host.ends_with("/v1") {
            return format!("{host}/models");
        }

        if host.contains("/v1beta/") || host.contains("/v1/") {
            return format!("{}/models", host.trim_end_matches('/'));
        }

        format!("{host}/v1beta/models")
    }

    fn build_ollama_models_api_url(api_host: &str) -> String {
        let normalized_host = Self::normalize_ollama_loopback_host(api_host);
        let host = normalized_host.trim_end_matches('/');

        if host.ends_with("/api/tags") {
            return host.to_string();
        }

        if host.ends_with("/api") {
            return format!("{host}/tags");
        }

        format!("{host}/api/tags")
    }

    fn normalize_ollama_loopback_host(api_host: &str) -> String {
        let trimmed = api_host.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        let had_scheme = trimmed.starts_with("http://") || trimmed.starts_with("https://");
        let parse_target = if had_scheme {
            trimmed.to_string()
        } else {
            format!("http://{trimmed}")
        };

        let Ok(mut url) = reqwest::Url::parse(&parse_target) else {
            return trimmed.to_string();
        };

        if matches!(url.host_str(), Some("localhost")) && url.set_host(Some("127.0.0.1")).is_err() {
            return trimmed.to_string();
        }

        let normalized = url.to_string();
        if had_scheme {
            normalized.trim_end_matches('/').to_string()
        } else {
            normalized
                .trim_start_matches("http://")
                .trim_end_matches('/')
                .to_string()
        }
    }

    fn build_diagnostic_models_api_url(
        provider_id: &str,
        api_host: &str,
        provider_type: Option<ApiProviderType>,
    ) -> Option<String> {
        let host = api_host.trim();
        if host.is_empty() {
            return None;
        }

        let url = match Self::resolve_model_fetch_protocol(provider_id, api_host, provider_type) {
            ModelFetchProtocol::Gemini => Self::build_gemini_models_api_url(host),
            ModelFetchProtocol::Ollama => Self::build_ollama_models_api_url(host),
            ModelFetchProtocol::ResponsesCompatible => return None,
            ModelFetchProtocol::Anthropic | ModelFetchProtocol::OpenAiCompatible => {
                Self::build_models_api_url(host)
            }
            ModelFetchProtocol::Unsupported => host.trim_end_matches('/').to_string(),
        };

        Some(url)
    }

    fn has_versioned_api_suffix(api_host: &str) -> bool {
        let path = api_host
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(api_host)
            .split_once('/')
            .map(|(_, path)| path)
            .unwrap_or("");

        let segments: Vec<&str> = path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect();
        if segments.is_empty() {
            return false;
        }

        let version = segments[segments.len() - 1];
        version.starts_with('v')
            && version
                .strip_prefix('v')
                .map(|suffix| !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit()))
                .unwrap_or(false)
    }

    fn build_models_api_hint(provider_id: &str, api_host: &str, api_url: &str) -> Option<String> {
        let normalized_host = normalize_openai_model_discovery_host(api_host);
        let original_host = Self::api_host_without_query_fragment(api_host);
        if !original_host.is_empty()
            && normalized_host.trim_end_matches('/') != original_host.trim_end_matches('/')
        {
            return Some(format!(
                "当前 API Host 看起来是具体接口地址而不是基础地址。Lime 已自动回退到 `{api_url}` 尝试模型枚举；如果上游本身不提供 `/models`，请改填基础 API Host，或直接在 Provider 中填写自定义模型。"
            ));
        }

        let host = api_host.to_lowercase();
        let provider = provider_id.to_lowercase();

        if provider.contains("doubao")
            || provider.contains("volc")
            || host.contains("volces.com")
            || host.contains("volcengine")
        {
            return Some(format!(
                "豆包 / 火山方舟通常应使用 Base URL `https://ark.cn-beijing.volces.com/api/v3`。当前模型列表请求为 `{api_url}`，如果出现 404，请优先检查 Base URL 是否配置为该地址。"
            ));
        }

        if provider.contains("zhipu") || host.contains("bigmodel.cn/api/paas") {
            return Some(format!(
                "智谱 GLM 官方 OpenAI 兼容 Base URL 通常应使用 `https://open.bigmodel.cn/api/paas/v4`。当前模型列表请求为 `{api_url}`，如果出现 404，请优先检查 Base URL 是否保留 `/api/paas/v4`，不要再额外改成 `/v1` 风格地址。"
            ));
        }

        None
    }

    fn should_prompt_model_fetch_error(kind: &ModelFetchErrorKind) -> bool {
        matches!(
            kind,
            ModelFetchErrorKind::NotFound
                | ModelFetchErrorKind::Unauthorized
                | ModelFetchErrorKind::Forbidden
        )
    }

    fn prepare_model_fetch_request(
        provider_id: &str,
        api_host: &str,
        api_key: &str,
        provider_type: Option<ApiProviderType>,
    ) -> Result<PreparedModelFetchRequest, ModelsApiError> {
        let protocol = Self::resolve_model_fetch_protocol(provider_id, api_host, provider_type);
        let normalized_host = api_host.trim();

        if normalized_host.is_empty() {
            return Err(ModelsApiError::new(
                ModelFetchErrorKind::Other,
                "Provider 没有配置 API Host".to_string(),
            ));
        }

        if matches!(
            protocol,
            ModelFetchProtocol::Unsupported | ModelFetchProtocol::ResponsesCompatible
        ) {
            let message = if protocol == ModelFetchProtocol::ResponsesCompatible {
                "当前 Responses 兼容入口未提供标准 /models 接口".to_string()
            } else {
                "当前协议暂不支持自动获取最新模型".to_string()
            };
            return Err(ModelsApiError::new(ModelFetchErrorKind::Other, message));
        }

        let request_type = provider_type.unwrap_or(match protocol {
            ModelFetchProtocol::Anthropic => ApiProviderType::Anthropic,
            ModelFetchProtocol::Gemini => ApiProviderType::Gemini,
            ModelFetchProtocol::Ollama => ApiProviderType::Ollama,
            ModelFetchProtocol::OpenAiCompatible
            | ModelFetchProtocol::ResponsesCompatible
            | ModelFetchProtocol::Unsupported => ApiProviderType::Openai,
        });

        let url = match protocol {
            ModelFetchProtocol::OpenAiCompatible | ModelFetchProtocol::Anthropic => {
                Self::build_models_api_url(normalized_host)
            }
            ModelFetchProtocol::Gemini => Self::build_gemini_models_api_url(normalized_host),
            ModelFetchProtocol::Ollama => Self::build_ollama_models_api_url(normalized_host),
            ModelFetchProtocol::ResponsesCompatible => unreachable!(),
            ModelFetchProtocol::Unsupported => unreachable!(),
        };

        let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
        let runtime_spec = infer_managed_runtime_spec(request_type, normalized_host);
        if !api_key.trim().is_empty() {
            let trimmed_api_key = api_key.trim();
            let auth_value = runtime_spec
                .auth_prefix
                .map(|prefix| format!("{prefix} {trimmed_api_key}"))
                .unwrap_or_else(|| trimmed_api_key.to_string());
            headers.push((runtime_spec.auth_header.to_string(), auth_value));

            if matches!(
                request_type,
                ApiProviderType::Anthropic | ApiProviderType::AnthropicCompatible
            ) && runtime_spec
                .auth_header
                .eq_ignore_ascii_case("Authorization")
            {
                headers.push(("x-api-key".to_string(), trimmed_api_key.to_string()));
            }
        }

        for (name, value) in runtime_spec.extra_headers {
            headers.push(((*name).to_string(), (*value).to_string()));
        }
        if let Some(tenant_id) = Self::lime_tenant_id_from_api_host(normalized_host) {
            headers.push((LIME_TENANT_HEADER.to_string(), tenant_id));
        }

        Ok(PreparedModelFetchRequest {
            protocol,
            url,
            headers,
        })
    }

    async fn call_models_api(
        &self,
        provider_id: &str,
        api_host: &str,
        api_key: &str,
        provider_type: Option<ApiProviderType>,
    ) -> Result<(Vec<ApiModelResponse>, String), ModelsApiError> {
        let request =
            Self::prepare_model_fetch_request(provider_id, api_host, api_key, provider_type)?;

        let mut client_builder =
            reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));
        if Self::should_bypass_proxy_for_models_api_url(&request.url) {
            tracing::info!("[ModelRegistry] 本地模型地址绕过系统代理: {}", request.url);
            client_builder = client_builder.no_proxy();
        }

        let client = client_builder.build().map_err(|e| {
            ModelsApiError::new(
                ModelFetchErrorKind::Other,
                format!("创建 HTTP 客户端失败: {e}"),
            )
        })?;

        let models = match request.protocol {
            ModelFetchProtocol::OpenAiCompatible => {
                let body = Self::send_models_api_request(
                    &client,
                    &request.url,
                    &request.headers,
                    request.protocol,
                )
                .await?;
                Self::parse_openai_models_response(&body)?
            }
            ModelFetchProtocol::Anthropic => {
                Self::call_anthropic_models_api(&client, &request.url, &request.headers).await?
            }
            ModelFetchProtocol::Gemini => {
                Self::call_gemini_models_api(&client, &request.url, &request.headers).await?
            }
            ModelFetchProtocol::Ollama => {
                let body = Self::send_models_api_request(
                    &client,
                    &request.url,
                    &request.headers,
                    request.protocol,
                )
                .await?;
                Self::parse_ollama_models_response(&body)?
            }
            ModelFetchProtocol::ResponsesCompatible => unreachable!(),
            ModelFetchProtocol::Unsupported => unreachable!(),
        };

        Ok((models, request.url))
    }

    fn summarize_http_error_body(body: &str) -> Option<String> {
        let normalized = body.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            return None;
        }

        if Self::looks_like_html_error_body(&normalized) {
            return Some("上游返回了 HTML 错误页".to_string());
        }

        const MAX_BODY_CHARS: usize = 240;
        let mut summarized = String::new();
        for (index, ch) in normalized.chars().enumerate() {
            if index >= MAX_BODY_CHARS {
                summarized.push_str("...");
                break;
            }
            summarized.push(ch);
        }

        Some(summarized)
    }

    fn looks_like_html_error_body(body: &str) -> bool {
        let preview = body.trim_start().chars().take(256).collect::<String>();
        if preview.is_empty() {
            return false;
        }

        let preview = preview.to_ascii_lowercase();
        preview.starts_with("<!doctype html")
            || preview.starts_with("<html")
            || preview.contains("<head>")
            || preview.contains("<body>")
    }

    fn format_models_api_not_found_message(protocol: ModelFetchProtocol, body: &str) -> String {
        match protocol {
            ModelFetchProtocol::Anthropic => "当前 Anthropic 兼容入口未提供标准 /models 接口；若消息测试可用，请直接使用已配置的自定义模型，或改用厂商文档提供的模型枚举入口。"
                .to_string(),
            ModelFetchProtocol::ResponsesCompatible => {
                "当前 Responses 兼容入口未提供标准 /models 接口；请直接使用已配置的自定义模型。"
                    .to_string()
            }
            _ => {
                let base_message = match Self::summarize_http_error_body(body) {
                    Some(summary) => format!("API 返回错误 404 Not Found: {summary}。"),
                    None => "API 返回错误 404 Not Found。".to_string(),
                };

                format!(
                    "{base_message}这通常表示 Base URL 路径不兼容，请检查 Provider Base URL 是否已经包含版本路径，或是否应直接使用 /models 端点。"
                )
            }
        }
    }

    async fn send_models_api_request(
        client: &reqwest::Client,
        url: &str,
        headers: &[(String, String)],
        protocol: ModelFetchProtocol,
    ) -> Result<String, ModelsApiError> {
        let mut request_builder = client.get(url);
        for (name, value) in headers {
            request_builder = request_builder.header(name, value);
        }

        let response = request_builder.send().await.map_err(|e| {
            ModelsApiError::new(ModelFetchErrorKind::Network, format!("请求失败: {e}"))
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "无法读取响应体".to_string());
            if status == reqwest::StatusCode::NOT_FOUND {
                return Err(ModelsApiError::new(
                    ModelFetchErrorKind::NotFound,
                    Self::format_models_api_not_found_message(protocol, &body),
                ));
            }
            let kind = if status == reqwest::StatusCode::UNAUTHORIZED {
                ModelFetchErrorKind::Unauthorized
            } else if status == reqwest::StatusCode::FORBIDDEN {
                ModelFetchErrorKind::Forbidden
            } else {
                ModelFetchErrorKind::Other
            };
            let message = match Self::summarize_http_error_body(&body) {
                Some(summary) => format!("API 返回错误 {status}: {summary}"),
                None => format!("API 返回错误 {status}"),
            };
            return Err(ModelsApiError::new(kind, message));
        }

        response.text().await.map_err(|e| {
            ModelsApiError::new(
                ModelFetchErrorKind::InvalidResponse,
                format!("读取响应失败: {e}"),
            )
        })
    }

    fn parse_openai_models_response(body: &str) -> Result<Vec<ApiModelResponse>, ModelsApiError> {
        let api_response: ApiModelsResponse = serde_json::from_str(body).map_err(|e| {
            ModelsApiError::new(
                ModelFetchErrorKind::InvalidResponse,
                format!("解析响应失败: {e}"),
            )
        })?;

        Ok(api_response.data)
    }

    async fn call_anthropic_models_api(
        client: &reqwest::Client,
        base_url: &str,
        headers: &[(String, String)],
    ) -> Result<Vec<ApiModelResponse>, ModelsApiError> {
        let mut models = Vec::new();
        let mut after_id: Option<String> = None;

        loop {
            let mut request_url = reqwest::Url::parse(base_url).map_err(|e| {
                ModelsApiError::new(
                    ModelFetchErrorKind::Other,
                    format!("无效的 Anthropic 模型地址: {e}"),
                )
            })?;
            request_url.query_pairs_mut().append_pair("limit", "1000");
            if let Some(after) = after_id.as_deref() {
                request_url.query_pairs_mut().append_pair("after_id", after);
            }

            let body = Self::send_models_api_request(
                client,
                request_url.as_ref(),
                headers,
                ModelFetchProtocol::Anthropic,
            )
            .await?;
            let response = Self::parse_anthropic_models_response(&body)?;
            models.extend(response.models);

            if !response.has_more {
                break;
            }

            let Some(next_after_id) = response.last_id else {
                break;
            };
            if next_after_id.trim().is_empty() {
                break;
            }
            after_id = Some(next_after_id);
        }

        Ok(models)
    }

    fn parse_anthropic_models_response(
        body: &str,
    ) -> Result<AnthropicModelsResponse, ModelsApiError> {
        let response: RawAnthropicModelsResponse = serde_json::from_str(body).map_err(|e| {
            ModelsApiError::new(
                ModelFetchErrorKind::InvalidResponse,
                format!("解析 Anthropic 响应失败: {e}"),
            )
        })?;

        let models = response
            .data
            .into_iter()
            .map(|model| ApiModelResponse {
                id: model.id.clone(),
                display_name: model.display_name,
                provider_name: None,
                family: None,
                context_length: None,
            })
            .collect();

        Ok(AnthropicModelsResponse {
            models,
            has_more: response.has_more,
            last_id: response.last_id,
        })
    }

    async fn call_gemini_models_api(
        client: &reqwest::Client,
        base_url: &str,
        headers: &[(String, String)],
    ) -> Result<Vec<ApiModelResponse>, ModelsApiError> {
        let mut models = Vec::new();
        let mut next_page_token: Option<String> = None;

        loop {
            let mut request_url = reqwest::Url::parse(base_url).map_err(|e| {
                ModelsApiError::new(
                    ModelFetchErrorKind::Other,
                    format!("无效的 Gemini 模型地址: {e}"),
                )
            })?;
            request_url
                .query_pairs_mut()
                .append_pair("pageSize", "1000");
            if let Some(page_token) = next_page_token.as_deref() {
                request_url
                    .query_pairs_mut()
                    .append_pair("pageToken", page_token);
            }

            let body = Self::send_models_api_request(
                client,
                request_url.as_ref(),
                headers,
                ModelFetchProtocol::Gemini,
            )
            .await?;
            let response = Self::parse_gemini_models_response(&body)?;
            models.extend(response.models);

            let Some(page_token) = response.next_page_token else {
                break;
            };
            if page_token.trim().is_empty() {
                break;
            }
            next_page_token = Some(page_token);
        }

        Ok(models)
    }

    fn parse_gemini_models_response(body: &str) -> Result<GeminiModelsResponse, ModelsApiError> {
        let response: RawGeminiModelsResponse = serde_json::from_str(body).map_err(|e| {
            ModelsApiError::new(
                ModelFetchErrorKind::InvalidResponse,
                format!("解析 Gemini 响应失败: {e}"),
            )
        })?;

        let models = response
            .models
            .into_iter()
            .filter(|model| {
                model
                    .supported_generation_methods
                    .as_ref()
                    .is_none_or(|methods| {
                        methods
                            .iter()
                            .any(|method| method.eq_ignore_ascii_case("generateContent"))
                    })
            })
            .map(|model| ApiModelResponse {
                id: model.name.trim_start_matches("models/").to_string(),
                display_name: model.display_name,
                provider_name: None,
                family: None,
                context_length: model.input_token_limit,
            })
            .collect();

        Ok(GeminiModelsResponse {
            models,
            next_page_token: response.next_page_token,
        })
    }

    fn parse_ollama_models_response(body: &str) -> Result<Vec<ApiModelResponse>, ModelsApiError> {
        let response: OllamaModelsResponse = serde_json::from_str(body).map_err(|e| {
            ModelsApiError::new(
                ModelFetchErrorKind::InvalidResponse,
                format!("解析 Ollama 响应失败: {e}"),
            )
        })?;

        Ok(response
            .models
            .into_iter()
            .map(|model| ApiModelResponse {
                id: model.name.clone(),
                display_name: Some(model.name),
                provider_name: None,
                family: model.details.and_then(|details| details.family),
                context_length: None,
            })
            .collect())
    }

    /// 转换 API 模型格式为内部格式
    fn convert_api_model(
        &self,
        model: ApiModelResponse,
        provider_id: &str,
        now: i64,
    ) -> EnhancedModelMetadata {
        let display_name = model.display_name.unwrap_or_else(|| {
            model
                .id
                .split('/')
                .next_back()
                .unwrap_or(&model.id)
                .to_string()
        });
        let canonical_model = maybe_get_canonical_model(provider_id, &model.id);
        let initial_taxonomy = infer_model_taxonomy(ModelTaxonomyInput {
            model_id: &model.id,
            provider_id: Some(provider_id),
            family: model.family.as_deref(),
            description: None,
            capabilities: None,
            explicit_task_families: &[],
            explicit_input_modalities: &[],
            explicit_output_modalities: &[],
            explicit_runtime_features: &[],
            explicit_deployment_source: None,
            explicit_management_plane: None,
            provider_model_id: Some(model.id.as_str()),
            canonical_model_id: None,
            explicit_alias_source: None,
            canonical_model: canonical_model.as_ref(),
        });
        let capabilities = infer_model_capabilities(
            &model.id,
            Some(provider_id),
            &initial_taxonomy.task_families,
        );
        let taxonomy = infer_model_taxonomy(ModelTaxonomyInput {
            model_id: &model.id,
            provider_id: Some(provider_id),
            family: model.family.as_deref(),
            description: None,
            capabilities: Some(&capabilities),
            explicit_task_families: &initial_taxonomy.task_families,
            explicit_input_modalities: &initial_taxonomy.input_modalities,
            explicit_output_modalities: &initial_taxonomy.output_modalities,
            explicit_runtime_features: &[],
            explicit_deployment_source: None,
            explicit_management_plane: None,
            provider_model_id: Some(model.id.as_str()),
            canonical_model_id: initial_taxonomy.canonical_model_id.as_deref(),
            explicit_alias_source: initial_taxonomy.alias_source.clone(),
            canonical_model: canonical_model.as_ref(),
        });

        EnhancedModelMetadata {
            id: model.id.clone(),
            display_name,
            provider_id: provider_id.to_string(),
            provider_name: model
                .provider_name
                .unwrap_or_else(|| provider_id.to_string()),
            family: model.family,
            tier: ModelTier::Pro,
            capabilities,
            task_families: taxonomy.task_families,
            input_modalities: taxonomy.input_modalities,
            output_modalities: taxonomy.output_modalities,
            runtime_features: taxonomy.runtime_features,
            deployment_source: taxonomy.deployment_source,
            management_plane: taxonomy.management_plane,
            canonical_model_id: taxonomy.canonical_model_id,
            provider_model_id: taxonomy.provider_model_id,
            alias_source: taxonomy.alias_source,
            pricing: None,
            limits: ModelLimits {
                context_length: model.context_length,
                max_output_tokens: None,
                requests_per_minute: None,
                tokens_per_minute: None,
            },
            status: ModelStatus::Active,
            release_date: None,
            is_latest: false,
            description: None,
            source: ModelSource::Api,
            created_at: now,
            updated_at: now,
        }
    }

    fn should_bypass_proxy_for_models_api_url(url: &str) -> bool {
        let Ok(parsed) = reqwest::Url::parse(url) else {
            return false;
        };

        let Some(host) = parsed.host_str() else {
            return false;
        };
        let normalized_host = host.trim_matches(['[', ']']);

        if matches!(
            normalized_host,
            "localhost" | "127.0.0.1" | "::1" | "0.0.0.0" | "host.docker.internal"
        ) {
            return true;
        }

        normalized_host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback() || ip.is_unspecified())
            .unwrap_or(false)
    }
}

// ============================================================================
// API 响应类型
// ============================================================================

#[derive(Debug, Clone)]
struct ModelsApiError {
    kind: ModelFetchErrorKind,
    message: String,
}

impl ModelsApiError {
    fn new(kind: ModelFetchErrorKind, message: String) -> Self {
        Self { kind, message }
    }
}

/// OpenAI /v1/models API 响应格式
#[derive(Debug, Deserialize)]
struct ApiModelsResponse {
    data: Vec<ApiModelResponse>,
}

/// 单个模型的 API 响应
#[derive(Debug, Deserialize)]
struct ApiModelResponse {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default, alias = "owned_by")]
    provider_name: Option<String>,
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    context_length: Option<u32>,
}

#[derive(Debug)]
struct AnthropicModelsResponse {
    models: Vec<ApiModelResponse>,
    has_more: bool,
    last_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawAnthropicModelsResponse {
    #[serde(default)]
    data: Vec<RawAnthropicModelResponse>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    last_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawAnthropicModelResponse {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Debug)]
struct GeminiModelsResponse {
    models: Vec<ApiModelResponse>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawGeminiModelsResponse {
    #[serde(default)]
    models: Vec<RawGeminiModelResponse>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawGeminiModelResponse {
    name: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    input_token_limit: Option<u32>,
    #[serde(default)]
    supported_generation_methods: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct OllamaModelsResponse {
    #[serde(default)]
    models: Vec<OllamaModelResponse>,
}

#[derive(Debug, Deserialize)]
struct OllamaModelResponse {
    name: String,
    #[serde(default)]
    details: Option<OllamaModelDetails>,
}

#[derive(Debug, Deserialize)]
struct OllamaModelDetails {
    #[serde(default)]
    family: Option<String>,
}

/// 模型获取来源
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ModelFetchSource {
    /// 从 API 获取
    Api,
    /// 从厂商目录获取
    Catalog,
    /// 使用当前 Provider 显式配置的自定义模型
    CustomModels,
    /// 从本地文件回退
    LocalFallback,
}

/// 模型获取错误类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ModelFetchErrorKind {
    NotFound,
    Unauthorized,
    Forbidden,
    Network,
    InvalidResponse,
    Other,
}

/// 从 API 获取模型的结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchModelsResult {
    /// 模型列表
    pub models: Vec<EnhancedModelMetadata>,
    /// 数据来源
    pub source: ModelFetchSource,
    /// 错误信息（如果有）
    pub error: Option<String>,
    /// 实际请求 URL（如果有）
    pub request_url: Option<String>,
    /// 面向用户的诊断建议（如果有）
    pub diagnostic_hint: Option<String>,
    /// 错误类型（如果有）
    pub error_kind: Option<ModelFetchErrorKind>,
    /// 是否应将该错误作为配置问题强提示
    pub should_prompt_error: bool,
}

#[cfg(test)]
mod tests {
    use super::{HostAliasRule, ModelFetchProtocol, ModelRegistryService, LIME_TENANT_HEADER};
    use lime_core::database::dao::api_key_provider::ApiProviderType;
    use lime_core::database::DbConnection;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    #[test]
    fn test_build_models_api_url() {
        assert_eq!(
            ModelRegistryService::build_models_api_url("https://api.openai.com"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            ModelRegistryService::build_models_api_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            ModelRegistryService::build_models_api_url("https://open.bigmodel.cn/api/anthropic"),
            "https://open.bigmodel.cn/api/anthropic/v1/models"
        );
        assert_eq!(
            ModelRegistryService::build_models_api_url("https://open.bigmodel.cn/api/paas/v4/"),
            "https://open.bigmodel.cn/api/paas/v4/models"
        );
        assert_eq!(
            ModelRegistryService::build_models_api_url("https://ark.cn-beijing.volces.com/api/v3/"),
            "https://ark.cn-beijing.volces.com/api/v3/models"
        );
        assert_eq!(
            ModelRegistryService::build_models_api_url("https://example.com/proxy/api/v9"),
            "https://example.com/proxy/api/v9/models"
        );
        assert_eq!(
            ModelRegistryService::build_models_api_url(
                "https://gateway.example.com/proxy/responses"
            ),
            "https://gateway.example.com/proxy/v1/models"
        );
    }

    #[test]
    fn test_prepare_model_fetch_request_adds_lime_tenant_header_from_fragment() {
        let request = ModelRegistryService::prepare_model_fetch_request(
            "lime-hub",
            "https://llm.limeai.run#lime_tenant_id=tenant-0001",
            "sk-lime-test",
            Some(ApiProviderType::Openai),
        )
        .expect("prepare Lime model fetch request");

        assert_eq!(request.url, "https://llm.limeai.run/v1/models");
        assert!(request
            .headers
            .iter()
            .any(|(name, value)| { name == "Authorization" && value == "Bearer sk-lime-test" }));
        assert!(request
            .headers
            .iter()
            .any(|(name, value)| { name == LIME_TENANT_HEADER && value == "tenant-0001" }));
    }

    #[test]
    fn test_build_models_api_hint_ignores_lime_tenant_fragment() {
        let hint = ModelRegistryService::build_models_api_hint(
            "lime-hub",
            "https://llm.limeai.run#lime_tenant_id=tenant-0001",
            "https://llm.limeai.run/v1/models",
        );

        assert_eq!(hint, None);
    }

    #[test]
    fn test_build_gemini_models_api_url() {
        assert_eq!(
            ModelRegistryService::build_gemini_models_api_url(
                "https://generativelanguage.googleapis.com"
            ),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
        assert_eq!(
            ModelRegistryService::build_gemini_models_api_url(
                "https://generativelanguage.googleapis.com/v1beta"
            ),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
    }

    #[test]
    fn test_build_ollama_models_api_url() {
        assert_eq!(
            ModelRegistryService::build_ollama_models_api_url("http://localhost:11434"),
            "http://127.0.0.1:11434/api/tags"
        );
        assert_eq!(
            ModelRegistryService::build_ollama_models_api_url("http://localhost:11434/api"),
            "http://127.0.0.1:11434/api/tags"
        );
        assert_eq!(
            ModelRegistryService::build_ollama_models_api_url("http://127.0.0.1:11434"),
            "http://127.0.0.1:11434/api/tags"
        );
        assert_eq!(
            ModelRegistryService::build_ollama_models_api_url("http://127.0.0.1:11434/api"),
            "http://127.0.0.1:11434/api/tags"
        );
    }

    #[test]
    fn test_should_bypass_proxy_for_models_api_url() {
        assert!(
            ModelRegistryService::should_bypass_proxy_for_models_api_url(
                "http://127.0.0.1:11434/api/tags"
            )
        );
        assert!(
            ModelRegistryService::should_bypass_proxy_for_models_api_url(
                "http://localhost:11434/api/tags"
            )
        );
        assert!(
            ModelRegistryService::should_bypass_proxy_for_models_api_url(
                "http://[::1]:11434/api/tags"
            )
        );
        assert!(
            !ModelRegistryService::should_bypass_proxy_for_models_api_url(
                "https://api.openai.com/v1/models"
            )
        );
    }

    #[test]
    fn test_build_models_api_hint_for_doubao() {
        let hint = ModelRegistryService::build_models_api_hint(
            "doubao",
            "https://ark.cn-beijing.volces.com/api/v3",
            "https://ark.cn-beijing.volces.com/api/v3/models",
        );

        assert!(hint.is_some());
        assert!(hint
            .unwrap()
            .contains("https://ark.cn-beijing.volces.com/api/v3"));
    }

    #[test]
    fn test_build_models_api_hint_for_zhipu() {
        let hint = ModelRegistryService::build_models_api_hint(
            "zhipu",
            "https://open.bigmodel.cn/api/paas/v4",
            "https://open.bigmodel.cn/api/paas/v4/models",
        );

        assert!(hint.is_some());
        assert!(hint
            .unwrap()
            .contains("https://open.bigmodel.cn/api/paas/v4"));
    }

    #[test]
    fn test_build_models_api_hint_explains_endpoint_host_normalization() {
        let hint = ModelRegistryService::build_models_api_hint(
            "custom-codex",
            "https://gateway.example.com/proxy/responses",
            "https://gateway.example.com/proxy/v1/models",
        )
        .expect("responses endpoint should produce hint");

        assert!(hint.contains("具体接口地址而不是基础地址"));
        assert!(hint.contains("https://gateway.example.com/proxy/v1/models"));
    }

    #[test]
    fn test_format_models_api_not_found_message_for_anthropic() {
        let message = ModelRegistryService::format_models_api_not_found_message(
            ModelFetchProtocol::Anthropic,
            "<html>404</html>",
        );

        assert!(message.contains("当前 Anthropic 兼容入口未提供标准 /models 接口"));
        assert!(!message.contains("<html>"));
        assert!(!message.contains("404 Not Found"));
        assert!(!message.contains("Base URL 路径不兼容"));
    }

    #[test]
    fn test_format_models_api_not_found_message_summarizes_html_body_for_non_anthropic() {
        let message = ModelRegistryService::format_models_api_not_found_message(
            ModelFetchProtocol::OpenAiCompatible,
            "<html><head><title>404 Not Found</title></head><body>oops</body></html>",
        );

        assert!(message.contains("API 返回错误 404 Not Found: 上游返回了 HTML 错误页。"));
        assert!(!message.contains("<html>"));
        assert!(message.contains("Base URL 路径不兼容"));
    }

    #[test]
    fn test_prepare_model_fetch_request_adds_dual_auth_for_anthropic_compatible_host() {
        let request = ModelRegistryService::prepare_model_fetch_request(
            "compatible-test",
            "https://api.minimaxi.com/anthropic",
            "test-key",
            Some(ApiProviderType::AnthropicCompatible),
        )
        .expect("anthropic-compatible request should be prepared");

        assert_eq!(request.protocol, ModelFetchProtocol::Anthropic);
        assert_eq!(request.url, "https://api.minimaxi.com/anthropic/v1/models");
        assert!(request
            .headers
            .iter()
            .any(|(name, value)| name == "Authorization" && value == "Bearer test-key"));
        assert!(request
            .headers
            .iter()
            .any(|(name, value)| name == "x-api-key" && value == "test-key"));
    }

    #[test]
    fn test_prepare_model_fetch_request_keeps_x_api_key_for_official_anthropic() {
        let request = ModelRegistryService::prepare_model_fetch_request(
            "anthropic",
            "https://api.anthropic.com",
            "test-key",
            Some(ApiProviderType::Anthropic),
        )
        .expect("request should be prepared");

        assert!(request
            .headers
            .iter()
            .any(|(name, value)| name == "x-api-key" && value == "test-key"));
        assert!(!request
            .headers
            .iter()
            .any(|(name, _)| name == "Authorization"));
    }

    fn create_service_with_resource_dir(resource_dir: std::path::PathBuf) -> ModelRegistryService {
        let conn = Connection::open_in_memory().expect("in-memory db");
        let db: DbConnection = Arc::new(Mutex::new(conn));
        let mut service = ModelRegistryService::new(db);
        service.set_resource_dir(resource_dir);
        service
    }

    fn create_service_with_repo_resource_dir() -> ModelRegistryService {
        create_service_with_resource_dir(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
        )
    }

    #[test]
    fn test_infer_provider_ids_from_host_aliases_resources() {
        let temp = tempdir().expect("tempdir");
        let models_dir = temp.path().join("resources/models");
        std::fs::create_dir_all(&models_dir).expect("create models dir");
        std::fs::write(
            models_dir.join("host_aliases.json"),
            r#"{"rules":[{"contains":"bigmodel.cn","providers":["zhipuai-custom"]}]}"#,
        )
        .expect("write host aliases");

        let service = create_service_with_resource_dir(temp.path().to_path_buf());
        let provider_ids =
            service.infer_provider_ids_from_host_aliases("https://open.bigmodel.cn/api/anthropic");

        assert_eq!(provider_ids, vec!["zhipuai-custom".to_string()]);
    }

    #[test]
    fn test_select_host_alias_candidates_user_priority() {
        let user_rules = vec![HostAliasRule {
            contains: "bigmodel.cn".to_string(),
            providers: vec!["zhipuai-user".to_string()],
        }];
        let system_rules = vec![HostAliasRule {
            contains: "bigmodel.cn".to_string(),
            providers: vec!["zhipuai-system".to_string()],
        }];

        let result = ModelRegistryService::select_host_alias_candidates(
            "https://open.bigmodel.cn/api/anthropic",
            Some(&user_rules),
            Some(&system_rules),
        );

        assert!(result.is_some());
        let (source, providers) = result.expect("should match");
        assert_eq!(source, "user");
        assert_eq!(providers, vec!["zhipuai-user".to_string()]);
    }

    #[test]
    fn test_select_host_alias_candidates_system_fallback() {
        let user_rules = vec![HostAliasRule {
            contains: "not-hit-domain".to_string(),
            providers: vec!["nohit".to_string()],
        }];
        let system_rules = vec![HostAliasRule {
            contains: "bigmodel.cn".to_string(),
            providers: vec!["zhipuai-system".to_string()],
        }];

        let result = ModelRegistryService::select_host_alias_candidates(
            "https://open.bigmodel.cn/api/anthropic",
            Some(&user_rules),
            Some(&system_rules),
        );

        assert!(result.is_some());
        let (source, providers) = result.expect("should fallback to system");
        assert_eq!(source, "system");
        assert_eq!(providers, vec!["zhipuai-system".to_string()]);
    }

    #[test]
    fn test_infer_provider_ids_from_api_host() {
        assert_eq!(
            ModelRegistryService::infer_provider_ids_from_api_host(
                "https://open.bigmodel.cn/api/anthropic"
            ),
            ["zhipuai"]
        );
        assert_eq!(
            ModelRegistryService::infer_provider_ids_from_api_host(
                "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic"
            ),
            ["alibaba", "alibaba-cn"]
        );
        assert_eq!(
            ModelRegistryService::infer_provider_ids_from_api_host(
                "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/"
            ),
            ["alibaba", "alibaba-cn"]
        );
        assert_eq!(
            ModelRegistryService::infer_provider_ids_from_api_host("https://api.kimi.com/coding/"),
            ["kimi-for-coding"]
        );
        assert_eq!(
            ModelRegistryService::infer_provider_ids_from_api_host("https://api.openai.com/v1"),
            ["openai"]
        );
    }

    #[test]
    fn test_build_diagnostic_models_api_url_keeps_anthropic_compatible_provider_request() {
        assert_eq!(
            ModelRegistryService::build_diagnostic_models_api_url(
                "compatible-test",
                "https://api.minimaxi.com/anthropic",
                Some(ApiProviderType::AnthropicCompatible),
            ),
            Some("https://api.minimaxi.com/anthropic/v1/models".to_string())
        );
    }

    #[test]
    fn test_build_diagnostic_models_api_url_skips_responses_compatible_host() {
        assert_eq!(
            ModelRegistryService::build_diagnostic_models_api_url(
                "custom-yls-images",
                "https://gateway.example.com/codex",
                Some(ApiProviderType::Openai),
            ),
            None
        );
    }

    #[test]
    fn test_should_disable_registry_fallback_for_anthropic_compatible() {
        assert!(ModelRegistryService::should_disable_registry_fallback(
            "https://example.com/api/anthropic",
            Some(ApiProviderType::AnthropicCompatible),
        ));
        assert!(ModelRegistryService::should_disable_registry_fallback(
            "https://open.bigmodel.cn/api/anthropic",
            None,
        ));
        assert!(!ModelRegistryService::should_disable_registry_fallback(
            "https://api.openai.com/v1",
            Some(ApiProviderType::Openai),
        ));
    }

    #[tokio::test]
    async fn test_anthropic_compatible_local_fallback_returns_catalog_for_known_mimo_host() {
        let service = create_service_with_repo_resource_dir();
        service
            .initialize()
            .await
            .expect("initialize model registry");

        let fallback_models = service
            .get_local_fallback_model_ids_with_hints(
                "custom-mimo",
                "https://token-plan-cn.xiaomimimo.com/anthropic",
                Some(ApiProviderType::AnthropicCompatible),
                &[],
            )
            .await;

        assert_eq!(fallback_models.len(), 5);
        assert!(fallback_models.contains(&"mimo-v2.5-pro".to_string()));
        assert!(fallback_models.contains(&"mimo-v2.5".to_string()));
        assert!(fallback_models.contains(&"mimo-v2-pro".to_string()));
        assert!(fallback_models.contains(&"mimo-v2-omni".to_string()));
        assert!(fallback_models.contains(&"mimo-v2-flash".to_string()));
    }

    #[tokio::test]
    async fn test_anthropic_compatible_local_fallback_prefers_catalog_for_known_mimo_host_even_with_custom_models(
    ) {
        let service = create_service_with_repo_resource_dir();
        service
            .initialize()
            .await
            .expect("initialize model registry");

        let fallback_models = service
            .get_local_fallback_model_ids_with_hints(
                "custom-mimo",
                "https://token-plan-cn.xiaomimimo.com/anthropic",
                Some(ApiProviderType::AnthropicCompatible),
                &["mimo-v2.5-pro".to_string(), "mimo-v2-flash".to_string()],
            )
            .await;

        assert_eq!(fallback_models.len(), 5);
        assert!(fallback_models.contains(&"mimo-v2.5-pro".to_string()));
        assert!(fallback_models.contains(&"mimo-v2.5".to_string()));
        assert!(fallback_models.contains(&"mimo-v2-pro".to_string()));
        assert!(fallback_models.contains(&"mimo-v2-omni".to_string()));
        assert!(fallback_models.contains(&"mimo-v2-flash".to_string()));
    }

    #[tokio::test]
    async fn test_anthropic_compatible_local_fallback_keeps_explicit_custom_models() {
        let service = create_service_with_repo_resource_dir();
        service
            .initialize()
            .await
            .expect("initialize model registry");

        let fallback_models = service
            .get_local_fallback_model_ids_with_hints(
                "custom-minimax",
                "https://api.minimaxi.com/anthropic",
                Some(ApiProviderType::AnthropicCompatible),
                &["MiniMax-M2.7".to_string()],
            )
            .await;

        assert_eq!(fallback_models, vec!["MiniMax-M2.7".to_string()]);
    }

    #[tokio::test]
    async fn test_openai_endpoint_local_fallback_keeps_explicit_custom_models() {
        let service = create_service_with_repo_resource_dir();
        service
            .initialize()
            .await
            .expect("initialize model registry");

        let fallback_models = service
            .get_local_fallback_model_ids_with_hints(
                "custom-openai-endpoint",
                "https://gateway.example.com/proxy/responses",
                Some(ApiProviderType::Openai),
                &["gpt-images-2".to_string()],
            )
            .await;

        assert_eq!(fallback_models, vec!["gpt-images-2".to_string()]);
    }

    #[tokio::test]
    async fn test_openai_endpoint_local_fallback_does_not_expand_generic_openai_catalog() {
        let service = create_service_with_repo_resource_dir();
        service
            .initialize()
            .await
            .expect("initialize model registry");

        let fallback_models = service
            .get_local_fallback_model_ids_with_hints(
                "custom-openai-endpoint",
                "https://gateway.example.com/proxy/responses",
                Some(ApiProviderType::Openai),
                &[],
            )
            .await;

        assert!(fallback_models.is_empty());
    }

    #[test]
    fn test_map_provider_type_to_registry_ids() {
        assert_eq!(
            ModelRegistryService::map_provider_type_to_registry_ids(
                ApiProviderType::AnthropicCompatible
            ),
            ["anthropic"]
        );
        assert_eq!(
            ModelRegistryService::map_provider_type_to_registry_ids(ApiProviderType::Gemini),
            ["google"]
        );
    }

    #[test]
    fn test_requires_api_key_for_model_fetch() {
        assert!(ModelRegistryService::requires_api_key_for_model_fetch(
            "openai",
            "https://api.openai.com",
            ApiProviderType::Openai
        ));
        assert!(!ModelRegistryService::requires_api_key_for_model_fetch(
            "ollama",
            "http://127.0.0.1:11434",
            ApiProviderType::Ollama
        ));
        assert!(!ModelRegistryService::requires_api_key_for_model_fetch(
            "lmstudio",
            "http://127.0.0.1:1234/v1",
            ApiProviderType::Openai
        ));
    }

    #[test]
    fn test_resolve_model_fetch_protocol() {
        assert_eq!(
            ModelRegistryService::resolve_model_fetch_protocol(
                "google",
                "https://generativelanguage.googleapis.com",
                Some(ApiProviderType::Gemini)
            ),
            ModelFetchProtocol::Gemini
        );
        assert_eq!(
            ModelRegistryService::resolve_model_fetch_protocol(
                "anthropic",
                "https://api.anthropic.com",
                Some(ApiProviderType::Anthropic)
            ),
            ModelFetchProtocol::Anthropic
        );
        assert_eq!(
            ModelRegistryService::resolve_model_fetch_protocol(
                "azure-openai",
                "https://example.openai.azure.com",
                Some(ApiProviderType::AzureOpenai)
            ),
            ModelFetchProtocol::Unsupported
        );
        assert_eq!(
            ModelRegistryService::resolve_model_fetch_protocol(
                "custom-yls-images",
                "https://gateway.example.com/codex",
                Some(ApiProviderType::Openai)
            ),
            ModelFetchProtocol::ResponsesCompatible
        );
        assert_eq!(
            ModelRegistryService::resolve_model_fetch_protocol(
                "codex",
                "https://chatgpt.com/backend-api/codex",
                Some(ApiProviderType::Codex)
            ),
            ModelFetchProtocol::ResponsesCompatible
        );
    }

    #[test]
    fn test_parse_anthropic_models_response() {
        let response = ModelRegistryService::parse_anthropic_models_response(
            r#"{
              "data": [
                { "id": "claude-sonnet-4-5", "display_name": "Claude Sonnet 4.5" }
              ],
              "has_more": false,
              "last_id": "claude-sonnet-4-5"
            }"#,
        )
        .expect("parse anthropic response");

        assert_eq!(response.models.len(), 1);
        assert_eq!(response.models[0].id, "claude-sonnet-4-5");
        assert_eq!(
            response.models[0].display_name.as_deref(),
            Some("Claude Sonnet 4.5")
        );
    }

    #[test]
    fn test_parse_gemini_models_response() {
        let response = ModelRegistryService::parse_gemini_models_response(
            r#"{
              "models": [
                {
                  "name": "models/gemini-2.5-pro",
                  "displayName": "Gemini 2.5 Pro",
                  "inputTokenLimit": 1048576,
                  "supportedGenerationMethods": ["generateContent"]
                },
                {
                  "name": "models/text-embedding-004",
                  "displayName": "Embedding",
                  "supportedGenerationMethods": ["embedContent"]
                }
              ],
              "nextPageToken": "next-page"
            }"#,
        )
        .expect("parse gemini response");

        assert_eq!(response.models.len(), 1);
        assert_eq!(response.models[0].id, "gemini-2.5-pro");
        assert_eq!(response.next_page_token.as_deref(), Some("next-page"));
    }

    #[test]
    fn test_parse_ollama_models_response() {
        let models = ModelRegistryService::parse_ollama_models_response(
            r#"{
              "models": [
                {
                  "name": "qwen3:14b",
                  "details": { "family": "qwen3" }
                }
              ]
            }"#,
        )
        .expect("parse ollama response");

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "qwen3:14b");
        assert_eq!(models[0].family.as_deref(), Some("qwen3"));
    }
}
