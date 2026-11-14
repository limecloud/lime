use super::super::*;
use crate::runtime::RealtimeVoiceProviderSnapshot;
use app_server_protocol::*;
use async_trait::async_trait;

#[async_trait]
impl VoiceAppDataSource for LocalAppDataSource {
    async fn list_dictation_history(
        &self,
    ) -> Result<DictationHistoryListResponse, RuntimeCoreError> {
        let store = self.dictation_history.clone();
        tokio::task::spawn_blocking(move || store.list())
            .await
            .map_err(data_error)?
            .map_err(data_error)
    }

    async fn start_dictation_history(
        &self,
        params: DictationHistoryStartParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        let store = self.dictation_history.clone();
        tokio::task::spawn_blocking(move || store.start(params))
            .await
            .map_err(data_error)?
            .map_err(data_error)
    }

    async fn append_dictation_history_audio(
        &self,
        params: DictationHistoryAppendAudioParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        let store = self.dictation_history.clone();
        tokio::task::spawn_blocking(move || store.append_audio(params))
            .await
            .map_err(data_error)?
            .map_err(data_error)
    }

    async fn finish_dictation_history(
        &self,
        params: DictationHistoryFinishParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        let store = self.dictation_history.clone();
        tokio::task::spawn_blocking(move || store.finish(params))
            .await
            .map_err(data_error)?
            .map_err(data_error)
    }

    async fn read_dictation_history_audio(
        &self,
        params: DictationHistoryIdParams,
    ) -> Result<DictationHistoryReadAudioResponse, RuntimeCoreError> {
        let store = self.dictation_history.clone();
        tokio::task::spawn_blocking(move || store.read_audio(params))
            .await
            .map_err(data_error)?
            .map_err(data_error)
    }

    async fn set_dictation_history_transcript(
        &self,
        params: DictationHistorySetTranscriptParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        let store = self.dictation_history.clone();
        tokio::task::spawn_blocking(move || store.set_transcript(params))
            .await
            .map_err(data_error)?
            .map_err(data_error)
    }

    async fn delete_dictation_history(
        &self,
        params: DictationHistoryIdParams,
    ) -> Result<DictationHistoryDeleteResponse, RuntimeCoreError> {
        let store = self.dictation_history.clone();
        tokio::task::spawn_blocking(move || store.delete(params))
            .await
            .map_err(data_error)?
            .map_err(data_error)
    }

    async fn list_voice_asr_credentials(
        &self,
    ) -> Result<VoiceAsrCredentialListResponse, RuntimeCoreError> {
        voice_asr_credentials::list_voice_asr_credentials()
    }

