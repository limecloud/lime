//! Chrome Native Messaging Host 安装和管理

use std::path::PathBuf;
use tokio::fs;

use super::types::*;

/// 获取当前平台
pub fn get_platform() -> Platform {
    #[cfg(target_os = "macos")]
    {
        Platform::MacOS
    }

    #[cfg(target_os = "windows")]
    {
        Platform::Windows
    }

    #[cfg(target_os = "linux")]
    {
        // 检查是否在 WSL 中
        if let Ok(release) = std::fs::read_to_string("/proc/version") {
            if release.to_lowercase().contains("microsoft")
                || release.to_lowercase().contains("wsl")
            {
                return Platform::Wsl;
            }
        }
        Platform::Linux
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Platform::Unknown
    }
}

/// 获取 Chrome Native Messaging Hosts 目录路径
pub fn get_native_hosts_directory() -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    match get_platform() {
        Platform::MacOS => Some(
            home.join("Library")
                .join("Application Support")
                .join("Google")
                .join("Chrome")
                .join("NativeMessagingHosts"),
        ),
        Platform::Linux => Some(
            home.join(".config")
                .join("google-chrome")
                .join("NativeMessagingHosts"),
        ),
        Platform::Windows => {
            let app_data = std::env::var("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|_| home.join("AppData").join("Local"));
            Some(app_data.join("Claude Code").join("ChromeNativeHost"))
        }
        _ => None,
    }
}

/// 获取 Claude 配置目录
pub fn get_claude_config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
}

/// 获取 Socket 路径
pub fn get_socket_path() -> String {
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    let socket_name = format!("aster-mcp-browser-bridge-{}", username);

    #[cfg(windows)]
    return format!("\\\\.\\pipe\\{}", socket_name);

    #[cfg(not(windows))]
    return std::env::temp_dir()
        .join(socket_name)
        .to_string_lossy()
        .to_string();
}

/// 生成 Native Host Manifest
pub fn generate_native_host_manifest(wrapper_script_path: &str) -> serde_json::Value {
    serde_json::json!({
        "name": NATIVE_HOST_NAME,
        "description": "Aster Browser Extension Native Host",
        "path": wrapper_script_path,
        "type": "stdio",
        "allowed_origins": [
            format!("chrome-extension://{}/", CHROME_EXTENSION_ID)
        ]
    })
}

/// 生成 Native Host Wrapper Script
pub fn generate_wrapper_script(command: &str) -> String {
    match get_platform() {
        Platform::Windows => format!(
            "@echo off\nREM Chrome native host wrapper script\n{}\n",
            command
        ),
        _ => format!(
            "#!/bin/bash\n# Chrome native host wrapper script\nexec {}\n",
            command
        ),
    }
}

/// 检查 Chrome 集成是否支持
pub fn is_chrome_integration_supported() -> bool {
    matches!(
        get_platform(),
        Platform::MacOS | Platform::Linux | Platform::Windows
    )
}

/// 检查 Chrome 集成是否已配置
pub async fn is_chrome_integration_configured() -> bool {
    let hosts_dir = match get_native_hosts_directory() {
        Some(d) => d,
        None => return false,
    };

    let manifest_path = hosts_dir.join(format!("{}.json", NATIVE_HOST_NAME));
    fs::metadata(&manifest_path).await.is_ok()
}

/// 获取所有 MCP 工具名称
pub fn get_mcp_tool_names() -> Vec<String> {
    vec![
        "mcp__claude-in-chrome__javascript_tool".to_string(),
        "mcp__claude-in-chrome__read_page".to_string(),
        "mcp__claude-in-chrome__find".to_string(),
        "mcp__claude-in-chrome__form_input".to_string(),
        "mcp__claude-in-chrome__computer".to_string(),
        "mcp__claude-in-chrome__navigate".to_string(),
        "mcp__claude-in-chrome__resize_window".to_string(),
        "mcp__claude-in-chrome__gif_creator".to_string(),
        "mcp__claude-in-chrome__upload_image".to_string(),
        "mcp__claude-in-chrome__get_page_text".to_string(),
        "mcp__claude-in-chrome__tabs_context_mcp".to_string(),
        "mcp__claude-in-chrome__tabs_create_mcp".to_string(),
        "mcp__claude-in-chrome__update_plan".to_string(),
        "mcp__claude-in-chrome__read_console_messages".to_string(),
        "mcp__claude-in-chrome__read_network_requests".to_string(),
        "mcp__claude-in-chrome__shortcuts_list".to_string(),
        "mcp__claude-in-chrome__shortcuts_execute".to_string(),
    ]
}

