use super::{args_or_default, parse_optional_nested_arg};
use crate::dev_bridge::DevBridgeState;
use proxycast_memory::{MemoryCategory, MemoryMetadata, MemorySource, MemoryType, UnifiedMemory};
use rusqlite::{params_from_iter, types::Value};
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

fn parse_unified_memory_row(row: &rusqlite::Row) -> Result<UnifiedMemory, rusqlite::Error> {
    let id: String = row.get(0)?;
    let session_id: String = row.get(1)?;
    let memory_type_json: String = row.get(2)?;
    let category_json: String = row.get(3)?;
    let title: String = row.get(4)?;
    let content: String = row.get(5)?;
    let summary: String = row.get(6)?;
    let tags_json: String = row.get(7)?;
    let confidence: f32 = row.get(8)?;
    let importance: i64 = row.get(9)?;
    let access_count: i64 = row.get(10)?;
    let last_accessed_at: Option<i64> = row.get(11)?;
    let source_json: String = row.get(12)?;
    let created_at: i64 = row.get(13)?;
    let updated_at: i64 = row.get(14)?;
    let archived: i64 = row.get(15)?;

    let memory_type: MemoryType = serde_json::from_str(&memory_type_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let category: MemoryCategory = serde_json::from_str(&category_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let tags: Vec<String> = serde_json::from_str(&tags_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let source: MemorySource = serde_json::from_str(&source_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    Ok(UnifiedMemory {
        id,
        session_id,
        memory_type,
        category,
        title,
        content,
        summary,
        tags,
        metadata: MemoryMetadata {
            confidence,
            importance: importance.clamp(0, 10) as u8,
            access_count: access_count.max(0) as u32,
            last_accessed_at,
            source,
            embedding: None,
        },
        created_at,
        updated_at,
        archived: archived != 0,
    })
}

fn unified_memory_category_to_key(category: &MemoryCategory) -> &'static str {
    match category {
        MemoryCategory::Identity => "identity",
        MemoryCategory::Context => "context",
        MemoryCategory::Preference => "preference",
        MemoryCategory::Experience => "experience",
        MemoryCategory::Activity => "activity",
    }
}

fn ordered_unified_categories() -> [&'static str; 5] {
    [
        "identity",
        "context",
        "preference",
        "experience",
        "activity",
    ]
}

fn normalize_unified_category_value(value: &str) -> Option<&'static str> {
    if let Ok(category) = serde_json::from_str::<MemoryCategory>(value) {
        return Some(unified_memory_category_to_key(&category));
    }

    match value.trim_matches('"').to_lowercase().as_str() {
        "identity" | "身份" => Some("identity"),
        "context" | "情境" | "上下文" => Some("context"),
        "preference" | "偏好" => Some("preference"),
        "experience" | "经验" => Some("experience"),
        "activity" | "活动" => Some("activity"),
        _ => None,
    }
}

fn normalize_unified_sort_by(sort_by: Option<&str>) -> &'static str {
    match sort_by.unwrap_or("updated_at") {
        "created_at" => "created_at",
        "importance" => "importance",
        "access_count" => "access_count",
        _ => "updated_at",
    }
}

fn normalize_unified_sort_order(order: Option<&str>) -> &'static str {
    match order.unwrap_or("desc").to_lowercase().as_str() {
        "asc" => "ASC",
        _ => "DESC",
    }
}

