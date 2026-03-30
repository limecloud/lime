//! 项目相关模型定义
//!
//! 定义统一内容创作系统中的项目相关数据结构，包括：
//! - Persona（人设）
//! - Material（素材）
//! - PublishConfig（发布配置）
//! - ProjectContext（项目上下文）
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
// 素材相关类型
// ============================================================================

/// 素材类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum MaterialType {
    /// 文档（PDF、Word 等）
    #[default]
    Document,
    /// 图片
    Image,
    /// 音频
    Audio,
    /// 视频
    Video,
    /// 纯文本
    Text,
    /// 数据文件（CSV、JSON 等）
    Data,
    /// 链接
    Link,
    /// 图标（海报扩展）
    Icon,
    /// 配色方案（海报扩展）
    Color,
    /// 布局模板（海报扩展）
    Layout,
}

#[allow(dead_code)]
impl MaterialType {
    pub fn as_str(&self) -> &'static str {
        match self {
            MaterialType::Document => "document",
            MaterialType::Image => "image",
            MaterialType::Audio => "audio",
            MaterialType::Video => "video",
            MaterialType::Text => "text",
            MaterialType::Data => "data",
            MaterialType::Link => "link",
            MaterialType::Icon => "icon",
            MaterialType::Color => "color",
            MaterialType::Layout => "layout",
        }
    }
}

impl std::str::FromStr for MaterialType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "document" => Ok(MaterialType::Document),
            "image" => Ok(MaterialType::Image),
            "audio" => Ok(MaterialType::Audio),
            "video" => Ok(MaterialType::Video),
            "text" => Ok(MaterialType::Text),
            "data" => Ok(MaterialType::Data),
            "link" => Ok(MaterialType::Link),
            "icon" => Ok(MaterialType::Icon),
            "color" => Ok(MaterialType::Color),
            "layout" => Ok(MaterialType::Layout),
            _ => Ok(MaterialType::Document),
        }
    }
}

#[allow(dead_code)]
impl MaterialType {
    /// 判断是否为海报素材类型
    pub fn is_poster_material(&self) -> bool {
        matches!(
            self,
            MaterialType::Image | MaterialType::Icon | MaterialType::Color | MaterialType::Layout
        )
    }
}

/// 图片分类
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ImageCategory {
    /// 背景图
    Background,
    /// 产品图
    Product,
    /// 人物图
    Person,
    /// 装饰图
    Decoration,
    /// 纹理图
    Texture,
    /// 其他
    #[default]
    Other,
}

#[allow(dead_code)]
impl ImageCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            ImageCategory::Background => "background",
            ImageCategory::Product => "product",
            ImageCategory::Person => "person",
            ImageCategory::Decoration => "decoration",
            ImageCategory::Texture => "texture",
            ImageCategory::Other => "other",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            ImageCategory::Background => "背景",
            ImageCategory::Product => "产品",
            ImageCategory::Person => "人物",
            ImageCategory::Decoration => "装饰",
            ImageCategory::Texture => "纹理",
            ImageCategory::Other => "其他",
        }
    }
}

impl std::str::FromStr for ImageCategory {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "background" => Ok(ImageCategory::Background),
            "product" => Ok(ImageCategory::Product),
            "person" => Ok(ImageCategory::Person),
            "decoration" => Ok(ImageCategory::Decoration),
            "texture" => Ok(ImageCategory::Texture),
            _ => Ok(ImageCategory::Other),
        }
    }
}

/// 布局分类
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LayoutCategory {
    /// 大图型
    #[default]
    HeroImage,
    /// 文字主导
    TextDominant,
    /// 网格型
    Grid,
    /// 分割型
    Split,
    /// 极简型
    Minimal,
    /// 拼贴型
    Collage,
}

#[allow(dead_code)]
impl LayoutCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            LayoutCategory::HeroImage => "hero-image",
            LayoutCategory::TextDominant => "text-dominant",
            LayoutCategory::Grid => "grid",
            LayoutCategory::Split => "split",
            LayoutCategory::Minimal => "minimal",
            LayoutCategory::Collage => "collage",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            LayoutCategory::HeroImage => "大图型",
            LayoutCategory::TextDominant => "文字型",
            LayoutCategory::Grid => "网格型",
            LayoutCategory::Split => "分割型",
            LayoutCategory::Minimal => "极简型",
            LayoutCategory::Collage => "拼贴型",
        }
    }
}

impl std::str::FromStr for LayoutCategory {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "hero-image" => Ok(LayoutCategory::HeroImage),
            "text-dominant" => Ok(LayoutCategory::TextDominant),
            "grid" => Ok(LayoutCategory::Grid),
            "split" => Ok(LayoutCategory::Split),
            "minimal" => Ok(LayoutCategory::Minimal),
            "collage" => Ok(LayoutCategory::Collage),
            _ => Ok(LayoutCategory::HeroImage),
        }
    }
}

