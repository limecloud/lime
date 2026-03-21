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

fn default_image_generation_allow_fallback() -> bool {
    true
}

/// 图片生成偏好设置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImageGenerationSettings {
    /// 默认图片 Provider ID
    #[serde(
        skip_serializing_if = "Option::is_none",
        alias = "preferred_provider_id"
    )]
    pub preferred_provider_id: Option<String>,
    /// 默认图片模型 ID
    #[serde(skip_serializing_if = "Option::is_none", alias = "preferred_model_id")]
    pub preferred_model_id: Option<String>,
    /// 默认图片 Provider 不可用时是否允许回退自动选择
    #[serde(
        default = "default_image_generation_allow_fallback",
        alias = "allow_fallback"
    )]
    pub allow_fallback: bool,
}

/// 视频生成偏好设置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceVideoGenerationSettings {
    #[serde(
        skip_serializing_if = "Option::is_none",
        alias = "preferred_provider_id"
    )]
    pub preferred_provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "preferred_model_id")]
    pub preferred_model_id: Option<String>,
    #[serde(
        default = "default_image_generation_allow_fallback",
        alias = "allow_fallback"
    )]
    pub allow_fallback: bool,
}

impl Default for WorkspaceVideoGenerationSettings {
    fn default() -> Self {
        Self {
            preferred_provider_id: None,
            preferred_model_id: None,
            allow_fallback: true,
        }
    }
}

/// 语音生成偏好设置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceVoiceGenerationSettings {
    #[serde(
        skip_serializing_if = "Option::is_none",
        alias = "preferred_provider_id"
    )]
    pub preferred_provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "preferred_model_id")]
    pub preferred_model_id: Option<String>,
    #[serde(
        default = "default_image_generation_allow_fallback",
        alias = "allow_fallback"
    )]
    pub allow_fallback: bool,
}

impl Default for WorkspaceVoiceGenerationSettings {
    fn default() -> Self {
        Self {
            preferred_provider_id: None,
            preferred_model_id: None,
            allow_fallback: true,
        }
    }
}

impl Default for WorkspaceImageGenerationSettings {
    fn default() -> Self {
        Self {
            preferred_provider_id: None,
            preferred_model_id: None,
            allow_fallback: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceTeamSelectionSource {
    Builtin,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTeamSelectionReference {
    pub id: String,
    pub source: WorkspaceTeamSelectionSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAgentTeamRoleSettings {
    pub id: String,
    pub label: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none", alias = "profile_id")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "role_key")]
    pub role_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "skill_ids")]
    pub skill_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAgentCustomTeamSettings {
    pub id: String,
    pub label: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "preset_id")]
    pub preset_id: Option<String>,
    pub roles: Vec<WorkspaceAgentTeamRoleSettings>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "created_at")]
    pub created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "updated_at")]
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAgentTeamSettings {
    #[serde(skip_serializing_if = "Option::is_none", alias = "selected_team")]
    pub selected_team: Option<WorkspaceTeamSelectionReference>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none", alias = "custom_teams")]
    pub custom_teams: Option<Vec<WorkspaceAgentCustomTeamSettings>>,
}

