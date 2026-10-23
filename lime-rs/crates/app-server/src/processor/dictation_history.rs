//! Dictation history handlers; persistence remains in the voice data source.
use super::{dispatch_result, parse_params, to_jsonrpc_error, RequestProcessor, RpcDispatch};
use app_server_protocol::*;

impl RequestProcessor {
    pub(super) async fn handle_list_dictation_history_impl(
        &self,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .list_dictation_history()
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_start_dictation_history_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: DictationHistoryStartParams = parse_params(params)?;
        let response = self
            .runtime
            .start_dictation_history(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_append_dictation_history_audio_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: DictationHistoryAppendAudioParams = parse_params(params)?;
        let response = self
            .runtime
            .append_dictation_history_audio(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_finish_dictation_history_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: DictationHistoryFinishParams = parse_params(params)?;
        let response = self
            .runtime
            .finish_dictation_history(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_read_dictation_history_audio_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: DictationHistoryIdParams = parse_params(params)?;
        let response = self
            .runtime
            .read_dictation_history_audio(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_set_dictation_history_transcript_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: DictationHistorySetTranscriptParams = parse_params(params)?;
        let response = self
            .runtime
            .set_dictation_history_transcript(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_delete_dictation_history_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: DictationHistoryIdParams = parse_params(params)?;
        let response = self
            .runtime
            .delete_dictation_history(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }
}
