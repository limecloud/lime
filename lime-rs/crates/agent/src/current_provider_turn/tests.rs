use super::*;
use async_trait::async_trait;
use rmcp::model::{CallToolResult, Content, JsonObject, ListToolsResult};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tool_runtime::mcp_connection::{McpConnection, McpConnectionCall, McpConnectionError};
use tool_runtime::tool_call::ToolEnvironment;
use tool_runtime::tool_executor::{RuntimeToolExecutionRequest, RuntimeToolPolicyErrorKind};
use tool_runtime::tool_extension::RuntimeExtensionConfig;
use tool_runtime::tool_io::{
    ToolIoPayloadStats, ToolOutputReference, ToolOutputTruncation, ToolOutputTruncationReason,
};
use tool_runtime::tool_result_projection::NormalizedToolOutput;

struct HangingMcpConnection;

#[async_trait]
impl McpConnection for HangingMcpConnection {
    async fn list_tools(
        &self,
        _next_cursor: Option<String>,
        _cancel_token: CancellationToken,
    ) -> Result<ListToolsResult, McpConnectionError> {
        std::future::pending().await
    }

    async fn start_call_tool(
        &self,
        _name: &str,
        _arguments: Option<JsonObject>,
        _scope: &tool_runtime::mcp_connection::McpCallScope,
        _cancel_token: CancellationToken,
    ) -> Result<McpConnectionCall, McpConnectionError> {
        Ok(McpConnectionCall {
            response: Box::pin(std::future::pending()),
            notifications: Box::pin(futures::stream::empty()),
        })
    }
}

#[test]
fn tool_result_projection_keeps_text_and_structured_content() {
    let result = project_call_result(Ok(CallToolResult {
        content: vec![Content::text("workspace result")],
        structured_content: Some(serde_json::json!({ "path": "README.md" })),
        is_error: Some(false),
        meta: None,
    }))
    .expect("tool result");

    assert!(result.success);
    assert_eq!(result.output, "workspace result");
    assert_eq!(
        result.structured_content,
        Some(serde_json::json!({ "path": "README.md" }))
    );
    assert!(!result.metadata.contains_key("structured_content"));
}

