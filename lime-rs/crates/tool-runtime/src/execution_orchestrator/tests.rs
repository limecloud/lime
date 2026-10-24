use super::*;
#[path = "network_tests.rs"]
mod network_tests;
use crate::tool_executor::{
    RuntimeToolExecutionContext, RuntimeToolExecutionContextInput, RuntimeToolExecutionRequest,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct RecordingApprovals {
    requests: Mutex<Vec<RuntimeToolApprovalRequest>>,
}

impl RuntimeToolApprovalHandler for RecordingApprovals {
    fn approve<'a>(&'a self, request: RuntimeToolApprovalRequest) -> RuntimeToolApprovalFuture<'a> {
        Box::pin(async move {
            self.requests.lock().unwrap().push(request);
            Ok(())
        })
    }
}

struct SequenceRunner {
    calls: Mutex<Vec<RuntimeToolExecutionAttempt>>,
    first_error: Option<RuntimeToolExecutionError>,
}

impl RuntimeToolAttemptRunner for SequenceRunner {
    fn run<'a>(&'a self, attempt: RuntimeToolExecutionAttempt) -> RuntimeToolAttemptFuture<'a> {
        Box::pin(async move {
            let mut calls = self.calls.lock().unwrap();
            calls.push(attempt);
            if calls.len() == 1 {
                if let Some(error) = &self.first_error {
                    return Err(error.clone());
                }
            }
            Ok(RuntimeToolExecutionResult::new(
                true,
                "ok".to_string(),
                None,
                HashMap::new(),
            ))
        })
    }
}

struct ApplyPatchAttemptRunner {
    working_directory: PathBuf,
    params: Value,
    calls: Mutex<Vec<RuntimeToolExecutionAttempt>>,
}

#[tokio::test]
async fn automatic_reviewer_is_preserved_for_network_retry_without_strict_grant() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: Some(RuntimeToolExecutionError::new(
            "network denied",
            Some(RuntimeToolPolicyErrorKind::ManagedNetworkDenied {
                reason_code: "network_denied".into(),
                host: Some("example.test".into()),
            }),
        )),
    };
    let mut input = input();
    input.initial_approval =
        RuntimeToolInitialApproval::Required(RuntimeToolApprovalKind::Guardian);
    input.network_denial_retry_allowed = true;
    input.approvals_reviewer = agent_protocol::ApprovalsReviewer::AutoReview;
    assert!(!input.strict_guardian);
    orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .unwrap();
    let requests = approvals.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[1].kind, RuntimeToolApprovalKind::Guardian);
    assert_eq!(requests[1].phase, RuntimeToolApprovalPhase::Escalation);
    assert_eq!(requests[1].network_host.as_deref(), Some("example.test"));
    assert_eq!(
        requests[1]
            .granted_permissions
            .network
            .as_ref()
            .unwrap()
            .enabled,
        Some(true)
    );
}

#[tokio::test]
async fn automatic_reviewer_checks_sandbox_retry_when_first_attempt_needed_no_approval() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: Some(RuntimeToolExecutionError::new(
            "sandbox denied",
            Some(RuntimeToolPolicyErrorKind::SandboxDenied(
                "sandbox_denied".into(),
            )),
        )),
    };
    let mut input = input();
    input.approvals_reviewer = agent_protocol::ApprovalsReviewer::AutoReview;
    orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .unwrap();
    let requests = approvals.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].kind, RuntimeToolApprovalKind::Guardian);
    assert_eq!(
        requests[0].effective_sandbox_policy,
        RuntimeToolSandboxPolicy::DangerFullAccess
    );
}

#[tokio::test]
async fn automatic_reviewer_does_not_review_an_action_without_an_approval_requirement() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: None,
    };
    let mut input = input();
    input.approvals_reviewer = agent_protocol::ApprovalsReviewer::AutoReview;
    orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .unwrap();
    assert!(approvals.requests.lock().unwrap().is_empty());
    assert_eq!(runner.calls.lock().unwrap().len(), 1);
}

struct CancellationOwningApproval {
    token: CancellationToken,
    completed: Arc<std::sync::atomic::AtomicBool>,
}

