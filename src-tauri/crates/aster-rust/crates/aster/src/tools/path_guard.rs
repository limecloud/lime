use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathMutationKind {
    Write,
    Remove,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathMutationCandidate {
    pub raw_path: String,
    pub kind: PathMutationKind,
}

impl PathMutationCandidate {
    pub fn new(raw_path: impl Into<String>, kind: PathMutationKind) -> Self {
        Self {
            raw_path: raw_path.into(),
            kind,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathGuardFinding {
    ProtectedPaths(Vec<PathBuf>),
    OutsideWorkspace(Vec<PathBuf>),
    DynamicPaths(Vec<String>),
}

pub fn evaluate_path_mutations(
    candidates: &[PathMutationCandidate],
    cwd: &Path,
) -> Option<PathGuardFinding> {
    let normalized_cwd = normalize_path_lexically(cwd);
    let protected_git_root = normalized_cwd.join(".git");
    let home_dir = dirs::home_dir().map(|path| normalize_path_lexically(&path));

    let mut protected_paths = Vec::new();
    let mut outside_workspace_paths = Vec::new();
    let mut dynamic_paths = Vec::new();

    for candidate in candidates {
        let raw = candidate.raw_path.trim();
        if raw.is_empty() {
            continue;
        }

        if is_safe_sink_path(raw) {
            continue;
        }

        if path_looks_dynamic(raw) {
            dynamic_paths.push(raw.to_string());
            continue;
        }

        let Some(resolved_path) = resolve_candidate_path(raw, &normalized_cwd, home_dir.as_deref())
        else {
            continue;
        };

        if is_protected_path(
            &resolved_path,
            &normalized_cwd,
            &protected_git_root,
            home_dir.as_deref(),
        ) {
            if !protected_paths.contains(&resolved_path) {
                protected_paths.push(resolved_path);
            }
            continue;
        }

        if !path_within(&resolved_path, &normalized_cwd)
            && !outside_workspace_paths.contains(&resolved_path)
        {
            outside_workspace_paths.push(resolved_path);
        }
    }

    if !protected_paths.is_empty() {
        return Some(PathGuardFinding::ProtectedPaths(protected_paths));
    }
    if !outside_workspace_paths.is_empty() {
        return Some(PathGuardFinding::OutsideWorkspace(outside_workspace_paths));
    }
    if !dynamic_paths.is_empty() {
        return Some(PathGuardFinding::DynamicPaths(dynamic_paths));
    }

    None
}

pub fn summarize_paths(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .take(3)
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn summarize_raw_paths(paths: &[String]) -> String {
    paths.iter().take(3).cloned().collect::<Vec<_>>().join(", ")
}

pub fn resolve_static_path_candidate(raw: &str, cwd: &Path) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || is_safe_sink_path(trimmed) || path_looks_dynamic(trimmed) {
        return None;
    }

    let normalized_cwd = normalize_path_lexically(cwd);
    let home_dir = dirs::home_dir().map(|path| normalize_path_lexically(&path));
    resolve_candidate_path(trimmed, &normalized_cwd, home_dir.as_deref())
}

fn path_looks_dynamic(raw: &str) -> bool {
    let trimmed = raw.trim();
    trimmed.contains('$')
        || trimmed.contains('*')
        || trimmed.contains('?')
        || trimmed.contains('[')
        || trimmed.contains(']')
        || trimmed.contains('{')
        || trimmed.contains('}')
        || trimmed.contains('`')
        || trimmed.contains("$(")
        || trimmed.contains("${")
        || trimmed.contains("%")
}

fn is_safe_sink_path(raw: &str) -> bool {
    let normalized = raw
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`'))
        .to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "/dev/null" | "/dev/stdout" | "/dev/stderr" | "/dev/tty" | "nul" | "$null"
    )
}

fn resolve_candidate_path(raw: &str, cwd: &Path, home_dir: Option<&Path>) -> Option<PathBuf> {
    let cleaned = raw
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`'))
        .trim_end_matches(|ch: char| matches!(ch, ',' | ';' | ')' | '('));

    if cleaned.is_empty() {
        return None;
    }

    let expanded = if cleaned == "~" || cleaned.starts_with("~/") || cleaned.starts_with("~\\") {
        let home = home_dir?;
        let suffix = cleaned.trim_start_matches('~');
        home.join(suffix.trim_start_matches(['/', '\\']))
    } else {
        PathBuf::from(cleaned)
    };

    let resolved = if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    };

    Some(normalize_path_lexically(&resolved))
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    let is_absolute = path.is_absolute();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(std::path::MAIN_SEPARATOR.to_string()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() && !is_absolute {
                    normalized.push("..");
                }
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    normalized
}

fn path_within(path: &Path, cwd: &Path) -> bool {
    path == cwd || path.starts_with(cwd)
}

fn is_protected_path(
    path: &Path,
    _cwd: &Path,
    protected_git_root: &Path,
    home_dir: Option<&Path>,
) -> bool {
    if path == Path::new("/") {
        return true;
    }

    if let Some(home) = home_dir {
        if path == home {
            return true;
        }
    }

    if path == protected_git_root || path.starts_with(protected_git_root) {
        return true;
    }

    #[cfg(not(target_os = "windows"))]
    {
        for protected_prefix in [
            "/System",
            "/Library",
            "/Applications",
            "/bin",
            "/sbin",
            "/usr",
            "/etc",
            "/private/etc",
            "/dev",
            "/proc",
            "/sys",
            "/var/db",
        ] {
            let protected_path = Path::new(protected_prefix);
            if path == protected_path || path.starts_with(protected_path) {
                return true;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for protected_prefix in [
            r"C:\Windows",
            r"C:\Program Files",
            r"C:\Program Files (x86)",
        ] {
            let protected_path = Path::new(protected_prefix);
            if path == protected_path || path.starts_with(protected_path) {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::{
        evaluate_path_mutations, resolve_static_path_candidate, PathGuardFinding,
        PathMutationCandidate, PathMutationKind,
    };
    use std::path::Path;

    #[test]
    fn outside_workspace_write_is_reported() {
        let finding = evaluate_path_mutations(
            &[PathMutationCandidate::new(
                "../notes.txt",
                PathMutationKind::Write,
            )],
            Path::new("/tmp/project"),
        );
        assert!(matches!(
            finding,
            Some(PathGuardFinding::OutsideWorkspace(_))
        ));
    }

    #[test]
    fn protected_git_path_is_reported() {
        let finding = evaluate_path_mutations(
            &[PathMutationCandidate::new(
                ".git/config",
                PathMutationKind::Write,
            )],
            Path::new("/tmp/project"),
        );
        assert!(matches!(finding, Some(PathGuardFinding::ProtectedPaths(_))));
    }

    #[test]
    fn dynamic_path_is_reported() {
        let finding = evaluate_path_mutations(
            &[PathMutationCandidate::new(
                "$TARGET/out.txt",
                PathMutationKind::Write,
            )],
            Path::new("/tmp/project"),
        );
        assert_eq!(
            finding,
            Some(PathGuardFinding::DynamicPaths(vec![
                "$TARGET/out.txt".to_string()
            ]))
        );
    }

    #[test]
    fn resolve_static_path_candidate_normalizes_relative_path() {
        let resolved =
            resolve_static_path_candidate("../notes.txt", Path::new("/tmp/project")).unwrap();
        assert_eq!(resolved, Path::new("/tmp/notes.txt"));
    }

    #[test]
    fn resolve_static_path_candidate_skips_dynamic_expression() {
        let resolved = resolve_static_path_candidate("$TARGET/out.txt", Path::new("/tmp/project"));
        assert!(resolved.is_none());
    }
}
