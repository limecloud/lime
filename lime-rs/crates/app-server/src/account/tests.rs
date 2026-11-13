use super::*;
#[path = "config_tests.rs"]
mod config_tests;
#[path = "recovery_tests.rs"]
mod recovery_tests;
#[path = "request_tests.rs"]
mod request_tests;
#[path = "tools/tests.rs"]
mod tool_tests;
use app_server_protocol::protocol::v2::{
    CloudRequestMethod, CloudRequestParams, CloudResource, LoginAccountParams, LoginAccountResponse,
};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[test]
fn oauth_bearer_token_type_is_case_insensitive_and_rejects_other_schemes() {
    let resource = cloud::ResourceConfig {
        audience: "urn:lime:api:app:sandbox:default".into(),
        scope: "openid profile".into(),
    };
    for (scheme, accepted) in [
        ("bearer", true),
        ("Bearer", true),
        ("BEARER", true),
        ("bEaReR", true),
        ("Basic", false),
        ("", false),
        (" Bearer", false),
        ("Bearer ", false),
    ] {
        let tokens: cloud::Tokens = serde_json::from_value(json!({
            "access_token":"isolated-test-token", "token_type":scheme,
            "expires_in":3600, "scope":"openid profile"
        }))
        .unwrap();
        assert_eq!(
            tokens.credential(&resource).is_ok(),
            accepted,
            "scheme {scheme:?}"
        );
    }
}

struct Fixture {
    base: String,
    state: Arc<Mutex<FixtureState>>,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Default)]
