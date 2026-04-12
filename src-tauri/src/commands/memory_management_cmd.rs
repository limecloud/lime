//! 记忆管理命令
//!
//! 提供记忆相关的统计、治理与自动记忆配置能力。
//!
//! 其中：
//! - `memory_runtime_*` 属于当前 runtime / 上下文记忆主入口
//! - `memory_get_*` / `memory_toggle_auto` / `memory_update_auto_note`
//!   属于当前仍在演进的记忆治理配置入口

use crate::commands::context_memory::ContextMemoryServiceState;
use crate::commands::unified_memory_cmd::{list_unified_memories, ListFilters};
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::services::auto_memory_service::{
    get_auto_memory_index, update_auto_memory_note, AutoMemoryIndexResponse,
};
use crate::services::chat_history_service::{load_memory_source_candidates, MemorySourceCandidate};
use crate::services::memory_source_resolver_service::{
    resolve_effective_sources, EffectiveMemorySourcesResponse,
};
use crate::services::runtime_agents_template_service::{
    ensure_workspace_local_agents_gitignore, scaffold_runtime_agents_template,
    RuntimeAgentsTemplateScaffoldResult, RuntimeAgentsTemplateTarget,
    WorkspaceGitignoreEnsureResult,
};
use aster::session::list_summaries;
use chrono::{Local, NaiveDateTime, TimeZone};
use lime_core::app_paths;
use lime_core::config::MemoryConfig;
use lime_services::context_memory_service::{ContextMemoryService, MemoryEntry, MemoryFileType};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use tracing::{info, warn};

/// 记忆统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStatsResponse {
    /// 总记忆条数
    pub total_entries: u32,
    /// 已使用的存储空间（字节）
    pub storage_used: u64,
    /// 记忆库数量
    pub memory_count: u32,
}

/// 清理记忆结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanupMemoryResult {
    /// 清理的条目数
    pub cleaned_entries: u32,
    /// 释放的存储空间（字节）
    pub freed_space: u64,
}

/// 记忆分析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryAnalysisResult {
    /// 分析到的会话数
    pub analyzed_sessions: u32,
    /// 分析到的消息数
    pub analyzed_messages: u32,
    /// 新生成的记忆条目数
    pub generated_entries: u32,
    /// 去重忽略的条目数
    pub deduplicated_entries: u32,
}

/// 记忆分类统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryCategoryStat {
    /// 分类 key：identity/context/preference/experience/activity
    pub category: String,
    /// 分类下条目数量
    pub count: u32,
}

/// 记忆条目预览
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntryPreview {
    pub id: String,
    pub session_id: String,
    pub file_type: String,
    pub category: String,
    pub title: String,
    pub summary: String,
    pub updated_at: i64,
    pub tags: Vec<String>,
}

/// 记忆总览响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryOverviewResponse {
    pub stats: MemoryStatsResponse,
    pub categories: Vec<MemoryCategoryStat>,
    pub entries: Vec<MemoryEntryPreview>,
}

/// 自动记忆开关响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryAutoToggleResponse {
    pub enabled: bool,
}

/// 工作记忆文件摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingMemoryFileSummary {
    pub file_type: String,
    pub path: String,
    pub exists: bool,
    pub entry_count: u32,
    pub updated_at: i64,
    pub summary: String,
}

/// 单个会话的工作记忆视图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingMemorySessionSummary {
    pub session_id: String,
    pub total_entries: u32,
    pub updated_at: i64,
    pub files: Vec<WorkingMemoryFileSummary>,
    pub highlights: Vec<MemoryEntryPreview>,
}

/// 工作记忆总览
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingMemoryView {
    pub memory_dir: String,
    pub total_sessions: u32,
    pub total_entries: u32,
    pub sessions: Vec<WorkingMemorySessionSummary>,
}

/// 压缩边界快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionBoundarySnapshot {
    pub session_id: String,
    pub source: String,
    pub summary_preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_count: Option<u32>,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// 工作记忆抽取状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryExtractionStatusResponse {
    pub enabled: bool,
    pub status: String,
    pub status_summary: String,
    pub working_session_count: u32,
    pub working_entry_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_working_memory_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_compaction: Option<CompactionBoundarySnapshot>,
    #[serde(default)]
    pub recent_compactions: Vec<CompactionBoundarySnapshot>,
}

/// 持久记忆召回条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DurableMemoryRecallEntry {
    pub id: String,
    pub session_id: String,
    pub category: String,
    pub title: String,
    pub summary: String,
    pub updated_at: i64,
    pub tags: Vec<String>,
}

/// Team 影子记忆条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMemoryShadowEntry {
    pub key: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

/// 单回合记忆预取请求
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TurnMemoryPrefetchRequest {
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub user_message: String,
    #[serde(default)]
    pub request_metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub max_durable_entries: Option<usize>,
    #[serde(default)]
    pub max_working_chars: Option<usize>,
}

/// 单回合记忆预取结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnMemoryPrefetchResult {
    pub session_id: String,
    #[serde(default)]
    pub rules_source_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_memory_excerpt: Option<String>,
    #[serde(default)]
    pub durable_memories: Vec<DurableMemoryRecallEntry>,
    #[serde(default)]
    pub team_memory_entries: Vec<TeamMemoryShadowEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_compaction: Option<CompactionBoundarySnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ErrorEntryRecord {
    #[serde(default)]
    id: String,
    #[serde(default)]
    error_description: String,
    #[serde(default)]
    attempted_solutions: Vec<String>,
    #[serde(default)]
    last_failure_at: i64,
    #[serde(default)]
    resolved: bool,
    #[serde(default)]
    resolution: Option<String>,
}

const SUPPORTED_MEMORY_FILES: [&str; 4] = [
    "task_plan.md",
    "findings.md",
    "progress.md",
    "error_log.json",
];

