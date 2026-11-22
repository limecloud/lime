//! WaveSpeedAI 视频协议：提交、轮询与响应 envelope 校验。

use super::{
    mapping_error, provider_error, report_progress, send_json, summarize_provider_body,
    VideoProviderConfig, VideoProviderError, VideoProviderOutput, VideoProviderProgress,
    VideoProviderRequest,
};
use crate::lowering::build_wavespeed_video_generation_body;
use reqwest::Client;
use serde_json::{json, Map, Value};

/// WaveSpeedAI: POST /api/v3/{model} 返回 prediction id，再轮询
/// GET /api/v3/predictions/{id}/result。响应统一为 `{code, message, data}`，
/// HTTP 200 但 `code` 非 200 也视为失败。提交请求不重试，恢复时只轮询已持久化的 id。
pub(super) async fn execute<OnProgress, IsCancelled>(
    client: &Client,
    config: &VideoProviderConfig,
    request: &VideoProviderRequest,
    on_progress: &mut OnProgress,
    is_cancelled: &mut IsCancelled,
) -> Result<VideoProviderOutput, VideoProviderError>
where
    OnProgress: FnMut(VideoProviderProgress) -> Result<(), String>,
    IsCancelled: FnMut() -> bool,
{
    let mut start_response = None;
    let request_id = match request
        .resume_request_id
        .as_deref()
        .map(str::trim)
        .filter(|request_id| !request_id.is_empty())
    {
        Some(request_id) => request_id.to_string(),
        None => {
            let body =
                build_wavespeed_video_generation_body(&request.request).map_err(mapping_error)?;
            let response = send_json(
                client.post(config.endpoint.trim()).json(&body),
                config,
                "video_provider_start_failed",
                "start",
            )
            .await?;
            let request_id = wavespeed_data(&response, "start")?
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|request_id| !request_id.is_empty())
                .ok_or_else(|| {
                    provider_error(
                        "video_provider_request_id_missing",
                        "WaveSpeedAI 视频服务未返回 prediction id".to_string(),
                        false,
                        "start",
                        None,
                        None,
                    )
                })?
                .to_string();
            report_progress(
                on_progress,
                VideoProviderProgress::Started {
                    request_id: request_id.clone(),
                },
            )?;
            start_response = Some(response);
            request_id
        }
    };
    let poll_endpoint = wavespeed_poll_endpoint(&config.endpoint, &request_id)?;
    let started = tokio::time::Instant::now();

    loop {
        if is_cancelled() {
            return Err(VideoProviderError::cancelled());
        }
        if started.elapsed() >= config.overall_timeout {
            return Err(provider_error(
                "video_provider_poll_timeout",
                format!("WaveSpeedAI 视频生成超时 (prediction_id={request_id})"),
                true,
                "poll",
                None,
                Some("timeout".to_string()),
            ));
        }
        tokio::time::sleep(config.poll_interval).await;
        if is_cancelled() {
            return Err(VideoProviderError::cancelled());
        }

        let poll_response = send_json(
            client.get(&poll_endpoint),
            config,
            "video_provider_poll_failed",
            "poll",
        )
        .await?;
        let data = wavespeed_data(&poll_response, "poll")?;
        let status = data
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        report_progress(
            on_progress,
            VideoProviderProgress::Polling {
                request_id: request_id.clone(),
                status: status.clone(),
            },
        )?;

        match status.as_str() {
            "completed" => {
                let url = data
                    .get("outputs")
                    .and_then(Value::as_array)
                    .and_then(|outputs| outputs.iter().find_map(Value::as_str))
                    .map(str::trim)
                    .filter(|url| !url.is_empty())
                    .ok_or_else(|| {
                        provider_error(
                            "video_result_empty",
                            "WaveSpeedAI 视频任务完成但未返回视频 URL".to_string(),
                            false,
                            "result",
                            None,
                            Some("completed".to_string()),
                        )
                    })?;
                return Ok(VideoProviderOutput {
                    video: json!({ "url": url }),
                    response: json!({
                        "start": start_response,
                        "poll": poll_response,
                    }),
                    provider_request_id: Some(request_id),
                });
            }
            "failed" => {
                let detail = data
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|error| !error.is_empty())
                    .map(summarize_provider_body)
                    .unwrap_or_else(|| "unknown error".to_string());
                return Err(provider_error(
                    "video_provider_generation_failed",
                    format!("WaveSpeedAI 视频生成失败 (prediction_id={request_id}): {detail}"),
                    false,
                    "poll",
                    None,
                    Some("failed".to_string()),
                ));
            }
            _ => {}
        }
    }
}

