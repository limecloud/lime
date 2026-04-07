//! 对话统计后端服务
//!
//! 从数据库查询真实的对话和使用统计数据

use crate::database::dao::agent::{AgentDao, AgentModelPatternMatch};
use crate::database::dao::orchestrator::OrchestratorDao;
use crate::database::ConversationWindowSummary;
use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Timelike};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const GENERAL_MODE_PATTERN: &str = "general:%";

/// 使用统计数据响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStatsResponse {
    /// 总对话数
    pub total_conversations: u32,
    /// 总消息数
    pub total_messages: u32,
    /// 总 Token 消耗
    pub total_tokens: u64,
    /// 总使用时间（分钟）
    pub total_time_minutes: u32,
    /// 本月对话数
    pub monthly_conversations: u32,
    /// 本月消息数
    pub monthly_messages: u32,
    /// 本月 Token 消耗
    pub monthly_tokens: u64,
    /// 今日对话数
    pub today_conversations: u32,
    /// 今日消息数
    pub today_messages: u32,
    /// 今日 Token 消耗
    pub today_tokens: u64,
}

/// 模型使用统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelUsage {
    /// 模型名称
    pub model: String,
    /// 对话次数
    pub conversations: u32,
    /// Token 消耗
    pub tokens: u64,
    /// 使用百分比
    pub percentage: f32,
}

/// 每日使用统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyUsage {
    /// 日期 (YYYY-MM-DD)
    pub date: String,
    /// 对话数
    pub conversations: u32,
    /// Token 消耗
    pub tokens: u64,
}

#[derive(Debug, Clone, Copy, Default)]
struct ConversationStats {
    total_conversations: u32,
    total_messages: u32,
    monthly_conversations: u32,
    monthly_messages: u32,
    today_conversations: u32,
    today_messages: u32,
}

#[derive(Debug, Clone, Copy, Default)]
struct ConversationWindowTriplet {
    total: ConversationWindowSummary,
    monthly: ConversationWindowSummary,
    today: ConversationWindowSummary,
}

#[derive(Debug, Clone, Copy, Default)]
struct TokenStats {
    total_tokens: u64,
    monthly_tokens: u64,
    today_tokens: u64,
}

#[derive(Debug, Clone)]
struct RawModelUsage {
    model: String,
    conversations: u64,
    tokens: u64,
}

/// 获取使用统计数据
pub fn get_usage_stats_from_db(
    time_range: &str,
    conn: &Connection,
) -> Result<UsageStatsResponse, String> {
    validate_time_range(time_range)?;

    let now = Local::now();
    let today_start = start_of_day(now);
    let month_start = start_of_month(now);

    let general_windows =
        build_window_triplet(conn, summarize_general_window, &today_start, &month_start)?;
    let agent_windows =
        build_window_triplet(conn, summarize_agent_window, &today_start, &month_start)?;
    let general_stats = build_conversation_stats(general_windows);
    let agent_stats = build_conversation_stats(agent_windows);

    // 合并统计
    let total_conversations = general_stats.total_conversations + agent_stats.total_conversations;
    let total_messages = general_stats.total_messages + agent_stats.total_messages;

    let today_conversations = general_stats.today_conversations + agent_stats.today_conversations;
    let today_messages = general_stats.today_messages + agent_stats.today_messages;

    let monthly_conversations =
        general_stats.monthly_conversations + agent_stats.monthly_conversations;
    let monthly_messages = general_stats.monthly_messages + agent_stats.monthly_messages;

    // Token 优先使用真实统计表；无记录时回退到基于消息内容长度的估算
    let token_stats = query_token_stats(
        conn,
        &today_start,
        &month_start,
        general_windows,
        agent_windows,
    )?;
    let total_tokens = token_stats.total_tokens;
    let monthly_tokens = token_stats.monthly_tokens;
    let today_tokens = token_stats.today_tokens;

    // 计算总使用时间（基于 token 估算，约 10 token/s）
    let total_time_minutes = (total_tokens / 600) as u32;

    Ok(UsageStatsResponse {
        total_conversations,
        total_messages,
        total_tokens,
        total_time_minutes,
        monthly_conversations,
        monthly_messages,
        monthly_tokens,
        today_conversations,
        today_messages,
        today_tokens,
    })
}

