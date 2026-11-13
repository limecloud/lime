use super::super::*;
use crate::MarketDataSource;
use app_server_protocol::protocol::v2::*;
use async_trait::async_trait;

#[async_trait]
impl MarketDataSource for LocalAppDataSource {
    async fn list_pending_market_installs(
        &self,
        params: MarketPendingParams,
    ) -> Result<MarketPendingResponse, RuntimeCoreError> {
        self.market_store.pending(params).map_err(data_error)
    }

    async fn cancel_market_install(
        &self,
        params: MarketInstallCancelParams,
    ) -> Result<MarketInstallCancelResponse, RuntimeCoreError> {
        self.market_store
            .cancel_install(params)
            .await
            .map_err(data_error)
    }

    async fn reconcile_market_resources(
        &self,
        params: MarketReconcileParams,
    ) -> Result<MarketReconcileResponse, RuntimeCoreError> {
        self.market_store
            .reconcile(params)
            .await
            .map_err(data_error)
    }

    async fn install_market_resource(
        &self,
        params: MarketInstallParams,
    ) -> Result<MarketInstallResponse, RuntimeCoreError> {
        self.market_store.install(params).await.map_err(data_error)
    }
    async fn list_installed_market_resources(
        &self,
        params: MarketInstalledParams,
    ) -> Result<MarketInstalledResponse, RuntimeCoreError> {
        self.market_store.installed(params).map_err(data_error)
    }
    async fn set_market_resource_enabled(
        &self,
        params: MarketEnabledSetParams,
    ) -> Result<MarketEnabledSetResponse, RuntimeCoreError> {
        self.market_store.set_enabled(params).map_err(data_error)
    }
    async fn uninstall_market_resource(
        &self,
        params: MarketUninstallParams,
    ) -> Result<MarketUninstallResponse, RuntimeCoreError> {
        self.market_store.uninstall(params).map_err(data_error)
    }
    async fn list_market_skills(
        &self,
    ) -> Result<Vec<lime_skills::AgentSkillMetadata>, RuntimeCoreError> {
        self.market_store.skills().map_err(data_error)
    }
}
