mod outgoing_message;
mod transport;
#[path = "websocket_auth/lib.rs"]
pub mod websocket_auth;

use app_server_protocol::JsonRpcMessage;
pub use outgoing_message::ConnectionId;
pub use outgoing_message::ConnectionOrigin;
pub use outgoing_message::OutgoingError;
pub use outgoing_message::OutgoingMessage;
pub use outgoing_message::OutgoingResponse;
pub use outgoing_message::QueuedOutgoingMessage;
pub use outgoing_message::CHANNEL_CAPACITY;
use thiserror::Error;
pub use transport::acquire_app_server_startup_lock;
pub use transport::app_server_control_socket_path;
pub use transport::app_server_startup_lock_path;
pub use transport::enqueue_incoming_message;
pub use transport::extract_stdio_initialize_client_name;
pub use transport::forward_incoming_message;
pub use transport::next_connection_id;
pub use transport::overload_error_for_request;
pub use transport::prepare_control_socket_path;
pub use transport::serialize_outgoing_message;
pub use transport::start_control_socket_acceptor;
pub use transport::start_stdio_connection;
pub use transport::start_websocket_acceptor;
pub use transport::AppServerStartupLock;
pub use transport::AppServerTransport;
pub use transport::AppServerTransportParseError;
pub use transport::StdioConnection;
pub use transport::TransportEvent;
pub use transport::APP_SERVER_CONTROL_SOCKET_DIR_NAME;
pub use transport::APP_SERVER_CONTROL_SOCKET_FILE_NAME;
pub use transport::APP_SERVER_STARTUP_LOCK_FILE_NAME;
pub use transport::OVERLOADED_ERROR_CODE;

pub const DEFAULT_LISTEN_URL: &str = "stdio://";

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("empty JSON-RPC line")]
    EmptyLine,
    #[error("failed to decode JSON-RPC line: {0}")]
    Decode(#[from] serde_json::Error),
}

#[derive(Debug, Default, Clone, Copy)]
pub struct JsonLineCodec;

impl JsonLineCodec {
    pub fn encode(message: &JsonRpcMessage) -> Result<String, TransportError> {
        let mut line = serde_json::to_string(message)?;
        line.push('\n');
        Ok(line)
    }

    pub fn decode(line: &str) -> Result<JsonRpcMessage, TransportError> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Err(TransportError::EmptyLine);
        }
        Ok(serde_json::from_str(trimmed)?)
    }
}

pub fn encode_message(message: &JsonRpcMessage) -> Result<String, TransportError> {
    JsonLineCodec::encode(message)
}

pub fn decode_message(line: &str) -> Result<JsonRpcMessage, TransportError> {
    JsonLineCodec::decode(line)
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::JsonRpcError;
    use app_server_protocol::JsonRpcErrorResponse;
    use app_server_protocol::JsonRpcNotification;
    use app_server_protocol::JsonRpcRequest;
    use app_server_protocol::JsonRpcResponse;
    use app_server_protocol::RequestId;
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn codec_round_trips_one_json_message_per_line() {
        let message = JsonRpcMessage::Request(JsonRpcRequest::new(
            RequestId::Integer(1),
            "initialize",
            Some(json!({ "clientInfo": { "name": "test" } })),
        ));

        let line = JsonLineCodec::encode(&message).expect("encode");
        assert!(line.ends_with('\n'));

        let decoded = JsonLineCodec::decode(&line).expect("decode");
        assert_eq!(decoded, message);
    }

    #[test]
    fn codec_rejects_empty_lines_and_trims_jsonl_whitespace() {
        assert!(matches!(
            JsonLineCodec::decode(" \n\t "),
            Err(TransportError::EmptyLine)
        ));

        let message = JsonRpcMessage::Notification(JsonRpcNotification::new("initialized", None));
        let line = format!("  {}  \n", serde_json::to_string(&message).expect("json"));

        assert_eq!(JsonLineCodec::decode(&line).expect("decode"), message);
    }

    #[test]
    fn codec_round_trips_request_notification_response_and_error() {
        let messages = vec![
            JsonRpcMessage::Request(JsonRpcRequest::new(
                RequestId::Integer(1),
                "initialize",
                Some(json!({ "clientInfo": { "name": "test" } })),
            )),
            JsonRpcMessage::Notification(JsonRpcNotification::new(
                "agentSession/event",
                Some(json!({ "event": { "eventId": "evt_1" } })),
            )),
            JsonRpcMessage::Response(
                JsonRpcResponse::new(RequestId::Integer(2), json!({ "ok": true }))
                    .expect("response"),
            ),
            JsonRpcMessage::Error(JsonRpcErrorResponse {
                id: RequestId::Integer(3),
                error: JsonRpcError::new(-32000, "runtime error"),
            }),
        ];

        for message in messages {
            let line = encode_message(&message).expect("encode");
            assert_eq!(decode_message(&line).expect("decode"), message);
        }
    }

    #[test]
    fn connection_id_is_stable_displayable_and_hashable() {
        let id = ConnectionId(42);
        let mut ids = HashSet::new();
        ids.insert(id);

        assert_eq!(id.to_string(), "42");
        assert!(ids.contains(&ConnectionId(42)));
    }

    #[test]
    fn queued_outgoing_message_starts_without_completion_signal() {
        let message = OutgoingMessage::from(JsonRpcMessage::Notification(
            JsonRpcNotification::new("initialized", None),
        ));
        let queued = QueuedOutgoingMessage::new(message);

        assert!(queued.write_complete_tx.is_none());
        assert!(matches!(
            queued.message.into_json_rpc_message(),
            JsonRpcMessage::Notification(_)
        ));
        assert_eq!(CHANNEL_CAPACITY, 256);
        assert_eq!(ConnectionOrigin::Stdio, ConnectionOrigin::Stdio);
    }
}
