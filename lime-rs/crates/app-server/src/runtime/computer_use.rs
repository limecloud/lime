//! Host composition and live policy loading for the shared Computer Use owner.

use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::protocol::v2::*;
use app_server_protocol::AgentTurnStatus;
use lime_core::config::{ConfigManager, YamlService};
use std::sync::Arc;
use tool_runtime::computer_use::{
    ComputerUseError, ComputerUseOwner, ComputerUsePaths, ComputerUsePolicy,
    ComputerUsePolicyStore, ComputerUseResult, ComputerUseService, ComputerUseTarget,
};

mod gateway;

impl RuntimeCore {
    /// Resolve the signed product's resource manifest lazily; missing resources
    /// remain not_installed, with no Electron callback or PATH fallback.
    pub fn with_native_computer_use(mut self, paths: ComputerUsePaths) -> Self {
        self.computer_use = Arc::new(
            ComputerUseService::default()
                .with_control_directory(paths.root.clone())
                .with_adapter(Arc::new(
                    tool_runtime::computer_use::NativeAdapter::default(),
                ))
                .with_adapter(Arc::new(tool_runtime::computer_use::ExtensionAdapter::new(
                    ComputerUseAdapterKind::Chrome,
                    paths.clone(),
                )))
                .with_adapter(Arc::new(tool_runtime::computer_use::OfficeAdapter::new(
                    paths,
                ))),
        );
        self
    }

    /// Only a trusted host can register adapters; RPC cannot supply a driver or its status.
    pub fn with_computer_use_service(mut self, service: ComputerUseService) -> Self {
        self.computer_use = Arc::new(service);
        self
    }

    fn computer_use_policy(&self) -> ComputerUseResult<ComputerUsePolicy> {
        load_policy(&self.app_config_path, self.requirements_path.as_deref())
    }

    pub(crate) async fn computer_use_status(
        &self,
        connection: &str,
        params: ComputerUseStatusParams,
    ) -> Result<ComputerUseStatusResponse, RuntimeCoreError> {
        let mut response = self
            .computer_use
            .status(params, || self.computer_use_policy())
            .await
            .map_err(policy_error)?;
        response.grants = self
            .computer_use
            .grants_for_connection(connection)
            .map_err(policy_error)?;
        Ok(response)
    }

    pub(crate) async fn computer_use_setup(
        &self,
        connection: &str,
        params: ComputerUseSetupParams,
        canceled: impl Fn() -> bool + Send + Sync,
    ) -> Result<ComputerUseSetupResponse, RuntimeCoreError> {
        self.computer_use
            .setup(
                connection,
                params,
                PolicyStore {
                    config_path: &self.app_config_path,
                    requirements_path: self.requirements_path.as_deref(),
                    canceled: &canceled,
                },
            )
            .await
            .map_err(policy_error)
    }

    pub(crate) async fn computer_use_acquire(
        &self,
        connection: &str,
        params: ComputerUseLeaseAcquireParams,
    ) -> Result<ComputerUseLeaseAcquireResponse, RuntimeCoreError> {
        self.check_computer_use_turn(&params.thread_id, &params.turn_id)?;
        let owner = ComputerUseOwner {
            connection: connection.into(),
            thread_id: params.thread_id.clone(),
            turn_id: params.turn_id.clone(),
        };
        let lease = self
            .computer_use
            .acquire(owner.clone(), params, || self.computer_use_policy())
            .await
            .map_err(policy_error)?;
        if let Err(error) = self.check_computer_use_turn(&owner.thread_id, &owner.turn_id) {
            let _ = self.computer_use.release(connection, &lease.lease_id);
            return Err(error);
        }
        Ok(lease)
    }

