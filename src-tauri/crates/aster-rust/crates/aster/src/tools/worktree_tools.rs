use crate::session::{ExtensionState, SessionManager, WorktreeSessionState};
use crate::tools::{
    base::{PermissionCheckResult, Tool},
    context::{ToolContext, ToolResult},
    error::ToolError,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Output;
use tokio::fs;
use tokio::process::Command;

const ENTER_WORKTREE_TOOL_NAME: &str = "EnterWorktree";
const EXIT_WORKTREE_TOOL_NAME: &str = "ExitWorktree";
const VALID_WORKTREE_SEGMENT_CHARS: &str =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
const MAX_WORKTREE_SLUG_LENGTH: usize = 64;

#[derive(Debug, Clone, Deserialize)]
struct EnterWorktreeInput {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnterWorktreeOutput {
    worktree_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    worktree_branch: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ExitWorktreeAction {
    Keep,
    Remove,
}

#[derive(Debug, Clone, Deserialize)]
struct ExitWorktreeInput {
    action: ExitWorktreeAction,
    #[serde(default, alias = "discardChanges")]
    discard_changes: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitWorktreeOutput {
    action: ExitWorktreeAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    original_cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    worktree_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    discarded_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    discarded_commits: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    noop: Option<bool>,
    message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ChangeSummary {
    changed_files: usize,
    commits: usize,
}

pub struct EnterWorktreeTool;

impl EnterWorktreeTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for EnterWorktreeTool {
    fn default() -> Self {
        Self::new()
    }
}

pub struct ExitWorktreeTool;

impl ExitWorktreeTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ExitWorktreeTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for EnterWorktreeTool {
    fn name(&self) -> &str {
        ENTER_WORKTREE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建隔离 git worktree，并把当前 session 切换到该 worktree。仅在用户明确要求使用 worktree、隔离分支或临时沙盒时使用。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "可选 worktree 名称。支持使用 / 分段；每段只能包含字母、数字、点、下划线和横杠，总长度不超过 64。未提供时会自动生成随机名称。"
                }
            },
            "additionalProperties": false
        })
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: EnterWorktreeInput = serde_json::from_value(params).map_err(|error| {
            ToolError::invalid_params(format!("EnterWorktree 参数无效: {error}"))
        })?;
        let session_id = require_session_id(context)?;
        let mut session = SessionManager::get_session(&session_id, false)
            .await
            .map_err(|error| ToolError::execution_failed(format!("读取 session 失败: {error}")))?;

        if WorktreeSessionState::from_extension_data(&session.extension_data).is_some() {
            return Err(ToolError::execution_failed("Already in a worktree session"));
        }

        let current_cwd = resolve_session_working_dir(&session, context);
        let git_root = resolve_canonical_git_root(&current_cwd).await?;
        let slug = resolve_worktree_slug(input.name)?;
        let flattened_slug = flatten_slug(&slug);
        let worktree_branch = format!("aster/worktree/{flattened_slug}");
        let worktree_path = git_root
            .join(".aster")
            .join("worktrees")
            .join(&flattened_slug);

        if worktree_path.exists() {
            return Err(ToolError::execution_failed(format!(
                "工作树路径已存在，请更换名称或先清理旧工作树: {}",
                worktree_path.display()
            )));
        }

        if git_local_branch_exists(&git_root, &worktree_branch).await? {
            return Err(ToolError::execution_failed(format!(
                "工作树分支已存在，请更换名称或先清理旧分支: {worktree_branch}"
            )));
        }

        let original_head_commit = Some(current_head(&git_root).await?);
        create_worktree(&git_root, &worktree_path, &worktree_branch).await?;

        let state = WorktreeSessionState {
            original_cwd: current_cwd.display().to_string(),
            git_root: git_root.display().to_string(),
            worktree_path: worktree_path.display().to_string(),
            worktree_branch: Some(worktree_branch.clone()),
            original_head_commit,
            slug,
        };
        state
            .to_extension_data(&mut session.extension_data)
            .map_err(|error| ToolError::execution_failed(format!("保存工作树状态失败: {error}")))?;

        SessionManager::update_session(&session_id)
            .working_dir(worktree_path.clone())
            .extension_data(session.extension_data)
            .apply()
            .await
            .map_err(|error| {
                ToolError::execution_failed(format!("更新 session 工作目录失败: {error}"))
            })?;

        let output = EnterWorktreeOutput {
            worktree_path: worktree_path.display().to_string(),
            worktree_branch: Some(worktree_branch.clone()),
            message: format!(
                "Created worktree at {} on branch {}. The session is now working in the worktree. Use ExitWorktree to leave mid-session.",
                worktree_path.display(),
                worktree_branch
            ),
        };

        Ok(ToolResult::success(pretty_json(&output)?)
            .with_metadata("worktreePath", json!(output.worktree_path))
            .with_metadata("worktreeBranch", json!(output.worktree_branch))
            .with_metadata("message", json!(output.message)))
    }
}

#[async_trait]
impl Tool for ExitWorktreeTool {
    fn name(&self) -> &str {
        EXIT_WORKTREE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "退出当前 session 通过 EnterWorktree 创建的 worktree。action=\"keep\" 仅恢复原目录；action=\"remove\" 会删除该 worktree 与对应分支。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["keep", "remove"],
                    "description": "\"keep\" 保留 worktree 和分支；\"remove\" 删除两者。"
                },
                "discard_changes": {
                    "type": "boolean",
                    "description": "当 action 为 \"remove\" 且 worktree 内存在未提交文件或未合并提交时，必须显式传 true 才允许继续。"
                }
            },
            "required": ["action"],
            "additionalProperties": false
        })
    }

    async fn check_permissions(
        &self,
        params: &Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        let Ok(input) = serde_json::from_value::<ExitWorktreeInput>(params.clone()) else {
            return PermissionCheckResult::allow();
        };

        if input.action != ExitWorktreeAction::Remove {
            return PermissionCheckResult::allow();
        }

        let Ok(session_id) = require_session_id(context) else {
            return PermissionCheckResult::ask(
                "ExitWorktree remove 将删除 worktree 目录和分支，请确认后继续。",
            );
        };

        match SessionManager::get_session(&session_id, false).await {
            Ok(session) => {
                if WorktreeSessionState::from_extension_data(&session.extension_data).is_some() {
                    PermissionCheckResult::ask(
                        "ExitWorktree remove 将删除当前 session 创建的 worktree 目录和分支，请确认后继续。",
                    )
                } else {
                    PermissionCheckResult::allow()
                }
            }
            Err(_) => PermissionCheckResult::ask(
                "ExitWorktree remove 将删除 worktree 目录和分支，请确认后继续。",
            ),
        }
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: ExitWorktreeInput = serde_json::from_value(params).map_err(|error| {
            ToolError::invalid_params(format!("ExitWorktree 参数无效: {error}"))
        })?;
        let session_id = require_session_id(context)?;
        let mut session = SessionManager::get_session(&session_id, false)
            .await
            .map_err(|error| ToolError::execution_failed(format!("读取 session 失败: {error}")))?;

        let Some(state) = WorktreeSessionState::from_extension_data(&session.extension_data) else {
            let output = ExitWorktreeOutput {
                action: input.action,
                original_cwd: None,
                worktree_path: None,
                worktree_branch: None,
                discarded_files: None,
                discarded_commits: None,
                noop: Some(true),
                message: "No-op: there is no active EnterWorktree session to exit. No filesystem changes were made.".to_string(),
            };

            return Ok(ToolResult::success(pretty_json(&output)?)
                .with_metadata("action", json!(output.action))
                .with_metadata("noop", json!(true))
                .with_metadata("message", json!(output.message)));
        };

        let change_summary = count_worktree_changes(
            Path::new(&state.worktree_path),
            state.original_head_commit.as_deref(),
        )
        .await?;

        if input.action == ExitWorktreeAction::Remove && input.discard_changes != Some(true) {
            match change_summary {
                Some(summary) if summary.changed_files == 0 && summary.commits == 0 => {}
                Some(summary) => {
                    let mut parts = Vec::new();
                    if summary.changed_files > 0 {
                        parts.push(format!(
                            "{} uncommitted {}",
                            summary.changed_files,
                            if summary.changed_files == 1 {
                                "file"
                            } else {
                                "files"
                            }
                        ));
                    }
                    if summary.commits > 0 {
                        parts.push(format!(
                            "{} {} on {}",
                            summary.commits,
                            if summary.commits == 1 {
                                "commit"
                            } else {
                                "commits"
                            },
                            state
                                .worktree_branch
                                .clone()
                                .unwrap_or_else(|| "the worktree branch".to_string())
                        ));
                    }
                    return Err(ToolError::execution_failed(format!(
                        "Worktree has {}. Removing will discard this work permanently. Confirm with the user, then re-invoke with discard_changes: true, or use action: \"keep\" to preserve the worktree.",
                        parts.join(" and ")
                    )));
                }
                None => {
                    return Err(ToolError::execution_failed(format!(
                        "Could not verify worktree state at {}. Refusing to remove without explicit confirmation. Re-invoke with discard_changes: true to proceed, or use action: \"keep\" to preserve the worktree.",
                        state.worktree_path
                    )));
                }
            }
        }

        let original_cwd = state.original_cwd.clone();
        let worktree_path = state.worktree_path.clone();
        let worktree_branch = state.worktree_branch.clone();

        session.extension_data.remove_extension_state(
            WorktreeSessionState::EXTENSION_NAME,
            WorktreeSessionState::VERSION,
        );

        match input.action {
            ExitWorktreeAction::Keep => {
                SessionManager::update_session(&session_id)
                    .working_dir(PathBuf::from(&original_cwd))
                    .extension_data(session.extension_data)
                    .apply()
                    .await
                    .map_err(|error| {
                        ToolError::execution_failed(format!("恢复 session 工作目录失败: {error}"))
                    })?;

                let output = ExitWorktreeOutput {
                    action: ExitWorktreeAction::Keep,
                    original_cwd: Some(original_cwd.clone()),
                    worktree_path: Some(worktree_path.clone()),
                    worktree_branch: worktree_branch.clone(),
                    discarded_files: None,
                    discarded_commits: None,
                    noop: None,
                    message: format!(
                        "Exited worktree. Your work is preserved at {}{}. Session is now back in {}.",
                        worktree_path,
                        worktree_branch
                            .as_ref()
                            .map(|branch| format!(" on branch {branch}"))
                            .unwrap_or_default(),
                        original_cwd
                    ),
                };

                return Ok(ToolResult::success(pretty_json(&output)?)
                    .with_metadata("action", json!(output.action))
                    .with_metadata("originalCwd", json!(output.original_cwd))
                    .with_metadata("worktreePath", json!(output.worktree_path))
                    .with_metadata("worktreeBranch", json!(output.worktree_branch))
                    .with_metadata("message", json!(output.message)));
            }
            ExitWorktreeAction::Remove => {
                let summary = change_summary.unwrap_or(ChangeSummary {
                    changed_files: 0,
                    commits: 0,
                });
                remove_worktree(
                    Path::new(&state.git_root),
                    Path::new(&worktree_path),
                    worktree_branch.as_deref(),
                )
                .await?;

                SessionManager::update_session(&session_id)
                    .working_dir(PathBuf::from(&original_cwd))
                    .extension_data(session.extension_data)
                    .apply()
                    .await
                    .map_err(|error| {
                        ToolError::execution_failed(format!("恢复 session 工作目录失败: {error}"))
                    })?;

                let discard_note = build_discard_note(summary);
                let output = ExitWorktreeOutput {
                    action: ExitWorktreeAction::Remove,
                    original_cwd: Some(original_cwd.clone()),
                    worktree_path: Some(worktree_path.clone()),
                    worktree_branch: worktree_branch.clone(),
                    discarded_files: Some(summary.changed_files),
                    discarded_commits: Some(summary.commits),
                    noop: None,
                    message: format!(
                        "Exited and removed worktree at {}.{} Session is now back in {}.",
                        worktree_path, discard_note, original_cwd
                    ),
                };

                return Ok(ToolResult::success(pretty_json(&output)?)
                    .with_metadata("action", json!(output.action))
                    .with_metadata("originalCwd", json!(output.original_cwd))
                    .with_metadata("worktreePath", json!(output.worktree_path))
                    .with_metadata("worktreeBranch", json!(output.worktree_branch))
                    .with_metadata("discardedFiles", json!(output.discarded_files))
                    .with_metadata("discardedCommits", json!(output.discarded_commits))
                    .with_metadata("message", json!(output.message)));
            }
        }
    }
}

