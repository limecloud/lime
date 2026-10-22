use super::*;
use agent_runtime::session_loop::{RuntimeSessionClosureTask, RuntimeSessionRegistry};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tool_runtime::tool_executor::{
    RuntimeToolExecutionContext, RuntimeToolExecutionContextInput, RuntimeToolExecutionIdentity,
};

struct Outcome {
    result: Result<RuntimeToolExecutionResult, RuntimeToolExecutionError>,
    phases: Vec<(DynamicToolCallPhase, Option<String>)>,
    prompts: Vec<Value>,
}

async fn run_stages(namespace: &str, tokens: &[&str], decline_at: Option<usize>) -> Outcome {
    let registry = RuntimeSessionRegistry::default();
    let session = registry
        .get_or_create("session-browser-stages", "thread-browser-stages")
        .await
        .expect("canonical session");
    let state = AgentRuntimeState::new();
    let task_state = state.clone();
    let route = DynamicToolRoute {
        runtime_tool_name: format!("{namespace}__click"),
        namespace: Some(namespace.to_string()),
        tool: "click".to_string(),
    };
    let (event_sender, mut events) = tokio::sync::mpsc::unbounded_channel();
    let (result_sender, mut result_receiver) = tokio::sync::oneshot::channel();
    let result_sender = Arc::new(Mutex::new(Some(result_sender)));
    let task = RuntimeSessionClosureTask::new(
        "turn-browser-stages",
        Vec::new(),
        move |task_context, _, _| {
            let state = task_state.clone();
            let event_sender = event_sender.clone();
            let result_sender = Arc::clone(&result_sender);
            let route = route.clone();
            Box::pin(async move {
                let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
                    working_directory: PathBuf::from("/workspace"),
                    session_id: "session-browser-stages".to_string(),
                    cancel_token: None,
                    workspace_sandbox: None,
                })
                .with_tool_identity(RuntimeToolExecutionIdentity::new(
                    "call-browser-stages",
                    "turn-browser-stages",
                ));
                let params =
                    json!({"tabId":"tab-1", "backendNodeId":11, "snapshotId":"snapshot-1"});
                let result = call_dynamic_tool(
                    RuntimeToolExecutionRequest {
                        tool_name: &route.runtime_tool_name,
                        params: &params,
                        context: &context,
                        turn_context: None,
                    },
                    &ThreadId::new("thread-browser-stages"),
                    route.clone(),
                    Some(task_context.input_handle()),
                    &event_sender,
                    &state,
                )
                .await;
                let _ = result_sender
                    .lock()
                    .expect("result lock")
                    .take()
                    .expect("one result")
                    .send(result);
                Ok(())
            })
        },
    );
    let submission = session.submit(Arc::new(task), false).await.expect("submit");
    let mut phases = Vec::new();
    let mut prompts = Vec::new();
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            tokio::select! {
                result = &mut result_receiver => break result.expect("tool result"),
                event = events.recv() => match event {
                    None => break (&mut result_receiver).await.expect("tool result after event owner exit"),
                    Some(AgentEvent::DynamicToolCallRequested { call_id, namespace: actual_namespace, tool, arguments, phase, approval_token }) => {
                        assert_eq!(call_id, "call-browser-stages");
                        assert_eq!(actual_namespace.as_deref(), Some(namespace));
                        assert_eq!(tool, "click");
                        assert_eq!(arguments, json!({"tabId":"tab-1", "backendNodeId":11, "snapshotId":"snapshot-1"}));
                        let index = phases.len();
                        phases.push((phase, approval_token));
                        let response = tokens.get(index).map_or_else(
                            || json!({"success":true,"contentItems":[{"type":"inputText","text":"executed"}]}),
                            |token| json!({
                                "success":false,"contentItems":[],
                                "approval":{
                                    "approvalToken":token,
                                    "reason":format!("stage {index}"),
                                    "riskClass":if index == 0 { "browse" } else { "high_impact_click" },
                                    "actionKind":"click","browserSessionId":"browser-1",
                                    "tabId":"tab-1","viewId":"view-1","webContentsId":100,
                                    "snapshotId":"snapshot-1","backendNodeId":11
                                }
                            }),
                        );
                        session.respond_dynamic_tool(Some("turn-browser-stages"), call_id, response).await.expect("host response");
                    }
                    Some(AgentEvent::ActionRequired { request_id, data, scope, .. }) => {
                        let declined = decline_at == Some(prompts.len());
                        prompts.push(data);
                        state.action_required_state().resolve_action(&request_id, scope.as_ref()).await.expect("resolve canonical action");
                        session.approve(Some("turn-browser-stages"), request_id, json!({"confirmed":!declined,"decision":if declined { "decline" } else { "allow_once" }})).await.expect("user decision");
                    }
                    event => panic!("unexpected event: {event:?}"),
                }
            }
        }
    }).await.expect("approval stages must terminate");
    submission
        .completion
        .await
        .expect("task completion")
        .expect("completed");
    registry
        .shutdown("session-browser-stages")
        .await
        .expect("shutdown");
    Outcome {
        result,
        phases,
        prompts,
    }
}

#[tokio::test]
async fn browser_browse_then_action_approval_keeps_one_canonical_call() {
    let outcome = run_stages("browser", &["browse-token", "action-token"], None).await;
    assert!(outcome.result.expect("approved action").success);
    assert_eq!(
        outcome.phases,
        vec![
            (DynamicToolCallPhase::Preflight, None),
            (
                DynamicToolCallPhase::ApprovedExecute,
                Some("browse-token".to_string())
            ),
            (
                DynamicToolCallPhase::ApprovedExecute,
                Some("action-token".to_string())
            ),
        ]
    );
    assert_eq!(outcome.prompts.len(), 2);
    assert_eq!(outcome.prompts[0]["approvalScope"]["riskClass"], "browse");
    assert_eq!(
        outcome.prompts[1]["approvalScope"]["riskClass"],
        "high_impact_click"
    );
}

#[tokio::test]
async fn declining_second_stage_does_not_execute_the_action() {
    let outcome = run_stages("browser", &["browse-token", "action-token"], Some(1)).await;
    assert!(outcome.result.is_err());
    assert_eq!(outcome.prompts.len(), 2);
    assert_eq!(outcome.phases.len(), 2);
}

#[tokio::test]
async fn repeated_approval_token_fails_without_a_second_prompt() {
    let outcome = run_stages("browser", &["same-token", "same-token"], None).await;
    assert!(
        matches!(outcome.result.expect_err("token replay").policy_kind(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(reason)) if reason == "dynamic_tool_approval_repeated")
    );
    assert_eq!(outcome.prompts.len(), 1);
    assert_eq!(outcome.phases.len(), 2);
}

#[tokio::test]
async fn approval_stage_limit_stops_before_a_fifth_prompt() {
    let outcome = run_stages("browser", &["1", "2", "3", "4", "5"], None).await;
    assert!(
        matches!(outcome.result.expect_err("stage limit").policy_kind(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(reason)) if reason == "dynamic_tool_approval_limit")
    );
    assert_eq!(outcome.prompts.len(), 4);
    assert_eq!(outcome.phases.len(), 5);
}

#[tokio::test]
async fn non_browser_tool_cannot_request_browser_approval() {
    let outcome = run_stages("desktop", &["token"], None).await;
    assert!(
        matches!(outcome.result.expect_err("namespace").policy_kind(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(reason)) if reason == "dynamic_tool_approval_namespace_invalid")
    );
    assert!(outcome.prompts.is_empty());
    assert_eq!(outcome.phases.len(), 1);
}
