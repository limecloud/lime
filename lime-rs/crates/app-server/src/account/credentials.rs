use super::{store, AccountManager};
use app_server_protocol::protocol::v2::{Account, CloudCredentialStatus as Status, CloudResource};

impl AccountManager {
    pub(super) async fn credential(
        &self,
        resource: CloudResource,
        language: &str,
    ) -> Result<(String, Account, store::Credential), String> {
        let snapshot = store::load(&self.path)?;
        let account = snapshot.account.ok_or("account_login_required")?;
        let Account::Cloud {
            base_url,
            issuer,
            application_id,
            client_id,
            environment,
            ..
        } = &account;
        let mut credential = snapshot
            .credentials
            .get(&resource)
            .cloned()
            .ok_or("resource_login_required")?;
        if credential.status == Status::OutcomeUnknown || credential.status == Status::Refreshing {
            return Err("outcome_unknown".into());
        }
        if credential.status == Status::Connected
            && credential.expires_at > chrono::Utc::now().timestamp() + 30
        {
            return Ok((snapshot.epoch, account, credential));
        }
        let cfg = self.get_config(base_url, language).await?;
        if cfg.issuer != *issuer
            || cfg.application_id != *application_id
            || cfg.client_id != *client_id
            || cfg.environment != *environment
            || cfg.resource(resource)?.audience != credential.audience
        {
            return Err("account_identity_mismatch".into());
        }
        if credential.status == Status::Connected {
            let refresh = credential
                .tokens
                .refresh_token
                .as_ref()
                .ok_or("resource_login_required")?
                .clone();
            store::update(&self.path, |s| {
                ensure_credential(
                    s,
                    &snapshot.epoch,
                    resource,
                    &credential.tokens.access_token,
                )?;
                if s.credentials.get(&resource).map(|c| c.status) != Some(Status::Connected) {
                    return Err("resource_refresh_pending".into());
                }
                s.credentials
                    .get_mut(&resource)
                    .ok_or("resource_login_required")?
                    .status = Status::Refreshing;
                Ok(())
            })?;
            let exchanged = self
                .exchange(
                    base_url,
                    serde_json::json!({"grantType":"refresh_token", "refreshToken":refresh}),
                    language,
                )
                .await
                .and_then(|tokens| tokens.credential(&cfg.resource(resource)?));
            let mut new = match exchanged {
                Ok(new) => new,
                Err(error) => {
                    let _ = store::update(&self.path, |s| {
                        ensure_credential(
                            s,
                            &snapshot.epoch,
                            resource,
                            &credential.tokens.access_token,
                        )?;
                        s.credentials
                            .get_mut(&resource)
                            .ok_or("resource_login_required")?
                            .status = Status::OutcomeUnknown;
                        Ok(())
                    });
                    return Err(error);
                }
            };
            // Refresh keeps the original independently approved deadline. It does
            // not grant a longer file authorization or reinterpret unsigned data.
            new.authorization_expires_at = credential.authorization_expires_at;
            store::update(&self.path, |s| {
                ensure_credential(
                    s,
                    &snapshot.epoch,
                    resource,
                    &credential.tokens.access_token,
                )?;
                if s.credentials.get(&resource).map(|c| c.status) != Some(Status::Refreshing) {
                    return Err("account_changed".into());
                }
                s.credentials.insert(resource, new.clone());
                Ok(())
            })?;
            credential = new;
        }
        // Only a GET can be repeated after the new rotating material was saved.
        let verified = self.identity(base_url, &cfg, &credential, language).await?;
        if Self::plugin_identity_for(&verified) != Self::plugin_identity_for(&account) {
            return Err("account_identity_mismatch".into());
        }
        credential.status = Status::Connected;
        store::update(&self.path, |s| {
            ensure_credential(
                s,
                &snapshot.epoch,
                resource,
                &credential.tokens.access_token,
            )?;
            s.credentials.insert(resource, credential.clone());
            Ok(())
        })?;
        Ok((snapshot.epoch, account, credential))
    }
}

pub(super) fn ensure_credential(
    state: &store::State,
    epoch: &str,
    resource: CloudResource,
    token: &str,
) -> Result<(), String> {
    if state.epoch != epoch
        || state.account.is_none()
        || state
            .credentials
            .get(&resource)
            .map(|c| c.tokens.access_token.as_str())
            != Some(token)
    {
        return Err("account_changed".into());
    }
    Ok(())
}