/// 海报素材元数据
///
/// 存储海报素材的扩展信息，与 materials 表关联。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosterMaterialMetadata {
    /// 关联的素材 ID
    pub material_id: String,
    /// 图片分类（仅 image 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_category: Option<String>,
    /// 图片宽度
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i32>,
    /// 图片高度
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i32>,
    /// 缩略图路径或 base64
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    /// 主色列表（JSON 数组）
    #[serde(default)]
    pub colors: Vec<String>,
    /// 图标风格（仅 icon 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_style: Option<String>,
    /// 图标分类（仅 icon 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_category: Option<String>,
    /// 配色方案数据（仅 color 类型，JSON）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_scheme_json: Option<String>,
    /// 配色氛围（仅 color 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
    /// 布局分类（仅 layout 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_category: Option<String>,
    /// 布局元素数量（仅 layout 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element_count: Option<i32>,
    /// 布局预览图
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    /// Fabric.js JSON（仅 layout 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fabric_json: Option<String>,
    /// 创建时间
    pub created_at: i64,
    /// 更新时间
    pub updated_at: i64,
}

/// 创建海报素材元数据请求
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePosterMetadataRequest {
    /// 关联的素材 ID
    pub material_id: String,
    /// 图片分类
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_category: Option<String>,
    /// 图片宽度
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i32>,
    /// 图片高度
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i32>,
    /// 缩略图
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    /// 主色列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colors: Option<Vec<String>>,
    /// 图标风格
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_style: Option<String>,
    /// 图标分类
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_category: Option<String>,
    /// 配色方案 JSON
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_scheme_json: Option<String>,
    /// 配色氛围
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
    /// 布局分类
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_category: Option<String>,
    /// 布局元素数量
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element_count: Option<i32>,
    /// 布局预览图
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    /// Fabric.js JSON
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fabric_json: Option<String>,
}

/// 海报素材（完整视图）
///
/// 包含基础素材和海报扩展元数据的完整数据。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosterMaterial {
    /// 基础素材
    #[serde(flatten)]
    pub base: Material,
    /// 海报元数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<PosterMaterialMetadata>,
}

/// 素材
///
/// 存储项目级素材，包含文档、图片、文本等参考资料。
/// 用于 AI 创作时的引用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Material {
    /// 唯一标识
    pub id: String,
    /// 所属项目 ID
    pub project_id: String,
    /// 素材名称
    pub name: String,
    /// 素材类型
    #[serde(rename = "type")]
    pub material_type: String,
    /// 文件路径（本地存储路径）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    /// 文件大小（字节）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<i64>,
    /// MIME 类型
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// 文本内容（用于 text 类型或提取的内容）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// 标签列表
    #[serde(default)]
    pub tags: Vec<String>,
    /// 素材描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 创建时间（Unix 时间戳）
    pub created_at: i64,
}