fn validate_time_range(time_range: &str) -> Result<(), String> {
    match time_range {
        "week" | "month" | "all" => Ok(()),
        _ => Err("无效的时间范围".to_string()),
    }
}

fn resolve_range_days(time_range: &str) -> Result<i64, String> {
    match time_range {
        "week" => Ok(7),
        "month" => Ok(30),
        "all" => Ok(90),
        _ => Err("无效的时间范围".to_string()),
    }
}

fn resolve_range_start(time_range: &str) -> Result<Option<DateTime<Local>>, String> {
    let now = Local::now();
    match time_range {
        "week" => Ok(Some(now - Duration::days(7))),
        "month" => Ok(Some(now - Duration::days(30))),
        "all" => Ok(None),
        _ => Err("无效的时间范围".to_string()),
    }
}

fn start_of_day(now: DateTime<Local>) -> DateTime<Local> {
    now.with_hour(0)
        .and_then(|dt| dt.with_minute(0))
        .and_then(|dt| dt.with_second(0))
        .and_then(|dt| dt.with_nanosecond(0))
        .unwrap_or(now)
}

fn start_of_month(now: DateTime<Local>) -> DateTime<Local> {
    now.with_day(1)
        .and_then(|dt| dt.with_hour(0))
        .and_then(|dt| dt.with_minute(0))
        .and_then(|dt| dt.with_second(0))
        .and_then(|dt| dt.with_nanosecond(0))
        .unwrap_or_else(|| start_of_day(now))
}

fn clamp_i64_to_u32(value: i64) -> u32 {
    value.clamp(0, u32::MAX as i64) as u32
}

fn clamp_i64_to_u64(value: i64) -> u64 {
    value.max(0) as u64
}

fn chars_to_estimated_tokens(chars: i64) -> u64 {
    if chars <= 0 {
        return 0;
    }
    ((chars as f64) / 4.0).ceil() as u64
}

fn format_sqlite_datetime(timestamp_ms: i64) -> String {
    Local
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string())
}

fn summarize_unified_window(
    conn: &Connection,
    match_mode: AgentModelPatternMatch,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
) -> Result<ConversationWindowSummary, String> {
    let from_text = from_timestamp_ms.map(format_sqlite_datetime);
    let to_text = to_timestamp_ms.map(format_sqlite_datetime);

    AgentDao::summarize_by_model_pattern(
        conn,
        GENERAL_MODE_PATTERN,
        match_mode,
        from_text.as_deref(),
        to_text.as_deref(),
    )
    .map_err(|e| match match_mode {
        AgentModelPatternMatch::Like => format!("查询 unified general 摘要失败: {e}"),
        AgentModelPatternMatch::NotLike => format!("查询非通用 unified 摘要失败: {e}"),
    })
}

fn summarize_general_window(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
) -> Result<ConversationWindowSummary, String> {
    summarize_unified_window(
        conn,
        AgentModelPatternMatch::Like,
        from_timestamp_ms,
        to_timestamp_ms,
    )
}

fn summarize_agent_window(
    conn: &Connection,
    from_timestamp_ms: Option<i64>,
    to_timestamp_ms: Option<i64>,
) -> Result<ConversationWindowSummary, String> {
    summarize_unified_window(
        conn,
        AgentModelPatternMatch::NotLike,
        from_timestamp_ms,
        to_timestamp_ms,
    )
}

fn build_window_triplet(
    conn: &Connection,
    summarize_window: impl Fn(
        &Connection,
        Option<i64>,
        Option<i64>,
    ) -> Result<ConversationWindowSummary, String>,
    today_start: &DateTime<Local>,
    month_start: &DateTime<Local>,
) -> Result<ConversationWindowTriplet, String> {
    let today_ts = today_start.timestamp_millis();
    let month_ts = month_start.timestamp_millis();

    Ok(ConversationWindowTriplet {
        total: summarize_window(conn, None, None)?,
        monthly: summarize_window(conn, Some(month_ts), None)?,
        today: summarize_window(conn, Some(today_ts), None)?,
    })
}

