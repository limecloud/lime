//! 通过 current JSON Lines transport 驱动同一 canonical Thread/Turn/Item。
#![allow(dead_code)]
use app_server::{run_json_lines, AppServer};
use app_server_protocol::protocol::v2::METHOD_TURN_COMPLETED;
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::{path::Path, process::Stdio};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, Lines};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

pub struct TransportClient {
    input: Box<dyn AsyncWrite + Unpin + Send>,
    lines: Lines<BufReader<Box<dyn AsyncRead + Unpin + Send>>>,
    pending: VecDeque<Value>,
    runner: JoinHandle<Result<(), String>>,
    shutdown_timeout: Duration,
}

impl TransportClient {
    pub async fn start(server: AppServer, name: &str) -> Self {
        let (input, input_server) = tokio::io::duplex(128 * 1024);
        let (output_server, output) = tokio::io::duplex(128 * 1024);
        let runner = tokio::spawn(async move {
            run_json_lines(server, input_server, output_server)
                .await
                .map_err(|error| error.to_string())
        });
        Self::initialize(
            Box::new(input),
            Box::new(output),
            runner,
            name,
            Duration::from_secs(3),
        )
        .await
    }

    pub async fn start_stdio(program: &Path, root: &Path, name: &str) -> Self {
        let mut child = tokio::process::Command::new(program)
            .args(["--stdio", "--backend", "runtime", "--app-data-dir"])
            .arg(root.join("app"))
            .arg("--data-dir")
            .arg(root.join("agent"))
            .env("LIME_CONFIG_PATH", root.join("config.yaml"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(
                std::fs::File::create(root.join(format!("{name}.stderr.log"))).unwrap(),
            ))
            .kill_on_drop(true)
            .spawn()
            .expect("start actual app-server process");
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let runner = tokio::spawn(async move {
            let status = child.wait().await.map_err(|error| error.to_string())?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("app-server exited: {status}"))
            }
        });
        Self::initialize(
            Box::new(input),
            Box::new(output),
            runner,
            name,
            Duration::from_secs(15),
        )
        .await
    }

    async fn initialize(
        input: Box<dyn AsyncWrite + Unpin + Send>,
        output: Box<dyn AsyncRead + Unpin + Send>,
        runner: JoinHandle<Result<(), String>>,
        name: &str,
        shutdown_timeout: Duration,
    ) -> Self {
        let mut client = Self {
            input,
            lines: BufReader::new(output).lines(),
            pending: VecDeque::new(),
            runner,
            shutdown_timeout,
        };
        client
            .request_ok(
                1,
                METHOD_INITIALIZE,
                json!({
                    "clientInfo": {"name": name, "version": "1.0.0"},
                    "capabilities": {"experimentalApi": true}
                }),
            )
            .await;
        client
            .write(json!({
                "jsonrpc": "2.0",
                "method": METHOD_INITIALIZED,
                "params": {}
            }))
            .await;
        client
    }

    pub async fn request_ok(&mut self, id: u64, method: &str, params: Value) -> Value {
        let response = self.request(id, method, params).await;
        Self::assert_ok_response(method, response)
    }

    pub async fn request(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.write(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }))
        .await;
        if let Some(position) = self
            .pending
            .iter()
            .position(|message| message.get("id") == Some(&json!(id)))
        {
            return self.pending.remove(position).expect("pending response");
        }
        loop {
            let message = self.read_message(method).await;
            if message.get("id") == Some(&json!(id)) {
                return message;
            }
            self.pending.push_back(message);
        }
    }

    pub async fn wait_for_turn_completed(&mut self, thread_id: &str, turn_id: &str) {
        self.wait_for_completion(thread_id, Some(turn_id)).await;
    }

    pub async fn wait_for_thread_completed(&mut self, thread_id: &str) -> Value {
        self.wait_for_completion(thread_id, None).await
    }

    async fn wait_for_completion(&mut self, thread_id: &str, turn_id: Option<&str>) -> Value {
        timeout(Duration::from_secs(10), async {
            loop {
                let pending_position = self
                    .pending
                    .iter()
                    .position(|message| turn_completed_matches(message, thread_id, turn_id));
                let message = match pending_position {
                    Some(position) => self.pending.remove(position).expect("pending terminal"),
                    None => self.read_message("turn/completed").await,
                };
                let matches = turn_completed_matches(&message, thread_id, turn_id);
                if matches {
                    assert_eq!(
                        message.pointer("/params/turn/status"),
                        Some(&json!("completed"))
                    );
                    return message;
                }
                self.pending.push_back(message);
            }
        })
        .await
        .unwrap_or_else(|_| {
            panic!(
                "timed out waiting for turn/completed: {turn_id:?}; pending: {:#?}",
                self.pending
            )
        })
    }

    fn assert_ok_response(method: &str, message: Value) -> Value {
        assert!(
            message.get("error").is_none(),
            "{method} returned an error: {message:#}"
        );
        message
    }

    async fn read_message(&mut self, scenario: &str) -> Value {
        let line = timeout(Duration::from_secs(10), self.lines.next_line())
            .await
            .unwrap_or_else(|_| panic!("timed out waiting for JSON-RPC message: {scenario}"))
            .expect("read JSON-RPC message")
            .expect("JSON-RPC output closed");
        serde_json::from_str(&line).expect("decode JSON-RPC message")
    }

    async fn write(&mut self, message: Value) {
        self.input
            .write_all(format!("{message}\n").as_bytes())
            .await
            .expect("write JSON-RPC message");
    }

    pub async fn shutdown(self) {
        drop(self.input);
        timeout(self.shutdown_timeout, self.runner)
            .await
            .expect("JSON lines runner should stop")
            .expect("JSON lines runner task")
            .expect("JSON lines runner result");
    }
}

fn turn_completed_matches(message: &Value, thread_id: &str, turn_id: Option<&str>) -> bool {
    message.get("method") == Some(&json!(METHOD_TURN_COMPLETED))
        && message.pointer("/params/threadId") == Some(&json!(thread_id))
        && turn_id.is_none_or(|id| message.pointer("/params/turn/id") == Some(&json!(id)))
}