/// 上传素材请求
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadMaterialRequest {
    /// 所属项目 ID
    pub project_id: String,
    /// 素材名称
    pub name: String,
    /// 素材类型
    #[serde(rename = "type")]
    pub material_type: String,
    /// 文件路径（上传的临时文件路径）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    /// 文本内容（用于 text 类型）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// 标签列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// 素材描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// 更新素材请求
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MaterialUpdate {
    /// 素材名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 标签列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// 素材描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// 素材筛选条件
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MaterialFilter {
    /// 按类型筛选
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub material_type: Option<String>,
    /// 按标签筛选
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// 搜索关键词
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_query: Option<String>,
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
// 项目上下文相关类型
// ============================================================================

/// 项目上下文
///
/// 聚合项目的所有配置信息，用于注入到 AI System Prompt。
/// 包含项目基本信息、默认人设和素材列表。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContext {
    /// 项目信息
    pub project: crate::workspace::Workspace,
    /// 默认人设（如果有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persona: Option<Persona>,
    /// 素材列表
    #[serde(default)]
    pub materials: Vec<Material>,
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_material_type_conversion() {
        assert_eq!(MaterialType::Document.as_str(), "document");
        assert_eq!(MaterialType::Image.as_str(), "image");
        assert_eq!(MaterialType::Audio.as_str(), "audio");
        assert_eq!(MaterialType::Video.as_str(), "video");
        assert_eq!(MaterialType::Text.as_str(), "text");
        assert_eq!(MaterialType::Data.as_str(), "data");
        assert_eq!(MaterialType::Link.as_str(), "link");
        assert_eq!(MaterialType::Icon.as_str(), "icon");
        assert_eq!(MaterialType::Color.as_str(), "color");
        assert_eq!(MaterialType::Layout.as_str(), "layout");

        assert_eq!(
            "document".parse::<MaterialType>().unwrap(),
            MaterialType::Document
        );
        assert_eq!(
            "IMAGE".parse::<MaterialType>().unwrap(),
            MaterialType::Image
        );
        assert_eq!(
            "audio".parse::<MaterialType>().unwrap(),
            MaterialType::Audio
        );
        assert_eq!(
            "VIDEO".parse::<MaterialType>().unwrap(),
            MaterialType::Video
        );
        assert_eq!("icon".parse::<MaterialType>().unwrap(), MaterialType::Icon);
        assert_eq!(
            "color".parse::<MaterialType>().unwrap(),
            MaterialType::Color
        );
        assert_eq!(
            "layout".parse::<MaterialType>().unwrap(),
            MaterialType::Layout
        );
        assert_eq!(
            "unknown".parse::<MaterialType>().unwrap(),
            MaterialType::Document
        );
    }

    #[test]
    fn test_material_type_is_poster_material() {
        assert!(MaterialType::Image.is_poster_material());
        assert!(MaterialType::Icon.is_poster_material());
        assert!(MaterialType::Color.is_poster_material());
        assert!(MaterialType::Layout.is_poster_material());
        assert!(!MaterialType::Document.is_poster_material());
        assert!(!MaterialType::Audio.is_poster_material());
        assert!(!MaterialType::Video.is_poster_material());
        assert!(!MaterialType::Text.is_poster_material());
        assert!(!MaterialType::Data.is_poster_material());
        assert!(!MaterialType::Link.is_poster_material());
    }

    #[test]
    fn test_image_category_conversion() {
        assert_eq!(ImageCategory::Background.as_str(), "background");
        assert_eq!(ImageCategory::Product.as_str(), "product");
        assert_eq!(ImageCategory::Person.as_str(), "person");

        assert_eq!(
            "background".parse::<ImageCategory>().unwrap(),
            ImageCategory::Background
        );
        assert_eq!(
            "PRODUCT".parse::<ImageCategory>().unwrap(),
            ImageCategory::Product
        );
        assert_eq!(
            "unknown".parse::<ImageCategory>().unwrap(),
            ImageCategory::Other
        );

        assert_eq!(ImageCategory::Background.display_name(), "背景");
        assert_eq!(ImageCategory::Product.display_name(), "产品");
    }

    #[test]
    fn test_layout_category_conversion() {
        assert_eq!(LayoutCategory::HeroImage.as_str(), "hero-image");
        assert_eq!(LayoutCategory::TextDominant.as_str(), "text-dominant");
        assert_eq!(LayoutCategory::Grid.as_str(), "grid");

        assert_eq!(
            "hero-image".parse::<LayoutCategory>().unwrap(),
            LayoutCategory::HeroImage
        );
        assert_eq!(
            "grid".parse::<LayoutCategory>().unwrap(),
            LayoutCategory::Grid
        );
        assert_eq!(
            "unknown".parse::<LayoutCategory>().unwrap(),
            LayoutCategory::HeroImage
        );

        assert_eq!(LayoutCategory::HeroImage.display_name(), "大图型");
        assert_eq!(LayoutCategory::Grid.display_name(), "网格型");
    }

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
    fn test_material_serialization() {
        let material = Material {
            id: "mat-1".to_string(),
            project_id: "project-1".to_string(),
            name: "测试素材.pdf".to_string(),
            material_type: "document".to_string(),
            file_path: Some("/path/to/file.pdf".to_string()),
            file_size: Some(1024),
            mime_type: Some("application/pdf".to_string()),
            content: None,
            tags: vec!["标签1".to_string()],
            description: Some("测试描述".to_string()),
            created_at: 1234567890,
        };

        let json = serde_json::to_string(&material).unwrap();
        assert!(json.contains("\"type\":\"document\""));

        let parsed: Material = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.material_type, "document");
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

    #[test]
    fn test_upload_material_request() {
        let req = UploadMaterialRequest {
            project_id: "project-1".to_string(),
            name: "文档.pdf".to_string(),
            material_type: "document".to_string(),
            file_path: Some("/tmp/upload.pdf".to_string()),
            content: None,
            tags: Some(vec!["参考".to_string()]),
            description: Some("参考文档".to_string()),
        };

        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"type\":\"document\""));
    }

    #[test]
    fn test_default_values() {
        assert_eq!(MaterialType::default(), MaterialType::Document);
        assert_eq!(Platform::default(), Platform::Markdown);
    }
}
