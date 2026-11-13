use super::{cloud, store, timestamp, AccountManager};
use app_server_protocol::protocol::v2::{
    Account, AccountAuthorization, AccountAuthorizationStatus as Status, CloudCredentialStatus,
    CloudResource, LoginAccountParams, LoginAccountResponse,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

mod callback;

const AUTHORIZATION_SECONDS: i64 = 600;

fn ensure_authorization_idle(state: &store::State, resource: CloudResource) -> Result<(), String> {
    if let Some(authorization) = state.authorizations.get(&resource) {
        match authorization.public.status {
            Status::Exchanging | Status::OutcomeUnknown => return Err("outcome_unknown".into()),
            Status::Pending => {
                let expired =
                    chrono::DateTime::parse_from_rfc3339(&authorization.public.expires_at)
                        .is_ok_and(|at| at.timestamp() <= chrono::Utc::now().timestamp());
                if !expired {
                    return Err("authorization_in_progress".into());
                }
            }
            _ => {}
        }
    }
    Ok(())
}

impl AccountManager {
    pub(crate) async fn login(
        &self,
        params: LoginAccountParams,
    ) -> Result<LoginAccountResponse, String> {
        self.login_bound(params, None).await
    }

    pub(super) async fn login_bound(
        &self,
        params: LoginAccountParams,
        binding: Option<(&str, &str, &str)>,
    ) -> Result<LoginAccountResponse, String> {
        let LoginAccountParams::Cloud {
            resource,
            language,
            installation,
        } = params;
        validate_language(&language)?;
        let snapshot = store::update(&self.path, |state| {
            ensure_authorization_idle(state, resource)?;
            let service_url = self
                .service_url(state)?
                .ok_or("account_service_unconfigured")?;
            if binding.is_some_and(|(epoch, origin, id)| {
                state.epoch != epoch
                    || service_url != origin
                    || state
                        .tool_login
                        .as_ref()
                        .is_none_or(|claim| claim.id != id || claim.base_url != origin)
            }) {
                return Err("account_changed".into());
            }
            Ok((state.epoch.clone(), state.account.clone(), service_url))
        })?;
        let base_url = snapshot.2;
        let config = self.get_config(&base_url, &language).await?;
        config.resource(resource)?;
        if resource == CloudResource::Connections && config.environment == "production" {
            if !installation.as_ref().is_some_and(|i| {
                cloud::identifier(&i.installation_id) && cloud::identifier(&i.space_id)
            }) {
                return Err("connection_installation_required".into());
            }
        } else if installation.is_some() {
            return Err("connection_installation_invalid".into());
        }
        if resource != CloudResource::Default {
            let account = snapshot.1.as_ref().ok_or("account_login_required")?;
            let Account::Cloud {
                base_url: current_base,
                issuer,
                application_id,
                client_id,
                environment,
                ..
            } = account;
            if current_base != &base_url
                || issuer != &config.issuer
                || application_id != &config.application_id
                || client_id != &config.client_id
                || environment != &config.environment
            {
                return Err("account_identity_mismatch".into());
            }
        }
        let id = binding
            .map(|(_, _, id)| id.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let lease = callback::claim(&self.path, &id)?.ok_or("account_store_busy")?;
        let (listener, redirect_uri) = callback_listener(&config.redirect_uris).await?;
        let state = random();
        let nonce = random();
        let verifier = random();
        let public = AccountAuthorization {
            id: id.clone(),
            resource,
            status: Status::Pending,
            expires_at: timestamp(chrono::Utc::now().timestamp() + AUTHORIZATION_SECONDS),
        };
        let authorization = store::update(&self.path, |current| {
            // Reload under the file lock: a different process may have logged out
            // while configuration or the registered listener was being prepared.
            if current.epoch != snapshot.0 {
                return Err("account_changed".into());
            }
            if binding.is_some_and(|(_, origin, id)| {
                current
                    .tool_login
                    .as_ref()
                    .is_none_or(|claim| claim.id != id || claim.base_url != origin)
            }) {
                return Err("account_changed".into());
            }
            ensure_authorization_idle(current, resource)?;
            if resource != CloudResource::Default && current.account != snapshot.1 {
                return Err("account_changed".into());
            }
            let value = store::Authorization {
                public: public.clone(),
                base_url: base_url.clone(),
                config,
                parent_epoch: current.epoch.clone(),
                expected_identity: current.account.as_ref().map(Self::plugin_identity_for),
                state,
                nonce,
                verifier,
                redirect_uri,
                language,
                staged: None,
            };
            current.authorizations.insert(resource, value.clone());
            Ok(value)
        })?;
        let auth_url = authorization_url(&authorization, installation.as_ref())?;
        self.start_callback(listener, authorization, lease);
        Ok(LoginAccountResponse::Cloud {
            authorization: public,
            auth_url,
        })
    }

    async fn complete(
        &self,
        authorization: &store::Authorization,
        code: &str,
    ) -> Result<(), String> {
        let resource = authorization.public.resource;
        store::update(&self.path, |s| {
            ensure_current(s, authorization)?;
            if callback::remaining(authorization).is_none() {
                return Err("authorization_expired".into());
            }
            let current = s
                .authorizations
                .get_mut(&resource)
                .ok_or("account_changed")?;
            if current.public.status != Status::Pending {
                return Err("authorization_consumed".into());
            }
            current.public.status = Status::Exchanging;
            Ok(())
        })?;
        // Exchanging is durable before the one permitted code submission.
        let tokens = self
            .exchange(
                &authorization.base_url,
                serde_json::json!({"grantType":"authorization_code", "code":code,
            "redirectUri":authorization.redirect_uri, "codeVerifier":authorization.verifier}),
                &authorization.language,
            )
            .await?;
        let credential = tokens.credential(&authorization.config.resource(resource)?)?;
        store::update(&self.path, |s| {
            ensure_current(s, authorization)?;
            s.authorizations
                .get_mut(&resource)
                .ok_or("account_changed")?
                .staged = Some(credential.clone());
            Ok(())
        })?;
        self.verify_authorization(authorization, credential).await
    }

    pub(crate) async fn read_verified(
        &self,
        params: app_server_protocol::protocol::v2::GetAccountParams,
    ) -> Result<app_server_protocol::protocol::v2::GetAccountResponse, String> {
        self.resume_callbacks(params.authorization_id.as_deref())
            .await?;
        if let Some(id) = &params.authorization_id {
            // The live callback owns this same lease through token verification.
            // Reload after acquiring it so a late reader cannot verify an old
            // staged snapshot after the original process has published it.
            if let Some(_lease) = callback::claim(&self.path, id)? {
                let state = store::load(&self.path)?;
                let authorization = state
                    .authorizations
                    .values()
                    .find(|a| &a.public.id == id)
                    .ok_or("authorization_not_found")?;
                if let Some(credential) = &authorization.staged {
                    // Recovery only verifies the saved result. The code and refresh
                    // token are never resubmitted, including after process restart.
                    self.verify_authorization(authorization, credential.clone())
                        .await?;
                }
            }
        }
        self.read(Default::default())
    }

    async fn verify_authorization(
        &self,
        authorization: &store::Authorization,
        mut credential: store::Credential,
    ) -> Result<(), String> {
        ensure_current(&store::load(&self.path)?, authorization)?;
        let resource = authorization.public.resource;
        // Keep newly rotated material before any subsequent verification I/O.
        let mut account = self
            .identity(
                &authorization.base_url,
                &authorization.config,
                &credential,
                &authorization.language,
            )
            .await?;
        credential.authorization_expires_at = self
            .verify_id_token(
                &authorization.base_url,
                &authorization.config,
                resource,
                &credential.tokens,
                &authorization.nonce,
                &account,
                &authorization.language,
            )
            .await?;
        let identity = Self::plugin_identity_for(&account);
        if resource != CloudResource::Default
            && authorization.expected_identity.as_deref() != Some(&identity)
        {
            return Err("account_identity_mismatch".into());
        }
        credential.status = CloudCredentialStatus::Connected;
        store::update(&self.path, |s| {
            ensure_current(s, authorization)?;
            if s.account.as_ref().map(Self::plugin_identity_for).as_deref() != Some(&identity) {
                if resource != CloudResource::Default {
                    return Err("account_identity_mismatch".into());
                }
                s.epoch = uuid::Uuid::new_v4().to_string();
                s.credentials.clear();
                s.authorizations.retain(|key, _| *key == resource);
            }
            let Account::Cloud { generation, .. } = &mut account;
            *generation = s.epoch.clone();
            s.account = Some(account);
            s.credentials.insert(resource, credential);
            let current = s
                .authorizations
                .get_mut(&resource)
                .ok_or("account_changed")?;
            current.public.status = Status::Completed;
            current.staged = None;
            current.verifier.clear();
            current.state.clear();
            current.nonce.clear();
            Ok(())
        })?;
        Ok(())
    }

    fn authorization_failed(&self, authorization: &store::Authorization, status: Status) {
        let _ = store::update(&self.path, |s| {
            ensure_current(s, authorization)?;
            let current = s
                .authorizations
                .get_mut(&authorization.public.resource)
                .ok_or("account_changed")?;
            if current.public.status == Status::Completed {
                return Ok(());
            }
            current.public.status = status;
            // A staged token is retained privately; it is never usable as an
            // account credential, nor is its code submitted a second time.
            current.verifier.clear();
            current.state.clear();
            if current.staged.is_none() {
                current.nonce.clear();
            }
            Ok(())
        });
    }
}

pub(super) fn authorization_url(
    authorization: &store::Authorization,
    installation: Option<&app_server_protocol::protocol::v2::ConnectionInstallation>,
) -> Result<String, String> {
    let base_url = &authorization.base_url;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(authorization.verifier.as_bytes()));
    let mut authorization_url =
        reqwest::Url::parse(&format!("{base_url}{}/auth/authorize", cloud::PREFIX))
            .map_err(|_| "account_origin_invalid")?;
    let mut query = authorization_url.query_pairs_mut();
    query
        .append_pair("redirect_uri", &authorization.redirect_uri)
        .append_pair("code_challenge", &challenge)
        .append_pair("state", &authorization.state)
        .append_pair("nonce", &authorization.nonce);
    match authorization.public.resource {
        CloudResource::Default => {}
        CloudResource::Market => {
            query.append_pair("resource", "market");
        }
        CloudResource::Web => {
            query.append_pair("resource", "web");
        }
        CloudResource::Connections => {
            query.append_pair("resource", "connections");
        }
    }
    if let Some(installation) = installation {
        query
            .append_pair("installation_id", &installation.installation_id)
            .append_pair("space_id", &installation.space_id);
    }
    drop(query);
    Ok(authorization_url.to_string())
}

fn ensure_current(
    state: &store::State,
    authorization: &store::Authorization,
) -> Result<(), String> {
    if state.epoch != authorization.parent_epoch
        || state
            .authorizations
            .get(&authorization.public.resource)
            .map(|a| &a.public.id)
            != Some(&authorization.public.id)
    {
        return Err("account_changed".into());
    }
    Ok(())
}

pub(super) fn validate_language(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 35
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("language_invalid".into());
    }
    Ok(())
}

