//! 浏览器连接器服务
//!
//! 负责浏览器连接器安装目录、导出同步和本地设置持久化。

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use tauri::{AppHandle, Manager};

const SETTINGS_SUBDIR: &str = "connectors";
const SETTINGS_FILE_NAME: &str = "browser-connector-settings.json";
const EXTENSION_INSTALL_DIR_NAME: &str = "Lime Browser Connector";
const EXTENSION_SYNC_REQUIRED_FILES: [&str; 4] = [
    "manifest.json",
    "background.js",
    "content_script.js",
    "site_adapter_runners.generated.js",
];

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

const BROWSER_ACTION_CAPABILITY_DEFINITIONS: [(&str, &str, &str, &str); 20] = [
    (
        "tabs_context_mcp",
        "标签页概览",
        "读取当前已附着标签页的上下文摘要。",
        "read",
    ),
    ("list_tabs", "列出标签页", "列出当前浏览器标签页。", "read"),
    (
        "tabs_create_mcp",
        "新建标签页",
        "创建新的浏览器标签页。",
        "write",
    ),
    ("read_page", "页面快照", "抓取当前页面快照。", "read"),
    (
        "get_page_text",
        "页面文本",
        "读取当前页面文本内容。",
        "read",
    ),
    (
        "get_page_info",
        "页面信息",
        "读取页面标题、URL 与快照信息。",
        "read",
    ),
    ("find", "页面内查找", "在当前页面中查找文本。", "read"),
    (
        "read_console_messages",
        "控制台消息",
        "读取浏览器控制台消息。",
        "read",
    ),
    (
        "read_network_requests",
        "网络请求",
        "读取页面网络请求记录。",
        "read",
    ),
    ("navigate", "导航", "导航到目标地址。", "write"),
    ("open_url", "打开链接", "直接打开目标链接。", "write"),
    ("click", "点击元素", "点击页面元素。", "write"),
    ("type", "输入文本", "向当前页面输入文本。", "write"),
    ("form_input", "表单输入", "按字段填写页面表单。", "write"),
    ("switch_tab", "切换标签页", "切换当前操作标签页。", "write"),
    ("scroll_page", "滚动页面", "滚动当前页面或容器。", "write"),
    ("refresh_page", "刷新页面", "刷新当前页面。", "write"),
    ("go_back", "返回上一页", "返回上一页。", "write"),
    ("go_forward", "前进到下一页", "前进到下一页。", "write"),
    ("javascript", "执行脚本", "在当前页面执行脚本。", "write"),
];

