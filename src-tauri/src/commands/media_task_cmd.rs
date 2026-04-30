//! 媒体任务 artifact 命令
//!
//! 当前主链先承接 Claw `@配图` 的图片任务创建，统一落到 task file 协议。

use lime_media_runtime::{
    list_task_outputs, load_task_output, patch_task_artifact, update_task_status,
    write_task_artifact, MediaTaskOutput, MediaTaskType, TaskArtifactPatch, TaskErrorRecord,
    TaskProgress, TaskRelationships, TaskWriteOptions, DEFAULT_ARTIFACT_ROOT,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::commands::aster_agent_cmd::tool_runtime::media_cli_bridge;
use crate::commands::modality_runtime_contracts::{
    assess_image_generation_model_capability_from_registry, audio_transcription_runtime_contract,
    image_generation_runtime_contract, looks_like_text_model_for_image_generation,
    normalize_audio_transcription_contract_key, normalize_audio_transcription_modality,
    normalize_audio_transcription_required_capabilities,
    normalize_audio_transcription_routing_slot, normalize_image_generation_contract_key,
    normalize_image_generation_modality, normalize_image_generation_required_capabilities,
    normalize_image_generation_routing_slot, normalize_voice_generation_contract_key,
    normalize_voice_generation_modality, normalize_voice_generation_required_capabilities,
    normalize_voice_generation_routing_slot, voice_generation_runtime_contract,
    ImageGenerationModelCapabilityAssessment, AUDIO_TRANSCRIPTION_CONTRACT_KEY,
    AUDIO_TRANSCRIPTION_ROUTING_SLOT, IMAGE_GENERATION_CONTRACT_KEY, IMAGE_GENERATION_ROUTING_SLOT,
    VOICE_GENERATION_CONTRACT_KEY, VOICE_GENERATION_ROUTING_SLOT,
};
use crate::commands::model_registry_cmd::ModelRegistryState;
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use lime_core::models::runtime_provider_model::{RuntimeCredentialData, RuntimeProviderCredential};

const IMAGE_TASK_RUNNER_WORKER_ID: &str = "lime-image-api-worker";
const AUDIO_TASK_RUNNER_WORKER_ID: &str = "lime-audio-worker";
const AUDIO_TASK_COMPLETION_WORKER_ID: &str = "lime-audio-output-writer";
const TRANSCRIPTION_TASK_RUNNER_WORKER_ID: &str = "lime-transcription-worker";
const AUDIO_TASK_DEFAULT_MIME_TYPE: &str = "audio/mpeg";
const AUDIO_TASK_DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const AUDIO_TASK_DEFAULT_VOICE: &str = "alloy";
const AUDIO_TASK_RUNNER_TIMEOUT_SECS: u64 = 240;
const AUDIO_TASK_OUTPUT_RELATIVE_DIR: &str = ".lime/runtime/audio";
const TRANSCRIPTION_TASK_DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const TRANSCRIPTION_TASK_RUNNER_TIMEOUT_SECS: u64 = 300;
const TRANSCRIPTION_TASK_OUTPUT_RELATIVE_DIR: &str = ".lime/runtime/transcripts";

static ACTIVE_IMAGE_TASK_EXECUTIONS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));
static ACTIVE_AUDIO_TASK_EXECUTIONS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));
static ACTIVE_TRANSCRIPTION_TASK_EXECUTIONS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));
const MAX_IMAGE_TASK_COUNT: u32 = 16;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageStoryboardSlotInput {
    pub prompt: String,
    #[serde(default, alias = "slot_id")]
    pub slot_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, alias = "shot_type")]
    pub shot_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateImageGenerationTaskArtifactRequest {
    pub project_root_path: String,
    pub prompt: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, alias = "title_generation_result")]
    pub title_generation_result: Option<serde_json::Value>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default, alias = "raw_text")]
    pub raw_text: Option<String>,
    #[serde(default)]
    pub layout_hint: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub aspect_ratio: Option<String>,
    #[serde(default)]
    pub count: Option<u32>,
    #[serde(default)]
    pub usage: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub content_id: Option<String>,
    #[serde(default)]
    pub entry_source: Option<String>,
    #[serde(default, alias = "modality_contract_key")]
    pub modality_contract_key: Option<String>,
    #[serde(default)]
    pub modality: Option<String>,
    #[serde(default, alias = "required_capabilities")]
    pub required_capabilities: Vec<String>,
    #[serde(default, alias = "routing_slot")]
    pub routing_slot: Option<String>,
    #[serde(default, alias = "runtime_contract")]
    pub runtime_contract: Option<serde_json::Value>,
    #[serde(default)]
    pub requested_target: Option<String>,
    #[serde(default)]
    pub slot_id: Option<String>,
    #[serde(default)]
    pub anchor_hint: Option<String>,
    #[serde(default)]
    pub anchor_section_title: Option<String>,
    #[serde(default)]
    pub anchor_text: Option<String>,
    #[serde(default)]
    pub target_output_id: Option<String>,
    #[serde(default)]
    pub target_output_ref_id: Option<String>,
    #[serde(default)]
    pub reference_images: Vec<String>,
    #[serde(default)]
    pub storyboard_slots: Vec<ImageStoryboardSlotInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAudioGenerationTaskArtifactRequest {
    pub project_root_path: String,
    #[serde(alias = "source_text", alias = "prompt", alias = "text")]
    pub source_text: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub raw_text: Option<String>,
    #[serde(default)]
    pub voice: Option<String>,
    #[serde(default, alias = "voice_style")]
    pub voice_style: Option<String>,
    #[serde(default, alias = "target_language")]
    pub target_language: Option<String>,
    #[serde(default, alias = "mime_type")]
    pub mime_type: Option<String>,
    #[serde(default, alias = "audio_path")]
    pub audio_path: Option<String>,
    #[serde(default, alias = "duration_ms")]
    pub duration_ms: Option<u64>,
    #[serde(default, alias = "provider_id")]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default, alias = "session_id")]
    pub session_id: Option<String>,
    #[serde(default, alias = "project_id")]
    pub project_id: Option<String>,
    #[serde(default, alias = "content_id")]
    pub content_id: Option<String>,
    #[serde(default, alias = "entry_source")]
    pub entry_source: Option<String>,
    #[serde(default, alias = "modality_contract_key")]
    pub modality_contract_key: Option<String>,
    #[serde(default)]
    pub modality: Option<String>,
    #[serde(default, alias = "required_capabilities")]
    pub required_capabilities: Vec<String>,
    #[serde(default, alias = "routing_slot")]
    pub routing_slot: Option<String>,
    #[serde(default, alias = "runtime_contract")]
    pub runtime_contract: Option<serde_json::Value>,
    #[serde(default, alias = "requested_target")]
    pub requested_target: Option<String>,
    #[serde(default, alias = "output_path")]
    pub output_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTranscriptionTaskArtifactRequest {
    pub project_root_path: String,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub raw_text: Option<String>,
    #[serde(default, alias = "source_url")]
    pub source_url: Option<String>,
    #[serde(default, alias = "source_path")]
    pub source_path: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default, alias = "output_format")]
    pub output_format: Option<String>,
    #[serde(default, alias = "speaker_labels")]
    pub speaker_labels: Option<bool>,
    #[serde(default)]
    pub timestamps: Option<bool>,
    #[serde(default, alias = "provider_id")]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default, alias = "session_id")]
    pub session_id: Option<String>,
    #[serde(default, alias = "project_id")]
    pub project_id: Option<String>,
    #[serde(default, alias = "content_id")]
    pub content_id: Option<String>,
    #[serde(default, alias = "entry_source")]
    pub entry_source: Option<String>,
    #[serde(default, alias = "modality_contract_key")]
    pub modality_contract_key: Option<String>,
    #[serde(default)]
    pub modality: Option<String>,
    #[serde(default, alias = "required_capabilities")]
    pub required_capabilities: Vec<String>,
    #[serde(default, alias = "routing_slot")]
    pub routing_slot: Option<String>,
    #[serde(default, alias = "runtime_contract")]
    pub runtime_contract: Option<serde_json::Value>,
    #[serde(default, alias = "requested_target")]
    pub requested_target: Option<String>,
    #[serde(default, alias = "output_path")]
    pub output_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTaskLookupRequest {
    pub project_root_path: String,
    pub task_ref: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteAudioGenerationTaskArtifactRequest {
    pub project_root_path: String,
    pub task_ref: String,
    #[serde(alias = "audio_path", alias = "audio_url")]
    pub audio_path: String,
    #[serde(default, alias = "mime_type")]
    pub mime_type: Option<String>,
    #[serde(default, alias = "duration_ms")]
    pub duration_ms: Option<u64>,
    #[serde(default, alias = "provider_id")]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMediaTaskArtifactsRequest {
    pub project_root_path: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub task_family: Option<String>,
    #[serde(default)]
    pub task_type: Option<String>,
    #[serde(default)]
    #[serde(alias = "modality_contract_key")]
    pub modality_contract_key: Option<String>,
    #[serde(default)]
    #[serde(alias = "routing_outcome")]
    pub routing_outcome: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct MediaTaskListFilters {
    pub status: Option<String>,
    pub task_family: Option<String>,
    pub task_type: Option<String>,
    pub modality_contract_key: Option<String>,
    pub routing_outcome: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct MediaTaskModalityRuntimeContractIndexEntry {
    pub task_id: String,
    pub task_type: String,
    pub normalized_status: String,
    pub contract_key: Option<String>,
    pub routing_slot: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub routing_event: String,
    pub routing_outcome: String,
    pub failure_code: Option<String>,
    pub model_capability_assessment_source: Option<String>,
    pub model_supports_image_generation: Option<bool>,
    pub audio_output_status: Option<String>,
    pub audio_output_path: Option<String>,
    pub audio_output_mime_type: Option<String>,
    pub audio_output_duration_ms: Option<u64>,
    pub audio_output_error_code: Option<String>,
    pub audio_output_retryable: Option<bool>,
    pub transcript_status: Option<String>,
    pub transcript_path: Option<String>,
    pub transcript_source_url: Option<String>,
    pub transcript_source_path: Option<String>,
    pub transcript_language: Option<String>,
    pub transcript_output_format: Option<String>,
    pub transcript_error_code: Option<String>,
    pub transcript_retryable: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct MediaTaskRoutingOutcomeCount {
    pub outcome: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct MediaTaskAudioOutputStatusCount {
    pub status: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct MediaTaskTranscriptStatusCount {
    pub status: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct MediaTaskModalityRuntimeContractIndex {
    pub snapshot_count: usize,
    pub contract_keys: Vec<String>,
    pub blocked_count: usize,
    pub routing_outcomes: Vec<MediaTaskRoutingOutcomeCount>,
    pub model_registry_assessment_count: usize,
    pub audio_output_count: usize,
    pub audio_output_statuses: Vec<MediaTaskAudioOutputStatusCount>,
    pub audio_output_error_codes: Vec<String>,
    pub transcript_count: usize,
    pub transcript_statuses: Vec<MediaTaskTranscriptStatusCount>,
    pub transcript_error_codes: Vec<String>,
    pub snapshots: Vec<MediaTaskModalityRuntimeContractIndexEntry>,
}

#[derive(Debug, Serialize)]
pub struct ListMediaTaskArtifactsResponse {
    pub success: bool,
    pub workspace_root: String,
    pub artifact_root: String,
    pub filters: MediaTaskListFilters,
    pub total: usize,
    pub modality_runtime_contracts: MediaTaskModalityRuntimeContractIndex,
    pub tasks: Vec<MediaTaskOutput>,
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ImageGenerationPreferenceDefaults {
    provider_id: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct AudioGenerationPreferenceDefaults {
    provider_id: Option<String>,
    model: Option<String>,
}

fn load_image_generation_preference_defaults() -> ImageGenerationPreferenceDefaults {
    #[cfg(test)]
    {
        return ImageGenerationPreferenceDefaults::default();
    }

    #[cfg(not(test))]
    {
        let config_path = lime_core::config::ConfigManager::default_config_path();
        let Ok(manager) = lime_core::config::ConfigManager::load(&config_path) else {
            return ImageGenerationPreferenceDefaults::default();
        };
        let image_preference = manager
            .config()
            .workspace_preferences
            .media_defaults
            .image
            .clone();

        ImageGenerationPreferenceDefaults {
            provider_id: normalize_optional_string(image_preference.preferred_provider_id),
            model: normalize_optional_string(image_preference.preferred_model_id),
        }
    }
}

fn load_audio_generation_preference_defaults() -> AudioGenerationPreferenceDefaults {
    #[cfg(test)]
    {
        return AudioGenerationPreferenceDefaults::default();
    }

    #[cfg(not(test))]
    {
        let config_path = lime_core::config::ConfigManager::default_config_path();
        let Ok(manager) = lime_core::config::ConfigManager::load(&config_path) else {
            return AudioGenerationPreferenceDefaults::default();
        };
        let voice_preference = manager
            .config()
            .workspace_preferences
            .media_defaults
            .voice
            .clone();

        AudioGenerationPreferenceDefaults {
            provider_id: normalize_optional_string(voice_preference.preferred_provider_id),
            model: normalize_optional_string(voice_preference.preferred_model_id),
        }
    }
}

fn load_audio_generation_preference_defaults_from_app(
    app: Option<&AppHandle>,
) -> AudioGenerationPreferenceDefaults {
    let Some(config_manager) =
        app.and_then(|app_handle| app_handle.try_state::<GlobalConfigManagerState>())
    else {
        return AudioGenerationPreferenceDefaults::default();
    };
    let voice_preference = config_manager
        .config()
        .workspace_preferences
        .media_defaults
        .voice
        .clone();

    AudioGenerationPreferenceDefaults {
        provider_id: normalize_optional_string(voice_preference.preferred_provider_id),
        model: normalize_optional_string(voice_preference.preferred_model_id),
    }
}

fn apply_image_generation_preference_defaults(
    provider_id: Option<String>,
    model: Option<String>,
    defaults: &ImageGenerationPreferenceDefaults,
) -> (Option<String>, Option<String>) {
    let provider_missing = provider_id.is_none();
    let effective_provider_id = provider_id.or_else(|| defaults.provider_id.clone());
    let effective_model = match model {
        Some(value) => Some(value),
        None => {
            if effective_provider_id.as_deref() == defaults.provider_id.as_deref()
                || provider_missing
            {
                defaults.model.clone()
            } else {
                None
            }
        }
    };

    (effective_provider_id, effective_model)
}

fn apply_audio_generation_preference_defaults(
    provider_id: Option<String>,
    model: Option<String>,
    defaults: &AudioGenerationPreferenceDefaults,
) -> (Option<String>, Option<String>) {
    let provider_missing = provider_id.is_none();
    let effective_provider_id = provider_id.or_else(|| defaults.provider_id.clone());
    let effective_model = match model {
        Some(value) => Some(value),
        None => {
            if effective_provider_id.as_deref() == defaults.provider_id.as_deref()
                || provider_missing
            {
                defaults.model.clone()
            } else {
                None
            }
        }
    };

    (effective_provider_id, effective_model)
}

fn normalize_required_string(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} 不能为空"));
    }
    Ok(trimmed.to_string())
}

fn normalize_reference_images(reference_images: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for image in reference_images {
        let trimmed = image.trim();
        if trimmed.is_empty() {
            continue;
        }
        if normalized.iter().any(|existing| existing == trimmed) {
            continue;
        }
        normalized.push(trimmed.to_string());
    }
    normalized
}

fn normalize_optional_json_object(value: Option<serde_json::Value>) -> Option<serde_json::Value> {
    match value {
        Some(serde_json::Value::Object(record)) if !record.is_empty() => {
            Some(serde_json::Value::Object(record))
        }
        _ => None,
    }
}

fn normalize_storyboard_slots(
    storyboard_slots: Vec<ImageStoryboardSlotInput>,
) -> Vec<ImageStoryboardSlotInput> {
    storyboard_slots
        .into_iter()
        .enumerate()
        .filter_map(|(index, slot)| {
            let prompt = slot.prompt.trim().to_string();
            if prompt.is_empty() {
                return None;
            }

            Some(ImageStoryboardSlotInput {
                prompt,
                slot_id: normalize_optional_string(slot.slot_id)
                    .or_else(|| Some(format!("storyboard-slot-{}", index + 1))),
                label: normalize_optional_string(slot.label),
                shot_type: normalize_optional_string(slot.shot_type),
            })
        })
        .take(MAX_IMAGE_TASK_COUNT as usize)
        .collect()
}

fn build_storyboard_slots_payload(
    storyboard_slots: &[ImageStoryboardSlotInput],
) -> Vec<serde_json::Value> {
    storyboard_slots
        .iter()
        .map(|slot| {
            let mut payload = serde_json::Map::new();
            payload.insert("prompt".to_string(), json!(slot.prompt));
            if let Some(slot_id) = slot.slot_id.as_ref() {
                payload.insert("slot_id".to_string(), json!(slot_id));
            }
            if let Some(label) = slot.label.as_ref() {
                payload.insert("label".to_string(), json!(label));
            }
            if let Some(shot_type) = slot.shot_type.as_ref() {
                payload.insert("shot_type".to_string(), json!(shot_type));
            }
            serde_json::Value::Object(payload)
        })
        .collect()
}

fn normalize_mode(value: Option<String>) -> Result<String, String> {
    match value
        .as_deref()
        .map(str::trim)
        .filter(|mode| !mode.is_empty())
        .unwrap_or("generate")
        .to_ascii_lowercase()
        .as_str()
    {
        "generate" => Ok("generate".to_string()),
        "edit" => Ok("edit".to_string()),
        "variation" | "variant" => Ok("variation".to_string()),
        other => Err(format!("不支持的图片任务模式: {other}")),
    }
}

fn normalize_positive_count(value: Option<u32>) -> Result<u32, String> {
    let count = value.unwrap_or(1);
    if count == 0 {
        return Err("count 必须大于 0".to_string());
    }
    Ok(count.min(MAX_IMAGE_TASK_COUNT))
}

fn build_image_task_idempotency_key(
    request: &CreateImageGenerationTaskArtifactRequest,
    mode: &str,
    prompt: &str,
    count: u32,
    size: Option<&str>,
    usage: Option<&str>,
    reference_images: &[String],
    storyboard_slots: &[ImageStoryboardSlotInput],
    target_output_ref_id: Option<&str>,
) -> Result<String, String> {
    let storyboard_slots_payload = build_storyboard_slots_payload(storyboard_slots);
    let fingerprint = json!({
        "session_id": normalize_optional_string(request.session_id.clone()),
        "project_id": normalize_optional_string(request.project_id.clone()),
        "content_id": normalize_optional_string(request.content_id.clone()),
        "entry_source": normalize_optional_string(request.entry_source.clone()),
        "mode": mode,
        "prompt": prompt,
        "size": size,
        "count": count,
        "layout_hint": normalize_optional_string(request.layout_hint.clone()),
        "usage": usage,
        "slot_id": normalize_optional_string(request.slot_id.clone()),
        "anchor_hint": normalize_optional_string(request.anchor_hint.clone()),
        "anchor_section_title": normalize_optional_string(request.anchor_section_title.clone()),
        "anchor_text": normalize_optional_string(request.anchor_text.clone()),
        "target_output_ref_id": target_output_ref_id,
        "reference_images": reference_images,
        "storyboard_slots": storyboard_slots_payload,
    });
    let serialized = serde_json::to_vec(&fingerprint)
        .map_err(|error| format!("序列化图片任务幂等指纹失败: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&serialized);
    let digest = hasher.finalize();
    Ok(format!("image-task-{}", hex::encode(&digest[..16])))
}

fn build_audio_task_idempotency_key(
    request: &CreateAudioGenerationTaskArtifactRequest,
    source_text: &str,
    voice: Option<&str>,
    voice_style: Option<&str>,
    target_language: Option<&str>,
    provider_id: Option<&str>,
    model: Option<&str>,
) -> Result<String, String> {
    let fingerprint = json!({
        "session_id": normalize_optional_string(request.session_id.clone()),
        "project_id": normalize_optional_string(request.project_id.clone()),
        "content_id": normalize_optional_string(request.content_id.clone()),
        "entry_source": normalize_optional_string(request.entry_source.clone()),
        "source_text": source_text,
        "voice": voice,
        "voice_style": voice_style,
        "target_language": target_language,
        "provider_id": provider_id,
        "model": model,
    });
    let serialized = serde_json::to_vec(&fingerprint)
        .map_err(|error| format!("序列化音频任务幂等指纹失败: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&serialized);
    let digest = hasher.finalize();
    Ok(format!("audio-task-{}", hex::encode(&digest[..16])))
}

fn build_transcription_task_idempotency_key(
    request: &CreateTranscriptionTaskArtifactRequest,
    source_url: Option<&str>,
    source_path: Option<&str>,
    language: Option<&str>,
    output_format: Option<&str>,
    provider_id: Option<&str>,
    model: Option<&str>,
) -> Result<String, String> {
    let fingerprint = json!({
        "session_id": normalize_optional_string(request.session_id.clone()),
        "project_id": normalize_optional_string(request.project_id.clone()),
        "content_id": normalize_optional_string(request.content_id.clone()),
        "entry_source": normalize_optional_string(request.entry_source.clone()),
        "source_url": source_url,
        "source_path": source_path,
        "language": language,
        "output_format": output_format,
        "speaker_labels": request.speaker_labels,
        "timestamps": request.timestamps,
        "provider_id": provider_id,
        "model": model,
    });
    let serialized = serde_json::to_vec(&fingerprint)
        .map_err(|error| format!("序列化转写任务幂等指纹失败: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&serialized);
    let digest = hasher.finalize();
    Ok(format!("transcription-task-{}", hex::encode(&digest[..16])))
}

#[derive(Debug, Clone)]
struct ImageGenerationRunnerConfig {
    endpoint: String,
    api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AudioGenerationRunnerConfig {
    provider_id: String,
    model: String,
    endpoint: String,
    api_key: String,
}

#[derive(Debug, Clone)]
struct GeneratedAudioOutput {
    audio_bytes: Vec<u8>,
    mime_type: String,
    provider_id: String,
    model: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TranscriptionRunnerConfig {
    provider_id: String,
    model: String,
    endpoint: String,
    api_key: String,
}

#[derive(Debug, Clone)]
struct TranscriptionSourceBytes {
    bytes: Vec<u8>,
    file_name: String,
    mime_type: String,
}

#[derive(Debug, Clone)]
struct GeneratedTranscriptOutput {
    content: String,
    text_preview: Option<String>,
    language: Option<String>,
    output_format: String,
    provider_id: String,
    model: String,
}

fn normalize_server_host(host: &str) -> String {
    let trimmed = host.trim();
    if trimmed.is_empty() || trimmed == "0.0.0.0" || trimmed == "::" {
        return "127.0.0.1".to_string();
    }
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return trimmed.to_string();
    }
    if trimmed.contains(':') {
        return format!("[{trimmed}]");
    }
    trimmed.to_string()
}

fn resolve_image_generation_runner_config(
    config_manager: &GlobalConfigManagerState,
) -> Result<ImageGenerationRunnerConfig, String> {
    let runtime_config = config_manager.config();
    let server_host = normalize_server_host(&runtime_config.server.host);
    let api_key = runtime_config.server.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("Lime 本地图片服务未配置 API Key".to_string());
    }

    Ok(ImageGenerationRunnerConfig {
        endpoint: format!(
            "http://{}:{}/v1/images/generations",
            server_host, runtime_config.server.port
        ),
        api_key,
    })
}

fn should_start_image_generation_worker(output: &MediaTaskOutput) -> bool {
    output.task_type == MediaTaskType::ImageGenerate.as_str()
        && matches!(output.normalized_status.as_str(), "pending" | "queued")
}

fn mark_image_task_execution_started(task_id: &str) -> bool {
    let mut active = ACTIVE_IMAGE_TASK_EXECUTIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    active.insert(task_id.to_string())
}

fn finish_image_task_execution(task_id: &str) {
    let mut active = ACTIVE_IMAGE_TASK_EXECUTIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    active.remove(task_id);
}

fn should_start_audio_generation_worker(output: &MediaTaskOutput) -> bool {
    output.task_type == MediaTaskType::AudioGenerate.as_str()
        && media_task_contract_key(output).as_deref() == Some(VOICE_GENERATION_CONTRACT_KEY)
        && matches!(output.normalized_status.as_str(), "pending" | "queued")
}

fn should_start_transcription_worker(output: &MediaTaskOutput) -> bool {
    output.task_type == MediaTaskType::TranscriptionGenerate.as_str()
        && media_task_contract_key(output).as_deref() == Some(AUDIO_TRANSCRIPTION_CONTRACT_KEY)
        && matches!(output.normalized_status.as_str(), "pending" | "queued")
}

fn mark_audio_task_execution_started(task_id: &str) -> bool {
    let mut active = ACTIVE_AUDIO_TASK_EXECUTIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    active.insert(task_id.to_string())
}

fn finish_audio_task_execution(task_id: &str) {
    let mut active = ACTIVE_AUDIO_TASK_EXECUTIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    active.remove(task_id);
}

fn mark_transcription_task_execution_started(task_id: &str) -> bool {
    let mut active = ACTIVE_TRANSCRIPTION_TASK_EXECUTIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    active.insert(task_id.to_string())
}

fn finish_transcription_task_execution(task_id: &str) {
    let mut active = ACTIVE_TRANSCRIPTION_TASK_EXECUTIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    active.remove(task_id);
}

fn build_task_progress(phase: &str, message: String, percent: Option<u32>) -> TaskProgress {
    TaskProgress {
        phase: Some(phase.to_string()),
        percent,
        message: Some(message),
        preview_slots: Vec::new(),
    }
}

fn build_task_error(
    code: &str,
    message: impl Into<String>,
    retryable: bool,
    stage: &str,
) -> TaskErrorRecord {
    TaskErrorRecord {
        code: code.to_string(),
        message: message.into(),
        retryable,
        stage: Some(stage.to_string()),
        provider_code: None,
        occurred_at: Some(chrono::Utc::now().to_rfc3339()),
    }
}

fn build_task_error_with_provider_code(
    code: &str,
    message: impl Into<String>,
    retryable: bool,
    stage: &str,
    provider_code: Option<String>,
) -> TaskErrorRecord {
    let mut error = build_task_error(code, message, retryable, stage);
    error.provider_code = provider_code;
    error
}

fn summarize_audio_response_body(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "响应体为空".to_string();
    }
    let mut summary: String = trimmed.chars().take(320).collect();
    if trimmed.chars().count() > 320 {
        summary.push_str("...");
    }
    summary
}

fn extract_audio_provider_error_code(body: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(body).ok()?;
    parsed
        .pointer("/error/code")
        .or_else(|| parsed.pointer("/error/type"))
        .or_else(|| parsed.get("code"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_openai_audio_base_url(base_url: Option<&str>) -> String {
    base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(AUDIO_TASK_DEFAULT_OPENAI_BASE_URL)
        .trim_end_matches('/')
        .to_string()
}

fn build_openai_audio_speech_url(base_url: Option<&str>) -> String {
    let normalized = normalize_openai_audio_base_url(base_url);
    if normalized.ends_with("/audio/speech") {
        normalized
    } else {
        format!("{normalized}/audio/speech")
    }
}

fn audio_response_format_for_mime_type(mime_type: Option<&str>) -> &'static str {
    match mime_type
        .map(str::trim)
        .unwrap_or(AUDIO_TASK_DEFAULT_MIME_TYPE)
        .to_ascii_lowercase()
        .as_str()
    {
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/aac" => "aac",
        "audio/ogg" | "audio/opus" => "opus",
        "audio/flac" => "flac",
        "audio/pcm" | "audio/l16" => "pcm",
        _ => "mp3",
    }
}

fn audio_file_extension_for_mime_type(mime_type: &str) -> &'static str {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/aac" => "aac",
        "audio/ogg" | "audio/opus" => "opus",
        "audio/flac" => "flac",
        "audio/pcm" | "audio/l16" => "pcm",
        _ => "mp3",
    }
}

fn transcription_file_extension_for_output_format(output_format: &str) -> &'static str {
    match output_format.trim().to_ascii_lowercase().as_str() {
        "srt" => "srt",
        "vtt" => "vtt",
        "json" | "verbose_json" => "json",
        _ => "txt",
    }
}

fn media_file_mime_type_from_name(file_name: &str) -> &'static str {
    match Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "webm" => "video/webm",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

fn sanitize_audio_output_file_stem(raw: &str) -> String {
    let mut sanitized = String::new();
    for character in raw.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
            sanitized.push(character);
        } else {
            sanitized.push('-');
        }
    }
    let sanitized = sanitized.trim_matches('-').to_string();
    if sanitized.is_empty() {
        let mut hasher = Sha256::new();
        hasher.update(raw.as_bytes());
        let digest = hasher.finalize();
        format!("audio-{}", hex::encode(&digest[..8]))
    } else {
        sanitized
    }
}

fn build_audio_output_relative_path(task_id: &str, mime_type: &str) -> PathBuf {
    let file_stem = sanitize_audio_output_file_stem(task_id);
    PathBuf::from(AUDIO_TASK_OUTPUT_RELATIVE_DIR).join(format!(
        "{file_stem}.{}",
        audio_file_extension_for_mime_type(mime_type)
    ))
}

fn build_transcript_output_relative_path(task_id: &str, output_format: &str) -> PathBuf {
    let file_stem = sanitize_audio_output_file_stem(task_id);
    PathBuf::from(TRANSCRIPTION_TASK_OUTPUT_RELATIVE_DIR).join(format!(
        "{file_stem}.{}",
        transcription_file_extension_for_output_format(output_format)
    ))
}

fn path_to_runtime_relative_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn write_audio_output_bytes(
    workspace_root: &Path,
    task_id: &str,
    mime_type: &str,
    audio_bytes: &[u8],
) -> Result<String, TaskErrorRecord> {
    if audio_bytes.is_empty() {
        return Err(build_task_error(
            "audio_provider_empty_response",
            "音频 provider 返回了空音频内容，已阻止写入 audio_output。",
            true,
            "response",
        ));
    }

    let relative_path = build_audio_output_relative_path(task_id, mime_type);
    let absolute_path = workspace_root.join(&relative_path);
    if let Some(parent) = absolute_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            build_task_error(
                "audio_output_write_failed",
                format!("创建音频输出目录失败: {error}"),
                true,
                "output",
            )
        })?;
    }
    fs::write(&absolute_path, audio_bytes).map_err(|error| {
        build_task_error(
            "audio_output_write_failed",
            format!("写入音频输出文件失败: {error}"),
            true,
            "output",
        )
    })?;

    Ok(path_to_runtime_relative_string(&relative_path))
}

fn write_transcript_output_text(
    workspace_root: &Path,
    task_id: &str,
    output_format: &str,
    content: &str,
) -> Result<String, TaskErrorRecord> {
    if content.trim().is_empty() {
        return Err(build_task_error(
            "transcription_provider_empty_response",
            "转写 provider 返回了空 transcript 内容，已阻止写入 transcript。",
            true,
            "response",
        ));
    }

    let relative_path = build_transcript_output_relative_path(task_id, output_format);
    let absolute_path = workspace_root.join(&relative_path);
    if let Some(parent) = absolute_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            build_task_error(
                "transcript_output_write_failed",
                format!("创建 transcript 输出目录失败: {error}"),
                true,
                "output",
            )
        })?;
    }
    fs::write(&absolute_path, content).map_err(|error| {
        build_task_error(
            "transcript_output_write_failed",
            format!("写入 transcript 输出文件失败: {error}"),
            true,
            "output",
        )
    })?;

    Ok(path_to_runtime_relative_string(&relative_path))
}

fn normalize_openai_transcription_base_url(base_url: Option<&str>) -> String {
    base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(TRANSCRIPTION_TASK_DEFAULT_OPENAI_BASE_URL)
        .trim_end_matches('/')
        .to_string()
}

fn build_openai_audio_transcriptions_url(base_url: Option<&str>) -> String {
    let normalized = normalize_openai_transcription_base_url(base_url);
    if normalized.ends_with("/audio/transcriptions") {
        normalized
    } else {
        format!("{normalized}/audio/transcriptions")
    }
}

fn normalize_transcription_response_format(output_format: Option<&str>) -> String {
    match output_format
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("json")
        .to_ascii_lowercase()
        .as_str()
    {
        "srt" => "srt".to_string(),
        "vtt" => "vtt".to_string(),
        "text" | "txt" | "markdown" | "md" => "text".to_string(),
        "verbose_json" | "verbose-json" => "verbose_json".to_string(),
        _ => "json".to_string(),
    }
}

fn transcript_text_preview(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut preview: String = trimmed.chars().take(500).collect();
    if trimmed.chars().count() > 500 {
        preview.push_str("...");
    }
    Some(preview)
}

fn extract_transcript_text_from_response(raw: &str, response_format: &str) -> Option<String> {
    if matches!(response_format, "text" | "srt" | "vtt") {
        return transcript_text_preview(raw);
    }

    let parsed: serde_json::Value = serde_json::from_str(raw).ok()?;
    parsed
        .get("text")
        .and_then(serde_json::Value::as_str)
        .and_then(transcript_text_preview)
}

fn extract_transcript_language_from_response(raw: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|parsed| {
            parsed
                .get("language")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

fn source_url_file_name(source_url: &str) -> String {
    let candidate = source_url
        .split('?')
        .next()
        .unwrap_or(source_url)
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("audio")
        .trim();
    if candidate.is_empty() {
        "audio".to_string()
    } else {
        candidate.to_string()
    }
}

fn resolve_transcription_source_path(workspace_root: &Path, source_path: &str) -> PathBuf {
    let path = PathBuf::from(source_path);
    if path.is_absolute() {
        path
    } else {
        workspace_root.join(path)
    }
}

fn read_image_task_payload_string<'a>(
    payload: &'a serde_json::Value,
    keys: &[&str],
) -> Option<&'a str> {
    keys.iter()
        .filter_map(|key| payload.get(*key))
        .find_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn read_image_task_payload_string_array(
    payload: &serde_json::Value,
    key: &str,
) -> Option<Vec<String>> {
    payload
        .get(key)
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
}

fn read_image_task_payload_bool(payload: &serde_json::Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .filter_map(|key| payload.get(*key))
        .find_map(serde_json::Value::as_bool)
}

fn is_image_generation_contract_routing_failure_code(code: &str) -> bool {
    matches!(
        code.trim(),
        "image_generation_contract_mismatch"
            | "image_generation_capability_gap"
            | "image_generation_routing_slot_mismatch"
            | "image_generation_model_capability_gap"
    )
}

fn media_task_contract_key(output: &MediaTaskOutput) -> Option<String> {
    read_image_task_payload_string(&output.record.payload, &["modality_contract_key"])
        .or_else(|| {
            output
                .record
                .payload
                .get("runtime_contract")
                .and_then(|value| value.get("contract_key"))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .map(ToString::to_string)
}

fn media_task_routing_outcome(output: &MediaTaskOutput) -> (&'static str, &'static str) {
    let is_contract_routing_failure = output
        .last_error
        .as_ref()
        .map(|error| is_image_generation_contract_routing_failure_code(&error.code))
        .unwrap_or(false);

    if is_contract_routing_failure {
        ("routing_not_possible", "blocked")
    } else if matches!(
        media_task_contract_key(output).as_deref(),
        Some(VOICE_GENERATION_CONTRACT_KEY) | Some(AUDIO_TRANSCRIPTION_CONTRACT_KEY)
    ) {
        if output.normalized_status == "failed" {
            ("executor_invoked", "failed")
        } else {
            ("executor_invoked", "accepted")
        }
    } else if output.normalized_status == "failed" {
        ("model_routing_decision", "failed")
    } else {
        ("model_routing_decision", "accepted")
    }
}

fn image_task_matches_modality_contract_filters(
    output: &MediaTaskOutput,
    modality_contract_key: Option<&str>,
    routing_outcome: Option<&str>,
) -> bool {
    let contract_matches = modality_contract_key
        .map(|expected| {
            media_task_contract_key(output)
                .map(|actual| actual == expected)
                .unwrap_or(false)
        })
        .unwrap_or(true);
    let (_, actual_routing_outcome) = media_task_routing_outcome(output);
    let routing_matches = routing_outcome
        .map(|expected| actual_routing_outcome == expected)
        .unwrap_or(true);
    contract_matches && routing_matches
}

fn push_unique_string(values: &mut Vec<String>, value: Option<String>) {
    let Some(value) = value else {
        return;
    };
    if values.iter().any(|existing| existing == &value) {
        return;
    }
    values.push(value);
}

fn increment_routing_outcome_count(counts: &mut Vec<MediaTaskRoutingOutcomeCount>, outcome: &str) {
    if let Some(item) = counts.iter_mut().find(|item| item.outcome == outcome) {
        item.count += 1;
        return;
    }
    counts.push(MediaTaskRoutingOutcomeCount {
        outcome: outcome.to_string(),
        count: 1,
    });
}

fn increment_audio_output_status_count(
    counts: &mut Vec<MediaTaskAudioOutputStatusCount>,
    status: &str,
) {
    if let Some(item) = counts.iter_mut().find(|item| item.status == status) {
        item.count += 1;
        return;
    }
    counts.push(MediaTaskAudioOutputStatusCount {
        status: status.to_string(),
        count: 1,
    });
}

fn increment_transcript_status_count(
    counts: &mut Vec<MediaTaskTranscriptStatusCount>,
    status: &str,
) {
    if let Some(item) = counts.iter_mut().find(|item| item.status == status) {
        item.count += 1;
        return;
    }
    counts.push(MediaTaskTranscriptStatusCount {
        status: status.to_string(),
        count: 1,
    });
}

fn media_task_audio_output(output: &MediaTaskOutput) -> Option<&serde_json::Value> {
    output
        .record
        .payload
        .get("audio_output")
        .filter(|value| value.is_object())
        .or_else(|| {
            output
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("audio_output"))
                .filter(|value| value.is_object())
        })
}

fn media_task_transcript(output: &MediaTaskOutput) -> Option<&serde_json::Value> {
    output
        .record
        .payload
        .get("transcript")
        .filter(|value| value.is_object())
        .or_else(|| {
            output
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("transcript"))
                .filter(|value| value.is_object())
        })
}

fn media_task_audio_output_string(
    audio_output: Option<&serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    audio_output
        .and_then(|value| read_image_task_payload_string(value, keys).map(ToString::to_string))
}

fn media_task_audio_output_u64(
    audio_output: Option<&serde_json::Value>,
    keys: &[&str],
) -> Option<u64> {
    audio_output.and_then(|value| {
        keys.iter()
            .find_map(|key| value.get(*key).and_then(serde_json::Value::as_u64))
    })
}

fn media_task_audio_output_bool(
    audio_output: Option<&serde_json::Value>,
    keys: &[&str],
) -> Option<bool> {
    audio_output.and_then(|value| read_image_task_payload_bool(value, keys))
}

fn media_task_transcript_string(
    transcript: Option<&serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    transcript
        .and_then(|value| read_image_task_payload_string(value, keys).map(ToString::to_string))
}

fn media_task_transcript_bool(
    transcript: Option<&serde_json::Value>,
    keys: &[&str],
) -> Option<bool> {
    transcript.and_then(|value| read_image_task_payload_bool(value, keys))
}

fn build_modality_runtime_contract_index(
    tasks: &[MediaTaskOutput],
) -> MediaTaskModalityRuntimeContractIndex {
    let mut contract_keys = Vec::new();
    let mut blocked_count = 0;
    let mut routing_outcomes = Vec::new();
    let mut model_registry_assessment_count = 0;
    let mut audio_output_count = 0;
    let mut audio_output_statuses = Vec::new();
    let mut audio_output_error_codes = Vec::new();
    let mut transcript_count = 0;
    let mut transcript_statuses = Vec::new();
    let mut transcript_error_codes = Vec::new();
    let mut snapshots = Vec::new();

    for output in tasks {
        let contract_key = media_task_contract_key(output);
        if contract_key.is_none() {
            continue;
        }

        push_unique_string(&mut contract_keys, contract_key.clone());
        let (routing_event, routing_outcome) = media_task_routing_outcome(output);
        if routing_outcome == "blocked" {
            blocked_count += 1;
        }
        increment_routing_outcome_count(&mut routing_outcomes, routing_outcome);

        let payload = &output.record.payload;
        let model_capability_assessment = payload.get("model_capability_assessment");
        let model_capability_assessment_source = model_capability_assessment
            .and_then(|value| value.get("source"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        if model_capability_assessment_source.as_deref() == Some("model_registry") {
            model_registry_assessment_count += 1;
        }
        let audio_output = media_task_audio_output(output);
        let audio_output_status = media_task_audio_output_string(audio_output, &["status"]);
        let audio_output_error_code =
            media_task_audio_output_string(audio_output, &["error_code", "errorCode"]);
        if audio_output.is_some() {
            audio_output_count += 1;
        }
        if let Some(status) = audio_output_status.as_deref() {
            increment_audio_output_status_count(&mut audio_output_statuses, status);
        }
        push_unique_string(
            &mut audio_output_error_codes,
            audio_output_error_code.clone(),
        );
        let transcript = media_task_transcript(output);
        let transcript_status = media_task_transcript_string(transcript, &["status"]);
        let transcript_error_code =
            media_task_transcript_string(transcript, &["error_code", "errorCode"]);
        if transcript.is_some() {
            transcript_count += 1;
        }
        if let Some(status) = transcript_status.as_deref() {
            increment_transcript_status_count(&mut transcript_statuses, status);
        }
        push_unique_string(&mut transcript_error_codes, transcript_error_code.clone());

        snapshots.push(MediaTaskModalityRuntimeContractIndexEntry {
            task_id: output.task_id.clone(),
            task_type: output.task_type.clone(),
            normalized_status: output.normalized_status.clone(),
            contract_key,
            routing_slot: read_image_task_payload_string(payload, &["routing_slot"])
                .map(ToString::to_string),
            provider_id: read_image_task_payload_string(payload, &["provider_id", "providerId"])
                .map(ToString::to_string),
            model: read_image_task_payload_string(payload, &["model"]).map(ToString::to_string),
            routing_event: routing_event.to_string(),
            routing_outcome: routing_outcome.to_string(),
            failure_code: output.last_error.as_ref().map(|error| error.code.clone()),
            model_capability_assessment_source,
            model_supports_image_generation: model_capability_assessment.and_then(|value| {
                read_image_task_payload_bool(value, &["supports_image_generation"])
            }),
            audio_output_status,
            audio_output_path: media_task_audio_output_string(
                audio_output,
                &["audio_path", "audioPath"],
            ),
            audio_output_mime_type: media_task_audio_output_string(
                audio_output,
                &["mime_type", "mimeType"],
            ),
            audio_output_duration_ms: media_task_audio_output_u64(
                audio_output,
                &["duration_ms", "durationMs"],
            ),
            audio_output_error_code,
            audio_output_retryable: media_task_audio_output_bool(audio_output, &["retryable"]),
            transcript_status,
            transcript_path: media_task_transcript_string(
                transcript,
                &["transcript_path", "transcriptPath", "path"],
            ),
            transcript_source_url: media_task_transcript_string(
                transcript,
                &["source_url", "sourceUrl"],
            ),
            transcript_source_path: media_task_transcript_string(
                transcript,
                &["source_path", "sourcePath"],
            ),
            transcript_language: media_task_transcript_string(transcript, &["language"]),
            transcript_output_format: media_task_transcript_string(
                transcript,
                &["output_format", "outputFormat"],
            ),
            transcript_error_code,
            transcript_retryable: media_task_transcript_bool(transcript, &["retryable"]),
        });
    }

    MediaTaskModalityRuntimeContractIndex {
        snapshot_count: snapshots.len(),
        contract_keys,
        blocked_count,
        routing_outcomes,
        model_registry_assessment_count,
        audio_output_count,
        audio_output_statuses,
        audio_output_error_codes,
        transcript_count,
        transcript_statuses,
        transcript_error_codes,
        snapshots,
    }
}

fn validate_image_generation_task_execution_contract(
    output: &MediaTaskOutput,
    model_capability: Option<&ImageGenerationModelCapabilityAssessment>,
) -> Result<(), TaskErrorRecord> {
    if output.task_type != MediaTaskType::ImageGenerate.as_str() {
        return Ok(());
    }

    let payload = &output.record.payload;
    let contract_key =
        read_image_task_payload_string(payload, &["modality_contract_key"]).or_else(|| {
            payload
                .get("runtime_contract")
                .and_then(|value| value.get("contract_key"))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        });
    if let Some(contract_key) = contract_key {
        if contract_key != IMAGE_GENERATION_CONTRACT_KEY {
            return Err(build_task_error(
                "image_generation_contract_mismatch",
                format!(
                    "图片任务 contract_key 必须是 {IMAGE_GENERATION_CONTRACT_KEY}，收到 {contract_key}"
                ),
                false,
                "contract",
            ));
        }
    }

    let required_capabilities =
        read_image_task_payload_string_array(payload, "required_capabilities").unwrap_or_default();
    if !required_capabilities.is_empty()
        && !required_capabilities
            .iter()
            .any(|capability| capability == IMAGE_GENERATION_CONTRACT_KEY)
    {
        return Err(build_task_error(
            "image_generation_capability_gap",
            "图片任务缺少 image_generation required_capability，已阻止进入执行器。",
            false,
            "routing",
        ));
    }

    if let Some(routing_slot) = read_image_task_payload_string(payload, &["routing_slot"]) {
        if routing_slot != IMAGE_GENERATION_ROUTING_SLOT {
            return Err(build_task_error(
                "image_generation_routing_slot_mismatch",
                format!(
                    "图片任务 routing_slot 必须是 {IMAGE_GENERATION_ROUTING_SLOT}，收到 {routing_slot}"
                ),
                false,
                "routing",
            ));
        }
    }

    if let Some(assessment) = model_capability {
        if !assessment.supports_image_generation {
            return Err(build_task_error(
                "image_generation_model_capability_gap",
                format!(
                    "image_generation contract 要求图片生成模型，但 model registry 显示当前模型 {} 不具备图片生成能力。",
                    assessment.model_id
                ),
                false,
                "routing",
            ));
        }
    } else if let Some(model) = read_image_task_payload_string(payload, &["model"]) {
        if looks_like_text_model_for_image_generation(model) {
            return Err(build_task_error(
                "image_generation_model_capability_gap",
                format!(
                    "image_generation contract 要求图片生成模型，但当前模型 {model} 看起来是文本模型。"
                ),
                false,
                "routing",
            ));
        }
    }

    Ok(())
}

async fn resolve_image_generation_model_capability_assessment(
    app: Option<&AppHandle>,
    output: &MediaTaskOutput,
) -> Option<ImageGenerationModelCapabilityAssessment> {
    if output.task_type != MediaTaskType::ImageGenerate.as_str() {
        return None;
    }

    let payload = &output.record.payload;
    let model = read_image_task_payload_string(payload, &["model"])?;
    let provider_id = read_image_task_payload_string(payload, &["provider_id", "providerId"]);
    let state = app?.try_state::<ModelRegistryState>()?;
    let guard = state.inner().read().await;
    let service = guard.as_ref()?;
    let catalog = service.get_all_models().await;
    assess_image_generation_model_capability_from_registry(&catalog, model, provider_id)
}

fn load_current_image_task(
    workspace_root: &Path,
    task_id: &str,
) -> Result<MediaTaskOutput, String> {
    get_media_task_artifact_inner(MediaTaskLookupRequest {
        project_root_path: workspace_root.to_string_lossy().to_string(),
        task_ref: task_id.to_string(),
    })
}

fn patch_image_task(
    workspace_root: &Path,
    task_id: &str,
    patch: TaskArtifactPatch,
) -> Result<MediaTaskOutput, String> {
    patch_task_artifact(workspace_root, task_id, None, patch)
        .map_err(|error| format!("写回图片任务状态失败: {error}"))
}

fn load_current_audio_task(
    workspace_root: &Path,
    task_id: &str,
) -> Result<MediaTaskOutput, String> {
    get_media_task_artifact_inner(MediaTaskLookupRequest {
        project_root_path: workspace_root.to_string_lossy().to_string(),
        task_ref: task_id.to_string(),
    })
}

fn patch_audio_task(
    workspace_root: &Path,
    task_id: &str,
    patch: TaskArtifactPatch,
) -> Result<MediaTaskOutput, String> {
    patch_task_artifact(workspace_root, task_id, None, patch)
        .map_err(|error| format!("写回音频任务状态失败: {error}"))
}

fn load_current_transcription_task(
    workspace_root: &Path,
    task_id: &str,
) -> Result<MediaTaskOutput, String> {
    get_media_task_artifact_inner(MediaTaskLookupRequest {
        project_root_path: workspace_root.to_string_lossy().to_string(),
        task_ref: task_id.to_string(),
    })
}

fn patch_transcription_task(
    workspace_root: &Path,
    task_id: &str,
    patch: TaskArtifactPatch,
) -> Result<MediaTaskOutput, String> {
    patch_task_artifact(workspace_root, task_id, None, patch)
        .map_err(|error| format!("写回转写任务状态失败: {error}"))
}

fn image_generation_model_capability_assessment_payload(
    assessment: &ImageGenerationModelCapabilityAssessment,
) -> serde_json::Value {
    json!({
        "model_id": assessment.model_id.as_str(),
        "provider_id": assessment.provider_id.as_deref(),
        "source": assessment.source,
        "supports_image_generation": assessment.supports_image_generation,
        "reason": assessment.reason,
    })
}

fn patch_image_task_model_capability_assessment(
    workspace_root: &Path,
    task_id: &str,
    assessment: &ImageGenerationModelCapabilityAssessment,
) -> Result<MediaTaskOutput, String> {
    patch_image_task(
        workspace_root,
        task_id,
        TaskArtifactPatch {
            payload_patch: Some(json!({
                "model_capability_assessment": image_generation_model_capability_assessment_payload(assessment)
            })),
            ..TaskArtifactPatch::default()
        },
    )
    .map_err(|error| format!("写回图片任务模型能力评估失败: {error}"))
}

fn emit_image_task_event(app: Option<&AppHandle>, output: &MediaTaskOutput) {
    emit_creation_task_event_if_needed(app, output);
}

fn emit_audio_task_event(app: Option<&AppHandle>, output: &MediaTaskOutput) {
    emit_creation_task_event_if_needed(app, output);
}

fn emit_transcription_task_event(app: Option<&AppHandle>, output: &MediaTaskOutput) {
    emit_creation_task_event_if_needed(app, output);
}

fn build_audio_output_status_summary(
    payload: &serde_json::Value,
    status: &str,
    error: Option<&TaskErrorRecord>,
) -> serde_json::Value {
    let mut audio_output = payload
        .get("audio_output")
        .cloned()
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| {
            json!({
                "kind": "audio_output",
                "audio_path": payload.get("audio_path").cloned().unwrap_or(serde_json::Value::Null),
                "mime_type": read_image_task_payload_string(payload, &["mime_type", "mimeType"]),
                "duration_ms": payload.get("duration_ms").cloned().unwrap_or(serde_json::Value::Null),
                "source_text": read_image_task_payload_string(payload, &["source_text", "sourceText", "prompt"]),
                "voice": read_image_task_payload_string(payload, &["voice"]),
                "voice_style": read_image_task_payload_string(payload, &["voice_style", "voiceStyle"]),
                "target_language": read_image_task_payload_string(payload, &["target_language", "targetLanguage"]),
            })
        });

    if let Some(audio_output_object) = audio_output.as_object_mut() {
        audio_output_object
            .entry("kind".to_string())
            .or_insert_with(|| json!("audio_output"));
        audio_output_object.insert("status".to_string(), json!(status));
        audio_output_object
            .entry("mime_type".to_string())
            .or_insert_with(|| {
                read_image_task_payload_string(payload, &["mime_type", "mimeType"])
                    .map(|value| json!(value))
                    .unwrap_or_else(|| json!(AUDIO_TASK_DEFAULT_MIME_TYPE))
            });
        audio_output_object
            .entry("source_text".to_string())
            .or_insert_with(|| {
                read_image_task_payload_string(payload, &["source_text", "sourceText", "prompt"])
                    .map(|value| json!(value))
                    .unwrap_or(serde_json::Value::Null)
            });
        audio_output_object
            .entry("voice".to_string())
            .or_insert_with(|| {
                read_image_task_payload_string(payload, &["voice"])
                    .map(|value| json!(value))
                    .unwrap_or(serde_json::Value::Null)
            });
        audio_output_object.insert(
            "modality_contract_key".to_string(),
            json!(VOICE_GENERATION_CONTRACT_KEY),
        );
        audio_output_object.insert("modality".to_string(), json!("audio"));
        audio_output_object.insert(
            "routing_slot".to_string(),
            json!(VOICE_GENERATION_ROUTING_SLOT),
        );

        if let Some(error) = error {
            audio_output_object.insert("error_code".to_string(), json!(error.code.as_str()));
            audio_output_object.insert("error_message".to_string(), json!(error.message.as_str()));
            audio_output_object.insert("retryable".to_string(), json!(error.retryable));
            audio_output_object.insert("stage".to_string(), json!(error.stage.as_deref()));
        } else {
            audio_output_object.remove("error_code");
            audio_output_object.remove("error_message");
            audio_output_object.remove("retryable");
            audio_output_object.remove("stage");
        }
    }

    audio_output
}

fn resolve_audio_generation_payload_provider_model(
    app: Option<&AppHandle>,
    output: &MediaTaskOutput,
) -> Result<(String, String), TaskErrorRecord> {
    let payload = &output.record.payload;
    let requested_provider_id =
        read_image_task_payload_string(payload, &["provider_id", "providerId"])
            .map(ToString::to_string);
    let requested_model =
        read_image_task_payload_string(payload, &["model"]).map(ToString::to_string);
    let defaults = load_audio_generation_preference_defaults_from_app(app);
    let (provider_id, model) = apply_audio_generation_preference_defaults(
        requested_provider_id,
        requested_model,
        &defaults,
    );

    match (provider_id, model) {
        (Some(provider_id), Some(model)) => Ok((provider_id, model)),
        (None, _) => Err(build_task_error(
            "audio_provider_unconfigured",
            "voice_generation 音频任务缺少 provider_id；请先配置媒体生成 voice provider，不能回退到 legacy TTS。",
            true,
            "provider_config",
        )),
        (_, None) => Err(build_task_error(
            "audio_provider_model_unconfigured",
            "voice_generation 音频任务缺少 model；请先配置媒体生成 voice model，不能回退到 legacy TTS。",
            true,
            "provider_config",
        )),
    }
}

fn audio_generation_runner_config_from_credential(
    provider_id: String,
    model: String,
    credential: RuntimeProviderCredential,
) -> Result<AudioGenerationRunnerConfig, TaskErrorRecord> {
    match credential.credential {
        RuntimeCredentialData::OpenAIKey { api_key, base_url } => Ok(AudioGenerationRunnerConfig {
            provider_id,
            model,
            endpoint: build_openai_audio_speech_url(base_url.as_deref()),
            api_key,
        }),
        _ => Err(build_task_error(
            "audio_provider_client_missing",
            format!(
                "voice_generation 当前只接入 OpenAI-compatible speech adapter，provider runtime type {} 尚未提供音频生成 client。",
                credential.provider_type
            ),
            true,
            "provider_client",
        )),
    }
}

async fn resolve_audio_generation_runner_config(
    app: Option<&AppHandle>,
    output: &MediaTaskOutput,
) -> Result<AudioGenerationRunnerConfig, TaskErrorRecord> {
    let Some(app_handle) = app else {
        return Err(build_task_error(
            "audio_provider_resolver_unavailable",
            "缺少 AppHandle，无法从 current API Key Provider 主链解析 voice_generation provider 凭证。",
            true,
            "bootstrap",
        ));
    };
    let (provider_id, model) = resolve_audio_generation_payload_provider_model(app, output)?;
    let Some(db) = app_handle
        .try_state::<DbConnection>()
        .map(|state| state.inner().clone())
    else {
        return Err(build_task_error(
            "audio_provider_resolver_unavailable",
            "DbConnection 未初始化，无法从 current API Key Provider 主链解析音频 provider。",
            true,
            "bootstrap",
        ));
    };
    let Some(api_key_provider_service) = app_handle
        .try_state::<ApiKeyProviderServiceState>()
        .map(|state| state.0.clone())
    else {
        return Err(build_task_error(
            "audio_provider_resolver_unavailable",
            "ApiKeyProviderServiceState 未初始化，无法从 current API Key Provider 主链解析音频 provider。",
            true,
            "bootstrap",
        ));
    };

    let credential = api_key_provider_service
        .select_credential_for_provider(&db, provider_id.as_str(), Some(provider_id.as_str()), None)
        .await
        .map_err(|error| {
            build_task_error(
                "audio_provider_resolution_failed",
                format!("解析 voice_generation provider 凭证失败: {error}"),
                true,
                "provider_config",
            )
        })?
        .ok_or_else(|| {
            build_task_error(
                "audio_provider_unconfigured",
                format!(
                    "未找到可用的 voice_generation provider/API Key: {provider_id}；任务保留在 audio_generate artifact，不能回退 legacy TTS。"
                ),
                true,
                "provider_config",
            )
        })?;

    audio_generation_runner_config_from_credential(provider_id, model, credential)
}

fn build_audio_generation_instructions(payload: &serde_json::Value) -> Option<String> {
    let mut instructions = Vec::new();
    if let Some(voice_style) =
        read_image_task_payload_string(payload, &["voice_style", "voiceStyle"])
    {
        instructions.push(format!("Voice style: {voice_style}."));
    }
    if let Some(target_language) =
        read_image_task_payload_string(payload, &["target_language", "targetLanguage"])
    {
        instructions.push(format!("Speak in {target_language}."));
    }

    if instructions.is_empty() {
        None
    } else {
        Some(instructions.join(" "))
    }
}

fn audio_model_supports_speech_instructions(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    normalized.starts_with("gpt-4o") || normalized.starts_with("gpt-5")
}

fn content_type_audio_mime_or_fallback(
    headers: &reqwest::header::HeaderMap,
    fallback_mime_type: &str,
) -> String {
    headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| value.starts_with("audio/"))
        .map(ToString::to_string)
        .unwrap_or_else(|| fallback_mime_type.to_string())
}

async fn request_openai_compatible_audio_generation(
    config: &AudioGenerationRunnerConfig,
    output: &MediaTaskOutput,
) -> Result<GeneratedAudioOutput, TaskErrorRecord> {
    let payload = &output.record.payload;
    let source_text =
        read_image_task_payload_string(payload, &["source_text", "sourceText", "prompt"])
            .ok_or_else(|| {
                build_task_error(
                    "invalid_audio_task_payload",
                    "audio_generate 任务缺少 source_text，无法调用音频 provider。",
                    false,
                    "payload",
                )
            })?;
    let requested_mime_type = read_image_task_payload_string(payload, &["mime_type", "mimeType"])
        .unwrap_or(AUDIO_TASK_DEFAULT_MIME_TYPE);
    let voice =
        read_image_task_payload_string(payload, &["voice"]).unwrap_or(AUDIO_TASK_DEFAULT_VOICE);
    let response_format = audio_response_format_for_mime_type(Some(requested_mime_type));
    let mut request_body = json!({
        "model": config.model.as_str(),
        "input": source_text,
        "voice": voice,
        "response_format": response_format,
    });
    if audio_model_supports_speech_instructions(&config.model) {
        if let Some(instructions) = build_audio_generation_instructions(payload) {
            if let Some(body_object) = request_body.as_object_mut() {
                body_object.insert("instructions".to_string(), json!(instructions));
            }
        }
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(AUDIO_TASK_RUNNER_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let response = client
        .post(&config.endpoint)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", config.api_key),
        )
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            build_task_error(
                "audio_provider_request_failed",
                format!("调用音频 provider 失败: {error}"),
                true,
                "request",
            )
        })?;

    let status = response.status();
    let response_mime_type =
        content_type_audio_mime_or_fallback(response.headers(), requested_mime_type);
    let body_bytes = response.bytes().await.map_err(|error| {
        build_task_error(
            "audio_provider_response_read_failed",
            format!("读取音频 provider 响应失败: {error}"),
            true,
            "response",
        )
    })?;

    if !status.is_success() {
        let body = String::from_utf8_lossy(&body_bytes).to_string();
        return Err(build_task_error_with_provider_code(
            "audio_provider_request_failed",
            format!(
                "音频 provider 返回错误 {status}: {}",
                summarize_audio_response_body(&body)
            ),
            status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS,
            "request",
            extract_audio_provider_error_code(&body),
        ));
    }

    if body_bytes.is_empty() {
        return Err(build_task_error(
            "audio_provider_empty_response",
            "音频 provider 返回了空音频内容。",
            true,
            "response",
        ));
    }

    Ok(GeneratedAudioOutput {
        audio_bytes: body_bytes.to_vec(),
        mime_type: response_mime_type,
        provider_id: config.provider_id.clone(),
        model: config.model.clone(),
    })
}

fn validate_audio_generation_task_execution_contract(
    output: &MediaTaskOutput,
) -> Result<(), TaskErrorRecord> {
    if output.task_type != MediaTaskType::AudioGenerate.as_str() {
        return Err(build_task_error(
            "voice_generation_task_type_mismatch",
            format!(
                "voice_generation 执行器只能处理 audio_generate 任务，收到 {}",
                output.task_type
            ),
            false,
            "contract",
        ));
    }

    if media_task_contract_key(output).as_deref() != Some(VOICE_GENERATION_CONTRACT_KEY) {
        return Err(build_task_error(
            "voice_generation_contract_mismatch",
            format!(
                "音频任务 contract_key 必须是 {VOICE_GENERATION_CONTRACT_KEY}，已阻止进入执行器。"
            ),
            false,
            "contract",
        ));
    }

    let required_capabilities =
        read_image_task_payload_string_array(&output.record.payload, "required_capabilities")
            .unwrap_or_default();
    if !required_capabilities.is_empty()
        && !required_capabilities
            .iter()
            .any(|capability| capability == VOICE_GENERATION_CONTRACT_KEY)
    {
        return Err(build_task_error(
            "voice_generation_capability_gap",
            "音频任务缺少 voice_generation required_capability，已阻止进入执行器。",
            false,
            "routing",
        ));
    }

    if let Some(routing_slot) =
        read_image_task_payload_string(&output.record.payload, &["routing_slot"])
    {
        if routing_slot != VOICE_GENERATION_ROUTING_SLOT {
            return Err(build_task_error(
                "voice_generation_routing_slot_mismatch",
                format!(
                    "音频任务 routing_slot 必须是 {VOICE_GENERATION_ROUTING_SLOT}，收到 {routing_slot}"
                ),
                false,
                "routing",
            ));
        }
    }

    Ok(())
}

fn build_transcript_status_summary(
    payload: &serde_json::Value,
    status: &str,
    error: Option<&TaskErrorRecord>,
) -> serde_json::Value {
    let mut transcript = payload
        .get("transcript")
        .cloned()
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| {
            json!({
                "kind": "transcript",
                "source_url": read_image_task_payload_string(payload, &["source_url", "sourceUrl"]),
                "source_path": read_image_task_payload_string(payload, &["source_path", "sourcePath"]),
                "language": read_image_task_payload_string(payload, &["language"]),
                "output_format": read_image_task_payload_string(payload, &["output_format", "outputFormat"]),
                "timestamps": payload.get("timestamps").cloned().unwrap_or(serde_json::Value::Null),
                "speaker_labels": payload.get("speaker_labels").cloned().unwrap_or(serde_json::Value::Null),
                "provider_id": read_image_task_payload_string(payload, &["provider_id", "providerId"]),
                "model": read_image_task_payload_string(payload, &["model"]),
            })
        });

    if let Some(transcript_object) = transcript.as_object_mut() {
        transcript_object
            .entry("kind".to_string())
            .or_insert_with(|| json!("transcript"));
        transcript_object.insert("status".to_string(), json!(status));
        transcript_object
            .entry("source_url".to_string())
            .or_insert_with(|| {
                read_image_task_payload_string(payload, &["source_url", "sourceUrl"])
                    .map(|value| json!(value))
                    .unwrap_or(serde_json::Value::Null)
            });
        transcript_object
            .entry("source_path".to_string())
            .or_insert_with(|| {
                read_image_task_payload_string(payload, &["source_path", "sourcePath"])
                    .map(|value| json!(value))
                    .unwrap_or(serde_json::Value::Null)
            });
        transcript_object
            .entry("language".to_string())
            .or_insert_with(|| {
                read_image_task_payload_string(payload, &["language"])
                    .map(|value| json!(value))
                    .unwrap_or(serde_json::Value::Null)
            });
        transcript_object
            .entry("output_format".to_string())
            .or_insert_with(|| {
                read_image_task_payload_string(payload, &["output_format", "outputFormat"])
                    .map(|value| json!(value))
                    .unwrap_or_else(|| json!("json"))
            });
        transcript_object.insert(
            "modality_contract_key".to_string(),
            json!(AUDIO_TRANSCRIPTION_CONTRACT_KEY),
        );
        transcript_object.insert("modality".to_string(), json!("audio"));
        transcript_object.insert(
            "routing_slot".to_string(),
            json!(AUDIO_TRANSCRIPTION_ROUTING_SLOT),
        );

        if let Some(error) = error {
            transcript_object.insert("error_code".to_string(), json!(error.code.as_str()));
            transcript_object.insert("error_message".to_string(), json!(error.message.as_str()));
            transcript_object.insert("retryable".to_string(), json!(error.retryable));
            transcript_object.insert("stage".to_string(), json!(error.stage.as_deref()));
        } else {
            transcript_object.remove("error_code");
            transcript_object.remove("error_message");
            transcript_object.remove("retryable");
            transcript_object.remove("stage");
        }
    }

    transcript
}

fn resolve_transcription_payload_provider_model(
    app: Option<&AppHandle>,
    output: &MediaTaskOutput,
) -> Result<(String, String), TaskErrorRecord> {
    let payload = &output.record.payload;
    let provider_id = read_image_task_payload_string(payload, &["provider_id", "providerId"])
        .map(ToString::to_string);
    let model = read_image_task_payload_string(payload, &["model"]).map(ToString::to_string);

    match (provider_id, model) {
        (Some(provider_id), Some(model)) => Ok((provider_id, model)),
        (None, _) if app.is_none() => Err(build_task_error(
            "transcription_provider_resolver_unavailable",
            "缺少 AppHandle，无法从 current API Key Provider 主链解析 audio_transcription provider 凭证。",
            true,
            "bootstrap",
        )),
        (None, _) => Err(build_task_error(
            "transcription_provider_unconfigured",
            "audio_transcription 转写任务缺少 provider_id；请先配置转写 provider，不能回退 frontend ASR 或 generic_file transcript。",
            true,
            "provider_config",
        )),
        (_, None) => Err(build_task_error(
            "transcription_provider_model_unconfigured",
            "audio_transcription 转写任务缺少 model；请先配置转写 model，不能回退 frontend ASR 或 generic_file transcript。",
            true,
            "provider_config",
        )),
    }
}

fn transcription_runner_config_from_credential(
    provider_id: String,
    model: String,
    credential: RuntimeProviderCredential,
) -> Result<TranscriptionRunnerConfig, TaskErrorRecord> {
    match credential.credential {
        RuntimeCredentialData::OpenAIKey { api_key, base_url } => Ok(TranscriptionRunnerConfig {
            provider_id,
            model,
            endpoint: build_openai_audio_transcriptions_url(base_url.as_deref()),
            api_key,
        }),
        _ => Err(build_task_error(
            "transcription_provider_client_missing",
            format!(
                "audio_transcription 当前只接入 OpenAI-compatible transcription adapter，provider runtime type {} 尚未提供转写 client。",
                credential.provider_type
            ),
            true,
            "provider_client",
        )),
    }
}

async fn resolve_transcription_runner_config(
    app: Option<&AppHandle>,
    output: &MediaTaskOutput,
) -> Result<TranscriptionRunnerConfig, TaskErrorRecord> {
    let Some(app_handle) = app else {
        return Err(build_task_error(
            "transcription_provider_resolver_unavailable",
            "缺少 AppHandle，无法从 current API Key Provider 主链解析 audio_transcription provider 凭证。",
            true,
            "bootstrap",
        ));
    };
    let (provider_id, model) = resolve_transcription_payload_provider_model(app, output)?;
    let Some(db) = app_handle
        .try_state::<DbConnection>()
        .map(|state| state.inner().clone())
    else {
        return Err(build_task_error(
            "transcription_provider_resolver_unavailable",
            "DbConnection 未初始化，无法从 current API Key Provider 主链解析转写 provider。",
            true,
            "bootstrap",
        ));
    };
    let Some(api_key_provider_service) = app_handle
        .try_state::<ApiKeyProviderServiceState>()
        .map(|state| state.0.clone())
    else {
        return Err(build_task_error(
            "transcription_provider_resolver_unavailable",
            "ApiKeyProviderServiceState 未初始化，无法从 current API Key Provider 主链解析转写 provider。",
            true,
            "bootstrap",
        ));
    };

    let credential = api_key_provider_service
        .select_credential_for_provider(&db, provider_id.as_str(), Some(provider_id.as_str()), None)
        .await
        .map_err(|error| {
            build_task_error(
                "transcription_provider_resolution_failed",
                format!("解析 audio_transcription provider 凭证失败: {error}"),
                true,
                "provider_config",
            )
        })?
        .ok_or_else(|| {
            build_task_error(
                "transcription_provider_unconfigured",
                format!(
                    "未找到可用的 audio_transcription provider/API Key: {provider_id}；任务保留在 transcription_generate artifact，不能回退 frontend ASR。"
                ),
                true,
                "provider_config",
            )
        })?;

    transcription_runner_config_from_credential(provider_id, model, credential)
}

async fn read_transcription_source_bytes(
    workspace_root: &Path,
    output: &MediaTaskOutput,
) -> Result<TranscriptionSourceBytes, TaskErrorRecord> {
    let payload = &output.record.payload;
    if let Some(source_path) =
        read_image_task_payload_string(payload, &["source_path", "sourcePath"])
    {
        let absolute_path = resolve_transcription_source_path(workspace_root, source_path);
        let bytes = fs::read(&absolute_path).map_err(|error| {
            build_task_error(
                "transcription_source_unavailable",
                format!("读取转写源文件失败 {}: {error}", absolute_path.display()),
                true,
                "source",
            )
        })?;
        let file_name = absolute_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("audio")
            .to_string();
        let mime_type = media_file_mime_type_from_name(&file_name).to_string();
        return Ok(TranscriptionSourceBytes {
            bytes,
            file_name,
            mime_type,
        });
    }

    let source_url = read_image_task_payload_string(payload, &["source_url", "sourceUrl"])
        .ok_or_else(|| {
            build_task_error(
                "invalid_transcription_task_payload",
                "transcription_generate 任务缺少 source_path/source_url，无法调用转写 provider。",
                false,
                "payload",
            )
        })?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(TRANSCRIPTION_TASK_RUNNER_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let response = client.get(source_url).send().await.map_err(|error| {
        build_task_error(
            "transcription_source_download_failed",
            format!("下载转写源失败: {error}"),
            true,
            "source",
        )
    })?;
    let status = response.status();
    let mime_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| media_file_mime_type_from_name(source_url).to_string());
    let bytes = response.bytes().await.map_err(|error| {
        build_task_error(
            "transcription_source_download_failed",
            format!("读取转写源下载响应失败: {error}"),
            true,
            "source",
        )
    })?;
    if !status.is_success() {
        return Err(build_task_error(
            "transcription_source_download_failed",
            format!("下载转写源返回错误 {status}。"),
            true,
            "source",
        ));
    }

    Ok(TranscriptionSourceBytes {
        bytes: bytes.to_vec(),
        file_name: source_url_file_name(source_url),
        mime_type,
    })
}

async fn request_openai_compatible_transcription(
    config: &TranscriptionRunnerConfig,
    output: &MediaTaskOutput,
    workspace_root: &Path,
) -> Result<GeneratedTranscriptOutput, TaskErrorRecord> {
    let payload = &output.record.payload;
    let source = read_transcription_source_bytes(workspace_root, output).await?;
    if source.bytes.is_empty() {
        return Err(build_task_error(
            "transcription_source_empty",
            "转写源文件为空，已阻止调用 audio_transcription provider。",
            false,
            "source",
        ));
    }

    let response_format = normalize_transcription_response_format(read_image_task_payload_string(
        payload,
        &["output_format", "outputFormat"],
    ));
    let output_format = response_format.clone();
    let file_part = reqwest::multipart::Part::bytes(source.bytes)
        .file_name(source.file_name)
        .mime_str(source.mime_type.as_str())
        .map_err(|error| {
            build_task_error(
                "transcription_source_mime_invalid",
                format!("转写源 MIME 类型无效: {error}"),
                false,
                "source",
            )
        })?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", config.model.clone())
        .text("response_format", response_format.clone());
    if let Some(language) = read_image_task_payload_string(payload, &["language"]) {
        if !language.eq_ignore_ascii_case("auto") {
            form = form.text("language", language.to_string());
        }
    }
    if let Some(prompt) = read_image_task_payload_string(payload, &["prompt", "raw_text"]) {
        form = form.text("prompt", prompt.to_string());
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(TRANSCRIPTION_TASK_RUNNER_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let response = client
        .post(&config.endpoint)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", config.api_key),
        )
        .multipart(form)
        .send()
        .await
        .map_err(|error| {
            build_task_error(
                "transcription_provider_request_failed",
                format!("调用转写 provider 失败: {error}"),
                true,
                "request",
            )
        })?;

    let status = response.status();
    let body = response.text().await.map_err(|error| {
        build_task_error(
            "transcription_provider_response_read_failed",
            format!("读取转写 provider 响应失败: {error}"),
            true,
            "response",
        )
    })?;

    if !status.is_success() {
        return Err(build_task_error_with_provider_code(
            "transcription_provider_request_failed",
            format!(
                "转写 provider 返回错误 {status}: {}",
                summarize_audio_response_body(&body)
            ),
            status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS,
            "request",
            extract_audio_provider_error_code(&body),
        ));
    }

    let text_preview = extract_transcript_text_from_response(&body, &response_format)
        .or_else(|| transcript_text_preview(&body));
    let language = extract_transcript_language_from_response(&body).or_else(|| {
        read_image_task_payload_string(payload, &["language"])
            .map(ToString::to_string)
            .filter(|value| !value.eq_ignore_ascii_case("auto"))
    });

    Ok(GeneratedTranscriptOutput {
        content: body,
        text_preview,
        language,
        output_format,
        provider_id: config.provider_id.clone(),
        model: config.model.clone(),
    })
}

fn validate_transcription_task_execution_contract(
    output: &MediaTaskOutput,
) -> Result<(), TaskErrorRecord> {
    if output.task_type != MediaTaskType::TranscriptionGenerate.as_str() {
        return Err(build_task_error(
            "audio_transcription_task_type_mismatch",
            format!(
                "audio_transcription 执行器只能处理 transcription_generate 任务，收到 {}",
                output.task_type
            ),
            false,
            "contract",
        ));
    }

    if media_task_contract_key(output).as_deref() != Some(AUDIO_TRANSCRIPTION_CONTRACT_KEY) {
        return Err(build_task_error(
            "audio_transcription_contract_mismatch",
            format!(
                "转写任务 contract_key 必须是 {AUDIO_TRANSCRIPTION_CONTRACT_KEY}，已阻止进入执行器。"
            ),
            false,
            "contract",
        ));
    }

    let required_capabilities =
        read_image_task_payload_string_array(&output.record.payload, "required_capabilities")
            .unwrap_or_default();
    if !required_capabilities.is_empty()
        && !required_capabilities
            .iter()
            .any(|capability| capability == AUDIO_TRANSCRIPTION_CONTRACT_KEY)
    {
        return Err(build_task_error(
            "audio_transcription_capability_gap",
            "转写任务缺少 audio_transcription required_capability，已阻止进入执行器。",
            false,
            "routing",
        ));
    }

    if let Some(routing_slot) =
        read_image_task_payload_string(&output.record.payload, &["routing_slot"])
    {
        if routing_slot != AUDIO_TRANSCRIPTION_ROUTING_SLOT {
            return Err(build_task_error(
                "audio_transcription_routing_slot_mismatch",
                format!(
                    "转写任务 routing_slot 必须是 {AUDIO_TRANSCRIPTION_ROUTING_SLOT}，收到 {routing_slot}"
                ),
                false,
                "routing",
            ));
        }
    }

    Ok(())
}

fn mark_image_task_failed(
    app: Option<&AppHandle>,
    workspace_root: &Path,
    task_id: &str,
    error: TaskErrorRecord,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_image_task(workspace_root, task_id)?;
    if current.normalized_status == "cancelled" {
        return Ok(current);
    }

    let output = patch_image_task(
        workspace_root,
        task_id,
        TaskArtifactPatch {
            status: Some("failed".to_string()),
            last_error: Some(Some(error.clone())),
            progress: Some(build_task_progress("failed", error.message.clone(), None)),
            current_attempt_worker_id: Some(Some(IMAGE_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    emit_image_task_event(app, &output);
    Ok(output)
}

fn mark_audio_task_failed(
    app: Option<&AppHandle>,
    workspace_root: &Path,
    task_id: &str,
    error: TaskErrorRecord,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_audio_task(workspace_root, task_id)?;
    if current.normalized_status == "cancelled" {
        return Ok(current);
    }

    let audio_output =
        build_audio_output_status_summary(&current.record.payload, "failed", Some(&error));
    let output = patch_audio_task(
        workspace_root,
        task_id,
        TaskArtifactPatch {
            status: Some("failed".to_string()),
            payload_patch: Some(json!({
                "audio_output": audio_output,
            })),
            last_error: Some(Some(error.clone())),
            progress: Some(build_task_progress("failed", error.message.clone(), None)),
            current_attempt_worker_id: Some(Some(AUDIO_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    emit_audio_task_event(app, &output);
    Ok(output)
}

fn mark_audio_task_succeeded(
    app: Option<&AppHandle>,
    workspace_root: &Path,
    task_id: &str,
    generated: GeneratedAudioOutput,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_audio_task(workspace_root, task_id)?;
    if current.normalized_status == "cancelled" {
        return Ok(current);
    }

    let audio_path = match write_audio_output_bytes(
        workspace_root,
        task_id,
        generated.mime_type.as_str(),
        &generated.audio_bytes,
    ) {
        Ok(audio_path) => audio_path,
        Err(error) => return mark_audio_task_failed(app, workspace_root, task_id, error),
    };
    let payload = &current.record.payload;
    let duration_ms = payload
        .get("duration_ms")
        .and_then(serde_json::Value::as_u64)
        .or_else(|| {
            payload
                .pointer("/audio_output/duration_ms")
                .and_then(serde_json::Value::as_u64)
        });
    let audio_output = build_audio_output_summary(
        payload,
        audio_path.as_str(),
        generated.mime_type.as_str(),
        duration_ms,
        Some(generated.provider_id.as_str()),
        Some(generated.model.as_str()),
    );
    let result = build_audio_generation_result_value(&audio_output);
    let output = patch_audio_task(
        workspace_root,
        task_id,
        TaskArtifactPatch {
            status: Some("succeeded".to_string()),
            payload_patch: Some(json!({
                "audio_path": audio_path,
                "mime_type": generated.mime_type,
                "duration_ms": duration_ms,
                "provider_id": generated.provider_id,
                "model": generated.model,
                "audio_output": audio_output,
            })),
            result: Some(Some(result)),
            last_error: Some(None),
            progress: Some(build_task_progress(
                "succeeded",
                "音频任务已由 voice_generation provider 完成，audio_output 已回写。".to_string(),
                Some(100),
            )),
            current_attempt_worker_id: Some(Some(AUDIO_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    emit_audio_task_event(app, &output);
    Ok(output)
}

fn mark_transcription_task_failed(
    app: Option<&AppHandle>,
    workspace_root: &Path,
    task_id: &str,
    error: TaskErrorRecord,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_transcription_task(workspace_root, task_id)?;
    if current.normalized_status == "cancelled" {
        return Ok(current);
    }

    let transcript =
        build_transcript_status_summary(&current.record.payload, "failed", Some(&error));
    let output = patch_transcription_task(
        workspace_root,
        task_id,
        TaskArtifactPatch {
            status: Some("failed".to_string()),
            payload_patch: Some(json!({
                "transcript": transcript,
            })),
            last_error: Some(Some(error.clone())),
            progress: Some(build_task_progress("failed", error.message.clone(), None)),
            current_attempt_worker_id: Some(Some(TRANSCRIPTION_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    emit_transcription_task_event(app, &output);
    Ok(output)
}

fn build_transcript_completed_summary(
    payload: &serde_json::Value,
    transcript_path: &str,
    generated: &GeneratedTranscriptOutput,
) -> serde_json::Value {
    json!({
        "kind": "transcript",
        "status": "completed",
        "transcript_path": transcript_path,
        "path": transcript_path,
        "source_url": read_image_task_payload_string(payload, &["source_url", "sourceUrl"]),
        "source_path": read_image_task_payload_string(payload, &["source_path", "sourcePath"]),
        "language": generated.language.as_deref().or_else(|| read_image_task_payload_string(payload, &["language"])),
        "output_format": generated.output_format.as_str(),
        "text_preview": generated.text_preview.as_deref(),
        "timestamps": payload.get("timestamps").cloned().unwrap_or(serde_json::Value::Null),
        "speaker_labels": payload.get("speaker_labels").cloned().unwrap_or(serde_json::Value::Null),
        "provider_id": generated.provider_id.as_str(),
        "model": generated.model.as_str(),
        "modality_contract_key": AUDIO_TRANSCRIPTION_CONTRACT_KEY,
        "modality": "audio",
        "routing_slot": AUDIO_TRANSCRIPTION_ROUTING_SLOT,
    })
}

fn build_transcription_result_value(transcript: &serde_json::Value) -> serde_json::Value {
    json!({
        "kind": "transcription_result",
        "status": "completed",
        "transcript": transcript,
        "outputs": [transcript],
        "transcript_path": transcript.get("transcript_path").cloned().unwrap_or(serde_json::Value::Null),
        "output_format": transcript.get("output_format").cloned().unwrap_or(serde_json::Value::Null),
    })
}

fn mark_transcription_task_succeeded(
    app: Option<&AppHandle>,
    workspace_root: &Path,
    task_id: &str,
    generated: GeneratedTranscriptOutput,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_transcription_task(workspace_root, task_id)?;
    if current.normalized_status == "cancelled" {
        return Ok(current);
    }

    let transcript_path = match write_transcript_output_text(
        workspace_root,
        task_id,
        generated.output_format.as_str(),
        generated.content.as_str(),
    ) {
        Ok(transcript_path) => transcript_path,
        Err(error) => return mark_transcription_task_failed(app, workspace_root, task_id, error),
    };
    let transcript = build_transcript_completed_summary(
        &current.record.payload,
        transcript_path.as_str(),
        &generated,
    );
    let result = build_transcription_result_value(&transcript);
    let output = patch_transcription_task(
        workspace_root,
        task_id,
        TaskArtifactPatch {
            status: Some("succeeded".to_string()),
            payload_patch: Some(json!({
                "transcript_path": transcript_path,
                "output_format": generated.output_format,
                "provider_id": generated.provider_id,
                "model": generated.model,
                "transcript": transcript,
            })),
            result: Some(Some(result)),
            last_error: Some(None),
            progress: Some(build_task_progress(
                "succeeded",
                "转写任务已由 audio_transcription provider 完成，transcript 已回写。".to_string(),
                Some(100),
            )),
            current_attempt_worker_id: Some(Some(TRANSCRIPTION_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    emit_transcription_task_event(app, &output);
    Ok(output)
}

async fn execute_image_generation_task(
    app: Option<AppHandle>,
    workspace_root: PathBuf,
    task_id: String,
    runner_config: ImageGenerationRunnerConfig,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_image_task(&workspace_root, &task_id)?;
    let model_capability =
        resolve_image_generation_model_capability_assessment(app.as_ref(), &current).await;
    let current = match model_capability.as_ref() {
        Some(assessment) => {
            patch_image_task_model_capability_assessment(&workspace_root, &task_id, assessment)?
        }
        None => current,
    };
    if let Err(task_error) =
        validate_image_generation_task_execution_contract(&current, model_capability.as_ref())
    {
        return mark_image_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
    }

    let emit_app = app.clone();
    lime_media_runtime::execute_image_generation_task_with_hook(
        &workspace_root,
        &task_id,
        &lime_media_runtime::ImageGenerationRunnerConfig {
            endpoint: runner_config.endpoint,
            api_key: runner_config.api_key,
        },
        move |output| emit_image_task_event(emit_app.as_ref(), output),
    )
    .await
    .map_err(|error| format!("执行图片任务失败: {error}"))
}

async fn execute_audio_generation_task_with_runner_config(
    app: Option<AppHandle>,
    workspace_root: PathBuf,
    task_id: String,
    runner_config: AudioGenerationRunnerConfig,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_audio_task(&workspace_root, &task_id)?;
    if current.normalized_status == "cancelled" {
        return Ok(current);
    }
    if let Err(task_error) = validate_audio_generation_task_execution_contract(&current) {
        return mark_audio_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
    }

    let running_audio_output =
        build_audio_output_status_summary(&current.record.payload, "running", None);
    let running = patch_audio_task(
        &workspace_root,
        &task_id,
        TaskArtifactPatch {
            status: Some("running".to_string()),
            payload_patch: Some(json!({
                "audio_output": running_audio_output,
            })),
            progress: Some(build_task_progress(
                "running",
                "音频任务已进入 voice_generation 执行链，正在调用音频 provider。".to_string(),
                Some(5),
            )),
            current_attempt_worker_id: Some(Some(AUDIO_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    emit_audio_task_event(app.as_ref(), &running);

    let generated = match request_openai_compatible_audio_generation(&runner_config, &running).await
    {
        Ok(generated) => generated,
        Err(task_error) => {
            return mark_audio_task_failed(app.as_ref(), &workspace_root, &task_id, task_error)
        }
    };
    mark_audio_task_succeeded(app.as_ref(), &workspace_root, &task_id, generated)
}

async fn execute_audio_generation_task(
    app: Option<AppHandle>,
    workspace_root: PathBuf,
    task_id: String,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_audio_task(&workspace_root, &task_id)?;
    if current.normalized_status == "cancelled" {
        return Ok(current);
    }
    if let Err(task_error) = validate_audio_generation_task_execution_contract(&current) {
        return mark_audio_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
    }

    let runner_config = match resolve_audio_generation_runner_config(app.as_ref(), &current).await {
        Ok(runner_config) => runner_config,
        Err(task_error) => {
            return mark_audio_task_failed(app.as_ref(), &workspace_root, &task_id, task_error)
        }
    };

    execute_audio_generation_task_with_runner_config(app, workspace_root, task_id, runner_config)
        .await
}

async fn execute_transcription_task_with_runner_config(
    app: Option<AppHandle>,
    workspace_root: PathBuf,
    task_id: String,
    runner_config: TranscriptionRunnerConfig,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_transcription_task(&workspace_root, &task_id)?;
    if current.normalized_status == "cancelled" {
        return Ok(current);
    }
    if let Err(task_error) = validate_transcription_task_execution_contract(&current) {
        return mark_transcription_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
    }

    let running_transcript =
        build_transcript_status_summary(&current.record.payload, "running", None);
    let running = patch_transcription_task(
        &workspace_root,
        &task_id,
        TaskArtifactPatch {
            status: Some("running".to_string()),
            payload_patch: Some(json!({
                "transcript": running_transcript,
            })),
            progress: Some(build_task_progress(
                "running",
                "转写任务已进入 audio_transcription 执行链，正在调用转写 provider。".to_string(),
                Some(5),
            )),
            current_attempt_worker_id: Some(Some(TRANSCRIPTION_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    emit_transcription_task_event(app.as_ref(), &running);

    let generated =
        match request_openai_compatible_transcription(&runner_config, &running, &workspace_root)
            .await
        {
            Ok(generated) => generated,
            Err(task_error) => {
                return mark_transcription_task_failed(
                    app.as_ref(),
                    &workspace_root,
                    &task_id,
                    task_error,
                )
            }
        };
    mark_transcription_task_succeeded(app.as_ref(), &workspace_root, &task_id, generated)
}

async fn execute_transcription_task(
    app: Option<AppHandle>,
    workspace_root: PathBuf,
    task_id: String,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_transcription_task(&workspace_root, &task_id)?;
    if current.normalized_status == "cancelled" {
        return Ok(current);
    }
    if let Err(task_error) = validate_transcription_task_execution_contract(&current) {
        return mark_transcription_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
    }

    let runner_config = match resolve_transcription_runner_config(app.as_ref(), &current).await {
        Ok(runner_config) => runner_config,
        Err(task_error) => {
            return mark_transcription_task_failed(
                app.as_ref(),
                &workspace_root,
                &task_id,
                task_error,
            )
        }
    };

    execute_transcription_task_with_runner_config(app, workspace_root, task_id, runner_config).await
}

pub(crate) fn start_image_generation_task_worker_if_needed(
    app_handle: &AppHandle,
    workspace_root: &str,
    output: &MediaTaskOutput,
) {
    if !should_start_image_generation_worker(output) {
        return;
    }

    let normalized_workspace_root = workspace_root.trim();
    if normalized_workspace_root.is_empty() {
        return;
    }

    let task_id = output.task_id.trim().to_string();
    if task_id.is_empty() || !mark_image_task_execution_started(&task_id) {
        return;
    }

    let runner_config = app_handle
        .try_state::<GlobalConfigManagerState>()
        .ok_or_else(|| "GlobalConfigManagerState 未初始化".to_string())
        .and_then(|state| resolve_image_generation_runner_config(&state));

    let app = app_handle.clone();
    let workspace_root = PathBuf::from(normalized_workspace_root);
    match runner_config {
        Ok(runner_config) => {
            tauri::async_runtime::spawn(async move {
                let _ = execute_image_generation_task(
                    Some(app.clone()),
                    workspace_root,
                    task_id.clone(),
                    runner_config,
                )
                .await;
                finish_image_task_execution(&task_id);
            });
        }
        Err(error_message) => {
            let task_error = build_task_error(
                "image_worker_unavailable",
                error_message,
                false,
                "bootstrap",
            );
            let _ = mark_image_task_failed(Some(&app), &workspace_root, &task_id, task_error);
            finish_image_task_execution(&task_id);
        }
    }
}

pub(crate) fn start_audio_generation_task_worker_if_needed(
    app_handle: &AppHandle,
    workspace_root: &str,
    output: &MediaTaskOutput,
) {
    if !should_start_audio_generation_worker(output) {
        return;
    }

    let normalized_workspace_root = workspace_root.trim();
    if normalized_workspace_root.is_empty() {
        return;
    }

    let task_id = output.task_id.trim().to_string();
    if task_id.is_empty() || !mark_audio_task_execution_started(&task_id) {
        return;
    }

    let app = app_handle.clone();
    let workspace_root = PathBuf::from(normalized_workspace_root);
    tauri::async_runtime::spawn(async move {
        let _ = execute_audio_generation_task(Some(app), workspace_root, task_id.clone()).await;
        finish_audio_task_execution(&task_id);
    });
}

pub(crate) fn start_transcription_task_worker_if_needed(
    app_handle: &AppHandle,
    workspace_root: &str,
    output: &MediaTaskOutput,
) {
    if !should_start_transcription_worker(output) {
        return;
    }

    let normalized_workspace_root = workspace_root.trim();
    if normalized_workspace_root.is_empty() {
        return;
    }

    let task_id = output.task_id.trim().to_string();
    if task_id.is_empty() || !mark_transcription_task_execution_started(&task_id) {
        return;
    }

    let app = app_handle.clone();
    let workspace_root = PathBuf::from(normalized_workspace_root);
    tauri::async_runtime::spawn(async move {
        let _ = execute_transcription_task(Some(app), workspace_root, task_id.clone()).await;
        finish_transcription_task_execution(&task_id);
    });
}

fn emit_creation_task_event_if_needed(app: Option<&AppHandle>, output: &MediaTaskOutput) {
    if let Some(app_handle) = app {
        media_cli_bridge::emit_media_creation_task_event(app_handle, output);
    }
}

pub(crate) fn finalize_image_generation_task_creation(
    app: Option<&AppHandle>,
    workspace_root: &str,
    output: &MediaTaskOutput,
) {
    emit_creation_task_event_if_needed(app, output);
    if let Some(app_handle) = app {
        start_image_generation_task_worker_if_needed(app_handle, workspace_root, output);
    }
}

pub(crate) fn finalize_audio_generation_task_creation(
    app: Option<&AppHandle>,
    workspace_root: &str,
    output: &MediaTaskOutput,
) {
    emit_creation_task_event_if_needed(app, output);
    if let Some(app_handle) = app {
        start_audio_generation_task_worker_if_needed(app_handle, workspace_root, output);
    }
}

pub(crate) fn finalize_transcription_task_creation(
    app: Option<&AppHandle>,
    workspace_root: &str,
    output: &MediaTaskOutput,
) {
    emit_creation_task_event_if_needed(app, output);
    if let Some(app_handle) = app {
        start_transcription_task_worker_if_needed(app_handle, workspace_root, output);
    }
}

pub(crate) fn create_image_generation_task_artifact_inner(
    request: CreateImageGenerationTaskArtifactRequest,
) -> Result<MediaTaskOutput, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let prompt = normalize_required_string(&request.prompt, "prompt")?;

    let mode = normalize_mode(request.mode.clone())?;
    let normalized_storyboard_slots = normalize_storyboard_slots(request.storyboard_slots.clone());
    let count = normalize_positive_count(Some(
        request
            .count
            .unwrap_or(normalized_storyboard_slots.len() as u32)
            .max(normalized_storyboard_slots.len() as u32),
    ))?;
    let size = normalize_optional_string(request.size.clone());
    let aspect_ratio = normalize_optional_string(request.aspect_ratio.clone());
    let usage = normalize_optional_string(request.usage.clone());
    let style = normalize_optional_string(request.style.clone());
    let requested_provider_id = normalize_optional_string(request.provider_id.clone());
    let requested_model = normalize_optional_string(request.model.clone());
    let image_preference_defaults = load_image_generation_preference_defaults();
    let (provider_id, model) = apply_image_generation_preference_defaults(
        requested_provider_id,
        requested_model,
        &image_preference_defaults,
    );
    let raw_text = normalize_optional_string(request.raw_text.clone());
    let layout_hint = normalize_optional_string(request.layout_hint.clone());
    let session_id = normalize_optional_string(request.session_id.clone());
    let project_id = normalize_optional_string(request.project_id.clone());
    let content_id = normalize_optional_string(request.content_id.clone());
    let entry_source = normalize_optional_string(request.entry_source.clone());
    let runtime_contract_key = request
        .runtime_contract
        .as_ref()
        .and_then(|value| value.get("contract_key"))
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string);
    if let Some(runtime_contract_key) = runtime_contract_key {
        normalize_image_generation_contract_key(Some(runtime_contract_key))?;
    }
    let modality_contract_key =
        normalize_image_generation_contract_key(request.modality_contract_key.clone())?;
    let modality = normalize_image_generation_modality(request.modality.clone())?;
    let required_capabilities =
        normalize_image_generation_required_capabilities(request.required_capabilities.clone())?;
    let routing_slot = normalize_image_generation_routing_slot(request.routing_slot.clone())?;
    let requested_target = normalize_optional_string(request.requested_target.clone());
    let slot_id = normalize_optional_string(request.slot_id.clone());
    let anchor_hint = normalize_optional_string(request.anchor_hint.clone());
    let anchor_section_title = normalize_optional_string(request.anchor_section_title.clone());
    let anchor_text = normalize_optional_string(request.anchor_text.clone());
    let title_generation_result =
        normalize_optional_json_object(request.title_generation_result.clone());
    let target_output_id = normalize_optional_string(request.target_output_id.clone());
    let target_output_ref_id = normalize_optional_string(request.target_output_ref_id.clone());
    let normalized_reference_images = normalize_reference_images(request.reference_images.clone());
    let storyboard_slots_payload = build_storyboard_slots_payload(&normalized_storyboard_slots);

    let idempotency_key = build_image_task_idempotency_key(
        &request,
        &mode,
        &prompt,
        count,
        size.as_deref(),
        usage.as_deref(),
        &normalized_reference_images,
        &normalized_storyboard_slots,
        target_output_ref_id.as_deref(),
    )?;

    write_task_artifact(
        std::path::Path::new(project_root_path.as_str()),
        MediaTaskType::ImageGenerate,
        normalize_optional_string(request.title),
        json!({
            "prompt": prompt.as_str(),
            "mode": mode,
            "raw_text": raw_text,
            "layout_hint": layout_hint,
            "provider_id": provider_id,
            "model": model,
            "style": style,
            "size": size,
            "aspect_ratio": aspect_ratio,
            "count": count,
            "usage": usage,
            "session_id": session_id,
            "project_id": project_id,
            "content_id": content_id,
            "entry_source": entry_source,
            "modality_contract_key": modality_contract_key,
            "modality": modality,
            "required_capabilities": required_capabilities,
            "routing_slot": routing_slot,
            "runtime_contract": image_generation_runtime_contract(),
            "requested_target": requested_target,
            "slot_id": slot_id.clone(),
            "anchor_hint": anchor_hint,
            "anchor_section_title": anchor_section_title,
            "anchor_text": anchor_text,
            "title_generation_result": title_generation_result,
            "target_output_id": target_output_id,
            "target_output_ref_id": target_output_ref_id,
            "reference_images": normalized_reference_images,
            "storyboard_slots": storyboard_slots_payload,
        }),
        TaskWriteOptions {
            status: Some("pending_submit".to_string()),
            output_path: None,
            artifact_dir: None,
            idempotency_key: Some(idempotency_key.as_str()),
            relationships: TaskRelationships {
                slot_id,
                ..TaskRelationships::default()
            },
        },
    )
    .map_err(|error| format!("创建图片任务 artifact 失败: {error}"))
}

pub(crate) fn create_audio_generation_task_artifact_inner(
    request: CreateAudioGenerationTaskArtifactRequest,
) -> Result<MediaTaskOutput, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let source_text = normalize_required_string(&request.source_text, "sourceText")?;
    let raw_text = normalize_optional_string(request.raw_text.clone());
    let voice = normalize_optional_string(request.voice.clone());
    let voice_style = normalize_optional_string(request.voice_style.clone());
    let target_language = normalize_optional_string(request.target_language.clone());
    let mime_type = normalize_optional_string(request.mime_type.clone())
        .unwrap_or_else(|| AUDIO_TASK_DEFAULT_MIME_TYPE.to_string());
    let audio_path = normalize_optional_string(request.audio_path.clone());
    let requested_provider_id = normalize_optional_string(request.provider_id.clone());
    let requested_model = normalize_optional_string(request.model.clone());
    let audio_preference_defaults = load_audio_generation_preference_defaults();
    let (provider_id, model) = apply_audio_generation_preference_defaults(
        requested_provider_id,
        requested_model,
        &audio_preference_defaults,
    );
    let session_id = normalize_optional_string(request.session_id.clone());
    let project_id = normalize_optional_string(request.project_id.clone());
    let content_id = normalize_optional_string(request.content_id.clone());
    let entry_source = normalize_optional_string(request.entry_source.clone())
        .or_else(|| Some("at_voice_command".to_string()));
    let runtime_contract_key = request
        .runtime_contract
        .as_ref()
        .and_then(|value| value.get("contract_key"))
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string);
    if let Some(runtime_contract_key) = runtime_contract_key {
        normalize_voice_generation_contract_key(Some(runtime_contract_key))?;
    }
    let modality_contract_key =
        normalize_voice_generation_contract_key(request.modality_contract_key.clone())?;
    let modality = normalize_voice_generation_modality(request.modality.clone())?;
    let required_capabilities =
        normalize_voice_generation_required_capabilities(request.required_capabilities.clone())?;
    let routing_slot = normalize_voice_generation_routing_slot(request.routing_slot.clone())?;
    let requested_target = normalize_optional_string(request.requested_target.clone())
        .or_else(|| Some("voice".to_string()));
    let output_path = normalize_optional_string(request.output_path.clone());
    let idempotency_key = build_audio_task_idempotency_key(
        &request,
        &source_text,
        voice.as_deref(),
        voice_style.as_deref(),
        target_language.as_deref(),
        provider_id.as_deref(),
        model.as_deref(),
    )?;

    write_task_artifact(
        std::path::Path::new(project_root_path.as_str()),
        MediaTaskType::AudioGenerate,
        normalize_optional_string(request.title),
        json!({
            "prompt": source_text.as_str(),
            "source_text": source_text.as_str(),
            "raw_text": raw_text,
            "voice": voice.clone(),
            "voice_style": voice_style,
            "target_language": target_language,
            "mime_type": mime_type.clone(),
            "audio_path": audio_path.clone(),
            "duration_ms": request.duration_ms,
            "provider_id": provider_id,
            "model": model,
            "session_id": session_id,
            "project_id": project_id,
            "content_id": content_id,
            "entry_source": entry_source,
            "modality_contract_key": modality_contract_key,
            "modality": modality,
            "required_capabilities": required_capabilities,
            "routing_slot": routing_slot,
            "runtime_contract": voice_generation_runtime_contract(),
            "requested_target": requested_target,
            "audio_output": {
                "kind": "audio_output",
                "status": "pending",
                "audio_path": audio_path,
                "mime_type": mime_type,
                "duration_ms": request.duration_ms,
                "source_text": source_text.clone(),
                "voice": voice,
            }
        }),
        TaskWriteOptions {
            status: Some("pending_submit".to_string()),
            output_path: output_path.as_deref(),
            artifact_dir: None,
            idempotency_key: Some(idempotency_key.as_str()),
            relationships: TaskRelationships::default(),
        },
    )
    .map_err(|error| format!("创建音频任务 artifact 失败: {error}"))
}

fn build_audio_output_summary(
    payload: &serde_json::Value,
    audio_path: &str,
    mime_type: &str,
    duration_ms: Option<u64>,
    provider_id: Option<&str>,
    model: Option<&str>,
) -> serde_json::Value {
    json!({
        "kind": "audio_output",
        "status": "completed",
        "audio_path": audio_path,
        "mime_type": mime_type,
        "duration_ms": duration_ms,
        "source_text": read_image_task_payload_string(payload, &["source_text", "sourceText", "prompt"]),
        "voice": read_image_task_payload_string(payload, &["voice"]),
        "voice_style": read_image_task_payload_string(payload, &["voice_style", "voiceStyle"]),
        "target_language": read_image_task_payload_string(payload, &["target_language", "targetLanguage"]),
        "provider_id": provider_id,
        "model": model,
        "modality_contract_key": VOICE_GENERATION_CONTRACT_KEY,
        "modality": "audio",
        "routing_slot": VOICE_GENERATION_ROUTING_SLOT,
    })
}

fn build_audio_generation_result_value(audio_output: &serde_json::Value) -> serde_json::Value {
    json!({
        "kind": "audio_generation_result",
        "status": "completed",
        "audio_output": audio_output,
        "outputs": [audio_output],
        "audio_path": audio_output.get("audio_path").cloned().unwrap_or(serde_json::Value::Null),
        "mime_type": audio_output.get("mime_type").cloned().unwrap_or(serde_json::Value::Null),
        "duration_ms": audio_output.get("duration_ms").cloned().unwrap_or(serde_json::Value::Null),
    })
}

fn build_transcription_task_transcript_summary(
    source_url: Option<&str>,
    source_path: Option<&str>,
    language: Option<&str>,
    output_format: Option<&str>,
    timestamps: Option<bool>,
    speaker_labels: Option<bool>,
    provider_id: Option<&str>,
    model: Option<&str>,
) -> serde_json::Value {
    json!({
        "kind": "transcript",
        "status": "pending",
        "source_url": source_url,
        "source_path": source_path,
        "language": language,
        "output_format": output_format,
        "timestamps": timestamps,
        "speaker_labels": speaker_labels,
        "provider_id": provider_id,
        "model": model,
        "modality_contract_key": AUDIO_TRANSCRIPTION_CONTRACT_KEY,
        "modality": "audio",
        "routing_slot": AUDIO_TRANSCRIPTION_ROUTING_SLOT,
    })
}

pub(crate) fn create_transcription_task_artifact_inner(
    request: CreateTranscriptionTaskArtifactRequest,
) -> Result<MediaTaskOutput, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let source_url = normalize_optional_string(request.source_url.clone());
    let source_path = normalize_optional_string(request.source_path.clone());
    if source_url.is_none() && source_path.is_none() {
        return Err("sourceUrl 或 sourcePath 至少需要提供一个".to_string());
    }
    let prompt = normalize_optional_string(request.prompt.clone());
    let raw_text = normalize_optional_string(request.raw_text.clone());
    let language = normalize_optional_string(request.language.clone());
    let output_format = normalize_optional_string(request.output_format.clone());
    let provider_id = normalize_optional_string(request.provider_id.clone());
    let model = normalize_optional_string(request.model.clone());
    let session_id = normalize_optional_string(request.session_id.clone());
    let project_id = normalize_optional_string(request.project_id.clone());
    let content_id = normalize_optional_string(request.content_id.clone());
    let entry_source = normalize_optional_string(request.entry_source.clone())
        .or_else(|| Some("at_transcription_command".to_string()));
    let runtime_contract_key = request
        .runtime_contract
        .as_ref()
        .and_then(|value| value.get("contract_key"))
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string);
    if let Some(runtime_contract_key) = runtime_contract_key {
        normalize_audio_transcription_contract_key(Some(runtime_contract_key))?;
    }
    let modality_contract_key =
        normalize_audio_transcription_contract_key(request.modality_contract_key.clone())?;
    let modality = normalize_audio_transcription_modality(request.modality.clone())?;
    let required_capabilities =
        normalize_audio_transcription_required_capabilities(request.required_capabilities.clone())?;
    let routing_slot = normalize_audio_transcription_routing_slot(request.routing_slot.clone())?;
    let requested_target = normalize_optional_string(request.requested_target.clone())
        .or_else(|| Some("transcript".to_string()));
    let output_path = normalize_optional_string(request.output_path.clone());
    let transcript = build_transcription_task_transcript_summary(
        source_url.as_deref(),
        source_path.as_deref(),
        language.as_deref(),
        output_format.as_deref(),
        request.timestamps,
        request.speaker_labels,
        provider_id.as_deref(),
        model.as_deref(),
    );
    let idempotency_key = build_transcription_task_idempotency_key(
        &request,
        source_url.as_deref(),
        source_path.as_deref(),
        language.as_deref(),
        output_format.as_deref(),
        provider_id.as_deref(),
        model.as_deref(),
    )?;

    write_task_artifact(
        std::path::Path::new(project_root_path.as_str()),
        MediaTaskType::TranscriptionGenerate,
        normalize_optional_string(request.title),
        json!({
            "prompt": prompt,
            "raw_text": raw_text,
            "source_url": source_url,
            "source_path": source_path,
            "language": language,
            "output_format": output_format,
            "speaker_labels": request.speaker_labels,
            "timestamps": request.timestamps,
            "provider_id": provider_id,
            "model": model,
            "session_id": session_id,
            "project_id": project_id,
            "content_id": content_id,
            "entry_source": entry_source,
            "modality_contract_key": modality_contract_key,
            "modality": modality,
            "required_capabilities": required_capabilities,
            "routing_slot": routing_slot,
            "runtime_contract": audio_transcription_runtime_contract(),
            "requested_target": requested_target,
            "transcript": transcript,
        }),
        TaskWriteOptions {
            status: Some("pending_submit".to_string()),
            output_path: output_path.as_deref(),
            artifact_dir: None,
            idempotency_key: Some(idempotency_key.as_str()),
            relationships: TaskRelationships::default(),
        },
    )
    .map_err(|error| format!("创建转写任务 artifact 失败: {error}"))
}

pub(crate) fn complete_audio_generation_task_artifact_inner(
    request: CompleteAudioGenerationTaskArtifactRequest,
) -> Result<MediaTaskOutput, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let task_ref = normalize_required_string(&request.task_ref, "taskRef")?;
    let audio_path = normalize_required_string(&request.audio_path, "audioPath")?;
    let workspace_root = std::path::Path::new(project_root_path.as_str());
    let current = load_task_output(workspace_root, task_ref.as_str(), None)
        .map_err(|error| format!("读取音频任务 artifact 失败: {error}"))?;

    if current.task_type != MediaTaskType::AudioGenerate.as_str() {
        return Err(format!(
            "只能完成 audio_generate 任务，当前任务类型为 {}",
            current.task_type
        ));
    }

    if media_task_contract_key(&current).as_deref() != Some(VOICE_GENERATION_CONTRACT_KEY) {
        return Err("只能完成 voice_generation 合同下的 audio_generate 任务".to_string());
    }
    if matches!(current.normalized_status.as_str(), "cancelled" | "failed") {
        return Err(format!(
            "当前音频任务状态为 {}，不能直接写回完成态",
            current.normalized_status
        ));
    }

    let payload = &current.record.payload;
    let mime_type = normalize_optional_string(request.mime_type)
        .or_else(|| {
            read_image_task_payload_string(payload, &["mime_type", "mimeType"])
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| AUDIO_TASK_DEFAULT_MIME_TYPE.to_string());
    let provider_id = normalize_optional_string(request.provider_id).or_else(|| {
        read_image_task_payload_string(payload, &["provider_id", "providerId"])
            .map(ToString::to_string)
    });
    let model = normalize_optional_string(request.model)
        .or_else(|| read_image_task_payload_string(payload, &["model"]).map(ToString::to_string));
    let duration_ms = request.duration_ms.or_else(|| {
        payload
            .get("duration_ms")
            .and_then(serde_json::Value::as_u64)
            .or_else(|| {
                payload
                    .pointer("/audio_output/duration_ms")
                    .and_then(serde_json::Value::as_u64)
            })
    });
    let audio_output = build_audio_output_summary(
        payload,
        audio_path.as_str(),
        mime_type.as_str(),
        duration_ms,
        provider_id.as_deref(),
        model.as_deref(),
    );
    let result = build_audio_generation_result_value(&audio_output);

    patch_task_artifact(
        workspace_root,
        task_ref.as_str(),
        None,
        TaskArtifactPatch {
            status: Some("succeeded".to_string()),
            payload_patch: Some(json!({
                "audio_path": audio_path,
                "mime_type": mime_type,
                "duration_ms": duration_ms,
                "provider_id": provider_id,
                "model": model,
                "audio_output": audio_output,
            })),
            result: Some(Some(result)),
            last_error: Some(None),
            progress: Some(build_task_progress(
                "succeeded",
                "音频任务已完成，audio_output 已回写。".to_string(),
                Some(100),
            )),
            current_attempt_worker_id: Some(Some(AUDIO_TASK_COMPLETION_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )
    .map_err(|error| format!("完成音频任务 artifact 失败: {error}"))
}

pub(crate) fn get_media_task_artifact_inner(
    request: MediaTaskLookupRequest,
) -> Result<MediaTaskOutput, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let task_ref = normalize_required_string(&request.task_ref, "taskRef")?;
    load_task_output(
        std::path::Path::new(project_root_path.as_str()),
        task_ref.as_str(),
        None,
    )
    .map_err(|error| format!("读取媒体任务 artifact 失败: {error}"))
}

pub(crate) fn list_media_task_artifacts_inner(
    request: ListMediaTaskArtifactsRequest,
) -> Result<ListMediaTaskArtifactsResponse, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let status_filter = normalize_optional_string(request.status);
    let task_family_filter = normalize_optional_string(request.task_family);
    let task_type_filter = normalize_optional_string(request.task_type);
    let modality_contract_key_filter = normalize_optional_string(request.modality_contract_key);
    let routing_outcome_filter = normalize_optional_string(request.routing_outcome);
    let parsed_task_type = task_type_filter
        .as_deref()
        .map(|value| {
            value
                .parse::<MediaTaskType>()
                .map_err(|_| format!("不支持的 taskType: {value}"))
        })
        .transpose()?;
    let mut tasks = list_task_outputs(
        std::path::Path::new(project_root_path.as_str()),
        None,
        status_filter.as_deref(),
        task_family_filter.as_deref(),
        parsed_task_type,
        None,
    )
    .map_err(|error| format!("列出媒体任务 artifact 失败: {error}"))?;
    tasks.retain(|output| {
        image_task_matches_modality_contract_filters(
            output,
            modality_contract_key_filter.as_deref(),
            routing_outcome_filter.as_deref(),
        )
    });
    if let Some(limit) = request.limit {
        tasks.truncate(limit);
    }
    let modality_runtime_contracts = build_modality_runtime_contract_index(&tasks);

    Ok(ListMediaTaskArtifactsResponse {
        success: true,
        workspace_root: project_root_path.clone(),
        artifact_root: std::path::Path::new(project_root_path.as_str())
            .join(DEFAULT_ARTIFACT_ROOT)
            .to_string_lossy()
            .to_string(),
        filters: MediaTaskListFilters {
            status: status_filter,
            task_family: task_family_filter,
            task_type: parsed_task_type.map(|value| value.as_str().to_string()),
            modality_contract_key: modality_contract_key_filter,
            routing_outcome: routing_outcome_filter,
            limit: request.limit,
        },
        total: tasks.len(),
        modality_runtime_contracts,
        tasks,
    })
}

pub(crate) fn cancel_media_task_artifact_inner(
    request: MediaTaskLookupRequest,
) -> Result<MediaTaskOutput, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let task_ref = normalize_required_string(&request.task_ref, "taskRef")?;
    update_task_status(
        std::path::Path::new(project_root_path.as_str()),
        task_ref.as_str(),
        None,
        "cancelled",
    )
    .map_err(|error| format!("取消媒体任务 artifact 失败: {error}"))
}

#[tauri::command]
pub fn create_image_generation_task_artifact(
    app: AppHandle,
    request: CreateImageGenerationTaskArtifactRequest,
) -> Result<MediaTaskOutput, String> {
    let project_root_path = request.project_root_path.trim().to_string();
    let output = create_image_generation_task_artifact_inner(request)?;
    finalize_image_generation_task_creation(Some(&app), &project_root_path, &output);
    Ok(output)
}

#[tauri::command]
pub fn create_audio_generation_task_artifact(
    app: AppHandle,
    request: CreateAudioGenerationTaskArtifactRequest,
) -> Result<MediaTaskOutput, String> {
    let project_root_path = request.project_root_path.trim().to_string();
    let output = create_audio_generation_task_artifact_inner(request)?;
    finalize_audio_generation_task_creation(Some(&app), &project_root_path, &output);
    Ok(output)
}

#[tauri::command]
pub fn complete_audio_generation_task_artifact(
    app: AppHandle,
    request: CompleteAudioGenerationTaskArtifactRequest,
) -> Result<MediaTaskOutput, String> {
    let output = complete_audio_generation_task_artifact_inner(request)?;
    emit_creation_task_event_if_needed(Some(&app), &output);
    Ok(output)
}

#[tauri::command]
pub fn get_media_task_artifact(request: MediaTaskLookupRequest) -> Result<MediaTaskOutput, String> {
    get_media_task_artifact_inner(request)
}

#[tauri::command]
pub fn list_media_task_artifacts(
    request: ListMediaTaskArtifactsRequest,
) -> Result<ListMediaTaskArtifactsResponse, String> {
    list_media_task_artifacts_inner(request)
}

#[tauri::command]
pub fn cancel_media_task_artifact(
    app: AppHandle,
    request: MediaTaskLookupRequest,
) -> Result<MediaTaskOutput, String> {
    let output = cancel_media_task_artifact_inner(request)?;
    emit_creation_task_event_if_needed(Some(&app), &output);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        http::{HeaderMap, StatusCode},
        routing::post,
        Json, Router,
    };
    use serde_json::Value;
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;

    fn minimal_image_generation_request(
        project_root_path: String,
        model: Option<&str>,
    ) -> CreateImageGenerationTaskArtifactRequest {
        CreateImageGenerationTaskArtifactRequest {
            project_root_path,
            prompt: "未来感青柠实验室".to_string(),
            title: Some("青柠主视觉".to_string()),
            title_generation_result: None,
            mode: Some("generate".to_string()),
            raw_text: Some("@配图 生成 未来感青柠实验室".to_string()),
            layout_hint: None,
            size: Some("1024x1024".to_string()),
            aspect_ratio: None,
            count: Some(1),
            usage: Some("claw-image-workbench".to_string()),
            style: None,
            provider_id: Some("fal".to_string()),
            model: model.map(ToString::to_string),
            session_id: Some("session-image-contract-1".to_string()),
            project_id: Some("project-image-contract-1".to_string()),
            content_id: Some("content-image-contract-1".to_string()),
            entry_source: Some("at_image_command".to_string()),
            modality_contract_key: None,
            modality: None,
            required_capabilities: Vec::new(),
            routing_slot: None,
            runtime_contract: None,
            requested_target: Some("generate".to_string()),
            slot_id: None,
            anchor_hint: None,
            anchor_section_title: None,
            anchor_text: None,
            target_output_id: None,
            target_output_ref_id: None,
            reference_images: Vec::new(),
            storyboard_slots: Vec::new(),
        }
    }

    #[test]
    fn create_image_generation_task_artifact_inner_should_write_context_payload_and_idempotency() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let request = CreateImageGenerationTaskArtifactRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            prompt: "未来感青柠实验室".to_string(),
            title: Some("青柠主视觉".to_string()),
            title_generation_result: Some(json!({
                "title": "青柠主视觉",
                "sessionId": "title-session-1",
                "executionRuntime": {
                    "route": "auxiliary.generate_title"
                },
                "usedFallback": false,
                "fallbackReason": null
            })),
            mode: Some("variation".to_string()),
            raw_text: Some("@配图 变体 #img-1 未来感青柠实验室".to_string()),
            layout_hint: Some("storyboard_3x3".to_string()),
            size: Some("1024x1024".to_string()),
            aspect_ratio: Some("1:1".to_string()),
            count: Some(2),
            usage: Some("claw-image-workbench".to_string()),
            style: Some("cinematic".to_string()),
            provider_id: Some("fal".to_string()),
            model: Some("fal-ai/nano-banana".to_string()),
            session_id: Some("session-1".to_string()),
            project_id: Some("project-1".to_string()),
            content_id: Some("content-1".to_string()),
            entry_source: Some("at_image_command".to_string()),
            modality_contract_key: None,
            modality: None,
            required_capabilities: Vec::new(),
            routing_slot: None,
            runtime_contract: None,
            requested_target: Some("generate".to_string()),
            slot_id: Some("document-slot-1".to_string()),
            anchor_hint: Some("section_end".to_string()),
            anchor_section_title: Some("技术亮点".to_string()),
            anchor_text: Some("这里是技术亮点段落，需要插入配图。".to_string()),
            target_output_id: Some("task-a:output:1".to_string()),
            target_output_ref_id: Some("img-1".to_string()),
            reference_images: vec![
                "https://example.com/reference-a.png".to_string(),
                "https://example.com/reference-a.png".to_string(),
                "".to_string(),
            ],
            storyboard_slots: vec![
                ImageStoryboardSlotInput {
                    prompt: "未来感实验室的广角建立镜头".to_string(),
                    slot_id: Some("storyboard-slot-1".to_string()),
                    label: Some("建立镜头".to_string()),
                    shot_type: Some("establishing".to_string()),
                },
                ImageStoryboardSlotInput {
                    prompt: "聚焦核心设备与人物互动的中景".to_string(),
                    slot_id: Some("storyboard-slot-2".to_string()),
                    label: Some("主体互动".to_string()),
                    shot_type: Some("medium".to_string()),
                },
            ],
        };

        let first = create_image_generation_task_artifact_inner(request).expect("create first");
        let second =
            create_image_generation_task_artifact_inner(CreateImageGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: "未来感青柠实验室".to_string(),
                title: Some("青柠主视觉".to_string()),
                title_generation_result: Some(json!({
                    "title": "青柠主视觉",
                    "sessionId": "title-session-2",
                    "executionRuntime": {
                        "route": "auxiliary.generate_title"
                    },
                    "usedFallback": false,
                    "fallbackReason": null
                })),
                mode: Some("variation".to_string()),
                raw_text: Some("@配图 变体 #img-1 未来感青柠实验室".to_string()),
                layout_hint: Some("storyboard_3x3".to_string()),
                size: Some("1024x1024".to_string()),
                aspect_ratio: Some("1:1".to_string()),
                count: Some(2),
                usage: Some("claw-image-workbench".to_string()),
                style: Some("cinematic".to_string()),
                provider_id: Some("fal".to_string()),
                model: Some("fal-ai/nano-banana".to_string()),
                session_id: Some("session-1".to_string()),
                project_id: Some("project-1".to_string()),
                content_id: Some("content-1".to_string()),
                entry_source: Some("at_image_command".to_string()),
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: Some("generate".to_string()),
                slot_id: Some("document-slot-1".to_string()),
                anchor_hint: Some("section_end".to_string()),
                anchor_section_title: Some("技术亮点".to_string()),
                anchor_text: Some("这里是技术亮点段落，需要插入配图。".to_string()),
                target_output_id: Some("task-a:output:1".to_string()),
                target_output_ref_id: Some("img-1".to_string()),
                reference_images: vec![
                    "https://example.com/reference-a.png".to_string(),
                    "https://example.com/reference-a.png".to_string(),
                ],
                storyboard_slots: vec![
                    ImageStoryboardSlotInput {
                        prompt: "未来感实验室的广角建立镜头".to_string(),
                        slot_id: Some("storyboard-slot-1".to_string()),
                        label: Some("建立镜头".to_string()),
                        shot_type: Some("establishing".to_string()),
                    },
                    ImageStoryboardSlotInput {
                        prompt: "聚焦核心设备与人物互动的中景".to_string(),
                        slot_id: Some("storyboard-slot-2".to_string()),
                        label: Some("主体互动".to_string()),
                        shot_type: Some("medium".to_string()),
                    },
                ],
            })
            .expect("create second");

        assert_eq!(first.task_id, second.task_id);
        assert!(second.reused_existing);
        assert_eq!(first.record.payload.get("mode"), Some(&json!("variation")));
        assert_eq!(
            first.record.payload.get("session_id"),
            Some(&json!("session-1"))
        );
        assert_eq!(
            first.record.payload.get("entry_source"),
            Some(&json!("at_image_command"))
        );
        assert_eq!(
            first.record.payload.get("modality_contract_key"),
            Some(&json!("image_generation"))
        );
        assert_eq!(first.record.payload.get("modality"), Some(&json!("image")));
        assert_eq!(
            first.record.payload.get("required_capabilities"),
            Some(&json!([
                "text_generation",
                "image_generation",
                "vision_input"
            ]))
        );
        assert_eq!(
            first.record.payload.get("routing_slot"),
            Some(&json!("image_generation_model"))
        );
        assert_eq!(
            first
                .record
                .payload
                .get("runtime_contract")
                .and_then(serde_json::Value::as_object)
                .and_then(|contract| contract.get("contract_key"))
                .and_then(serde_json::Value::as_str),
            Some("image_generation")
        );
        assert_eq!(
            first.record.payload.get("title_generation_result"),
            Some(&json!({
                "title": "青柠主视觉",
                "sessionId": "title-session-1",
                "executionRuntime": {
                    "route": "auxiliary.generate_title"
                },
                "usedFallback": false,
                "fallbackReason": null
            }))
        );
        assert_eq!(
            first.record.payload.get("reference_images"),
            Some(&json!(["https://example.com/reference-a.png"]))
        );
        assert_eq!(
            first.record.payload.get("storyboard_slots"),
            Some(&json!([
                {
                    "prompt": "未来感实验室的广角建立镜头",
                    "slot_id": "storyboard-slot-1",
                    "label": "建立镜头",
                    "shot_type": "establishing"
                },
                {
                    "prompt": "聚焦核心设备与人物互动的中景",
                    "slot_id": "storyboard-slot-2",
                    "label": "主体互动",
                    "shot_type": "medium"
                }
            ]))
        );
        assert_eq!(
            first.record.payload.get("slot_id"),
            Some(&json!("document-slot-1"))
        );
        assert_eq!(
            first.record.payload.get("anchor_hint"),
            Some(&json!("section_end"))
        );
        assert_eq!(
            first.record.payload.get("anchor_section_title"),
            Some(&json!("技术亮点"))
        );
        assert_eq!(
            first.record.payload.get("anchor_text"),
            Some(&json!("这里是技术亮点段落，需要插入配图。"))
        );
        assert_eq!(
            first.record.relationships.slot_id.as_deref(),
            Some("document-slot-1")
        );
    }

    #[test]
    fn create_audio_generation_task_artifact_inner_should_write_voice_contract_payload() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let request = CreateAudioGenerationTaskArtifactRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            source_text: "这是一段需要生成温暖旁白的发布文案。".to_string(),
            title: Some("发布配音".to_string()),
            raw_text: Some("@配音 风格: 温暖 这是一段发布文案".to_string()),
            voice: Some("warm_narrator".to_string()),
            voice_style: Some("温暖".to_string()),
            target_language: Some("zh-CN".to_string()),
            mime_type: None,
            audio_path: None,
            duration_ms: None,
            provider_id: Some("limecore".to_string()),
            model: Some("voice-pro".to_string()),
            session_id: Some("session-voice-1".to_string()),
            project_id: Some("project-voice-1".to_string()),
            content_id: Some("content-voice-1".to_string()),
            entry_source: None,
            modality_contract_key: None,
            modality: None,
            required_capabilities: Vec::new(),
            routing_slot: None,
            runtime_contract: None,
            requested_target: None,
            output_path: None,
        };

        let first = create_audio_generation_task_artifact_inner(request)
            .expect("create audio generation task");
        let second =
            create_audio_generation_task_artifact_inner(CreateAudioGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                source_text: "这是一段需要生成温暖旁白的发布文案。".to_string(),
                title: Some("发布配音".to_string()),
                raw_text: Some("@配音 风格: 温暖 这是一段发布文案".to_string()),
                voice: Some("warm_narrator".to_string()),
                voice_style: Some("温暖".to_string()),
                target_language: Some("zh-CN".to_string()),
                mime_type: None,
                audio_path: None,
                duration_ms: None,
                provider_id: Some("limecore".to_string()),
                model: Some("voice-pro".to_string()),
                session_id: Some("session-voice-1".to_string()),
                project_id: Some("project-voice-1".to_string()),
                content_id: Some("content-voice-1".to_string()),
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: None,
                output_path: None,
            })
            .expect("reuse audio generation task");

        assert_eq!(first.task_id, second.task_id);
        assert!(second.reused_existing);
        assert!(first.path.starts_with(".lime/tasks/audio_generate/"));
        assert_eq!(first.task_type, "audio_generate");
        assert_eq!(first.task_family, "audio");
        assert_eq!(
            first
                .record
                .payload
                .get("entry_source")
                .and_then(Value::as_str),
            Some("at_voice_command")
        );
        assert_eq!(
            first
                .record
                .payload
                .get("modality_contract_key")
                .and_then(Value::as_str),
            Some(VOICE_GENERATION_CONTRACT_KEY)
        );
        assert_eq!(
            first.record.payload.get("modality").and_then(Value::as_str),
            Some("audio")
        );
        assert_eq!(
            first.record.payload.get("required_capabilities"),
            Some(&json!(["text_generation", "voice_generation"]))
        );
        assert_eq!(
            first
                .record
                .payload
                .get("routing_slot")
                .and_then(Value::as_str),
            Some(crate::commands::modality_runtime_contracts::VOICE_GENERATION_ROUTING_SLOT)
        );
        assert_eq!(
            first
                .record
                .payload
                .pointer("/runtime_contract/executor_binding/binding_key")
                .and_then(Value::as_str),
            Some("voice_runtime")
        );
        assert_eq!(
            first
                .record
                .payload
                .pointer("/audio_output/kind")
                .and_then(Value::as_str),
            Some("audio_output")
        );
        assert_eq!(
            first
                .record
                .payload
                .pointer("/audio_output/status")
                .and_then(Value::as_str),
            Some("pending")
        );
        assert_eq!(
            first
                .record
                .payload
                .pointer("/audio_output/mime_type")
                .and_then(Value::as_str),
            Some(AUDIO_TASK_DEFAULT_MIME_TYPE)
        );

        let listed = list_media_task_artifacts_inner(ListMediaTaskArtifactsRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            status: Some("pending".to_string()),
            task_family: Some("audio".to_string()),
            task_type: Some("audio_generate".to_string()),
            modality_contract_key: Some(VOICE_GENERATION_CONTRACT_KEY.to_string()),
            routing_outcome: Some("accepted".to_string()),
            limit: Some(10),
        })
        .expect("list audio generation tasks");

        assert_eq!(listed.total, 1);
        assert_eq!(listed.modality_runtime_contracts.snapshot_count, 1);
        assert_eq!(listed.modality_runtime_contracts.audio_output_count, 1);
        assert_eq!(
            listed.modality_runtime_contracts.audio_output_statuses[0].status,
            "pending"
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .routing_event
                .as_str(),
            "executor_invoked"
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .audio_output_status
                .as_deref(),
            Some("pending")
        );
    }

    #[test]
    fn create_transcription_task_artifact_inner_should_write_audio_transcription_contract_payload()
    {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let first =
            create_transcription_task_artifact_inner(CreateTranscriptionTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: Some("生成逐字稿".to_string()),
                title: Some("会议转写".to_string()),
                raw_text: Some("@转写 /tmp/interview.wav 生成逐字稿".to_string()),
                source_url: None,
                source_path: Some("/tmp/interview.wav".to_string()),
                language: Some("zh-CN".to_string()),
                output_format: Some("srt".to_string()),
                speaker_labels: Some(true),
                timestamps: Some(true),
                provider_id: Some("limecore".to_string()),
                model: Some("asr-pro".to_string()),
                session_id: Some("session-transcription-1".to_string()),
                project_id: Some("project-transcription-1".to_string()),
                content_id: Some("content-transcription-1".to_string()),
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: None,
                output_path: None,
            })
            .expect("create transcription task");
        let second =
            create_transcription_task_artifact_inner(CreateTranscriptionTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: Some("生成逐字稿".to_string()),
                title: Some("会议转写".to_string()),
                raw_text: Some("@转写 /tmp/interview.wav 生成逐字稿".to_string()),
                source_url: None,
                source_path: Some("/tmp/interview.wav".to_string()),
                language: Some("zh-CN".to_string()),
                output_format: Some("srt".to_string()),
                speaker_labels: Some(true),
                timestamps: Some(true),
                provider_id: Some("limecore".to_string()),
                model: Some("asr-pro".to_string()),
                session_id: Some("session-transcription-1".to_string()),
                project_id: Some("project-transcription-1".to_string()),
                content_id: Some("content-transcription-1".to_string()),
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: None,
                output_path: None,
            })
            .expect("reuse transcription task");

        assert_eq!(first.task_id, second.task_id);
        assert!(second.reused_existing);
        assert!(first
            .path
            .starts_with(".lime/tasks/transcription_generate/"));
        assert_eq!(first.task_type, "transcription_generate");
        assert_eq!(first.task_family, "document");
        assert_eq!(
            first
                .record
                .payload
                .get("entry_source")
                .and_then(Value::as_str),
            Some("at_transcription_command")
        );
        assert_eq!(
            first
                .record
                .payload
                .get("modality_contract_key")
                .and_then(Value::as_str),
            Some(AUDIO_TRANSCRIPTION_CONTRACT_KEY)
        );
        assert_eq!(
            first.record.payload.get("modality").and_then(Value::as_str),
            Some("audio")
        );
        assert_eq!(
            first.record.payload.get("required_capabilities"),
            Some(&json!(["text_generation", "audio_transcription"]))
        );
        assert_eq!(
            first
                .record
                .payload
                .get("routing_slot")
                .and_then(Value::as_str),
            Some(AUDIO_TRANSCRIPTION_ROUTING_SLOT)
        );
        assert_eq!(
            first
                .record
                .payload
                .pointer("/runtime_contract/executor_binding/binding_key")
                .and_then(Value::as_str),
            Some("transcription_generate")
        );
        assert_eq!(
            first
                .record
                .payload
                .pointer("/transcript/kind")
                .and_then(Value::as_str),
            Some("transcript")
        );
        assert_eq!(
            first
                .record
                .payload
                .pointer("/transcript/status")
                .and_then(Value::as_str),
            Some("pending")
        );
        assert_eq!(
            first
                .record
                .payload
                .pointer("/transcript/source_path")
                .and_then(Value::as_str),
            Some("/tmp/interview.wav")
        );
        assert_eq!(
            first
                .record
                .payload
                .pointer("/transcript/output_format")
                .and_then(Value::as_str),
            Some("srt")
        );

        let listed = list_media_task_artifacts_inner(ListMediaTaskArtifactsRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            status: Some("pending".to_string()),
            task_family: Some("document".to_string()),
            task_type: Some("transcription_generate".to_string()),
            modality_contract_key: Some(AUDIO_TRANSCRIPTION_CONTRACT_KEY.to_string()),
            routing_outcome: Some("accepted".to_string()),
            limit: Some(10),
        })
        .expect("list transcription tasks");

        assert_eq!(listed.total, 1);
        assert_eq!(listed.modality_runtime_contracts.snapshot_count, 1);
        assert_eq!(listed.modality_runtime_contracts.transcript_count, 1);
        assert_eq!(
            listed.modality_runtime_contracts.transcript_statuses[0].status,
            "pending"
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .routing_event
                .as_str(),
            "executor_invoked"
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .transcript_status
                .as_deref(),
            Some("pending")
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .transcript_source_path
                .as_deref(),
            Some("/tmp/interview.wav")
        );
    }

    #[tokio::test]
    async fn execute_audio_transcription_task_should_mark_provider_resolver_unavailable_without_fabricated_transcript(
    ) {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let source_path = temp_dir.path().join("meeting.wav");
        std::fs::write(&source_path, b"fake wav bytes").expect("write fake source audio");
        let created =
            create_transcription_task_artifact_inner(CreateTranscriptionTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: Some("生成逐字稿".to_string()),
                title: Some("转写执行器失败态".to_string()),
                raw_text: Some("@转写 meeting.wav".to_string()),
                source_url: None,
                source_path: Some(source_path.to_string_lossy().to_string()),
                language: Some("zh".to_string()),
                output_format: Some("json".to_string()),
                speaker_labels: Some(false),
                timestamps: Some(false),
                provider_id: Some("openai-asr".to_string()),
                model: Some("whisper-1".to_string()),
                session_id: Some("session-transcription-worker-1".to_string()),
                project_id: Some("project-transcription-worker-1".to_string()),
                content_id: Some("content-transcription-worker-1".to_string()),
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: None,
                output_path: None,
            })
            .expect("create transcription task");

        let result = execute_transcription_task(
            None,
            temp_dir.path().to_path_buf(),
            created.task_id.clone(),
        )
        .await
        .expect("transcription worker should settle to failed output");

        assert_eq!(result.normalized_status, "failed");
        assert_eq!(
            result.last_error.as_ref().map(|value| value.code.as_str()),
            Some("transcription_provider_resolver_unavailable")
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/transcript/status")
                .and_then(Value::as_str),
            Some("failed")
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/transcript/error_code")
                .and_then(Value::as_str),
            Some("transcription_provider_resolver_unavailable")
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/transcript/retryable")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/transcript/transcript_path")
                .and_then(Value::as_str),
            None
        );
        assert!(result.record.result.is_none());
        assert_eq!(
            result
                .record
                .attempts
                .first()
                .and_then(|attempt| attempt.worker_id.as_deref()),
            Some(TRANSCRIPTION_TASK_RUNNER_WORKER_ID)
        );

        let listed = list_media_task_artifacts_inner(ListMediaTaskArtifactsRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            status: Some("failed".to_string()),
            task_family: Some("document".to_string()),
            task_type: Some("transcription_generate".to_string()),
            modality_contract_key: Some(AUDIO_TRANSCRIPTION_CONTRACT_KEY.to_string()),
            routing_outcome: Some("failed".to_string()),
            limit: Some(10),
        })
        .expect("list failed transcription tasks");
        assert_eq!(listed.total, 1);
        assert_eq!(listed.modality_runtime_contracts.transcript_count, 1);
        assert_eq!(
            listed.modality_runtime_contracts.transcript_statuses[0].status,
            "failed"
        );
        assert_eq!(
            listed.modality_runtime_contracts.transcript_error_codes,
            vec!["transcription_provider_resolver_unavailable".to_string()]
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .transcript_error_code
                .as_deref(),
            Some("transcription_provider_resolver_unavailable")
        );
    }

    #[tokio::test]
    async fn execute_audio_transcription_task_with_openai_compatible_provider_should_write_transcript_output(
    ) {
        let captured_request = Arc::new(Mutex::new(None::<(String, String)>));
        let captured_for_server = Arc::clone(&captured_request);
        let app = Router::new().route(
            "/v1/audio/transcriptions",
            post(move |headers: HeaderMap, body: axum::body::Bytes| {
                let captured = Arc::clone(&captured_for_server);
                async move {
                    let authorization = headers
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    let body_text = String::from_utf8_lossy(&body).to_string();
                    *captured.lock().expect("lock captured request") =
                        Some((authorization, body_text));
                    Json(json!({
                        "text": "这里是会议转写结果。",
                        "language": "zh"
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock transcription server");
        let address = listener.local_addr().expect("mock server addr");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve mock transcription server");
        });

        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let source_path = temp_dir.path().join("meeting.wav");
        std::fs::write(&source_path, b"fake wav bytes").expect("write fake source audio");
        let created =
            create_transcription_task_artifact_inner(CreateTranscriptionTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: Some("请转写会议音频".to_string()),
                title: Some("真实转写执行器".to_string()),
                raw_text: Some("@转写 meeting.wav".to_string()),
                source_url: None,
                source_path: Some(source_path.to_string_lossy().to_string()),
                language: Some("zh".to_string()),
                output_format: Some("json".to_string()),
                speaker_labels: Some(false),
                timestamps: Some(false),
                provider_id: Some("openai-asr".to_string()),
                model: Some("whisper-1".to_string()),
                session_id: Some("session-transcription-worker-success".to_string()),
                project_id: Some("project-transcription-worker-success".to_string()),
                content_id: Some("content-transcription-worker-success".to_string()),
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: None,
                output_path: None,
            })
            .expect("create transcription task");

        let result = execute_transcription_task_with_runner_config(
            None,
            temp_dir.path().to_path_buf(),
            created.task_id.clone(),
            TranscriptionRunnerConfig {
                provider_id: "openai-asr".to_string(),
                model: "whisper-1".to_string(),
                endpoint: format!("http://{address}/v1/audio/transcriptions"),
                api_key: "sk-test-transcription".to_string(),
            },
        )
        .await
        .expect("transcription worker should complete with provider text");
        server.abort();

        assert_eq!(result.normalized_status, "succeeded");
        assert_eq!(
            result
                .record
                .payload
                .pointer("/transcript/status")
                .and_then(Value::as_str),
            Some("completed")
        );
        let transcript_path = result
            .record
            .payload
            .pointer("/transcript/transcript_path")
            .and_then(Value::as_str)
            .expect("transcript output path");
        assert!(transcript_path.starts_with(".lime/runtime/transcripts/"));
        assert!(transcript_path.ends_with(".json"));
        let transcript_content = std::fs::read_to_string(temp_dir.path().join(transcript_path))
            .expect("read generated transcript output");
        assert!(transcript_content.contains("这里是会议转写结果。"));
        assert_eq!(
            result
                .record
                .payload
                .pointer("/transcript/text_preview")
                .and_then(Value::as_str),
            Some("这里是会议转写结果。")
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/transcript/provider_id")
                .and_then(Value::as_str),
            Some("openai-asr")
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/transcript/model")
                .and_then(Value::as_str),
            Some("whisper-1")
        );
        assert_eq!(
            result
                .record
                .result
                .as_ref()
                .and_then(|value| value.pointer("/transcript/transcript_path"))
                .and_then(Value::as_str),
            Some(transcript_path)
        );
        assert_eq!(
            result
                .record
                .attempts
                .first()
                .and_then(|attempt| attempt.worker_id.as_deref()),
            Some(TRANSCRIPTION_TASK_RUNNER_WORKER_ID)
        );

        let (authorization, body_text) = captured_request
            .lock()
            .expect("lock captured request")
            .clone()
            .expect("captured transcription request");
        assert_eq!(authorization, "Bearer sk-test-transcription");
        assert!(body_text.contains("name=\"model\""));
        assert!(body_text.contains("whisper-1"));
        assert!(body_text.contains("name=\"response_format\""));
        assert!(body_text.contains("json"));
    }

    #[test]
    fn complete_audio_generation_task_artifact_inner_should_write_audio_output_result() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_audio_generation_task_artifact_inner(CreateAudioGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                source_text: "请把这段内容生成温暖旁白。".to_string(),
                title: Some("音频完成态".to_string()),
                raw_text: Some("@配音 请把这段内容生成温暖旁白。".to_string()),
                voice: Some("warm_narrator".to_string()),
                voice_style: Some("温暖".to_string()),
                target_language: Some("zh-CN".to_string()),
                mime_type: None,
                audio_path: None,
                duration_ms: None,
                provider_id: Some("limecore".to_string()),
                model: Some("voice-pro".to_string()),
                session_id: Some("session-voice-complete".to_string()),
                project_id: Some("project-voice-complete".to_string()),
                content_id: Some("content-voice-complete".to_string()),
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: None,
                output_path: None,
            })
            .expect("create audio task");

        let completed = complete_audio_generation_task_artifact_inner(
            CompleteAudioGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                task_ref: created.task_id.clone(),
                audio_path: ".lime/runtime/audio/voice-complete.mp3".to_string(),
                mime_type: Some("audio/mpeg".to_string()),
                duration_ms: Some(3200),
                provider_id: Some("limecore".to_string()),
                model: Some("voice-pro".to_string()),
            },
        )
        .expect("complete audio task");

        assert_eq!(completed.task_id, created.task_id);
        assert_eq!(completed.status, "succeeded");
        assert_eq!(completed.normalized_status, "succeeded");
        assert!(completed.record.completed_at.is_some());
        assert_eq!(
            completed
                .record
                .payload
                .pointer("/audio_output/status")
                .and_then(Value::as_str),
            Some("completed")
        );
        assert_eq!(
            completed
                .record
                .payload
                .pointer("/audio_output/audio_path")
                .and_then(Value::as_str),
            Some(".lime/runtime/audio/voice-complete.mp3")
        );
        assert_eq!(
            completed
                .record
                .payload
                .pointer("/audio_output/duration_ms")
                .and_then(Value::as_u64),
            Some(3200)
        );
        assert_eq!(
            completed
                .record
                .payload
                .pointer("/audio_output/modality_contract_key")
                .and_then(Value::as_str),
            Some(VOICE_GENERATION_CONTRACT_KEY)
        );
        assert_eq!(
            completed
                .record
                .result
                .as_ref()
                .and_then(|value| value.pointer("/audio_output/audio_path"))
                .and_then(Value::as_str),
            Some(".lime/runtime/audio/voice-complete.mp3")
        );
        assert_eq!(
            completed
                .record
                .attempts
                .first()
                .and_then(|attempt| attempt.worker_id.as_deref()),
            Some(AUDIO_TASK_COMPLETION_WORKER_ID)
        );
        assert_eq!(
            completed
                .record
                .attempts
                .first()
                .and_then(|attempt| attempt.result_snapshot.as_ref())
                .and_then(|value| value.pointer("/audio_output/status"))
                .and_then(Value::as_str),
            Some("completed")
        );

        let listed = list_media_task_artifacts_inner(ListMediaTaskArtifactsRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            status: Some("succeeded".to_string()),
            task_family: Some("audio".to_string()),
            task_type: Some("audio_generate".to_string()),
            modality_contract_key: Some(VOICE_GENERATION_CONTRACT_KEY.to_string()),
            routing_outcome: Some("accepted".to_string()),
            limit: Some(10),
        })
        .expect("list completed audio generation tasks");
        assert_eq!(listed.total, 1);
        assert_eq!(listed.modality_runtime_contracts.audio_output_count, 1);
        assert_eq!(
            listed.modality_runtime_contracts.audio_output_statuses[0].status,
            "completed"
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .audio_output_path
                .as_deref(),
            Some(".lime/runtime/audio/voice-complete.mp3")
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0].audio_output_duration_ms,
            Some(3200)
        );
    }

    #[tokio::test]
    async fn execute_audio_generation_task_should_mark_provider_resolver_unavailable_without_fabricated_audio(
    ) {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_audio_generation_task_artifact_inner(CreateAudioGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                source_text: "请生成一段清晰的产品播报。".to_string(),
                title: Some("音频执行器骨架".to_string()),
                raw_text: Some("@配音 请生成一段清晰的产品播报。".to_string()),
                voice: Some("clear_narrator".to_string()),
                voice_style: Some("清晰".to_string()),
                target_language: Some("zh-CN".to_string()),
                mime_type: None,
                audio_path: None,
                duration_ms: None,
                provider_id: Some("limecore".to_string()),
                model: Some("voice-pro".to_string()),
                session_id: Some("session-audio-worker-1".to_string()),
                project_id: Some("project-audio-worker-1".to_string()),
                content_id: Some("content-audio-worker-1".to_string()),
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: None,
                output_path: None,
            })
            .expect("create audio task");

        let result = execute_audio_generation_task(
            None,
            temp_dir.path().to_path_buf(),
            created.task_id.clone(),
        )
        .await
        .expect("audio worker should settle to failed output");

        assert_eq!(result.normalized_status, "failed");
        assert_eq!(
            result.last_error.as_ref().map(|value| value.code.as_str()),
            Some("audio_provider_resolver_unavailable")
        );
        assert_eq!(
            result.last_error.as_ref().map(|value| value.retryable),
            Some(true)
        );
        assert_eq!(
            result
                .last_error
                .as_ref()
                .and_then(|value| value.stage.as_deref()),
            Some("bootstrap")
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/audio_output/status")
                .and_then(Value::as_str),
            Some("failed")
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/audio_output/error_code")
                .and_then(Value::as_str),
            Some("audio_provider_resolver_unavailable")
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/audio_output/retryable")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/audio_output/audio_path")
                .and_then(Value::as_str),
            None
        );
        assert!(result.record.result.is_none());
        assert_eq!(
            result
                .record
                .attempts
                .first()
                .and_then(|attempt| attempt.worker_id.as_deref()),
            Some(AUDIO_TASK_RUNNER_WORKER_ID)
        );

        let loaded = get_media_task_artifact_inner(MediaTaskLookupRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            task_ref: created.task_id.clone(),
        })
        .expect("load failed audio task");
        assert_eq!(loaded.normalized_status, "failed");
        assert_eq!(
            loaded
                .record
                .payload
                .pointer("/audio_output/status")
                .and_then(Value::as_str),
            Some("failed")
        );

        let listed = list_media_task_artifacts_inner(ListMediaTaskArtifactsRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            status: Some("failed".to_string()),
            task_family: Some("audio".to_string()),
            task_type: Some("audio_generate".to_string()),
            modality_contract_key: Some(VOICE_GENERATION_CONTRACT_KEY.to_string()),
            routing_outcome: Some("failed".to_string()),
            limit: Some(10),
        })
        .expect("list failed audio generation tasks");
        assert_eq!(listed.total, 1);
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .failure_code
                .as_deref(),
            Some("audio_provider_resolver_unavailable")
        );
        assert_eq!(listed.modality_runtime_contracts.audio_output_count, 1);
        assert_eq!(
            listed.modality_runtime_contracts.audio_output_statuses[0].status,
            "failed"
        );
        assert_eq!(
            listed.modality_runtime_contracts.audio_output_error_codes,
            vec!["audio_provider_resolver_unavailable".to_string()]
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .audio_output_error_code
                .as_deref(),
            Some("audio_provider_resolver_unavailable")
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0].audio_output_retryable,
            Some(true)
        );
    }

    #[tokio::test]
    async fn execute_audio_generation_task_with_openai_compatible_provider_should_write_audio_output(
    ) {
        let captured_request = Arc::new(Mutex::new(None::<(String, Value)>));
        let captured_for_server = Arc::clone(&captured_request);
        let app = Router::new().route(
            "/v1/audio/speech",
            post(move |headers: HeaderMap, Json(body): Json<Value>| {
                let captured = Arc::clone(&captured_for_server);
                async move {
                    let authorization = headers
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    *captured.lock().expect("lock captured request") = Some((authorization, body));
                    (
                        [(axum::http::header::CONTENT_TYPE, "audio/mpeg")],
                        Vec::from(&b"ID3 lime audio bytes"[..]),
                    )
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock audio server");
        let address = listener.local_addr().expect("mock server addr");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve mock audio server");
        });

        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_audio_generation_task_artifact_inner(CreateAudioGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                source_text: "请生成一段清晰的产品播报。".to_string(),
                title: Some("真实音频执行器".to_string()),
                raw_text: Some("@配音 请生成一段清晰的产品播报。".to_string()),
                voice: Some("alloy".to_string()),
                voice_style: Some("clear".to_string()),
                target_language: Some("zh-CN".to_string()),
                mime_type: None,
                audio_path: None,
                duration_ms: None,
                provider_id: Some("openai-tts".to_string()),
                model: Some("gpt-4o-mini-tts".to_string()),
                session_id: Some("session-audio-worker-success".to_string()),
                project_id: Some("project-audio-worker-success".to_string()),
                content_id: Some("content-audio-worker-success".to_string()),
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: None,
                output_path: None,
            })
            .expect("create audio task");

        let result = execute_audio_generation_task_with_runner_config(
            None,
            temp_dir.path().to_path_buf(),
            created.task_id.clone(),
            AudioGenerationRunnerConfig {
                provider_id: "openai-tts".to_string(),
                model: "gpt-4o-mini-tts".to_string(),
                endpoint: format!("http://{address}/v1/audio/speech"),
                api_key: "sk-test-audio".to_string(),
            },
        )
        .await
        .expect("audio worker should complete with provider bytes");
        server.abort();

        assert_eq!(result.normalized_status, "succeeded");
        assert_eq!(
            result
                .record
                .payload
                .pointer("/audio_output/status")
                .and_then(Value::as_str),
            Some("completed")
        );
        let audio_path = result
            .record
            .payload
            .pointer("/audio_output/audio_path")
            .and_then(Value::as_str)
            .expect("audio output path");
        assert!(audio_path.starts_with(".lime/runtime/audio/"));
        assert!(audio_path.ends_with(".mp3"));
        let audio_bytes =
            std::fs::read(temp_dir.path().join(audio_path)).expect("read generated audio output");
        assert_eq!(audio_bytes, b"ID3 lime audio bytes");
        assert_eq!(
            result
                .record
                .payload
                .pointer("/audio_output/provider_id")
                .and_then(Value::as_str),
            Some("openai-tts")
        );
        assert_eq!(
            result
                .record
                .payload
                .pointer("/audio_output/model")
                .and_then(Value::as_str),
            Some("gpt-4o-mini-tts")
        );
        assert_eq!(
            result
                .record
                .result
                .as_ref()
                .and_then(|value| value.pointer("/audio_output/audio_path"))
                .and_then(Value::as_str),
            Some(audio_path)
        );
        assert_eq!(
            result
                .record
                .attempts
                .first()
                .and_then(|attempt| attempt.worker_id.as_deref()),
            Some(AUDIO_TASK_RUNNER_WORKER_ID)
        );

        let (authorization, body) = captured_request
            .lock()
            .expect("lock captured request")
            .clone()
            .expect("captured speech request");
        assert_eq!(authorization, "Bearer sk-test-audio");
        assert_eq!(
            body.get("model").and_then(Value::as_str),
            Some("gpt-4o-mini-tts")
        );
        assert_eq!(
            body.get("input").and_then(Value::as_str),
            Some("请生成一段清晰的产品播报。")
        );
        assert_eq!(body.get("voice").and_then(Value::as_str), Some("alloy"));
        assert_eq!(
            body.get("response_format").and_then(Value::as_str),
            Some("mp3")
        );
        assert!(body
            .get("instructions")
            .and_then(Value::as_str)
            .is_some_and(|value| value.contains("clear") && value.contains("zh-CN")));
    }

    #[test]
    fn validate_image_generation_task_execution_contract_should_reject_text_model_candidate() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_image_generation_task_artifact_inner(minimal_image_generation_request(
                temp_dir.path().to_string_lossy().to_string(),
                Some("gpt-5.2"),
            ))
            .expect("create task");

        let error = validate_image_generation_task_execution_contract(&created, None)
            .expect_err("text model should be rejected for image generation");

        assert_eq!(error.code, "image_generation_model_capability_gap");
        assert_eq!(error.stage.as_deref(), Some("routing"));
        assert!(!error.retryable);
    }

    #[test]
    fn validate_image_generation_task_execution_contract_should_accept_image_model_candidate() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_image_generation_task_artifact_inner(minimal_image_generation_request(
                temp_dir.path().to_string_lossy().to_string(),
                Some("gpt-image-1"),
            ))
            .expect("create task");

        validate_image_generation_task_execution_contract(&created, None)
            .expect("image model should satisfy image_generation contract");
    }

    #[test]
    fn validate_image_generation_task_execution_contract_should_reject_registry_text_model() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_image_generation_task_artifact_inner(minimal_image_generation_request(
                temp_dir.path().to_string_lossy().to_string(),
                Some("lime-text-router"),
            ))
            .expect("create task");
        let assessment = ImageGenerationModelCapabilityAssessment {
            model_id: "lime-text-router".to_string(),
            provider_id: Some("lime".to_string()),
            source: "model_registry",
            supports_image_generation: false,
            reason: "registry_missing_image_generation_capability",
        };

        let error = validate_image_generation_task_execution_contract(&created, Some(&assessment))
            .expect_err("registry text model should be rejected for image generation");

        assert_eq!(error.code, "image_generation_model_capability_gap");
        assert!(error.message.contains("model registry"));
    }

    #[test]
    fn patch_image_task_model_capability_assessment_should_persist_registry_snapshot() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_image_generation_task_artifact_inner(minimal_image_generation_request(
                temp_dir.path().to_string_lossy().to_string(),
                Some("lime-text-router"),
            ))
            .expect("create task");
        let assessment = ImageGenerationModelCapabilityAssessment {
            model_id: "lime-text-router".to_string(),
            provider_id: Some("lime".to_string()),
            source: "model_registry",
            supports_image_generation: false,
            reason: "registry_missing_image_generation_capability",
        };

        let patched = patch_image_task_model_capability_assessment(
            temp_dir.path(),
            &created.task_id,
            &assessment,
        )
        .expect("patch model capability assessment");

        assert_eq!(
            patched
                .record
                .payload
                .pointer("/model_capability_assessment/source")
                .and_then(serde_json::Value::as_str),
            Some("model_registry")
        );
        assert_eq!(
            patched
                .record
                .payload
                .pointer("/model_capability_assessment/supports_image_generation")
                .and_then(serde_json::Value::as_bool),
            Some(false)
        );
        assert_eq!(
            patched
                .record
                .attempts
                .first()
                .and_then(|attempt| {
                    attempt
                        .input_snapshot
                        .pointer("/model_capability_assessment/model_id")
                })
                .and_then(serde_json::Value::as_str),
            Some("lime-text-router")
        );
    }

    #[test]
    fn validate_image_generation_task_execution_contract_should_trust_registry_image_model() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_image_generation_task_artifact_inner(minimal_image_generation_request(
                temp_dir.path().to_string_lossy().to_string(),
                Some("gpt-5.2"),
            ))
            .expect("create task");
        let assessment = ImageGenerationModelCapabilityAssessment {
            model_id: "gpt-5.2".to_string(),
            provider_id: Some("openai".to_string()),
            source: "model_registry",
            supports_image_generation: true,
            reason: "registry_declares_image_generation",
        };

        validate_image_generation_task_execution_contract(&created, Some(&assessment))
            .expect("registry image model should satisfy image_generation contract");
    }

    #[test]
    fn apply_image_generation_preference_defaults_should_fill_missing_provider_and_model() {
        let defaults = ImageGenerationPreferenceDefaults {
            provider_id: Some("custom-f0181b00-35b6-4731-94e2-24f17fd247c9".to_string()),
            model: Some("gpt-images-2".to_string()),
        };

        let (provider_id, model) =
            apply_image_generation_preference_defaults(None, None, &defaults);

        assert_eq!(
            provider_id.as_deref(),
            Some("custom-f0181b00-35b6-4731-94e2-24f17fd247c9")
        );
        assert_eq!(model.as_deref(), Some("gpt-images-2"));
    }

    #[test]
    fn apply_image_generation_preference_defaults_should_not_mix_explicit_provider_with_default_model(
    ) {
        let defaults = ImageGenerationPreferenceDefaults {
            provider_id: Some("custom-f0181b00-35b6-4731-94e2-24f17fd247c9".to_string()),
            model: Some("gpt-images-2".to_string()),
        };

        let (provider_id, model) =
            apply_image_generation_preference_defaults(Some("fal".to_string()), None, &defaults);

        assert_eq!(provider_id.as_deref(), Some("fal"));
        assert_eq!(model, None);
    }

    #[test]
    fn media_task_artifact_controls_should_share_same_task_file_protocol() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_image_generation_task_artifact_inner(CreateImageGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: "用于正文的未来感实验室配图".to_string(),
                title: Some("正文配图".to_string()),
                title_generation_result: None,
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 用于正文的未来感实验室配图".to_string()),
                layout_hint: None,
                size: Some("1024x1024".to_string()),
                aspect_ratio: None,
                count: Some(1),
                usage: Some("claw-image-workbench".to_string()),
                style: None,
                provider_id: Some("fal".to_string()),
                model: Some("fal-ai/flux-pro".to_string()),
                session_id: Some("session-2".to_string()),
                project_id: Some("project-2".to_string()),
                content_id: Some("content-2".to_string()),
                entry_source: Some("at_image_command".to_string()),
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: Some("generate".to_string()),
                slot_id: Some("document-slot-2".to_string()),
                anchor_hint: Some("section_end".to_string()),
                anchor_section_title: Some("核心观点".to_string()),
                anchor_text: Some("这里是核心观点内容。".to_string()),
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
                storyboard_slots: Vec::new(),
            })
            .expect("create task");

        let loaded = get_media_task_artifact_inner(MediaTaskLookupRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            task_ref: created.task_id.clone(),
        })
        .expect("load task");
        assert_eq!(loaded.task_id, created.task_id);

        let listed = list_media_task_artifacts_inner(ListMediaTaskArtifactsRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            status: Some("pending".to_string()),
            task_family: Some("image".to_string()),
            task_type: Some("image_generate".to_string()),
            modality_contract_key: None,
            routing_outcome: None,
            limit: Some(10),
        })
        .expect("list tasks");
        assert_eq!(listed.total, 1);
        assert_eq!(listed.tasks[0].task_id, created.task_id);
        assert_eq!(listed.modality_runtime_contracts.snapshot_count, 1);
        assert_eq!(
            listed.modality_runtime_contracts.contract_keys,
            vec![IMAGE_GENERATION_CONTRACT_KEY.to_string()]
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .routing_outcome
                .as_str(),
            "accepted"
        );

        let cancelled = cancel_media_task_artifact_inner(MediaTaskLookupRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            task_ref: created.task_id.clone(),
        })
        .expect("cancel task");
        assert_eq!(cancelled.normalized_status, "cancelled");
        assert!(cancelled.record.cancelled_at.is_some());
    }

    #[test]
    fn list_media_task_artifacts_inner_should_index_modality_contract_routing_blocks() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_image_generation_task_artifact_inner(minimal_image_generation_request(
                temp_dir.path().to_string_lossy().to_string(),
                Some("gpt-5.2"),
            ))
            .expect("create task");
        let assessment = ImageGenerationModelCapabilityAssessment {
            model_id: "gpt-5.2".to_string(),
            provider_id: Some("openai".to_string()),
            source: "model_registry",
            supports_image_generation: false,
            reason: "registry_missing_image_generation_capability",
        };
        patch_image_task_model_capability_assessment(
            temp_dir.path(),
            &created.task_id,
            &assessment,
        )
        .expect("patch model capability assessment");
        patch_image_task(
            temp_dir.path(),
            &created.task_id,
            TaskArtifactPatch {
                status: Some("failed".to_string()),
                last_error: Some(Some(build_task_error(
                    "image_generation_model_capability_gap",
                    "model registry 显示当前模型不具备图片生成能力。",
                    false,
                    "routing",
                ))),
                ..TaskArtifactPatch::default()
            },
        )
        .expect("mark task failed");

        let listed = list_media_task_artifacts_inner(ListMediaTaskArtifactsRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            status: Some("failed".to_string()),
            task_family: Some("image".to_string()),
            task_type: Some("image_generate".to_string()),
            modality_contract_key: Some(IMAGE_GENERATION_CONTRACT_KEY.to_string()),
            routing_outcome: Some("blocked".to_string()),
            limit: Some(10),
        })
        .expect("list contract routing blocks");

        assert_eq!(listed.total, 1);
        assert_eq!(
            listed.filters.modality_contract_key.as_deref(),
            Some(IMAGE_GENERATION_CONTRACT_KEY)
        );
        assert_eq!(listed.filters.routing_outcome.as_deref(), Some("blocked"));
        assert_eq!(listed.modality_runtime_contracts.snapshot_count, 1);
        assert_eq!(listed.modality_runtime_contracts.blocked_count, 1);
        assert_eq!(
            listed
                .modality_runtime_contracts
                .model_registry_assessment_count,
            1
        );
        assert_eq!(
            listed.modality_runtime_contracts.routing_outcomes[0].outcome,
            "blocked"
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0]
                .model_capability_assessment_source
                .as_deref(),
            Some("model_registry")
        );
        assert_eq!(
            listed.modality_runtime_contracts.snapshots[0].model_supports_image_generation,
            Some(false)
        );
    }

    #[test]
    fn create_image_generation_task_artifact_inner_should_create_new_task_after_cancelled_one() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let first =
            create_image_generation_task_artifact_inner(CreateImageGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: "未来感青柠实验室".to_string(),
                title: Some("青柠主视觉".to_string()),
                title_generation_result: None,
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 未来感青柠实验室".to_string()),
                layout_hint: None,
                size: Some("1024x1024".to_string()),
                aspect_ratio: None,
                count: Some(1),
                usage: Some("claw-image-workbench".to_string()),
                style: None,
                provider_id: Some("fal".to_string()),
                model: Some("fal-ai/nano-banana".to_string()),
                session_id: Some("session-1".to_string()),
                project_id: Some("project-1".to_string()),
                content_id: Some("content-1".to_string()),
                entry_source: Some("at_image_command".to_string()),
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: Some("generate".to_string()),
                slot_id: Some("document-slot-3".to_string()),
                anchor_hint: Some("section_end".to_string()),
                anchor_section_title: Some("结论".to_string()),
                anchor_text: Some("这里是结论段落。".to_string()),
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
                storyboard_slots: Vec::new(),
            })
            .expect("create first task");

        let cancelled = cancel_media_task_artifact_inner(MediaTaskLookupRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            task_ref: first.task_id.clone(),
        })
        .expect("cancel first task");
        assert_eq!(cancelled.normalized_status, "cancelled");

        let second =
            create_image_generation_task_artifact_inner(CreateImageGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: "未来感青柠实验室".to_string(),
                title: Some("青柠主视觉".to_string()),
                title_generation_result: None,
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 未来感青柠实验室".to_string()),
                layout_hint: None,
                size: Some("1024x1024".to_string()),
                aspect_ratio: None,
                count: Some(1),
                usage: Some("claw-image-workbench".to_string()),
                style: None,
                provider_id: Some("fal".to_string()),
                model: Some("fal-ai/nano-banana".to_string()),
                session_id: Some("session-1".to_string()),
                project_id: Some("project-1".to_string()),
                content_id: Some("content-1".to_string()),
                entry_source: Some("at_image_command".to_string()),
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: Some("generate".to_string()),
                slot_id: Some("document-slot-3".to_string()),
                anchor_hint: Some("section_end".to_string()),
                anchor_section_title: Some("结论".to_string()),
                anchor_text: Some("这里是结论段落。".to_string()),
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
                storyboard_slots: Vec::new(),
            })
            .expect("create second task");

        assert_ne!(first.task_id, second.task_id);
        assert!(!second.reused_existing);
        assert_eq!(second.normalized_status, "pending");
    }

    #[tokio::test]
    async fn execute_image_generation_task_should_advance_task_file_to_succeeded() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let captured_provider_id = Arc::new(Mutex::new(None::<String>));
        let captured_response_format = Arc::new(Mutex::new(None::<String>));
        let created =
            create_image_generation_task_artifact_inner(CreateImageGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: "未来感青柠实验室".to_string(),
                title: Some("青柠主视觉".to_string()),
                title_generation_result: None,
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 未来感青柠实验室".to_string()),
                layout_hint: None,
                size: Some("1024x1024".to_string()),
                aspect_ratio: None,
                count: Some(1),
                usage: Some("claw-image-workbench".to_string()),
                style: Some("cinematic".to_string()),
                provider_id: Some("fal".to_string()),
                model: Some("fal-ai/nano-banana-pro".to_string()),
                session_id: Some("session-image-worker-1".to_string()),
                project_id: Some("project-image-worker-1".to_string()),
                content_id: Some("content-image-worker-1".to_string()),
                entry_source: Some("at_image_command".to_string()),
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: Some("generate".to_string()),
                slot_id: None,
                anchor_hint: None,
                anchor_section_title: None,
                anchor_text: None,
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
                storyboard_slots: Vec::new(),
            })
            .expect("create task");

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image api");
        let address = listener.local_addr().expect("resolve address");
        let captured_provider_id_for_server = Arc::clone(&captured_provider_id);
        let captured_response_format_for_server = Arc::clone(&captured_response_format);
        let server = tokio::spawn(async move {
            let app = Router::new().route(
                "/v1/images/generations",
                post(move |headers: HeaderMap, Json(body): Json<Value>| {
                    let captured_provider_id = Arc::clone(&captured_provider_id_for_server);
                    let captured_response_format = Arc::clone(&captured_response_format_for_server);
                    async move {
                        let provider_id = headers
                            .get("x-provider-id")
                            .and_then(|value| value.to_str().ok())
                            .map(|value| value.to_string());
                        *captured_provider_id.lock().expect("lock provider id") = provider_id;
                        let response_format = body
                            .get("response_format")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string());
                        *captured_response_format
                            .lock()
                            .expect("lock response format") = response_format;
                        (
                            StatusCode::OK,
                            Json(json!({
                                "created": 1_717_200_000i64,
                                "data": [
                                    {
                                        "b64_json": "ZmFrZS1saW1lLWltYWdl",
                                        "revised_prompt": "未来感青柠实验室主视觉"
                                    }
                                ]
                            })),
                        )
                    }
                }),
            );
            axum::serve(listener, app).await.expect("serve image api");
        });

        let result = execute_image_generation_task(
            None,
            temp_dir.path().to_path_buf(),
            created.task_id.clone(),
            ImageGenerationRunnerConfig {
                endpoint: format!("http://{address}/v1/images/generations"),
                api_key: "test-key".to_string(),
            },
        )
        .await
        .expect("execute image task");

        assert_eq!(result.normalized_status, "succeeded");
        assert_eq!(
            result
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("images"))
                .and_then(|value| value.as_array())
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            result
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("images"))
                .and_then(|value| value.as_array())
                .and_then(|images| images.first())
                .and_then(|value| value.get("url"))
                .and_then(Value::as_str),
            Some("data:image/png;base64,ZmFrZS1saW1lLWltYWdl")
        );
        assert_eq!(
            result
                .record
                .attempts
                .last()
                .and_then(|attempt| attempt.worker_id.as_deref()),
            Some(IMAGE_TASK_RUNNER_WORKER_ID)
        );

        let loaded = get_media_task_artifact_inner(MediaTaskLookupRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            task_ref: created.task_id.clone(),
        })
        .expect("load succeeded task");
        assert_eq!(loaded.normalized_status, "succeeded");
        assert_eq!(
            loaded
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("images"))
                .and_then(|value| value.as_array())
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            loaded
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("images"))
                .and_then(|value| value.as_array())
                .and_then(|images| images.first())
                .and_then(|value| value.get("url"))
                .and_then(Value::as_str),
            Some("data:image/png;base64,ZmFrZS1saW1lLWltYWdl")
        );
        assert_eq!(
            captured_provider_id
                .lock()
                .expect("lock provider id")
                .clone(),
            Some("fal".to_string())
        );
        assert_eq!(
            captured_response_format
                .lock()
                .expect("lock response format")
                .clone(),
            Some("b64_json".to_string())
        );

        server.abort();
    }

    #[tokio::test]
    async fn execute_image_generation_task_should_mark_task_failed_when_service_rejects() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_image_generation_task_artifact_inner(CreateImageGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: "未来感青柠实验室".to_string(),
                title: Some("青柠主视觉".to_string()),
                title_generation_result: None,
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 未来感青柠实验室".to_string()),
                layout_hint: None,
                size: Some("1024x1024".to_string()),
                aspect_ratio: None,
                count: Some(1),
                usage: Some("claw-image-workbench".to_string()),
                style: None,
                provider_id: Some("fal".to_string()),
                model: Some("fal-ai/nano-banana-pro".to_string()),
                session_id: Some("session-image-worker-2".to_string()),
                project_id: Some("project-image-worker-2".to_string()),
                content_id: Some("content-image-worker-2".to_string()),
                entry_source: Some("at_image_command".to_string()),
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: Some("generate".to_string()),
                slot_id: None,
                anchor_hint: None,
                anchor_section_title: None,
                anchor_text: None,
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
                storyboard_slots: Vec::new(),
            })
            .expect("create task");

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image api");
        let address = listener.local_addr().expect("resolve address");
        let server = tokio::spawn(async move {
            let app = Router::new().route(
                "/v1/images/generations",
                post(|| async move {
                    (
                        StatusCode::TOO_MANY_REQUESTS,
                        Json(json!({
                            "error": {
                                "code": "rate_limited",
                                "message": "图片服务限流，请稍后重试"
                            }
                        })),
                    )
                }),
            );
            axum::serve(listener, app).await.expect("serve image api");
        });

        let result = execute_image_generation_task(
            None,
            temp_dir.path().to_path_buf(),
            created.task_id.clone(),
            ImageGenerationRunnerConfig {
                endpoint: format!("http://{address}/v1/images/generations"),
                api_key: "test-key".to_string(),
            },
        )
        .await
        .expect("image task should settle to failed output");

        assert_eq!(result.normalized_status, "failed");
        assert_eq!(
            result.last_error.as_ref().map(|value| value.code.as_str()),
            Some("rate_limited")
        );
        assert_eq!(
            result.last_error.as_ref().map(|value| value.retryable),
            Some(true)
        );

        server.abort();
    }
}
