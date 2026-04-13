use lime_core::models::{AppType, Provider};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// Lime 管理的环境变量块标记
const ENV_BLOCK_START: &str = "# >>> Lime Claude Config >>>";
const ENV_BLOCK_END: &str = "# <<< Lime Claude Config <<<";

/// 原子写入 JSON 文件，防止配置损坏
/// 参考 cc-switch 的实现：使用临时文件 + 重命名的原子操作
///
/// Windows 优化：
/// - 避免不必要的 flush() 调用（Windows 上 flush 会触发磁盘同步）
/// - 跳过验证步骤以减少文件读取
pub(crate) fn write_json_file_atomic(
    path: &std::path::Path,
    value: &Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use std::fs;
    use std::io::Write;

    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    // 创建临时文件
    let temp_path = path.with_extension("tmp");

    // 写入临时文件
    let content = serde_json::to_string_pretty(value)?;
    let mut temp_file = fs::File::create(&temp_path)?;
    temp_file.write_all(content.as_bytes())?;

    // Windows 优化：只在非 Windows 平台调用 flush
    // Windows 上 flush() 会触发 FlushFileBuffers()，导致等待物理磁盘写入
    #[cfg(not(target_os = "windows"))]
    temp_file.flush()?;

    drop(temp_file); // 确保文件句柄被释放

    // Windows 优化：跳过验证步骤，减少一次文件读取
    // 验证主要是为了防止 JSON 序列化错误，但 serde_json 已经保证了正确性
    #[cfg(not(target_os = "windows"))]
    {
        let verify_content = fs::read_to_string(&temp_path)?;
        let _: Value = serde_json::from_str(&verify_content)?; // 验证解析
    }

    // 原子性重命名
    fs::rename(&temp_path, path)?;

    tracing::info!("Successfully wrote config file: {}", path.display());
    Ok(())
}

/// 创建配置文件的备份
pub(crate) fn create_backup(
    path: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if !should_create_backup() {
        tracing::info!("Skip backup for: {}", path.display());
        return Ok(());
    }

    if path.exists() {
        let backup_path = path.with_extension("bak");
        std::fs::copy(path, &backup_path)?;
        tracing::info!("Created backup: {}", backup_path.display());
    }
    Ok(())
}

fn should_create_backup() -> bool {
    if cfg!(target_os = "windows") {
        return lime_core::env_compat::var(&["LIME_FORCE_BACKUP", "PROXYCAST_FORCE_BACKUP"])
            .map(|value| {
                let value = value.to_lowercase();
                value == "1" || value == "true" || value == "yes"
            })
            .unwrap_or(false);
    }

    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
enum ShellConfigSyntax {
    Posix,
    PowerShell,
}

/// 获取当前 shell 配置文件路径
/// 优先级：zsh > bash
fn get_shell_config_target(
) -> Result<(PathBuf, ShellConfigSyntax), Box<dyn std::error::Error + Send + Sync>> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;

    #[cfg(target_os = "windows")]
    {
        let documents = dirs::document_dir().unwrap_or_else(|| home.join("Documents"));
        let ps7_profile = documents
            .join("PowerShell")
            .join("Microsoft.PowerShell_profile.ps1");
        let winps_profile = documents
            .join("WindowsPowerShell")
            .join("Microsoft.PowerShell_profile.ps1");

        if ps7_profile.exists() {
            return Ok((ps7_profile, ShellConfigSyntax::PowerShell));
        }
        if winps_profile.exists() {
            return Ok((winps_profile, ShellConfigSyntax::PowerShell));
        }

        return Ok((ps7_profile, ShellConfigSyntax::PowerShell));
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 检查 SHELL 环境变量
        if let Ok(shell) = std::env::var("SHELL") {
            if shell.contains("zsh") {
                let zshrc = home.join(".zshrc");
                return Ok((zshrc, ShellConfigSyntax::Posix));
            } else if shell.contains("bash") {
                let bashrc = home.join(".bashrc");
                return Ok((bashrc, ShellConfigSyntax::Posix));
            }
        }

        // 默认检查文件是否存在
        let zshrc = home.join(".zshrc");
        if zshrc.exists() {
            return Ok((zshrc, ShellConfigSyntax::Posix));
        }

        let bashrc = home.join(".bashrc");
        if bashrc.exists() {
            return Ok((bashrc, ShellConfigSyntax::Posix));
        }

        // 如果都不存在，默认使用 .zshrc（macOS 默认）
        Ok((zshrc, ShellConfigSyntax::Posix))
    }
}

