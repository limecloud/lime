//! 聊天cwd可以不存在；保护关系不能依赖文件系统canonicalize成功。
use std::path::Path;

pub fn worktree_contains(root: &Path, path: &Path) -> bool {
    let root = key(root);
    if root.is_empty() {
        return false;
    }
    let path = key(path);
    path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|tail| tail.starts_with('/'))
        || (root == "/" && path.starts_with('/'))
}

fn key(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let windows =
        raw.starts_with(r"\\") || raw.starts_with("//") || raw.as_bytes().get(1) == Some(&b':');
    let value = if windows {
        raw.replace('\\', "/").to_lowercase()
    } else {
        raw.into_owned()
    };
    let value = value.strip_prefix("//?/").unwrap_or(&value);
    let value = value
        .strip_prefix("unc/")
        .map(|tail| format!("//{tail}"))
        .unwrap_or_else(|| value.to_owned());
    let drive = value.as_bytes().get(1) == Some(&b':');
    let absolute = value.starts_with('/') || (drive && value.as_bytes().get(2) == Some(&b'/'));
    let minimum = if drive {
        1
    } else if windows && value.starts_with("//") {
        2
    } else {
        0
    };
    let mut parts = Vec::new();
    for part in value.split('/') {
        match part {
            "" | "." => {}
            ".." if parts.len() > minimum && parts.last().is_some_and(|part| *part != "..") => {
                parts.pop();
            }
            ".." if absolute => {}
            other => parts.push(other),
        }
    }
    format!("{}{}", if absolute { "/" } else { "" }, parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_extended_drive_and_unc_paths_match_missing_descendants() {
        assert!(worktree_contains(
            Path::new(r"\\?\C:\Managed\Repo"),
            Path::new(r"c:\managed\repo\missing\nested")
        ));
        assert!(worktree_contains(
            Path::new("//?/C:/Managed/Repo"),
            Path::new("c:/managed/repo/missing")
        ));
        assert!(worktree_contains(
            Path::new(r"\\?\UNC\Server\Share\Repo"),
            Path::new(r"\\server\share\repo\missing")
        ));
        assert!(!worktree_contains(
            Path::new(r"C:\Managed\Repo"),
            Path::new(r"C:\Managed\Repo-other")
        ));
    }
    #[test]
    fn lexical_segments_are_normalized_without_following_symlinks_or_folding_posix_case() {
        assert!(worktree_contains(
            Path::new("/managed/repo"),
            Path::new("/managed/repo/absent/../nested")
        ));
        assert!(!worktree_contains(
            Path::new("/managed/repo"),
            Path::new("/managed/repo/../other")
        ));
        assert!(!worktree_contains(
            Path::new("/managed/Repo"),
            Path::new("/managed/repo/nested")
        ));
        assert!(!worktree_contains(
            Path::new("/managed/repo"),
            Path::new("/managed/repo-other")
        ));
    }
}
