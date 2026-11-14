use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::*;
use lime_core::config::ConfigManager;

impl RuntimeCore {
    /// 读取显式实时语音配置与默认 provider 快照，计算端到端 readiness。
    pub async fn realtime_voice_capability(
        &self,
    ) -> Result<crate::realtime::RealtimeVoiceCapability, RuntimeCoreError> {
        let config = ConfigManager::load(&self.app_config_path).map_err(|error| {
            RuntimeCoreError::Backend(format!("读取实时语音配置失败: {error}"))
        })?;
        let provider_id = config.config().default_provider.trim().to_string();
        if provider_id.is_empty() {
            return Err(RuntimeCoreError::Backend(
                "实时语音不可用: 没有配置默认 provider".to_string(),
            ));
        }
        let voice_input = config.config().experimental.voice_input.clone();
        let model = configured_realtime_value(voice_input.realtime_model.as_deref());
        let voice = configured_realtime_value(voice_input.realtime_voice.as_deref());
        let snapshot = match self
            .app_data_source
            .realtime_voice_provider_snapshot(&provider_id)
            .await
        {
            Ok(snapshot) => snapshot,
            Err(error) => {
                // Capability read must stay available so UI can explain the
                // blocker; a failed snapshot never becomes a fake ready state.
                tracing::debug!(
                    provider_id = %provider_id,
                    error = %error,
                    "realtime voice provider snapshot unavailable"
                );
                None
            }
        };
        let provider_wire_supported = snapshot.as_ref().is_some_and(|provider| {
            crate::realtime::realtime_provider_wire_supported(
                &provider.provider_type,
                &provider.api_host,
            )
        });
        let provider_key_available = snapshot.as_ref().is_some_and(|provider| provider.key_available);
        let readiness = crate::realtime::RealtimeVoiceReadiness {
            provider_id: Some(
                snapshot
                    .as_ref()
                    .map(|provider| provider.provider_id.clone())
                    .unwrap_or(provider_id),
            ),
            provider_wire_supported,
            provider_key_available,
            model,
            voice,
        };
        let blockers = crate::realtime::realtime_blockers(&readiness);
        Ok(crate::realtime::RealtimeVoiceCapability {
            readiness,
            blockers,
        })
    }

    /// 用宿主内的标准 OpenAI provider key 兑换短时 Realtime client secret。
    ///
    /// 任何 blocker 都必须 fail closed；不接受 renderer 覆盖 model/voice/provider。
    pub async fn create_voice_realtime_client_secret(
        &self,
    ) -> Result<VoiceRealtimeClientSecretResponse, RuntimeCoreError> {
        let capability = self.realtime_voice_capability().await?;
        if !capability.available() {
            let blockers = crate::realtime::realtime_blocker_names(&capability.blockers);
            return Err(RuntimeCoreError::Backend(format!(
                "realtime voice unavailable: {}",
                blockers.join(", ")
            )));
        }
        let readiness = capability.readiness;
        let provider_id = readiness.provider_id.clone().ok_or_else(|| {
            RuntimeCoreError::Backend("realtime voice unavailable: providerRealtimeUnsupported".to_string())
        })?;
        let model = readiness.model.clone().ok_or_else(|| {
            RuntimeCoreError::Backend(
                "realtime voice unavailable: realtimeModelUnconfigured".to_string(),
            )
        })?;
        let voice = readiness.voice.clone().ok_or_else(|| {
            RuntimeCoreError::Backend(
                "realtime voice unavailable: realtimeVoiceUnconfigured".to_string(),
            )
        })?;
        self.app_data_source
            .create_realtime_voice_client_secret(&provider_id, &model, &voice)
            .await
    }

    pub async fn list_dictation_history(
        &self,
    ) -> Result<DictationHistoryListResponse, RuntimeCoreError> {
        self.app_data_source.list_dictation_history().await
    }

    pub async fn start_dictation_history(
        &self,
        params: DictationHistoryStartParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        self.app_data_source.start_dictation_history(params).await
    }

    pub async fn append_dictation_history_audio(
        &self,
        params: DictationHistoryAppendAudioParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        self.app_data_source
            .append_dictation_history_audio(params)
            .await
    }

