//! 会话文件存储类型定义

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 会话元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    /// 会话 ID
    pub session_id: String,
    /// 会话标题（第一条用户消息摘要）
    pub title: Option<String>,
    /// 主题类型（general、document、video 等）
    pub theme: Option<String>,
    /// 创建模式（guided, fast）
    pub creation_mode: Option<String>,
    /// 创建时间（Unix 时间戳，毫秒）
    pub created_at: i64,
    /// 更新时间（Unix 时间戳，毫秒）
    pub updated_at: i64,
    /// 文件数量
    pub file_count: u32,
    /// 总文件大小（字节）
    pub total_size: u64,
}

impl SessionMeta {
    /// 创建新的会话元数据
    pub fn new(session_id: String) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            session_id,
            title: None,
            theme: None,
            creation_mode: None,
            created_at: now,
            updated_at: now,
            file_count: 0,
            total_size: 0,
        }
    }
}

/// 会话文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFile {
    /// 文件名
    pub name: String,
    /// 文件类型（document, image 等）
    pub file_type: String,
    /// 文件元数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
    /// 文件大小（字节）
    pub size: u64,
    /// 创建时间
    pub created_at: i64,
    /// 更新时间
    pub updated_at: i64,
}

/// 会话摘要（用于列表显示）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    /// 会话 ID
    pub session_id: String,
    /// 会话标题
    pub title: Option<String>,
    /// 主题类型
    pub theme: Option<String>,
    /// 创建时间
    pub created_at: i64,
    /// 更新时间
    pub updated_at: i64,
    /// 文件数量
    pub file_count: u32,
}

/// 会话详情（包含文件列表）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    /// 会话元数据
    pub meta: SessionMeta,
    /// 文件列表
    pub files: Vec<SessionFile>,
}
