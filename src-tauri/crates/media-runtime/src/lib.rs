use std::fs;
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Utc;
use image::{codecs::png::PngEncoder, ColorType, ImageEncoder, ImageFormat};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Map, Value};
use thiserror::Error;
use tokio::task::JoinSet;
use uuid::Uuid;

pub const DEFAULT_ARTIFACT_ROOT: &str = ".lime/tasks";
pub const IMAGE_TASK_RUNNER_WORKER_ID: &str = "lime-image-api-worker";
pub const IMAGE_TASK_RUNNER_TIMEOUT_SECS: u64 = 300;
pub const IMAGE_TASK_MAX_PARALLEL_REQUESTS: usize = 3;
const STORYBOARD_3X3_LAYOUT_HINT: &str = "storyboard_3x3";
const PNG_DATA_URL_MIME: &str = "image/png";
const CHROMA_KEY_DISTANCE_THRESHOLD: i16 = 32;
const IMAGE_TASK_POSTPROCESS_MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const IMAGE_EXECUTOR_MODE_IMAGES_API: &str = "images_api";
const IMAGE_EXECUTOR_MODE_RESPONSES_IMAGE_GENERATION: &str = "responses_image_generation";
const DEFAULT_RESPONSES_IMAGE_GENERATION_OUTER_MODEL: &str = "gpt-5.5";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageGenerationRunnerConfig {
    pub endpoint: String,
    pub api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreparedImageTaskSlot {
    slot_index: u32,
    slot_id: String,
    label: Option<String>,
    prompt: String,
    shot_type: Option<String>,
}

#[derive(Debug, Clone)]
struct PreparedImageTaskInput {
    prompt: String,
    model: String,
    size: Option<String>,
    count: u32,
    style: Option<String>,
    provider_id: Option<String>,
    executor_mode: String,
    outer_model: Option<String>,
    layout_hint: Option<String>,
    postprocess_plan: Option<PreparedImageTaskPostprocessPlan>,
    request_slots: Vec<PreparedImageTaskSlot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreparedImageTaskPostprocessPlan {
    strategy: String,
    chroma_key_color: String,
    document_id: Option<String>,
    layer_id: Option<String>,
    asset_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ImagePostprocessOutcome {
    status: &'static str,
    reason: Option<String>,
    output_url: Option<String>,
    removed_pixel_count: Option<u64>,
    total_pixel_count: Option<u64>,
    output_mime: Option<&'static str>,
    input_source: Option<&'static str>,
}

impl ImagePostprocessOutcome {
    fn succeeded(
        output_url: String,
        removed_pixel_count: u64,
        total_pixel_count: u64,
        input_source: &'static str,
    ) -> Self {
        Self {
            status: "succeeded",
            reason: None,
            output_url: Some(output_url),
            removed_pixel_count: Some(removed_pixel_count),
            total_pixel_count: Some(total_pixel_count),
            output_mime: Some(PNG_DATA_URL_MIME),
            input_source: Some(input_source),
        }
    }

    fn skipped(reason: impl Into<String>) -> Self {
        Self {
            status: "skipped_unsupported_source",
            reason: Some(reason.into()),
            output_url: None,
            removed_pixel_count: None,
            total_pixel_count: None,
            output_mime: None,
            input_source: None,
        }
    }

    fn failed(reason: impl Into<String>) -> Self {
        Self {
            status: "failed",
            reason: Some(reason.into()),
            output_url: None,
            removed_pixel_count: None,
            total_pixel_count: None,
            output_mime: None,
            input_source: None,
        }
    }
}

pub fn normalize_image_generation_service_host(host: &str) -> String {
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

pub fn build_image_generation_endpoint(host: &str, port: u16) -> String {
    format!(
        "http://{}:{port}/v1/images/generations",
        normalize_image_generation_service_host(host)
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    ImageGenerate,
    AudioGenerate,
    CoverGenerate,
    VideoGenerate,
    TranscriptionGenerate,
    BroadcastGenerate,
    UrlParse,
    Typesetting,
    ModalResourceSearch,
}

impl TaskType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ImageGenerate => "image_generate",
            Self::AudioGenerate => "audio_generate",
            Self::CoverGenerate => "cover_generate",
            Self::VideoGenerate => "video_generate",
            Self::TranscriptionGenerate => "transcription_generate",
            Self::BroadcastGenerate => "broadcast_generate",
            Self::UrlParse => "url_parse",
            Self::Typesetting => "typesetting",
            Self::ModalResourceSearch => "modal_resource_search",
        }
    }

    pub fn command_name(self) -> &'static str {
        match self {
            Self::ImageGenerate => "image",
            Self::AudioGenerate => "audio",
            Self::CoverGenerate => "cover",
            Self::VideoGenerate => "video",
            Self::TranscriptionGenerate => "transcription",
            Self::BroadcastGenerate => "broadcast",
            Self::UrlParse => "url-parse",
            Self::Typesetting => "typesetting",
            Self::ModalResourceSearch => "resource-search",
        }
    }

    pub fn default_status(self) -> &'static str {
        match self {
            Self::VideoGenerate => "queued",
            Self::ImageGenerate
            | Self::AudioGenerate
            | Self::CoverGenerate
            | Self::TranscriptionGenerate
            | Self::BroadcastGenerate
            | Self::UrlParse
            | Self::Typesetting
            | Self::ModalResourceSearch => "pending_submit",
        }
    }

    pub fn family(self) -> &'static str {
        match self {
            Self::ImageGenerate | Self::CoverGenerate => "image",
            Self::AudioGenerate => "audio",
            Self::VideoGenerate => "video",
            Self::TranscriptionGenerate
            | Self::BroadcastGenerate
            | Self::UrlParse
            | Self::Typesetting => "document",
            Self::ModalResourceSearch => "resource",
        }
    }

    pub fn all() -> &'static [Self] {
        &[
            Self::ImageGenerate,
            Self::AudioGenerate,
            Self::CoverGenerate,
            Self::VideoGenerate,
            Self::TranscriptionGenerate,
            Self::BroadcastGenerate,
            Self::UrlParse,
            Self::Typesetting,
            Self::ModalResourceSearch,
        ]
    }
}

impl FromStr for TaskType {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "image" | "image_generate" => Ok(Self::ImageGenerate),
            "audio" | "audio_generate" | "voice" | "voice_generate" => Ok(Self::AudioGenerate),
            "cover" | "cover_generate" => Ok(Self::CoverGenerate),
            "video" | "video_generate" => Ok(Self::VideoGenerate),
            "transcription" | "transcribe" | "transcription_generate" => {
                Ok(Self::TranscriptionGenerate)
            }
            "broadcast" | "broadcast_generate" => Ok(Self::BroadcastGenerate),
            "url-parse" | "url_parse" | "urlparse" => Ok(Self::UrlParse),
            "typesetting" => Ok(Self::Typesetting),
            "resource-search" | "resource_search" | "modal_resource_search" | "resource" => {
                Ok(Self::ModalResourceSearch)
            }
            _ => Err(()),
        }
    }
}

pub type MediaTaskType = TaskType;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TaskErrorRecord {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub occurred_at: Option<String>,
}

