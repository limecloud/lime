//! Desktop service names are preserved; management runs through the shared App Server boundary.
use super::{dispatch_result, parse_params, RequestProcessor, RpcDispatch};
use app_server_protocol::protocol::v2::{
    CancelInstallParams, CancelInstallResponse, DiagnoseDependenciesParams,
    InstallDependenciesResponse, RunUpdateNowParams,
};
use app_server_protocol::{error_codes, JsonRpcError};
use lime_core::config::layers::ConfigLayers;
use std::sync::Arc;
use tool_runtime::primary_runtime::PrimaryRuntimeService;

impl RequestProcessor {
    fn primary_runtime(&self) -> Result<Arc<PrimaryRuntimeService>, JsonRpcError> {
        self.runtime.primary_runtime_service().ok_or_else(|| {
            JsonRpcError::new(
                error_codes::RUNTIME_ERROR,
                "primary runtime storage is unavailable",
            )
        })
    }

    fn workspace_dependencies_enabled(&self) -> Result<bool, JsonRpcError> {
        ConfigLayers::load(self.runtime.app_config_path(), None)
            .map(|layers| layers.effective.features.workspace_dependencies_enabled())
            .map_err(|_| {
                JsonRpcError::new(
                    error_codes::RUNTIME_ERROR,
                    "failed to read workspace dependency configuration",
                )
            })
    }

    pub(super) async fn handle_diagnose_dependencies(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: DiagnoseDependenciesParams = parse_params(params)?;
        let enabled = self.workspace_dependencies_enabled()?;
        dispatch_result(
            self.primary_runtime()?
                .diagnose_dependencies(enabled, params.probe_executables)
                .await,
        )
    }

    pub(super) async fn handle_run_update_now(
        &self,
        params: Option<serde_json::Value>,
        reinstall: bool,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let _: RunUpdateNowParams = parse_params(params)?;
        if !self.workspace_dependencies_enabled()? {
            return Err(JsonRpcError::new(
                error_codes::INVALID_REQUEST,
                "workspace dependencies are disabled",
            ));
        }
        let service = self.primary_runtime()?;
        let update = if reinstall {
            service.reset_dependencies()
        } else {
            service.run_update_now()
        }
        .map_err(|_| {
            JsonRpcError::new(
                error_codes::RUNTIME_ERROR,
                "dependency installation is unavailable or already running in another process",
            )
        })?;
        dispatch_result(InstallDependenciesResponse { update })
    }

    pub(super) async fn handle_cancel_install(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: CancelInstallParams = parse_params(params)?;
        dispatch_result(CancelInstallResponse {
            canceled: self.primary_runtime()?.cancel_install(&params.id),
        })
    }
}
