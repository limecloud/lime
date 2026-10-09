use super::*;
use serde_json::json;

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
fn unsupported_mcp_request_is_rejected_with_same_id() {
    let request = serde_json::from_value(json!({"method":"mcpServer/elicitation/request", "id":7,
        "params":{"threadId":"thread", "serverName":"server", "mode":"form", "message":"input", "requestedSchema":{"type":"object"}}
    })).unwrap();
    let ServerResponse::Reject { id, error } = response_for(request).unwrap() else {
        panic!("non-interactive client must reject elicitation")
    };
    assert_eq!(id, RequestId::Integer(7));
    assert_eq!(
        error.code,
        app_server_protocol::error_codes::METHOD_NOT_FOUND
    );
    assert!(error.message.contains("mcpServer/elicitation/request"));
}
