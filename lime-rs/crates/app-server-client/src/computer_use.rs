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
