//! Capability Draft 文件事实源服务。
//!
//! P1A / P1B 只负责创建、读取、列出和静态验证草案；不注册 Skill，也不进入执行面。

use chrono::Utc;
use lime_core::models::{
    parse_skill_manifest_from_content, SkillResourceSummary, SkillStandardCompliance,
};
use lime_services::skill_service::SkillService;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

const DRAFTS_RELATIVE_DIR: &str = ".lime/capability-drafts";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const VERIFICATION_DIR_NAME: &str = "verification";
const LATEST_VERIFICATION_FILE_NAME: &str = "latest.json";
const REGISTRATION_DIR_NAME: &str = "registration";
const LATEST_REGISTRATION_FILE_NAME: &str = "latest.json";
const REGISTERED_SKILLS_ROOT_DIR_NAME: &str = ".agents";
const REGISTERED_SKILLS_DIR_NAME: &str = "skills";
const SKILL_REGISTRATION_METADATA_DIR_NAME: &str = ".lime";
const SKILL_REGISTRATION_METADATA_FILE_NAME: &str = "registration.json";
const MAX_GENERATED_FILES: usize = 32;
const MAX_FILE_BYTES: usize = 256 * 1024;
const MAX_TOTAL_BYTES: usize = 1024 * 1024;
const MAX_TEXT_FIELD_CHARS: usize = 4096;
const MIN_SKILL_MD_CHARS: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftStatus {
    Unverified,
    FailedSelfCheck,
    VerificationFailed,
    VerifiedPendingRegistration,
    Registered,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftVerificationRunStatus {
    Passed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDraftVerificationCheckStatus {
    Passed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftVerificationCheck {
    pub id: String,
    pub label: String,
    pub status: CapabilityDraftVerificationCheckStatus,
    pub message: String,
    pub suggestions: Vec<String>,
    pub can_agent_repair: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftVerificationSummary {
    pub report_id: String,
    pub status: CapabilityDraftVerificationRunStatus,
    pub summary: String,
    pub checked_at: String,
    pub failed_check_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftVerificationReport {
    #[serde(flatten)]
    pub summary: CapabilityDraftVerificationSummary,
    pub draft_id: String,
    pub checks: Vec<CapabilityDraftVerificationCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftRegistrationSummary {
    pub registration_id: String,
    pub registered_at: String,
    pub skill_directory: String,
    pub registered_skill_directory: String,
    pub source_draft_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_verification_report_id: Option<String>,
    pub generated_file_count: usize,
    pub permission_summary: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftFileInput {
    #[serde(alias = "relative_path")]
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftFileSummary {
    #[serde(alias = "relative_path")]
    pub relative_path: String,
    pub byte_length: usize,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftManifest {
    pub draft_id: String,
    pub name: String,
    pub description: String,
    pub user_goal: String,
    pub source_kind: String,
    pub source_refs: Vec<String>,
    pub permission_summary: Vec<String>,
    pub generated_files: Vec<CapabilityDraftFileSummary>,
    pub verification_status: CapabilityDraftStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_verification: Option<CapabilityDraftVerificationSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_registration: Option<CapabilityDraftRegistrationSummary>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDraftRecord {
    #[serde(flatten)]
    pub manifest: CapabilityDraftManifest,
    pub draft_root: String,
    pub manifest_path: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateCapabilityDraftRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    pub name: String,
    pub description: String,
    #[serde(alias = "user_goal")]
    pub user_goal: String,
    #[serde(default = "default_source_kind", alias = "source_kind")]
    pub source_kind: String,
    #[serde(default, alias = "source_refs")]
    pub source_refs: Vec<String>,
    #[serde(default, alias = "permission_summary")]
    pub permission_summary: Vec<String>,
    #[serde(default, alias = "generated_files")]
    pub generated_files: Vec<CapabilityDraftFileInput>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListCapabilityDraftsRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetCapabilityDraftRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    #[serde(alias = "draft_id")]
    pub draft_id: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerifyCapabilityDraftRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    #[serde(alias = "draft_id")]
    pub draft_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerifyCapabilityDraftResult {
    pub draft: CapabilityDraftRecord,
    pub report: CapabilityDraftVerificationReport,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegisterCapabilityDraftRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
    #[serde(alias = "draft_id")]
    pub draft_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegisterCapabilityDraftResult {
    pub draft: CapabilityDraftRecord,
    pub registration: CapabilityDraftRegistrationSummary,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspaceRegisteredSkillsRequest {
    #[serde(alias = "workspace_root")]
    pub workspace_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRegisteredSkillRecord {
    pub key: String,
    pub name: String,
    pub description: String,
    pub directory: String,
    pub registered_skill_directory: String,
    pub registration: CapabilityDraftRegistrationSummary,
    pub permission_summary: Vec<String>,
    pub metadata: HashMap<String, String>,
    pub allowed_tools: Vec<String>,
    pub resource_summary: SkillResourceSummary,
    pub standard_compliance: SkillStandardCompliance,
    pub launch_enabled: bool,
    pub runtime_gate: String,
}

struct PreparedDraftFile {
    relative_path: String,
    output_path: PathBuf,
    content: String,
    summary: CapabilityDraftFileSummary,
}

fn default_source_kind() -> String {
    "manual".to_string()
}

fn now_iso8601() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn normalize_required_text(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.replace('\r', "").trim().to_string();
    if normalized.is_empty() {
        return Err(format!("{field} 不能为空"));
    }
    if normalized.chars().count() > MAX_TEXT_FIELD_CHARS {
        return Err(format!("{field} 过长，最多 {MAX_TEXT_FIELD_CHARS} 个字符"));
    }
    Ok(normalized)
}

fn normalize_string_list(values: &[String], field: &str) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let item = value.replace('\r', "").trim().to_string();
        if item.is_empty() {
            continue;
        }
        if item.chars().count() > MAX_TEXT_FIELD_CHARS {
            return Err(format!("{field} 中存在过长条目"));
        }
        if seen.insert(item.clone()) {
            normalized.push(item);
        }
    }
    Ok(normalized)
}

fn resolve_workspace_root(workspace_root: &str) -> Result<PathBuf, String> {
    let raw = workspace_root.trim();
    if raw.is_empty() {
        return Err("workspaceRoot 不能为空".to_string());
    }

    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("workspaceRoot 必须是绝对路径".to_string());
    }
    if !path.exists() {
        return Err(format!("工作区根目录不存在: {raw}"));
    }
    if !path.is_dir() {
        return Err(format!("workspaceRoot 不是目录: {raw}"));
    }

    fs::canonicalize(&path).map_err(|error| format!("解析工作区根目录失败: {error}"))
}

fn drafts_root_for_workspace(workspace_root: &Path) -> PathBuf {
    workspace_root.join(DRAFTS_RELATIVE_DIR)
}

fn validate_draft_id(draft_id: &str) -> Result<String, String> {
    let normalized = draft_id.trim();
    if normalized.is_empty() {
        return Err("draftId 不能为空".to_string());
    }
    if normalized.len() > 96 {
        return Err("draftId 过长".to_string());
    }
    if normalized == "." || normalized == ".." {
        return Err("draftId 不合法".to_string());
    }
    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("draftId 只能包含字母、数字、短横线和下划线".to_string());
    }
    Ok(normalized.to_string())
}

fn validate_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let raw = relative_path.trim();
    if raw.is_empty() {
        return Err("生成文件 relativePath 不能为空".to_string());
    }
    if raw.contains('\\') || raw.contains(':') || raw.chars().any(char::is_control) {
        return Err(format!("生成文件路径不允许包含平台相关或控制字符: {raw}"));
    }

    let path = Path::new(raw);
    if path.is_absolute() {
        return Err(format!("生成文件路径必须是相对路径: {raw}"));
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err(format!("生成文件路径不能包含 .、.. 或根路径: {raw}"));
            }
        }
    }

    let normalized_text = normalized.to_string_lossy().replace('\\', "/");
    if normalized_text.is_empty() || normalized_text == MANIFEST_FILE_NAME {
        return Err("manifest.json 由 Capability Draft 服务维护，不能作为生成文件写入".to_string());
    }

    Ok(normalized)
}

fn sha256_hex(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    format!("{digest:x}")
}

fn prepare_generated_files(
    draft_root: &Path,
    files: &[CapabilityDraftFileInput],
) -> Result<Vec<PreparedDraftFile>, String> {
    if files.is_empty() {
        return Err("至少需要 1 个生成文件，P1A 不创建空草案".to_string());
    }
    if files.len() > MAX_GENERATED_FILES {
        return Err(format!("生成文件过多，最多 {MAX_GENERATED_FILES} 个"));
    }

    let mut total_bytes = 0usize;
    let mut seen = HashSet::new();
    let mut prepared = Vec::with_capacity(files.len());

    for file in files {
        let relative_path = validate_relative_path(&file.relative_path)?;
        let relative_text = relative_path.to_string_lossy().replace('\\', "/");
        if !seen.insert(relative_text.clone()) {
            return Err(format!("生成文件路径重复: {relative_text}"));
        }

        let byte_length = file.content.as_bytes().len();
        if byte_length > MAX_FILE_BYTES {
            return Err(format!(
                "生成文件 {relative_text} 过大，最多 {MAX_FILE_BYTES} 字节"
            ));
        }
        total_bytes = total_bytes.saturating_add(byte_length);
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(format!("生成文件总大小过大，最多 {MAX_TOTAL_BYTES} 字节"));
        }

        let output_path = draft_root.join(&relative_path);
        if !output_path.starts_with(draft_root) {
            return Err(format!("生成文件路径逃逸 draft root: {relative_text}"));
        }

        prepared.push(PreparedDraftFile {
            relative_path: relative_text.clone(),
            output_path,
            content: file.content.clone(),
            summary: CapabilityDraftFileSummary {
                relative_path: relative_text,
                byte_length,
                sha256: sha256_hex(&file.content),
            },
        });
    }

    Ok(prepared)
}

fn write_manifest(path: &Path, manifest: &CapabilityDraftManifest) -> Result<(), String> {
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("序列化 capability draft manifest 失败: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)
        .map_err(|error| format!("写入 capability draft manifest 临时文件失败: {error}"))?;
    fs::rename(&temp_path, path)
        .map_err(|error| format!("替换 capability draft manifest 失败: {error}"))
}

fn read_manifest(path: &Path) -> Result<CapabilityDraftManifest, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("读取 capability draft manifest 失败: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("解析 capability draft manifest 失败: {error}"))
}

fn verification_report_path(draft_root: &Path) -> PathBuf {
    draft_root
        .join(VERIFICATION_DIR_NAME)
        .join(LATEST_VERIFICATION_FILE_NAME)
}

fn registration_report_path(draft_root: &Path) -> PathBuf {
    draft_root
        .join(REGISTRATION_DIR_NAME)
        .join(LATEST_REGISTRATION_FILE_NAME)
}

fn write_verification_report(
    path: &Path,
    report: &CapabilityDraftVerificationReport,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 capability draft verification 目录失败: {error}"))?;
    }
    let content = serde_json::to_string_pretty(report)
        .map_err(|error| format!("序列化 capability draft verification report 失败: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)
        .map_err(|error| format!("写入 capability draft verification 临时文件失败: {error}"))?;
    fs::rename(&temp_path, path)
        .map_err(|error| format!("替换 capability draft verification report 失败: {error}"))
}

fn write_registration_summary(
    path: &Path,
    summary: &CapabilityDraftRegistrationSummary,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 capability draft registration 目录失败: {error}"))?;
    }
    let content = serde_json::to_string_pretty(summary)
        .map_err(|error| format!("序列化 capability draft registration summary 失败: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)
        .map_err(|error| format!("写入 capability draft registration 临时文件失败: {error}"))?;
    fs::rename(&temp_path, path)
        .map_err(|error| format!("替换 capability draft registration summary 失败: {error}"))
}

fn read_registration_summary(path: &Path) -> Result<CapabilityDraftRegistrationSummary, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("读取 capability draft registration summary 失败: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("解析 capability draft registration summary 失败: {error}"))
}

fn to_record(draft_root: &Path, manifest: CapabilityDraftManifest) -> CapabilityDraftRecord {
    CapabilityDraftRecord {
        manifest,
        draft_root: draft_root.to_string_lossy().to_string(),
        manifest_path: draft_root
            .join(MANIFEST_FILE_NAME)
            .to_string_lossy()
            .to_string(),
    }
}

fn workspace_registered_skills_root(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(REGISTERED_SKILLS_ROOT_DIR_NAME)
        .join(REGISTERED_SKILLS_DIR_NAME)
}

fn skill_directory_for_draft(draft_id: &str) -> Result<String, String> {
    let normalized = validate_draft_id(draft_id)?;
    let suffix = normalized.strip_prefix("capdraft-").unwrap_or(&normalized);
    let short = suffix
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(12)
        .collect::<String>();
    if short.is_empty() {
        return Err("无法从 draftId 派生 Skill 目录名".to_string());
    }
    Ok(format!("capability-{short}"))
}

fn validate_agent_skill_standard(skill_dir: &Path) -> Result<(), String> {
    let inspection = SkillService::inspect_skill_dir(skill_dir)
        .map_err(|error| format!("Agent Skills 标准检查失败: {error}"))?;
    if inspection.standard_compliance.validation_errors.is_empty() {
        return Ok(());
    }
    Err(format!(
        "Agent Skills 标准检查未通过: {}",
        inspection.standard_compliance.validation_errors.join("；")
    ))
}

fn copy_registered_skill_files(
    draft_root: &Path,
    target_dir: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<(), String> {
    if let Some(parent) = target_dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建注册 Skill 根目录失败 {}: {error}", parent.display()))?;
    }
    fs::create_dir(target_dir).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!("Workspace Skill 目录已存在: {}", target_dir.display())
        } else {
            format!("创建注册 Skill 目录失败 {}: {error}", target_dir.display())
        }
    })?;

    for file in &manifest.generated_files {
        let relative_path = validate_relative_path(&file.relative_path)?;
        let source_path = draft_root.join(&relative_path);
        let target_path = target_dir.join(&relative_path);
        if !source_path.starts_with(draft_root) || !target_path.starts_with(target_dir) {
            return Err(format!("注册文件路径逃逸: {}", file.relative_path));
        }

        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("读取注册源文件失败 {}: {error}", file.relative_path))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "注册源文件不允许是 symlink: {}",
                file.relative_path
            ));
        }
        if !metadata.is_file() {
            return Err(format!("注册源路径不是文件: {}", file.relative_path));
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建注册目标父目录失败 {}: {error}", parent.display()))?;
        }
        fs::copy(&source_path, &target_path).map_err(|error| {
            format!(
                "复制注册文件失败 {} -> {}: {error}",
                source_path.display(),
                target_path.display()
            )
        })?;
    }

    Ok(())
}

fn verification_check(
    id: &str,
    label: &str,
    passed: bool,
    message: impl Into<String>,
    suggestions: Vec<String>,
) -> CapabilityDraftVerificationCheck {
    CapabilityDraftVerificationCheck {
        id: id.to_string(),
        label: label.to_string(),
        status: if passed {
            CapabilityDraftVerificationCheckStatus::Passed
        } else {
            CapabilityDraftVerificationCheckStatus::Failed
        },
        message: message.into(),
        suggestions,
        can_agent_repair: !passed,
    }
}

fn relative_path_matches(relative_path: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|candidate| {
        relative_path == *candidate || relative_path.ends_with(&format!("/{candidate}"))
    })
}

fn find_generated_file<'a>(
    manifest: &'a CapabilityDraftManifest,
    candidates: &[&str],
) -> Option<&'a CapabilityDraftFileSummary> {
    manifest
        .generated_files
        .iter()
        .find(|file| relative_path_matches(&file.relative_path, candidates))
}

