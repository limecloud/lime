//! 图片搜索相关的 Tauri 命令
//!
//! 提供在线图片搜索功能，支持 Pixabay API 和联网搜索（Pexels）。

use crate::app::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

fn normalize_non_empty_api_key(raw: Option<String>) -> Option<String> {
    raw.and_then(|key| {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn resolve_api_key_with_env_fallback(config_key: Option<String>, env_key: &str) -> Option<String> {
    normalize_non_empty_api_key(config_key)
        .or_else(|| normalize_non_empty_api_key(std::env::var(env_key).ok()))
}

/// Pixabay 搜索请求
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PixabaySearchRequest {
    /// 搜索关键词
    pub query: String,
    /// 页码（从 1 开始）
    pub page: u32,
    /// 每页数量
    #[serde(alias = "per_page")]
    pub per_page: u32,
    /// 方向筛选：horizontal, vertical
    pub orientation: Option<String>,
}

/// Pixabay 搜索响应
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PixabaySearchResponse {
    /// 总结果数
    pub total: u32,
    /// 总命中数
    pub total_hits: u32,
    /// 搜索结果
    pub hits: Vec<PixabayHit>,
}

/// Pixabay 图片信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PixabayHit {
    /// 图片 ID
    pub id: u64,
    /// 预览图 URL
    pub preview_url: String,
    /// 大图 URL
    pub large_image_url: String,
    /// 图片宽度
    pub image_width: u32,
    /// 图片高度
    pub image_height: u32,
    /// 标签（逗号分隔）
    pub tags: String,
    /// 来源页面 URL
    pub page_url: String,
    /// 作者名称
    pub user: String,
}

/// 联网图片搜索请求
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebImageSearchRequest {
    /// 搜索关键词
    pub query: String,
    /// 页码（从 1 开始）
    pub page: u32,
    /// 每页数量
    #[serde(alias = "per_page")]
    pub per_page: u32,
    /// 方向筛选：landscape, portrait, square
    pub aspect: Option<String>,
}

/// 联网图片搜索响应（统一格式）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebImageSearchResponse {
    /// 总结果数
    pub total: u32,
    /// 搜索结果
    pub hits: Vec<WebImageHit>,
    /// 来源提供者标识
    pub provider: String,
}

/// 联网图片信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebImageHit {
    /// 图片 ID
    pub id: String,
    /// 缩略图 URL
    pub thumbnail_url: String,
    /// 原图 URL
    pub content_url: String,
    /// 图片宽度
    pub width: u32,
    /// 图片高度
    pub height: u32,
    /// 标题/描述
    pub name: String,
    /// 来源页面 URL
    pub host_page_url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct PexelsSearchResponse {
    total_results: u32,
    photos: Vec<PexelsPhoto>,
}

#[derive(Debug, Clone, Deserialize)]
struct PexelsPhoto {
    id: u64,
    width: u32,
    height: u32,
    url: String,
    alt: Option<String>,
    src: PexelsPhotoSrc,
}

#[derive(Debug, Clone, Deserialize)]
struct PexelsPhotoSrc {
    tiny: Option<String>,
    small: Option<String>,
    medium: Option<String>,
    large: Option<String>,
    large2x: Option<String>,
    landscape: Option<String>,
    portrait: Option<String>,
    original: Option<String>,
}

/// 获取 Pixabay API Key（优先配置，其次环境变量）
async fn get_pixabay_api_key(app_state: State<'_, AppState>) -> Option<String> {
    let key_from_config = {
        let state = app_state.read().await;
        state.config.image_gen.image_search_pixabay_api_key.clone()
    };

    resolve_api_key_with_env_fallback(key_from_config, "PIXABAY_API_KEY")
}

pub(crate) fn resolve_pexels_api_key(config_key: Option<String>) -> Option<String> {
    resolve_api_key_with_env_fallback(config_key, "PEXELS_API_KEY")
}

/// 获取 Pexels API Key（优先配置，其次环境变量）
pub(crate) async fn get_pexels_api_key_from_app_state(app_state: &AppState) -> Option<String> {
    let key_from_config = {
        let state = app_state.read().await;
        state.config.image_gen.image_search_pexels_api_key.clone()
    };

    resolve_pexels_api_key(key_from_config)
}

fn map_aspect_to_pexels_orientation(aspect: Option<&str>) -> Option<&'static str> {
    match aspect.unwrap_or_default() {
        "landscape" => Some("landscape"),
        "portrait" => Some("portrait"),
        "square" => Some("square"),
        _ => None,
    }
}

