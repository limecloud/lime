//! 浏览器连接器服务
//!
//! 负责浏览器连接器安装目录、导出同步和本地设置持久化。

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SETTINGS_SUBDIR: &str = "connectors";
const SETTINGS_FILE_NAME: &str = "browser-connector-settings.json";
const EXTENSION_INSTALL_DIR_NAME: &str = "Lime Browser Connector";

const SYSTEM_CONNECTOR_DEFINITIONS: [(&str, &str, &str); 5] = [
    (
        "reminders",
        "提醒事项",
        "读取和管理你的提醒事项和任务列表。",
    ),
    ("calendar", "日历", "读取和管理你的日历事件。"),
    ("notes", "备忘录", "读取和创建你的备忘录。"),
    ("mail", "邮件", "读取邮件和创建草稿。"),
    ("contacts", "通讯录", "搜索、读取和创建联系人。"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConnectorAutoConfig {
    #[serde(rename = "serverUrl")]
    pub server_url: String,
    #[serde(rename = "bridgeKey")]
    pub bridge_key: String,
    #[serde(rename = "profileKey")]
    pub profile_key: String,
    #[serde(rename = "monitoringEnabled")]
    pub monitoring_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConnectorInstallStatus {
    pub status: String,
    pub install_root_dir: Option<String>,
    pub install_dir: Option<String>,
    pub bundled_name: String,
    pub bundled_version: String,
    pub installed_name: Option<String>,
    pub installed_version: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConnectorInstallResult {
    pub install_root_dir: String,
    pub install_dir: String,
    pub bundled_name: String,
    pub bundled_version: String,
    pub installed_version: String,
    pub auto_config_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemConnectorSnapshot {
    pub id: String,
    pub label: String,
    pub description: String,
    pub enabled: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConnectorSettingsSnapshot {
    pub enabled: bool,
    pub install_root_dir: Option<String>,
    pub install_dir: Option<String>,
    pub system_connectors: Vec<SystemConnectorSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BrowserConnectorSettingsRecord {
    enabled: bool,
    install_root_dir: Option<String>,
    system_connectors: HashMap<String, bool>,
    updated_at: String,
}

#[derive(Debug, Clone)]
struct ManifestInfo {
    name: String,
    version: String,
}

impl Default for BrowserConnectorSettingsRecord {
    fn default() -> Self {
        Self {
            enabled: true,
            install_root_dir: None,
            system_connectors: default_system_connector_states(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

fn default_system_connector_states() -> HashMap<String, bool> {
    SYSTEM_CONNECTOR_DEFINITIONS
        .iter()
        .map(|(id, _, _)| ((*id).to_string(), false))
        .collect()
}

fn browser_connector_settings_path() -> Result<PathBuf, String> {
    Ok(lime_core::app_paths::preferred_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?
        .join(SETTINGS_SUBDIR)
        .join(SETTINGS_FILE_NAME))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Err("目标路径缺少父目录".to_string());
    };
    fs::create_dir_all(parent).map_err(|error| format!("创建目录失败: {error}"))
}

fn load_settings_record() -> Result<BrowserConnectorSettingsRecord, String> {
    let path = browser_connector_settings_path()?;
    if !path.exists() {
        return Ok(BrowserConnectorSettingsRecord::default());
    }

    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取连接器设置失败: {error}"))?;
    let mut record: BrowserConnectorSettingsRecord =
        serde_json::from_str(&content).map_err(|error| format!("解析连接器设置失败: {error}"))?;

    for (id, enabled) in default_system_connector_states() {
        record.system_connectors.entry(id).or_insert(enabled);
    }

    Ok(record)
}

fn save_settings_record(record: &BrowserConnectorSettingsRecord) -> Result<(), String> {
    let path = browser_connector_settings_path()?;
    ensure_parent_dir(&path)?;
    let content = serde_json::to_string_pretty(record)
        .map_err(|error| format!("序列化连接器设置失败: {error}"))?;
    fs::write(&path, content).map_err(|error| format!("写入连接器设置失败: {error}"))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn normalize_install_root_dir(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("安装目录不能为空".to_string());
    }

    let candidate = PathBuf::from(trimmed);
    let normalized = if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir()
            .map_err(|error| format!("获取当前目录失败: {error}"))?
            .join(candidate)
    };

    Ok(normalized)
}

pub fn resolve_browser_connector_install_dir(root_dir: &Path) -> PathBuf {
    root_dir.join(EXTENSION_INSTALL_DIR_NAME)
}

fn read_manifest_info(extension_dir: &Path) -> Result<ManifestInfo, String> {
    let manifest_path = extension_dir.join("manifest.json");
    let content = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("读取 manifest.json 失败 {:?}: {error}", manifest_path))?;
    let manifest: Value = serde_json::from_str(&content)
        .map_err(|error| format!("解析 manifest.json 失败: {error}"))?;

    let name = manifest
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "manifest.json 缺少 name".to_string())?
        .to_string();
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "manifest.json 缺少 version".to_string())?
        .to_string();

    Ok(ManifestInfo { name, version })
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|error| format!("创建目标目录失败: {error}"))?;

    for entry in fs::read_dir(src).map_err(|error| format!("读取源目录失败: {error}"))? {
        let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
        let entry_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if entry_path.is_dir() {
            copy_dir_recursive(&entry_path, &dst_path)?;
        } else {
            fs::copy(&entry_path, &dst_path)
                .map_err(|error| format!("复制文件失败 {:?}: {error}", entry_path.file_name()))?;
        }
    }

    Ok(())
}

pub fn resolve_browser_connector_extension_source(app: &AppHandle) -> Result<PathBuf, String> {
    let path = if cfg!(debug_assertions) {
        let current_dir =
            std::env::current_dir().map_err(|error| format!("获取当前目录失败: {error}"))?;
        let project_root = if current_dir.ends_with("src-tauri") {
            current_dir
                .parent()
                .ok_or_else(|| "无法获取项目根目录".to_string())?
                .to_path_buf()
        } else {
            current_dir
        };
        project_root.join("extensions").join("lime-chrome")
    } else {
        app.path()
            .resource_dir()
            .map_err(|error| format!("获取资源目录失败: {error}"))?
            .join("extensions")
            .join("lime-chrome")
    };

    if !path.exists() {
        return Err(format!("未找到内置浏览器连接器目录: {:?}", path));
    }

    Ok(path)
}

fn build_install_status_from_paths(
    bundled_extension_dir: &Path,
    install_root_dir: Option<&Path>,
) -> Result<BrowserConnectorInstallStatus, String> {
    let bundled_manifest = read_manifest_info(bundled_extension_dir)?;

    let Some(root_dir) = install_root_dir else {
        return Ok(BrowserConnectorInstallStatus {
            status: "not_installed".to_string(),
            install_root_dir: None,
            install_dir: None,
            bundled_name: bundled_manifest.name,
            bundled_version: bundled_manifest.version,
            installed_name: None,
            installed_version: None,
            message: Some("尚未选择浏览器连接器安装目录".to_string()),
        });
    };

    let install_dir = resolve_browser_connector_install_dir(root_dir);
    if !install_dir.exists() {
        return Ok(BrowserConnectorInstallStatus {
            status: "not_installed".to_string(),
            install_root_dir: Some(path_to_string(root_dir)),
            install_dir: Some(path_to_string(&install_dir)),
            bundled_name: bundled_manifest.name,
            bundled_version: bundled_manifest.version,
            installed_name: None,
            installed_version: None,
            message: Some("已记录安装目录，但尚未导出浏览器连接器".to_string()),
        });
    }

    match read_manifest_info(&install_dir) {
        Ok(installed_manifest) => {
            let status = if installed_manifest.version == bundled_manifest.version {
                "installed"
            } else {
                "update_available"
            };
            let message = if status == "installed" {
                Some("已安装最新版本浏览器连接器".to_string())
            } else {
                Some("检测到用户目录中的连接器版本落后于当前应用".to_string())
            };

            Ok(BrowserConnectorInstallStatus {
                status: status.to_string(),
                install_root_dir: Some(path_to_string(root_dir)),
                install_dir: Some(path_to_string(&install_dir)),
                bundled_name: bundled_manifest.name,
                bundled_version: bundled_manifest.version,
                installed_name: Some(installed_manifest.name),
                installed_version: Some(installed_manifest.version),
                message,
            })
        }
        Err(error) => Ok(BrowserConnectorInstallStatus {
            status: "broken".to_string(),
            install_root_dir: Some(path_to_string(root_dir)),
            install_dir: Some(path_to_string(&install_dir)),
            bundled_name: bundled_manifest.name,
            bundled_version: bundled_manifest.version,
            installed_name: None,
            installed_version: None,
            message: Some(format!("安装目录存在，但扩展文件不完整: {error}")),
        }),
    }
}

pub fn get_browser_connector_install_status(
    app: &AppHandle,
) -> Result<BrowserConnectorInstallStatus, String> {
    let settings = load_settings_record()?;
    let install_root_dir = settings
        .install_root_dir
        .as_deref()
        .map(normalize_install_root_dir)
        .transpose()?;
    let bundled_extension_dir = resolve_browser_connector_extension_source(app)?;
    build_install_status_from_paths(&bundled_extension_dir, install_root_dir.as_deref())
}

pub fn write_browser_connector_auto_config(
    install_dir: &Path,
    auto_config: &BrowserConnectorAutoConfig,
) -> Result<PathBuf, String> {
    let auto_config_path = install_dir.join("auto_config.json");
    let content = serde_json::to_string_pretty(auto_config)
        .map_err(|error| format!("序列化 auto_config.json 失败: {error}"))?;
    fs::write(&auto_config_path, content)
        .map_err(|error| format!("写入 auto_config.json 失败 {:?}: {error}", auto_config_path))?;
    Ok(auto_config_path)
}

pub fn install_browser_connector_extension(
    app: &AppHandle,
    install_root_dir: &Path,
    auto_config: &BrowserConnectorAutoConfig,
) -> Result<BrowserConnectorInstallResult, String> {
    let bundled_extension_dir = resolve_browser_connector_extension_source(app)?;
    let bundled_manifest = read_manifest_info(&bundled_extension_dir)?;
    let install_dir = resolve_browser_connector_install_dir(install_root_dir);

    fs::create_dir_all(install_root_dir).map_err(|error| format!("创建安装根目录失败: {error}"))?;

    if install_dir.exists() {
        fs::remove_dir_all(&install_dir)
            .map_err(|error| format!("删除旧连接器目录失败 {:?}: {error}", install_dir))?;
    }

    copy_dir_recursive(&bundled_extension_dir, &install_dir)?;
    let auto_config_path = write_browser_connector_auto_config(&install_dir, auto_config)?;

    Ok(BrowserConnectorInstallResult {
        install_root_dir: path_to_string(install_root_dir),
        install_dir: path_to_string(&install_dir),
        bundled_name: bundled_manifest.name,
        bundled_version: bundled_manifest.version.clone(),
        installed_version: bundled_manifest.version,
        auto_config_path: path_to_string(&auto_config_path),
    })
}

pub fn sync_browser_connector_auto_config_if_installed(
    auto_config: &BrowserConnectorAutoConfig,
) -> Result<Option<String>, String> {
    let settings = load_settings_record()?;
    let Some(root_dir) = settings.install_root_dir.as_deref() else {
        return Ok(None);
    };
    let root_dir = normalize_install_root_dir(root_dir)?;
    let install_dir = resolve_browser_connector_install_dir(&root_dir);
    if !install_dir.exists() {
        return Ok(None);
    }

    let auto_config_path = write_browser_connector_auto_config(&install_dir, auto_config)?;
    Ok(Some(path_to_string(&auto_config_path)))
}

pub fn get_browser_connector_settings() -> Result<BrowserConnectorSettingsSnapshot, String> {
    let record = load_settings_record()?;
    Ok(build_settings_snapshot(&record))
}

fn build_settings_snapshot(
    record: &BrowserConnectorSettingsRecord,
) -> BrowserConnectorSettingsSnapshot {
    let install_root_dir = record.install_root_dir.clone();
    let install_dir = install_root_dir
        .as_deref()
        .map(|raw| normalize_install_root_dir(raw).unwrap_or_else(|_| PathBuf::from(raw)))
        .map(|root_dir| path_to_string(&resolve_browser_connector_install_dir(&root_dir)));

    BrowserConnectorSettingsSnapshot {
        enabled: record.enabled,
        install_root_dir,
        install_dir,
        system_connectors: SYSTEM_CONNECTOR_DEFINITIONS
            .iter()
            .map(|(id, label, description)| SystemConnectorSnapshot {
                id: (*id).to_string(),
                label: (*label).to_string(),
                description: (*description).to_string(),
                enabled: record.system_connectors.get(*id).copied().unwrap_or(false),
                available: cfg!(target_os = "macos"),
            })
            .collect(),
    }
}

pub fn update_browser_connector_install_root(
    install_root_dir: &str,
) -> Result<BrowserConnectorSettingsSnapshot, String> {
    let normalized = normalize_install_root_dir(install_root_dir)?;
    fs::create_dir_all(&normalized).map_err(|error| format!("创建安装目录失败: {error}"))?;

    let mut record = load_settings_record()?;
    record.install_root_dir = Some(path_to_string(&normalized));
    record.updated_at = Utc::now().to_rfc3339();
    save_settings_record(&record)?;
    Ok(build_settings_snapshot(&record))
}

pub fn update_browser_connector_enabled(
    enabled: bool,
) -> Result<BrowserConnectorSettingsSnapshot, String> {
    let mut record = load_settings_record()?;
    record.enabled = enabled;
    record.updated_at = Utc::now().to_rfc3339();
    save_settings_record(&record)?;
    Ok(build_settings_snapshot(&record))
}

pub fn update_system_connector_enabled(
    id: &str,
    enabled: bool,
) -> Result<BrowserConnectorSettingsSnapshot, String> {
    if !SYSTEM_CONNECTOR_DEFINITIONS
        .iter()
        .any(|(entry_id, _, _)| *entry_id == id)
    {
        return Err(format!("未知的系统连接器: {id}"));
    }

    let mut record = load_settings_record()?;
    record.system_connectors.insert(id.to_string(), enabled);
    record.updated_at = Utc::now().to_rfc3339();
    save_settings_record(&record)?;
    Ok(build_settings_snapshot(&record))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_extension_dir(base_dir: &Path, version: &str) -> PathBuf {
        let extension_dir = base_dir.join(format!("extension-{version}"));
        fs::create_dir_all(&extension_dir).expect("创建扩展目录失败");
        fs::write(
            extension_dir.join("manifest.json"),
            format!(
                r#"{{
  "name": "Lime Browser Connector",
  "version": "{version}"
}}"#
            ),
        )
        .expect("写入 manifest 失败");
        extension_dir
    }

    #[test]
    fn install_dir_should_use_fixed_child_directory() {
        let root = PathBuf::from("/tmp/lime-browser-root");
        let install_dir = resolve_browser_connector_install_dir(&root);
        assert_eq!(install_dir, root.join("Lime Browser Connector"));
    }

    #[test]
    fn status_should_report_not_installed_without_root_dir() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let bundled_dir = create_extension_dir(temp_dir.path(), "1.0.0");
        let status = build_install_status_from_paths(&bundled_dir, None).expect("读取状态失败");

        assert_eq!(status.status, "not_installed");
        assert_eq!(status.bundled_version, "1.0.0");
        assert!(status.install_root_dir.is_none());
    }

    #[test]
    fn status_should_report_update_available_when_versions_differ() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let bundled_dir = create_extension_dir(temp_dir.path(), "1.1.0");
        let install_root = temp_dir.path().join("user-selected");
        let installed_dir = resolve_browser_connector_install_dir(&install_root);
        fs::create_dir_all(&installed_dir).expect("创建安装目录失败");
        fs::write(
            installed_dir.join("manifest.json"),
            r#"{
  "name": "Lime Browser Connector",
  "version": "1.0.0"
}"#,
        )
        .expect("写入已安装 manifest 失败");

        let status = build_install_status_from_paths(&bundled_dir, Some(&install_root))
            .expect("读取状态失败");
        assert_eq!(status.status, "update_available");
        assert_eq!(status.installed_version.as_deref(), Some("1.0.0"));
        assert_eq!(status.bundled_version, "1.1.0");
    }
}
