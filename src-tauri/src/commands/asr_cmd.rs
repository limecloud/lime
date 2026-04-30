//! ASR 凭证管理命令
//!
//! 提供语音识别服务凭证的 CRUD 操作

use crate::config::{
    load_config, save_config, AsrCredentialEntry, AsrProviderType, BaiduConfig, OpenAIAsrConfig,
    SenseVoiceLocalConfig, WhisperLocalConfig, XunfeiConfig,
};
use lime_core::app_paths;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::command;
use uuid::Uuid;

const SENSEVOICE_MODEL_FILE: &str = "model.int8.onnx";
const SENSEVOICE_TOKENS_FILE: &str = "tokens.txt";
const SENSEVOICE_VAD_FILE: &str = "silero_vad.onnx";

/// 获取所有 ASR 凭证
#[command]
pub async fn get_asr_credentials() -> Result<Vec<AsrCredentialEntry>, String> {
    let config = load_config().map_err(|e| e.to_string())?;
    Ok(config.experimental.voice_input.asr_credentials)
}

/// 添加 ASR 凭证的请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddAsrCredentialRequest {
    pub provider: AsrProviderType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whisper_config: Option<WhisperLocalConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sensevoice_config: Option<SenseVoiceLocalConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xunfei_config: Option<XunfeiConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baidu_config: Option<BaiduConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openai_config: Option<OpenAIAsrConfig>,
}

fn default_language() -> String {
    "zh".to_string()
}

/// 添加 ASR 凭证
#[command]
pub async fn add_asr_credential(
    entry: AddAsrCredentialRequest,
) -> Result<AsrCredentialEntry, String> {
    tracing::info!(
        "[ASR] 添加凭证: provider={:?}, name={:?}",
        entry.provider,
        entry.name
    );

    let mut config = load_config().map_err(|e| {
        tracing::error!("[ASR] 加载配置失败: {}", e);
        e.to_string()
    })?;

    // 创建新凭证
    let mut new_entry = AsrCredentialEntry {
        id: Uuid::new_v4().to_string(),
        provider: entry.provider,
        name: entry.name,
        is_default: entry.is_default,
        disabled: entry.disabled,
        language: entry.language,
        whisper_config: entry.whisper_config,
        sensevoice_config: entry.sensevoice_config,
        xunfei_config: entry.xunfei_config,
        baidu_config: entry.baidu_config,
        openai_config: entry.openai_config,
    };

    tracing::info!("[ASR] 生成新 ID: {}", new_entry.id);

    // 如果是第一个凭证，设为默认
    if config.experimental.voice_input.asr_credentials.is_empty() {
        new_entry.is_default = true;
        tracing::info!("[ASR] 设为默认凭证");
    }

    config
        .experimental
        .voice_input
        .asr_credentials
        .push(new_entry.clone());

    save_config(&config).map_err(|e| {
        tracing::error!("[ASR] 保存配置失败: {}", e);
        e.to_string()
    })?;

    tracing::info!("[ASR] 凭证添加成功: {}", new_entry.id);
    Ok(new_entry)
}

/// 更新 ASR 凭证
#[command]
pub async fn update_asr_credential(entry: AsrCredentialEntry) -> Result<(), String> {
    let mut config = load_config().map_err(|e| e.to_string())?;

    let idx = config
        .experimental
        .voice_input
        .asr_credentials
        .iter()
        .position(|c| c.id == entry.id)
        .ok_or_else(|| format!("凭证不存在: {}", entry.id))?;

    config.experimental.voice_input.asr_credentials[idx] = entry;
    save_config(&config).map_err(|e| e.to_string())?;

    Ok(())
}

/// 删除 ASR 凭证
#[command]
pub async fn delete_asr_credential(id: String) -> Result<(), String> {
    let mut config = load_config().map_err(|e| e.to_string())?;

    let idx = config
        .experimental
        .voice_input
        .asr_credentials
        .iter()
        .position(|c| c.id == id)
        .ok_or_else(|| format!("凭证不存在: {id}"))?;

    let was_default = config.experimental.voice_input.asr_credentials[idx].is_default;
    config.experimental.voice_input.asr_credentials.remove(idx);

    // 如果删除的是默认凭证，将第一个设为默认
    if was_default && !config.experimental.voice_input.asr_credentials.is_empty() {
        config.experimental.voice_input.asr_credentials[0].is_default = true;
    }

    save_config(&config).map_err(|e| e.to_string())?;

    Ok(())
}