impl RuntimeToolApprovalHandler for CancellationOwningApproval {
    fn handles_cancellation(&self, _: &RuntimeToolApprovalRequest) -> bool {
        true
    }
    fn approve<'a>(&'a self, _: RuntimeToolApprovalRequest) -> RuntimeToolApprovalFuture<'a> {
        Box::pin(async move {
            self.token.cancel();
            tokio::task::yield_now().await;
            self.completed
                .store(true, std::sync::atomic::Ordering::SeqCst);
            Err(cancelled_error())
        })
    }
}

#[tokio::test]
async fn owned_reviewer_cancellation_finishes_settlement_before_returning() {
    let completed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let token = CancellationToken::new();
    let approvals = CancellationOwningApproval {
        token: token.clone(),
        completed: completed.clone(),
    };
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: None,
    };
    let mut input = input();
    input.cancel_token = Some(token);
    input.initial_approval =
        RuntimeToolInitialApproval::Required(RuntimeToolApprovalKind::Guardian);
    orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .expect_err("cancelled reviewer");
    assert!(completed.load(std::sync::atomic::Ordering::SeqCst));
    assert!(runner.calls.lock().unwrap().is_empty());
}

impl RuntimeToolAttemptRunner for ApplyPatchAttemptRunner {
    fn run<'a>(&'a self, attempt: RuntimeToolExecutionAttempt) -> RuntimeToolAttemptFuture<'a> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(attempt.clone());
            let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
                working_directory: self.working_directory.clone(),
                session_id: "apply-patch-orchestrator-test".to_string(),
                cancel_token: None,
                workspace_sandbox: None,
            })
            .with_tool_identity(attempt.identity().clone())
            .with_execution_attempt(attempt);
            crate::apply_patch::runtime_apply_patch_executor_handle()
                .execute(RuntimeToolExecutionRequest {
                    tool_name: crate::apply_patch::APPLY_PATCH_TOOL_NAME,
                    params: &self.params,
                    context: &context,
                    turn_context: None,
                })
                .await
        })
    }
}

fn input() -> RuntimeToolOrchestrationInput {
    RuntimeToolOrchestrationInput {
        approvals_reviewer: agent_protocol::ApprovalsReviewer::User,
        identity: RuntimeToolExecutionIdentity::new("call-1", "turn-1"),
        approval_policy: RuntimeToolApprovalPolicy::UnlessTrusted,
        initial_approval: RuntimeToolInitialApproval::NotRequired,
        initial_approval_reason: None,
        requested_sandbox_policy: RuntimeToolSandboxPolicy::WorkspaceWrite,
        effective_sandbox_policy: RuntimeToolSandboxPolicy::WorkspaceWrite,
        sandbox_network_access: false,
        granted_permissions: GrantedPermissionProfile::default(),
        managed_network_host: None,
        strict_guardian: false,
        explicit_sandbox_escalation: false,
        sandbox_denial_retry_allowed: true,
        network_denial_retry_allowed: true,
        cancel_token: None,
    }
}

struct CancelingRunner {
    cleanup: std::sync::atomic::AtomicBool,
    handles_cancellation: bool,
}

impl RuntimeToolAttemptRunner for CancelingRunner {
    fn handles_cancellation(&self) -> bool {
        self.handles_cancellation
    }

    fn run<'a>(&'a self, attempt: RuntimeToolExecutionAttempt) -> RuntimeToolAttemptFuture<'a> {
        Box::pin(async move {
            let token = attempt.cancel_token().expect("cancellation token");
            token.cancel();
            // Return control to the orchestration layer before publishing resource cleanup.
            tokio::task::yield_now().await;
            self.cleanup
                .store(true, std::sync::atomic::Ordering::SeqCst);
            Err(cancelled_error())
        })
    }
}