struct FixtureState {
    nonce: String,
    callback: String,
    resource: String,
    challenge: String,
    user: String,
    reject_identity: bool,
    invalid_nonce: bool,
    id_audience: Option<Value>,
    id_authorized_party: Option<Value>,
    fail_refresh: bool,
    invalid_post: bool,
    web_response: Option<Value>,
    web_prices: Option<(u16, Value)>,
    web_rejection: Option<(u16, Value)>,
    web_operation_missing: bool,
    web_operation_invalid: bool,
    connection_request: Option<Value>,
    connection_claims: Option<Value>,
    connection_file: Option<Value>,
    connection_prices: Option<(u16, Value)>,
    connection_rejection: Option<(u16, Value)>,
    connection_request_unknown: bool,
    connection_read_unknown: bool,
    connection_read_missing: bool,
    product_registered: bool,
    product_disabled: bool,
    summary_response: Option<(u16, Value)>,
    summary_delay: bool,
    disable_product_on_result: bool,
    registration_unknown: bool,
    registration_delay: bool,
    calls: Vec<(String, Value, String)>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Fixture {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let callback_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let callback = format!(
            "http://{}/oauth/callback",
            callback_listener.local_addr().unwrap()
        );
        drop(callback_listener);
        let base = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(FixtureState {
            callback,
            resource: "default".into(),
            user: "person-a".into(),
            ..Default::default()
        }));
        let shared = state.clone();
        let origin = base.clone();
        let task = tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let state = shared.clone();
                let base = origin.clone();
                tokio::spawn(async move {
                    let mut bytes = Vec::new();
                    let mut header_len = None;
                    let mut body_len = 0;
                    loop {
                        let mut block = [0; 4096];
                        let n = socket.read(&mut block).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        bytes.extend_from_slice(&block[..n]);
                        assert!(bytes.len() < 256 * 1024);
                        if header_len.is_none() {
                            if let Some(at) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                                header_len = Some(at + 4);
                                let text = std::str::from_utf8(&bytes[..at]).unwrap();
                                body_len = text
                                    .lines()
                                    .filter_map(|l| l.split_once(':'))
                                    .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                                    .map(|(_, v)| v.trim().parse().unwrap())
                                    .unwrap_or(0);
                            }
                        }
                        if header_len.is_some_and(|at| bytes.len() >= at + body_len) {
                            break;
                        }
                    }
                    let at = header_len.unwrap();
                    let headers = std::str::from_utf8(&bytes[..at]).unwrap();
                    let path = headers.split_whitespace().nth(1).unwrap().to_string();
                    let bearer = headers
                        .lines()
                        .filter_map(|l| l.split_once(':'))
                        .find(|(k, _)| k.eq_ignore_ascii_case("authorization"))
                        .map(|(_, v)| v.trim().to_string())
                        .unwrap_or_default();
                    let input: Value = if body_len == 0 {
                        Value::Null
                    } else {
                        serde_json::from_slice(&bytes[at..at + body_len]).unwrap()
                    };
                    let delayed_registration = path.ends_with("/product-users")
                        && state.lock().unwrap().registration_delay;
                    if delayed_registration {
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                    let (status, body) = {
                        let mut state = state.lock().unwrap();
                        state
                            .calls
                            .push((path.clone(), input.clone(), bearer.clone()));
                        fixture_response(&base, &mut state, &path, &input, &bearer)
                    };
                    let delayed =
                        path.contains("/recovery/") && state.lock().unwrap().summary_delay;
                    if delayed {
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                    let reply = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    socket.write_all(reply.as_bytes()).await.unwrap();
                });
            }
        });
        Self { base, state, task }
    }

    fn count(&self, suffix: &str) -> usize {
        self.state
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|(p, _, _)| p.ends_with(suffix))
            .count()
    }

    fn configure(&self, manager: &AccountManager) {
        std::fs::write(
            &manager.config_path,
            serde_json::json!({"cloud":{"base_url":self.base}}).to_string(),
        )
        .unwrap();
    }

    async fn login(&self, manager: &AccountManager, resource: CloudResource) -> String {
        self.configure(manager);
        let result = manager
            .login(LoginAccountParams::Cloud {
                resource,
                language: "zh-CN".into(),
                installation: None,
            })
            .await
            .unwrap();
        let LoginAccountResponse::Cloud {
            authorization,
            auth_url,
        } = result;
        let url = reqwest::Url::parse(&auth_url).unwrap();
        let values: std::collections::BTreeMap<_, _> = url.query_pairs().into_owned().collect();
        assert!(!values.contains_key("token"));
        assert!(!values.contains_key("code_verifier"));
        let mut state = self.state.lock().unwrap();
        state.nonce = values["nonce"].clone();
        state.challenge = values["code_challenge"].clone();
        state.resource = if resource == CloudResource::Default {
            "default".into()
        } else {
            values["resource"].clone()
        };
        let mut callback = reqwest::Url::parse(&values["redirect_uri"]).unwrap();
        callback
            .query_pairs_mut()
            .append_pair("state", &values["state"])
            .append_pair("code", "one-time-code");
        drop(state);
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(callback)
            .send()
            .await
            .unwrap();
        for _ in 0..200 {
            let result = manager.read(Default::default()).unwrap();
            if result.authorizations.iter().any(|a| {
                a.id == authorization.id
                    && !matches!(
                        a.status,
                        AccountAuthorizationStatus::Pending
                            | AccountAuthorizationStatus::Exchanging
                    )
            }) {
                return authorization.id;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        panic!("authorization did not finish")
    }
}

fn scope(resource: &str) -> &'static str {
    match resource {
        "market" => "openid ecosystem.catalog.read ecosystem.acquire",
        "web" => "openid integration.web.search integration.web.read",
        "connections" => "openid integration.connections.files.read",
        _ => "openid profile offline_access",
    }
}

fn audience(resource: &str) -> String {
    format!("urn:lime:api:app:sandbox:{resource}")
}

