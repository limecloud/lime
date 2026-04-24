use std::{collections::BTreeMap, time::Duration};

use axum::http::StatusCode;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures::StreamExt;
use lime_core::api_host_utils::{
    is_openai_responses_compatible_host, normalize_openai_compatible_api_host,
};
use lime_core::config::ConfigManager;
use lime_core::database::dao::api_key_provider::{
    ApiKeyProvider, ApiKeyProviderDao, ApiProviderType,
};
use lime_core::models::openai::{ImageData, ImageGenerationRequest, ImageGenerationResponse};
use lime_providers::providers::codex::CodexProvider;
use reqwest::{header::CONTENT_TYPE, Client};
use serde_json::{json, Value};

use crate::AppState;

const FAL_DEFAULT_HOST: &str = "https://fal.run";
const FAL_DEFAULT_MODEL: &str = "fal-ai/nano-banana-pro";
const FAL_QUEUE_DEFAULT_HOST: &str = "https://queue.fal.run";
const OPENAI_RESPONSES_IMAGE_ORCHESTRATOR_MODEL: &str = "gpt-5.4";
const IMAGE_PROVIDER_REQUEST_TIMEOUT_SECS: u64 = 240;
const FAL_QUEUE_TIMEOUT_SECS: u64 = 180;
const FAL_QUEUE_POLL_INTERVAL_MS: u64 = 1500;

pub(crate) struct ConfiguredImageProviderError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

struct ImageProviderRoutingConfig {
    provider_id: String,
    preferred_model_id: Option<String>,
    allow_fallback: bool,
    default_size: Option<String>,
    is_explicit: bool,
}

enum ConfiguredImageProviderKind {
    Fal,
    OpenAiCompatible,
}

#[derive(Debug)]
struct OpenAiImageEndpointError {
    message: String,
    is_endpoint_not_found: bool,
}

const IMAGE_MODEL_KEYWORDS: [&str; 20] = [
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

pub(crate) async fn try_generate_with_configured_provider(
    state: &AppState,
    request: &ImageGenerationRequest,
    explicit_provider_id: Option<&str>,
) -> Result<Option<ImageGenerationResponse>, ConfiguredImageProviderError> {
    let Some(routing) = load_image_provider_routing(explicit_provider_id) else {
        return Ok(None);
    };

    let db = state
        .db
        .as_ref()
        .ok_or_else(|| ConfiguredImageProviderError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "database_unavailable",
            message: "Database not available".to_string(),
        })?;

    let provider = match load_api_key_provider(db, &routing.provider_id) {
        Ok(Some(provider)) if provider.enabled => provider,
        Ok(Some(_)) | Ok(None) => {
            return handle_routing_failure(
                state,
                &routing,
                format!("默认图片服务 {} 当前不可用", routing.provider_id),
                "configured_provider_unavailable",
            )
        }
        Err(error) => {
            return handle_routing_failure(
                state,
                &routing,
                format!("读取默认图片服务失败: {error}"),
                "configured_provider_lookup_failed",
            )
        }
    };

    let provider_kind = match resolve_configured_image_provider_kind(&provider, request, &routing) {
        Some(kind) => kind,
        None => {
            return handle_routing_failure(
                state,
                &routing,
                format!(
                    "当前默认图片服务 {} 尚未接入 /v1/images/generations",
                    provider.id
                ),
                "configured_provider_not_supported",
            )
        }
    };

    let Some((key_id, api_key)) = state
        .api_key_service
        .get_next_api_key_entry(db, &provider.id)
        .map_err(|error| ConfiguredImageProviderError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "configured_provider_key_failed",
            message: format!("读取默认图片服务 API Key 失败: {error}"),
        })?
    else {
        return handle_routing_failure(
            state,
            &routing,
            format!("默认图片服务 {} 没有可用的 API Key", provider.id),
            "configured_provider_missing_key",
        );
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(IMAGE_PROVIDER_REQUEST_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| Client::new());
    let request_size = request
        .size
        .clone()
        .or_else(|| routing.default_size.clone())
        .unwrap_or_else(|| "1024x1024".to_string());

    state.logs.write().await.add(
        "info",
        &format!(
            "[IMAGE] 图片服务命中 API Provider: provider_id={}, kind={}, requested_model={}, size={}, explicit={}",
            provider.id,
            match provider_kind {
                ConfiguredImageProviderKind::Fal => "fal",
                ConfiguredImageProviderKind::OpenAiCompatible => "openai-images",
            },
            request.model,
            request_size,
            routing.is_explicit
        ),
    );

    let response = match provider_kind {
        ConfiguredImageProviderKind::Fal => {
            let request_model = resolve_fal_model(
                request.model.as_str(),
                routing.preferred_model_id.as_deref(),
            );
            match request_fal_images(
                &client,
                &provider.api_host,
                &api_key,
                &request.prompt,
                &request_model,
                &request_size,
                request.n.max(1),
            )
            .await
            {
                Ok(image_urls) => {
                    build_openai_response(&client, &image_urls, &request.response_format).await
                }
                Err(error) => Err(error),
            }
        }
        ConfiguredImageProviderKind::OpenAiCompatible => {
            let Some(request_model) = resolve_compatible_image_model(
                request.model.as_str(),
                routing.preferred_model_id.as_deref(),
                &provider.custom_models,
            ) else {
                return handle_routing_failure(
                    state,
                    &routing,
                    format!("默认图片服务 {} 缺少可用图片模型", provider.id),
                    "configured_provider_missing_model",
                );
            };

            request_openai_compatible_images(
                &client,
                &provider,
                &provider.api_host,
                &api_key,
                request,
                &request_model,
                &request_size,
            )
            .await
        }
    };

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            let _ = state.api_key_service.record_error(db, &key_id);
            return handle_routing_failure(
                state,
                &routing,
                format!("默认图片服务调用失败: {error}"),
                "configured_provider_request_failed",
            );
        }
    };

    let _ = state.api_key_service.record_usage(db, &key_id);

    Ok(Some(response))
}

fn handle_routing_failure(
    _state: &AppState,
    routing: &ImageProviderRoutingConfig,
    message: String,
    code: &'static str,
) -> Result<Option<ImageGenerationResponse>, ConfiguredImageProviderError> {
    if routing.allow_fallback {
        tracing::warn!("[IMAGE] 默认图片服务失败，允许回退: {}", message);
        return Ok(None);
    }

    Err(ConfiguredImageProviderError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        code,
        message,
    })
}

fn load_image_provider_routing(
    explicit_provider_id: Option<&str>,
) -> Option<ImageProviderRoutingConfig> {
    if let Some(provider_id) = explicit_provider_id
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
    {
        return Some(ImageProviderRoutingConfig {
            provider_id,
            preferred_model_id: None,
            allow_fallback: false,
            default_size: None,
            is_explicit: true,
        });
    }

    let config_path = ConfigManager::default_config_path();
    let manager = ConfigManager::load(&config_path).ok()?;
    let image_preference = manager
        .config()
        .workspace_preferences
        .media_defaults
        .image
        .clone();
    let provider_id = image_preference.preferred_provider_id?.trim().to_string();

    if provider_id.is_empty() {
        return None;
    }

    Some(ImageProviderRoutingConfig {
        provider_id,
        preferred_model_id: normalize_optional_string(image_preference.preferred_model_id),
        allow_fallback: image_preference.allow_fallback,
        default_size: normalize_optional_string(manager.config().image_gen.default_size.clone()),
        is_explicit: false,
    })
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn load_api_key_provider(
    db: &lime_core::database::DbConnection,
    provider_id: &str,
) -> Result<Option<ApiKeyProvider>, String> {
    let conn = lime_core::database::lock_db(db)?;
    ApiKeyProviderDao::get_provider_by_id(&conn, provider_id).map_err(|error| error.to_string())
}

fn is_fal_provider(provider: &ApiKeyProvider) -> bool {
    if provider.provider_type == ApiProviderType::Fal || provider.id == "fal" {
        return true;
    }

    let normalized_host = provider.api_host.trim().to_ascii_lowercase();
    normalized_host.contains("fal.run") || normalized_host.contains("queue.fal.run")
}

fn resolve_configured_image_provider_kind(
    provider: &ApiKeyProvider,
    request: &ImageGenerationRequest,
    routing: &ImageProviderRoutingConfig,
) -> Option<ConfiguredImageProviderKind> {
    if is_fal_provider(provider) {
        return Some(ConfiguredImageProviderKind::Fal);
    }

    if supports_openai_image_provider(provider)
        && resolve_compatible_image_model(
            request.model.as_str(),
            routing.preferred_model_id.as_deref(),
            &provider.custom_models,
        )
        .is_some()
    {
        return Some(ConfiguredImageProviderKind::OpenAiCompatible);
    }

    None
}

fn supports_openai_image_provider(provider: &ApiKeyProvider) -> bool {
    matches!(
        provider.effective_provider_type(),
        ApiProviderType::Openai
            | ApiProviderType::OpenaiResponse
            | ApiProviderType::Codex
            | ApiProviderType::NewApi
            | ApiProviderType::Gateway
    )
}

fn resolve_compatible_image_model(
    request_model: &str,
    preferred_model_id: Option<&str>,
    custom_models: &[String],
) -> Option<String> {
    let normalized_request_model = request_model.trim();
    if looks_like_image_generation_model(normalized_request_model) {
        return Some(normalized_request_model.to_string());
    }

    if let Some(preferred_model) = preferred_model_id
        .map(str::trim)
        .filter(|value| looks_like_image_generation_model(value))
    {
        return Some(preferred_model.to_string());
    }

    custom_models
        .iter()
        .map(|model| model.trim())
        .find(|model| looks_like_image_generation_model(model))
        .map(|model| model.to_string())
}

fn looks_like_image_generation_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    !normalized.is_empty()
        && IMAGE_MODEL_KEYWORDS
            .iter()
            .any(|keyword| normalized.contains(keyword))
}