const AUTH_STATUS_NOT_DETERMINED: &str = "not_determined";
#[cfg(target_os = "macos")]
const AUTH_STATUS_AUTHORIZED: &str = "authorized";
#[cfg(target_os = "macos")]
const AUTH_STATUS_DENIED: &str = "denied";
const AUTH_STATUS_ERROR: &str = "error";
const AUTH_STATUS_UNSUPPORTED: &str = "unsupported";

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
    pub visible: bool,
    pub authorization_status: String,
    pub last_error: Option<String>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserActionCapabilitySnapshot {
    pub key: String,
    pub label: String,
    pub description: String,
    pub group: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConnectorSettingsSnapshot {
    pub enabled: bool,
    pub install_root_dir: Option<String>,
    pub install_dir: Option<String>,
    pub system_connectors: Vec<SystemConnectorSnapshot>,
    pub browser_action_capabilities: Vec<BrowserActionCapabilitySnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BrowserConnectorSettingsRecord {
    enabled: bool,
    install_root_dir: Option<String>,
    system_connectors: HashMap<String, StoredSystemConnectorState>,
    #[serde(default = "default_browser_action_capability_states")]
    browser_action_capabilities: HashMap<String, bool>,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum StoredSystemConnectorState {
    LegacyBool(bool),
    Detailed(SystemConnectorStateRecord),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SystemConnectorStateRecord {
    enabled: bool,
    authorization_status: String,
    last_error: Option<String>,
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
            system_connectors: default_system_connector_state_records(),
            browser_action_capabilities: default_browser_action_capability_states(),
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

fn default_system_connector_state_records() -> HashMap<String, StoredSystemConnectorState> {
    default_system_connector_states()
        .into_iter()
        .map(|(id, enabled)| (id, StoredSystemConnectorState::LegacyBool(enabled)))
        .collect()
}

fn default_browser_action_capability_states() -> HashMap<String, bool> {
    BROWSER_ACTION_CAPABILITY_DEFINITIONS
        .iter()
        .map(|(key, _, _, _)| ((*key).to_string(), true))
        .collect()
}

fn default_connector_record(enabled: bool) -> SystemConnectorStateRecord {
    SystemConnectorStateRecord {
        enabled,
        authorization_status: if cfg!(target_os = "macos") {
            AUTH_STATUS_NOT_DETERMINED.to_string()
        } else {
            AUTH_STATUS_UNSUPPORTED.to_string()
        },
        last_error: None,
    }
}

fn normalize_connector_record(
    state: Option<&StoredSystemConnectorState>,
) -> SystemConnectorStateRecord {
    match state {
        Some(StoredSystemConnectorState::LegacyBool(enabled)) => default_connector_record(*enabled),
        Some(StoredSystemConnectorState::Detailed(record)) => record.clone(),
        None => default_connector_record(false),
    }
}

fn normalize_browser_action_capability_key(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "scroll" => "scroll_page".to_string(),
        "javascript_tool" => "javascript".to_string(),
        other => other.to_string(),
    }
}

fn browser_action_capability_definition(
    key: &str,
) -> Option<(&'static str, &'static str, &'static str, &'static str)> {
    BROWSER_ACTION_CAPABILITY_DEFINITIONS
        .iter()
        .copied()
        .find(|(candidate, _, _, _)| *candidate == key)
}

fn browser_action_capability_enabled_in_record(
    record: &BrowserConnectorSettingsRecord,
    action: &str,
) -> bool {
    let normalized = normalize_browser_action_capability_key(action);
    match browser_action_capability_definition(&normalized) {
        Some((key, _, _, _)) => record
            .browser_action_capabilities
            .get(key)
            .copied()
            .unwrap_or(true),
        None => true,
    }
}

fn browser_action_capability_snapshots(
    record: &BrowserConnectorSettingsRecord,
) -> Vec<BrowserActionCapabilitySnapshot> {
    BROWSER_ACTION_CAPABILITY_DEFINITIONS
        .iter()
        .map(
            |(key, label, description, group)| BrowserActionCapabilitySnapshot {
                key: (*key).to_string(),
                label: (*label).to_string(),
                description: (*description).to_string(),
                group: (*group).to_string(),
                enabled: record
                    .browser_action_capabilities
                    .get(*key)
                    .copied()
                    .unwrap_or(true),
            },
        )
        .collect()
}

fn connector_capabilities(id: &str) -> Vec<String> {
    match id {
        "reminders" => vec![
            "list_reminders".to_string(),
            "create_reminder".to_string(),
            "update_reminder".to_string(),
        ],
        "calendar" => vec![
            "list_events".to_string(),
            "create_event".to_string(),
            "update_event".to_string(),
        ],
        "notes" => vec![
            "list_notes".to_string(),
            "read_note".to_string(),
            "create_note".to_string(),
        ],
        "mail" => vec![
            "list_mailboxes".to_string(),
            "read_messages".to_string(),
            "create_draft".to_string(),
        ],
        "contacts" => vec![
            "search_contacts".to_string(),
            "read_contact".to_string(),
            "create_contact".to_string(),
        ],
        _ => Vec::new(),
    }
}

#[cfg(target_os = "macos")]
fn connector_probe_script(id: &str) -> Option<&'static str> {
    match id {
        "reminders" => Some(r#"tell application id "com.apple.reminders" to count of lists"#),
        "calendar" => Some(r#"tell application id "com.apple.iCal" to count of calendars"#),
        "notes" => Some(r#"tell application id "com.apple.Notes" to count of folders"#),
        "mail" => Some(r#"tell application id "com.apple.mail" to count of mailboxes"#),
        "contacts" => Some(r#"tell application id "com.apple.AddressBook" to count of people"#),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn truncate_connector_error(input: &str) -> String {
    input
        .trim()
        .split('\n')
        .find(|line| !line.trim().is_empty())
        .unwrap_or(input)
        .trim()
        .to_string()
}

#[cfg(target_os = "macos")]
fn request_connector_authorization(id: &str) -> Result<SystemConnectorStateRecord, String> {
    let script = connector_probe_script(id).ok_or_else(|| format!("未知的系统连接器: {id}"))?;
    let output = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|error| format!("调用 osascript 失败: {error}"))?;

    if output.status.success() {
        return Ok(SystemConnectorStateRecord {
            enabled: true,
            authorization_status: AUTH_STATUS_AUTHORIZED.to_string(),
            last_error: None,
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let combined = format!("{stderr}\n{stdout}");
    let normalized = combined.to_ascii_lowercase();
    let last_error = truncate_connector_error(&combined);

    if normalized.contains("not authorized")
        || normalized.contains("not permitted")
        || normalized.contains("(-1743)")
        || normalized.contains("1743")
    {
        return Ok(SystemConnectorStateRecord {
            enabled: false,
            authorization_status: AUTH_STATUS_DENIED.to_string(),
            last_error: Some(if last_error.is_empty() {
                "系统已拒绝该连接器的自动化权限。".to_string()
            } else {
                last_error
            }),
        });
    }

    Ok(SystemConnectorStateRecord {
        enabled: false,
        authorization_status: AUTH_STATUS_ERROR.to_string(),
        last_error: Some(if last_error.is_empty() {
            "系统连接器授权失败。".to_string()
        } else {
            last_error
        }),
    })
}

#[cfg(not(target_os = "macos"))]
fn request_connector_authorization(_id: &str) -> Result<SystemConnectorStateRecord, String> {
    Ok(SystemConnectorStateRecord {
        enabled: false,
        authorization_status: AUTH_STATUS_UNSUPPORTED.to_string(),
        last_error: Some("当前平台暂不支持系统连接器。".to_string()),
    })
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
        record
            .system_connectors
            .entry(id)
            .or_insert(StoredSystemConnectorState::LegacyBool(enabled));
    }
    for (key, enabled) in default_browser_action_capability_states() {
        record
            .browser_action_capabilities
            .entry(key)
            .or_insert(enabled);
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

fn detect_extension_sync_drift(
    bundled_extension_dir: &Path,
    install_dir: &Path,
) -> Result<Option<String>, String> {
    for relative_path in EXTENSION_SYNC_REQUIRED_FILES {
        let bundled_path = bundled_extension_dir.join(relative_path);
        let bundled_content = fs::read(&bundled_path)
            .map_err(|error| format!("读取内置连接器文件失败 {:?}: {error}", bundled_path))?;

        let installed_path = install_dir.join(relative_path);
        let installed_content = match fs::read(&installed_path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Some(format!("缺少关键文件 {relative_path}")));
            }
            Err(error) => {
                return Ok(Some(format!("关键文件 {relative_path} 无法读取: {error}")));
            }
        };

        if installed_content != bundled_content {
            return Ok(Some(format!("关键文件 {relative_path} 已变化")));
        }
    }

    Ok(None)
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
            let (status, message) = if installed_manifest.version != bundled_manifest.version {
                (
                    "update_available",
                    Some("检测到用户目录中的连接器版本落后于当前应用".to_string()),
                )
            } else if let Some(drift_reason) =
                detect_extension_sync_drift(bundled_extension_dir, &install_dir)?
            {
                (
                    "update_available",
                    Some(format!(
                        "检测到已安装连接器与当前应用内置扩展不一致（{drift_reason}），请重新同步扩展"
                    )),
                )
            } else {
                ("installed", Some("已安装最新版本浏览器连接器".to_string()))
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
        browser_action_capabilities: browser_action_capability_snapshots(record),
        system_connectors: if cfg!(target_os = "macos") {
            SYSTEM_CONNECTOR_DEFINITIONS
                .iter()
                .map(|(id, label, description)| {
                    let connector_record =
                        normalize_connector_record(record.system_connectors.get(*id));
                    SystemConnectorSnapshot {
                        id: (*id).to_string(),
                        label: (*label).to_string(),
                        description: (*description).to_string(),
                        enabled: connector_record.enabled,
                        available: true,
                        visible: true,
                        authorization_status: connector_record.authorization_status,
                        last_error: connector_record.last_error,
                        capabilities: connector_capabilities(id),
                    }
                })
                .collect()
        } else {
            Vec::new()
        },
    }
}

pub fn ensure_browser_action_capability_enabled(action: &str) -> Result<(), String> {
    let record = load_settings_record()?;
    let normalized = normalize_browser_action_capability_key(action);
    let Some((key, label, _, _)) = browser_action_capability_definition(&normalized) else {
        return Ok(());
    };
    if browser_action_capability_enabled_in_record(&record, key) {
        return Ok(());
    }
    Err(format!("浏览器动作已被禁用: {label}"))
}

pub fn filter_enabled_browser_action_capabilities(
    capabilities: &[String],
) -> Result<Vec<String>, String> {
    let record = load_settings_record()?;
    Ok(capabilities
        .iter()
        .filter(|capability| browser_action_capability_enabled_in_record(&record, capability))
        .cloned()
        .collect())
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
    let next_state = if enabled {
        request_connector_authorization(id)?
    } else {
        let mut current = normalize_connector_record(record.system_connectors.get(id));
        current.enabled = false;
        current.last_error = None;
        if !cfg!(target_os = "macos") {
            current.authorization_status = AUTH_STATUS_UNSUPPORTED.to_string();
        } else if current.authorization_status == AUTH_STATUS_ERROR {
            current.authorization_status = AUTH_STATUS_NOT_DETERMINED.to_string();
        }
        current
    };
    record.system_connectors.insert(
        id.to_string(),
        StoredSystemConnectorState::Detailed(next_state),
    );
    record.updated_at = Utc::now().to_rfc3339();
    save_settings_record(&record)?;
    Ok(build_settings_snapshot(&record))
}

pub fn update_browser_action_capability_enabled(
    key: &str,
    enabled: bool,
) -> Result<BrowserConnectorSettingsSnapshot, String> {
    let normalized = normalize_browser_action_capability_key(key);
    let Some((definition_key, _, _, _)) = browser_action_capability_definition(&normalized) else {
        return Err(format!("未知的浏览器动作能力: {key}"));
    };

    let mut record = load_settings_record()?;
    record
        .browser_action_capabilities
        .insert(definition_key.to_string(), enabled);
    record.updated_at = Utc::now().to_rfc3339();
    save_settings_record(&record)?;
    Ok(build_settings_snapshot(&record))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_extension_fixture(extension_dir: &Path, version: &str, tag: &str) {
        fs::create_dir_all(&extension_dir).expect("创建扩展目录失败");
        fs::write(
            extension_dir.join("manifest.json"),
            format!(
                r#"{{
  "name": "Lime Browser Bridge",
  "version": "{version}"
}}"#
            ),
        )
        .expect("写入 manifest 失败");
        fs::write(
            extension_dir.join("background.js"),
            format!("globalThis.__lime_background = \"{tag}\";\n"),
        )
        .expect("写入 background.js 失败");
        fs::write(
            extension_dir.join("content_script.js"),
            format!("globalThis.__lime_content = \"{tag}\";\n"),
        )
        .expect("写入 content_script.js 失败");
        fs::write(
            extension_dir.join("site_adapter_runners.generated.js"),
            format!("globalThis.__lime_generated = \"{tag}\";\n"),
        )
        .expect("写入 site_adapter_runners.generated.js 失败");
    }

    fn create_extension_dir(base_dir: &Path, version: &str, tag: &str) -> PathBuf {
        let extension_dir = base_dir.join(format!("extension-{version}-{tag}"));
        write_extension_fixture(&extension_dir, version, tag);
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
        let bundled_dir = create_extension_dir(temp_dir.path(), "1.0.0", "bundled");
        let status = build_install_status_from_paths(&bundled_dir, None).expect("读取状态失败");

        assert_eq!(status.status, "not_installed");
        assert_eq!(status.bundled_version, "1.0.0");
        assert!(status.install_root_dir.is_none());
    }

    #[test]
    fn status_should_report_update_available_when_versions_differ() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let bundled_dir = create_extension_dir(temp_dir.path(), "1.1.0", "bundled");
        let install_root = temp_dir.path().join("user-selected");
        let installed_dir = resolve_browser_connector_install_dir(&install_root);
        write_extension_fixture(&installed_dir, "1.0.0", "installed");

        let status = build_install_status_from_paths(&bundled_dir, Some(&install_root))
            .expect("读取状态失败");
        assert_eq!(status.status, "update_available");
        assert_eq!(status.installed_version.as_deref(), Some("1.0.0"));
        assert_eq!(status.bundled_version, "1.1.0");
    }

    #[test]
    fn status_should_report_installed_when_versions_and_files_match() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let bundled_dir = create_extension_dir(temp_dir.path(), "1.1.0", "bundled");
        let install_root = temp_dir.path().join("user-selected");
        let installed_dir = resolve_browser_connector_install_dir(&install_root);
        copy_dir_recursive(&bundled_dir, &installed_dir).expect("复制安装目录失败");

        let status = build_install_status_from_paths(&bundled_dir, Some(&install_root))
            .expect("读取状态失败");

        assert_eq!(status.status, "installed");
        assert_eq!(
            status.message.as_deref(),
            Some("已安装最新版本浏览器连接器")
        );
    }

    #[test]
    fn status_should_report_update_available_when_required_file_missing() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let bundled_dir = create_extension_dir(temp_dir.path(), "1.1.0", "bundled");
        let install_root = temp_dir.path().join("user-selected");
        let installed_dir = resolve_browser_connector_install_dir(&install_root);
        copy_dir_recursive(&bundled_dir, &installed_dir).expect("复制安装目录失败");
        fs::remove_file(installed_dir.join("site_adapter_runners.generated.js"))
            .expect("删除 generated runner 失败");

        let status = build_install_status_from_paths(&bundled_dir, Some(&install_root))
            .expect("读取状态失败");

        assert_eq!(status.status, "update_available");
        assert!(status
            .message
            .as_deref()
            .is_some_and(|message| message.contains("site_adapter_runners.generated.js")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn settings_snapshot_should_expose_visible_system_connectors_on_macos() {
        let record = BrowserConnectorSettingsRecord::default();
        let snapshot = build_settings_snapshot(&record);

        assert_eq!(
            snapshot.system_connectors.len(),
            SYSTEM_CONNECTOR_DEFINITIONS.len()
        );
        assert!(snapshot
            .system_connectors
            .iter()
            .all(|connector| connector.visible));
        assert!(snapshot
            .system_connectors
            .iter()
            .all(|connector| connector.available));
        assert!(snapshot
            .system_connectors
            .iter()
            .all(|connector| !connector.capabilities.is_empty()));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn settings_snapshot_should_hide_system_connectors_on_non_macos() {
        let record = BrowserConnectorSettingsRecord::default();
        let snapshot = build_settings_snapshot(&record);

        assert!(snapshot.system_connectors.is_empty());
    }

    #[test]
    fn settings_snapshot_should_include_browser_action_capabilities() {
        let record = BrowserConnectorSettingsRecord::default();
        let snapshot = build_settings_snapshot(&record);

        assert!(!snapshot.browser_action_capabilities.is_empty());
        assert!(snapshot
            .browser_action_capabilities
            .iter()
            .any(|capability| capability.key == "find" && capability.enabled));
    }

    #[test]
    fn filter_enabled_browser_action_capabilities_should_hide_disabled_actions() {
        let mut record = BrowserConnectorSettingsRecord::default();
        record
            .browser_action_capabilities
            .insert("find".to_string(), false);

        let filtered = vec![
            "read_page".to_string(),
            "find".to_string(),
            "click".to_string(),
        ]
        .into_iter()
        .filter(|capability| browser_action_capability_enabled_in_record(&record, capability))
        .collect::<Vec<_>>();

        assert_eq!(filtered, vec!["read_page".to_string(), "click".to_string()]);
    }
}