const CATEGORY_ORDER: [&str; 5] = [
    "identity",
    "context",
    "preference",
    "experience",
    "activity",
];

const MAX_SOURCE_MESSAGES: usize = 6000;
const MAX_GENERATED_PER_REQUEST: usize = 200;
const MAX_GENERATED_PER_REQUEST_CAP: usize = 2000;
const MAX_GENERATED_PER_SESSION: usize = 40;
const MIN_MESSAGE_LENGTH: usize = 18;
const DEFAULT_WORKING_SESSION_LIMIT: usize = 24;
const MAX_WORKING_SESSION_LIMIT: usize = 120;
const DEFAULT_RECENT_COMPACTION_LIMIT: usize = 12;
const DEFAULT_PREFETCH_DURABLE_LIMIT: usize = 5;
const DEFAULT_PREFETCH_WORKING_CHARS: usize = 2400;

async fn memory_runtime_get_stats_impl() -> Result<MemoryStatsResponse, String> {
    info!("[记忆管理] 获取记忆统计信息");

    let memory_dir = resolve_memory_dir();
    let overview = collect_memory_overview(&memory_dir)?;
    Ok(overview.stats)
}

/// 获取 runtime / 上下文记忆统计信息
#[tauri::command]
pub async fn memory_runtime_get_stats() -> Result<MemoryStatsResponse, String> {
    memory_runtime_get_stats_impl().await
}

async fn memory_runtime_get_overview_impl(
    limit: Option<u32>,
) -> Result<MemoryOverviewResponse, String> {
    info!("[记忆管理] 获取记忆总览, limit={:?}", limit);

    let memory_dir = resolve_memory_dir();
    let mut overview = collect_memory_overview(&memory_dir)?;

    if let Some(limit) = limit.filter(|v| *v > 0) {
        overview.entries.truncate(limit as usize);
    }

    Ok(overview)
}

/// 获取 runtime / 上下文记忆总览（分类 + 条目）
#[tauri::command]
pub async fn memory_runtime_get_overview(
    limit: Option<u32>,
) -> Result<MemoryOverviewResponse, String> {
    memory_runtime_get_overview_impl(limit).await
}

async fn memory_runtime_request_analysis_impl(
    memory_service: State<'_, ContextMemoryServiceState>,
    db: State<'_, DbConnection>,
    global_config: State<'_, GlobalConfigManagerState>,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
) -> Result<MemoryAnalysisResult, String> {
    info!(
        "[记忆管理] 请求记忆分析 from={:?}, to={:?}",
        from_timestamp, to_timestamp
    );

    if let (Some(start), Some(end)) = (from_timestamp, to_timestamp) {
        if start > end {
            return Err("开始时间不能大于结束时间".to_string());
        }
    }

    let memory_config = global_config.config().memory;
    if !memory_config.enabled {
        info!("[记忆管理] 记忆功能已关闭，跳过分析");
        return Ok(MemoryAnalysisResult {
            analyzed_sessions: 0,
            analyzed_messages: 0,
            generated_entries: 0,
            deduplicated_entries: 0,
        });
    }

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let candidates = load_memory_candidates(&conn, from_timestamp, to_timestamp)?;
    analyze_memory_candidates(memory_service.0.as_ref(), &memory_config, &candidates)
}

/// 从历史对话中抽取 runtime / 上下文记忆条目
#[tauri::command]
pub async fn memory_runtime_request_analysis(
    memory_service: State<'_, ContextMemoryServiceState>,
    db: State<'_, DbConnection>,
    global_config: State<'_, GlobalConfigManagerState>,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
) -> Result<MemoryAnalysisResult, String> {
    memory_runtime_request_analysis_impl(
        memory_service,
        db,
        global_config,
        from_timestamp,
        to_timestamp,
    )
    .await
}

async fn memory_runtime_cleanup_impl(
    memory_service: State<'_, ContextMemoryServiceState>,
    global_config: State<'_, GlobalConfigManagerState>,
) -> Result<CleanupMemoryResult, String> {
    info!("[记忆管理] 开始清理过期记忆");

    let memory_config = global_config.config().memory;
    if matches!(memory_config.auto_cleanup, Some(false)) {
        info!("[记忆管理] 自动清理已关闭，跳过清理");
        return Ok(CleanupMemoryResult {
            cleaned_entries: 0,
            freed_space: 0,
        });
    }

    let retention_days = memory_config.retention_days.unwrap_or(30).clamp(1, 3650);

    let memory_dir = resolve_memory_dir();
    let before = collect_memory_overview(&memory_dir)?;

    memory_service
        .0
        .cleanup_expired_memories_with_retention_days(retention_days)?;

    let after = collect_memory_overview(&memory_dir)?;

    let cleaned_entries = before
        .stats
        .total_entries
        .saturating_sub(after.stats.total_entries);
    let freed_space = before
        .stats
        .storage_used
        .saturating_sub(after.stats.storage_used);

    Ok(CleanupMemoryResult {
        cleaned_entries,
        freed_space,
    })
}

/// 清理 runtime / 上下文记忆
#[tauri::command]
pub async fn memory_runtime_cleanup(
    memory_service: State<'_, ContextMemoryServiceState>,
    global_config: State<'_, GlobalConfigManagerState>,
) -> Result<CleanupMemoryResult, String> {
    memory_runtime_cleanup_impl(memory_service, global_config).await
}

/// 获取当前会话可见的有效记忆来源（含 AGENTS、规则、自动记忆）
#[tauri::command]
pub async fn memory_get_effective_sources(
    global_config: State<'_, GlobalConfigManagerState>,
    working_dir: Option<String>,
    active_relative_path: Option<String>,
) -> Result<EffectiveMemorySourcesResponse, String> {
    let config = global_config.config();
    let resolved_working_dir = resolve_working_dir(working_dir)?;
    let resolution = resolve_effective_sources(
        &config,
        &resolved_working_dir,
        active_relative_path.as_deref(),
    );
    Ok(resolution.response)
}

