use model_provider::lowering::build_openai_images_generation_body;
use model_routing_core::{CanonicalRequest, ContentPart};
use serde_json::{json, Value};

use crate::{ImageGenerationRequestBodyFormat, ImageGenerationRunnerConfig, TaskErrorRecord};

use super::{
    build_image_provider_http_error, build_image_task_error, read_response_error_code,
    read_response_error_message, summarize_response_body, with_optional_bearer_auth,
    ImageGenerationRequestInput,
};

const AGNES_DEFAULT_SIZE_FOR_RATIO: &str = "2K";

pub(super) async fn request_single_image_generation(
    client: &reqwest::Client,
    runner_config: &ImageGenerationRunnerConfig,
    prepared_input: &ImageGenerationRequestInput,
    request_prompt: &str,
    task_id: &str,
) -> Result<(Value, Value), TaskErrorRecord> {
    let request_body = build_image_generation_request_body(
        prepared_input,
        request_prompt,
        1,
        task_id,
        runner_config.request_body_format,
    )?;

    let endpoint = image_endpoint_for_reference_images(
        &runner_config.endpoint,
        !prepared_input.reference_image_urls.is_empty(),
        runner_config.request_body_format,
    );
    let mut request_builder =
        with_optional_bearer_auth(client.post(&endpoint), &runner_config.api_key);
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

    if !status.is_success() {
        let response_body: Option<Value> = serde_json::from_str(&response_body_raw).ok();
        let provider_code = response_body
            .as_ref()
            .and_then(|body| read_response_error_code(body, &[&["error", "code"], &["code"]]));
        let error_message = response_body
            .as_ref()
            .and_then(|body| {
                read_response_error_message(body, &[&["error", "message"], &["message"]])
            })
            .unwrap_or_else(|| summarize_response_body(&response_body_raw));
        return Err(build_image_provider_http_error(
            status,
            provider_code,
            error_message,
            "request",
            None,
        ));
    }

    let response_body: Value = serde_json::from_str(&response_body_raw).map_err(|error| {
        let detail = summarize_response_body(&response_body_raw);
        build_image_task_error(
            "image_response_parse_failed",
            format!("解析图片服务响应失败: {error}；{detail}"),
            false,
            "response",
        )
    })?;

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

pub(super) fn build_openai_compatible_image_generation_llm_request(
    prepared_input: &ImageGenerationRequestInput,
    request_prompt: &str,
    task_id: &str,
    count: Option<u32>,
) -> Result<CanonicalRequest, TaskErrorRecord> {
    let mut provider_options = std::collections::BTreeMap::new();
    if let Some(count) = count {
        provider_options.insert("n".to_string(), json!(count.max(1)));
    }
    if let Some(size) = prepared_input
        .size
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        provider_options.insert("size".to_string(), json!(size));
    }
    provider_options.insert("response_format".to_string(), json!("b64_json"));
    provider_options.insert("user".to_string(), json!(task_id));
    if let Some(style) = prepared_input
        .style
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        provider_options.insert("style".to_string(), json!(style));
    }
    let mut request = CanonicalRequest::text(&prepared_input.model, request_prompt);
    request.provider_options = provider_options;
    let content = &mut request.messages[0].content;
    for image_url in &prepared_input.reference_image_urls {
        content.push(ContentPart::media(image_url, "image/*").map_err(|error| {
            build_image_task_error(
                "image_reference_invalid",
                format!("图片参考必须使用 URI 或 sidecar reference: {error}"),
                false,
                "request",
            )
        })?);
    }
    Ok(request)
}

fn build_image_generation_request_body(
    prepared_input: &ImageGenerationRequestInput,
    request_prompt: &str,
    request_count: u32,
    task_id: &str,
    request_body_format: ImageGenerationRequestBodyFormat,
) -> Result<Value, TaskErrorRecord> {
    if request_body_format == ImageGenerationRequestBodyFormat::AgnesImages {
        return Ok(build_agnes_image_generation_request_body(
            prepared_input,
            request_prompt,
        ));
    }

    let request = build_openai_compatible_image_generation_llm_request(
        prepared_input,
        request_prompt,
        task_id,
        Some(request_count.max(1)),
    )?;
    build_openai_images_generation_body(&prepared_input.model, &request).map_err(|error| {
        build_image_task_error(
            "image_request_mapping_failed",
            format!("构建图片生成请求失败: {error}"),
            false,
            "request",
        )
    })
}

