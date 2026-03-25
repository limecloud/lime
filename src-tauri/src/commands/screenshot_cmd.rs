//! 截图对话命令模块
//!
//! 提供截图对话功能的 Tauri 命令接口，包括：
//! - 获取和保存实验室功能配置
//! - 启动截图
//! - 验证和更新快捷键
//! - 读取图片为 Base64
//!
//! _需求: 1.1, 1.4, 1.5, 2.2, 2.4, 3.1, 5.1_

use crate::config::{ExperimentalFeatures, GlobalConfigManagerState};
use crate::screenshot::{capture, shortcut};
use tauri::{AppHandle, Emitter, Manager, State};
use tracing::{debug, error, info};

#[derive(Debug, Clone, serde::Serialize)]
pub struct ScreenshotShortcutRuntimeStatus {
    pub shortcut_registered: bool,
    pub registered_shortcut: Option<String>,
}

/// 获取实验室功能配置
///
/// 从应用状态中获取当前的实验室功能配置
///
/// # 返回
/// 成功返回 ExperimentalFeatures，失败返回错误信息
///
/// _需求: 1.1_
#[tauri::command]
pub async fn get_experimental_config(
    config_manager: State<'_, GlobalConfigManagerState>,
) -> Result<ExperimentalFeatures, String> {
    debug!("获取实验室功能配置");

    let config = config_manager.config();
    Ok(config.experimental.clone())
}

/// 获取截图快捷键运行时状态
#[tauri::command]
pub async fn get_screenshot_shortcut_runtime_status(
) -> Result<ScreenshotShortcutRuntimeStatus, String> {
    Ok(ScreenshotShortcutRuntimeStatus {
        shortcut_registered: shortcut::is_registered(),
        registered_shortcut: shortcut::get_current(),
    })
}

/// 保存实验室功能配置
///
/// 将实验室功能配置保存到应用状态和配置文件
/// 同时根据配置状态注册或注销快捷键
///
/// # 参数
/// - `app`: Tauri 应用句柄
/// - `config_manager`: 全局配置管理器状态
/// - `experimental_config`: 要保存的实验室功能配置
///
/// # 返回
/// 成功返回 Ok(()), 失败返回错误信息
///
/// _需求: 1.4, 1.5_
#[tauri::command]
pub async fn save_experimental_config(
    app: AppHandle,
    config_manager: State<'_, GlobalConfigManagerState>,
    experimental_config: ExperimentalFeatures,
) -> Result<(), String> {
    info!(
        "保存实验室功能配置: enabled={}, shortcut={}",
        experimental_config.screenshot_chat.enabled, experimental_config.screenshot_chat.shortcut
    );

    // 获取旧配置以比较变化
    let old_config = config_manager.config();
    let was_enabled = old_config.experimental.screenshot_chat.enabled;
    let is_enabled = experimental_config.screenshot_chat.enabled;

    debug!(
        "配置变化: was_enabled={}, is_enabled={}",
        was_enabled, is_enabled
    );

    // 更新配置
    let mut new_config = old_config.clone();
    new_config.experimental = experimental_config.clone();

    // 保存配置到文件
    debug!("开始保存配置到文件...");
    if let Err(e) = config_manager.save_config(&new_config).await {
        error!("保存配置失败: {}", e);
        return Err(format!("保存配置失败: {e}"));
    }
    info!("配置文件保存成功");

    // 根据功能开关状态注册或注销快捷键
    if was_enabled != is_enabled {
        if is_enabled {
            info!(
                "截图对话功能已启用，注册快捷键: {}",
                experimental_config.screenshot_chat.shortcut
            );
            if let Err(e) = shortcut::register(&app, &experimental_config.screenshot_chat.shortcut)
            {
                error!("注册快捷键失败: {}", e);
                return Err(format!("注册快捷键失败: {e}"));
            }
            info!("快捷键注册成功");
        } else {
            info!("截图对话功能已禁用，注销快捷键");
            if let Err(e) = shortcut::unregister(&app) {
                error!("注销快捷键失败: {}", e);
                return Err(format!("注销快捷键失败: {e}"));
            }
            info!("快捷键注销成功");
        }
    }

    info!("实验室功能配置保存完成");
    Ok(())
}

/// 启动截图
///
/// 启动交互式截图，返回截图文件路径
///
/// # 返回
/// 成功返回截图文件路径，用户取消返回空字符串，失败返回错误信息
///
/// _需求: 3.1_
#[tauri::command]
pub async fn start_screenshot() -> Result<String, String> {
    info!("启动截图命令");

    match capture::start_capture().await {
        Ok(path) => {
            info!("截图成功: {:?}", path);
            Ok(path.to_string_lossy().to_string())
        }
        Err(capture::CaptureError::Cancelled) => {
            info!("用户取消了截图");
            Ok(String::new())
        }
        Err(e) => {
            error!("截图失败: {}", e);
            Err(format!("截图失败: {e}"))
        }
    }
}

/// 验证快捷键格式
///
/// 检查快捷键字符串是否符合 Tauri 快捷键格式要求
///
/// # 参数
/// - `shortcut_str`: 快捷键字符串，如 "CommandOrControl+Shift+S"
///
/// # 返回
/// 如果格式有效返回 true，否则返回错误信息
///
/// _需求: 2.2_
#[tauri::command]
pub fn validate_shortcut(shortcut_str: String) -> Result<bool, String> {
    debug!("验证快捷键格式: {}", shortcut_str);

    match shortcut::validate(&shortcut_str) {
        Ok(()) => Ok(true),
        Err(e) => Err(format!("{e}")),
    }
}