#[test]
fn lifecycle_projection_preserves_normalized_terminal_output() {
    let (sender, _receiver) = mpsc::unbounded_channel();
    let emitter = CurrentTurnToolLifecycleEmitter::new(sender, "session-1", "thread-1");
    let started = emitter
        .project(ToolLifecycleEvent {
            turn_id: "turn-1".to_string(),
            call_id: "call-1".to_string(),
            tool_name: "Read".to_string(),
            arguments: serde_json::json!({ "path": "README.md" }),
            provider_metadata: serde_json::json!({
                "google": { "thoughtSignature": "sig" }
            }),
            environments: vec![ToolEnvironment::new("local", PathBuf::from("/workspace"))],
            phase: ToolLifecyclePhase::Started,
            output: None,
        })
        .expect("started lifecycle projection");
    let AgentEvent::ItemStarted { item: started } = started else {
        panic!("expected canonical item started event");
    };
    assert_eq!(started.session_id.as_str(), "session-1");
    assert_eq!(started.thread_id.as_str(), "thread-1");
    assert_eq!(started.turn_id.as_str(), "turn-1");
    assert_eq!(started.item_id.as_str(), "item_call-1");
    assert_eq!(started.status, ItemStatus::InProgress);
    let ThreadItemPayload::Tool {
        call_id,
        name,
        arguments,
        output,
    } = &started.payload
    else {
        panic!("expected canonical tool payload");
    };
    assert_eq!(call_id, "call-1");
    assert_eq!(name, "Read");
    assert_eq!(arguments[0].name, "path");
    assert_eq!(arguments[0].value, "README.md");
    assert!(output.is_none());
    assert_eq!(
        started.metadata["provider_metadata"]["google"]["thoughtSignature"],
        "sig"
    );

    let projected = emitter
        .project(ToolLifecycleEvent {
            turn_id: "turn-1".to_string(),
            call_id: "call-1".to_string(),
            tool_name: "Read".to_string(),
            arguments: serde_json::json!({ "path": "README.md" }),
            provider_metadata: serde_json::json!({
                "google": { "thoughtSignature": "sig" }
            }),
            environments: vec![ToolEnvironment::new("local", PathBuf::from("/workspace"))],
            phase: ToolLifecyclePhase::Completed,
            output: Some(NormalizedToolOutput {
                history_token_limit: None,
                success: true,
                text: "preview".to_string(),
                structured_content: Some(serde_json::json!({ "rows": 3 })),
                error: None,
                duration_ms: 42,
                truncation: Some(ToolOutputTruncation::new(
                    ToolOutputTruncationReason::PayloadOffloaded,
                    ToolIoPayloadStats {
                        chars: 12_000,
                        bytes: 12_000,
                        tokens: 3_000,
                    },
                )),
                sidecar_reference: Some(ToolOutputReference::new(
                    "sidecar://tool-output-1",
                    Some("preview".to_string()),
                )),
                metadata: HashMap::from([("source".to_string(), serde_json::json!("mcp"))]),
                agent_control_projection_facts: Vec::new(),
                agent_control_state_facts: Vec::new(),
            }),
        })
        .expect("completed lifecycle projection");

    let AgentEvent::ItemCompleted { item } = projected else {
        panic!("expected canonical item completed event");
    };
    assert_eq!(item.session_id.as_str(), "session-1");
    assert_eq!(item.thread_id.as_str(), "thread-1");
    assert_eq!(item.turn_id.as_str(), "turn-1");
    assert_eq!(item.item_id, started.item_id);
    assert_eq!(item.ordinal, started.ordinal);
    assert_eq!(item.created_at_ms, started.created_at_ms);
    assert_eq!(item.status, ItemStatus::Completed);
    let ThreadItemPayload::Tool {
        call_id,
        name,
        arguments,
        output,
    } = item.payload
    else {
        panic!("expected canonical tool payload");
    };
    assert_eq!(call_id, "call-1");
    assert_eq!(name, "Read");
    assert_eq!(arguments[0].value, "README.md");
    let output = output.expect("canonical terminal output");
    assert_eq!(output.text.as_deref(), Some("preview"));
    assert_eq!(
        output.structured_content,
        Some(serde_json::json!({ "rows": 3 }))
    );
    assert_eq!(output.duration_ms, Some(42));
    assert!(output.truncated);
    assert_eq!(
        output.output_ref.as_deref(),
        Some("sidecar://tool-output-1")
    );
    let metadata = item.metadata.as_object().expect("canonical item metadata");
    assert_eq!(metadata.get("source"), Some(&serde_json::json!("mcp")));
    assert_eq!(metadata.get("duration_ms"), Some(&serde_json::json!(42)));
    assert_eq!(
        metadata
            .get("truncation")
            .and_then(|value| value.get("reason")),
        Some(&serde_json::json!("payload_offloaded"))
    );
    assert_eq!(
        metadata
            .get("sidecar_reference")
            .and_then(|value| value.get("reference")),
        Some(&serde_json::json!("sidecar://tool-output-1"))
    );
    assert_eq!(metadata["environments"][0]["environmentId"], "local");
    assert_eq!(metadata["environments"][0]["cwd"], "/workspace");
    assert_eq!(
        metadata["provider_metadata"]["google"]["thoughtSignature"],
        "sig"
    );
}

