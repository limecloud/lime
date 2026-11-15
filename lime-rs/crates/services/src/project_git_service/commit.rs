//! 创建一次新的 Git 提交。
//!
//! 只允许“暂存 + 提交”这一条路径：不 amend、不 reset、不 force，也不改写已有历史。

use super::process::git_command_output_from;
use super::{read_status, required_root_path};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Output;
use std::time::Duration;

/// 提交信息上限，按字符计。
pub const MAX_COMMIT_MESSAGE_CHARS: usize = 10_000;
/// 单次提交允许显式指定的路径上限。
pub const MAX_COMMIT_PATH_COUNT: usize = 256;
const MAX_COMMIT_PATH_CHARS: usize = 4_096;

/// 提交可能触发用户自己的钩子与签名流程，单独给更宽的预算。
const GIT_COMMIT_TIMEOUT: Duration = Duration::from_secs(30);
const GIT_STAGE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectGitCommitStatus {
    Committed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommitResult {
    pub root_path: String,
    pub repository_root: Option<String>,
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub status: ProjectGitCommitStatus,
}

/// 暂存并提交，默认 `git add -A`，指定 `paths` 时只处理这些路径。
pub async fn commit(
    root_path: &str,
    message: &str,
    paths: Option<Vec<String>>,
) -> Result<ProjectGitCommitResult, String> {
    let message = validate_commit_message(message)?;
    let paths = validate_commit_paths(paths)?;
    let status = read_status(root_path).await?;
    if !status.has_git_repository {
        return Err("当前工作区不是 Git 仓库".to_string());
    }
    let root = required_root_path(root_path)?;

    stage_changes(&root, paths.as_deref()).await?;
    if !has_staged_changes(&root, paths.as_deref()).await? {
        return Err("没有可提交的更改".to_string());
    }
    commit_staged_changes(&root, message, paths.as_deref()).await?;

    let output = git_output_with_timeout(
        &root,
        &["log", "-1", "--format=%H%x1f%h%x1f%s"],
        GIT_STAGE_TIMEOUT,
    )
    .await?;
    let mut parts = output.splitn(3, '\x1f');
    let sha = parts.next().unwrap_or_default().trim().to_string();
    let short_sha = parts.next().unwrap_or_default().trim().to_string();
    let subject = parts.next().unwrap_or_default().trim().to_string();
    if sha.is_empty() || short_sha.is_empty() {
        return Err("提交已完成，但无法读取新提交的 SHA".to_string());
    }

    Ok(ProjectGitCommitResult {
        root_path: status.root_path,
        repository_root: status.repository_root,
        sha,
        short_sha,
        subject,
        status: ProjectGitCommitStatus::Committed,
    })
}

fn validate_commit_message(message: &str) -> Result<&str, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("提交信息不能为空".to_string());
    }
    if message.contains('\0') {
        return Err("提交信息包含无效字符".to_string());
    }
    if message.chars().count() > MAX_COMMIT_MESSAGE_CHARS {
        return Err(format!(
            "提交信息过长（最多 {MAX_COMMIT_MESSAGE_CHARS} 个字符）"
        ));
    }
    Ok(message)
}

fn validate_commit_paths(paths: Option<Vec<String>>) -> Result<Option<Vec<String>>, String> {
    let Some(paths) = paths else {
        return Ok(None);
    };
    if paths.is_empty() {
        return Err("提交路径不能为空".to_string());
    }
    if paths.len() > MAX_COMMIT_PATH_COUNT {
        return Err(format!("提交路径过多（最多 {MAX_COMMIT_PATH_COUNT} 个）"));
    }
    let mut validated = Vec::with_capacity(paths.len());
    for raw in paths {
        let path = validate_commit_path(&raw)?;
        if !validated.iter().any(|item| item == &path) {
            validated.push(path);
        }
    }
    Ok(Some(validated))
}

