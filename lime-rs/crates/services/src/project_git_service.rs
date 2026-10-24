use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::Duration;

mod process;
use process::git_command_output_from;

mod worktrees;
pub use worktrees::{
    create_worktree, list_worktrees, remove_worktree, validate_worktree_removal, worktree_contains,
    ManagedWorktree, WorktreeOptions,
};
pub use worktrees::{read_local_environment_config_path, save_local_environment_config_path};
pub use worktrees::{restore_worktree, snapshot_worktree, WorktreeSnapshot};

const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitStatus {
    pub root_path: String,
    pub repository_root: Option<String>,
    pub has_git_repository: bool,
    pub current_branch: Option<String>,
    pub branches: Vec<String>,
    pub uncommitted_file_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitWorktree {
    pub worktree_path: String,
    pub branch: String,
    pub status: ProjectGitStatus,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommitList {
    pub root_path: String,
    pub repository_root: Option<String>,
    pub has_git_repository: bool,
    pub commits: Vec<ProjectGitCommit>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommit {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
    pub committed_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitDiff {
    pub root_path: String,
    pub repository_root: Option<String>,
    pub has_git_repository: bool,
    pub current_ref: Option<String>,
    pub comparison_base_ref: Option<String>,
    pub patch: String,
    pub uncommitted_file_count: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectGitDiffBase {
    #[default]
    Unstaged,
    Staged,
    Commit,
    Branch,
    PreviousConversation,
}

pub async fn read_status(root_path: &str) -> Result<ProjectGitStatus, String> {
    let root = required_root_path(root_path)?;
    if !has_git_ancestor(&root) {
        return Ok(non_repository_status(root_path));
    }
    let repository_root = match git_output(&root, &["rev-parse", "--show-toplevel"]).await {
        Ok(output) => output,
        Err(_) => return Ok(non_repository_status(root_path)),
    };

    let repository_root = repository_root.trim().to_string();
    let repository_path = PathBuf::from(&repository_root);
    let current_branch = read_current_branch(&root).await?;
    let branches = read_branches(&repository_path).await?;
    let uncommitted_file_count = read_uncommitted_file_count(&root).await?;

    Ok(ProjectGitStatus {
        root_path: root_path.to_string(),
        repository_root: Some(repository_root),
        has_git_repository: true,
        current_branch,
        branches,
        uncommitted_file_count,
    })
}

fn has_git_ancestor(root: &Path) -> bool {
    let absolute_root = if root.is_absolute() {
        root.to_path_buf()
    } else {
        match std::env::current_dir() {
            Ok(current_dir) => current_dir.join(root),
            Err(_) => return false,
        }
    };
    absolute_root
        .ancestors()
        .any(|ancestor| ancestor.join(".git").exists())
}

fn non_repository_status(root_path: &str) -> ProjectGitStatus {
    ProjectGitStatus {
        root_path: root_path.to_string(),
        repository_root: None,
        has_git_repository: false,
        current_branch: None,
        branches: Vec::new(),
        uncommitted_file_count: 0,
    }
}

pub async fn read_diff(
    root_path: &str,
    context_lines: Option<u32>,
    base: Option<ProjectGitDiffBase>,
    commit_sha: Option<&str>,
) -> Result<ProjectGitDiff, String> {
    let status = read_status(root_path).await?;
    if !status.has_git_repository {
        return Ok(ProjectGitDiff {
            root_path: status.root_path,
            repository_root: status.repository_root,
            has_git_repository: false,
            current_ref: None,
            comparison_base_ref: None,
            patch: String::new(),
            uncommitted_file_count: 0,
        });
    }

    let root = required_root_path(root_path)?;
    let unified_arg = format!("--unified={}", context_lines.unwrap_or(3).min(100));
    let base = base.unwrap_or_default();
    let diff_result = match base {
        ProjectGitDiffBase::Unstaged => {
            ProjectGitPatchResult::new(read_unstaged_patch(&root, unified_arg.as_str()).await?)
        }
        ProjectGitDiffBase::Staged => git_diff_output(
            &root,
            &[
                "diff",
                "--cached",
                "--no-textconv",
                "--no-ext-diff",
                "--submodule=short",
                "--ignore-submodules=dirty",
                "--no-color",
                unified_arg.as_str(),
            ],
        )
        .await
        .map(ProjectGitPatchResult::new)?,
        ProjectGitDiffBase::Commit => {
            let commit_sha = validate_commit_sha(commit_sha)?;
            ProjectGitPatchResult {
                patch: read_commit_patch(&root, commit_sha, unified_arg.as_str()).await?,
                current_ref: status.current_branch.clone(),
                comparison_base_ref: Some(commit_sha.to_string()),
            }
        }
        ProjectGitDiffBase::Branch => {
            read_branch_patch(&root, &status, unified_arg.as_str()).await?
        }
        ProjectGitDiffBase::PreviousConversation => {
            return Err("上轮对话基准不由 Git 后端读取".to_string());
        }
    };

    Ok(ProjectGitDiff {
        root_path: status.root_path,
        repository_root: status.repository_root,
        has_git_repository: true,
        current_ref: diff_result.current_ref,
        comparison_base_ref: diff_result.comparison_base_ref,
        patch: diff_result.patch,
        uncommitted_file_count: status.uncommitted_file_count,
    })
}

pub async fn list_commits(
    root_path: &str,
    limit: Option<u32>,
) -> Result<ProjectGitCommitList, String> {
    let status = read_status(root_path).await?;
    if !status.has_git_repository {
        return Ok(ProjectGitCommitList {
            root_path: status.root_path,
            repository_root: status.repository_root,
            has_git_repository: false,
            commits: Vec::new(),
        });
    }

    let root = required_root_path(root_path)?;
    let limit = limit.unwrap_or(30).clamp(1, 100).to_string();
    let output = git_output(
        &root,
        &[
            "log",
            "--date=iso-strict",
            "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1e",
            "-n",
            &limit,
        ],
    )
    .await?;
    let commits = output
        .split('\x1e')
        .filter_map(parse_commit_log_record)
        .collect();

    Ok(ProjectGitCommitList {
        root_path: status.root_path,
        repository_root: status.repository_root,
        has_git_repository: true,
        commits,
    })
}

async fn read_unstaged_patch(root: &Path, unified_arg: &str) -> Result<String, String> {
    let tracked_patch = git_diff_output(
        root,
        &[
            "diff",
            "--no-textconv",
            "--no-ext-diff",
            "--submodule=short",
            "--ignore-submodules=dirty",
            "--no-color",
            unified_arg,
        ],
    )
    .await?;
    let untracked_patch = read_untracked_patch(root, unified_arg).await?;
    Ok(join_patch_sections([tracked_patch, untracked_patch]))
}

async fn read_untracked_patch(root: &Path, unified_arg: &str) -> Result<String, String> {
    let output = git_output(root, &["ls-files", "--others", "--exclude-standard"]).await?;
    let null_path = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let mut patch = String::new();

    for file in output
        .lines()
        .map(str::trim)
        .filter(|file| !file.is_empty())
    {
        let diff = git_diff_output(
            root,
            &[
                "diff",
                "--no-textconv",
                "--no-ext-diff",
                "--submodule=short",
                "--ignore-submodules=dirty",
                "--no-color",
                unified_arg,
                "--no-index",
                "--",
                null_path,
                file,
            ],
        )
        .await?;
        append_patch_section(&mut patch, &diff);
    }

    Ok(patch)
}

fn join_patch_sections(sections: impl IntoIterator<Item = String>) -> String {
    let mut patch = String::new();
    for section in sections {
        append_patch_section(&mut patch, &section);
    }
    patch
}

fn append_patch_section(patch: &mut String, section: &str) {
    if section.trim().is_empty() {
        return;
    }
    if !patch.is_empty() {
        patch.push('\n');
    }
    patch.push_str(section.trim());
}

async fn read_commit_patch(
    root: &Path,
    commit_sha: &str,
    unified_arg: &str,
) -> Result<String, String> {
    git_diff_output(
        root,
        &[
            "show",
            "--format=",
            "--no-textconv",
            "--no-ext-diff",
            "--submodule=short",
            "--ignore-submodules=dirty",
            "--no-color",
            unified_arg,
            commit_sha,
        ],
    )
    .await
}

async fn read_branch_patch(
    root: &Path,
    status: &ProjectGitStatus,
    unified_arg: &str,
) -> Result<ProjectGitPatchResult, String> {
    let preferred_ref = resolve_current_upstream_ref(root, status)
        .await?
        .or_else(|| resolve_default_base_branch(status).map(ToString::to_string));
    let Some(preferred_ref) = preferred_ref else {
        return Ok(ProjectGitPatchResult::new(String::new()));
    };
    let Some(merge_base) =
        git_output_optional(root, &["merge-base", "HEAD", &preferred_ref]).await?
    else {
        return Ok(ProjectGitPatchResult::new(String::new()));
    };

    let patch = join_patch_sections([
        git_diff_output(
            root,
            &[
                "diff",
                "--no-textconv",
                "--no-ext-diff",
                "--submodule=short",
                "--ignore-submodules=dirty",
                "--no-color",
                unified_arg,
                &merge_base,
            ],
        )
        .await?,
        read_untracked_patch(root, unified_arg).await?,
    ]);

    Ok(ProjectGitPatchResult {
        patch,
        current_ref: status.current_branch.clone(),
        comparison_base_ref: Some(preferred_ref),
    })
}

fn parse_commit_log_record(record: &str) -> Option<ProjectGitCommit> {
    let trimmed = record.trim_matches('\n');
    if trimmed.trim().is_empty() {
        return None;
    }
    let mut parts = trimmed.split('\x1f');
    let sha = parts.next()?.trim().to_string();
    let short_sha = parts.next()?.trim().to_string();
    let subject = parts.next()?.trim().to_string();
    let author_name = parts.next()?.trim().to_string();
    let author_email = parts.next()?.trim().to_string();
    let committed_at = parts.next()?.trim().to_string();
    if sha.is_empty() || short_sha.is_empty() {
        return None;
    }
    Some(ProjectGitCommit {
        sha,
        short_sha,
        subject,
        author_name,
        author_email,
        committed_at,
    })
}

fn resolve_default_base_branch(status: &ProjectGitStatus) -> Option<&str> {
    let current = status.current_branch.as_deref();
    ["main", "master", "trunk", "develop"]
        .into_iter()
        .find(|branch| {
            current != Some(*branch) && status.branches.iter().any(|item| item == branch)
        })
        .or_else(|| {
            status
                .branches
                .iter()
                .map(String::as_str)
                .find(|branch| current != Some(*branch))
        })
}

async fn resolve_current_upstream_ref(
    root: &Path,
    status: &ProjectGitStatus,
) -> Result<Option<String>, String> {
    let Some(current_branch) = status.current_branch.as_deref() else {
        return Ok(None);
    };
    git_output_optional(
        root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            &format!("{current_branch}@{{upstream}}"),
        ],
    )
    .await
}

fn validate_commit_sha(commit_sha: Option<&str>) -> Result<&str, String> {
    let commit_sha = commit_sha
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "提交基准需要 commitSha".to_string())?;
    if commit_sha.len() > 64 {
        return Err("commitSha 过长".to_string());
    }
    if !commit_sha.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("commitSha 格式无效".to_string());
    }
    Ok(commit_sha)
}

pub async fn checkout_branch(root_path: &str, branch: &str) -> Result<ProjectGitStatus, String> {
    let root = required_root_path(root_path)?;
    validate_branch_name(branch)?;
    git_output(&root, &["switch", branch]).await?;
    read_status(root_path).await
}

pub async fn create_branch(root_path: &str, branch: &str) -> Result<ProjectGitStatus, String> {
    let root = required_root_path(root_path)?;
    validate_branch_name(branch)?;
    git_output(&root, &["switch", "-c", branch]).await?;
    read_status(root_path).await
}

fn required_root_path(root_path: &str) -> Result<PathBuf, String> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() {
        return Err("项目路径不能为空".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

async fn read_current_branch(root: &Path) -> Result<Option<String>, String> {
    let branch = git_output(root, &["branch", "--show-current"]).await?;
    let branch = branch.trim();
    if !branch.is_empty() {
        return Ok(Some(branch.to_string()));
    }

    let commit = git_output(root, &["rev-parse", "--short", "HEAD"]).await?;
    let commit = commit.trim();
    Ok((!commit.is_empty()).then(|| commit.to_string()))
}

async fn read_branches(root: &Path) -> Result<Vec<String>, String> {
    let output = git_output(
        root,
        &[
            "for-each-ref",
            "--sort=refname",
            "--format=%(refname:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )
    .await?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty() && !branch.ends_with("/HEAD"))
        .map(ToString::to_string)
        .collect())
}

#[derive(Debug, Clone, Default)]
struct ProjectGitPatchResult {
    patch: String,
    current_ref: Option<String>,
    comparison_base_ref: Option<String>,
}

impl ProjectGitPatchResult {
    fn new(patch: String) -> Self {
        Self {
            patch,
            current_ref: None,
            comparison_base_ref: None,
        }
    }
}

async fn read_uncommitted_file_count(root: &Path) -> Result<u32, String> {
    let output = git_output(root, &["status", "--porcelain", "--untracked-files=all"]).await?;
    Ok(output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count() as u32)
}

async fn git_output(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_command_output_from(Path::new("git"), root, args, GIT_COMMAND_TIMEOUT).await?;
    output_to_string(output)
}

async fn git_output_optional(root: &Path, args: &[&str]) -> Result<Option<String>, String> {
    let output = git_command_output_from(Path::new("git"), root, args, GIT_COMMAND_TIMEOUT).await?;
    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((!value.is_empty()).then_some(value));
    }
    Ok(None)
}

async fn git_diff_output(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_command_output_from(Path::new("git"), root, args, GIT_COMMAND_TIMEOUT).await?;
    let code = output.status.code();
    if output.status.success() || code == Some(1) {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
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

fn validate_branch_name(branch: &str) -> Result<(), String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("分支名不能为空".to_string());
    }
    if branch.len() > 128 {
        return Err("分支名过长".to_string());
    }
    if branch.starts_with('-') || branch.starts_with('/') || branch.ends_with('/') {
        return Err("分支名格式无效".to_string());
    }
    if branch.ends_with(".lock") || branch.contains("..") || branch.contains("@{") {
        return Err("分支名格式无效".to_string());
    }
    if branch.chars().any(|ch| {
        ch.is_control()
            || ch.is_whitespace()
            || matches!(ch, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
    }) {
        return Err("分支名格式无效".to_string());
    }
    if branch
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("分支名格式无效".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command as StdCommand;
    #[cfg(unix)]
    use std::time::Instant;
    use tempfile::TempDir;

    fn git_available() -> bool {
        StdCommand::new("git").arg("--version").output().is_ok()
    }

    fn run_git(root: &Path, args: &[&str]) {
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
    }

    fn init_repo() -> Option<(TempDir, PathBuf)> {
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

    #[tokio::test]
    async fn status_returns_local_mode_for_plain_directory() {
        let temp = TempDir::new().expect("temp dir");
        let status = read_status(&temp.path().to_string_lossy())
            .await
            .expect("status");
        assert!(!status.has_git_repository);
        assert!(status.current_branch.is_none());
        assert!(status.branches.is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn git_command_timeout_stops_waiting_for_a_stuck_process() {
        let temp = TempDir::new().expect("temp dir");
        let started = Instant::now();

        let error = git_command_output_from(
            Path::new("/bin/sh"),
            temp.path(),
            &["-c", "sleep 30"],
            Duration::from_millis(50),
        )
        .await
        .expect_err("command should time out");

        assert!(error.contains("git 命令超时"), "unexpected error: {error}");
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "timeout did not bound the command: {:?}",
            started.elapsed()
        );
    }

    #[tokio::test]
    async fn status_reads_branch_and_dirty_count() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        fs::write(repo.join("note.txt"), "dirty").expect("write dirty");

        let status = read_status(&repo.to_string_lossy()).await.expect("status");

        assert!(status.has_git_repository);
        assert_eq!(status.current_branch.as_deref(), Some("main"));
        assert!(status.branches.iter().any(|branch| branch == "main"));
        assert_eq!(status.uncommitted_file_count, 1);
    }

    #[tokio::test]
    async fn status_reads_remote_tracking_branches() {
        let Some((temp, repo)) = init_repo() else {
            return;
        };
        let remote = temp.path().join("remote.git");
        run_git(temp.path(), &["init", "--bare", "remote.git"]);
        run_git(
            &repo,
            &["remote", "add", "origin", &remote.to_string_lossy()],
        );
        run_git(&repo, &["push", "-u", "origin", "main"]);

        let status = read_status(&repo.to_string_lossy()).await.expect("status");

        assert!(status.branches.iter().any(|branch| branch == "main"));
        assert!(status.branches.iter().any(|branch| branch == "origin/main"));
    }

    #[tokio::test]
    async fn diff_reads_unstaged_patch() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        fs::write(repo.join("README.md"), "hello\nworld\n").expect("write readme");

        let diff = read_diff(&repo.to_string_lossy(), Some(1), None, None)
            .await
            .expect("diff");

        assert!(diff.has_git_repository);
        assert!(diff.patch.contains("diff --git a/README.md b/README.md"));
        assert!(diff.patch.contains("+world"));
        assert_eq!(diff.uncommitted_file_count, 1);
    }

    #[tokio::test]
    async fn diff_reads_staged_patch() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        fs::write(repo.join("README.md"), "hello\nstaged\n").expect("write readme");
        run_git(&repo, &["add", "README.md"]);

        let diff = read_diff(
            &repo.to_string_lossy(),
            Some(1),
            Some(ProjectGitDiffBase::Staged),
            None,
        )
        .await
        .expect("diff");

        assert!(diff.has_git_repository);
        assert!(diff.patch.contains("diff --git a/README.md b/README.md"));
        assert!(diff.patch.contains("+staged"));
    }

    #[tokio::test]
    async fn diff_reads_branch_merge_base_patch() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        run_git(&repo, &["switch", "-c", "feature/review"]);
        fs::write(repo.join("README.md"), "hello\nbranch\n").expect("write readme");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "feature change"]);

        let diff = read_diff(
            &repo.to_string_lossy(),
            Some(3),
            Some(ProjectGitDiffBase::Branch),
            None,
        )
        .await
        .expect("diff");

        assert!(diff.has_git_repository);
        assert_eq!(diff.current_ref.as_deref(), Some("feature/review"));
        assert_eq!(diff.comparison_base_ref.as_deref(), Some("main"));
        assert!(diff.patch.contains("diff --git a/README.md b/README.md"));
        assert!(diff.patch.contains("+branch"));
    }

    #[tokio::test]
    async fn diff_reads_current_branch_upstream_patch() {
        let Some((temp, repo)) = init_repo() else {
            return;
        };
        let remote = temp.path().join("remote.git");
        run_git(temp.path(), &["init", "--bare", "remote.git"]);
        run_git(
            &repo,
            &["remote", "add", "origin", &remote.to_string_lossy()],
        );
        run_git(&repo, &["push", "-u", "origin", "main"]);
        fs::write(repo.join("README.md"), "hello\nupstream diff\n").expect("write readme");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "local branch change"]);
        fs::write(repo.join("scratch.txt"), "untracked\n").expect("write untracked");

        let diff = read_diff(
            &repo.to_string_lossy(),
            Some(3),
            Some(ProjectGitDiffBase::Branch),
            None,
        )
        .await
        .expect("diff");

        assert!(diff.has_git_repository);
        assert_eq!(diff.current_ref.as_deref(), Some("main"));
        assert_eq!(diff.comparison_base_ref.as_deref(), Some("origin/main"));
        assert!(diff.patch.contains("diff --git a/README.md b/README.md"));
        assert!(diff.patch.contains("+upstream diff"));
        assert!(diff
            .patch
            .contains("diff --git a/scratch.txt b/scratch.txt"));
        assert!(diff.patch.contains("+untracked"));
    }

    #[tokio::test]
    async fn branch_diff_includes_untracked_files() {
        let Some((temp, repo)) = init_repo() else {
            return;
        };
        let remote = temp.path().join("remote.git");
        run_git(temp.path(), &["init", "--bare", "remote.git"]);
        run_git(
            &repo,
            &["remote", "add", "origin", &remote.to_string_lossy()],
        );
        run_git(&repo, &["push", "-u", "origin", "main"]);
        fs::write(repo.join("scratch.txt"), "untracked\n").expect("write untracked");

        let diff = read_diff(
            &repo.to_string_lossy(),
            Some(3),
            Some(ProjectGitDiffBase::Branch),
            None,
        )
        .await
        .expect("diff");

        assert!(diff
            .patch
            .contains("diff --git a/scratch.txt b/scratch.txt"));
        assert!(diff.patch.contains("+untracked"));
    }

    #[tokio::test]
    async fn diff_returns_empty_patch_for_plain_directory() {
        let temp = TempDir::new().expect("temp dir");
        let diff = read_diff(&temp.path().to_string_lossy(), Some(3), None, None)
            .await
            .expect("diff");
        assert!(!diff.has_git_repository);
        assert!(diff.patch.is_empty());
    }

    #[tokio::test]
    async fn commits_list_reads_recent_commits() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        fs::write(repo.join("README.md"), "hello\nsecond\n").expect("write readme");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "second change"]);

        let list = list_commits(&repo.to_string_lossy(), Some(5))
            .await
            .expect("commits");

        assert!(list.has_git_repository);
        assert!(list.commits.len() >= 2);
        assert_eq!(list.commits[0].subject, "second change");
        assert!(!list.commits[0].sha.is_empty());
        assert!(!list.commits[0].short_sha.is_empty());
    }

    #[tokio::test]
    async fn diff_reads_commit_patch() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };
        fs::write(repo.join("README.md"), "hello\ncommitted\n").expect("write readme");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "committed change"]);
        let commit_sha = git_output(&repo, &["rev-parse", "HEAD"])
            .await
            .expect("head");

        let diff = read_diff(
            &repo.to_string_lossy(),
            Some(3),
            Some(ProjectGitDiffBase::Commit),
            Some(commit_sha.trim()),
        )
        .await
        .expect("diff");

        assert!(diff.has_git_repository);
        assert!(diff.patch.contains("diff --git a/README.md b/README.md"));
        assert!(diff.patch.contains("+committed"));
    }

    #[tokio::test]
    async fn diff_commit_requires_sha() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };

        let error = read_diff(
            &repo.to_string_lossy(),
            Some(3),
            Some(ProjectGitDiffBase::Commit),
            None,
        )
        .await
        .expect_err("commit sha required");

        assert!(error.contains("commitSha"));
    }

    #[tokio::test]
    async fn branch_create_and_checkout_refresh_status() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };

        let created = create_branch(&repo.to_string_lossy(), "feature/demo")
            .await
            .expect("create branch");
        assert_eq!(created.current_branch.as_deref(), Some("feature/demo"));

        let checked_out = checkout_branch(&repo.to_string_lossy(), "main")
            .await
            .expect("checkout");
        assert_eq!(checked_out.current_branch.as_deref(), Some("main"));
    }

    #[test]
    fn branch_validation_rejects_injection_like_names() {
        assert!(validate_branch_name("-bad").is_err());
        assert!(validate_branch_name("bad name").is_err());
        assert!(validate_branch_name("bad..name").is_err());
        assert!(validate_branch_name("bad~name").is_err());
    }

    #[tokio::test]
    async fn worktree_create_returns_new_worktree_status() {
        let Some((_temp, repo)) = init_repo() else {
            return;
        };

        let root = repo.parent().unwrap().join("Managed Worktrees");
        run_git(
            &repo,
            &["remote", "add", "origin", "/missing/local-fixture-remote"],
        );
        let worktree = create_worktree(
            &repo.to_string_lossy(),
            Some("agent-demo"),
            Some("main"),
            &WorktreeOptions {
                root: root.clone(),
                refresh_upstream: true,
            },
        )
        .await
        .expect("best-effort refresh failure must not block creation");
        assert!(
            PathBuf::from(&worktree.worktree_path).starts_with(fs::canonicalize(&root).unwrap())
        );

        assert!(PathBuf::from(&worktree.worktree_path).exists());
        assert_eq!(worktree.branch, "main");
        assert!(worktree.status.has_git_repository);
        assert!(worktree.status.current_branch.is_some());
    }
}
