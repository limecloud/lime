use super::super::*;
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
}
