use super::*;

#[derive(Clone)]
pub(crate) struct SocialGenerateCoverImageTool {
    config_manager: Arc<GlobalConfigManager>,
    client: reqwest::Client,
}

impl SocialGenerateCoverImageTool {
    fn new(config_manager: Arc<GlobalConfigManager>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            config_manager,
            client,
        }
    }

    pub(crate) fn normalize_server_host(host: &str) -> String {
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

    pub(crate) fn parse_non_empty_string(
        params: &serde_json::Value,
        key: &str,
        default: Option<&str>,
    ) -> Option<String> {
        if let Some(value) = params.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        default.map(ToString::to_string)
    }

    pub(crate) fn extract_first_image_payload(
        response_body: &serde_json::Value,
    ) -> Result<(Option<String>, Option<String>, Option<String>), String> {
        let data = response_body
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "图像接口返回缺少 data 字段".to_string())?;

        let first = data
            .first()
            .ok_or_else(|| "图像接口返回 data 为空".to_string())?;

        let image_url = first
            .get("url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let image_b64 = first
            .get("b64_json")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let revised_prompt = first
            .get("revised_prompt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok((image_url, image_b64, revised_prompt))
    }
}

#[async_trait]
impl Tool for SocialGenerateCoverImageTool {
    fn name(&self) -> &str {
        SOCIAL_IMAGE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "为社媒文章生成封面图，内部复用 Lime 的 /v1/images/generations 能力。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "图片描述词，建议包含主体、风格、氛围、构图。"
                },
                "model": {
                    "type": "string",
                    "description": "可选模型名；不传则使用默认图像模型。"
                },
                "size": {
                    "type": "string",
                    "description": "图片尺寸，例如 1024x1024、1024x1792。"
                },
                "response_format": {
                    "type": "string",
                    "enum": ["url", "b64_json"],
                    "description": "返回格式，默认 url。"
                }
            },
            "required": ["prompt"],
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["image", "social-media", "cover"],
                "allowed_callers": ["assistant", "skill"],
                "input_examples": [
                    {
                        "prompt": "科技感蓝紫渐变背景，一位年轻创作者在笔记本前沉思，暖色轮廓光，简洁社媒封面风格",
                        "size": "1024x1024"
                    }
                ]
            }
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(180))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let prompt = Self::parse_non_empty_string(&params, "prompt", None).ok_or_else(|| {
            ToolError::invalid_params("参数 prompt 必填，且不能为空字符串".to_string())
        })?;

        let runtime_config = self.config_manager.config();
        let model =
            Self::parse_non_empty_string(&params, "model", Some(SOCIAL_IMAGE_DEFAULT_MODEL))
                .unwrap_or_else(|| SOCIAL_IMAGE_DEFAULT_MODEL.to_string());
        let size = Self::parse_non_empty_string(
            &params,
            "size",
            runtime_config.image_gen.default_size.as_deref(),
        )
        .unwrap_or_else(|| SOCIAL_IMAGE_DEFAULT_SIZE.to_string());
        let response_format = Self::parse_non_empty_string(
            &params,
            "response_format",
            Some(SOCIAL_IMAGE_DEFAULT_RESPONSE_FORMAT),
        )
        .unwrap_or_else(|| SOCIAL_IMAGE_DEFAULT_RESPONSE_FORMAT.to_string());

        if response_format != "url" && response_format != "b64_json" {
            return Err(ToolError::invalid_params(
                "response_format 仅支持 url 或 b64_json".to_string(),
            ));
        }

        let server_host = Self::normalize_server_host(&runtime_config.server.host);
        let endpoint = format!(
            "http://{}:{}/v1/images/generations",
            server_host, runtime_config.server.port
        );
        let request_body = serde_json::json!({
            "prompt": prompt,
            "model": model,
            "n": 1,
            "size": size,
            "response_format": response_format
        });

        let response = self
            .client
            .post(&endpoint)
            .header(
                "Authorization",
                format!("Bearer {}", runtime_config.server.api_key),
            )
            .json(&request_body)
            .send()
            .await
            .map_err(|e| ToolError::execution_failed(format!("调用图像接口失败: {e}")))?;

        let status = response.status();
        let response_body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| ToolError::execution_failed(format!("图像接口响应解析失败: {e}")))?;

        if !status.is_success() {
            let error_message = response_body
                .get("error")
                .and_then(|v| v.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("图像生成失败")
                .to_string();
            let error_code = response_body
                .get("error")
                .and_then(|v| v.get("code"))
                .and_then(|v| v.as_str())
                .unwrap_or("image_generation_failed")
                .to_string();
            let result_payload = serde_json::json!({
                "success": false,
                "error_code": error_code,
                "error_message": error_message,
                "status": status.as_u16(),
                "retryable": status.is_server_error() || status.as_u16() == 429
            });
            return Ok(ToolResult::error(result_payload.to_string())
                .with_metadata("result", result_payload));
        }

        let (image_url, image_b64, revised_prompt) =
            Self::extract_first_image_payload(&response_body)
                .map_err(ToolError::execution_failed)?;

        if image_url.is_none() && image_b64.is_none() {
            return Err(ToolError::execution_failed(
                "图像接口返回中未找到 url 或 b64_json".to_string(),
            ));
        }

        let result_payload = serde_json::json!({
            "success": true,
            "image_url": image_url,
            "b64_json": image_b64,
            "revised_prompt": revised_prompt,
            "model": request_body.get("model").cloned(),
            "size": request_body.get("size").cloned(),
            "response_format": request_body.get("response_format").cloned()
        });
        let output = serde_json::to_string_pretty(&result_payload)
            .unwrap_or_else(|_| result_payload.to_string());
        Ok(ToolResult::success(output).with_metadata("result", result_payload))
    }
}

