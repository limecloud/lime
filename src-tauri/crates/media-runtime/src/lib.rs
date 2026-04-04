use std::fs;
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;

use chrono::Utc;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

pub const DEFAULT_ARTIFACT_ROOT: &str = ".lime/tasks";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    ImageGenerate,
    CoverGenerate,
    VideoGenerate,
    BroadcastGenerate,
    UrlParse,
    Typesetting,
    ModalResourceSearch,
}

impl TaskType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ImageGenerate => "image_generate",
            Self::CoverGenerate => "cover_generate",
            Self::VideoGenerate => "video_generate",
            Self::BroadcastGenerate => "broadcast_generate",
            Self::UrlParse => "url_parse",
            Self::Typesetting => "typesetting",
            Self::ModalResourceSearch => "modal_resource_search",
        }
    }

    pub fn command_name(self) -> &'static str {
        match self {
            Self::ImageGenerate => "image",
            Self::CoverGenerate => "cover",
            Self::VideoGenerate => "video",
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
            | Self::CoverGenerate
            | Self::BroadcastGenerate
            | Self::UrlParse
            | Self::Typesetting
            | Self::ModalResourceSearch => "pending_submit",
        }
    }

    pub fn family(self) -> &'static str {
        match self {
            Self::ImageGenerate | Self::CoverGenerate => "image",
            Self::VideoGenerate => "video",
            Self::BroadcastGenerate | Self::UrlParse | Self::Typesetting => "document",
            Self::ModalResourceSearch => "resource",
        }
    }

    pub fn all() -> &'static [Self] {
        &[
            Self::ImageGenerate,
            Self::CoverGenerate,
            Self::VideoGenerate,
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
            "cover" | "cover_generate" => Ok(Self::CoverGenerate),
            "video" | "video_generate" => Ok(Self::VideoGenerate),
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
    pub label: Option<String>,
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
            value if value.contains("video") => "video".to_string(),
            value if value.contains("resource") => "resource".to_string(),
            "broadcast_generate" | "url_parse" | "typesetting" => "document".to_string(),
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
        relationships: TaskRelationships::default(),
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
}