fn build_conversation_stats(windows: ConversationWindowTriplet) -> ConversationStats {
    ConversationStats {
        total_conversations: clamp_i64_to_u32(windows.total.session_count),
        total_messages: clamp_i64_to_u32(windows.total.message_count),
        monthly_conversations: clamp_i64_to_u32(windows.monthly.session_count),
        monthly_messages: clamp_i64_to_u32(windows.monthly.message_count),
        today_conversations: clamp_i64_to_u32(windows.today.session_count),
        today_messages: clamp_i64_to_u32(windows.today.message_count),
    }
}

#[cfg(test)]
fn query_general_chat_stats(
    conn: &Connection,
    today_start: &DateTime<Local>,
    month_start: &DateTime<Local>,
) -> Result<ConversationStats, String> {
    build_window_triplet(conn, summarize_general_window, today_start, month_start)
        .map(build_conversation_stats)
}

#[cfg(test)]
fn query_agent_chat_stats(
    conn: &Connection,
    today_start: &DateTime<Local>,
    month_start: &DateTime<Local>,
) -> Result<ConversationStats, String> {
    build_window_triplet(conn, summarize_agent_window, today_start, month_start)
        .map(build_conversation_stats)
}

fn query_token_stats(
    conn: &Connection,
    today_start: &DateTime<Local>,
    month_start: &DateTime<Local>,
    general_windows: ConversationWindowTriplet,
    agent_windows: ConversationWindowTriplet,
) -> Result<TokenStats, String> {
    if let Some(actual_tokens) = query_model_usage_table_tokens(conn, today_start, month_start)? {
        return Ok(actual_tokens);
    }

    Ok(query_estimated_tokens_from_windows(
        general_windows,
        agent_windows,
    ))
}

fn query_model_usage_table_tokens(
    conn: &Connection,
    today_start: &DateTime<Local>,
    month_start: &DateTime<Local>,
) -> Result<Option<TokenStats>, String> {
    if !OrchestratorDao::has_model_usage_stats(conn)
        .map_err(|e| format!("查询 model_usage_stats 行数失败: {e}"))?
    {
        return Ok(None);
    }

    let today_key = today_start.format("%Y-%m-%d").to_string();
    let month_key = month_start.format("%Y-%m-%d").to_string();

    let total_tokens = OrchestratorDao::get_total_model_usage_tokens(conn)
        .map_err(|e| format!("查询总 Token 失败: {e}"))?;

    let monthly_tokens = OrchestratorDao::get_model_usage_tokens_since(conn, &month_key)
        .map_err(|e| format!("查询本月 Token 失败: {e}"))?;

    let today_tokens = OrchestratorDao::get_model_usage_tokens_on(conn, &today_key)
        .map_err(|e| format!("查询今日 Token 失败: {e}"))?;

    Ok(Some(TokenStats {
        total_tokens: clamp_i64_to_u64(total_tokens),
        monthly_tokens: clamp_i64_to_u64(monthly_tokens),
        today_tokens: clamp_i64_to_u64(today_tokens),
    }))
}

fn query_estimated_tokens_from_windows(
    general_windows: ConversationWindowTriplet,
    agent_windows: ConversationWindowTriplet,
) -> TokenStats {
    TokenStats {
        total_tokens: chars_to_estimated_tokens(
            general_windows.total.content_chars + agent_windows.total.content_chars,
        ),
        monthly_tokens: chars_to_estimated_tokens(
            general_windows.monthly.content_chars + agent_windows.monthly.content_chars,
        ),
        today_tokens: chars_to_estimated_tokens(
            general_windows.today.content_chars + agent_windows.today.content_chars,
        ),
    }
}

/// 获取模型使用排行
pub fn get_model_usage_ranking_from_db(
    time_range: &str,
    conn: &Connection,
) -> Result<Vec<ModelUsage>, String> {
    let range_start = resolve_range_start(time_range)?;

    let mut usages = query_model_usage_from_stats_table(conn, range_start)?;
    if usages.is_empty() {
        usages = query_model_usage_from_agent_messages(conn, range_start)?;
    }

    Ok(build_model_usage_response(usages))
}

