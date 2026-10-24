use super::{
    git_output, read_branches, read_current_branch, read_local_environment_config_path,
    read_uncommitted_file_count, required_root_path, ProjectGitStatus,
};
use std::path::{Path, PathBuf};

pub async fn read_status(root_path: &str) -> Result<ProjectGitStatus, String> {
    let root = required_root_path(root_path)?;
    if !has_git_ancestor(&root) {
        return Ok(non_repository_status(root_path));
    }
    let repository_root = match git_output(&root, &["rev-parse", "--show-toplevel"]).await {
        Ok(output) => output.trim().to_string(),
        Err(_) => return Ok(non_repository_status(root_path)),
    };
    let repository_path = PathBuf::from(&repository_root);
    let git_dir = git_output(&root, &["rev-parse", "--absolute-git-dir"]).await?;
    let common_dir = git_output(
        &root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .await?;
    let is_worktree = git_dir.trim() != common_dir.trim();
    // 工作树只读取自己的Git作用域，不从源项目的UI偏好继承选择。
    let local_environment_config_path = if is_worktree {
        read_local_environment_config_path(&repository_path).await?
    } else {
        None
    };
    Ok(ProjectGitStatus {
        root_path: root_path.to_string(),
        repository_root: Some(repository_root),
        has_git_repository: true,
        is_worktree,
        local_environment_config_path,
        current_branch: read_current_branch(&root).await?,
        branches: read_branches(&repository_path).await?,
        uncommitted_file_count: read_uncommitted_file_count(&root).await?,
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
        ..Default::default()
    }
}

#[cfg(test)]
mod tests;