fn build_discard_note(summary: ChangeSummary) -> String {
    let mut discarded = Vec::new();
    if summary.commits > 0 {
        discarded.push(format!(
            "{} {}",
            summary.commits,
            if summary.commits == 1 {
                "commit"
            } else {
                "commits"
            }
        ));
    }
    if summary.changed_files > 0 {
        discarded.push(format!(
            "{} uncommitted {}",
            summary.changed_files,
            if summary.changed_files == 1 {
                "file"
            } else {
                "files"
            }
        ));
    }

    if discarded.is_empty() {
        String::new()
    } else {
        format!(" Discarded {}.", discarded.join(" and "))
    }
}

fn require_session_id(context: &ToolContext) -> Result<String, ToolError> {
    let session_id = context.session_id.trim();
    if session_id.is_empty() {
        return Err(ToolError::execution_failed(
            "当前工具调用缺少 session_id，无法更新 session 工作目录",
        ));
    }

    Ok(session_id.to_string())
}

fn resolve_session_working_dir(
    session: &crate::session::Session,
    context: &ToolContext,
) -> PathBuf {
    if session.working_dir.as_os_str().is_empty() {
        context.working_directory.clone()
    } else {
        session.working_dir.clone()
    }
}

fn resolve_worktree_slug(value: Option<String>) -> Result<String, ToolError> {
    match value {
        Some(raw) => {
            let slug = raw.trim();
            validate_worktree_slug(slug)?;
            Ok(slug.to_string())
        }
        None => Ok(format!("worktree-{}", nanoid::nanoid!(8))),
    }
}

