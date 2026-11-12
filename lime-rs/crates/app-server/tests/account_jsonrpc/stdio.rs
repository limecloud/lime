use super::issuer::Fixture;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

struct Peer {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Lines<BufReader<ChildStdout>>,
    stderr: PathBuf,
    next_id: u64,
}

impl Peer {
    async fn start(root: &Path, name: &str) -> Self {
        let stderr = root.join(format!("{name}.stderr.log"));
        let mut child = Command::new(env!("CARGO_BIN_EXE_app-server"))
            .args(["--stdio", "--backend", "unavailable", "--app-data-dir"])
            .arg(root.join("app"))
            .arg("--data-dir")
            .arg(root.join("agent"))
            .env("HTTP_PROXY", "http://127.0.0.1:1")
            .env("HTTPS_PROXY", "http://127.0.0.1:1")
            .env("ALL_PROXY", "http://127.0.0.1:1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(std::fs::File::create(&stderr).unwrap())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut peer = Self {
            child,
            stdin: Some(stdin),
            lines,
            stderr,
            next_id: 1,
        };
        peer.rpc(
            "initialize",
            Some(json!({"clientInfo":{"name":"account-stdio-test","version":"1"}})),
        )
        .await;
        peer.send(json!({"jsonrpc":"2.0","method":"initialized"}))
            .await;
        peer
    }

    async fn send(&mut self, message: Value) {
        self.stdin
            .as_mut()
            .unwrap()
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
    }

    async fn rpc(&mut self, method: &str, params: Option<Value>) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        let mut request = json!({"jsonrpc":"2.0","id":id,"method":method});
        if let Some(params) = params {
            request["params"] = params;
        }
        self.send(request).await;
        tokio::time::timeout(Duration::from_secs(60), async {
            loop {
                let line = self
                    .lines
                    .next_line()
                    .await
                    .unwrap()
                    .expect("App Server JSONL output");
                assert!(
                    !line.contains("access-default") && !line.contains("refresh-default"),
                    "credentials must not appear in stdio projections"
                );
                let message: Value =
                    serde_json::from_str(&line).expect("stdout must contain JSONL only");
                if message["id"] == id {
                    assert!(message.get("error").is_none(), "{method}: {message}");
                    return message["result"].clone();
                }
            }
        })
        .await
        .expect("account stdio response")
    }

    async fn close(mut self) {
        drop(self.stdin.take());
        let status = tokio::time::timeout(Duration::from_secs(60), self.child.wait())
            .await
            .expect("App Server must stop after stdin closes")
            .unwrap();
        let stderr = std::fs::read_to_string(self.stderr).unwrap();
        assert!(!stderr.contains("access-default"));
        assert!(
            status.success(),
            "App Server did not stop cleanly: {stderr}"
        );
    }

    async fn crash(mut self) {
        self.child.kill().await.unwrap();
        self.child.wait().await.unwrap();
    }
}

