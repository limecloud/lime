//! Shared resume-session path semantics.
//!
//! App Server owns persisted session metadata and returns the effective working directory.
//! This module only provides the Lime-native, side-effect-free path comparison used when a
//! caller needs to decide whether an explicit cwd differs from the resumed session cwd.

use std::path::{Component, Path, PathBuf};

/// Return whether two working-directory paths refer to different locations after normalization.
pub(crate) fn cwds_differ(current_cwd: &Path, session_cwd: &Path) -> bool {
    normalize_cwd(current_cwd) != normalize_cwd(session_cwd)
}

fn normalize_cwd(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() && !normalized.has_root() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::Normal(part) => normalized.push(part),
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn cwds_differ_ignores_lexical_segments() {
        assert!(!cwds_differ(
            Path::new("/workspace/project"),
            Path::new("/workspace/project/./src/.."),
        ));
    }

    #[test]
    fn cwds_differ_detects_distinct_paths() {
        assert!(cwds_differ(
            Path::new("/workspace/one"),
            Path::new("/workspace/two"),
        ));
    }

    #[cfg(unix)]
    #[test]
    fn cwds_differ_resolves_existing_symlink_targets() {
        let root = tempdir().expect("tempdir");
        let target = root.path().join("target");
        let link = root.path().join("link");
        std::fs::create_dir(&target).expect("target directory");
        std::os::unix::fs::symlink(&target, &link).expect("symlink");

        assert!(!cwds_differ(&target, &link));
    }
}