fn build_openai_images_url(api_host: &str) -> String {
    let normalized_host = normalize_openai_compatible_api_host(api_host);
    let trimmed = normalized_host.trim().trim_end_matches('/');
    let normalized = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if trimmed.is_empty() {
        "https://api.openai.com".to_string()
    } else {
        format!("https://{trimmed}")
    };

    let has_version = normalized
        .rsplit('/')
        .next()
        .map(|segment| {
            segment.starts_with('v')
                && segment.len() >= 2
                && segment[1..].chars().all(|char| char.is_ascii_digit())
        })
        .unwrap_or(false);

    if has_version {
        format!("{normalized}/images/generations")
    } else {
        format!("{normalized}/v1/images/generations")
    }
}

fn build_openai_image_request_payload(
    request: &ImageGenerationRequest,
    model: &str,
    request_size: &str,
) -> Value {
    let mut payload = json!({
        "model": model,
        "prompt": request.prompt.trim(),
        "n": request.n.max(1),
        "response_format": request.response_format,
        "size": request_size,
    });

    if let Some(quality) = request
        .quality
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        payload["quality"] = Value::String(quality.to_string());
    }

    if let Some(style) = request
        .style
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        payload["style"] = Value::String(style.to_string());
    }

    if let Some(user) = request
        .user
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        payload["user"] = Value::String(user.to_string());
    }

    payload
}

fn build_openai_responses_image_request_payload(
    request: &ImageGenerationRequest,
    orchestration_model: &str,
    image_model: &str,
    request_size: &str,
) -> Value {
    let tool_model = normalize_openai_responses_image_tool_model(image_model);
    // 一些 Codex/OpenAI relay 对 n 字段兼容性较差，默认依赖上游单图默认值。
    let mut tool = json!({
        "type": "image_generation",
        "model": tool_model,
        "output_format": "png",
    });

    if !request_size.trim().is_empty() {
        tool["size"] = Value::String(request_size.trim().to_string());
    }

    json!({
        "model": orchestration_model,
        "input": build_openai_responses_image_input(request),
        "tools": [tool],
        "stream": true,
    })
}

fn build_openai_responses_image_input(request: &ImageGenerationRequest) -> String {
    let prompt = request.prompt.trim();
    let count = request.n.max(1);
    if count <= 1 {
        return prompt.to_string();
    }

    format!(
        concat!(
            "你是一名图片生成编排器。请调用 image_generation 工具恰好 {count} 次，",
            "每次只生成 1 张独立图片。\n",
            "- 不要只调用一次工具。\n",
            "- 不要把多张图片拼成一张拼贴、九宫格、海报或联系单。\n",
            "- 所有图片要保持同一主题与风格，但每张图都必须能单独使用，并且构图、主体或镜头要有变化。\n",
            "- 如果原始要求里包含多个角色、物体或场景，请把它们合理分配到不同图片里，不要全部塞进同一张。\n",
            "- 最终只返回工具结果，不要额外输出解释文本。\n\n",
            "原始创作要求：{prompt}"
        ),
        count = count,
        prompt = prompt,
    )
}

fn normalize_openai_responses_image_tool_model(model: &str) -> String {
    let trimmed = model.trim();
    if let Some(version) = trimmed.strip_prefix("gpt-images-") {
        return format!("gpt-image-{version}");
    }

    trimmed.to_string()
}

fn resolve_openai_responses_image_orchestration_model(
    provider: &ApiKeyProvider,
    image_model: &str,
) -> String {
    let trimmed = image_model.trim();
    if !trimmed.is_empty() && !looks_like_image_generation_model(trimmed) {
        return trimmed.to_string();
    }

    provider
        .custom_models
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .find(|candidate| !candidate.is_empty() && !looks_like_image_generation_model(candidate))
        .map(ToString::to_string)
        .unwrap_or_else(|| OPENAI_RESPONSES_IMAGE_ORCHESTRATOR_MODEL.to_string())
}

fn should_prefer_openai_responses_image_api(provider: &ApiKeyProvider) -> bool {
    matches!(
        provider.effective_provider_type(),
        ApiProviderType::OpenaiResponse | ApiProviderType::Codex
    ) || is_openai_responses_compatible_host(&provider.api_host)
}

fn is_not_found_status(status: StatusCode, body: &str) -> bool {
    if status == StatusCode::NOT_FOUND {
        return true;
    }

    let normalized = body.to_ascii_lowercase();
    normalized.contains("not found")
        || normalized.contains("page not found")
        || body.contains("请求的接口不存在")
}

fn build_openai_responses_data_url(output_format: Option<&str>, b64: &str) -> String {
    let mime = match output_format
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("png")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    };

    format!("data:{mime};base64,{b64}")
}

fn buffer_contains_responses_event(buffer: &str, event_name: &str) -> bool {
    buffer.contains(event_name) || buffer.contains(&format!("event: {event_name}"))
}

fn try_finalize_openai_responses_image_stream(
    buffer: &str,
    response_format: &str,
    expected_count: usize,
) -> Result<Option<ImageGenerationResponse>, String> {
    let has_completed = buffer_contains_responses_event(buffer, "response.completed");
    let has_output_item_done = buffer_contains_responses_event(buffer, "response.output_item.done");

    if !has_completed && !has_output_item_done {
        return Ok(None);
    }

    let parsed = normalize_openai_responses_image_sse(buffer, response_format)?;
    let expected = expected_count.max(1);

    if has_completed || parsed.data.len() >= expected {
        return Ok(Some(parsed));
    }

    Ok(None)
}

fn try_extract_partial_openai_responses_images(
    buffer: &str,
    response_format: &str,
) -> Result<Option<ImageGenerationResponse>, String> {
    if !buffer_contains_responses_event(buffer, "response.output_item.done") {
        return Ok(None);
    }

    let parsed = normalize_openai_responses_image_sse(buffer, response_format)?;
    if parsed.data.is_empty() {
        return Ok(None);
    }

    Ok(Some(parsed))
}

fn normalize_openai_responses_image_payload(
    payload: &Value,
    response_format: &str,
) -> Result<ImageGenerationResponse, String> {
    let created_at = payload
        .get("created_at")
        .and_then(Value::as_i64)
        .unwrap_or_else(|| chrono::Utc::now().timestamp());
    let mut data = Vec::new();

    if let Some(items) = payload.get("output").and_then(Value::as_array) {
        for item in items {
            if item.get("type").and_then(Value::as_str) != Some("image_generation_call") {
                continue;
            }

            let revised_prompt = item
                .get("revised_prompt")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());
            let output_format = item
                .get("output_format")
                .and_then(Value::as_str)
                .map(|value| value.to_string());
            let b64 = item
                .get("result")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .or_else(|| {
                    item.get("partial_image_b64")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(|value| value.to_string())
                });

            let Some(b64) = b64 else {
                continue;
            };

            if response_format == "b64_json" {
                data.push(ImageData {
                    b64_json: Some(b64),
                    url: None,
                    revised_prompt,
                });
            } else {
                data.push(ImageData {
                    b64_json: None,
                    url: Some(build_openai_responses_data_url(
                        output_format.as_deref(),
                        &b64,
                    )),
                    revised_prompt,
                });
            }
        }
    }

    if data.is_empty() {
        return Err("Responses 图片接口未返回可解析图片字段".to_string());
    }

    Ok(ImageGenerationResponse {
        created: created_at,
        data,
    })
}

