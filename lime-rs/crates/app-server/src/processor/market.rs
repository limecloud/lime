use super::{dispatch_result, parse_params, to_jsonrpc_error, RequestProcessor, RpcDispatch};
use app_server_protocol::{protocol::v2::*, JsonRpcError};

impl RequestProcessor {
    pub(super) async fn handle_market_reconcile(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: MarketReconcileParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .market_reconcile(params)
                .await
                .map_err(to_jsonrpc_error)?,
        )
    }

    pub(super) async fn handle_market_install_cancel(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: MarketInstallCancelParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .market_install_cancel(params)
                .await
                .map_err(to_jsonrpc_error)?,
        )
    }

    pub(super) async fn handle_market_pending(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: MarketPendingParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .market_pending(params)
                .await
                .map_err(to_jsonrpc_error)?,
        )
    }

    pub(super) async fn handle_market_list(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: MarketListParams = parse_params(params)?;
        let response = self
            .runtime
            .market_list(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }
    pub(super) async fn handle_market_read(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: MarketReadParams = parse_params(params)?;
        let response = self
            .runtime
            .market_read(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }
    pub(super) async fn handle_market_install(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: MarketInstallParams = parse_params(params)?;
        let response = self
            .runtime
            .market_install(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, true).await
    }
    pub(super) async fn handle_market_installed(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: MarketInstalledParams = parse_params(params)?;
        let response = self
            .runtime
            .market_installed(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }
    pub(super) async fn handle_market_enabled_set(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: MarketEnabledSetParams = parse_params(params)?;
        let response = self
            .runtime
            .market_enabled_set(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, true).await
    }
    pub(super) async fn handle_market_uninstall(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: MarketUninstallParams = parse_params(params)?;
        let response = self
            .runtime
            .market_uninstall(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, true).await
    }
}