fn build_agnes_image_generation_request_body(
    prepared_input: &ImageGenerationRequestInput,
    request_prompt: &str,
) -> Value {
    let mut body = serde_json::Map::new();
    body.insert("model".to_string(), json!(prepared_input.model));
    body.insert("prompt".to_string(), json!(request_prompt));
    let size_request = normalize_agnes_image_size_request(prepared_input.size.as_deref());
    if let Some(size) = size_request.size {
        body.insert("size".to_string(), json!(size));
    }
    if let Some(ratio) = size_request.ratio {
        body.insert("ratio".to_string(), json!(ratio));
    }

    let mut extra_body = serde_json::Map::new();
    extra_body.insert("response_format".to_string(), json!("url"));
    if !prepared_input.reference_image_urls.is_empty() {
        extra_body.insert(
            "image".to_string(),
            Value::Array(
                prepared_input
                    .reference_image_urls
                    .iter()
                    .map(|image_url| json!(image_url))
                    .collect(),
            ),
        );
    }
    body.insert("extra_body".to_string(), Value::Object(extra_body));

    Value::Object(body)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AgnesImageSizeRequest {
    size: Option<String>,
    ratio: Option<String>,
}

fn normalize_agnes_image_size_request(size: Option<&str>) -> AgnesImageSizeRequest {
    let Some(size) = size.map(str::trim).filter(|value| !value.is_empty()) else {
        return AgnesImageSizeRequest {
            size: None,
            ratio: None,
        };
    };

    if is_supported_image_aspect_ratio(size) {
        return AgnesImageSizeRequest {
            size: Some(AGNES_DEFAULT_SIZE_FOR_RATIO.to_string()),
            ratio: Some(size.to_string()),
        };
    }

    AgnesImageSizeRequest {
        size: Some(size.to_string()),
        ratio: None,
    }
}

fn is_supported_image_aspect_ratio(value: &str) -> bool {
    matches!(
        value.trim(),
        "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9" | "4:5" | "5:4"
    )
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

fn image_endpoint_for_reference_images(
    endpoint: &str,
    has_reference_images: bool,
    request_body_format: ImageGenerationRequestBodyFormat,
) -> String {
    if !has_reference_images || request_body_format == ImageGenerationRequestBodyFormat::AgnesImages
    {
        return endpoint.to_string();
    }

    let trimmed = endpoint.trim().trim_end_matches('/');
    let (base, query) = trimmed
        .split_once('?')
        .map(|(left, right)| (left, Some(right)))
        .unwrap_or((trimmed, None));
    let edit_base = if base.ends_with("/v1/images/generations") {
        format!(
            "{}/v1/images/edits",
            base.trim_end_matches("/v1/images/generations")
        )
    } else if base.ends_with("/images/generations") {
        format!(
            "{}/images/edits",
            base.trim_end_matches("/images/generations")
        )
    } else if base.ends_with("/v1/images/edits") || base.ends_with("/images/edits") {
        base.to_string()
    } else if base.ends_with("/v1") {
        format!("{base}/images/edits")
    } else {
        format!("{base}/v1/images/edits")
    };

    match query {
        Some(value) if !value.is_empty() => format!("{edit_base}?{value}"),
        _ => edit_base,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_endpoint_for_reference_images_uses_edit_endpoint() {
        assert_eq!(
            image_endpoint_for_reference_images(
                "https://gateway.test/v1/images/generations",
                true,
                ImageGenerationRequestBodyFormat::OpenaiImages
            ),
            "https://gateway.test/v1/images/edits"
        );
        assert_eq!(
            image_endpoint_for_reference_images(
                "https://gateway.test/v1?tenant=1",
                true,
                ImageGenerationRequestBodyFormat::OpenaiImages
            ),
            "https://gateway.test/v1/images/edits?tenant=1"
        );
        assert_eq!(
            image_endpoint_for_reference_images(
                "https://gateway.test/v1/images/generations",
                false,
                ImageGenerationRequestBodyFormat::OpenaiImages
            ),
            "https://gateway.test/v1/images/generations"
        );
        assert_eq!(
            image_endpoint_for_reference_images(
                "https://gateway.test/v1/images/generations",
                true,
                ImageGenerationRequestBodyFormat::AgnesImages
            ),
            "https://gateway.test/v1/images/generations"
        );
    }

    #[test]
    fn agnes_request_body_maps_ratio_size_to_official_size_and_ratio_fields() {
        let prepared_input = ImageGenerationRequestInput {
            model: "agnes-image-2.1-flash".to_string(),
            size: Some("16:9".to_string()),
            style: None,
            provider_id: Some("agnes".to_string()),
            executor_mode: "images_api".to_string(),
            outer_model: None,
            reference_image_urls: Vec::new(),
        };

        let body = build_agnes_image_generation_request_body(&prepared_input, "深圳夏天街景");

        assert_eq!(
            body.get("size").and_then(Value::as_str),
            Some(AGNES_DEFAULT_SIZE_FOR_RATIO)
        );
        assert_eq!(body.get("ratio").and_then(Value::as_str), Some("16:9"));
        assert_eq!(
            body.pointer("/extra_body/response_format")
                .and_then(Value::as_str),
            Some("url")
        );
        assert_eq!(body.get("response_format"), None);
    }

    #[test]
    fn canonical_image_request_rejects_inline_reference_data() {
        let prepared_input = ImageGenerationRequestInput {
            model: "gpt-image-1".to_string(),
            size: None,
            style: None,
            provider_id: Some("openai".to_string()),
            executor_mode: "images_api".to_string(),
            outer_model: None,
            reference_image_urls: vec!["data:image/png;base64,AAAA".to_string()],
        };

        let error = build_openai_compatible_image_generation_llm_request(
            &prepared_input,
            "edit it",
            "task-1",
            Some(1),
        )
        .expect_err("inline media must fail closed");

        assert_eq!(error.code, "image_reference_invalid");
    }
}