fn normalize_openai_responses_image_sse(
    body: &str,
    response_format: &str,
) -> Result<ImageGenerationResponse, String> {
    #[derive(Debug)]
    struct ParsedSseEvent {
        event: Option<String>,
        data: String,
    }

    fn parse_sse_events(body: &str) -> Vec<ParsedSseEvent> {
        let mut events = Vec::new();
        let mut current_event: Option<String> = None;
        let mut data_lines: Vec<String> = Vec::new();

        let flush_event = |events: &mut Vec<ParsedSseEvent>,
                           current_event: &mut Option<String>,
                           data_lines: &mut Vec<String>| {
            if current_event.is_none() && data_lines.is_empty() {
                return;
            }
            events.push(ParsedSseEvent {
                event: current_event.take(),
                data: data_lines.join("\n"),
            });
            data_lines.clear();
        };

        for raw_line in body.lines() {
            let line = raw_line.trim_end();
            if line.trim().is_empty() {
                flush_event(&mut events, &mut current_event, &mut data_lines);
                continue;
            }

            let trimmed = line.trim_start();
            if let Some(value) = trimmed.strip_prefix("event:") {
                current_event = Some(value.trim().to_string());
                continue;
            }

            if let Some(value) = trimmed.strip_prefix("data:") {
                data_lines.push(value.trim_start().to_string());
            }
        }

        flush_event(&mut events, &mut current_event, &mut data_lines);
        events
    }

    fn upsert_openai_responses_image_output(
        latest_partial_images: &mut BTreeMap<usize, Value>,
        output_index: usize,
        output_item: &Value,
    ) {
        let mut merged = latest_partial_images
            .remove(&output_index)
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();

        if let Some(record) = output_item.as_object() {
            for (key, value) in record {
                if key == "type"
                    && value.as_str() == Some("response.image_generation_call.partial_image")
                {
                    continue;
                }
                merged.insert(key.clone(), value.clone());
            }
        }

        merged.insert(
            "type".to_string(),
            Value::String("image_generation_call".to_string()),
        );
        latest_partial_images.insert(output_index, Value::Object(merged));
    }

    let mut latest_partial_images: BTreeMap<usize, Value> = BTreeMap::new();
    let mut completed_response: Option<Value> = None;

    for sse_event in parse_sse_events(body) {
        let data = sse_event.data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }

        let Ok(event) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        let event_type = event
            .get("type")
            .and_then(Value::as_str)
            .or(sse_event.event.as_deref());

        match event_type {
            Some("response.image_generation_call.partial_image") => {
                let output_index = event
                    .get("output_index")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as usize;
                upsert_openai_responses_image_output(
                    &mut latest_partial_images,
                    output_index,
                    &event,
                );
            }
            Some("response.output_item.done") => {
                let item = event.get("item");
                let is_image_generation_item = item
                    .and_then(|value| value.get("type"))
                    .and_then(Value::as_str)
                    == Some("image_generation_call")
                    || item.and_then(|value| value.get("result")).is_some()
                    || item
                        .and_then(|value| value.get("partial_image_b64"))
                        .is_some();
                if is_image_generation_item {
                    let output_index = event
                        .get("output_index")
                        .and_then(Value::as_u64)
                        .unwrap_or(0) as usize;
                    upsert_openai_responses_image_output(
                        &mut latest_partial_images,
                        output_index,
                        item.unwrap_or(&Value::Null),
                    );
                }
            }
            Some("response.completed") => {
                completed_response = event
                    .get("response")
                    .cloned()
                    .or_else(|| Some(event.clone()));
            }
            _ => {}
        }
    }

    if !latest_partial_images.is_empty() {
        let created_at = completed_response
            .as_ref()
            .and_then(|response| response.get("created_at"))
            .and_then(Value::as_i64)
            .unwrap_or_else(|| chrono::Utc::now().timestamp());
        let output = latest_partial_images.into_values().collect::<Vec<_>>();
        return normalize_openai_responses_image_payload(
            &json!({
                "created_at": created_at,
                "output": output,
            }),
            response_format,
        );
    }

    if let Some(response) = completed_response {
        return normalize_openai_responses_image_payload(&response, response_format);
    }

    Err("Responses 图片接口未返回任何图片事件".to_string())
}

async fn request_openai_responses_images(
    client: &Client,
    provider: &ApiKeyProvider,
    api_host: &str,
    api_key: &str,
    request: &ImageGenerationRequest,
    image_model: &str,
    request_size: &str,
) -> Result<ImageGenerationResponse, OpenAiImageEndpointError> {
    let endpoint = CodexProvider::build_responses_url(api_host);
    let orchestration_model =
        resolve_openai_responses_image_orchestration_model(provider, image_model);
    let payload = build_openai_responses_image_request_payload(
        request,
        &orchestration_model,
        image_model,
        request_size,
    );
    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {api_key}"))
        .header(CONTENT_TYPE, "application/json")
        .header("Accept", "text/event-stream")
        .header("Accept-Encoding", "identity")
        .json(&payload)
        .send()
        .await
        .map_err(|error| OpenAiImageEndpointError {
            message: format!("OpenAI Responses 图片接口请求失败: {error}"),
            is_endpoint_not_found: false,
        })?;

    let status = response.status();
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let expected_count = request.n.max(1) as usize;

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                buffer.push_str(&String::from_utf8_lossy(&bytes));

                if !status.is_success() {
                    continue;
                }

                if let Ok(Some(parsed)) = try_finalize_openai_responses_image_stream(
                    &buffer,
                    &request.response_format,
                    expected_count,
                ) {
                    return Ok(parsed);
                }
            }
            Err(error) => {
                if let Ok(Some(parsed)) = try_finalize_openai_responses_image_stream(
                    &buffer,
                    &request.response_format,
                    expected_count,
                ) {
                    return Ok(parsed);
                }

                if let Ok(Some(parsed)) =
                    try_extract_partial_openai_responses_images(&buffer, &request.response_format)
                {
                    return Ok(parsed);
                }

                return Err(OpenAiImageEndpointError {
                    message: format!("OpenAI Responses 图片接口流读取失败: {error}"),
                    is_endpoint_not_found: false,
                });
            }
        }
    }

    if !status.is_success() {
        return Err(OpenAiImageEndpointError {
            is_endpoint_not_found: is_not_found_status(status, &buffer),
            message: format!(
                "OpenAI Responses 图片接口 HTTP {}: {}",
                status.as_u16(),
                summarize_fal_error_body(&buffer)
            ),
        });
    }

    if let Some(parsed) = try_finalize_openai_responses_image_stream(
        &buffer,
        &request.response_format,
        expected_count,
    )
    .map_err(|error| OpenAiImageEndpointError {
        message: format!("OpenAI Responses 图片接口解析失败: {error}"),
        is_endpoint_not_found: false,
    })? {
        return Ok(parsed);
    }

    if let Some(parsed) =
        try_extract_partial_openai_responses_images(&buffer, &request.response_format).map_err(
            |error| OpenAiImageEndpointError {
                message: format!("OpenAI Responses 图片接口解析失败: {error}"),
                is_endpoint_not_found: false,
            },
        )?
    {
        return Ok(parsed);
    }

    Err(OpenAiImageEndpointError {
        message: "OpenAI Responses 图片接口解析失败: 未收齐所需图片事件".to_string(),
        is_endpoint_not_found: false,
    })
}