fn random() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

async fn callback_listener(redirects: &[String]) -> Result<(TcpListener, String), String> {
    for uri in redirects {
        let Ok(url) = reqwest::Url::parse(uri) else {
            continue;
        };
        let Some(host) = url.host_str() else {
            continue;
        };
        let Ok(ip) = host.trim_matches(['[', ']']).parse::<std::net::IpAddr>() else {
            continue;
        };
        let Some(port) = url.port() else {
            continue;
        };
        if url.scheme() != "http"
            || !ip.is_loopback()
            || port == 0
            || url.path() == "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            continue;
        }
        if let Ok(listener) = TcpListener::bind(std::net::SocketAddr::new(ip, port)).await {
            return Ok((listener, uri.clone()));
        }
    }
    Err("account_callback_unavailable".into())
}

async fn receive_callback(
    listener: TcpListener,
    authorization: &store::Authorization,
) -> Result<Option<String>, String> {
    let target =
        reqwest::Url::parse(&authorization.redirect_uri).map_err(|_| "callback_invalid")?;
    for _ in 0..64 {
        let (mut socket, peer) = listener
            .accept()
            .await
            .map_err(|_| "callback_unavailable")?;
        if !peer.ip().is_loopback() {
            continue;
        }
        let mut request = Vec::new();
        let read = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while request.len() < 16 * 1024 && !request.windows(4).any(|w| w == b"\r\n\r\n") {
                let mut bytes = [0; 1024];
                let n = socket.read(&mut bytes).await?;
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&bytes[..n]);
            }
            Ok::<_, std::io::Error>(())
        })
        .await;
        if !matches!(read, Ok(Ok(()))) {
            continue;
        }
        let parsed = parse_callback(&request, &target, authorization);
        let response = if parsed.is_some() {
            "HTTP/1.1 204 No Content\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n"
        } else {
            "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        };
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            socket.write_all(response.as_bytes()),
        )
        .await;
        if let Some(result) = parsed {
            return Ok(result);
        }
    }
    Err("callback_unavailable".into())
}

