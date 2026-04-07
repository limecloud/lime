//! Agent 会话和消息的数据访问层
//!
//! 提供 Agent 会话和消息的持久化存储功能

use crate::agent::types::{
    AgentMessage, AgentSession, ContentPart, FunctionCall, MessageContent, ToolCall,
};
use crate::database::ConversationWindowSummary;
use chrono::{Local, TimeZone};
use rusqlite::{params, Connection};

const JSON_RECURSION_LIMIT: usize = 50;

/// 解析消息内容 JSON，支持多种格式
///
/// 支持的格式：
/// 1. Aster 格式: `[{"Text":"..."}, {"ToolRequest":...}]`
/// 2. Lime 纯文本: `"string"`
/// 3. Lime Parts: `[{"type":"text","text":"..."}]`
fn parse_message_content(content_json: &str) -> MessageContent {
    // 尝试解析为纯文本字符串
    if let Ok(text) = serde_json::from_str::<String>(content_json) {
        return MessageContent::Text(text);
    }

    // 尝试按 JSON 值解析并提取可展示内容
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(content_json) {
        let parts = parse_content_parts_from_json(&value);
        if !parts.is_empty() {
            return MessageContent::Parts(parts);
        }

        // 兼容历史 toolResponse 协议，将工具输出提取为文本用于后续 tool_response 恢复。
        if let Some(tool_output) = extract_tool_response_text(&value) {
            return MessageContent::Text(tool_output);
        }

        // 历史数据中常见工具协议 JSON（无可展示文本），避免将整段 JSON 暴露到 UI
        if value.is_array() || value.is_object() {
            return MessageContent::Text(String::new());
        }
    }

    // 尝试直接解析为 Lime MessageContent
    if let Ok(content) = serde_json::from_str::<MessageContent>(content_json) {
        return content;
    }

    // 兜底：返回原始 JSON 作为文本
    MessageContent::Text(content_json.to_string())
}

fn normalize_json_type_token(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect()
}

fn push_non_empty(target: &mut Vec<String>, value: Option<&str>) {
    let Some(raw) = value else {
        return;
    };
    let trimmed = raw.trim();
    if !trimmed.is_empty() {
        target.push(trimmed.to_string());
    }
}

fn dedupe_preserve_order(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::new();
    for item in items {
        if seen.insert(item.clone()) {
            deduped.push(item);
        }
    }
    deduped
}

fn collect_text_candidates_with_depth(
    value: &serde_json::Value,
    target: &mut Vec<String>,
    depth: usize,
) {
    if depth >= JSON_RECURSION_LIMIT {
        return;
    }

    match value {
        serde_json::Value::String(text) => push_non_empty(target, Some(text)),
        serde_json::Value::Array(items) => {
            for item in items {
                collect_text_candidates_with_depth(item, target, depth + 1);
            }
        }
        serde_json::Value::Object(obj) => {
            if let Some(content) = obj.get("content") {
                collect_text_candidates_with_depth(content, target, depth + 1);
            }

            for key in ["text", "output", "stdout", "stderr", "message"] {
                push_non_empty(target, obj.get(key).and_then(|v| v.as_str()));
            }

            if let Some(value) = obj.get("value") {
                collect_text_candidates_with_depth(value, target, depth + 1);
            }

            push_non_empty(target, obj.get("error").and_then(|v| v.as_str()));
        }
        _ => {}
    }
}

fn extract_tool_response_text(value: &serde_json::Value) -> Option<String> {
    extract_tool_response_text_with_depth(value, 0)
}

fn extract_tool_response_text_with_depth(
    value: &serde_json::Value,
    depth: usize,
) -> Option<String> {
    if depth >= JSON_RECURSION_LIMIT {
        return None;
    }

    match value {
        serde_json::Value::Array(items) => {
            let mut segments = Vec::new();
            for item in items {
                if let Some(text) = extract_tool_response_text_with_depth(item, depth + 1) {
                    push_non_empty(&mut segments, Some(&text));
                }
            }
            let deduped = dedupe_preserve_order(segments);
            if deduped.is_empty() {
                None
            } else {
                Some(deduped.join("\n"))
            }
        }
        serde_json::Value::Object(obj) => {
            let type_token = obj
                .get("type")
                .and_then(|v| v.as_str())
                .map(normalize_json_type_token);
            let is_tool_response = matches!(type_token.as_deref(), Some("toolresponse"))
                || obj.contains_key("toolResult")
                || obj.contains_key("tool_result")
                || obj.contains_key("ToolResponse")
                || obj.contains_key("toolResponse")
                || obj.contains_key("tool_response");

            if !is_tool_response {
                return None;
            }

            let mut segments = Vec::new();

            if let Some(inner) = obj
                .get("ToolResponse")
                .or_else(|| obj.get("toolResponse"))
                .or_else(|| obj.get("tool_response"))
            {
                collect_text_candidates_with_depth(inner, &mut segments, depth + 1);
            }

            if let Some(tool_result) = obj.get("toolResult").or_else(|| obj.get("tool_result")) {
                collect_text_candidates_with_depth(tool_result, &mut segments, depth + 1);
            }

            push_non_empty(&mut segments, obj.get("output").and_then(|v| v.as_str()));
            push_non_empty(&mut segments, obj.get("error").and_then(|v| v.as_str()));

            let deduped = dedupe_preserve_order(segments);
            if deduped.is_empty() {
                None
            } else {
                Some(deduped.join("\n"))
            }
        }
        _ => None,
    }
}

fn parse_content_parts_from_json(value: &serde_json::Value) -> Vec<ContentPart> {
    parse_content_parts_from_json_with_depth(value, 0)
}