fn fixture_response(
    base: &str,
    s: &mut FixtureState,
    path: &str,
    input: &Value,
    bearer: &str,
) -> (u16, String) {
    let relative = path.strip_prefix(cloud::PREFIX).unwrap();
    if relative.starts_with("/recovery/") {
        let resource = if relative.starts_with("/recovery/market/") {
            "market"
        } else if relative.starts_with("/recovery/web/") {
            "web"
        } else {
            "connections"
        };
        assert_eq!(bearer, format!("Bearer access-{resource}"));
        assert!(input.is_null());
        return s.summary_response.as_ref().map_or_else(
            || (404, json!({"error":"not_found"}).to_string()),
            |(status, body)| (*status, body.to_string()),
        );
    }
    if s.disable_product_on_result
        && (relative.starts_with("/web/operations/")
            || relative.starts_with("/connection-requests/")
            || relative.starts_with("/connection-file-operations/"))
    {
        s.product_disabled = true;
        return (403, json!({"error":"product_user_disabled"}).to_string());
    }
    let value = match relative {
        "/auth/config" => {
            json!({"issuer":base,"applicationId":"app","environment":"sandbox","clientId":"native","redirectUris":[s.callback],"audience":audience("default"),"scope":scope("default"),"resources":{
            "market":{"audience":audience("market"),"scope":scope("market")},"web":{"audience":audience("web"),"scope":scope("web")},"connections":{"audience":audience("connections"),"scope":scope("connections")}}})
        }
        "/auth/keys" => serde_json::from_str(include_str!("testdata/signing-keys.json")).unwrap(),
        "/auth/token" => {
            if input["grantType"] == "refresh_token" && s.fail_refresh {
                return (502, "invalid-json".into());
            }
            let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
            header.kid = Some("native-test-key".into());
            let mut claims = json!({"iss":base,"aud":s.id_audience.clone().unwrap_or(json!("native")),"sub":s.user,"nonce":if s.invalid_nonce {"wrong"} else {&s.nonce},"iat":chrono::Utc::now().timestamp(),"exp":chrono::Utc::now().timestamp()+3600});
            if s.resource == "connections" {
                claims["lime_authorization_source"] = json!("sandbox_test_approval");
                claims["lime_application_id"] = json!("app");
                claims["lime_environment"] = json!("sandbox");
                claims["lime_test_approval_expires_at"] =
                    json!(chrono::Utc::now().timestamp() + 3600);
                if let Some(extra) = s.connection_claims.as_ref().and_then(Value::as_object) {
                    for (name, value) in extra {
                        claims[name] = value.clone();
                    }
                }
            }
            if let Some(azp) = &s.id_authorized_party {
                claims["azp"] = azp.clone();
            }
            // This key is a public test fixture and never used for real accounts.
            let key =
                jsonwebtoken::EncodingKey::from_rsa_pem(include_bytes!("testdata/signing-key.pem"))
                    .unwrap();
            let id_token = jsonwebtoken::encode(&header, &claims, &key).unwrap();
            json!({"access_token":format!("access-{}",s.resource),"refresh_token":format!("refresh-{}",s.resource),"token_type":"Bearer","expires_in":3600,"scope":scope(&s.resource),"id_token":id_token})
        }
        "/account" => {
            if s.reject_identity {
                return (503, json!({"error":"cloud_unavailable"}).to_string());
            }
            let resource = bearer.strip_prefix("Bearer access-").unwrap();
            json!({"issuer":base,"applicationId":"app","clientId":"native","environment":"sandbox","audience":audience(resource),"user":{"id":s.user,"displayName":"Test user","email":"","emailVerified":false}})
        }
        "/product-users/self" | "/product-users" => {
            assert_eq!(bearer, "Bearer access-default");
            if s.product_disabled {
                return (403, json!({"error":"product_user_disabled"}).to_string());
            }
            if path.ends_with("/product-users") {
                assert_eq!(input, &json!({}));
                s.product_registered = true;
                if s.registration_unknown {
                    return (502, "invalid-json".into());
                }
            } else if !s.product_registered {
                return (404, json!({"error":"product_user_not_found"}).to_string());
            }
            json!({"id":"pusr_person","status":"active","revision":1,"createdAt":"2026-11-12T00:00:00Z"})
        }
        "/web/prices" => {
            assert_eq!(bearer, "Bearer access-web");
            assert!(input.is_null());
            return s.web_prices.as_ref().map_or_else(
                || (200, json!({"items":[{"kind":"search","billingStatus":"unpriced"},{"kind":"page","billingStatus":"unpriced"}]}).to_string()),
                |(status, body)| (*status, body.to_string()),
            );
        }
        "/web/searches" | "/web/pages" if s.web_rejection.is_some() => {
            let (status, body) = s.web_rejection.as_ref().unwrap();
            return (*status, body.to_string());
        }
        "/web/searches" if s.invalid_post => return (200, "invalid-json".into()),
        "/web/searches" | "/web/pages" if s.web_response.is_some() => {
            s.web_response.clone().unwrap()
        }
        "/web/searches" => json!({"status":"completed","search":{"items":[]}}),
        p if p.starts_with("/web/operations/") => {
            if s.web_operation_invalid {
                return (200, "invalid-json".into());
            }
            if s.web_operation_missing {
                return (404, json!({"error":"not_found"}).to_string());
            }
            if let Some(response) = &s.web_response {
                return (200, response.to_string());
            }
            json!({"status":"completed","search":{"items":[]}})
        }
        "/connection-file-prices" => {
            assert_eq!(bearer, "Bearer access-connections");
            assert!(input.is_null());
            return s.connection_prices.as_ref().map_or_else(
                || {
                    (
                        200,
                        json!({"items":[{"action":"drive.files.read","billingStatus":"unpriced"}]})
                            .to_string(),
                    )
                },
                |(status, body)| (*status, body.to_string()),
            );
        }
        p if p == "/connection-requests" || p.starts_with("/connection-requests/") => {
            assert_eq!(bearer, "Bearer access-connections");
            let Some(value) = s.connection_request.as_mut() else {
                return (404, json!({"error":"not_found"}).to_string());
            };
            if p == "/connection-requests" {
                assert_eq!(input["connector"], "google-drive");
                assert_eq!(input["fileIds"], json!(["doc_original"]));
                value["requestedExpiresAt"] = input["expiresAt"].clone();
                if value["status"] == "approved" {
                    value["approvedExpiresAt"] = input["expiresAt"].clone();
                }
                if s.connection_request_unknown {
                    return (502, "invalid-json".into());
                }
            }
            value.clone()
        }
        p if p.starts_with("/connections/") && p.ends_with("/file-reads")
            || p.starts_with("/connection-file-operations/") =>
        {
            assert_eq!(bearer, "Bearer access-connections");
            if p.ends_with("/file-reads") {
                if let Some((status, body)) = s.connection_rejection.as_ref() {
                    return (*status, body.to_string());
                }
            }
            if p.ends_with("/file-reads") && s.connection_read_unknown {
                return (502, "invalid-json".into());
            }
            if p.starts_with("/connection-file-operations/") && s.connection_read_missing {
                return (404, json!({"error":"not_found"}).to_string());
            }
            let Some(value) = &s.connection_file else {
                return (404, json!({"error":"not_found"}).to_string());
            };
            value.clone()
        }
        _ => return (404, json!({"error":"not_found"}).to_string()),
    };
    (200, value.to_string())
}