    pub async fn finish_dictation_history(
        &self,
        params: DictationHistoryFinishParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        self.app_data_source.finish_dictation_history(params).await
    }

    pub async fn read_dictation_history_audio(
        &self,
        params: DictationHistoryIdParams,
    ) -> Result<DictationHistoryReadAudioResponse, RuntimeCoreError> {
        self.app_data_source
            .read_dictation_history_audio(params)
            .await
    }

    pub async fn set_dictation_history_transcript(
        &self,
        params: DictationHistorySetTranscriptParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        self.app_data_source
            .set_dictation_history_transcript(params)
            .await
    }

    pub async fn delete_dictation_history(
        &self,
        params: DictationHistoryIdParams,
    ) -> Result<DictationHistoryDeleteResponse, RuntimeCoreError> {
        self.app_data_source.delete_dictation_history(params).await
    }

    pub async fn list_voice_asr_credentials(
        &self,
    ) -> Result<VoiceAsrCredentialListResponse, RuntimeCoreError> {
        self.app_data_source.list_voice_asr_credentials().await
    }

    pub async fn create_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialCreateParams,
    ) -> Result<VoiceAsrCredentialWriteResponse, RuntimeCoreError> {
        self.app_data_source
            .create_voice_asr_credential(params)
            .await
    }

    pub async fn update_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialUpdateParams,
    ) -> Result<VoiceAsrCredentialMutationResponse, RuntimeCoreError> {
        self.app_data_source
            .update_voice_asr_credential(params)
            .await
    }

    pub async fn delete_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialIdParams,
    ) -> Result<VoiceAsrCredentialMutationResponse, RuntimeCoreError> {
        self.app_data_source
            .delete_voice_asr_credential(params)
            .await
    }

    pub async fn set_default_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialIdParams,
    ) -> Result<VoiceAsrCredentialMutationResponse, RuntimeCoreError> {
        self.app_data_source
            .set_default_voice_asr_credential(params)
            .await
    }

    pub async fn test_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialIdParams,
    ) -> Result<VoiceAsrCredentialTestResponse, RuntimeCoreError> {
        self.app_data_source.test_voice_asr_credential(params).await
    }

    pub async fn test_transcribe_voice_model_file(
        &self,
        params: VoiceModelTestTranscribeFileParams,
    ) -> Result<VoiceModelTestTranscribeFileResponse, RuntimeCoreError> {
        self.app_data_source
            .test_transcribe_voice_model_file(params)
            .await
    }

    pub async fn transcribe_voice_audio(
        &self,
        params: VoiceTranscriptionTranscribeAudioParams,
    ) -> Result<VoiceTranscriptionTranscribeAudioResponse, RuntimeCoreError> {
        self.app_data_source.transcribe_voice_audio(params).await
    }

    pub async fn polish_voice_text(
        &self,
        params: VoiceTranscriptionPolishTextParams,
    ) -> Result<VoiceTranscriptionPolishTextResponse, RuntimeCoreError> {
        self.app_data_source.polish_voice_text(params).await
    }

    pub async fn list_voice_instructions(
        &self,
    ) -> Result<VoiceInstructionListResponse, RuntimeCoreError> {
        self.app_data_source.list_voice_instructions().await
    }

    pub async fn save_voice_instruction(
        &self,
        params: VoiceInstructionSaveParams,
    ) -> Result<VoiceInstructionMutationResponse, RuntimeCoreError> {
        self.app_data_source.save_voice_instruction(params).await
    }

    pub async fn delete_voice_instruction(
        &self,
        params: VoiceInstructionIdParams,
    ) -> Result<VoiceInstructionMutationResponse, RuntimeCoreError> {
        self.app_data_source.delete_voice_instruction(params).await
    }

    pub async fn set_default_voice_model(
        &self,
        params: VoiceModelDefaultSetParams,
    ) -> Result<VoiceModelDefaultSetResponse, RuntimeCoreError> {
        self.app_data_source.set_default_voice_model(params).await
    }
}

fn configured_realtime_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}