/// 检查是否应该启用 Chrome 集成
pub fn should_enable_chrome_integration(cli_chrome_flag: Option<bool>) -> bool {
    // 如果明确通过 --no-chrome 禁用
    if cli_chrome_flag == Some(false) {
        return false;
    }

    // 如果通过 --chrome 明确启用
    if cli_chrome_flag == Some(true) {
        return true;
    }

    // 检查环境变量
    if let Ok(env_value) = std::env::var("ASTER_ENABLE_CHROME") {
        if env_value == "1" || env_value == "true" {
            return true;
        }
        if env_value == "0" || env_value == "false" {
            return false;
        }
    }

    false
}

/// 安装 Chrome Native Host 的结果
#[derive(Debug)]
pub struct SetupResult {
    pub success: bool,
    pub message: String,
    pub manifest_path: Option<PathBuf>,
    pub wrapper_path: Option<PathBuf>,
}

/// 安装 Chrome Native Host
pub async fn setup_chrome_native_host(command: &str) -> Result<SetupResult, String> {
    // 检查平台支持
    if !is_chrome_integration_supported() {
        return Ok(SetupResult {
            success: false,
            message: "Chrome integration is not supported on this platform".to_string(),
            manifest_path: None,
            wrapper_path: None,
        });
    }

    // 获取 Native Hosts 目录
    let hosts_dir = get_native_hosts_directory()
        .ok_or_else(|| "Failed to get native hosts directory".to_string())?;

    // 创建目录
    fs::create_dir_all(&hosts_dir)
        .await
        .map_err(|e| format!("Failed to create native hosts directory: {}", e))?;

    // 生成 wrapper script 路径
    let wrapper_ext = if get_platform() == Platform::Windows {
        "bat"
    } else {
        "sh"
    };
    let wrapper_path = hosts_dir.join(format!("{}.{}", NATIVE_HOST_NAME, wrapper_ext));

    // 写入 wrapper script
    let wrapper_content = generate_wrapper_script(command);
    fs::write(&wrapper_path, &wrapper_content)
        .await
        .map_err(|e| format!("Failed to write wrapper script: {}", e))?;

    // 设置执行权限 (非 Windows)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&wrapper_path, perms)
            .map_err(|e| format!("Failed to set wrapper script permissions: {}", e))?;
    }

    // 生成并写入 manifest
    let manifest_path = hosts_dir.join(format!("{}.json", NATIVE_HOST_NAME));
    let manifest = generate_native_host_manifest(&wrapper_path.to_string_lossy());
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;

    fs::write(&manifest_path, &manifest_json)
        .await
        .map_err(|e| format!("Failed to write manifest: {}", e))?;

    // Windows 需要注册表设置
    #[cfg(windows)]
    {
        setup_windows_registry(&manifest_path)?;
    }

    Ok(SetupResult {
        success: true,
        message: "Chrome native host installed successfully".to_string(),
        manifest_path: Some(manifest_path),
        wrapper_path: Some(wrapper_path),
    })
}

/// Windows 注册表设置
#[cfg(windows)]
fn setup_windows_registry(manifest_path: &PathBuf) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = format!(
        "Software\\Google\\Chrome\\NativeMessagingHosts\\{}",
        NATIVE_HOST_NAME
    );

    let (key, _) = hkcu
        .create_subkey(&path)
        .map_err(|e| format!("Failed to create registry key: {}", e))?;

    let manifest_str: String = manifest_path.to_string_lossy().to_string();
    key.set_value("", &manifest_str)
        .map_err(|e| format!("Failed to set registry value: {}", e))?;

    Ok(())
}

/// 卸载 Chrome Native Host
pub async fn uninstall_chrome_native_host() -> Result<(), String> {
    let hosts_dir = get_native_hosts_directory()
        .ok_or_else(|| "Failed to get native hosts directory".to_string())?;

    // 删除 manifest
    let manifest_path = hosts_dir.join(format!("{}.json", NATIVE_HOST_NAME));
    if fs::metadata(&manifest_path).await.is_ok() {
        fs::remove_file(&manifest_path)
            .await
            .map_err(|e| format!("Failed to remove manifest: {}", e))?;
    }

    // 删除 wrapper script
    let wrapper_ext = if get_platform() == Platform::Windows {
        "bat"
    } else {
        "sh"
    };
    let wrapper_path = hosts_dir.join(format!("{}.{}", NATIVE_HOST_NAME, wrapper_ext));
    if fs::metadata(&wrapper_path).await.is_ok() {
        fs::remove_file(&wrapper_path)
            .await
            .map_err(|e| format!("Failed to remove wrapper script: {}", e))?;
    }

    // Windows 清理注册表
    #[cfg(windows)]
    {
        uninstall_windows_registry()?;
    }

    Ok(())
}

/// Windows 注册表清理
#[cfg(windows)]
fn uninstall_windows_registry() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = format!(
        "Software\\Google\\Chrome\\NativeMessagingHosts\\{}",
        NATIVE_HOST_NAME
    );

    // 忽略删除失败（可能不存在）
    let _ = hkcu.delete_subkey(&path);
    Ok(())
}
