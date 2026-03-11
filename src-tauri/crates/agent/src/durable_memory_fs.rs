use std::fs;
use std::path::{Component, Path, PathBuf};

pub const DURABLE_MEMORY_VIRTUAL_ROOT: &str = "/memories";
pub const DURABLE_MEMORY_ROOT_ENV: &str = "PROXYCAST_DURABLE_MEMORY_DIR";

const DURABLE_MEMORY_SUBDIR: &str = "harness/memories";

fn normalize_virtual_input(path: &str) -> String {
    let raw = path.trim();
    let starts_absolute = raw.starts_with('/') || raw.starts_with('\\');
    let mut normalized = raw.replace('\\', "/");
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    if starts_absolute && !normalized.starts_with('/') {
        normalized.insert(0, '/');
    }
    normalized
}

pub fn durable_memory_permission_pattern() -> &'static str {
    r"^/memories(?:/.*)?$"
}

pub fn resolve_durable_memory_root() -> Result<PathBuf, String> {
    let root = if let Ok(override_dir) = std::env::var(DURABLE_MEMORY_ROOT_ENV) {
        let trimmed = override_dir.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    } else {
        None
    };

    let root = match root {
        Some(path) => path,
        None => {
            #[cfg(test)]
            {
                std::env::temp_dir()
                    .join("proxycast-tests")
                    .join(DURABLE_MEMORY_SUBDIR)
            }
            #[cfg(not(test))]
            {
                proxycast_core::app_paths::preferred_data_dir()?.join(DURABLE_MEMORY_SUBDIR)
            }
        }
    };

    fs::create_dir_all(&root)
        .map_err(|e| format!("创建 durable memory 根目录失败 {}: {e}", root.display()))?;
    Ok(root)
}

pub fn virtual_memory_relative_path(path: &str) -> Option<String> {
    let normalized = normalize_virtual_input(path);
    if normalized == DURABLE_MEMORY_VIRTUAL_ROOT
        || normalized == format!("{DURABLE_MEMORY_VIRTUAL_ROOT}/")
    {
        return Some(String::new());
    }

    normalized
        .strip_prefix(&format!("{DURABLE_MEMORY_VIRTUAL_ROOT}/"))
        .map(str::to_string)
}

pub fn is_virtual_memory_path(path: &str) -> bool {
    virtual_memory_relative_path(path).is_some()
}

pub fn resolve_virtual_memory_path(path: &str) -> Result<Option<PathBuf>, String> {
    let Some(relative) = virtual_memory_relative_path(path) else {
        return Ok(None);
    };

    let root = resolve_durable_memory_root()?;
    if relative.trim().is_empty() {
        return Ok(Some(root));
    }

    let mut target = root.clone();
    for component in Path::new(&relative).components() {
        match component {
            Component::Normal(segment) => target.push(segment),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("`/memories/` 路径不允许包含 `..`".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("`/memories/` 路径格式无效".to_string());
            }
        }
    }

    Ok(Some(target))
}

pub fn to_virtual_memory_path(path: &Path) -> Result<Option<String>, String> {
    let root = resolve_durable_memory_root()?;
    let normalized_root = root.canonicalize().unwrap_or(root.clone());
    let normalized_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());

    let relative = normalized_path
        .strip_prefix(&normalized_root)
        .or_else(|_| path.strip_prefix(&root));

    let Ok(relative) = relative else {
        return Ok(None);
    };

    if relative.as_os_str().is_empty() {
        return Ok(Some(DURABLE_MEMORY_VIRTUAL_ROOT.to_string()));
    }

    let suffix = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");

    if suffix.is_empty() {
        Ok(Some(DURABLE_MEMORY_VIRTUAL_ROOT.to_string()))
    } else {
        Ok(Some(format!("{DURABLE_MEMORY_VIRTUAL_ROOT}/{suffix}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::{Mutex, OnceLock};
    use tempfile::TempDir;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvOverrideGuard {
        previous: Option<OsString>,
    }

    impl EnvOverrideGuard {
        fn set(path: &Path) -> Self {
            let previous = std::env::var_os(DURABLE_MEMORY_ROOT_ENV);
            std::env::set_var(DURABLE_MEMORY_ROOT_ENV, path.as_os_str());
            Self { previous }
        }
    }

    impl Drop for EnvOverrideGuard {
        fn drop(&mut self) {
            if let Some(value) = &self.previous {
                std::env::set_var(DURABLE_MEMORY_ROOT_ENV, value);
            } else {
                std::env::remove_var(DURABLE_MEMORY_ROOT_ENV);
            }
        }
    }

    #[test]
    fn should_map_virtual_memory_path_to_override_root() {
        let _guard = env_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let _env = EnvOverrideGuard::set(tmp.path());

        let resolved = resolve_virtual_memory_path("/memories/preferences.md")
            .expect("resolve path")
            .expect("mapped path");

        assert_eq!(resolved, tmp.path().join("preferences.md"));
    }

    #[test]
    fn should_reject_parent_segments_in_virtual_memory_path() {
        let _guard = env_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let _env = EnvOverrideGuard::set(tmp.path());

        let error = resolve_virtual_memory_path("/memories/../escape.md")
            .expect_err("should reject parent dir");
        assert!(error.contains("`..`"));
    }

    #[test]
    fn should_convert_real_path_back_to_virtual_memory_path() {
        let _guard = env_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let _env = EnvOverrideGuard::set(tmp.path());

        let real_path = tmp.path().join("team").join("preferences.md");
        fs::create_dir_all(real_path.parent().expect("parent")).expect("create subdir");
        fs::write(&real_path, "# preferences").expect("write file");

        let virtual_path = to_virtual_memory_path(&real_path)
            .expect("convert")
            .expect("virtual path");
        assert_eq!(virtual_path, "/memories/team/preferences.md");
    }
}
