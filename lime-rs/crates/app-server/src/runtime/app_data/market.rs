use super::{unavailable, NoopAppDataSource, RuntimeCoreError};
use app_server_protocol::protocol::v2::*;
use async_trait::async_trait;

#[async_trait]
pub trait MarketDataSource: Send + Sync {
    async fn list_pending_market_installs(
        &self,
        _params: MarketPendingParams,
    ) -> Result<MarketPendingResponse, RuntimeCoreError> {
        Err(unavailable("market/install/pending"))
    }

    async fn cancel_market_install(
        &self,
        _params: MarketInstallCancelParams,
    ) -> Result<MarketInstallCancelResponse, RuntimeCoreError> {
        Err(unavailable("market/install/cancel"))
    }

    async fn reconcile_market_resources(
        &self,
        _params: MarketReconcileParams,
    ) -> Result<MarketReconcileResponse, RuntimeCoreError> {
        Err(unavailable("market/reconcile"))
    }

    async fn install_market_resource(
        &self,
        _params: MarketInstallParams,
    ) -> Result<MarketInstallResponse, RuntimeCoreError> {
        Err(unavailable("market/install"))
    }
    async fn list_installed_market_resources(
        &self,
        _params: MarketInstalledParams,
    ) -> Result<MarketInstalledResponse, RuntimeCoreError> {
        Ok(MarketInstalledResponse {
            resources: Vec::new(),
            errors: Vec::new(),
        })
    }
    async fn set_market_resource_enabled(
        &self,
        _params: MarketEnabledSetParams,
    ) -> Result<MarketEnabledSetResponse, RuntimeCoreError> {
        Err(unavailable("market/enabled/set"))
    }
    async fn uninstall_market_resource(
        &self,
        _params: MarketUninstallParams,
    ) -> Result<MarketUninstallResponse, RuntimeCoreError> {
        Err(unavailable("market/uninstall"))
    }
    async fn list_market_skills(
        &self,
    ) -> Result<Vec<lime_skills::AgentSkillMetadata>, RuntimeCoreError> {
        Ok(Vec::new())
    }
}

impl MarketDataSource for NoopAppDataSource {}
