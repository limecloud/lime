//! 语音输入 Tauri 命令
//!
//! 提供前端调用的语音输入相关命令。

use lime_core::config::{VoiceInputConfig, VoiceInstruction};
use lime_services::voice_command_service;
use tauri::{command, AppHandle};

use super::config;
use super::recording_service::{AudioDeviceInfo, RecordingServiceState};
use tauri::State;

fn normalize_shortcut(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VoiceShortcutRuntimeStatus {
    pub shortcut_registered: bool,
    pub registered_shortcut: Option<String>,
    pub translate_shortcut_registered: bool,
    pub registered_translate_shortcut: Option<String>,
}

/// 获取所有可用的麦克风设备
#[command]
pub async fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    super::recording_service::list_audio_devices()
}

/// 获取语音输入配置
#[command]
pub async fn get_voice_input_config() -> Result<VoiceInputConfig, String> {
    config::load_voice_config()
}

/// 获取语音快捷键运行时状态
#[command]
pub async fn get_voice_shortcut_runtime_status() -> Result<VoiceShortcutRuntimeStatus, String> {
    Ok(VoiceShortcutRuntimeStatus {
        shortcut_registered: super::shortcut::is_registered(),
        registered_shortcut: super::shortcut::get_current(),
        translate_shortcut_registered: super::shortcut::is_translate_registered(),
        registered_translate_shortcut: super::shortcut::get_current_translate(),
    })
}

/// 保存语音输入配置
#[command]
pub async fn save_voice_input_config(
    app: AppHandle,
    voice_config: VoiceInputConfig,
) -> Result<(), String> {
    let old_config = config::load_voice_config()?;
    let old_enabled = old_config.enabled;
    let new_enabled = voice_config.enabled;

    if old_enabled && new_enabled {
        if old_config.shortcut != voice_config.shortcut {
            super::shortcut::update(&app, &voice_config.shortcut)?;
        }

        let old_translate_shortcut = normalize_shortcut(old_config.translate_shortcut.clone());
        let new_translate_shortcut = normalize_shortcut(voice_config.translate_shortcut.clone());
        let instruction_changed =
            old_config.translate_instruction_id != voice_config.translate_instruction_id;

        if old_translate_shortcut != new_translate_shortcut || instruction_changed {
            match (
                old_translate_shortcut.as_deref(),
                new_translate_shortcut.as_deref(),
            ) {
                (Some(_), Some(new_shortcut)) => {
                    super::shortcut::update_translate(
                        &app,
                        new_shortcut,
                        &voice_config.translate_instruction_id,
                    )?;
                }
                (None, Some(new_shortcut)) => {
                    super::shortcut::register_translate(
                        &app,
                        new_shortcut,
                        &voice_config.translate_instruction_id,
                    )?;
                }
                (Some(_), None) => {
                    super::shortcut::unregister_translate(&app)?;
                }
                (None, None) => {}
            }
        }
    } else if old_enabled && !new_enabled {
        super::shortcut::unregister(&app)?;
        let _ = super::shortcut::unregister_translate(&app);
    } else if !old_enabled && new_enabled {
        super::shortcut::register(&app, &voice_config.shortcut)?;

        if let Some(translate_shortcut) =
            normalize_shortcut(voice_config.translate_shortcut.clone())
        {
            super::shortcut::register_translate(
                &app,
                &translate_shortcut,
                &voice_config.translate_instruction_id,
            )?;
        }
    }

    config::save_voice_config(voice_config)
}

/// 获取指令列表
#[command]
pub async fn get_voice_instructions() -> Result<Vec<VoiceInstruction>, String> {
    config::get_instructions()
}

/// 保存指令
#[command]
pub async fn save_voice_instruction(instruction: VoiceInstruction) -> Result<(), String> {
    config::save_voice_instruction(instruction)
}

/// 删除指令
#[command]
pub async fn delete_voice_instruction(id: String) -> Result<(), String> {
    config::delete_voice_instruction(&id)
}

/// 打开语音输入窗口
#[command]
pub async fn open_voice_window(app: AppHandle) -> Result<(), String> {
    super::window::open_voice_window(&app)
}

/// 关闭语音输入窗口
#[command]
pub async fn close_voice_window(app: AppHandle) -> Result<(), String> {
    super::window::close_voice_window(&app)
}