fn read_generated_file_text(
    draft_root: &Path,
    file: &CapabilityDraftFileSummary,
) -> Result<String, String> {
    let relative_path = validate_relative_path(&file.relative_path)?;
    let path = draft_root.join(relative_path);
    if !path.starts_with(draft_root) {
        return Err(format!(
            "生成文件路径逃逸 draft root: {}",
            file.relative_path
        ));
    }
    fs::read_to_string(&path).map_err(|error| format!("读取 {} 失败: {error}", file.relative_path))
}

fn validate_manifest_file_integrity(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<(), Vec<String>> {
    let mut issues = Vec::new();
    let mut seen = HashSet::new();

    for file in &manifest.generated_files {
        let relative_path = match validate_relative_path(&file.relative_path) {
            Ok(path) => path,
            Err(error) => {
                issues.push(error);
                continue;
            }
        };
        if !seen.insert(file.relative_path.clone()) {
            issues.push(format!("文件清单重复: {}", file.relative_path));
        }
        let path = draft_root.join(relative_path);
        if !path.starts_with(draft_root) {
            issues.push(format!("文件清单路径逃逸: {}", file.relative_path));
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) => {
                issues.push(format!("读取 {} 失败: {error}", file.relative_path));
                continue;
            }
        };
        let byte_length = content.as_bytes().len();
        if byte_length != file.byte_length {
            issues.push(format!(
                "{} 字节数不一致，manifest={} actual={}",
                file.relative_path, file.byte_length, byte_length
            ));
        }
        let sha256 = sha256_hex(&content);
        if sha256 != file.sha256 {
            issues.push(format!("{} sha256 不一致", file.relative_path));
        }
    }

    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

fn permission_text(manifest: &CapabilityDraftManifest) -> String {
    manifest
        .permission_summary
        .iter()
        .map(|item| item.to_lowercase())
        .collect::<Vec<_>>()
        .join("\n")
}

fn permission_declares_local_cli(permission_text: &str) -> bool {
    [
        "cli",
        "local command",
        "local cli",
        "本地命令",
        "本地 cli",
        "命令",
    ]
    .iter()
    .any(|needle| permission_text.contains(needle))
}

fn scan_static_risks(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Result<(), Vec<String>> {
    let permissions = permission_text(manifest);
    let local_cli_declared = permission_declares_local_cli(&permissions);
    let mut issues = Vec::new();

    for file in &manifest.generated_files {
        let content = match read_generated_file_text(draft_root, file) {
            Ok(content) => content,
            Err(error) => {
                issues.push(error);
                continue;
            }
        };
        let lower = content.to_lowercase();
        let path = &file.relative_path;

        for token in [
            "rm -rf",
            "fs.rm(",
            "fs.rmsync(",
            "unlink(",
            "remove_file",
            "deleteobject",
        ] {
            if lower.contains(token) {
                issues.push(format!("{path} 命中删除类危险 token: {token}"));
            }
        }

        for token in [
            "npm install",
            "pnpm add",
            "yarn add",
            "pip install",
            "cargo add",
        ] {
            if lower.contains(token) {
                issues.push(format!("{path} 命中依赖安装 token: {token}"));
            }
        }

        for token in [
            "child_process.exec",
            "execsync(",
            "shell: true",
            "curl -x post",
            "curl -x put",
            "curl -x patch",
            "curl -x delete",
            "method: \"post\"",
            "method: 'post'",
            "method: \"put\"",
            "method: 'put'",
            "method: \"patch\"",
            "method: 'patch'",
            "method: \"delete\"",
            "method: 'delete'",
            "axios.post",
            "axios.put",
            "axios.patch",
            "axios.delete",
        ] {
            if lower.contains(token) {
                issues.push(format!("{path} 命中外部写 / shell 字符串 token: {token}"));
            }
        }

        for token in [
            "payment",
            "charge",
            "place_order",
            "create_order",
            "create_listing",
            "publish_listing",
            "update_price",
        ] {
            if lower.contains(token) {
                issues.push(format!("{path} 命中高风险业务动作 token: {token}"));
            }
        }

        let declares_cli_token = [
            "child_process.spawn",
            "spawn(",
            "execfile(",
            "std::process::command",
            "command::new",
        ]
        .iter()
        .any(|token| lower.contains(token));

        if declares_cli_token && !local_cli_declared {
            issues.push(format!(
                "{path} 出现本地 CLI 执行，但 permissionSummary 未声明本地命令权限"
            ));
        }
    }

    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

fn run_capability_draft_static_checks(
    draft_root: &Path,
    manifest: &CapabilityDraftManifest,
) -> Vec<CapabilityDraftVerificationCheck> {
    let mut checks = Vec::new();
    let skill_file = find_generated_file(manifest, &["SKILL.md"]);

    match validate_manifest_file_integrity(draft_root, manifest) {
        Ok(()) if skill_file.is_some() => checks.push(verification_check(
            "package_structure",
            "包结构",
            true,
            "manifest 文件清单与磁盘一致，且包含 SKILL.md。",
            Vec::new(),
        )),
        Ok(()) => checks.push(verification_check(
            "package_structure",
            "包结构",
            false,
            "文件清单缺少 SKILL.md。",
            vec!["补齐 SKILL.md，并确保它进入 generatedFiles 清单。".to_string()],
        )),
        Err(issues) => checks.push(verification_check(
            "package_structure",
            "包结构",
            false,
            issues.join("；"),
            vec![
                "重新生成或修复 manifest 文件清单，确保路径、字节数和 sha256 与磁盘一致。"
                    .to_string(),
            ],
        )),
    }

    let skill_quality = skill_file
        .and_then(|file| read_generated_file_text(draft_root, file).ok())
        .map(|content| {
            let trimmed = content.trim();
            trimmed.chars().count() >= MIN_SKILL_MD_CHARS
                && (trimmed.contains("##")
                    || trimmed.contains("步骤")
                    || trimmed.contains("输入")
                    || trimmed.contains("输出")
                    || trimmed.to_lowercase().contains("when"))
        })
        .unwrap_or(false);
    checks.push(verification_check(
        "skill_readme_quality",
        "Skill 说明质量",
        skill_quality,
        if skill_quality {
            "SKILL.md 包含基本说明，可供后续人工复核。"
        } else {
            "SKILL.md 过短或缺少输入、输出、步骤、触发条件等可读说明。"
        },
        vec!["补齐触发条件、输入、执行步骤、输出、失败回退和权限边界。".to_string()],
    ));

    let has_input_contract = find_generated_file(
        manifest,
        &[
            "contract/input.schema.json",
            "contracts/input.schema.json",
            "input.schema.json",
            "input.schema.yaml",
            "input.schema.yml",
        ],
    )
    .is_some();
    checks.push(verification_check(
        "input_contract",
        "输入 contract",
        has_input_contract,
        if has_input_contract {
            "已找到输入 contract。"
        } else {
            "缺少输入 contract。"
        },
        vec!["新增 contract/input.schema.json，描述必填输入、类型和约束。".to_string()],
    ));

    let has_output_contract = find_generated_file(
        manifest,
        &[
            "contract/output.schema.json",
            "contracts/output.schema.json",
            "output.schema.json",
            "output.schema.yaml",
            "output.schema.yml",
        ],
    )
    .is_some();
    checks.push(verification_check(
        "output_contract",
        "输出 contract",
        has_output_contract,
        if has_output_contract {
            "已找到输出 contract。"
        } else {
            "缺少输出 contract。"
        },
        vec!["新增 contract/output.schema.json，描述产物、错误和输出字段。".to_string()],
    ));

    let has_permission_summary = !manifest.permission_summary.is_empty();
    checks.push(verification_check(
        "permission_declaration",
        "权限声明",
        has_permission_summary,
        if has_permission_summary {
            "已声明权限摘要。"
        } else {
            "缺少权限摘要，无法判断草案是否只读、是否写文件或是否调用本地命令。"
        },
        vec![
            "补充 permissionSummary，明确只读发现、草案内写入、本地 CLI、网络和外部写边界。"
                .to_string(),
        ],
    ));

    match scan_static_risks(draft_root, manifest) {
        Ok(()) => checks.push(verification_check(
            "static_risk_scan",
            "静态风险扫描",
            true,
            "未发现删除、依赖安装、HTTP 写操作、任意 shell 字符串或高风险业务动作 token。",
            Vec::new(),
        )),
        Err(issues) => checks.push(verification_check(
            "static_risk_scan",
            "静态风险扫描",
            false,
            issues.join("；"),
            vec![
                "移除高风险动作，或拆成后续需要人工确认 / policy gate 的能力。".to_string(),
                "如果只是只读 CLI，请使用结构化参数并在 permissionSummary 中声明本地命令边界。"
                    .to_string(),
            ],
        )),
    }

    let has_fixture = manifest.generated_files.iter().any(|file| {
        file.relative_path.starts_with("tests/") || file.relative_path.starts_with("examples/")
    });
    checks.push(verification_check(
        "fixture_presence",
        "fixture / example",
        has_fixture,
        if has_fixture {
            "已找到 tests/ 或 examples/，可作为后续 dry-run 输入。"
        } else {
            "缺少 tests/ 或 examples/，后续无法做可重复 dry-run。"
        },
        vec!["新增 examples/input.sample.json 或 tests/fixture.test.*。".to_string()],
    ));

    checks
}

pub fn create_capability_draft(
    request: CreateCapabilityDraftRequest,
) -> Result<CapabilityDraftRecord, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let drafts_root = drafts_root_for_workspace(&workspace_root);
    let draft_id = format!("capdraft-{}", Uuid::new_v4().simple());
    let draft_root = drafts_root.join(&draft_id);
    if draft_root.exists() {
        return Err(format!("Capability Draft 已存在: {draft_id}"));
    }

    let name = normalize_required_text(&request.name, "name")?;
    let description = normalize_required_text(&request.description, "description")?;
    let user_goal = normalize_required_text(&request.user_goal, "userGoal")?;
    let source_kind = normalize_required_text(&request.source_kind, "sourceKind")?;
    let source_refs = normalize_string_list(&request.source_refs, "sourceRefs")?;
    let permission_summary =
        normalize_string_list(&request.permission_summary, "permissionSummary")?;
    let prepared_files = prepare_generated_files(&draft_root, &request.generated_files)?;

    fs::create_dir_all(&draft_root)
        .map_err(|error| format!("创建 capability draft 目录失败: {error}"))?;

    for file in &prepared_files {
        if let Some(parent) = file.output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建生成文件父目录失败: {error}"))?;
        }
        fs::write(&file.output_path, &file.content)
            .map_err(|error| format!("写入生成文件 {} 失败: {error}", file.relative_path))?;
    }

    let now = now_iso8601();
    let manifest = CapabilityDraftManifest {
        draft_id,
        name,
        description,
        user_goal,
        source_kind,
        source_refs,
        permission_summary,
        generated_files: prepared_files
            .into_iter()
            .map(|file| file.summary)
            .collect(),
        verification_status: CapabilityDraftStatus::Unverified,
        last_verification: None,
        last_registration: None,
        created_at: now.clone(),
        updated_at: now,
    };

    let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
    write_manifest(&manifest_path, &manifest)?;

    Ok(to_record(&draft_root, manifest))
}

pub fn list_capability_drafts(
    request: ListCapabilityDraftsRequest,
) -> Result<Vec<CapabilityDraftRecord>, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let drafts_root = drafts_root_for_workspace(&workspace_root);
    if !drafts_root.exists() {
        return Ok(Vec::new());
    }

    let mut records = Vec::new();
    let entries = fs::read_dir(&drafts_root)
        .map_err(|error| format!("读取 capability drafts 目录失败: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 capability draft 目录项失败: {error}"))?;
        let draft_root = entry.path();
        if !draft_root.is_dir() {
            continue;
        }
        let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
        if !manifest_path.is_file() {
            continue;
        }
        let manifest = read_manifest(&manifest_path)?;
        records.push(to_record(&draft_root, manifest));
    }

    records.sort_by(|left, right| {
        right
            .manifest
            .updated_at
            .cmp(&left.manifest.updated_at)
            .then_with(|| left.manifest.draft_id.cmp(&right.manifest.draft_id))
    });

    Ok(records)
}

