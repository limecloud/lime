//! 单连接交付经过本机 JSONL 与真实认证 WebSocket；不调用真实模型或云服务。
#[path = "thread_compact_jsonrpc/model_fixture.rs"]
#[allow(dead_code)]
mod provider;
mod support;

use app_server::{AppServer, LocalAppDataSource, MockBackend, RuntimeCore};
use app_server_transport::websocket_auth::{
    policy_from_settings, WebsocketAuthConfig, WebsocketAuthPolicy, WebsocketAuthSettings,
    WebsocketCapabilityTokenSource,
};
use app_server_transport::AppServerTransport;
use futures::{SinkExt, StreamExt};
use lime_core::database::DbConnection;
use lime_services::api_key_provider_service::ApiKeyProviderService;
use provider::{ModelFixture, Wire};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc, time::Duration};
use support::json_lines_transport::TransportClient;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};

async fn server(root: &Path) -> (AppServer, DbConnection) {
    let db = lime_core::database::init_database_at_path(root.join("product.sqlite")).unwrap();
    let data = LocalAppDataSource::initialize_with_roots(db.clone(), root, root.join("agent"))
        .await
        .unwrap();
    (
        AppServer::with_runtime(
            RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_data_source(Arc::new(data)),
        ),
        db,
    )
}

struct Remote {
    runner: tokio::task::JoinHandle<Result<(), app_server::AppServerError>>,
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    notifications: Vec<Value>,
}
impl Drop for Remote {
    fn drop(&mut self) {
        self.runner.abort();
    }
}
impl Remote {
    async fn start(server: AppServer, authenticated: bool) -> Self {
        let reserved = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = reserved.local_addr().unwrap();
        drop(reserved);
        let policy = if authenticated {
            policy_from_settings(&WebsocketAuthSettings {
                config: Some(WebsocketAuthConfig::CapabilityToken {
                    source: WebsocketCapabilityTokenSource::TokenSha256 {
                        token_sha256: Sha256::digest(b"fixture-target-capability").into(),
                    },
                }),
            })
            .unwrap()
        } else {
            WebsocketAuthPolicy::default()
        };
        let runner = tokio::spawn(app_server::run_transport(
            server,
            AppServerTransport::WebSocket {
                bind_address: address,
            },
            policy,
        ));
        let socket = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let mut request = format!("ws://{address}").into_client_request().unwrap();
                if authenticated {
                    request.headers_mut().insert(
                        "Authorization",
                        "Bearer fixture-target-capability".parse().unwrap(),
                    );
                }
                match connect_async(request).await {
                    Ok((socket, _)) => break socket,
                    Err(tokio_tungstenite::tungstenite::Error::Io(error))
                        if error.kind() == std::io::ErrorKind::ConnectionRefused =>
                    {
                        tokio::task::yield_now().await
                    }
                    Err(error) => panic!("WebSocket startup: {error}"),
                }
            }
        })
        .await
        .unwrap();
        let mut remote = Self {
            runner,
            socket,
            notifications: vec![],
        };
        assert!(remote
            .rpc(
                1,
                "initialize",
                json!({"clientInfo":{"name":"model-transfer-test","version":"1"}})
            )
            .await
            .get("result")
            .is_some());
        remote
            .socket
            .send(Message::Text(json!({"method":"initialized"}).to_string()))
            .await
            .unwrap();
        remote
    }

    async fn rpc(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.socket
            .send(Message::Text(
                json!({"id":id,"method":method,"params":params}).to_string(),
            ))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let message = self
                    .socket
                    .next()
                    .await
                    .expect("WebSocket remains open")
                    .unwrap();
                if let Message::Text(text) = message {
                    let value: Value = serde_json::from_str(&text).unwrap();
                    if value["id"] == id {
                        break value;
                    }
                    self.notifications.push(value);
                }
            }
        })
        .await
        .expect("public JSON-RPC response")
    }
}