fn resolve_fal_model(request_model: &str, preferred_model_id: Option<&str>) -> String {
    let trimmed = request_model.trim();
    if trimmed.is_empty() {
        return normalize_preferred_fal_model(preferred_model_id)
            .unwrap_or_else(|| FAL_DEFAULT_MODEL.to_string());
    }

    if !looks_like_fal_model(trimmed) {
        return normalize_preferred_fal_model(preferred_model_id)
            .unwrap_or_else(|| FAL_DEFAULT_MODEL.to_string());
    }

    normalize_fal_model(trimmed)
}

fn normalize_preferred_fal_model(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(normalize_fal_model)
}

fn looks_like_fal_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    normalized.starts_with("fal-ai/")
        || normalized.contains("nano-banana")
        || normalized.contains("flux")
        || normalized.contains("seedream")
        || normalized.contains("recraft")
        || normalized.contains("ideogram")
        || normalized.contains("fal")
}

fn normalize_fal_model(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return FAL_DEFAULT_MODEL.to_string();
    }

    if trimmed.starts_with("fal-ai/") {
        trimmed.to_string()
    } else {
        format!("fal-ai/{trimmed}")
    }
}

fn normalize_fal_api_host(api_host: &str) -> String {
    let trimmed = api_host.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return FAL_DEFAULT_HOST.to_string();
    }

    let normalized = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    match reqwest::Url::parse(&normalized) {
        Ok(url) if matches!(url.host_str(), Some("fal.run" | "queue.fal.run")) => {
            format!("{}://{}", url.scheme(), url.host_str().unwrap_or("fal.run"))
        }
        Ok(url) => url.to_string().trim_end_matches('/').to_string(),
        Err(_) => normalized,
    }
}

fn resolve_fal_queue_host(api_host: &str) -> String {
    let normalized = normalize_fal_api_host(api_host);
    match reqwest::Url::parse(&normalized) {
        Ok(url) if url.host_str() == Some("queue.fal.run") => {
            format!("{}://queue.fal.run", url.scheme())
        }
        Ok(url) if url.host_str() == Some("fal.run") => format!("{}://queue.fal.run", url.scheme()),
        _ => FAL_QUEUE_DEFAULT_HOST.to_string(),
    }
}

const FAL_SUPPORTED_ASPECT_RATIOS: [(&str, f64); 10] = [
    ("21:9", 21.0 / 9.0),
    ("16:9", 16.0 / 9.0),
    ("3:2", 3.0 / 2.0),
    ("4:3", 4.0 / 3.0),
    ("5:4", 5.0 / 4.0),
    ("1:1", 1.0),
    ("4:5", 4.0 / 5.0),
    ("3:4", 3.0 / 4.0),
    ("2:3", 2.0 / 3.0),
    ("9:16", 9.0 / 16.0),
];

fn size_to_aspect_ratio(size: &str) -> Option<String> {
    let (width_raw, height_raw) = size.split_once('x')?;
    let width = width_raw.parse::<u32>().ok()?;
    let height = height_raw.parse::<u32>().ok()?;
    if width == 0 || height == 0 {
        return None;
    }

    let gcd = greatest_common_divisor(width, height);
    let exact_ratio = format!("{}:{}", width / gcd, height / gcd);
    if FAL_SUPPORTED_ASPECT_RATIOS
        .iter()
        .any(|(label, _)| *label == exact_ratio)
    {
        return Some(exact_ratio);
    }

    let numeric_ratio = width as f64 / height as f64;
    let nearest = FAL_SUPPORTED_ASPECT_RATIOS
        .iter()
        .map(|(label, ratio)| (*label, (numeric_ratio - ratio).abs()))
        .min_by(|left, right| left.1.total_cmp(&right.1));

    match nearest {
        Some((label, diff)) if diff <= 0.08 => Some(label.to_string()),
        Some(_) => Some("auto".to_string()),
        None => None,
    }
}

fn greatest_common_divisor(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        let temp = right;
        right = left % right;
        left = temp;
    }
    left.max(1)
}

fn build_fal_payload(prompt: &str, size: &str, count: u32) -> Value {
    let mut payload = json!({
        "prompt": prompt.trim(),
        "num_images": count.max(1),
        "output_format": "png",
        "safety_tolerance": "4",
    });

    if let Some(aspect_ratio) = size_to_aspect_ratio(size) {
        payload["aspect_ratio"] = Value::String(aspect_ratio);
    }

    payload
}

async fn request_openai_compatible_images(
    client: &Client,
    provider: &ApiKeyProvider,
    api_host: &str,
    api_key: &str,
    request: &ImageGenerationRequest,
    model: &str,
    request_size: &str,
) -> Result<ImageGenerationResponse, String> {
    if should_prefer_openai_responses_image_api(provider) {
        return request_openai_responses_images(
            client,
            provider,
            api_host,
            api_key,
            request,
            model,
            request_size,
        )
        .await
        .map_err(|error| error.message);
    }

    let endpoint = build_openai_images_url(api_host);
    let payload = build_openai_image_request_payload(request, model, request_size);
    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {api_key}"))
        .header(CONTENT_TYPE, "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("OpenAI 图片接口请求失败: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("OpenAI 图片接口响应读取失败: {error}"))?;

    if !status.is_success() {
        let image_error = OpenAiImageEndpointError {
            is_endpoint_not_found: is_not_found_status(status, &body),
            message: format!(
                "OpenAI 图片接口 HTTP {}: {}",
                status.as_u16(),
                summarize_fal_error_body(&body)
            ),
        };

        if image_error.is_endpoint_not_found {
            match request_openai_responses_images(
                client,
                provider,
                api_host,
                api_key,
                request,
                model,
                request_size,
            )
            .await
            {
                Ok(response) => return Ok(response),
                Err(responses_error) => {
                    return Err(format!(
                        "{}；回退 Responses 后仍失败: {}",
                        image_error.message, responses_error.message
                    ))
                }
            }
        }

        return Err(image_error.message);
    }

    let payload = serde_json::from_str::<Value>(&body).map_err(|error| {
        format!(
            "OpenAI 图片接口 JSON 解析失败: {error}; body={}",
            preview_text(&body, 240)
        )
    })?;

    normalize_openai_compatible_image_response(client, &payload, &request.response_format).await
}

async fn normalize_openai_compatible_image_response(
    client: &Client,
    payload: &Value,
    response_format: &str,
) -> Result<ImageGenerationResponse, String> {
    let mut data = Vec::new();

    if let Some(items) = payload.get("data").and_then(Value::as_array) {
        for item in items {
            let revised_prompt = item
                .get("revised_prompt")
                .and_then(Value::as_str)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());
            let b64_json = item
                .get("b64_json")
                .and_then(Value::as_str)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());
            let image_url = item
                .get("url")
                .and_then(Value::as_str)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());

            if response_format == "b64_json" {
                if let Some(b64_json) = b64_json.clone() {
                    data.push(ImageData {
                        b64_json: Some(b64_json),
                        url: None,
                        revised_prompt,
                    });
                    continue;
                }

                if let Some(image_url) = image_url.clone() {
                    match download_image_as_base64(client, &image_url).await {
                        Ok(b64_json) => {
                            data.push(ImageData {
                                b64_json: Some(b64_json),
                                url: None,
                                revised_prompt,
                            });
                        }
                        Err(error) => {
                            tracing::warn!(
                                "[IMAGE] OpenAI 图片 URL 转 base64 失败，回退原始 URL: url={}, error={}",
                                image_url,
                                error
                            );
                            data.push(ImageData {
                                b64_json: None,
                                url: Some(image_url),
                                revised_prompt,
                            });
                        }
                    }
                    continue;
                }
            } else {
                if let Some(image_url) = image_url {
                    data.push(ImageData {
                        b64_json: None,
                        url: Some(image_url),
                        revised_prompt,
                    });
                    continue;
                }

                if let Some(b64_json) = b64_json {
                    data.push(ImageData {
                        b64_json: None,
                        url: Some(format!("data:image/png;base64,{b64_json}")),
                        revised_prompt,
                    });
                    continue;
                }
            }
        }
    }

    if !data.is_empty() {
        return Ok(ImageGenerationResponse {
            created: chrono::Utc::now().timestamp(),
            data,
        });
    }

    let image_urls = collect_image_urls(payload);
    if !image_urls.is_empty() {
        return build_openai_response(client, &image_urls, response_format).await;
    }

    Err("默认图片服务未返回可解析图片字段".to_string())
}

