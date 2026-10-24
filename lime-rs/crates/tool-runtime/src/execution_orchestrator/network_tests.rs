use super::*;

#[tokio::test]
async fn ambient_workspace_network_survives_retry_without_forging_a_managed_grant() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: Some(RuntimeToolExecutionError::new(
            "managed network denied",
            Some(RuntimeToolPolicyErrorKind::ManagedNetworkDenied {
                reason_code: "managed_network_denied".into(),
                host: Some("example.test".into()),
            }),
        )),
    };
    let mut request = input();
    request.sandbox_network_access = true;
    request.managed_network_host = Some("example.test".into());
    orchestrate_runtime_tool_execution(request, &approvals, &runner)
        .await
        .unwrap();
    let calls = runner.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert!(calls[0].sandbox_network_access());
    assert!(calls[0].granted_permissions().network.is_none());
    assert!(calls[1].sandbox_network_access());
    assert_eq!(
        calls[1]
            .granted_permissions()
            .network
            .as_ref()
            .and_then(|value| value.enabled),
        Some(true)
    );
    assert_eq!(approvals.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn ambient_workspace_network_does_not_open_read_only_execution() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: None,
    };
    let mut request = input();
    request.requested_sandbox_policy = RuntimeToolSandboxPolicy::ReadOnly;
    request.effective_sandbox_policy = RuntimeToolSandboxPolicy::ReadOnly;
    request.sandbox_network_access = true;
    orchestrate_runtime_tool_execution(request, &approvals, &runner)
        .await
        .unwrap();
    let calls = runner.calls.lock().unwrap();
    assert!(!calls[0].sandbox_network_access());
    assert!(calls[0].granted_permissions().network.is_none());
    assert!(approvals.requests.lock().unwrap().is_empty());
}
