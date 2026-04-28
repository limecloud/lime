//! 浏览器连接器命令

use crate::app::AppState;
use crate::services::browser_connector_guide_window::{
    normalize_browser_connector_guide_mode,
    open_browser_connector_guide_window as open_browser_connector_guide_window_service,
};
use crate::services::browser_connector_service::{
    get_browser_connector_install_status, get_browser_connector_settings,
    install_browser_connector_extension, sync_browser_connector_auto_config_if_installed,
    update_browser_action_capability_enabled, update_browser_connector_enabled,
    update_browser_connector_install_root, update_system_connector_enabled,
    BrowserConnectorAutoConfig, BrowserConnectorInstallResult, BrowserConnectorInstallStatus,
    BrowserConnectorSettingsSnapshot,
};
use serde::Deserialize;
use tauri::{AppHandle, State};

#[derive(Debug, Deserialize)]
pub struct SetBrowserConnectorInstallRootRequest {
    pub install_root_dir: String,
}

#[derive(Debug, Deserialize)]
pub struct InstallBrowserConnectorExtensionRequest {
    #[serde(default)]
    pub install_root_dir: Option<String>,
    #[serde(default)]
    pub profile_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetSystemConnectorEnabledRequest {
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct SetBrowserActionCapabilityEnabledRequest {
    pub key: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct OpenBrowserConnectorGuideWindowRequest {
    #[serde(default)]
    pub mode: Option<String>,
}

fn normalize_bridge_host(host: &str) -> String {
    match host.trim() {
        "" | "0.0.0.0" | "::" | "[::]" => "127.0.0.1".to_string(),
        value => value.to_string(),
    }
}

async fn build_auto_config(
    app_state: &AppState,
    profile_key: Option<&str>,
    monitoring_enabled: bool,
) -> Result<BrowserConnectorAutoConfig, String> {
    let state_guard = app_state.read().await;
    let status = state_guard.status();
    let host = normalize_bridge_host(&status.host);
    let bridge_key = state_guard.config.server.api_key.clone();
    let profile_key = profile_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default")
        .to_string();

    Ok(BrowserConnectorAutoConfig {
        server_url: format!("ws://{host}:{}", status.port),
        bridge_key,
        profile_key,
        monitoring_enabled,
    })
}

fn open_chrome_url(url: &str) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        command.args(["-a", "Google Chrome", url]);
        if let Err(primary_error) = command.spawn() {
            std::process::Command::new("open")
                .arg(url)
                .spawn()
                .map_err(|fallback_error| {
                    format!("打开 Chrome 页面失败: {primary_error}; fallback: {fallback_error}")
                })?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|error| format!("打开 Chrome 页面失败: {error}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        let attempts = [
            ("google-chrome", vec![url]),
            ("chromium", vec![url]),
            ("xdg-open", vec![url]),
        ];

        let mut last_error = None;
        let mut opened = false;
        for (binary, args) in attempts {
            match std::process::Command::new(binary).args(args).spawn() {
                Ok(_) => {
                    opened = true;
                    break;
                }
                Err(error) => {
                    last_error = Some(format!("{binary}: {error}"));
                }
            }
        }

        if !opened {
            return Err(format!(
                "打开 Chrome 页面失败: {}",
                last_error.unwrap_or_else(|| "没有可用的浏览器命令".to_string())
            ));
        }
    }

    Ok(true)
}

#[tauri::command]
pub fn get_browser_connector_settings_cmd() -> Result<BrowserConnectorSettingsSnapshot, String> {
    get_browser_connector_settings()
}

#[tauri::command]
pub fn set_browser_connector_install_root_cmd(
    request: SetBrowserConnectorInstallRootRequest,
) -> Result<BrowserConnectorSettingsSnapshot, String> {
    update_browser_connector_install_root(&request.install_root_dir)
}

#[tauri::command]
pub async fn set_browser_connector_enabled_cmd(
    app_state: State<'_, AppState>,
    enabled: bool,
) -> Result<BrowserConnectorSettingsSnapshot, String> {
    let snapshot = update_browser_connector_enabled(enabled)?;
    let auto_config = build_auto_config(app_state.inner(), None, enabled).await?;
    let _ = sync_browser_connector_auto_config_if_installed(&auto_config)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn set_system_connector_enabled_cmd(
    request: SetSystemConnectorEnabledRequest,
) -> Result<BrowserConnectorSettingsSnapshot, String> {
    update_system_connector_enabled(&request.id, request.enabled)
}

#[tauri::command]
pub fn set_browser_action_capability_enabled_cmd(
    request: SetBrowserActionCapabilityEnabledRequest,
) -> Result<BrowserConnectorSettingsSnapshot, String> {
    update_browser_action_capability_enabled(&request.key, request.enabled)
}

#[tauri::command]
pub fn get_browser_connector_install_status_cmd(
    app: AppHandle,
) -> Result<BrowserConnectorInstallStatus, String> {
    get_browser_connector_install_status(&app)
}

#[tauri::command]
pub async fn install_browser_connector_extension_cmd(
    app: AppHandle,
    app_state: State<'_, AppState>,
    request: InstallBrowserConnectorExtensionRequest,
) -> Result<BrowserConnectorInstallResult, String> {
    let settings = if let Some(install_root_dir) = request.install_root_dir.as_deref() {
        update_browser_connector_install_root(install_root_dir)?
    } else {
        get_browser_connector_settings()?
    };

    let install_root_dir = settings
        .install_root_dir
        .ok_or_else(|| "尚未选择浏览器连接器安装目录".to_string())?;
    let auto_config = build_auto_config(
        app_state.inner(),
        request.profile_key.as_deref(),
        settings.enabled,
    )
    .await?;

    install_browser_connector_extension(&app, std::path::Path::new(&install_root_dir), &auto_config)
}

#[tauri::command]
pub async fn open_browser_extensions_page_cmd() -> Result<bool, String> {
    open_chrome_url("chrome://extensions")
}

#[tauri::command]
pub async fn open_browser_remote_debugging_page_cmd() -> Result<bool, String> {
    open_chrome_url("chrome://inspect/#remote-debugging")
}

#[tauri::command]
pub fn open_browser_connector_guide_window(
    app: AppHandle,
    request: Option<OpenBrowserConnectorGuideWindowRequest>,
) -> Result<(), String> {
    let mode = request.and_then(|request| request.mode);
    let mode = normalize_browser_connector_guide_mode(mode.as_deref());
    open_browser_connector_guide_window_service(&app, mode)
        .map_err(|error| format!("打开浏览器连接器引导窗口失败: {error}"))
}
