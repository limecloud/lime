use super::*;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tool_runtime::tool_call::ToolEnvironment;
use tool_runtime::tool_result_projection::NormalizedToolOutput;

#[tokio::test]
async fn code_cell_evidence_is_forwarded_before_public_exec_item_projection() {
    let (event_sender, mut events) = tokio::sync::mpsc::unbounded_channel();
    let emitter = Arc::new(CurrentTurnToolLifecycleEmitter::new(
        event_sender,
        "session-code-mode",
        "thread-code-mode",
    ));
    let call = tool_runtime::tool_call::ToolCall::new(
        "turn-code-mode",
        "exec-call-1",
        "exec",
        serde_json::Value::String("text('ok')".to_string()),
        Vec::new(),
        emitter.clone(),
    );
    emitter.emit(ToolLifecycleEvent::started(&call)).await;

    assert!(matches!(
        events.recv().await,
        Some(CurrentTurnHostEvent::ToolLifecycle(AgentEvent::CodeCellTrace {
            event: CodeCellTraceEvent::SourceItemObserved {
                model_visible_call_id,
                source_item_id,
                ..
            }
        })) if model_visible_call_id == "exec-call-1" && source_item_id == "item_exec-call-1"
    ));
    assert!(matches!(
        events.recv().await,
        Some(CurrentTurnHostEvent::ToolLifecycle(AgentEvent::ItemStarted { item }))
            if item.item_id.as_str() == "item_exec-call-1"
    ));

    let output = NormalizedToolOutput {
        history_token_limit: None,
        success: true,
        text: "Script completed".to_string(),
        structured_content: None,
        error: None,
        duration_ms: 1,
        truncation: None,
        sidecar_reference: None,
        metadata: HashMap::from([(
            "code_mode_cell_id".to_string(),
            serde_json::Value::String("cell-1".to_string()),
        )]),
        agent_control_projection_facts: Vec::new(),
        agent_control_state_facts: Vec::new(),
    };
    emitter
        .emit(ToolLifecycleEvent::completed(&call, output))
        .await;
    assert!(matches!(
        events.recv().await,
        Some(CurrentTurnHostEvent::ToolLifecycle(AgentEvent::CodeCellTrace {
            event: CodeCellTraceEvent::OutputItemObserved {
                runtime_cell_id,
                output_item_id,
                ..
            }
        })) if runtime_cell_id == "cell-1" && output_item_id == "item_exec-call-1"
    ));
    assert!(matches!(
        events.recv().await,
        Some(CurrentTurnHostEvent::ToolLifecycle(AgentEvent::ItemCompleted { item }))
            if item.item_id.as_str() == "item_exec-call-1"
    ));
}

#[tokio::test]
async fn output_delta_keeps_code_mode_call_and_cell_correlation() {
    let (event_sender, mut events) = tokio::sync::mpsc::unbounded_channel();
    let emitter =
        CurrentTurnToolLifecycleEmitter::new(event_sender, "session-code-mode", "thread-code-mode");
    emitter
        .emit_output_delta(ToolOutputDeltaEvent {
            turn_id: "turn-code-mode".to_string(),
            call_id: "exec-call-1".to_string(),
            tool_name: "exec".to_string(),
            delta: "cell update".to_string(),
            output_kind: Some("code_mode_notify".to_string()),
            metadata: HashMap::from([(
                "code_mode_cell_id".to_string(),
                serde_json::Value::String("cell-1".to_string()),
            )]),
        })
        .await;

    let CurrentTurnHostEvent::ToolLifecycle(AgentEvent::ToolOutputDelta {
        tool_id,
        delta,
        output_kind,
        metadata,
    }) = events.recv().await.expect("output delta event")
    else {
        panic!("expected canonical tool output delta")
    };
    assert_eq!(tool_id, "exec-call-1");
    assert_eq!(delta, "cell update");
    assert_eq!(output_kind.as_deref(), Some("code_mode_notify"));
    let metadata = metadata.expect("output delta metadata");
    assert_eq!(
        metadata
            .get("code_mode_cell_id")
            .and_then(serde_json::Value::as_str),
        Some("cell-1")
    );
    assert_eq!(
        metadata.get("turn_id").and_then(serde_json::Value::as_str),
        Some("turn-code-mode")
    );
    assert_eq!(
        metadata
            .get("tool_name")
            .and_then(serde_json::Value::as_str),
        Some("exec")
    );
}

#[test]
fn exact_snapshot_route_projects_mcp_item() {
    let routes = McpToolRoutes::default();
    routes.replace_for_test([tool_runtime::mcp_connection::McpStepRouteIdentity {
        server_name: "lime_apps".to_string(),
        tool_name: "search".to_string(),
        runtime_tool_name: "lime_apps__search".to_string(),
        app_context: Some(tool_runtime::mcp_connection::McpStepRouteAppContext {
            connector_id: "calendar".to_string(),
            link_id: Some("link-calendar".to_string()),
            resource_uri: Some("ui://calendar/event".to_string()),
            app_name: Some("Calendar".to_string()),
            action_name: Some("search".to_string()),
        }),
        mcp_app_resource_uri: Some("ui://calendar/event".to_string()),
        plugin_id: None,
    }]);
    let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel();
    let emitter = CurrentTurnToolLifecycleEmitter::with_tool_routes(
        sender,
        "session-1",
        "thread-1",
        routes,
        DynamicToolRoutes::default(),
    );

    let event = emitter
        .project(ToolLifecycleEvent {
            turn_id: "turn-1".to_string(),
            call_id: "mcp-call-1".to_string(),
            tool_name: "lime_apps__search".to_string(),
            arguments: serde_json::json!({ "query": "lime" }),
            provider_metadata: serde_json::Value::Null,
            environments: vec![ToolEnvironment::new("local", PathBuf::from("/workspace"))],
            phase: ToolLifecyclePhase::Started,
            output: None,
        })
        .expect("MCP item started");

    let AgentEvent::ItemStarted { item } = event else {
        panic!("expected item started");
    };
    assert_eq!(item.item_id.as_str(), "item_mcp-call-1");
    assert!(matches!(
        item.payload,
        ThreadItemPayload::McpToolCall {
            ref server_name,
            ref tool_name,
            ref app_context,
            ref mcp_app_resource_uri,
            ref plugin_id,
            ..
        } if server_name == "lime_apps"
            && tool_name == "search"
            && app_context.as_ref().is_some_and(|context|
                context.connector_id == "calendar"
                    && context.link_id.as_deref() == Some("link-calendar")
                    && context.resource_uri.as_deref() == Some("ui://calendar/event")
            )
            && mcp_app_resource_uri.as_deref() == Some("ui://calendar/event")
            && plugin_id.is_none()
    ));
}

