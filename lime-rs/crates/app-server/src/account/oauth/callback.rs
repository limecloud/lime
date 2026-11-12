use super::*;
use std::{fs::File, path::Path, time::Duration};

pub(super) fn claim(path: &Path, id: &str) -> Result<Option<File>, String> {
    // The OS releases this lease on process exit. A persisted pending record
    // alone never proves that a Desktop or CLI still owns its callback socket.
    let key = hex::encode(Sha256::digest(id.as_bytes()));
    store::try_lock(&path.with_file_name(format!("oauth-callback-{key}.lock")))
}

impl AccountManager {
    pub(super) async fn resume_callbacks(&self, selected: Option<&str>) -> Result<(), String> {
        let state = store::load(&self.path)?;
        if selected.is_some_and(|id| !state.authorizations.values().any(|a| a.public.id == id)) {
            return Err("authorization_not_found".into());
        }
        for authorization in state.authorizations.into_values() {
            if selected.is_some_and(|id| id != authorization.public.id)
                || authorization.public.status != Status::Pending
            {
                continue;
            }
            let Some(lease) = claim(&self.path, &authorization.public.id)? else {
                // The original process still owns the listener. Never bind an
                // alternative port or start a second authorization transaction.
                continue;
            };
            let current = store::load(&self.path)?;
            ensure_current(&current, &authorization)?;
            if current.authorizations[&authorization.public.resource]
                .public
                .status
                != Status::Pending
            {
                continue;
            }
            if remaining(&authorization).is_none() {
                self.authorization_failed(&authorization, Status::Expired);
                continue;
            }
            if authorization.state.is_empty()
                || authorization.nonce.is_empty()
                || authorization.verifier.is_empty()
                || !authorization
                    .config
                    .redirect_uris
                    .contains(&authorization.redirect_uri)
                || authorization.staged.is_some()
            {
                return Err("account_store_invalid".into());
            }
            // Only the exact redirect registered for the original transaction
            // can receive its original state and PKCE result after a restart.
            let (listener, _) = callback_listener(&[authorization.redirect_uri.clone()]).await?;
            self.start_callback(listener, authorization, lease);
        }
        Ok(())
    }

    pub(super) fn start_callback(
        &self,
        listener: TcpListener,
        authorization: store::Authorization,
        lease: File,
    ) -> tokio::task::JoinHandle<()> {
        let manager = self.clone();
        tokio::spawn(async move {
            let _lease = lease;
            let Some(duration) = remaining(&authorization) else {
                manager.authorization_failed(&authorization, Status::Expired);
                return;
            };
            let callback =
                tokio::time::timeout(duration, receive_callback(listener, &authorization));
            tokio::pin!(callback);
            let result = loop {
                tokio::select! {
                    result = &mut callback => break result,
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {
                        // Logout, cancellation or a new account fences the old
                        // transaction and promptly releases its callback port.
                        let active = store::load(&manager.path).is_ok_and(|state| {
                            ensure_current(&state, &authorization).is_ok()
                                && state.authorizations[&authorization.public.resource].public.status
                                    == Status::Pending
                        });
                        if !active {
                            return;
                        }
                    }
                }
            };
            match result {
                Ok(Ok(Some(code))) => {
                    if let Err(error) = manager.complete(&authorization, &code).await {
                        manager.authorization_failed(
                            &authorization,
                            match error.as_str() {
                                "authorization_rejected" => Status::Denied,
                                "authorization_expired" => Status::Expired,
                                _ => Status::OutcomeUnknown,
                            },
                        );
                    }
                }
                Ok(Ok(None)) => manager.authorization_failed(&authorization, Status::Denied),
                Ok(Err(_)) => manager.authorization_failed(&authorization, Status::Failed),
                Err(_) => manager.authorization_failed(&authorization, Status::Expired),
            }
        })
    }
}

pub(super) fn remaining(authorization: &store::Authorization) -> Option<Duration> {
    let deadline = chrono::DateTime::parse_from_rfc3339(&authorization.public.expires_at).ok()?;
    (deadline.with_timezone(&chrono::Utc) - chrono::Utc::now())
        .to_std()
        .ok()
        .filter(|duration| !duration.is_zero())
}

#[cfg(test)]
mod tests;