fn escape_shell_env_value(value: &str, syntax: ShellConfigSyntax) -> String {
    match syntax {
        ShellConfigSyntax::Posix => value.replace('\\', "\\\\").replace('"', "\\\""),
        ShellConfigSyntax::PowerShell => value.replace('`', "``").replace('"', "`\""),
    }
}

fn format_shell_env_line(key: &str, value: &str, syntax: ShellConfigSyntax) -> String {
    let escaped_value = escape_shell_env_value(value, syntax);
    match syntax {
        ShellConfigSyntax::Posix => format!("export {key}=\"{escaped_value}\""),
        ShellConfigSyntax::PowerShell => format!("$env:{key} = \"{escaped_value}\""),
    }
}

#[cfg(test)]
fn parse_shell_env_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();

    if let Some(rest) = trimmed.strip_prefix("export ") {
        let (key, value) = rest.split_once('=')?;
        let unquoted = value
            .trim()
            .strip_prefix('"')?
            .strip_suffix('"')?
            .replace("\\\"", "\"")
            .replace("\\\\", "\\");
        return Some((key.trim().to_string(), unquoted));
    }

    if let Some(rest) = trimmed.strip_prefix("$env:") {
        let (key, value) = rest.split_once('=')?;
        let unquoted = value
            .trim()
            .strip_prefix('"')?
            .strip_suffix('"')?
            .replace("`\"", "\"")
            .replace("``", "`");
        return Some((key.trim().to_string(), unquoted));
    }

    None
}

/// 将环境变量写入 shell 配置文件
/// 使用标记块管理，避免重复添加
///
/// Windows 优化：避免不必要的 flush() 调用
pub fn write_env_to_shell_config(
    env_vars: &[(String, String)],
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (config_path, syntax) = get_shell_config_target()?;

    tracing::info!(
        "Writing environment variables to: {}",
        config_path.display()
    );

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // 读取现有配置
    let existing_content = if config_path.exists() {
        fs::read_to_string(&config_path)?
    } else {
        String::new()
    };

    // 移除旧的 Lime 配置块
    let mut new_content = String::new();
    let mut in_lime_block = false;

    for line in existing_content.lines() {
        if line.trim() == ENV_BLOCK_START {
            in_lime_block = true;
            continue;
        }
        if line.trim() == ENV_BLOCK_END {
            in_lime_block = false;
            continue;
        }
        if !in_lime_block {
            new_content.push_str(line);
            new_content.push('\n');
        }
    }

    // 添加新的 Lime 配置块
    if !env_vars.is_empty() {
        // 确保前面有空行
        if !new_content.ends_with("\n\n") && !new_content.is_empty() {
            new_content.push('\n');
        }

        new_content.push_str(ENV_BLOCK_START);
        new_content.push('\n');
        new_content.push_str("# Lime managed Claude Code configuration\n");
        new_content.push_str("# Do not edit this block manually\n");

        for (key, value) in env_vars {
            let line = format_shell_env_line(key, value, syntax);
            new_content.push_str(&line);
            new_content.push('\n');
        }

        new_content.push_str(ENV_BLOCK_END);
        new_content.push('\n');
    }

    // 创建备份（Windows 优化：异步或跳过备份可以进一步优化）
    create_backup(&config_path)?;

    // 写入文件
    let mut file = fs::File::create(&config_path)?;
    file.write_all(new_content.as_bytes())?;

    // Windows 优化：只在非 Windows 平台调用 flush
    #[cfg(not(target_os = "windows"))]
    file.flush()?;

    tracing::info!(
        "Successfully updated shell config: {}",
        config_path.display()
    );
    Ok(())
}

/// Get the configuration file path for an app type
#[allow(dead_code)]
pub fn get_app_config_path(app_type: &AppType) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    match app_type {
        AppType::Claude => Some(home.join(".claude").join("settings.json")),
        AppType::Codex => Some(home.join(".codex")),
        AppType::Gemini => Some(home.join(".gemini")),
        AppType::Lime => None,
    }
}

/// Sync provider configuration to live config files
pub fn sync_to_live(
    app_type: &AppType,
    provider: &Provider,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match app_type {
        AppType::Claude => sync_claude_settings(provider),
        AppType::Codex => sync_codex_config(provider),
        AppType::Gemini => sync_gemini_config(provider),
        AppType::Lime => Ok(()),
    }
}

