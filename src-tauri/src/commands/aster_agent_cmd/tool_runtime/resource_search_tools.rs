use super::*;
use crate::agent_tools::catalog::LIME_SEARCH_WEB_IMAGES_TOOL_NAME;
use crate::app::AppState;
use crate::commands::image_search_cmd::{
    get_pexels_api_key_from_app_state, search_web_images_with_pexels_api_key, WebImageSearchRequest,
};
use tauri::Manager;

const DEFAULT_WEB_IMAGE_SEARCH_COUNT: u32 = 8;
const MAX_WEB_IMAGE_SEARCH_COUNT: u32 = 20;
const DEFAULT_WEB_IMAGE_SEARCH_PAGE: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LimeSearchWebImagesToolInput {
    query: String,
    #[serde(default)]
    count: Option<u32>,
    #[serde(default)]
    aspect: Option<String>,
    #[serde(default)]
    page: Option<u32>,
}

#[derive(Clone)]
pub(crate) struct LimeSearchWebImagesTool {
    app_handle: AppHandle,
}

impl LimeSearchWebImagesTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    fn normalize_optional_text(value: &str) -> Option<String> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    fn normalize_search_count(count: Option<u32>) -> u32 {
        count
            .unwrap_or(DEFAULT_WEB_IMAGE_SEARCH_COUNT)
            .clamp(1, MAX_WEB_IMAGE_SEARCH_COUNT)
    }

    fn normalize_search_page(page: Option<u32>) -> u32 {
        page.unwrap_or(DEFAULT_WEB_IMAGE_SEARCH_PAGE).max(1)
    }

    fn normalize_aspect_alias(value: &str) -> Option<&'static str> {
        match value.trim().to_ascii_lowercase().as_str() {
            "landscape" | "horizontal" | "横版" | "横图" | "宽图" | "16:9" | "4:3" | "3:2" => {
                Some("landscape")
            }
            "portrait" | "vertical" | "竖版" | "竖图" | "长图" | "9:16" | "3:4" | "2:3" => {
                Some("portrait")
            }
            "square" | "方图" | "正方形" | "1:1" => Some("square"),
            _ => None,
        }
    }

    fn normalize_aspect(aspect: Option<&str>) -> Result<Option<String>, ToolError> {
        let Some(raw) = aspect else {
            return Ok(None);
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        Self::normalize_aspect_alias(trimmed)
            .map(|value| Some(value.to_string()))
            .ok_or_else(|| {
                ToolError::invalid_params(
                    "aspect 仅支持 landscape / portrait / square（也兼容 横版 / 竖版 / 方图）"
                        .to_string(),
                )
            })
    }
}

#[async_trait]
impl Tool for LimeSearchWebImagesTool {
    fn name(&self) -> &str {
        LIME_SEARCH_WEB_IMAGES_TOOL_NAME
    }

    fn description(&self) -> &str {
        "使用当前已配置的 Pexels API Key 搜索联网图片素材候选。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "图片检索关键词。"
                },
                "count": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "description": "返回候选数量，默认 8。"
                },
                "aspect": {
                    "type": "string",
                    "enum": ["landscape", "portrait", "square"],
                    "description": "画幅方向，可选 landscape / portrait / square。"
                },
                "page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "分页页码，默认 1。"
                }
            },
            "required": ["query"],
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["image", "search", "resource"],
                "allowed_callers": ["assistant", "skill"],
                "input_examples": [
                    {
                        "query": "cozy coffee shop background",
                        "count": 8,
                        "aspect": "landscape"
                    }
                ]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: LimeSearchWebImagesToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        let query = Self::normalize_optional_text(&input.query)
            .ok_or_else(|| ToolError::invalid_params("query 不能为空字符串".to_string()))?;
        let count = Self::normalize_search_count(input.count);
        let page = Self::normalize_search_page(input.page);
        let aspect = Self::normalize_aspect(input.aspect.as_deref())?;

        let app_state = self.app_handle.state::<AppState>();
        let api_key = get_pexels_api_key_from_app_state(app_state.inner()).await;
        let result = search_web_images_with_pexels_api_key(
            api_key,
            WebImageSearchRequest {
                query: query.clone(),
                page,
                per_page: count,
                aspect: aspect.clone(),
            },
        )
        .await
        .map_err(ToolError::execution_failed)?;
        let provider = result.provider.clone();
        let total = result.total;
        let returned_count = result.hits.len();
        let hits = result.hits;

        let payload = serde_json::json!({
            "provider": provider,
            "query": query,
            "requestedCount": count,
            "returnedCount": returned_count,
            "page": page,
            "aspect": aspect,
            "total": total,
            "hits": hits,
        });
        let output = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());

        Ok(ToolResult::success(output)
            .with_metadata("tool_family", serde_json::json!("search"))
            .with_metadata("provider", payload["provider"].clone())
            .with_metadata("query", payload["query"].clone())
            .with_metadata("result", payload))
    }
}

pub(super) fn register_resource_search_tools_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    app_handle: AppHandle,
) {
    if !registry.contains(LIME_SEARCH_WEB_IMAGES_TOOL_NAME) {
        registry.register(Box::new(LimeSearchWebImagesTool::new(app_handle)));
    }
}

#[cfg(test)]
mod tests {
    use super::LimeSearchWebImagesTool;

    #[test]
    fn test_normalize_aspect_alias_supports_common_inputs() {
        assert_eq!(
            LimeSearchWebImagesTool::normalize_aspect_alias("landscape"),
            Some("landscape")
        );
        assert_eq!(
            LimeSearchWebImagesTool::normalize_aspect_alias("横版"),
            Some("landscape")
        );
        assert_eq!(
            LimeSearchWebImagesTool::normalize_aspect_alias("9:16"),
            Some("portrait")
        );
        assert_eq!(
            LimeSearchWebImagesTool::normalize_aspect_alias("方图"),
            Some("square")
        );
        assert_eq!(
            LimeSearchWebImagesTool::normalize_aspect_alias("cinematic"),
            None
        );
    }
}