async fn request_fal_images(
    client: &Client,
    api_host: &str,
    api_key: &str,
    prompt: &str,
    model: &str,
    size: &str,
    count: u32,
) -> Result<Vec<String>, String> {
    let endpoint_model = model.trim().trim_start_matches('/');
    let sync_endpoint = format!(
        "{}/{}",
        normalize_fal_api_host(api_host).trim_end_matches('/'),
        endpoint_model
    );
    let payload = build_fal_payload(prompt, size, count);
    let sync_result = post_fal_json(client, &sync_endpoint, &payload, api_key).await;

    if let Ok(sync_response) = &sync_result {
        let urls = collect_image_urls(sync_response);
        if !urls.is_empty() {
            return Ok(urls.into_iter().take(count as usize).collect());
        }
    }

    let queue_error_context = sync_result
        .err()
        .unwrap_or_else(|| "Fal 同步接口未返回可解析图片，改走队列模式".to_string());
    tracing::warn!("[IMAGE] {}", queue_error_context);

    request_fal_queue_images(client, api_host, api_key, endpoint_model, &payload, count)
        .await
        .map_err(|queue_error| format!("{queue_error}; sync_context={queue_error_context}"))
}

async fn post_fal_json(
    client: &Client,
    endpoint: &str,
    payload: &Value,
    api_key: &str,
) -> Result<Value, String> {
    let response = client
        .post(endpoint)
        .header("Authorization", format!("Key {api_key}"))
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("Fal 请求失败: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Fal 响应读取失败: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "Fal HTTP {}: {}",
            status.as_u16(),
            summarize_fal_error_body(&body)
        ));
    }

    serde_json::from_str::<Value>(&body).map_err(|error| {
        format!(
            "Fal JSON 解析失败: {error}; body={}",
            preview_text(&body, 240)
        )
    })
}

async fn request_fal_queue_images(
    client: &Client,
    api_host: &str,
    api_key: &str,
    endpoint_model: &str,
    payload: &Value,
    count: u32,
) -> Result<Vec<String>, String> {
    let queue_endpoint = format!(
        "{}/{}",
        resolve_fal_queue_host(api_host).trim_end_matches('/'),
        endpoint_model
    );
    let submit = post_fal_json(client, &queue_endpoint, payload, api_key).await?;
    let mut urls = collect_image_urls(&submit);
    if !urls.is_empty() {
        return Ok(urls.into_iter().take(count as usize).collect());
    }

    let request_id = submit
        .get("request_id")
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut status_url = submit
        .get("status_url")
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut response_url = submit
        .get("response_url")
        .and_then(Value::as_str)
        .map(str::to_string);

    if let Some(request_id) = request_id {
        let request_base = format!(
            "{queue_endpoint}/requests/{}",
            urlencoding::encode(&request_id)
        );
        if status_url.is_none() {
            status_url = Some(format!("{request_base}/status"));
        }
        if response_url.is_none() {
            response_url = Some(format!("{request_base}/response"));
        }
    }

    let Some(status_url) = status_url else {
        return Err("Fal 队列提交成功，但缺少 status_url".to_string());
    };

    let deadline = tokio::time::Instant::now() + Duration::from_secs(FAL_QUEUE_TIMEOUT_SECS);
    while tokio::time::Instant::now() < deadline {
        let status_payload = get_fal_json(client, &status_url, api_key).await?;
        if let Some(next_response_url) = status_payload
            .get("response_url")
            .and_then(Value::as_str)
            .map(str::to_string)
        {
            response_url = Some(next_response_url);
        }

        let status = status_payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_uppercase();

        if status == "COMPLETED" {
            break;
        }

        if matches!(status.as_str(), "FAILED" | "ERROR" | "CANCELLED") {
            return Err(format!(
                "Fal 队列任务失败: {}",
                preview_text(&status_payload.to_string(), 240)
            ));
        }

        tokio::time::sleep(Duration::from_millis(FAL_QUEUE_POLL_INTERVAL_MS)).await;
    }

    let Some(response_url) = response_url else {
        return Err("Fal 队列完成后缺少 response_url".to_string());
    };

    let result_payload = get_fal_json(client, &response_url, api_key).await?;
    urls = collect_image_urls(&result_payload);
    if urls.is_empty() {
        return Err(format!(
            "Fal 队列结果中未找到图片地址: {}",
            preview_text(&result_payload.to_string(), 240)
        ));
    }

    Ok(urls.into_iter().take(count as usize).collect())
}

async fn get_fal_json(client: &Client, endpoint: &str, api_key: &str) -> Result<Value, String> {
    let response = client
        .get(endpoint)
        .header("Authorization", format!("Key {api_key}"))
        .send()
        .await
        .map_err(|error| format!("Fal GET 请求失败: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Fal GET 响应读取失败: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "Fal GET HTTP {}: {}",
            status.as_u16(),
            summarize_fal_error_body(&body)
        ));
    }

    serde_json::from_str::<Value>(&body).map_err(|error| {
        format!(
            "Fal GET JSON 解析失败: {error}; body={}",
            preview_text(&body, 240)
        )
    })
}

async fn build_openai_response(
    client: &Client,
    image_urls: &[String],
    response_format: &str,
) -> Result<ImageGenerationResponse, String> {
    if image_urls.is_empty() {
        return Err("默认图片服务未返回图片地址".to_string());
    }

    let mut data = Vec::with_capacity(image_urls.len());
    for image_url in image_urls {
        if response_format == "b64_json" {
            match download_image_as_base64(client, image_url).await {
                Ok(b64_json) => data.push(ImageData {
                    b64_json: Some(b64_json),
                    url: None,
                    revised_prompt: None,
                }),
                Err(error) => {
                    tracing::warn!(
                        "[IMAGE] 图片二次下载失败，回退原始 URL: url={}, error={}",
                        image_url,
                        error
                    );
                    data.push(ImageData {
                        b64_json: None,
                        url: Some(image_url.clone()),
                        revised_prompt: None,
                    });
                }
            }
        } else {
            data.push(ImageData {
                b64_json: None,
                url: Some(image_url.clone()),
                revised_prompt: None,
            });
        }
    }

    Ok(ImageGenerationResponse {
        created: chrono::Utc::now().timestamp(),
        data,
    })
}

async fn download_image_as_base64(client: &Client, image_url: &str) -> Result<String, String> {
    let response = client
        .get(image_url)
        .send()
        .await
        .map_err(|error| format!("下载图片失败: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("下载图片失败: HTTP {}", status.as_u16()));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取图片字节失败: {error}"))?;
    tracing::debug!(
        "[IMAGE] 默认图片服务下载成功: content_type={}, bytes={}",
        content_type,
        bytes.len()
    );
    Ok(BASE64.encode(bytes))
}

fn collect_image_urls(value: &Value) -> Vec<String> {
    let mut urls = Vec::new();
    collect_image_urls_inner(value, None, &mut urls);
    urls
}

fn should_skip_control_url_key(key: &str) -> bool {
    matches!(
        key,
        "status_url" | "statusUrl" | "response_url" | "responseUrl" | "cancel_url" | "cancelUrl"
    )
}

fn collect_image_urls_inner(value: &Value, parent_key: Option<&str>, urls: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            if parent_key.is_some_and(should_skip_control_url_key) {
                return;
            }
            let trimmed = text.trim();
            if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                push_unique(urls, trimmed.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_image_urls_inner(item, None, urls);
            }
        }
        Value::Object(map) => {
            for key in [
                "url",
                "uri",
                "href",
                "image",
                "image_url",
                "imageUrl",
                "image_uri",
                "imageUri",
                "file_url",
                "fileUrl",
                "download_url",
                "downloadUrl",
            ] {
                if let Some(Value::String(url)) = map.get(key) {
                    let trimmed = url.trim();
                    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                        push_unique(urls, trimmed.to_string());
                    }
                }
            }

            for (key, nested) in map {
                collect_image_urls_inner(nested, Some(key.as_str()), urls);
            }
        }
        _ => {}
    }
}

fn push_unique(urls: &mut Vec<String>, candidate: String) {
    if !urls.iter().any(|existing| existing == &candidate) {
        urls.push(candidate);
    }
}

