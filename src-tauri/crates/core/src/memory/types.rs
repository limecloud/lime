//! Memory 类型定义
//!
//! 定义项目记忆系统相关的数据结构（角色、世界观、大纲等）。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 角色 ID
pub type CharacterId = String;

/// 大纲节点 ID
pub type OutlineNodeId = String;

/// 角色设定
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    /// 唯一标识
    pub id: CharacterId,
    /// 所属项目 ID
    pub project_id: String,
    /// 角色名称
    pub name: String,
    /// 角色别名/昵称
    #[serde(default)]
    pub aliases: Vec<String>,
    /// 角色描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 角色性格
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    /// 角色背景
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    /// 角色外貌
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<String>,
    /// 角色关系（与其他角色的关系）
    #[serde(default)]
    pub relationships: Vec<CharacterRelationship>,
    /// 角色头像 URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    /// 是否为主要角色
    #[serde(default)]
    pub is_main: bool,
    /// 排序顺序
    #[serde(default)]
    pub order: i32,
    /// 额外属性（JSON）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<serde_json::Value>,
    /// 创建时间
    pub created_at: DateTime<Utc>,
    /// 更新时间
    pub updated_at: DateTime<Utc>,
}

/// 角色关系
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterRelationship {
    /// 目标角色 ID
    pub target_id: CharacterId,
    /// 关系类型（如：朋友、敌人、恋人、家人等）
    pub relationship_type: String,
    /// 关系描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// 角色创建请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterCreateRequest {
    /// 所属项目 ID
    pub project_id: String,
    /// 角色名称
    pub name: String,
    /// 角色别名
    #[serde(default)]
    pub aliases: Vec<String>,
    /// 角色描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 角色性格
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    /// 角色背景
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    /// 角色外貌
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<String>,
    /// 是否为主要角色
    #[serde(default)]
    pub is_main: bool,
}

/// 角色更新请求
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CharacterUpdateRequest {
    /// 角色名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 角色别名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aliases: Option<Vec<String>>,
    /// 角色描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 角色性格
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    /// 角色背景
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    /// 角色外貌
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<String>,
    /// 角色关系
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relationships: Option<Vec<CharacterRelationship>>,
    /// 角色头像 URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    /// 是否为主要角色
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_main: Option<bool>,
    /// 排序顺序
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
    /// 额外属性
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<serde_json::Value>,
}

/// 世界观设定
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBuilding {
    /// 所属项目 ID
    pub project_id: String,
    /// 世界观描述
    pub description: String,
    /// 时代背景
    #[serde(skip_serializing_if = "Option::is_none")]
    pub era: Option<String>,
    /// 地点设定
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locations: Option<String>,
    /// 规则/设定
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<String>,
    /// 额外设定（JSON）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<serde_json::Value>,
    /// 更新时间
    pub updated_at: DateTime<Utc>,
}

/// 世界观更新请求
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorldBuildingUpdateRequest {
    /// 世界观描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 时代背景
    #[serde(skip_serializing_if = "Option::is_none")]
    pub era: Option<String>,
    /// 地点设定
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locations: Option<String>,
    /// 规则/设定
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<String>,
    /// 额外设定
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<serde_json::Value>,
}

/// 大纲节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutlineNode {
    /// 唯一标识
    pub id: OutlineNodeId,
    /// 所属项目 ID
    pub project_id: String,
    /// 父节点 ID（null 表示根节点）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<OutlineNodeId>,
    /// 节点标题
    pub title: String,
    /// 节点内容/描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// 关联的内容 ID（如关联到某一集/章节）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
    /// 排序顺序
    pub order: i32,
    /// 是否展开
    #[serde(default = "default_true")]
    pub expanded: bool,
    /// 额外属性（JSON）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<serde_json::Value>,
    /// 创建时间
    pub created_at: DateTime<Utc>,
    /// 更新时间
    pub updated_at: DateTime<Utc>,
}

fn default_true() -> bool {
    true
}

/// 大纲节点创建请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutlineNodeCreateRequest {
    /// 所属项目 ID
    pub project_id: String,
    /// 父节点 ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<OutlineNodeId>,
    /// 节点标题
    pub title: String,
    /// 节点内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// 关联的内容 ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
    /// 排序顺序
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
}

/// 大纲节点更新请求
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OutlineNodeUpdateRequest {
    /// 父节点 ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Option<OutlineNodeId>>,
    /// 节点标题
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 节点内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// 关联的内容 ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_id: Option<Option<String>>,
    /// 排序顺序
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
    /// 是否展开
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
    /// 额外属性
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<serde_json::Value>,
}

/// 项目记忆（聚合所有记忆数据）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectMemory {
    /// 角色列表
    pub characters: Vec<Character>,
    /// 世界观设定
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_building: Option<WorldBuilding>,
    /// 大纲
    pub outline: Vec<OutlineNode>,
}
