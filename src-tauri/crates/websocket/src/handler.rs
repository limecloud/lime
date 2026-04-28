//! WebSocket 请求处理器
//!
//! 处理 WebSocket 连接和消息

use super::{
    handlers::{parse_rpc_request, serialize_rpc_response, RpcHandler, RpcHandlerState},
    WsApiRequest, WsApiResponse, WsConfig, WsConnectionManager, WsEndpoint, WsError, WsMessage,
};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    http::HeaderMap,
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use lime_core::LogStore;
use std::sync::Arc;
use tokio::sync::RwLock;

/// WebSocket 处理器状态
#[derive(Clone)]
pub struct WsHandlerState {
    /// 连接管理器
    pub manager: Arc<WsConnectionManager>,
    /// API 密钥
    pub api_key: String,
    /// 日志存储
    pub logs: Arc<RwLock<LogStore>>,
    /// RPC 处理器状态
    pub rpc_state: RpcHandlerState,
}

impl WsHandlerState {
    /// 创建新的处理器状态
    pub fn new(
        config: WsConfig,
        api_key: String,
        logs: Arc<RwLock<LogStore>>,
        db: Option<lime_core::database::DbConnection>,
        scheduler: Option<lime_agent::LimeScheduler>,
    ) -> Self {
        let rpc_state = RpcHandlerState::new(db, scheduler, logs.clone());
        Self {
            manager: Arc::new(WsConnectionManager::new(config)),
            api_key,
            logs,
            rpc_state,
        }
    }
}

/// WebSocket 升级处理器
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<WsHandlerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // 验证 API 密钥
    let auth = headers
        .get("authorization")
        .or_else(|| headers.get("x-api-key"))
        .and_then(|v| v.to_str().ok());

    let key = match auth {
        Some(s) if s.starts_with("Bearer ") => &s[7..],
        Some(s) => s,
        None => {
            return axum::http::Response::builder()
                .status(401)
                .body(axum::body::Body::from("No API key provided"))
                .unwrap()
                .into_response();
        }
    };

    if key != state.api_key {
        return axum::http::Response::builder()
            .status(401)
            .body(axum::body::Body::from("Invalid API key"))
            .unwrap()
            .into_response();
    }

    // 获取客户端信息
    let client_info = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    ws.on_upgrade(move |socket| handle_socket(socket, state, client_info))
}