fn summarize_fal_error_body(body: &str) -> String {
    let normalized = body.trim();
    if normalized.is_empty() {
        return "Fal 返回了空响应。".to_string();
    }

    if normalized.contains("aspect_ratio") {
        return "当前图片服务不支持这个画幅比例，请改用 21:9、16:9、3:2、4:3、5:4、1:1、4:5、3:4、2:3 或 9:16。".to_string();
    }

    if let Ok(parsed) = serde_json::from_str::<Value>(normalized) {
        if let Some(message) = parsed
            .get("message")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return message.to_string();
        }

        if let Some(message) = parsed
            .get("error")
            .and_then(Value::as_object)
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return message.to_string();
        }

        if let Some(message) = parsed
            .get("detail")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(Value::as_object)
            .and_then(|record| record.get("msg"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return message.to_string();
        }
    }

    preview_text(normalized, 240)
}

fn preview_text(text: &str, max_len: usize) -> String {
    let normalized = text.trim();
    let normalized_chars = normalized.chars().count();
    if normalized_chars <= max_len {
        return normalized.to_string();
    }
    let preview: String = normalized.chars().take(max_len).collect();
    format!("{preview}...")
}

#[cfg(test)]
mod tests {
    use super::{
        build_openai_images_url, build_openai_responses_image_request_payload, collect_image_urls,
        load_image_provider_routing, looks_like_image_generation_model, normalize_fal_api_host,
        normalize_openai_compatible_image_response, normalize_openai_responses_image_payload,
        normalize_openai_responses_image_sse, normalize_openai_responses_image_tool_model,
        request_openai_responses_images, resolve_compatible_image_model, resolve_fal_model,
        resolve_openai_responses_image_orchestration_model,
        should_prefer_openai_responses_image_api, size_to_aspect_ratio,
        try_extract_partial_openai_responses_images,
    };
    use async_stream::stream;
    use axum::{
        response::sse::{Event, Sse},
        routing::post,
        Router,
    };
    use chrono::Utc;
    use lime_core::database::dao::api_key_provider::{
        ApiKeyProvider, ApiProviderType, ProviderGroup,
    };
    use lime_core::models::openai::ImageGenerationRequest;
    use reqwest::Client;
    use serde_json::json;
    use std::{convert::Infallible, time::Duration};
    use tokio::net::TcpListener;

    #[test]
    fn normalize_fal_api_host_strips_builtin_path_suffix() {
        assert_eq!(
            normalize_fal_api_host("https://fal.run/fal-ai"),
            "https://fal.run"
        );
        assert_eq!(
            normalize_fal_api_host("https://queue.fal.run/fal-ai"),
            "https://queue.fal.run"
        );
    }

    #[test]
    fn resolve_fal_model_prefers_config_when_request_uses_openai_default() {
        assert_eq!(
            resolve_fal_model("dall-e-3", Some("fal-ai/nano-banana-pro")),
            "fal-ai/nano-banana-pro"
        );
        assert_eq!(
            resolve_fal_model("nano-banana-pro", None),
            "fal-ai/nano-banana-pro"
        );
    }

    #[test]
    fn size_to_aspect_ratio_maps_to_supported_fal_values() {
        assert_eq!(size_to_aspect_ratio("1024x1024"), Some("1:1".to_string()));
        assert_eq!(size_to_aspect_ratio("1792x1024"), Some("16:9".to_string()));
        assert_eq!(size_to_aspect_ratio("1024x1792"), Some("9:16".to_string()));
        assert_eq!(size_to_aspect_ratio("1000x100"), Some("auto".to_string()));
        assert_eq!(size_to_aspect_ratio("invalid"), None);
    }

    #[test]
    fn collect_image_urls_reads_nested_payloads() {
        let payload = json!({
            "images": [
                { "url": "https://example.com/a.png" },
                { "imageUrl": "https://example.com/b.png" }
            ],
            "nested": {
                "downloadUrl": "https://example.com/c.png"
            }
        });

        assert_eq!(
            collect_image_urls(&payload),
            vec![
                "https://example.com/a.png".to_string(),
                "https://example.com/b.png".to_string(),
                "https://example.com/c.png".to_string(),
            ]
        );
    }

    #[test]
    fn collect_image_urls_ignores_fal_queue_control_urls() {
        let payload = json!({
            "status_url": "https://queue.fal.run/fal-ai/nano-banana/requests/req-1/status",
            "response_url": "https://queue.fal.run/fal-ai/nano-banana/requests/req-1/response",
            "cancel_url": "https://queue.fal.run/fal-ai/nano-banana/requests/req-1/cancel",
            "data": [
                {
                    "url": "https://cdn.example.com/final-image.png"
                }
            ]
        });

        assert_eq!(
            collect_image_urls(&payload),
            vec!["https://cdn.example.com/final-image.png".to_string()]
        );
    }

    #[test]
    fn load_image_provider_routing_prefers_explicit_provider_without_fallback() {
        let routing = load_image_provider_routing(Some("fal")).expect("explicit provider routing");

        assert_eq!(routing.provider_id, "fal");
        assert_eq!(routing.preferred_model_id, None);
        assert_eq!(routing.default_size, None);
        assert!(!routing.allow_fallback);
        assert!(routing.is_explicit);
    }

    #[test]
    fn resolve_compatible_image_model_prefers_request_then_provider_defaults() {
        assert_eq!(
            resolve_compatible_image_model("gpt-images-2", Some("dall-e-3"), &[]),
            Some("gpt-images-2".to_string())
        );
        assert_eq!(
            resolve_compatible_image_model("gpt-5.2", Some("gpt-images-2"), &[]),
            Some("gpt-images-2".to_string())
        );
        assert_eq!(
            resolve_compatible_image_model(
                "gpt-5.2",
                None,
                &["gpt-images-2".to_string(), "gpt-5.2".to_string()],
            ),
            Some("gpt-images-2".to_string())
        );
        assert_eq!(
            resolve_compatible_image_model("claude-sonnet-4-5", Some("cogview-3-flash"), &[]),
            Some("cogview-3-flash".to_string())
        );
        assert_eq!(
            resolve_compatible_image_model(
                "claude-sonnet-4-5",
                None,
                &[
                    "black-forest-labs/FLUX.1-schnell".to_string(),
                    "glm-5".to_string(),
                ],
            ),
            Some("black-forest-labs/FLUX.1-schnell".to_string())
        );
        assert_eq!(resolve_compatible_image_model("gpt-5.2", None, &[]), None);
    }

    #[test]
    fn build_openai_images_url_reuses_existing_version_path() {
        assert_eq!(
            build_openai_images_url("https://airgate.k8ray.com/v1"),
            "https://airgate.k8ray.com/v1/images/generations"
        );
        assert_eq!(
            build_openai_images_url("https://api.openai.com"),
            "https://api.openai.com/v1/images/generations"
        );
    }

    #[tokio::test]
    async fn normalize_openai_compatible_image_response_supports_b64_and_url_modes() {
        let client = Client::builder().no_proxy().build().expect("client");
        let payload = json!({
            "data": [
                {
                    "b64_json": "dGVzdA==",
                    "revised_prompt": "refined prompt"
                }
            ]
        });

        let b64_response =
            normalize_openai_compatible_image_response(&client, &payload, "b64_json")
                .await
                .expect("b64 response");
        assert_eq!(b64_response.data.len(), 1);
        assert_eq!(b64_response.data[0].b64_json.as_deref(), Some("dGVzdA=="));
        assert_eq!(b64_response.data[0].url, None);
        assert_eq!(
            b64_response.data[0].revised_prompt.as_deref(),
            Some("refined prompt")
        );

        let url_response = normalize_openai_compatible_image_response(&client, &payload, "url")
            .await
            .expect("url response");
        assert_eq!(
            url_response.data[0].url.as_deref(),
            Some("data:image/png;base64,dGVzdA==")
        );
        assert_eq!(url_response.data[0].b64_json, None);
    }

    #[test]
    fn normalize_openai_responses_image_payload_supports_b64_and_url_modes() {
        let payload = json!({
            "created_at": 1_777_000_000i64,
            "output": [
                {
                    "type": "image_generation_call",
                    "result": "dGVzdA==",
                    "revised_prompt": "refined prompt",
                    "output_format": "png"
                }
            ]
        });

        let b64_response =
            normalize_openai_responses_image_payload(&payload, "b64_json").expect("b64 response");
        assert_eq!(b64_response.created, 1_777_000_000);
        assert_eq!(b64_response.data[0].b64_json.as_deref(), Some("dGVzdA=="));
        assert_eq!(b64_response.data[0].url, None);

        let url_response =
            normalize_openai_responses_image_payload(&payload, "url").expect("url response");
        assert_eq!(
            url_response.data[0].url.as_deref(),
            Some("data:image/png;base64,dGVzdA==")
        );
        assert_eq!(url_response.data[0].b64_json, None);
        assert_eq!(
            url_response.data[0].revised_prompt.as_deref(),
            Some("refined prompt")
        );
    }

