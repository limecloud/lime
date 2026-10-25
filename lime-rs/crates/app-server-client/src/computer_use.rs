//! Typed Computer Use requests use the existing session transport.

use crate::{RequestHandle, SessionError};
pub use app_server_protocol::protocol::v2::{
    ComputerUseLeaseAcquireParams, ComputerUseLeaseAcquireResponse, ComputerUseLeaseReleaseParams,
    ComputerUseLeaseReleaseResponse, ComputerUseRevokeParams, ComputerUseRevokeResponse,
    ComputerUseSetupParams, ComputerUseSetupResponse, ComputerUseStatusParams,
    ComputerUseStatusResponse, METHOD_COMPUTER_USE_LEASE_ACQUIRE,
    METHOD_COMPUTER_USE_LEASE_RELEASE, METHOD_COMPUTER_USE_REVOKE, METHOD_COMPUTER_USE_SETUP,
    METHOD_COMPUTER_USE_STATUS,
};

impl RequestHandle {
    /// Confirm targets on this connection. No grant survives connection replacement.
    pub async fn setup_computer_use_targets(
        &self,
        targets: &[app_server_protocol::protocol::v2::ComputerUseTargetIdentity],
    ) -> Result<(), SessionError> {
        use app_server_protocol::protocol::v2::{
            ComputerUseAdapterKind, ComputerUseGrantScope, ComputerUseTargetIdentity,
        };
        for target in targets {
            let adapter = match target {
                ComputerUseTargetIdentity::Native { .. } => ComputerUseAdapterKind::Native,
                ComputerUseTargetIdentity::Chrome { .. } => ComputerUseAdapterKind::Chrome,
                ComputerUseTargetIdentity::Office { .. } => ComputerUseAdapterKind::Office,
            };
            let response = self
                .computer_use_setup(ComputerUseSetupParams {
                    adapter,
                    target: Some(target.clone()),
                    grant_scope: ComputerUseGrantScope::Session,
                })
                .await?;
            if !response.accepted
                || !response.grant.as_ref().is_some_and(|grant| {
                    grant.adapter == adapter
                        && same_target(&grant.target, target)
                        && grant.scope == ComputerUseGrantScope::Session
                })
            {
                return Err(SessionError::ComputerUseDenied);
            }
        }
        Ok(())
    }
    pub async fn computer_use_status(
        &self,
        params: ComputerUseStatusParams,
    ) -> Result<ComputerUseStatusResponse, SessionError> {
        self.request(METHOD_COMPUTER_USE_STATUS, params).await
    }
    pub async fn computer_use_setup(
        &self,
        params: ComputerUseSetupParams,
    ) -> Result<ComputerUseSetupResponse, SessionError> {
        self.request(METHOD_COMPUTER_USE_SETUP, params).await
    }
    pub async fn computer_use_revoke(
        &self,
        params: ComputerUseRevokeParams,
    ) -> Result<ComputerUseRevokeResponse, SessionError> {
        self.request(METHOD_COMPUTER_USE_REVOKE, params).await
    }
    pub async fn computer_use_lease_acquire(
        &self,
        params: ComputerUseLeaseAcquireParams,
    ) -> Result<ComputerUseLeaseAcquireResponse, SessionError> {
        self.request(METHOD_COMPUTER_USE_LEASE_ACQUIRE, params)
            .await
    }
    pub async fn computer_use_lease_release(
        &self,
        params: ComputerUseLeaseReleaseParams,
    ) -> Result<ComputerUseLeaseReleaseResponse, SessionError> {
        self.request(METHOD_COMPUTER_USE_LEASE_RELEASE, params)
            .await
    }
}

fn same_target(
    actual: &app_server_protocol::protocol::v2::ComputerUseTargetIdentity,
    requested: &app_server_protocol::protocol::v2::ComputerUseTargetIdentity,
) -> bool {
    use app_server_protocol::protocol::v2::ComputerUseTargetIdentity;
    match (actual, requested) {
        (
            ComputerUseTargetIdentity::Native {
                app_id: a,
                process_id: ap,
                window_id: aw,
                ..
            },
            ComputerUseTargetIdentity::Native {
                app_id: b,
                process_id: bp,
                window_id: bw,
                ..
            },
        ) => {
            a == b
                && ap.is_some()
                && ap == bp
                && aw.as_ref().is_some_and(|id| !id.is_empty())
                && aw == bw
        }
        (
            ComputerUseTargetIdentity::Chrome {
                origin: a,
                profile_id: ap,
                tab_id: at,
                ..
            },
            ComputerUseTargetIdentity::Chrome {
                origin: b,
                profile_id: bp,
                tab_id: bt,
                ..
            },
        ) => a == b && ap == bp && at == bt,
        (
            ComputerUseTargetIdentity::Office {
                host: a,
                workbook_id: aw,
                session_id: asid,
                ..
            },
            ComputerUseTargetIdentity::Office {
                host: b,
                workbook_id: bw,
                session_id: bsid,
                ..
            },
        ) => a == b && aw == bw && asid == bsid,
        _ => false,
    }
}
