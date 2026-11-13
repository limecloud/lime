#![allow(dead_code)]
use app_server::{AppServer, LocalAppDataSource, MockBackend, RuntimeCore};
use lime_core::database::schema::create_tables;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

pub struct Fixture {
    pub base: String,
    pub state: Arc<Mutex<FixtureState>>,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Default)]
pub struct FixtureState {
    pub nonce: String,
    pub callback: String,
    pub resource: String,
    pub challenge: String,
    pub user: String,
    pub reject_identity: bool,
    pub invalid_nonce: bool,
    pub fail_refresh: bool,
    pub invalid_post: bool,
    pub web_operation_missing: bool,
    pub product_registered: bool,
    pub product_disabled: bool,
    pub registration_unknown: bool,
    pub calls: Vec<(String, Value, String)>,
    pub responses: std::collections::BTreeMap<String, (u16, Vec<u8>)>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Fixture {
    pub async fn start() -> Self {
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
                    let (status, body) = {
                        let mut state = state.lock().unwrap();
                        state
                            .calls
                            .push((path.clone(), input.clone(), bearer.clone()));
                        if let Some(response) = state
                            .responses
                            .get(&format!(
                                "{}#{}",
                                path,
                                input
                                    .get("releaseId")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                            ))
                            .or_else(|| state.responses.get(&path))
                            .or_else(|| state.responses.get(path.split('?').next().unwrap()))
                        {
                            response.clone()
                        } else {
                            let (status, body) =
                                fixture_response(&base, &mut state, &path, &input, &bearer);
                            (status, body.into_bytes())
                        }
                    };
                    let reply = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                    socket.write_all(reply.as_bytes()).await.unwrap();
                    socket.write_all(&body).await.unwrap();
                });
            }
        });
        Self { base, state, task }
    }

    pub fn count(&self, suffix: &str) -> usize {
        self.state
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|(p, _, _)| p.ends_with(suffix))
            .count()
    }

    pub fn respond(&self, path: &str, status: u16, body: Value) {
        self.state
            .lock()
            .unwrap()
            .responses
            .insert(path.into(), (status, serde_json::to_vec(&body).unwrap()));
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
    let value = match path.strip_prefix("/api/v1/client").unwrap() {
        "/auth/config" => {
            json!({"issuer":base,"applicationId":"app","environment":"sandbox","clientId":"native","redirectUris":[s.callback],"audience":audience("default"),"scope":scope("default"),"resources":{
            "market":{"audience":audience("market"),"scope":scope("market")},"web":{"audience":audience("web"),"scope":scope("web")},"connections":{"audience":audience("connections"),"scope":scope("connections")}}})
        }
        "/auth/keys" => {
            serde_json::from_str(include_str!("../../src/account/testdata/signing-keys.json"))
                .unwrap()
        }
        "/auth/token" => {
            if input["grantType"] == "refresh_token" && s.fail_refresh {
                return (502, "invalid-json".into());
            }
            let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
            header.kid = Some("native-test-key".into());
            let mut claims = json!({"iss":base,"aud":"native","sub":s.user,"nonce":if s.invalid_nonce {"wrong"} else {&s.nonce},"iat":chrono::Utc::now().timestamp(),"exp":chrono::Utc::now().timestamp()+3600});
            if s.resource == "connections" {
                claims["lime_authorization_source"] = json!("sandbox_test_approval");
                claims["lime_application_id"] = json!("app");
                claims["lime_environment"] = json!("sandbox");
                claims["lime_test_approval_expires_at"] =
                    json!(chrono::Utc::now().timestamp() + 3600);
            }
            // This key is a public test fixture and never used for real accounts.
            let key = jsonwebtoken::EncodingKey::from_rsa_pem(include_bytes!(
                "../../src/account/testdata/signing-key.pem"
            ))
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
            json!({"items":[{"kind":"search","billingStatus":"unpriced"},{"kind":"page","billingStatus":"unpriced"}]})
        }
        "/web/searches" if s.invalid_post => return (200, "invalid-json".into()),
        "/web/searches" => json!({"status":"completed","search":{"items":[]}}),
        "/connection-file-prices" => {
            json!({"items":[{"action":"drive.files.read","billingStatus":"unpriced"}]})
        }
        "/connection-requests" => {
            assert_eq!(bearer, "Bearer access-connections");
            assert_eq!(input["connector"], "google-drive");
            assert_eq!(input["actions"], json!(["drive.files.read"]));
            assert_eq!(input["fileIds"], json!(["doc_original"]));
            let now = chrono::Utc::now();
            let value = json!({"id":"irq_original","consentVersion":"connection-selected-files.v1",
                "connector":"google-drive","actions":["drive.files.read"],"fileIds":["doc_original"],
                "requestedExpiresAt":input["expiresAt"],"status":"pending","revision":1,
                "createdAt":now.to_rfc3339(),"expiresAt":(now+chrono::Duration::minutes(5)).to_rfc3339(),
                "approvalUrl":"https://console.test/connections/requests/irq_original?environment=sandbox"});
            s.responses.insert(
                "/api/v1/client/connection-requests/irq_original".into(),
                (200, serde_json::to_vec(&value).unwrap()),
            );
            value
        }
        p if p.starts_with("/web/operations/") => {
            if s.web_operation_missing {
                return (404, json!({"error":"not_found"}).to_string());
            }
            json!({"status":"completed","search":{"items":[]}})
        }
        _ => return (404, json!({"error":"not_found"}).to_string()),
    };
    (200, value.to_string())
}

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

