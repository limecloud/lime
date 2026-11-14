//! voice domain handlers for the App Server processor.

use super::{dispatch_result, parse_params, to_jsonrpc_error, RequestProcessor, RpcDispatch};
use app_server_protocol::{
    JsonRpcError, VoiceAsrCredentialCreateParams, VoiceAsrCredentialIdParams,
    VoiceAsrCredentialUpdateParams, VoiceInstructionIdParams, VoiceInstructionSaveParams,
    VoiceModelDefaultSetParams, VoiceModelTestTranscribeFileParams,
    VoiceRealtimeClientSecretCreateParams, VoiceTranscriptionPolishTextParams,
    VoiceTranscriptionTranscribeAudioParams,
};

impl RequestProcessor {
    pub(super) async fn handle_voice_asr_credential_list_impl(
        &self,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .list_voice_asr_credentials()
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_asr_credential_create_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceAsrCredentialCreateParams = parse_params(params)?;
        let response = self
            .runtime
            .create_voice_asr_credential(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_asr_credential_update_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceAsrCredentialUpdateParams = parse_params(params)?;
        let response = self
            .runtime
            .update_voice_asr_credential(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_asr_credential_delete_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceAsrCredentialIdParams = parse_params(params)?;
        let response = self
            .runtime
            .delete_voice_asr_credential(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_asr_credential_default_set_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceAsrCredentialIdParams = parse_params(params)?;
        let response = self
            .runtime
            .set_default_voice_asr_credential(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_asr_credential_test_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceAsrCredentialIdParams = parse_params(params)?;
        let response = self
            .runtime
            .test_voice_asr_credential(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_model_test_transcribe_file_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceModelTestTranscribeFileParams = parse_params(params)?;
        let response = self
            .runtime
            .test_transcribe_voice_model_file(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_instruction_list_impl(
        &self,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .list_voice_instructions()
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_instruction_save_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceInstructionSaveParams = parse_params(params)?;
        let response = self
            .runtime
            .save_voice_instruction(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_instruction_delete_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceInstructionIdParams = parse_params(params)?;
        let response = self
            .runtime
            .delete_voice_instruction(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_realtime_client_secret_create_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let _: VoiceRealtimeClientSecretCreateParams = parse_params(params)?;
        let response = self
            .runtime
            .create_voice_realtime_client_secret()
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_model_default_set_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceModelDefaultSetParams = parse_params(params)?;
        let response = self
            .runtime
            .set_default_voice_model(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_transcription_transcribe_audio_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceTranscriptionTranscribeAudioParams = parse_params(params)?;
        let response = self
            .runtime
            .transcribe_voice_audio(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_voice_transcription_polish_text_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: VoiceTranscriptionPolishTextParams = parse_params(params)?;
        let response = self
            .runtime
            .polish_voice_text(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }
}