impl TaskErrorRecord {
    fn from_legacy_message(message: String) -> Option<Self> {
        let trimmed = message.trim();
        if trimmed.is_empty() {
            return None;
        }

        Some(Self {
            code: "legacy_error".to_string(),
            message: trimmed.to_string(),
            retryable: false,
            stage: None,
            provider_code: None,
            occurred_at: None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TaskRelationships {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depends_on_task_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub child_task_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_asset_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_from_attempt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub triggered_by_skill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub triggered_by_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_id: Option<String>,
}

impl TaskRelationships {
    fn is_empty(&self) -> bool {
        self.parent_task_id.is_none()
            && self.root_task_id.is_none()
            && self.depends_on_task_ids.is_empty()
            && self.child_task_ids.is_empty()
            && self.source_asset_ids.is_empty()
            && self.derived_from_attempt_id.is_none()
            && self.triggered_by_skill.is_none()
            && self.triggered_by_message_id.is_none()
            && self.slot_id.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TaskPreviewSlot {
    pub slot_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shot_type: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TaskProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preview_slots: Vec<TaskPreviewSlot>,
}

impl TaskProgress {
    fn is_empty(&self) -> bool {
        self.phase.is_none()
            && self.percent.is_none()
            && self.message.is_none()
            && self.preview_slots.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TaskUiHints {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub render_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_surface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_action: Option<String>,
}

impl TaskUiHints {
    fn is_empty(&self) -> bool {
        self.render_mode.is_none()
            && self.placeholder_text.is_none()
            && self.preferred_surface.is_none()
            && self.open_action.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TaskAttemptMetrics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_ms: Option<u64>,
}

impl TaskAttemptMetrics {
    fn is_empty(&self) -> bool {
        self.queue_ms.is_none() && self.run_ms.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TaskAttemptRecord {
    pub attempt_id: String,
    pub attempt_index: u32,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queued_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_id: Option<String>,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub input_snapshot: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_snapshot: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<TaskErrorRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<TaskAttemptMetrics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaskArtifactRecord {
    pub task_id: String,
    pub task_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub task_family: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub payload: Value,
    pub status: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub normalized_status: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub retry_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(
        default,
        deserialize_with = "deserialize_task_error_opt",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_error: Option<TaskErrorRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attempts: Vec<TaskAttemptRecord>,
    #[serde(default, skip_serializing_if = "TaskRelationships::is_empty")]
    pub relationships: TaskRelationships,
    #[serde(default, skip_serializing_if = "TaskProgress::is_empty")]
    pub progress: TaskProgress,
    #[serde(default, skip_serializing_if = "TaskUiHints::is_empty")]
    pub ui_hints: TaskUiHints,
}

pub type MediaTaskArtifactRecord = TaskArtifactRecord;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaskOutput {
    pub success: bool,
    pub task_id: String,
    pub task_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub task_family: String,
    pub status: String,
    pub normalized_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub attempt_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<TaskErrorRecord>,
    #[serde(default, skip_serializing_if = "TaskProgress::is_empty")]
    pub progress: TaskProgress,
    #[serde(default, skip_serializing_if = "TaskUiHints::is_empty")]
    pub ui_hints: TaskUiHints,
    pub path: String,
    pub absolute_path: String,
    pub artifact_path: String,
    pub absolute_artifact_path: String,
    #[serde(default)]
    pub reused_existing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    pub record: TaskArtifactRecord,
}

impl TaskOutput {
    pub fn artifact_paths(&self) -> Vec<String> {
        vec![self.path.clone()]
    }
}

pub type MediaTaskOutput = TaskOutput;

fn is_zero(value: &u32) -> bool {
    *value == 0
}

fn deserialize_task_error_opt<'de, D>(deserializer: D) -> Result<Option<TaskErrorRecord>, D::Error>
where
    D: Deserializer<'de>,
{
    let Some(value) = Option::<Value>::deserialize(deserializer)? else {
        return Ok(None);
    };

    match value {
        Value::Null => Ok(None),
        Value::String(message) => Ok(TaskErrorRecord::from_legacy_message(message)),
        other => serde_json::from_value(other)
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskErrorOutput {
    pub success: bool,
    pub error_code: String,
    pub error_message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}

impl TaskErrorOutput {
    pub fn from_error(error: &MediaRuntimeError) -> Self {
        Self {
            success: false,
            error_code: error.code().to_string(),
            error_message: error.to_string(),
            retryable: error.retryable(),
            hint: error.hint().map(ToOwned::to_owned),
            task_id: error.task_id(),
            idempotency_key: error.idempotency_key(),
        }
    }
}

pub type MediaTaskErrorOutput = TaskErrorOutput;

#[derive(Debug, Error)]
pub enum MediaRuntimeError {
    #[error("{0}")]
    InvalidParams(String),
    #[error("{0}")]
    Io(String),
    #[error("未找到任务: {task_ref}")]
    TaskNotFound { task_ref: String },
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    InvalidState(String),
    #[error("{0}")]
    NotRetryable(String),
}

impl MediaRuntimeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidParams(_) => "invalid_params",
            Self::Io(_) => "io_error",
            Self::TaskNotFound { .. } => "task_not_found",
            Self::Conflict(_) => "task_conflict",
            Self::InvalidState(_) => "invalid_state",
            Self::NotRetryable(_) => "not_retryable",
        }
    }

    pub fn exit_code(&self) -> i32 {
        match self {
            Self::InvalidParams(_) => 2,
            Self::TaskNotFound { .. } => 3,
            Self::Io(_) => 4,
            Self::Conflict(_) => 5,
            Self::InvalidState(_) => 6,
            Self::NotRetryable(_) => 7,
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(self, Self::Io(_))
    }

    pub fn hint(&self) -> Option<&'static str> {
        match self {
            Self::InvalidParams(_) => Some("请检查命令参数、路径和 JSON 字段是否完整。"),
            Self::Io(_) => Some("请检查工作目录、文件权限，或稍后重试。"),
            Self::TaskNotFound { .. } => {
                Some("可先运行 `lime task list` 或检查 `--artifact-dir`。")
            }
            Self::Conflict(_) => Some("请更换 `--output`，或使用稳定的 `--idempotency-key` 重试。"),
            Self::InvalidState(_) => Some("可先运行 `lime task status <task-id>` 查看当前状态。"),
            Self::NotRetryable(_) => Some("只有 failed 或 cancelled 的任务可以重试。"),
        }
    }

    pub fn task_id(&self) -> Option<String> {
        match self {
            Self::TaskNotFound { task_ref } => Some(task_ref.clone()),
            _ => None,
        }
    }

    pub fn idempotency_key(&self) -> Option<String> {
        None
    }
}

#[derive(Debug, Clone, Default)]
pub struct TaskWriteOptions<'a> {
    pub status: Option<String>,
    pub output_path: Option<&'a str>,
    pub artifact_dir: Option<&'a str>,
    pub idempotency_key: Option<&'a str>,
    pub relationships: TaskRelationships,
}

#[derive(Debug, Clone, Default)]
pub struct TaskArtifactPatch {
    pub status: Option<String>,
    pub payload_patch: Option<Value>,
    pub result: Option<Option<Value>>,
    pub last_error: Option<Option<TaskErrorRecord>>,
    pub progress: Option<TaskProgress>,
    pub ui_hints: Option<TaskUiHints>,
    pub current_attempt_worker_id: Option<Option<String>>,
    pub current_attempt_metrics: Option<Option<TaskAttemptMetrics>>,
}

fn is_safe_relative_path(path: &Path) -> bool {
    if path.is_absolute() {
        return false;
    }

    !path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}

fn normalize_relative_path(raw: &str, field_name: &str) -> Result<PathBuf, MediaRuntimeError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(MediaRuntimeError::InvalidParams(format!(
            "{field_name} 不能为空字符串"
        )));
    }

    let candidate = PathBuf::from(trimmed);
    if !is_safe_relative_path(&candidate) {
        return Err(MediaRuntimeError::InvalidParams(format!(
            "{field_name} 必须是安全的相对路径，且不能包含 '..'"
        )));
    }

    Ok(candidate)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn apply_payload_patch(payload: &mut Value, patch: Value) -> Result<(), MediaRuntimeError> {
    let Some(target) = payload.as_object_mut() else {
        return Err(MediaRuntimeError::InvalidState(
            "任务 payload 必须是 JSON object 才能应用 patch".to_string(),
        ));
    };
    let Value::Object(patch) = patch else {
        return Err(MediaRuntimeError::InvalidParams(
            "payloadPatch 必须是 JSON object".to_string(),
        ));
    };

    for (key, value) in patch {
        target.insert(key, value);
    }
    Ok(())
}

fn normalize_idempotency_key(raw: Option<&str>) -> Result<Option<String>, MediaRuntimeError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "idempotencyKey 不能为空字符串".to_string(),
        ));
    }
    Ok(Some(trimmed.to_string()))
}

fn resolve_artifact_root_relative_path(
    artifact_dir: Option<&str>,
) -> Result<PathBuf, MediaRuntimeError> {
    match artifact_dir {
        Some(raw) => normalize_relative_path(raw, "artifactDir"),
        None => Ok(PathBuf::from(DEFAULT_ARTIFACT_ROOT)),
    }
}

fn resolve_output_relative_path(
    task_type: TaskType,
    output_path: Option<&str>,
    artifact_dir: Option<&str>,
) -> Result<PathBuf, MediaRuntimeError> {
    if let Some(raw) = output_path {
        return normalize_relative_path(raw, "output");
    }

    let artifact_root = resolve_artifact_root_relative_path(artifact_dir)?;
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let suffix = Uuid::new_v4().simple().to_string();
    Ok(artifact_root
        .join(task_type.as_str())
        .join(format!("{timestamp}-{suffix}.json")))
}

fn task_family_for_type(task_type: &str) -> String {
    task_type
        .parse::<TaskType>()
        .ok()
        .map(|value| value.family().to_string())
        .unwrap_or_else(|| match task_type.trim().to_ascii_lowercase().as_str() {
            value if value.contains("image") || value.contains("cover") => "image".to_string(),
            value if value.contains("audio") || value.contains("voice") => "audio".to_string(),
            value if value.contains("video") => "video".to_string(),
            value if value.contains("resource") => "resource".to_string(),
            "transcription_generate" | "broadcast_generate" | "url_parse" | "typesetting" => {
                "document".to_string()
            }
            _ => "automation".to_string(),
        })
}

fn payload_string(payload: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        payload
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn summarize_text(raw: &str, limit: usize) -> String {
    let total = raw.chars().count();
    if total <= limit {
        return raw.to_string();
    }

    let summary: String = raw.chars().take(limit).collect();
    format!("{summary}...")
}

fn derive_task_summary(task_type: &str, title: Option<&str>, payload: &Value) -> Option<String> {
    title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            let candidate = match task_type {
                "image_generate" | "cover_generate" | "video_generate" => {
                    payload_string(payload, &["prompt", "usage"])
                }
                "audio_generate" => {
                    payload_string(payload, &["source_text", "prompt", "voice", "voice_style"])
                }
                "transcription_generate" => {
                    payload_string(payload, &["prompt", "source_path", "source_url"])
                }
                "broadcast_generate" | "typesetting" => {
                    payload_string(payload, &["content", "targetPlatform"])
                }
                "url_parse" => payload_string(payload, &["summary", "url"]),
                "modal_resource_search" => payload_string(payload, &["query", "usage"]),
                _ => payload_string(payload, &["prompt", "query", "content", "summary"]),
            }?;
            Some(summarize_text(&candidate, 48))
        })
}

fn derive_task_ui_hints(task_family: &str, summary: Option<&str>) -> TaskUiHints {
    match task_family {
        "image" => TaskUiHints {
            render_mode: Some("media_placeholder_card".to_string()),
            placeholder_text: Some(format!("[img:{}]", summary.unwrap_or("图片任务"))),
            preferred_surface: Some("claw_chat".to_string()),
            open_action: Some("open_image_workbench".to_string()),
        },
        "video" => TaskUiHints {
            render_mode: Some("media_placeholder_card".to_string()),
            placeholder_text: Some(format!("[video:{}]", summary.unwrap_or("视频任务"))),
            preferred_surface: Some("claw_chat".to_string()),
            open_action: Some("open_video_workbench".to_string()),
        },
        "audio" => TaskUiHints {
            render_mode: Some("media_placeholder_card".to_string()),
            placeholder_text: Some(format!("[audio:{}]", summary.unwrap_or("音频任务"))),
            preferred_surface: Some("claw_chat".to_string()),
            open_action: Some("open_audio_player".to_string()),
        },
        _ => TaskUiHints {
            render_mode: Some("task_status_card".to_string()),
            placeholder_text: None,
            preferred_surface: Some("task_panel".to_string()),
            open_action: Some("open_task_panel".to_string()),
        },
    }
}

fn derive_task_progress(status: &str, last_error: Option<&TaskErrorRecord>) -> TaskProgress {
    let normalized_status = normalize_status(status);
    match normalized_status.as_str() {
        "pending" => TaskProgress {
            phase: Some("pending_submit".to_string()),
            percent: Some(0),
            message: Some("任务已创建，等待进入队列".to_string()),
            preview_slots: Vec::new(),
        },
        "queued" => TaskProgress {
            phase: Some("queued".to_string()),
            percent: Some(0),
            message: Some("任务已进入队列".to_string()),
            preview_slots: Vec::new(),
        },
        "running" => TaskProgress {
            phase: Some("running".to_string()),
            percent: None,
            message: Some("任务执行中".to_string()),
            preview_slots: Vec::new(),
        },
        "partial" => TaskProgress {
            phase: Some("partial".to_string()),
            percent: None,
            message: Some("任务已返回部分结果".to_string()),
            preview_slots: Vec::new(),
        },
        "succeeded" => TaskProgress {
            phase: Some("succeeded".to_string()),
            percent: Some(100),
            message: Some("任务已完成".to_string()),
            preview_slots: Vec::new(),
        },
        "failed" => TaskProgress {
            phase: Some("failed".to_string()),
            percent: None,
            message: Some(
                last_error
                    .map(|value| value.message.clone())
                    .unwrap_or_else(|| "任务执行失败".to_string()),
            ),
            preview_slots: Vec::new(),
        },
        "cancelled" => TaskProgress {
            phase: Some("cancelled".to_string()),
            percent: None,
            message: Some("任务已取消".to_string()),
            preview_slots: Vec::new(),
        },
        _ => TaskProgress::default(),
    }
}

fn infer_attempt_provider(payload: &Value) -> Option<String> {
    payload_string(payload, &["provider", "providerId"])
}

fn infer_attempt_model(payload: &Value) -> Option<String> {
    payload_string(payload, &["model"])
}

fn new_attempt_id() -> String {
    format!("attempt_{}", Uuid::new_v4().simple())
}

fn legacy_attempt_id(task_id: &str, attempt_index: u32) -> String {
    format!("{task_id}:attempt:{attempt_index}")
}

fn fallback_attempt_index(record: &TaskArtifactRecord) -> u32 {
    record.retry_count.saturating_add(1).max(1)
}

struct AttemptRecordInput {
    attempt_id: String,
    attempt_index: u32,
    status: String,
    queued_at: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    result_snapshot: Option<Value>,
    error: Option<TaskErrorRecord>,
}

fn build_attempt_record(
    task_id: &str,
    payload: &Value,
    input: AttemptRecordInput,
) -> TaskAttemptRecord {
    let AttemptRecordInput {
        attempt_id,
        attempt_index,
        status,
        queued_at,
        started_at,
        completed_at,
        result_snapshot,
        error,
    } = input;

    TaskAttemptRecord {
        attempt_id,
        attempt_index,
        status,
        queued_at,
        started_at,
        completed_at,
        provider: infer_attempt_provider(payload),
        model: infer_attempt_model(payload),
        worker_id: None,
        input_snapshot: payload.clone(),
        result_snapshot,
        error,
        metrics: None,
        logs_ref: Some(format!(
            ".lime/task-logs/{task_id}/attempt_{attempt_index}.jsonl"
        )),
    }
}

fn current_attempt_index(record: &TaskArtifactRecord) -> Option<usize> {
    if record.attempts.is_empty() {
        return None;
    }

    record
        .current_attempt_id
        .as_deref()
        .and_then(|attempt_id| {
            record
                .attempts
                .iter()
                .position(|attempt| attempt.attempt_id == attempt_id)
        })
        .or_else(|| record.attempts.len().checked_sub(1))
}

fn canonicalize_task_record(mut record: TaskArtifactRecord) -> TaskArtifactRecord {
    record.title = normalize_optional_text(record.title);
    record.summary = normalize_optional_text(record.summary);
    record.task_family = if record.task_family.trim().is_empty() {
        task_family_for_type(&record.task_type)
    } else {
        record.task_family.trim().to_string()
    };
    record.normalized_status = normalize_status(&record.status);
    if record.summary.is_none() {
        record.summary =
            derive_task_summary(&record.task_type, record.title.as_deref(), &record.payload);
    }

    if record.attempts.is_empty() {
        let attempt_index = fallback_attempt_index(&record);
        let anchor_time = record
            .updated_at
            .clone()
            .unwrap_or_else(|| record.created_at.clone());
        let normalized_status = record.normalized_status.clone();
        let queued_at = matches!(
            normalized_status.as_str(),
            "queued" | "running" | "partial" | "succeeded" | "failed" | "cancelled"
        )
        .then(|| {
            record
                .submitted_at
                .clone()
                .unwrap_or_else(|| anchor_time.clone())
        });
        let started_at = matches!(
            normalized_status.as_str(),
            "running" | "partial" | "succeeded" | "failed" | "cancelled"
        )
        .then(|| {
            record
                .started_at
                .clone()
                .unwrap_or_else(|| anchor_time.clone())
        });
        let completed_at = matches!(
            normalized_status.as_str(),
            "partial" | "succeeded" | "failed" | "cancelled"
        )
        .then(|| {
            record
                .completed_at
                .clone()
                .or_else(|| record.cancelled_at.clone())
                .unwrap_or_else(|| anchor_time.clone())
        });

        record.attempts.push(build_attempt_record(
            &record.task_id,
            &record.payload,
            AttemptRecordInput {
                attempt_id: legacy_attempt_id(&record.task_id, attempt_index),
                attempt_index,
                status: record.status.clone(),
                queued_at,
                started_at,
                completed_at,
                result_snapshot: record.result.clone(),
                error: record.last_error.clone(),
            },
        ));
    }

    for (index, attempt) in record.attempts.iter_mut().enumerate() {
        if attempt.attempt_index == 0 {
            attempt.attempt_index = index as u32 + 1;
        }
        if attempt.attempt_id.trim().is_empty() {
            attempt.attempt_id = legacy_attempt_id(&record.task_id, attempt.attempt_index);
        }
        if attempt.status.trim().is_empty() {
            attempt.status = record.status.clone();
        } else if let Ok(status) = normalize_mutation_status(&attempt.status) {
            attempt.status = status;
        }
        if attempt.input_snapshot.is_null() {
            attempt.input_snapshot = record.payload.clone();
        }
        if attempt.provider.is_none() {
            attempt.provider = infer_attempt_provider(&attempt.input_snapshot);
        }
        if attempt.model.is_none() {
            attempt.model = infer_attempt_model(&attempt.input_snapshot);
        }
        if attempt.logs_ref.is_none() {
            attempt.logs_ref = Some(format!(
                ".lime/task-logs/{}/attempt_{}.jsonl",
                record.task_id, attempt.attempt_index
            ));
        }
        if attempt
            .metrics
            .as_ref()
            .is_some_and(TaskAttemptMetrics::is_empty)
        {
            attempt.metrics = None;
        }
    }

    if let Some(index) = current_attempt_index(&record) {
        let current_attempt = &mut record.attempts[index];
        if record.normalized_status == "failed" && current_attempt.error.is_none() {
            current_attempt.error = record.last_error.clone();
        }
        if matches!(record.normalized_status.as_str(), "partial" | "succeeded")
            && current_attempt.result_snapshot.is_none()
        {
            current_attempt.result_snapshot = record.result.clone();
        }
        record.current_attempt_id = Some(current_attempt.attempt_id.clone());
    } else {
        record.current_attempt_id = None;
    }

    record.retry_count = record.attempts.len().saturating_sub(1) as u32;
    if record.progress.is_empty() {
        record.progress = derive_task_progress(&record.status, record.last_error.as_ref());
    }
    if record.ui_hints.is_empty() {
        record.ui_hints = derive_task_ui_hints(&record.task_family, record.summary.as_deref());
    }

    record
}

fn normalize_status(status: &str) -> String {
    match status.trim().to_ascii_lowercase().as_str() {
        "pending" | "pending_submit" => "pending".to_string(),
        "queued" => "queued".to_string(),
        "running" | "processing" | "in_progress" => "running".to_string(),
        "partial" => "partial".to_string(),
        "completed" | "success" | "succeeded" => "succeeded".to_string(),
        "failed" | "error" => "failed".to_string(),
        "cancelled" | "canceled" => "cancelled".to_string(),
        other => other.to_string(),
    }
}

fn read_payload_string(payload: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        payload
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn read_payload_positive_u32(payload: &Value, keys: &[&str]) -> Option<u32> {
    keys.iter().find_map(|key| {
        let value = payload.get(*key)?;
        if let Some(number) = value.as_u64() {
            return u32::try_from(number).ok().filter(|item| *item > 0);
        }
        value
            .as_str()
            .and_then(|item| item.trim().parse::<u32>().ok().filter(|parsed| *parsed > 0))
    })
}

fn normalize_image_generation_executor_mode(value: Option<String>) -> String {
    match value
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.to_ascii_lowercase().replace('-', "_"))
        .as_deref()
    {
        Some("responses")
        | Some("responses_api")
        | Some("response_api")
        | Some("image_generation_tool")
        | Some("responses_image_generation") => {
            IMAGE_EXECUTOR_MODE_RESPONSES_IMAGE_GENERATION.to_string()
        }
        _ => IMAGE_EXECUTOR_MODE_IMAGES_API.to_string(),
    }
}

fn is_responses_image_generation_executor(mode: &str) -> bool {
    mode == IMAGE_EXECUTOR_MODE_RESPONSES_IMAGE_GENERATION
}

fn read_object_field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| value.get(*key))
}

fn read_nested_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn read_nested_bool(value: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_bool))
}

fn read_layered_design_chroma_key_postprocess_plan(
    payload: &Value,
) -> Option<PreparedImageTaskPostprocessPlan> {
    let runtime_contract = read_object_field(payload, &["runtime_contract", "runtimeContract"])?;
    let layered_design = read_object_field(runtime_contract, &["layered_design", "layeredDesign"])?;
    let alpha = read_object_field(layered_design, &["alpha"])?;
    let strategy = read_nested_string(alpha, &["strategy"])?;
    if strategy != "chroma_key_postprocess" {
        return None;
    }

    let postprocess_required =
        read_nested_bool(alpha, &["postprocess_required", "postprocessRequired"]).unwrap_or(true);
    if !postprocess_required {
        return None;
    }

    Some(PreparedImageTaskPostprocessPlan {
        strategy,
        chroma_key_color: read_nested_string(alpha, &["chroma_key_color", "chromaKeyColor"])
            .unwrap_or_else(|| "#00ff00".to_string()),
        document_id: read_nested_string(layered_design, &["document_id", "documentId"]),
        layer_id: read_nested_string(layered_design, &["layer_id", "layerId"]),
        asset_id: read_nested_string(layered_design, &["asset_id", "assetId"]),
    })
}

fn apply_image_postprocess_prompt_hint(
    prompt: &str,
    plan: Option<&PreparedImageTaskPostprocessPlan>,
) -> String {
    let Some(plan) = plan else {
        return prompt.to_string();
    };

    format!(
        "{prompt}\n\nLayered design alpha requirement: create the foreground subject on a flat chroma-key background ({}) so Lime can remove that key color after generation; avoid using that key color inside the subject.",
        plan.chroma_key_color
    )
}

fn read_positive_u32_from_value(value: &Value) -> Option<u32> {
    if let Some(number) = value.as_u64() {
        return u32::try_from(number).ok().filter(|item| *item > 0);
    }

    value
        .as_str()
        .and_then(|item| item.trim().parse::<u32>().ok().filter(|parsed| *parsed > 0))
}

fn read_storyboard_slot_text(
    record: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter().find_map(|key| {
        record
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn build_default_image_task_slot_id(layout_hint: Option<&str>, slot_index: u32) -> String {
    if layout_hint == Some(STORYBOARD_3X3_LAYOUT_HINT) {
        return format!("storyboard-slot-{slot_index}");
    }

    format!("image-slot-{slot_index}")
}

fn storyboard_fallback_beat(slot_index: u32) -> (&'static str, &'static str, &'static str) {
    match slot_index {
        1 => (
            "建立镜头",
            "establishing",
            "第1格使用建立镜头，先交代整体场景、时代氛围、空间关系和主要主体的分布",
        ),
        2 => (
            "主体亮相",
            "hero_intro",
            "第2格聚焦一个核心主体或主角，给出具有辨识度的亮相画面",
        ),
        3 => (
            "另一核心主体",
            "secondary_intro",
            "第3格切到另一位核心主体、阵营或关键对象，形成明显区分",
        ),
        4 => (
            "关系镜头",
            "relationship",
            "第4格展示多位主体之间的关系、对峙、协作或队形变化",
        ),
        5 => (
            "行动推进",
            "action",
            "第5格进入明确动作或事件推进，不要重复前面的静态构图",
        ),
        6 => (
            "情绪特写",
            "close_up",
            "第6格给出情绪、反应或心理张力的近景或特写",
        ),
        7 => (
            "环境细节",
            "detail",
            "第7格切到关键环境、道具、符号或世界细节，补足叙事信息",
        ),
        8 => (
            "高潮转折",
            "climax",
            "第8格表现冲突升级、关键转折或最强张力时刻",
        ),
        9 => (
            "收束定格",
            "finale",
            "第9格作为收束画面，形成完整结尾或海报式定格",
        ),
        _ => (
            "补充镜头",
            "supplementary",
            "这一格补充新的主体、动作、关系或环境信息，继续推进叙事，不要重复已有镜头",
        ),
    }
}

fn build_storyboard_fallback_slots(prompt: &str, count: u32) -> Vec<PreparedImageTaskSlot> {
    (1..=count)
        .map(|slot_index| {
            let (label, shot_type, directive) = storyboard_fallback_beat(slot_index);
            PreparedImageTaskSlot {
                slot_index,
                slot_id: build_default_image_task_slot_id(
                    Some(STORYBOARD_3X3_LAYOUT_HINT),
                    slot_index,
                ),
                label: Some(label.to_string()),
                prompt: format!(
                    "{prompt}。{directive}。保持与其他格明显区分，避免重复同一群像、同一构图或只换画风。"
                ),
                shot_type: Some(shot_type.to_string()),
            }
        })
        .collect()
}

fn build_repeated_image_task_slots(
    prompt: &str,
    count: u32,
    layout_hint: Option<&str>,
) -> Vec<PreparedImageTaskSlot> {
    (1..=count)
        .map(|slot_index| PreparedImageTaskSlot {
            slot_index,
            slot_id: build_default_image_task_slot_id(layout_hint, slot_index),
            label: None,
            prompt: prompt.to_string(),
            shot_type: None,
        })
        .collect()
}

fn read_storyboard_slots(payload: &Value, layout_hint: Option<&str>) -> Vec<PreparedImageTaskSlot> {
    payload
        .get("storyboard_slots")
        .or_else(|| payload.get("storyboardSlots"))
        .and_then(Value::as_array)
        .map(|items| {
            let mut slots = items
                .iter()
                .enumerate()
                .filter_map(|(index, item)| {
                    let record = item.as_object()?;
                    let slot_index = record
                        .get("slot_index")
                        .or_else(|| record.get("slotIndex"))
                        .and_then(read_positive_u32_from_value)
                        .unwrap_or(index as u32 + 1);
                    let prompt = read_storyboard_slot_text(
                        record,
                        &["prompt", "slot_prompt", "slotPrompt"],
                    )?;

                    Some(PreparedImageTaskSlot {
                        slot_index,
                        slot_id: read_storyboard_slot_text(record, &["slot_id", "slotId"])
                            .unwrap_or_else(|| {
                                build_default_image_task_slot_id(layout_hint, slot_index)
                            }),
                        label: read_storyboard_slot_text(
                            record,
                            &["label", "slot_label", "slotLabel"],
                        ),
                        prompt,
                        shot_type: read_storyboard_slot_text(record, &["shot_type", "shotType"]),
                    })
                })
                .collect::<Vec<_>>();
            slots.sort_by_key(|slot| slot.slot_index);
            slots.dedup_by_key(|slot| slot.slot_index);
            slots
        })
        .unwrap_or_default()
}

fn build_request_slots(
    prompt: &str,
    count: u32,
    layout_hint: Option<&str>,
    explicit_slots: Vec<PreparedImageTaskSlot>,
) -> Vec<PreparedImageTaskSlot> {
    let mut slots = explicit_slots;
    if slots.is_empty() {
        return if layout_hint == Some(STORYBOARD_3X3_LAYOUT_HINT) {
            build_storyboard_fallback_slots(prompt, count)
        } else {
            build_repeated_image_task_slots(prompt, count, layout_hint)
        };
    }

    let supplemental = if layout_hint == Some(STORYBOARD_3X3_LAYOUT_HINT) {
        build_storyboard_fallback_slots(prompt, count)
    } else {
        build_repeated_image_task_slots(prompt, count, layout_hint)
    };
    for slot in supplemental {
        if slots
            .iter()
            .any(|existing| existing.slot_index == slot.slot_index)
        {
            continue;
        }
        slots.push(slot);
        if slots.len() >= count as usize {
            break;
        }
    }

    slots.sort_by_key(|slot| slot.slot_index);
    slots.truncate(count as usize);
    slots
}

fn prepare_image_task_input(task: &MediaTaskOutput) -> Result<PreparedImageTaskInput, String> {
    let payload = &task.record.payload;
    let prompt = read_payload_string(payload, &["prompt"])
        .ok_or_else(|| "图片任务缺少 prompt，无法继续执行".to_string())?;
    let layout_hint = read_payload_string(payload, &["layout_hint", "layoutHint"]);
    let explicit_slots = read_storyboard_slots(payload, layout_hint.as_deref());
    let requested_count =
        read_payload_positive_u32(payload, &["count", "image_count"]).unwrap_or(1);
    let max_slot_index = explicit_slots
        .iter()
        .map(|slot| slot.slot_index)
        .max()
        .unwrap_or(0);
    let count = requested_count
        .max(explicit_slots.len() as u32)
        .max(max_slot_index)
        .max(1);
    let postprocess_plan = read_layered_design_chroma_key_postprocess_plan(payload);
    let request_slots: Vec<PreparedImageTaskSlot> =
        build_request_slots(&prompt, count, layout_hint.as_deref(), explicit_slots)
            .into_iter()
            .map(|mut slot| {
                slot.prompt =
                    apply_image_postprocess_prompt_hint(&slot.prompt, postprocess_plan.as_ref());
                slot
            })
            .collect();

    Ok(PreparedImageTaskInput {
        prompt,
        model: read_payload_string(payload, &["model"]).unwrap_or_default(),
        size: read_payload_string(payload, &["size"]),
        count: request_slots.len() as u32,
        style: read_payload_string(payload, &["style"]),
        provider_id: read_payload_string(payload, &["provider_id", "providerId"]),
        executor_mode: normalize_image_generation_executor_mode(read_payload_string(
            payload,
            &["executor_mode", "executorMode"],
        )),
        outer_model: read_payload_string(payload, &["outer_model", "outerModel"]),
        layout_hint,
        postprocess_plan,
        request_slots,
    })
}

fn collect_generated_images(response_body: &Value) -> Vec<Value> {
    response_body
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let record = item.as_object()?;
                    let url = record
                        .get("url")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned)
                        .or_else(|| {
                            record
                                .get("b64_json")
                                .and_then(Value::as_str)
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(|value| format!("data:image/png;base64,{value}"))
                        })?;
                    Some(json!({
                        "url": url,
                        "revised_prompt": record
                            .get("revised_prompt")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty()),
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn build_responses_image_generation_tool(model: &str) -> Value {
    let mut tool = Map::new();
    tool.insert("type".to_string(), json!("image_generation"));
    let trimmed_model = model.trim();
    if !trimmed_model.is_empty() {
        tool.insert("model".to_string(), json!(trimmed_model));
    }
    Value::Object(tool)
}

fn build_responses_image_generation_input(prompt: &str, use_input_list: bool) -> Value {
    if use_input_list {
        return json!([
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt,
                    }
                ],
            }
        ]);
    }

    json!(prompt)
}

fn build_responses_image_generation_request_body(
    prepared_input: &PreparedImageTaskInput,
    request_prompt: &str,
    use_input_list: bool,
) -> Value {
    json!({
        "model": prepared_input
            .outer_model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_RESPONSES_IMAGE_GENERATION_OUTER_MODEL),
        "input": build_responses_image_generation_input(request_prompt, use_input_list),
        "tools": [build_responses_image_generation_tool(&prepared_input.model)],
        "stream": true,
    })
}

fn build_responses_image_generation_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    let (base, query) = trimmed
        .split_once('?')
        .map(|(left, right)| (left, Some(right)))
        .unwrap_or((trimmed, None));
    let responses_base = if base.ends_with("/v1/images/generations") {
        format!(
            "{}/v1/responses",
            base.trim_end_matches("/v1/images/generations")
        )
    } else if base.ends_with("/images/generations") {
        format!("{}/responses", base.trim_end_matches("/images/generations"))
    } else if base.ends_with("/v1") {
        format!("{base}/responses")
    } else if base.ends_with("/responses") || base.ends_with("/v1/responses") {
        base.to_string()
    } else {
        format!("{base}/responses")
    };

    match query {
        Some(value) if !value.is_empty() => format!("{responses_base}?{value}"),
        _ => responses_base,
    }
}

fn should_retry_responses_image_generation_with_input_list(status: u16, body: &str) -> bool {
    status == 400 && body.to_ascii_lowercase().contains("input must be a list")
}

fn parse_sse_event(raw_event: &str) -> Option<(String, String)> {
    let mut event_name = String::new();
    let mut data_lines = Vec::new();

    for line in raw_event.lines() {
        let trimmed = line.trim_end_matches('\r');
        if let Some(rest) = trimmed.strip_prefix("event:") {
            event_name = rest.trim().to_string();
        } else if let Some(rest) = trimmed.strip_prefix("data:") {
            data_lines.push(rest.trim_start().to_string());
        }
    }

    if event_name.is_empty() || data_lines.is_empty() {
        return None;
    }

    Some((event_name, data_lines.join("\n")))
}

fn extract_responses_image_generation_result(
    response_body_raw: &str,
) -> Result<(Value, Value), TaskErrorRecord> {
    let mut event_count = 0u32;
    let mut output_item_count = 0u32;

    for raw_event in response_body_raw.split("\n\n") {
        let Some((event_name, data_text)) = parse_sse_event(raw_event) else {
            continue;
        };
        event_count += 1;
        if data_text.trim() == "[DONE]" {
            continue;
        }
        if event_name != "response.output_item.done" {
            continue;
        }

        let parsed: Value = match serde_json::from_str(&data_text) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Some(item) = parsed.get("item").and_then(Value::as_object) else {
            continue;
        };
        output_item_count += 1;
        if item.get("type").and_then(Value::as_str) != Some("image_generation_call") {
            continue;
        }
        let image_item_id = item
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let Some(result) = item
            .get("result")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        return Ok((
            json!({
                "url": format!("data:image/png;base64,{result}"),
                "revised_prompt": item
                    .get("revised_prompt")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty()),
                "source": IMAGE_EXECUTOR_MODE_RESPONSES_IMAGE_GENERATION,
            }),
            json!({
                "executor_mode": IMAGE_EXECUTOR_MODE_RESPONSES_IMAGE_GENERATION,
                "event_count": event_count,
                "output_item_count": output_item_count,
                "image_item_id": image_item_id,
            }),
        ));
    }

