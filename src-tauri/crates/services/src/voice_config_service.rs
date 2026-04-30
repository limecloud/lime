//! 语音输入配置服务
//!
//! 管理语音输入配置、ASR 凭证与润色指令。
//! 不依赖 Tauri，可被主 crate 以桥接方式复用。

use lime_core::config::{
    load_config, save_config, AsrCredentialEntry, AsrProviderType, VoiceInputConfig,
    VoiceInstruction, VoiceOutputMode,
};

/// 加载语音输入配置
pub fn load_voice_config() -> Result<VoiceInputConfig, String> {
    let config = load_config().map_err(|e| e.to_string())?;
    Ok(config.experimental.voice_input)
}

/// 保存语音输入配置
pub fn save_voice_config(voice_config: VoiceInputConfig) -> Result<(), String> {
    let mut config = load_config().map_err(|e| e.to_string())?;
    config.experimental.voice_input = voice_config;
    save_config(&config).map_err(|e| e.to_string())?;
    Ok(())
}

/// 获取默认 ASR 凭证
pub fn get_default_asr_credential() -> Result<Option<AsrCredentialEntry>, String> {
    let config = load_config().map_err(|e| e.to_string())?;
    Ok(config
        .experimental
        .voice_input
        .asr_credentials
        .into_iter()
        .find(|credential| credential.is_default && !credential.disabled))
}

/// 获取指定 ID 的 ASR 凭证
pub fn get_asr_credential(id: &str) -> Result<Option<AsrCredentialEntry>, String> {
    let config = load_config().map_err(|e| e.to_string())?;
    Ok(config
        .experimental
        .voice_input
        .asr_credentials
        .into_iter()
        .find(|credential| credential.id == id))
}

/// 列出所有 ASR 凭证
pub fn list_asr_credentials() -> Result<Vec<AsrCredentialEntry>, String> {
    let config = load_config().map_err(|e| e.to_string())?;
    Ok(config.experimental.voice_input.asr_credentials)
}

/// 获取首个启用的指定 Provider 凭证
pub fn get_enabled_asr_credential_by_provider(
    provider: AsrProviderType,
) -> Result<Option<AsrCredentialEntry>, String> {
    let config = load_config().map_err(|e| e.to_string())?;
    Ok(config
        .experimental
        .voice_input
        .asr_credentials
        .into_iter()
        .find(|credential| credential.provider == provider && !credential.disabled))
}

/// 获取指令列表
pub fn get_instructions() -> Result<Vec<VoiceInstruction>, String> {
    let config = load_config().map_err(|e| e.to_string())?;
    Ok(config.experimental.voice_input.instructions)
}

/// 获取指定 ID 的指令
pub fn get_instruction(id: &str) -> Result<Option<VoiceInstruction>, String> {
    let instructions = get_instructions()?;
    Ok(instructions
        .into_iter()
        .find(|instruction| instruction.id == id))
}

/// 保存或更新语音指令
pub fn save_voice_instruction(instruction: VoiceInstruction) -> Result<(), String> {
    let mut voice_config = load_voice_config()?;

    if let Some(index) = voice_config
        .instructions
        .iter()
        .position(|item| item.id == instruction.id)
    {
        voice_config.instructions[index] = instruction;
    } else {
        voice_config.instructions.push(instruction);
    }

    save_voice_config(voice_config)
}

/// 删除语音指令（预设指令不可删除）
pub fn delete_voice_instruction(id: &str) -> Result<(), String> {
    let mut voice_config = load_voice_config()?;

    if let Some(instruction) = voice_config.instructions.iter().find(|item| item.id == id) {
        if instruction.is_preset {
            return Err("无法删除预设指令".to_string());
        }
    }

    voice_config.instructions.retain(|item| item.id != id);

    if !voice_config
        .instructions
        .iter()
        .any(|item| item.id == voice_config.processor.default_instruction_id)
    {
        voice_config.processor.default_instruction_id = voice_config
            .instructions
            .iter()
            .find(|item| item.id == "default")
            .or_else(|| voice_config.instructions.first())
            .map(|item| item.id.clone())
            .unwrap_or_else(|| "default".to_string());
    }

    if !voice_config
        .instructions
        .iter()
        .any(|item| item.id == voice_config.translate_instruction_id)
    {
        voice_config.translate_instruction_id = voice_config
            .instructions
            .iter()
            .find(|item| item.id == "translate_en")
            .map(|item| item.id.clone())
            .unwrap_or_else(|| voice_config.processor.default_instruction_id.clone());
    }

    save_voice_config(voice_config)
}

/// 解析输出模式
///
/// 当 `mode` 为 `None` 时，返回配置中的默认输出模式。
pub fn resolve_output_mode(mode: Option<&str>) -> Result<VoiceOutputMode, String> {
    match mode {
        Some("type") => Ok(VoiceOutputMode::Type),
        Some("clipboard") => Ok(VoiceOutputMode::Clipboard),
        Some("both") => Ok(VoiceOutputMode::Both),
        None => {
            let voice_config = load_voice_config()?;
            Ok(voice_config.output.mode)
        }
        Some(other) => Err(format!("未知的输出模式: {other}")),
    }
}

/// 获取 ASR Provider 展示名
pub fn asr_provider_name(provider: AsrProviderType) -> &'static str {
    match provider {
        AsrProviderType::WhisperLocal => "本地 Whisper",
        AsrProviderType::SenseVoiceLocal => "SenseVoice Small 本地",
        AsrProviderType::OpenAI => "OpenAI Whisper",
        AsrProviderType::Baidu => "百度语音",
        AsrProviderType::Xunfei => "讯飞语音",
    }
}
