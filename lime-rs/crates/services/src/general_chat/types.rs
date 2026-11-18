//! 通用对话类型定义
//!
//! 定义会话、消息等核心数据结构
//!
//! ## 主要类型
//! - `ChatSession` - 对话会话
//! - `ChatMessage` - 对话消息
//! - `MessageRole` - 消息角色枚举
//! - `ContentBlock` - 内容块（代码、文件等）

use serde::{Deserialize, Serialize};

/// 对话会话
///
/// 表示一个完整的对话会话，包含会话元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    /// 会话唯一标识
    pub id: String,
    /// 会话名称/标题
    pub name: String,
    /// 创建时间戳（毫秒）
    pub created_at: i64,
    /// 更新时间戳（毫秒）
    pub updated_at: i64,
    /// 额外元数据（JSON 格式）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// 消息角色
///
/// 标识消息的发送者类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    /// 用户消息
    #[default]
    User,
    /// AI 助手消息
    Assistant,
    /// 系统消息
    System,
}

/// 消息状态
///
/// 标识消息的当前处理状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum MessageStatus {
    /// 等待发送
    #[default]
    Pending,
    /// 流式生成中
    Streaming,
    /// 已完成
    Complete,
    /// 发生错误
    Error,
}

/// 内容块
///
/// 表示消息中的一个内容单元，可以是文本、代码、图片或文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentBlock {
    /// 内容块类型：text, code, image, file
    #[serde(rename = "type")]
    pub r#type: String,
    /// 内容文本
    pub content: String,
    /// 代码块语言（仅 type=code 时有效）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// 文件名（仅 type=file 时有效）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    /// MIME 类型
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// 对话消息
///
/// 表示会话中的一条消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// 消息唯一标识
    pub id: String,
    /// 所属会话 ID
    pub session_id: String,
    /// 消息角色
    pub role: MessageRole,
    /// 消息文本内容
    pub content: String,
    /// 内容块列表（代码块、文件等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<ContentBlock>>,
    /// 消息状态
    pub status: String,
    /// 创建时间戳（毫秒）
    pub created_at: i64,
    /// 额外元数据（模型、token 数等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// 会话详情（包含消息列表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionDetail {
    /// 会话信息
    pub session: ChatSession,
    /// 消息列表
    pub messages: Vec<ChatMessage>,
    /// 消息总数
    pub message_count: i64,
}

/// 创建会话请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    /// 会话名称（可选，默认为"新对话"）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 额外元数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// 创建消息请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMessageRequest {
    /// 所属会话 ID
    pub session_id: String,
    /// 消息角色
    pub role: MessageRole,
    /// 消息内容
    pub content: String,
    /// 内容块列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<ContentBlock>>,
    /// 额外元数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_session_serialization() {
        let session = ChatSession {
            id: "test-id".to_string(),
            name: "测试会话".to_string(),
            created_at: 1700000000000,
            updated_at: 1700000000000,
            metadata: None,
        };

        let json = serde_json::to_string(&session).unwrap();
        let deserialized: ChatSession = serde_json::from_str(&json).unwrap();

        assert_eq!(session.id, deserialized.id);
        assert_eq!(session.name, deserialized.name);
    }

    #[test]
    fn test_message_role_serialization() {
        let role = MessageRole::User;
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(json, "\"user\"");

        let role = MessageRole::Assistant;
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(json, "\"assistant\"");

        let role = MessageRole::System;
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(json, "\"system\"");
    }

    #[test]
    fn test_chat_message_serialization() {
        let message = ChatMessage {
            id: "msg-1".to_string(),
            session_id: "session-1".to_string(),
            role: MessageRole::User,
            content: "你好".to_string(),
            blocks: None,
            status: "complete".to_string(),
            created_at: 1700000000000,
            metadata: None,
        };

        let json = serde_json::to_string(&message).unwrap();
        let deserialized: ChatMessage = serde_json::from_str(&json).unwrap();

        assert_eq!(message.id, deserialized.id);
        assert_eq!(message.content, deserialized.content);
        assert_eq!(message.role, deserialized.role);
    }

    #[test]
    fn test_content_block_serialization() {
        let block = ContentBlock {
            r#type: "code".to_string(),
            content: "fn main() {}".to_string(),
            language: Some("rust".to_string()),
            filename: None,
            mime_type: None,
        };

        let json = serde_json::to_string(&block).unwrap();
        assert!(json.contains("\"type\":\"code\""));
        assert!(json.contains("\"language\":\"rust\""));
    }
}
