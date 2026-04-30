//! 语音输入模块
//!
//! 提供系统级语音输入功能，包括：
//! - 全局快捷键触发
//! - 悬浮窗口管理
//! - 语音识别处理
//! - 文本输出

pub mod asr_service;
pub mod commands;
pub mod config;
pub mod fn_shortcut;
pub mod output_service;
pub mod processor;
pub mod recording_service;
pub mod shortcut;
pub mod window;

use tauri::AppHandle;

pub(crate) fn register_fn_shortcut_if_supported(app: &AppHandle) {
    if !fn_shortcut::is_supported() {
        tracing::info!("[语音输入] 当前平台不支持 Fn 按住录音，使用普通快捷键回退");
        return;
    }

    if let Err(error) = fn_shortcut::register(app) {
        tracing::warn!("[语音输入] Fn 按住录音监听注册失败: {}", error);
    }
}

/// 初始化语音输入模块
pub fn init(app: &AppHandle) -> Result<(), String> {
    // 加载配置
    let config = config::load_voice_config()?;

    // 如果功能未启用，直接返回
    if !config.enabled {
        tracing::info!("[语音输入] 功能未启用");
        return Ok(());
    }

    // 注册全局快捷键
    shortcut::register(app, &config.shortcut)?;
    register_fn_shortcut_if_supported(app);

    // 注册翻译快捷键（如果配置了）
    if let Some(translate_shortcut) = &config.translate_shortcut {
        if !translate_shortcut.is_empty() {
            match shortcut::register_translate(
                app,
                translate_shortcut,
                &config.translate_instruction_id,
            ) {
                Ok(()) => {
                    tracing::info!("[语音输入] 翻译快捷键已注册: {}", translate_shortcut);
                }
                Err(e) => {
                    tracing::warn!("[语音输入] 翻译快捷键注册失败: {}", e);
                    // 翻译快捷键注册失败不影响主功能
                }
            }
        }
    }

    tracing::info!("[语音输入] 模块初始化完成");
    Ok(())
}

/// 清理语音输入模块
pub fn cleanup(app: &AppHandle) -> Result<(), String> {
    // 注销快捷键
    shortcut::unregister(app)?;

    // 注销翻译快捷键
    let _ = shortcut::unregister_translate(app);

    // 注销 Fn 监听
    let _ = fn_shortcut::unregister();

    // 关闭悬浮窗口
    window::close_voice_window(app)?;

    tracing::info!("[语音输入] 模块已清理");
    Ok(())
}
