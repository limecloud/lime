use super::unavailable;
use super::NoopAppDataSource;
use super::RuntimeCoreError;
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
use std::path::PathBuf;

/// Snapshot of an enabled Agent Plugin used to build one current turn.
///
/// This is intentionally smaller than an activation payload: package discovery and
/// component loading stay owned by App Server, while RuntimeCore receives only the
/// stable inputs needed for Skills and MCP routing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginTurnSnapshot {
    pub id: String,
    pub config_name: String,
    pub display_name: String,
    pub package_root: PathBuf,
    pub skill_roots: Vec<PathBuf>,
    pub skills: Vec<lime_skills::AgentSkillMetadata>,
    pub mcp_server_names: Vec<String>,
}

impl PluginTurnSnapshot {
    pub(crate) fn skill_roots(&self) -> impl Iterator<Item = lime_skills::AgentSkillRoot> + '_ {
        self.skill_roots
            .iter()
            .map(|path| lime_skills::AgentSkillRoot {
                path: path.clone(),
                scope: lime_skills::AgentSkillScope::App,
            })
    }

    pub(crate) fn append_skills(&self, snapshot: &mut lime_skills::AgentSkillSnapshot) {
        snapshot.roots.extend(self.skill_roots());
        snapshot.skills.extend(self.skills.iter().cloned());
    }
}
#[async_trait]
pub trait PluginDataSource: Send + Sync {
    async fn load_plugin_hooks(
        &self,
    ) -> Result<tool_runtime::hook_source::PluginHookLoadOutcome, RuntimeCoreError> {
        Ok(Default::default())
    }

    async fn add_marketplace(
        &self,
        _params: MarketplaceAddParams,
    ) -> Result<MarketplaceAddResponse, RuntimeCoreError> {
        Err(unavailable("marketplace/add"))
    }

    async fn remove_marketplace(
        &self,
        _params: MarketplaceRemoveParams,
    ) -> Result<MarketplaceRemoveResponse, RuntimeCoreError> {
        Err(unavailable("marketplace/remove"))
    }

    async fn upgrade_marketplace(
        &self,
        _params: MarketplaceUpgradeParams,
    ) -> Result<MarketplaceUpgradeResponse, RuntimeCoreError> {
        Err(unavailable("marketplace/upgrade"))
    }

    async fn list_plugins(
        &self,
        _params: PluginListParams,
    ) -> Result<PluginListResponse, RuntimeCoreError> {
        Err(unavailable("plugin/list"))
    }

    async fn search_plugins(
        &self,
        _params: PluginSearchParams,
    ) -> Result<PluginSearchResponse, RuntimeCoreError> {
        Err(unavailable("plugin/search"))
    }

    async fn read_plugin(
        &self,
        _params: PluginReadParams,
    ) -> Result<PluginReadResponse, RuntimeCoreError> {
        Err(unavailable("plugin/read"))
    }

    async fn install_plugin(
        &self,
        _params: PluginInstallParams,
    ) -> Result<PluginInstallResponse, RuntimeCoreError> {
        Err(unavailable("plugin/install"))
    }

    async fn uninstall_plugin(
        &self,
        _params: PluginUninstallParams,
    ) -> Result<PluginUninstallResponse, RuntimeCoreError> {
        Err(unavailable("plugin/uninstall"))
    }

    async fn list_installed_plugins(
        &self,
        _params: PluginInstalledParams,
    ) -> Result<PluginInstalledResponse, RuntimeCoreError> {
        Err(unavailable("plugin/installed"))
    }

    async fn reconcile_plugins(
        &self,
        _params: app_server_protocol::protocol::v2::PluginReconcileParams,
    ) -> Result<app_server_protocol::protocol::v2::PluginReconcileResponse, RuntimeCoreError> {
        Err(unavailable("plugin/reconcile"))
    }

    async fn list_enabled_plugin_turn_snapshots(
        &self,
    ) -> Result<Vec<PluginTurnSnapshot>, RuntimeCoreError> {
        Ok(Vec::new())
    }

    async fn list_apps(
        &self,
        _params: AppsListParams,
    ) -> Result<AppsListResponse, RuntimeCoreError> {
        Err(unavailable("app/list"))
    }

    async fn read_apps(
        &self,
        _params: AppsReadParams,
    ) -> Result<AppsReadResponse, RuntimeCoreError> {
        Err(unavailable("app/read"))
    }

    async fn list_installed_apps(
        &self,
        _params: AppsInstalledParams,
    ) -> Result<AppsInstalledResponse, RuntimeCoreError> {
        Err(unavailable("app/installed"))
    }
}

impl PluginDataSource for NoopAppDataSource {}