/// 处理 WebSocket 连接
async fn handle_socket(socket: WebSocket, state: WsHandlerState, client_info: Option<String>) {
    let conn_id = uuid::Uuid::new_v4().to_string();

    // 注册连接
    if let Err(e) = state.manager.register(conn_id.clone(), client_info.clone()) {
        state.logs.write().await.add(
            "error",
            &format!("[WS] Failed to register connection: {}", e.message),
        );
        return;
    }

    state.logs.write().await.add(
        "info",
        &format!(
            "[WS] New connection: {} (client: {:?})",
            &conn_id[..8],
            client_info
        ),
    );

    let (mut sender, mut receiver) = socket.split();

    // 心跳任务
    let heartbeat_interval = state.manager.config().heartbeat_interval_secs;
    let _heartbeat_timeout = state.manager.config().heartbeat_timeout_secs;

    let heartbeat_handle = tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(tokio::time::Duration::from_secs(heartbeat_interval));
        loop {
            interval.tick().await;
            // 心跳逻辑由客户端发起 ping，服务端响应 pong
            // 这里只是保持任务运行以便后续扩展
        }
    });

    // 消息处理循环
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                // P1 安全修复：限制消息大小防止 DoS
                const MAX_MESSAGE_SIZE: usize = 10 * 1024 * 1024; // 10MB
                if text.len() > MAX_MESSAGE_SIZE {
                    state.manager.on_error();
                    let error = WsMessage::Error(WsError::invalid_message(format!(
                        "Message too large: {} bytes (max: {} bytes)",
                        text.len(),
                        MAX_MESSAGE_SIZE
                    )));
                    let error_text = serde_json::to_string(&error).unwrap_or_default();
                    if sender.send(Message::Text(error_text)).await.is_err() {
                        break;
                    }
                    continue;
                }

                state.manager.on_message();
                state.manager.increment_request_count(&conn_id);

                match serde_json::from_str::<WsMessage>(&text) {
                    Ok(ws_msg) => {
                        let response = handle_message(&state, &conn_id, ws_msg).await;
                        if let Some(resp) = response {
                            let resp_text = serde_json::to_string(&resp).unwrap_or_default();
                            if sender.send(Message::Text(resp_text)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(_) => {
                        // 尝试解析为 RPC 请求
                        match parse_rpc_request(&text) {
                            Ok(rpc_req) => {
                                let rpc_handler = RpcHandler::new(state.rpc_state.clone());
                                let rpc_resp = rpc_handler.handle_request(rpc_req).await;
                                match serialize_rpc_response(&rpc_resp) {
                                    Ok(resp_text) => {
                                        if sender.send(Message::Text(resp_text)).await.is_err() {
                                            break;
                                        }
                                    }
                                    Err(e) => {
                                        state.manager.on_error();
                                        let error = WsMessage::Error(WsError::internal(
                                            None,
                                            format!("Failed to serialize RPC response: {:?}", e),
                                        ));
                                        let error_text =
                                            serde_json::to_string(&error).unwrap_or_default();
                                        if sender.send(Message::Text(error_text)).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                state.manager.on_error();
                                let error = WsMessage::Error(WsError::invalid_message(format!(
                                    "Failed to parse message as WS or RPC: {}",
                                    e.message
                                )));
                                let error_text = serde_json::to_string(&error).unwrap_or_default();
                                if sender.send(Message::Text(error_text)).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            Ok(Message::Binary(_)) => {
                state.manager.on_error();
                let error =
                    WsMessage::Error(WsError::invalid_message("Binary messages not supported"));
                let error_text = serde_json::to_string(&error).unwrap_or_default();
                if sender.send(Message::Text(error_text)).await.is_err() {
                    break;
                }
            }
            Ok(Message::Ping(data)) => {
                if sender.send(Message::Pong(data)).await.is_err() {
                    break;
                }
            }
            Ok(Message::Pong(_)) => {
                // 收到 pong，连接正常
            }
            Ok(Message::Close(_)) => {
                break;
            }
            Err(e) => {
                state.logs.write().await.add(
                    "error",
                    &format!("[WS] Connection {} error: {}", &conn_id[..8], e),
                );
                break;
            }
        }
    }

    // 清理
    heartbeat_handle.abort();
    state.manager.unregister(&conn_id);
    state.logs.write().await.add(
        "info",
        &format!("[WS] Connection closed: {}", &conn_id[..8]),
    );
}

/// 处理 WebSocket 消息
async fn handle_message(
    state: &WsHandlerState,
    conn_id: &str,
    msg: WsMessage,
) -> Option<WsMessage> {
    match msg {
        WsMessage::Ping { timestamp } => Some(WsMessage::Pong { timestamp }),
        WsMessage::Pong { .. } => None,
        WsMessage::Request(request) => {
            state.logs.write().await.add(
                "info",
                &format!(
                    "[WS] Request from {}: id={} endpoint={:?}",
                    &conn_id[..8],
                    request.request_id,
                    request.endpoint
                ),
            );
            let response = handle_api_request(state, &request).await;
            Some(response)
        }

        WsMessage::Response(_) | WsMessage::StreamChunk(_) | WsMessage::StreamEnd(_) => {
            Some(WsMessage::Error(WsError::invalid_request(
                None,
                "Invalid message type from client",
            )))
        }
        WsMessage::Error(_) => None,
    }
}

/// 处理 API 请求
async fn handle_api_request(_state: &WsHandlerState, request: &WsApiRequest) -> WsMessage {
    match request.endpoint {
        WsEndpoint::Models => {
            let models = serde_json::json!({
                "object": "list",
                "data": [
                    {"id": "claude-sonnet-4-5", "object": "model", "owned_by": "anthropic"},
                    {"id": "claude-sonnet-4-5-20250929", "object": "model", "owned_by": "anthropic"},
                    {"id": "claude-3-7-sonnet-20250219", "object": "model", "owned_by": "anthropic"},
                    {"id": "gemini-2.5-flash", "object": "model", "owned_by": "google"},
                    {"id": "gemini-2.5-pro", "object": "model", "owned_by": "google"},
                    {"id": "qwen3-coder-plus", "object": "model", "owned_by": "alibaba"},
                ]
            });
            WsMessage::Response(WsApiResponse {
                request_id: request.request_id.clone(),
                payload: models,
            })
        }
        WsEndpoint::ChatCompletions | WsEndpoint::Messages => WsMessage::Response(WsApiResponse {
            request_id: request.request_id.clone(),
            payload: serde_json::json!({
                "error": {
                    "message": "WebSocket API requests are not yet fully implemented. Please use HTTP endpoints.",
                    "type": "not_implemented"
                }
            }),
        }),
    }
}

/// 解析 WebSocket 消息
pub fn parse_message(text: &str) -> Result<WsMessage, WsError> {
    serde_json::from_str(text).map_err(|e| WsError::invalid_message(format!("Parse error: {e}")))
}

/// 序列化 WebSocket 消息
pub fn serialize_message(msg: &WsMessage) -> Result<String, WsError> {
    serde_json::to_string(msg).map_err(|e| WsError::internal(None, format!("Serialize error: {e}")))
}
