use super::super::RequestProcessor;
use super::tests_support::initialize_processor;
use crate::RuntimeCore;
use app_server_protocol::protocol::v2::METHOD_COMMAND_EXEC;
use app_server_protocol::{error_codes, JsonRpcMessage, JsonRpcRequest, RequestId};
use serde_json::json;

#[tokio::test]
async fn command_exec_rejects_client_granted_permissions_at_jsonrpc_boundary() {
    let processor = RequestProcessor::new(RuntimeCore::default());
    initialize_processor(&processor).await;

    let messages = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_COMMAND_EXEC,
            Some(json!({
                "command": ["printf", "ok"],
                "grantedPermissions": {"network": {"enabled": true}}
            })),
        ))
        .await
        .expect("command/exec response");

    let [JsonRpcMessage::Error(error)] = messages.as_slice() else {
        panic!("expected command/exec invalid params response: {messages:?}");
    };
    assert_eq!(error.error.code, error_codes::INVALID_PARAMS);
    assert!(error.error.message.contains("managed by permissionProfile"));
}

#[tokio::test]
async fn administrator_requirements_reject_standalone_command_before_process_spawn() {
    let temp = tempfile::tempdir().unwrap();
    let policy = temp.path().join("requirements.toml");
    std::fs::write(&policy, "allowed_sandbox_modes = ['read-only']").unwrap();
    let config = temp.path().join("config.yaml");
    std::fs::write(&config, "server:\n  api_key: test-only\n").unwrap();
    let processor = RequestProcessor::new(
        RuntimeCore::default()
            .with_app_config_path(config)
            .with_requirements_path(policy),
    );
    initialize_processor(&processor).await;
    let marker = temp.path().join("must-not-exist");
    for extra in [
        json!({"sandboxPolicy":{"type":"dangerFullAccess"}}),
        json!({"permissionProfile":":danger-full-access"}),
        json!({"sandboxPolicy":{"type":"externalSandbox"}}),
    ] {
        let mut params = json!({"command":["touch",marker]});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let id = RequestId::Integer(2);
        let messages = processor
            .handle_request_with_context(
                JsonRpcRequest::new(id.clone(), METHOD_COMMAND_EXEC, Some(params)),
                Some(super::super::ConnectionRequestId::new(
                    app_server_transport::ConnectionId(1),
                    id,
                )),
            )
            .await
            .unwrap();
        let [JsonRpcMessage::Error(error)] = messages.as_slice() else {
            panic!("{messages:?}");
        };
        assert!(error.error.message.contains("Admin policy"), "{error:?}");
        assert!(!marker.exists());
    }
}
