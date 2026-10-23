use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::*;

impl RuntimeCore {
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