fn wavespeed_data<'a>(
    response: &'a Value,
    stage: &'static str,
) -> Result<&'a Map<String, Value>, VideoProviderError> {
    if let Some(code) = response.get("code").and_then(Value::as_i64) {
        if code != 200 {
            let message = response
                .get("message")
                .and_then(Value::as_str)
                .map(summarize_provider_body)
                .unwrap_or_default();
            return Err(provider_error(
                "video_provider_envelope_error",
                format!("WaveSpeedAI 视频服务返回 code {code}: {message}"),
                false,
                stage,
                None,
                Some(code.to_string()),
            ));
        }
    }
    response
        .get("data")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            provider_error(
                "video_provider_response_invalid",
                "WaveSpeedAI 视频服务响应缺少 data".to_string(),
                false,
                stage,
                None,
                None,
            )
        })
}

fn wavespeed_poll_endpoint(endpoint: &str, request_id: &str) -> Result<String, VideoProviderError> {
    if !request_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(provider_error(
            "video_provider_request_id_invalid",
            "WaveSpeedAI prediction id 格式无效".to_string(),
            false,
            "poll",
            None,
            None,
        ));
    }
    let mut url = url::Url::parse(endpoint.trim()).map_err(|error| {
        provider_error(
            "video_endpoint_invalid",
            format!("WaveSpeedAI 视频 endpoint 无效: {error}"),
            false,
            "poll",
            None,
            None,
        )
    })?;
    let path = url.path().to_string();
    let prefix = path
        .find("/api/v3/")
        .map(|index| &path[..index])
        .unwrap_or("");
    url.set_path(&format!("{prefix}/api/v3/predictions/{request_id}/result"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wavespeed_poll_url_uses_prediction_result_path() {
        assert_eq!(
            wavespeed_poll_endpoint(
                "https://api.wavespeed.ai/api/v3/alibaba/wan-3.0/text-to-video",
                "pred_123-abc"
            )
            .expect("poll endpoint"),
            "https://api.wavespeed.ai/api/v3/predictions/pred_123-abc/result"
        );
        assert_eq!(
            wavespeed_poll_endpoint("https://proxy.example.test/ws/api/v3/vendor/model", "p1")
                .expect("poll endpoint behind path prefix"),
            "https://proxy.example.test/ws/api/v3/predictions/p1/result"
        );
        assert_eq!(
            wavespeed_poll_endpoint("https://api.wavespeed.ai/api/v3/m/x", "../x")
                .expect_err("path traversal id")
                .code,
            "video_provider_request_id_invalid"
        );
    }

    #[test]
    fn wavespeed_envelope_code_is_checked_even_on_http_success() {
        let error = wavespeed_data(
            &json!({ "code": 401, "message": "invalid api key", "data": null }),
            "start",
        )
        .expect_err("non-200 envelope code");
        assert_eq!(error.code, "video_provider_envelope_error");
        assert_eq!(error.provider_code.as_deref(), Some("401"));
        assert!(error.message.contains("invalid api key"));

        let response = json!({ "code": 200, "message": "success", "data": { "id": "p1" } });
        let data = wavespeed_data(&response, "start").expect("success envelope");
        assert_eq!(data.get("id"), Some(&json!("p1")));
    }
}
