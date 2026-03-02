//! Workspace 类型定义
//!
//! 定义 Workspace 相关的数据结构和类型。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Workspace 唯一标识
pub type WorkspaceId = String;

/// Workspace 类型
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceType {
    /// 持久化 workspace
    #[default]
    Persistent,
    /// 临时 workspace（自动清理）
    Temporary,
    /// 通用对话
    General,
    /// 社媒内容
    SocialMedia,
    /// 图文海报
    Poster,
    /// 歌词曲谱
    Music,
    /// 知识探索
    Knowledge,
    /// 计划规划
    Planning,
    /// 办公文档
    Document,
    /// 短视频
    Video,
    /// 小说创作
    Novel,
}

impl WorkspaceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkspaceType::Persistent => "persistent",
            WorkspaceType::Temporary => "temporary",
            WorkspaceType::General => "general",
            WorkspaceType::SocialMedia => "social-media",
            WorkspaceType::Poster => "poster",
            WorkspaceType::Music => "music",
            WorkspaceType::Knowledge => "knowledge",
            WorkspaceType::Planning => "planning",
            WorkspaceType::Document => "document",
            WorkspaceType::Video => "video",
            WorkspaceType::Novel => "novel",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "temporary" => WorkspaceType::Temporary,
            "general" => WorkspaceType::General,
            "social-media" => WorkspaceType::SocialMedia,
            "poster" => WorkspaceType::Poster,
            "music" => WorkspaceType::Music,
            "knowledge" => WorkspaceType::Knowledge,
            "planning" => WorkspaceType::Planning,
            "document" => WorkspaceType::Document,
            "video" => WorkspaceType::Video,
            "novel" => WorkspaceType::Novel,
            // 旧类型兼容映射
            "drama" => WorkspaceType::Video,
            "social" => WorkspaceType::SocialMedia,
            _ => WorkspaceType::Persistent,
        }
    }

    /// 判断是否为项目类型
    pub fn is_project_type(&self) -> bool {
        matches!(
            self,
            WorkspaceType::General
                | WorkspaceType::SocialMedia
                | WorkspaceType::Poster
                | WorkspaceType::Music
                | WorkspaceType::Knowledge
                | WorkspaceType::Planning
                | WorkspaceType::Document
                | WorkspaceType::Video
                | WorkspaceType::Novel
        )
    }
}

/// Workspace 级别设置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceSettings {
    /// Workspace 级 MCP 配置
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_config: Option<serde_json::Value>,
    /// 默认 provider
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_provider: Option<String>,
    /// 自动压缩 context
    #[serde(default)]
    pub auto_compact: bool,
}

/// 项目统计信息
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectStats {
    /// 内容数量
    #[serde(default)]
    pub content_count: i64,
    /// 总字数
    #[serde(default)]
    pub total_words: i64,
    /// 已完成数量
    #[serde(default)]
    pub completed_count: i64,
    /// 最后访问时间
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed: Option<DateTime<Utc>>,
}

/// Workspace 元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    /// 唯一标识
    pub id: WorkspaceId,
    /// 显示名称
    pub name: String,
    /// Workspace 类型
    pub workspace_type: WorkspaceType,
    /// 根目录路径（对应 Aster Session.working_dir）
    pub root_path: PathBuf,
    /// 是否为默认 workspace
    pub is_default: bool,
    /// 创建时间
    pub created_at: DateTime<Utc>,
    /// 更新时间
    pub updated_at: DateTime<Utc>,
    /// Workspace 级别设置
    pub settings: WorkspaceSettings,
    /// 项目图标（emoji 或图标名称）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// 项目颜色（hex 格式）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// 是否收藏
    #[serde(default)]
    pub is_favorite: bool,
    /// 是否归档
    #[serde(default)]
    pub is_archived: bool,
    /// 标签列表
    #[serde(default)]
    pub tags: Vec<String>,
    /// 项目统计信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<ProjectStats>,
}