fn parse_callback(
    request: &[u8],
    target: &reqwest::Url,
    authorization: &store::Authorization,
) -> Option<Option<String>> {
    let text = std::str::from_utf8(request).ok()?;
    if !text.ends_with("\r\n\r\n") {
        return None;
    }
    let mut lines = text.split("\r\n");
    let first: Vec<_> = lines.next()?.split(' ').collect();
    if first.len() != 3
        || first[0] != "GET"
        || first[2] != "HTTP/1.1"
        || !first[1].starts_with('/')
        || first[1].starts_with("//")
    {
        return None;
    }
    if first[1].split('?').next()? != target.path() {
        return None;
    }
    let hosts: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("host"))
        .map(|(_, value)| value.trim())
        .collect();
    let host = &target[url::Position::BeforeHost..url::Position::AfterPort];
    if hosts != [host] {
        return None;
    }
    let url = target.join(first[1]).ok()?;
    if url.origin() != target.origin() || url.path() != target.path() || url.fragment().is_some() {
        return None;
    }
    let mut values = std::collections::BTreeMap::new();
    for (key, value) in url.query_pairs() {
        if !matches!(
            key.as_ref(),
            "state" | "code" | "error" | "error_description" | "iss" | "scope"
        ) || values.insert(key.to_string(), value.to_string()).is_some()
        {
            return None;
        }
    }
    if values.get("state") != Some(&authorization.state)
        || values
            .get("iss")
            .is_some_and(|s| s != &authorization.config.issuer)
    {
        return None;
    }
    if values.contains_key("error") {
        return if values.contains_key("code") {
            None
        } else {
            Some(None)
        };
    }
    let code = values.remove("code")?;
    if code.is_empty() || code.len() > 8192 || code.chars().any(char::is_control) {
        return None;
    }
    Some(Some(code))
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn authorization() -> store::Authorization {
        store::Authorization {
            public: AccountAuthorization {
                id: "auth-test".into(),
                resource: CloudResource::Default,
                status: Status::Pending,
                expires_at: timestamp(chrono::Utc::now().timestamp() + 600),
            },
            base_url: "https://core.test".into(),
            config: cloud::AuthConfig {
                issuer: "https://cloud.test".into(),
                application_id: "app".into(),
                environment: "sandbox".into(),
                client_id: "native".into(),
                redirect_uris: vec![],
                audience: "urn:lime:api:app:sandbox:default".into(),
                scope: "openid profile".into(),
                resources: Default::default(),
            },
            parent_epoch: "epoch".into(),
            expected_identity: None,
            state: "original-state".into(),
            nonce: "nonce".into(),
            verifier: "verifier".into(),
            redirect_uri: "http://127.0.0.1:43123/oauth/callback".into(),
            language: "zh-CN".into(),
            staged: None,
        }
    }

    #[test]
    fn callback_requires_exact_host_path_state_and_single_code() {
        let a = authorization();
        let target = reqwest::Url::parse(&a.redirect_uri).unwrap();
        let request =
            |path: &str, host: &str| format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n");
        let valid = "/oauth/callback?state=original-state&code=once&iss=https%3A%2F%2Fcloud.test";
        assert_eq!(
            parse_callback(request(valid, "127.0.0.1:43123").as_bytes(), &target, &a),
            Some(Some("once".into()))
        );
        for path in [
            "/oauth/callback?state=wrong&code=once",
            "/oauth/callback?state=original-state&code=one&code=two",
            "/other?state=original-state&code=once",
            "/oauth/callback?state=original-state&code=once&iss=https%3A%2F%2Fevil.test",
            "/oauth/callback?state=original-state&code=once&error=denied",
            "//evil.test/oauth/callback?state=original-state&code=once",
            "/oauth/callback?state=original-state&code=once&token=private",
        ] {
            assert!(
                parse_callback(request(path, "127.0.0.1:43123").as_bytes(), &target, &a).is_none()
            );
        }
        assert!(
            parse_callback(request(valid, "localhost:43123").as_bytes(), &target, &a).is_none()
        );
        assert!(parse_callback(
            format!(
                "GET {valid} HTTP/1.1\r\nHost: 127.0.0.1:43123\r\nHost: 127.0.0.1:43123\r\n\r\n"
            )
            .as_bytes(),
            &target,
            &a
        )
        .is_none());
        assert_eq!(
            parse_callback(
                request(
                    "/oauth/callback?state=original-state&error=access_denied",
                    "127.0.0.1:43123"
                )
                .as_bytes(),
                &target,
                &a
            ),
            Some(None)
        );
    }

    #[tokio::test]
    async fn listener_only_binds_registered_numeric_loopback_callbacks() {
        for uri in [
            "http://localhost:43123/oauth/callback",
            "https://127.0.0.1:43123/oauth/callback",
            "http://0.0.0.0:43123/oauth/callback",
            "http://127.0.0.1:0/oauth/callback",
            "http://127.0.0.1:43123/",
            "http://127.0.0.1:43123/oauth/callback?state=constant",
        ] {
            assert!(callback_listener(&[uri.into()]).await.is_err());
        }
        let reserved = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = reserved.local_addr().unwrap();
        drop(reserved);
        let uri = format!("http://{address}/oauth/callback");
        let (listener, registered) = callback_listener(&[uri.clone()]).await.unwrap();
        assert_eq!(listener.local_addr().unwrap(), address);
        assert_eq!(registered, uri);
    }
}
