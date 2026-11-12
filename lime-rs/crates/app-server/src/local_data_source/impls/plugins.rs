use super::super::*;
use app_server_protocol::protocol::v2::{
    AppsInstalledParams, AppsInstalledResponse, AppsListParams, AppsListResponse, AppsReadParams,
    AppsReadResponse, PluginInstallParams, PluginInstallResponse, PluginInstalledParams,
    PluginInstalledResponse, PluginListParams, PluginListResponse, PluginReadParams,
    PluginReadResponse, PluginSearchParams, PluginSearchResponse, PluginUninstallParams,
    PluginUninstallResponse,
};
use app_server_protocol::protocol::v2::{
    MarketplaceAddParams, MarketplaceAddResponse, MarketplaceRemoveParams,
    MarketplaceRemoveResponse, MarketplaceUpgradeParams, MarketplaceUpgradeResponse,
};
use async_trait::async_trait;

impl LocalAppDataSource {
    /// Configure the host's home and bundled marketplace discovery roots.
    pub fn with_plugin_discovery_roots(
        mut self,
        home: Option<std::path::PathBuf>,
        bundled_marketplace: Option<std::path::PathBuf>,
    ) -> Self {
        self.plugin_store.home = home;
        self.plugin_store.bundled_marketplace = bundled_marketplace;
        self
    }
}

#[async_trait]
impl PluginDataSource for LocalAppDataSource {
    async fn load_plugin_hooks(
        &self,
    ) -> Result<tool_runtime::hook_source::PluginHookLoadOutcome, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::hooks::load(&self.plugin_store)
            .map_err(data_error)
    }

    async fn add_marketplace(
        &self,
        params: MarketplaceAddParams,
    ) -> Result<MarketplaceAddResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::marketplace::add(&self.plugin_store, params).await
    }

    async fn remove_marketplace(
        &self,
        params: MarketplaceRemoveParams,
    ) -> Result<MarketplaceRemoveResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::marketplace::remove(&self.plugin_store, params)
    }

    async fn upgrade_marketplace(
        &self,
        params: MarketplaceUpgradeParams,
    ) -> Result<MarketplaceUpgradeResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::marketplace::upgrade(&self.plugin_store, params)
            .await
    }

    async fn list_plugins(
        &self,
        params: PluginListParams,
    ) -> Result<PluginListResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::list(&self.plugin_store, params)
            .map_err(data_error)
    }

    async fn search_plugins(
        &self,
        params: PluginSearchParams,
    ) -> Result<PluginSearchResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::search(&self.plugin_store, params)
            .map_err(data_error)
    }

    async fn read_plugin(
        &self,
        params: PluginReadParams,
    ) -> Result<PluginReadResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::read(&self.plugin_store, params)
            .map_err(data_error)
    }

    async fn install_plugin(
        &self,
        params: PluginInstallParams,
    ) -> Result<PluginInstallResponse, RuntimeCoreError> {
        if params.marketplace_path.is_none() && params.remote_marketplace_name.is_some() {
            return crate::local_data_source::plugin_catalog::remote::install(
                &self.plugin_store,
                params,
            )
            .await
            .map_err(data_error);
        }
        crate::local_data_source::plugin_catalog::install(&self.plugin_store, params)
            .map_err(data_error)
    }

    async fn uninstall_plugin(
        &self,
        params: PluginUninstallParams,
    ) -> Result<PluginUninstallResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::remote::uninstall(&self.plugin_store, params)
            .await
            .map_err(data_error)
    }

    async fn list_installed_plugins(
        &self,
        params: PluginInstalledParams,
    ) -> Result<PluginInstalledResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::installed(&self.plugin_store, params)
            .map_err(data_error)
    }

    async fn list_enabled_plugin_turn_snapshots(
        &self,
    ) -> Result<Vec<crate::runtime::PluginTurnSnapshot>, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::enabled_plugin_turn_snapshots(&self.plugin_store)
            .map_err(data_error)
    }

    async fn reconcile_plugins(
        &self,
        _params: app_server_protocol::protocol::v2::PluginReconcileParams,
    ) -> Result<app_server_protocol::protocol::v2::PluginReconcileResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::remote::reconcile(&self.plugin_store)
            .await
            .map_err(data_error)
    }

    async fn list_apps(
        &self,
        params: AppsListParams,
    ) -> Result<AppsListResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::list_apps(&self.plugin_store, params)
            .map_err(data_error)
    }

    async fn read_apps(
        &self,
        params: AppsReadParams,
    ) -> Result<AppsReadResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::read_apps(&self.plugin_store, params)
            .map_err(data_error)
    }

    async fn list_installed_apps(
        &self,
        params: AppsInstalledParams,
    ) -> Result<AppsInstalledResponse, RuntimeCoreError> {
        crate::local_data_source::plugin_catalog::installed_apps(&self.plugin_store, params)
            .map_err(data_error)
    }
}