    Err(build_image_task_error(
        "image_result_empty",
        "Responses 图片生成已返回成功，但 SSE 流里没有 image_generation_call.result",
        false,
        "result",
    ))
}

fn summarize_response_body(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "响应体为空".to_string();
    }

    let preview: String = trimmed.chars().take(240).collect();
    if trimmed.chars().count() > preview.chars().count() {
        format!("{preview}...")
    } else {
        preview
    }
}

fn build_image_task_progress(phase: &str, message: String, percent: Option<u32>) -> TaskProgress {
    build_image_task_progress_with_preview(phase, message, percent, Vec::new())
}

fn build_image_task_progress_with_preview(
    phase: &str,
    message: String,
    percent: Option<u32>,
    preview_slots: Vec<TaskPreviewSlot>,
) -> TaskProgress {
    TaskProgress {
        phase: Some(phase.to_string()),
        percent,
        message: Some(message),
        preview_slots,
    }
}

fn build_image_task_error(
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
        occurred_at: Some(Utc::now().to_rfc3339()),
    }
}

fn build_image_generation_request_body(
    prepared_input: &PreparedImageTaskInput,
    request_prompt: &str,
    request_count: u32,
    task_id: &str,
) -> Value {
    json!({
        "prompt": request_prompt,
        "model": prepared_input.model.clone(),
        "n": request_count.max(1),
        "size": prepared_input.size.clone(),
        "response_format": "b64_json",
        "quality": Value::Null,
        "style": prepared_input.style.clone(),
        "user": task_id,
    })
}

async fn request_single_image_generation(
    client: &reqwest::Client,
    runner_config: &ImageGenerationRunnerConfig,
    prepared_input: &PreparedImageTaskInput,
    request_prompt: &str,
    task_id: &str,
) -> Result<(Value, Value), TaskErrorRecord> {
    let request_body =
        build_image_generation_request_body(prepared_input, request_prompt, 1, task_id);

    let mut request_builder = client
        .post(&runner_config.endpoint)
        .header("Authorization", format!("Bearer {}", runner_config.api_key));
    if let Some(provider_id) = prepared_input
        .provider_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request_builder = request_builder.header("X-Provider-Id", provider_id);
    }

    let response = request_builder
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            build_image_task_error(
                "image_request_failed",
                format!("调用图片服务失败: {error}"),
                true,
                "request",
            )
        })?;

    let status = response.status();
    let response_body_raw = response.text().await.map_err(|error| {
        build_image_task_error(
            "image_response_read_failed",
            format!("读取图片服务响应失败: {error}"),
            false,
            "response",
        )
    })?;
    let response_body: Value = serde_json::from_str(&response_body_raw).map_err(|error| {
        let detail = summarize_response_body(&response_body_raw);
        build_image_task_error(
            "image_response_parse_failed",
            format!("解析图片服务响应失败: {error}；{detail}"),
            false,
            "response",
        )
    })?;

    if !status.is_success() {
        let error_code = response_body
            .get("error")
            .and_then(|value| value.get("code"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("image_generation_failed");
        let error_message = response_body
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("图片服务未返回可用结果");
        return Err(build_image_task_error(
            error_code,
            error_message,
            status.is_server_error() || status.as_u16() == 429,
            "request",
        ));
    }

    let image = collect_generated_images(&response_body).into_iter().next();
    let Some(image) = image else {
        return Err(build_image_task_error(
            "image_result_empty",
            "图片服务已返回成功，但没有可用的图片地址",
            false,
            "result",
        ));
    };

    Ok((image, response_body))
}

async fn send_responses_image_generation_request(
    client: &reqwest::Client,
    runner_config: &ImageGenerationRunnerConfig,
    prepared_input: &PreparedImageTaskInput,
    request_prompt: &str,
    use_input_list: bool,
) -> Result<(u16, String), TaskErrorRecord> {
    let request_body = build_responses_image_generation_request_body(
        prepared_input,
        request_prompt,
        use_input_list,
    );
    let endpoint = build_responses_image_generation_endpoint(&runner_config.endpoint);
    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", runner_config.api_key))
        .header("Accept", "text/event-stream")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            build_image_task_error(
                "image_request_failed",
                format!("调用 Responses 图片服务失败: {error}"),
                true,
                "request",
            )
        })?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|error| {
        build_image_task_error(
            "image_response_read_failed",
            format!("读取 Responses 图片服务响应失败: {error}"),
            false,
            "response",
        )
    })?;

    Ok((status, body))
}