pub fn get_capability_draft(
    request: GetCapabilityDraftRequest,
) -> Result<Option<CapabilityDraftRecord>, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let draft_id = validate_draft_id(&request.draft_id)?;
    let draft_root = drafts_root_for_workspace(&workspace_root).join(&draft_id);
    let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
    if !manifest_path.is_file() {
        return Ok(None);
    }

    let manifest = read_manifest(&manifest_path)?;
    Ok(Some(to_record(&draft_root, manifest)))
}

pub fn verify_capability_draft(
    request: VerifyCapabilityDraftRequest,
) -> Result<VerifyCapabilityDraftResult, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let draft_id = validate_draft_id(&request.draft_id)?;
    let draft_root = drafts_root_for_workspace(&workspace_root).join(&draft_id);
    let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
    if !manifest_path.is_file() {
        return Err(format!("Capability Draft 不存在: {draft_id}"));
    }

    let mut manifest = read_manifest(&manifest_path)?;
    if manifest.draft_id != draft_id {
        return Err(format!(
            "Capability Draft ID 不一致: path={draft_id} manifest={}",
            manifest.draft_id
        ));
    }

    let checks = run_capability_draft_static_checks(&draft_root, &manifest);
    let failed_check_count = checks
        .iter()
        .filter(|check| check.status == CapabilityDraftVerificationCheckStatus::Failed)
        .count();
    let checked_at = now_iso8601();
    let run_status = if failed_check_count == 0 {
        CapabilityDraftVerificationRunStatus::Passed
    } else {
        CapabilityDraftVerificationRunStatus::Failed
    };
    let summary_text = if failed_check_count == 0 {
        "最小 verification gate 通过，等待后续注册阶段。".to_string()
    } else {
        format!("最小 verification gate 未通过，{failed_check_count} 项检查失败。")
    };
    let summary = CapabilityDraftVerificationSummary {
        report_id: format!("capver-{}", Uuid::new_v4().simple()),
        status: run_status,
        summary: summary_text,
        checked_at,
        failed_check_count,
    };
    let report = CapabilityDraftVerificationReport {
        summary: summary.clone(),
        draft_id: draft_id.clone(),
        checks,
    };

    write_verification_report(&verification_report_path(&draft_root), &report)?;

    manifest.verification_status = if failed_check_count == 0 {
        CapabilityDraftStatus::VerifiedPendingRegistration
    } else {
        CapabilityDraftStatus::VerificationFailed
    };
    manifest.last_verification = Some(summary);
    manifest.updated_at = now_iso8601();
    write_manifest(&manifest_path, &manifest)?;

    Ok(VerifyCapabilityDraftResult {
        draft: to_record(&draft_root, manifest),
        report,
    })
}