fn parse_content_parts_from_json_with_depth(
    value: &serde_json::Value,
    depth: usize,
) -> Vec<ContentPart> {
    if depth >= JSON_RECURSION_LIMIT {
        return Vec::new();
    }

    match value {
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(parse_content_part_item)
            .collect::<Vec<_>>(),
        serde_json::Value::Object(_) => parse_content_part_item(value).into_iter().collect(),
        _ => Vec::new(),
    }
}

fn parse_content_part_item(value: &serde_json::Value) -> Option<ContentPart> {
    let obj = value.as_object()?;

    // Aster 格式: {"Text":"..."} 或 {"Text":{"text":"..."}}
    if let Some(text) = obj.get("Text").and_then(|v| v.as_str()) {
        return Some(ContentPart::Text {
            text: text.to_string(),
        });
    }
    if let Some(text_obj) = obj.get("Text").and_then(|v| v.as_object()) {
        if let Some(text) = text_obj
            .get("text")
            .and_then(|v| v.as_str())
            .or_else(|| text_obj.get("content").and_then(|v| v.as_str()))
        {
            return Some(ContentPart::Text {
                text: text.to_string(),
            });
        }
    }

    // 常见文本格式:
    // - {"text":"..."}
    // - {"type":"text","text":"..."}
    // - {"type":"text","content":"..."}
    // - {"type":"input_text","text":"..."}
    // - {"type":"output_text","text":"..."}
    if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
        return Some(ContentPart::Text {
            text: text.to_string(),
        });
    }

    let part_type = obj.get("type").and_then(|v| v.as_str());

    if matches!(part_type, Some("text" | "input_text" | "output_text")) {
        if let Some(text) = obj.get("content").and_then(|v| v.as_str()) {
            return Some(ContentPart::Text {
                text: text.to_string(),
            });
        }
    }

    // 图片格式:
    // - {"type":"image_url","image_url":{"url":"..."}}
    // - {"type":"input_image","image_url":"..."}
    // - {"type":"image","mime_type":"image/png","data":"base64..."}
    // - {"type":"image","source":{"media_type":"image/png","data":"base64..."}}
    if matches!(part_type, Some("image_url" | "input_image")) {
        let image_url_value = obj.get("image_url").or_else(|| obj.get("url"))?;
        let (url, detail) = if let Some(url) = image_url_value.as_str() {
            (url.to_string(), None)
        } else {
            let image_url_obj = image_url_value.as_object()?;
            let url = image_url_obj.get("url")?.as_str()?.to_string();
            let detail = image_url_obj
                .get("detail")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            (url, detail)
        };
        return Some(ContentPart::ImageUrl {
            image_url: crate::agent::types::ImageUrl { url, detail },
        });
    }

    if part_type == Some("image") {
        if let Some(url) = obj
            .get("url")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("image_url").and_then(|v| v.as_str()))
        {
            return Some(ContentPart::ImageUrl {
                image_url: crate::agent::types::ImageUrl {
                    url: url.to_string(),
                    detail: None,
                },
            });
        }

        let source_obj = obj.get("source").and_then(|v| v.as_object());
        let mime_type = obj
            .get("mime_type")
            .or_else(|| obj.get("media_type"))
            .and_then(|v| v.as_str())
            .or_else(|| {
                source_obj
                    .and_then(|source| source.get("mime_type").or_else(|| source.get("media_type")))
                    .and_then(|v| v.as_str())
            });
        let data = obj
            .get("data")
            .or_else(|| obj.get("image_base64"))
            .and_then(|v| v.as_str())
            .or_else(|| {
                source_obj
                    .and_then(|source| source.get("data"))
                    .and_then(|v| v.as_str())
            });

        if let (Some(mime), Some(data)) = (mime_type, data) {
            let url = format!("data:{mime};base64,{data}");
            return Some(ContentPart::ImageUrl {
                image_url: crate::agent::types::ImageUrl { url, detail: None },
            });
        }
    }

    // 兼容 {"image_url":{"url":"..."}}（无 type）
    if let Some(image_url_obj) = obj.get("image_url").and_then(|v| v.as_object()) {
        if let Some(url) = image_url_obj.get("url").and_then(|v| v.as_str()) {
            let detail = image_url_obj
                .get("detail")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            return Some(ContentPart::ImageUrl {
                image_url: crate::agent::types::ImageUrl {
                    url: url.to_string(),
                    detail,
                },
            });
        }
    }

    // 兼容 {"image_url":"..."}（无 type）
    if let Some(url) = obj.get("image_url").and_then(|v| v.as_str()) {
        return Some(ContentPart::ImageUrl {
            image_url: crate::agent::types::ImageUrl {
                url: url.to_string(),
                detail: None,
            },
        });
    }

    None
}

