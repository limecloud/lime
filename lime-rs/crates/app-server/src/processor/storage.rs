use super::{
    dispatch_result, parse_params, to_jsonrpc_error, JsonRpcError, RequestProcessor, RpcDispatch,
};
use app_server_protocol::{StorageDeleteParams, StorageReadParams, StorageReviewParams};

impl RequestProcessor {
    pub(super) async fn handle_storage_read(
        &self,
        params: Option<serde_json::Value>,
        refresh: bool,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let _: StorageReadParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .read_storage(refresh)
                .await
                .map_err(to_jsonrpc_error)?,
        )
    }

    pub(super) async fn handle_storage_review(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: StorageReviewParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .review_storage(params)
                .await
                .map_err(to_jsonrpc_error)?,
        )
    }

    pub(super) async fn handle_storage_delete(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: StorageDeleteParams = parse_params(params)?;
        let (result, deleted) = self
            .runtime
            .delete_storage(params)
            .await
            .map_err(to_jsonrpc_error)?;
        let notifications = self.finish_thread_delete(deleted).await;
        Ok(dispatch_result(result)?.with_notifications(notifications))
    }
}