    #[test]
    fn normalize_openai_responses_image_sse_reads_partial_image_events() {
        let sse = r#"
event: response.image_generation_call.partial_image
data: {"type":"response.image_generation_call.partial_image","output_index":0,"partial_image_b64":"dGVzdA==","revised_prompt":"refined prompt","output_format":"png"}

event: response.completed
data: {"type":"response.completed","response":{"created_at":1777000000,"output":[]}}
"#;

        let response =
            normalize_openai_responses_image_sse(sse, "b64_json").expect("sse image response");
        assert_eq!(response.data.len(), 1);
        assert_eq!(response.data[0].b64_json.as_deref(), Some("dGVzdA=="));
        assert_eq!(
            response.data[0].revised_prompt.as_deref(),
            Some("refined prompt")
        );
    }

    #[test]
    fn normalize_openai_responses_image_sse_reads_multiple_done_events() {
        let sse = r#"
event: response.output_item.done
data: {"type":"response.output_item.done","output_index":0,"item":{"type":"image_generation_call","result":"Zmlyc3Q=","revised_prompt":"first prompt","output_format":"png"}}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":1,"item":{"type":"image_generation_call","result":"c2Vjb25k","revised_prompt":"second prompt","output_format":"png"}}

event: response.completed
data: {"type":"response.completed","response":{"created_at":1777000001,"output":[]}}
"#;

        let response =
            normalize_openai_responses_image_sse(sse, "b64_json").expect("sse image response");
        assert_eq!(response.data.len(), 2);
        assert_eq!(response.data[0].b64_json.as_deref(), Some("Zmlyc3Q="));
        assert_eq!(response.data[1].b64_json.as_deref(), Some("c2Vjb25k"));
        assert_eq!(
            response.data[0].revised_prompt.as_deref(),
            Some("first prompt")
        );
        assert_eq!(
            response.data[1].revised_prompt.as_deref(),
            Some("second prompt")
        );
    }

    #[test]
    fn normalize_openai_responses_image_sse_uses_event_name_when_json_type_missing() {
        let sse = r#"
event: response.output_item.done
data: {"output_index":0,"item":{"type":"image_generation_call","result":"Zmlyc3Q=","revised_prompt":"first prompt","output_format":"png"}}

event: response.completed
data: {"response":{"created_at":1777000001,"output":[]}}
"#;

        let response =
            normalize_openai_responses_image_sse(sse, "b64_json").expect("sse image response");
        assert_eq!(response.data.len(), 1);
        assert_eq!(response.data[0].b64_json.as_deref(), Some("Zmlyc3Q="));
        assert_eq!(
            response.data[0].revised_prompt.as_deref(),
            Some("first prompt")
        );
    }

    #[test]
    fn normalize_openai_responses_image_sse_merges_multiline_data_blocks() {
        let sse = r#"
event: response.output_item.done
data: {"output_index":0,
data: "item":{"type":"image_generation_call","result":"Zmlyc3Q=","revised_prompt":"first prompt","output_format":"png"}}

event: response.completed
data: {"response":{"created_at":1777000001,"output":[]}}
"#;

        let response =
            normalize_openai_responses_image_sse(sse, "b64_json").expect("sse image response");
        assert_eq!(response.data.len(), 1);
        assert_eq!(response.data[0].b64_json.as_deref(), Some("Zmlyc3Q="));
    }

    #[test]
    fn normalize_openai_responses_image_tool_model_rewrites_gpt_images_alias() {
        assert_eq!(
            normalize_openai_responses_image_tool_model("gpt-images-2"),
            "gpt-image-2"
        );
        assert_eq!(
            normalize_openai_responses_image_tool_model("gpt-image-1"),
            "gpt-image-1"
        );
    }

    #[test]
    fn build_openai_responses_image_request_payload_uses_tool_model_and_omits_n() {
        let request = ImageGenerationRequest {
            model: "gpt-images-2".to_string(),
            prompt: "生成一个苹果".to_string(),
            n: 3,
            size: Some("1024x1024".to_string()),
            response_format: "b64_json".to_string(),
            quality: Some("high".to_string()),
            style: None,
            user: None,
        };

        let payload = build_openai_responses_image_request_payload(
            &request,
            "gpt-5.4",
            "gpt-images-2",
            "1024x1024",
        );
        let tool = payload["tools"][0].as_object().expect("tool object");

        assert_eq!(payload["model"].as_str(), Some("gpt-5.4"));
        let input = payload["input"].as_str().expect("responses input");
        assert!(input.contains("恰好 3 次"));
        assert!(input.contains("每次只生成 1 张独立图片"));
        assert!(input.contains("原始创作要求：生成一个苹果"));
        assert_eq!(
            tool.get("type").and_then(|value| value.as_str()),
            Some("image_generation")
        );
        assert_eq!(
            tool.get("model").and_then(|value| value.as_str()),
            Some("gpt-image-2")
        );
        assert_eq!(
            tool.get("size").and_then(|value| value.as_str()),
            Some("1024x1024")
        );
        assert_eq!(
            tool.get("output_format").and_then(|value| value.as_str()),
            Some("png")
        );
        assert!(tool.get("n").is_none());
        assert!(tool.get("quality").is_none());
    }

    #[test]
    fn build_openai_responses_image_request_payload_keeps_plain_prompt_for_single_image() {
        let request = ImageGenerationRequest {
            model: "gpt-images-2".to_string(),
            prompt: "生成一个苹果".to_string(),
            n: 1,
            size: Some("1024x1024".to_string()),
            response_format: "b64_json".to_string(),
            quality: None,
            style: None,
            user: None,
        };

        let payload = build_openai_responses_image_request_payload(
            &request,
            "gpt-5.4",
            "gpt-images-2",
            "1024x1024",
        );

        assert_eq!(payload["input"].as_str(), Some("生成一个苹果"));
    }

    #[test]
    fn resolve_openai_responses_image_orchestration_model_prefers_non_image_custom_model() {
        let now = Utc::now();
        let provider = ApiKeyProvider {
            id: "custom-openai-images".to_string(),
            name: "Custom".to_string(),
            provider_type: ApiProviderType::Openai,
            api_host: "https://gateway.example.com/codex".to_string(),
            is_system: false,
            group: ProviderGroup::Custom,
            enabled: true,
            sort_order: 0,
            api_version: None,
            project: None,
            location: None,
            region: None,
            custom_models: vec!["gpt-images-2".to_string(), "gpt-5.4".to_string()],
            prompt_cache_mode: None,
            created_at: now,
            updated_at: now,
        };

        assert_eq!(
            resolve_openai_responses_image_orchestration_model(&provider, "gpt-images-2"),
            "gpt-5.4"
        );
    }

