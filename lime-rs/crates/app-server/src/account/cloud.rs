use super::{store::Credential, AccountManager};
use app_server_protocol::protocol::v2::{Account, CloudCredentialStatus, CloudResource};
use futures::StreamExt;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const PREFIX: &str = "/api/v1/client";
pub(super) const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AuthConfig {
    pub issuer: String,
    pub application_id: String,
    pub environment: String,
    pub client_id: String,
    pub redirect_uris: Vec<String>,
    pub audience: String,
    pub scope: String,
    #[serde(default)]
    pub resources: BTreeMap<CloudResource, ResourceConfig>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ResourceConfig {
    pub audience: String,
    pub scope: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Tokens {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Identity {
    issuer: String,
    application_id: String,
    client_id: String,
    environment: String,
    audience: String,
    user: User,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct User {
    id: String,
    display_name: String,
    email: String,
    email_verified: bool,
}

impl AuthConfig {
    pub fn resource(&self, resource: CloudResource) -> Result<ResourceConfig, String> {
        if resource == CloudResource::Default {
            Ok(ResourceConfig {
                audience: self.audience.clone(),
                scope: self.scope.clone(),
            })
        } else {
            self.resources
                .get(&resource)
                .cloned()
                .ok_or("resource_unavailable".into())
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        validated_base_url(&self.issuer)?;
        if !identifier(&self.application_id)
            || !identifier(&self.client_id)
            || !matches!(self.environment.as_str(), "sandbox" | "production")
            || self.redirect_uris.is_empty()
            || self.redirect_uris.len() > 20
            || self.resources.contains_key(&CloudResource::Default)
        {
            return Err("account_config_invalid".into());
        }
        let mut seen = BTreeSet::new();
        for resource in [
            CloudResource::Default,
            CloudResource::Market,
            CloudResource::Web,
            CloudResource::Connections,
        ] {
            let Ok(value) = self.resource(resource) else {
                continue;
            };
            let parts: Vec<_> = value.audience.split(':').collect();
            let scopes = scope_set(&value.scope)?;
            if parts.len() != 6
                || parts[..3] != ["urn", "lime", "api"]
                || parts[4] != self.environment
                || !identifier(parts[3])
                || !identifier(parts[5])
                || !seen.insert(value.audience)
                || !scopes.contains("openid")
                || scopes.len() < 2
            {
                return Err("account_config_invalid".into());
            }
            let required: &[&str] = match resource {
                CloudResource::Market => &["ecosystem.catalog.read", "ecosystem.acquire"],
                CloudResource::Web => &["integration.web.search", "integration.web.read"],
                CloudResource::Connections => &["integration.connections.files.read"],
                CloudResource::Default => &[],
            };
            if required.iter().any(|s| !scopes.contains(s)) {
                return Err("account_config_invalid".into());
            }
        }
        Ok(())
    }
}

pub(super) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn scope_set(value: &str) -> Result<BTreeSet<&str>, String> {
    let words: Vec<_> = value.split(' ').collect();
    let set: BTreeSet<_> = words.iter().copied().collect();
    if set.len() != words.len()
        || set.len() > 100
        || set
            .iter()
            .any(|s| s.is_empty() || s.len() > 256 || s.chars().any(char::is_control))
    {
        return Err("account_scope_invalid".into());
    }
    Ok(set)
}

impl Tokens {
    pub fn credential(self, resource: &ResourceConfig) -> Result<Credential, String> {
        let valid_token =
            |v: &str| !v.is_empty() && v.len() <= 65536 && !v.chars().any(char::is_control);
        if self.token_type != "Bearer"
            || !valid_token(&self.access_token)
            || self.expires_in <= 0
            || self.expires_in > 31_536_000
            || self.refresh_token.as_ref().is_some_and(|v| !valid_token(v))
            || self.id_token.as_ref().is_some_and(|v| !valid_token(v))
            || self
                .scope
                .as_ref()
                .is_some_and(|scope| scope_set(scope).ok() != scope_set(&resource.scope).ok())
        {
            return Err("outcome_unknown".into());
        }
        Ok(Credential {
            expires_at: chrono::Utc::now().timestamp() + self.expires_in,
            tokens: self,
            audience: resource.audience.clone(),
            scope: resource.scope.clone(),
            status: CloudCredentialStatus::VerificationRequired,
        })
    }
}

impl AccountManager {
    pub(super) async fn get_config(
        &self,
        base_url: &str,
        language: &str,
    ) -> Result<AuthConfig, String> {
        let cfg: AuthConfig = self.get(base_url, "/auth/config", None, language).await?;
        cfg.validate()?;
        Ok(cfg)
    }

    pub(super) async fn get<T: DeserializeOwned>(
        &self,
        base: &str,
        path: &str,
        token: Option<&str>,
        language: &str,
    ) -> Result<T, String> {
        let mut request = self
            .http(base)?
            .get(format!("{base}{PREFIX}{path}"))
            .header("Accept-Language", language);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.map_err(|_| "cloud_unavailable")?;
        if response.status().as_u16() != 200 {
            return Err(if matches!(response.status().as_u16(), 401 | 403) {
                "authorization_rejected"
            } else {
                "cloud_unavailable"
            }
            .into());
        }
        serde_json::from_slice(&response_bytes(response).await?)
            .map_err(|_| "cloud_response_invalid".into())
    }

    pub(super) async fn exchange(
        &self,
        base: &str,
        input: serde_json::Value,
        language: &str,
    ) -> Result<Tokens, String> {
        let response = self
            .http(base)?
            .post(format!("{base}{PREFIX}/auth/token"))
            .header("Accept-Language", language)
            .json(&input)
            .send()
            .await
            .map_err(|_| "outcome_unknown")?;
        let status = response.status().as_u16();
        if status != 200 {
            return Err(if matches!(status, 400 | 401 | 403) {
                "authorization_rejected"
            } else {
                "outcome_unknown"
            }
            .into());
        }
        let bytes = response_bytes(response)
            .await
            .map_err(|_| "outcome_unknown")?;
        serde_json::from_slice(&bytes).map_err(|_| "outcome_unknown".into())
    }

    pub(super) async fn identity(
        &self,
        base: &str,
        cfg: &AuthConfig,
        credential: &Credential,
        language: &str,
    ) -> Result<Account, String> {
        let identity: Identity = self
            .get(
                base,
                "/account",
                Some(&credential.tokens.access_token),
                language,
            )
            .await?;
        if identity.issuer != cfg.issuer
            || identity.application_id != cfg.application_id
            || identity.client_id != cfg.client_id
            || identity.environment != cfg.environment
            || identity.audience != credential.audience
            || identity.user.id.is_empty()
            || identity.user.id.len() > 512
        {
            return Err("account_identity_mismatch".into());
        }
        let _ = identity.user.email_verified;
        Ok(Account::Cloud {
            base_url: base.into(),
            issuer: cfg.issuer.clone(),
            application_id: cfg.application_id.clone(),
            client_id: cfg.client_id.clone(),
            environment: cfg.environment.clone(),
            user_id: identity.user.id,
            email: identity.user.email,
            display_name: identity.user.display_name,
            generation: String::new(),
            resources: vec![],
        })
    }

    pub(super) async fn verify_id_token(
        &self,
        base: &str,
        cfg: &AuthConfig,
        tokens: &Tokens,
        nonce: &str,
        account: &Account,
        language: &str,
    ) -> Result<(), String> {
        use jsonwebtoken::{
            decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation,
        };
        #[derive(Deserialize)]
        struct Claims {
            sub: String,
            nonce: String,
            iat: i64,
            aud: String,
        }
        let token = tokens.id_token.as_deref().ok_or("id_token_invalid")?;
        let header = decode_header(token).map_err(|_| "id_token_invalid")?;
        if header.alg != Algorithm::RS256 {
            return Err("id_token_invalid".into());
        }
        let kid = header.kid.ok_or("id_token_invalid")?;
        let keys: JwkSet = self.get(base, "/auth/keys", None, language).await?;
        let matches: Vec<_> = keys
            .keys
            .iter()
            .filter(|k| k.common.key_id.as_deref() == Some(&kid))
            .collect();
        if matches.len() != 1 {
            return Err("id_token_invalid".into());
        }
        let key = DecodingKey::from_jwk(matches[0]).map_err(|_| "id_token_invalid")?;
        let mut policy = Validation::new(Algorithm::RS256);
        policy.set_issuer(&[&cfg.issuer]);
        policy.set_audience(&[&cfg.client_id]);
        policy.set_required_spec_claims(&["iss", "sub", "aud", "exp", "iat", "nonce"]);
        policy.leeway = 30;
        let claims = decode::<Claims>(token, &key, &policy)
            .map_err(|_| "id_token_invalid")?
            .claims;
        let Account::Cloud { user_id, .. } = account;
        if claims.sub != *user_id
            || claims.nonce != nonce
            || claims.aud != cfg.client_id
            || claims.iat > chrono::Utc::now().timestamp() + 30
        {
            return Err("id_token_invalid".into());
        }
        Ok(())
    }
}

pub(super) async fn response_bytes(response: reqwest::Response) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "cloud_unavailable")?;
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("cloud_response_invalid".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(super) fn validated_base_url(value: &str) -> Result<(reqwest::Url, bool), String> {
    let base = reqwest::Url::parse(value).map_err(|_| "account_origin_invalid")?;
    let loopback = base.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if !(base.scheme() == "https" || base.scheme() == "http" && loopback)
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
        || base.path() != "/"
        || base.cannot_be_a_base()
        || base.origin().ascii_serialization() != value.trim_end_matches('/')
    {
        return Err("account_origin_invalid".into());
    }
    Ok((base, loopback))
}
