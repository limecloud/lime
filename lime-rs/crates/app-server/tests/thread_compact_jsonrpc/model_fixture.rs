use lime_core::database::dao::api_key_provider::ApiProviderType;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU8, Ordering},
    Arc, Mutex,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[path = "model_tool_reply.rs"]
mod tool_reply;

type ToolScript = Box<dyn FnMut(&Capture) -> Option<String> + Send>;

type SamplingGate = (
    tokio::sync::oneshot::Sender<()>,
    tokio::sync::oneshot::Receiver<()>,
);

#[derive(Clone, Copy, Debug)]
pub(super) enum Wire {
    Chat,
    Responses,
    Anthropic,
    Gemini,
}

impl Wire {
    pub(super) fn credential(self) -> &'static str {
        match self {
            Self::Chat => "chat-fixture-key",
            Self::Responses => "responses-fixture-key",
            Self::Anthropic => "anthropic-fixture-key",
            Self::Gemini => "gemini-fixture-key",
        }
    }

    pub(super) fn provider_type(self) -> ApiProviderType {
        match self {
            Self::Chat => ApiProviderType::Openai,
            Self::Responses => ApiProviderType::OpenaiResponse,
            Self::Anthropic => ApiProviderType::Anthropic,
            Self::Gemini => ApiProviderType::Gemini,
        }
    }

    pub(super) fn model(self) -> &'static str {
        match self {
            Self::Chat => "compact-chat-model",
            Self::Responses => "compact-responses-model",
            Self::Anthropic => "compact-anthropic-model",
            Self::Gemini => "compact-gemini-model",
        }
    }

    fn response(self, text: &str, mode: u8) -> String {
        let events = match self {
            Self::Chat => vec![
                json!({"id":"chat-summary","object":"chat.completion.chunk","created":0,"model":self.model(),"choices":[{"index":0,"delta":{"content":text},"finish_reason":null}]}),
                json!({"id":"chat-summary","object":"chat.completion.chunk","created":0,"model":self.model(),"choices":[{"index":0,"delta":{},"finish_reason":if mode == 1 {"length"} else {"stop"}}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}),
            ],
            Self::Responses => vec![
                json!({"type":"response.output_text.delta","item_id":"summary","delta":text}),
                if mode == 1 {
                    json!({"type":"response.incomplete","response":{"id":"resp-summary","incomplete_details":{"reason":"max_output_tokens"}}})
                } else {
                    json!({"type":"response.completed","response":{"id":"resp-summary","output":[],"usage":{"input_tokens":100,"output_tokens":20}}})
                },
            ],
            Self::Anthropic => vec![
                json!({"type":"message_start","message":{"id":"msg-summary","type":"message","role":"assistant","model":self.model(),"usage":{"input_tokens":100,"output_tokens":0}}}),
                json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":text}}),
                json!({"type":"content_block_stop","index":0}),
                json!({"type":"message_delta","delta":{"stop_reason":if mode == 1 {"max_tokens"} else {"end_turn"}},"usage":{"input_tokens":100,"output_tokens":20}}),
                json!({"type":"message_stop"}),
            ],
            Self::Gemini => vec![
                json!({"candidates":[{"index":0,"content":{"role":"model","parts":[{"text":text}]}}]}),
                json!({"candidates":[{"index":0,"finishReason":if mode == 1 {"MAX_TOKENS"} else {"STOP"}}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":20,"totalTokenCount":120}}),
            ],
        };
        let count = if mode == 2 {
            match self {
                Self::Anthropic => 2,
                _ => 1,
            }
        } else {
            events.len()
        };
        events[..count]
            .iter()
            .map(|event| format!("data: {event}\n\n"))
            .collect()
    }
}

#[derive(Clone, Debug)]
pub(super) struct Capture {
    pub(super) path: String,
    pub(super) headers: String,
    pub(super) body: Value,
}

impl Capture {
    pub(super) fn history(&self) -> &Value {
        self.body
            .get("messages")
            .or_else(|| self.body.get("input"))
            .or_else(|| self.body.get("contents"))
            .expect("wire history")
    }

    pub(super) fn assert_route(&self, wire: Wire) {
        self.assert_model_route(wire, wire.model());
    }

    pub(super) fn assert_model_route(&self, wire: Wire, model: &str) {
        let headers = self.headers.to_ascii_lowercase();
        match wire {
            Wire::Chat | Wire::Responses => {
                assert_eq!(self.body["model"], model);
                assert_eq!(
                    self.path,
                    if matches!(wire, Wire::Chat) {
                        "/v1/chat/completions"
                    } else {
                        "/v1/responses"
                    }
                );
                assert!(
                    headers.contains(&format!("authorization: bearer {}\r\n", wire.credential()))
                );
                assert!(!headers.contains("x-api-key:"));
            }
            Wire::Anthropic => {
                assert_eq!(self.body["model"], model);
                assert_eq!(self.path, "/v1/messages");
                assert!(headers.contains(&format!("x-api-key: {}\r\n", wire.credential())));
                assert!(headers.contains("anthropic-version:"));
                assert!(!headers.contains("authorization:"));
            }
            Wire::Gemini => {
                assert!(
                    self.path
                        .contains(&format!("/models/{model}:streamGenerateContent")),
                    "{}",
                    self.path
                );
                assert!(headers.contains(&format!("x-goog-api-key: {}\r\n", wire.credential())));
                assert!(!headers.contains("authorization:"));
            }
        }
    }
}

pub(super) struct ModelFixture {
    pub(super) url: String,
    pub(super) wire: Wire,
    pub(super) mode: Arc<AtomicU8>,
    pub(super) pending_response: Arc<tokio::sync::Notify>,
    requests: Arc<Mutex<Vec<Capture>>>,
    catalog_requests: Arc<Mutex<Vec<Capture>>>,
    sampling_gate: Arc<Mutex<Option<SamplingGate>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for ModelFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl ModelFixture {
    pub(super) async fn start(wire: Wire) -> Self {
        Self::start_inner(wire, None, None).await
    }

    pub(super) async fn start_with_catalog(wire: Wire, catalog: Value) -> Self {
        Self::start_inner(wire, Some(catalog), None).await
    }

    pub(super) async fn start_with_catalog_and_tool(
        wire: Wire,
        catalog: Value,
        tool: &str,
        arguments: Value,
    ) -> Self {
        Self::start_inner(wire, Some(catalog), Some((tool.to_string(), arguments))).await
    }

    async fn start_inner(
        wire: Wire,
        catalog: Option<Value>,
        mut first_tool: Option<(String, Value)>,
    ) -> Self {
        Self::start_scripted(
            wire,
            catalog,
            Box::new(move |_| {
                first_tool
                    .take()
                    .map(|(name, args)| wire.tool_response("origin-tool", &name, &args))
            }),
        )
        .await
    }

    pub(super) async fn start_with_script(
        wire: Wire,
        catalog: Value,
        mut script: impl FnMut(&Capture) -> Option<(String, String, Value)> + Send + 'static,
    ) -> Self {
        Self::start_scripted(
            wire,
            Some(catalog),
            Box::new(move |capture| {
                script(capture).map(|(id, name, args)| wire.tool_response(&id, &name, &args))
            }),
        )
        .await
    }

    pub(super) async fn start_with_custom_tool(
        wire: Wire,
        catalog: Value,
        name: &'static str,
        source: String,
    ) -> Self {
        let mut source = Some(source);
        Self::start_scripted(
            wire,
            Some(catalog),
            Box::new(move |_| {
                source
                    .take()
                    .map(|source| wire.custom_tool_response("custom-tool", name, &source))
            }),
        )
        .await
    }

    async fn start_scripted(wire: Wire, catalog: Option<Value>, mut script: ToolScript) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let mode = Arc::new(AtomicU8::new(0));
        let pending_response = Arc::new(tokio::sync::Notify::new());
        let sampling_gate = Arc::new(Mutex::new(None::<SamplingGate>));
        let next_sampling_gate = sampling_gate.clone();
        let pending_ready = pending_response.clone();
        let captured = requests.clone();
        let catalog_requests = Arc::new(Mutex::new(Vec::new()));
        let catalog_captured = catalog_requests.clone();
        let response_mode = mode.clone();
        let task = tokio::spawn(async move {
            let mut summaries = 0;
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let capture = read_request(&mut socket).await;
                if !capture.headers.starts_with("POST ") {
                    let is_catalog = capture.headers.starts_with("GET ")
                        && capture.path.split('?').next() == Some("/v1/models");
                    if let Some(catalog) = catalog.as_ref().filter(|_| is_catalog) {
                        catalog_captured.lock().unwrap().push(capture);
                        let body = catalog.to_string();
                        let headers = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                        socket.write_all(headers.as_bytes()).await.unwrap();
                        socket.write_all(body.as_bytes()).await.unwrap();
                        continue;
                    }
                    // 不把 Responses WebSocket 握手等其它 GET 当作模型目录请求。
                    socket
                        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .await
                        .unwrap();
                    continue;
                }
                // Startup memory uses the same provider route. Keep its independent
                // sampling out of the foreground script and history assertions.
                let memory = has_memory_prompt(&capture.body);
                let compact = has_prompt(&capture.body);
                let tool = (!compact && !memory).then(|| script(&capture)).flatten();
                if !memory {
                    captured.lock().unwrap().push(capture);
                }
                let gate = if compact || memory {
                    None
                } else {
                    next_sampling_gate.lock().unwrap().take()
                };
                if let Some((started, released)) = gate {
                    let _ = started.send(());
                    let _ = released.await;
                }
                let mode = if compact {
                    response_mode.load(Ordering::SeqCst)
                } else {
                    0
                };
                let text = if memory {
                    "MEMORY-FIXTURE: no update needed".to_string()
                } else if compact {
                    summaries += 1;
                    format!("MODEL-SUMMARY-{summaries}: {wire:?}; preserve the user constraint, decisions, and pending work")
                } else {
                    "MODEL-ASSISTANT-NOTE: observed project state".to_string()
                };
                let events = tool.unwrap_or_else(|| wire.response(&text, mode));
                let headers = if mode == 2 {
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n".to_string()
                } else {
                    format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", events.len())
                };
                socket.write_all(headers.as_bytes()).await.unwrap();
                socket.write_all(events.as_bytes()).await.unwrap();
                if mode == 2 {
                    pending_ready.notify_one();
                    let _ = socket.read(&mut [0_u8; 1]).await;
                }
            }
        });
        Self {
            url,
            wire,
            requests,
            catalog_requests,
            sampling_gate,
            mode,
            pending_response,
            task,
        }
    }

    pub(super) fn last_request(&self) -> Capture {
        self.requests.lock().unwrap().last().unwrap().clone()
    }

    pub(super) fn request_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }

    pub(super) fn catalog_requests(&self) -> Vec<Capture> {
        self.catalog_requests.lock().unwrap().clone()
    }

    pub(super) fn hold_next_sampling(
        &self,
    ) -> (
        tokio::sync::oneshot::Receiver<()>,
        tokio::sync::oneshot::Sender<()>,
    ) {
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, released) = tokio::sync::oneshot::channel();
        assert!(self
            .sampling_gate
            .lock()
            .unwrap()
            .replace((started, released))
            .is_none());
        (ready, release)
    }
}

