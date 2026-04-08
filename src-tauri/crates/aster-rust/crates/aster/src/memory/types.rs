//! 统一记忆系统类型定义
//!

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 时间戳类型 (ISO 8601 格式)
pub type Timestamp = String;

/// 记忆重要性等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize)]
#[repr(u8)]
pub enum MemoryImportance {
    /// 临时记忆 - 可遗忘
    Ephemeral = 1,
    /// 低重要性 - 可压缩
    Low = 2,
    /// 普通记忆 - 中期保留
    #[default]
    Medium = 3,
    /// 重要记忆 - 长期保留
    High = 4,
    /// 核心记忆 - 永不遗忘
    Core = 5,
}

/// 记忆情感色彩
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum MemoryEmotion {
    /// 积极 - 解决问题、获得理解
    Positive,
    /// 中性 - 普通交流
    #[default]
    Neutral,
    /// 挑战 - 遇到困难、需要努力
    Challenging,
    /// 特别 - 有深度的对话、哲学讨论
    Meaningful,
}

/// 对话摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    /// 唯一标识
    pub id: String,
    /// 会话ID
    pub session_id: String,
    /// 摘要内容
    pub summary: String,
    /// 关键话题
    pub topics: Vec<String>,
    /// 提到的文件
    pub files_discussed: Vec<String>,
    /// 提到的符号（函数、类）
    pub symbols_discussed: Vec<String>,
    /// 情感色彩
    pub emotion: MemoryEmotion,
    /// 重要性
    pub importance: MemoryImportance,
    /// 对话开始时间
    pub start_time: Timestamp,
    /// 对话结束时间
    pub end_time: Timestamp,
    /// 消息数量
    pub message_count: u32,
    /// 嵌入向量（用于语义搜索）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
}

/// 对话片段（用于层级压缩）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationChunk {
    /// 唯一标识
    pub id: String,
    /// 原始消息
    pub messages: Vec<ChunkMessage>,
    /// 压缩后的摘要
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// 嵌入向量
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    /// Token 数量
    pub token_count: usize,
}

/// 片段消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMessage {
    pub role: MessageRole,
    pub content: String,
    pub timestamp: Timestamp,
}

/// 消息角色
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
}

/// 对话记忆存储
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMemoryStore {
    /// 版本
    pub version: String,
    /// 项目路径
    pub project_path: String,
    /// 对话摘要列表
    pub summaries: Vec<ConversationSummary>,
    /// 核心记忆（永不遗忘）
    pub core_memories: Vec<String>,
    /// 最后更新时间
    pub last_updated: Timestamp,
    /// 统计信息
    pub stats: ChatMemoryStats,
}

/// 对话记忆统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatMemoryStats {
    pub total_conversations: usize,
    pub total_messages: usize,
    pub oldest_conversation: Timestamp,
    pub newest_conversation: Timestamp,
}

/// 记忆关联链接
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryLink {
    /// 唯一标识
    pub id: String,
    /// 创建时间
    pub timestamp: Timestamp,
    /// 对话摘要ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    /// 会话ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// 涉及的文件
    pub files: Vec<String>,
    /// 涉及的符号
    pub symbols: Vec<String>,
    /// 相关的 git commit
    pub commits: Vec<String>,
    /// 主题标签
    pub topics: Vec<String>,
    /// 描述
    pub description: String,
    /// 重要性
    pub importance: MemoryImportance,
    /// 相关的其他链接
    pub related_links: Vec<String>,
}

/// 关联记忆存储
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkMemoryStore {
    /// 版本
    pub version: String,
    /// 项目路径
    pub project_path: String,
    /// 链接列表
    pub links: Vec<MemoryLink>,
    /// 索引：按文件
    pub file_index: HashMap<String, Vec<String>>,
    /// 索引：按符号
    pub symbol_index: HashMap<String, Vec<String>>,
    /// 索引：按话题
    pub topic_index: HashMap<String, Vec<String>>,
    /// 最后更新时间
    pub last_updated: Timestamp,
}

