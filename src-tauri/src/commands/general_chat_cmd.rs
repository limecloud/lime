//! 通用对话 Tauri 命令兼容层
//!
//! 该模块仅用于兼容旧版 `general-chat` 前端链路。
//! 新功能和后续治理请统一收口到 `unified_chat_cmd`。
//!
//! ## 主要命令
//! - `general_chat_create_session` - 创建新会话
//! - `general_chat_list_sessions` - 获取会话列表
//! - `general_chat_get_session` - 获取会话详情
//! - `general_chat_delete_session` - 删除会话
//! - `general_chat_rename_session` - 重命名会话
//! - `general_chat_add_message` - 已废弃直接写消息（显式报错）
//! - `general_chat_send_message` - 已废弃流式发送（显式报错）
//! - `general_chat_stop_generation` - 已废弃停止生成（显式报错）
//! - `general_chat_generate_title` - 已废弃标题生成（显式报错）
//! - `general_chat_get_messages` - 获取消息列表

use crate::database::dao::chat::{
    ChatDao, ChatMessage as UnifiedChatMessage, ChatMode, ChatSession as UnifiedChatSession,
};
use crate::database::dao::general_chat::GeneralChatDao;
use crate::database::DbConnection;
use once_cell::sync::Lazy;
use proxycast_services::general_chat::{
    ChatMessage, ChatSession, ContentBlock, MessageRole, SessionDetail,
};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

static LEGACY_WARNED_COMMANDS: Lazy<Mutex<HashSet<&'static str>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

fn warn_general_chat_legacy(command: &'static str, replacement: &'static str) {
    let should_warn = match LEGACY_WARNED_COMMANDS.lock() {
        Ok(mut warned) => warned.insert(command),
        Err(error) => {
            tracing::warn!(
                "[GeneralChat][Compat] 废弃命令告警状态异常: {}。命令 {} 仍通过兼容层提供，建议迁移到 {}",
                error,
                command,
                replacement
            );
            true
        }
    };

    if should_warn {
        tracing::warn!(
            "[GeneralChat][Compat] 命令 {} 仍通过兼容层提供，建议迁移到 {}。该入口仅用于兼容旧 UI，禁止继续叠加新逻辑。",
            command,
            replacement
        );
    }
}

fn general_chat_deprecated_error(command: &'static str, replacement: &'static str) -> String {
    format!(
        "命令 {command} 已废弃，请迁移到 {replacement}。该兼容入口已停止维护，禁止继续叠加新逻辑。"
    )
}

fn timestamp_ms_to_rfc3339(timestamp_ms: i64) -> String {
    use chrono::{TimeZone, Utc};

    let secs = timestamp_ms / 1000;
    let nsecs = ((timestamp_ms % 1000) * 1_000_000) as u32;

    match Utc.timestamp_opt(secs, nsecs) {
        chrono::LocalResult::Single(dt) => dt.to_rfc3339(),
        _ => Utc::now().to_rfc3339(),
    }
}

fn rfc3339_to_timestamp_ms(timestamp: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .map(|value| value.timestamp_millis())
        .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis())
}

fn general_message_role_name(role: &MessageRole) -> &'static str {
    match role {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::System => "system",
    }
}

fn overlay_general_session(
    legacy_session: Option<ChatSession>,
    unified_session: Option<&UnifiedChatSession>,
) -> Option<ChatSession> {
    match (legacy_session, unified_session) {
        (None, None) => None,
        (Some(mut session), Some(unified)) if unified.mode == ChatMode::General => {
            if let Some(title) = unified
                .title
                .as_deref()
                .map(str::trim)
                .filter(|title| !title.is_empty())
            {
                session.name = title.to_string();
            }
            session.created_at = session
                .created_at
                .min(rfc3339_to_timestamp_ms(&unified.created_at));
            session.updated_at = session
                .updated_at
                .max(rfc3339_to_timestamp_ms(&unified.updated_at));
            Some(session)
        }
        (Some(session), _) => Some(session),
        (None, Some(unified)) if unified.mode == ChatMode::General => Some(ChatSession {
            id: unified.id.clone(),
            name: unified
                .title
                .as_deref()
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .unwrap_or("新对话")
                .to_string(),
            created_at: rfc3339_to_timestamp_ms(&unified.created_at),
            updated_at: rfc3339_to_timestamp_ms(&unified.updated_at),
            metadata: unified.metadata.clone(),
        }),
        _ => None,
    }
}