fn has_prompt(value: &Value) -> bool {
    match value {
        Value::String(text) => text == lime_agent::SUMMARIZATION_PROMPT,
        Value::Array(values) => values.iter().any(has_prompt),
        Value::Object(values) => values.values().any(has_prompt),
        _ => false,
    }
}

fn has_memory_prompt(value: &Value) -> bool {
    let prefix = include_str!("../../src/memory_store/consolidation_prompt.md")
        .split("\n\n")
        .next()
        .expect("memory consolidation prompt prefix");
    match value {
        Value::String(text) => text.starts_with(prefix),
        Value::Array(values) => values.iter().any(has_memory_prompt),
        Value::Object(values) => values.values().any(has_memory_prompt),
        _ => false,
    }
}

async fn read_request(socket: &mut TcpStream) -> Capture {
    let mut bytes = Vec::new();
    let header_end = loop {
        let mut part = [0_u8; 4096];
        let count = socket.read(&mut part).await.unwrap();
        assert_ne!(count, 0, "provider request ended before headers");
        bytes.extend_from_slice(&part[..count]);
        if let Some(offset) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break offset + 4;
        }
    };
    let headers = std::str::from_utf8(&bytes[..header_end])
        .unwrap()
        .to_string();
    let size = headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("content-length")
            .then(|| value.trim().parse::<usize>().unwrap())
    });
    let size = size.unwrap_or_else(|| {
        assert!(!headers.starts_with("POST "), "sampling requires a body");
        0
    });
    while bytes.len() < header_end + size {
        let mut part = [0_u8; 4096];
        let count = socket.read(&mut part).await.unwrap();
        assert_ne!(count, 0, "provider request ended before body");
        bytes.extend_from_slice(&part[..count]);
    }
    Capture {
        path: headers
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .to_string(),
        headers,
        body: if size == 0 {
            Value::Null
        } else {
            serde_json::from_slice(&bytes[header_end..header_end + size]).unwrap()
        },
    }
}
