use super::*;
use app_server_protocol::protocol::v2::{
    MarketplaceUpgradeErrorInfo, MarketplaceUpgradeParams, MarketplaceUpgradeResponse,
};
use app_server_protocol::protocol::v2::{
    PluginAuthPolicy, PluginInstallParams, PluginInstallResponse, PluginUninstallParams,
    PluginUninstallResponse,
};
use async_trait::async_trait;
use std::sync::Mutex as StdMutex;

#[derive(Clone)]
struct PluginLifecycleBackend {
    events: Arc<StdMutex<Vec<&'static str>>>,
}

#[async_trait]
impl ExecutionBackend for PluginLifecycleBackend {
    async fn start_turn(
        &self,
        _request: ExecutionRequest,
        _sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn cancel_turn(
        &self,
        _request: CancelExecutionRequest,
        _sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn invalidate_mcp_runtimes(&self) {
        self.events
            .lock()
            .expect("plugin lifecycle events mutex poisoned")
            .push("invalidate");
    }

    async fn respond_action(
        &self,
        _request: ActionRespondRequest,
        _sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }
}

struct PluginLifecycleDataSource {
    events: Arc<StdMutex<Vec<&'static str>>>,
    upgrade: Result<MarketplaceUpgradeResponse, &'static str>,
    install: Result<(), &'static str>,
}

impl SessionAppDataSource for PluginLifecycleDataSource {}
impl WorkspaceAppDataSource for PluginLifecycleDataSource {}
impl SkillAppDataSource for PluginLifecycleDataSource {}
impl WorkspaceSkillBindingAppDataSource for PluginLifecycleDataSource {}
impl GatewayAppDataSource for PluginLifecycleDataSource {}
impl MediaAppDataSource for PluginLifecycleDataSource {}
impl VoiceAppDataSource for PluginLifecycleDataSource {}

#[async_trait]
impl PluginDataSource for PluginLifecycleDataSource {
    async fn install_plugin(
        &self,
        _params: PluginInstallParams,
    ) -> Result<PluginInstallResponse, RuntimeCoreError> {
        self.events.lock().unwrap().push("install");
        self.install
            .map_err(|error| RuntimeCoreError::InvalidRequest(error.into()))?;
        Ok(PluginInstallResponse {
            auth_policy: PluginAuthPolicy::OnUse,
            apps_needing_auth: Vec::new(),
        })
    }
    async fn upgrade_marketplace(
        &self,
        _params: MarketplaceUpgradeParams,
    ) -> Result<MarketplaceUpgradeResponse, RuntimeCoreError> {
        self.events.lock().unwrap().push("upgrade");
        self.upgrade
            .clone()
            .map_err(|error| RuntimeCoreError::InvalidRequest(error.into()))
    }

    async fn uninstall_plugin(
        &self,
        _params: PluginUninstallParams,
    ) -> Result<PluginUninstallResponse, RuntimeCoreError> {
        self.events
            .lock()
            .expect("plugin lifecycle events mutex poisoned")
            .push("uninstall");
        Ok(PluginUninstallResponse {})
    }
}
impl AutomationOverviewAppDataSource for PluginLifecycleDataSource {}
impl McpAppDataSource for PluginLifecycleDataSource {}
impl AutomationManagementAppDataSource for PluginLifecycleDataSource {}
impl MemoryAppDataSource for PluginLifecycleDataSource {}
impl DiagnosticsAppDataSource for PluginLifecycleDataSource {}
impl ModelProviderAppDataSource for PluginLifecycleDataSource {}
impl ConnectAppDataSource for PluginLifecycleDataSource {}
impl RightSurfaceAppDataSource for PluginLifecycleDataSource {}

#[tokio::test]
async fn plugin_uninstall_invalidates_mcp_runtimes_before_and_after_removing_package() {
    let events = Arc::new(StdMutex::new(Vec::new()));
    let core = RuntimeCore::with_backend(Arc::new(PluginLifecycleBackend {
        events: Arc::clone(&events),
    }))
    .with_app_data_source(Arc::new(PluginLifecycleDataSource {
        events: Arc::clone(&events),
        upgrade: Ok(MarketplaceUpgradeResponse::default()),
        install: Ok(()),
    }));

    let response = core
        .uninstall_plugin(PluginUninstallParams {
            plugin_id: "mcp-elicitation-plugin@local".to_string(),
        })
        .await
        .expect("plugin uninstall");

    assert_eq!(
        serde_json::to_value(response).unwrap(),
        serde_json::json!({})
    );
    assert_eq!(
        *events
            .lock()
            .expect("plugin lifecycle events mutex poisoned"),
        vec!["invalidate", "uninstall", "invalidate"]
    );
}

#[tokio::test]
async fn marketplace_upgrade_invalidates_mcp_only_after_a_new_snapshot_is_committed() {
    let error = MarketplaceUpgradeErrorInfo {
        marketplace_name: "failed".into(),
        message: "injected failure".into(),
    };
    for (upgrade, changed) in [
        (Ok(MarketplaceUpgradeResponse::default()), false),
        (
            Ok(MarketplaceUpgradeResponse {
                errors: vec![error.clone()],
                ..Default::default()
            }),
            false,
        ),
        (
            Ok(MarketplaceUpgradeResponse {
                upgraded_roots: vec!["/fixture/team".into()],
                errors: vec![error],
                ..Default::default()
            }),
            true,
        ),
        (Err("invalid marketplace"), false),
    ] {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let core = RuntimeCore::with_backend(Arc::new(PluginLifecycleBackend {
            events: Arc::clone(&events),
        }))
        .with_app_data_source(Arc::new(PluginLifecycleDataSource {
            events: Arc::clone(&events),
            upgrade: upgrade.clone(),
            install: Ok(()),
        }));
        assert_eq!(
            core.upgrade_marketplace(MarketplaceUpgradeParams::default())
                .await
                .is_ok(),
            upgrade.is_ok()
        );
        let expected = if changed {
            vec!["upgrade", "invalidate"]
        } else {
            vec!["upgrade"]
        };
        assert_eq!(*events.lock().unwrap(), expected, "outcome: {upgrade:?}");
    }
}

#[tokio::test]
async fn plugin_install_invalidates_concurrent_old_mcp_snapshot_only_after_successful_commit() {
    for result in [Ok(()), Err("download rejected")] {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let core = RuntimeCore::with_backend(Arc::new(PluginLifecycleBackend {
            events: events.clone(),
        }))
        .with_app_data_source(Arc::new(PluginLifecycleDataSource {
            events: events.clone(),
            upgrade: Ok(MarketplaceUpgradeResponse::default()),
            install: result,
        }));
        assert_eq!(
            core.install_plugin(PluginInstallParams {
                marketplace_path: None,
                remote_marketplace_name: Some("workspace-directory".into()),
                plugin_name: "opaque~install".into(),
                install_attempt_id: None,
            })
            .await
            .is_ok(),
            result.is_ok()
        );
        let expected = if result.is_ok() {
            vec!["invalidate", "install", "invalidate"]
        } else {
            vec!["invalidate", "install"]
        };
        assert_eq!(*events.lock().unwrap(), expected);
    }
}
