//! Two real WebSocket clients sharing the App Server transport loop.

use crate::{run_transport_events, AppServer, ProjectionStore, RuntimeCore};
use app_server_protocol::error_codes;
use app_server_transport::start_websocket_acceptor;
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tokio_util::sync::CancellationToken;

struct Client(WebSocketStream<MaybeTlsStream<TcpStream>>);

impl Client {
    async fn connect(url: &str, name: &str) -> Self {
        let (socket, _) = connect_async(url).await.expect("connect websocket client");
        let mut client = Self(socket);
        let response = client
            .request(
                1,
                "initialize",
                json!({"clientInfo": {"name": name, "version": "1.0"}}),
            )
            .await;
        assert!(response.get("result").is_some(), "{response}");
        client
            .send(json!({"jsonrpc": "2.0", "method": "initialized"}))
            .await;
        client
    }

    async fn send(&mut self, message: Value) {
        self.0
            .send(Message::Text(message.to_string().into()))
            .await
            .expect("send JSON-RPC message");
    }

    async fn request(&mut self, id: i64, method: &str, params: Value) -> Value {
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
            .await;
        timeout(Duration::from_secs(5), async {
            loop {
                let message = self
                    .0
                    .next()
                    .await
                    .expect("websocket remains open")
                    .expect("receive message");
                if let Message::Text(text) = message {
                    let value: Value =
                        serde_json::from_str(text.as_str()).expect("JSON-RPC response");
                    if value.get("id") == Some(&json!(id)) {
                        return value;
                    }
                }
            }
        })
        .await
        .expect("JSON-RPC response deadline")
    }
}

#[tokio::test]
async fn client_context_websocket_clients_share_threads_but_isolate_cancellation() {
    let temp = tempfile::tempdir().expect("shared transport fixture");
    let runtime = RuntimeCore::default().with_projection_store(Arc::new(
        ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
    ));
    let server = AppServer::with_runtime(runtime);
    let shutdown = CancellationToken::new();
    let (events_tx, events_rx) = mpsc::channel(64);
    let (address, acceptor) = start_websocket_acceptor(
        "127.0.0.1:0".parse().unwrap(),
        events_tx,
        shutdown.clone(),
        Default::default(),
    )
    .await
    .unwrap();
    let runner = tokio::spawn(run_transport_events(
        server,
        events_rx,
        false,
        shutdown.clone(),
    ));
    let url = format!("ws://{address}");
    let mut gui = Client::connect(&url, "gui").await;
    let mut tui = Client::connect(&url, "tui").await;

    let thread = gui
        .request(
            2,
            "thread/start",
            json!({
                "model": "fixture", "modelProvider": "fixture", "cwd": temp.path()
            }),
        )
        .await;
    let thread_id = thread
        .pointer("/result/thread/id")
        .expect("canonical thread id")
        .clone();
    let read = tui
        .request(
            2,
            "thread/read",
            json!({"threadId": thread_id, "includeTurns": false}),
        )
        .await;
    assert_eq!(
        read.pointer("/result/thread/id"),
        Some(&thread_id),
        "{read}"
    );

    gui.send(json!({"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": 7}}))
        .await;
    // The response is a processing barrier for GUI's preceding cancel notification.
    let barrier = gui.request(8, "thread/list", json!({})).await;
    assert!(barrier.get("result").is_some(), "{barrier}");
    let other = tui.request(7, "thread/list", json!({})).await;
    assert!(other.get("result").is_some(), "{other}");
    let canceled = gui.request(7, "thread/list", json!({})).await;
    assert_eq!(
        canceled.pointer("/error/code"),
        Some(&json!(error_codes::REQUEST_CANCELLED))
    );
    let reused = gui.request(7, "thread/list", json!({})).await;
    assert!(reused.get("result").is_some(), "{reused}");

    gui.0.close(None).await.unwrap();
    let surviving = tui
        .request(
            9,
            "thread/read",
            json!({"threadId": thread_id, "includeTurns": false}),
        )
        .await;
    assert_eq!(
        surviving.pointer("/result/thread/id"),
        Some(&thread_id),
        "{surviving}"
    );
    let mut reconnect = Client::connect(&url, "reconnected-gui").await;
    let after_reconnect = reconnect.request(7, "thread/list", json!({})).await;
    assert!(after_reconnect.get("result").is_some(), "{after_reconnect}");
    tui.0.close(None).await.unwrap();
    reconnect.0.close(None).await.unwrap();
    drop((gui, tui, reconnect));
    shutdown.cancel();
    timeout(Duration::from_secs(5), acceptor)
        .await
        .unwrap()
        .unwrap();
    timeout(Duration::from_secs(5), runner)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}
