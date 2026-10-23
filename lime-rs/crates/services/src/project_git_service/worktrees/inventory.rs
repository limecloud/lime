//! 从当前托管目录和 Git 注册信息读取清单；不建立第二份工作树索引。

use super::super::{git_command_output_from, output_to_string, GIT_COMMAND_TIMEOUT};
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedWorktree {
    pub worktree_path: PathBuf,
    pub repository_root: PathBuf,
    pub head_sha: String,
    pub branch: Option<String>,
    pub created_at_ms: Option<i64>,
}

pub async fn list_worktrees(root: &Path) -> Result<Vec<ManagedWorktree>, String> {
    if !root.is_absolute() {
        return Err("工作树根目录必须为绝对路径".into());
    }
    let root = match tokio::fs::canonicalize(root).await {
        Ok(root) => root,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("无法读取工作树根目录: {error}")),
    };
    let mut entries = tokio::fs::read_dir(&root)
        .await
        .map_err(|error| format!("无法读取工作树清单: {error}"))?;
    let mut result = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| error.to_string())?
    {
        // 不跟随子目录符号链接；普通目录和主仓没有 linked .git 文件。
        if !entry
            .file_type()
            .await
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        match inspect_worktree(&root, &entry.path()).await {
            Ok(Some(worktree)) => result.push(worktree),
            Ok(None) => {}
            Err(error) => tracing::warn!("Skipping invalid managed worktree: {error}"),
        }
    }
    result.sort_by(|left, right| left.worktree_path.cmp(&right.worktree_path));
    Ok(result)
}

/// 验证当前托管 linked checkout。调用者负责快照、聊天保护及归档。
pub async fn validate_worktree_removal(
    root: &Path,
    target: &Path,
) -> Result<ManagedWorktree, String> {
    inspect_managed_worktree(root, target).await
}

pub(super) async fn inspect_managed_worktree(
    root: &Path,
    target: &Path,
) -> Result<ManagedWorktree, String> {
    let root = tokio::fs::canonicalize(root)
        .await
        .map_err(|error| error.to_string())?;
    if target.parent() != Some(root.as_path()) {
        return Err("目标不在当前托管工作树目录中".into());
    }
    let target_metadata = tokio::fs::symlink_metadata(target)
        .await
        .map_err(|error| error.to_string())?;
    if !target_metadata.file_type().is_dir() {
        return Err("目标不是托管工作树目录".into());
    }
    inspect_worktree(&root, target)
        .await?
        .ok_or_else(|| "目标不是已注册的托管工作树".to_string())
}

pub async fn remove_worktree(root: &Path, target: &Path) -> Result<ManagedWorktree, String> {
    let checkout = validate_worktree_removal(root, target).await?;
    let path = checkout
        .worktree_path
        .to_str()
        .ok_or("工作树路径不是有效的 UTF-8")?;
    let removed = git(
        &checkout.repository_root,
        &["worktree", "remove", "--force", "--", path],
    )
    .await;
    if let Err(error) = removed {
        // Git无法移除含子模块的目录时，按已确认的删除请求回收同一个托管目录。
        // 重新检查linked checkout，不能把竞态替换后的普通目录或符号链接当作目标。
        inspect_managed_worktree(root, target).await?;
        tracing::warn!(%error, "Git worktree removal failed; removing the verified managed directory");
        tokio::fs::remove_dir_all(target)
            .await
            .map_err(|error| error.to_string())?;
        if let Err(error) = git(
            &checkout.repository_root,
            &["worktree", "remove", "--force", "--", path],
        )
        .await
        {
            tracing::warn!(%error, "Removed worktree directory has stale Git registration");
        }
    }
    Ok(checkout)
}

