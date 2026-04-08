//! 消息和结果类型
//!
//! 定义入站消息、触发结果和触发上下文。

use std::collections::HashMap;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::auto_reply::keyword_matcher::KeywordMatchResult;
use crate::auto_reply::registry::AutoReplyTrigger;
use crate::auto_reply::types::TriggerType;

/// 入站消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingMessage {
    /// 消息 ID
    pub id: String,
    /// 发送者 ID
    pub sender_id: String,
    /// 发送者名称
    #[serde(default)]
    pub sender_name: Option<String>,
    /// 消息内容
    pub content: String,
    /// 渠道类型
    pub channel: String,
    /// 群组 ID（如果是群组消息）
    #[serde(default)]
    pub group_id: Option<String>,
    /// 是否是私聊
    #[serde(default)]
    pub is_direct_message: bool,
    /// 是否包含 @提及
    #[serde(default)]
    pub mentions_bot: bool,
    /// 消息时间戳
    pub timestamp: DateTime<Utc>,
    /// 附加元数据
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

/// 拒绝原因
#[derive(Debug, Clone)]
pub enum RejectionReason {
    /// 用户不在白名单
    NotInWhitelist,
    /// 在冷却时间内
    InCooldown { remaining: Duration },
    /// 群组未激活
    GroupNotActivated,
    /// 群组要求 @提及
    RequiresMention,
    /// 触发器已禁用
    TriggerDisabled,
}

/// 触发上下文
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerContext {
    /// 触发器 ID
    pub trigger_id: String,
    /// 触发类型
    pub trigger_type: TriggerType,
    /// 原始消息
    pub message: IncomingMessage,
    /// 匹配详情（关键词匹配时）
    #[serde(default, skip)]
    pub match_details: Option<KeywordMatchResult>,
    /// 触发时间
    pub triggered_at: DateTime<Utc>,
    /// 附加数据
    #[serde(default)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// 触发结果
#[derive(Debug, Clone)]
pub enum TriggerResult {
    /// 触发成功
    Triggered {
        trigger: Box<AutoReplyTrigger>,
        context: Box<TriggerContext>,
    },
    /// 触发被拒绝
    Rejected { reason: RejectionReason },
    /// 无匹配触发器
    NoMatch,
}
