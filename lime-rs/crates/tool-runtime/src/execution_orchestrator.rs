use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionIdentity, RuntimeToolExecutionResult,
    RuntimeToolPolicyErrorKind,
};
use app_server_protocol::protocol::v2::{
    AdditionalNetworkPermissions, FileSystemAccessMode, GrantedPermissionProfile,
};
use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;
use tokio_util::sync::CancellationToken;

pub const TOOL_ATTEMPT_COUNT_METADATA_KEY: &str = "toolAttemptCount";
pub const TOOL_ATTEMPT_NUMBER_METADATA_KEY: &str = "toolAttemptNumber";
pub const TOOL_ESCALATED_METADATA_KEY: &str = "toolEscalated";
pub const TOOL_APPROVAL_SOURCE_METADATA_KEY: &str = "toolApprovalSource";
pub const TOOL_REQUESTED_SANDBOX_METADATA_KEY: &str = "requestedSandboxPolicy";
pub const TOOL_EFFECTIVE_SANDBOX_METADATA_KEY: &str = "effectiveSandboxPolicy";
pub const TOOL_FIRST_ATTEMPT_OUTCOME_METADATA_KEY: &str = "firstAttemptOutcome";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeToolApprovalPolicy {
    Never,
    OnRequest,
    UnlessTrusted,
    Granular,
    Unknown,
}