fn validate_commit_path(raw: &str) -> Result<String, String> {
    let path = raw.trim();
    if path.is_empty() {
        return Err("提交路径不能为空".to_string());
    }
    if path.chars().count() > MAX_COMMIT_PATH_CHARS {
        return Err("提交路径过长".to_string());
    }
    if path.contains('\0') {
        return Err("提交路径包含无效字符".to_string());
    }
    if path.starts_with(['/', '\\', '-', ':']) {
        return Err(format!("提交路径必须是仓库内相对路径: {path}"));
    }
    if is_windows_absolute_path(path) {
        return Err(format!("提交路径必须是仓库内相对路径: {path}"));
    }
    let normalized = path.replace('\\', "/");
    if normalized.split('/').any(|segment| segment.is_empty()) {
        return Err(format!("提交路径格式无效: {path}"));
    }
    if normalized
        .split('/')
        .any(|segment| segment == "." || segment == ".." || segment == ".git")
    {
        return Err(format!("提交路径格式无效: {path}"));
    }
    Ok(path.to_string())
}

fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

async fn stage_changes(root: &Path, paths: Option<&[String]>) -> Result<(), String> {
    let mut args = vec!["add", "-A"];
    if let Some(paths) = paths {
        args.push("--");
        args.extend(paths.iter().map(String::as_str));
    }
    git_output_with_timeout(root, &args, GIT_STAGE_TIMEOUT).await?;
    Ok(())
}

async fn has_staged_changes(root: &Path, paths: Option<&[String]>) -> Result<bool, String> {
    let mut args = vec!["diff", "--cached", "--name-only"];
    if let Some(paths) = paths {
        args.push("--");
        args.extend(paths.iter().map(String::as_str));
    }
    let output = git_output_with_timeout(root, &args, GIT_STAGE_TIMEOUT).await?;
    Ok(!output.trim().is_empty())
}

async fn commit_staged_changes(
    root: &Path,
    message: &str,
    paths: Option<&[String]>,
) -> Result<(), String> {
    let mut args = vec!["commit", "-m", message];
    if let Some(paths) = paths {
        args.push("--");
        args.extend(paths.iter().map(String::as_str));
    }
    git_output_with_timeout(root, &args, GIT_COMMIT_TIMEOUT).await?;
    Ok(())
}

async fn git_output_with_timeout(
    root: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let output = git_command_output_from(Path::new("git"), root, args, timeout).await?;
    output_to_string(output)
}

