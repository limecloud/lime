//! 日志命令
//!
//! 包含日志查询和清理命令。

use crate::app::types::LogState;
use crate::logger;
use chrono::Utc;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

/// 前端异常上报参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendCrashReport {
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_step: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

/// 前端调试日志上报参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendDebugLogReport {
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogArtifactEntry {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    pub compressed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogStorageDiagnostics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_log_path: Option<String>,
    pub current_log_exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_log_size_bytes: Option<u64>,
    pub in_memory_log_count: usize,
    pub related_log_files: Vec<LogArtifactEntry>,
    pub raw_response_files: Vec<LogArtifactEntry>,
}

/// 获取日志
#[tauri::command]
pub async fn get_logs(logs: tauri::State<'_, LogState>) -> Result<Vec<logger::LogEntry>, String> {
    Ok(logs.read().await.get_logs())
}

/// 清除日志
#[tauri::command]
pub async fn clear_logs(logs: tauri::State<'_, LogState>) -> Result<(), String> {
    let log_file_path = {
        let mut logs = logs.write().await;
        let log_file_path = logs.get_log_file_path();
        logs.clear();
        log_file_path
    };
    clear_persisted_log_artifacts_from_path(log_file_path)?;
    Ok(())
}

/// 清除诊断相关历史日志与原始响应文件
#[tauri::command]
pub async fn clear_diagnostic_log_history(logs: tauri::State<'_, LogState>) -> Result<(), String> {
    let log_file_path = {
        let mut logs = logs.write().await;
        let log_file_path = logs.get_log_file_path();
        logs.clear();
        log_file_path
    };
    clear_persisted_log_artifacts_from_path(log_file_path)?;
    Ok(())
}

fn parse_persisted_log_line(line: &str) -> Option<logger::LogEntry> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some((timestamp, rest)) = trimmed.split_once(" [") {
        if let Some((level, message)) = rest.split_once("] ") {
            return Some(logger::LogEntry {
                timestamp: timestamp.trim().to_string(),
                level: level.trim().to_lowercase(),
                message: message.trim().to_string(),
            });
        }
    }

    Some(logger::LogEntry {
        timestamp: Utc::now().to_rfc3339(),
        level: "info".to_string(),
        message: trimmed.to_string(),
    })
}

fn to_rfc3339(system_time: std::time::SystemTime) -> String {
    chrono::DateTime::<Utc>::from(system_time).to_rfc3339()
}

fn parse_rotated_log_timestamp(current_log_path: &Path, candidate: &Path) -> Option<i64> {
    let current_name = current_log_path.file_name()?.to_str()?;
    let candidate_name = candidate.file_name()?.to_str()?;

    if candidate_name == current_name {
        return Some(i64::MAX);
    }

    let prefix = format!("{current_name}.");
    let suffix = candidate_name.strip_prefix(&prefix)?;
    let suffix = suffix.strip_suffix(".gz").unwrap_or(suffix);
    let parsed = chrono::NaiveDateTime::parse_from_str(suffix, "%Y%m%d-%H%M%S").ok()?;
    parsed.and_utc().timestamp_nanos_opt()
}

fn path_sort_key(current_log_path: &Path, path: &Path) -> (i64, String) {
    let logical_ts = parse_rotated_log_timestamp(current_log_path, path).unwrap_or_else(|| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| chrono::DateTime::<Utc>::from(modified).timestamp_nanos_opt())
            .unwrap_or_else(|| {
                chrono::DateTime::<Utc>::from(UNIX_EPOCH)
                    .timestamp_nanos_opt()
                    .unwrap_or(0)
            })
    });

    (logical_ts, path.to_string_lossy().to_string())
}

fn build_log_artifact_entry(path: &Path) -> Option<LogArtifactEntry> {
    let metadata = fs::metadata(path).ok()?;
    let modified_at = metadata.modified().ok().map(to_rfc3339);
    let file_name = path.file_name()?.to_string_lossy().to_string();

    Some(LogArtifactEntry {
        file_name,
        path: path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        modified_at,
        compressed: path.extension().and_then(|ext| ext.to_str()) == Some("gz"),
    })
}

fn collect_related_log_paths(current_log_path: &Path) -> Vec<PathBuf> {
    let Some(log_dir) = current_log_path.parent() else {
        return Vec::new();
    };
    let Some(file_name) = current_log_path.file_name().and_then(|name| name.to_str()) else {
        return Vec::new();
    };
    let prefix = format!("{file_name}.");

    let mut candidates = Vec::new();

    if current_log_path.exists() {
        candidates.push(current_log_path.to_path_buf());
    }

    let Ok(entries) = fs::read_dir(log_dir) else {
        return candidates;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name == file_name || name.starts_with(&prefix) {
            if !candidates.iter().any(|candidate| candidate == &path) {
                candidates.push(path);
            }
        }
    }

    candidates.sort_by_key(|path| path_sort_key(current_log_path, path));
    candidates
}

