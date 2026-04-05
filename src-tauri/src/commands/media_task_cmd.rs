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
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::commands::aster_agent_cmd::tool_runtime::media_cli_bridge;
use crate::config::GlobalConfigManagerState;

const IMAGE_TASK_RUNNER_WORKER_ID: &str = "lime-image-api-worker";
const IMAGE_TASK_RUNNER_TIMEOUT_SECS: u64 = 300;

static ACTIVE_IMAGE_TASK_EXECUTIONS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateImageGenerationTaskArtifactRequest {
    pub project_root_path: String,
    pub prompt: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub raw_text: Option<String>,
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTaskLookupRequest {
    pub project_root_path: String,
    pub task_ref: String,
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
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct MediaTaskListFilters {
    pub status: Option<String>,
    pub task_family: Option<String>,
    pub task_type: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct ListMediaTaskArtifactsResponse {
    pub success: bool,
    pub workspace_root: String,
    pub artifact_root: String,
    pub filters: MediaTaskListFilters,
    pub total: usize,
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
    Ok(count.min(8))
}

fn build_image_task_idempotency_key(
    request: &CreateImageGenerationTaskArtifactRequest,
    mode: &str,
    prompt: &str,
    count: u32,
    size: Option<&str>,
    usage: Option<&str>,
    reference_images: &[String],
    target_output_ref_id: Option<&str>,
) -> Result<String, String> {
    let fingerprint = json!({
        "session_id": normalize_optional_string(request.session_id.clone()),
        "project_id": normalize_optional_string(request.project_id.clone()),
        "content_id": normalize_optional_string(request.content_id.clone()),
        "entry_source": normalize_optional_string(request.entry_source.clone()),
        "mode": mode,
        "prompt": prompt,
        "size": size,
        "count": count,
        "usage": usage,
        "slot_id": normalize_optional_string(request.slot_id.clone()),
        "anchor_hint": normalize_optional_string(request.anchor_hint.clone()),
        "anchor_section_title": normalize_optional_string(request.anchor_section_title.clone()),
        "anchor_text": normalize_optional_string(request.anchor_text.clone()),
        "target_output_ref_id": target_output_ref_id,
        "reference_images": reference_images,
    });
    let serialized = serde_json::to_vec(&fingerprint)
        .map_err(|error| format!("序列化图片任务幂等指纹失败: {error}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&serialized);
    let digest = hasher.finalize();
    Ok(format!("image-task-{}", hex::encode(&digest[..16])))
}

#[derive(Debug, Clone)]
struct ImageGenerationRunnerConfig {
    endpoint: String,
    api_key: String,
}

#[derive(Debug, Clone)]
struct PreparedImageTaskInput {
    prompt: String,
    model: String,
    size: Option<String>,
    count: u32,
    style: Option<String>,
    provider_id: Option<String>,
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

fn prepare_image_task_input(task: &MediaTaskOutput) -> Result<PreparedImageTaskInput, String> {
    let payload = &task.record.payload;
    let prompt = read_payload_string(payload, &["prompt"])
        .ok_or_else(|| "图片任务缺少 prompt，无法继续执行".to_string())?;
    let count = read_payload_positive_u32(payload, &["count", "image_count"]).unwrap_or(1);

    Ok(PreparedImageTaskInput {
        prompt,
        model: read_payload_string(payload, &["model"]).unwrap_or_default(),
        size: read_payload_string(payload, &["size"]),
        count,
        style: read_payload_string(payload, &["style"]),
        provider_id: read_payload_string(payload, &["provider_id", "providerId"]),
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

fn emit_image_task_event(app: Option<&AppHandle>, output: &MediaTaskOutput) {
    emit_creation_task_event_if_needed(app, output);
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

async fn execute_image_generation_task(
    app: Option<AppHandle>,
    workspace_root: PathBuf,
    task_id: String,
    runner_config: ImageGenerationRunnerConfig,
) -> Result<MediaTaskOutput, String> {
    let current = load_current_image_task(&workspace_root, &task_id)?;
    if matches!(
        current.normalized_status.as_str(),
        "cancelled" | "failed" | "succeeded" | "partial"
    ) {
        return Ok(current);
    }

    let queued_output = if current.normalized_status == "pending" {
        let output = patch_image_task(
            &workspace_root,
            &task_id,
            TaskArtifactPatch {
                status: Some("queued".to_string()),
                progress: Some(build_task_progress(
                    "queued",
                    "图片任务已进入队列，等待图片服务响应。".to_string(),
                    Some(0),
                )),
                current_attempt_worker_id: Some(Some(IMAGE_TASK_RUNNER_WORKER_ID.to_string())),
                ..TaskArtifactPatch::default()
            },
        )?;
        emit_image_task_event(app.as_ref(), &output);
        output
    } else {
        current
    };

    if queued_output.normalized_status == "cancelled" {
        return Ok(queued_output);
    }

    let prepared_input = prepare_image_task_input(&queued_output).map_err(|message| {
        let task_error = build_task_error("invalid_image_task_payload", message, false, "payload");
        let _ = mark_image_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
        "图片任务 payload 无法执行".to_string()
    })?;

    let running_output = patch_image_task(
        &workspace_root,
        &task_id,
        TaskArtifactPatch {
            status: Some("running".to_string()),
            progress: Some(build_task_progress(
                "running",
                "图片生成中，结果会自动回填到对话与画布。".to_string(),
                None,
            )),
            current_attempt_worker_id: Some(Some(IMAGE_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    emit_image_task_event(app.as_ref(), &running_output);

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(IMAGE_TASK_RUNNER_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let request_body = lime_core::models::openai::ImageGenerationRequest {
        prompt: prepared_input.prompt.clone(),
        model: prepared_input.model.clone(),
        n: prepared_input.count.max(1),
        size: prepared_input.size.clone(),
        response_format: "b64_json".to_string(),
        quality: None,
        style: prepared_input.style.clone(),
        user: Some(task_id.clone()),
    };

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
            let task_error = build_task_error(
                "image_request_failed",
                format!("调用图片服务失败: {error}"),
                true,
                "request",
            );
            let _ = mark_image_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
            format!("调用图片服务失败: {error}")
        })?;

    let status = response.status();
    let response_body_raw = response.text().await.map_err(|error| {
        let task_error = build_task_error(
            "image_response_read_failed",
            format!("读取图片服务响应失败: {error}"),
            false,
            "response",
        );
        let _ = mark_image_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
        format!("读取图片服务响应失败: {error}")
    })?;
    let response_body: Value = serde_json::from_str(&response_body_raw).map_err(|error| {
        let detail = summarize_response_body(&response_body_raw);
        let task_error = build_task_error(
            "image_response_parse_failed",
            format!("解析图片服务响应失败: {error}；{detail}"),
            false,
            "response",
        );
        let _ = mark_image_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
        format!("解析图片服务响应失败: {error}；{detail}")
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
        let task_error = build_task_error(
            error_code,
            error_message,
            status.is_server_error() || status.as_u16() == 429,
            "request",
        );
        return mark_image_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
    }

    let images = collect_generated_images(&response_body);
    if images.is_empty() {
        let task_error = build_task_error(
            "image_result_empty",
            "图片服务已返回成功，但没有可用的图片地址",
            false,
            "result",
        );
        return mark_image_task_failed(app.as_ref(), &workspace_root, &task_id, task_error);
    }

    let latest = load_current_image_task(&workspace_root, &task_id)?;
    if latest.normalized_status == "cancelled" {
        return Ok(latest);
    }

    let final_status = if images.len() < prepared_input.count as usize {
        "partial"
    } else {
        "succeeded"
    };
    let result_value = json!({
        "provider_id": prepared_input.provider_id,
        "model": if prepared_input.model.trim().is_empty() {
            None::<String>
        } else {
            Some(prepared_input.model.clone())
        },
        "size": prepared_input.size,
        "requested_count": prepared_input.count,
        "received_count": images.len(),
        "images": images,
        "response": response_body,
    });
    let success_message = if final_status == "partial" {
        format!("图片任务已返回部分结果，共生成 {} 张。", images.len())
    } else {
        format!("图片任务已完成，共生成 {} 张。", images.len())
    };
    let completed = patch_image_task(
        &workspace_root,
        &task_id,
        TaskArtifactPatch {
            status: Some(final_status.to_string()),
            result: Some(Some(result_value)),
            last_error: Some(None),
            progress: Some(build_task_progress(
                final_status,
                success_message,
                Some(100),
            )),
            current_attempt_worker_id: Some(Some(IMAGE_TASK_RUNNER_WORKER_ID.to_string())),
            ..TaskArtifactPatch::default()
        },
    )?;
    emit_image_task_event(app.as_ref(), &completed);
    Ok(completed)
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

fn emit_creation_task_event_if_needed(app: Option<&AppHandle>, output: &MediaTaskOutput) {
    if let Some(app_handle) = app {
        media_cli_bridge::emit_media_creation_task_event(app_handle, output);
    }
}

pub(crate) fn create_image_generation_task_artifact_inner(
    request: CreateImageGenerationTaskArtifactRequest,
) -> Result<MediaTaskOutput, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let prompt = normalize_required_string(&request.prompt, "prompt")?;

    let mode = normalize_mode(request.mode.clone())?;
    let count = normalize_positive_count(request.count)?;
    let size = normalize_optional_string(request.size.clone());
    let aspect_ratio = normalize_optional_string(request.aspect_ratio.clone());
    let usage = normalize_optional_string(request.usage.clone());
    let style = normalize_optional_string(request.style.clone());
    let provider_id = normalize_optional_string(request.provider_id.clone());
    let model = normalize_optional_string(request.model.clone());
    let raw_text = normalize_optional_string(request.raw_text.clone());
    let session_id = normalize_optional_string(request.session_id.clone());
    let project_id = normalize_optional_string(request.project_id.clone());
    let content_id = normalize_optional_string(request.content_id.clone());
    let entry_source = normalize_optional_string(request.entry_source.clone());
    let requested_target = normalize_optional_string(request.requested_target.clone());
    let slot_id = normalize_optional_string(request.slot_id.clone());
    let anchor_hint = normalize_optional_string(request.anchor_hint.clone());
    let anchor_section_title = normalize_optional_string(request.anchor_section_title.clone());
    let anchor_text = normalize_optional_string(request.anchor_text.clone());
    let target_output_id = normalize_optional_string(request.target_output_id.clone());
    let target_output_ref_id = normalize_optional_string(request.target_output_ref_id.clone());
    let normalized_reference_images = normalize_reference_images(request.reference_images.clone());

    let idempotency_key = build_image_task_idempotency_key(
        &request,
        &mode,
        &prompt,
        count,
        size.as_deref(),
        usage.as_deref(),
        &normalized_reference_images,
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
            "requested_target": requested_target,
            "slot_id": slot_id.clone(),
            "anchor_hint": anchor_hint,
            "anchor_section_title": anchor_section_title,
            "anchor_text": anchor_text,
            "target_output_id": target_output_id,
            "target_output_ref_id": target_output_ref_id,
            "reference_images": normalized_reference_images,
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
    let parsed_task_type = task_type_filter
        .as_deref()
        .map(|value| {
            value
                .parse::<MediaTaskType>()
                .map_err(|_| format!("不支持的 taskType: {value}"))
        })
        .transpose()?;
    let tasks = list_task_outputs(
        std::path::Path::new(project_root_path.as_str()),
        None,
        status_filter.as_deref(),
        task_family_filter.as_deref(),
        parsed_task_type,
        request.limit,
    )
    .map_err(|error| format!("列出媒体任务 artifact 失败: {error}"))?;

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
            limit: request.limit,
        },
        total: tasks.len(),
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
    emit_creation_task_event_if_needed(Some(&app), &output);
    start_image_generation_task_worker_if_needed(&app, &project_root_path, &output);
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
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;

    #[test]
    fn create_image_generation_task_artifact_inner_should_write_context_payload_and_idempotency() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let request = CreateImageGenerationTaskArtifactRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            prompt: "未来感青柠实验室".to_string(),
            title: Some("青柠主视觉".to_string()),
            mode: Some("variation".to_string()),
            raw_text: Some("@配图 变体 #img-1 未来感青柠实验室".to_string()),
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
        };

        let first = create_image_generation_task_artifact_inner(request).expect("create first");
        let second =
            create_image_generation_task_artifact_inner(CreateImageGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: "未来感青柠实验室".to_string(),
                title: Some("青柠主视觉".to_string()),
                mode: Some("variation".to_string()),
                raw_text: Some("@配图 变体 #img-1 未来感青柠实验室".to_string()),
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
            first.record.payload.get("reference_images"),
            Some(&json!(["https://example.com/reference-a.png"]))
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
    fn media_task_artifact_controls_should_share_same_task_file_protocol() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let created =
            create_image_generation_task_artifact_inner(CreateImageGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: "用于正文的未来感实验室配图".to_string(),
                title: Some("正文配图".to_string()),
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 用于正文的未来感实验室配图".to_string()),
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
                requested_target: Some("generate".to_string()),
                slot_id: Some("document-slot-2".to_string()),
                anchor_hint: Some("section_end".to_string()),
                anchor_section_title: Some("核心观点".to_string()),
                anchor_text: Some("这里是核心观点内容。".to_string()),
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
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
            limit: Some(10),
        })
        .expect("list tasks");
        assert_eq!(listed.total, 1);
        assert_eq!(listed.tasks[0].task_id, created.task_id);

        let cancelled = cancel_media_task_artifact_inner(MediaTaskLookupRequest {
            project_root_path: temp_dir.path().to_string_lossy().to_string(),
            task_ref: created.task_id.clone(),
        })
        .expect("cancel task");
        assert_eq!(cancelled.normalized_status, "cancelled");
        assert!(cancelled.record.cancelled_at.is_some());
    }

    #[test]
    fn create_image_generation_task_artifact_inner_should_create_new_task_after_cancelled_one() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let first =
            create_image_generation_task_artifact_inner(CreateImageGenerationTaskArtifactRequest {
                project_root_path: temp_dir.path().to_string_lossy().to_string(),
                prompt: "未来感青柠实验室".to_string(),
                title: Some("青柠主视觉".to_string()),
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 未来感青柠实验室".to_string()),
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
                requested_target: Some("generate".to_string()),
                slot_id: Some("document-slot-3".to_string()),
                anchor_hint: Some("section_end".to_string()),
                anchor_section_title: Some("结论".to_string()),
                anchor_text: Some("这里是结论段落。".to_string()),
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
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
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 未来感青柠实验室".to_string()),
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
                requested_target: Some("generate".to_string()),
                slot_id: Some("document-slot-3".to_string()),
                anchor_hint: Some("section_end".to_string()),
                anchor_section_title: Some("结论".to_string()),
                anchor_text: Some("这里是结论段落。".to_string()),
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
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
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 未来感青柠实验室".to_string()),
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
                requested_target: Some("generate".to_string()),
                slot_id: None,
                anchor_hint: None,
                anchor_section_title: None,
                anchor_text: None,
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
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
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 生成 未来感青柠实验室".to_string()),
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
                requested_target: Some("generate".to_string()),
                slot_id: None,
                anchor_hint: None,
                anchor_section_title: None,
                anchor_text: None,
                target_output_id: None,
                target_output_ref_id: None,
                reference_images: Vec::new(),
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
