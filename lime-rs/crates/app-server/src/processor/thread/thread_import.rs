use super::*;

impl RequestProcessor {
    pub(in crate::processor) async fn handle_thread_import_v2(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: app_server_protocol::protocol::v2::ThreadImportParams = parse_params(params)?;
        let response = self
            .runtime
            .import_thread(params)
            .await
            .map_err(|error| match error {
                crate::RuntimeCoreError::InvalidRequest(message) => invalid_request(message),
                other => to_jsonrpc_error(other),
            })?;
        dispatch_result(response)
    }
}
