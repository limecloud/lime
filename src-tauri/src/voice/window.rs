//! 语音输入悬浮窗口管理
//!
//! 创建和管理语音输入的悬浮窗口

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const VOICE_WINDOW_LABEL: &str = "voice-input";
const VOICE_WINDOW_WIDTH: f64 = 500.0;
const VOICE_WINDOW_HEIGHT: f64 = 80.0;

#[derive(Clone, serde::Serialize)]
struct VoiceWindowResetPayload {
    target: Option<String>,
}

/// 打开语音输入窗口
pub fn open_voice_window(app: &AppHandle, target: Option<&str>) -> Result<(), String> {
    let target = normalize_voice_window_target(target);

    // 检查窗口是否已存在
    if let Some(window) = app.get_webview_window(VOICE_WINDOW_LABEL) {
        // 发送重置事件，让前端重新开始录音
        window
            .emit(
                "voice-reset",
                VoiceWindowResetPayload {
                    target: target.clone(),
                },
            )
            .map_err(|e| format!("发送重置事件失败: {e}"))?;

        // 移动到鼠标所在屏幕
        position_window_on_cursor_screen(&window)?;

        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        tracing::info!("[语音输入] 窗口已存在，发送重置事件");
        return Ok(());
    }

    // 创建新窗口 - 使用 /smart-input 路由并带上 voice=true 参数
    let window = WebviewWindowBuilder::new(
        app,
        VOICE_WINDOW_LABEL,
        WebviewUrl::App(build_voice_window_route(target.as_deref()).into()),
    )
    .title("语音输入")
    .inner_size(VOICE_WINDOW_WIDTH, VOICE_WINDOW_HEIGHT)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .transparent(false) // 关闭透明，避免 macOS 上的渲染问题
    .skip_taskbar(true)
    .build()
    .map_err(|e| format!("创建窗口失败: {e}"))?;

    // 移动到鼠标所在屏幕
    position_window_on_cursor_screen(&window)?;

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    tracing::info!("[语音输入] 窗口已打开");
    Ok(())
}

fn normalize_voice_window_target(target: Option<&str>) -> Option<String> {
    target
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn build_voice_window_route(target: Option<&str>) -> String {
    match normalize_voice_window_target(target).as_deref() {
        Some(target) => format!("/smart-input?voice=true&target={target}"),
        None => "/smart-input?voice=true".to_string(),
    }
}

/// 将窗口定位到鼠标所在屏幕的中央
fn position_window_on_cursor_screen(window: &tauri::WebviewWindow) -> Result<(), String> {
    use tauri::PhysicalPosition;

    // 获取鼠标位置
    let cursor_pos = match window.cursor_position() {
        Ok(pos) => pos,
        Err(e) => {
            tracing::warn!("[语音输入] 获取鼠标位置失败: {}，使用默认居中", e);
            window.center().map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    // 获取所有显示器
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;

    // 找到鼠标所在的显示器
    let target_monitor = monitors.iter().find(|m| {
        let pos = m.position();
        let size = m.size();
        cursor_pos.x >= pos.x as f64
            && cursor_pos.x < (pos.x + size.width as i32) as f64
            && cursor_pos.y >= pos.y as f64
            && cursor_pos.y < (pos.y + size.height as i32) as f64
    });

    if let Some(monitor) = target_monitor {
        let monitor_pos = monitor.position();
        let monitor_size = monitor.size();
        let scale_factor = monitor.scale_factor();

        // 计算窗口在该显示器上的居中位置
        let window_width = (VOICE_WINDOW_WIDTH * scale_factor) as i32;
        let window_height = (VOICE_WINDOW_HEIGHT * scale_factor) as i32;

        let x = monitor_pos.x + (monitor_size.width as i32 - window_width) / 2;
        let y = monitor_pos.y + (monitor_size.height as i32 - window_height) / 2;

        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;

        tracing::info!(
            "[语音输入] 窗口定位到显示器 ({}, {}) 尺寸 {}x{}, 窗口位置 ({}, {})",
            monitor_pos.x,
            monitor_pos.y,
            monitor_size.width,
            monitor_size.height,
            x,
            y
        );
    } else {
        // 没找到对应显示器，使用默认居中
        tracing::warn!("[语音输入] 未找到鼠标所在显示器，使用默认居中");
        window.center().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 关闭语音输入窗口
pub fn close_voice_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(VOICE_WINDOW_LABEL) {
        window.close().map_err(|e| e.to_string())?;
        tracing::info!("[语音输入] 窗口已关闭");
    }
    Ok(())
}

/// 更新窗口状态（发送事件到前端）
pub fn update_window_state(app: &AppHandle, state: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(VOICE_WINDOW_LABEL) {
        window
            .emit("voice-state-change", state)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 发送停止录音事件到前端
pub fn send_stop_recording_event(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(VOICE_WINDOW_LABEL) {
        window
            .emit("voice-stop-recording", ())
            .map_err(|e| format!("发送停止录音事件失败: {e}"))?;
        tracing::info!("[语音输入] 已发送停止录音事件");
    }
    Ok(())
}