/// 更新截图快捷键
///
/// 原子性地更新快捷键：先注销旧快捷键，再注册新快捷键
/// 同时更新配置文件
///
/// # 参数
/// - `app`: Tauri 应用句柄
/// - `config_manager`: 全局配置管理器状态
/// - `new_shortcut`: 新的快捷键字符串
///
/// # 返回
/// 成功返回 Ok(()), 失败返回错误信息
///
/// _需求: 2.4_
#[tauri::command]
pub async fn update_screenshot_shortcut(
    app: AppHandle,
    config_manager: State<'_, GlobalConfigManagerState>,
    new_shortcut: String,
) -> Result<(), String> {
    info!("更新截图快捷键: {}", new_shortcut);

    // 验证新快捷键格式
    shortcut::validate(&new_shortcut).map_err(|e| format!("快捷键格式无效: {e}"))?;

    // 获取当前配置
    let mut config = config_manager.config();

    // 检查功能是否启用
    if config.experimental.screenshot_chat.enabled {
        // 更新快捷键（原子操作）
        shortcut::update(&app, &new_shortcut).map_err(|e| format!("更新快捷键失败: {e}"))?;
    }

    // 更新配置
    config.experimental.screenshot_chat.shortcut = new_shortcut;

    // 保存配置到文件
    config_manager
        .save_config(&config)
        .await
        .map_err(|e| format!("保存配置失败: {e}"))?;

    info!("截图快捷键更新成功");
    Ok(())
}

/// 关闭截图对话窗口
///
/// 关闭当前打开的截图对话悬浮窗口
///
/// # 返回
/// 成功返回 Ok(()), 失败返回错误信息
#[tauri::command]
pub fn close_screenshot_chat_window(app: AppHandle) -> Result<(), String> {
    info!("关闭截图对话窗口");

    crate::screenshot::window::close_floating_window(&app).map_err(|e| format!("关闭窗口失败: {e}"))
}

/// 打开带预填文本的输入框
///
/// 用于语音识别完成后，将识别结果填入输入框
///
/// # 参数
/// - `app`: Tauri 应用句柄
/// - `text`: 预填文本
///
/// # 返回
/// 成功返回 Ok(()), 失败返回错误信息
#[tauri::command]
pub fn open_input_with_text(app: AppHandle, text: String) -> Result<(), String> {
    info!("打开带预填文本的输入框: {} 字符", text.len());

    crate::screenshot::window::open_floating_window_with_text(&app, &text)
        .map_err(|e| format!("打开窗口失败: {e}"))
}

/// 读取图片文件并转换为 Base64
///
/// 读取指定路径的图片文件，并将其内容编码为 Base64 字符串
///
/// # 参数
/// - `path`: 图片文件路径
///
/// # 返回
/// 成功返回 Base64 编码的图片数据，失败返回错误信息
///
/// _需求: 5.1_
#[tauri::command]
pub async fn read_image_as_base64(path: String) -> Result<String, String> {
    lime_services::screenshot_image_service::read_image_as_base64(&path).await
}

/// 截图对话消息结构
#[derive(Debug, Clone, serde::Serialize)]
pub struct ScreenshotChatMessage {
    pub message: String,
    pub image_path: Option<String>,
    pub image_base64: Option<String>,
}

/// 发送截图对话消息到主应用
///
/// 将用户输入的消息和截图发送到主应用的 Agent 聊天界面
///
/// # 参数
/// - `app`: Tauri 应用句柄
/// - `message`: 用户输入的消息
/// - `image_path`: 截图文件路径（可选）
///
/// # 返回
/// 成功返回 Ok(()), 失败返回错误信息
#[tauri::command]
pub async fn send_screenshot_chat(
    app: AppHandle,
    message: String,
    image_path: Option<String>,
) -> Result<(), String> {
    info!(
        "发送截图对话: message={}, image_path={:?}",
        message, image_path
    );

    // 如果有图片，读取为 Base64
    let image_base64 = if let Some(ref path) = image_path {
        match read_image_as_base64(path.clone()).await {
            Ok(base64) => Some(base64),
            Err(e) => {
                error!("读取图片失败: {}", e);
                None
            }
        }
    } else {
        None
    };

    // 构建消息
    let chat_message = ScreenshotChatMessage {
        message,
        image_path,
        image_base64,
    };

    // 发送事件到主窗口
    if let Some(main_window) = app.get_webview_window("main") {
        main_window
            .emit("smart-input-message", &chat_message)
            .map_err(|e| format!("发送事件失败: {e}"))?;

        // 恢复并聚焦主窗口（主窗口在截图时被最小化）
        let _ = main_window.unminimize();
        let _ = main_window.show();
        let _ = main_window.set_focus();
    } else {
        // 尝试发送到所有窗口
        app.emit("smart-input-message", &chat_message)
            .map_err(|e| format!("发送事件失败: {e}"))?;
    }

    info!("截图对话消息已发送");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_shortcut_valid() {
        assert!(validate_shortcut("CommandOrControl+Shift+S".to_string()).is_ok());
        assert!(validate_shortcut("Alt+F4".to_string()).is_ok());
        assert!(validate_shortcut("Ctrl+C".to_string()).is_ok());
    }

    #[test]
    fn test_validate_shortcut_invalid() {
        assert!(validate_shortcut("".to_string()).is_err());
        assert!(validate_shortcut("InvalidKey".to_string()).is_err());
    }
}
