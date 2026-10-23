use super::unavailable;
use super::NoopAppDataSource;
use super::RuntimeCoreError;
use app_server_protocol::*;
use async_trait::async_trait;

#[async_trait]
pub trait VoiceAppDataSource: Send + Sync {
    async fn list_dictation_history(
        &self,
    ) -> Result<DictationHistoryListResponse, RuntimeCoreError> {
        Err(unavailable("dictationHistory/list"))
    }

    async fn start_dictation_history(
        &self,
        _params: DictationHistoryStartParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        Err(unavailable("dictationHistory/start"))
    }

    async fn append_dictation_history_audio(
        &self,
        _params: DictationHistoryAppendAudioParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        Err(unavailable("dictationHistory/appendAudio"))
    }

    async fn finish_dictation_history(
        &self,
        _params: DictationHistoryFinishParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        Err(unavailable("dictationHistory/finish"))
    }

    async fn read_dictation_history_audio(
        &self,
        _params: DictationHistoryIdParams,
    ) -> Result<DictationHistoryReadAudioResponse, RuntimeCoreError> {
        Err(unavailable("dictationHistory/readAudio"))
    }

    async fn set_dictation_history_transcript(
        &self,
        _params: DictationHistorySetTranscriptParams,
    ) -> Result<DictationHistoryWriteResponse, RuntimeCoreError> {
        Err(unavailable("dictationHistory/setTranscript"))
    }

    async fn delete_dictation_history(
        &self,
        _params: DictationHistoryIdParams,
    ) -> Result<DictationHistoryDeleteResponse, RuntimeCoreError> {
        Err(unavailable("dictationHistory/delete"))
    }

    async fn list_voice_asr_credentials(
        &self,
    ) -> Result<VoiceAsrCredentialListResponse, RuntimeCoreError> {
        Err(unavailable("voiceAsrCredential/list"))
    }

    async fn create_voice_asr_credential(
        &self,
        _params: VoiceAsrCredentialCreateParams,
    ) -> Result<VoiceAsrCredentialWriteResponse, RuntimeCoreError> {
        Err(unavailable("voiceAsrCredential/create"))
    }

    async fn update_voice_asr_credential(
        &self,
        _params: VoiceAsrCredentialUpdateParams,
    ) -> Result<VoiceAsrCredentialMutationResponse, RuntimeCoreError> {
        Err(unavailable("voiceAsrCredential/update"))
    }

    async fn delete_voice_asr_credential(
        &self,
        _params: VoiceAsrCredentialIdParams,
    ) -> Result<VoiceAsrCredentialMutationResponse, RuntimeCoreError> {
        Err(unavailable("voiceAsrCredential/delete"))
    }

    async fn set_default_voice_asr_credential(
        &self,
        _params: VoiceAsrCredentialIdParams,
    ) -> Result<VoiceAsrCredentialMutationResponse, RuntimeCoreError> {
        Err(unavailable("voiceAsrCredential/default/set"))
    }

    async fn test_voice_asr_credential(
        &self,
        _params: VoiceAsrCredentialIdParams,
    ) -> Result<VoiceAsrCredentialTestResponse, RuntimeCoreError> {
        Err(unavailable("voiceAsrCredential/test"))
    }

    async fn test_transcribe_voice_model_file(
        &self,
        _params: VoiceModelTestTranscribeFileParams,
    ) -> Result<VoiceModelTestTranscribeFileResponse, RuntimeCoreError> {
        Err(unavailable("voiceModel/testTranscribeFile"))
    }

    async fn transcribe_voice_audio(
        &self,
        _params: VoiceTranscriptionTranscribeAudioParams,
    ) -> Result<VoiceTranscriptionTranscribeAudioResponse, RuntimeCoreError> {
        Err(unavailable("voiceTranscription/transcribeAudio"))
    }

    async fn polish_voice_text(
        &self,
        _params: VoiceTranscriptionPolishTextParams,
    ) -> Result<VoiceTranscriptionPolishTextResponse, RuntimeCoreError> {
        Err(unavailable("voiceTranscription/polishText"))
    }

    async fn list_voice_instructions(
        &self,
    ) -> Result<VoiceInstructionListResponse, RuntimeCoreError> {
        Err(unavailable("voiceInstruction/list"))
    }

    async fn save_voice_instruction(
        &self,
        _params: VoiceInstructionSaveParams,
    ) -> Result<VoiceInstructionMutationResponse, RuntimeCoreError> {
        Err(unavailable("voiceInstruction/save"))
    }

    async fn delete_voice_instruction(
        &self,
        _params: VoiceInstructionIdParams,
    ) -> Result<VoiceInstructionMutationResponse, RuntimeCoreError> {
        Err(unavailable("voiceInstruction/delete"))
    }

    async fn set_default_voice_model(
        &self,
        _params: VoiceModelDefaultSetParams,
    ) -> Result<VoiceModelDefaultSetResponse, RuntimeCoreError> {
        Err(unavailable("voiceModel/default/set"))
    }
}

impl VoiceAppDataSource for NoopAppDataSource {}
