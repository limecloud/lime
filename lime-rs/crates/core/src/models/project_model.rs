//! 项目相关模型定义
//!
//! 定义统一内容创作系统中的项目相关数据结构，包括：
//! - Persona（人设）
//! - PublishConfig（发布配置）
//!
//! 以及相关的请求类型。

use serde::{Deserialize, Serialize};

// ============================================================================
// 人设相关类型
// ============================================================================

/// 人设配置
///
/// 存储项目级人设配置，包含写作风格、语气、目标读者等信息。
/// 用于 AI 生成内容时的风格指导。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Persona {
    /// 唯一标识
    pub id: String,
    /// 所属项目 ID
    pub project_id: String,
    /// 人设名称
    pub name: String,
    /// 人设描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 写作风格（如：专业、轻松、幽默等）
    pub style: String,
    /// 语气（如：正式、亲切、活泼等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
    /// 目标读者群体
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_audience: Option<String>,
    /// 禁用词列表
    #[serde(default)]
    pub forbidden_words: Vec<String>,
    /// 偏好词列表
    #[serde(default)]
    pub preferred_words: Vec<String>,
    /// 示例文本
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<String>,
    /// 适用平台列表
    #[serde(default)]
    pub platforms: Vec<String>,
    /// 是否为项目默认人设
    #[serde(default)]
    pub is_default: bool,
    /// 创建时间（Unix 时间戳）
    pub created_at: i64,
    /// 更新时间（Unix 时间戳）
    pub updated_at: i64,
}

/// 创建人设请求
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePersonaRequest {
    /// 所属项目 ID
    pub project_id: String,
    /// 人设名称
    pub name: String,
    /// 人设描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 写作风格
    pub style: String,
    /// 语气
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
    /// 目标读者群体
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_audience: Option<String>,
    /// 禁用词列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forbidden_words: Option<Vec<String>>,
    /// 偏好词列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_words: Option<Vec<String>>,
    /// 示例文本
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<String>,
    /// 适用平台列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platforms: Option<Vec<String>>,
}

/// 更新人设请求
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersonaUpdate {
    /// 人设名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 人设描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 写作风格
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    /// 语气
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
    /// 目标读者群体
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_audience: Option<String>,
    /// 禁用词列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forbidden_words: Option<Vec<String>>,
    /// 偏好词列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_words: Option<Vec<String>>,
    /// 示例文本
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<String>,
    /// 适用平台列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platforms: Option<Vec<String>>,
}

/// 人设模板
///
/// 预定义的人设模板，用于快速创建人设。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaTemplate {
    /// 模板 ID
    pub id: String,
    /// 模板名称
    pub name: String,
    /// 模板描述
    pub description: String,
    /// 写作风格
    pub style: String,
    /// 语气
    pub tone: String,
    /// 目标读者群体
    pub target_audience: String,
    /// 适用平台列表
    #[serde(default)]
    pub platforms: Vec<String>,
}

// ============================================================================
// 排版模板相关类型
// ============================================================================

/// 平台类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    /// 小红书
    Xiaohongshu,
    /// 微信公众号
    Wechat,
    /// 知乎
    Zhihu,
    /// 微博
    Weibo,
    /// 抖音
    Douyin,
    /// Markdown 通用格式
    #[default]
    Markdown,
}

#[allow(dead_code)]
impl Platform {
    pub fn as_str(&self) -> &'static str {
        match self {
            Platform::Xiaohongshu => "xiaohongshu",
            Platform::Wechat => "wechat",
            Platform::Zhihu => "zhihu",
            Platform::Weibo => "weibo",
            Platform::Douyin => "douyin",
            Platform::Markdown => "markdown",
        }
    }

    /// 获取平台显示名称
    pub fn display_name(&self) -> &'static str {
        match self {
            Platform::Xiaohongshu => "小红书",
            Platform::Wechat => "微信公众号",
            Platform::Zhihu => "知乎",
            Platform::Weibo => "微博",
            Platform::Douyin => "抖音",
            Platform::Markdown => "Markdown",
        }
    }
}

impl std::str::FromStr for Platform {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "xiaohongshu" => Ok(Platform::Xiaohongshu),
            "wechat" => Ok(Platform::Wechat),
            "zhihu" => Ok(Platform::Zhihu),
            "weibo" => Ok(Platform::Weibo),
            "douyin" => Ok(Platform::Douyin),
            "markdown" => Ok(Platform::Markdown),
            _ => Ok(Platform::Markdown),
        }
    }
}

// ============================================================================
// 发布配置相关类型
// ============================================================================

/// 发布配置
///
/// 存储项目级发布配置，包含平台认证信息和发布历史。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishConfig {
    /// 唯一标识
    pub id: String,
    /// 所属项目 ID
    pub project_id: String,
    /// 目标平台
    pub platform: String,
    /// 是否已配置
    #[serde(default)]
    pub is_configured: bool,
    /// 最后发布时间（Unix 时间戳）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_published_at: Option<i64>,
    /// 发布次数
    #[serde(default)]
    pub publish_count: i64,
    /// 创建时间（Unix 时间戳）
    pub created_at: i64,
    /// 更新时间（Unix 时间戳）
    pub updated_at: i64,
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_conversion() {
        assert_eq!(Platform::Xiaohongshu.as_str(), "xiaohongshu");
        assert_eq!(Platform::Wechat.as_str(), "wechat");
        assert_eq!(Platform::Markdown.as_str(), "markdown");

        assert_eq!(
            "xiaohongshu".parse::<Platform>().unwrap(),
            Platform::Xiaohongshu
        );
        assert_eq!("WECHAT".parse::<Platform>().unwrap(), Platform::Wechat);
        assert_eq!("unknown".parse::<Platform>().unwrap(), Platform::Markdown);
    }

    #[test]
    fn test_platform_display_name() {
        assert_eq!(Platform::Xiaohongshu.display_name(), "小红书");
        assert_eq!(Platform::Wechat.display_name(), "微信公众号");
        assert_eq!(Platform::Markdown.display_name(), "Markdown");
    }

    #[test]
    fn test_persona_serialization() {
        let persona = Persona {
            id: "test-id".to_string(),
            project_id: "project-1".to_string(),
            name: "测试人设".to_string(),
            description: Some("这是一个测试人设".to_string()),
            style: "专业".to_string(),
            tone: Some("正式".to_string()),
            target_audience: Some("技术人员".to_string()),
            forbidden_words: vec!["禁词1".to_string()],
            preferred_words: vec!["偏好词1".to_string()],
            examples: None,
            platforms: vec!["xiaohongshu".to_string()],
            is_default: false,
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        let json = serde_json::to_string(&persona).unwrap();
        let parsed: Persona = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, persona.id);
        assert_eq!(parsed.name, persona.name);
        assert_eq!(parsed.style, persona.style);
    }

    #[test]
    fn test_create_persona_request() {
        let req = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "新人设".to_string(),
            description: None,
            style: "轻松".to_string(),
            tone: Some("活泼".to_string()),
            target_audience: None,
            forbidden_words: Some(vec!["禁词".to_string()]),
            preferred_words: None,
            examples: None,
            platforms: Some(vec!["wechat".to_string()]),
        };

        let json = serde_json::to_string(&req).unwrap();
        let parsed: CreatePersonaRequest = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.project_id, "project-1");
        assert_eq!(parsed.style, "轻松");
    }
}
