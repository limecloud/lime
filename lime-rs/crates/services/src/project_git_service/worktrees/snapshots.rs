//! 快照保存在 Git ref；临时 index 不改变用户的暂存区、HEAD 或分支。

use super::super::{output_to_string, process::git_command_output_with};
use super::inventory::inspect_managed_worktree;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    time::Duration,
};

#[cfg(test)]
mod tests;

const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSnapshot {
    pub root_path: PathBuf,
    pub worktree_path: PathBuf,
    pub repository_root: PathBuf,
    pub snapshot_ref: String,
    pub commit_sha: String,
}

pub async fn snapshot_worktree(root: &Path, target: &Path) -> Result<WorktreeSnapshot, String> {
    let checkout = inspect_managed_worktree(root, target).await?;
    let target = &checkout.worktree_path;
    reject_nested_repositories(target).await?;
    let temp = tempfile::tempdir().map_err(|error| error.to_string())?;
    let index = git_path(target, "--git-path", Some("index")).await?;
    copy_index(&index, &temp.path().join("index")).await?;
    let shared = git(target, &["rev-parse", "--shared-index-path"], &[], None).await?;
    if !shared.trim().is_empty() {
        let source = target.join(shared.trim_end_matches(['\r', '\n']));
        let name = source.file_name().ok_or("无法读取共享 index 名称")?;
        copy_index(&source, &temp.path().join(name)).await?;
    }
    let env = [
        (
            OsString::from("GIT_INDEX_FILE"),
            temp.path().join("index").into_os_string(),
        ),
        (OsString::from("GIT_LITERAL_PATHSPECS"), OsString::from("1")),
    ];
    git(target, &["add", "-u"], &env, None).await?;
    let untracked = git(
        target,
        &["ls-files", "--others", "--exclude-standard", "-z"],
        &env,
        None,
    )
    .await?;
    if !untracked.is_empty() {
        git(
            target,
            &["add", "--pathspec-from-file=-", "--pathspec-file-nul"],
            &env,
            Some(untracked.as_bytes()),
        )
        .await?;
    }
    let tree = git(target, &["write-tree"], &env, None).await?;
    let tree = tree.trim();
    let head_tree = git(target, &["rev-parse", "HEAD^{tree}"], &[], None).await?;
    let commit_sha = if tree == head_tree.trim() {
        checkout.head_sha
    } else {
        git(
            target,
            &[
                "-c",
                "user.name=Worktree",
                "-c",
                "user.email=worktree@localhost",
                "commit-tree",
                tree,
                "-p",
                &checkout.head_sha,
                "-m",
                "Worktree recovery snapshot",
            ],
            &[],
            None,
        )
        .await?
        .trim()
        .to_string()
    };
    let snapshot_ref = snapshot_ref(target);
    git(
        target,
        &["update-ref", &snapshot_ref, &commit_sha],
        &[],
        None,
    )
    .await?;
    Ok(WorktreeSnapshot {
        root_path: target.parent().ok_or("无效的工作树目录")?.to_path_buf(),
        worktree_path: target.to_path_buf(),
        repository_root: checkout.repository_root,
        snapshot_ref,
        commit_sha,
    })
}

pub async fn restore_worktree(snapshot: &WorktreeSnapshot, cwd: &Path) -> Result<(), String> {
    let target = &snapshot.worktree_path;
    if snapshot.snapshot_ref != snapshot_ref(target)
        || target.parent() != Some(snapshot.root_path.as_path())
        || !snapshot.root_path.is_absolute()
        || !super::worktree_contains(target, cwd)
        || cwd
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("工作树恢复信息或聊天目录无效".into());
    }
    let root = tokio::fs::canonicalize(&snapshot.root_path)
        .await
        .map_err(|error| error.to_string())?;
    if root != snapshot.root_path {
        return Err("工作树恢复根目录已变化".into());
    }
    match tokio::fs::symlink_metadata(target).await {
        Ok(_) => {
            let current = inspect_managed_worktree(&root, target).await?;
            if current.repository_root != snapshot.repository_root {
                return Err("工作树目录已被其他仓库占用".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            git(
                &snapshot.repository_root,
                &[
                    "worktree",
                    "add",
                    "--detach",
                    target.to_str().ok_or("工作树路径不是有效的 UTF-8")?,
                    &snapshot.snapshot_ref,
                ],
                &[],
                None,
            )
            .await?;
        }
        Err(error) => return Err(error.to_string()),
    }
    if !tokio::fs::try_exists(cwd)
        .await
        .map_err(|error| error.to_string())?
    {
        let relative = cwd
            .strip_prefix(target)
            .map_err(|error| error.to_string())?;
        git(
            target,
            &[
                "sparse-checkout",
                "add",
                "--",
                relative.to_str().ok_or("聊天目录不是有效的 UTF-8")?,
            ],
            &[],
            None,
        )
        .await?;
    }
    if !tokio::fs::metadata(cwd)
        .await
        .map_err(|error| error.to_string())?
        .is_dir()
    {
        return Err("无法恢复聊天的工作目录".into());
    }
    Ok(())
}

fn snapshot_ref(target: &Path) -> String {
    format!(
        "refs/snapshots/worktrees/{:x}",
        Sha256::digest(target.to_string_lossy().as_bytes())
    )
}

async fn reject_nested_repositories(root: &Path) -> Result<(), String> {
    let entries = git(
        root,
        &[
            "ls-files",
            "--stage",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        &[],
        None,
    )
    .await?;
    for entry in entries.split('\0').filter(|entry| !entry.is_empty()) {
        let path = if entry.starts_with("160000 ") {
            entry.split_once('\t').map(|(_, path)| path)
        } else if entry.ends_with('/') {
            Some(entry)
        } else {
            None
        };
        if let Some(path) = path {
            match tokio::fs::symlink_metadata(root.join(path).join(".git")).await {
                Ok(_) => return Err("工作树快照无法保存已初始化的子模块或嵌套 Git 仓库".into()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("无法检查嵌套 Git 仓库: {error}")),
            }
        }
    }
    Ok(())
}

async fn copy_index(source: &Path, destination: &Path) -> Result<(), String> {
    match tokio::fs::copy(source, destination).await {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

async fn git_path(root: &Path, option: &str, argument: Option<&str>) -> Result<PathBuf, String> {
    let mut args = vec!["rev-parse", "--path-format=absolute", option];
    args.extend(argument);
    let value = git(root, &args, &[], None).await?;
    Ok(root.join(value.trim_end_matches(['\r', '\n'])))
}

async fn git(
    root: &Path,
    args: &[&str],
    env: &[(OsString, OsString)],
    input: Option<&[u8]>,
) -> Result<String, String> {
    let output =
        git_command_output_with(Path::new("git"), root, args, SNAPSHOT_TIMEOUT, env, input).await?;
    if !output.status.success() {
        return output_to_string(output);
    }
    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}
