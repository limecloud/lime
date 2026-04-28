//! 语音命令业务服务
//!
//! 封装语音转写、润色、输出等可复用业务流程。

use serde::{Deserialize, Serialize};

use super::voice_asr_service::AsrService;
use super::voice_config_service;
use super::voice_output_service;
use super::voice_processor_service;

/// 语音识别结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscribeResult {
    /// 识别文本
    pub text: String,
    /// 使用的 ASR 服务
    pub provider: String,
}

/// 润色文本结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishResult {
    /// 润色后的文本
    pub text: String,
    /// 使用的指令
    pub instruction_name: String,
}

/// 执行语音识别
pub async fn transcribe_audio(
    audio_data: &[u8],
    sample_rate: u32,
    credential_id: Option<&str>,
) -> Result<TranscribeResult, String> {
    tracing::info!(
        "[语音识别] 开始识别，音频大小: {} 字节，采样率: {}",
        audio_data.len(),
        sample_rate
    );

    if audio_data.is_empty() {
        tracing::error!("[语音识别] 音频数据为空！");
        return Err("音频数据为空，请检查麦克风权限".to_string());
    }

    let non_zero_count = audio_data.iter().filter(|&&byte| byte != 0).count();
    let non_zero_ratio = non_zero_count as f32 / audio_data.len() as f32;
    tracing::info!(
        "[语音识别] 非零字节比例: {:.2}% ({}/{})",
        non_zero_ratio * 100.0,
        non_zero_count,
        audio_data.len()
    );

    if non_zero_ratio < 0.01 {
        tracing::warn!("[语音识别] 音频数据几乎全为静音，可能是麦克风权限问题或未正确录音");
    }

    let credential = if let Some(id) = credential_id {
        tracing::info!("[语音识别] 使用指定凭证: {}", id);
        AsrService::get_credential(id)?.ok_or_else(|| format!("凭证不存在: {id}"))?
    } else {
        tracing::info!("[语音识别] 获取默认凭证...");
        match AsrService::get_default_credential() {
            Ok(Some(credential)) => {
                tracing::info!(
                    "[语音识别] 找到默认凭证: id={}, provider={:?}",
                    credential.id,
                    credential.provider
                );
                credential
            }
            Ok(None) => {
                if let Ok(credentials) = voice_config_service::list_asr_credentials() {
                    tracing::error!(
                        "[语音识别] 未找到默认凭证，当前 ASR 凭证数量: {}",
                        credentials.len()
                    );
                    for (index, credential) in credentials.iter().enumerate() {
                        tracing::error!(
                            "[语音识别] 凭证 {}: id={}, is_default={}, disabled={}",
                            index,
                            credential.id,
                            credential.is_default,
                            credential.disabled
                        );
                    }
                }
                return Err("未配置语音识别服务。请在设置 → Agent → 语音中添加讯飞、百度或 OpenAI Whisper 凭证。".to_string());
            }
            Err(error) => {
                tracing::error!("[语音识别] 获取默认凭证失败: {}", error);
                return Err(format!("获取凭证失败: {error}"));
            }
        }
    };

    let provider_name = voice_config_service::asr_provider_name(credential.provider);
    tracing::info!("[语音识别] 使用服务: {}", provider_name);

    let text = AsrService::transcribe(&credential, audio_data, sample_rate).await?;
    tracing::info!("[语音识别] 识别完成，文本长度: {} 字符", text.len());

    Ok(TranscribeResult {
        text,
        provider: provider_name.to_string(),
    })
}

/// 润色文本
pub async fn polish_voice_text(
    text: &str,
    instruction_id: Option<&str>,
) -> Result<PolishResult, String> {
    let voice_config = voice_config_service::load_voice_config()?;
    let instruction_id = instruction_id
        .map(|value| value.to_string())
        .unwrap_or_else(|| voice_config.processor.default_instruction_id.clone());

    let instruction = voice_config
        .instructions
        .iter()
        .find(|item| item.id == instruction_id)
        .ok_or_else(|| format!("指令不存在: {instruction_id}"))?;

    if instruction_id == "raw" {
        return Ok(PolishResult {
            text: text.to_string(),
            instruction_name: instruction.name.clone(),
        });
    }

    let polished = voice_processor_service::polish_text(
        text,
        instruction,
        voice_config.processor.polish_provider.as_deref(),
        voice_config.processor.polish_model.as_deref(),
    )
    .await?;

    Ok(PolishResult {
        text: polished,
        instruction_name: instruction.name.clone(),
    })
}

/// 输出文本到系统
pub fn output_voice_text(text: &str, mode: Option<&str>) -> Result<(), String> {
    let output_mode = voice_config_service::resolve_output_mode(mode)?;
    voice_output_service::output_text(text, output_mode)?;

    tracing::info!("[语音输出] 文本已输出: {} 字符", text.chars().count());
    Ok(())
}