/// 获取自动记忆入口索引
#[tauri::command]
pub async fn memory_get_auto_index(
    global_config: State<'_, GlobalConfigManagerState>,
    working_dir: Option<String>,
) -> Result<AutoMemoryIndexResponse, String> {
    let config = global_config.config();
    let resolved_working_dir = resolve_working_dir(working_dir)?;
    get_auto_memory_index(&config.memory, &resolved_working_dir)
}

/// 切换自动记忆开关（写入全局配置）
#[tauri::command]
pub async fn memory_toggle_auto(
    global_config: State<'_, GlobalConfigManagerState>,
    enabled: bool,
) -> Result<MemoryAutoToggleResponse, String> {
    let mut config = global_config.config();
    config.memory.auto.enabled = enabled;

    global_config
        .save_config(&config)
        .await
        .map_err(|e| format!("保存自动记忆开关失败: {e}"))?;

    Ok(MemoryAutoToggleResponse {
        enabled: config.memory.auto.enabled,
    })
}

/// 更新自动记忆笔记（写入 MEMORY.md 或 topic 文件）
#[tauri::command]
pub async fn memory_update_auto_note(
    global_config: State<'_, GlobalConfigManagerState>,
    working_dir: Option<String>,
    note: String,
    topic: Option<String>,
) -> Result<AutoMemoryIndexResponse, String> {
    let config = global_config.config();
    let resolved_working_dir = resolve_working_dir(working_dir)?;
    update_auto_memory_note(
        &config.memory,
        &resolved_working_dir,
        &note,
        topic.as_deref(),
    )
}

/// 显式生成运行时 AGENTS 模板
#[tauri::command]
pub async fn memory_scaffold_runtime_agents_template(
    target: RuntimeAgentsTemplateTarget,
    working_dir: Option<String>,
    overwrite: Option<bool>,
) -> Result<RuntimeAgentsTemplateScaffoldResult, String> {
    let resolved_working_dir = match target {
        RuntimeAgentsTemplateTarget::Global => None,
        RuntimeAgentsTemplateTarget::Workspace | RuntimeAgentsTemplateTarget::WorkspaceLocal => {
            Some(resolve_working_dir(working_dir)?)
        }
    };

    scaffold_runtime_agents_template(
        target,
        resolved_working_dir.as_deref(),
        overwrite.unwrap_or(false),
    )
}

/// 确保 Workspace `.gitignore` 忽略 `.lime/AGENTS.local.md`
#[tauri::command]
pub async fn memory_ensure_workspace_local_agents_gitignore(
    working_dir: Option<String>,
) -> Result<WorkspaceGitignoreEnsureResult, String> {
    let resolved_working_dir = resolve_working_dir(working_dir)?;
    ensure_workspace_local_agents_gitignore(&resolved_working_dir)
}

/// 获取结构化工作记忆视图
#[tauri::command]
pub async fn memory_runtime_get_working_memory(
    session_id: Option<String>,
    limit: Option<u32>,
) -> Result<WorkingMemoryView, String> {
    let memory_dir = resolve_memory_dir();
    let normalized_limit = limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_WORKING_SESSION_LIMIT)
        .clamp(1, MAX_WORKING_SESSION_LIMIT);
    collect_working_memory_view(&memory_dir, session_id.as_deref(), normalized_limit)
}

/// 获取记忆抽取与压缩状态
#[tauri::command]
pub async fn memory_runtime_get_extraction_status(
    global_config: State<'_, GlobalConfigManagerState>,
) -> Result<MemoryExtractionStatusResponse, String> {
    let config = global_config.config();
    let memory_dir = resolve_memory_dir();
    let working_view =
        collect_working_memory_view(&memory_dir, None, DEFAULT_WORKING_SESSION_LIMIT)?;
    let recent_compactions = list_recent_compactions(DEFAULT_RECENT_COMPACTION_LIMIT);
    let latest_working_memory_at = working_view
        .sessions
        .iter()
        .map(|session| session.updated_at)
        .filter(|timestamp| *timestamp > 0)
        .max();
    let latest_compaction = recent_compactions.first().cloned();

    let (status, status_summary) = if !config.memory.enabled {
        (
            "disabled".to_string(),
            "全局记忆功能当前已关闭，规则、工作记忆与自动沉淀都不会参与运行时。".to_string(),
        )
    } else if working_view.total_entries == 0 && latest_compaction.is_none() {
        (
            "idle".to_string(),
            "还没有检测到工作记忆文件或上下文压缩结果，当前处于冷启动状态。".to_string(),
        )
    } else if working_view.total_entries > 0 && latest_compaction.is_none() {
        (
            "collecting".to_string(),
            "已检测到工作记忆文件，当前还没有可复用的上下文压缩快照。".to_string(),
        )
    } else {
        (
            "ready".to_string(),
            "工作记忆和上下文压缩快照都已就绪，可用于运行时回忆与续接。".to_string(),
        )
    };

    Ok(MemoryExtractionStatusResponse {
        enabled: config.memory.enabled,
        status,
        status_summary,
        working_session_count: working_view.total_sessions,
        working_entry_count: working_view.total_entries,
        latest_working_memory_at,
        latest_compaction,
        recent_compactions,
    })
}

/// 为单回合构建记忆预取结果
#[tauri::command]
pub async fn memory_runtime_prefetch_for_turn(
    global_config: State<'_, GlobalConfigManagerState>,
    db: State<'_, DbConnection>,
    request: TurnMemoryPrefetchRequest,
) -> Result<TurnMemoryPrefetchResult, String> {
    let config = global_config.config();
    let resolved_working_dir = resolve_working_dir(request.working_dir.clone())?;
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    build_turn_memory_prefetch_result(&config, &conn, &resolved_working_dir, &request)
}

