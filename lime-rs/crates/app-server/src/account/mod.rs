mod billing;
mod cloud;
mod config;
mod continuation;
mod credentials;
mod oauth;
mod operations;
mod product;
mod recovery;
mod request;
mod store;
mod tools;

pub(crate) use config::configured_language;

#[cfg(test)]
mod tests;

use app_server_protocol::protocol::v2::{
    Account, AccountAuthorizationStatus, CloudCredentialStatus, CloudResourceCredential,
    GetAccountParams, GetAccountResponse, LogoutAccountResponse,
};
use std::path::{Path, PathBuf};

/// One native account owner shared by Desktop, CLI and TUI. RPC only returns metadata.
#[derive(Debug, Clone)]
pub(crate) struct AccountManager {
    path: PathBuf,
    config_path: PathBuf,
    client: reqwest::Client,
    loopback_client: reqwest::Client,
    host_requests: std::sync::OnceLock<crate::host_request::HostRequestRouter>,
}

impl AccountManager {
    pub(crate) fn set_host_requests(&self, host: crate::host_request::HostRequestRouter) {
        let _ = self.host_requests.set(host);
    }

    pub(crate) fn new(app_data_root: &Path, config_path: &Path) -> Self {
        Self {
            path: app_data_root.join("credentials").join("account.json"),
            config_path: config_path.to_path_buf(),
            client: session_client(false),
            loopback_client: session_client(true),
            host_requests: Default::default(),
        }
    }

    pub(crate) fn read(&self, _params: GetAccountParams) -> Result<GetAccountResponse, String> {
        let state = store::load(&self.path)?;
        let (service_url, service_error) = match self.service_url(&state) {
            Ok(url) => (url, None),
            Err(error) => (None, Some(error)),
        };
        let now = chrono::Utc::now().timestamp();
        let account = state.account.map(|mut account| {
            let Account::Cloud { resources, .. } = &mut account;
            *resources = state
                .credentials
                .iter()
                .map(|(resource, credential)| CloudResourceCredential {
                    resource: *resource,
                    audience: credential.audience.clone(),
                    scope: credential.scope.clone(),
                    expires_at: timestamp(credential.expires_at),
                    status: if credential.status == CloudCredentialStatus::Connected
                        && credential.expires_at <= now
                    {
                        CloudCredentialStatus::Expired
                    } else {
                        credential.status
                    },
                })
                .collect();
            account
        });
        let authorizations = state
            .authorizations
            .into_values()
            .map(|a| {
                let mut public = a.public;
                if chrono::DateTime::parse_from_rfc3339(&public.expires_at)
                    .is_ok_and(|at| at.timestamp() <= now)
                {
                    public.status = match public.status {
                        AccountAuthorizationStatus::Pending => AccountAuthorizationStatus::Expired,
                        AccountAuthorizationStatus::Exchanging => {
                            AccountAuthorizationStatus::OutcomeUnknown
                        }
                        other => other,
                    };
                }
                public
            })
            .collect();
        Ok(GetAccountResponse {
            service_url,
            service_error,
            account,
            authorizations,
        })
    }

    fn service_url(&self, state: &store::State) -> Result<Option<String>, String> {
        if let Some(Account::Cloud { base_url, .. }) = &state.account {
            return Ok(Some(base_url.clone()));
        }
        if let Some(authorization) = state.authorizations.get(&Default::default()) {
            if matches!(
                authorization.public.status,
                AccountAuthorizationStatus::Pending
                    | AccountAuthorizationStatus::Exchanging
                    | AccountAuthorizationStatus::OutcomeUnknown
            ) {
                return Ok(Some(authorization.base_url.clone()));
            }
        }
        lime_core::config::ConfigManager::load(&self.config_path)
            .map(|manager| manager.config().cloud.base_url.clone())
            .map_err(|_| "account_config_invalid".into())
    }

    pub(crate) fn set_config_path(&mut self, path: PathBuf) {
        self.config_path = path;
    }

    pub(crate) fn logout(&self) -> Result<LogoutAccountResponse, String> {
        // Epoch replacement fences every in-flight callback and business result.
        // Local logout does not claim that the issuer's sessions were terminated.
        store::reset(&self.path)?;
        Ok(LogoutAccountResponse {})
    }

    pub(crate) fn plugin_identity(&self) -> Result<Option<String>, String> {
        Ok(self
            .read(GetAccountParams::default())?
            .account
            .as_ref()
            .map(Self::plugin_identity_for))
    }

    pub(crate) fn plugin_identity_for(account: &Account) -> String {
        use sha2::{Digest, Sha256};
        let Account::Cloud {
            base_url,
            issuer,
            application_id,
            client_id,
            environment,
            user_id,
            ..
        } = account;
        let mut hash = Sha256::new();
        for part in [
            base_url,
            issuer,
            application_id,
            client_id,
            environment,
            user_id,
        ] {
            hash.update((part.len() as u64).to_be_bytes());
            hash.update(part.as_bytes());
        }
        hex::encode(hash.finalize())
    }

    fn http(&self, base_url: &str) -> Result<&reqwest::Client, String> {
        let (_, loopback) = cloud::validated_base_url(base_url)?;
        Ok(if loopback {
            &self.loopback_client
        } else {
            &self.client
        })
    }
}

fn timestamp(seconds: i64) -> String {
    chrono::DateTime::from_timestamp(seconds, 0)
        .unwrap_or_default()
        .to_rfc3339()
}

fn session_client(loopback: bool) -> reqwest::Client {
    let builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(35));
    let builder = if loopback {
        builder.no_proxy()
    } else {
        builder
    };
    builder.build().expect("account HTTP client configuration")
}
