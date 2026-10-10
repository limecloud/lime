use super::common::create_test_client;
use crate::elicitation::{ElicitationAction, ElicitationRequestRouter, ElicitationResponse};
use crate::manager::McpClientManager;
use rmcp::model::{
    CallToolRequestParam, CallToolResult, CreateElicitationRequestParam, ElicitationSchema,
    PrimitiveSchema, StringSchema,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ServerHandler, ServiceExt};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
struct FormServer;

impl ServerHandler for FormServer {
    async fn call_tool(
        &self,
        _request: CallToolRequestParam,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let result = context
            .peer
            .create_elicitation(CreateElicitationRequestParam {
                message: "Provide a name".into(),
                requested_schema: ElicitationSchema::builder()
                    .required_property("name", PrimitiveSchema::String(StringSchema::new()))
                    .build()
                    .unwrap(),
            })
            .await
            .map_err(|error| rmcp::ErrorData::internal_error(error.to_string(), None))?;
        Ok(CallToolResult {
            content: vec![],
            structured_content: Some(serde_json::to_value(result).unwrap()),
            is_error: Some(false),
            meta: None,
        })
    }
}

async fn exercise_explicit_tool_call(runtime: bool) {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().unwrap();
    let manager = Arc::new(if runtime {
        McpClientManager::new_runtime(None, router.clone(), "session-form", "thread-form")
    } else {
        McpClientManager::new(None)
    });
    let (server_transport, client_transport) = tokio::io::duplex(8192);
    let server_task = tokio::spawn(async move {
        FormServer
            .serve(server_transport)
            .await
            .unwrap()
            .waiting()
            .await
            .unwrap();
    });
    let handler = if runtime {
        crate::LimeMcpClientService::with_runtime_elicitation_router(
            "form".into(),
            None,
            router.clone(),
            "session-form".into(),
            "thread-form".into(),
        )
    } else {
        crate::LimeMcpClientService::new("form".into(), None)
    };
    let service = handler.serve(client_transport).await.unwrap();
    let mut client = create_test_client("form");
    client.set_running_service(service);
    manager.add_client("form".into(), client).await.unwrap();
    let caller = Arc::clone(&manager);
    let call = tokio::spawn(async move {
        caller
            .call_tool("mcp__form__name", json!({}))
            .await
            .unwrap()
    });
    if runtime {
        let request = tokio::time::timeout(Duration::from_secs(5), requests.recv())
            .await
            .expect("thread-owned explicit tool call must route its form")
            .unwrap();
        assert_eq!(request.thread_id, "thread-form");
        assert_eq!(request.turn_id, None);
        assert_eq!(request.server_name, "form");
        router
            .resolve(
                &request.id,
                ElicitationResponse::try_from_parts(
                    ElicitationAction::Accept,
                    Some(json!({"name": "Ada"})),
                )
                .unwrap(),
            )
            .await
            .unwrap();
    }
    let result = tokio::time::timeout(Duration::from_secs(5), call)
        .await
        .expect("explicit MCP tool call must finish")
        .unwrap();
    assert_eq!(
        result.structured_content,
        Some(if runtime {
            json!({"action": "accept", "content": {"name": "Ada"}})
        } else {
            json!({"action": "decline"})
        })
    );
    assert!(requests.try_recv().is_err());
    manager.stop_server("form").await.unwrap();
    server_task.await.unwrap();
}

#[tokio::test]
async fn thread_tool_call_without_turn_routes_and_resolves_form() {
    exercise_explicit_tool_call(true).await;
}

#[tokio::test]
async fn management_tool_call_declines_form_without_routing() {
    exercise_explicit_tool_call(false).await;
}
