//! 托管工作树：目录策略、清单和快照恢复共用现有 Git 执行边界。

use super::{
    git_command_output_from, output_to_string, read_status, validate_branch_name,
    ProjectGitWorktree, GIT_COMMAND_TIMEOUT,
};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

mod inventory;
mod paths;
pub use inventory::{list_worktrees, remove_worktree, validate_worktree_removal, ManagedWorktree};
pub use paths::worktree_contains;
mod local_environment;
mod snapshots;
pub use local_environment::{
    read_local_environment_config_path, save_local_environment_config_path,
};
pub use snapshots::{restore_worktree, snapshot_worktree, WorktreeSnapshot};

#[derive(Debug, Clone)]
pub struct WorktreeOptions {
    pub root: PathBuf,
    pub refresh_upstream: bool,
}

pub async fn create_worktree(
    root_path: &str,
    name: Option<&str>,
    base_branch: Option<&str>,
    options: &WorktreeOptions,
) -> Result<ProjectGitWorktree, String> {
    let status = read_status(root_path).await?;
    if !status.has_git_repository {
        return Err("当前项目不是 Git 仓库".to_string());
    }

    let repository_root = status
        .repository_root
        .as_deref()
        .ok_or_else(|| "无法读取 Git 仓库根目录".to_string())?;
    let repository_path = PathBuf::from(repository_root);
    if !options.root.is_absolute() {
        return Err("工作树根目录必须为绝对路径".to_string());
    }
    let repository_name = repository_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("project");
    let slug = resolve_worktree_slug(name);
    let branch = base_branch
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .or(status.current_branch.as_deref())
        .unwrap_or("HEAD")
        .to_string();
    if branch != "HEAD" {
        validate_branch_name(&branch)?;
    }
    tokio::fs::create_dir_all(&options.root)
        .await
        .map_err(|error| format!("无法创建工作树根目录: {error}"))?;
    let parent = tokio::fs::canonicalize(&options.root)
        .await
        .map_err(|error| format!("无法解析工作树根目录: {error}"))?;
    let worktree_path = parent.join(format!("{repository_name}-{slug}"));

    if worktree_path.exists() {
        return Err(format!(
            "工作树目录已存在: {}",
            worktree_path.to_string_lossy()
        ));
    }

    if options.refresh_upstream {
        let refreshed = git_command_output_from(
            Path::new("git"),
            &repository_path,
            &[
                "-c",
                "credential.interactive=false",
                "fetch",
                "--all",
                "--prune",
            ],
            GIT_COMMAND_TIMEOUT,
        )
        .await;
        if !matches!(refreshed, Ok(ref output) if output.status.success()) {
            tracing::warn!("Upstream refresh failed; continuing requested worktree creation");
        }
    }

    git_worktree_add(&repository_path, &branch, &worktree_path).await?;
    let worktree_path_string = worktree_path.to_string_lossy().to_string();
    let status = read_status(&worktree_path_string).await?;
    Ok(ProjectGitWorktree {
        worktree_path: worktree_path_string,
        branch,
        status,
    })
}

async fn git_worktree_add(root: &Path, branch: &str, path: &Path) -> Result<(), String> {
    let path = path.to_string_lossy();
    let output = git_command_output_from(
        Path::new("git"),
        root,
        &["worktree", "add", "--detach", path.as_ref(), branch],
        GIT_COMMAND_TIMEOUT,
    )
    .await?;
    output_to_string(output).map(|_| ())
}

fn resolve_worktree_slug(name: Option<&str>) -> String {
    let fallback = || {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        format!("worktree-{millis}")
    };
    let Some(name) = name.map(str::trim).filter(|value| !value.is_empty()) else {
        return fallback();
    };
    let slug = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '.', '_'])
        .to_string();
    if slug.is_empty() {
        fallback()
    } else {
        slug
    }
}