    fn check_computer_use_turn(
        &self,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<(), RuntimeCoreError> {
        let state = self
            .state
            .lock()
            .map_err(|_| RuntimeCoreError::InvalidRequest("Runtime state is unavailable".into()))?;
        let live = state.sessions.values().any(|stored| {
            stored.session.thread_id == thread_id
                && stored.turns.iter().any(|turn| {
                    turn.turn_id == turn_id
                        && matches!(
                            turn.status,
                            AgentTurnStatus::Accepted
                                | AgentTurnStatus::Running
                                | AgentTurnStatus::WaitingAction
                        )
                })
        });
        if !live {
            return Err(RuntimeCoreError::InvalidRequest(
                "Computer Use lease requires an active canonical thread and turn".into(),
            ));
        }
        Ok(())
    }
}

fn load_policy(
    config_path: &std::path::Path,
    requirements_path: Option<&std::path::Path>,
) -> ComputerUseResult<ComputerUsePolicy> {
    let _lock = lime_core::config::config_file_lock();
    let config = ConfigManager::load(config_path)
        .map_err(|error| ComputerUseError::new(error.to_string()))?;
    policy_from_config(config.config(), requirements_path)
}

struct PolicyStore<'a> {
    config_path: &'a std::path::Path,
    requirements_path: Option<&'a std::path::Path>,
    canceled: &'a (dyn Fn() -> bool + Sync),
}

impl ComputerUsePolicyStore for PolicyStore<'_> {
    fn load(&self) -> ComputerUseResult<ComputerUsePolicy> {
        if (self.canceled)() {
            return Err(ComputerUseError::new("Computer Use setup canceled".into()));
        }
        load_policy(self.config_path, self.requirements_path)
    }

    fn save_approval(
        &self,
        adapter: ComputerUseAdapterKind,
        target: &ComputerUseTarget,
    ) -> ComputerUseResult<()> {
        let _lock = lime_core::config::config_file_lock();
        if (self.canceled)() {
            return Err(ComputerUseError::new("Computer Use setup canceled".into()));
        }
        let mut manager = ConfigManager::load(self.config_path)
            .map_err(|error| ComputerUseError::new(error.to_string()))?;
        let policy = policy_from_config(manager.config(), self.requirements_path)?
            .with_persistent_approval(adapter, target)
            .map_err(|error| ComputerUseError::new(error.into()))?;
        manager.config_mut().computer_use = policy.user;
        if (self.canceled)() {
            return Err(ComputerUseError::new("Computer Use setup canceled".into()));
        }
        YamlService::save_preserve_comments(self.config_path, manager.config())
            .map_err(|error| ComputerUseError::new(error.to_string()))
    }
}

fn policy_from_config(
    config: &lime_core::config::Config,
    requirements_path: Option<&std::path::Path>,
) -> ComputerUseResult<ComputerUsePolicy> {
    let requirements = super::config_requirements::read_config_requirements_at(requirements_path)
        .map_err(|error| ComputerUseError::new(error.to_string()))?;
    Ok(ComputerUsePolicy {
        native_enabled: Some(
            config
                .features
                .entries
                .get("computer_use")
                .copied()
                .unwrap_or(false),
        ),
        chrome_enabled: Some(
            config
                .features
                .entries
                .get("chrome_use")
                .copied()
                .unwrap_or(false),
        ),
        office_enabled: Some(
            config
                .features
                .entries
                .get("office_use")
                .copied()
                .unwrap_or(false),
        ),
        browser: config.browser_use.clone(),
        browser_admin: requirements.as_ref().and_then(|r| r.browser_use.clone()),
        user: config.computer_use.clone(),
        admin: requirements.as_ref().and_then(|r| r.computer_use.clone()),
        allow_browser_and_computer_use: requirements.and_then(|r| r.allow_browser_and_computer_use),
    })
}

fn policy_error(error: ComputerUseError) -> RuntimeCoreError {
    RuntimeCoreError::InvalidRequest(error.to_string())
}

pub(in crate::runtime) fn cancel_terminal_computer_use(
    service: &ComputerUseService,
    thread_id: &str,
    fallback_turn_id: Option<&str>,
    events: &[app_server_protocol::AgentEvent],
) {
    for event in events {
        if matches!(
            event.event_type.as_str(),
            "turn.completed" | "turn.failed" | "turn.canceled"
        ) {
            if let Some(turn_id) = event.turn_id.as_deref().or(fallback_turn_id) {
                service.cancel_turn(thread_id, turn_id);
            }
        }
    }
}