fn resolve_memory_dir() -> PathBuf {
    app_paths::best_effort_runtime_subdir("memory")
}

fn resolve_working_dir(working_dir: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = working_dir
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        let candidate = PathBuf::from(path);
        let canonical = candidate
            .canonicalize()
            .map_err(|e| format!("working_dir 无效: {path} ({e})"))?;
        return Ok(canonical);
    }

    std::env::current_dir().map_err(|e| format!("获取当前工作目录失败: {e}"))
}

fn collect_memory_overview(memory_dir: &Path) -> Result<MemoryOverviewResponse, String> {
    if !memory_dir.exists() {
        return Ok(MemoryOverviewResponse {
            stats: MemoryStatsResponse {
                total_entries: 0,
                storage_used: 0,
                memory_count: 0,
            },
            categories: CATEGORY_ORDER
                .iter()
                .map(|category| MemoryCategoryStat {
                    category: (*category).to_string(),
                    count: 0,
                })
                .collect(),
            entries: Vec::new(),
        });
    }

    let mut storage_used = 0u64;
    let mut memory_count = 0u32;
    let mut entries: Vec<MemoryEntryPreview> = Vec::new();

    let session_dirs = fs::read_dir(memory_dir).map_err(|e| format!("读取记忆目录失败: {e}"))?;

    for session_entry in session_dirs.flatten() {
        let session_path = session_entry.path();
        if !session_path.is_dir() {
            continue;
        }

        let session_id = session_entry.file_name().to_string_lossy().to_string();
        let mut has_memory_file = false;

        let files = match fs::read_dir(&session_path) {
            Ok(files) => files,
            Err(err) => {
                warn!("[记忆管理] 读取会话目录失败: {} - {}", session_id, err);
                continue;
            }
        };

        for file_entry in files.flatten() {
            let file_path = file_entry.path();
            if !file_path.is_file() {
                continue;
            }

            let file_name = file_entry.file_name().to_string_lossy().to_string();
            if !SUPPORTED_MEMORY_FILES.contains(&file_name.as_str()) {
                continue;
            }

            has_memory_file = true;

            let file_size = match fs::metadata(&file_path) {
                Ok(meta) => meta.len(),
                Err(err) => {
                    warn!(
                        "[记忆管理] 读取文件元数据失败: {} - {}",
                        file_path.display(),
                        err
                    );
                    0
                }
            };
            storage_used += file_size;

            let content = match fs::read_to_string(&file_path) {
                Ok(content) => content,
                Err(err) => {
                    warn!(
                        "[记忆管理] 读取记忆文件失败: {} - {}",
                        file_path.display(),
                        err
                    );
                    continue;
                }
            };

            if content.trim().is_empty() {
                continue;
            }

            let mut parsed_entries = parse_memory_file(&session_id, &file_name, &content);
            entries.append(&mut parsed_entries);
        }

        if has_memory_file {
            memory_count += 1;
        }
    }

    entries.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    let categories = build_categories(&entries);
    let total_entries = entries.len() as u32;

    Ok(MemoryOverviewResponse {
        stats: MemoryStatsResponse {
            total_entries,
            storage_used,
            memory_count,
        },
        categories,
        entries,
    })
}

#[derive(Debug, Default)]
struct WorkingMemorySessionAccumulator {
    total_entries: u32,
    updated_at: i64,
    highlights: Vec<MemoryEntryPreview>,
    files: HashMap<String, WorkingMemoryFileSummary>,
}

fn collect_working_memory_view(
    memory_dir: &Path,
    session_id: Option<&str>,
    limit: usize,
) -> Result<WorkingMemoryView, String> {
    let overview = collect_memory_overview(memory_dir)?;
    let mut sessions: HashMap<String, WorkingMemorySessionAccumulator> = HashMap::new();

    for entry in overview.entries.iter() {
        if session_id.is_some_and(|value| value.trim() != entry.session_id) {
            continue;
        }

        let accumulator = sessions
            .entry(entry.session_id.clone())
            .or_insert_with(WorkingMemorySessionAccumulator::default);
        accumulator.total_entries += 1;
        accumulator.updated_at = accumulator.updated_at.max(entry.updated_at);
        accumulator.highlights.push(entry.clone());

        let file_path = memory_dir
            .join(&entry.session_id)
            .join(memory_file_name_by_file_type(&entry.file_type));
        let file_summary = accumulator
            .files
            .entry(entry.file_type.clone())
            .or_insert_with(|| WorkingMemoryFileSummary {
                file_type: entry.file_type.clone(),
                path: file_path.to_string_lossy().to_string(),
                exists: file_path.exists(),
                entry_count: 0,
                updated_at: 0,
                summary: String::new(),
            });
        file_summary.entry_count += 1;
        file_summary.updated_at = file_summary.updated_at.max(entry.updated_at);
        if file_summary.summary.is_empty() {
            file_summary.summary = entry.summary.clone();
        } else if !file_summary.summary.contains(&entry.title) {
            file_summary.summary =
                truncate_text(&format!("{} / {}", file_summary.summary, entry.title), 140);
        }
    }

    let mut session_summaries = sessions
        .into_iter()
        .map(|(current_session_id, mut accumulator)| {
            accumulator.highlights.sort_by(|left, right| {
                right
                    .updated_at
                    .cmp(&left.updated_at)
                    .then_with(|| left.id.cmp(&right.id))
            });
            accumulator.highlights.truncate(5);

            let mut files = accumulator.files.into_values().collect::<Vec<_>>();
            files.sort_by(|left, right| {
                working_file_sort_key(&left.file_type)
                    .cmp(&working_file_sort_key(&right.file_type))
                    .then_with(|| left.file_type.cmp(&right.file_type))
            });

            WorkingMemorySessionSummary {
                session_id: current_session_id,
                total_entries: accumulator.total_entries,
                updated_at: accumulator.updated_at,
                files,
                highlights: accumulator.highlights,
            }
        })
        .collect::<Vec<_>>();

    session_summaries.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    session_summaries.truncate(limit);

    let total_entries = session_summaries
        .iter()
        .map(|session| session.total_entries)
        .sum();

    Ok(WorkingMemoryView {
        memory_dir: memory_dir.to_string_lossy().to_string(),
        total_sessions: session_summaries.len() as u32,
        total_entries,
        sessions: session_summaries,
    })
}