fn search(key: &str, language: &str) -> CloudRequestParams {
    CloudRequestParams {
        path: "/web/searches".into(),
        method: CloudRequestMethod::Post,
        body: Some(json!({"query":"Lime"})),
        language: language.into(),
        operation_key: Some(key.into()),
        task_id: Some("task-search".into()),
    }
}

#[tokio::test]
async fn product_registration_resumes_after_restart_and_never_restores_disabled_users() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().registration_unknown = true;
    assert_eq!(
        manager
            .request(search("product-search-first", "zh-CN"))
            .await
            .unwrap_err(),
        "outcome_unknown"
    );
    assert_eq!(f.count("/product-users"), 1);
    assert_eq!(f.count("/web/searches"), 0);
    let restarted = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    assert_eq!(
        restarted
            .request(search("product-search-first", "en-US"))
            .await
            .unwrap()
            .status,
        200
    );
    assert_eq!(f.count("/product-users"), 1);
    assert_eq!(f.count("/web/searches"), 1);
    f.state.lock().unwrap().product_disabled = true;
    assert_eq!(
        restarted
            .request(search("product-search-second", "en-US"))
            .await
            .unwrap_err(),
        "product_user_disabled"
    );
    assert_eq!(f.count("/product-users"), 1);
    assert_eq!(f.count("/web/searches"), 1);
}

#[tokio::test]
async fn unresolved_registration_does_not_dispatch_again_when_self_is_still_missing() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().registration_unknown = true;
    assert!(manager
        .request(search("product-search-first", "zh-CN"))
        .await
        .is_err());
    f.state.lock().unwrap().product_registered = false;
    let restarted = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    assert_eq!(
        restarted
            .request(search("product-search-first", "en-US"))
            .await
            .unwrap_err(),
        "outcome_unknown"
    );
    assert_eq!(f.count("/product-users"), 1);
    assert_eq!(f.count("/web/searches"), 0);
}

