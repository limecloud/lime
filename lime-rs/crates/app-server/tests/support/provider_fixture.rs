//! 真实 HTTP provider 夹具；请求经过 current runtime 与工具执行链。
#![allow(dead_code)]
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

pub struct ProviderFixture {
    pub base_url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    task: JoinHandle<()>,
}

impl ProviderFixture {
    pub async fn start(model: &'static str, arguments: Value, call_prefix: &'static str) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind provider fixture");
        let address = listener.local_addr().expect("provider fixture address");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let fixture_requests = Arc::clone(&requests);
        let task = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let requests = Arc::clone(&fixture_requests);
                let arguments = arguments.clone();
                tokio::spawn(async move {
                    let _ =
                        handle_provider_connection(stream, requests, model, arguments, call_prefix)
                            .await;
                });
            }
        });
        Self {
            base_url: format!("http://{address}/v1"),
            requests,
            task,
        }
    }

    pub fn requests(&self) -> Vec<Value> {
        self.requests.lock().expect("provider requests").clone()
    }
}

impl Drop for ProviderFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn handle_provider_connection(
    mut stream: TcpStream,
    requests: Arc<Mutex<Vec<Value>>>,
    model: &str,
    arguments: Value,
    call_prefix: &str,
) -> std::io::Result<()> {
    let body = read_http_json_body(&mut stream).await?;
    requests
        .lock()
        .expect("record provider request")
        .push(body.clone());
    let streaming = body["stream"] == true;
    let response_body = if streaming {
        streaming_provider_response(&body, model, &arguments, call_prefix)
    } else {
        json!({
            "id": "chatcmpl-title",
            "object": "chat.completion",
            "created": 0,
            "model": model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": "Tool turn"},
                "finish_reason": "stop"
            }]
        })
        .to_string()
    };
    let content_type = if streaming {
        "text/event-stream"
    } else {
        "application/json"
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{response_body}",
        response_body.len()
    );
    stream.write_all(response.as_bytes()).await
}

fn streaming_provider_response(
    request: &Value,
    model: &str,
    arguments: &Value,
    call_prefix: &str,
) -> String {
    let messages = request
        .get("messages")
        .and_then(Value::as_array)
        .expect("provider request messages");
    let current_turn_start = messages
        .iter()
        .rposition(|message| message["role"] == "user")
        .expect("current turn user message");
    let has_tool_result = messages[current_turn_start + 1..]
        .iter()
        .any(|message| message["role"] == "tool");
    if has_tool_result {
        return sse(&[
            json!({
                "id": "chatcmpl-final",
                "object": "chat.completion.chunk",
                "created": 0,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {"role": "assistant", "content": "command completed"},
                    "finish_reason": "stop"
                }],
                "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}
            })
            .to_string(),
            "[DONE]".to_string(),
        ]);
    }

    let turn_number = messages
        .iter()
        .filter(|message| message["role"] == "user")
        .count();
    let tool_call_id = format!("{call_prefix}-{turn_number}");

    sse(&[
        json!({
            "id": "chatcmpl-tool",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": model,
            "choices": [{
                "index": 0,
                "delta": {
                    "role": "assistant",
                    "tool_calls": [{
                        "index": 0,
                        "id": tool_call_id,
                        "type": "function",
                        "function": {
                            "name": "exec_command",
                            "arguments": arguments.to_string()
                        }
                    }]
                },
                "finish_reason": null
            }]
        })
        .to_string(),
        json!({
            "id": "chatcmpl-tool",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 8, "completion_tokens": 2, "total_tokens": 10}
        })
        .to_string(),
        "[DONE]".to_string(),
    ])
}

fn sse(events: &[String]) -> String {
    events
        .iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect()
}

async fn read_http_json_body(stream: &mut TcpStream) -> std::io::Result<Value> {
    let mut buffer = Vec::new();
    let header_end = loop {
        let mut chunk = [0_u8; 1024];
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(json!({}));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index;
        }
    };
    let headers = String::from_utf8_lossy(&buffer[..header_end]);
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    let body_start = header_end + 4;
    while buffer.len().saturating_sub(body_start) < content_length {
        let mut chunk = vec![0_u8; content_length - (buffer.len() - body_start)];
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    serde_json::from_slice(&buffer[body_start..body_start + content_length])
        .map_err(std::io::Error::other)
}