async fn request_single_responses_image_generation(
    client: &reqwest::Client,
    runner_config: &ImageGenerationRunnerConfig,
    prepared_input: &PreparedImageTaskInput,
    request_prompt: &str,
) -> Result<(Value, Value), TaskErrorRecord> {
    let (mut status, mut response_body_raw) = send_responses_image_generation_request(
        client,
        runner_config,
        prepared_input,
        request_prompt,
        false,
    )
    .await?;

    if should_retry_responses_image_generation_with_input_list(status, &response_body_raw) {
        let retry = send_responses_image_generation_request(
            client,
            runner_config,
            prepared_input,
            request_prompt,
            true,
        )
        .await?;
        status = retry.0;
        response_body_raw = retry.1;
    }

    if !(200..300).contains(&status) {
        let error_body: Value = serde_json::from_str(&response_body_raw).unwrap_or_else(|_| {
            json!({
                "error": {
                    "code": "responses_image_generation_failed",
                    "message": summarize_response_body(&response_body_raw),
                }
            })
        });
        let error_code = error_body
            .get("error")
            .and_then(|value| value.get("code"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("responses_image_generation_failed");
        let error_message = error_body
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Responses 图片服务未返回可用结果");
        return Err(build_image_task_error(
            error_code,
            error_message,
            status >= 500 || status == 429,
            "request",
        ));
    }

    extract_responses_image_generation_result(&response_body_raw)
}

async fn request_single_image_generation_for_executor(
    client: &reqwest::Client,
    runner_config: &ImageGenerationRunnerConfig,
    prepared_input: &PreparedImageTaskInput,
    request_prompt: &str,
    task_id: &str,
) -> Result<(Value, Value), TaskErrorRecord> {
    if is_responses_image_generation_executor(&prepared_input.executor_mode) {
        return request_single_responses_image_generation(
            client,
            runner_config,
            prepared_input,
            request_prompt,
        )
        .await;
    }

    request_single_image_generation(
        client,
        runner_config,
        prepared_input,
        request_prompt,
        task_id,
    )
    .await
}

fn parse_hex_rgb(value: &str) -> Option<[u8; 3]> {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() == 3 {
        let mut color = [0u8; 3];
        for (index, item) in hex.as_bytes().iter().enumerate() {
            let digit = (*item as char).to_digit(16)? as u8;
            color[index] = digit * 17;
        }
        return Some(color);
    }

    if hex.len() != 6 {
        return None;
    }

    Some([
        u8::from_str_radix(&hex[0..2], 16).ok()?,
        u8::from_str_radix(&hex[2..4], 16).ok()?,
        u8::from_str_radix(&hex[4..6], 16).ok()?,
    ])
}

fn decode_png_data_url_bytes(image_url: &str) -> Result<Option<Vec<u8>>, String> {
    let trimmed = image_url.trim();
    let Some((header, payload)) = trimmed.split_once(',') else {
        return Ok(None);
    };
    let header = header.trim().to_ascii_lowercase();
    if !header.starts_with("data:") {
        return Ok(None);
    }
    if !header.starts_with("data:image/png")
        || !header.split(';').any(|part| part.trim() == "base64")
    {
        return Ok(None);
    }

    BASE64_STANDARD
        .decode(payload.trim())
        .map(Some)
        .map_err(|error| format!("无法解码 PNG data URL: {error}"))
}

fn encode_png_data_url(bytes: &[u8]) -> String {
    format!(
        "data:{PNG_DATA_URL_MIME};base64,{}",
        BASE64_STANDARD.encode(bytes)
    )
}

fn apply_chroma_key_postprocess_to_png_bytes(
    source_bytes: &[u8],
    plan: &PreparedImageTaskPostprocessPlan,
    input_source: &'static str,
) -> ImagePostprocessOutcome {
    let Some(chroma_key) = parse_hex_rgb(&plan.chroma_key_color) else {
        return ImagePostprocessOutcome::failed(format!(
            "无效 chroma-key 颜色: {}",
            plan.chroma_key_color
        ));
    };

    let decoded = match image::load_from_memory_with_format(source_bytes, ImageFormat::Png) {
        Ok(decoded) => decoded,
        Err(error) => {
            return ImagePostprocessOutcome::failed(format!("无法读取 PNG 像素: {error}"));
        }
    };

    let mut rgba = decoded.to_rgba8();
    let (width, height) = rgba.dimensions();
    let threshold_squared =
        i32::from(CHROMA_KEY_DISTANCE_THRESHOLD) * i32::from(CHROMA_KEY_DISTANCE_THRESHOLD);
    let mut removed_pixel_count = 0u64;
    for pixel in rgba.pixels_mut() {
        let red_delta = i16::from(pixel[0]) - i16::from(chroma_key[0]);
        let green_delta = i16::from(pixel[1]) - i16::from(chroma_key[1]);
        let blue_delta = i16::from(pixel[2]) - i16::from(chroma_key[2]);
        let distance_squared = i32::from(red_delta) * i32::from(red_delta)
            + i32::from(green_delta) * i32::from(green_delta)
            + i32::from(blue_delta) * i32::from(blue_delta);
        if distance_squared <= threshold_squared {
            pixel[3] = 0;
            removed_pixel_count += 1;
        }
    }

    let mut output_bytes = Vec::new();
    let encoder = PngEncoder::new(&mut output_bytes);
    if let Err(error) = encoder.write_image(rgba.as_raw(), width, height, ColorType::Rgba8.into()) {
        return ImagePostprocessOutcome::failed(format!("无法写出透明 PNG: {error}"));
    }

    ImagePostprocessOutcome::succeeded(
        encode_png_data_url(&output_bytes),
        removed_pixel_count,
        u64::from(width) * u64::from(height),
        input_source,
    )
}

#[cfg(test)]
fn apply_chroma_key_postprocess_to_data_url(
    image_url: &str,
    plan: &PreparedImageTaskPostprocessPlan,
) -> ImagePostprocessOutcome {
    match decode_png_data_url_bytes(image_url) {
        Ok(Some(bytes)) => apply_chroma_key_postprocess_to_png_bytes(&bytes, plan, "data_url"),
        Ok(None) => ImagePostprocessOutcome::skipped("当前源图不是 PNG data URL"),
        Err(message) => ImagePostprocessOutcome::failed(message),
    }
}

async fn download_remote_image_bytes_for_postprocess(
    client: &reqwest::Client,
    image_url: &str,
) -> Result<Vec<u8>, ImagePostprocessOutcome> {
    let parsed_url = reqwest::Url::parse(image_url)
        .map_err(|_| ImagePostprocessOutcome::skipped("当前源图不是可下载的 http/https URL"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err(ImagePostprocessOutcome::skipped(
            "当前仅支持 http/https 远程图片后处理",
        ));
    }

    let response =
        client.get(parsed_url).send().await.map_err(|error| {
            ImagePostprocessOutcome::failed(format!("下载远程图片失败: {error}"))
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(ImagePostprocessOutcome::failed(format!(
            "下载远程图片返回非成功状态: {status}"
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > IMAGE_TASK_POSTPROCESS_MAX_IMAGE_BYTES)
    {
        return Err(ImagePostprocessOutcome::failed(format!(
            "远程图片超过后处理大小上限: {} bytes",
            IMAGE_TASK_POSTPROCESS_MAX_IMAGE_BYTES
        )));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| ImagePostprocessOutcome::failed(format!("读取远程图片失败: {error}")))?;
    if bytes.len() as u64 > IMAGE_TASK_POSTPROCESS_MAX_IMAGE_BYTES {
        return Err(ImagePostprocessOutcome::failed(format!(
            "远程图片超过后处理大小上限: {} bytes",
            IMAGE_TASK_POSTPROCESS_MAX_IMAGE_BYTES
        )));
    }

    Ok(bytes.to_vec())
}

async fn apply_chroma_key_postprocess_to_image_url(
    client: &reqwest::Client,
    image_url: &str,
    plan: &PreparedImageTaskPostprocessPlan,
) -> ImagePostprocessOutcome {
    match decode_png_data_url_bytes(image_url) {
        Ok(Some(bytes)) => {
            return apply_chroma_key_postprocess_to_png_bytes(&bytes, plan, "data_url");
        }
        Err(message) => return ImagePostprocessOutcome::failed(message),
        Ok(None) => {}
    }

    match download_remote_image_bytes_for_postprocess(client, image_url).await {
        Ok(bytes) => apply_chroma_key_postprocess_to_png_bytes(&bytes, plan, "remote_url"),
        Err(outcome) => outcome,
    }
}

fn build_image_task_result_value(
    prepared_input: &PreparedImageTaskInput,
    requested_count: u32,
    images: &[Value],
    responses: &[Value],
    failures: &[Value],
) -> Value {
    json!({
        "prompt": prepared_input.prompt,
        "provider_id": prepared_input.provider_id,
        "executor_mode": prepared_input.executor_mode,
        "outer_model": prepared_input.outer_model,
        "model": if prepared_input.model.trim().is_empty() {
            None::<String>
        } else {
            Some(prepared_input.model.clone())
        },
        "size": prepared_input.size,
        "count": prepared_input.count,
        "layout_hint": prepared_input.layout_hint,
        "requested_count": requested_count,
        "received_count": images.len(),
        "images": images,
        "response": responses.first().cloned(),
        "responses": responses,
        "failures": failures,
        "postprocess": prepared_input
            .postprocess_plan
            .as_ref()
            .map(|plan| build_image_result_postprocess_value(plan, requested_count, images)),
        "storyboard_slots": prepared_input
            .request_slots
            .iter()
            .map(|slot| {
                json!({
                    "slot_index": slot.slot_index,
                    "slot_id": slot.slot_id,
                    "label": slot.label,
                    "prompt": slot.prompt,
                    "shot_type": slot.shot_type,
                })
            })
            .collect::<Vec<_>>(),
    })
}

fn build_image_postprocess_record(
    plan: &PreparedImageTaskPostprocessPlan,
    status: &str,
) -> Map<String, Value> {
    let mut record = Map::new();
    record.insert("strategy".to_string(), json!(plan.strategy));
    record.insert("status".to_string(), json!(status));
    record.insert("chroma_key_color".to_string(), json!(plan.chroma_key_color));
    record.insert("postprocess_required".to_string(), json!(true));
    record.insert(
        "source".to_string(),
        json!("runtime_contract.layered_design.alpha"),
    );
    record.insert("document_id".to_string(), json!(plan.document_id));
    record.insert("layer_id".to_string(), json!(plan.layer_id));
    record.insert("asset_id".to_string(), json!(plan.asset_id));
    record
}

fn build_image_postprocess_value(
    plan: &PreparedImageTaskPostprocessPlan,
    outcome: Option<&ImagePostprocessOutcome>,
) -> Value {
    let mut record = build_image_postprocess_record(
        plan,
        outcome
            .map(|item| item.status)
            .unwrap_or("pending_chroma_key_processor"),
    );
    if let Some(outcome) = outcome {
        if let Some(reason) = outcome.reason.as_ref() {
            record.insert("reason".to_string(), json!(reason));
        }
        if let Some(removed_pixel_count) = outcome.removed_pixel_count {
            record.insert(
                "removed_pixel_count".to_string(),
                json!(removed_pixel_count),
            );
        }
        if let Some(total_pixel_count) = outcome.total_pixel_count {
            record.insert("total_pixel_count".to_string(), json!(total_pixel_count));
        }
        if let Some(output_mime) = outcome.output_mime {
            record.insert("output_mime".to_string(), json!(output_mime));
            record.insert(
                "transparent".to_string(),
                json!(outcome.status == "succeeded"),
            );
        }
        if let Some(input_source) = outcome.input_source {
            record.insert("input_source".to_string(), json!(input_source));
        }
    }
    Value::Object(record)
}

fn read_postprocess_u64(record: &Map<String, Value>, key: &str) -> u64 {
    record.get(key).and_then(Value::as_u64).unwrap_or_default()
}

fn build_image_result_postprocess_value(
    plan: &PreparedImageTaskPostprocessPlan,
    requested_count: u32,
    images: &[Value],
) -> Value {
    let mut succeeded_count = 0u64;
    let mut skipped_count = 0u64;
    let mut failed_count = 0u64;
    let mut removed_pixel_count = 0u64;
    let mut total_pixel_count = 0u64;

    for postprocess in images
        .iter()
        .filter_map(|image| image.get("postprocess").and_then(Value::as_object))
    {
        match postprocess.get("status").and_then(Value::as_str) {
            Some("succeeded") => succeeded_count += 1,
            Some("skipped_unsupported_source") => skipped_count += 1,
            Some("failed") => failed_count += 1,
            _ => {}
        }
        removed_pixel_count += read_postprocess_u64(postprocess, "removed_pixel_count");
        total_pixel_count += read_postprocess_u64(postprocess, "total_pixel_count");
    }

    let processed_count = succeeded_count + skipped_count + failed_count;
    let status = if processed_count == 0 {
        "pending_chroma_key_processor"
    } else if failed_count > 0 && succeeded_count == 0 && skipped_count == 0 {
        "failed"
    } else if failed_count > 0 {
        "completed_with_postprocess_warnings"
    } else if skipped_count > 0 && succeeded_count == 0 {
        "skipped_unsupported_source"
    } else if skipped_count > 0 {
        "completed_with_skips"
    } else {
        "succeeded"
    };

    let mut record = build_image_postprocess_record(plan, status);
    record.insert("requested_count".to_string(), json!(requested_count));
    record.insert("processed_count".to_string(), json!(processed_count));
    record.insert("succeeded_count".to_string(), json!(succeeded_count));
    record.insert("skipped_count".to_string(), json!(skipped_count));
    record.insert("failed_count".to_string(), json!(failed_count));
    if removed_pixel_count > 0 || total_pixel_count > 0 {
        record.insert(
            "removed_pixel_count".to_string(),
            json!(removed_pixel_count),
        );
        record.insert("total_pixel_count".to_string(), json!(total_pixel_count));
        record.insert("output_mime".to_string(), json!(PNG_DATA_URL_MIME));
        record.insert("transparent".to_string(), json!(succeeded_count > 0));
    }
    Value::Object(record)
}

fn build_running_image_task_message(
    requested_count: usize,
    success_count: usize,
    failed_count: usize,
) -> String {
    if failed_count == 0 {
        return format!("图片生成中，已返回 {success_count}/{requested_count} 张。");
    }

    format!("图片生成中，已返回 {success_count}/{requested_count} 张，另有 {failed_count} 张失败。")
}

#[cfg(test)]
fn infer_sync_image_postprocess_outcome(
    image: &Value,
    plan: &PreparedImageTaskPostprocessPlan,
) -> ImagePostprocessOutcome {
    image
        .get("url")
        .and_then(Value::as_str)
        .map(|image_url| apply_chroma_key_postprocess_to_data_url(image_url, plan))
        .unwrap_or_else(|| ImagePostprocessOutcome::failed("图片结果缺少 url，无法后处理"))
}

async fn infer_image_postprocess_outcome(
    client: &reqwest::Client,
    image: &Value,
    plan: &PreparedImageTaskPostprocessPlan,
) -> ImagePostprocessOutcome {
    let Some(image_url) = image.get("url").and_then(Value::as_str) else {
        return ImagePostprocessOutcome::failed("图片结果缺少 url，无法后处理");
    };

    apply_chroma_key_postprocess_to_image_url(client, image_url, plan).await
}

#[cfg(test)]
fn decorate_generated_image_with_slot(
    image: Value,
    slot: &PreparedImageTaskSlot,
    postprocess_plan: Option<&PreparedImageTaskPostprocessPlan>,
) -> Value {
    let postprocess_outcome = postprocess_plan.map(|plan| match &image {
        Value::Object(_) => infer_sync_image_postprocess_outcome(&image, plan),
        _ => ImagePostprocessOutcome::failed("图片结果不是对象，无法读取 url 后处理"),
    });

    decorate_generated_image_with_slot_with_postprocess_outcome(
        image,
        slot,
        postprocess_plan,
        postprocess_outcome.as_ref(),
    )
}

fn decorate_generated_image_with_slot_with_postprocess_outcome(
    image: Value,
    slot: &PreparedImageTaskSlot,
    postprocess_plan: Option<&PreparedImageTaskPostprocessPlan>,
    postprocess_outcome: Option<&ImagePostprocessOutcome>,
) -> Value {
    match image {
        Value::Object(mut record) => {
            record.insert("slot_index".to_string(), json!(slot.slot_index));
            record.insert("slot_id".to_string(), json!(slot.slot_id));
            record.insert("slot_prompt".to_string(), json!(slot.prompt));
            if let Some(label) = slot.label.as_ref() {
                record.insert("slot_label".to_string(), json!(label));
            }
            if let Some(shot_type) = slot.shot_type.as_ref() {
                record.insert("shot_type".to_string(), json!(shot_type));
            }
            if let Some(plan) = postprocess_plan {
                if let Some(output_url) =
                    postprocess_outcome.and_then(|outcome| outcome.output_url.as_ref())
                {
                    record.insert("url".to_string(), json!(output_url));
                }
                record.insert(
                    "postprocess".to_string(),
                    build_image_postprocess_value(plan, postprocess_outcome),
                );
            }
            Value::Object(record)
        }
        other => {
            json!({
                "slot_index": slot.slot_index,
                "slot_id": slot.slot_id,
                "slot_label": slot.label,
                "slot_prompt": slot.prompt,
                "shot_type": slot.shot_type,
                "postprocess": postprocess_plan
                    .map(|plan| build_image_postprocess_value(plan, postprocess_outcome)),
                "image": other,
            })
        }
    }
}

fn decorate_response_with_slot(response: Value, slot: &PreparedImageTaskSlot) -> Value {
    match response {
        Value::Object(mut record) => {
            record.insert("slot_index".to_string(), json!(slot.slot_index));
            record.insert("slot_id".to_string(), json!(slot.slot_id));
            if let Some(label) = slot.label.as_ref() {
                record.insert("slot_label".to_string(), json!(label));
            }
            record.insert("slot_prompt".to_string(), json!(slot.prompt));
            if let Some(shot_type) = slot.shot_type.as_ref() {
                record.insert("shot_type".to_string(), json!(shot_type));
            }
            Value::Object(record)
        }
        other => json!({
            "slot_index": slot.slot_index,
            "slot_id": slot.slot_id,
            "slot_label": slot.label,
            "slot_prompt": slot.prompt,
            "shot_type": slot.shot_type,
            "response": other,
        }),
    }
}

fn build_failed_slot_value(slot: &PreparedImageTaskSlot, error: TaskErrorRecord) -> Value {
    json!({
        "slot_index": slot.slot_index,
        "slot_id": slot.slot_id,
        "slot_label": slot.label,
        "slot_prompt": slot.prompt,
        "shot_type": slot.shot_type,
        "error": error,
    })
}

fn flatten_task_slot_values(values: &[Option<Value>]) -> Vec<Value> {
    values.iter().filter_map(|value| value.clone()).collect()
}

fn build_preview_slots(
    request_slots: &[PreparedImageTaskSlot],
    slot_statuses: &[String],
) -> Vec<TaskPreviewSlot> {
    request_slots
        .iter()
        .enumerate()
        .map(|(index, slot)| TaskPreviewSlot {
            slot_id: slot.slot_id.clone(),
            slot_index: Some(slot.slot_index),
            label: slot.label.clone(),
            prompt: Some(slot.prompt.clone()),
            shot_type: slot.shot_type.clone(),
            status: slot_statuses
                .get(index)
                .cloned()
                .unwrap_or_else(|| "queued".to_string()),
        })
        .collect()
}

fn load_current_image_task(
    workspace_root: &Path,
    task_id: &str,
) -> Result<MediaTaskOutput, MediaRuntimeError> {
    load_task_output(workspace_root, task_id, None)
}

fn patch_image_task(
    workspace_root: &Path,
    task_id: &str,
    patch: TaskArtifactPatch,
) -> Result<MediaTaskOutput, MediaRuntimeError> {
    patch_task_artifact(workspace_root, task_id, None, patch)
}

fn mark_image_task_failed<F>(
    workspace_root: &Path,
    task_id: &str,
    error: TaskErrorRecord,
    on_update: &mut F,
) -> Result<MediaTaskOutput, MediaRuntimeError>
where
    F: FnMut(&MediaTaskOutput),
{
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
            progress: Some(build_image_task_progress(
                "failed",
                error.message.clone(),
                None,
            )),
            current_attempt_worker_id: Some(Some(IMAGE_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    on_update(&output);
    Ok(output)
}

pub async fn execute_image_generation_task(
    workspace_root: &Path,
    task_id: &str,
    runner_config: &ImageGenerationRunnerConfig,
) -> Result<MediaTaskOutput, MediaRuntimeError> {
    execute_image_generation_task_with_hook(workspace_root, task_id, runner_config, |_| {}).await
}

pub async fn execute_image_generation_task_with_hook<F>(
    workspace_root: &Path,
    task_id: &str,
    runner_config: &ImageGenerationRunnerConfig,
    mut on_update: F,
) -> Result<MediaTaskOutput, MediaRuntimeError>
where
    F: FnMut(&MediaTaskOutput) + Send,
{
    let current = load_current_image_task(workspace_root, task_id)?;
    if matches!(
        current.normalized_status.as_str(),
        "cancelled" | "failed" | "succeeded" | "partial"
    ) {
        return Ok(current);
    }

    let queued_output = if current.normalized_status == "pending" {
        let output = patch_image_task(
            workspace_root,
            task_id,
            TaskArtifactPatch {
                status: Some("queued".to_string()),
                progress: Some(build_image_task_progress(
                    "queued",
                    "图片任务已进入队列，等待图片服务响应。".to_string(),
                    Some(0),
                )),
                current_attempt_worker_id: Some(Some(IMAGE_TASK_RUNNER_WORKER_ID.to_string())),
                ..TaskArtifactPatch::default()
            },
        )?;
        on_update(&output);
        output
    } else {
        current
    };

    if queued_output.normalized_status == "cancelled" {
        return Ok(queued_output);
    }

    let prepared_input = match prepare_image_task_input(&queued_output) {
        Ok(prepared_input) => prepared_input,
        Err(message) => {
            let task_error =
                build_image_task_error("invalid_image_task_payload", message, false, "payload");
            return mark_image_task_failed(workspace_root, task_id, task_error, &mut on_update);
        }
    };

    let running_output = patch_image_task(
        workspace_root,
        task_id,
        TaskArtifactPatch {
            status: Some("running".to_string()),
            progress: Some(build_image_task_progress_with_preview(
                "running",
                "图片生成中，结果会自动回填到对话与画布。".to_string(),
                None,
                build_preview_slots(
                    &prepared_input.request_slots,
                    &vec!["queued".to_string(); prepared_input.request_slots.len()],
                ),
            )),
            current_attempt_worker_id: Some(Some(IMAGE_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    on_update(&running_output);

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(IMAGE_TASK_RUNNER_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let requested_count = prepared_input.request_slots.len().max(1);
    let mut images: Vec<Option<Value>> = vec![None; requested_count];
    let mut responses: Vec<Option<Value>> = vec![None; requested_count];
    let mut failures: Vec<Option<Value>> = vec![None; requested_count];
    let mut slot_statuses = vec!["queued".to_string(); requested_count];
    let mut first_error: Option<TaskErrorRecord> = None;

    for batch_start in (0..requested_count).step_by(IMAGE_TASK_MAX_PARALLEL_REQUESTS) {
        let latest = load_current_image_task(workspace_root, task_id)?;
        if latest.normalized_status == "cancelled" {
            return Ok(latest);
        }

        let mut join_set = JoinSet::new();
        let batch_end = (batch_start + IMAGE_TASK_MAX_PARALLEL_REQUESTS).min(requested_count);
        for request_slot in prepared_input.request_slots[batch_start..batch_end]
            .iter()
            .cloned()
        {
            let client = client.clone();
            let runner_config = runner_config.clone();
            let prepared_input = prepared_input.clone();
            let task_id = task_id.to_string();
            join_set.spawn(async move {
                (
                    request_slot.clone(),
                    request_single_image_generation_for_executor(
                        &client,
                        &runner_config,
                        &prepared_input,
                        &request_slot.prompt,
                        &task_id,
                    )
                    .await,
                )
            });
        }

        let mut batch_saw_non_retryable_failure = false;
        while let Some(joined) = join_set.join_next().await {
            let (request_slot, result) = match joined {
                Ok(payload) => payload,
                Err(error) => {
                    let task_error = build_image_task_error(
                        "image_request_join_failed",
                        format!("等待图片服务任务失败: {error}"),
                        false,
                        "request",
                    );
                    let slot_index = batch_start;
                    if first_error.is_none() {
                        first_error = Some(task_error.clone());
                    }
                    if let Some(slot_status) = slot_statuses.get_mut(slot_index) {
                        *slot_status = "error".to_string();
                    }
                    failures[slot_index] = Some(json!({
                        "slot_index": slot_index + 1,
                        "error": task_error,
                    }));
                    let latest = load_current_image_task(workspace_root, task_id)?;
                    if latest.normalized_status == "cancelled" {
                        return Ok(latest);
                    }
                    let progress_message = build_running_image_task_message(
                        requested_count,
                        images.iter().filter(|value| value.is_some()).count(),
                        failures.iter().filter(|value| value.is_some()).count(),
                    );
                    let running_snapshot = patch_image_task(
                        workspace_root,
                        task_id,
                        TaskArtifactPatch {
                            result: Some(Some(build_image_task_result_value(
                                &prepared_input,
                                requested_count as u32,
                                &flatten_task_slot_values(&images),
                                &flatten_task_slot_values(&responses),
                                &flatten_task_slot_values(&failures),
                            ))),
                            progress: Some(build_image_task_progress_with_preview(
                                "running",
                                progress_message,
                                Some(
                                    (((images.iter().filter(|value| value.is_some()).count()
                                        + failures.iter().filter(|value| value.is_some()).count())
                                        * 100)
                                        / requested_count)
                                        as u32,
                                ),
                                build_preview_slots(&prepared_input.request_slots, &slot_statuses),
                            )),
                            current_attempt_worker_id: Some(Some(
                                IMAGE_TASK_RUNNER_WORKER_ID.to_string(),
                            )),
                            ..TaskArtifactPatch::default()
                        },
                    )?;
                    on_update(&running_snapshot);
                    continue;
                }
            };

            let slot_position = request_slot.slot_index.saturating_sub(1) as usize;
            match result {
                Ok((image, response_body)) => {
                    let postprocess_outcome =
                        if let Some(plan) = prepared_input.postprocess_plan.as_ref() {
                            Some(infer_image_postprocess_outcome(&client, &image, plan).await)
                        } else {
                            None
                        };
                    images[slot_position] =
                        Some(decorate_generated_image_with_slot_with_postprocess_outcome(
                            image,
                            &request_slot,
                            prepared_input.postprocess_plan.as_ref(),
                            postprocess_outcome.as_ref(),
                        ));
                    responses[slot_position] =
                        Some(decorate_response_with_slot(response_body, &request_slot));
                    slot_statuses[slot_position] = "complete".to_string();
                }
                Err(task_error) => {
                    batch_saw_non_retryable_failure |= !task_error.retryable;
                    if first_error.is_none() {
                        first_error = Some(task_error.clone());
                    }
                    slot_statuses[slot_position] = "error".to_string();
                    failures[slot_position] =
                        Some(build_failed_slot_value(&request_slot, task_error));
                }
            }

            let latest = load_current_image_task(workspace_root, task_id)?;
            if latest.normalized_status == "cancelled" {
                return Ok(latest);
            }

            let progress_message = build_running_image_task_message(
                requested_count,
                images.iter().filter(|value| value.is_some()).count(),
                failures.iter().filter(|value| value.is_some()).count(),
            );
            let running_snapshot = patch_image_task(
                workspace_root,
                task_id,
                TaskArtifactPatch {
                    result: Some(Some(build_image_task_result_value(
                        &prepared_input,
                        requested_count as u32,
                        &flatten_task_slot_values(&images),
                        &flatten_task_slot_values(&responses),
                        &flatten_task_slot_values(&failures),
                    ))),
                    progress: Some(build_image_task_progress_with_preview(
                        "running",
                        progress_message,
                        Some(
                            (((images.iter().filter(|value| value.is_some()).count()
                                + failures.iter().filter(|value| value.is_some()).count())
                                * 100)
                                / requested_count) as u32,
                        ),
                        build_preview_slots(&prepared_input.request_slots, &slot_statuses),
                    )),
                    current_attempt_worker_id: Some(Some(IMAGE_TASK_RUNNER_WORKER_ID.to_string())),
                    ..TaskArtifactPatch::default()
                },
            )?;
            on_update(&running_snapshot);
        }

        if batch_saw_non_retryable_failure && images.iter().all(|value| value.is_none()) {
            break;
        }
    }

    let completed_images = flatten_task_slot_values(&images);
    let completed_responses = flatten_task_slot_values(&responses);
    let failed_slots = flatten_task_slot_values(&failures);

    if completed_images.is_empty() {
        let task_error = first_error.unwrap_or_else(|| {
            build_image_task_error(
                "image_result_empty",
                "图片服务未返回可用结果",
                false,
                "result",
            )
        });
        return mark_image_task_failed(workspace_root, task_id, task_error, &mut on_update);
    }

    let latest = load_current_image_task(workspace_root, task_id)?;
    if latest.normalized_status == "cancelled" {
        return Ok(latest);
    }

    let final_status = if completed_images.len() < requested_count {
        "partial"
    } else {
        "succeeded"
    };
    let result_value = build_image_task_result_value(
        &prepared_input,
        requested_count as u32,
        &completed_images,
        &completed_responses,
        &failed_slots,
    );
    let success_message = if final_status == "partial" {
        format!(
            "图片任务已返回 {}/{} 张，另有 {} 张失败。",
            completed_images.len(),
            requested_count,
            failed_slots.len()
        )
    } else {
        format!("图片任务已完成，共生成 {} 张。", completed_images.len())
    };
    let completed = patch_image_task(
        workspace_root,
        task_id,
        TaskArtifactPatch {
            status: Some(final_status.to_string()),
            result: Some(Some(result_value)),
            last_error: Some(None),
            progress: Some(build_image_task_progress_with_preview(
                final_status,
                success_message,
                Some(100),
                build_preview_slots(&prepared_input.request_slots, &slot_statuses),
            )),
            current_attempt_worker_id: Some(Some(IMAGE_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    on_update(&completed);
    Ok(completed)
}

fn supports_idempotent_reuse(normalized_status: &str) -> bool {
    matches!(normalized_status, "pending" | "queued" | "running")
}

fn normalize_mutation_status(status: &str) -> Result<String, MediaRuntimeError> {
    let normalized = status.trim().to_ascii_lowercase();
    let resolved = match normalized.as_str() {
        "pending" | "pending_submit" => "pending_submit",
        "queued" => "queued",
        "running" => "running",
        "partial" => "partial",
        "succeeded" | "completed" | "success" => "succeeded",
        "failed" | "error" => "failed",
        "cancelled" | "canceled" => "cancelled",
        _ => {
            return Err(MediaRuntimeError::InvalidParams(format!(
                "不支持的任务状态: {status}"
            )));
        }
    };
    Ok(resolved.to_string())
}

fn record_sort_key(record: &TaskArtifactRecord) -> &str {
    record
        .updated_at
        .as_deref()
        .unwrap_or(record.created_at.as_str())
}

fn task_record_matches_filter(
    record: &TaskArtifactRecord,
    status_filter: Option<&str>,
    task_family_filter: Option<&str>,
    task_type_filter: Option<TaskType>,
) -> bool {
    if let Some(task_type) = task_type_filter {
        if record.task_type != task_type.as_str() {
            return false;
        }
    }

    if let Some(task_family_filter) = task_family_filter {
        if task_family_filter.trim().is_empty() {
            return false;
        }
        if !record
            .task_family
            .trim()
            .eq_ignore_ascii_case(task_family_filter.trim())
        {
            return false;
        }
    }

    if let Some(status_filter) = status_filter {
        let normalized_filter = normalize_status(status_filter);
        let normalized_record = record.normalized_status.clone();
        if normalized_filter != normalized_record
            && !status_filter
                .trim()
                .eq_ignore_ascii_case(record.status.trim())
        {
            return false;
        }
    }

    true
}

fn read_task_record(path: &Path) -> Result<TaskArtifactRecord, MediaRuntimeError> {
    let content = fs::read_to_string(path)
        .map_err(|error| MediaRuntimeError::Io(format!("读取任务文件失败: {error}")))?;
    serde_json::from_str::<TaskArtifactRecord>(&content)
        .map(canonicalize_task_record)
        .map_err(|error| MediaRuntimeError::Io(format!("解析任务文件失败: {error}")))
}

fn write_task_record(path: &Path, record: &TaskArtifactRecord) -> Result<(), MediaRuntimeError> {
    let canonical_record = canonicalize_task_record(record.clone());
    let serialized = serde_json::to_string_pretty(&canonical_record)
        .unwrap_or_else(|_| serde_json::json!(canonical_record).to_string());
    fs::write(path, serialized.as_bytes())
        .map_err(|error| MediaRuntimeError::Io(format!("写入任务文件失败: {error}")))
}

fn relative_path_from_workspace(workspace_root: &Path, task_path: &Path) -> String {
    task_path
        .strip_prefix(workspace_root)
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|_| task_path.to_string_lossy().to_string())
}

fn build_task_output(
    workspace_root: &Path,
    task_path: &Path,
    record: TaskArtifactRecord,
    reused_existing: bool,
) -> TaskOutput {
    let record = canonicalize_task_record(record);
    let path = relative_path_from_workspace(workspace_root, task_path);
    let absolute_path = task_path.to_string_lossy().to_string();
    TaskOutput {
        success: true,
        task_id: record.task_id.clone(),
        task_type: record.task_type.clone(),
        task_family: record.task_family.clone(),
        status: record.status.clone(),
        normalized_status: record.normalized_status.clone(),
        current_attempt_id: record.current_attempt_id.clone(),
        attempt_count: record.attempts.len() as u32,
        last_error: record.last_error.clone(),
        progress: record.progress.clone(),
        ui_hints: record.ui_hints.clone(),
        path: path.clone(),
        absolute_path: absolute_path.clone(),
        artifact_path: path,
        absolute_artifact_path: absolute_path,
        reused_existing,
        idempotency_key: record.idempotency_key.clone(),
        record,
    }
}

fn collect_task_files(root: &Path) -> Result<Vec<PathBuf>, MediaRuntimeError> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut stack = vec![root.to_path_buf()];
    let mut files = Vec::new();

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir)
            .map_err(|error| MediaRuntimeError::Io(format!("读取任务目录失败: {error}")))?;
        for entry in entries {
            let entry = entry
                .map_err(|error| MediaRuntimeError::Io(format!("读取任务目录项失败: {error}")))?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }

            if path.extension().and_then(|value| value.to_str()) == Some("json") {
                files.push(path);
            }
        }
    }

    Ok(files)
}

fn find_task_record_by_idempotency_key(
    workspace_root: &Path,
    artifact_dir: Option<&str>,
    task_type: TaskType,
    idempotency_key: &str,
) -> Result<Option<(PathBuf, TaskArtifactRecord)>, MediaRuntimeError> {
    let artifact_root = workspace_root.join(resolve_artifact_root_relative_path(artifact_dir)?);
    let mut best_match: Option<(PathBuf, TaskArtifactRecord)> = None;

    for file_path in collect_task_files(&artifact_root)? {
        let Ok(record) = read_task_record(&file_path) else {
            continue;
        };
        if record.task_type != task_type.as_str() {
            continue;
        }
        if record.idempotency_key.as_deref() != Some(idempotency_key) {
            continue;
        }
        if !supports_idempotent_reuse(&record.normalized_status) {
            continue;
        }

        let should_replace = match best_match.as_ref() {
            Some((_, existing)) => record_sort_key(&record) > record_sort_key(existing),
            None => true,
        };
        if should_replace {
            best_match = Some((file_path, record));
        }
    }

    Ok(best_match)
}

fn ensure_output_not_occupied(
    workspace_root: &Path,
    output_abs_path: &Path,
    task_type: TaskType,
    idempotency_key: Option<&str>,
) -> Result<Option<TaskOutput>, MediaRuntimeError> {
    if !output_abs_path.exists() {
        return Ok(None);
    }

    let record = read_task_record(output_abs_path)?;
    if record.task_type == task_type.as_str()
        && idempotency_key.is_some()
        && record.idempotency_key.as_deref() == idempotency_key
    {
        return Ok(Some(build_task_output(
            workspace_root,
            output_abs_path,
            record,
            true,
        )));
    }

    Err(MediaRuntimeError::Conflict(format!(
        "输出路径已存在: {}",
        output_abs_path.to_string_lossy()
    )))
}

fn persist_task_record(
    workspace_root: &Path,
    output_rel_path: &Path,
    record: TaskArtifactRecord,
    reused_existing: bool,
) -> Result<TaskOutput, MediaRuntimeError> {
    let output_abs_path = workspace_root.join(output_rel_path);
    let parent = output_abs_path
        .parent()
        .ok_or_else(|| MediaRuntimeError::Io("无法解析任务文件父目录".to_string()))?;
    fs::create_dir_all(parent)
        .map_err(|error| MediaRuntimeError::Io(format!("创建任务目录失败: {error}")))?;
    write_task_record(&output_abs_path, &record)?;
    Ok(build_task_output(
        workspace_root,
        &output_abs_path,
        record,
        reused_existing,
    ))
}

fn apply_status_to_attempt(attempt: &mut TaskAttemptRecord, status: &str, occurred_at: &str) {
    let normalized_status = normalize_status(status);
    attempt.status = status.to_string();

    match normalized_status.as_str() {
        "pending" => {
            attempt.queued_at = None;
            attempt.started_at = None;
            attempt.completed_at = None;
        }
        "queued" => {
            if attempt.queued_at.is_none() {
                attempt.queued_at = Some(occurred_at.to_string());
            }
            attempt.started_at = None;
            attempt.completed_at = None;
        }
        "running" => {
            if attempt.queued_at.is_none() {
                attempt.queued_at = Some(occurred_at.to_string());
            }
            attempt.started_at = Some(occurred_at.to_string());
            attempt.completed_at = None;
        }
        "partial" => {
            if attempt.queued_at.is_none() {
                attempt.queued_at = Some(occurred_at.to_string());
            }
            if attempt.started_at.is_none() {
                attempt.started_at = Some(occurred_at.to_string());
            }
            attempt.completed_at = None;
        }
        "succeeded" | "failed" | "cancelled" => {
            if attempt.queued_at.is_none() {
                attempt.queued_at = Some(occurred_at.to_string());
            }
            if attempt.started_at.is_none() {
                attempt.started_at = Some(occurred_at.to_string());
            }
            attempt.completed_at = Some(occurred_at.to_string());
        }
        _ => {}
    }
}

fn apply_status_to_record(record: &mut TaskArtifactRecord, status: &str, occurred_at: &str) {
    let normalized_status = normalize_status(status);
    record.status = status.to_string();
    record.normalized_status = normalized_status.clone();

    match normalized_status.as_str() {
        "pending" => {
            record.submitted_at = None;
            record.started_at = None;
            record.completed_at = None;
            record.cancelled_at = None;
        }
        "queued" => {
            if record.submitted_at.is_none() {
                record.submitted_at = Some(occurred_at.to_string());
            }
            record.started_at = None;
            record.completed_at = None;
            record.cancelled_at = None;
        }
        "running" => {
            if record.submitted_at.is_none() {
                record.submitted_at = Some(occurred_at.to_string());
            }
            record.started_at = Some(occurred_at.to_string());
            record.completed_at = None;
            record.cancelled_at = None;
        }
        "partial" => {
            if record.submitted_at.is_none() {
                record.submitted_at = Some(occurred_at.to_string());
            }
            if record.started_at.is_none() {
                record.started_at = Some(occurred_at.to_string());
            }
            record.completed_at = None;
            record.cancelled_at = None;
        }
        "succeeded" | "failed" => {
            if record.submitted_at.is_none() {
                record.submitted_at = Some(occurred_at.to_string());
            }
            if record.started_at.is_none() {
                record.started_at = Some(occurred_at.to_string());
            }
            record.completed_at = Some(occurred_at.to_string());
            record.cancelled_at = None;
        }
        "cancelled" => {
            record.cancelled_at = Some(occurred_at.to_string());
        }
        _ => {}
    }

    record.progress = derive_task_progress(status, record.last_error.as_ref());
}

pub fn write_task_artifact(
    workspace_root: &Path,
    task_type: TaskType,
    title: Option<String>,
    payload: Value,
    options: TaskWriteOptions<'_>,
) -> Result<TaskOutput, MediaRuntimeError> {
    let normalized_title = normalize_optional_text(title);
    let normalized_idempotency_key = normalize_idempotency_key(options.idempotency_key)?;
    let initial_status = match options.status.as_deref() {
        Some(status) => normalize_mutation_status(status)?,
        None => task_type.default_status().to_string(),
    };

    if let Some(idempotency_key) = normalized_idempotency_key.as_deref() {
        if let Some((task_path, record)) = find_task_record_by_idempotency_key(
            workspace_root,
            options.artifact_dir,
            task_type,
            idempotency_key,
        )? {
            return Ok(build_task_output(workspace_root, &task_path, record, true));
        }
    }

    let output_rel_path =
        resolve_output_relative_path(task_type, options.output_path, options.artifact_dir)?;
    let output_abs_path = workspace_root.join(&output_rel_path);
    if let Some(existing) = ensure_output_not_occupied(
        workspace_root,
        &output_abs_path,
        task_type,
        normalized_idempotency_key.as_deref(),
    )? {
        return Ok(existing);
    }

    let created_at = Utc::now().to_rfc3339();
    let summary = derive_task_summary(task_type.as_str(), normalized_title.as_deref(), &payload);
    let task_family = task_type.family().to_string();
    let initial_attempt = build_attempt_record(
        "",
        &payload,
        AttemptRecordInput {
            attempt_id: new_attempt_id(),
            attempt_index: 1,
            status: initial_status.clone(),
            queued_at: None,
            started_at: None,
            completed_at: None,
            result_snapshot: None,
            error: None,
        },
    );
    let mut record = TaskArtifactRecord {
        task_id: Uuid::new_v4().to_string(),
        task_type: task_type.as_str().to_string(),
        task_family,
        title: normalized_title,
        summary,
        payload,
        status: initial_status.clone(),
        normalized_status: normalize_status(&initial_status),
        created_at: created_at.clone(),
        updated_at: None,
        submitted_at: None,
        started_at: None,
        completed_at: None,
        cancelled_at: None,
        idempotency_key: normalized_idempotency_key,
        retry_count: 0,
        source_task_id: None,
        result: None,
        last_error: None,
        current_attempt_id: Some(initial_attempt.attempt_id.clone()),
        attempts: vec![TaskAttemptRecord {
            input_snapshot: serde_json::json!({}),
            ..initial_attempt
        }],
        relationships: options.relationships,
        progress: TaskProgress::default(),
        ui_hints: TaskUiHints::default(),
    };
    record.attempts[0].input_snapshot = record.payload.clone();
    record.attempts[0].logs_ref = Some(format!(
        ".lime/task-logs/{}/attempt_1.jsonl",
        record.task_id
    ));
    apply_status_to_attempt(&mut record.attempts[0], &initial_status, &created_at);
    apply_status_to_record(&mut record, &initial_status, &created_at);

    persist_task_record(workspace_root, &output_rel_path, record, false)
}

pub fn write_media_task_artifact(
    workspace_root: &Path,
    task_type: MediaTaskType,
    title: Option<String>,
    payload: Value,
    status: Option<String>,
    output_path: Option<&str>,
    artifact_dir: Option<&str>,
) -> Result<MediaTaskOutput, MediaRuntimeError> {
    write_task_artifact(
        workspace_root,
        task_type,
        title,
        payload,
        TaskWriteOptions {
            status,
            output_path,
            artifact_dir,
            idempotency_key: None,
            relationships: TaskRelationships::default(),
        },
    )
}

fn resolve_task_reference_path(
    workspace_root: &Path,
    task_ref: &str,
    artifact_dir: Option<&str>,
) -> Result<PathBuf, MediaRuntimeError> {
    let trimmed = task_ref.trim();
    if trimmed.is_empty() {
        return Err(MediaRuntimeError::InvalidParams(
            "task_ref 不能为空字符串".to_string(),
        ));
    }

    let explicit_path = PathBuf::from(trimmed);
    if explicit_path.is_absolute() && explicit_path.is_file() {
        return Ok(explicit_path);
    }

    let workspace_relative = workspace_root.join(trimmed);
    if workspace_relative.is_file() {
        return Ok(workspace_relative);
    }

    let artifact_root = workspace_root.join(resolve_artifact_root_relative_path(artifact_dir)?);
    for file_path in collect_task_files(&artifact_root)? {
        let Ok(record) = read_task_record(&file_path) else {
            continue;
        };
        if record.task_id == trimmed {
            return Ok(file_path);
        }
    }

    Err(MediaRuntimeError::TaskNotFound {
        task_ref: trimmed.to_string(),
    })
}

pub fn load_task_output(
    workspace_root: &Path,
    task_ref: &str,
    artifact_dir: Option<&str>,
) -> Result<TaskOutput, MediaRuntimeError> {
    let task_path = resolve_task_reference_path(workspace_root, task_ref, artifact_dir)?;
    let record = read_task_record(&task_path)?;
    Ok(build_task_output(workspace_root, &task_path, record, false))
}

pub fn list_task_outputs(
    workspace_root: &Path,
    artifact_dir: Option<&str>,
    status_filter: Option<&str>,
    task_family_filter: Option<&str>,
    task_type_filter: Option<TaskType>,
    limit: Option<usize>,
) -> Result<Vec<TaskOutput>, MediaRuntimeError> {
    let artifact_root = workspace_root.join(resolve_artifact_root_relative_path(artifact_dir)?);
    let mut outputs = Vec::new();

    for file_path in collect_task_files(&artifact_root)? {
        let Ok(record) = read_task_record(&file_path) else {
            continue;
        };
        if !task_record_matches_filter(&record, status_filter, task_family_filter, task_type_filter)
        {
            continue;
        }
        outputs.push(build_task_output(workspace_root, &file_path, record, false));
    }

    outputs
        .sort_by(|left, right| record_sort_key(&right.record).cmp(record_sort_key(&left.record)));

    if let Some(limit) = limit {
        outputs.truncate(limit);
    }

    Ok(outputs)
}

pub fn update_task_status(
    workspace_root: &Path,
    task_ref: &str,
    artifact_dir: Option<&str>,
    new_status: &str,
) -> Result<TaskOutput, MediaRuntimeError> {
    let task_path = resolve_task_reference_path(workspace_root, task_ref, artifact_dir)?;
    let mut record = read_task_record(&task_path)?;
    let current_normalized_status = record.normalized_status.clone();
    let next_status = normalize_mutation_status(new_status)?;
    let next_normalized_status = normalize_status(&next_status);
    let occurred_at = Utc::now().to_rfc3339();

    if current_normalized_status == "succeeded" && next_normalized_status != "succeeded" {
        return Err(MediaRuntimeError::InvalidState(
            "已成功完成的任务不能再修改状态".to_string(),
        ));
    }
    if current_normalized_status == "failed" && next_normalized_status == "running" {
        return Err(MediaRuntimeError::InvalidState(
            "失败任务请使用 retry 创建新尝试，不要直接改回 running".to_string(),
        ));
    }

    record.updated_at = Some(occurred_at.clone());
    if next_normalized_status != "failed" {
        record.last_error = None;
    }
    apply_status_to_record(&mut record, &next_status, &occurred_at);
    if let Some(index) = current_attempt_index(&record) {
        let current_attempt = &mut record.attempts[index];
        apply_status_to_attempt(current_attempt, &next_status, &occurred_at);
        if next_normalized_status != "failed" {
            current_attempt.error = None;
        } else if current_attempt.error.is_none() {
            current_attempt.error = record.last_error.clone();
        }

        if matches!(next_normalized_status.as_str(), "partial" | "succeeded") {
            current_attempt.result_snapshot = record.result.clone();
        } else if next_normalized_status != "failed" {
            current_attempt.result_snapshot = None;
        }
    }
    write_task_record(&task_path, &record)?;
    Ok(build_task_output(workspace_root, &task_path, record, false))
}

pub fn patch_task_artifact(
    workspace_root: &Path,
    task_ref: &str,
    artifact_dir: Option<&str>,
    patch: TaskArtifactPatch,
) -> Result<TaskOutput, MediaRuntimeError> {
    let task_path = resolve_task_reference_path(workspace_root, task_ref, artifact_dir)?;
    let mut record = read_task_record(&task_path)?;
    let occurred_at = Utc::now().to_rfc3339();
    let mut should_refresh_progress = false;

    if let Some(status) = patch.status.as_deref() {
        let current_normalized_status = record.normalized_status.clone();
        let next_status = normalize_mutation_status(status)?;
        let next_normalized_status = normalize_status(&next_status);

        if current_normalized_status == "succeeded" && next_normalized_status != "succeeded" {
            return Err(MediaRuntimeError::InvalidState(
                "已成功完成的任务不能再修改状态".to_string(),
            ));
        }
        if current_normalized_status == "failed" && next_normalized_status == "running" {
            return Err(MediaRuntimeError::InvalidState(
                "失败任务请使用 retry 创建新尝试，不要直接改回 running".to_string(),
            ));
        }

        if next_normalized_status != "failed" && patch.last_error.is_none() {
            record.last_error = None;
        }
        record.updated_at = Some(occurred_at.clone());
        apply_status_to_record(&mut record, &next_status, &occurred_at);
        if let Some(index) = current_attempt_index(&record) {
            let current_attempt = &mut record.attempts[index];
            apply_status_to_attempt(current_attempt, &next_status, &occurred_at);
            if next_normalized_status != "failed" && patch.last_error.is_none() {
                current_attempt.error = None;
            }
            if matches!(next_normalized_status.as_str(), "partial" | "succeeded") {
                current_attempt.result_snapshot = record.result.clone();
            } else if next_normalized_status != "failed" {
                current_attempt.result_snapshot = None;
            }
        }
        should_refresh_progress = true;
    }

    if let Some(last_error) = patch.last_error {
        record.last_error = last_error.clone();
        if let Some(index) = current_attempt_index(&record) {
            record.attempts[index].error = last_error;
        }
        should_refresh_progress = true;
    }

    if let Some(result) = patch.result {
        record.result = result.clone();
        if let Some(index) = current_attempt_index(&record) {
            if matches!(record.normalized_status.as_str(), "partial" | "succeeded") {
                record.attempts[index].result_snapshot = result;
            }
        }
    }

    if let Some(payload_patch) = patch.payload_patch {
        apply_payload_patch(&mut record.payload, payload_patch)?;
        if let Some(index) = current_attempt_index(&record) {
            record.attempts[index].input_snapshot = record.payload.clone();
        }
    }

    if let Some(worker_id) = patch.current_attempt_worker_id {
        if let Some(index) = current_attempt_index(&record) {
            record.attempts[index].worker_id = worker_id;
        }
    }

    if let Some(metrics) = patch.current_attempt_metrics {
        if let Some(index) = current_attempt_index(&record) {
            record.attempts[index].metrics = metrics;
        }
    }

    if should_refresh_progress {
        record.progress = derive_task_progress(&record.status, record.last_error.as_ref());
    }
    if let Some(progress) = patch.progress {
        record.progress = progress;
    }
    if let Some(ui_hints) = patch.ui_hints {
        record.ui_hints = ui_hints;
    }

    record.updated_at = Some(occurred_at.clone());
    write_task_record(&task_path, &record)?;
    Ok(build_task_output(workspace_root, &task_path, record, false))
}

pub fn retry_task_artifact(
    workspace_root: &Path,
    task_ref: &str,
    artifact_dir: Option<&str>,
) -> Result<TaskOutput, MediaRuntimeError> {
    let task_path = resolve_task_reference_path(workspace_root, task_ref, artifact_dir)?;
    let mut record = read_task_record(&task_path)?;
    let normalized_status = record.normalized_status.clone();
    if normalized_status != "failed" && normalized_status != "cancelled" {
        return Err(MediaRuntimeError::NotRetryable(format!(
            "当前状态 `{}` 不支持 retry",
            record.status
        )));
    }

    let task_type = record.task_type.parse::<TaskType>().map_err(|_| {
        MediaRuntimeError::InvalidState(format!("未知任务类型: {}", record.task_type))
    })?;
    let retry_status = task_type.default_status().to_string();
    let occurred_at = Utc::now().to_rfc3339();
    let next_attempt_index = record.attempts.len() as u32 + 1;
    let previous_attempt_id = record.current_attempt_id.clone();
    let mut next_attempt = build_attempt_record(
        &record.task_id,
        &record.payload,
        AttemptRecordInput {
            attempt_id: new_attempt_id(),
            attempt_index: next_attempt_index,
            status: retry_status.clone(),
            queued_at: None,
            started_at: None,
            completed_at: None,
            result_snapshot: None,
            error: None,
        },
    );
    apply_status_to_attempt(&mut next_attempt, &retry_status, &occurred_at);

    record.attempts.push(next_attempt);
    record.current_attempt_id = record
        .attempts
        .last()
        .map(|attempt| attempt.attempt_id.clone());
    record.relationships.derived_from_attempt_id = previous_attempt_id;
    record.updated_at = Some(occurred_at.clone());
    record.result = None;
    record.last_error = None;
    record.source_task_id = None;
    record.retry_count = record.attempts.len().saturating_sub(1) as u32;
    apply_status_to_record(&mut record, &retry_status, &occurred_at);

    write_task_record(&task_path, &record)?;
    Ok(build_task_output(workspace_root, &task_path, record, false))
}

pub fn parse_task_output(raw: &str) -> Option<TaskOutput> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    serde_json::from_str::<TaskOutput>(trimmed)
        .ok()
        .map(|mut value| {
            value.record = canonicalize_task_record(value.record);
            value.task_family = if value.task_family.trim().is_empty() {
                value.record.task_family.clone()
            } else {
                value.task_family
            };
            value.status = if value.status.trim().is_empty() {
                value.record.status.clone()
            } else {
                value.status
            };
            value.normalized_status = normalize_status(&value.status);
            value.current_attempt_id = value
                .current_attempt_id
                .or_else(|| value.record.current_attempt_id.clone());
            if value.attempt_count == 0 {
                value.attempt_count = value.record.attempts.len() as u32;
            }
            if value.last_error.is_none() {
                value.last_error = value.record.last_error.clone();
            }
            if value.progress.is_empty() {
                value.progress = value.record.progress.clone();
            }
            if value.ui_hints.is_empty() {
                value.ui_hints = value.record.ui_hints.clone();
            }
            value
        })
        .filter(|value| value.success && !value.task_type.trim().is_empty())
}

pub fn parse_media_task_output(raw: &str) -> Option<MediaTaskOutput> {
    parse_task_output(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };

    use axum::{
        extract::Json,
        http::{HeaderMap, StatusCode},
        routing::{get, post},
        Router,
    };
    use tokio::net::TcpListener;

    fn build_test_png_bytes(width: u32, height: u32, pixels: &[[u8; 4]]) -> Vec<u8> {
        let raw = pixels
            .iter()
            .flat_map(|pixel| pixel.iter().copied())
            .collect::<Vec<_>>();
        let mut output_bytes = Vec::new();
        PngEncoder::new(&mut output_bytes)
            .write_image(&raw, width, height, ColorType::Rgba8.into())
            .expect("write test png");
        output_bytes
    }

    fn build_test_png_data_url(width: u32, height: u32, pixels: &[[u8; 4]]) -> String {
        let output_bytes = build_test_png_bytes(width, height, pixels);
        encode_png_data_url(&output_bytes)
    }

    fn read_test_png_alpha(data_url: &str, x: u32, y: u32) -> u8 {
        let bytes = decode_png_data_url_bytes(data_url)
            .expect("decode data url")
            .expect("png bytes");
        image::load_from_memory_with_format(&bytes, ImageFormat::Png)
            .expect("decode png")
            .to_rgba8()
            .get_pixel(x, y)[3]
    }

    fn test_chroma_key_plan() -> PreparedImageTaskPostprocessPlan {
        PreparedImageTaskPostprocessPlan {
            strategy: "chroma_key_postprocess".to_string(),
            chroma_key_color: "#00ff00".to_string(),
            document_id: Some("design-1".to_string()),
            layer_id: Some("subject".to_string()),
            asset_id: Some("asset-subject".to_string()),
        }
    }

    fn test_image_slot() -> PreparedImageTaskSlot {
        PreparedImageTaskSlot {
            slot_index: 1,
            slot_id: "image-slot-1".to_string(),
            label: None,
            prompt: "生成透明角色层".to_string(),
            shot_type: None,
        }
    }

    #[test]
    fn write_media_task_artifact_uses_default_task_root() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = write_media_task_artifact(
            temp_dir.path(),
            MediaTaskType::ImageGenerate,
            Some("配图".to_string()),
            serde_json::json!({ "prompt": "未来城市插图" }),
            None,
            None,
            None,
        )
        .expect("write media task");

        assert!(output.path.starts_with(".lime/tasks/image_generate/"));
        assert_eq!(output.task_type, "image_generate");
        assert_eq!(output.task_family, "image");
        assert_eq!(output.status, "pending_submit");
        assert_eq!(output.normalized_status, "pending");
        assert_eq!(output.attempt_count, 1);
        assert!(output.current_attempt_id.is_some());
        assert_eq!(output.record.attempts.len(), 1);
        assert_eq!(
            output.ui_hints.render_mode.as_deref(),
            Some("media_placeholder_card")
        );
        assert!(temp_dir.path().join(&output.path).exists());
    }

    #[test]
    fn write_media_task_artifact_rejects_parent_dir_escape() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let error = write_media_task_artifact(
            temp_dir.path(),
            MediaTaskType::CoverGenerate,
            None,
            serde_json::json!({ "prompt": "封面" }),
            None,
            Some("../escape.json"),
            None,
        )
        .expect_err("should reject unsafe path");

        assert!(matches!(error, MediaRuntimeError::InvalidParams(_)));
    }

    #[test]
    fn write_media_task_artifact_supports_custom_artifact_dir() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = write_media_task_artifact(
            temp_dir.path(),
            MediaTaskType::VideoGenerate,
            None,
            serde_json::json!({ "prompt": "短视频" }),
            Some("queued".to_string()),
            None,
            Some("custom/tasks"),
        )
        .expect("write media task");

        assert!(output.path.starts_with("custom/tasks/video_generate/"));
        assert_eq!(output.status, "queued");
        assert_eq!(output.normalized_status, "queued");
        assert_eq!(output.record.attempts.len(), 1);
        assert!(output.record.current_attempt_id.is_some());
    }

    #[test]
    fn prepare_image_task_input_should_consume_layered_design_chroma_key_postprocess_contract() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = write_media_task_artifact(
            temp_dir.path(),
            MediaTaskType::ImageGenerate,
            Some("透明角色层".to_string()),
            serde_json::json!({
                "prompt": "生成透明角色层",
                "runtime_contract": {
                    "contract_key": "image_generation",
                    "layered_design": {
                        "document_id": "design-1",
                        "layer_id": "subject",
                        "asset_id": "asset-subject",
                        "alpha": {
                            "requested": true,
                            "strategy": "chroma_key_postprocess",
                            "chromaKeyColor": "#00ff00",
                            "postprocessRequired": true
                        }
                    }
                }
            }),
            None,
            None,
            None,
        )
        .expect("write media task");

        let prepared = prepare_image_task_input(&output).expect("prepare image task");
        let postprocess_plan = prepared
            .postprocess_plan
            .as_ref()
            .expect("postprocess plan");

        assert_eq!(postprocess_plan.strategy, "chroma_key_postprocess");
        assert_eq!(postprocess_plan.chroma_key_color, "#00ff00");
        assert_eq!(postprocess_plan.layer_id.as_deref(), Some("subject"));
        assert!(prepared.request_slots[0]
            .prompt
            .contains("flat chroma-key background (#00ff00)"));

        let source_url = build_test_png_data_url(2, 1, &[[0, 255, 0, 255], [255, 0, 0, 255]]);
        let decorated = decorate_generated_image_with_slot(
            serde_json::json!({ "url": source_url }),
            &prepared.request_slots[0],
            prepared.postprocess_plan.as_ref(),
        );
        assert_eq!(
            decorated.pointer("/postprocess/status"),
            Some(&serde_json::json!("succeeded"))
        );
        assert_eq!(
            decorated.pointer("/postprocess/removed_pixel_count"),
            Some(&serde_json::json!(1))
        );
        let output_url = decorated
            .pointer("/url")
            .and_then(Value::as_str)
            .expect("decorated image url");
        assert_eq!(read_test_png_alpha(output_url, 0, 0), 0);
        assert_eq!(read_test_png_alpha(output_url, 1, 0), 255);

        let result = build_image_task_result_value(&prepared, 1, &[decorated], &[], &[]);
        assert_eq!(
            result.pointer("/postprocess/strategy"),
            Some(&serde_json::json!("chroma_key_postprocess"))
        );
        assert_eq!(
            result.pointer("/postprocess/status"),
            Some(&serde_json::json!("succeeded"))
        );
    }

    #[test]
    fn chroma_key_postprocess_should_skip_remote_image_url_without_failing_task() {
        let plan = test_chroma_key_plan();
        let source_url = "https://example.test/generated.png";
        let decorated = decorate_generated_image_with_slot(
            serde_json::json!({ "url": source_url }),
            &test_image_slot(),
            Some(&plan),
        );

        assert_eq!(
            decorated.pointer("/url"),
            Some(&serde_json::json!(source_url))
        );
        assert_eq!(
            decorated.pointer("/postprocess/status"),
            Some(&serde_json::json!("skipped_unsupported_source"))
        );
        assert!(decorated.pointer("/postprocess/reason").is_some());
    }

    #[tokio::test]
    async fn execute_image_generation_task_should_postprocess_remote_chroma_key_url() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created = write_task_artifact(
            temp_dir.path(),
            TaskType::ImageGenerate,
            Some("透明角色层".to_string()),
            json!({
                "prompt": "生成透明角色层",
                "count": 1,
                "runtime_contract": {
                    "contract_key": "image_generation",
                    "layered_design": {
                        "document_id": "design-remote",
                        "layer_id": "subject",
                        "asset_id": "asset-subject",
                        "alpha": {
                            "requested": true,
                            "strategy": "chroma_key_postprocess",
                            "chroma_key_color": "#00ff00",
                            "postprocess_required": true
                        }
                    }
                }
            }),
            TaskWriteOptions::default(),
        )
        .expect("create task");

        let png_bytes = Arc::new(build_test_png_bytes(
            2,
            1,
            &[[0, 255, 0, 255], [255, 0, 0, 255]],
        ));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image api");
        let address = listener.local_addr().expect("resolve address");
        let generated_image_url = format!("http://{address}/generated.png");
        let response_image_url = generated_image_url.clone();
        let png_bytes_for_server = Arc::clone(&png_bytes);
        let server = tokio::spawn(async move {
            let app = Router::new()
                .route(
                    "/v1/images/generations",
                    post(move |Json(_body): Json<Value>| {
                        let response_image_url = response_image_url.clone();
                        async move {
                            (
                                StatusCode::OK,
                                Json(json!({
                                    "created": 1_717_200_000i64,
                                    "data": [
                                        {
                                            "url": response_image_url,
                                            "revised_prompt": "透明角色层"
                                        }
                                    ]
                                })),
                            )
                        }
                    }),
                )
                .route(
                    "/generated.png",
                    get(move || {
                        let png_bytes = Arc::clone(&png_bytes_for_server);
                        async move {
                            (
                                StatusCode::OK,
                                [("content-type", PNG_DATA_URL_MIME)],
                                png_bytes.as_ref().clone(),
                            )
                        }
                    }),
                );
            axum::serve(listener, app).await.expect("serve image api");
        });

        let result = execute_image_generation_task(
            temp_dir.path(),
            &created.task_id,
            &ImageGenerationRunnerConfig {
                endpoint: format!("http://{address}/v1/images/generations"),
                api_key: "test-key".to_string(),
            },
        )
        .await
        .expect("execute image task");

        let image = result
            .record
            .result
            .as_ref()
            .and_then(|value| value.get("images"))
            .and_then(Value::as_array)
            .and_then(|images| images.first())
            .expect("generated image");
        let output_url = image
            .get("url")
            .and_then(Value::as_str)
            .expect("output url");

        assert_ne!(output_url, generated_image_url);
        assert!(output_url.starts_with("data:image/png;base64,"));
        assert_eq!(read_test_png_alpha(output_url, 0, 0), 0);
        assert_eq!(read_test_png_alpha(output_url, 1, 0), 255);
        assert_eq!(
            image.pointer("/postprocess/status"),
            Some(&serde_json::json!("succeeded"))
        );
        assert_eq!(
            image.pointer("/postprocess/input_source"),
            Some(&serde_json::json!("remote_url"))
        );
        assert_eq!(
            result
                .record
                .result
                .as_ref()
                .and_then(|value| value.pointer("/postprocess/succeeded_count")),
            Some(&serde_json::json!(1))
        );

        server.abort();
    }

    #[test]
    fn write_task_artifact_supports_transcription_generate() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = write_task_artifact(
            temp_dir.path(),
            TaskType::TranscriptionGenerate,
            None,
            serde_json::json!({
                "source_path": "/tmp/interview.wav",
                "output_format": "srt"
            }),
            TaskWriteOptions::default(),
        )
        .expect("write transcription task");

        assert!(output
            .path
            .starts_with(".lime/tasks/transcription_generate/"));
        assert_eq!(output.task_type, "transcription_generate");
        assert_eq!(output.task_family, "document");
        assert_eq!(output.status, "pending_submit");
        assert_eq!(
            output.ui_hints.open_action.as_deref(),
            Some("open_task_panel")
        );
    }

    #[test]
    fn write_task_artifact_supports_audio_generate() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = write_task_artifact(
            temp_dir.path(),
            TaskType::AudioGenerate,
            Some("配音".to_string()),
            serde_json::json!({
                "source_text": "这是需要配音的文案",
                "voice": "warm_narrator",
                "audio_output": {
                    "status": "pending",
                    "mime_type": "audio/mpeg"
                }
            }),
            TaskWriteOptions::default(),
        )
        .expect("write audio task");

        assert!(output.path.starts_with(".lime/tasks/audio_generate/"));
        assert_eq!(output.task_type, "audio_generate");
        assert_eq!(output.task_family, "audio");
        assert_eq!(output.status, "pending_submit");
        assert_eq!(output.normalized_status, "pending");
        assert_eq!(
            output.ui_hints.open_action.as_deref(),
            Some("open_audio_player")
        );
        assert_eq!(
            output.record.payload.pointer("/audio_output/status"),
            Some(&serde_json::json!("pending"))
        );
    }

    #[test]
    fn write_task_artifact_reuses_idempotent_record() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let first = write_task_artifact(
            temp_dir.path(),
            TaskType::BroadcastGenerate,
            Some("播客".to_string()),
            serde_json::json!({ "content": "demo" }),
            TaskWriteOptions {
                idempotency_key: Some("broadcast-1"),
                ..TaskWriteOptions::default()
            },
        )
        .expect("write first");

        let second = write_task_artifact(
            temp_dir.path(),
            TaskType::BroadcastGenerate,
            Some("播客".to_string()),
            serde_json::json!({ "content": "demo" }),
            TaskWriteOptions {
                idempotency_key: Some("broadcast-1"),
                ..TaskWriteOptions::default()
            },
        )
        .expect("write second");

        assert_eq!(first.task_id, second.task_id);
        assert!(second.reused_existing);
    }

    #[test]
    fn write_task_artifact_does_not_reuse_cancelled_idempotent_record() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let cancelled = write_task_artifact(
            temp_dir.path(),
            TaskType::BroadcastGenerate,
            Some("播客".to_string()),
            serde_json::json!({ "content": "demo" }),
            TaskWriteOptions {
                status: Some("cancelled".to_string()),
                idempotency_key: Some("broadcast-1"),
                ..TaskWriteOptions::default()
            },
        )
        .expect("write cancelled");

        let created_again = write_task_artifact(
            temp_dir.path(),
            TaskType::BroadcastGenerate,
            Some("播客".to_string()),
            serde_json::json!({ "content": "demo" }),
            TaskWriteOptions {
                idempotency_key: Some("broadcast-1"),
                ..TaskWriteOptions::default()
            },
        )
        .expect("write again");

        assert_ne!(cancelled.task_id, created_again.task_id);
        assert!(!created_again.reused_existing);
        assert_eq!(created_again.normalized_status, "pending");
    }

    #[test]
    fn list_task_outputs_filters_by_normalized_status() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let _pending = write_task_artifact(
            temp_dir.path(),
            TaskType::Typesetting,
            None,
            serde_json::json!({ "content": "demo" }),
            TaskWriteOptions::default(),
        )
        .expect("write pending");
        let failed = write_task_artifact(
            temp_dir.path(),
            TaskType::UrlParse,
            None,
            serde_json::json!({ "url": "https://example.com" }),
            TaskWriteOptions {
                status: Some("failed".to_string()),
                ..TaskWriteOptions::default()
            },
        )
        .expect("write failed");

        let items = list_task_outputs(temp_dir.path(), None, Some("failed"), None, None, Some(10))
            .expect("list tasks");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].task_id, failed.task_id);
    }

    #[test]
    fn retry_task_artifact_appends_attempt_to_same_task() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let failed = write_task_artifact(
            temp_dir.path(),
            TaskType::ModalResourceSearch,
            None,
            serde_json::json!({ "query": "城市" }),
            TaskWriteOptions {
                status: Some("failed".to_string()),
                idempotency_key: Some("search-1"),
                ..TaskWriteOptions::default()
            },
        )
        .expect("write failed");

        let retried =
            retry_task_artifact(temp_dir.path(), &failed.task_id, None).expect("retry task");

        assert_eq!(failed.task_id, retried.task_id);
        assert_ne!(failed.current_attempt_id, retried.current_attempt_id);
        assert_eq!(retried.status, "pending_submit");
        assert_eq!(retried.record.retry_count, 1);
        assert_eq!(retried.record.source_task_id, None);
        assert_eq!(retried.record.idempotency_key.as_deref(), Some("search-1"));
        assert_eq!(retried.record.attempts.len(), 2);
        assert_eq!(
            retried.record.relationships.derived_from_attempt_id,
            failed.current_attempt_id
        );
    }

    #[test]
    fn load_task_output_upgrades_legacy_error_and_attempt_history() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let legacy_path = temp_dir
            .path()
            .join(".lime/tasks/image_generate/legacy-task.json");
        std::fs::create_dir_all(
            legacy_path
                .parent()
                .expect("legacy task parent should exist"),
        )
        .expect("create legacy task dir");
        std::fs::write(
            &legacy_path,
            serde_json::json!({
                "task_id": "legacy-task",
                "task_type": "image_generate",
                "payload": {
                    "prompt": "未来实验室"
                },
                "status": "failed",
                "created_at": "2026-04-03T00:00:00Z",
                "retry_count": 2,
                "last_error": "provider timeout"
            })
            .to_string(),
        )
        .expect("write legacy task");

        let output =
            load_task_output(temp_dir.path(), "legacy-task", None).expect("load legacy task");

        assert_eq!(output.task_family, "image");
        assert_eq!(output.attempt_count, 1);
        assert_eq!(output.record.retry_count, 0);
        assert_eq!(output.record.attempts.len(), 1);
        assert_eq!(
            output
                .record
                .last_error
                .as_ref()
                .map(|value| value.code.as_str()),
            Some("legacy_error")
        );
        assert_eq!(
            output
                .record
                .attempts
                .first()
                .and_then(|attempt| attempt.error.as_ref())
                .map(|value| value.message.as_str()),
            Some("provider timeout")
        );
    }

    #[test]
    fn parse_media_task_output_accepts_serialized_success_payload() {
        let payload = MediaTaskOutput {
            success: true,
            task_id: "task-1".to_string(),
            task_type: "image_generate".to_string(),
            task_family: "image".to_string(),
            status: "pending_submit".to_string(),
            normalized_status: "pending".to_string(),
            current_attempt_id: Some("attempt-1".to_string()),
            attempt_count: 1,
            last_error: None,
            progress: TaskProgress::default(),
            ui_hints: TaskUiHints::default(),
            path: ".lime/tasks/image_generate/demo.json".to_string(),
            absolute_path: "/tmp/demo.json".to_string(),
            artifact_path: ".lime/tasks/image_generate/demo.json".to_string(),
            absolute_artifact_path: "/tmp/demo.json".to_string(),
            reused_existing: false,
            idempotency_key: None,
            record: MediaTaskArtifactRecord {
                task_id: "task-1".to_string(),
                task_type: "image_generate".to_string(),
                task_family: "image".to_string(),
                title: None,
                summary: Some("image_generate 任务".to_string()),
                payload: serde_json::json!({ "prompt": "demo" }),
                status: "pending_submit".to_string(),
                normalized_status: "pending".to_string(),
                created_at: "2026-04-03T00:00:00Z".to_string(),
                updated_at: None,
                submitted_at: None,
                started_at: None,
                completed_at: None,
                cancelled_at: None,
                idempotency_key: None,
                retry_count: 0,
                source_task_id: None,
                result: None,
                last_error: None,
                current_attempt_id: Some("attempt-1".to_string()),
                attempts: vec![TaskAttemptRecord {
                    attempt_id: "attempt-1".to_string(),
                    attempt_index: 1,
                    status: "pending_submit".to_string(),
                    input_snapshot: serde_json::json!({ "prompt": "demo" }),
                    ..TaskAttemptRecord::default()
                }],
                relationships: TaskRelationships::default(),
                progress: TaskProgress::default(),
                ui_hints: TaskUiHints::default(),
            },
        };
        let serialized = serde_json::to_string(&payload).expect("serialize");

        let parsed = parse_media_task_output(&serialized).expect("parse success payload");
        assert_eq!(parsed.task_id, "task-1");
        assert_eq!(
            parsed.artifact_paths(),
            vec![".lime/tasks/image_generate/demo.json".to_string()]
        );
    }

    #[tokio::test]
    async fn execute_image_generation_task_should_advance_task_file_to_succeeded() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let captured_provider_id = Arc::new(Mutex::new(None::<String>));
        let captured_response_format = Arc::new(Mutex::new(None::<String>));
        let created = write_task_artifact(
            temp_dir.path(),
            TaskType::ImageGenerate,
            Some("青柠主视觉".to_string()),
            json!({
                "prompt": "未来感青柠实验室",
                "size": "1024x1024",
                "count": 1,
                "style": "cinematic",
                "provider_id": "fal",
                "model": "fal-ai/nano-banana-pro",
            }),
            TaskWriteOptions::default(),
        )
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
            temp_dir.path(),
            &created.task_id,
            &ImageGenerationRunnerConfig {
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
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            result
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("images"))
                .and_then(Value::as_array)
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
    async fn execute_image_generation_task_should_support_responses_image_generation_executor() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let captured_body = Arc::new(Mutex::new(None::<Value>));
        let created = write_task_artifact(
            temp_dir.path(),
            TaskType::ImageGenerate,
            Some("图层主视觉".to_string()),
            json!({
                "prompt": "透明背景上的青柠产品主体",
                "size": "1024x1024",
                "count": 1,
                "provider_id": "openai",
                "model": "gpt-image-2",
                "executor_mode": "responses_image_generation",
                "outer_model": "gpt-5.5"
            }),
            TaskWriteOptions::default(),
        )
        .expect("create task");

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind responses api");
        let address = listener.local_addr().expect("resolve address");
        let captured_body_for_server = Arc::clone(&captured_body);
        let server = tokio::spawn(async move {
            let app = Router::new().route(
                "/v1/responses",
                post(move |Json(body): Json<Value>| {
                    let captured_body = Arc::clone(&captured_body_for_server);
                    async move {
                        *captured_body.lock().expect("lock captured body") = Some(body);
                        let body = concat!(
                            "event: response.output_item.done\n",
                            "data: {\"item\":{\"id\":\"ig_1\",\"type\":\"image_generation_call\",\"result\":\"ZmFrZS1yZXNwb25zZXMtaW1hZ2U=\",\"revised_prompt\":\"青柠产品主体\"}}\n\n",
                            "event: response.completed\n",
                            "data: {\"response\":{\"id\":\"resp_1\"}}\n\n"
                        );
                        (StatusCode::OK, [("content-type", "text/event-stream")], body)
                    }
                }),
            );
            axum::serve(listener, app)
                .await
                .expect("serve responses api");
        });

        let result = execute_image_generation_task(
            temp_dir.path(),
            &created.task_id,
            &ImageGenerationRunnerConfig {
                endpoint: format!("http://{address}/v1/images/generations"),
                api_key: "test-key".to_string(),
            },
        )
        .await
        .expect("execute responses image task");

        assert_eq!(result.normalized_status, "succeeded");
        let result_value = result.record.result.as_ref().expect("result value");
        assert_eq!(
            result_value.get("executor_mode").and_then(Value::as_str),
            Some(IMAGE_EXECUTOR_MODE_RESPONSES_IMAGE_GENERATION)
        );
        assert_eq!(
            result_value
                .get("images")
                .and_then(Value::as_array)
                .and_then(|images| images.first())
                .and_then(|value| value.get("url"))
                .and_then(Value::as_str),
            Some("data:image/png;base64,ZmFrZS1yZXNwb25zZXMtaW1hZ2U=")
        );
        assert_eq!(
            result_value
                .get("responses")
                .and_then(Value::as_array)
                .and_then(|responses| responses.first())
                .and_then(|response| response.get("image_item_id"))
                .and_then(Value::as_str),
            Some("ig_1")
        );

        let body = captured_body
            .lock()
            .expect("lock captured body")
            .clone()
            .expect("captured body");
        assert_eq!(body.get("model").and_then(Value::as_str), Some("gpt-5.5"));
        assert_eq!(body.get("stream").and_then(Value::as_bool), Some(true));
        assert_eq!(
            body.pointer("/tools/0/type").and_then(Value::as_str),
            Some("image_generation")
        );
        assert_eq!(
            body.pointer("/tools/0/model").and_then(Value::as_str),
            Some("gpt-image-2")
        );

        server.abort();
    }

    #[test]
    fn responses_image_generation_endpoint_should_reuse_images_api_base() {
        assert_eq!(
            build_responses_image_generation_endpoint(
                "https://gateway.example.com/v1/images/generations"
            ),
            "https://gateway.example.com/v1/responses"
        );
        assert_eq!(
            build_responses_image_generation_endpoint(
                "https://gateway.example.com/proxy/images/generations?token=secret"
            ),
            "https://gateway.example.com/proxy/responses?token=secret"
        );
        assert_eq!(
            build_responses_image_generation_endpoint("https://gateway.example.com/v1/responses"),
            "https://gateway.example.com/v1/responses"
        );
    }

    #[tokio::test]
    async fn execute_image_generation_task_should_limit_parallel_single_image_requests() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created = write_task_artifact(
            temp_dir.path(),
            TaskType::ImageGenerate,
            Some("分镜任务".to_string()),
            json!({
                "prompt": "三国主要人物分镜",
                "size": "1024x1024",
                "count": 7,
                "provider_id": "custom-provider",
                "model": "gpt-images-2",
            }),
            TaskWriteOptions::default(),
        )
        .expect("create task");

        let request_count = Arc::new(AtomicUsize::new(0));
        let in_flight = Arc::new(AtomicUsize::new(0));
        let max_in_flight = Arc::new(AtomicUsize::new(0));

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image api");
        let address = listener.local_addr().expect("resolve address");
        let request_count_for_server = Arc::clone(&request_count);
        let in_flight_for_server = Arc::clone(&in_flight);
        let max_in_flight_for_server = Arc::clone(&max_in_flight);
        let server = tokio::spawn(async move {
            let app = Router::new().route(
                "/v1/images/generations",
                post(move |Json(body): Json<Value>| {
                    let request_count = Arc::clone(&request_count_for_server);
                    let in_flight = Arc::clone(&in_flight_for_server);
                    let max_in_flight = Arc::clone(&max_in_flight_for_server);
                    async move {
                        assert_eq!(body.get("n").and_then(Value::as_u64), Some(1));

                        let request_index = request_count.fetch_add(1, Ordering::SeqCst) + 1;
                        let current_in_flight = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                        max_in_flight.fetch_max(current_in_flight, Ordering::SeqCst);

                        tokio::time::sleep(Duration::from_millis(40)).await;

                        in_flight.fetch_sub(1, Ordering::SeqCst);
                        (
                            StatusCode::OK,
                            Json(json!({
                                "created": 1_717_200_000i64,
                                "data": [
                                    {
                                        "url": format!("https://example.com/storyboard-{request_index}.png"),
                                        "revised_prompt": format!("分镜 {request_index}")
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
            temp_dir.path(),
            &created.task_id,
            &ImageGenerationRunnerConfig {
                endpoint: format!("http://{address}/v1/images/generations"),
                api_key: "test-key".to_string(),
            },
        )
        .await
        .expect("execute image task");

        assert_eq!(result.normalized_status, "succeeded");
        assert_eq!(request_count.load(Ordering::SeqCst), 7);
        assert_eq!(max_in_flight.load(Ordering::SeqCst), 3);
        assert_eq!(
            result
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("requested_count"))
                .and_then(Value::as_u64),
            Some(7)
        );
        assert_eq!(
            result
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("received_count"))
                .and_then(Value::as_u64),
            Some(7)
        );
        assert_eq!(
            result
                .record
                .result
                .as_ref()
                .and_then(|value| value.get("images"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(7)
        );

        server.abort();
    }

    #[tokio::test]
    async fn execute_image_generation_task_should_preserve_storyboard_slot_prompts_and_order() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created = write_task_artifact(
            temp_dir.path(),
            TaskType::ImageGenerate,
            Some("三国主要人物分镜".to_string()),
            json!({
                "prompt": "三国主要人物，电影感九宫格分镜",
                "layout_hint": "storyboard_3x3",
                "count": 3,
                "provider_id": "custom-provider",
                "model": "gpt-image-2",
                "storyboard_slots": [
                    {
                        "slot_index": 1,
                        "slot_id": "storyboard-slot-1",
                        "label": "刘备亮相",
                        "prompt": "三国主要人物，电影感分镜，第1格，刘备单人亮相，中景，仁义领袖气质，汉末营帐背景",
                        "shot_type": "medium"
                    },
                    {
                        "slot_index": 2,
                        "slot_id": "storyboard-slot-2",
                        "label": "曹操压迫感",
                        "prompt": "三国主要人物，电影感分镜，第2格，曹操近景特写，压迫感强，冷色军帐与火光反差",
                        "shot_type": "close_up"
                    },
                    {
                        "slot_index": 3,
                        "slot_id": "storyboard-slot-3",
                        "label": "诸葛亮谋局",
                        "prompt": "三国主要人物，电影感分镜，第3格，诸葛亮执扇谋局，侧光半身像，桌上地图与烛火",
                        "shot_type": "portrait"
                    }
                ]
            }),
            TaskWriteOptions::default(),
        )
        .expect("create task");

        let received_prompts = Arc::new(Mutex::new(Vec::<String>::new()));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image api");
        let address = listener.local_addr().expect("resolve address");
        let received_prompts_for_server = Arc::clone(&received_prompts);
        let server = tokio::spawn(async move {
            let app = Router::new().route(
                "/v1/images/generations",
                post(move |Json(body): Json<Value>| {
                    let received_prompts = Arc::clone(&received_prompts_for_server);
                    async move {
                        let prompt = body
                            .get("prompt")
                            .and_then(Value::as_str)
                            .expect("request prompt")
                            .to_string();
                        received_prompts
                            .lock()
                            .expect("lock prompts")
                            .push(prompt.clone());

                        let (delay_ms, slug, revised_prompt) = if prompt.contains("刘备") {
                            (60, "liu-bei", "刘备亮相，中景，营帐背景".to_string())
                        } else if prompt.contains("曹操") {
                            (10, "cao-cao", "曹操近景特写，压迫感强".to_string())
                        } else {
                            (30, "zhuge-liang", "诸葛亮执扇谋局，侧光半身像".to_string())
                        };

                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;

                        (
                            StatusCode::OK,
                            Json(json!({
                                "created": 1_717_200_000i64,
                                "data": [
                                    {
                                        "url": format!("https://example.com/{slug}.png"),
                                        "revised_prompt": revised_prompt
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
            temp_dir.path(),
            &created.task_id,
            &ImageGenerationRunnerConfig {
                endpoint: format!("http://{address}/v1/images/generations"),
                api_key: "test-key".to_string(),
            },
        )
        .await
        .expect("execute storyboard task");

        let received_prompts = received_prompts.lock().expect("lock prompts").clone();
        assert_eq!(received_prompts.len(), 3);
        assert!(received_prompts
            .iter()
            .any(|prompt| prompt.contains("刘备")));
        assert!(received_prompts
            .iter()
            .any(|prompt| prompt.contains("曹操")));
        assert!(received_prompts
            .iter()
            .any(|prompt| prompt.contains("诸葛亮")));

        let images = result
            .record
            .result
            .as_ref()
            .and_then(|value| value.get("images"))
            .and_then(Value::as_array)
            .cloned()
            .expect("storyboard images");
        assert_eq!(images.len(), 3);
        assert_eq!(images[0]["slot_index"].as_u64(), Some(1));
        assert_eq!(images[1]["slot_index"].as_u64(), Some(2));
        assert_eq!(images[2]["slot_index"].as_u64(), Some(3));
        assert_eq!(images[0]["slot_label"].as_str(), Some("刘备亮相"));
        assert_eq!(images[1]["slot_label"].as_str(), Some("曹操压迫感"));
        assert_eq!(images[2]["slot_label"].as_str(), Some("诸葛亮谋局"));
        assert_eq!(
            images[0]["url"].as_str(),
            Some("https://example.com/liu-bei.png")
        );
        assert_eq!(
            images[1]["url"].as_str(),
            Some("https://example.com/cao-cao.png")
        );
        assert_eq!(
            images[2]["url"].as_str(),
            Some("https://example.com/zhuge-liang.png")
        );
        assert_eq!(
            result
                .record
                .progress
                .preview_slots
                .iter()
                .map(|slot| slot.status.as_str())
                .collect::<Vec<_>>(),
            vec!["complete", "complete", "complete"]
        );

        server.abort();
    }

    #[tokio::test]
    async fn execute_image_generation_task_should_mark_task_failed_when_service_rejects() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created = write_task_artifact(
            temp_dir.path(),
            TaskType::ImageGenerate,
            Some("青柠主视觉".to_string()),
            json!({
                "prompt": "未来感青柠实验室",
                "size": "1024x1024",
                "count": 1,
                "provider_id": "fal",
                "model": "fal-ai/nano-banana-pro",
            }),
            TaskWriteOptions::default(),
        )
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
            temp_dir.path(),
            &created.task_id,
            &ImageGenerationRunnerConfig {
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