pub async fn raw(server: &AppServer, method: &str, params: Value) -> Value {
    let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let lines = tokio::time::timeout(
        std::time::Duration::from_secs(40),
        server.handle_json_line(
            &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string(),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    let response = lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|message| message["id"] == id)
        .unwrap();
    assert!(!response.to_string().contains("access-default"));
    assert!(!response.to_string().contains("refresh-default"));
    assert!(!response.to_string().contains("access-market"));
    assert!(!response.to_string().contains("access-web"));
    response
}

pub async fn rpc(server: &AppServer, method: &str, params: Value) -> Value {
    let value = raw(server, method, params).await;
    assert!(value.get("error").is_none(), "{method}: {value}");
    value["result"].clone()
}

pub async fn server(root: &Path) -> AppServer {
    let db = Connection::open_in_memory().unwrap();
    create_tables(&db).unwrap();
    server_with_runtime(
        root,
        RuntimeCore::with_backend(Arc::new(MockBackend)),
        Arc::new(Mutex::new(db)),
    )
    .await
}

pub async fn server_with_runtime(
    root: &Path,
    runtime: RuntimeCore,
    db: lime_core::database::DbConnection,
) -> AppServer {
    let data = LocalAppDataSource::initialize_with_roots(db, root, root.join("agent"))
        .await
        .unwrap()
        .with_app_config_path(root.join("config.yaml"))
        .with_plugin_discovery_roots(Some(root.join("home")), None);
    let server = AppServer::with_runtime(
        runtime
            .with_account_store_root(root)
            .with_app_config_path(root.join("config.yaml"))
            .with_app_data_source(Arc::new(data)),
    );
    rpc(
        &server,
        "initialize",
        json!({"clientInfo":{"name":"shared-cloud-test","version":"1"}}),
    )
    .await;
    server
        .handle_json_line(r#"{"jsonrpc":"2.0","method":"initialized"}"#)
        .await
        .unwrap();
    server
}

impl Fixture {
    pub async fn callback(&self, auth_url: &str) {
        let url = reqwest::Url::parse(auth_url).unwrap();
        let values: std::collections::BTreeMap<_, _> = url.query_pairs().into_owned().collect();
        assert!(!values.contains_key("code_verifier"));
        let callback = {
            let mut state = self.state.lock().unwrap();
            state.nonce = values["nonce"].clone();
            state.challenge = values["code_challenge"].clone();
            state.resource = values.get("resource").cloned().unwrap_or("default".into());
            let mut callback = reqwest::Url::parse(&values["redirect_uri"]).unwrap();
            callback
                .query_pairs_mut()
                .append_pair("state", &values["state"])
                .append_pair("code", "one-time-code");
            callback
        };
        let response = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(callback)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 204);
    }

    pub async fn authorize(&self, server: &AppServer, resource: &str) -> Value {
        rpc(
            server,
            "config/value/write",
            json!({
                "keyPath":"cloud.base_url", "value":self.base, "mergeStrategy":"replace"
            }),
        )
        .await;
        let login = rpc(
            server,
            "account/login/start",
            json!({"type":"cloud","resource":resource,"language":"zh-CN"}),
        )
        .await;
        self.callback(login["authUrl"].as_str().unwrap()).await;
        for _ in 0..400 {
            let value = rpc(server, "account/read", json!({})).await;
            if value["authorizations"].as_array().unwrap().iter().any(|a| {
                a["id"] == login["authorization"]["id"]
                    && !matches!(a["status"].as_str(), Some("pending" | "exchanging"))
            }) {
                return value;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        panic!("public authorization did not finish")
    }
}

pub fn search(key: &str, language: &str) -> Value {
    json!({"path":"/web/searches","method":"POST","body":{"query":"Lime"},
        "operationKey":key,"taskId":"research-task","language":language})
}
