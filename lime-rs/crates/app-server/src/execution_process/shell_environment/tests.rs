use super::*;
use serde_json::json;

#[test]
fn frozen_policy_excludes_cannot_be_restored_by_child_inheritance_or_launch_context() {
    let server = ExecutionProcessServer::default();
    let metadata = json!({"metadata":{"shell_environment_policy":{"inherit":"none","set":{"VALUE":"configured","NODE_REPL_AUTH_TOKEN":"forbidden"}}}});
    let (environment, clear) = server
        .build_shell_environment(
            HashMap::new(),
            Some(&metadata),
            Some("thread-env"),
            "call-env",
        )
        .unwrap();
    assert!(clear);
    assert_eq!(
        environment,
        HashMap::from([
            ("VALUE".into(), "configured".into()),
            ("LIME_THREAD_ID".into(), "thread-env".into()),
            ("LIME_TOOL_CALL_ID".into(), "call-env".into()),
        ])
    );
}

#[test]
fn malformed_frozen_policy_fails_instead_of_falling_back_to_parent_environment() {
    let metadata = json!({"metadata":{"shell_environment_policy":{"inherit":"invalid"}}});
    assert!(ExecutionProcessServer::default()
        .build_shell_environment(
            HashMap::new(),
            Some(&metadata),
            Some("thread-env"),
            "call-env"
        )
        .is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn real_thread_process_uses_the_frozen_policy_and_canonical_tool_identity() {
    use tool_runtime::execution_process::live::{
        LiveExecutionRequest, RuntimeLiveExecutionGateway,
    };
    let server = ExecutionProcessServer::default();
    let temporary = tempfile::tempdir().unwrap();
    let process = server.start_thread_process("thread-env", "inspect policy", LiveExecutionRequest {
        process_id:"thread-env-process".into(), tool_id:"call-env".into(), tool_name:"exec_command".into(), environment_id:"local".into(),
        command:vec!["/bin/sh".into(),"-c".into(),"printf '%s|%s|%s|%s' \"$VALUE\" \"${HOME-missing}\" \"$LIME_THREAD_ID\" \"$LIME_TOOL_CALL_ID\"".into()],
        working_directory:temporary.path().into(), tty:false,
        approval_policy:Some("never".into()), sandbox_policy:Some("danger-full-access".into()),
        runtime_metadata:Some(json!({"metadata":{"shell_environment_policy":{"inherit":"none","set":{"VALUE":"configured"}}}})),
        env:HashMap::new(),attempt:None,
    }).await.unwrap();
    let completed = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        RuntimeLiveExecutionGateway::wait_for_exit(&server, &process.process_id),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(completed.exit_code, Some(0));
    assert_eq!(
        completed.retained_output,
        "configured|missing|thread-env|call-env"
    );
}
