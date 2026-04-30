//! SenseVoice Small 本地语音识别模块。
//!
//! 模型文件由上层按需下载；这里只负责把已安装模型接入 sherpa-onnx
//! offline recognizer。

use std::path::{Path, PathBuf};

use sherpa_onnx::{
    LinearResampler, OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig,
};

use crate::error::{Result, VoiceError};
use crate::types::{AudioData, Segment, TranscribeResult};

const SENSEVOICE_SAMPLE_RATE: i32 = 16_000;

/// SenseVoice 识别器。
pub struct SenseVoiceTranscriber {
    recognizer: OfflineRecognizer,
    language: String,
}

impl SenseVoiceTranscriber {
    /// 创建新的 SenseVoice 识别器。
    pub fn new(
        model_path: PathBuf,
        tokens_path: PathBuf,
        language: &str,
        use_itn: bool,
        num_threads: u16,
    ) -> Result<Self> {
        ensure_file_exists(&model_path, "SenseVoice 模型文件")?;
        ensure_file_exists(&tokens_path, "SenseVoice tokens 文件")?;

        let language = normalize_language(language);
        let mut config = OfflineRecognizerConfig::default();
        config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
            model: Some(model_path.to_string_lossy().to_string()),
            language: Some(language.clone()),
            use_itn,
        };
        config.model_config.tokens = Some(tokens_path.to_string_lossy().to_string());
        config.model_config.num_threads = i32::from(num_threads.max(1));

        let recognizer = OfflineRecognizer::create(&config).ok_or_else(|| {
            VoiceError::TranscriberError("创建 sherpa-onnx SenseVoice 识别器失败".to_string())
        })?;

        Ok(Self {
            recognizer,
            language,
        })
    }

    /// 识别音频。
    pub fn transcribe(&self, audio: &AudioData) -> Result<TranscribeResult> {
        if !audio.is_valid() {
            return Err(VoiceError::RecordingTooShort);
        }

        let samples = prepare_samples(audio)?;
        if samples.is_empty() {
            return Err(VoiceError::AudioFormatError(
                "SenseVoice 输入音频为空".to_string(),
            ));
        }

        let stream = self.recognizer.create_stream();
        stream.accept_waveform(SENSEVOICE_SAMPLE_RATE, &samples);
        self.recognizer.decode(&stream);

        let result = stream.get_result().ok_or_else(|| {
            VoiceError::TranscriberError("读取 sherpa-onnx SenseVoice 识别结果失败".to_string())
        })?;
        let text = result.text.trim().to_string();

        let segments = if text.is_empty() {
            Vec::new()
        } else {
            vec![Segment {
                start: 0.0,
                end: audio.duration_secs,
                text: text.clone(),
            }]
        };

        Ok(TranscribeResult {
            text,
            language: (self.language != "auto").then(|| self.language.clone()),
            confidence: None,
            segments,
        })
    }
}

fn ensure_file_exists(path: &Path, label: &str) -> Result<()> {
    if path.is_file() {
        Ok(())
    } else {
        Err(VoiceError::TranscriberError(format!(
            "{label}不存在: {}",
            path.display()
        )))
    }
}

fn normalize_language(language: &str) -> String {
    let normalized = language.trim();
    if normalized.is_empty() {
        "auto".to_string()
    } else {
        normalized.to_string()
    }
}

fn prepare_samples(audio: &AudioData) -> Result<Vec<f32>> {
    let samples = audio
        .samples
        .iter()
        .map(|sample| *sample as f32 / i16::MAX as f32)
        .collect::<Vec<_>>();

    if audio.sample_rate == SENSEVOICE_SAMPLE_RATE as u32 {
        return Ok(samples);
    }

    let resampler = LinearResampler::create(audio.sample_rate as i32, SENSEVOICE_SAMPLE_RATE)
        .ok_or_else(|| {
            VoiceError::AudioFormatError(format!(
                "创建采样率转换器失败: {} -> {}",
                audio.sample_rate, SENSEVOICE_SAMPLE_RATE
            ))
        })?;
    Ok(resampler.resample(&samples, true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_empty_language_to_auto() {
        assert_eq!(normalize_language(""), "auto");
        assert_eq!(normalize_language("  "), "auto");
        assert_eq!(normalize_language("zh"), "zh");
    }

    #[test]
    fn prepare_samples_keeps_16khz_length() {
        let audio = AudioData::new(vec![0, i16::MAX, i16::MIN], 16_000, 1);
        let samples = prepare_samples(&audio).expect("prepare samples");

        assert_eq!(samples.len(), 3);
        assert_eq!(samples[0], 0.0);
        assert!(samples[1] > 0.99);
        assert!(samples[2] < -0.99);
    }
}