#[test]
fn lifecycle_projection_maps_failed_output_to_failed_item() {
    let (sender, _receiver) = mpsc::unbounded_channel();
    let emitter = CurrentTurnToolLifecycleEmitter::new(sender, "session-1", "thread-1");
    let output_metadata = HashMap::from([
        ("command".to_string(), serde_json::json!("false")),
        ("command_output".to_string(), serde_json::json!("failed")),
        ("exit_code".to_string(), serde_json::json!(1)),
    ]);
    let mut projected = emitter
        .project_all(ToolLifecycleEvent {
            turn_id: "turn-1".to_string(),
            call_id: "call-failed".to_string(),
            tool_name: "exec_command".to_string(),
            arguments: serde_json::json!({ "command": "false" }),
            provider_metadata: serde_json::Value::Null,
            environments: Vec::new(),
            phase: ToolLifecyclePhase::Completed,
            output: Some(NormalizedToolOutput {
                history_token_limit: None,
                success: false,
                text: "failed".to_string(),
                structured_content: None,
                error: Some("exit code 1".to_string()),
                duration_ms: 3,
                truncation: None,
                sidecar_reference: None,
                metadata: output_metadata,
                agent_control_projection_facts: Vec::new(),
                agent_control_state_facts: Vec::new(),
            }),
        })
        .into_iter();

    let Some(AgentEvent::ItemStarted { item: pending }) = projected.next() else {
        panic!("expected rejected invocation start");
    };
    assert!(pending.metadata.get("processId").is_none());
    assert_eq!(pending.metadata["commandArgv"], serde_json::json!([]));
    let projected = projected.next().expect("failed lifecycle projection");

    let AgentEvent::ItemCompleted { item } = projected else {
        panic!("expected canonical item completed event");
    };
    assert_eq!(item.status, ItemStatus::Failed);
    let ThreadItemPayload::Command {
        command,
        output,
        exit_code,
        ..
    } = item.payload
    else {
        panic!("expected canonical command payload");
    };
    assert_eq!(command, "false");
    assert_eq!(output.as_deref(), Some("failed"));
    assert_eq!(exit_code, Some(1));
}

#[tokio::test]
async fn ready_lifecycle_and_policy_events_keep_start_action_end_order() {
    let (host_sender, mut host_receiver) = mpsc::unbounded_channel();
    let (agent_sender, mut agent_receiver) = mpsc::unbounded_channel();
    let emitter = CurrentTurnToolLifecycleEmitter::new(host_sender, "session-1", "thread-1");
    let environment = vec![ToolEnvironment::new("local", PathBuf::from("/workspace"))];

    emitter
        .emit(ToolLifecycleEvent {
            turn_id: "turn-1".to_string(),
            call_id: "call-1".to_string(),
            tool_name: "Read".to_string(),
            arguments: serde_json::json!({ "path": "README.md" }),
            provider_metadata: serde_json::Value::Null,
            environments: environment.clone(),
            phase: ToolLifecyclePhase::Started,
            output: None,
        })
        .await;
    agent_sender
        .send(AgentEvent::ActionRequired {
            request_id: "approval-1".to_string(),
            action_type: "tool_confirmation".to_string(),
            data: serde_json::json!({ "toolCallId": "call-1" }),
            scope: None,
        })
        .expect("queue policy event");
    emitter
        .emit(ToolLifecycleEvent {
            turn_id: "turn-1".to_string(),
            call_id: "call-1".to_string(),
            tool_name: "Read".to_string(),
            arguments: serde_json::json!({ "path": "README.md" }),
            provider_metadata: serde_json::Value::Null,
            environments: environment,
            phase: ToolLifecyclePhase::Completed,
            output: Some(NormalizedToolOutput {
                history_token_limit: None,
                success: true,
                text: "done".to_string(),
                structured_content: None,
                error: None,
                duration_ms: 1,
                truncation: None,
                sidecar_reference: None,
                metadata: HashMap::new(),
                agent_control_projection_facts: Vec::new(),
                agent_control_state_facts: Vec::new(),
            }),
        })
        .await;

    let policy = RequestToolPolicy {
        search_mode: crate::request_tool_policy::RequestToolPolicyMode::Disabled,
        effective_web_search: false,
        web_search_mode: agent_protocol::WebSearchMode::Disabled,
        required_tools: Vec::new(),
        allowed_tools: Vec::new(),
        disallowed_tools: Vec::new(),
    };
    let mut artifacts = WriteArtifactEventEmitter::new("session-1".to_string());
    let mut tracker = WebSearchExecutionTracker::default();
    let mut usage = None;
    let mut order = Vec::new();
    drain_ready_turn_events(
        &mut host_receiver,
        &mut agent_receiver,
        "provider",
        &policy,
        &mut artifacts,
        &mut tracker,
        &mut usage,
        &mut |event| match event {
            AgentEvent::ItemStarted { .. } => order.push("item.started"),
            AgentEvent::ActionRequired { .. } => order.push("action.required"),
            AgentEvent::ItemCompleted { .. } => order.push("item.completed"),
            _ => {}
        },
    );

    assert_eq!(order, ["item.started", "action.required", "item.completed"]);
}