fn json_value_as_str(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|item| item.as_str())
        .map(ToString::to_string)
        .filter(|item| !item.trim().is_empty())
}

fn convert_unified_content_part_to_general_block(
    object: &serde_json::Map<String, serde_json::Value>,
) -> Option<ContentBlock> {
    if let Some(text) = object.get("Text").and_then(|value| value.as_str()) {
        return Some(ContentBlock {
            r#type: "text".to_string(),
            content: text.to_string(),
            language: None,
            filename: None,
            mime_type: None,
        });
    }

    if let Some(text_obj) = object.get("Text").and_then(|value| value.as_object()) {
        if let Some(text) = json_value_as_str(text_obj.get("text"))
            .or_else(|| json_value_as_str(text_obj.get("content")))
        {
            return Some(ContentBlock {
                r#type: "text".to_string(),
                content: text,
                language: None,
                filename: None,
                mime_type: None,
            });
        }
    }

    if let Some(text) = json_value_as_str(object.get("text")) {
        return Some(ContentBlock {
            r#type: "text".to_string(),
            content: text,
            language: None,
            filename: None,
            mime_type: None,
        });
    }

    let part_type = object.get("type").and_then(|value| value.as_str());

    if matches!(
        part_type,
        Some("text" | "input_text" | "output_text" | "thinking")
    ) {
        if let Some(text) = json_value_as_str(object.get("content"))
            .or_else(|| json_value_as_str(object.get("text")))
        {
            return Some(ContentBlock {
                r#type: "text".to_string(),
                content: text,
                language: None,
                filename: None,
                mime_type: None,
            });
        }
    }

    if part_type == Some("code") {
        if let Some(code) = json_value_as_str(object.get("content"))
            .or_else(|| json_value_as_str(object.get("text")))
        {
            return Some(ContentBlock {
                r#type: "code".to_string(),
                content: code,
                language: json_value_as_str(object.get("language")),
                filename: json_value_as_str(object.get("filename")),
                mime_type: None,
            });
        }
    }

    if part_type == Some("file") {
        if let Some(path) = json_value_as_str(object.get("path"))
            .or_else(|| json_value_as_str(object.get("file_path")))
            .or_else(|| json_value_as_str(object.get("filePath")))
            .or_else(|| json_value_as_str(object.get("content")))
        {
            return Some(ContentBlock {
                r#type: "file".to_string(),
                content: path,
                language: None,
                filename: json_value_as_str(object.get("name"))
                    .or_else(|| json_value_as_str(object.get("filename"))),
                mime_type: json_value_as_str(object.get("mime_type"))
                    .or_else(|| json_value_as_str(object.get("media_type"))),
            });
        }
    }

    if matches!(part_type, Some("image_url" | "input_image")) {
        let image_url = object.get("image_url").or_else(|| object.get("url"));
        let url = image_url
            .and_then(|value| value.as_str().map(ToString::to_string))
            .or_else(|| {
                image_url
                    .and_then(|value| value.as_object())
                    .and_then(|value| json_value_as_str(value.get("url")))
            });

        if let Some(url) = url {
            return Some(ContentBlock {
                r#type: "image".to_string(),
                content: url,
                language: None,
                filename: None,
                mime_type: None,
            });
        }
    }

    if part_type == Some("image") {
        if let Some(url) = json_value_as_str(object.get("url"))
            .or_else(|| json_value_as_str(object.get("image_url")))
        {
            return Some(ContentBlock {
                r#type: "image".to_string(),
                content: url,
                language: None,
                filename: None,
                mime_type: None,
            });
        }

        let source = object.get("source").and_then(|value| value.as_object());
        let mime_type = json_value_as_str(object.get("mime_type"))
            .or_else(|| json_value_as_str(object.get("media_type")))
            .or_else(|| {
                source
                    .and_then(|value| json_value_as_str(value.get("mime_type")))
                    .or_else(|| source.and_then(|value| json_value_as_str(value.get("media_type"))))
            });
        let data = json_value_as_str(object.get("data"))
            .or_else(|| json_value_as_str(object.get("image_base64")))
            .or_else(|| source.and_then(|value| json_value_as_str(value.get("data"))));

        if let (Some(mime_type), Some(data)) = (mime_type, data) {
            return Some(ContentBlock {
                r#type: "image".to_string(),
                content: format!("data:{mime_type};base64,{data}"),
                language: None,
                filename: None,
                mime_type: Some(mime_type),
            });
        }
    }

    if let Some(image_url_obj) = object.get("image_url").and_then(|value| value.as_object()) {
        if let Some(url) = json_value_as_str(image_url_obj.get("url")) {
            return Some(ContentBlock {
                r#type: "image".to_string(),
                content: url,
                language: None,
                filename: None,
                mime_type: None,
            });
        }
    }

    if let Some(url) = json_value_as_str(object.get("image_url")) {
        return Some(ContentBlock {
            r#type: "image".to_string(),
            content: url,
            language: None,
            filename: None,
            mime_type: None,
        });
    }

    if let Some(text) = json_value_as_str(object.get("content")) {
        return Some(ContentBlock {
            r#type: "text".to_string(),
            content: text,
            language: None,
            filename: None,
            mime_type: None,
        });
    }

    None
}