#[tokio::test]
async fn native_id_token_preserves_one_client_for_string_and_array_audiences() {
    for (audience, azp, accepted) in [
        (json!("native"), None, true),
        (json!(["native"]), None, true),
        (json!(["native"]), Some(json!("native")), true),
        (json!("other"), None, false),
        (json!(["other"]), None, false),
        (json!(["native", "other"]), Some(json!("native")), false),
        (json!(["native", "native"]), None, false),
        (json!([]), None, false),
        (json!(["native"]), Some(json!("other")), false),
        (json!(["native"]), Some(json!(42)), false),
    ] {
        let f = Fixture::start().await;
        {
            let mut state = f.state.lock().unwrap();
            state.id_audience = Some(audience.clone());
            state.id_authorized_party = azp.clone();
        }
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        let id = f.login(&manager, CloudResource::Default).await;
        let result = manager.read(Default::default()).unwrap();
        assert_eq!(
            result.account.is_some(),
            accepted,
            "aud={audience}, azp={azp:?}"
        );
        assert_eq!(
            result.authorizations[0].status == AccountAuthorizationStatus::Completed,
            accepted
        );
        let verified = manager
            .read_verified(GetAccountParams {
                authorization_id: Some(id),
            })
            .await;
        assert_eq!(verified.is_ok(), accepted);
        assert_eq!(
            f.count("/auth/token"),
            1,
            "verification must not replay a code"
        );
    }
}

#[tokio::test]
async fn native_pkce_validates_signature_and_keeps_resource_slots_separate() {
    use base64::Engine as _;
    use sha2::{Digest, Sha256};
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    let original = store::load(&manager.path).unwrap().credentials[&CloudResource::Default]
        .tokens
        .access_token
        .clone();
    f.login(&manager, CloudResource::Web).await;
    let state = store::load(&manager.path).unwrap();
    assert_eq!(state.credentials.len(), 2);
    assert_eq!(
        state.credentials[&CloudResource::Default]
            .tokens
            .access_token,
        original
    );
    let Account::Cloud { resources, .. } =
        manager.read(Default::default()).unwrap().account.unwrap();
    assert_eq!(resources.len(), 2);
    let calls = f.state.lock().unwrap();
    let verifier = calls
        .calls
        .iter()
        .find(|(p, _, _)| p.ends_with("/auth/token"))
        .unwrap()
        .1["codeVerifier"]
        .as_str()
        .unwrap();
    assert_eq!(verifier.len(), 64);
    // The latest transaction is the web authorization; compare its exact S256 value.
    let verifier = calls
        .calls
        .iter()
        .rev()
        .find(|(p, _, _)| p.ends_with("/auth/token"))
        .unwrap()
        .1["codeVerifier"]
        .as_str()
        .unwrap();
    assert_eq!(
        calls.challenge,
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier))
    );
    let projection = serde_json::to_string(&manager.read(Default::default()).unwrap()).unwrap();
    assert!(!projection.contains("access-"));
    assert!(!projection.contains("refresh-"));
    assert!(!projection.contains(verifier));
}

#[tokio::test]
async fn unresolved_authorization_cannot_be_replaced_after_restart_or_language_change() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.configure(&manager);
    let params = |language: &str| LoginAccountParams::Cloud {
        resource: CloudResource::Default,
        language: language.into(),
        installation: None,
    };
    let LoginAccountResponse::Cloud { authorization, .. } =
        manager.login(params("zh-CN")).await.unwrap();
    for (status, error) in [
        (
            AccountAuthorizationStatus::Pending,
            "authorization_in_progress",
        ),
        (AccountAuthorizationStatus::Exchanging, "outcome_unknown"),
        (
            AccountAuthorizationStatus::OutcomeUnknown,
            "outcome_unknown",
        ),
    ] {
        store::update(&manager.path, |state| {
            state
                .authorizations
                .get_mut(&CloudResource::Default)
                .unwrap()
                .public
                .status = status;
            Ok(())
        })
        .unwrap();
        let restarted = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        assert_eq!(restarted.login(params("en-US")).await.unwrap_err(), error);
        let state = store::load(&manager.path).unwrap();
        assert_eq!(
            state.authorizations[&CloudResource::Default].public.id,
            authorization.id
        );
        assert_eq!(
            state.authorizations[&CloudResource::Default].language,
            "zh-CN"
        );
    }
    assert_eq!(f.count("/auth/config"), 1);
    assert_eq!(f.count("/auth/token"), 0);
}