pub(super) fn register_social_image_tool_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    config_manager: Arc<GlobalConfigManager>,
) {
    if registry.contains(SOCIAL_IMAGE_TOOL_NAME) {
        return;
    }
    registry.register(Box::new(SocialGenerateCoverImageTool::new(config_manager)));
}

pub(crate) async fn ensure_social_image_tool_registered(
    state: &AsterAgentState,
    config_manager: &GlobalConfigManagerState,
) -> Result<(), String> {
    let (registry_arc, _) = resolve_agent_registry(state).await?;
    let mut registry = registry_arc.write().await;
    register_social_image_tool_to_registry(&mut registry, config_manager.0.clone());
    Ok(())
}

#[tauri::command]
pub async fn social_generate_cover_image_cmd(
    config_manager: State<'_, GlobalConfigManagerState>,
    prompt: String,
    size: Option<String>,
) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("prompt 不能为空".to_string());
    }
    let runtime_config = config_manager.config();
    let server_host =
        SocialGenerateCoverImageTool::normalize_server_host(&runtime_config.server.host);
    let size = size
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .or(runtime_config.image_gen.default_size.as_deref())
        .unwrap_or(SOCIAL_IMAGE_DEFAULT_SIZE)
        .to_string();
    let endpoint = format!(
        "http://{}:{}/v1/images/generations",
        server_host, runtime_config.server.port
    );
    let request_body = serde_json::json!({
        "prompt": prompt.trim(),
        "model": SOCIAL_IMAGE_DEFAULT_MODEL,
        "n": 1,
        "size": size,
        "response_format": "url"
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let response = client
        .post(&endpoint)
        .header(
            "Authorization",
            format!("Bearer {}", runtime_config.server.api_key),
        )
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("调用图像接口失败: {e}"))?;

    let status = response.status();
    let response_body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("图像接口响应解析失败: {e}"))?;

    if !status.is_success() {
        let msg = response_body
            .get("error")
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("图像生成失败");
        return Err(msg.to_string());
    }

    let (image_url, _b64, _revised) =
        SocialGenerateCoverImageTool::extract_first_image_payload(&response_body)?;

    image_url.ok_or_else(|| "接口返回中未找到 image_url".to_string())
}