    #[tokio::test]
    async fn request_openai_responses_images_waits_for_completed_event_before_returning() {
        async fn responses_handler() -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>>
        {
            let stream = stream! {
                yield Ok(Event::default().event("response.output_item.done").data(
                    r#"{"type":"response.output_item.done","output_index":0,"item":{"type":"image_generation_call","result":"Zmlyc3Q=","revised_prompt":"first prompt","output_format":"png"}}"#,
                ));
                tokio::time::sleep(Duration::from_millis(15)).await;
                yield Ok(Event::default().event("response.output_item.done").data(
                    r#"{"type":"response.output_item.done","output_index":1,"item":{"type":"image_generation_call","result":"c2Vjb25k","revised_prompt":"second prompt","output_format":"png"}}"#,
                ));
                tokio::time::sleep(Duration::from_millis(15)).await;
                yield Ok(Event::default().event("response.completed").data(
                    r#"{"type":"response.completed","response":{"created_at":1777000001,"output":[]}}"#,
                ));
            };

            Sse::new(stream)
        }

        let app = Router::new().route("/v1/responses", post(responses_handler));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind listener");
        let addr = listener.local_addr().expect("listener addr");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve test app");
        });

        let client = Client::builder().no_proxy().build().expect("client");
        let now = Utc::now();
        let provider = ApiKeyProvider {
            id: "custom-openai-images".to_string(),
            name: "Custom".to_string(),
            provider_type: ApiProviderType::Openai,
            api_host: format!("http://{addr}"),
            is_system: false,
            group: ProviderGroup::Custom,
            enabled: true,
            sort_order: 0,
            api_version: None,
            project: None,
            location: None,
            region: None,
            custom_models: vec!["gpt-images-2".to_string()],
            prompt_cache_mode: None,
            created_at: now,
            updated_at: now,
        };
        let request = ImageGenerationRequest {
            model: "gpt-images-2".to_string(),
            prompt: "生成两个苹果".to_string(),
            n: 2,
            size: Some("1024x1024".to_string()),
            response_format: "b64_json".to_string(),
            quality: None,
            style: None,
            user: None,
        };

        let response = request_openai_responses_images(
            &client,
            &provider,
            &format!("http://{addr}"),
            "test-key",
            &request,
            "gpt-images-2",
            "1024x1024",
        )
        .await
        .expect("responses image request");

        assert_eq!(response.data.len(), 2);
        assert_eq!(response.data[0].b64_json.as_deref(), Some("Zmlyc3Q="));
        assert_eq!(response.data[1].b64_json.as_deref(), Some("c2Vjb25k"));
    }

    #[tokio::test]
    async fn request_openai_responses_images_accepts_event_only_completion_markers() {
        async fn responses_handler() -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>>
        {
            let stream = stream! {
                yield Ok(Event::default().event("response.output_item.done").data(
                    r#"{"output_index":0,"item":{"type":"image_generation_call","result":"Zmlyc3Q=","revised_prompt":"first prompt","output_format":"png"}}"#,
                ));
                tokio::time::sleep(Duration::from_millis(15)).await;
                yield Ok(Event::default().event("response.completed").data(
                    r#"{"response":{"created_at":1777000001,"output":[]}}"#,
                ));
            };

            Sse::new(stream)
        }

        let app = Router::new().route("/v1/responses", post(responses_handler));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind listener");
        let addr = listener.local_addr().expect("listener addr");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve test app");
        });

        let client = Client::builder().no_proxy().build().expect("client");
        let now = Utc::now();
        let provider = ApiKeyProvider {
            id: "custom-openai-images".to_string(),
            name: "Custom".to_string(),
            provider_type: ApiProviderType::Openai,
            api_host: format!("http://{addr}"),
            is_system: false,
            group: ProviderGroup::Custom,
            enabled: true,
            sort_order: 0,
            api_version: None,
            project: None,
            location: None,
            region: None,
            custom_models: vec!["gpt-images-2".to_string()],
            prompt_cache_mode: None,
            created_at: now,
            updated_at: now,
        };
        let request = ImageGenerationRequest {
            model: "gpt-images-2".to_string(),
            prompt: "生成一个苹果".to_string(),
            n: 1,
            size: Some("1024x1024".to_string()),
            response_format: "b64_json".to_string(),
            quality: None,
            style: None,
            user: None,
        };

        let response = request_openai_responses_images(
            &client,
            &provider,
            &format!("http://{addr}"),
            "test-key",
            &request,
            "gpt-images-2",
            "1024x1024",
        )
        .await
        .expect("responses image request");

        assert_eq!(response.data.len(), 1);
        assert_eq!(response.data[0].b64_json.as_deref(), Some("Zmlyc3Q="));
    }

    #[tokio::test]
    async fn request_openai_responses_images_returns_after_expected_done_events_without_completed()
    {
        async fn responses_handler() -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>>
        {
            let stream = stream! {
                yield Ok(Event::default().event("response.output_item.done").data(
                    r#"{"type":"response.output_item.done","output_index":0,"item":{"type":"image_generation_call","result":"Zmlyc3Q=","revised_prompt":"first prompt","output_format":"png"}}"#,
                ));
                tokio::time::sleep(Duration::from_millis(15)).await;
                yield Ok(Event::default().event("response.output_item.done").data(
                    r#"{"type":"response.output_item.done","output_index":1,"item":{"type":"image_generation_call","result":"c2Vjb25k","revised_prompt":"second prompt","output_format":"png"}}"#,
                ));
                tokio::time::sleep(Duration::from_secs(5)).await;
                yield Ok(Event::default().event("keepalive").data(r#"{"type":"keepalive"}"#));
            };

            Sse::new(stream)
        }

        let app = Router::new().route("/v1/responses", post(responses_handler));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind listener");
        let addr = listener.local_addr().expect("listener addr");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve test app");
        });

        let client = Client::builder().no_proxy().build().expect("client");
        let now = Utc::now();
        let provider = ApiKeyProvider {
            id: "custom-openai-images".to_string(),
            name: "Custom".to_string(),
            provider_type: ApiProviderType::Openai,
            api_host: format!("http://{addr}"),
            is_system: false,
            group: ProviderGroup::Custom,
            enabled: true,
            sort_order: 0,
            api_version: None,
            project: None,
            location: None,
            region: None,
            custom_models: vec!["gpt-images-2".to_string()],
            prompt_cache_mode: None,
            created_at: now,
            updated_at: now,
        };
        let request = ImageGenerationRequest {
            model: "gpt-images-2".to_string(),
            prompt: "生成两个苹果".to_string(),
            n: 2,
            size: Some("1024x1024".to_string()),
            response_format: "b64_json".to_string(),
            quality: None,
            style: None,
            user: None,
        };

        let response = tokio::time::timeout(
            Duration::from_millis(250),
            request_openai_responses_images(
                &client,
                &provider,
                &format!("http://{addr}"),
                "test-key",
                &request,
                "gpt-images-2",
                "1024x1024",
            ),
        )
        .await
        .expect("responses image request should finish before keepalive")
        .expect("responses image request");

        assert_eq!(response.data.len(), 2);
        assert_eq!(response.data[0].b64_json.as_deref(), Some("Zmlyc3Q="));
        assert_eq!(response.data[1].b64_json.as_deref(), Some("c2Vjb25k"));
    }

    #[test]
    fn try_extract_partial_openai_responses_images_returns_done_images_without_completed() {
        let sse = r#"
event: response.output_item.done
data: {"type":"response.output_item.done","output_index":0,"item":{"type":"image_generation_call","result":"Zmlyc3Q=","revised_prompt":"first prompt","output_format":"png"}}
"#;

        let response = try_extract_partial_openai_responses_images(sse, "b64_json")
            .expect("partial extraction should parse")
            .expect("partial extraction should keep at least one image");

        assert_eq!(response.data.len(), 1);
        assert_eq!(response.data[0].b64_json.as_deref(), Some("Zmlyc3Q="));
    }

    #[test]
    fn should_prefer_openai_responses_image_api_for_generic_codex_base_path() {
        let now = Utc::now();
        let provider = ApiKeyProvider {
            id: "custom-openai-images".to_string(),
            name: "Custom OpenAI Images".to_string(),
            provider_type: ApiProviderType::Openai,
            api_host: "https://gateway.example.com/codex".to_string(),
            is_system: false,
            group: ProviderGroup::Custom,
            enabled: true,
            sort_order: 0,
            api_version: None,
            project: None,
            location: None,
            region: None,
            custom_models: vec!["gpt-images-2".to_string()],
            prompt_cache_mode: None,
            created_at: now,
            updated_at: now,
        };

        assert!(should_prefer_openai_responses_image_api(&provider));

        let standard_provider = ApiKeyProvider {
            api_host: "https://api.openai.com/v1".to_string(),
            ..provider
        };
        assert!(!should_prefer_openai_responses_image_api(
            &standard_provider
        ));
    }

    #[test]
    fn looks_like_image_generation_model_matches_supported_families() {
        assert!(looks_like_image_generation_model("gpt-images-2"));
        assert!(looks_like_image_generation_model("gpt-image-1"));
        assert!(looks_like_image_generation_model("dall-e-3"));
        assert!(looks_like_image_generation_model("cogview-3-flash"));
        assert!(looks_like_image_generation_model(
            "black-forest-labs/FLUX.1-schnell"
        ));
        assert!(looks_like_image_generation_model("nano-banana-pro"));
        assert!(!looks_like_image_generation_model("gpt-5.2"));
    }
}