impl RuntimeToolApprovalPolicy {
    pub fn from_label(value: Option<&str>) -> Self {
        match value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase().replace('_', "-"))
            .as_deref()
        {
            Some("never") => Self::Never,
            Some("on-request") => Self::OnRequest,
            Some("unless-trusted" | "untrusted") => Self::UnlessTrusted,
            Some("granular") => Self::Granular,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeToolSandboxPolicy {
    None,
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

impl RuntimeToolSandboxPolicy {
    pub fn from_label(value: Option<&str>) -> Self {
        match value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase().replace('_', "-"))
            .as_deref()
        {
            Some("read-only") => Self::ReadOnly,
            Some("danger-full-access") => Self::DangerFullAccess,
            Some("workspace-write") => Self::WorkspaceWrite,
            _ => Self::None,
        }
    }

    pub fn label(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::ReadOnly => Some("read-only"),
            Self::WorkspaceWrite => Some("workspace-write"),
            Self::DangerFullAccess => Some("danger-full-access"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeToolAttemptNumber {
    Initial,
    Escalated,
}

impl RuntimeToolAttemptNumber {
    pub fn ordinal(self) -> u8 {
        match self {
            Self::Initial => 1,
            Self::Escalated => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeToolApprovalKind {
    User,
    Guardian,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeToolApprovalSource {
    Config,
    User,
    Guardian,
    Reused,
}

impl RuntimeToolApprovalSource {
    pub fn label(self) -> &'static str {
        match self {
            Self::Config => "config",
            Self::User => "user",
            Self::Guardian => "guardian",
            Self::Reused => "reused",
        }
    }

    fn from_kind(kind: RuntimeToolApprovalKind) -> Self {
        match kind {
            RuntimeToolApprovalKind::User => Self::User,
            RuntimeToolApprovalKind::Guardian => Self::Guardian,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeToolInitialApproval {
    NotRequired,
    Required(RuntimeToolApprovalKind),
    Cached,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeToolApprovalPhase {
    Initial,
    Escalation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeToolDenialKind {
    Sandbox,
    ManagedNetwork,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeToolApprovalRequest {
    pub phase: RuntimeToolApprovalPhase,
    pub kind: RuntimeToolApprovalKind,
    pub denial_kind: Option<RuntimeToolDenialKind>,
    pub reason: Option<String>,
    pub network_host: Option<String>,
    pub effective_sandbox_policy: RuntimeToolSandboxPolicy,
    pub granted_permissions: GrantedPermissionProfile,
}

#[derive(Debug, Clone)]
pub struct RuntimeToolExecutionAttempt {
    internal_agent_policy: Option<crate::internal_agent::InternalAgentPolicy>,
    identity: RuntimeToolExecutionIdentity,
    number: RuntimeToolAttemptNumber,
    approval_policy: RuntimeToolApprovalPolicy,
    approval_source: RuntimeToolApprovalSource,
    requested_sandbox_policy: RuntimeToolSandboxPolicy,
    effective_sandbox_policy: RuntimeToolSandboxPolicy,
    sandbox_network_access: bool,
    granted_permissions: GrantedPermissionProfile,
    managed_network_host: Option<String>,
    cancel_token: Option<CancellationToken>,
}

impl RuntimeToolExecutionAttempt {
    pub fn internal_agent_policy(&self) -> Option<&crate::internal_agent::InternalAgentPolicy> {
        self.internal_agent_policy.as_ref()
    }
    pub fn with_internal_agent_policy(
        mut self,
        policy: crate::internal_agent::InternalAgentPolicy,
    ) -> Self {
        self.internal_agent_policy = Some(policy);
        self
    }

    pub fn identity(&self) -> &RuntimeToolExecutionIdentity {
        &self.identity
    }

    pub fn number(&self) -> RuntimeToolAttemptNumber {
        self.number
    }

    pub fn approval_policy(&self) -> RuntimeToolApprovalPolicy {
        self.approval_policy
    }

    pub fn approval_source(&self) -> RuntimeToolApprovalSource {
        self.approval_source
    }

    pub fn requested_sandbox_policy(&self) -> RuntimeToolSandboxPolicy {
        self.requested_sandbox_policy
    }

    pub fn effective_sandbox_policy(&self) -> RuntimeToolSandboxPolicy {
        self.effective_sandbox_policy
    }

    pub fn granted_permissions(&self) -> &GrantedPermissionProfile {
        &self.granted_permissions
    }

    pub fn sandbox_network_access(&self) -> bool {
        self.effective_sandbox_policy == RuntimeToolSandboxPolicy::WorkspaceWrite
            && self.sandbox_network_access
    }

    pub fn managed_network_host(&self) -> Option<&str> {
        self.managed_network_host.as_deref()
    }

    pub fn cancel_token(&self) -> Option<&CancellationToken> {
        self.cancel_token.as_ref()
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel_token
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeToolOrchestrationInput {
    pub identity: RuntimeToolExecutionIdentity,
    pub approval_policy: RuntimeToolApprovalPolicy,
    pub approvals_reviewer: agent_protocol::ApprovalsReviewer,
    pub initial_approval: RuntimeToolInitialApproval,
    pub initial_approval_reason: Option<String>,
    pub requested_sandbox_policy: RuntimeToolSandboxPolicy,
    pub effective_sandbox_policy: RuntimeToolSandboxPolicy,
    pub sandbox_network_access: bool,
    pub granted_permissions: GrantedPermissionProfile,
    pub managed_network_host: Option<String>,
    pub strict_guardian: bool,
    pub explicit_sandbox_escalation: bool,
    pub sandbox_denial_retry_allowed: bool,
    pub network_denial_retry_allowed: bool,
    pub cancel_token: Option<CancellationToken>,
}

pub type RuntimeToolAttemptFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<RuntimeToolExecutionResult, RuntimeToolExecutionError>>
            + Send
            + 'a,
    >,
>;

pub trait RuntimeToolAttemptRunner: Send + Sync {
    fn run<'a>(&'a self, attempt: RuntimeToolExecutionAttempt) -> RuntimeToolAttemptFuture<'a>;

    /// An owned process must publish its terminal lifecycle before execution is dropped.
    fn handles_cancellation(&self) -> bool {
        false
    }
}

pub type RuntimeToolApprovalFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), RuntimeToolExecutionError>> + Send + 'a>>;

pub trait RuntimeToolApprovalHandler: Send + Sync {
    fn handles_cancellation(&self, _request: &RuntimeToolApprovalRequest) -> bool {
        false
    }

    fn approve<'a>(&'a self, request: RuntimeToolApprovalRequest) -> RuntimeToolApprovalFuture<'a>;
}

pub async fn orchestrate_runtime_tool_execution(
    input: RuntimeToolOrchestrationInput,
    approvals: &dyn RuntimeToolApprovalHandler,
    runner: &dyn RuntimeToolAttemptRunner,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    if input.explicit_sandbox_escalation
        && matches!(
            input.approval_policy,
            RuntimeToolApprovalPolicy::Never | RuntimeToolApprovalPolicy::Unknown
        )
    {
        return Err(policy_denied(
            "sandbox escalation is forbidden by the active approval policy",
            "sandbox_escalation_forbidden",
        ));
    }

    let initial_approval_source = match input.initial_approval {
        RuntimeToolInitialApproval::NotRequired => RuntimeToolApprovalSource::Config,
        RuntimeToolInitialApproval::Cached => RuntimeToolApprovalSource::Reused,
        RuntimeToolInitialApproval::Required(kind) => {
            await_approval(
                approvals,
                RuntimeToolApprovalRequest {
                    phase: RuntimeToolApprovalPhase::Initial,
                    kind,
                    denial_kind: None,
                    reason: input.initial_approval_reason.clone(),
                    network_host: None,
                    effective_sandbox_policy: input.effective_sandbox_policy,
                    granted_permissions: input.granted_permissions.clone(),
                },
                input.cancel_token.as_ref(),
            )
            .await?;
            RuntimeToolApprovalSource::from_kind(kind)
        }
    };

    let initial_attempt = RuntimeToolExecutionAttempt {
        internal_agent_policy: None,
        identity: input.identity.clone(),
        number: RuntimeToolAttemptNumber::Initial,
        approval_policy: input.approval_policy,
        approval_source: initial_approval_source,
        requested_sandbox_policy: input.requested_sandbox_policy,
        effective_sandbox_policy: input.effective_sandbox_policy,
        sandbox_network_access: input.sandbox_network_access,
        granted_permissions: input.granted_permissions.clone(),
        managed_network_host: input.managed_network_host.clone(),
        cancel_token: input.cancel_token.clone(),
    };
    let first_result = run_attempt(runner, initial_attempt.clone()).await;
    let first_error = match first_result {
        Ok(mut result) => {
            insert_attempt_metadata(&mut result, &initial_attempt, 1, None);
            return Ok(result);
        }
        Err(error) => error,
    };

    let Some(retry) = retry_plan(&input, &initial_attempt, &first_error) else {
        return Err(first_error);
    };
    let retry_approval_source = match retry.approval_kind {
        None => RuntimeToolApprovalSource::Reused,
        Some(kind) => {
            await_approval(
                approvals,
                RuntimeToolApprovalRequest {
                    phase: RuntimeToolApprovalPhase::Escalation,
                    kind,
                    denial_kind: Some(retry.denial_kind),
                    reason: Some(first_error.message().to_string()),
                    network_host: retry.network_host.clone(),
                    effective_sandbox_policy: retry.effective_sandbox_policy,
                    granted_permissions: retry.granted_permissions.clone(),
                },
                input.cancel_token.as_ref(),
            )
            .await?;
            RuntimeToolApprovalSource::from_kind(kind)
        }
    };
    let retry_attempt = RuntimeToolExecutionAttempt {
        internal_agent_policy: None,
        identity: input.identity,
        number: RuntimeToolAttemptNumber::Escalated,
        approval_policy: input.approval_policy,
        approval_source: retry_approval_source,
        requested_sandbox_policy: input.requested_sandbox_policy,
        effective_sandbox_policy: retry.effective_sandbox_policy,
        sandbox_network_access: input.sandbox_network_access,
        granted_permissions: retry.granted_permissions,
        managed_network_host: input.managed_network_host,
        cancel_token: input.cancel_token,
    };
    let mut result = run_attempt(runner, retry_attempt.clone()).await?;
    insert_attempt_metadata(
        &mut result,
        &retry_attempt,
        2,
        first_error.policy_kind().map(policy_error_label),
    );
    Ok(result)
}

struct RuntimeToolRetryPlan {
    denial_kind: RuntimeToolDenialKind,
    approval_kind: Option<RuntimeToolApprovalKind>,
    effective_sandbox_policy: RuntimeToolSandboxPolicy,
    granted_permissions: GrantedPermissionProfile,
    network_host: Option<String>,
}

fn retry_plan(
    input: &RuntimeToolOrchestrationInput,
    initial_attempt: &RuntimeToolExecutionAttempt,
    error: &RuntimeToolExecutionError,
) -> Option<RuntimeToolRetryPlan> {
    match error.policy_kind()? {
        RuntimeToolPolicyErrorKind::SandboxDenied(_)
            if input.sandbox_denial_retry_allowed
                && initial_attempt.effective_sandbox_policy
                    != RuntimeToolSandboxPolicy::DangerFullAccess
                && !has_denied_file_system_permissions(&input.granted_permissions) =>
        {
            Some(RuntimeToolRetryPlan {
                denial_kind: RuntimeToolDenialKind::Sandbox,
                approval_kind: retry_approval_kind(input, initial_attempt, false),
                effective_sandbox_policy: RuntimeToolSandboxPolicy::DangerFullAccess,
                granted_permissions: input.granted_permissions.clone(),
                network_host: None,
            })
        }
        RuntimeToolPolicyErrorKind::ManagedNetworkDenied { host, .. }
            if input.network_denial_retry_allowed
                && !network_is_granted(&input.granted_permissions) =>
        {
            Some(RuntimeToolRetryPlan {
                denial_kind: RuntimeToolDenialKind::ManagedNetwork,
                approval_kind: retry_approval_kind(input, initial_attempt, true),
                effective_sandbox_policy: initial_attempt.effective_sandbox_policy,
                granted_permissions: with_network_grant(input.granted_permissions.clone()),
                network_host: host.clone(),
            })
        }
        _ => None,
    }
}

fn retry_approval_kind(
    input: &RuntimeToolOrchestrationInput,
    initial_attempt: &RuntimeToolExecutionAttempt,
    network_denial: bool,
) -> Option<RuntimeToolApprovalKind> {
    if input.strict_guardian
        || input.approvals_reviewer == agent_protocol::ApprovalsReviewer::AutoReview
    {
        return Some(RuntimeToolApprovalKind::Guardian);
    }
    if !network_denial && initial_attempt.approval_source == RuntimeToolApprovalSource::User {
        return None;
    }
    Some(RuntimeToolApprovalKind::User)
}

async fn await_approval(
    approvals: &dyn RuntimeToolApprovalHandler,
    request: RuntimeToolApprovalRequest,
    cancel_token: Option<&CancellationToken>,
) -> Result<(), RuntimeToolExecutionError> {
    if cancel_token.is_some_and(CancellationToken::is_cancelled) {
        return Err(cancelled_error());
    }
    if approvals.handles_cancellation(&request) {
        return approvals.approve(request).await;
    }
    match cancel_token.cloned() {
        Some(cancel_token) => {
            tokio::select! {
                biased;
                _ = cancel_token.cancelled() => Err(cancelled_error()),
                result = approvals.approve(request) => result,
            }
        }
        None => approvals.approve(request).await,
    }
}

async fn run_attempt(
    runner: &dyn RuntimeToolAttemptRunner,
    attempt: RuntimeToolExecutionAttempt,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    if attempt.is_cancelled() {
        return Err(cancelled_error());
    }
    if runner.handles_cancellation() {
        return runner.run(attempt).await;
    }
    match attempt.cancel_token().cloned() {
        Some(cancel_token) => {
            tokio::select! {
                biased;
                _ = cancel_token.cancelled() => Err(cancelled_error()),
                result = runner.run(attempt) => result,
            }
        }
        None => runner.run(attempt).await,
    }
}

fn insert_attempt_metadata(
    result: &mut RuntimeToolExecutionResult,
    attempt: &RuntimeToolExecutionAttempt,
    attempt_count: u8,
    first_attempt_outcome: Option<&'static str>,
) {
    result.metadata.insert(
        TOOL_ATTEMPT_COUNT_METADATA_KEY.to_string(),
        json!(attempt_count),
    );
    result.metadata.insert(
        TOOL_ATTEMPT_NUMBER_METADATA_KEY.to_string(),
        json!(attempt.number.ordinal()),
    );
    result.metadata.insert(
        TOOL_ESCALATED_METADATA_KEY.to_string(),
        Value::Bool(attempt.number == RuntimeToolAttemptNumber::Escalated),
    );
    result.metadata.insert(
        TOOL_APPROVAL_SOURCE_METADATA_KEY.to_string(),
        json!(attempt.approval_source.label()),
    );
    if let Some(policy) = attempt.requested_sandbox_policy.label() {
        result.metadata.insert(
            TOOL_REQUESTED_SANDBOX_METADATA_KEY.to_string(),
            json!(policy),
        );
    }
    if let Some(policy) = attempt.effective_sandbox_policy.label() {
        result.metadata.insert(
            TOOL_EFFECTIVE_SANDBOX_METADATA_KEY.to_string(),
            json!(policy),
        );
    }
    if let Some(outcome) = first_attempt_outcome {
        result.metadata.insert(
            TOOL_FIRST_ATTEMPT_OUTCOME_METADATA_KEY.to_string(),
            json!(outcome),
        );
    }
}

fn policy_error_label(kind: &RuntimeToolPolicyErrorKind) -> &'static str {
    match kind {
        RuntimeToolPolicyErrorKind::PermissionDenied(_) => "permission_denied",
        RuntimeToolPolicyErrorKind::SafetyCheckFailed(_) => "policy_denied",
        RuntimeToolPolicyErrorKind::SandboxDenied(_) => "sandbox_denied",
        RuntimeToolPolicyErrorKind::ManagedNetworkDenied { .. } => "managed_network_denied",
        RuntimeToolPolicyErrorKind::Timeout(_) => "timeout",
        RuntimeToolPolicyErrorKind::Canceled(_) => "canceled",
        RuntimeToolPolicyErrorKind::ExecutionFailed(_) => "handler_failure",
    }
}

fn has_denied_file_system_permissions(permissions: &GrantedPermissionProfile) -> bool {
    permissions
        .file_system
        .as_ref()
        .and_then(|file_system| file_system.entries.as_deref())
        .is_some_and(|entries| {
            entries
                .iter()
                .any(|entry| entry.access == FileSystemAccessMode::Deny)
        })
}

fn network_is_granted(permissions: &GrantedPermissionProfile) -> bool {
    permissions
        .network
        .as_ref()
        .and_then(|network| network.enabled)
        .unwrap_or(false)
}

fn with_network_grant(mut permissions: GrantedPermissionProfile) -> GrantedPermissionProfile {
    permissions.network = Some(AdditionalNetworkPermissions {
        enabled: Some(true),
    });
    permissions
}

fn cancelled_error() -> RuntimeToolExecutionError {
    RuntimeToolExecutionError::new(
        "Tool execution cancelled",
        Some(RuntimeToolPolicyErrorKind::Canceled(
            "tool_execution_cancelled".to_string(),
        )),
    )
}

fn policy_denied(message: &str, reason_code: &str) -> RuntimeToolExecutionError {
    RuntimeToolExecutionError::new(
        message,
        Some(RuntimeToolPolicyErrorKind::PermissionDenied(
            reason_code.to_string(),
        )),
    )
    .before_handler()
}

#[cfg(test)]
pub(crate) fn test_runtime_tool_execution_attempt(
    identity: RuntimeToolExecutionIdentity,
    sandbox_policy: RuntimeToolSandboxPolicy,
    granted_permissions: GrantedPermissionProfile,
) -> RuntimeToolExecutionAttempt {
    RuntimeToolExecutionAttempt {
        internal_agent_policy: None,
        identity,
        number: RuntimeToolAttemptNumber::Initial,
        approval_policy: RuntimeToolApprovalPolicy::UnlessTrusted,
        approval_source: RuntimeToolApprovalSource::Config,
        requested_sandbox_policy: sandbox_policy,
        effective_sandbox_policy: sandbox_policy,
        sandbox_network_access: false,
        granted_permissions,
        managed_network_host: None,
        cancel_token: None,
    }
}

#[cfg(test)]
mod tests;
