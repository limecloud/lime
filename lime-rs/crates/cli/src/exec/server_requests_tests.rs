use super::*;
use serde_json::json;

#[test]
fn non_interactive_exec_cannot_approve_an_external_file() {
    let wire = app_server_protocol::JsonRpcRequest::new(
        RequestId::String("original-file-request".into()),
        "connection/authorize",
        Some(
            json!({"threadId":"thread","requestId":"irq_original","environment":"sandbox",
            "approvalUrl":"https://console.test/connections/requests/irq_original?environment=sandbox",
            "expiresAt":"2030-01-01T00:00:00Z"}),
        ),
    );
    let request = ServerRequest::try_from(wire).unwrap();
    let ServerResponse::Reply { id, result } = response_for(request).unwrap() else {
        panic!("typed connection authorization response required")
    };
    assert_eq!(id, RequestId::String("original-file-request".into()));
    assert_eq!(result, json!({"action":"unavailable"}));
}

#[test]
fn non_interactive_exec_does_not_open_a_browser_or_claim_authorization() {
    let request = ServerRequest::AccountAuthorize {
        id: RequestId::String("original-request".into()),
        params: serde_json::from_value(json!({
            "threadId":"thread", "authUrl":"https://core.test/api/v1/client/auth/authorize",
            "authorization":{"id":"original", "resource":"web", "status":"pending", "expiresAt":"2030-01-01T00:00:00Z"}
        })).unwrap(),
    };
    match response_for(request).unwrap() {
        ServerResponse::Reply { id, result } => {
            assert_eq!(id, RequestId::String("original-request".into()));
            assert_eq!(result, json!({"action":"unavailable"}));
        }
        ServerResponse::Reject { .. } => panic!("typed authorization response required"),
    }
}

#[test]
fn typed_interactions_never_grant_consent_or_invent_user_answers() {
    let scope = json!({"threadId":"thread", "turnId":"turn", "itemId":"item", "startedAtMs":1});
    for (method, extra, expected) in [
        (
            "item/commandExecution/requestApproval",
            json!({}),
            json!({"decision":"cancel"}),
        ),
        (
            "item/fileChange/requestApproval",
            json!({}),
            json!({"decision":"cancel"}),
        ),
        (
            "item/permissions/requestApproval",
            json!({"cwd":"/workspace", "permissions":{}}),
            json!({"permissions":{}, "scope":"turn"}),
        ),
        (
            "item/tool/requestUserInput",
            json!({"questions":[], "isBlocking":true}),
            json!({"answers":{}}),
        ),
    ] {
        let mut params = scope.clone();
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let request =
            serde_json::from_value(json!({"method":method, "id":"exact-request", "params":params}))
                .unwrap();
        let ServerResponse::Reply { id, result } = response_for(request).unwrap() else {
            panic!("expected typed response for {method}")
        };
        assert_eq!(id, RequestId::String("exact-request".into()));
        assert_eq!(result, expected, "method={method}");
    }
}

#[test]
fn mcp_elicitation_is_canceled_for_parent_and_attached_child_threads() {
    for (thread, request_id) in [
        ("parent-thread", RequestId::Integer(7)),
        ("child-thread", RequestId::String("child-request".into())),
    ] {
        let request = serde_json::from_value(json!({
            "method": "mcpServer/elicitation/request", "id": request_id,
            "params": {
                "threadId": thread, "serverName": "server", "mode": "form",
                "message": "input", "requestedSchema": {"type": "object"},
                "_meta": {"fixture": "request-only"}
            }
        }))
        .unwrap();
        let ServerResponse::Reply { id, result } = response_for(request).unwrap() else {
            panic!("non-interactive client must cancel elicitation for {thread}")
        };
        assert_eq!(id, request_id);
        assert_eq!(result, json!({"action": "cancel"}));
        serde_json::from_value::<McpServerElicitationRequestResponse>(result)
            .unwrap()
            .validate()
            .unwrap();
    }
}