#[test]
fn request_policy_hides_disallowed_tools() {
    let policy = RequestToolPolicy {
        search_mode: crate::request_tool_policy::RequestToolPolicyMode::Disabled,
        effective_web_search: false,
        web_search_mode: agent_protocol::WebSearchMode::Disabled,
        required_tools: Vec::new(),
        allowed_tools: Vec::new(),
        disallowed_tools: vec!["WebSearch".to_string()],
    };

    assert!(policy.matches_any_disallowed_tool("web_search"));
}

#[test]
fn action_scope_uses_typed_call_identity_and_canonical_thread() {
    let context = tool_runtime::tool_executor::RuntimeToolExecutionContext::new(
        tool_runtime::tool_executor::RuntimeToolExecutionContextInput {
            working_directory: PathBuf::from("/workspace"),
            session_id: "session-canonical".to_string(),
            cancel_token: None,
            workspace_sandbox: None,
        },
    )
    .with_tool_identity(
        tool_runtime::tool_executor::RuntimeToolExecutionIdentity::new(
            "call-canonical",
            "turn-canonical",
        ),
    );
    let turn_context = tool_runtime::tool_executor::RuntimeToolTurnContext {
        metadata: HashMap::from([
            (
                "thread_id".to_string(),
                serde_json::json!("thread-metadata"),
            ),
            ("turn_id".to_string(), serde_json::json!("turn-metadata")),
            (
                "tool_call_id".to_string(),
                serde_json::json!("call-metadata"),
            ),
        ]),
        ..tool_runtime::tool_executor::RuntimeToolTurnContext::default()
    };
    let params = serde_json::json!({});

    let (scope, call_id) = action_scope(
        RuntimeToolExecutionRequest {
            tool_name: "exec_command",
            params: &params,
            context: &context,
            turn_context: Some(&turn_context),
        },
        &ThreadId::new("thread-canonical"),
    )
    .expect("typed tool identity should form approval scope");

    let scope = scope.expect("canonical action scope");
    assert_eq!(scope.session_id.as_deref(), Some("session-canonical"));
    assert_eq!(scope.thread_id.as_deref(), Some("thread-canonical"));
    assert_ne!(scope.thread_id, scope.session_id);
    assert_eq!(scope.turn_id.as_deref(), Some("turn-canonical"));
    assert_eq!(call_id, "call-canonical");
}

#[test]
fn action_scope_fails_closed_without_typed_call_identity() {
    let context = tool_runtime::tool_executor::RuntimeToolExecutionContext::new(
        tool_runtime::tool_executor::RuntimeToolExecutionContextInput {
            working_directory: PathBuf::from("/workspace"),
            session_id: "session-1".to_string(),
            cancel_token: None,
            workspace_sandbox: None,
        },
    );
    let turn_context = tool_runtime::tool_executor::RuntimeToolTurnContext {
        metadata: HashMap::from([
            (
                "thread_id".to_string(),
                serde_json::json!("thread-metadata"),
            ),
            ("turn_id".to_string(), serde_json::json!("turn-metadata")),
            (
                "tool_call_id".to_string(),
                serde_json::json!("call-metadata"),
            ),
        ]),
        ..tool_runtime::tool_executor::RuntimeToolTurnContext::default()
    };
    let params = serde_json::json!({});

    let error = action_scope(
        RuntimeToolExecutionRequest {
            tool_name: "exec_command",
            params: &params,
            context: &context,
            turn_context: Some(&turn_context),
        },
        &ThreadId::new("thread-1"),
    )
    .expect_err("metadata identity must not revive an unidentified tool request");

    assert_eq!(
        error.message(),
        "tool approval requires canonical tool identity"
    );
    assert!(matches!(
        error.policy_kind(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(reason))
            if reason == "tool_approval_identity_missing"
    ));
}