#[tokio::test]
async fn authenticated_destination_commits_selected_connection_and_reopens_without_the_source() {
    let root = tempfile::tempdir().unwrap();
    let src = root.path().join("source");
    let dst = root.path().join("destination");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::create_dir_all(&dst).unwrap();
    let model =
        ModelFixture::start_with_catalog(Wire::Chat, json!({"data":[{"id":Wire::Chat.model()}]}))
            .await;
    let (source_server, source_db) = server(&src).await;
    let service = ApiKeyProviderService::new();
    let provider = service
        .add_custom_provider(
            &source_db,
            "Selected connection".into(),
            Wire::Chat.provider_type(),
            model.url.clone(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
    let key = service
        .add_api_key(
            &source_db,
            &provider.id,
            Wire::Chat.credential(),
            Some("Selected key".into()),
            false,
        )
        .unwrap();
    let mut local = TransportClient::start(source_server, "model-transfer-source").await;
    let (target_server, target_db) = server(&dst).await;
    let mut target = Remote::start(target_server, true).await;
    let id = uuid::Uuid::new_v4().to_string();
    let prepared = target
        .rpc(
            2,
            "cloud/desktop",
            json!({"action":"prepareModelConnection","operationId":id}),
        )
        .await;
    let state = &prepared["result"]["data"];
    assert_eq!(state["phase"], "prepared", "{prepared}");
    let sealed = local.request_ok(2, "cloud/desktop", json!({"action":"sealModelConnection","operationId":id,
        "recipient":state["recipient"],"expiresAt":state["expiresAt"],"providerId":provider.id,"keyId":key.id})).await;
    assert!(!sealed.to_string().contains(Wire::Chat.credential()));
    let ciphertext = sealed["result"]["data"]["ciphertext"]
        .as_str()
        .expect("source returns encrypted connection through public JSON-RPC");
    let apply = json!({"action":"applyModelConnection","operationId":id,"ciphertext":ciphertext});
    let applied = target.rpc(3, "cloud/desktop", apply.clone()).await;
    assert_eq!(applied["result"]["data"]["phase"], "complete", "{applied}");
    assert!(!applied.to_string().contains(Wire::Chat.credential()));
    let imported_id = applied["result"]["data"]["providerId"]
        .as_str()
        .unwrap()
        .to_owned();
    let imported = service
        .get_provider(&target_db, &imported_id)
        .unwrap()
        .unwrap();
    assert_eq!(imported.api_keys.len(), 1);
    assert_eq!(
        service
            .read_api_key(&imported.api_keys[0].api_key_encrypted)
            .unwrap(),
        Wire::Chat.credential()
    );
    assert!(target
        .notifications
        .iter()
        .any(|value| value["method"] == "model/list/updated"));
    assert!(model.catalog_requests().iter().any(|request| request
        .headers
        .to_ascii_lowercase()
        .contains("authorization: bearer chat-fixture-key")));
    assert_eq!(
        model.request_count(),
        0,
        "transfer must not generate inference charges"
    );
    let forbidden = target.rpc(4, "cloud/desktop", json!({"action":"sealModelConnection","operationId":id,
        "recipient":state["recipient"],"expiresAt":state["expiresAt"],"providerId":provider.id,"keyId":key.id})).await;
    assert_eq!(forbidden["error"]["code"], -32600);
    local.shutdown().await;
    assert!(service.delete_api_key(&source_db, &key.id).unwrap());
    drop(target);
    drop(target_db);
    let (reopened, db) = server(&dst).await;
    let mut target = Remote::start(reopened, true).await;
    assert_eq!(
        target
            .rpc(
                5,
                "cloud/desktop",
                json!({"action":"readModelConnection","operationId":id})
            )
            .await["result"]["data"],
        applied["result"]["data"]
    );
    assert_eq!(
        target.rpc(6, "cloud/desktop", apply).await["result"]["data"],
        applied["result"]["data"]
    );
    let reopened = service.get_provider(&db, &imported_id).unwrap().unwrap();
    assert_eq!(reopened.api_keys.len(), 1);
    assert_eq!(
        service
            .read_api_key(&reopened.api_keys[0].api_key_encrypted)
            .unwrap(),
        Wire::Chat.credential(),
        "destination credential must survive deletion of the source credential"
    );
}

#[tokio::test]
async fn unauthenticated_websocket_cannot_prepare_read_or_apply_connections() {
    let root = tempfile::tempdir().unwrap();
    let (server, _) = server(root.path()).await;
    let mut remote = Remote::start(server, false).await;
    let id = uuid::Uuid::new_v4().to_string();
    for (n, action) in [
        "prepareModelConnection",
        "readModelConnection",
        "applyModelConnection",
    ]
    .into_iter()
    .enumerate()
    {
        let mut params = json!({"action":action,"operationId":id});
        if action == "applyModelConnection" {
            params["ciphertext"] = json!("ciphertext");
        }
        let response = remote.rpc(n as u64 + 2, "cloud/desktop", params).await;
        assert_eq!(response["error"]["code"], -32600, "{action}: {response}");
    }
}