async fn inspect_worktree(root: &Path, checkout: &Path) -> Result<Option<ManagedWorktree>, String> {
    let git_file = checkout.join(".git");
    let metadata = match tokio::fs::symlink_metadata(&git_file).await {
        Ok(metadata) if metadata.file_type().is_file() => metadata,
        _ => return Ok(None),
    };
    if metadata.len() > 16 * 1024 {
        return Ok(None);
    }
    let checkout = tokio::fs::canonicalize(checkout)
        .await
        .map_err(|error| error.to_string())?;
    if checkout.parent() != Some(root) {
        return Ok(None);
    }
    let common = git_path(&checkout, "--git-common-dir").await?;
    let admin = git_path(&checkout, "--git-dir").await?;
    let expected_admin_parent = tokio::fs::canonicalize(common.join("worktrees"))
        .await
        .map_err(|error| error.to_string())?;
    if admin.parent() != Some(expected_admin_parent.as_path()) {
        return Ok(None);
    }
    let backlink = tokio::fs::read_to_string(admin.join("gitdir"))
        .await
        .map_err(|error| error.to_string())?;
    let backlink = PathBuf::from(backlink.trim_end_matches(['\r', '\n']));
    let backlink = tokio::fs::canonicalize(admin.join(backlink))
        .await
        .map_err(|error| error.to_string())?;
    let git_file = tokio::fs::canonicalize(git_file)
        .await
        .map_err(|error| error.to_string())?;
    if backlink != git_file {
        return Ok(None);
    }
    let output = git_command_output_from(
        Path::new("git"),
        &checkout,
        &[
            "-c",
            "core.quotePath=false",
            "worktree",
            "list",
            "--porcelain",
        ],
        GIT_COMMAND_TIMEOUT,
    )
    .await?;
    if !output.status.success() {
        return Err("无法读取 Git 工作树注册信息".into());
    }
    let mut repository_root = None;
    let mut head_sha = None;
    let mut branch = None;
    // Git 2.33 尚无 worktree list -z；使用 porcelain 的 C 引号路径合同。
    let output = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
    for record in output.split("\n\n") {
        let mut record_path = None;
        let mut record_head = None;
        let mut record_branch = None;
        for field in record.lines() {
            if let Some(value) = field.strip_prefix("worktree ") {
                record_path = Some(decode_git_path(value)?);
            } else if let Some(value) = field.strip_prefix("HEAD ") {
                record_head = Some(value.to_owned());
            } else if let Some(value) = field.strip_prefix("branch refs/heads/") {
                record_branch = Some(value.to_owned());
            }
        }
        let Some(record_path) = record_path else {
            continue;
        };
        let Ok(record_path) = tokio::fs::canonicalize(record_path).await else {
            continue;
        };
        if repository_root.is_none() {
            repository_root = Some(record_path.clone());
        }
        if record_path == checkout {
            head_sha = record_head;
            branch = record_branch;
        }
    }
    let Some(head_sha) = head_sha else {
        return Ok(None);
    };
    let Some(repository_root) = repository_root else {
        return Ok(None);
    };
    if repository_root == checkout {
        return Ok(None);
    }
    let created_at_ms = tokio::fs::metadata(&checkout)
        .await
        .ok()
        .and_then(|metadata| metadata.created().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .filter(|time| *time > 0);
    Ok(Some(ManagedWorktree {
        worktree_path: checkout,
        repository_root,
        head_sha,
        branch,
        created_at_ms,
    }))
}

fn decode_git_path(value: &str) -> Result<PathBuf, String> {
    if !value.starts_with('"') {
        return Ok(PathBuf::from(value));
    }
    let value = value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .ok_or("Git 工作树路径引号无效")?;
    let mut bytes = value.bytes();
    let mut result = Vec::new();
    while let Some(byte) = bytes.next() {
        if byte != b'\\' {
            result.push(byte);
            continue;
        }
        let escaped = bytes.next().ok_or("Git 工作树路径转义无效")?;
        result.push(match escaped {
            b'a' => 7,
            b'b' => 8,
            b't' => 9,
            b'n' => 10,
            b'v' => 11,
            b'f' => 12,
            b'r' => 13,
            b'\\' | b'"' => escaped,
            b'0'..=b'3' => {
                let second = bytes
                    .next()
                    .filter(|byte| matches!(byte, b'0'..=b'7'))
                    .ok_or("Git 路径八进制转义无效")?;
                let third = bytes
                    .next()
                    .filter(|byte| matches!(byte, b'0'..=b'7'))
                    .ok_or("Git 路径八进制转义无效")?;
                (escaped - b'0') * 64 + (second - b'0') * 8 + (third - b'0')
            }
            _ => return Err("Git 工作树路径转义无效".into()),
        });
    }
    Ok(PathBuf::from(
        String::from_utf8(result).map_err(|error| error.to_string())?,
    ))
}

async fn git_path(root: &Path, kind: &str) -> Result<PathBuf, String> {
    let value = git(root, &["rev-parse", "--path-format=absolute", kind]).await?;
    tokio::fs::canonicalize(value.trim_end_matches(['\r', '\n']))
        .await
        .map_err(|error| error.to_string())
}

async fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    output_to_string(
        git_command_output_from(Path::new("git"), root, args, GIT_COMMAND_TIMEOUT).await?,
    )
}
