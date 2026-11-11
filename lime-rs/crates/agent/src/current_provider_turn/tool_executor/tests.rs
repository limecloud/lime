use super::*;
use agent_runtime::action_required::ActionRequiredRequest;
use app_server_protocol::protocol::v2::GrantedPermissionProfile;
use rmcp::model::{
    Content, NumberOrString, ProgressNotification, ProgressNotificationParam, ProgressToken,
    PromptListChangedNotification, ResourceListChangedNotification, ToolListChangedNotification,
};

#[test]
fn request_user_input_blocking_follows_collaboration_mode() {
    assert!(request_user_input_is_blocking(None));

    let mut context = tool_runtime::tool_executor::RuntimeToolTurnContext {
        collaboration_mode: Some(agent_protocol::CollaborationMode {
            mode: ModeKind::Default,
            settings: agent_protocol::CollaborationModeSettings::default(),
        }),
        ..Default::default()
    };
    assert!(!request_user_input_is_blocking(Some(&context)));

    context
        .collaboration_mode
        .as_mut()
        .expect("collaboration mode")
        .mode = ModeKind::Plan;
    assert!(request_user_input_is_blocking(Some(&context)));
}

#[test]
fn shell_tool_approval_materializes_current_projection() {
    let metadata = HashMap::from([
        (
            "reasonCode".to_string(),
            serde_json::json!("shell_command_requires_approval"),
        ),
        ("cwd".to_string(), serde_json::json!("/Users/coso/project")),
    ]);
    let approval =
        tool_runtime::execution_approval::execution_approval_projection("exec_command", &metadata);
    let queued = ActionRequiredRequest {
        id: "approval-1".to_string(),
        action_type: agent_protocol::action_required::TOOL_CONFIRMATION_ACTION_TYPE.to_string(),
        tool_id: Some("call-1".to_string()),
        message: "Allow?".to_string(),
        requested_schema: serde_json::json!({}),
        available_decisions: approval.available_decisions.clone(),
        scope: None,
        created_at_ms: Some(1),
        deadline_at_ms: Some(2),
    };

    let projection = approval::materialize_tool_approval_action(
        &queued,
        "exec_command",
        &serde_json::json!({ "cmd": "cargo test" }),
        "Allow?",
        &approval,
    );

    assert_eq!(projection.data["actionKind"], "tool_execution_policy");
    assert_eq!(projection.data["action_kind"], "tool_execution_policy");
    assert_eq!(projection.data["toolFamily"], "shell_command");
    assert_eq!(projection.data["tool_family"], "shell_command");
    assert_eq!(projection.data["contractKey"], "shell_command");
    assert_eq!(projection.data["contract_key"], "shell_command");
    assert_eq!(
        projection.data["runtime_contract"]["session_cache_supported"],
        false
    );
    assert_eq!(
        projection.data["availableDecisions"],
        serde_json::json!(["allow_once", "decline", "cancel"])
    );
    assert_eq!(projection.data["arguments"]["cmd"], "cargo test");
    assert_eq!(projection.data["prompt"], "Allow?");
    assert!(projection.data["approvalScope"].get("cwd").is_none());
    assert!(!projection.data["approvalScope"]
        .to_string()
        .contains("/Users/coso/project"));
    assert_eq!(
        projection.data["approvalScope"],
        projection.data["approval_scope"]
    );
}

#[test]
fn permission_context_accepts_only_recorded_strict_review_state() {
    let source = tool_runtime::tool_executor::RuntimeToolTurnContext {
        metadata: HashMap::from([
            (
                GRANTED_PERMISSIONS_METADATA_KEY.to_string(),
                serde_json::json!({ "network": { "enabled": true } }),
            ),
            (
                STRICT_AUTO_REVIEW_METADATA_KEY.to_string(),
                Value::Bool(true),
            ),
            ("safe".to_string(), Value::String("kept".to_string())),
        ]),
        ..Default::default()
    };
    let sanitized =
        trusted_permission_turn_context(Some(&source), &EffectivePermissionGrant::default())
            .expect("sanitized turn context");
    assert!(!sanitized
        .metadata
        .contains_key(GRANTED_PERMISSIONS_METADATA_KEY));
    assert!(!sanitized
        .metadata
        .contains_key(STRICT_AUTO_REVIEW_METADATA_KEY));
    assert_eq!(
        sanitized.metadata.get("safe"),
        Some(&serde_json::json!("kept"))
    );

    let trusted = trusted_permission_turn_context(
        Some(&source),
        &EffectivePermissionGrant {
            permissions: GrantedPermissionProfile::default(),
            strict_auto_review: true,
        },
    )
    .expect("trusted turn context");
    assert_eq!(
        trusted.metadata.get(STRICT_AUTO_REVIEW_METADATA_KEY),
        Some(&Value::Bool(true))
    );
}

