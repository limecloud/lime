//! skill domain handlers for the App Server processor.

mod dispatch;
mod watcher;

use super::{dispatch_result, parse_params, to_jsonrpc_error, RequestProcessor, RpcDispatch};
use app_server_protocol::protocol::v2::{
    ServerNotification as V2ServerNotification, SkillsChangedNotification, SkillsConfigWriteParams,
    SkillsExtraRootsSetParams, SkillsListParams,
};
use app_server_protocol::{
    JsonRpcError, SkillDownloadInstallParams, SkillLocalDetailInspectParams,
    SkillLocalImportParams, SkillLocalInspectParams, SkillLocalRenameParams,
    SkillManagementInstallParams, SkillManagementListParams, SkillManagementUninstallParams,
    SkillMarketplaceInstallParams, SkillPackageExportParams, SkillPackageLocalInspectParams,
    SkillPackageLocalInstallParams, SkillPackageLocalReplaceParams, SkillReadParams,
    SkillRemoteInspectParams, SkillRepositoryDeleteParams, SkillRepositorySaveParams,
    SkillScaffoldCreateParams,
};
use serde::Serialize;

impl RequestProcessor {
    pub(crate) async fn shutdown_skills_watcher(&self) {
        if let Some(watcher) = &self.skills_watcher {
            watcher.shutdown().await;
        }
    }

    pub(crate) fn with_skills_watcher(
        mut self,
        watcher: Option<std::sync::Arc<crate::skills_watcher::SkillsWatcher>>,
    ) -> Self {
        self.skills_watcher = watcher;
        self
    }

    pub(super) async fn handle_skills_list_v2_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillsListParams = parse_params(params)?;
        let response = self
            .runtime
            .list_skills(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skill_read_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillReadParams = parse_params(params)?;
        let response = self
            .runtime
            .read_skill(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skills_extra_roots_set_v2_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillsExtraRootsSetParams = parse_params(params)?;
        let response =
            self.runtime
                .set_extra_skill_roots(params)
                .await
                .map_err(|error| match error {
                    crate::RuntimeCoreError::InvalidRequest(message) => {
                        JsonRpcError::new(app_server_protocol::error_codes::INVALID_PARAMS, message)
                    }
                    other => to_jsonrpc_error(other),
                })?;
        if let Some(watcher) = &self.skills_watcher {
            watcher.register_runtime_extra_roots(lime_skills::runtime_extra_skill_roots());
        }
        self.dispatch_skill_catalog_mutation(response, true).await
    }

    pub(super) async fn handle_skills_config_write_v2_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillsConfigWriteParams = parse_params(params)?;
        let response =
            self.runtime
                .write_skill_config(params)
                .await
                .map_err(|error| match error {
                    crate::RuntimeCoreError::InvalidRequest(message) => {
                        JsonRpcError::new(app_server_protocol::error_codes::INVALID_PARAMS, message)
                    }
                    other => to_jsonrpc_error(other),
                })?;
        self.dispatch_skill_catalog_mutation(response, true).await
    }

    pub(super) async fn handle_skill_management_list_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillManagementListParams = parse_params(params)?;
        let response = self
            .runtime
            .list_management_skills(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skill_management_install_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillManagementInstallParams = parse_params(params)?;
        let changes_lime_catalog = is_lime_app(&params.app);
        let response = self
            .runtime
            .install_management_skill(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, changes_lime_catalog)
            .await
    }