fn query_model_usage_from_stats_table(
    conn: &Connection,
    range_start: Option<DateTime<Local>>,
) -> Result<Vec<RawModelUsage>, String> {
    if !OrchestratorDao::has_model_usage_stats(conn)
        .map_err(|e| format!("检查模型统计表失败: {e}"))?
    {
        return Ok(Vec::new());
    }

    let start_key = range_start.map(|start| start.format("%Y-%m-%d").to_string());
    let rows = OrchestratorDao::list_model_usage_aggregates(conn, start_key.as_deref(), 20)
        .map_err(|e| format!("执行模型统计查询失败: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|row| RawModelUsage {
            model: row.model_id,
            conversations: clamp_i64_to_u64(row.request_count),
            tokens: clamp_i64_to_u64(row.total_tokens),
        })
        .collect())
}

fn query_model_usage_from_agent_messages(
    conn: &Connection,
    range_start: Option<DateTime<Local>>,
) -> Result<Vec<RawModelUsage>, String> {
    let start_str = range_start.map(|start| start.format("%Y-%m-%d %H:%M:%S").to_string());
    let rows = AgentDao::list_model_usage_by_model_pattern(
        conn,
        GENERAL_MODE_PATTERN,
        AgentModelPatternMatch::NotLike,
        start_str.as_deref(),
        20,
    )
    .map_err(|e| format!("查询 Agent 模型排行失败: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|row| RawModelUsage {
            model: row.model,
            conversations: row.conversations,
            tokens: chars_to_estimated_tokens(row.content_chars as i64),
        })
        .collect())
}

fn build_model_usage_response(usages: Vec<RawModelUsage>) -> Vec<ModelUsage> {
    if usages.is_empty() {
        return Vec::new();
    }

    let total_tokens: u64 = usages.iter().map(|item| item.tokens).sum();
    let total_conversations: u64 = usages.iter().map(|item| item.conversations).sum();

    usages
        .into_iter()
        .map(|item| {
            let denominator = if total_tokens > 0 {
                total_tokens as f64
            } else {
                total_conversations.max(1) as f64
            };
            let numerator = if total_tokens > 0 {
                item.tokens as f64
            } else {
                item.conversations as f64
            };
            let percentage = ((numerator / denominator) * 1000.0).round() / 10.0;

            ModelUsage {
                model: if item.model.trim().is_empty() {
                    "unknown".to_string()
                } else {
                    item.model
                },
                conversations: item.conversations.min(u32::MAX as u64) as u32,
                tokens: item.tokens,
                percentage: percentage as f32,
            }
        })
        .collect()
}

/// 获取每日使用趋势
pub fn get_daily_usage_trends_from_db(
    time_range: &str,
    conn: &Connection,
) -> Result<Vec<DailyUsage>, String> {
    let days = resolve_range_days(time_range)?;

    let use_actual_tokens = OrchestratorDao::has_model_usage_stats(conn)
        .map_err(|e| format!("检查 model_usage_stats 失败: {e}"))?;

    let mut daily_usage = Vec::new();

    // 查询每日统计（从最早日期到今天）
    for i in (0..days).rev() {
        let date = Local::now() - Duration::days(i);
        let day_start = start_of_day(date);
        let day_end = day_start + Duration::days(1);

        let day_start_ts = day_start.timestamp_millis();
        let day_end_ts = day_end.timestamp_millis();
        let day_key = day_start.format("%Y-%m-%d").to_string();
        let general_window = summarize_general_window(conn, Some(day_start_ts), Some(day_end_ts))
            .map_err(|e| format!("查询通用日摘要失败: {e}"))?;
        let agent_window = summarize_agent_window(conn, Some(day_start_ts), Some(day_end_ts))
            .map_err(|e| format!("查询 Agent 日摘要失败: {e}"))?;

        let total_conversations = general_window.session_count + agent_window.session_count;

        let tokens = if use_actual_tokens {
            let day_tokens = OrchestratorDao::get_model_usage_tokens_on(conn, &day_key)
                .map_err(|e| format!("查询模型日 Token 失败: {e}"))?;

            clamp_i64_to_u64(day_tokens)
        } else {
            chars_to_estimated_tokens(general_window.content_chars + agent_window.content_chars)
        };

        daily_usage.push(DailyUsage {
            date: day_key,
            conversations: clamp_i64_to_u32(total_conversations),
            tokens,
        });
    }

    Ok(daily_usage)
}

