//! Reusable Lime account boundary.
//!
//! Core/tool crates depend on this trait instead of upstream auth or app-server
//! internals. The production implementation remains in App Server and talks to
//! Lime Core/Cloud `/auth/*`.

use app_server_protocol::protocol::v2::{
    Account, CloudCredentialStatus, CloudRequestParams, CloudRequestResponse, CloudResource,
};
use async_trait::async_trait;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountSnapshot {
    pub account: Option<Account>,
    pub epoch: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountCredential {
    pub access_token: String,
    pub audience: String,
    pub scope: String,
    pub expires_at: i64,
    pub status: CloudCredentialStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccountProviderError {
    LoginRequired,
    ResourceLoginRequired,
    OutcomeUnknown,
    AccountChanged,
    NotAvailable(String),
}

impl AccountProviderError {
    pub fn from_backend(message: impl Into<String>) -> Self {
        let message = message.into();
        match message.as_str() {
            "account_login_required" => Self::LoginRequired,
            "resource_login_required" => Self::ResourceLoginRequired,
            "outcome_unknown" => Self::OutcomeUnknown,
            "account_changed" => Self::AccountChanged,
            _ => Self::NotAvailable(message),
        }
    }
}

#[async_trait]
pub trait AccountProvider: Send + Sync {
    fn snapshot(&self) -> Result<AccountSnapshot, AccountProviderError>;

    async fn credential(
        &self,
        resource: CloudResource,
        language: &str,
    ) -> Result<AccountCredential, AccountProviderError>;

    async fn request(
        &self,
        params: CloudRequestParams,
    ) -> Result<CloudRequestResponse, AccountProviderError>;
}

#[cfg(test)]
mod tests {
    use super::AccountProviderError;

    #[test]
    fn maps_stable_account_errors() {
        assert_eq!(
            AccountProviderError::from_backend("account_login_required"),
            AccountProviderError::LoginRequired
        );
        assert_eq!(
            AccountProviderError::from_backend("outcome_unknown"),
            AccountProviderError::OutcomeUnknown
        );
        assert_eq!(
            AccountProviderError::from_backend("account_changed"),
            AccountProviderError::AccountChanged
        );
        assert_eq!(
            AccountProviderError::from_backend("boom"),
            AccountProviderError::NotAvailable("boom".to_string())
        );
    }
}