fn map_pexels_to_web_response(resp: PexelsSearchResponse) -> WebImageSearchResponse {
    let hits = resp
        .photos
        .into_iter()
        .filter_map(|photo| {
            let content_url = photo
                .src
                .large2x
                .clone()
                .or(photo.src.large.clone())
                .or(photo.src.original.clone())
                .or(photo.src.landscape.clone())
                .or(photo.src.portrait.clone())
                .or(photo.src.medium.clone())
                .or(photo.src.small.clone())
                .or(photo.src.tiny.clone())?;
            let thumbnail_url = photo
                .src
                .medium
                .clone()
                .or(photo.src.small.clone())
                .or(photo.src.tiny.clone())
                .or(photo.src.landscape.clone())
                .or(photo.src.portrait.clone())
                .or(photo.src.large.clone())
                .or(photo.src.original.clone())
                .unwrap_or_else(|| content_url.clone());
            let name = photo
                .alt
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| "Pexels Image".to_string());

            Some(WebImageHit {
                id: photo.id.to_string(),
                thumbnail_url,
                content_url,
                width: photo.width,
                height: photo.height,
                name,
                host_page_url: photo.url,
            })
        })
        .collect::<Vec<_>>();

    WebImageSearchResponse {
        total: resp.total_results,
        hits,
        provider: "pexels".to_string(),
    }
}