#[tokio::test]
async fn owned_attempt_cancellation_finishes_cleanup_without_retry() {
    let approvals = RecordingApprovals::default();
    let runner = CancelingRunner {
        cleanup: std::sync::atomic::AtomicBool::new(false),
        handles_cancellation: true,
    };
    let mut input = input();
    input.cancel_token = Some(CancellationToken::new());
    let error = orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .expect_err("owned attempt must report cancellation");
    assert!(matches!(
        error.policy_kind(),
        Some(RuntimeToolPolicyErrorKind::Canceled(_))
    ));
    assert!(runner.cleanup.load(std::sync::atomic::Ordering::SeqCst));
    assert!(approvals.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unowned_attempt_cancellation_drops_execution() {
    let approvals = RecordingApprovals::default();
    let runner = CancelingRunner {
        cleanup: std::sync::atomic::AtomicBool::new(false),
        handles_cancellation: false,
    };
    let mut input = input();
    input.cancel_token = Some(CancellationToken::new());
    let error = orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .expect_err("unowned attempt must report cancellation");
    assert!(matches!(
        error.policy_kind(),
        Some(RuntimeToolPolicyErrorKind::Canceled(_))
    ));
    assert!(!runner.cleanup.load(std::sync::atomic::Ordering::SeqCst));
}

#[tokio::test]
async fn sandbox_denial_approves_once_then_retries_with_same_identity() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: Some(RuntimeToolExecutionError::new(
            "sandbox denied write",
            Some(RuntimeToolPolicyErrorKind::SandboxDenied(
                "sandbox_denied".to_string(),
            )),
        )),
    };

    let result = orchestrate_runtime_tool_execution(input(), &approvals, &runner)
        .await
        .expect("escalated result");

    let calls = runner.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].identity(), calls[1].identity());
    assert_eq!(
        calls[1].effective_sandbox_policy(),
        RuntimeToolSandboxPolicy::DangerFullAccess
    );
    assert_eq!(approvals.requests.lock().unwrap().len(), 1);
    assert_eq!(result.metadata[TOOL_ATTEMPT_COUNT_METADATA_KEY], json!(2));
    assert_eq!(
        result.metadata[TOOL_FIRST_ATTEMPT_OUTCOME_METADATA_KEY],
        json!("sandbox_denied")
    );
}

#[tokio::test]
async fn ordinary_initial_approval_is_reused_for_sandbox_retry() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: Some(RuntimeToolExecutionError::new(
            "sandbox denied write",
            Some(RuntimeToolPolicyErrorKind::SandboxDenied(
                "sandbox_denied".to_string(),
            )),
        )),
    };
    let mut input = input();
    input.initial_approval = RuntimeToolInitialApproval::Required(RuntimeToolApprovalKind::User);

    orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .expect("approved retry");

    assert_eq!(approvals.requests.lock().unwrap().len(), 1);
    assert_eq!(
        runner.calls.lock().unwrap()[1].approval_source(),
        RuntimeToolApprovalSource::Reused
    );
}

#[tokio::test]
async fn cached_initial_approval_skips_approval_handler() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: None,
    };
    let mut input = input();
    input.initial_approval = RuntimeToolInitialApproval::Cached;

    let result = orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .expect("cached approval should execute");

    assert_eq!(approvals.requests.lock().unwrap().len(), 0);
    assert_eq!(runner.calls.lock().unwrap().len(), 1);
    assert_eq!(
        runner.calls.lock().unwrap()[0].approval_source(),
        RuntimeToolApprovalSource::Reused
    );
    assert_eq!(
        result.metadata[TOOL_APPROVAL_SOURCE_METADATA_KEY],
        json!("reused")
    );
}

#[tokio::test]
async fn strict_guardian_reviews_sandbox_retry_again() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: Some(RuntimeToolExecutionError::new(
            "sandbox denied write",
            Some(RuntimeToolPolicyErrorKind::SandboxDenied(
                "sandbox_denied".to_string(),
            )),
        )),
    };
    let mut input = input();
    input.strict_guardian = true;
    input.initial_approval =
        RuntimeToolInitialApproval::Required(RuntimeToolApprovalKind::Guardian);

    orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .expect("guardian retry");

    let requests = approvals.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].kind, RuntimeToolApprovalKind::Guardian);
    assert_eq!(requests[1].kind, RuntimeToolApprovalKind::Guardian);
    assert_eq!(requests[1].phase, RuntimeToolApprovalPhase::Escalation);
}