#[tokio::test]
async fn account_real_stdio_processes_share_pkce_credentials_and_logout() {
    let temp = TempDir::new().unwrap();
    let fixture = Fixture::start().await;
    let mut first = Peer::start(temp.path(), "first").await;
    let login = first
        .rpc(
            "account/login/start",
            Some(json!({
                "type":"cloud","baseUrl":fixture.base,"resource":"default","language":"zh-CN"
            })),
        )
        .await;
    fixture.callback(login["authUrl"].as_str().unwrap()).await;
    for _ in 0..400 {
        if first.rpc("account/read", Some(json!({}))).await["account"]["userId"] == "person-a" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(temp.path().join("app/credentials/account.json").is_file());
    let mut second = Peer::start(temp.path(), "second").await;
    assert_eq!(
        second.rpc("account/read", Some(json!({}))).await["account"]["userId"],
        "person-a"
    );
    assert_eq!(fixture.count("/auth/token"), 1);
    second.rpc("account/logout", Some(json!({}))).await;
    assert!(first.rpc("account/read", Some(json!({}))).await["account"].is_null());
    second.close().await;
    first.close().await;
}

#[tokio::test]
async fn account_real_stdio_restart_resumes_the_original_pending_callback() {
    let temp = TempDir::new().unwrap();
    let fixture = Fixture::start().await;
    let mut first = Peer::start(temp.path(), "pending-owner").await;
    let login = first
        .rpc(
            "account/login/start",
            Some(json!({
                "type":"cloud", "baseUrl":fixture.base, "resource":"default", "language":"zh-CN"
            })),
        )
        .await;
    let path = temp.path().join("app/credentials/account.json");
    let original = std::fs::read(&path).unwrap();
    let mut second = Peer::start(temp.path(), "pending-reader").await;
    let params = json!({"authorizationId":login["authorization"]["id"]});
    assert_eq!(
        second.rpc("account/read", Some(params.clone())).await["authorizations"][0]["status"],
        "pending"
    );
    assert_eq!(std::fs::read(&path).unwrap(), original);
    first.crash().await;

    assert_eq!(
        second.rpc("account/read", Some(params.clone())).await["authorizations"][0],
        login["authorization"]
    );
    assert_eq!(std::fs::read(&path).unwrap(), original);
    fixture.callback(login["authUrl"].as_str().unwrap()).await;
    let result = wait_authorization(&mut second, params).await;
    assert_eq!(result["account"]["userId"], "person-a");
    assert_eq!(result["authorizations"][0]["status"], "completed");
    assert_eq!(fixture.count("/auth/config"), 1);
    assert_eq!(fixture.count("/auth/token"), 1);
    second.close().await;
}

#[tokio::test]
async fn account_real_stdio_unknown_exchange_restart_never_reopens_or_resubmits_code() {
    let temp = TempDir::new().unwrap();
    let fixture = Fixture::start().await;
    fixture.state.lock().unwrap().responses.insert(
        "/api/v1/client/auth/token".into(),
        (502, b"unavailable".to_vec()),
    );
    let mut first = Peer::start(temp.path(), "exchange-owner").await;
    let login = first
        .rpc(
            "account/login/start",
            Some(json!({
                "type":"cloud", "baseUrl":fixture.base, "resource":"default", "language":"zh-CN"
            })),
        )
        .await;
    fixture.callback(login["authUrl"].as_str().unwrap()).await;
    let params = json!({"authorizationId":login["authorization"]["id"]});
    assert_eq!(
        wait_authorization(&mut first, params.clone()).await["authorizations"][0]["status"],
        "outcome_unknown"
    );
    first.crash().await;

    let mut second = Peer::start(temp.path(), "exchange-reader").await;
    for _ in 0..3 {
        let result = second.rpc("account/read", Some(params.clone())).await;
        assert!(result["account"].is_null());
        assert_eq!(result["authorizations"][0]["status"], "outcome_unknown");
    }
    let original = reqwest::Url::parse(login["authUrl"].as_str().unwrap()).unwrap();
    let redirect = original
        .query_pairs()
        .find(|(key, _)| key == "redirect_uri")
        .unwrap()
        .1
        .into_owned();
    let callback = reqwest::Url::parse(&redirect).unwrap();
    let free_port =
        tokio::net::TcpListener::bind((callback.host_str().unwrap(), callback.port().unwrap()))
            .await
            .unwrap();
    assert_eq!(fixture.count("/auth/config"), 1);
    assert_eq!(fixture.count("/auth/token"), 1);
    drop(free_port);
    second.close().await;
}

async fn wait_authorization(peer: &mut Peer, params: Value) -> Value {
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            let result = peer.rpc("account/read", Some(params.clone())).await;
            if !matches!(
                result["authorizations"][0]["status"].as_str(),
                Some("pending" | "exchanging")
            ) {
                return result;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("original authorization must reach a terminal status")
}