fn convert_unified_content_to_general_parts(
    content: &serde_json::Value,
) -> (String, Option<Vec<ContentBlock>>) {
    match content {
        serde_json::Value::String(text) => (text.clone(), None),
        serde_json::Value::Array(items) => {
            let blocks: Vec<ContentBlock> = items
                .iter()
                .filter_map(|item| item.as_object())
                .filter_map(convert_unified_content_part_to_general_block)
                .collect();

            if blocks.is_empty() {
                return (serde_json::to_string(content).unwrap_or_default(), None);
            }

            let text_content = blocks
                .iter()
                .filter(|block| matches!(block.r#type.as_str(), "text" | "code" | "file"))
                .map(|block| block.content.clone())
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();

            let content = if !text_content.is_empty() {
                text_content
            } else if blocks.iter().any(|block| block.r#type == "image") {
                "[图片]".to_string()
            } else {
                serde_json::to_string(content).unwrap_or_default()
            };

            (content, Some(blocks))
        }
        serde_json::Value::Object(object) => {
            let block = convert_unified_content_part_to_general_block(object);
            if let Some(block) = block {
                let content = if matches!(block.r#type.as_str(), "text" | "code" | "file") {
                    block.content.clone()
                } else if block.r#type == "image" {
                    "[图片]".to_string()
                } else {
                    serde_json::to_string(content).unwrap_or_default()
                };
                (content, Some(vec![block]))
            } else {
                (serde_json::to_string(content).unwrap_or_default(), None)
            }
        }
        _ => (serde_json::to_string(content).unwrap_or_default(), None),
    }
}

fn convert_unified_message_to_general(message: UnifiedChatMessage) -> Option<ChatMessage> {
    let role = match message.role.as_str() {
        "user" => MessageRole::User,
        "assistant" => MessageRole::Assistant,
        "system" => MessageRole::System,
        _ => return None,
    };

    let (content, blocks) = convert_unified_content_to_general_parts(&message.content);
    if content.trim().is_empty() && blocks.as_ref().is_none_or(Vec::is_empty) {
        return None;
    }

    Some(ChatMessage {
        id: message.id.to_string(),
        session_id: message.session_id,
        role,
        content,
        blocks,
        status: "complete".to_string(),
        created_at: rfc3339_to_timestamp_ms(&message.created_at),
        metadata: message.metadata,
    })
}

fn general_message_identity_key(message: &ChatMessage) -> String {
    let blocks_signature =
        serde_json::to_string(&message.blocks).unwrap_or_else(|_| "[]".to_string());
    format!(
        "{}|{}|{}|{}",
        general_message_role_name(&message.role),
        message.created_at,
        message.content,
        blocks_signature
    )
}

fn merge_general_message_sources(
    legacy_messages: Vec<ChatMessage>,
    unified_messages: Vec<ChatMessage>,
) -> Vec<ChatMessage> {
    let mut seen = HashSet::new();
    let mut merged = Vec::new();

    for message in legacy_messages
        .into_iter()
        .chain(unified_messages.into_iter())
    {
        if seen.insert(general_message_identity_key(&message)) {
            merged.push(message);
        }
    }

    merged.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    merged
}

fn paginate_general_messages(
    messages: Vec<ChatMessage>,
    limit: Option<i32>,
    before_id: Option<&str>,
) -> Vec<ChatMessage> {
    let filtered = if let Some(before_id) = before_id {
        if let Some(index) = messages.iter().position(|message| message.id == before_id) {
            messages.into_iter().take(index).collect::<Vec<_>>()
        } else {
            messages
        }
    } else {
        messages
    };

    let Some(limit) = limit else {
        return filtered;
    };

    let limit = limit.max(0) as usize;
    if limit == 0 || filtered.len() <= limit {
        return filtered;
    }

    filtered[filtered.len() - limit..].to_vec()
}

fn load_merged_general_messages(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<ChatMessage>, String> {
    let legacy_messages = if GeneralChatDao::session_exists(conn, session_id)
        .map_err(|e| format!("检查 general_chat 会话失败: {e}"))?
    {
        GeneralChatDao::get_messages(conn, session_id, None, None)
            .map_err(|e| format!("读取 general_chat 消息失败: {e}"))?
    } else {
        Vec::new()
    };

    let unified_messages = match ChatDao::get_session(conn, session_id)
        .map_err(|e| format!("读取 unified 会话失败: {e}"))?
    {
        Some(session) if session.mode == ChatMode::General => {
            ChatDao::get_messages(conn, session_id, None)
                .map_err(|e| format!("读取 unified 消息失败: {e}"))?
                .into_iter()
                .filter_map(convert_unified_message_to_general)
                .collect()
        }
        _ => Vec::new(),
    };

    Ok(merge_general_message_sources(
        legacy_messages,
        unified_messages,
    ))
}

fn ensure_general_session_shadow(
    conn: &rusqlite::Connection,
    session: &ChatSession,
) -> Result<(), String> {
    if ChatDao::session_exists(conn, &session.id)
        .map_err(|e| format!("检查 unified 会话失败: {e}"))?
    {
        ChatDao::update_title(conn, &session.id, &session.name)
            .map_err(|e| format!("更新 unified 会话标题失败: {e}"))?;
        return Ok(());
    }

    let unified_session = UnifiedChatSession {
        id: session.id.clone(),
        mode: ChatMode::General,
        title: Some(session.name.clone()),
        system_prompt: None,
        model: None,
        provider_type: None,
        credential_uuid: None,
        metadata: session.metadata.clone(),
        created_at: timestamp_ms_to_rfc3339(session.created_at),
        updated_at: timestamp_ms_to_rfc3339(session.updated_at),
    };

    ChatDao::create_session(conn, &unified_session)
        .map_err(|e| format!("创建 unified 会话影子失败: {e}"))
}

fn ensure_general_session_shadow_by_id(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<(), String> {
    let session = GeneralChatDao::get_session(conn, session_id)
        .map_err(|e| format!("读取 general_chat 会话失败: {e}"))?
        .ok_or_else(|| format!("general_chat 会话不存在: {session_id}"))?;

    ensure_general_session_shadow(conn, &session)
}

fn convert_general_blocks_to_unified_content(
    content: &str,
    blocks: Option<&[ContentBlock]>,
) -> serde_json::Value {
    if let Some(blocks) = blocks {
        let converted: Vec<serde_json::Value> = blocks
            .iter()
            .map(|block| match block.r#type.as_str() {
                "text" => serde_json::json!({
                    "type": "text",
                    "text": block.content,
                }),
                "image" => serde_json::json!({
                    "type": "image",
                    "url": block.content,
                    "alt": block.filename,
                }),
                "file" => serde_json::json!({
                    "type": "file",
                    "path": block.content,
                    "name": block.filename.clone().unwrap_or_default(),
                }),
                _ => serde_json::json!({
                    "type": "text",
                    "text": block.content,
                }),
            })
            .collect();

        if !converted.is_empty() {
            return serde_json::Value::Array(converted);
        }
    }

    serde_json::json!([{ "type": "text", "text": content }])
}

fn convert_general_message_to_unified(message: &ChatMessage) -> UnifiedChatMessage {
    let role = match message.role {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::System => "system",
    };

    UnifiedChatMessage {
        id: 0,
        session_id: message.session_id.clone(),
        role: role.to_string(),
        content: convert_general_blocks_to_unified_content(
            &message.content,
            message.blocks.as_deref(),
        ),
        tool_calls: None,
        tool_call_id: None,
        metadata: message.metadata.clone(),
        created_at: timestamp_ms_to_rfc3339(message.created_at),
    }
}

fn mirror_general_message_to_unified(
    conn: &rusqlite::Connection,
    message: &ChatMessage,
) -> Result<i64, String> {
    ensure_general_session_shadow_by_id(conn, &message.session_id)?;
    let unified_message = convert_general_message_to_unified(message);
    ChatDao::add_message(conn, &unified_message).map_err(|e| format!("写入 unified 消息失败: {e}"))
}

fn log_general_session_shadow_result(
    action: &'static str,
    session_id: &str,
    result: Result<(), String>,
) {
    match result {
        Ok(()) => {
            tracing::info!(
                "[GeneralChat][Compat] {} 已同步 unified 会话影子: session={}",
                action,
                session_id
            );
        }
        Err(error) => {
            tracing::warn!(
                "[GeneralChat][Compat] {} 未能同步 unified 会话影子: session={}, error={}",
                action,
                session_id,
                error
            );
        }
    }
}

fn log_general_message_mirror_result(
    action: &'static str,
    message: &ChatMessage,
    result: Result<i64, String>,
) {
    match result {
        Ok(unified_id) => tracing::info!(
            "[GeneralChat][Compat] {} 已同步 unified 消息: session={}, role={:?}, unified_message_id={}",
            action,
            message.session_id,
            message.role,
            unified_id
        ),
        Err(error) => tracing::warn!(
            "[GeneralChat][Compat] {} 未能同步 unified 消息: session={}, role={:?}, error={}",
            action,
            message.session_id,
            message.role,
            error
        ),
    }
}

// ==================== 会话管理命令 ====================

/// 兼容层：创建新会话。
///
/// # Arguments
/// * `name` - 会话名称（可选，默认为"新对话"）
/// * `metadata` - 额外元数据（可选）
#[tauri::command]
pub async fn general_chat_create_session(
    db: State<'_, DbConnection>,
    name: Option<String>,
    metadata: Option<serde_json::Value>,
) -> Result<ChatSession, String> {
    warn_general_chat_legacy(
        "general_chat_create_session",
        "chat_create_session(mode = ChatMode::General)",
    );

    let now = chrono::Utc::now().timestamp_millis();
    let session = ChatSession {
        id: Uuid::new_v4().to_string(),
        name: name.unwrap_or_else(|| "新对话".to_string()),
        created_at: now,
        updated_at: now,
        metadata,
    };

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    GeneralChatDao::create_session(&conn, &session).map_err(|e| format!("创建会话失败: {e}"))?;
    log_general_session_shadow_result(
        "创建会话",
        &session.id,
        ensure_general_session_shadow(&conn, &session),
    );

    tracing::info!(
        "[GeneralChat] 创建会话: id={}, name={}",
        session.id,
        session.name
    );
    Ok(session)
}

/// 兼容层：获取会话列表。
#[tauri::command]
pub async fn general_chat_list_sessions(
    db: State<'_, DbConnection>,
) -> Result<Vec<ChatSession>, String> {
    warn_general_chat_legacy(
        "general_chat_list_sessions",
        "chat_list_sessions(mode = Some(ChatMode::General))",
    );

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let legacy_sessions =
        GeneralChatDao::list_sessions(&conn).map_err(|e| format!("获取会话列表失败: {e}"))?;
    let unified_sessions = ChatDao::list_sessions(&conn, Some(ChatMode::General))
        .map_err(|e| format!("获取 unified 会话列表失败: {e}"))?;
    let unified_session_map: HashMap<String, UnifiedChatSession> = unified_sessions
        .into_iter()
        .map(|session| (session.id.clone(), session))
        .collect();

    let mut sessions: Vec<ChatSession> = legacy_sessions
        .into_iter()
        .map(|session| {
            overlay_general_session(Some(session.clone()), unified_session_map.get(&session.id))
                .unwrap_or(session)
        })
        .collect();
    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    Ok(sessions)
}

/// 兼容层：获取会话详情（包含消息列表）。
///
/// # Arguments
/// * `session_id` - 会话 ID
/// * `message_limit` - 消息数量限制（可选）
#[tauri::command]
pub async fn general_chat_get_session(
    db: State<'_, DbConnection>,
    session_id: String,
    message_limit: Option<i32>,
) -> Result<SessionDetail, String> {
    warn_general_chat_legacy("general_chat_get_session", "chat_get_session");

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let legacy_session = GeneralChatDao::get_session(&conn, &session_id)
        .map_err(|e| format!("获取 general_chat 会话失败: {e}"))?;
    let unified_session = ChatDao::get_session(&conn, &session_id)
        .map_err(|e| format!("获取 unified 会话失败: {e}"))?;

    let session = overlay_general_session(legacy_session, unified_session.as_ref())
        .ok_or_else(|| "会话不存在".to_string())?;
    let all_messages = load_merged_general_messages(&conn, &session_id)?;
    let message_count = all_messages.len() as i64;
    let messages = paginate_general_messages(all_messages, message_limit, None);

    Ok(SessionDetail {
        session,
        messages,
        message_count,
    })
}

/// 兼容层：删除会话。
///
/// # Arguments
/// * `session_id` - 会话 ID
#[tauri::command]
pub async fn general_chat_delete_session(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<bool, String> {
    warn_general_chat_legacy("general_chat_delete_session", "chat_delete_session");

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let deleted = GeneralChatDao::delete_session(&conn, &session_id)
        .map_err(|e| format!("删除会话失败: {e}"))?;

    if deleted {
        match ChatDao::delete_session(&conn, &session_id) {
            Ok(true) => tracing::info!(
                "[GeneralChat][Compat] 已删除 unified 会话影子: session={}",
                session_id
            ),
            Ok(false) => tracing::debug!(
                "[GeneralChat][Compat] 未找到 unified 会话影子，无需删除: session={}",
                session_id
            ),
            Err(error) => tracing::warn!(
                "[GeneralChat][Compat] 删除 unified 会话影子失败: session={}, error={}",
                session_id,
                error
            ),
        }
        tracing::info!("[GeneralChat] 删除会话: id={}", session_id);
    }

    Ok(deleted)
}

/// 兼容层：重命名会话。
///
/// # Arguments
/// * `session_id` - 会话 ID
/// * `name` - 新名称
#[tauri::command]
pub async fn general_chat_rename_session(
    db: State<'_, DbConnection>,
    session_id: String,
    name: String,
) -> Result<bool, String> {
    warn_general_chat_legacy("general_chat_rename_session", "chat_rename_session");

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let renamed = GeneralChatDao::rename_session(&conn, &session_id, &name)
        .map_err(|e| format!("重命名会话失败: {e}"))?;

    if renamed {
        log_general_session_shadow_result(
            "重命名会话",
            &session_id,
            ensure_general_session_shadow_by_id(&conn, &session_id),
        );
        tracing::info!("[GeneralChat] 重命名会话: id={}, name={}", session_id, name);
    }

    Ok(renamed)
}

// ==================== 消息管理命令 ====================

/// 兼容层：获取会话消息列表。
///
/// # Arguments
/// * `session_id` - 会话 ID
/// * `limit` - 消息数量限制（可选）
/// * `before_id` - 在此消息 ID 之前的消息（用于分页）
#[tauri::command]
pub async fn general_chat_get_messages(
    db: State<'_, DbConnection>,
    session_id: String,
    limit: Option<i32>,
    before_id: Option<String>,
) -> Result<Vec<ChatMessage>, String> {
    warn_general_chat_legacy("general_chat_get_messages", "chat_get_messages");

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let messages = paginate_general_messages(
        load_merged_general_messages(&conn, &session_id)?,
        limit,
        before_id.as_deref(),
    );

    Ok(messages)
}

/// 兼容层：添加消息到会话。
///
/// # Arguments
/// * `session_id` - 会话 ID
/// * `role` - 消息角色 (user/assistant/system)
/// * `content` - 消息内容
/// * `blocks` - 内容块列表（可选）
/// * `metadata` - 额外元数据（可选）
#[tauri::command]
pub async fn general_chat_add_message(
    _db: State<'_, DbConnection>,
    _session_id: String,
    _role: String,
    _content: String,
    _blocks: Option<Vec<ContentBlock>>,
    _metadata: Option<serde_json::Value>,
) -> Result<ChatMessage, String> {
    warn_general_chat_legacy(
        "general_chat_add_message",
        "统一对话消息流程（暂无一对一 Tauri 替代命令）",
    );

    Err(general_chat_deprecated_error(
        "general_chat_add_message",
        "统一对话消息流程",
    ))
}

// ==================== 旧流式消息兼容命令 ====================

/// 流式消息请求
#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    /// 会话 ID
    pub session_id: String,
    /// 用户消息内容
    pub content: String,
    /// 事件名称（用于前端监听）
    pub event_name: String,
    /// Provider 配置（可选）
    #[serde(default)]
    #[allow(dead_code)]
    pub provider: Option<String>,
    /// 模型名称（可选）
    #[serde(default)]
    #[allow(dead_code)]
    pub model: Option<String>,
}

/// 兼容层：发送消息并获取流式响应。
///
/// 该命令历史上维护了一套独立于现役链路之外的模拟流式实现，
/// 会造成“命令还在、行为却已失真”的治理问题。
/// 现在仅保留命令名用于兼容探测，并显式返回迁移错误。
#[tauri::command]
pub async fn general_chat_send_message(_request: SendMessageRequest) -> Result<String, String> {
    warn_general_chat_legacy(
        "general_chat_send_message",
        "chat_send_message / aster_agent_chat_stream",
    );

    Err(general_chat_deprecated_error(
        "general_chat_send_message",
        "chat_send_message / aster_agent_chat_stream",
    ))
}

/// 兼容层：停止生成。
///
/// 旧实现依赖 compat 层自建的停止标志，已与现役 Aster 会话停止链路脱节。
/// 现在仅保留命令名用于兼容探测，并显式返回迁移错误。
///
/// # Arguments
/// * `session_id` - 会话 ID
#[tauri::command]
pub async fn general_chat_stop_generation(_session_id: String) -> Result<bool, String> {
    warn_general_chat_legacy(
        "general_chat_stop_generation",
        "chat_stop_generation / aster_agent_stop",
    );

    Err(general_chat_deprecated_error(
        "general_chat_stop_generation",
        "chat_stop_generation / aster_agent_stop",
    ))
}

/// 自动生成会话标题请求
#[derive(Debug, Deserialize)]
pub struct GenerateTitleRequest {
    /// 会话 ID
    pub session_id: String,
    /// 用户第一条消息内容
    pub first_message: String,
    /// Provider 名称（可选，暂未使用，预留给未来支持多 provider）
    #[serde(default)]
    pub provider: Option<String>,
    /// 模型名称（可选，用于指定生成标题的模型）
    #[serde(default)]
    pub model: Option<String>,
}

/// 兼容层：自动生成会话标题。
///
/// 基于用户第一条消息，调用 AI 生成简短的会话标题
///
/// # Arguments
/// * `request` - 生成标题请求
#[tauri::command]
pub async fn general_chat_generate_title(
    _db: State<'_, DbConnection>,
    _request: GenerateTitleRequest,
) -> Result<String, String> {
    warn_general_chat_legacy(
        "general_chat_generate_title",
        "统一对话标题流程（暂无一对一 Tauri 替代命令）",
    );
    Err(general_chat_deprecated_error(
        "general_chat_generate_title",
        "前端本地标题规则 + general_chat_rename_session / chat_rename_session",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_general_session(
        id: &str,
        name: &str,
        created_at: i64,
        updated_at: i64,
    ) -> ChatSession {
        ChatSession {
            id: id.to_string(),
            name: name.to_string(),
            created_at,
            updated_at,
            metadata: None,
        }
    }

    fn build_unified_session(
        id: &str,
        title: Option<&str>,
        created_at: &str,
        updated_at: &str,
    ) -> UnifiedChatSession {
        UnifiedChatSession {
            id: id.to_string(),
            mode: ChatMode::General,
            title: title.map(ToString::to_string),
            system_prompt: None,
            model: None,
            provider_type: None,
            credential_uuid: None,
            metadata: None,
            created_at: created_at.to_string(),
            updated_at: updated_at.to_string(),
        }
    }

    fn build_general_message(
        id: &str,
        role: MessageRole,
        content: &str,
        created_at: i64,
    ) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            session_id: "session-1".to_string(),
            role,
            content: content.to_string(),
            blocks: None,
            status: "complete".to_string(),
            created_at,
            metadata: None,
        }
    }

    #[test]
    fn overlay_general_session_prefers_unified_title_and_latest_timestamp() {
        let legacy_session = build_general_session("session-1", "旧标题", 1000, 2000);
        let unified_session = build_unified_session(
            "session-1",
            Some("新标题"),
            "1970-01-01T00:00:01Z",
            "1970-01-01T00:00:05Z",
        );

        let merged = overlay_general_session(Some(legacy_session), Some(&unified_session))
            .expect("会话应存在");

        assert_eq!(merged.name, "新标题");
        assert_eq!(merged.created_at, 1000);
        assert_eq!(merged.updated_at, 5000);
    }

    #[test]
    fn merge_general_message_sources_deduplicates_mirrored_messages() {
        let legacy_message = build_general_message("legacy-1", MessageRole::User, "你好", 1000);
        let unified_duplicate =
            build_general_message("unified-101", MessageRole::User, "你好", 1000);
        let unified_new =
            build_general_message("unified-102", MessageRole::Assistant, "收到", 2000);

        let merged = merge_general_message_sources(
            vec![legacy_message.clone()],
            vec![unified_duplicate, unified_new.clone()],
        );

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].id, legacy_message.id);
        assert_eq!(merged[1].id, unified_new.id);
    }

    #[test]
    fn paginate_general_messages_respects_before_id_and_limit() {
        let messages = vec![
            build_general_message("msg-1", MessageRole::User, "1", 1000),
            build_general_message("msg-2", MessageRole::Assistant, "2", 2000),
            build_general_message("msg-3", MessageRole::User, "3", 3000),
            build_general_message("msg-4", MessageRole::Assistant, "4", 4000),
        ];

        let paged = paginate_general_messages(messages, Some(2), Some("msg-4"));

        assert_eq!(paged.len(), 2);
        assert_eq!(paged[0].id, "msg-2");
        assert_eq!(paged[1].id, "msg-3");
    }

    #[test]
    fn deprecated_error_mentions_command_and_replacement() {
        let error = general_chat_deprecated_error(
            "general_chat_send_message",
            "chat_send_message / aster_agent_chat_stream",
        );

        assert!(error.contains("general_chat_send_message"));
        assert!(error.contains("chat_send_message / aster_agent_chat_stream"));
        assert!(error.contains("已废弃"));
    }
}