#[tokio::test]
async fn managed_network_denial_requires_scoped_approval_and_keeps_sandbox() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: Some(RuntimeToolExecutionError::new(
            "network blocked",
            Some(RuntimeToolPolicyErrorKind::ManagedNetworkDenied {
                reason_code: "managed_network_denied".to_string(),
                host: Some("https://example.com".to_string()),
            }),
        )),
    };

    orchestrate_runtime_tool_execution(input(), &approvals, &runner)
        .await
        .expect("network retry");

    let calls = runner.calls.lock().unwrap();
    assert_eq!(
        calls[1].effective_sandbox_policy(),
        RuntimeToolSandboxPolicy::WorkspaceWrite
    );
    assert!(network_is_granted(calls[1].granted_permissions()));
    let requests = approvals.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].denial_kind,
        Some(RuntimeToolDenialKind::ManagedNetwork)
    );
    assert_eq!(
        requests[0].network_host.as_deref(),
        Some("https://example.com")
    );
}

#[tokio::test]
async fn never_policy_rejects_explicit_escalation_before_approval_or_attempt() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: None,
    };
    let mut input = input();
    input.approval_policy = RuntimeToolApprovalPolicy::Never;
    input.explicit_sandbox_escalation = true;

    let error = orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .expect_err("never must reject escalation");

    assert!(matches!(
        error.policy_kind(),
        Some(RuntimeToolPolicyErrorKind::PermissionDenied(reason))
            if reason == "sandbox_escalation_forbidden"
    ));
    assert!(approvals.requests.lock().unwrap().is_empty());
    assert!(runner.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn ordinary_handler_failure_never_retries() {
    let approvals = Arc::new(RecordingApprovals::default());
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: Some(RuntimeToolExecutionError::new(
            "handler failed",
            Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                "handler_failure".to_string(),
            )),
        )),
    };

    orchestrate_runtime_tool_execution(input(), approvals.as_ref(), &runner)
        .await
        .expect_err("ordinary failure");

    assert_eq!(runner.calls.lock().unwrap().len(), 1);
    assert!(approvals.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn apply_patch_outside_workspace_retries_after_approval() {
    let root = tempfile::tempdir().expect("tempdir");
    let workspace = root.path().join("workspace");
    std::fs::create_dir_all(&workspace).expect("workspace");
    let approvals = RecordingApprovals::default();
    let runner = ApplyPatchAttemptRunner {
        working_directory: workspace,
        params: json!({
            "patch": "*** Begin Patch\n*** Add File: ../outside.md\n+approved\n*** End Patch"
        }),
        calls: Mutex::new(Vec::new()),
    };
    let mut input = input();
    input.approval_policy = RuntimeToolApprovalPolicy::OnRequest;
    input.sandbox_denial_retry_allowed = true;

    let result = orchestrate_runtime_tool_execution(input, &approvals, &runner)
        .await
        .expect("approved apply_patch retry");

    assert!(result.success);
    assert_eq!(
        std::fs::read_to_string(root.path().join("outside.md")).expect("outside patch"),
        "approved\n"
    );
    let attempts = runner.calls.lock().unwrap();
    assert_eq!(attempts.len(), 2);
    assert_eq!(
        attempts[0].effective_sandbox_policy(),
        RuntimeToolSandboxPolicy::WorkspaceWrite
    );
    assert_eq!(
        attempts[1].effective_sandbox_policy(),
        RuntimeToolSandboxPolicy::DangerFullAccess
    );
    let approvals = approvals.requests.lock().unwrap();
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0].phase, RuntimeToolApprovalPhase::Escalation);
    assert_eq!(
        approvals[0].denial_kind,
        Some(RuntimeToolDenialKind::Sandbox)
    );
}

#[tokio::test]
async fn timeout_never_retries() {
    let approvals = RecordingApprovals::default();
    let runner = SequenceRunner {
        calls: Mutex::new(Vec::new()),
        first_error: Some(RuntimeToolExecutionError::new(
            "execution timed out",
            Some(RuntimeToolPolicyErrorKind::Timeout(
                "execution_timeout".to_string(),
            )),
        )),
    };

    let error = orchestrate_runtime_tool_execution(input(), &approvals, &runner)
        .await
        .expect_err("timeout must not retry");

    assert!(matches!(
        error.policy_kind(),
        Some(RuntimeToolPolicyErrorKind::Timeout(reason)) if reason == "execution_timeout"
    ));
    assert_eq!(runner.calls.lock().unwrap().len(), 1);
    assert!(approvals.requests.lock().unwrap().is_empty());
}