/// 清理 Claude 配置中冲突的认证环境变量
///
/// Claude Code 同时检测到 ANTHROPIC_AUTH_TOKEN 和 ANTHROPIC_API_KEY 时会报警告。
/// 此函数确保只保留一个认证变量：
/// - 优先保留 ANTHROPIC_AUTH_TOKEN（OAuth token）
/// - 如果只有 ANTHROPIC_API_KEY，则保留它
pub(crate) fn clean_claude_auth_conflict(settings: &mut Value) {
    if let Some(env) = settings.get_mut("env").and_then(|v| v.as_object_mut()) {
        let has_auth_token = env
            .get("ANTHROPIC_AUTH_TOKEN")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let has_api_key = env
            .get("ANTHROPIC_API_KEY")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);

        // 如果两者都存在，移除 ANTHROPIC_API_KEY（优先使用 AUTH_TOKEN）
        if has_auth_token && has_api_key {
            tracing::info!(
                "检测到 Claude 认证冲突：同时存在 ANTHROPIC_AUTH_TOKEN 和 ANTHROPIC_API_KEY，移除 ANTHROPIC_API_KEY"
            );
            env.remove("ANTHROPIC_API_KEY");
        }
    }
}

/// Sync Claude settings to ~/.claude/settings.json
fn sync_claude_settings(
    provider: &Provider,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let claude_dir = home.join(".claude");
    let config_path = claude_dir.join("settings.json");

    tracing::info!("开始同步 Claude 配置: {}", provider.name);

    // 创建备份（如果文件存在）
    create_backup(&config_path)?;

    // Ensure .claude directory exists
    if !claude_dir.exists() {
        std::fs::create_dir_all(&claude_dir)?;
    }

    // Read existing settings to preserve other fields
    let mut settings: Value = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)?;
        match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("配置文件格式有误，使用默认配置: {}", e);
                json!({})
            }
        }
    } else {
        json!({})
    };

    // Merge env variables into settings
    if let Some(env_obj) = provider
        .settings_config
        .get("env")
        .and_then(|v| v.as_object())
    {
        let settings_obj = settings.as_object_mut().ok_or("Invalid settings format")?;

        // Ensure env object exists
        if !settings_obj.contains_key("env") {
            settings_obj.insert("env".to_string(), json!({}));
        }

        if let Some(target_env) = settings_obj.get_mut("env").and_then(|v| v.as_object_mut()) {
            for (key, value) in env_obj {
                target_env.insert(key.clone(), value.clone());
                tracing::debug!("设置环境变量: {} = [MASKED]", key);
            }
        }
    } else {
        // If settings_config is the full settings object, use it directly
        settings = provider.settings_config.clone();
        tracing::debug!("使用完整配置对象");
    }

    // 清理冲突的认证环境变量（在收集环境变量之前）
    clean_claude_auth_conflict(&mut settings);

    // 收集环境变量用于写入 shell 配置（从清理后的 settings 中提取）
    let mut env_vars_for_shell: Vec<(String, String)> = Vec::new();
    if let Some(env_obj) = settings.get("env").and_then(|v| v.as_object()) {
        for (key, value) in env_obj {
            if let Some(value_str) = value.as_str() {
                env_vars_for_shell.push((key.clone(), value_str.to_string()));
            }
        }
    }

    // 使用原子写入配置文件
    write_json_file_atomic(&config_path, &settings)?;
    tracing::info!("Claude 配置文件同步完成: {}", config_path.display());

    // 同时写入 shell 配置文件（后台任务，避免阻塞切换响应）
    if !env_vars_for_shell.is_empty() {
        let env_vars_for_shell = env_vars_for_shell;
        std::thread::spawn(
            move || match write_env_to_shell_config(&env_vars_for_shell) {
                Ok(_) => {
                    tracing::info!("Claude 环境变量已写入 shell 配置文件");
                    tracing::info!("请重启终端或执行 'source ~/.zshrc' (或 ~/.bashrc) 使配置生效");
                }
                Err(e) => {
                    tracing::warn!("写入 shell 配置文件失败: {}", e);
                    // 不中断流程，配置文件方式仍然可用
                }
            },
        );
    }

    Ok(())
}