/// 解析工具调用 JSON，兼容历史数据缺少 `type` 字段的情况
fn parse_tool_calls(tool_calls_json: Option<&str>) -> Option<Vec<ToolCall>> {
    let json = tool_calls_json?;
    if json.trim().is_empty() {
        return None;
    }

    // 新格式：直接反序列化
    if let Ok(tool_calls) = serde_json::from_str::<Vec<ToolCall>>(json) {
        return Some(tool_calls);
    }

    // 兼容旧格式：手动解析并补默认值
    let raw_items = match serde_json::from_str::<Vec<serde_json::Value>>(json) {
        Ok(items) => items,
        Err(e) => {
            tracing::warn!("[AgentDao] 解析 tool_calls_json 失败，已降级忽略: {}", e);
            return None;
        }
    };

    let mut parsed = Vec::new();

    for (idx, item) in raw_items.iter().enumerate() {
        let Some(obj) = item.as_object() else {
            continue;
        };

        let id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("legacy_tool_call_{idx}"));

        // 历史数据可能没有 `type`，默认按 function 处理
        let call_type = obj
            .get("type")
            .or_else(|| obj.get("call_type"))
            .and_then(|v| v.as_str())
            .unwrap_or("function")
            .to_string();

        let tool_call_value = obj
            .get("toolCall")
            .and_then(|v| v.get("value"))
            .or_else(|| obj.get("tool_call").and_then(|v| v.get("value")));

        let function_name = obj
            .get("function")
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .or_else(|| {
                tool_call_value
                    .and_then(|v| v.get("name"))
                    .and_then(|v| v.as_str())
            })
            .or_else(|| obj.get("tool_name").and_then(|v| v.as_str()))
            .or_else(|| obj.get("name").and_then(|v| v.as_str()));

        let Some(function_name) = function_name else {
            continue;
        };

        let function_arguments = obj
            .get("function")
            .and_then(|v| v.get("arguments"))
            .or_else(|| tool_call_value.and_then(|v| v.get("arguments")))
            .or_else(|| obj.get("arguments"))
            .map(|v| {
                if let Some(s) = v.as_str() {
                    s.to_string()
                } else {
                    v.to_string()
                }
            })
            .unwrap_or_else(|| "{}".to_string());

        parsed.push(ToolCall {
            id,
            call_type,
            function: FunctionCall {
                name: function_name.to_string(),
                arguments: function_arguments,
            },
        });
    }

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

pub struct AgentDao;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentModelPatternMatch {
    Like,
    NotLike,
}

impl AgentModelPatternMatch {
    fn sql_operator(self) -> &'static str {
        match self {
            Self::Like => "LIKE",
            Self::NotLike => "NOT LIKE",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentModelUsageRow {
    pub model: String,
    pub conversations: u64,
    pub content_chars: u64,
}

#[derive(Debug, Clone)]
pub struct AgentSessionOverviewRow {
    pub session: AgentSession,
    pub messages_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentMessageTextRow {
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub timestamp_ms: i64,
}

fn parse_message_timestamp_to_millis(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
        .or_else(|| parse_datetime_or_timestamp_to_millis(value))
}

fn parse_datetime_or_timestamp_to_millis(value: &str) -> Option<i64> {
    if let Ok(v) = value.parse::<i64>() {
        if v > 1_000_000_000_000 {
            return Some(v);
        }
        return Some(v * 1000);
    }

    chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .ok()
        .and_then(|naive| {
            Local
                .from_local_datetime(&naive)
                .single()
                .map(|dt| dt.timestamp_millis())
        })
}

fn map_agent_session_row(row: &rusqlite::Row) -> Result<AgentSession, rusqlite::Error> {
    Ok(AgentSession {
        id: row.get(0)?,
        model: row.get(1)?,
        messages: Vec::new(),
        system_prompt: row.get(2)?,
        title: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        working_dir: row.get(6)?,
        execution_strategy: row.get(7)?,
    })
}

impl AgentDao {
    /// 创建新会话
    pub fn create_session(
        conn: &Connection,
        session: &AgentSession,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at, working_dir, execution_strategy)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session.id,
                session.model,
                session.system_prompt,
                session.title,
                session.created_at,
                session.updated_at,
                session.working_dir,
                session.execution_strategy,
            ],
        )?;
        Ok(())
    }

    /// 获取会话（不包含消息）
    pub fn get_session(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Option<AgentSession>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, model, system_prompt, title, created_at, updated_at, working_dir, execution_strategy
             FROM agent_sessions WHERE id = ?",
        )?;