    async fn create_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialCreateParams,
    ) -> Result<VoiceAsrCredentialWriteResponse, RuntimeCoreError> {
        voice_asr_credentials::create_voice_asr_credential(params)
    }

    async fn update_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialUpdateParams,
    ) -> Result<VoiceAsrCredentialMutationResponse, RuntimeCoreError> {
        voice_asr_credentials::update_voice_asr_credential(params)
    }

    async fn delete_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialIdParams,
    ) -> Result<VoiceAsrCredentialMutationResponse, RuntimeCoreError> {
        voice_asr_credentials::delete_voice_asr_credential(params)
    }

    async fn set_default_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialIdParams,
    ) -> Result<VoiceAsrCredentialMutationResponse, RuntimeCoreError> {
        voice_asr_credentials::set_default_voice_asr_credential(params)
    }

    async fn test_voice_asr_credential(
        &self,
        params: VoiceAsrCredentialIdParams,
    ) -> Result<VoiceAsrCredentialTestResponse, RuntimeCoreError> {
        voice_asr_credentials::test_voice_asr_credential(params)
    }

    async fn test_transcribe_voice_model_file(
        &self,
        params: VoiceModelTestTranscribeFileParams,
    ) -> Result<VoiceModelTestTranscribeFileResponse, RuntimeCoreError> {
        voice_asr_credentials::test_transcribe_voice_model_file(params).await
    }

    async fn transcribe_voice_audio(
        &self,
        params: VoiceTranscriptionTranscribeAudioParams,
    ) -> Result<VoiceTranscriptionTranscribeAudioResponse, RuntimeCoreError> {
        voice_asr_credentials::transcribe_voice_audio(params).await
    }

    async fn polish_voice_text(
        &self,
        params: VoiceTranscriptionPolishTextParams,
    ) -> Result<VoiceTranscriptionPolishTextResponse, RuntimeCoreError> {
        voice_text_processing::polish_voice_text(params).await
    }

    async fn list_voice_instructions(
        &self,
    ) -> Result<VoiceInstructionListResponse, RuntimeCoreError> {
        voice_instructions::list_voice_instructions()
    }

    async fn save_voice_instruction(
        &self,
        params: VoiceInstructionSaveParams,
    ) -> Result<VoiceInstructionMutationResponse, RuntimeCoreError> {
        voice_instructions::save_voice_instruction(params)
    }

    async fn delete_voice_instruction(
        &self,
        params: VoiceInstructionIdParams,
    ) -> Result<VoiceInstructionMutationResponse, RuntimeCoreError> {
        voice_instructions::delete_voice_instruction(params)
    }

    async fn set_default_voice_model(
        &self,
        params: VoiceModelDefaultSetParams,
    ) -> Result<VoiceModelDefaultSetResponse, RuntimeCoreError> {
        voice_asr_credentials::set_default_voice_model(params)
    }

    async fn realtime_voice_provider_snapshot(
        &self,
        provider_id: &str,
    ) -> Result<Option<RealtimeVoiceProviderSnapshot>, RuntimeCoreError> {
        let Some(provider) = self
            .api_key_provider_service
            .get_provider(&self.db, provider_id)
            .map_err(data_error)?
        else {
            return Ok(None);
        };
        let key_available = provider
            .api_keys
            .iter()
            .filter(|key| key.enabled)
            .any(|key| {
                self.api_key_provider_service
                    .read_api_key(&key.api_key_encrypted)
                    .is_ok()
            });
        Ok(Some(RealtimeVoiceProviderSnapshot {
            provider_id: provider.provider.id.clone(),
            provider_type: provider.provider.effective_provider_type().to_string(),
            api_host: provider.provider.api_host.clone(),
            key_available,
        }))
    }

    async fn create_realtime_voice_client_secret(
        &self,
        provider_id: &str,
        model: &str,
        voice: &str,
    ) -> Result<VoiceRealtimeClientSecretResponse, RuntimeCoreError> {
        let provider = self
            .api_key_provider_service
            .get_provider(&self.db, provider_id)
            .map_err(data_error)?
            .ok_or_else(|| {
                RuntimeCoreError::Backend(format!(
                    "realtime voice unavailable: provider `{provider_id}` is not configured"
                ))
            })?;
        if !provider.provider.enabled {
            return Err(RuntimeCoreError::Backend(
                "realtime voice unavailable: the default provider is disabled".to_string(),
            ));
        }
        let provider_type = provider.provider.effective_provider_type().to_string();
        let api_host = provider.provider.api_host.clone();
        if !crate::realtime::realtime_provider_wire_supported(&provider_type, &api_host) {
            return Err(RuntimeCoreError::Backend(
                "realtime voice unavailable: the default provider is not the official OpenAI API-key route"
                    .to_string(),
            ));
        }
        let credential = self
            .api_key_provider_service
            .select_credential_for_provider(
                &self.db,
                &provider_type,
                Some(provider.provider.id.as_str()),
                None,
            )
            .await
            .map_err(data_error)?
            .ok_or_else(|| {
                RuntimeCoreError::Backend(
                    "realtime voice unavailable: providerKeyMissing".to_string(),
                )
            })?;
        let api_key = match credential.credential {
            lime_core::models::RuntimeCredentialData::OpenAIKey { api_key, .. } => api_key,
            _ => {
                return Err(RuntimeCoreError::Backend(
                    "realtime voice unavailable: the provider key is not an OpenAI API key"
                        .to_string(),
                ));
            }
        };
        let minted = model_provider::realtime::mint_openai_realtime_client_secret(
            &api_host, &api_key, model, voice,
        )
        .await
        .map_err(|error| {
            RuntimeCoreError::Backend(format!(
                "failed to mint the OpenAI Realtime client secret: {error}"
            ))
        })?;
        Ok(VoiceRealtimeClientSecretResponse {
            client_secret: minted.client_secret,
            expires_at: minted.expires_at,
            model: model.trim().to_string(),
            voice: voice.trim().to_string(),
            calls_url: minted.calls_url,
            provider_id: provider.provider.id.clone(),
        })
    }
}
