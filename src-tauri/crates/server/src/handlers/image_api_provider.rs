use std::time::Duration;

use axum::http::StatusCode;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use lime_core::config::ConfigManager;
use lime_core::database::dao::api_key_provider::{
    ApiKeyProvider, ApiKeyProviderDao, ApiProviderType,
};
use lime_core::models::openai::{ImageData, ImageGenerationRequest, ImageGenerationResponse};
use reqwest::{header::CONTENT_TYPE, Client};
use serde_json::{json, Value};

use crate::AppState;

const FAL_DEFAULT_HOST: &str = "https://fal.run";
const FAL_DEFAULT_MODEL: &str = "fal-ai/nano-banana-pro";
const FAL_QUEUE_DEFAULT_HOST: &str = "https://queue.fal.run";
const FAL_REQUEST_TIMEOUT_SECS: u64 = 180;
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

    if !is_fal_provider(&provider) {
        return handle_routing_failure(
            state,
            &routing,
            format!(
                "当前默认图片服务 {} 尚未接入 /v1/images/generations",
                provider.id
            ),
            "configured_provider_not_supported",
        );
    }

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
        .timeout(Duration::from_secs(FAL_REQUEST_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| Client::new());
    let request_size = request
        .size
        .clone()
        .or_else(|| routing.default_size.clone())
        .unwrap_or_else(|| "1024x1024".to_string());
    let request_model = resolve_fal_model(
        request.model.as_str(),
        routing.preferred_model_id.as_deref(),
    );

    state.logs.write().await.add(
        "info",
        &format!(
            "[IMAGE] 图片服务命中 API Provider: provider_id={}, model={}, size={}, explicit={}",
            provider.id, request_model, request_size, routing.is_explicit
        ),
    );

    let image_urls = match request_fal_images(
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
        Ok(urls) => urls,
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

    build_openai_response(&client, &image_urls, &request.response_format)
        .await
        .map(Some)
        .map_err(|error| ConfiguredImageProviderError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "configured_provider_response_failed",
            message: error,
        })
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
        collect_image_urls, load_image_provider_routing, normalize_fal_api_host, resolve_fal_model,
        size_to_aspect_ratio,
    };
    use serde_json::json;

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
}
