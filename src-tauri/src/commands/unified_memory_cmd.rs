//! Unified memory Tauri commands
//!
//! Provides unified memory CRUD operations and analysis pipeline.

use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::services::chat_history_service::{load_memory_source_candidates, MemorySourceCandidate};
use lime_core::config::MemoryConfig;
use lime_memory::extractor::{self, ExtractionContext};
use lime_memory::gatekeeper::ChatMessage;
use lime_memory::{MemoryCategory, MemoryMetadata, MemorySource, MemoryType, UnifiedMemory};
use rusqlite::{params, params_from_iter, types::Value};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;
use tracing::{info, warn};

const DEFAULT_LIST_LIMIT: usize = 120;
const MAX_LIST_LIMIT: usize = 1000;
const MAX_SOURCE_MESSAGES: usize = 6000;
const MAX_GENERATED_PER_REQUEST: usize = 200;
const MAX_GENERATED_PER_REQUEST_CAP: usize = 2000;
const MAX_GENERATED_PER_SESSION: usize = 40;
const MIN_MESSAGE_LENGTH: usize = 18;
const MAX_LLM_SESSIONS: usize = 20;
const MAX_LLM_MESSAGES_PER_SESSION: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateRequest {
    pub session_id: String,
    pub title: String,
    pub content: String,
    pub summary: String,
    pub category: Option<MemoryCategory>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub confidence: Option<f32>,
    pub importance: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateRequest {
    pub title: Option<String>,
    pub content: Option<String>,
    pub summary: Option<String>,
    pub tags: Option<Vec<String>>,
    pub confidence: Option<f32>,
    pub importance: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListFilters {
    pub session_id: Option<String>,
    pub memory_type: Option<MemoryType>,
    pub category: Option<MemoryCategory>,
    pub archived: Option<bool>,
    pub sort_by: Option<String>,
    pub order: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStatsResponse {
    pub total_entries: u32,
    pub storage_used: u64,
    pub memory_count: u32,
    pub categories: Vec<MemoryCategoryStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryCategoryStat {
    pub category: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryAnalysisResult {
    pub analyzed_sessions: u32,
    pub analyzed_messages: u32,
    pub generated_entries: u32,
    pub deduplicated_entries: u32,
}

#[derive(Debug, Clone)]
struct PendingMemory {
    session_id: String,
    category: MemoryCategory,
    title: String,
    content: String,
    summary: String,
    tags: Vec<String>,
    confidence: f32,
    importance: u8,
    created_at: i64,
    source: MemorySource,
}

#[tauri::command]
pub async fn unified_memory_list(
    db: State<'_, DbConnection>,
    filters: Option<ListFilters>,
) -> Result<Vec<UnifiedMemory>, String> {
    let filters = filters.unwrap_or_default();
    info!("[Unified Memory] List memories: {:?}", filters);

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    list_unified_memories(&conn, filters)
}

pub(crate) fn list_unified_memories(
    conn: &rusqlite::Connection,
    filters: ListFilters,
) -> Result<Vec<UnifiedMemory>, String> {
    let archived = filters.archived.unwrap_or(false);
    let sort_by = normalize_sort_by(filters.sort_by.as_deref());
    let order = normalize_sort_order(filters.order.as_deref());
    let limit = filters
        .limit
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, MAX_LIST_LIMIT) as i64;
    let offset = filters.offset.unwrap_or(0) as i64;

    let mut where_parts = vec!["archived = ?".to_string()];
    let mut values: Vec<Value> = vec![Value::from(if archived { 1 } else { 0 })];

    if let Some(session_id) = filters.session_id.filter(|v| !v.trim().is_empty()) {
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
        let encoded =
            serde_json::to_string(&category).map_err(|e| format!("序列化 category 失败: {e}"))?;
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
        .query_map(params_from_iter(values), parse_memory_row)
        .map_err(|e| format!("查询记忆失败: {e}"))?
        .collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| format!("解析记忆失败: {e}"))?;

    Ok(memories)
}

#[tauri::command]
pub async fn unified_memory_get(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<Option<UnifiedMemory>, String> {
    info!("[Unified Memory] Get memory: {}", id);

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let mut stmt = conn
        .prepare("SELECT id, session_id, memory_type, category, title, content, summary, tags, confidence, importance, access_count, last_accessed_at, source, created_at, updated_at, archived FROM unified_memory WHERE id = ?")
        .map_err(|e| format!("构建查询失败: {e}"))?;

    let mut rows = stmt
        .query_map(params![&id], parse_memory_row)
        .map_err(|e| format!("查询记忆失败: {e}"))?;

    if let Some(Ok(memory)) = rows.next() {
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE unified_memory SET access_count = access_count + 1, last_accessed_at = ?1 WHERE id = ?2",
            params![now, &id],
        )
        .map_err(|e| format!("更新访问统计失败: {e}"))?;

        Ok(Some(memory))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn unified_memory_create(
    db: State<'_, DbConnection>,
    request: CreateRequest,
) -> Result<UnifiedMemory, String> {
    info!("[Unified Memory] Create memory: {}", request.title);

    if request.title.trim().is_empty() {
        return Err("记忆标题不能为空".to_string());
    }

    if request.content.trim().is_empty() {
        return Err("记忆内容不能为空".to_string());
    }

    let now = chrono::Utc::now().timestamp_millis();
    let category = request.category.unwrap_or_else(|| {
        infer_category_from_text(&request.title, &request.summary, &request.content)
    });

    let memory = UnifiedMemory {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: request.session_id,
        memory_type: MemoryType::Conversation,
        category,
        title: request.title.trim().to_string(),
        content: request.content.trim().to_string(),
        summary: if request.summary.trim().is_empty() {
            truncate_text(request.content.trim(), 120)
        } else {
            truncate_text(request.summary.trim(), 140)
        },
        tags: normalize_tags(request.tags),
        metadata: MemoryMetadata {
            confidence: request.confidence.unwrap_or(0.7).clamp(0.0, 1.0),
            importance: request.importance.unwrap_or(5).clamp(0, 10),
            access_count: 0,
            last_accessed_at: None,
            source: MemorySource::Manual,
            embedding: None,
        },
        created_at: now,
        updated_at: now,
        archived: false,
    };

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    insert_unified_memory(&conn, &memory)?;

    Ok(memory)
}

#[tauri::command]
pub async fn unified_memory_update(
    db: State<'_, DbConnection>,
    id: String,
    request: UpdateRequest,
) -> Result<UnifiedMemory, String> {
    info!("[Unified Memory] Update memory: {}", id);

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let existing = get_memory_by_id(&conn, &id)?;
    let Some(existing) = existing else {
        return Err("记忆不存在".to_string());
    };

    let now = chrono::Utc::now().timestamp_millis();
    let updated = UnifiedMemory {
        id: existing.id,
        session_id: existing.session_id,
        memory_type: existing.memory_type,
        category: existing.category,
        title: request
            .title
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or(existing.title),
        content: request
            .content
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or(existing.content),
        summary: request
            .summary
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or(existing.summary),
        tags: request.tags.map(normalize_tags).unwrap_or(existing.tags),
        metadata: MemoryMetadata {
            confidence: request
                .confidence
                .unwrap_or(existing.metadata.confidence)
                .clamp(0.0, 1.0),
            importance: request
                .importance
                .unwrap_or(existing.metadata.importance)
                .clamp(0, 10),
            access_count: existing.metadata.access_count,
            last_accessed_at: existing.metadata.last_accessed_at,
            source: existing.metadata.source,
            embedding: existing.metadata.embedding,
        },
        created_at: existing.created_at,
        updated_at: now,
        archived: existing.archived,
    };

    update_unified_memory(&conn, &updated)?;
    Ok(updated)
}

#[tauri::command]
pub async fn unified_memory_delete(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<bool, String> {
    info!("[Unified Memory] Delete memory (hard): {}", id);

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let rows = conn
        .execute("DELETE FROM unified_memory WHERE id = ?", params![&id])
        .map_err(|e| format!("删除记忆失败: {e}"))?;

    Ok(rows > 0)
}

#[tauri::command]
pub async fn unified_memory_search(
    db: State<'_, DbConnection>,
    query: String,
    category: Option<MemoryCategory>,
    limit: Option<usize>,
) -> Result<Vec<UnifiedMemory>, String> {
    info!("[Unified Memory] Search: {}", query);

    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let search_pattern = format!("%{}%", escape_like(trimmed));
    let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT) as i64;

    let mut params: Vec<Value> = vec![
        Value::from(search_pattern.clone()),
        Value::from(search_pattern.clone()),
        Value::from(search_pattern.clone()),
    ];

    let mut sql = String::from(
        "SELECT id, session_id, memory_type, category, title, content, summary, tags, confidence, importance, access_count, last_accessed_at, source, created_at, updated_at, archived FROM unified_memory WHERE archived = 0 AND (title LIKE ? ESCAPE '\\\\' OR summary LIKE ? ESCAPE '\\\\' OR content LIKE ? ESCAPE '\\\\')",
    );

    if let Some(category) = category {
        let encoded =
            serde_json::to_string(&category).map_err(|e| format!("序列化 category 失败: {e}"))?;
        sql.push_str(" AND category = ?");
        params.push(Value::from(encoded));
    }

    sql.push_str(" ORDER BY updated_at DESC LIMIT ?");
    params.push(Value::from(limit));

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("构建查询失败: {e}"))?;

    let memories = stmt
        .query_map(params_from_iter(params), parse_memory_row)
        .map_err(|e| format!("搜索失败: {e}"))?
        .collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| format!("解析搜索结果失败: {e}"))?;

    Ok(memories)
}

#[tauri::command]
pub async fn unified_memory_stats(
    db: State<'_, DbConnection>,
) -> Result<MemoryStatsResponse, String> {
    info!("[Unified Memory] Stats");

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    collect_unified_memory_stats(&conn)
}

pub(crate) fn collect_unified_memory_stats(
    conn: &rusqlite::Connection,
) -> Result<MemoryStatsResponse, String> {
    let (total_entries, memory_count, storage_used): (i64, i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COUNT(DISTINCT session_id), COALESCE(SUM(length(title) + length(content) + length(summary) + length(tags)), 0) FROM unified_memory WHERE archived = 0",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| format!("统计记忆失败: {e}"))?;

    let mut category_counts: HashMap<String, u32> = HashMap::new();
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
        if let Some(category) = normalize_category_value(&row.0) {
            category_counts.insert(category.to_string(), row.1.max(0) as u32);
        }
    }

    let categories = ordered_categories()
        .iter()
        .map(|category| MemoryCategoryStat {
            category: (*category).to_string(),
            count: *category_counts.get(*category).unwrap_or(&0),
        })
        .collect();

    Ok(MemoryStatsResponse {
        total_entries: total_entries.max(0) as u32,
        storage_used: storage_used.max(0) as u64,
        memory_count: memory_count.max(0) as u32,
        categories,
    })
}

#[tauri::command]
pub async fn unified_memory_analyze(
    db: State<'_, DbConnection>,
    global_config: State<'_, GlobalConfigManagerState>,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
) -> Result<MemoryAnalysisResult, String> {
    info!(
        "[Unified Memory] Analyze memories, from={:?}, to={:?}",
        from_timestamp, to_timestamp
    );

    if let (Some(start), Some(end)) = (from_timestamp, to_timestamp) {
        if start > end {
            return Err("开始时间不能晚于结束时间".to_string());
        }
    }

    let memory_config = global_config.config().memory;
    let candidates = {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        load_memory_candidates(&conn, from_timestamp, to_timestamp)?
    };

    analyze_unified_memory_candidates(&db, &memory_config, &candidates).await
}

pub(crate) async fn analyze_unified_memory_candidates(
    db: &DbConnection,
    memory_config: &MemoryConfig,
    candidates: &[MemorySourceCandidate],
) -> Result<MemoryAnalysisResult, String> {
    if !memory_config.enabled {
        info!("[Unified Memory] 记忆功能已关闭，跳过分析");
        return Ok(MemoryAnalysisResult {
            analyzed_sessions: 0,
            analyzed_messages: 0,
            generated_entries: 0,
            deduplicated_entries: 0,
        });
    }

    if candidates.is_empty() {
        return Ok(MemoryAnalysisResult {
            analyzed_sessions: 0,
            analyzed_messages: 0,
            generated_entries: 0,
            deduplicated_entries: 0,
        });
    }

    let max_generated_per_request = memory_config
        .max_entries
        .unwrap_or(MAX_GENERATED_PER_REQUEST as u32)
        .clamp(1, MAX_GENERATED_PER_REQUEST_CAP as u32)
        as usize;
    let analyzed_sessions = candidates
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<HashSet<_>>()
        .len() as u32;

    let mut deduplicated_entries = 0u32;
    let mut pending_memories: Vec<PendingMemory> = Vec::new();

    let llm_api_key = resolve_llm_api_key();
    let llm_attempted = llm_api_key.is_some();

    if let Some(api_key) = llm_api_key {
        match build_pending_from_llm(db, candidates, &api_key, max_generated_per_request).await {
            Ok((mut llm_pending, llm_dedup)) => {
                deduplicated_entries += llm_dedup;
                pending_memories.append(&mut llm_pending);
            }
            Err(err) => {
                warn!("[Unified Memory] LLM 提取失败，回退规则提取: {}", err);
            }
        }
    }

    if !llm_attempted || pending_memories.is_empty() {
        let (mut fallback_pending, fallback_dedup) =
            build_pending_from_rules(db, candidates, max_generated_per_request)?;
        deduplicated_entries += fallback_dedup;
        pending_memories.append(&mut fallback_pending);
    }

    if pending_memories.len() > max_generated_per_request {
        pending_memories.truncate(max_generated_per_request);
    }

    let generated_entries = {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        let mut inserted = 0u32;
        for pending in pending_memories {
            let memory = pending_to_memory(pending);
            match insert_unified_memory(&conn, &memory) {
                Ok(_) => inserted += 1,
                Err(err) => {
                    warn!("[Unified Memory] 保存提取记忆失败: {}", err);
                    deduplicated_entries += 1;
                }
            }
        }
        inserted
    };

    Ok(MemoryAnalysisResult {
        analyzed_sessions,
        analyzed_messages: candidates.len() as u32,
        generated_entries,
        deduplicated_entries,
    })
}

fn build_pending_from_rules(
    db: &DbConnection,
    candidates: &[MemorySourceCandidate],
    max_generated_per_request: usize,
) -> Result<(Vec<PendingMemory>, u32), String> {
    let mut pending_memories = Vec::new();
    let mut deduplicated_entries = 0u32;

    let session_ids: HashSet<String> = candidates.iter().map(|c| c.session_id.clone()).collect();
    let mut existing_by_session = {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        load_existing_memories_by_session(&conn, &session_ids)?
    };

    let mut generated_per_session: HashMap<String, usize> = HashMap::new();

    for candidate in candidates {
        let counter = generated_per_session
            .entry(candidate.session_id.clone())
            .or_insert(0);
        if *counter >= MAX_GENERATED_PER_SESSION {
            continue;
        }

        let (title, summary, category) = build_rule_entry_fields(candidate);
        let fingerprint = build_fingerprint(&candidate.content);
        let entry_tags = vec![
            "auto_analysis".to_string(),
            category_to_key(&category).to_string(),
            fingerprint.clone(),
        ];

        let existing = existing_by_session
            .entry(candidate.session_id.clone())
            .or_insert_with(Vec::new);

        if is_duplicate(existing, &fingerprint, &title, &summary) {
            deduplicated_entries += 1;
            continue;
        }

        let pending = PendingMemory {
            session_id: candidate.session_id.clone(),
            category,
            title,
            content: summary.clone(),
            summary,
            tags: entry_tags,
            confidence: infer_confidence(candidate),
            importance: infer_importance(candidate),
            created_at: normalize_timestamp(candidate.created_at),
            source: MemorySource::AutoExtracted,
        };

        existing.push(pending_to_memory(pending.clone()));
        pending_memories.push(pending);
        *counter += 1;

        if pending_memories.len() >= max_generated_per_request {
            break;
        }
    }

    Ok((pending_memories, deduplicated_entries))
}

async fn build_pending_from_llm(
    db: &DbConnection,
    candidates: &[MemorySourceCandidate],
    api_key: &str,
    max_generated_per_request: usize,
) -> Result<(Vec<PendingMemory>, u32), String> {
    let mut grouped: HashMap<String, Vec<MemorySourceCandidate>> = HashMap::new();
    for candidate in candidates.iter().cloned() {
        grouped
            .entry(candidate.session_id.clone())
            .or_default()
            .push(candidate);
    }

    let mut session_ids: Vec<String> = grouped.keys().cloned().collect();
    session_ids.sort();
    session_ids.truncate(MAX_LLM_SESSIONS);

    let session_set: HashSet<String> = session_ids.iter().cloned().collect();
    let mut existing_by_session = {
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        load_existing_memories_by_session(&conn, &session_set)?
    };

    let mut pending_memories = Vec::new();
    let mut deduplicated_entries = 0u32;

    for session_id in session_ids {
        let mut session_candidates = grouped.remove(&session_id).unwrap_or_default();
        if session_candidates.is_empty() {
            continue;
        }

        session_candidates.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        if session_candidates.len() > MAX_LLM_MESSAGES_PER_SESSION {
            let start = session_candidates.len() - MAX_LLM_MESSAGES_PER_SESSION;
            session_candidates = session_candidates[start..].to_vec();
        }

        let messages = session_candidates
            .iter()
            .map(|item| ChatMessage {
                role: item.role.clone(),
                content: item.content.clone(),
                timestamp: normalize_timestamp(item.created_at),
            })
            .collect::<Vec<_>>();

        let existing = existing_by_session
            .entry(session_id.clone())
            .or_insert_with(Vec::new)
            .clone();

        let context = ExtractionContext {
            messages,
            existing_memories: existing,
            session_id: session_id.clone(),
        };

        let extracted = extractor::extract_memories(api_key, &context).await?;

        let existing_mut = existing_by_session
            .entry(session_id.clone())
            .or_insert_with(Vec::new);

        for memory in extracted {
            let fingerprint = build_fingerprint(&memory.content);
            let title = memory.title.trim().to_string();
            let summary = truncate_text(memory.summary.trim(), 140);
            let content = if memory.content.trim().is_empty() {
                summary.clone()
            } else {
                truncate_text(memory.content.trim(), 600)
            };

            if title.is_empty() || summary.is_empty() {
                continue;
            }

            if is_duplicate(existing_mut, &fingerprint, &title, &summary) {
                deduplicated_entries += 1;
                continue;
            }

            let mut tags = normalize_tags(memory.tags);
            if !tags.iter().any(|tag| tag == &fingerprint) {
                tags.push(fingerprint.clone());
            }
            if !tags.iter().any(|tag| tag == "auto_analysis") {
                tags.push("auto_analysis".to_string());
            }

            let pending = PendingMemory {
                session_id: session_id.clone(),
                category: memory.category,
                title,
                content,
                summary,
                tags,
                confidence: memory.metadata.confidence.clamp(0.0, 1.0),
                importance: memory.metadata.importance.clamp(0, 10),
                created_at: normalize_timestamp(memory.created_at),
                source: MemorySource::AutoExtracted,
            };

            existing_mut.push(pending_to_memory(pending.clone()));
            pending_memories.push(pending);

            if pending_memories.len() >= max_generated_per_request {
                break;
            }
        }

        if pending_memories.len() >= max_generated_per_request {
            break;
        }
    }

    Ok((pending_memories, deduplicated_entries))
}

fn resolve_llm_api_key() -> Option<String> {
    [
        "ANTHROPIC_API_KEY",
        "CLAUDE_API_KEY",
        "LIME_ANTHROPIC_API_KEY",
        "PROXYCAST_ANTHROPIC_API_KEY",
    ]
    .iter()
    .find_map(|key| std::env::var(key).ok())
    .map(|key| key.trim().to_string())
    .filter(|key| !key.is_empty())
}

fn load_existing_memories_by_session(
    conn: &rusqlite::Connection,
    session_ids: &HashSet<String>,
) -> Result<HashMap<String, Vec<UnifiedMemory>>, String> {
    let mut map = HashMap::new();

    let mut stmt = conn
        .prepare("SELECT id, session_id, memory_type, category, title, content, summary, tags, confidence, importance, access_count, last_accessed_at, source, created_at, updated_at, archived FROM unified_memory WHERE archived = 0 AND session_id = ? ORDER BY updated_at DESC")
        .map_err(|e| format!("构建查询失败: {e}"))?;

    for session_id in session_ids {
        let memories = stmt
            .query_map(params![session_id], parse_memory_row)
            .map_err(|e| format!("查询会话记忆失败: {e}"))?
            .collect::<Result<Vec<_>, rusqlite::Error>>()
            .map_err(|e| format!("解析会话记忆失败: {e}"))?;

        map.insert(session_id.clone(), memories);
    }

    Ok(map)
}

fn get_memory_by_id(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<Option<UnifiedMemory>, String> {
    let mut stmt = conn
        .prepare("SELECT id, session_id, memory_type, category, title, content, summary, tags, confidence, importance, access_count, last_accessed_at, source, created_at, updated_at, archived FROM unified_memory WHERE id = ?")
        .map_err(|e| format!("构建查询失败: {e}"))?;

    let mut rows = stmt
        .query_map(params![id], parse_memory_row)
        .map_err(|e| format!("查询记忆失败: {e}"))?;

    if let Some(row) = rows.next() {
        row.map(Some).map_err(|e| format!("解析记忆失败: {e}"))
    } else {
        Ok(None)
    }
}

fn insert_unified_memory(
    conn: &rusqlite::Connection,
    memory: &UnifiedMemory,
) -> Result<(), String> {
    let memory_type_json = serde_json::to_string(&memory.memory_type)
        .map_err(|e| format!("序列化 memory_type 失败: {e}"))?;
    let category_json = serde_json::to_string(&memory.category)
        .map_err(|e| format!("序列化 category 失败: {e}"))?;
    let tags_json =
        serde_json::to_string(&memory.tags).map_err(|e| format!("序列化 tags 失败: {e}"))?;
    let source_json = serde_json::to_string(&memory.metadata.source)
        .map_err(|e| format!("序列化 source 失败: {e}"))?;

    conn.execute(
        "INSERT INTO unified_memory (id, session_id, memory_type, category, title, content, summary, tags, confidence, importance, access_count, last_accessed_at, source, created_at, updated_at, archived)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            &memory.id,
            &memory.session_id,
            &memory_type_json,
            &category_json,
            &memory.title,
            &memory.content,
            &memory.summary,
            &tags_json,
            memory.metadata.confidence,
            memory.metadata.importance as i64,
            memory.metadata.access_count as i64,
            memory.metadata.last_accessed_at,
            &source_json,
            memory.created_at,
            memory.updated_at,
            if memory.archived { 1 } else { 0 },
        ],
    )
    .map_err(|e| format!("写入记忆失败: {e}"))?;

    Ok(())
}

fn update_unified_memory(
    conn: &rusqlite::Connection,
    memory: &UnifiedMemory,
) -> Result<(), String> {
    let tags_json =
        serde_json::to_string(&memory.tags).map_err(|e| format!("序列化 tags 失败: {e}"))?;

    conn.execute(
        "UPDATE unified_memory
         SET title = ?1,
             content = ?2,
             summary = ?3,
             tags = ?4,
             confidence = ?5,
             importance = ?6,
             updated_at = ?7
         WHERE id = ?8",
        params![
            &memory.title,
            &memory.content,
            &memory.summary,
            &tags_json,
            memory.metadata.confidence,
            memory.metadata.importance as i64,
            memory.updated_at,
            &memory.id,
        ],
    )
    .map_err(|e| format!("更新记忆失败: {e}"))?;

    Ok(())
}

fn parse_memory_row(row: &rusqlite::Row) -> Result<UnifiedMemory, rusqlite::Error> {
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

    let metadata = MemoryMetadata {
        confidence,
        importance: importance.clamp(0, 10) as u8,
        access_count: access_count.max(0) as u32,
        last_accessed_at,
        source,
        embedding: None,
    };

    Ok(UnifiedMemory {
        id,
        session_id,
        memory_type,
        category,
        title,
        content,
        summary,
        tags,
        metadata,
        created_at,
        updated_at,
        archived: archived != 0,
    })
}

fn load_memory_candidates(
    conn: &rusqlite::Connection,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
) -> Result<Vec<MemorySourceCandidate>, String> {
    load_memory_source_candidates(
        conn,
        from_timestamp,
        to_timestamp,
        MAX_SOURCE_MESSAGES,
        MIN_MESSAGE_LENGTH,
    )
}

fn build_rule_entry_fields(candidate: &MemorySourceCandidate) -> (String, String, MemoryCategory) {
    let content = candidate.content.trim();
    let lowered = content.to_lowercase();

    let category = if contains_any(
        &lowered,
        &["喜欢", "偏好", "prefer", "不喜欢", "习惯", "常用"],
    ) {
        MemoryCategory::Preference
    } else if contains_any(
        &lowered,
        &["我是", "我叫", "身份", "职业", "my name", "i am"],
    ) {
        MemoryCategory::Identity
    } else if contains_any(&lowered, &["计划", "待办", "todo", "接下来", "将要"]) {
        MemoryCategory::Activity
    } else if contains_any(
        &lowered,
        &["错误", "失败", "异常", "报错", "error", "failed"],
    ) {
        MemoryCategory::Context
    } else if candidate.role == "assistant" {
        MemoryCategory::Experience
    } else {
        MemoryCategory::Context
    };

    let title = format!(
        "{}记忆 · {}",
        map_category_display_name(&category),
        format_timestamp(candidate.created_at)
    );

    let summary = format!(
        "自动分析提取（{}）：{}",
        if candidate.role == "assistant" {
            "AI 响应"
        } else {
            "用户表达"
        },
        truncate_text(content, 200)
    );

    (title, summary, category)
}

fn infer_confidence(candidate: &MemorySourceCandidate) -> f32 {
    let base: f32 = if candidate.role == "user" { 0.72 } else { 0.62 };
    if contains_any(
        &candidate.content.to_lowercase(),
        &["必须", "重要", "关键", "urgent", "critical"],
    ) {
        (base + 0.08f32).clamp(0.0, 1.0)
    } else {
        base
    }
}

fn infer_importance(candidate: &MemorySourceCandidate) -> u8 {
    let mut importance = if candidate.role == "user" { 6 } else { 5 };
    if contains_any(
        &candidate.content.to_lowercase(),
        &["必须", "重要", "关键", "urgent", "critical"],
    ) {
        importance = 8;
    }
    importance
}

fn infer_category_from_text(title: &str, summary: &str, content: &str) -> MemoryCategory {
    let combined = format!("{title} {summary} {content}").to_lowercase();

    if contains_any(&combined, &["我是", "我叫", "my name", "i am", "身份"]) {
        return MemoryCategory::Identity;
    }
    if contains_any(&combined, &["喜欢", "偏好", "prefer", "习惯", "爱好"]) {
        return MemoryCategory::Preference;
    }
    if contains_any(&combined, &["经历", "做过", "learned", "经验", "复盘"]) {
        return MemoryCategory::Experience;
    }
    if contains_any(&combined, &["计划", "待办", "正在", "接下来", "任务"]) {
        return MemoryCategory::Activity;
    }
    MemoryCategory::Context
}

fn pending_to_memory(pending: PendingMemory) -> UnifiedMemory {
    let now = chrono::Utc::now().timestamp_millis();
    UnifiedMemory {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: pending.session_id,
        memory_type: MemoryType::Conversation,
        category: pending.category,
        title: pending.title,
        content: pending.content,
        summary: pending.summary,
        tags: normalize_tags(pending.tags),
        metadata: MemoryMetadata {
            confidence: pending.confidence.clamp(0.0, 1.0),
            importance: pending.importance.clamp(0, 10),
            access_count: 0,
            last_accessed_at: None,
            source: pending.source,
            embedding: None,
        },
        created_at: normalize_timestamp(pending.created_at),
        updated_at: now,
        archived: false,
    }
}

fn is_duplicate(
    existing_entries: &[UnifiedMemory],
    fingerprint: &str,
    title: &str,
    summary: &str,
) -> bool {
    let normalized_title = normalize_text(title);
    let normalized_summary = normalize_text(summary);

    existing_entries.iter().any(|entry| {
        entry.tags.iter().any(|tag| tag == fingerprint)
            || normalize_text(&entry.title) == normalized_title
            || normalize_text(&entry.summary) == normalized_summary
            || normalize_text(&entry.content).contains(&normalized_summary)
    })
}

fn build_fingerprint(content: &str) -> String {
    let normalized = normalize_text(content);
    let compact = normalized.chars().take(120).collect::<String>();
    format!("fp:{compact}")
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }

        let key = trimmed.to_lowercase();
        if seen.insert(key) {
            normalized.push(trimmed.to_string());
        }
    }

    normalized
}

fn normalize_text(input: &str) -> String {
    input
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate_text(input: &str, max_chars: usize) -> String {
    let mut chars = input.chars();
    let prefix: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn category_to_key(category: &MemoryCategory) -> &'static str {
    match category {
        MemoryCategory::Identity => "identity",
        MemoryCategory::Context => "context",
        MemoryCategory::Preference => "preference",
        MemoryCategory::Experience => "experience",
        MemoryCategory::Activity => "activity",
    }
}

fn map_category_display_name(category: &MemoryCategory) -> &'static str {
    match category {
        MemoryCategory::Identity => "身份",
        MemoryCategory::Context => "情境",
        MemoryCategory::Preference => "偏好",
        MemoryCategory::Experience => "经验",
        MemoryCategory::Activity => "活动",
    }
}

fn ordered_categories() -> [&'static str; 5] {
    [
        "identity",
        "context",
        "preference",
        "experience",
        "activity",
    ]
}

fn normalize_category_value(value: &str) -> Option<&'static str> {
    if let Ok(category) = serde_json::from_str::<MemoryCategory>(value) {
        return Some(category_to_key(&category));
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

fn contains_any(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| text.contains(keyword))
}

fn normalize_sort_by(sort_by: Option<&str>) -> &'static str {
    match sort_by.unwrap_or("updated_at") {
        "created_at" => "created_at",
        "importance" => "importance",
        "access_count" => "access_count",
        _ => "updated_at",
    }
}

fn normalize_sort_order(order: Option<&str>) -> &'static str {
    match order.unwrap_or("desc").to_lowercase().as_str() {
        "asc" => "ASC",
        _ => "DESC",
    }
}

fn normalize_timestamp(ts: i64) -> i64 {
    if ts <= 0 {
        return chrono::Utc::now().timestamp_millis();
    }
    if ts > 1_000_000_000_000 {
        ts
    } else {
        ts * 1000
    }
}

fn format_timestamp(timestamp_ms: i64) -> String {
    let normalized = normalize_timestamp(timestamp_ms);

    chrono::DateTime::from_timestamp_millis(normalized)
        .map(|dt| dt.format("%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "未知时间".to_string())
}

fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