pub fn register_capability_draft(
    request: RegisterCapabilityDraftRequest,
) -> Result<RegisterCapabilityDraftResult, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let draft_id = validate_draft_id(&request.draft_id)?;
    let draft_root = drafts_root_for_workspace(&workspace_root).join(&draft_id);
    let manifest_path = draft_root.join(MANIFEST_FILE_NAME);
    if !manifest_path.is_file() {
        return Err(format!("Capability Draft 不存在: {draft_id}"));
    }

    let mut manifest = read_manifest(&manifest_path)?;
    if manifest.draft_id != draft_id {
        return Err(format!(
            "Capability Draft ID 不一致: path={draft_id} manifest={}",
            manifest.draft_id
        ));
    }
    if manifest.verification_status != CapabilityDraftStatus::VerifiedPendingRegistration {
        return Err(format!(
            "Capability Draft 当前状态为 {:?}，只有 verified_pending_registration 可以注册",
            manifest.verification_status
        ));
    }

    validate_manifest_file_integrity(&draft_root, &manifest)
        .map_err(|issues| format!("注册前文件完整性检查失败: {}", issues.join("；")))?;
    validate_agent_skill_standard(&draft_root)?;

    let skill_directory = skill_directory_for_draft(&draft_id)?;
    let skills_root = workspace_registered_skills_root(&workspace_root);
    let target_dir = skills_root.join(&skill_directory);
    if target_dir.exists() {
        return Err(format!("Workspace Skill 目录已存在: {skill_directory}"));
    }

    let summary = CapabilityDraftRegistrationSummary {
        registration_id: format!("capreg-{}", Uuid::new_v4().simple()),
        registered_at: now_iso8601(),
        skill_directory: skill_directory.clone(),
        registered_skill_directory: target_dir.to_string_lossy().to_string(),
        source_draft_id: draft_id.clone(),
        source_verification_report_id: manifest
            .last_verification
            .as_ref()
            .map(|verification| verification.report_id.clone()),
        generated_file_count: manifest.generated_files.len(),
        permission_summary: manifest.permission_summary.clone(),
    };

    if let Err(error) = copy_registered_skill_files(&draft_root, &target_dir, &manifest) {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(error);
    }

    let target_registration_path = target_dir
        .join(SKILL_REGISTRATION_METADATA_DIR_NAME)
        .join(SKILL_REGISTRATION_METADATA_FILE_NAME);
    if let Err(error) = write_registration_summary(&target_registration_path, &summary) {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(error);
    }
    if let Err(error) = validate_agent_skill_standard(&target_dir) {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(error);
    }
    if let Err(error) = write_registration_summary(&registration_report_path(&draft_root), &summary)
    {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(error);
    }

    manifest.verification_status = CapabilityDraftStatus::Registered;
    manifest.last_registration = Some(summary.clone());
    manifest.updated_at = now_iso8601();
    if let Err(error) = write_manifest(&manifest_path, &manifest) {
        let _ = fs::remove_dir_all(&target_dir);
        let _ = fs::remove_file(registration_report_path(&draft_root));
        return Err(error);
    }

    Ok(RegisterCapabilityDraftResult {
        draft: to_record(&draft_root, manifest),
        registration: summary,
    })
}