fn collect_raw_response_paths(current_log_path: &Path) -> Vec<PathBuf> {
    let Some(log_dir) = current_log_path.parent() else {
        return Vec::new();
    };

    let Ok(entries) = fs::read_dir(log_dir) else {
        return Vec::new();
    };

    let mut candidates: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.starts_with("raw_response_") && name.ends_with(".txt"))
        })
        .collect();

    candidates.sort_by_key(|path| path_sort_key(current_log_path, path));
    candidates.reverse();
    candidates
}

pub fn clear_diagnostic_log_artifacts_from_path(
    current_log_path: Option<String>,
) -> Result<(), String> {
    let Some(current_log_path) = current_log_path else {
        return Ok(());
    };

    let current_log_path = PathBuf::from(current_log_path);

    for path in collect_related_log_paths(&current_log_path) {
        if path == current_log_path || !path.exists() {
            continue;
        }
        fs::remove_file(&path).map_err(|error| {
            format!(
                "删除历史日志文件失败（{}）: {}",
                path.to_string_lossy(),
                error
            )
        })?;
    }

    for path in collect_raw_response_paths(&current_log_path) {
        if !path.exists() {
            continue;
        }
        fs::remove_file(&path).map_err(|error| {
            format!(
                "删除原始响应文件失败（{}）: {}",
                path.to_string_lossy(),
                error
            )
        })?;
    }

    Ok(())
}

pub fn truncate_current_log_file_from_path(current_log_path: Option<String>) -> Result<(), String> {
    let Some(current_log_path) = current_log_path else {
        return Ok(());
    };

    let current_log_path = PathBuf::from(current_log_path);

    if let Some(parent) = current_log_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "创建日志目录失败（{}）: {}",
                parent.to_string_lossy(),
                error
            )
        })?;
    }

    fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&current_log_path)
        .and_then(|mut file| file.write_all(b""))
        .map_err(|error| {
            format!(
                "清空当前日志文件失败（{}）: {}",
                current_log_path.to_string_lossy(),
                error
            )
        })?;

    Ok(())
}

pub fn clear_persisted_log_artifacts_from_path(
    current_log_path: Option<String>,
) -> Result<(), String> {
    truncate_current_log_file_from_path(current_log_path.clone())?;
    clear_diagnostic_log_artifacts_from_path(current_log_path)?;
    Ok(())
}

fn read_log_file_content(path: &Path) -> Option<String> {
    if path.extension().and_then(|ext| ext.to_str()) == Some("gz") {
        let file = fs::File::open(path).ok()?;
        let mut decoder = GzDecoder::new(file);
        let mut content = String::new();
        decoder.read_to_string(&mut content).ok()?;
        return Some(content);
    }

    fs::read_to_string(path).ok()
}

pub fn get_log_storage_diagnostics_from_path(
    log_file_path: Option<String>,
    in_memory_log_count: usize,
) -> LogStorageDiagnostics {
    let current_log_path = log_file_path.map(PathBuf::from);
    let current_log_exists = current_log_path.as_ref().is_some_and(|path| path.exists());
    let current_log_size_bytes = current_log_path
        .as_ref()
        .and_then(|path| fs::metadata(path).ok())
        .map(|metadata| metadata.len());
    let log_directory = current_log_path
        .as_ref()
        .and_then(|path| path.parent())
        .map(|path| path.to_string_lossy().to_string());
    let related_log_files = current_log_path
        .as_ref()
        .map(|path| collect_related_log_paths(path))
        .unwrap_or_default()
        .into_iter()
        .rev()
        .take(12)
        .filter_map(|path| build_log_artifact_entry(&path))
        .collect();
    let raw_response_files = current_log_path
        .as_ref()
        .map(|path| collect_raw_response_paths(path))
        .unwrap_or_default()
        .into_iter()
        .take(12)
        .filter_map(|path| build_log_artifact_entry(&path))
        .collect();

    LogStorageDiagnostics {
        log_directory,
        current_log_path: current_log_path.map(|path| path.to_string_lossy().to_string()),
        current_log_exists,
        current_log_size_bytes,
        in_memory_log_count,
        related_log_files,
        raw_response_files,
    }
}

pub fn read_persisted_logs_tail_from_path(
    log_file_path: Option<String>,
    lines: usize,
) -> Result<Vec<logger::LogEntry>, String> {
    let safe_limit = lines.clamp(1, 1000);

    let Some(path) = log_file_path else {
        return Ok(Vec::new());
    };

    let related_paths = collect_related_log_paths(Path::new(&path));
    if related_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut parsed: Vec<logger::LogEntry> = Vec::new();

    for log_path in related_paths.into_iter().rev() {
        let remaining = safe_limit.saturating_sub(parsed.len());
        if remaining == 0 {
            break;
        }

        let Some(content) = read_log_file_content(&log_path) else {
            continue;
        };

        parsed.extend(
            content
                .lines()
                .rev()
                .take(remaining)
                .filter_map(parse_persisted_log_line),
        );
    }

    parsed.reverse();
    Ok(parsed)
}