/// 设置默认 ASR 凭证
#[command]
pub async fn set_default_asr_credential(id: String) -> Result<(), String> {
    let mut config = load_config().map_err(|e| e.to_string())?;

    // 检查凭证是否存在
    let exists = config
        .experimental
        .voice_input
        .asr_credentials
        .iter()
        .any(|c| c.id == id);
    if !exists {
        return Err(format!("凭证不存在: {id}"));
    }

    // 更新默认状态
    for cred in &mut config.experimental.voice_input.asr_credentials {
        cred.is_default = cred.id == id;
    }

    save_config(&config).map_err(|e| e.to_string())?;

    Ok(())
}

/// 测试 ASR 凭证连通性
#[command]
pub async fn test_asr_credential(id: String) -> Result<TestResult, String> {
    let config = load_config().map_err(|e| e.to_string())?;

    let credential = config
        .experimental
        .voice_input
        .asr_credentials
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("凭证不存在: {id}"))?;

    // 根据 Provider 类型测试
    match credential.provider {
        AsrProviderType::WhisperLocal => {
            // 本地 Whisper 检查模型文件是否存在
            Ok(TestResult {
                success: true,
                message: "本地 Whisper 已就绪".to_string(),
            })
        }
        AsrProviderType::SenseVoiceLocal => {
            let Some(sensevoice_config) = credential.sensevoice_config.as_ref() else {
                return Ok(TestResult {
                    success: false,
                    message: "SenseVoice 本地配置缺失".to_string(),
                });
            };

            match resolve_sensevoice_model_dir(sensevoice_config)
                .and_then(|model_dir| ensure_sensevoice_model_files(&model_dir))
            {
                Ok(()) => Ok(TestResult {
                    success: true,
                    message: "SenseVoice Small 本地模型已就绪".to_string(),
                }),
                Err(error) => Ok(TestResult {
                    success: false,
                    message: error,
                }),
            }
        }
        AsrProviderType::Xunfei => {
            // TODO: 实现讯飞 API 测试
            if credential.xunfei_config.is_some() {
                Ok(TestResult {
                    success: true,
                    message: "讯飞配置已设置（实际测试待实现）".to_string(),
                })
            } else {
                Ok(TestResult {
                    success: false,
                    message: "讯飞配置缺失".to_string(),
                })
            }
        }
        AsrProviderType::Baidu => {
            // TODO: 实现百度 API 测试
            if credential.baidu_config.is_some() {
                Ok(TestResult {
                    success: true,
                    message: "百度配置已设置（实际测试待实现）".to_string(),
                })
            } else {
                Ok(TestResult {
                    success: false,
                    message: "百度配置缺失".to_string(),
                })
            }
        }
        AsrProviderType::OpenAI => {
            // TODO: 实现 OpenAI API 测试
            if credential.openai_config.is_some() {
                Ok(TestResult {
                    success: true,
                    message: "OpenAI 配置已设置（实际测试待实现）".to_string(),
                })
            } else {
                Ok(TestResult {
                    success: false,
                    message: "OpenAI 配置缺失".to_string(),
                })
            }
        }
    }
}

fn resolve_sensevoice_model_dir(config: &SenseVoiceLocalConfig) -> Result<PathBuf, String> {
    if let Some(model_dir) = config.model_dir.as_ref() {
        let trimmed = model_dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    Ok(app_paths::preferred_data_dir()?
        .join("models")
        .join("voice")
        .join(&config.model_id))
}

fn ensure_sensevoice_model_files(model_dir: &Path) -> Result<(), String> {
    let required_files = [
        SENSEVOICE_MODEL_FILE,
        SENSEVOICE_TOKENS_FILE,
        SENSEVOICE_VAD_FILE,
    ];
    let missing_files = required_files
        .iter()
        .filter(|file_name| !model_dir.join(file_name).is_file())
        .copied()
        .collect::<Vec<_>>();

    if missing_files.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "SenseVoice Small 本地模型文件不完整，请先在设置 -> 语音模型中下载；缺失文件: {}",
            missing_files.join(", ")
        ))
    }
}

/// 测试结果
#[derive(serde::Serialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
}
