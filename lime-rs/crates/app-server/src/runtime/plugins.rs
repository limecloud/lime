use super::RuntimeCore;
use super::RuntimeCoreError;
use app_server_protocol::protocol::v2::{
    AppsInstalledParams, AppsInstalledResponse, AppsListParams, AppsListResponse, AppsReadParams,
    AppsReadResponse, PluginInstallParams, PluginInstallResponse, PluginInstalledParams,
    PluginInstalledResponse, PluginListParams, PluginListResponse, PluginReadParams,
    PluginReadResponse, PluginSearchParams, PluginSearchResponse, PluginUninstallParams,
    PluginUninstallResponse,
};

mod remote;
use app_server_protocol::protocol::v2::{
    MarketplaceAddParams, MarketplaceAddResponse, MarketplaceRemoveParams,
    MarketplaceRemoveResponse, MarketplaceUpgradeParams, MarketplaceUpgradeResponse,
};

impl RuntimeCore {
    pub async fn add_marketplace(
        &self,
        params: MarketplaceAddParams,
    ) -> Result<MarketplaceAddResponse, RuntimeCoreError> {
        self.app_data_source.add_marketplace(params).await
    }

    pub async fn remove_marketplace(
        &self,
        params: MarketplaceRemoveParams,
    ) -> Result<MarketplaceRemoveResponse, RuntimeCoreError> {
        self.app_data_source.remove_marketplace(params).await
    }

    pub async fn upgrade_marketplace(
        &self,
        params: MarketplaceUpgradeParams,
    ) -> Result<MarketplaceUpgradeResponse, RuntimeCoreError> {
        let response = self.app_data_source.upgrade_marketplace(params).await?;
        if !response.upgraded_roots.is_empty() {
            self.invalidate_plugin_components().await;
        }
        Ok(response)
    }

    pub(crate) async fn invalidate_plugin_components(&self) {
        self.backend.invalidate_mcp_runtimes().await;
    }

    pub(crate) async fn plugin_skill_roots(
        &self,
    ) -> Result<Vec<lime_skills::AgentSkillRoot>, RuntimeCoreError> {
        Ok(self
            .app_data_source
            .list_enabled_plugin_turn_snapshots()
            .await?
            .iter()
            .flat_map(super::PluginTurnSnapshot::skill_roots)
            .collect())
    }

    pub async fn list_apps(
        &self,
        params: AppsListParams,
    ) -> Result<AppsListResponse, RuntimeCoreError> {
        self.ensure_optional_apps_thread_loaded(params.thread_id.as_deref())?;
        self.app_data_source.list_apps(params).await
    }

    pub async fn read_apps(
        &self,
        params: AppsReadParams,
    ) -> Result<AppsReadResponse, RuntimeCoreError> {
        self.app_data_source.read_apps(params).await
    }

    pub async fn list_installed_apps(
        &self,
        params: AppsInstalledParams,
    ) -> Result<AppsInstalledResponse, RuntimeCoreError> {
        self.ensure_optional_apps_thread_loaded(params.thread_id.as_deref())?;
        self.app_data_source.list_installed_apps(params).await
    }

    fn ensure_optional_apps_thread_loaded(
        &self,
        thread_id: Option<&str>,
    ) -> Result<(), RuntimeCoreError> {
        let Some(thread_id) = thread_id else {
            return Ok(());
        };
        let thread_id = thread_id.trim();
        if thread_id.is_empty() || self.loaded_session_id_for_thread(thread_id).is_none() {
            return Err(RuntimeCoreError::SessionNotFound(thread_id.to_string()));
        }
        Ok(())
    }

    pub async fn list_plugins(
        &self,
        params: PluginListParams,
    ) -> Result<PluginListResponse, RuntimeCoreError> {
        let mut response = self.app_data_source.list_plugins(params.clone()).await?;
        match tokio::time::timeout(std::time::Duration::from_secs(30), remote::list(self, &params)).await {
            Ok(Ok(marketplaces)) => response.marketplaces.extend(marketplaces),
            result => response.marketplace_load_errors.push(
                app_server_protocol::protocol::v2::MarketplaceLoadErrorInfo {
                    marketplace_path: "lime-cloud".into(),
                    message: match result {
                        Ok(Err(error)) => error.to_string(),
                        _ => "shared market request timed out".into(),
                    },
                },
            ),
        }
        Ok(response)
    }

    pub async fn search_plugins(
        &self,
        params: PluginSearchParams,
    ) -> Result<PluginSearchResponse, RuntimeCoreError> {
        self.app_data_source.search_plugins(params).await
    }

    pub async fn read_plugin_skill(
        &self,
        params: app_server_protocol::protocol::v2::PluginSkillReadParams,
    ) -> Result<app_server_protocol::protocol::v2::PluginSkillReadResponse, RuntimeCoreError> {
        remote::read_skill(self, params).await
    }

    pub async fn read_plugin(
        &self,
        params: PluginReadParams,
    ) -> Result<PluginReadResponse, RuntimeCoreError> {
        if params.marketplace_path.is_none() && params.remote_marketplace_name.is_some() {
            return remote::read(self, params).await;
        }
        self.app_data_source.read_plugin(params).await
    }

    pub async fn install_plugin(
        &self,
        params: PluginInstallParams,
    ) -> Result<PluginInstallResponse, RuntimeCoreError> {
        self.backend.invalidate_mcp_runtimes().await;
        let result = self.app_data_source.install_plugin(params).await;
        if result.is_ok() {
            // A concurrent turn may have rebuilt the previous MCP snapshot while
            // the remote bundle was downloading. Invalidate after commit as well.
            self.backend.invalidate_mcp_runtimes().await;
        }
        result
    }

    pub async fn uninstall_plugin(
        &self,
        params: PluginUninstallParams,
    ) -> Result<PluginUninstallResponse, RuntimeCoreError> {
        self.backend.invalidate_mcp_runtimes().await;
        let result = self.app_data_source.uninstall_plugin(params).await;
        if result.is_ok() {
            self.backend.invalidate_mcp_runtimes().await;
        }
        result
    }

    pub async fn list_installed_plugins(
        &self,
        params: PluginInstalledParams,
    ) -> Result<PluginInstalledResponse, RuntimeCoreError> {
        self.app_data_source.list_installed_plugins(params).await
    }

    pub async fn reconcile_plugins(
        &self,
        params: app_server_protocol::protocol::v2::PluginReconcileParams,
    ) -> Result<app_server_protocol::protocol::v2::PluginReconcileResponse, RuntimeCoreError> {
        self.invalidate_plugin_components().await;
        let result = self.app_data_source.reconcile_plugins(params).await;
        // Publication can succeed before a later materialization or account check fails.
        self.invalidate_plugin_components().await;
        result
    }
}
