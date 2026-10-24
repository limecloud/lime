//! 项目配置的发现、信任、继承和精确写入；调用者持有共享配置锁。

use super::{Config, ConfigError, ConfigManager};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use toml_edit::{DocumentMut, Item};

pub const PROJECT_CONFIG_FILE: &str = "config.toml";
pub const PROJECT_CONFIG_FOLDER: &str = ".lime";
pub const PROJECT_DEFAULT_KEYS: &[&str] = &[
    "approval_policy",
    "sandbox_mode",
    "sandbox_workspace_write",
    "web_search",
    "model_verbosity",
    "model_reasoning_summary",
    "model_reasoning_effort",
    "default_permissions",
    "permissions",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trust_level: Option<TrustLevel>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrustLevel {
    Trusted,
    Untrusted,
}

#[derive(Debug, Clone)]
pub struct ProjectLayer {
    pub folder: PathBuf,
    pub config: Value,
    pub source: String,
    pub disabled_reason: Option<String>,
}

pub struct ConfigLayers {
    pub user: Config,
    pub effective: Config,
    /// 按覆盖优先级从低到高排列。
    pub projects: Vec<ProjectLayer>,
    pub managed: Option<super::managed::ManagedConfig>,
}

impl ConfigLayers {
    pub fn load(user_file: &Path, cwd: Option<&Path>) -> Result<Self, ConfigError> {
        let user = ConfigManager::load(user_file)?.config().clone();
        Self::from_user(user, cwd)
    }

    /// 同一次读取复用用户快照，避免 effective 与 layer revision 来自两次文件读取。
    pub fn from_user(user: Config, cwd: Option<&Path>) -> Result<Self, ConfigError> {
        Self::from_user_with_managed(user, cwd, super::managed::read_config()?)
    }

    /// 平台读取与纯层组合分离；产品入口始终使用 from_user/load 读取真实系统源。
    pub fn from_user_with_managed(
        user: Config,
        cwd: Option<&Path>,
        managed: Option<super::managed::ManagedConfig>,
    ) -> Result<Self, ConfigError> {
        let mut effective = serde_json::to_value(&user).map_err(parse_error)?;
        let projects = cwd
            .map(|cwd| discover_projects(cwd, &user))
            .transpose()?
            .unwrap_or_default();
        for project in &projects {
            if project.disabled_reason.is_none() {
                merge_defaults(&mut effective, &project.config);
            }
        }
        if let Some(managed) = &managed {
            merge_value(&mut effective, &managed.config);
        }
        let effective = serde_json::from_value(effective).map_err(parse_error)?;
        Ok(Self {
            user,
            effective,
            projects,
            managed,
        })
    }
}

fn discover_projects(cwd: &Path, user: &Config) -> Result<Vec<ProjectLayer>, ConfigError> {
    if !cwd.is_absolute() || !cwd.is_dir() {
        return Err(ConfigError::ValidationError(
            "cwd must be an existing absolute directory".into(),
        ));
    }
    let cwd = std::fs::canonicalize(cwd).map_err(read_error)?;
    let root = cwd
        .ancestors()
        .find(|path| path.join(".git").exists())
        .unwrap_or(&cwd);
    let trust = project_config_for(user, &cwd)
        .or_else(|| project_config_for(user, root))
        .and_then(|project| project.trust_level);
    let disabled_reason = (trust != Some(TrustLevel::Trusted)).then(|| {
        "Project configuration is disabled because this project is not trusted.".to_owned()
    });
    let mut directories = cwd
        .ancestors()
        .take_while(|path| path.starts_with(root))
        .collect::<Vec<_>>();
    directories.reverse();
    let mut layers = Vec::new();
    for directory in directories {
        let folder = directory.join(PROJECT_CONFIG_FOLDER);
        let file = folder.join(PROJECT_CONFIG_FILE);
        // 与参考 loader 一致：已有配置目录才形成项目层，文件可以尚未创建。
        if !folder.is_dir()
            && !std::fs::symlink_metadata(&folder)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            continue;
        }
        if [&folder, &file].iter().any(|path| {
            std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink())
        }) {
            layers.push(ProjectLayer {
                folder,
                config: serde_json::json!({}),
                source: String::new(),
                disabled_reason: Some(
                    "Project configuration paths must not be symbolic links.".into(),
                ),
            });
            continue;
        }
        let source = match std::fs::read_to_string(&file) {
            Ok(source) => source,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(read_error(error)),
        };
        let config = parse_project(&source);
        let (config, reason) = match config {
            Ok(config) => (config, disabled_reason.clone()),
            Err(_) if disabled_reason.is_some() => (serde_json::json!({}), disabled_reason.clone()),
            Err(error) => return Err(error),
        };
        layers.push(ProjectLayer {
            folder,
            config,
            source,
            disabled_reason: reason,
        });
    }
    Ok(layers)
}

