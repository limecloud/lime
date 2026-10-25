use super::{
    dispatch_result, parse_params, to_jsonrpc_error, ConnectionRequestId, RequestProcessor,
    RpcDispatch,
};
use app_server_protocol::protocol::v2::*;
use app_server_protocol::{error_codes, JsonRpcError};
use serde_json::Value;

fn connection(request: Option<ConnectionRequestId>) -> String {
    request.map_or_else(
        || "direct".into(),
        |request| format!("transport:{}", request.connection_id),
    )
}

impl RequestProcessor {
    pub(super) async fn handle_computer_use_status(
        &self,
        params: Option<Value>,
        request: Option<ConnectionRequestId>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        dispatch_result(
            self.runtime
                .computer_use_status(&connection(request), parse_params(params)?)
                .await
                .map_err(to_jsonrpc_error)?,
        )
    }

    pub(super) async fn handle_computer_use_setup(
        &self,
        params: Option<Value>,
        request: Option<ConnectionRequestId>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let request_id = request.as_ref().map(|request| request.request_id.clone());
        let connection = connection(request);
        let result = self
            .runtime
            .computer_use_setup(&connection, parse_params(params)?)
            .await
            .map_err(to_jsonrpc_error)?;
        if request_id
            .as_ref()
            .is_some_and(|id| self.is_request_canceled(id))
        {
            if let Some(grant) = result.grant {
                let _ = self.runtime.computer_use.revoke(&connection, &grant.id);
            }
            return Err(JsonRpcError::new(
                error_codes::REQUEST_CANCELLED,
                "Computer Use setup canceled",
            ));
        }
        dispatch_result(result)
    }

    pub(super) async fn handle_computer_use_acquire(
        &self,
        params: Option<Value>,
        request: Option<ConnectionRequestId>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let request_id = request.as_ref().map(|request| request.request_id.clone());
        let connection = connection(request);
        let result = self
            .runtime
            .computer_use_acquire(&connection, parse_params(params)?)
            .await
            .map_err(to_jsonrpc_error)?;
        if request_id
            .as_ref()
            .is_some_and(|id| self.is_request_canceled(id))
        {
            let _ = self
                .runtime
                .computer_use
                .release(&connection, &result.lease_id);
            return Err(JsonRpcError::new(
                error_codes::REQUEST_CANCELLED,
                "Computer Use lease acquisition canceled",
            ));
        }
        dispatch_result(result)
    }

    pub(super) fn handle_computer_use_revoke(
        &self,
        params: Option<Value>,
        request: Option<ConnectionRequestId>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ComputerUseRevokeParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .computer_use
                .revoke(&connection(request), &params.grant_id)
                .map_err(|e| JsonRpcError::new(error_codes::INVALID_REQUEST, e.to_string()))?,
        )
    }

    pub(super) fn handle_computer_use_release(
        &self,
        params: Option<Value>,
        request: Option<ConnectionRequestId>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ComputerUseLeaseReleaseParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .computer_use
                .release(&connection(request), &params.lease_id)
                .map_err(|e| JsonRpcError::new(error_codes::INVALID_REQUEST, e.to_string()))?,
        )
    }
}