    pub(super) async fn handle_skill_management_uninstall_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillManagementUninstallParams = parse_params(params)?;
        let changes_lime_catalog = is_lime_app(&params.app);
        let response = self
            .runtime
            .uninstall_management_skill(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, changes_lime_catalog)
            .await
    }

    pub(super) async fn handle_skill_repository_list_impl(
        &self,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .list_skill_repositories()
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skill_repository_save_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillRepositorySaveParams = parse_params(params)?;
        let response = self
            .runtime
            .save_skill_repository(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, true).await
    }

    pub(super) async fn handle_skill_repository_delete_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillRepositoryDeleteParams = parse_params(params)?;
        let response = self
            .runtime
            .delete_skill_repository(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, true).await
    }

    pub(super) async fn handle_skill_cache_refresh_impl(
        &self,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .refresh_skill_cache()
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, true).await
    }

    pub(super) async fn handle_skill_installed_directories_list_impl(
        &self,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .list_installed_skill_directories()
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skill_local_inspect_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillLocalInspectParams = parse_params(params)?;
        let response = self
            .runtime
            .inspect_local_skill(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skill_package_local_inspect_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillPackageLocalInspectParams = parse_params(params)?;
        let response = self
            .runtime
            .inspect_local_skill_package(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skill_local_detail_inspect_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillLocalDetailInspectParams = parse_params(params)?;
        let response = self
            .runtime
            .inspect_local_skill_detail(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skill_local_scaffold_create_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillScaffoldCreateParams = parse_params(params)?;
        let changes_lime_catalog = is_lime_app(&params.app);
        let response = self
            .runtime
            .create_skill_scaffold(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, changes_lime_catalog)
            .await
    }

    pub(super) async fn handle_skill_local_import_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillLocalImportParams = parse_params(params)?;
        let changes_lime_catalog = is_lime_app(&params.app);
        let response = self
            .runtime
            .import_local_skill(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, changes_lime_catalog)
            .await
    }

    pub(super) async fn handle_skill_local_rename_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillLocalRenameParams = parse_params(params)?;
        let changes_lime_catalog = is_lime_app(&params.app);
        let response = self
            .runtime
            .rename_local_skill(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, changes_lime_catalog)
            .await
    }

    pub(super) async fn handle_skill_remote_inspect_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillRemoteInspectParams = parse_params(params)?;
        let response = self
            .runtime
            .inspect_remote_skill(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skill_package_local_install_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillPackageLocalInstallParams = parse_params(params)?;
        let changes_lime_catalog = is_lime_app(&params.app);
        let response = self
            .runtime
            .install_local_skill_package(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, changes_lime_catalog)
            .await
    }

    pub(super) async fn handle_skill_package_local_replace_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillPackageLocalReplaceParams = parse_params(params)?;
        let changes_lime_catalog = is_lime_app(&params.app);
        let response = self
            .runtime
            .replace_local_skill_package(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, changes_lime_catalog)
            .await
    }

    pub(super) async fn handle_skill_package_export_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillPackageExportParams = parse_params(params)?;
        let response = self
            .runtime
            .export_local_skill_package(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_skill_marketplace_install_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillMarketplaceInstallParams = parse_params(params)?;
        let changes_lime_catalog = is_lime_app(&params.app);
        let response = self
            .runtime
            .install_marketplace_skill(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, changes_lime_catalog)
            .await
    }

    pub(super) async fn handle_skill_download_install_impl(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SkillDownloadInstallParams = parse_params(params)?;
        let changes_lime_catalog = is_lime_app(&params.app);
        let response = self
            .runtime
            .install_skill_from_download_url(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.dispatch_skill_catalog_mutation(response, changes_lime_catalog)
            .await
    }
}

impl RequestProcessor {
    pub(in crate::processor) async fn dispatch_skill_catalog_mutation(
        &self,
        response: impl Serialize,
        changes_lime_catalog: bool,
    ) -> Result<RpcDispatch, JsonRpcError> {
        let dispatch = dispatch_result(response)?;
        if !changes_lime_catalog {
            return Ok(dispatch);
        }
        lime_skills::invalidate_agent_skill_snapshot_cache();
        let notification = V2ServerNotification::SkillsChanged(SkillsChangedNotification {});
        if self.server_notification_hook.is_some() {
            self.publish_server_notification(notification).await;
            Ok(dispatch)
        } else {
            Ok(dispatch.with_notification(notification.into()))
        }
    }
}

fn is_lime_app(app: &str) -> bool {
    app.trim().eq_ignore_ascii_case("lime")
}