fn build_workspace_registered_skill_record(
    skill_dir: &Path,
    directory: String,
    registration: CapabilityDraftRegistrationSummary,
) -> Result<WorkspaceRegisteredSkillRecord, String> {
    let inspection = SkillService::inspect_skill_dir(skill_dir)
        .map_err(|error| format!("检查 Workspace 注册 Skill 失败: {error}"))?;
    let parsed_manifest = parse_skill_manifest_from_content(&inspection.content).ok();
    let name = parsed_manifest
        .as_ref()
        .and_then(|manifest| manifest.metadata.name.clone())
        .unwrap_or_else(|| directory.clone());
    let description = parsed_manifest
        .as_ref()
        .and_then(|manifest| manifest.metadata.description.clone())
        .unwrap_or_default();

    Ok(WorkspaceRegisteredSkillRecord {
        key: format!("workspace:{directory}"),
        name,
        description,
        directory,
        registered_skill_directory: skill_dir.to_string_lossy().to_string(),
        permission_summary: registration.permission_summary.clone(),
        metadata: inspection.metadata,
        allowed_tools: inspection.allowed_tools,
        resource_summary: inspection.resource_summary,
        standard_compliance: inspection.standard_compliance,
        registration,
        launch_enabled: false,
        runtime_gate: "已注册为 Workspace 本地 Skill 包；进入运行前还需要 P3C runtime binding 与 tool_runtime 授权。"
            .to_string(),
    })
}