#[test]
fn mcp_call_scope_uses_canonical_execution_identity() {
    let context = tool_runtime::tool_executor::RuntimeToolExecutionContext::new(
        tool_runtime::tool_executor::RuntimeToolExecutionContextInput {
            working_directory: PathBuf::from("/workspace"),
            session_id: "session-canonical".to_string(),
            cancel_token: None,
            workspace_sandbox: None,
        },
    )
    .with_tool_identity(
        tool_runtime::tool_executor::RuntimeToolExecutionIdentity::new(
            "call-canonical",
            "turn-canonical",
        ),
    );
    let turn_context = tool_runtime::tool_executor::RuntimeToolTurnContext {
        metadata: HashMap::from([
            (
                "thread_id".to_string(),
                serde_json::json!("thread-metadata"),
            ),
            ("turn_id".to_string(), serde_json::json!("turn-metadata")),
            (
                "tool_call_id".to_string(),
                serde_json::json!("call-metadata"),
            ),
        ]),
        ..tool_runtime::tool_executor::RuntimeToolTurnContext::default()
    };
    let params = serde_json::json!({});

    let scope = mcp_call_scope(RuntimeToolExecutionRequest {
        tool_name: "mcp_search",
        params: &params,
        context: &context,
        turn_context: Some(&turn_context),
    })
    .expect("canonical execution identity should form MCP call scope");

    assert_eq!(scope.turn_id(), Some("turn-canonical"));
}

#[test]
fn mcp_call_scope_fails_closed_without_typed_call_identity() {
    let context = tool_runtime::tool_executor::RuntimeToolExecutionContext::new(
        tool_runtime::tool_executor::RuntimeToolExecutionContextInput {
            working_directory: PathBuf::from("/workspace"),
            session_id: "session-1".to_string(),
            cancel_token: None,
            workspace_sandbox: None,
        },
    );
    let turn_context = tool_runtime::tool_executor::RuntimeToolTurnContext {
        metadata: HashMap::from([
            ("turn_id".to_string(), serde_json::json!("turn-metadata")),
            (
                "tool_call_id".to_string(),
                serde_json::json!("call-metadata"),
            ),
        ]),
        ..tool_runtime::tool_executor::RuntimeToolTurnContext::default()
    };
    let params = serde_json::json!({});

    let error = mcp_call_scope(RuntimeToolExecutionRequest {
        tool_name: "mcp_search",
        params: &params,
        context: &context,
        turn_context: Some(&turn_context),
    })
    .expect_err("metadata identity must not revive an unidentified MCP call");

    assert_eq!(error.message(), "MCP call requires canonical tool identity");
    assert!(matches!(
        error.policy_kind(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(reason))
            if reason == "mcp_call_scope_missing"
    ));
}

#[tokio::test]
async fn mcp_tool_discovery_timeout_keeps_main_turn_unblocked() {
    let state = AgentRuntimeState::new();
    let runtime = Arc::new(crate::runtime_state::McpThreadRuntime::for_test(
        "session-1",
        "thread-1",
    ));
    runtime
        .connections()
        .register(
            "slow".to_string(),
            RuntimeExtensionConfig::new(
                "slow",
                "slow MCP fixture",
                vec!["search".to_string()],
                false,
                vec!["search".to_string()],
                None,
            ),
            tool_runtime::mcp_connection::McpConnectionProvenance::default(),
            false,
            Arc::new(Mutex::new(Box::new(HangingMcpConnection))),
        )
        .await;

    let snapshot = tokio::time::timeout(
        Duration::from_millis(200),
        mcp_step_snapshot::mcp_step_snapshot(
            &state,
            "session-1",
            &ThreadId::new("thread-1"),
            Duration::from_millis(10),
            &mcp_step_snapshot::DeferredToolSelections::default(),
        ),
    )
    .await
    .expect("MCP discovery timeout should return control to the main turn");

    assert!(snapshot.tools().is_empty());
    assert_eq!(runtime.connections().names().await, vec!["slow"]);
}
