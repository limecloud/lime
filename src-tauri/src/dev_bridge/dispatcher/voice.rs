use super::{args_or_default, get_string_arg, parse_nested_arg, require_app_handle};
use crate::commands::asr_cmd::AddAsrCredentialRequest;
use crate::config::AsrCredentialEntry;
use crate::dev_bridge::DevBridgeState;
use crate::voice::commands::{RecordingStatus, StopRecordingResult, VoiceShortcutRuntimeStatus};
use crate::voice::recording_service::RecordingServiceState;
use lime_core::config::{VoiceInputConfig, VoiceInstruction};
use serde_json::Value as JsonValue;
use tauri::Manager;

type DynError = Box<dyn std::error::Error>;

fn get_optional_string_arg(args: &JsonValue, primary: &str, secondary: &str) -> Option<String> {
    args.get(primary)
        .or_else(|| args.get(secondary))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn get_required_u32_arg(args: &JsonValue, primary: &str, secondary: &str) -> Result<u32, DynError> {
    args.get(primary)
        .or_else(|| args.get(secondary))
        .and_then(|value| value.as_u64())
        .map(|value| value as u32)
        .ok_or_else(|| format!("缺少参数: {primary}/{secondary}").into())
}

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "get_asr_credentials" => {
            serde_json::to_value(crate::commands::asr_cmd::get_asr_credentials().await?)?
        }
        "add_asr_credential" => {
            let args = args_or_default(args);
            let entry: AddAsrCredentialRequest = parse_nested_arg(&args, "entry")?;
            serde_json::to_value(crate::commands::asr_cmd::add_asr_credential(entry).await?)?
        }
        "update_asr_credential" => {
            let args = args_or_default(args);
            let entry: AsrCredentialEntry = parse_nested_arg(&args, "entry")?;
            crate::commands::asr_cmd::update_asr_credential(entry).await?;
            JsonValue::Null
        }
        "delete_asr_credential" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            crate::commands::asr_cmd::delete_asr_credential(id).await?;
            JsonValue::Null
        }
        "set_default_asr_credential" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            crate::commands::asr_cmd::set_default_asr_credential(id).await?;
            JsonValue::Null
        }
        "test_asr_credential" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            serde_json::to_value(crate::commands::asr_cmd::test_asr_credential(id).await?)?
        }
        "get_voice_input_config" => {
            serde_json::to_value(crate::voice::commands::get_voice_input_config().await?)?
        }
        "get_voice_shortcut_runtime_status" => {
            let status: VoiceShortcutRuntimeStatus =
                crate::voice::commands::get_voice_shortcut_runtime_status().await?;
            serde_json::to_value(status)?
        }
        "save_voice_input_config" => {
            let args = args_or_default(args);
            let voice_config: VoiceInputConfig = parse_nested_arg(&args, "voiceConfig")?;
            let app_handle = require_app_handle(state)?;
            crate::voice::commands::save_voice_input_config(app_handle, voice_config).await?;
            JsonValue::Null
        }
        "get_voice_instructions" => {
            serde_json::to_value(crate::voice::commands::get_voice_instructions().await?)?
        }
        "save_voice_instruction" => {
            let args = args_or_default(args);
            let instruction: VoiceInstruction = parse_nested_arg(&args, "instruction")?;
            crate::voice::commands::save_voice_instruction(instruction).await?;
            JsonValue::Null
        }
        "delete_voice_instruction" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            crate::voice::commands::delete_voice_instruction(id).await?;
            JsonValue::Null
        }
        "open_voice_window" => {
            let args = args_or_default(args);
            let target = get_optional_string_arg(&args, "target", "target");
            let app_handle = require_app_handle(state)?;
            crate::voice::commands::open_voice_window(app_handle, target).await?;
            JsonValue::Null
        }
        "close_voice_window" => {
            let app_handle = require_app_handle(state)?;
            crate::voice::commands::close_voice_window(app_handle).await?;
            JsonValue::Null
        }
        "list_audio_devices" => {
            serde_json::to_value(crate::voice::recording_service::list_audio_devices()?)?
        }
        "transcribe_audio" => {
            let args = args_or_default(args);
            let audio_data = args
                .get("audioData")
                .or_else(|| args.get("audio_data"))
                .cloned()
                .ok_or_else(|| "缺少参数: audioData/audio_data".to_string())?;
            let audio_data: Vec<u8> = serde_json::from_value(audio_data)?;
            let sample_rate = get_required_u32_arg(&args, "sampleRate", "sample_rate")?;
            let credential_id = get_optional_string_arg(&args, "credentialId", "credential_id");
            serde_json::to_value(
                crate::voice::commands::transcribe_audio(audio_data, sample_rate, credential_id)
                    .await?,
            )?
        }
        "polish_voice_text" => {
            let args = args_or_default(args);
            let text = get_string_arg(&args, "text", "text")?;
            let instruction_id = get_optional_string_arg(&args, "instructionId", "instruction_id");
            serde_json::to_value(
                crate::voice::commands::polish_voice_text(text, instruction_id).await?,
            )?
        }
        "output_voice_text" => {
            let args = args_or_default(args);
            let text = get_string_arg(&args, "text", "text")?;
            let mode = get_optional_string_arg(&args, "mode", "mode");
            crate::voice::commands::output_voice_text(text, mode).await?;
            JsonValue::Null
        }
        "start_recording" => {
            let args = args_or_default(args);
            let device_id = get_optional_string_arg(&args, "deviceId", "device_id");
            let app_handle = require_app_handle(state)?;
            let recording_service = app_handle.state::<RecordingServiceState>();
            let mut service = recording_service.0.lock();
            service.start(device_id)?;
            JsonValue::Null
        }
        "stop_recording" => {
            let app_handle = require_app_handle(state)?;
            let recording_service = app_handle.state::<RecordingServiceState>();
            let mut service = recording_service.0.lock();
            let audio = service.stop()?;
            serde_json::to_value(StopRecordingResult {
                audio_data: audio.to_pcm16le_bytes(),
                sample_rate: audio.sample_rate,
                duration: audio.duration_secs,
            })?
        }
        "cancel_recording" => {
            let app_handle = require_app_handle(state)?;
            let recording_service = app_handle.state::<RecordingServiceState>();
            if let Some(mut service) = recording_service.0.try_lock() {
                service.cancel();
            }
            JsonValue::Null
        }
        "get_recording_status" => {
            let app_handle = require_app_handle(state)?;
            let recording_service = app_handle.state::<RecordingServiceState>();
            let service = recording_service.0.lock();
            serde_json::to_value(RecordingStatus {
                is_recording: service.is_recording(),
                volume: service.get_volume(),
                duration: service.get_duration(),
            })?
        }
        "open_input_with_text" => {
            let args = args_or_default(args);
            let text = get_string_arg(&args, "text", "text")?;
            let app_handle = require_app_handle(state)?;
            crate::commands::screenshot_cmd::open_input_with_text(app_handle, text)?;
            JsonValue::Null
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