        let mut rows = stmt.query([session_id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(map_agent_session_row(row)?))
        } else {
            Ok(None)
        }
    }

    /// 获取会话（包含消息）
    pub fn get_session_with_messages(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Option<AgentSession>, rusqlite::Error> {
        let mut session = match Self::get_session(conn, session_id)? {
            Some(s) => s,
            None => return Ok(None),
        };

        session.messages = Self::get_messages(conn, session_id)?;
        Ok(Some(session))
    }

    /// 获取所有会话（不包含消息）
    pub fn list_sessions(conn: &Connection) -> Result<Vec<AgentSession>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, model, system_prompt, title, created_at, updated_at, working_dir, execution_strategy
             FROM agent_sessions ORDER BY updated_at DESC",
        )?;

        let sessions = stmt.query_map([], map_agent_session_row)?;

        sessions.collect()
    }

    pub fn list_session_overviews(
        conn: &Connection,
    ) -> Result<Vec<AgentSessionOverviewRow>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT s.id, s.model, s.system_prompt, s.title, s.created_at, s.updated_at,
                    s.working_dir, s.execution_strategy, COUNT(m.id) AS messages_count
             FROM agent_sessions s
             LEFT JOIN agent_messages m ON m.session_id = s.id
             GROUP BY s.id, s.model, s.system_prompt, s.title, s.created_at, s.updated_at,
                      s.working_dir, s.execution_strategy
             ORDER BY s.updated_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let messages_count: i64 = row.get(8)?;
            Ok(AgentSessionOverviewRow {
                session: map_agent_session_row(row)?,
                messages_count: messages_count.max(0) as usize,
            })
        })?;

        rows.collect()
    }

    pub fn get_session_overview(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Option<AgentSessionOverviewRow>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT s.id, s.model, s.system_prompt, s.title, s.created_at, s.updated_at,
                    s.working_dir, s.execution_strategy, COUNT(m.id) AS messages_count
             FROM agent_sessions s
             LEFT JOIN agent_messages m ON m.session_id = s.id
             WHERE s.id = ?1
             GROUP BY s.id, s.model, s.system_prompt, s.title, s.created_at, s.updated_at,
                      s.working_dir, s.execution_strategy",
        )?;
        let mut rows = stmt.query([session_id])?;

        if let Some(row) = rows.next()? {
            let messages_count: i64 = row.get(8)?;
            Ok(Some(AgentSessionOverviewRow {
                session: map_agent_session_row(row)?,
                messages_count: messages_count.max(0) as usize,
            }))
        } else {
            Ok(None)
        }
    }

    /// 获取会话的消息数量
    pub fn get_message_count(
        conn: &Connection,
        session_id: &str,
    ) -> Result<usize, rusqlite::Error> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM agent_messages WHERE session_id = ?",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    pub fn count_sessions_by_model_pattern(
        conn: &Connection,
        model_pattern: &str,
        match_mode: AgentModelPatternMatch,
        from_datetime: Option<&str>,
        to_datetime: Option<&str>,
    ) -> Result<i64, rusqlite::Error> {
        let sql = format!(
            "SELECT COUNT(*)
             FROM agent_sessions s
             WHERE s.model {} ?1
               AND (?2 IS NULL OR datetime(s.created_at) >= datetime(?2))
               AND (?3 IS NULL OR datetime(s.created_at) < datetime(?3))",
            match_mode.sql_operator()
        );

        conn.query_row(
            &sql,
            params![model_pattern, from_datetime, to_datetime],
            |row| row.get(0),
        )
    }

    pub fn summarize_by_model_pattern(
        conn: &Connection,
        model_pattern: &str,
        match_mode: AgentModelPatternMatch,
        from_datetime: Option<&str>,
        to_datetime: Option<&str>,
    ) -> Result<ConversationWindowSummary, rusqlite::Error> {
        let sql = format!(
            "SELECT
                (
                    SELECT COUNT(*)
                    FROM agent_sessions s
                    WHERE s.model {0} ?1
                      AND (?2 IS NULL OR datetime(s.created_at) >= datetime(?2))
                      AND (?3 IS NULL OR datetime(s.created_at) < datetime(?3))
                ) AS session_count,
                (
                    SELECT COUNT(*)
                    FROM agent_messages m
                    JOIN agent_sessions s ON s.id = m.session_id
                    WHERE s.model {0} ?1
                      AND (?2 IS NULL OR datetime(m.timestamp) >= datetime(?2))
                      AND (?3 IS NULL OR datetime(m.timestamp) < datetime(?3))
                ) AS message_count,
                (
                    SELECT COALESCE(SUM(LENGTH(m.content_json)), 0)
                    FROM agent_messages m
                    JOIN agent_sessions s ON s.id = m.session_id
                    WHERE s.model {0} ?1
                      AND (?2 IS NULL OR datetime(m.timestamp) >= datetime(?2))
                      AND (?3 IS NULL OR datetime(m.timestamp) < datetime(?3))
                ) AS content_chars",
            match_mode.sql_operator()
        );

        conn.query_row(
            &sql,
            params![model_pattern, from_datetime, to_datetime],
            |row| {
                Ok(ConversationWindowSummary {
                    session_count: row.get(0)?,
                    message_count: row.get(1)?,
                    content_chars: row.get(2)?,
                })
            },
        )
    }

    pub fn count_messages_by_model_pattern(
        conn: &Connection,
        model_pattern: &str,
        match_mode: AgentModelPatternMatch,
        from_datetime: Option<&str>,
        to_datetime: Option<&str>,
    ) -> Result<i64, rusqlite::Error> {
        let sql = format!(
            "SELECT COUNT(*)
             FROM agent_messages m
             JOIN agent_sessions s ON s.id = m.session_id
             WHERE s.model {} ?1
               AND (?2 IS NULL OR datetime(m.timestamp) >= datetime(?2))
               AND (?3 IS NULL OR datetime(m.timestamp) < datetime(?3))",
            match_mode.sql_operator()
        );

        conn.query_row(
            &sql,
            params![model_pattern, from_datetime, to_datetime],
            |row| row.get(0),
        )
    }

    pub fn sum_message_chars_by_model_pattern(
        conn: &Connection,
        model_pattern: &str,
        match_mode: AgentModelPatternMatch,
        from_datetime: Option<&str>,
        to_datetime: Option<&str>,
    ) -> Result<i64, rusqlite::Error> {
        let sql = format!(
            "SELECT COALESCE(SUM(LENGTH(m.content_json)), 0)
             FROM agent_messages m
             JOIN agent_sessions s ON s.id = m.session_id
             WHERE s.model {} ?1
               AND (?2 IS NULL OR datetime(m.timestamp) >= datetime(?2))
               AND (?3 IS NULL OR datetime(m.timestamp) < datetime(?3))",
            match_mode.sql_operator()
        );

        conn.query_row(
            &sql,
            params![model_pattern, from_datetime, to_datetime],
            |row| row.get(0),
        )
    }

    pub fn list_model_usage_by_model_pattern(
        conn: &Connection,
        model_pattern: &str,
        match_mode: AgentModelPatternMatch,
        start_datetime: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AgentModelUsageRow>, rusqlite::Error> {
        let rows = if let Some(start_datetime) = start_datetime {
            let sql = format!(
                "SELECT s.model,
                        COUNT(DISTINCT m.session_id) AS conversations,
                        COALESCE(SUM(LENGTH(m.content_json)), 0) AS content_chars
                 FROM agent_messages m
                 JOIN agent_sessions s ON s.id = m.session_id
                 WHERE s.model {} ?1
                   AND datetime(m.timestamp) >= datetime(?2)
                 GROUP BY s.model
                 ORDER BY content_chars DESC, conversations DESC
                 LIMIT ?3",
                match_mode.sql_operator()
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(
                params![model_pattern, start_datetime, limit as i64],
                |row| {
                    let content_chars: i64 = row.get(2)?;
                    let conversations: i64 = row.get(1)?;
                    Ok(AgentModelUsageRow {
                        model: row.get(0)?,
                        conversations: conversations.max(0) as u64,
                        content_chars: content_chars.max(0) as u64,
                    })
                },
            )?;
            rows.collect::<Result<Vec<_>, _>>()?
        } else {
            let sql = format!(
                "SELECT s.model,
                        COUNT(DISTINCT m.session_id) AS conversations,
                        COALESCE(SUM(LENGTH(m.content_json)), 0) AS content_chars
                 FROM agent_messages m
                 JOIN agent_sessions s ON s.id = m.session_id
                 WHERE s.model {} ?1
                 GROUP BY s.model
                 ORDER BY content_chars DESC, conversations DESC
                 LIMIT ?2",
                match_mode.sql_operator()
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![model_pattern, limit as i64], |row| {
                let content_chars: i64 = row.get(2)?;
                let conversations: i64 = row.get(1)?;
                Ok(AgentModelUsageRow {
                    model: row.get(0)?,
                    conversations: conversations.max(0) as u64,
                    content_chars: content_chars.max(0) as u64,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        Ok(rows)
    }

    pub fn list_message_text_rows_by_model_pattern(
        conn: &Connection,
        model_pattern: &str,
        match_mode: AgentModelPatternMatch,
        from_datetime: Option<&str>,
        to_datetime: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AgentMessageTextRow>, rusqlite::Error> {
        let sql = format!(
            "SELECT m.session_id, m.role, m.content_json, m.timestamp
             FROM agent_messages m
             JOIN agent_sessions s ON s.id = m.session_id
             WHERE s.model {} ?1
               AND (?2 IS NULL OR datetime(m.timestamp) >= datetime(?2))
               AND (?3 IS NULL OR datetime(m.timestamp) <= datetime(?3))
             ORDER BY datetime(m.timestamp) DESC
             LIMIT ?4",
            match_mode.sql_operator()
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            params![model_pattern, from_datetime, to_datetime, limit as i64],
            |row| {
                let content_json: String = row.get(2)?;
                let timestamp: String = row.get(3)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    parse_message_content(&content_json).as_text(),
                    parse_message_timestamp_to_millis(&timestamp),
                ))
            },
        )?;

        let mut result = Vec::new();
        for row in rows {
            let (session_id, role, content, timestamp_ms) = row?;
            let Some(timestamp_ms) = timestamp_ms else {
                continue;
            };
            result.push(AgentMessageTextRow {
                session_id,
                role,
                content,
                timestamp_ms,
            });
        }

        Ok(result)
    }

    /// 更新会话的 updated_at 时间
    pub fn update_session_time(
        conn: &Connection,
        session_id: &str,
        updated_at: &str,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "UPDATE agent_sessions SET updated_at = ? WHERE id = ?",
            params![updated_at, session_id],
        )?;
        Ok(())
    }

    /// 删除会话（消息会级联删除）
    pub fn delete_session(conn: &Connection, session_id: &str) -> Result<bool, rusqlite::Error> {
        let rows = conn.execute("DELETE FROM agent_sessions WHERE id = ?", [session_id])?;
        Ok(rows > 0)
    }

    /// 添加消息到会话
    pub fn add_message(
        conn: &Connection,
        session_id: &str,
        message: &AgentMessage,
    ) -> Result<(), rusqlite::Error> {
        let content_json = serde_json::to_string(&message.content)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let tool_calls_json = message
            .tool_calls
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "INSERT INTO agent_messages (
                session_id,
                role,
                content_json,
                timestamp,
                tool_calls_json,
                tool_call_id,
                reasoning_content,
                input_tokens,
                output_tokens
            )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                session_id,
                message.role,
                content_json,
                message.timestamp,
                tool_calls_json,
                message.tool_call_id,
                message.reasoning_content.as_deref(),
                message.usage.as_ref().map(|usage| usage.input_tokens),
                message.usage.as_ref().map(|usage| usage.output_tokens),
            ],
        )?;

        // 更新会话的 updated_at
        conn.execute(
            "UPDATE agent_sessions SET updated_at = ? WHERE id = ?",
            params![message.timestamp, session_id],
        )?;

        Ok(())
    }

    /// 获取会话的所有消息
    pub fn get_messages(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Vec<AgentMessage>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT role, content_json, timestamp, tool_calls_json, tool_call_id, reasoning_content,
                    input_tokens, output_tokens
             FROM agent_messages WHERE session_id = ? ORDER BY id ASC",
        )?;

        let messages = stmt.query_map([session_id], |row| {
            let role: String = row.get(0)?;
            let content_json: String = row.get(1)?;
            let timestamp: String = row.get(2)?;
            let tool_calls_json: Option<String> = row.get(3)?;
            let tool_call_id: Option<String> = row.get(4)?;
            let reasoning_content: Option<String> = row.get(5)?;
            let input_tokens: Option<u32> = row.get(6)?;
            let output_tokens: Option<u32> = row.get(7)?;

            // 解析 JSON - 支持多种格式
            // 1. Aster 格式: [{"Text":"..."}, {"Text":"..."}]
            // 2. Lime 格式: "string" 或 [{"type":"text","text":"..."}]
            let content = parse_message_content(&content_json);

            // 兼容历史数据：tool_calls 中缺失 type 字段时自动降级解析
            let tool_calls: Option<Vec<ToolCall>> = parse_tool_calls(tool_calls_json.as_deref());

            Ok(AgentMessage {
                role,
                content,
                timestamp,
                tool_calls,
                tool_call_id,
                reasoning_content,
                usage: match (input_tokens, output_tokens) {
                    (Some(input_tokens), Some(output_tokens)) => {
                        Some(crate::agent::types::TokenUsage {
                            input_tokens,
                            output_tokens,
                        })
                    }
                    _ => None,
                },
            })
        })?;

        messages.collect()
    }

    pub fn update_latest_assistant_message_usage(
        conn: &Connection,
        session_id: &str,
        input_tokens: u32,
        output_tokens: u32,
    ) -> Result<bool, rusqlite::Error> {
        let rows = conn.execute(
            "UPDATE agent_messages
             SET input_tokens = ?1, output_tokens = ?2
             WHERE id = (
                 SELECT id FROM agent_messages
                 WHERE session_id = ?3 AND role = 'assistant'
                 ORDER BY id DESC
                 LIMIT 1
             )",
            params![input_tokens, output_tokens, session_id],
        )?;

        Ok(rows > 0)
    }

    /// 删除会话的所有消息
    pub fn delete_messages(conn: &Connection, session_id: &str) -> Result<(), rusqlite::Error> {
        conn.execute(
            "DELETE FROM agent_messages WHERE session_id = ?",
            [session_id],
        )?;
        Ok(())
    }

    /// 检查会话是否存在
    pub fn session_exists(conn: &Connection, session_id: &str) -> Result<bool, rusqlite::Error> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM agent_sessions WHERE id = ?",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// 更新会话标题
    pub fn update_title(
        conn: &Connection,
        session_id: &str,
        title: &str,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "UPDATE agent_sessions SET title = ? WHERE id = ?",
            params![title, session_id],
        )?;
        Ok(())
    }

    pub fn rename_session(
        conn: &Connection,
        session_id: &str,
        title: &str,
        updated_at: &str,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "UPDATE agent_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, updated_at, session_id],
        )?;
        Ok(())
    }

    /// 更新会话工作目录
    pub fn update_working_dir(
        conn: &Connection,
        session_id: &str,
        working_dir: &str,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "UPDATE agent_sessions SET working_dir = ? WHERE id = ?",
            params![working_dir, session_id],
        )?;
        Ok(())
    }

    /// 获取会话标题
    pub fn get_title(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Option<String>, rusqlite::Error> {
        let mut stmt = conn.prepare("SELECT title FROM agent_sessions WHERE id = ?")?;
        let mut rows = stmt.query([session_id])?;

        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    /// 更新会话执行策略
    pub fn update_execution_strategy(
        conn: &Connection,
        session_id: &str,
        execution_strategy: &str,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "UPDATE agent_sessions SET execution_strategy = ? WHERE id = ?",
            params![execution_strategy, session_id],
        )?;
        Ok(())
    }

    /// 更新会话 provider / model 持久化配置
    pub fn update_provider_config(
        conn: &Connection,
        session_id: &str,
        provider_name: Option<&str>,
        model_name: Option<&str>,
        model_config_json: Option<&str>,
        updated_at: &str,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "UPDATE agent_sessions SET
                provider_name = COALESCE(?1, provider_name),
                model = COALESCE(?2, model),
                model_config_json = CASE WHEN ?3 IS NULL THEN model_config_json ELSE ?3 END,
                updated_at = ?4
             WHERE id = ?5",
            params![
                provider_name,
                model_name,
                model_config_json,
                updated_at,
                session_id,
            ],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::agent::types::MessageContent;
    use rusqlite::{params, Connection};

    use super::{
        parse_message_content, parse_tool_calls, AgentDao, AgentModelPatternMatch,
        JSON_RECURSION_LIMIT,
    };

    fn setup_pattern_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("打开内存数据库");
        conn.execute_batch(
            "
            CREATE TABLE agent_sessions (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                system_prompt TEXT,
                title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                working_dir TEXT,
                execution_strategy TEXT
            );
            CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content_json TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                tool_calls_json TEXT,
                tool_call_id TEXT,
                reasoning_content TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER
            );
            ",
        )
        .expect("创建测试 schema");
        conn
    }

    #[test]
    fn parse_tool_calls_should_compat_with_legacy_missing_type() {
        let legacy =
            r#"[{"id":"call_1","function":{"name":"search","arguments":"{\"q\":\"rust\"}"}}]"#;
        let result = parse_tool_calls(Some(legacy)).expect("应能解析旧格式 tool_calls");

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "call_1");
        assert_eq!(result[0].call_type, "function");
        assert_eq!(result[0].function.name, "search");
    }

    #[test]
    fn parse_tool_calls_should_return_none_on_invalid_json() {
        let result = parse_tool_calls(Some("not-json"));
        assert!(result.is_none());
    }

    #[test]
    fn parse_tool_calls_should_parse_aster_tool_request_shape() {
        let legacy = r#"[{"id":"call_324","toolCall":{"status":"success","value":{"name":"Skill","arguments":{"skill":"user:canvas-design"}}}}]"#;
        let result = parse_tool_calls(Some(legacy)).expect("应能解析 aster toolRequest 结构");

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "call_324");
        assert_eq!(result[0].function.name, "Skill");

        let args_value: serde_json::Value =
            serde_json::from_str(&result[0].function.arguments).expect("arguments 应为 JSON");
        assert_eq!(args_value["skill"], serde_json::json!("user:canvas-design"));
    }

    #[test]
    fn parse_message_content_should_not_expose_tool_payload_json() {
        let tool_only =
            r#"[{"type":"toolRequest","id":"call_1","toolName":"query","arguments":{"q":"rust"}}]"#;
        let parsed = parse_message_content(tool_only);
        assert_eq!(parsed.as_text(), "");
    }

    #[test]
    fn parse_message_content_should_extract_text_parts() {
        let mixed = r#"[{"type":"text","text":"hello"},{"Text":"world"}]"#;
        let parsed = parse_message_content(mixed);
        assert_eq!(parsed.as_text(), "hello\nworld");
    }

    #[test]
    fn parse_message_content_should_extract_input_image_parts() {
        let mixed = r#"[{"type":"input_text","text":"参考图"},{"type":"input_image","image_url":"data:image/png;base64,aGVsbG8="}]"#;
        let parsed = parse_message_content(mixed);

        match parsed {
            MessageContent::Parts(parts) => {
                assert_eq!(parts.len(), 2);
                assert!(parts.iter().any(|part| matches!(
                    part,
                    crate::agent::types::ContentPart::ImageUrl { image_url }
                        if image_url.url == "data:image/png;base64,aGVsbG8="
                )));
            }
            _ => panic!("应解析为 Parts"),
        }
    }

    #[test]
    fn parse_message_content_should_extract_tool_response_output() {
        let tool_response = r#"[{"type":"toolResponse","id":"call_1","toolResult":{"status":"success","value":{"content":[{"type":"text","text":"任务已完成"}],"isError":false}}}]"#;
        let parsed = parse_message_content(tool_response);
        assert_eq!(parsed.as_text(), "任务已完成");
    }

    #[test]
    fn parse_message_content_should_extract_tool_response_error() {
        let tool_response = r#"[{"type":"toolResponse","id":"call_2","toolResult":{"status":"error","error":"-32603: Tool not found"}}]"#;
        let parsed = parse_message_content(tool_response);
        assert_eq!(parsed.as_text(), "-32603: Tool not found");
    }

    #[test]
    fn parse_message_content_should_stop_on_excessive_depth() {
        let mut nested = serde_json::json!({ "text": "不会到达" });
        for _ in 0..(JSON_RECURSION_LIMIT + 10) {
            nested = serde_json::json!({ "value": nested });
        }

        let payload = serde_json::json!([
            {
                "type": "toolResponse",
                "toolResult": nested
            }
        ]);

        let parsed = parse_message_content(&payload.to_string());
        assert_eq!(parsed.as_text(), "");
    }

    #[test]
    fn model_pattern_queries_should_filter_general_and_agent_records() {
        let conn = setup_pattern_test_db();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params!["general-1", "general:default", "通用 1", "2026-03-12T10:00:00+08:00", "2026-03-12T10:00:00+08:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params!["general-2", "general:helper", "通用 2", "2026-03-14T09:00:00+08:00", "2026-03-14T09:00:00+08:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params!["agent-1", "claude-sonnet-4", "Agent 1", "2026-03-12T11:00:00+08:00", "2026-03-12T11:00:00+08:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params!["agent-2", "gpt-4.1", "Agent 2", "2026-03-15T09:00:00+08:00", "2026-03-15T09:00:00+08:00"],
        )
        .unwrap();

        let general_json_1 = r#"[{"type":"text","text":"第一条 general 消息"}]"#;
        let general_json_2 = r#"[{"type":"text","text":"第二条 general 消息"}]"#;
        let agent_json_1 = r#"[{"type":"text","text":"第一条 agent 消息"}]"#;
        let agent_json_2 = r#"[{"type":"text","text":"第二条 agent 消息，比第一条更长一些"}]"#;
        let agent_json_1_chars = agent_json_1.chars().count() as i64;
        let agent_json_2_chars = agent_json_2.chars().count() as i64;

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["general-1", "user", general_json_1, "2026-03-12T10:01:00+08:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["general-2", "assistant", general_json_2, "2026-03-14T09:01:00+08:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["agent-1", "assistant", agent_json_1, "2026-03-12T11:01:00+08:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["agent-2", "assistant", agent_json_2, "2026-03-15T09:01:00+08:00"],
        )
        .unwrap();

        let general_sessions = AgentDao::count_sessions_by_model_pattern(
            &conn,
            "general:%",
            AgentModelPatternMatch::Like,
            None,
            None,
        )
        .unwrap();
        assert_eq!(general_sessions, 2);

        let general_summary = AgentDao::summarize_by_model_pattern(
            &conn,
            "general:%",
            AgentModelPatternMatch::Like,
            None,
            Some("2026-03-15 00:00:00"),
        )
        .unwrap();
        assert_eq!(general_summary.session_count, 2);
        assert_eq!(general_summary.message_count, 2);
        assert_eq!(
            general_summary.content_chars,
            (general_json_1.chars().count() + general_json_2.chars().count()) as i64
        );

        let recent_agent_sessions = AgentDao::count_sessions_by_model_pattern(
            &conn,
            "general:%",
            AgentModelPatternMatch::NotLike,
            Some("2026-03-13 00:00:00"),
            None,
        )
        .unwrap();
        assert_eq!(recent_agent_sessions, 1);

        let general_messages = AgentDao::count_messages_by_model_pattern(
            &conn,
            "general:%",
            AgentModelPatternMatch::Like,
            None,
            Some("2026-03-15 00:00:00"),
        )
        .unwrap();
        assert_eq!(general_messages, 2);

        let agent_chars = AgentDao::sum_message_chars_by_model_pattern(
            &conn,
            "general:%",
            AgentModelPatternMatch::NotLike,
            None,
            None,
        )
        .unwrap();
        assert_eq!(agent_chars, agent_json_1_chars + agent_json_2_chars);

        let agent_usage = AgentDao::list_model_usage_by_model_pattern(
            &conn,
            "general:%",
            AgentModelPatternMatch::NotLike,
            None,
            10,
        )
        .unwrap();
        assert_eq!(agent_usage.len(), 2);
        assert_eq!(agent_usage[0].model, "gpt-4.1");
        assert_eq!(agent_usage[0].conversations, 1);
        assert_eq!(agent_usage[0].content_chars, agent_json_2_chars as u64);
        assert_eq!(agent_usage[1].model, "claude-sonnet-4");
        assert_eq!(agent_usage[1].conversations, 1);
        assert_eq!(agent_usage[1].content_chars, agent_json_1_chars as u64);

        let general_rows = AgentDao::list_message_text_rows_by_model_pattern(
            &conn,
            "general:%",
            AgentModelPatternMatch::Like,
            Some("2026-03-13 00:00:00"),
            None,
            10,
        )
        .unwrap();
        assert_eq!(general_rows.len(), 1);
        assert_eq!(general_rows[0].session_id, "general-2");
        assert_eq!(general_rows[0].role, "assistant");
        assert_eq!(general_rows[0].content, "第二条 general 消息");
        assert!(general_rows[0].timestamp_ms > 0);
    }

    #[test]
    fn session_overview_queries_and_rename_should_work() {
        let conn = setup_pattern_test_db();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at, working_dir, execution_strategy)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "session-a",
                "claude-sonnet-4",
                "system-a",
                "标题 A",
                "2026-03-10T10:00:00+08:00",
                "2026-03-10T10:00:00+08:00",
                "/tmp/a",
                "react"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at, working_dir, execution_strategy)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "session-b",
                "gpt-4.1",
                "system-b",
                "标题 B",
                "2026-03-11T10:00:00+08:00",
                "2026-03-11T10:00:00+08:00",
                "/tmp/b",
                "auto"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["session-a", "user", r#"[{"type":"text","text":"消息一"}]"#, "2026-03-10T10:01:00+08:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["session-a", "assistant", r#"[{"type":"text","text":"消息二"}]"#, "2026-03-10T10:02:00+08:00"],
        )
        .unwrap();

        let overviews = AgentDao::list_session_overviews(&conn).unwrap();
        assert_eq!(overviews.len(), 2);
        assert_eq!(overviews[0].session.id, "session-b");
        assert_eq!(overviews[0].messages_count, 0);
        assert_eq!(overviews[1].session.id, "session-a");
        assert_eq!(overviews[1].messages_count, 2);

        let overview = AgentDao::get_session_overview(&conn, "session-a")
            .unwrap()
            .expect("session-a overview");
        assert_eq!(overview.session.title.as_deref(), Some("标题 A"));
        assert_eq!(overview.messages_count, 2);
        assert_eq!(overview.session.working_dir.as_deref(), Some("/tmp/a"));

        AgentDao::rename_session(&conn, "session-a", "新的标题", "2026-03-12T09:00:00+08:00")
            .unwrap();

        let renamed = AgentDao::get_session_overview(&conn, "session-a")
            .unwrap()
            .expect("renamed overview");
        assert_eq!(renamed.session.title.as_deref(), Some("新的标题"));
        assert_eq!(renamed.session.updated_at, "2026-03-12T09:00:00+08:00");
    }

    #[test]
    fn add_message_and_get_messages_should_roundtrip_reasoning_content() {
        let conn = setup_pattern_test_db();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at, working_dir, execution_strategy)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, NULL, ?6)",
            params![
                "session-reasoning",
                "deepseek-reasoner",
                "推理会话",
                "2026-03-19T10:00:00+08:00",
                "2026-03-19T10:00:00+08:00",
                "react"
            ],
        )
        .unwrap();

        AgentDao::add_message(
            &conn,
            "session-reasoning",
            &crate::agent::types::AgentMessage {
                role: "assistant".to_string(),
                content: MessageContent::Text("需要继续调用工具".to_string()),
                timestamp: "2026-03-19T10:00:01+08:00".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: Some("先分析参数，再继续请求".to_string()),
                usage: Some(crate::agent::types::TokenUsage::new(1200, 300)),
            },
        )
        .unwrap();

        let messages = AgentDao::get_messages(&conn, "session-reasoning").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0].reasoning_content.as_deref(),
            Some("先分析参数，再继续请求")
        );
        assert_eq!(
            messages[0].usage,
            Some(crate::agent::types::TokenUsage::new(1200, 300))
        );
    }

    #[test]
    fn update_latest_assistant_message_usage_should_only_touch_latest_assistant() {
        let conn = setup_pattern_test_db();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at, working_dir, execution_strategy)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, NULL, ?6)",
            params![
                "session-usage",
                "gpt-4.1",
                "usage 会话",
                "2026-03-19T10:00:00+08:00",
                "2026-03-19T10:00:00+08:00",
                "react"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["session-usage", "assistant", r#"[{"type":"text","text":"旧助手消息"}]"#, "2026-03-19T10:00:01+08:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["session-usage", "user", r#"[{"type":"text","text":"用户消息"}]"#, "2026-03-19T10:00:02+08:00"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["session-usage", "assistant", r#"[{"type":"text","text":"最新助手消息"}]"#, "2026-03-19T10:00:03+08:00"],
        )
        .unwrap();

        let updated =
            AgentDao::update_latest_assistant_message_usage(&conn, "session-usage", 2048, 512)
                .unwrap();
        assert!(updated);

        let messages = AgentDao::get_messages(&conn, "session-usage").unwrap();
        assert_eq!(messages[0].usage, None);
        assert_eq!(messages[1].usage, None);
        assert_eq!(
            messages[2].usage,
            Some(crate::agent::types::TokenUsage::new(2048, 512))
        );
    }
}