fn validate_worktree_slug(slug: &str) -> Result<(), ToolError> {
    if slug.is_empty() {
        return Err(ToolError::invalid_params("工作树名称不能为空"));
    }

    if slug.len() > MAX_WORKTREE_SLUG_LENGTH {
        return Err(ToolError::invalid_params(format!(
            "工作树名称不能超过 {MAX_WORKTREE_SLUG_LENGTH} 个字符"
        )));
    }

    for segment in slug.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(ToolError::invalid_params(format!(
                "非法工作树名称 \"{slug}\"：不能包含空段、. 或 .."
            )));
        }

        if !segment
            .chars()
            .all(|ch| VALID_WORKTREE_SEGMENT_CHARS.contains(ch))
        {
            return Err(ToolError::invalid_params(format!(
                "非法工作树名称 \"{slug}\"：每个 / 分段只能包含字母、数字、点、下划线和横杠"
            )));
        }
    }

    Ok(())
}

fn flatten_slug(slug: &str) -> String {
    slug.replace('/', "+")
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| ToolError::execution_failed(format!("序列化 worktree 结果失败: {error}")))
}

async fn resolve_canonical_git_root(path: &Path) -> Result<PathBuf, ToolError> {
    let show_toplevel = git_stdout(path, ["rev-parse", "--show-toplevel"]).await?;
    let git_common_dir = git_stdout(
        path,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .await?;

    let worktree_root = canonicalize_best_effort(Path::new(show_toplevel.trim()));
    let common_dir = canonicalize_best_effort(Path::new(git_common_dir.trim()));

    Ok(match common_dir.file_name().and_then(OsStr::to_str) {
        Some(".git") => common_dir
            .parent()
            .map(canonicalize_best_effort)
            .unwrap_or(worktree_root),
        _ => worktree_root,
    })
}

fn canonicalize_best_effort(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

async fn current_head(git_root: &Path) -> Result<String, ToolError> {
    git_stdout(git_root, ["rev-parse", "HEAD"]).await
}

async fn create_worktree(
    git_root: &Path,
    worktree_path: &Path,
    worktree_branch: &str,
) -> Result<(), ToolError> {
    let Some(parent) = worktree_path.parent() else {
        return Err(ToolError::execution_failed("无法解析工作树目录父路径"));
    };
    fs::create_dir_all(parent)
        .await
        .map_err(|error| ToolError::execution_failed(format!("创建工作树目录失败: {error}")))?;

    let output = run_git(
        git_root,
        [
            OsStr::new("worktree"),
            OsStr::new("add"),
            OsStr::new("-b"),
            OsStr::new(worktree_branch),
            worktree_path.as_os_str(),
            OsStr::new("HEAD"),
        ],
    )
    .await?;

    if !output.status.success() {
        return Err(ToolError::execution_failed(format!(
            "创建工作树失败: {}",
            command_failure_text(&output)
        )));
    }

    Ok(())
}

async fn remove_worktree(
    git_root: &Path,
    worktree_path: &Path,
    worktree_branch: Option<&str>,
) -> Result<(), ToolError> {
    let output = run_git(
        git_root,
        [
            OsStr::new("worktree"),
            OsStr::new("remove"),
            OsStr::new("--force"),
            worktree_path.as_os_str(),
        ],
    )
    .await?;
    if !output.status.success() {
        return Err(ToolError::execution_failed(format!(
            "删除工作树失败: {}",
            command_failure_text(&output)
        )));
    }

    if let Some(branch) = worktree_branch {
        if git_local_branch_exists(git_root, branch).await? {
            let delete_output = run_git(
                git_root,
                [OsStr::new("branch"), OsStr::new("-D"), OsStr::new(branch)],
            )
            .await?;
            if !delete_output.status.success() {
                return Err(ToolError::execution_failed(format!(
                    "删除工作树分支失败: {}",
                    command_failure_text(&delete_output)
                )));
            }
        }
    }

    Ok(())
}

async fn count_worktree_changes(
    worktree_path: &Path,
    original_head_commit: Option<&str>,
) -> Result<Option<ChangeSummary>, ToolError> {
    let status = run_git(
        worktree_path,
        [OsStr::new("status"), OsStr::new("--porcelain")],
    )
    .await?;
    if !status.status.success() {
        return Ok(None);
    }
    let changed_files = String::from_utf8_lossy(&status.stdout)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();

    let Some(original_head_commit) = original_head_commit.filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };

    let rev_range = format!("{original_head_commit}..HEAD");
    let rev_list = run_git(
        worktree_path,
        [
            OsStr::new("rev-list"),
            OsStr::new("--count"),
            OsStr::new(&rev_range),
        ],
    )
    .await?;
    if !rev_list.status.success() {
        return Ok(None);
    }

    let commits = String::from_utf8_lossy(&rev_list.stdout)
        .trim()
        .parse::<usize>()
        .ok();

    Ok(commits.map(|commits| ChangeSummary {
        changed_files,
        commits,
    }))
}

async fn git_local_branch_exists(git_root: &Path, branch: &str) -> Result<bool, ToolError> {
    let ref_name = format!("refs/heads/{branch}");
    let output = run_git(
        git_root,
        [
            OsStr::new("show-ref"),
            OsStr::new("--verify"),
            OsStr::new("--quiet"),
            OsStr::new(&ref_name),
        ],
    )
    .await?;
    Ok(output.status.success())
}

async fn git_stdout<I, S>(cwd: &Path, args: I) -> Result<String, ToolError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = run_git(cwd, args).await?;
    if !output.status.success() {
        return Err(ToolError::execution_failed(format!(
            "git 命令失败: {}",
            command_failure_text(&output)
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn run_git<I, S>(cwd: &Path, args: I) -> Result<Output, ToolError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|error| ToolError::execution_failed(format!("启动 git 失败: {error}")))?;

    Ok(output)
}

fn command_failure_text(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }

    "unknown git failure".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{SessionManager, SessionType};
    use serde_json::json;
    use tempfile::TempDir;
    use uuid::Uuid;

    #[tokio::test]
    async fn test_enter_worktree_creates_session_state() -> anyhow::Result<()> {
        let repo = init_git_repo().await?;
        let session = create_hidden_session(repo.path()).await?;
        let context =
            ToolContext::new(repo.path().to_path_buf()).with_session_id(session.id.clone());

        let tool = EnterWorktreeTool::new();
        let result = tool
            .execute(json!({ "name": "feature/demo" }), &context)
            .await?;

        assert!(result.success);

        let updated = SessionManager::get_session(&session.id, false).await?;
        let state = WorktreeSessionState::from_extension_data(&updated.extension_data)
            .expect("worktree state should exist");

        assert_eq!(state.original_cwd, repo.path().display().to_string());
        assert_eq!(state.slug, "feature/demo");
        assert_eq!(
            state.worktree_branch.as_deref(),
            Some("aster/worktree/feature+demo")
        );
        assert!(updated
            .working_dir
            .ends_with(".aster/worktrees/feature+demo"));
        assert!(Path::new(&state.worktree_path).exists());

        Ok(())
    }

    #[tokio::test]
    async fn test_exit_worktree_keep_restores_original_cwd() -> anyhow::Result<()> {
        let repo = init_git_repo().await?;
        let session = create_hidden_session(repo.path()).await?;
        let context =
            ToolContext::new(repo.path().to_path_buf()).with_session_id(session.id.clone());

        EnterWorktreeTool::new()
            .execute(json!({ "name": "keep/demo" }), &context)
            .await?;

        let after_enter = SessionManager::get_session(&session.id, false).await?;
        let state = WorktreeSessionState::from_extension_data(&after_enter.extension_data)
            .expect("worktree state should exist");

        let result = ExitWorktreeTool::new()
            .execute(json!({ "action": "keep" }), &context)
            .await?;

        assert!(result.success);
        assert!(Path::new(&state.worktree_path).exists());
        assert!(
            git_local_branch_exists(Path::new(&state.git_root), "aster/worktree/keep+demo").await?
        );

        let restored = SessionManager::get_session(&session.id, false).await?;
        assert_eq!(restored.working_dir, repo.path());
        assert!(WorktreeSessionState::from_extension_data(&restored.extension_data).is_none());

        Ok(())
    }

    #[tokio::test]
    async fn test_exit_worktree_remove_requires_discard_confirmation_when_dirty(
    ) -> anyhow::Result<()> {
        let repo = init_git_repo().await?;
        let session = create_hidden_session(repo.path()).await?;
        let context =
            ToolContext::new(repo.path().to_path_buf()).with_session_id(session.id.clone());

        EnterWorktreeTool::new()
            .execute(json!({ "name": "dirty/demo" }), &context)
            .await?;

        let updated = SessionManager::get_session(&session.id, false).await?;
        let state = WorktreeSessionState::from_extension_data(&updated.extension_data)
            .expect("worktree state should exist");
        let dirty_file = Path::new(&state.worktree_path).join("dirty.txt");
        fs::write(&dirty_file, "dirty change\n").await?;

        let error = ExitWorktreeTool::new()
            .execute(json!({ "action": "remove" }), &context)
            .await
            .expect_err("dirty worktree removal should require discard confirmation");

        assert!(error.to_string().contains("discard_changes: true"));
        assert!(Path::new(&state.worktree_path).exists());

        let after_error = SessionManager::get_session(&session.id, false).await?;
        assert!(WorktreeSessionState::from_extension_data(&after_error.extension_data).is_some());

        Ok(())
    }

    #[tokio::test]
    async fn test_exit_worktree_remove_deletes_worktree_and_restores_original_cwd(
    ) -> anyhow::Result<()> {
        let repo = init_git_repo().await?;
        let session = create_hidden_session(repo.path()).await?;
        let context =
            ToolContext::new(repo.path().to_path_buf()).with_session_id(session.id.clone());

        EnterWorktreeTool::new()
            .execute(json!({ "name": "remove/demo" }), &context)
            .await?;

        let updated = SessionManager::get_session(&session.id, false).await?;
        let state = WorktreeSessionState::from_extension_data(&updated.extension_data)
            .expect("worktree state should exist");

        let result = ExitWorktreeTool::new()
            .execute(
                json!({ "action": "remove", "discard_changes": true }),
                &context,
            )
            .await?;

        assert!(result.success);
        assert!(!Path::new(&state.worktree_path).exists());
        assert!(
            !git_local_branch_exists(Path::new(&state.git_root), "aster/worktree/remove+demo")
                .await?
        );

        let restored = SessionManager::get_session(&session.id, false).await?;
        assert_eq!(restored.working_dir, repo.path());
        assert!(WorktreeSessionState::from_extension_data(&restored.extension_data).is_none());

        Ok(())
    }

    #[tokio::test]
    async fn test_exit_worktree_noop_without_active_session() -> anyhow::Result<()> {
        let repo = init_git_repo().await?;
        let session = create_hidden_session(repo.path()).await?;
        let context =
            ToolContext::new(repo.path().to_path_buf()).with_session_id(session.id.clone());

        let result = ExitWorktreeTool::new()
            .execute(json!({ "action": "keep" }), &context)
            .await?;

        assert!(result.success);
        assert!(result
            .output
            .as_deref()
            .unwrap_or_default()
            .contains("No-op"));

        Ok(())
    }

    async fn init_git_repo() -> anyhow::Result<TempDir> {
        let temp_dir = tempfile::tempdir()?;
        run_git_ok(temp_dir.path(), ["init"]).await?;
        run_git_ok(
            temp_dir.path(),
            ["config", "user.email", "test@example.com"],
        )
        .await?;
        run_git_ok(temp_dir.path(), ["config", "user.name", "test"]).await?;
        fs::write(temp_dir.path().join("README.md"), "hello\n").await?;
        run_git_ok(temp_dir.path(), ["add", "."]).await?;
        run_git_ok(temp_dir.path(), ["commit", "-m", "init"]).await?;
        Ok(temp_dir)
    }

    async fn create_hidden_session(working_dir: &Path) -> anyhow::Result<crate::session::Session> {
        SessionManager::create_session(
            working_dir.to_path_buf(),
            format!("worktree-test-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await
    }

    async fn run_git_ok<I, S>(cwd: &Path, args: I) -> anyhow::Result<()>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let output = run_git(cwd, args).await?;
        anyhow::ensure!(
            output.status.success(),
            "git command failed: {}",
            command_failure_text(&output)
        );
        Ok(())
    }
}