/// Workspace 级别设置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    /// Workspace 级 MCP 配置
    #[serde(skip_serializing_if = "Option::is_none", alias = "mcp_config")]
    pub mcp_config: Option<serde_json::Value>,
    /// 默认 provider
    #[serde(skip_serializing_if = "Option::is_none", alias = "default_provider")]
    pub default_provider: Option<String>,
    /// 自动压缩 context
    #[serde(default, alias = "auto_compact")]
    pub auto_compact: bool,
    /// 图片生成偏好
    #[serde(skip_serializing_if = "Option::is_none", alias = "image_generation")]
    pub image_generation: Option<WorkspaceImageGenerationSettings>,
    /// 视频生成偏好
    #[serde(skip_serializing_if = "Option::is_none", alias = "video_generation")]
    pub video_generation: Option<WorkspaceVideoGenerationSettings>,
    /// 语音生成偏好
    #[serde(skip_serializing_if = "Option::is_none", alias = "voice_generation")]
    pub voice_generation: Option<WorkspaceVoiceGenerationSettings>,
    /// Team 运行时偏好
    #[serde(skip_serializing_if = "Option::is_none", alias = "agent_team")]
    pub agent_team: Option<WorkspaceAgentTeamSettings>,
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

    #[test]
    fn test_workspace_settings_accepts_legacy_snake_case() {
        let settings: WorkspaceSettings = serde_json::from_str(
            r#"{
                "default_provider": "openai",
                "auto_compact": true,
                "image_generation": {
                    "preferred_provider_id": "new-api",
                    "preferred_model_id": "gpt-image-1",
                    "allow_fallback": false
                },
                "video_generation": {
                    "preferred_provider_id": "doubao-video",
                    "preferred_model_id": "seedance-1-5-pro-251215",
                    "allow_fallback": true
                },
                "voice_generation": {
                    "preferred_provider_id": "openai-tts",
                    "preferred_model_id": "gpt-4o-mini-tts",
                    "allow_fallback": false
                },
                "agent_team": {
                    "selected_team": {
                        "id": "code-triage-team",
                        "source": "builtin"
                    },
                    "custom_teams": [
                        {
                            "id": "custom-team-1",
                            "label": "项目联调 Team",
                            "description": "用于当前项目的前端联调。",
                            "roles": [
                                {
                                    "id": "planner",
                                    "label": "分析",
                                    "summary": "先确认边界再安排执行",
                                    "profile_id": "code-explorer",
                                    "role_key": "explorer",
                                    "skill_ids": ["source-grounding"]
                                }
                            ]
                        }
                    ],
                    "disabled": false
                }
            }"#,
        )
        .unwrap();

        assert_eq!(settings.default_provider.as_deref(), Some("openai"));
        assert!(settings.auto_compact);
        let image_generation = settings.image_generation.expect("应解析图片配置");
        assert_eq!(
            image_generation.preferred_provider_id.as_deref(),
            Some("new-api")
        );
        assert_eq!(
            image_generation.preferred_model_id.as_deref(),
            Some("gpt-image-1")
        );
        assert!(!image_generation.allow_fallback);
        let video_generation = settings.video_generation.expect("应解析视频配置");
        assert_eq!(
            video_generation.preferred_provider_id.as_deref(),
            Some("doubao-video")
        );
        assert_eq!(
            video_generation.preferred_model_id.as_deref(),
            Some("seedance-1-5-pro-251215")
        );
        assert!(video_generation.allow_fallback);
        let voice_generation = settings.voice_generation.expect("应解析语音配置");
        assert_eq!(
            voice_generation.preferred_provider_id.as_deref(),
            Some("openai-tts")
        );
        assert_eq!(
            voice_generation.preferred_model_id.as_deref(),
            Some("gpt-4o-mini-tts")
        );
        assert!(!voice_generation.allow_fallback);
        let agent_team = settings.agent_team.expect("应解析 Team 配置");
        let selected_team = agent_team.selected_team.expect("应解析 Team 选择");
        assert_eq!(selected_team.id, "code-triage-team");
        assert!(matches!(
            selected_team.source,
            WorkspaceTeamSelectionSource::Builtin
        ));
        assert!(!agent_team.disabled);
        let custom_teams = agent_team.custom_teams.expect("应解析自定义 Team 列表");
        assert_eq!(custom_teams.len(), 1);
        assert_eq!(custom_teams[0].label, "项目联调 Team");
        assert_eq!(custom_teams[0].roles.len(), 1);
        assert_eq!(
            custom_teams[0].roles[0].profile_id.as_deref(),
            Some("code-explorer")
        );
        assert_eq!(
            custom_teams[0].roles[0].role_key.as_deref(),
            Some("explorer")
        );
    }

    #[test]
    fn test_workspace_settings_serializes_to_camel_case() {
        let settings = WorkspaceSettings {
            image_generation: Some(WorkspaceImageGenerationSettings {
                preferred_provider_id: Some("new-api".to_string()),
                preferred_model_id: Some("gpt-image-1".to_string()),
                allow_fallback: false,
            }),
            video_generation: Some(WorkspaceVideoGenerationSettings {
                preferred_provider_id: Some("doubao-video".to_string()),
                preferred_model_id: Some("seedance-1-5-pro-251215".to_string()),
                allow_fallback: true,
            }),
            voice_generation: Some(WorkspaceVoiceGenerationSettings {
                preferred_provider_id: Some("openai-tts".to_string()),
                preferred_model_id: Some("gpt-4o-mini-tts".to_string()),
                allow_fallback: false,
            }),
            agent_team: Some(WorkspaceAgentTeamSettings {
                selected_team: Some(WorkspaceTeamSelectionReference {
                    id: "code-triage-team".to_string(),
                    source: WorkspaceTeamSelectionSource::Builtin,
                }),
                custom_teams: Some(vec![WorkspaceAgentCustomTeamSettings {
                    id: "custom-team-1".to_string(),
                    label: "项目联调 Team".to_string(),
                    description: "用于当前项目的前端联调。".to_string(),
                    theme: Some("general".to_string()),
                    preset_id: Some("code-triage-team".to_string()),
                    roles: vec![WorkspaceAgentTeamRoleSettings {
                        id: "planner".to_string(),
                        label: "分析".to_string(),
                        summary: "先确认边界再安排执行".to_string(),
                        profile_id: Some("code-explorer".to_string()),
                        role_key: Some("explorer".to_string()),
                        skill_ids: Some(vec!["source-grounding".to_string()]),
                    }],
                    created_at: Some(1),
                    updated_at: Some(2),
                }]),
                disabled: false,
            }),
            ..WorkspaceSettings::default()
        };

        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(
            value
                .get("imageGeneration")
                .and_then(|item| item.get("preferredProviderId"))
                .and_then(|item| item.as_str()),
            Some("new-api")
        );
        assert_eq!(
            value
                .get("imageGeneration")
                .and_then(|item| item.get("preferredModelId"))
                .and_then(|item| item.as_str()),
            Some("gpt-image-1")
        );
        assert_eq!(
            value
                .get("imageGeneration")
                .and_then(|item| item.get("allowFallback"))
                .and_then(|item| item.as_bool()),
            Some(false)
        );
        assert_eq!(
            value
                .get("videoGeneration")
                .and_then(|item| item.get("preferredProviderId"))
                .and_then(|item| item.as_str()),
            Some("doubao-video")
        );
        assert_eq!(
            value
                .get("voiceGeneration")
                .and_then(|item| item.get("preferredModelId"))
                .and_then(|item| item.as_str()),
            Some("gpt-4o-mini-tts")
        );
        assert_eq!(
            value
                .get("agentTeam")
                .and_then(|item| item.get("selectedTeam"))
                .and_then(|item| item.get("id"))
                .and_then(|item| item.as_str()),
            Some("code-triage-team")
        );
        assert_eq!(
            value
                .get("agentTeam")
                .and_then(|item| item.get("disabled"))
                .and_then(|item| item.as_bool()),
            Some(false)
        );
        assert_eq!(
            value
                .get("agentTeam")
                .and_then(|item| item.get("customTeams"))
                .and_then(|item| item.get(0))
                .and_then(|item| item.get("label"))
                .and_then(|item| item.as_str()),
            Some("项目联调 Team")
        );
        assert_eq!(
            value
                .get("agentTeam")
                .and_then(|item| item.get("customTeams"))
                .and_then(|item| item.get(0))
                .and_then(|item| item.get("roles"))
                .and_then(|item| item.get(0))
                .and_then(|item| item.get("profileId"))
                .and_then(|item| item.as_str()),
            Some("code-explorer")
        );
    }
}