fn memory_file_name_by_file_type(file_type: &str) -> &'static str {
    match file_type {
        "task_plan" => "task_plan.md",
        "findings" => "findings.md",
        "progress" => "progress.md",
        "error_log" => "error_log.json",
        _ => "unknown",
    }
}

fn working_file_sort_key(file_type: &str) -> usize {
    match file_type {
        "task_plan" => 0,
        "findings" => 1,
        "progress" => 2,
        "error_log" => 3,
        _ => 99,
    }
}

fn build_compaction_boundary_snapshot(
    session_id: &str,
    summary_text: &str,
    created_at: i64,
    turn_count: Option<usize>,
    trigger: Option<String>,
    detail: Option<String>,
) -> CompactionBoundarySnapshot {
    CompactionBoundarySnapshot {
        session_id: session_id.to_string(),
        source: "summary_cache".to_string(),
        summary_preview: compact_preview(summary_text, 220),
        turn_count: turn_count.map(|value| value as u32),
        created_at,
        trigger,
        detail,
    }
}

fn list_recent_compactions(limit: usize) -> Vec<CompactionBoundarySnapshot> {
    list_summaries()
        .into_iter()
        .take(limit)
        .map(|summary| {
            build_compaction_boundary_snapshot(
                &summary.uuid,
                &summary.summary,
                summary.timestamp.timestamp_millis(),
                summary.turn_count,
                None,
                None,
            )
        })
        .collect()
}

pub(crate) fn build_turn_memory_prefetch_result(
    config: &lime_core::config::Config,
    conn: &Connection,
    working_dir: &Path,
    request: &TurnMemoryPrefetchRequest,
) -> Result<TurnMemoryPrefetchResult, String> {
    let memory_dir = resolve_memory_dir();
    let session_id = request.session_id.trim().to_string();
    let max_durable_entries = request
        .max_durable_entries
        .unwrap_or(DEFAULT_PREFETCH_DURABLE_LIMIT)
        .clamp(1, 12);
    let max_working_chars = request
        .max_working_chars
        .unwrap_or(DEFAULT_PREFETCH_WORKING_CHARS)
        .clamp(400, 12_000);
    let resolution = resolve_effective_sources(config, working_dir, None);
    let rules_source_paths = resolution
        .response
        .sources
        .iter()
        .filter(|source| source.loaded)
        .map(|source| source.path.clone())
        .collect::<Vec<_>>();
    let working_memory_excerpt = if session_id.is_empty() {
        None
    } else {
        load_working_memory_excerpt(&memory_dir, &session_id, max_working_chars)
    };
    let durable_memories = resolve_durable_memory_recall(
        conn,
        &session_id,
        &request.user_message,
        max_durable_entries,
    )?;
    let team_memory_entries = extract_team_memory_shadow_entries(request.request_metadata.as_ref());
    let latest_compaction = list_recent_compactions(DEFAULT_RECENT_COMPACTION_LIMIT)
        .into_iter()
        .find(|snapshot| snapshot.session_id == session_id);
    let prompt = build_turn_memory_prefetch_prompt(
        working_memory_excerpt.as_deref(),
        &durable_memories,
        latest_compaction.as_ref(),
    );

    Ok(TurnMemoryPrefetchResult {
        session_id,
        rules_source_paths,
        working_memory_excerpt,
        durable_memories,
        team_memory_entries,
        latest_compaction,
        prompt,
    })
}

fn load_working_memory_excerpt(
    memory_dir: &Path,
    session_id: &str,
    max_chars: usize,
) -> Option<String> {
    let session_dir = memory_dir.join(session_id);
    if !session_dir.exists() {
        return None;
    }

    let mut sections = Vec::new();
    for file_name in SUPPORTED_MEMORY_FILES {
        let file_path = session_dir.join(file_name);
        if !file_path.exists() {
            continue;
        }

        let raw = match fs::read_to_string(&file_path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }

        let rendered = if file_name == "error_log.json" {
            render_error_log_excerpt(trimmed)
        } else {
            compact_preview(trimmed, max_chars / 2)
        };
        if rendered.is_empty() {
            continue;
        }

        sections.push(format!("【{}】\n{}", file_name, rendered));
    }

    if sections.is_empty() {
        None
    } else {
        Some(truncate_text(&sections.join("\n\n"), max_chars))
    }
}

fn render_error_log_excerpt(content: &str) -> String {
    parse_error_entries("session", content)
        .into_iter()
        .take(3)
        .map(|entry| format!("- {}：{}", entry.title, entry.summary))
        .collect::<Vec<_>>()
        .join("\n")
}

fn compact_preview(input: &str, max_chars: usize) -> String {
    let normalized = input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");
    truncate_text(&normalized, max_chars)
}

fn resolve_durable_memory_recall(
    conn: &Connection,
    session_id: &str,
    user_message: &str,
    limit: usize,
) -> Result<Vec<DurableMemoryRecallEntry>, String> {
    let trimmed_query = user_message.trim();
    let mut memories = if !trimmed_query.is_empty() {
        search_durable_memories(conn, trimmed_query, limit)?
    } else {
        Vec::new()
    };

    if memories.is_empty() && !session_id.trim().is_empty() {
        let session_memories = list_unified_memories(
            conn,
            ListFilters {
                session_id: Some(session_id.to_string()),
                limit: Some(limit),
                ..Default::default()
            },
        )?;
        memories = session_memories
            .into_iter()
            .map(map_durable_memory_recall_entry)
            .collect();
    }

    if memories.is_empty() {
        let recent_memories = list_unified_memories(
            conn,
            ListFilters {
                limit: Some(limit),
                ..Default::default()
            },
        )?;
        memories = recent_memories
            .into_iter()
            .map(map_durable_memory_recall_entry)
            .collect();
    }

    memories.truncate(limit);
    Ok(memories)
}