fn output_to_string(output: Output) -> Result<String, String> {
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err(format!("git 命令失败: {}", output.status))
    } else {
        Err(stderr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn git_available() -> bool {
        StdCommand::new("git").arg("--version").output().is_ok()
    }

    fn run_git(root: &Path, args: &[&str]) -> String {
        let output = StdCommand::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn init_repo() -> Option<(TempDir, std::path::PathBuf)> {
        if !git_available() {
            return None;
        }
        let temp = TempDir::new().expect("temp dir");
        let repo = temp.path().join("repo");
        fs::create_dir_all(&repo).expect("create repo");
        run_git(&repo, &["init"]);
        run_git(&repo, &["config", "user.email", "test@example.com"]);
        run_git(&repo, &["config", "user.name", "Test User"]);
        fs::write(repo.join("README.md"), "hello").expect("write readme");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "init"]);
        run_git(&repo, &["branch", "-M", "main"]);
        Some((temp, repo))
    }

    fn head(repo: &Path) -> String {
        run_git(repo, &["rev-parse", "HEAD"])
    }

    #[tokio::test]
    async fn commit_stages_all_and_returns_new_head() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        let parent = head(&repo);
        fs::write(repo.join("README.md"), "hello\nworld\n").expect("write readme");
        fs::write(repo.join("new.txt"), "new file\n").expect("write new file");

        let result = commit(&repo.to_string_lossy(), "  feat: add world  ", None)
            .await
            .expect("commit");

        assert_eq!(result.status, ProjectGitCommitStatus::Committed);
        assert_eq!(result.subject, "feat: add world");
        assert!(!result.sha.is_empty());
        assert!(result.sha.starts_with(&result.short_sha));
        assert_eq!(head(&repo), result.sha);
        assert_eq!(
            run_git(&repo, &["rev-parse", "HEAD^"]),
            parent,
            "new commit must extend, not rewrite, existing history"
        );
        assert_eq!(run_git(&repo, &["rev-list", "--count", "HEAD"]), "2");
        assert_eq!(run_git(&repo, &["status", "--porcelain"]), "");
        let files = run_git(&repo, &["show", "--name-only", "--format=", "HEAD"]);
        assert!(files.contains("README.md"));
        assert!(files.contains("new.txt"));
    }

    #[tokio::test]
    async fn commit_with_paths_only_commits_selected_paths() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        fs::write(repo.join("a.txt"), "a\n").expect("write a");
        fs::write(repo.join("b.txt"), "b\n").expect("write b");

        let result = commit(
            &repo.to_string_lossy(),
            "feat: only a",
            Some(vec!["a.txt".to_string()]),
        )
        .await
        .expect("commit");

        assert_eq!(result.subject, "feat: only a");
        let files = run_git(&repo, &["show", "--name-only", "--format=", "HEAD"]);
        assert_eq!(files, "a.txt");
        let status = run_git(&repo, &["status", "--porcelain"]);
        assert!(status.contains("?? b.txt"), "unexpected status: {status}");
    }

    #[tokio::test]
    async fn commit_rejects_plain_directory_without_creating_git_state() {
        let temp = TempDir::new().expect("temp dir");
        let error = commit(&temp.path().to_string_lossy(), "init", None)
            .await
            .expect_err("plain directory must fail");
        assert!(error.contains("Git 仓库"), "unexpected error: {error}");
        assert!(!temp.path().join(".git").exists());
    }

    #[tokio::test]
    async fn commit_rejects_empty_or_blank_message_without_staging() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        fs::write(repo.join("dirty.txt"), "dirty\n").expect("write dirty");
        let before = head(&repo);

        for message in ["", "   ", "\n\t  \n"] {
            let error = commit(&repo.to_string_lossy(), message, None)
                .await
                .expect_err("blank message must fail");
            assert!(error.contains("提交信息不能为空"), "unexpected: {error}");
        }

        assert_eq!(head(&repo), before);
        assert_eq!(run_git(&repo, &["status", "--porcelain"]), "?? dirty.txt");
    }

    #[tokio::test]
    async fn commit_rejects_no_changes_without_creating_commit() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        let before = head(&repo);

        let error = commit(&repo.to_string_lossy(), "empty", None)
            .await
            .expect_err("clean tree must fail");

        assert!(error.contains("没有可提交的更改"), "unexpected: {error}");
        assert_eq!(head(&repo), before);
    }

    #[tokio::test]
    async fn commit_reports_git_failure_and_keeps_existing_history() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        run_git(&repo, &["config", "commit.gpgsign", "true"]);
        run_git(&repo, &["config", "gpg.program", "lime-test-missing-gpg"]);
        fs::write(repo.join("README.md"), "hello\nsigned\n").expect("write readme");
        let before = head(&repo);

        let error = commit(&repo.to_string_lossy(), "feat: signed", None)
            .await
            .expect_err("signing failure must surface");

        assert!(!error.trim().is_empty());
        assert_eq!(head(&repo), before, "failed commit must not move HEAD");
    }

    #[tokio::test]
    async fn commit_rejects_path_traversal_before_running_git() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        fs::write(repo.join("README.md"), "hello\nworld\n").expect("write readme");
        let before = head(&repo);

        for path in [
            "../outside.txt",
            "/etc/passwd",
            "C:\\temp\\a.txt",
            ".git/config",
        ] {
            let error = commit(
                &repo.to_string_lossy(),
                "bad path",
                Some(vec![path.to_string()]),
            )
            .await
            .expect_err("unsafe path must fail");
            assert!(
                error.contains("提交路径"),
                "unexpected error for {path}: {error}"
            );
        }

        assert_eq!(head(&repo), before);
    }
}
