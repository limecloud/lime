use super::{dispatch_result, parse_params, RequestProcessor, RpcDispatch};
use crate::runtime::local_environments;
use app_server_protocol::protocol::v2::{
    LocalEnvironmentsListParams, LocalEnvironmentsReadConfigParams,
    LocalEnvironmentsSaveConfigParams,
};
use app_server_protocol::{error_codes, JsonRpcError};

impl RequestProcessor {
    pub(super) async fn handle_local_environments_list(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: LocalEnvironmentsListParams = parse_params(params)?;
        dispatch_result(
            tokio::task::spawn_blocking(move || local_environments::list(params))
                .await
                .map_err(join_error)??,
        )
    }

    pub(super) async fn handle_local_environments_read_config(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: LocalEnvironmentsReadConfigParams = parse_params(params)?;
        dispatch_result(
            tokio::task::spawn_blocking(move || local_environments::read_config(params))
                .await
                .map_err(join_error)??,
        )
    }

    pub(super) async fn handle_local_environments_save_config(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: LocalEnvironmentsSaveConfigParams = parse_params(params)?;
        dispatch_result(
            tokio::task::spawn_blocking(move || local_environments::save_config(params))
                .await
                .map_err(join_error)??,
        )
    }
}

fn join_error(error: tokio::task::JoinError) -> JsonRpcError {
    JsonRpcError::new(
        error_codes::RUNTIME_ERROR,
        format!("Environment operation failed: {error}"),
    )
}