/// 获取持久化日志文件尾部（用于崩溃后恢复诊断）
#[tauri::command]
pub async fn get_persisted_logs_tail(
    logs: tauri::State<'_, LogState>,
    lines: Option<usize>,
) -> Result<Vec<logger::LogEntry>, String> {
    let safe_limit = lines.unwrap_or(200).clamp(20, 1000);
    let log_file_path = logs.read().await.get_log_file_path();

    read_persisted_logs_tail_from_path(log_file_path, safe_limit)
}

#[tauri::command]
pub async fn get_log_storage_diagnostics(
    logs: tauri::State<'_, LogState>,
) -> Result<LogStorageDiagnostics, String> {
    let logs = logs.read().await;
    Ok(get_log_storage_diagnostics_from_path(
        logs.get_log_file_path(),
        logs.get_logs().len(),
    ))
}

/// 写入前端异常到本地日志并同步到崩溃上报后端
#[tauri::command]
pub async fn report_frontend_crash(
    logs: tauri::State<'_, LogState>,
    report: FrontendCrashReport,
) -> Result<(), String> {
    let sanitized_message = logger::sanitize_log_message(&report.message);
    let sanitized_component = report
        .component
        .as_deref()
        .map(logger::sanitize_log_message)
        .unwrap_or_else(|| "unknown".to_string());
    let sanitized_step = report
        .workflow_step
        .as_deref()
        .map(logger::sanitize_log_message)
        .unwrap_or_else(|| "unknown".to_string());
    let sanitized_mode = report
        .creation_mode
        .as_deref()
        .map(logger::sanitize_log_message)
        .unwrap_or_else(|| "unknown".to_string());

    let stack_preview = report
        .stack
        .as_deref()
        .map(logger::sanitize_log_message)
        .map(|stack| stack.lines().take(3).collect::<Vec<_>>().join(" | "))
        .unwrap_or_default();

    logs.write().await.add(
        "error",
        &format!(
            "[FrontendCrash] component={sanitized_component} step={sanitized_step} mode={sanitized_mode} message={sanitized_message} stack={stack_preview}"
        ),
    );

    let mut merged_context = match report.context {
        Some(Value::Object(context)) => context,
        Some(other) => {
            let mut context = Map::new();
            context.insert("raw_context".to_string(), other);
            context
        }
        None => Map::new(),
    };

    if let Some(name) = report.name.as_deref() {
        merged_context.insert(
            "error_name".to_string(),
            Value::String(logger::sanitize_log_message(name)),
        );
    }
    if let Some(stack) = report.stack.as_deref() {
        merged_context.insert(
            "error_stack".to_string(),
            Value::String(logger::sanitize_log_message(stack)),
        );
    }

    crate::crash_reporting::capture_frontend_report(
        &sanitized_message,
        report.component.as_deref(),
        report.workflow_step.as_deref(),
        report.creation_mode.as_deref(),
        Some(Value::Object(merged_context)),
    );

    Ok(())
}

fn summarize_frontend_debug_context(context: Option<&Value>) -> String {
    let Some(context) = context else {
        return String::new();
    };

    let serialized =
        serde_json::to_string(context).unwrap_or_else(|_| "\"<invalid-context>\"".into());
    let sanitized = logger::sanitize_log_message(&serialized);
    const MAX_LEN: usize = 1200;

    if sanitized.len() > MAX_LEN {
        format!("{}...", &sanitized[..MAX_LEN])
    } else {
        sanitized
    }
}

fn normalize_frontend_debug_level(level: Option<&str>) -> &'static str {
    match level.unwrap_or("info").trim().to_ascii_lowercase().as_str() {
        "debug" => "debug",
        "warn" | "warning" => "warn",
        "error" => "error",
        _ => "info",
    }
}