pub(super) fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "unified_memory_stats" => {
            let Some(db) = &state.db else {
                return Ok(Some(serde_json::json!({
                    "total_entries": 0,
                    "storage_used": 0,
                    "memory_count": 0,
                    "categories": [],
                })));
            };

            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

            let (total_entries, memory_count, storage_used): (i64, i64, i64) = conn
                .query_row(
                    "SELECT COUNT(*), COUNT(DISTINCT session_id), COALESCE(SUM(length(title) + length(content) + length(summary) + length(tags)), 0) FROM unified_memory WHERE archived = 0",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(|e| format!("统计记忆失败: {e}"))?;

            let mut category_counts: std::collections::HashMap<String, u32> =
                std::collections::HashMap::new();
            let mut stmt = conn
                .prepare(
                    "SELECT category, COUNT(*) FROM unified_memory WHERE archived = 0 GROUP BY category",
                )
                .map_err(|e| format!("构建分类统计查询失败: {e}"))?;

            let rows = stmt
                .query_map([], |row| {
                    let category_raw: String = row.get(0)?;
                    let count: i64 = row.get(1)?;
                    Ok((category_raw, count))
                })
                .map_err(|e| format!("分类统计查询失败: {e}"))?;

            for row in rows.flatten() {
                if let Some(category) = normalize_unified_category_value(&row.0) {
                    category_counts.insert(category.to_string(), row.1.max(0) as u32);
                }
            }

            let categories = ordered_unified_categories()
                .iter()
                .map(
                    |category| crate::commands::unified_memory_cmd::MemoryCategoryStat {
                        category: (*category).to_string(),
                        count: *category_counts.get(*category).unwrap_or(&0),
                    },
                )
                .collect();

            let response = crate::commands::unified_memory_cmd::MemoryStatsResponse {
                total_entries: total_entries.max(0) as u32,
                storage_used: storage_used.max(0) as u64,
                memory_count: memory_count.max(0) as u32,
                categories,
            };

            serde_json::to_value(response)?
        }
        "unified_memory_list" => {
            let args = args_or_default(args);
            let filters: Option<crate::commands::unified_memory_cmd::ListFilters> =
                parse_optional_nested_arg(&args, "filters")?;
            let filters = filters.unwrap_or_default();

            let Some(db) = &state.db else {
                return Ok(Some(serde_json::json!([])));
            };

            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            let archived = filters.archived.unwrap_or(false);
            let sort_by = normalize_unified_sort_by(filters.sort_by.as_deref());
            let order = normalize_unified_sort_order(filters.order.as_deref());
            let limit = filters.limit.unwrap_or(120).clamp(1, 1000) as i64;
            let offset = filters.offset.unwrap_or(0) as i64;

            let mut where_parts = vec!["archived = ?".to_string()];
            let mut values: Vec<Value> = vec![Value::from(if archived { 1 } else { 0 })];

            if let Some(session_id) = filters.session_id.filter(|value| !value.trim().is_empty()) {
                where_parts.push("session_id = ?".to_string());
                values.push(Value::from(session_id));
            }

            if let Some(memory_type) = filters.memory_type {
                let encoded = serde_json::to_string(&memory_type)
                    .map_err(|e| format!("序列化 memory_type 失败: {e}"))?;
                where_parts.push("memory_type = ?".to_string());
                values.push(Value::from(encoded));
            }

            if let Some(category) = filters.category {
                let encoded = serde_json::to_string(&category)
                    .map_err(|e| format!("序列化 category 失败: {e}"))?;
                where_parts.push("category = ?".to_string());
                values.push(Value::from(encoded));
            }

            let sql = format!(
                "SELECT id, session_id, memory_type, category, title, content, summary, tags, confidence, importance, access_count, last_accessed_at, source, created_at, updated_at, archived FROM unified_memory WHERE {} ORDER BY {} {} LIMIT ? OFFSET ?",
                where_parts.join(" AND "),
                sort_by,
                order,
            );

            values.push(Value::from(limit));
            values.push(Value::from(offset));

            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("构建查询失败: {e}"))?;

            let memories = stmt
                .query_map(params_from_iter(values), parse_unified_memory_row)
                .map_err(|e| format!("查询记忆失败: {e}"))?
                .collect::<Result<Vec<_>, rusqlite::Error>>()
                .map_err(|e| format!("解析记忆失败: {e}"))?;

            serde_json::to_value(memories)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