/// Sync Codex config to ~/.codex/auth.json and ~/.codex/config.toml
fn sync_codex_config(provider: &Provider) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let codex_dir = home.join(".codex");

    // Create directory if not exists
    std::fs::create_dir_all(&codex_dir)?;

    if let Some(obj) = provider.settings_config.as_object() {
        // Write auth.json
        if let Some(auth) = obj.get("auth") {
            let auth_path = codex_dir.join("auth.json");
            let content = serde_json::to_string_pretty(auth)?;
            std::fs::write(&auth_path, content)?;
        }

        // Write config.toml
        if let Some(config) = obj.get("config").and_then(|v| v.as_str()) {
            let config_path = codex_dir.join("config.toml");
            std::fs::write(&config_path, config)?;
        }
    }

    Ok(())
}

/// Sync Gemini config to ~/.gemini/.env and ~/.gemini/settings.json
fn sync_gemini_config(provider: &Provider) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let gemini_dir = home.join(".gemini");

    // Create directory if not exists
    std::fs::create_dir_all(&gemini_dir)?;

    // Write .env file
    if let Some(env_obj) = provider
        .settings_config
        .get("env")
        .and_then(|v| v.as_object())
    {
        let env_path = gemini_dir.join(".env");
        let mut content = String::new();

        for (key, value) in env_obj {
            if let Some(val) = value.as_str() {
                // Only write non-empty values
                if !val.is_empty() {
                    content.push_str(&format!("{key}={val}\n"));
                }
            }
        }

        std::fs::write(&env_path, content)?;
    }

    // Write settings.json (for MCP servers and other config)
    if let Some(config) = provider.settings_config.get("config") {
        if config.is_object() {
            let settings_path = gemini_dir.join("settings.json");

            // Read existing settings to preserve mcpServers
            let mut settings: Value = if settings_path.exists() {
                let content = std::fs::read_to_string(&settings_path)?;
                serde_json::from_str(&content).unwrap_or_else(|_| json!({}))
            } else {
                json!({})
            };

            // Merge config into settings
            if let (Some(settings_obj), Some(config_obj)) =
                (settings.as_object_mut(), config.as_object())
            {
                for (key, value) in config_obj {
                    settings_obj.insert(key.clone(), value.clone());
                }
            }

            let content = serde_json::to_string_pretty(&settings)?;
            std::fs::write(&settings_path, content)?;
        }
    }

    Ok(())
}

/// Read current live settings for an app type
pub fn read_live_settings(
    app_type: &AppType,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;

    match app_type {
        AppType::Claude => {
            let path = home.join(".claude").join("settings.json");

            // 读取配置文件 - 直接返回配置文件内容，不包装
            if path.exists() {
                let content = std::fs::read_to_string(&path)?;
                Ok(serde_json::from_str(&content)?)
            } else {
                Ok(json!({}))
            }
        }
        AppType::Codex => {
            let codex_dir = home.join(".codex");
            let auth_path = codex_dir.join("auth.json");
            let config_path = codex_dir.join("config.toml");

            let auth: Value = if auth_path.exists() {
                let content = std::fs::read_to_string(&auth_path)?;
                serde_json::from_str(&content)?
            } else {
                json!({})
            };

            let config = if config_path.exists() {
                std::fs::read_to_string(&config_path)?
            } else {
                String::new()
            };

            Ok(json!({
                "auth": auth,
                "config": config
            }))
        }
        AppType::Gemini => {
            let gemini_dir = home.join(".gemini");
            let env_path = gemini_dir.join(".env");
            let settings_path = gemini_dir.join("settings.json");

            // Read .env file
            let mut env_map: serde_json::Map<String, Value> = serde_json::Map::new();
            if env_path.exists() {
                let content = std::fs::read_to_string(&env_path)?;
                for line in content.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if let Some((key, value)) = line.split_once('=') {
                        env_map.insert(key.trim().to_string(), json!(value.trim()));
                    }
                }
            }

            // Read settings.json
            let config: Value = if settings_path.exists() {
                let content = std::fs::read_to_string(&settings_path)?;
                serde_json::from_str(&content)?
            } else {
                json!({})
            };

            Ok(json!({
                "env": env_map,
                "config": config
            }))
        }
        AppType::Lime => Ok(json!({})),
    }
}

// 包含测试模块
#[cfg(test)]
#[path = "live_sync_tests.rs"]
mod live_sync_tests;