fn project_config_for<'a>(user: &'a Config, path: &Path) -> Option<&'a ProjectConfig> {
    user.projects
        .get(&path.to_string_lossy().into_owned())
        .or_else(|| {
            user.projects.iter().find_map(|(key, project)| {
                std::fs::canonicalize(key)
                    .is_ok_and(|canonical| canonical == path)
                    .then_some(project)
            })
        })
}

pub fn parse_project(source: &str) -> Result<Value, ConfigError> {
    toml_edit::de::from_str(source).map_err(parse_error)
}

pub fn merge_defaults(effective: &mut Value, overlay: &Value) {
    for key in PROJECT_DEFAULT_KEYS {
        if let Some(value) = overlay.get(key) {
            merge_value(&mut effective[*key], value);
        }
    }
}

fn merge_value(target: &mut Value, source: &Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            merge_value(target.entry(key.clone()).or_insert(Value::Null), value);
        }
    } else {
        *target = source.clone();
    }
}

/// 仅修改配置页支持的键；不重排、归一化或丢弃文件内其他字段。
pub fn edit_project(source: &str, key: &str, value: &Value) -> Result<String, ConfigError> {
    let mut document = source.parse::<DocumentMut>().map_err(parse_error)?;
    let network = key == "sandbox_workspace_write.network_access";
    if !network
        && !matches!(
            key,
            "approval_policy"
                | "sandbox_mode"
                | "web_search"
                | "model_verbosity"
                | "model_reasoning_summary"
        )
    {
        return Err(ConfigError::ValidationError(format!(
            "Unsupported project setting: {key}"
        )));
    }
    let (table, key) = if network {
        if document
            .get("sandbox_workspace_write")
            .is_some_and(|item| !item.is_table())
        {
            return Err(ConfigError::ValidationError(
                "The sandbox_workspace_write inline table cannot be updated safely.".into(),
            ));
        }
        if !document.contains_key("sandbox_workspace_write") {
            document["sandbox_workspace_write"] = Item::Table(toml_edit::Table::new());
        }
        (
            document["sandbox_workspace_write"]
                .as_table_mut()
                .expect("table checked"),
            "network_access",
        )
    } else {
        (document.as_table_mut(), key)
    };
    if value.is_null() {
        table.remove(key);
    } else {
        let next = match value {
            Value::String(value) => toml_edit::Value::from(value.as_str()),
            Value::Bool(value) => toml_edit::Value::from(*value),
            _ => {
                return Err(ConfigError::ValidationError(
                    "Project setting must be a string or boolean".into(),
                ))
            }
        };
        let mut next = next;
        if let Some(current) = table.get(key).and_then(Item::as_value) {
            *next.decor_mut() = current.decor().clone();
        }
        if let Some(current) = table.get_mut(key) {
            *current = Item::Value(next);
        } else {
            table.insert(key, Item::Value(next));
        }
    }
    Ok(document.to_string())
}

pub fn save_project(path: &Path, source: &str) -> Result<(), ConfigError> {
    super::persistence::write_config(path, source.as_bytes())
        .map_err(|error| ConfigError::WriteError(error.to_string()))
}

fn parse_error(error: impl std::fmt::Display) -> ConfigError {
    ConfigError::ParseError(error.to_string())
}
fn read_error(error: impl std::fmt::Display) -> ConfigError {
    ConfigError::ReadError(error.to_string())
}

#[cfg(test)]
mod tests;