/// 写入前端调试日志到本地日志，便于排查卡顿或未崩溃问题
#[tauri::command]
pub async fn report_frontend_debug_log(
    logs: tauri::State<'_, LogState>,
    report: FrontendDebugLogReport,
) -> Result<(), String> {
    let sanitized_message = logger::sanitize_log_message(&report.message);
    let sanitized_category = report
        .category
        .as_deref()
        .map(logger::sanitize_log_message)
        .unwrap_or_else(|| "general".to_string());
    let context_preview = summarize_frontend_debug_context(report.context.as_ref());
    let level = normalize_frontend_debug_level(report.level.as_deref());
    let message = if context_preview.is_empty() {
        format!("[FrontendDebug] category={sanitized_category} message={sanitized_message}")
    } else {
        format!(
            "[FrontendDebug] category={sanitized_category} message={sanitized_message} context={context_preview}"
        )
    };

    logs.write().await.add(level, &message);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportBundleExportResult {
    pub bundle_path: String,
    pub output_directory: String,
    pub generated_at: String,
    pub platform: String,
    pub included_sections: Vec<String>,
    pub omitted_sections: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SupportBundlePathMetadata {
    path: String,
    exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_write_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
struct SupportBundleTreeEntry {
    relative_path: String,
    is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SupportBundleManifest {
    generated_at: String,
    app_version: String,
    platform: String,
    arch: String,
    username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    app_data_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    config_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legacy_lime_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    database_path: Option<String>,
    path_checks: Vec<SupportBundlePathMetadata>,
    log_storage_diagnostics: LogStorageDiagnostics,
    persisted_log_tail_lines: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    windows_startup_diagnostics:
        Option<crate::commands::windows_startup_cmd::WindowsStartupDiagnostics>,
    included_sections: Vec<String>,
    omitted_sections: Vec<String>,
}

#[derive(Debug, Clone)]
struct SupportBundleContext {
    generated_at: String,
    app_data_dir: Option<PathBuf>,
    config_path: Option<PathBuf>,
    legacy_lime_dir: Option<PathBuf>,
    database_path: Option<PathBuf>,
    log_storage_diagnostics: LogStorageDiagnostics,
    persisted_log_tail: Vec<logger::LogEntry>,
    windows_startup_diagnostics:
        Option<crate::commands::windows_startup_cmd::WindowsStartupDiagnostics>,
}

#[tauri::command]
pub async fn export_support_bundle(
    logs: tauri::State<'_, LogState>,
    app: AppHandle,
) -> Result<SupportBundleExportResult, String> {
    let (log_file_path, in_memory_log_count) = {
        let logs = logs.read().await;
        (logs.get_log_file_path(), logs.get_logs().len())
    };

    let log_storage_diagnostics =
        get_log_storage_diagnostics_from_path(log_file_path.clone(), in_memory_log_count);
    let persisted_log_tail = read_persisted_logs_tail_from_path(log_file_path, 200)?;

    let app_data_dir = lime_core::app_paths::preferred_data_dir()
        .ok()
        .or_else(guess_lime_app_data_dir);
    let config_path = guess_lime_config_path();
    let legacy_lime_dir = dirs::home_dir().map(|home| home.join(".lime"));
    let database_path = crate::database::get_db_path()
        .ok()
        .or_else(|| legacy_lime_dir.as_ref().map(|dir| dir.join("lime.db")));
    let output_directory = default_support_bundle_output_dir();

    let result = export_support_bundle_to(
        &output_directory,
        SupportBundleContext {
            generated_at: Utc::now().to_rfc3339(),
            app_data_dir,
            config_path,
            legacy_lime_dir,
            database_path,
            log_storage_diagnostics,
            persisted_log_tail,
            windows_startup_diagnostics: Some(
                crate::commands::windows_startup_cmd::collect_windows_startup_diagnostics(&app),
            ),
        },
    )?;

    logs.write().await.add(
        "info",
        &format!(
            "[SupportBundle] 已导出支持包: {}",
            logger::sanitize_log_message(&result.bundle_path)
        ),
    );

    Ok(result)
}

fn guess_lime_app_data_dir() -> Option<PathBuf> {
    lime_core::app_paths::preferred_data_dir().ok()
}

fn guess_lime_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("lime").join("config.yaml"))
}

fn default_support_bundle_output_dir() -> PathBuf {
    dirs::desktop_dir()
        .or_else(dirs::download_dir)
        .unwrap_or_else(std::env::temp_dir)
}

fn collect_support_path_metadata(path: Option<&Path>) -> SupportBundlePathMetadata {
    let Some(path) = path else {
        return SupportBundlePathMetadata {
            path: String::new(),
            exists: false,
            kind: None,
            last_write_time: None,
            size_bytes: None,
        };
    };

    let path_string = path.to_string_lossy().to_string();
    let Ok(metadata) = fs::metadata(path) else {
        return SupportBundlePathMetadata {
            path: path_string,
            exists: false,
            kind: None,
            last_write_time: None,
            size_bytes: None,
        };
    };

    let kind = if metadata.is_dir() {
        Some("directory".to_string())
    } else if metadata.is_file() {
        Some("file".to_string())
    } else {
        Some("other".to_string())
    };

    let size_bytes = if metadata.is_dir() {
        None
    } else {
        Some(metadata.len())
    };

    SupportBundlePathMetadata {
        path: path_string,
        exists: true,
        kind,
        last_write_time: metadata.modified().ok().map(to_rfc3339),
        size_bytes,
    }
}

fn should_exclude_support_listing(relative_path: &Path) -> bool {
    relative_path
        .components()
        .next()
        .and_then(|component| component.as_os_str().to_str())
        .is_some_and(|name| matches!(name, "credentials" | "auth"))
}

fn collect_directory_tree_entries(root: &Path) -> Vec<SupportBundleTreeEntry> {
    fn walk(base: &Path, current: &Path, entries: &mut Vec<SupportBundleTreeEntry>) {
        let Ok(children) = fs::read_dir(current) else {
            return;
        };

        for child in children.flatten() {
            let path = child.path();
            let Ok(relative_path) = path.strip_prefix(base) else {
                continue;
            };
            if should_exclude_support_listing(relative_path) {
                continue;
            }

            let Ok(metadata) = child.metadata() else {
                continue;
            };
            let is_directory = metadata.is_dir();
            entries.push(SupportBundleTreeEntry {
                relative_path: relative_path.to_string_lossy().to_string(),
                is_directory,
                size_bytes: if is_directory {
                    None
                } else {
                    Some(metadata.len())
                },
                modified_at: metadata.modified().ok().map(to_rfc3339),
            });

            if is_directory {
                walk(base, &path, entries);
            }
        }
    }

    if !root.exists() {
        return Vec::new();
    }

    let mut entries = Vec::new();
    walk(root, root, &mut entries);
    entries
}

fn write_support_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("序列化支持包 JSON 失败 {}: {error}", path.display()))?;
    fs::write(path, content)
        .map_err(|error| format!("写入支持包文件失败 {}: {error}", path.display()))
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    fs::create_dir_all(destination)
        .map_err(|error| format!("创建支持包目录失败 {}: {error}", destination.display()))?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("读取目录失败 {}: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("读取目录项失败 {}: {error}", source.display()))?;
        let path = entry.path();
        let target = destination.join(entry.file_name());

        if entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败 {}: {error}", path.display()))?
            .is_dir()
        {
            copy_directory_recursive(&path, &target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("创建支持包父目录失败 {}: {error}", parent.display())
                })?;
            }
            fs::copy(&path, &target).map_err(|error| {
                format!(
                    "复制支持包文件失败 {} -> {}: {error}",
                    path.display(),
                    target.display()
                )
            })?;
        }
    }

    Ok(())
}

