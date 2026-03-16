use serde::Serialize;
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::path::PathBuf;

#[cfg(target_os = "windows")]
use std::io::Write;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::path::Path;
#[cfg(target_os = "windows")]
use std::process::Command;
#[cfg(target_os = "windows")]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
#[cfg(target_os = "windows")]
use winreg::{enums::*, RegKey};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize)]
pub struct WindowsStartupCheck {
    pub key: String,
    pub status: String,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowsStartupDiagnostics {
    pub platform: String,
    pub app_data_dir: Option<String>,
    pub legacy_proxycast_dir: Option<String>,
    pub db_path: Option<String>,
    pub webview2_version: Option<String>,
    pub current_exe: Option<String>,
    pub current_dir: Option<String>,
    pub resource_dir: Option<String>,
    pub home_dir: Option<String>,
    pub shell_env: Option<String>,
    pub comspec_env: Option<String>,
    pub resolved_terminal_shell: Option<String>,
    pub installation_kind_guess: Option<String>,
    pub checks: Vec<WindowsStartupCheck>,
    pub has_blocking_issues: bool,
    pub has_warnings: bool,
    pub summary_message: Option<String>,
}

#[tauri::command]
pub async fn get_windows_startup_diagnostics(
    app: AppHandle,
) -> Result<WindowsStartupDiagnostics, String> {
    Ok(collect_windows_startup_diagnostics(&app))
}

#[cfg(target_os = "windows")]
pub fn maybe_show_windows_startup_notice(app: &AppHandle) {
    let diagnostics = collect_windows_startup_diagnostics(app);

    for check in &diagnostics.checks {
        match check.status.as_str() {
            "error" => tracing::error!(
                "[WindowsStartup] {}: {} {}",
                check.key,
                check.message,
                check.detail.as_deref().unwrap_or("")
            ),
            "warning" => tracing::warn!(
                "[WindowsStartup] {}: {} {}",
                check.key,
                check.message,
                check.detail.as_deref().unwrap_or("")
            ),
            _ => tracing::info!(
                "[WindowsStartup] {}: {} {}",
                check.key,
                check.message,
                check.detail.as_deref().unwrap_or("")
            ),
        }
    }

    if !diagnostics.has_blocking_issues {
        return;
    }

    let message = diagnostics.summary_message.clone().unwrap_or_else(|| {
        "检测到 Windows 启动环境存在阻塞问题，请查看日志并优先重新运行 Windows setup 安装包；如处于离线或受限网络环境，请改用 offline 安装包。".to_string()
    });

    app.dialog()
        .message(message)
        .title("ProxyCast Windows 启动自检")
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCustom("我知道了".to_string()))
        .show(|_| {});
}