pub use lime_services::voice_command_service::{PolishResult, TranscribeResult};

/// 执行语音识别
#[command]
pub async fn transcribe_audio(
    audio_data: Vec<u8>,
    sample_rate: u32,
    credential_id: Option<String>,
) -> Result<TranscribeResult, String> {
    voice_command_service::transcribe_audio(&audio_data, sample_rate, credential_id.as_deref())
        .await
}

/// 润色文本
#[command]
pub async fn polish_voice_text(
    text: String,
    instruction_id: Option<String>,
) -> Result<PolishResult, String> {
    voice_command_service::polish_voice_text(&text, instruction_id.as_deref()).await
}

/// 输出文本到系统
#[command]
pub async fn output_voice_text(text: String, mode: Option<String>) -> Result<(), String> {
    voice_command_service::output_voice_text(&text, mode.as_deref())
}

/// 停止录音的返回结果
#[derive(serde::Serialize)]
pub struct StopRecordingResult {
    /// 音频数据（i16 样本的字节数组，小端序）
    pub audio_data: Vec<u8>,
    /// 采样率
    pub sample_rate: u32,
    /// 录音时长（秒）
    pub duration: f32,
}

/// 开始录音
#[command]
pub async fn start_recording(
    recording_service: State<'_, RecordingServiceState>,
    device_id: Option<String>,
) -> Result<(), String> {
    tracing::info!("[录音命令] 收到开始录音请求，设备ID: {:?}", device_id);
    let mut service = recording_service.0.lock();
    let result = service.start(device_id);
    tracing::info!("[录音命令] 开始录音结果: {:?}", result.is_ok());
    result
}

/// 停止录音并返回音频数据
///
/// 返回的数据结构：
/// - audio_data: i16 样本的字节数组（小端序）
/// - sample_rate: 采样率
/// - duration: 录音时长（秒）
#[command]
pub async fn stop_recording(
    recording_service: State<'_, RecordingServiceState>,
) -> Result<StopRecordingResult, String> {
    let mut service = recording_service.0.lock();
    let audio = service.stop()?;

    tracing::info!(
        "[录音命令] 停止录音，样本数: {}, 采样率: {}, 时长: {:.2}s",
        audio.samples.len(),
        audio.sample_rate,
        audio.duration_secs
    );

    let non_zero_samples = audio.samples.iter().filter(|&&sample| sample != 0).count();
    let non_zero_ratio = non_zero_samples as f32 / audio.samples.len().max(1) as f32;
    tracing::info!(
        "[录音命令] 非零样本比例: {:.2}% ({}/{})",
        non_zero_ratio * 100.0,
        non_zero_samples,
        audio.samples.len()
    );

    let bytes = audio.to_pcm16le_bytes();

    Ok(StopRecordingResult {
        audio_data: bytes,
        sample_rate: audio.sample_rate,
        duration: audio.duration_secs,
    })
}

/// 取消录音
#[command]
pub async fn cancel_recording(
    recording_service: State<'_, RecordingServiceState>,
) -> Result<(), String> {
    match recording_service.0.try_lock() {
        Some(mut service) => {
            service.cancel();
            tracing::info!("[录音命令] 取消录音成功");
        }
        None => {
            tracing::warn!("[录音命令] 取消录音时锁被占用，跳过");
        }
    }
    Ok(())
}

/// 录音状态
#[derive(serde::Serialize)]
pub struct RecordingStatus {
    /// 是否正在录音
    pub is_recording: bool,
    /// 当前音量级别（0-100）
    pub volume: u32,
    /// 录音时长（秒）
    pub duration: f32,
}

/// 获取录音状态
#[command]
pub async fn get_recording_status(
    recording_service: State<'_, RecordingServiceState>,
) -> Result<RecordingStatus, String> {
    let service = recording_service.0.lock();
    let status = RecordingStatus {
        is_recording: service.is_recording(),
        volume: service.get_volume(),
        duration: service.get_duration(),
    };
    tracing::debug!(
        "[录音命令] 获取状态: is_recording={}, volume={}, duration={:.2}",
        status.is_recording,
        status.volume,
        status.duration
    );
    Ok(status)
}