fn write_support_bundle_readme(path: &Path, omitted_sections: &[String]) -> Result<(), String> {
    let omitted = omitted_sections
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");

    let content = format!(
        "Lime 支持包\n\n已包含：\n- meta/manifest.json\n- meta/log-storage-diagnostics.json\n- meta/persisted-log-tail.json\n- meta/appdata-listing.json（如目录存在）\n- meta/legacy-listing.json（如目录存在）\n- logs/（如目录存在）\n- request_logs/（如目录存在）\n\n默认未包含：\n{omitted}\n"
    );

    fs::write(path, content)
        .map_err(|error| format!("写入支持包 README 失败 {}: {error}", path.display()))
}

fn normalize_archive_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn add_directory_to_zip<W: Write + Seek>(
    writer: &mut ZipWriter<W>,
    root: &Path,
    current: &Path,
) -> Result<(), String> {
    let file_options = FileOptions::default().compression_method(CompressionMethod::Deflated);
    let dir_options = FileOptions::default().compression_method(CompressionMethod::Stored);

    for entry in fs::read_dir(current)
        .map_err(|error| format!("读取支持包目录失败 {}: {error}", current.display()))?
    {
        let entry = entry
            .map_err(|error| format!("读取支持包目录项失败 {}: {error}", current.display()))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("计算支持包相对路径失败 {}: {error}", path.display()))?;
        let archive_path = normalize_archive_path(relative);

        if entry
            .file_type()
            .map_err(|error| format!("读取支持包文件类型失败 {}: {error}", path.display()))?
            .is_dir()
        {
            writer
                .add_directory(format!("{archive_path}/"), dir_options)
                .map_err(|error| format!("写入 zip 目录失败 {archive_path}: {error}"))?;
            add_directory_to_zip(writer, root, &path)?;
            continue;
        }

        writer
            .start_file(archive_path.clone(), file_options)
            .map_err(|error| format!("写入 zip 文件失败 {archive_path}: {error}"))?;
        let mut file = fs::File::open(&path)
            .map_err(|error| format!("打开支持包文件失败 {}: {error}", path.display()))?;
        std::io::copy(&mut file, writer)
            .map_err(|error| format!("压缩支持包文件失败 {}: {error}", path.display()))?;
    }

    Ok(())
}

fn create_zip_from_directory(source_dir: &Path, zip_path: &Path) -> Result<(), String> {
    let file = fs::File::create(zip_path)
        .map_err(|error| format!("创建支持包 zip 失败 {}: {error}", zip_path.display()))?;
    let mut writer = ZipWriter::new(file);
    add_directory_to_zip(&mut writer, source_dir, source_dir)?;
    writer
        .finish()
        .map_err(|error| format!("完成支持包压缩失败 {}: {error}", zip_path.display()))?;
    Ok(())
}