#[cfg(test)]
mod tests {
    use super::{
        get_model_usage_ranking_from_db, query_agent_chat_stats, query_general_chat_stats,
        start_of_day, start_of_month,
    };
    use chrono::{Local, TimeZone};
    use rusqlite::{params, Connection};

    fn create_test_schema(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE agent_sessions (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                system_prompt TEXT,
                title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
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
            CREATE TABLE general_chat_sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT
            );
            CREATE TABLE general_chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                blocks TEXT,
                status TEXT NOT NULL DEFAULT 'complete',
                created_at INTEGER NOT NULL,
                metadata TEXT
            );
            ",
        )
        .expect("create schema");
    }

    #[test]
    fn stats_do_not_double_count_migrated_general_sessions() {
        let conn = Connection::open_in_memory().expect("open in memory db");
        create_test_schema(&conn);

        let now = Local
            .with_ymd_and_hms(2026, 3, 12, 10, 0, 0)
            .single()
            .expect("build datetime");
        let now_ms = now.timestamp_millis();

        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["general-1", "旧通用会话", now_ms, now_ms],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["gm-1", "general-1", "user", "legacy general", now_ms],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params!["general-1", "general:default", "统一通用会话", now.to_rfc3339(), now.to_rfc3339()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["general-1", "user", r#"[{"type":"text","text":"legacy general"}]"#, now.to_rfc3339()],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params!["agent-1", "claude-sonnet-4", "Agent 会话", now.to_rfc3339(), now.to_rfc3339()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params!["agent-1", "assistant", r#"[{"type":"text","text":"agent reply"}]"#, now.to_rfc3339()],
        )
        .unwrap();

        let today_start = start_of_day(now);
        let month_start = start_of_month(now);

        let general_stats =
            query_general_chat_stats(&conn, &today_start, &month_start).expect("general stats");
        let agent_stats =
            query_agent_chat_stats(&conn, &today_start, &month_start).expect("agent stats");

        assert_eq!(general_stats.total_conversations, 1);
        assert_eq!(general_stats.total_messages, 1);
        assert_eq!(agent_stats.total_conversations, 1);
        assert_eq!(agent_stats.total_messages, 1);
    }

    #[test]
    fn stats_ignore_legacy_general_tables_during_runtime() {
        let conn = Connection::open_in_memory().expect("open in memory db");
        create_test_schema(&conn);

        let now = Local
            .with_ymd_and_hms(2026, 3, 12, 10, 0, 0)
            .single()
            .expect("build datetime");
        let now_ms = now.timestamp_millis();

        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["legacy-only", "旧通用会话", now_ms, now_ms],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["gm-1", "legacy-only", "user", "legacy general", now_ms],
        )
        .unwrap();

        let today_start = start_of_day(now);
        let month_start = start_of_month(now);
        let general_stats =
            query_general_chat_stats(&conn, &today_start, &month_start).expect("general stats");

        assert_eq!(general_stats.total_conversations, 0);
        assert_eq!(general_stats.total_messages, 0);
        assert_eq!(general_stats.monthly_conversations, 0);
        assert_eq!(general_stats.today_messages, 0);
    }

    #[test]
    fn model_usage_ranking_fallback_should_only_include_non_general_models() {
        let conn = Connection::open_in_memory().expect("open in memory db");
        create_test_schema(&conn);

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params![
                "general-1",
                "general:default",
                "通用会话",
                "2026-03-12T10:00:00+08:00",
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params![
                "agent-1",
                "claude-sonnet-4",
                "Agent 会话",
                "2026-03-12T10:05:00+08:00",
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "general-1",
                "user",
                r#"[{"type":"text","text":"这条 general 消息不应进入 Agent 排行"}]"#,
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "assistant",
                r#"[{"type":"text","text":"这是 agent 模型排行候选"}]"#,
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        let ranking = get_model_usage_ranking_from_db("all", &conn).expect("load ranking");
        assert_eq!(ranking.len(), 1);
        assert_eq!(ranking[0].model, "claude-sonnet-4");
        assert_eq!(ranking[0].conversations, 1);
        assert!(ranking[0].tokens > 0);
    }
}
