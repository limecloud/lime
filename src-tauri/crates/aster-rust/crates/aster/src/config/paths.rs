use etcetera::{choose_app_strategy, AppStrategy, AppStrategyArgs};
use std::path::PathBuf;
use std::sync::OnceLock;

static PATH_ROOT_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

pub struct Paths;

impl Paths {
    fn get_dir(dir_type: DirType) -> PathBuf {
        if let Some(base) = resolve_path_root_override().or_else(resolve_path_root_from_env) {
            match dir_type {
                DirType::Config => base.join("config"),
                DirType::Data => base.join("data"),
                DirType::State => base.join("state"),
            }
        } else {
            let strategy = choose_app_strategy(AppStrategyArgs {
                top_level_domain: "Block".to_string(),
                author: "Block".to_string(),
                app_name: "aster".to_string(),
            })
            .expect("aster requires a home dir");

            match dir_type {
                DirType::Config => strategy.config_dir(),
                DirType::Data => strategy.data_dir(),
                DirType::State => strategy.state_dir().unwrap_or(strategy.data_dir()),
            }
        }
    }

    pub fn config_dir() -> PathBuf {
        Self::get_dir(DirType::Config)
    }

    pub fn data_dir() -> PathBuf {
        Self::get_dir(DirType::Data)
    }

    pub fn state_dir() -> PathBuf {
        Self::get_dir(DirType::State)
    }

    pub fn in_state_dir(subpath: &str) -> PathBuf {
        Self::state_dir().join(subpath)
    }

    pub fn in_config_dir(subpath: &str) -> PathBuf {
        Self::config_dir().join(subpath)
    }

    pub fn in_data_dir(subpath: &str) -> PathBuf {
        Self::data_dir().join(subpath)
    }
}

enum DirType {
    Config,
    Data,
    State,
}

pub fn initialize_path_root(root: PathBuf) -> Result<PathBuf, String> {
    if root.as_os_str().is_empty() {
        return Err("Aster path root 不能为空".to_string());
    }

    let normalized_root = normalize_path_root(root)
        .map_err(|error| format!("规范化 Aster path root 失败: {error}"))?;

    match PATH_ROOT_OVERRIDE.get() {
        Some(existing) if existing == &normalized_root => Ok(existing.clone()),
        Some(existing) => Err(format!(
            "Aster path root 已初始化为 {}，不能再切换到 {}",
            existing.to_string_lossy(),
            normalized_root.to_string_lossy()
        )),
        None => {
            let _ = PATH_ROOT_OVERRIDE.set(normalized_root.clone());
            Ok(normalized_root)
        }
    }
}

pub fn initialized_path_root() -> Option<PathBuf> {
    resolve_path_root_override()
}

fn resolve_path_root_override() -> Option<PathBuf> {
    PATH_ROOT_OVERRIDE.get().cloned()
}

fn resolve_path_root_from_env() -> Option<PathBuf> {
    std::env::var("ASTER_PATH_ROOT")
        .ok()
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
        .map(PathBuf::from)
}

fn normalize_path_root(root: PathBuf) -> std::io::Result<PathBuf> {
    if root.is_absolute() {
        Ok(root)
    } else {
        Ok(std::env::current_dir()?.join(root))
    }
}