pub fn list_workspace_registered_skills(
    request: ListWorkspaceRegisteredSkillsRequest,
) -> Result<Vec<WorkspaceRegisteredSkillRecord>, String> {
    let workspace_root = resolve_workspace_root(&request.workspace_root)?;
    let skills_root = workspace_registered_skills_root(&workspace_root);
    if !skills_root.exists() {
        return Ok(Vec::new());
    }

    let root_metadata = fs::symlink_metadata(&skills_root)
        .map_err(|error| format!("读取 Workspace Skill 根目录失败: {error}"))?;
    if root_metadata.file_type().is_symlink() {
        return Err(format!(
            "Workspace Skill 根目录不允许是 symlink: {}",
            skills_root.display()
        ));
    }
    if !root_metadata.is_dir() {
        return Err(format!(
            "Workspace Skill 根目录不是目录: {}",
            skills_root.display()
        ));
    }

    let canonical_skills_root = fs::canonicalize(&skills_root)
        .map_err(|error| format!("解析 Workspace Skill 根目录失败: {error}"))?;
    let mut entries = fs::read_dir(&skills_root)
        .map_err(|error| format!("读取 Workspace Skill 目录失败: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取 Workspace Skill 目录项失败: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_string());

    let mut records = Vec::new();
    for entry in entries {
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path)
            .map_err(|error| format!("读取 Workspace Skill 目录项失败: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Workspace 注册 Skill 不允许是 symlink: {}",
                entry_path.display()
            ));
        }
        if !metadata.is_dir() {
            continue;
        }

        let skill_md = entry_path.join("SKILL.md");
        let registration_path = entry_path
            .join(SKILL_REGISTRATION_METADATA_DIR_NAME)
            .join(SKILL_REGISTRATION_METADATA_FILE_NAME);
        let skill_md_metadata = match fs::symlink_metadata(&skill_md) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let registration_metadata = match fs::symlink_metadata(&registration_path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if skill_md_metadata.file_type().is_symlink()
            || registration_metadata.file_type().is_symlink()
        {
            return Err(format!(
                "Workspace 注册 Skill 元数据不允许是 symlink: {}",
                entry_path.display()
            ));
        }
        if !skill_md_metadata.is_file() || !registration_metadata.is_file() {
            continue;
        }

        let canonical_skill_dir = fs::canonicalize(&entry_path)
            .map_err(|error| format!("解析 Workspace 注册 Skill 目录失败: {error}"))?;
        if !canonical_skill_dir.starts_with(&canonical_skills_root) {
            return Err(format!(
                "Workspace 注册 Skill 路径逃逸: {}",
                entry_path.display()
            ));
        }
        let canonical_skill_md = fs::canonicalize(&skill_md)
            .map_err(|error| format!("解析 Workspace 注册 Skill 说明失败: {error}"))?;
        let canonical_registration = fs::canonicalize(&registration_path)
            .map_err(|error| format!("解析 Workspace 注册 Skill provenance 失败: {error}"))?;
        if !canonical_skill_md.starts_with(&canonical_skill_dir)
            || !canonical_registration.starts_with(&canonical_skill_dir)
        {
            return Err(format!(
                "Workspace 注册 Skill 文件路径逃逸: {}",
                entry_path.display()
            ));
        }

        let directory = entry
            .file_name()
            .to_str()
            .ok_or_else(|| "Workspace 注册 Skill 目录名不是 UTF-8".to_string())?
            .to_string();
        let registration = read_registration_summary(&registration_path)?;
        records.push(build_workspace_registered_skill_record(
            &canonical_skill_dir,
            directory,
            registration,
        )?);
    }

    records.sort_by(|left, right| {
        right
            .registration
            .registered_at
            .cmp(&left.registration.registered_at)
            .then_with(|| left.directory.cmp(&right.directory))
    });

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_request(root: &Path) -> CreateCapabilityDraftRequest {
        CreateCapabilityDraftRequest {
            workspace_root: root.to_string_lossy().to_string(),
            name: "竞品监控草案".to_string(),
            description: "每天汇总竞品价格和上新变化。".to_string(),
            user_goal: "持续监控竞品爆款并产出待复核清单。".to_string(),
            source_kind: "manual".to_string(),
            source_refs: vec!["docs/research/creaoai".to_string()],
            permission_summary: vec!["Level 0 只读发现".to_string()],
            generated_files: vec![CapabilityDraftFileInput {
                relative_path: "SKILL.md".to_string(),
                content: "# 竞品监控草案\n\n未验证，只能复核。".to_string(),
            }],
        }
    }

    fn verifiable_request(root: &Path) -> CreateCapabilityDraftRequest {
        CreateCapabilityDraftRequest {
            workspace_root: root.to_string_lossy().to_string(),
            name: "只读 CLI 报告草案".to_string(),
            description: "把只读 CLI 输出整理成 Markdown 报告。".to_string(),
            user_goal: "每天读取本地 CLI 输出并保存趋势摘要。".to_string(),
            source_kind: "cli".to_string(),
            source_refs: vec!["trendctl --help".to_string()],
            permission_summary: vec![
                "Level 0 只读发现".to_string(),
                "允许执行本地 CLI，但只读取输出，不做外部写操作".to_string(),
            ],
            generated_files: vec![
                CapabilityDraftFileInput {
                    relative_path: "SKILL.md".to_string(),
                    content: [
                        "# 只读 CLI 报告草案",
                        "",
                        "## 何时使用",
                        "当用户需要把本地只读 CLI 输出整理为 Markdown 报告时使用。",
                        "",
                        "## 输入",
                        "- topic: 报告主题",
                        "",
                        "## 输出",
                        "- markdown_report: 生成的 Markdown 摘要",
                    ]
                    .join("\n"),
                },
                CapabilityDraftFileInput {
                    relative_path: "contract/input.schema.json".to_string(),
                    content: r#"{"type":"object","required":["topic"],"properties":{"topic":{"type":"string"}}}"#
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "contract/output.schema.json".to_string(),
                    content: r#"{"type":"object","required":["markdown_report"],"properties":{"markdown_report":{"type":"string"}}}"#
                        .to_string(),
                },
                CapabilityDraftFileInput {
                    relative_path: "examples/input.sample.json".to_string(),
                    content: r#"{"topic":"AI Agent"}"#.to_string(),
                },
            ],
        }
    }

    fn standard_verifiable_request(root: &Path) -> CreateCapabilityDraftRequest {
        let mut request = verifiable_request(root);
        request.generated_files[0].content = [
            "---",
            "name: 只读 CLI 报告",
            "description: 把本地只读 CLI 输出整理成 Markdown 报告。",
            "---",
            "",
            "# 只读 CLI 报告",
            "",
            "## 何时使用",
            "当用户需要把本地只读 CLI 输出整理为 Markdown 报告时使用。",
            "",
            "## 输入",
            "- topic: 报告主题",
            "",
            "## 执行步骤",
            "1. 读取用户提供的只读 CLI 输出或 fixture。",
            "2. 提炼趋势、异常和后续建议。",
            "",
            "## 输出",
            "- markdown_report: 生成的 Markdown 摘要",
        ]
        .join("\n");
        request
    }

    #[test]
    fn create_get_and_list_capability_draft() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(sample_request(temp.path())).unwrap();

        assert_eq!(created.manifest.name, "竞品监控草案");
        assert_eq!(
            created.manifest.verification_status,
            CapabilityDraftStatus::Unverified
        );
        assert_eq!(created.manifest.generated_files.len(), 1);
        assert!(created
            .draft_root
            .contains(".lime/capability-drafts/capdraft-"));

        let skill_path = Path::new(&created.draft_root).join("SKILL.md");
        assert_eq!(
            fs::read_to_string(skill_path).unwrap(),
            "# 竞品监控草案\n\n未验证，只能复核。"
        );

        let loaded = get_capability_draft(GetCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap()
        .unwrap();
        assert_eq!(loaded.manifest.draft_id, created.manifest.draft_id);

        let drafts = list_capability_drafts(ListCapabilityDraftsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].manifest.draft_id, created.manifest.draft_id);
    }

    #[test]
    fn rejects_path_escape_and_platform_specific_paths() {
        let temp = TempDir::new().unwrap();
        for relative_path in [
            "../SKILL.md",
            "/tmp/SKILL.md",
            "scripts\\tool.ts",
            "C:foo.ts",
            "./SKILL.md",
        ] {
            let mut request = sample_request(temp.path());
            request.generated_files[0].relative_path = relative_path.to_string();
            let error = create_capability_draft(request).unwrap_err();
            assert!(
                error.contains("生成文件路径") || error.contains("manifest.json"),
                "unexpected error for {relative_path}: {error}"
            );
        }
    }

    #[test]
    fn rejects_empty_generated_file_set() {
        let temp = TempDir::new().unwrap();
        let mut request = sample_request(temp.path());
        request.generated_files = Vec::new();

        let error = create_capability_draft(request).unwrap_err();
        assert!(error.contains("至少需要 1 个生成文件"));
    }

    #[test]
    fn verify_capability_draft_marks_complete_draft_pending_registration() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(verifiable_request(temp.path())).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerifiedPendingRegistration
        );
        assert_eq!(
            result.report.summary.status,
            CapabilityDraftVerificationRunStatus::Passed
        );
        assert_eq!(result.report.summary.failed_check_count, 0);
        assert!(result
            .report
            .checks
            .iter()
            .all(|check| check.status == CapabilityDraftVerificationCheckStatus::Passed));
        assert!(Path::new(&result.draft.draft_root)
            .join("verification/latest.json")
            .is_file());
    }

    #[test]
    fn verify_capability_draft_fails_without_contracts() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(sample_request(temp.path())).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        assert_eq!(
            result.report.summary.status,
            CapabilityDraftVerificationRunStatus::Failed
        );
        assert!(result.report.summary.failed_check_count >= 1);
        assert!(result
            .report
            .checks
            .iter()
            .any(|check| check.id == "input_contract"
                && check.status == CapabilityDraftVerificationCheckStatus::Failed));
        assert!(result
            .draft
            .manifest
            .last_verification
            .as_ref()
            .is_some_and(|summary| summary.failed_check_count >= 1));
    }

    #[test]
    fn verify_capability_draft_rejects_dangerous_tokens() {
        let temp = TempDir::new().unwrap();
        let mut request = verifiable_request(temp.path());
        request.generated_files.push(CapabilityDraftFileInput {
            relative_path: "scripts/publish.ts".to_string(),
            content: "await fetch(url, { method: \"POST\", body });".to_string(),
        });
        let created = create_capability_draft(request).unwrap();

        let result = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );
        let risk_check = result
            .report
            .checks
            .iter()
            .find(|check| check.id == "static_risk_scan")
            .unwrap();
        assert_eq!(
            risk_check.status,
            CapabilityDraftVerificationCheckStatus::Failed
        );
        assert!(risk_check.message.contains("method: \"post\""));
    }

    #[test]
    fn register_capability_draft_rejects_unverified_draft() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();

        let error = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap_err();

        assert!(error.contains("verified_pending_registration"));
    }

    #[test]
    fn register_capability_draft_rejects_verification_failed_draft() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(sample_request(temp.path())).unwrap();
        let verified = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        assert_eq!(
            verified.draft.manifest.verification_status,
            CapabilityDraftStatus::VerificationFailed
        );

        let error = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap_err();

        assert!(error.contains("verified_pending_registration"));
    }

    #[test]
    fn register_capability_draft_rejects_non_standard_skill() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(verifiable_request(temp.path())).unwrap();
        let verified = verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        assert_eq!(
            verified.draft.manifest.verification_status,
            CapabilityDraftStatus::VerifiedPendingRegistration
        );

        let error = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap_err();

        assert!(error.contains("Agent Skills 标准检查未通过"));
    }

    #[test]
    fn register_capability_draft_copies_verified_standard_skill() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        let result = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        assert_eq!(
            result.draft.manifest.verification_status,
            CapabilityDraftStatus::Registered
        );
        assert_eq!(
            result
                .draft
                .manifest
                .last_registration
                .as_ref()
                .map(|summary| summary.source_draft_id.as_str()),
            Some(created.manifest.draft_id.as_str())
        );
        assert!(Path::new(&result.registration.registered_skill_directory)
            .join("SKILL.md")
            .is_file());
        assert!(Path::new(&result.registration.registered_skill_directory)
            .join(SKILL_REGISTRATION_METADATA_DIR_NAME)
            .join(SKILL_REGISTRATION_METADATA_FILE_NAME)
            .is_file());
        assert!(Path::new(&result.draft.draft_root)
            .join("registration/latest.json")
            .is_file());
        assert_eq!(result.registration.generated_file_count, 4);
        assert!(result.registration.source_verification_report_id.is_some());
    }

    #[test]
    fn register_capability_draft_rejects_existing_skill_directory() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let skill_directory = skill_directory_for_draft(&created.manifest.draft_id).unwrap();
        fs::create_dir_all(
            temp.path()
                .join(REGISTERED_SKILLS_ROOT_DIR_NAME)
                .join(REGISTERED_SKILLS_DIR_NAME)
                .join(&skill_directory),
        )
        .unwrap();

        let error = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap_err();

        assert!(error.contains("Workspace Skill 目录已存在"));
    }

    #[test]
    fn list_workspace_registered_skills_returns_empty_without_skills_root() {
        let temp = TempDir::new().unwrap();

        let records = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();

        assert!(records.is_empty());
    }

    #[test]
    fn list_workspace_registered_skills_rejects_relative_workspace_root() {
        let error = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: "relative/workspace".to_string(),
        })
        .unwrap_err();

        assert!(error.contains("workspaceRoot 必须是绝对路径"));
    }

    #[test]
    fn list_workspace_registered_skills_ignores_standard_skill_without_registration() {
        let temp = TempDir::new().unwrap();
        let skill_dir = temp
            .path()
            .join(REGISTERED_SKILLS_ROOT_DIR_NAME)
            .join(REGISTERED_SKILLS_DIR_NAME)
            .join("manual-standard-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            [
                "---",
                "name: 手工标准 Skill",
                "description: 没有 P3A provenance。",
                "---",
                "",
                "# 手工标准 Skill",
            ]
            .join("\n"),
        )
        .unwrap();

        let records = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();

        assert!(records.is_empty());
    }

    #[test]
    fn list_workspace_registered_skills_discovers_p3a_registered_skill() {
        let temp = TempDir::new().unwrap();
        let created = create_capability_draft(standard_verifiable_request(temp.path())).unwrap();
        verify_capability_draft(VerifyCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();
        let registered = register_capability_draft(RegisterCapabilityDraftRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
            draft_id: created.manifest.draft_id.clone(),
        })
        .unwrap();

        let records = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap();

        assert_eq!(records.len(), 1);
        let record = &records[0];
        assert_eq!(record.key, format!("workspace:{}", record.directory));
        assert_eq!(record.name, "只读 CLI 报告");
        assert_eq!(
            record.registration.source_draft_id,
            created.manifest.draft_id
        );
        assert_eq!(
            record.registration.skill_directory,
            registered.registration.skill_directory
        );
        assert!(!record.launch_enabled);
        assert!(record.runtime_gate.contains("tool_runtime 授权"));
        assert!(record.standard_compliance.is_standard);
        assert_eq!(
            record.permission_summary,
            registered.registration.permission_summary
        );
    }

    #[cfg(unix)]
    #[test]
    fn list_workspace_registered_skills_rejects_symlink_skill_directory() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().unwrap();
        let skills_root = temp
            .path()
            .join(REGISTERED_SKILLS_ROOT_DIR_NAME)
            .join(REGISTERED_SKILLS_DIR_NAME);
        let outside = temp.path().join("outside-skill");
        fs::create_dir_all(&outside).unwrap();
        fs::write(
            outside.join("SKILL.md"),
            "---\nname: Outside\ndescription: escape\n---\n",
        )
        .unwrap();
        fs::create_dir_all(&skills_root).unwrap();
        symlink(&outside, skills_root.join("escape-skill")).unwrap();

        let error = list_workspace_registered_skills(ListWorkspaceRegisteredSkillsRequest {
            workspace_root: temp.path().to_string_lossy().to_string(),
        })
        .unwrap_err();

        assert!(error.contains("不允许是 symlink"));
    }
}
