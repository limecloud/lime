use super::{dispatch_result, parse_params, to_jsonrpc_error, RequestProcessor, RpcDispatch};
use app_server_protocol::{InstructionsWriteParams, JsonRpcError};
use serde_json::Value;

impl RequestProcessor {
    pub(super) async fn handle_read_instructions_impl(&self) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        dispatch_result(self.runtime.read_instructions().map_err(to_jsonrpc_error)?)
    }

    pub(super) async fn handle_write_instructions_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: InstructionsWriteParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .write_instructions(params)
                .map_err(to_jsonrpc_error)?,
        )
    }
}