fn export_support_bundle_to(
    output_directory: &Path,
    context: SupportBundleContext,
) -> Result<SupportBundleExportResult, String> {
    fs::create_dir_all(output_directory).map_err(|error| {
        format!(
            "创建支持包输出目录失败 {}: {error}",
            output_directory.display()
        )
    })?;

    let timestamp = chrono::DateTime::parse_from_rfc3339(&context.generated_at)
        .map(|value| value.format("%Y%m%d-%H%M%S").to_string())
        .unwrap_or_else(|_| Utc::now().format("%Y%m%d-%H%M%S").to_string());
    let bundle_name = format!("Lime-Support-{timestamp}");
    let temp_dir = tempfile::tempdir().map_err(|error| format!("创建临时目录失败: {error}"))?;
    let bundle_dir = temp_dir.path().join(&bundle_name);
    let meta_dir = bundle_dir.join("meta");
    let logs_dir = bundle_dir.join("logs");
    let request_logs_dir = bundle_dir.join("request_logs");
    fs::create_dir_all(&meta_dir)
        .map_err(|error| format!("创建支持包元数据目录失败 {}: {error}", meta_dir.display()))?;

    let legacy_request_logs_dir = context
        .legacy_lime_dir
        .as_ref()
        .map(|dir| dir.join("request_logs"));
    let effective_logs_dir = context
        .log_storage_diagnostics
        .log_directory
        .as_ref()
        .map(PathBuf::from)
        .or_else(|| context.legacy_lime_dir.as_ref().map(|dir| dir.join("logs")));

    if let Some(log_dir) = effective_logs_dir.as_deref() {
        if log_dir.exists() {
            copy_directory_recursive(log_dir, &logs_dir)?;
        }
    }

    if let Some(request_dir) = legacy_request_logs_dir.as_deref() {
        if request_dir.exists() {
            copy_directory_recursive(request_dir, &request_logs_dir)?;
        }
    }

    let included_sections = vec![
        "meta/manifest.json".to_string(),
        "meta/log-storage-diagnostics.json".to_string(),
        "meta/persisted-log-tail.json".to_string(),
        "logs/".to_string(),
        "request_logs/".to_string(),
    ];
    let omitted_sections = vec![
        "config 内容".to_string(),
        "数据库内容".to_string(),
        "credentials 目录正文".to_string(),
        "auth 目录正文".to_string(),
    ];

    let manifest = SupportBundleManifest {
        generated_at: context.generated_at.clone(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        username: whoami::username(),
        app_data_dir: context
            .app_data_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        config_path: context
            .config_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        legacy_lime_dir: context
            .legacy_lime_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        database_path: context
            .database_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        path_checks: vec![
            collect_support_path_metadata(context.app_data_dir.as_deref()),
            collect_support_path_metadata(context.config_path.as_deref()),
            collect_support_path_metadata(context.legacy_lime_dir.as_deref()),
            collect_support_path_metadata(context.database_path.as_deref()),
            collect_support_path_metadata(effective_logs_dir.as_deref()),
            collect_support_path_metadata(legacy_request_logs_dir.as_deref()),
        ],
        log_storage_diagnostics: context.log_storage_diagnostics.clone(),
        persisted_log_tail_lines: context.persisted_log_tail.len(),
        windows_startup_diagnostics: context.windows_startup_diagnostics.clone(),
        included_sections: included_sections.clone(),
        omitted_sections: omitted_sections.clone(),
    };

    write_support_json(&meta_dir.join("manifest.json"), &manifest)?;
    write_support_json(
        &meta_dir.join("log-storage-diagnostics.json"),
        &context.log_storage_diagnostics,
    )?;
    write_support_json(
        &meta_dir.join("persisted-log-tail.json"),
        &context.persisted_log_tail,
    )?;

    if let Some(app_data_dir) = context.app_data_dir.as_deref() {
        let entries = collect_directory_tree_entries(app_data_dir);
        write_support_json(&meta_dir.join("appdata-listing.json"), &entries)?;
    }
    if let Some(legacy_dir) = context.legacy_lime_dir.as_deref() {
        let entries = collect_directory_tree_entries(legacy_dir);
        write_support_json(&meta_dir.join("legacy-listing.json"), &entries)?;
    }

    write_support_bundle_readme(&bundle_dir.join("README.txt"), &omitted_sections)?;

    let bundle_path = output_directory.join(format!("{bundle_name}.zip"));
    create_zip_from_directory(&bundle_dir, &bundle_path)?;

    Ok(SupportBundleExportResult {
        bundle_path: bundle_path.to_string_lossy().to_string(),
        output_directory: output_directory.to_string_lossy().to_string(),
        generated_at: context.generated_at,
        platform: std::env::consts::OS.to_string(),
        included_sections,
        omitted_sections,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        clear_diagnostic_log_artifacts_from_path, clear_persisted_log_artifacts_from_path,
        export_support_bundle_to, get_log_storage_diagnostics_from_path,
        read_persisted_logs_tail_from_path, SupportBundleContext,
    };
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs;
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static LOG_FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_log_path() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间异常")
            .as_nanos();
        let counter = LOG_FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let log_dir = std::env::temp_dir().join(format!("lime-log-tail-test-{nanos}-{counter}"));
        fs::create_dir_all(&log_dir).expect("创建测试日志目录失败");
        log_dir.join("lime.log")
    }

    fn cleanup_log_fixture(path: &Path) {
        if let Some(log_dir) = path.parent() {
            let _ = fs::remove_dir_all(log_dir);
        }
    }

    #[test]
    fn read_persisted_logs_tail_from_path_should_parse_latest_lines() {
        let path = unique_log_path();
        fs::write(
            &path,
            concat!(
                "2026-03-09 09:00:00.000 [INFO] first line\n",
                "2026-03-09 09:00:01.000 [WARN] second line\n",
                "2026-03-09 09:00:02.000 [ERROR] third line\n"
            ),
        )
        .expect("写入测试日志失败");

        let entries =
            read_persisted_logs_tail_from_path(Some(path.to_string_lossy().to_string()), 2)
                .expect("读取持久化日志失败");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].level, "warn");
        assert_eq!(entries[0].message, "second line");
        assert_eq!(entries[1].level, "error");
        assert_eq!(entries[1].message, "third line");

        cleanup_log_fixture(&path);
    }

    #[test]
    fn read_persisted_logs_tail_from_path_should_merge_rotated_and_gzip_logs() {
        let current = unique_log_path();
        let rotated = current.with_file_name(format!(
            "{}.20260309-085900",
            current
                .file_name()
                .and_then(|name| name.to_str())
                .expect("文件名缺失")
        ));
        let gz_path = current.with_file_name(format!(
            "{}.20260309-085800.gz",
            current
                .file_name()
                .and_then(|name| name.to_str())
                .expect("文件名缺失")
        ));

        fs::write(&current, "2026-03-09 09:00:02.000 [ERROR] current line\n")
            .expect("写入当前日志失败");
        fs::write(&rotated, "2026-03-09 09:00:01.000 [WARN] rotated line\n")
            .expect("写入轮转日志失败");

        let gz_file = fs::File::create(&gz_path).expect("创建 gzip 日志失败");
        let mut encoder = GzEncoder::new(gz_file, Compression::default());
        encoder
            .write_all(b"2026-03-09 09:00:00.000 [INFO] gz line\n")
            .expect("写入 gzip 内容失败");
        encoder.finish().expect("完成 gzip 写入失败");

        let entries =
            read_persisted_logs_tail_from_path(Some(current.to_string_lossy().to_string()), 3)
                .expect("读取跨文件日志失败");

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].message, "gz line");
        assert_eq!(entries[1].message, "rotated line");
        assert_eq!(entries[2].message, "current line");

        cleanup_log_fixture(&current);
    }

    #[test]
    fn get_log_storage_diagnostics_should_list_related_and_raw_response_files() {
        let current = unique_log_path();
        let rotated = current.with_file_name(format!(
            "{}.20260309-085900",
            current
                .file_name()
                .and_then(|name| name.to_str())
                .expect("文件名缺失")
        ));
        let raw = current.with_file_name("raw_response_demo.txt");

        fs::write(&current, "current\n").expect("写入当前日志失败");
        fs::write(&rotated, "rotated\n").expect("写入轮转日志失败");
        fs::write(&raw, "raw body\n").expect("写入原始响应文件失败");

        let diagnostics =
            get_log_storage_diagnostics_from_path(Some(current.to_string_lossy().to_string()), 7);

        assert!(diagnostics.current_log_exists);
        assert_eq!(diagnostics.in_memory_log_count, 7);
        assert!(diagnostics.related_log_files.len() >= 2);
        assert_eq!(diagnostics.raw_response_files.len(), 1);
        assert_eq!(
            diagnostics.raw_response_files[0].file_name,
            "raw_response_demo.txt"
        );

        cleanup_log_fixture(&current);
    }

    #[test]
    fn clear_diagnostic_log_artifacts_from_path_should_remove_history_files() {
        let current = unique_log_path();
        let rotated = current.with_file_name(format!(
            "{}.20260309-085900",
            current
                .file_name()
                .and_then(|name| name.to_str())
                .expect("文件名缺失")
        ));
        let gz_path = current.with_file_name(format!(
            "{}.20260309-085800.gz",
            current
                .file_name()
                .and_then(|name| name.to_str())
                .expect("文件名缺失")
        ));
        let raw = current.with_file_name("raw_response_demo.txt");

        fs::write(&current, "current\n").expect("写入当前日志失败");
        fs::write(&rotated, "rotated\n").expect("写入轮转日志失败");
        fs::write(&raw, "raw body\n").expect("写入原始响应文件失败");

        let gz_file = fs::File::create(&gz_path).expect("创建 gzip 日志失败");
        let mut encoder = GzEncoder::new(gz_file, Compression::default());
        encoder
            .write_all(b"gzip body\n")
            .expect("写入 gzip 内容失败");
        encoder.finish().expect("完成 gzip 写入失败");

        clear_diagnostic_log_artifacts_from_path(Some(current.to_string_lossy().to_string()))
            .expect("清理诊断日志历史失败");

        assert!(current.exists());
        assert!(!rotated.exists());
        assert!(!gz_path.exists());
        assert!(!raw.exists());

        cleanup_log_fixture(&current);
    }

    #[test]
    fn clear_persisted_log_artifacts_from_path_should_truncate_current_and_remove_history() {
        let current = unique_log_path();
        let rotated = current.with_file_name(format!(
            "{}.20260309-085900",
            current
                .file_name()
                .and_then(|name| name.to_str())
                .expect("文件名缺失")
        ));
        let gz_path = current.with_file_name(format!(
            "{}.20260309-085800.gz",
            current
                .file_name()
                .and_then(|name| name.to_str())
                .expect("文件名缺失")
        ));
        let raw = current.with_file_name("raw_response_demo.txt");

        fs::write(&current, "current\n").expect("写入当前日志失败");
        fs::write(&rotated, "rotated\n").expect("写入轮转日志失败");
        fs::write(&raw, "raw body\n").expect("写入原始响应文件失败");

        let gz_file = fs::File::create(&gz_path).expect("创建 gzip 日志失败");
        let mut encoder = GzEncoder::new(gz_file, Compression::default());
        encoder
            .write_all(b"gzip body\n")
            .expect("写入 gzip 内容失败");
        encoder.finish().expect("完成 gzip 写入失败");

        clear_persisted_log_artifacts_from_path(Some(current.to_string_lossy().to_string()))
            .expect("清空持久化日志失败");

        assert!(current.exists());
        assert_eq!(fs::read_to_string(&current).expect("读取当前日志失败"), "");
        assert!(!rotated.exists());
        assert!(!gz_path.exists());
        assert!(!raw.exists());

        cleanup_log_fixture(&current);
    }

    #[test]
    fn export_support_bundle_to_should_create_zip_with_manifest_and_logs() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let output_dir = temp_dir.path().join("output");
        let app_data_dir = temp_dir.path().join("appdata").join("lime");
        let legacy_dir = temp_dir.path().join("home").join(".lime");
        let logs_dir = legacy_dir.join("logs");
        let request_logs_dir = legacy_dir.join("request_logs");
        let config_path = app_data_dir.join("config.yaml");
        let database_path = legacy_dir.join("lime.db");
        let current_log_path = logs_dir.join("lime.log");
        let raw_response_path = logs_dir.join("raw_response_demo.txt");
        let request_log_path = request_logs_dir.join("requests.log");

        fs::create_dir_all(&app_data_dir).expect("创建 appdata 目录失败");
        fs::create_dir_all(&logs_dir).expect("创建 logs 目录失败");
        fs::create_dir_all(&request_logs_dir).expect("创建 request_logs 目录失败");
        fs::write(&config_path, "api_key: hidden").expect("写入配置失败");
        fs::write(&database_path, b"sqlite").expect("写入数据库文件失败");
        fs::write(
            &current_log_path,
            concat!(
                "2026-03-09 09:00:00.000 [INFO] first line
",
                "2026-03-09 09:00:01.000 [ERROR] second line
"
            ),
        )
        .expect("写入日志失败");
        fs::write(&raw_response_path, "raw body").expect("写入 raw response 失败");
        fs::write(&request_log_path, "request body").expect("写入 request log 失败");

        let diagnostics = get_log_storage_diagnostics_from_path(
            Some(current_log_path.to_string_lossy().to_string()),
            2,
        );
        let tail = read_persisted_logs_tail_from_path(
            Some(current_log_path.to_string_lossy().to_string()),
            20,
        )
        .expect("读取日志尾部失败");

        let result = export_support_bundle_to(
            &output_dir,
            SupportBundleContext {
                generated_at: "2026-03-09T10:00:00Z".to_string(),
                app_data_dir: Some(app_data_dir),
                config_path: Some(config_path),
                legacy_lime_dir: Some(legacy_dir),
                database_path: Some(database_path),
                log_storage_diagnostics: diagnostics,
                persisted_log_tail: tail,
                windows_startup_diagnostics: None,
            },
        )
        .expect("导出支持包失败");

        assert!(Path::new(&result.bundle_path).exists());

        let file = fs::File::open(&result.bundle_path).expect("打开 zip 失败");
        let mut archive = zip::ZipArchive::new(file).expect("读取 zip 失败");
        let mut names = Vec::new();
        for index in 0..archive.len() {
            let entry = archive.by_index(index).expect("读取 zip 条目失败");
            names.push(entry.name().to_string());
        }

        assert!(names
            .iter()
            .any(|name| name.ends_with("meta/manifest.json")));
        assert!(names
            .iter()
            .any(|name| name.ends_with("meta/persisted-log-tail.json")));
        assert!(names.iter().any(|name| name.ends_with("logs/lime.log")));
        assert!(names
            .iter()
            .any(|name| name.ends_with("logs/raw_response_demo.txt")));
        assert!(names
            .iter()
            .any(|name| name.ends_with("request_logs/requests.log")));

        let manifest_name = names
            .iter()
            .find(|name| name.ends_with("meta/manifest.json"))
            .expect("manifest 条目缺失")
            .to_string();
        let mut manifest = archive
            .by_name(&manifest_name)
            .expect("打开 manifest 条目失败");
        let mut manifest_content = String::new();
        manifest
            .read_to_string(&mut manifest_content)
            .expect("读取 manifest 内容失败");
        assert!(manifest_content.contains("request_logs/"));
        assert!(manifest_content.contains("credentials 目录正文"));
    }
}