fn search_durable_memories(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<DurableMemoryRecallEntry>, String> {
    let search_pattern = format!("%{}%", escape_like_for_sqlite(query));
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, category, title, summary, tags, updated_at
             FROM unified_memory
             WHERE archived = 0
               AND (title LIKE ? ESCAPE '\\\\' OR summary LIKE ? ESCAPE '\\\\' OR content LIKE ? ESCAPE '\\\\')
             ORDER BY updated_at DESC
             LIMIT ?",
        )
        .map_err(|e| format!("构建持久记忆搜索失败: {e}"))?;

    let rows = stmt
        .query_map(
            rusqlite::params![search_pattern, search_pattern, search_pattern, limit as i64],
            |row| {
                let tags_raw: String = row.get(5)?;
                let tags = serde_json::from_str::<Vec<String>>(&tags_raw).unwrap_or_default();
                Ok(DurableMemoryRecallEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    category: normalize_category_value_for_storage(&row.get::<_, String>(2)?),
                    title: row.get(3)?,
                    summary: row.get(4)?,
                    tags,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| format!("执行持久记忆搜索失败: {e}"))?;

    rows.collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| format!("解析持久记忆搜索结果失败: {e}"))
}

fn normalize_category_value_for_storage(value: &str) -> String {
    serde_json::from_str::<String>(value).unwrap_or_else(|_| value.to_string())
}

fn map_durable_memory_recall_entry(memory: lime_memory::UnifiedMemory) -> DurableMemoryRecallEntry {
    DurableMemoryRecallEntry {
        id: memory.id,
        session_id: memory.session_id,
        category: serde_json::to_string(&memory.category)
            .ok()
            .and_then(|encoded| serde_json::from_str::<String>(&encoded).ok())
            .unwrap_or_else(|| "context".to_string()),
        title: memory.title,
        summary: memory.summary,
        updated_at: memory.updated_at,
        tags: memory.tags,
    }
}

fn extract_team_memory_shadow_entries(
    request_metadata: Option<&serde_json::Value>,
) -> Vec<TeamMemoryShadowEntry> {
    let Some(metadata_object) = request_metadata.and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };
    let harness_object = metadata_object
        .get("harness")
        .and_then(serde_json::Value::as_object);
    let shadow = harness_object
        .and_then(|object| {
            object
                .get("team_memory_shadow")
                .or_else(|| object.get("teamMemoryShadow"))
        })
        .or_else(|| {
            metadata_object
                .get("team_memory_shadow")
                .or_else(|| metadata_object.get("teamMemoryShadow"))
        })
        .and_then(serde_json::Value::as_object);
    let Some(shadow_object) = shadow else {
        return Vec::new();
    };
    let Some(entries) = shadow_object
        .get("entries")
        .and_then(serde_json::Value::as_array)
    else {
        return Vec::new();
    };

    entries
        .iter()
        .filter_map(|entry| {
            let object = entry.as_object()?;
            let key = object
                .get("key")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            let content = object
                .get("content")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            let updated_at = object
                .get("updated_at")
                .or_else(|| object.get("updatedAt"))
                .and_then(serde_json::Value::as_i64);
            Some(TeamMemoryShadowEntry {
                key: key.to_string(),
                content: compact_preview(content, 220),
                updated_at,
            })
        })
        .collect()
}