pub fn collect_windows_startup_diagnostics(app: &AppHandle) -> WindowsStartupDiagnostics {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return WindowsStartupDiagnostics {
            platform: std::env::consts::OS.to_string(),
            app_data_dir: None,
            legacy_proxycast_dir: None,
            db_path: None,
            webview2_version: None,
            current_exe: None,
            current_dir: None,
            resource_dir: None,
            home_dir: None,
            shell_env: None,
            comspec_env: None,
            resolved_terminal_shell: None,
            installation_kind_guess: None,
            checks: vec![],
            has_blocking_issues: false,
            has_warnings: false,
            summary_message: None,
        };
    }

    #[cfg(target_os = "windows")]
    {
        let mut checks = Vec::new();
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        let app_data_dir: Option<PathBuf> = proxycast_core::app_paths::preferred_data_dir().ok();
        let home_dir = dirs::home_dir();
        let legacy_proxycast_dir = home_dir.clone().map(|home| home.join(".proxycast"));
        let db_path = crate::database::get_db_path().ok();
        let webview2_version = detect_webview2_runtime_version();
        let current_exe = std::env::current_exe().ok();
        let current_dir = std::env::current_dir().ok();
        let resource_dir: Option<PathBuf> = app.path().resource_dir().ok();
        let shell_env = get_env_path_value("SHELL");
        let comspec_env = get_env_path_value("COMSPEC");
        let resolved_terminal_shell =
            resolve_terminal_shell(shell_env.as_deref(), comspec_env.as_deref());
        let installation_kind_guess = current_exe
            .as_ref()
            .map(|path| guess_installation_kind(path).to_string());

        match &app_data_dir {
            Some(path) => match ensure_dir_writable(path) {
                Ok(()) => checks.push(ok_check(
                    "app_data_dir",
                    format!("应用数据目录可写: {}", path.display()),
                )),
                Err(error) => {
                    warnings.push(format!("应用数据目录不可写: {}", path.display()));
                    checks.push(warn_check(
                        "app_data_dir",
                        format!("应用数据目录不可写: {}", path.display()),
                        Some(error),
                    ));
                }
            },
            None => {
                warnings.push("无法解析应用数据目录".to_string());
                checks.push(warn_check(
                    "app_data_dir",
                    "无法解析应用数据目录".to_string(),
                    None,
                ));
            }
        }

        match &legacy_proxycast_dir {
            Some(path) if path.exists() => match ensure_existing_dir_writable(path) {
                Ok(()) => checks.push(ok_check(
                    "legacy_proxycast_dir",
                    format!("检测到旧版数据目录且可访问: {}", path.display()),
                )),
                Err(error) => {
                    warnings.push(format!("旧版数据目录不可访问: {}", path.display()));
                    checks.push(warn_check(
                        "legacy_proxycast_dir",
                        format!("旧版数据目录不可访问: {}", path.display()),
                        Some(error),
                    ));
                }
            },
            Some(path) => checks.push(ok_check(
                "legacy_proxycast_dir",
                format!("未检测到旧版数据目录: {}", path.display()),
            )),
            None => {
                warnings.push("无法解析用户 Home 目录".to_string());
                checks.push(warn_check(
                    "legacy_proxycast_dir",
                    "无法解析用户 Home 目录".to_string(),
                    None,
                ));
            }
        }

        match &db_path {
            Some(path) => match check_database_file(path) {
                Ok(()) => checks.push(ok_check(
                    "database",
                    format!("数据库可访问: {}", path.display()),
                )),
                Err(error) => {
                    errors.push(format!("数据库不可访问: {}", path.display()));
                    checks.push(error_check(
                        "database",
                        format!("数据库不可访问: {}", path.display()),
                        Some(error),
                    ));
                }
            },
            None => {
                errors.push("无法解析数据库路径".to_string());
                checks.push(error_check(
                    "database",
                    "无法解析数据库路径".to_string(),
                    None,
                ));
            }
        }

        match &webview2_version {
            Some(version) => checks.push(ok_check(
                "webview2",
                format!("检测到 WebView2 Runtime: {version}"),
            )),
            None => {
                warnings.push("未检测到 WebView2 Runtime 注册表项".to_string());
                checks.push(warn_check(
                    "webview2",
                    "未检测到 WebView2 Runtime 注册表项".to_string(),
                    Some(
                        "如果用户通过便携版或在线安装包启动失败，请优先重新运行 Windows setup 安装包；离线或受限网络环境请改用 offline 安装包。".to_string(),
                    ),
                ));
            }
        }

        match detect_shell_availability() {
            Some(shell) => checks.push(ok_check("shell", format!("检测到可用 Shell: {shell}"))),
            None => {
                warnings.push("未检测到 PowerShell 或 cmd.exe".to_string());
                checks.push(warn_check(
                    "shell",
                    "未检测到 PowerShell 或 cmd.exe".to_string(),
                    Some("Agent、终端与部分系统命令可能无法使用。".to_string()),
                ));
            }
        }

        match &current_exe {
            Some(path) if path.exists() => checks.push(ok_check(
                "current_exe",
                format!("当前可执行文件: {}", path.display()),
            )),
            Some(path) => {
                warnings.push(format!("当前可执行文件不存在: {}", path.display()));
                checks.push(warn_check(
                    "current_exe",
                    format!("当前可执行文件不存在: {}", path.display()),
                    None,
                ));
            }
            None => {
                warnings.push("无法解析当前可执行文件路径".to_string());
                checks.push(warn_check(
                    "current_exe",
                    "无法解析当前可执行文件路径".to_string(),
                    None,
                ));
            }
        }

        match &resource_dir {
            Some(path) if path.exists() => checks.push(ok_check(
                "resource_dir",
                format!("资源目录已解析: {}", path.display()),
            )),
            Some(path) => {
                warnings.push(format!("资源目录不存在: {}", path.display()));
                checks.push(warn_check(
                    "resource_dir",
                    format!("资源目录不存在: {}", path.display()),
                    Some("安装包资源缺失时，模型索引与内置资源初始化可能失败。".to_string()),
                ));
            }
            None => {
                warnings.push("无法解析资源目录".to_string());
                checks.push(warn_check(
                    "resource_dir",
                    "无法解析资源目录".to_string(),
                    Some("便携运行或安装不完整时较常见。".to_string()),
                ));
            }
        }

        if let Some(shell_value) = &shell_env {
            if shell_value.trim_start().starts_with('/') {
                warnings.push(format!("检测到 Unix 风格 SHELL 环境变量: {shell_value}"));
                checks.push(warn_check(
                    "shell_env",
                    format!("检测到 Unix 风格 SHELL 环境变量: {shell_value}"),
                    Some(
                        "旧版本 Windows 终端实现可能错误使用该值并触发 /bin/bash 启动失败。"
                            .to_string(),
                    ),
                ));
            } else {
                checks.push(ok_check(
                    "shell_env",
                    format!("SHELL 环境变量: {shell_value}"),
                ));
            }
        }

        if let Some(comspec_value) = &comspec_env {
            let path = PathBuf::from(comspec_value);
            if path.exists() {
                checks.push(ok_check(
                    "comspec_env",
                    format!("COMSPEC 环境变量: {comspec_value}"),
                ));
            } else {
                warnings.push(format!("COMSPEC 指向的路径不存在: {comspec_value}"));
                checks.push(warn_check(
                    "comspec_env",
                    format!("COMSPEC 指向的路径不存在: {comspec_value}"),
                    Some("终端默认 shell 可能回退到 cmd.exe。".to_string()),
                ));
            }
        }

        match &resolved_terminal_shell {
            Some(shell) => checks.push(ok_check(
                "resolved_terminal_shell",
                format!("终端默认 Shell 解析结果: {shell}"),
            )),
            None => {
                warnings.push("无法解析终端默认 Shell".to_string());
                checks.push(warn_check(
                    "resolved_terminal_shell",
                    "无法解析终端默认 Shell".to_string(),
                    Some(
                        "如终端/Agent 创建失败，请重点检查 SHELL 与 COMSPEC 环境变量。".to_string(),
                    ),
                ));
            }
        }

        let summary_message = if !errors.is_empty() {
            Some(format!(
                "检测到 {} 个阻塞问题：{}。建议先检查目录权限，并优先重新运行 Windows setup 安装包；离线或受限网络环境请改用 offline 安装包。",
                errors.len(),
                errors.join("；")
            ))
        } else if !warnings.is_empty() {
            Some(format!(
                "检测到 {} 个 Windows 环境提示：{}。如用户反馈启动失败，请优先收集日志并确认使用 Windows setup 安装包；离线或受限网络环境请改用 offline 安装包。",
                warnings.len(),
                warnings.join("；")
            ))
        } else {
            None
        };

        WindowsStartupDiagnostics {
            platform: "windows".to_string(),
            app_data_dir: app_data_dir.map(path_to_string),
            legacy_proxycast_dir: legacy_proxycast_dir.map(path_to_string),
            db_path: db_path.map(path_to_string),
            webview2_version,
            current_exe: current_exe.map(path_to_string),
            current_dir: current_dir.map(path_to_string),
            resource_dir: resource_dir.map(path_to_string),
            home_dir: home_dir.map(path_to_string),
            shell_env,
            comspec_env,
            resolved_terminal_shell,
            installation_kind_guess,
            checks,
            has_blocking_issues: !errors.is_empty(),
            has_warnings: !warnings.is_empty(),
            summary_message,
        }
    }
}