/// 搜索 Pixabay 图片
///
/// 通过 Pixabay API 搜索在线图片。
///
/// # 参数
/// - `req`: 搜索请求，包含关键词、页码、每页数量等
///
/// # 返回
/// - 成功返回搜索结果
/// - 失败返回错误信息
#[tauri::command]
pub async fn search_pixabay_images(
    app_state: State<'_, AppState>,
    req: PixabaySearchRequest,
) -> Result<PixabaySearchResponse, String> {
    let api_key = get_pixabay_api_key(app_state)
        .await
        .ok_or_else(|| "未配置 Pixabay API Key，请先在设置 → 系统 → 网络搜索中配置".to_string())?;

    // 构建 URL
    let url = format!(
        "https://pixabay.com/api/?key={}&q={}&page={}&per_page={}&image_type=photo&safesearch=true",
        api_key,
        urlencoding::encode(&req.query),
        req.page,
        req.per_page
    );

    // 添加 orientation 参数
    let url = if let Some(orientation) = &req.orientation {
        if !orientation.is_empty() {
            format!("{}&orientation={}", url, orientation)
        } else {
            url
        }
    } else {
        url
    };

    // 发起请求
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body.chars().take(120).collect::<String>());
        return Err(format!("Pixabay API 返回错误: HTTP {} {}", status, detail));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    // 映射响应
    let total = json["total"].as_u64().map(|v| v as u32).unwrap_or(0);
    let total_hits = json["totalHits"].as_u64().map(|v| v as u32).unwrap_or(0);

    let hits = json["hits"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|hit| {
            Some(PixabayHit {
                id: hit["id"].as_u64()?,
                preview_url: hit["previewURL"].as_str()?.to_string(),
                large_image_url: hit["largeImageURL"].as_str()?.to_string(),
                image_width: hit["imageWidth"].as_u64()? as u32,
                image_height: hit["imageHeight"].as_u64()? as u32,
                tags: hit["tags"].as_str().unwrap_or("").to_string(),
                page_url: hit["pageURL"].as_str().unwrap_or("").to_string(),
                user: hit["user"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect();

    Ok(PixabaySearchResponse {
        total,
        total_hits,
        hits,
    })
}

/// 联网搜索图片（Pexels）
pub(crate) async fn search_web_images_with_pexels_api_key(
    api_key: Option<String>,
    req: WebImageSearchRequest,
) -> Result<WebImageSearchResponse, String> {
    let api_key = resolve_pexels_api_key(api_key)
        .ok_or_else(|| "未配置 Pexels API Key，请先在设置 → 系统 → 网络搜索中配置".to_string())?;

    let client = reqwest::Client::new();
    let mut query = vec![
        ("query", req.query.clone()),
        ("page", req.page.to_string()),
        ("per_page", req.per_page.to_string()),
    ];

    if let Some(orientation) = map_aspect_to_pexels_orientation(req.aspect.as_deref()) {
        query.push(("orientation", orientation.to_string()));
    }

    let response = client
        .get("https://api.pexels.com/v1/search")
        .header("Authorization", api_key)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (compatible; Lime/0.75; +https://github.com/aiclientproxy/lime)",
        )
        .header(reqwest::header::ACCEPT, "application/json")
        .query(&query)
        .send()
        .await
        .map_err(|e| format!("请求 Pexels 失败: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err("Pexels API Key 无效或无权限，请检查设置".to_string());
        }
        return Err(format!("Pexels API 返回错误: HTTP {status}"));
    }

    let body: PexelsSearchResponse = response
        .json()
        .await
        .map_err(|e| format!("解析 Pexels 响应失败: {e}"))?;

    Ok(map_pexels_to_web_response(body))
}

#[tauri::command]
pub async fn search_web_images(
    app_state: State<'_, AppState>,
    req: WebImageSearchRequest,
) -> Result<WebImageSearchResponse, String> {
    let api_key = get_pexels_api_key_from_app_state(app_state.inner()).await;
    search_web_images_with_pexels_api_key(api_key, req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pixabay_request_serialization() {
        let req = PixabaySearchRequest {
            query: "nature".to_string(),
            page: 1,
            per_page: 20,
            orientation: Some("horizontal".to_string()),
        };

        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("nature"));
        assert!(json.contains("horizontal"));
    }

    #[test]
    fn test_web_request_serialization() {
        let req = WebImageSearchRequest {
            query: "city".to_string(),
            page: 2,
            per_page: 30,
            aspect: Some("landscape".to_string()),
        };

        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("city"));
        assert!(json.contains("landscape"));
        assert!(json.contains("\"page\":2"));
    }

    #[test]
    fn test_map_aspect_to_pexels_orientation() {
        assert_eq!(
            map_aspect_to_pexels_orientation(Some("landscape")),
            Some("landscape")
        );
        assert_eq!(
            map_aspect_to_pexels_orientation(Some("portrait")),
            Some("portrait")
        );
        assert_eq!(
            map_aspect_to_pexels_orientation(Some("square")),
            Some("square")
        );
        assert_eq!(map_aspect_to_pexels_orientation(Some("all")), None);
        assert_eq!(map_aspect_to_pexels_orientation(None), None);
    }

    #[test]
    fn test_map_pexels_to_web_response() {
        let resp = PexelsSearchResponse {
            total_results: 2,
            photos: vec![PexelsPhoto {
                id: 123,
                width: 1920,
                height: 1080,
                url: "https://www.pexels.com/photo/test".to_string(),
                alt: Some("  城市夜景  ".to_string()),
                src: PexelsPhotoSrc {
                    tiny: None,
                    small: None,
                    medium: Some("https://images.pexels.com/medium.jpg".to_string()),
                    large: Some("https://images.pexels.com/large.jpg".to_string()),
                    large2x: Some("https://images.pexels.com/large2x.jpg".to_string()),
                    landscape: None,
                    portrait: None,
                    original: None,
                },
            }],
        };

        let mapped = map_pexels_to_web_response(resp);
        assert_eq!(mapped.provider, "pexels");
        assert_eq!(mapped.total, 2);
        assert_eq!(mapped.hits.len(), 1);
        let hit = &mapped.hits[0];
        assert_eq!(hit.id, "123");
        assert_eq!(hit.name, "城市夜景");
        assert_eq!(hit.content_url, "https://images.pexels.com/large2x.jpg");
        assert_eq!(hit.thumbnail_url, "https://images.pexels.com/medium.jpg");
        assert_eq!(hit.width, 1920);
        assert_eq!(hit.height, 1080);
    }
}