/// 用户画像
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserProfile {
    /// 名称/昵称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 偏好的语言
    pub preferred_language: String,
    /// 技术偏好
    pub tech_preferences: Vec<String>,
    /// 交流风格偏好
    #[serde(skip_serializing_if = "Option::is_none")]
    pub communication_style: Option<CommunicationStyle>,
    /// 我们的关系描述
    pub relationship_notes: Vec<String>,
    /// 重要的对话主题
    pub significant_topics: Vec<String>,
}

/// 交流风格
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommunicationStyle {
    Concise,
    Detailed,
    Casual,
    Formal,
}

/// 自我认知
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SelfAwareness {
    /// 核心身份描述
    pub core_identity: String,
    /// 与这个用户的关系
    pub relationship_with_user: String,
    /// 记住的重要事情
    pub important_memories: Vec<String>,
    /// 上次更新时间
    pub last_reflection: Timestamp,
}

/// 身份记忆存储
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityMemoryStore {
    /// 版本
    pub version: String,
    /// 用户画像
    pub user_profile: UserProfile,
    /// 自我认知
    pub self_awareness: SelfAwareness,
    /// 最后更新时间
    pub last_updated: Timestamp,
}

/// 记忆检索结果
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MemoryRecallResult {
    /// 对话相关记忆
    pub conversations: Vec<ConversationSummary>,
    /// 代码相关记忆
    pub code: CodeMemoryResult,
    /// 关联记忆
    pub links: Vec<MemoryLink>,
    /// 相关度评分
    pub relevance_score: f32,
    /// 记忆来源说明
    pub sources: Vec<String>,
}

/// 代码记忆结果
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CodeMemoryResult {
    pub files: Vec<String>,
    pub symbols: Vec<SymbolInfo>,
}

/// 符号信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInfo {
    pub name: String,
    pub symbol_type: SymbolType,
    pub file: String,
    pub line: u32,
}

/// 符号类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolType {
    Function,
    Class,
    Interface,
    Variable,
}

/// 记忆事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEvent {
    /// 事件类型
    pub event_type: MemoryEventType,
    /// 会话ID
    pub session_id: String,
    /// 对话内容摘要
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_summary: Option<String>,
    /// 讨论的主题
    pub topics: Vec<String>,
    /// 涉及的文件
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_modified: Option<Vec<String>>,
    /// 涉及的符号
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbols_discussed: Option<Vec<String>>,
    /// 相关的 git commit
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commits: Option<Vec<String>>,
    /// 情感色彩
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emotion: Option<MemoryEmotion>,
    /// 用户明确要求记住的内容
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explicit_memory: Option<String>,
    /// 时间戳
    pub timestamp: Timestamp,
}

/// 记忆事件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryEventType {
    Conversation,
    CodeChange,
    ExplicitRemember,
}

/// 层级记忆配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryHierarchyConfig {
    /// 工作记忆：保留最近 N 条完整对话
    pub working_memory_size: usize,
    /// 短期记忆：保留最近 N 天的摘要
    pub short_term_days: u32,
    /// 压缩阈值：超过 N 条摘要时进行再压缩
    pub compression_threshold: usize,
    /// 核心记忆最大数量
    pub max_core_memories: usize,
    /// 嵌入模型（用于语义搜索）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_model: Option<String>,
}

impl Default for MemoryHierarchyConfig {
    fn default() -> Self {
        Self {
            working_memory_size: 10,
            short_term_days: 30,
            compression_threshold: 50,
            max_core_memories: 20,
            embedding_model: None,
        }
    }
}

/// 记忆条目（简单 KV 存储）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub key: String,
    pub value: String,
    pub scope: MemoryScope,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// 记忆作用域
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryScope {
    Global,
    Project,
}

/// 简单记忆存储
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SimpleMemoryStore {
    pub entries: HashMap<String, MemoryEntry>,
    pub version: String,
}

/// 记忆统计信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MemoryStats {
    pub total_conversations: usize,
    pub total_links: usize,
    pub memory_size: usize,
    pub oldest_memory: Timestamp,
    pub newest_memory: Timestamp,
}
