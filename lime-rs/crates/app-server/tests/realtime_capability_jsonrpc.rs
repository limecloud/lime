use std::sync::Arc;

use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::{
    METHOD_INITIALIZE, METHOD_INITIALIZED, METHOD_MODEL_PROVIDER_CAPABILITIES_READ,
    PROTOCOL_VERSION,
};
use serde_json::{json, Value};

/// 使用确定不存在的临时配置路径，避免读取开发机真实 config.yaml。
fn isolated_config_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "lime-realtime-capability-{}-{:?}.yaml",
        std::process::id(),
        std::thread::current().id()
    ))
}

fn test_server() -> AppServer {
    AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(isolated_config_path()),
    )
}

/// 实时语音必须在真实 App Server JSON-RPC 边界上 fail closed：
/// 没有 provider 实时 wire、也没有会话 transport owner 时，只报告阻断原因，
/// 不得返回任何可开始会话的假能力。
#[tokio::test]
async fn realtime_voice_capability_fails_closed_over_public_jsonrpc() {
    let server = test_server();
    initialize(&server).await;

    let response = request(
        &server,
        2,
        METHOD_MODEL_PROVIDER_CAPABILITIES_READ,
        json!({}),
    )
    .await;

    assert_eq!(
        response.pointer("/result/realtime"),
        Some(&json!(false)),
        "realtime voice must not be claimed without a wire adapter and session owner"
    );
    let blockers = response
        .pointer("/result/realtimeBlockers")
        .and_then(Value::as_array)
        .expect("realtimeBlockers array");
    let blockers: Vec<&str> = blockers.iter().filter_map(Value::as_str).collect();
    assert!(
        blockers.contains(&"providerRealtimeUnsupported"),
        "missing provider blocker: {blockers:?}"
    );
    assert!(
        blockers.contains(&"realtimeTransportUnimplemented"),
        "missing transport blocker: {blockers:?}"
    );
}

/// 实时语音会话方法不得在 transport owner 缺失时注册。
#[tokio::test]
async fn realtime_voice_session_methods_stay_unregistered() {
    let server = test_server();
    initialize(&server).await;

    let response = request(&server, 2, "thread/realtime/start", json!({})).await;
    assert_eq!(
        response.pointer("/error/code"),
        Some(&json!(-32601)),
        "thread/realtime/start must stay method-not-found until a real owner exists: {response}"
    );
}

async fn initialize(server: &AppServer) {
    let response = request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({
            "clientInfo": {
                "name": "realtime-capability-jsonrpc-test",
                "version": "1.0.0"
            }
        }),
    )
    .await;
    assert_eq!(
        response.pointer("/result/serverInfo/protocolVersion"),
        Some(&json!(PROTOCOL_VERSION))
    );
    let lines = server
        .handle_json_line(
            &json!({
                "jsonrpc": "2.0",
                "method": METHOD_INITIALIZED,
                "params": {}
            })
            .to_string(),
        )
        .await
        .expect("handle initialized notification");
    assert!(lines.is_empty());
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params
            })
            .to_string(),
        )
        .await
        .expect("handle JSON-RPC request");
    let response = lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).expect("decode JSON-RPC message"))
        .find(|message: &Value| message.get("id") == Some(&json!(id)))
        .expect("matching JSON-RPC response");
    response
}