fn build_turn_memory_prefetch_prompt(
    working_memory_excerpt: Option<&str>,
    durable_memories: &[DurableMemoryRecallEntry],
    latest_compaction: Option<&CompactionBoundarySnapshot>,
) -> Option<String> {
    let mut lines = vec!["【运行时记忆召回】".to_string()];

    if let Some(excerpt) = working_memory_excerpt.filter(|value| !value.trim().is_empty()) {
        lines.push(
            "- 以下是当前会话最近沉淀下来的工作记忆，只用于帮助你续接上下文，不要逐字复述给用户。"
                .to_string(),
        );
        lines.push(excerpt.to_string());
    }

    if !durable_memories.is_empty() {
        lines.push(
            "- 以下是与当前输入最接近的长期结构化记忆，请优先当作可复用事实，而不是重新臆测。"
                .to_string(),
        );
        for memory in durable_memories {
            let tag_suffix = if memory.tags.is_empty() {
                String::new()
            } else {
                format!(" / tags: {}", memory.tags.join(", "))
            };
            lines.push(format!(
                "  - [{}] {}：{}{}",
                memory.category, memory.title, memory.summary, tag_suffix
            ));
        }
    }

    if let Some(compaction) = latest_compaction {
        lines.push(
            "- 以下是最近一次上下文压缩后的边界摘要；如果当前对话需要追溯更早历史，优先从这里续接。"
                .to_string(),
        );
        lines.push(format!(
            "  - session={} / turns={:?} / summary={}",
            compaction.session_id, compaction.turn_count, compaction.summary_preview
        ));
    }

    if lines.len() == 1 {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn escape_like_for_sqlite(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn parse_memory_file(session_id: &str, file_name: &str, content: &str) -> Vec<MemoryEntryPreview> {
    match file_name {
        "task_plan.md" => parse_markdown_entries(session_id, content, "task_plan"),
        "findings.md" => parse_markdown_entries(session_id, content, "findings"),
        "progress.md" => parse_markdown_entries(session_id, content, "progress"),
        "error_log.json" => parse_error_entries(session_id, content),
        _ => Vec::new(),
    }
}

fn parse_markdown_entries(
    session_id: &str,
    content: &str,
    file_type: &str,
) -> Vec<MemoryEntryPreview> {
    let mut entries = Vec::new();
    let mut current_title: Option<String> = None;
    let mut section_lines: Vec<String> = Vec::new();
    let mut index = 0usize;

    for line in content.lines() {
        if let Some(title) = line.strip_prefix("## ") {
            if let Some(previous_title) = current_title.take() {
                if let Some(entry) = build_markdown_entry(
                    session_id,
                    file_type,
                    index,
                    &previous_title,
                    &section_lines,
                ) {
                    entries.push(entry);
                    index += 1;
                }
            }

            current_title = Some(title.trim().to_string());
            section_lines.clear();
            continue;
        }

        if current_title.is_some() {
            section_lines.push(line.to_string());
        }
    }

    if let Some(previous_title) = current_title {
        if let Some(entry) = build_markdown_entry(
            session_id,
            file_type,
            index,
            &previous_title,
            &section_lines,
        ) {
            entries.push(entry);
        }
    }

    entries
}

fn build_markdown_entry(
    session_id: &str,
    file_type: &str,
    index: usize,
    title: &str,
    lines: &[String],
) -> Option<MemoryEntryPreview> {
    if title.trim().is_empty() {
        return None;
    }

    let (tags, updated_at) = parse_metadata(lines);
    let summary = summarize_lines(lines);
    let category = infer_category(file_type, &tags, title, &summary);

    Some(MemoryEntryPreview {
        id: format!("{session_id}:{file_type}:{index}"),
        session_id: session_id.to_string(),
        file_type: file_type.to_string(),
        category,
        title: title.trim().to_string(),
        summary,
        updated_at,
        tags,
    })
}

fn parse_metadata(lines: &[String]) -> (Vec<String>, i64) {
    for line in lines {
        let line = line.trim();
        if !line.starts_with("**优先级**:") {
            continue;
        }

        let tags = line
            .split("**标签**:")
            .nth(1)
            .and_then(|part| part.split('|').next())
            .map(|part| {
                part.split(',')
                    .map(|tag| tag.trim().to_string())
                    .filter(|tag| !tag.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let updated_at = line
            .split("**更新时间**:")
            .nth(1)
            .map(str::trim)
            .and_then(parse_datetime_or_timestamp_to_millis)
            .unwrap_or(0);

        return (tags, updated_at);
    }

    (Vec::new(), 0)
}

fn parse_error_entries(session_id: &str, content: &str) -> Vec<MemoryEntryPreview> {
    let records: Vec<ErrorEntryRecord> = match serde_json::from_str(content) {
        Ok(records) => records,
        Err(err) => {
            warn!("[记忆管理] 解析 error_log.json 失败: {}", err);
            return Vec::new();
        }
    };

    records
        .into_iter()
        .enumerate()
        .map(|(index, record)| {
            let resolved = record.resolved;
            let tags = vec![
                "error".to_string(),
                if resolved {
                    "resolved".to_string()
                } else {
                    "unresolved".to_string()
                },
            ];

            let summary = record
                .resolution
                .clone()
                .or_else(|| record.attempted_solutions.last().cloned())
                .unwrap_or_else(|| "暂无解决方案记录".to_string());

            let category = if resolved {
                "experience".to_string()
            } else {
                "context".to_string()
            };

            let title_prefix = if resolved {
                "已解决错误"
            } else {
                "错误"
            };
            let title = if record.error_description.trim().is_empty() {
                title_prefix.to_string()
            } else {
                format!(
                    "{}：{}",
                    title_prefix,
                    truncate_text(&record.error_description, 32)
                )
            };

            MemoryEntryPreview {
                id: if record.id.is_empty() {
                    format!("{session_id}:error_log:{index}")
                } else {
                    record.id
                },
                session_id: session_id.to_string(),
                file_type: "error_log".to_string(),
                category,
                title,
                summary: truncate_text(summary.trim(), 140),
                updated_at: record.last_failure_at,
                tags,
            }
        })
        .collect()
}

fn build_categories(entries: &[MemoryEntryPreview]) -> Vec<MemoryCategoryStat> {
    let mut category_map: HashMap<String, u32> = HashMap::new();

    for entry in entries {
        *category_map.entry(entry.category.clone()).or_insert(0) += 1;
    }

    CATEGORY_ORDER
        .iter()
        .map(|category| MemoryCategoryStat {
            category: (*category).to_string(),
            count: category_map.get(*category).copied().unwrap_or(0),
        })
        .collect()
}

fn infer_category(file_type: &str, tags: &[String], title: &str, summary: &str) -> String {
    for tag in tags {
        if let Some(category) = normalize_category(tag) {
            return category.to_string();
        }
    }

    let text = format!("{title} {summary}").to_lowercase();

    if contains_any(&text, &["我是", "我叫", "my name", "i am", "身份", "职业"]) {
        return "identity".to_string();
    }
    if contains_any(&text, &["喜欢", "偏好", "prefer", "不喜欢", "习惯", "爱好"]) {
        return "preference".to_string();
    }
    if contains_any(
        &text,
        &[
            "曾经",
            "之前",
            "以前",
            "经历",
            "做过",
            "worked on",
            "learned",
        ],
    ) {
        return "experience".to_string();
    }
    if contains_any(
        &text,
        &["今天", "正在", "计划", "刚刚", "接下来", "todo", "任务"],
    ) {
        return "activity".to_string();
    }
    if contains_any(
        &text,
        &["背景", "场景", "环境", "上下文", "context", "需求", "目标"],
    ) {
        return "context".to_string();
    }

    map_file_type_to_category(file_type).to_string()
}

fn map_file_type_to_category(file_type: &str) -> &'static str {
    match file_type {
        "task_plan" => "context",
        "findings" => "experience",
        "progress" => "activity",
        "error_log" => "context",
        _ => "context",
    }
}

fn normalize_category(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_lowercase();
    match normalized.as_str() {
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

fn parse_datetime_to_timestamp(value: &str) -> Option<i64> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .ok()
        .and_then(|naive| {
            Local
                .from_local_datetime(&naive)
                .single()
                .map(|dt| dt.timestamp_millis())
        })
}

fn parse_datetime_or_timestamp_to_millis(value: &str) -> Option<i64> {
    if let Ok(v) = value.parse::<i64>() {
        if v > 1_000_000_000_000 {
            return Some(v);
        }
        return Some(v * 1000);
    }

    parse_datetime_to_timestamp(value)
}

fn summarize_lines(lines: &[String]) -> String {
    let summary = lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| {
            !line.is_empty() && !line.starts_with("**优先级**") && *line != "---" && *line != "----"
        })
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");

    if summary.is_empty() {
        "暂无摘要".to_string()
    } else {
        truncate_text(&summary, 140)
    }
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

fn load_memory_candidates(
    conn: &Connection,
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

pub(crate) fn analyze_memory_candidates(
    memory_service: &ContextMemoryService,
    memory_config: &MemoryConfig,
    candidates: &[MemorySourceCandidate],
) -> Result<MemoryAnalysisResult, String> {
    if !memory_config.enabled || candidates.is_empty() {
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
    let mut analyzed_sessions: HashSet<String> = HashSet::new();
    let mut generated_entries = 0u32;
    let mut deduplicated_entries = 0u32;
    let mut generated_count_per_session: HashMap<String, usize> = HashMap::new();

    for candidate in candidates.iter().take(MAX_SOURCE_MESSAGES) {
        analyzed_sessions.insert(candidate.session_id.clone());

        let counter = generated_count_per_session
            .entry(candidate.session_id.clone())
            .or_insert(0);
        if *counter >= MAX_GENERATED_PER_SESSION {
            continue;
        }

        let fingerprint = build_fingerprint(&candidate.content);
        let (title, summary, file_type, category_tag) = build_memory_entry_fields(candidate);
        let existing =
            memory_service.get_session_memories(&candidate.session_id, Some(file_type))?;

        if is_duplicate_memory(&existing, &fingerprint, &summary) {
            deduplicated_entries += 1;
            continue;
        }

        let entry = MemoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: candidate.session_id.clone(),
            file_type,
            title,
            content: summary,
            tags: vec![
                "auto_analysis".to_string(),
                category_tag.to_string(),
                fingerprint,
            ],
            priority: infer_priority(candidate),
            created_at: candidate.created_at,
            updated_at: candidate.created_at,
            archived: false,
        };

        memory_service.save_memory_entry(&entry)?;
        generated_entries += 1;
        *counter += 1;

        if generated_entries as usize >= max_generated_per_request {
            break;
        }
    }

    Ok(MemoryAnalysisResult {
        analyzed_sessions: analyzed_sessions.len() as u32,
        analyzed_messages: candidates.len() as u32,
        generated_entries,
        deduplicated_entries,
    })
}

fn build_fingerprint(content: &str) -> String {
    let normalized = content.to_lowercase();
    let compact = normalized
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .take(120)
        .collect::<String>();
    format!("fp:{compact}")
}

fn is_duplicate_memory(existing_entries: &[MemoryEntry], fingerprint: &str, summary: &str) -> bool {
    let summary_prefix = truncate_text(summary, 80);
    existing_entries.iter().any(|entry| {
        entry.tags.iter().any(|tag| tag == fingerprint)
            || entry.content.contains(fingerprint)
            || entry.content.contains(&summary_prefix)
    })
}

fn build_memory_entry_fields(
    candidate: &MemorySourceCandidate,
) -> (String, String, MemoryFileType, &'static str) {
    let content = candidate.content.trim();
    let lowered = content.to_lowercase();

    let (file_type, category) = if contains_any(
        &lowered,
        &["喜欢", "偏好", "prefer", "不喜欢", "习惯", "常用"],
    ) {
        (MemoryFileType::Findings, "preference")
    } else if contains_any(
        &lowered,
        &["我是", "我叫", "身份", "职业", "my name", "i am"],
    ) {
        (MemoryFileType::Findings, "identity")
    } else if contains_any(&lowered, &["计划", "待办", "todo", "接下来", "将要"]) {
        (MemoryFileType::TaskPlan, "activity")
    } else if contains_any(
        &lowered,
        &["错误", "失败", "异常", "报错", "error", "failed"],
    ) {
        (MemoryFileType::Findings, "context")
    } else if candidate.role == "assistant" {
        (MemoryFileType::Progress, "experience")
    } else {
        (MemoryFileType::Findings, "context")
    };

    let title = format!(
        "{}记忆 · {}",
        map_category_display_name(category),
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

    (title, summary, file_type, category)
}

fn infer_priority(candidate: &MemorySourceCandidate) -> u8 {
    let mut priority = if candidate.role == "user" { 4 } else { 3 };
    if contains_any(
        &candidate.content.to_lowercase(),
        &["必须", "重要", "关键", "urgent", "critical"],
    ) {
        priority = 5;
    }
    priority
}

fn map_category_display_name(category: &str) -> &'static str {
    match category {
        "identity" => "身份",
        "context" => "情境",
        "preference" => "偏好",
        "experience" => "经验",
        "activity" => "活动",
        _ => "记忆",
    }
}

fn format_timestamp(timestamp_ms: i64) -> String {
    if timestamp_ms <= 0 {
        return "未知时间".to_string();
    }

    let normalized = if timestamp_ms > 1_000_000_000_000 {
        timestamp_ms
    } else {
        timestamp_ms * 1000
    };

    chrono::DateTime::from_timestamp_millis(normalized)
        .map(|dt| dt.format("%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "未知时间".to_string())
}