#[tokio::test]
async fn mcp_call_emits_only_non_empty_progress_notifications() {
    let call = tool_runtime::mcp_connection::McpConnectionCall {
        response: Box::pin(async {
            tokio::task::yield_now().await;
            Ok(CallToolResult::success(vec![Content::text("done")]))
        }),
        notifications: Box::pin(futures::stream::iter([
            progress_notification(Some("   ")),
            progress_notification(Some("正在检索文档")),
        ])),
    };
    let (event_sender, mut event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let route = tool_runtime::mcp_connection::McpStepRouteIdentity {
        server_name: "docs".to_string(),
        tool_name: "search".to_string(),
        runtime_tool_name: "mcp__docs__search".to_string(),
        app_context: None,
        mcp_app_resource_uri: None,
        plugin_id: None,
    };

    let result = await_mcp_call(&event_sender, "mcp-call-1", &route, call)
        .await
        .expect("MCP result");

    assert_eq!(result.output, "done");
    let AgentEvent::ToolProgress { tool_id, progress } =
        event_receiver.try_recv().expect("MCP progress event")
    else {
        panic!("expected MCP progress event");
    };
    assert_eq!(tool_id, "mcp-call-1");
    assert_eq!(progress.message.as_deref(), Some("正在检索文档"));
    assert_eq!(
        progress
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("notification_kind"))
            .and_then(Value::as_str),
        Some("mcp_progress")
    );
    assert_eq!(
        progress
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("server_name"))
            .and_then(Value::as_str),
        Some("docs")
    );
    assert_eq!(
        progress
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("tool_name"))
            .and_then(Value::as_str),
        Some("search")
    );
    assert!(event_receiver.try_recv().is_err());
}

#[tokio::test]
async fn mcp_call_emits_supported_list_changed_notifications() {
    let call = tool_runtime::mcp_connection::McpConnectionCall {
        response: Box::pin(async {
            tokio::task::yield_now().await;
            Ok(CallToolResult::success(vec![Content::text("done")]))
        }),
        notifications: Box::pin(futures::stream::iter([
            ServerNotification::ToolListChangedNotification(ToolListChangedNotification {
                method: Default::default(),
                extensions: Default::default(),
            }),
            ServerNotification::PromptListChangedNotification(PromptListChangedNotification {
                method: Default::default(),
                extensions: Default::default(),
            }),
            ServerNotification::ResourceListChangedNotification(ResourceListChangedNotification {
                method: Default::default(),
                extensions: Default::default(),
            }),
        ])),
    };
    let (event_sender, mut event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let route = tool_runtime::mcp_connection::McpStepRouteIdentity {
        server_name: "docs".to_string(),
        tool_name: "search".to_string(),
        runtime_tool_name: "mcp__docs__search".to_string(),
        app_context: None,
        mcp_app_resource_uri: None,
        plugin_id: None,
    };

    await_mcp_call(&event_sender, "mcp-call-1", &route, call)
        .await
        .expect("MCP result");

    let mut kinds = Vec::new();
    while let Ok(AgentEvent::ToolProgress { progress, .. }) = event_receiver.try_recv() {
        kinds.push(
            progress
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("notification_kind"))
                .and_then(Value::as_str)
                .expect("notification kind")
                .to_string(),
        );
    }
    assert_eq!(
        kinds,
        vec![
            "mcp_tools_changed".to_string(),
            "mcp_prompts_changed".to_string(),
            "mcp_resources_changed".to_string(),
        ]
    );
}

fn progress_notification(message: Option<&str>) -> ServerNotification {
    ServerNotification::ProgressNotification(ProgressNotification::new(ProgressNotificationParam {
        progress_token: ProgressToken(NumberOrString::Number(1)),
        progress: 1.0,
        total: Some(2.0),
        message: message.map(str::to_string),
    }))
}