/// Workspace 更新请求
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceUpdate {
    /// 新名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 新设置
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<WorkspaceSettings>,
    /// 项目图标
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// 项目颜色
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// 是否收藏
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_favorite: Option<bool>,
    /// 是否归档
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_archived: Option<bool>,
    /// 标签列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// 新根目录路径
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<PathBuf>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workspace_type_as_str() {
        assert_eq!(WorkspaceType::Persistent.as_str(), "persistent");
        assert_eq!(WorkspaceType::Temporary.as_str(), "temporary");
        assert_eq!(WorkspaceType::General.as_str(), "general");
        assert_eq!(WorkspaceType::SocialMedia.as_str(), "social-media");
        assert_eq!(WorkspaceType::Poster.as_str(), "poster");
        assert_eq!(WorkspaceType::Music.as_str(), "music");
        assert_eq!(WorkspaceType::Knowledge.as_str(), "knowledge");
        assert_eq!(WorkspaceType::Planning.as_str(), "planning");
        assert_eq!(WorkspaceType::Document.as_str(), "document");
        assert_eq!(WorkspaceType::Video.as_str(), "video");
        assert_eq!(WorkspaceType::Novel.as_str(), "novel");
    }

    #[test]
    fn test_workspace_type_from_str() {
        assert_eq!(
            WorkspaceType::parse("persistent"),
            WorkspaceType::Persistent
        );
        assert_eq!(WorkspaceType::parse("temporary"), WorkspaceType::Temporary);
        assert_eq!(WorkspaceType::parse("general"), WorkspaceType::General);
        assert_eq!(
            WorkspaceType::parse("social-media"),
            WorkspaceType::SocialMedia
        );
        assert_eq!(WorkspaceType::parse("poster"), WorkspaceType::Poster);
        assert_eq!(WorkspaceType::parse("music"), WorkspaceType::Music);
        assert_eq!(WorkspaceType::parse("knowledge"), WorkspaceType::Knowledge);
        assert_eq!(WorkspaceType::parse("planning"), WorkspaceType::Planning);
        assert_eq!(WorkspaceType::parse("document"), WorkspaceType::Document);
        assert_eq!(WorkspaceType::parse("video"), WorkspaceType::Video);
        assert_eq!(WorkspaceType::parse("novel"), WorkspaceType::Novel);
    }

    #[test]
    fn test_legacy_type_migration() {
        // 旧类型应该正确映射到新类型
        assert_eq!(WorkspaceType::parse("drama"), WorkspaceType::Video);
        assert_eq!(WorkspaceType::parse("social"), WorkspaceType::SocialMedia);
    }

    #[test]
    fn test_unknown_type_defaults_to_persistent() {
        assert_eq!(WorkspaceType::parse("unknown"), WorkspaceType::Persistent);
        assert_eq!(WorkspaceType::parse(""), WorkspaceType::Persistent);
        assert_eq!(WorkspaceType::parse("invalid"), WorkspaceType::Persistent);
    }

    #[test]
    fn test_is_project_type() {
        // 用户级类型应该返回 true
        assert!(WorkspaceType::General.is_project_type());
        assert!(WorkspaceType::SocialMedia.is_project_type());
        assert!(WorkspaceType::Poster.is_project_type());
        assert!(WorkspaceType::Music.is_project_type());
        assert!(WorkspaceType::Knowledge.is_project_type());
        assert!(WorkspaceType::Planning.is_project_type());
        assert!(WorkspaceType::Document.is_project_type());
        assert!(WorkspaceType::Video.is_project_type());
        assert!(WorkspaceType::Novel.is_project_type());

        // 系统级类型应该返回 false
        assert!(!WorkspaceType::Persistent.is_project_type());
        assert!(!WorkspaceType::Temporary.is_project_type());
    }

    #[test]
    fn test_serde_serialization() {
        // 测试序列化为 kebab-case
        let json = serde_json::to_string(&WorkspaceType::SocialMedia).unwrap();
        assert_eq!(json, "\"social-media\"");

        let json = serde_json::to_string(&WorkspaceType::Video).unwrap();
        assert_eq!(json, "\"video\"");

        let json = serde_json::to_string(&WorkspaceType::Persistent).unwrap();
        assert_eq!(json, "\"persistent\"");
    }

    #[test]
    fn test_serde_deserialization() {
        // 测试从 kebab-case 反序列化
        let wt: WorkspaceType = serde_json::from_str("\"social-media\"").unwrap();
        assert_eq!(wt, WorkspaceType::SocialMedia);

        let wt: WorkspaceType = serde_json::from_str("\"video\"").unwrap();
        assert_eq!(wt, WorkspaceType::Video);

        let wt: WorkspaceType = serde_json::from_str("\"persistent\"").unwrap();
        assert_eq!(wt, WorkspaceType::Persistent);
    }

    #[test]
    fn test_roundtrip_all_types() {
        let types = vec![
            WorkspaceType::Persistent,
            WorkspaceType::Temporary,
            WorkspaceType::General,
            WorkspaceType::SocialMedia,
            WorkspaceType::Poster,
            WorkspaceType::Music,
            WorkspaceType::Knowledge,
            WorkspaceType::Planning,
            WorkspaceType::Document,
            WorkspaceType::Video,
            WorkspaceType::Novel,
        ];

        for wt in types {
            let s = wt.as_str();
            let parsed = WorkspaceType::parse(s);
            assert_eq!(wt, parsed, "Roundtrip failed for {wt:?}");
        }
    }

    #[test]
    fn test_default_workspace_type() {
        let default_type = WorkspaceType::default();
        assert_eq!(default_type, WorkspaceType::Persistent);
    }

    #[test]
    fn test_workspace_type_clone() {
        let original = WorkspaceType::Video;
        let cloned = original.clone();
        assert_eq!(original, cloned);
    }

    #[test]
    fn test_workspace_type_debug() {
        let wt = WorkspaceType::SocialMedia;
        let debug_str = format!("{wt:?}");
        assert_eq!(debug_str, "SocialMedia");
    }
}
