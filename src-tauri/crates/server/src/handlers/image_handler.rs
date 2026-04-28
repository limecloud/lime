//! 图像生成 API 处理器
//!
//! 实现 OpenAI 兼容的 `/v1/images/generations` 端点，
//! 通过已配置的 API Key Provider 调用图像生成模型。
//!
//! # 功能
//! - 接收 OpenAI 格式的图像生成请求
//! - 调用 API Key Provider
//! - 返回 OpenAI 格式的响应
//!
//! # 需求覆盖
//! - 需求 1.1: 实现 `/v1/images/generations` 端点
//! - 需求 4.1: 验证请求参数
//! - 需求 4.2: 获取当前 API Key Provider
//! - 需求 4.3: 调用 Provider
//! - 需求 4.4: 转换响应格式

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};

use super::image_api_provider;
use crate::handlers::verify_api_key;
use crate::AppState;
use lime_core::models::openai::ImageGenerationRequest;

fn read_explicit_provider_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-provider-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

/// 处理图像生成请求
///
/// # 端点
/// `POST /v1/images/generations`
///
/// # 请求格式
/// ```json
/// {
///   "prompt": "A cute cat",
///   "model": "dall-e-3",
///   "n": 1,
///   "size": "1024x1024",
///   "response_format": "url"
/// }
/// ```
///
/// # 响应格式
/// ```json
/// {
///   "created": 1234567890,
///   "data": [
///     {
///       "url": "data:image/png;base64,...",
///       "revised_prompt": "A cute fluffy cat"
///     }
///   ]
/// }
/// ```
pub async fn handle_image_generation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ImageGenerationRequest>,
) -> Response {
    // 验证 API Key
    if let Err(e) = verify_api_key(&headers, &state.api_key).await {
        return e.into_response();
    }

    // 验证请求参数
    if request.prompt.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": {
                    "message": "prompt is required and cannot be empty",
                    "type": "invalid_request_error",
                    "code": "invalid_prompt"
                }
            })),
        )
            .into_response();
    }

    // 记录请求日志
    // 安全截取 prompt，避免 UTF-8 字符边界问题
    let prompt_preview: String = request.prompt.chars().take(50).collect();
    let prompt_display = if request.prompt.chars().count() > 50 {
        format!("{prompt_preview}...")
    } else {
        request.prompt.clone()
    };
    state.logs.write().await.add(
        "info",
        &format!(
            "[IMAGE] 收到图像生成请求: model={}, prompt={}, n={}, response_format={}",
            request.model, prompt_display, request.n, request.response_format
        ),
    );

    let explicit_provider_id = read_explicit_provider_id(&headers);

    match image_api_provider::try_generate_with_configured_provider(
        &state,
        &request,
        explicit_provider_id.as_deref(),
    )
    .await
    {
        Ok(Some(response)) => {
            state.logs.write().await.add(
                "info",
                &format!("[IMAGE] 图片服务生成成功: {} 张图片", response.data.len()),
            );
            return (StatusCode::OK, Json(response)).into_response();
        }
        Ok(None) => {
            state
                .logs
                .write()
                .await
                .add("debug", "[IMAGE] 图片服务未命中当前 API Key Provider 路由");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": {
                        "message": "No image-capable API Key Provider configured",
                        "type": "server_error",
                        "code": "no_image_provider"
                    }
                })),
            )
                .into_response();
        }
        Err(error) => {
            state
                .logs
                .write()
                .await
                .add("error", &format!("[IMAGE] 图片服务失败: {}", error.message));
            return (
                error.status,
                Json(serde_json::json!({
                    "error": {
                        "message": error.message,
                        "type": "server_error",
                        "code": error.code,
                    }
                })),
            )
                .into_response();
        }
    }
}
