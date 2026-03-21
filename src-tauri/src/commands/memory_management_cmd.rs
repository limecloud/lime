//! 记忆管理命令
//!
//! 提供记忆相关的统计、治理与自动记忆配置能力。
//!
//! 其中：
//! - `memory_runtime_*` 属于当前 runtime / 上下文记忆主入口
//! - `memory_get_*` / `memory_toggle_auto` / `memory_update_auto_note`
//!   属于当前仍在演进的记忆治理配置入口

use crate::commands::context_memory::ContextMemoryServiceState;
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
use chrono::{Local, NaiveDateTime, TimeZone};
use lime_core::app_paths;
use lime_services::context_memory_service::{MemoryEntry, MemoryFileType};
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

    let max_generated_per_request = memory_config
        .max_entries
        .unwrap_or(MAX_GENERATED_PER_REQUEST as u32)
        .clamp(1, MAX_GENERATED_PER_REQUEST_CAP as u32)
        as usize;

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let candidates = load_memory_candidates(&conn, from_timestamp, to_timestamp)?;

    if candidates.is_empty() {
        return Ok(MemoryAnalysisResult {
            analyzed_sessions: 0,
            analyzed_messages: 0,
            generated_entries: 0,
            deduplicated_entries: 0,
        });
    }

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
        let existing = memory_service
            .0
            .get_session_memories(&candidate.session_id, Some(file_type))?;

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

        memory_service.0.save_memory_entry(&entry)?;
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