#[tokio::test]
async fn interrupted_identity_verification_recovers_saved_tokens_without_code_replay() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.state.lock().unwrap().reject_identity = true;
    let id = f.login(&manager, CloudResource::Default).await;
    assert!(manager.read(Default::default()).unwrap().account.is_none());
    assert_eq!(f.count("/auth/token"), 1);
    f.state.lock().unwrap().reject_identity = false;
    let restarted = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    let result = restarted
        .read_verified(GetAccountParams {
            authorization_id: Some(id),
        })
        .await
        .unwrap();
    assert!(result.account.is_some());
    assert_eq!(f.count("/auth/token"), 1);
}

#[tokio::test]
async fn wrong_nonce_and_late_authorization_cannot_publish_an_account() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.state.lock().unwrap().invalid_nonce = true;
    let id = f.login(&manager, CloudResource::Default).await;
    assert!(manager.read(Default::default()).unwrap().account.is_none());
    assert!(manager
        .read_verified(GetAccountParams {
            authorization_id: Some(id.clone())
        })
        .await
        .is_err());
    manager.logout().unwrap();
    assert!(manager
        .read_verified(GetAccountParams {
            authorization_id: Some(id)
        })
        .await
        .is_err());
    assert_eq!(f.count("/auth/token"), 1);
}

#[tokio::test]
async fn unknown_business_write_survives_restart_language_change_and_expired_credentials() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().invalid_post = true;
    let key = "original-search-operation";
    let result = manager.request(search(key, "zh-CN")).await.unwrap();
    assert_eq!(result.status, 502);
    assert_eq!(f.count("/web/searches"), 1);
    store::update(&manager.path, |s| {
        s.credentials.get_mut(&CloudResource::Web).unwrap().status =
            CloudCredentialStatus::OutcomeUnknown;
        Ok(())
    })
    .unwrap();
    let restarted = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    let repeated = restarted.request(search(key, "en-US")).await.unwrap();
    assert_eq!(repeated.operation.unwrap().key, key);
    assert_eq!(f.count("/web/searches"), 1);
    let mut changed = search(key, "zh-CN");
    changed.body = Some(json!({"query":"different"}));
    assert_eq!(
        restarted.request(changed).await.unwrap_err(),
        "operation_key_conflict"
    );
    let journal = restarted
        .request(CloudRequestParams {
            path: format!("/operations/{key}"),
            method: CloudRequestMethod::Get,
            body: None,
            language: "en-US".into(),
            operation_key: None,
            task_id: None,
        })
        .await
        .unwrap();
    assert_eq!(journal.body["language"], "zh-CN");
    assert_eq!(journal.body["taskId"], "task-search");
    assert_eq!(journal.body["input"]["query"], "Lime");
}

#[tokio::test]
async fn rotating_refresh_unknown_never_reuses_the_old_refresh_token() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    store::update(&manager.path, |s| {
        s.credentials
            .get_mut(&CloudResource::Default)
            .unwrap()
            .expires_at = 0;
        Ok(())
    })
    .unwrap();
    f.state.lock().unwrap().fail_refresh = true;
    let (a, b) = tokio::join!(
        manager.credential(CloudResource::Default, "zh-CN"),
        manager.credential(CloudResource::Default, "zh-CN")
    );
    assert!(a.is_err() && b.is_err());
    assert_eq!(f.count("/auth/token"), 2);
    assert!(
        AccountManager::new(root.path(), &root.path().join("config.yaml"))
            .credential(CloudResource::Default, "zh-CN")
            .await
            .is_err()
    );
    assert_eq!(f.count("/auth/token"), 2);
}

#[cfg(unix)]
#[test]
fn credential_and_operation_stores_reject_symlinks_and_use_private_modes() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    store::update(&manager.path, |_| Ok(())).unwrap();
    assert_eq!(
        std::fs::metadata(&manager.path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        std::fs::metadata(manager.path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    let external = root.path().join("outside");
    std::fs::create_dir(&external).unwrap();
    symlink(&external, manager.path.parent().unwrap().join("operations")).unwrap();
    let account = Account::Cloud {
        base_url: "https://core.test".into(),
        issuer: "https://cloud.test".into(),
        application_id: "app".into(),
        client_id: "native".into(),
        environment: "sandbox".into(),
        user_id: "person".into(),
        email: "".into(),
        display_name: "".into(),
        generation: "test".into(),
        resources: vec![],
    };
    assert!(manager
        .operation(&account, "original-operation-key")
        .is_err());
    assert_eq!(std::fs::read_dir(external).unwrap().count(), 0);
}