#[cfg(target_os = "windows")]
fn ok_check(key: &str, message: String) -> WindowsStartupCheck {
    WindowsStartupCheck {
        key: key.to_string(),
        status: "ok".to_string(),
        message,
        detail: None,
    }
}

#[cfg(target_os = "windows")]
fn warn_check(key: &str, message: String, detail: Option<String>) -> WindowsStartupCheck {
    WindowsStartupCheck {
        key: key.to_string(),
        status: "warning".to_string(),
        message,
        detail,
    }
}

#[cfg(target_os = "windows")]
fn error_check(key: &str, message: String, detail: Option<String>) -> WindowsStartupCheck {
    WindowsStartupCheck {
        key: key.to_string(),
        status: "error".to_string(),
        message,
        detail,
    }
}

#[cfg(target_os = "windows")]
fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(target_os = "windows")]
fn ensure_dir_writable(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| format!("创建目录失败 {}: {e}", path.display()))?;

    let probe = path.join("proxycast-write-test.tmp");
    let mut file = std::fs::File::create(&probe)
        .map_err(|e| format!("创建测试文件失败 {}: {e}", probe.display()))?;
    file.write_all(b"proxycast")
        .map_err(|e| format!("写入测试文件失败 {}: {e}", probe.display()))?;
    file.sync_all()
        .map_err(|e| format!("刷新测试文件失败 {}: {e}", probe.display()))?;
    std::fs::remove_file(&probe)
        .map_err(|e| format!("删除测试文件失败 {}: {e}", probe.display()))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_existing_dir_writable(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let probe = path.join("proxycast-write-test.tmp");
    let mut file = std::fs::File::create(&probe)
        .map_err(|e| format!("创建测试文件失败 {}: {e}", probe.display()))?;
    file.write_all(b"proxycast")
        .map_err(|e| format!("写入测试文件失败 {}: {e}", probe.display()))?;
    file.sync_all()
        .map_err(|e| format!("刷新测试文件失败 {}: {e}", probe.display()))?;
    std::fs::remove_file(&probe)
        .map_err(|e| format!("删除测试文件失败 {}: {e}", probe.display()))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn check_database_file(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        ensure_dir_writable(parent)?;
    }

    let conn = rusqlite::Connection::open(path)
        .map_err(|e| format!("打开数据库失败 {}: {e}", path.display()))?;
    conn.query_row("PRAGMA user_version", [], |_| Ok(()))
        .map_err(|e| format!("执行数据库探测失败 {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_windows_no_window(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(target_os = "windows")]
fn detect_webview2_runtime_version() -> Option<String> {
    const VALUE_NAME: &str = "pv";
    let key_paths = [
        "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    ];

    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let hive = RegKey::predef(root);
        for key_path in key_paths {
            if let Ok(key) = hive.open_subkey_with_flags(key_path, KEY_READ) {
                let version: Result<String, _> = key.get_value(VALUE_NAME);
                if let Ok(version) = version {
                    let trimmed = version.trim();
                    if !trimmed.is_empty() && trimmed != "0.0.0.0" {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn get_env_path_value(key: &str) -> Option<String> {
    let value = std::env::var(key).ok()?;
    let cleaned = value
        .split('\0')
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    (!cleaned.is_empty()).then_some(cleaned)
}

#[cfg(target_os = "windows")]
fn is_valid_windows_shell(candidate: &str) -> bool {
    let cleaned = candidate.trim();
    if cleaned.is_empty() {
        return false;
    }

    if cleaned.starts_with('/') {
        return false;
    }

    let path = Path::new(cleaned);
    if path.is_absolute() {
        if !path.exists() {
            return false;
        }

        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());

        return matches!(ext.as_deref(), Some("exe" | "cmd" | "bat" | "com"));
    }

    if cleaned.contains('/') || cleaned.contains('\\') {
        return false;
    }

    true
}

#[cfg(target_os = "windows")]
fn resolve_terminal_shell(shell_env: Option<&str>, comspec_env: Option<&str>) -> Option<String> {
    if let Some(shell) = shell_env {
        if is_valid_windows_shell(shell) {
            return Some(shell.trim().to_string());
        }
    }

    if let Some(comspec) = comspec_env {
        if is_valid_windows_shell(comspec) {
            return Some(comspec.trim().to_string());
        }
    }

    Some("cmd.exe".to_string())
}

#[cfg(target_os = "windows")]
fn guess_installation_kind(path: &Path) -> &'static str {
    let lowered = path.to_string_lossy().to_ascii_lowercase();
    if lowered.contains("\\downloads\\")
        || lowered.contains("\\desktop\\")
        || lowered.contains("\\temp\\")
        || lowered.contains("\\appdata\\local\\temp\\")
    {
        return "portable-like";
    }

    if lowered.contains("\\program files\\")
        || lowered.contains("\\program files (x86)\\")
        || lowered.contains("\\appdata\\local\\programs\\")
    {
        return "installed-like";
    }

    "unknown"
}

#[cfg(target_os = "windows")]
fn detect_shell_availability() -> Option<String> {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    let powershell = PathBuf::from(&windir)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if powershell.exists() {
        return Some(powershell.to_string_lossy().to_string());
    }

    if let Ok(comspec) = std::env::var("COMSPEC") {
        let path = PathBuf::from(comspec.trim());
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    let mut pwsh_check = Command::new("pwsh");
    apply_windows_no_window(&mut pwsh_check);
    let pwsh_check = pwsh_check.args(["-v"]).output();
    if pwsh_check
        .map(|output| output.status.success())
        .unwrap_or(false)
    {
        return Some("pwsh".to_string());
    }

    None
}
