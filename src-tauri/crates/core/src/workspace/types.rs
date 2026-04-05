//! Workspace 类型定义
//!
//! 定义 Workspace 相关的数据结构和类型。

use chrono::{DateTime, Utc};
use serde::{de, Deserialize, Deserializer, Serialize};
use std::path::PathBuf;

/// Workspace 唯一标识
pub type WorkspaceId = String;

/// Workspace 类型
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceType {
    /// 持久化 workspace
    #[default]
    Persistent,
    /// 临时 workspace（自动清理）
    Temporary,
    /// 通用对话
    General,
}

impl<'de> Deserialize<'de> for WorkspaceType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse_current(&value).ok_or_else(|| {
            de::Error::unknown_variant(&value, &["persistent", "temporary", "general"])
        })
    }
}

impl WorkspaceType {
    fn parse_current(value: &str) -> Option<Self> {
        match value {
            "persistent" => Some(WorkspaceType::Persistent),
            "temporary" => Some(WorkspaceType::Temporary),
            "general" => Some(WorkspaceType::General),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            WorkspaceType::Persistent => "persistent",
            WorkspaceType::Temporary => "temporary",
            WorkspaceType::General => "general",
        }
    }

    pub fn parse_persisted(s: &str) -> Self {
        Self::parse_current(s).unwrap_or(WorkspaceType::Persistent)
    }

    pub fn parse_user_input(s: &str) -> Result<Self, String> {
        if let Some(workspace_type) = Self::parse_current(s) {
            return Ok(workspace_type);
        }

        Err(format!(
            "不支持的 workspace_type '{s}'，仅支持 persistent / temporary / general"
        ))
    }

    /// 判断是否为项目类型
    pub fn is_project_type(&self) -> bool {
        matches!(self, WorkspaceType::General)
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl Default for WorkspaceSettings {
    fn default() -> Self {
        Self {
            mcp_config: None,
            default_provider: None,
            // 默认启用自动压缩，让长线程按上下文窗口阈值在下一回合前优先收缩上下文。
            auto_compact: true,
            image_generation: None,
            video_generation: None,
            voice_generation: None,
            agent_team: None,
        }
    }
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
    }

    #[test]
    fn test_workspace_type_from_str() {
        assert_eq!(
            WorkspaceType::parse_persisted("persistent"),
            WorkspaceType::Persistent
        );
        assert_eq!(
            WorkspaceType::parse_persisted("temporary"),
            WorkspaceType::Temporary
        );
        assert_eq!(
            WorkspaceType::parse_persisted("general"),
            WorkspaceType::General
        );
    }

    #[test]
    fn test_unknown_type_defaults_to_persistent() {
        assert_eq!(
            WorkspaceType::parse_persisted("unknown"),
            WorkspaceType::Persistent
        );
        assert_eq!(
            WorkspaceType::parse_persisted(""),
            WorkspaceType::Persistent
        );
        assert_eq!(
            WorkspaceType::parse_persisted("invalid"),
            WorkspaceType::Persistent
        );
    }

    #[test]
    fn test_is_project_type() {
        assert!(WorkspaceType::General.is_project_type());
        assert!(!WorkspaceType::Persistent.is_project_type());
        assert!(!WorkspaceType::Temporary.is_project_type());
    }

    #[test]
    fn test_serde_serialization() {
        let json = serde_json::to_string(&WorkspaceType::Persistent).unwrap();
        assert_eq!(json, "\"persistent\"");

        let json = serde_json::to_string(&WorkspaceType::General).unwrap();
        assert_eq!(json, "\"general\"");
    }

    #[test]
    fn test_serde_deserialization() {
        let wt: WorkspaceType = serde_json::from_str("\"persistent\"").unwrap();
        assert_eq!(wt, WorkspaceType::Persistent);
        let wt: WorkspaceType = serde_json::from_str("\"temporary\"").unwrap();
        assert_eq!(wt, WorkspaceType::Temporary);
        let wt: WorkspaceType = serde_json::from_str("\"general\"").unwrap();
        assert_eq!(wt, WorkspaceType::General);
        let err = serde_json::from_str::<WorkspaceType>("\"legacy-workspace\"").unwrap_err();
        assert!(err.to_string().contains("unknown variant"));
    }

    #[test]
    fn test_roundtrip_all_types() {
        let types = vec![
            WorkspaceType::Persistent,
            WorkspaceType::Temporary,
            WorkspaceType::General,
        ];

        for wt in types {
            let s = wt.as_str();
            let parsed = WorkspaceType::parse_persisted(s);
            assert_eq!(wt, parsed, "Roundtrip failed for {wt:?}");
        }
    }

    #[test]
    fn test_parse_user_input_rejects_unknown_value() {
        let error = WorkspaceType::parse_user_input("unknown").unwrap_err();
        assert!(error.contains("仅支持 persistent / temporary / general"));
    }

    #[test]
    fn test_default_workspace_type() {
        let default_type = WorkspaceType::default();
        assert_eq!(default_type, WorkspaceType::Persistent);
    }

    #[test]
    fn test_workspace_type_clone() {
        let original = WorkspaceType::General;
        let cloned = original.clone();
        assert_eq!(original, cloned);
    }

    #[test]
    fn test_workspace_type_debug() {
        let wt = WorkspaceType::General;
        let debug_str = format!("{wt:?}");
        assert_eq!(debug_str, "General");
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
    fn test_workspace_settings_default_enables_auto_compact() {
        let settings = WorkspaceSettings::default();

        assert!(settings.auto_compact);
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