#[test]
fn exact_snapshot_route_projects_typed_dynamic_tool_lifecycle() {
    let routes = DynamicToolRoutes::default();
    routes.replace_for_test([DynamicToolRoute {
        runtime_tool_name: "desktop__appInfo".to_string(),
        namespace: Some("desktop".to_string()),
        tool: "appInfo".to_string(),
    }]);
    let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel();
    let emitter = CurrentTurnToolLifecycleEmitter::with_tool_routes(
        sender,
        "session-1",
        "thread-1",
        McpToolRoutes::default(),
        routes,
    );
    let arguments = serde_json::json!({
        "includeLocale": true,
        "options": {"platform": "darwin"}
    });

    let started = emitter
        .project(ToolLifecycleEvent {
            turn_id: "turn-1".to_string(),
            call_id: "dynamic-call-1".to_string(),
            tool_name: "desktop__appInfo".to_string(),
            arguments: arguments.clone(),
            provider_metadata: serde_json::Value::Null,
            environments: Vec::new(),
            phase: ToolLifecyclePhase::Started,
            output: None,
        })
        .expect("dynamic item started");
    let AgentEvent::ItemStarted { item: started } = started else {
        panic!("expected dynamic item started");
    };
    assert_eq!(started.kind, agent_protocol::ItemKind::DynamicToolCall);
    assert!(matches!(
        &started.payload,
        ThreadItemPayload::DynamicToolCall {
            call_id,
            namespace: Some(namespace),
            tool,
            arguments: actual_arguments,
            content_items,
            success: None,
            duration_ms: None,
        } if call_id == "dynamic-call-1"
            && namespace == "desktop"
            && tool == "appInfo"
            && actual_arguments == &arguments
            && content_items.is_empty()
    ));

    let content_items = serde_json::json!([
        {"type": "inputText", "text": "Lime 1.116.0"},
        {"type": "inputImage", "imageUrl": "data:image/png;base64,AA=="},
        {"type": "inputAudio", "audioUrl": "data:audio/wav;base64,AA=="}
    ]);
    let completed = emitter
        .project(ToolLifecycleEvent {
            turn_id: "turn-1".to_string(),
            call_id: "dynamic-call-1".to_string(),
            tool_name: "desktop__appInfo".to_string(),
            arguments: arguments.clone(),
            provider_metadata: serde_json::Value::Null,
            environments: Vec::new(),
            phase: ToolLifecyclePhase::Completed,
            output: Some(NormalizedToolOutput {
                history_token_limit: None,
                success: true,
                text: content_items.to_string(),
                structured_content: Some(content_items.clone()),
                error: None,
                duration_ms: 17,
                truncation: None,
                sidecar_reference: None,
                metadata: HashMap::from([(
                    "dynamic_tool_content_items".to_string(),
                    content_items,
                )]),
                agent_control_projection_facts: Vec::new(),
                agent_control_state_facts: Vec::new(),
            }),
        })
        .expect("dynamic item completed");
    let AgentEvent::ItemCompleted { item: completed } = completed else {
        panic!("expected dynamic item completed");
    };
    assert_eq!(completed.item_id, started.item_id);
    assert_eq!(completed.ordinal, started.ordinal);
    assert_eq!(completed.created_at_ms, started.created_at_ms);
    let ThreadItemPayload::DynamicToolCall {
        call_id,
        namespace,
        tool,
        arguments: actual_arguments,
        content_items,
        success,
        duration_ms,
    } = completed.payload
    else {
        panic!("expected typed dynamic payload");
    };
    assert_eq!(call_id, "dynamic-call-1");
    assert_eq!(namespace.as_deref(), Some("desktop"));
    assert_eq!(tool, "appInfo");
    assert_eq!(actual_arguments, arguments);
    assert_eq!(
        content_items,
        vec![
            DynamicToolCallContentItem::InputText {
                text: "Lime 1.116.0".to_string(),
            },
            DynamicToolCallContentItem::InputImage {
                image_url: "data:image/png;base64,AA==".to_string(),
            },
            DynamicToolCallContentItem::InputAudio {
                audio_url: "data:audio/wav;base64,AA==".to_string(),
            },
        ]
    );
    assert_eq!(success, Some(true));
    assert_eq!(duration_ms, Some(17));
    assert!(completed.metadata.get("dynamic_tool").is_none());
    assert!(completed
        .metadata
        .get("dynamic_tool_content_items")
        .is_none());
    assert!(completed.metadata.get("success").is_none());
    assert!(completed.metadata.get("duration_ms").is_none());
}
