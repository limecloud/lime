//! Lime account provider implemented by the native account owner.

use account_provider::{AccountCredential, AccountProvider, AccountProviderError, AccountSnapshot};
use app_server_protocol::protocol::v2::{CloudRequestParams, CloudRequestResponse, CloudResource};
use async_trait::async_trait;

use super::{store, AccountManager};

impl AccountManager {
    fn provider_snapshot(&self) -> Result<AccountSnapshot, AccountProviderError> {
        let state = store::load(&self.path).map_err(AccountProviderError::from_backend)?;
        Ok(AccountSnapshot {
            account: state.account,
            epoch: state.epoch,
        })
    }
}

#[async_trait]
impl AccountProvider for AccountManager {
    fn snapshot(&self) -> Result<AccountSnapshot, AccountProviderError> {
        self.provider_snapshot()
    }

    async fn credential(
        &self,
        resource: CloudResource,
        language: &str,
    ) -> Result<AccountCredential, AccountProviderError> {
        let (_epoch, _account, credential) = self
            .credential(resource, language)
            .await
            .map_err(AccountProviderError::from_backend)?;
        Ok(AccountCredential {
            access_token: credential.tokens.access_token,
            audience: credential.audience,
            scope: credential.scope,
            expires_at: credential.expires_at,
            status: credential.status,
        })
    }

    async fn request(
        &self,
        params: CloudRequestParams,
    ) -> Result<CloudRequestResponse, AccountProviderError> {
        self.request(params)
            .await
            .map_err(AccountProviderError::from_backend)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use account_provider::AccountProvider;

    #[test]
    fn provider_snapshot_reads_lime_account_store() {
        let temp = tempfile::tempdir().expect("tempdir");
        let manager = AccountManager::new(temp.path(), &temp.path().join("config.toml"));
        let snapshot = manager.snapshot().expect("snapshot");
        assert!(snapshot.account.is_none());
        assert!(!snapshot.epoch.is_empty());
    }
}
