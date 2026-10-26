use crate::tool_call::ToolCall;
use crate::tool_definition::{RuntimeToolDefinition, RuntimeToolExposure};
use crate::tool_io::{ToolOutputReference, ToolOutputTruncation};
use crate::tool_result_projection::NormalizedToolOutput;
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct RuntimeToolExecutionContextInput {
    pub working_directory: PathBuf,
    pub session_id: String,
    pub cancel_token: Option<CancellationToken>,
    pub workspace_sandbox: Option<RuntimeWorkspaceSandboxInput>,
}

#[derive(Clone)]
pub struct RuntimeToolExecutionContext {
    working_directory: PathBuf,
    environment_id: Option<String>,
    session_id: String,
    cancel_token: Option<CancellationToken>,
    turn_cancel_token: Option<CancellationToken>,
    workspace_sandbox: Option<RuntimeWorkspaceSandboxInput>,
    environment: HashMap<String, String>,
    tool_identity: Option<RuntimeToolExecutionIdentity>,
    execution_attempt: Option<crate::execution_orchestrator::RuntimeToolExecutionAttempt>,
    filesystem_gateway: Option<Arc<dyn crate::filesystem_gateway::RuntimeFileSystemGateway>>,
    lifecycle_emitter: Option<Arc<dyn crate::tool_lifecycle::ToolLifecycleEmitter>>,
    history_token_limit: Option<usize>,
}

impl std::fmt::Debug for RuntimeToolExecutionContext {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RuntimeToolExecutionContext")
            .field("working_directory", &self.working_directory)
            .field("environment_id", &self.environment_id)
            .field("session_id", &self.session_id)
            .field("workspace_sandbox", &self.workspace_sandbox)
            .field("environment", &self.environment)
            .field("tool_identity", &self.tool_identity)
            .field("execution_attempt", &self.execution_attempt)
            .field("filesystem_gateway", &self.filesystem_gateway)
            .field(
                "lifecycle_emitter",
                &self
                    .lifecycle_emitter
                    .as_ref()
                    .map(|_| "<lifecycle-emitter>"),
            )
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeToolExecutionIdentity {
    call_id: String,
    turn_id: String,
}

impl RuntimeToolExecutionIdentity {
    pub fn new(call_id: impl Into<String>, turn_id: impl Into<String>) -> Self {
        Self {
            call_id: call_id.into(),
            turn_id: turn_id.into(),
        }
    }

    pub fn call_id(&self) -> &str {
        &self.call_id
    }

    pub fn turn_id(&self) -> &str {
        &self.turn_id
    }
}

impl RuntimeToolExecutionContext {
    pub fn new(input: RuntimeToolExecutionContextInput) -> Self {
        Self {
            working_directory: input.working_directory,
            environment_id: None,
            session_id: input.session_id,
            cancel_token: input.cancel_token,
            turn_cancel_token: None,
            workspace_sandbox: input.workspace_sandbox,
            environment: HashMap::new(),
            tool_identity: None,
            execution_attempt: None,
            filesystem_gateway: None,
            lifecycle_emitter: None,
            history_token_limit: None,
        }
    }

    pub fn working_directory(&self) -> &PathBuf {
        &self.working_directory
    }

    pub fn environment_id(&self) -> Option<&str> {
        self.environment_id.as_deref()
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn cancel_token(&self) -> Option<&CancellationToken> {
        self.cancel_token.as_ref()
    }

    /// Nested cells keep their local cancellation while trusted interruptions
    /// also stop the enclosing provider turn, including future sampling steps.
    pub fn with_turn_cancel_token(mut self, token: Option<CancellationToken>) -> Self {
        self.turn_cancel_token = token;
        self
    }

    pub fn interrupt_turn(&self) {
        if let Some(token) = &self.turn_cancel_token {
            token.cancel();
        }
        if let Some(token) = &self.cancel_token {
            token.cancel();
        }
    }

    pub fn workspace_sandbox(&self) -> Option<&RuntimeWorkspaceSandboxInput> {
        self.workspace_sandbox.as_ref()
    }

    pub fn has_workspace_sandbox(&self) -> bool {
        self.workspace_sandbox.is_some()
    }

    pub fn environment(&self) -> &HashMap<String, String> {
        &self.environment
    }

    pub fn tool_identity(&self) -> Option<&RuntimeToolExecutionIdentity> {
        self.tool_identity.as_ref()
    }

    pub fn execution_attempt(
        &self,
    ) -> Option<&crate::execution_orchestrator::RuntimeToolExecutionAttempt> {
        self.execution_attempt.as_ref()
    }

    pub fn filesystem_gateway(
        &self,
    ) -> Option<&Arc<dyn crate::filesystem_gateway::RuntimeFileSystemGateway>> {
        self.filesystem_gateway.as_ref()
    }

    pub fn lifecycle_emitter(
        &self,
    ) -> Option<&Arc<dyn crate::tool_lifecycle::ToolLifecycleEmitter>> {
        self.lifecycle_emitter.as_ref()
    }

    pub fn with_tool_identity(mut self, identity: RuntimeToolExecutionIdentity) -> Self {
        self.tool_identity = Some(identity);
        self
    }

    pub fn with_history_token_limit(mut self, limit: Option<usize>) -> Self {
        self.history_token_limit = limit;
        self
    }

    pub fn with_filesystem_gateway(
        mut self,
        gateway: Arc<dyn crate::filesystem_gateway::RuntimeFileSystemGateway>,
    ) -> Self {
        self.filesystem_gateway = Some(gateway);
        self
    }

    pub fn with_optional_filesystem_gateway(
        self,
        gateway: Option<Arc<dyn crate::filesystem_gateway::RuntimeFileSystemGateway>>,
    ) -> Self {
        match gateway {
            Some(gateway) => self.with_filesystem_gateway(gateway),
            None => self,
        }
    }

    pub(crate) fn with_lifecycle_emitter(
        mut self,
        emitter: Arc<dyn crate::tool_lifecycle::ToolLifecycleEmitter>,
    ) -> Self {
        self.lifecycle_emitter = Some(emitter);
        self
    }

    fn with_tool_environment(mut self, environment: &crate::tool_call::ToolEnvironment) -> Self {
        self.environment_id = Some(environment.environment_id.clone());
        self.working_directory = environment.cwd.clone();
        self
    }

    pub fn with_execution_attempt(
        mut self,
        attempt: crate::execution_orchestrator::RuntimeToolExecutionAttempt,
    ) -> Self {
        self.execution_attempt = Some(attempt);
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeWorkspaceSandboxInput {
    metadata: HashMap<String, Value>,
}

impl RuntimeWorkspaceSandboxInput {
    pub fn from_policy_metadata(metadata: &HashMap<String, Value>) -> Self {
        Self {
            metadata: metadata.clone(),
        }
    }

    pub fn metadata(&self) -> &HashMap<String, Value> {
        &self.metadata
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RuntimeToolExecutionRequest<'a> {
    pub tool_name: &'a str,
    pub params: &'a Value,
    pub context: &'a RuntimeToolExecutionContext,
    pub turn_context: Option<&'a RuntimeToolTurnContext>,
}

pub type RuntimeToolTurnContext = agent_protocol::turn_context::TurnContextOverride;

pub const TOOL_APPROVAL_GRANTED_METADATA_KEY: &str = "tool_approval_granted";

pub fn turn_context_has_tool_approval(turn_context: Option<&RuntimeToolTurnContext>) -> bool {
    turn_context
        .and_then(|context| context.metadata.get(TOOL_APPROVAL_GRANTED_METADATA_KEY))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub type RuntimeToolExecutionFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<RuntimeToolExecutionResult, RuntimeToolExecutionError>>
            + Send
            + 'a,
    >,
>;

pub trait RuntimeToolExecutor: Send + Sync {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a>;

    fn execute_call<'a>(
        &'a self,
        call: &'a ToolCall,
        context: &'a RuntimeToolExecutionContext,
        turn_context: Option<&'a RuntimeToolTurnContext>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move {
            self.execute(RuntimeToolExecutionRequest {
                tool_name: call.tool_name(),
                params: call.arguments(),
                context,
                turn_context,
            })
            .await
        })
    }
}

#[derive(Clone)]
pub struct RuntimeToolExecutorHandle {
    executor: Arc<dyn RuntimeToolExecutor>,
}

impl RuntimeToolExecutorHandle {
    pub fn new(executor: Arc<dyn RuntimeToolExecutor>) -> Self {
        Self { executor }
    }

    pub fn inner_executor(&self) -> Arc<dyn RuntimeToolExecutor> {
        Arc::clone(&self.executor)
    }

    pub async fn execute(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        self.executor.execute(request).await
    }

    pub async fn execute_call(
        &self,
        call: &ToolCall,
        context: &RuntimeToolExecutionContext,
        turn_context: Option<&RuntimeToolTurnContext>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        let context = context
            .clone()
            .with_tool_identity(RuntimeToolExecutionIdentity::new(
                call.call_id(),
                call.turn_id(),
            ))
            .with_lifecycle_emitter(call.lifecycle_emitter());
        let context = match call.environments() {
            [] => context,
            [environment] => context.with_tool_environment(environment),
            environments => {
                return Err(RuntimeToolExecutionError::new(
                    format!(
                        "tool '{}' has {} execution environments; exactly one is required",
                        call.tool_name(),
                        environments.len()
                    ),
                    Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                        "tool_environment_ambiguous".to_string(),
                    )),
                )
                .before_handler());
            }
        };
        self.executor
            .execute_call(call, &context, turn_context)
            .await
    }

    pub fn bind(
        self,
        definition: RuntimeToolDefinition,
        exposure: RuntimeToolExposure,
    ) -> RuntimeTool {
        RuntimeTool::new(definition, exposure, self)
    }
}

/// Binds the model-visible definition and exposure to its executable runtime.
#[derive(Clone)]
pub struct RuntimeTool {
    definition: RuntimeToolDefinition,
    exposure: RuntimeToolExposure,
    executor: RuntimeToolExecutorHandle,
}

impl RuntimeTool {
    pub fn new(
        definition: RuntimeToolDefinition,
        exposure: RuntimeToolExposure,
        executor: RuntimeToolExecutorHandle,
    ) -> Self {
        Self {
            definition,
            exposure,
            executor,
        }
    }

    pub fn definition(&self) -> &RuntimeToolDefinition {
        &self.definition
    }

    pub fn exposure(&self) -> RuntimeToolExposure {
        self.exposure
    }

    pub async fn execute_call(
        &self,
        call: &ToolCall,
        context: &RuntimeToolExecutionContext,
        turn_context: Option<&RuntimeToolTurnContext>,
    ) -> NormalizedToolOutput {
        call.emit_started().await;
        let started_at = Instant::now();
        let outcome = if call.tool_name() == self.definition.name {
            match context.cancel_token().cloned() {
                Some(cancel_token) if cancel_token.is_cancelled() => {
                    RuntimeToolExecutionOutcome::Aborted
                }
                Some(cancel_token)
                    if crate::unified_exec::is_unified_exec_tool_name(call.tool_name()) =>
                {
                    // Unified exec owns process termination, output drain and Command completion.
                    let result = self
                        .executor
                        .execute_call(call, context, turn_context)
                        .await;
                    if cancel_token.is_cancelled() {
                        RuntimeToolExecutionOutcome::Aborted
                    } else {
                        RuntimeToolExecutionOutcome::from_execution_result(result)
                    }
                }
                Some(cancel_token) => {
                    let execution = self.executor.execute_call(call, context, turn_context);
                    tokio::select! {
                        biased;
                        _ = cancel_token.cancelled() => RuntimeToolExecutionOutcome::Aborted,
                        result = execution => RuntimeToolExecutionOutcome::from_execution_result(result),
                    }
                }
                None => RuntimeToolExecutionOutcome::from_execution_result(
                    self.executor
                        .execute_call(call, context, turn_context)
                        .await,
                ),
            }
        } else {
            RuntimeToolExecutionOutcome::Error(RuntimeToolExecutionFailure::from_error(
                RuntimeToolExecutionError::new(
                    format!(
                        "tool call name '{}' does not match bound runtime '{}'",
                        call.tool_name(),
                        self.definition.name
                    ),
                    None,
                )
                .before_handler(),
            ))
        };
        let duration_ms = u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX);
        let mut output = NormalizedToolOutput::from_execution_outcome(outcome, duration_ms);
        output.history_token_limit = output.history_token_limit.or(context.history_token_limit);
        call.emit_completed(output.clone()).await;
        output
    }
}

impl std::fmt::Debug for RuntimeTool {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RuntimeTool")
            .field("definition", &self.definition)
            .field("exposure", &self.exposure)
            .field("executor", &"<runtime tool executor>")
            .finish()
    }
}

pub async fn run_runtime_tool_execution(
    executor: &RuntimeToolExecutorHandle,
    request: RuntimeToolExecutionRequest<'_>,
) -> RuntimeToolExecutionOutcome {
    RuntimeToolExecutionOutcome::from_execution_result(executor.execute(request).await)
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeToolExecutionResult {
    /// Tool-specific history budget, including serialization allowance. Host-owned.
    pub history_token_limit: Option<usize>,
    pub success: bool,
    pub output: String,
    pub structured_content: Option<Value>,
    pub error: Option<String>,
    pub truncation: Option<ToolOutputTruncation>,
    pub sidecar_reference: Option<ToolOutputReference>,
    pub metadata: HashMap<String, Value>,
    pub agent_control_projection_facts: Vec<crate::agent_control::SubAgentProjectionFact>,
    pub agent_control_state_facts: Vec<crate::agent_control::AgentStateProjectionFact>,
}

impl RuntimeToolExecutionResult {
    pub fn new(
        success: bool,
        output: String,
        error: Option<String>,
        metadata: HashMap<String, Value>,
    ) -> Self {
        Self {
            success,
            output,
            history_token_limit: None,
            structured_content: None,
            error,
            truncation: None,
            sidecar_reference: None,
            metadata,
            agent_control_projection_facts: Vec::new(),
            agent_control_state_facts: Vec::new(),
        }
    }

    pub fn with_structured_content(mut self, structured_content: Value) -> Self {
        self.structured_content = Some(structured_content);
        self
    }

    pub fn with_history_token_limit(mut self, limit: usize) -> Self {
        self.history_token_limit = Some(limit);
        self
    }

    pub fn with_truncation(mut self, truncation: ToolOutputTruncation) -> Self {
        self.truncation = Some(truncation);
        self
    }

    pub fn with_sidecar_reference(mut self, sidecar_reference: ToolOutputReference) -> Self {
        self.sidecar_reference = Some(sidecar_reference);
        self
    }

    pub fn with_agent_control_projection_facts(
        mut self,
        facts: Vec<crate::agent_control::SubAgentProjectionFact>,
    ) -> Self {
        self.agent_control_projection_facts = facts;
        self
    }

    pub fn with_agent_control_state_facts(
        mut self,
        facts: Vec<crate::agent_control::AgentStateProjectionFact>,
    ) -> Self {
        self.agent_control_state_facts = facts;
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeToolExecutionOutcome {
    Result(Box<RuntimeToolExecutionResult>),
    Error(RuntimeToolExecutionFailure),
    Aborted,
}

impl RuntimeToolExecutionOutcome {
    pub fn from_execution_result(
        result: Result<RuntimeToolExecutionResult, RuntimeToolExecutionError>,
    ) -> Self {
        match result {
            Ok(result) => Self::Result(Box::new(result)),
            Err(error) => Self::Error(RuntimeToolExecutionFailure::from_error(error)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeToolExecutionError {
    message: String,
    policy_kind: Option<RuntimeToolPolicyErrorKind>,
    handler_executed: bool,
}

impl RuntimeToolExecutionError {
    pub fn new(
        message: impl Into<String>,
        policy_kind: Option<RuntimeToolPolicyErrorKind>,
    ) -> Self {
        Self {
            message: message.into(),
            policy_kind,
            handler_executed: true,
        }
    }

    pub fn before_handler(mut self) -> Self {
        self.handler_executed = false;
        self
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn policy_kind(&self) -> Option<&RuntimeToolPolicyErrorKind> {
        self.policy_kind.as_ref()
    }

    pub fn handler_executed(&self) -> bool {
        self.handler_executed
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeToolExecutionFailure {
    message: String,
    kind: RuntimeToolExecutionFailureKind,
    reason_code: Option<String>,
    handler_executed: bool,
}

impl RuntimeToolExecutionFailure {
    pub fn from_error(error: RuntimeToolExecutionError) -> Self {
        let reason_code = error.policy_kind().map(|kind| match kind {
            RuntimeToolPolicyErrorKind::PermissionDenied(reason)
            | RuntimeToolPolicyErrorKind::SafetyCheckFailed(reason)
            | RuntimeToolPolicyErrorKind::SandboxDenied(reason)
            | RuntimeToolPolicyErrorKind::Timeout(reason)
            | RuntimeToolPolicyErrorKind::Canceled(reason)
            | RuntimeToolPolicyErrorKind::ExecutionFailed(reason) => reason.clone(),
            RuntimeToolPolicyErrorKind::ManagedNetworkDenied { reason_code, .. } => {
                reason_code.clone()
            }
        });
        let kind = match error.policy_kind() {
            Some(RuntimeToolPolicyErrorKind::PermissionDenied(_)) => {
                RuntimeToolExecutionFailureKind::PermissionDenied
            }
            Some(RuntimeToolPolicyErrorKind::SafetyCheckFailed(_)) => {
                RuntimeToolExecutionFailureKind::SafetyCheckFailed
            }
            Some(RuntimeToolPolicyErrorKind::SandboxDenied(_)) => {
                RuntimeToolExecutionFailureKind::SandboxDenied
            }
            Some(RuntimeToolPolicyErrorKind::ManagedNetworkDenied { .. }) => {
                RuntimeToolExecutionFailureKind::ManagedNetworkDenied
            }
            Some(RuntimeToolPolicyErrorKind::Timeout(_)) => {
                RuntimeToolExecutionFailureKind::Timeout
            }
            Some(RuntimeToolPolicyErrorKind::Canceled(_)) => {
                RuntimeToolExecutionFailureKind::Canceled
            }
            Some(RuntimeToolPolicyErrorKind::ExecutionFailed(_)) | None => {
                RuntimeToolExecutionFailureKind::ExecutionFailed
            }
        };

        Self {
            message: error.message().to_string(),
            kind,
            reason_code,
            handler_executed: error.handler_executed(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn kind(&self) -> RuntimeToolExecutionFailureKind {
        self.kind
    }

    pub fn reason_code(&self) -> Option<&str> {
        self.reason_code.as_deref()
    }

    pub fn handler_executed(&self) -> bool {
        self.handler_executed
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeToolExecutionFailureKind {
    PermissionDenied,
    SafetyCheckFailed,
    SandboxDenied,
    ManagedNetworkDenied,
    Timeout,
    Canceled,
    ExecutionFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeToolPolicyErrorKind {
    PermissionDenied(String),
    SafetyCheckFailed(String),
    SandboxDenied(String),
    ManagedNetworkDenied {
        reason_code: String,
        host: Option<String>,
    },
    Timeout(String),
    Canceled(String),
    ExecutionFailed(String),
}

impl RuntimeToolPolicyErrorKind {
    pub fn classification(&self) -> Option<RuntimeToolPolicyErrorClassification<'_>> {
        match self {
            RuntimeToolPolicyErrorKind::PermissionDenied(reason) => {
                Some(RuntimeToolPolicyErrorClassification {
                    event_class: "permission.denied",
                    failure_category: "permission_denied",
                    reason_code: "permission_denied",
                    reason,
                })
            }
            RuntimeToolPolicyErrorKind::SafetyCheckFailed(reason) => {
                Some(RuntimeToolPolicyErrorClassification {
                    event_class: "permission.denied",
                    failure_category: "policy_denied",
                    reason_code: "safety_check_failed",
                    reason,
                })
            }
            RuntimeToolPolicyErrorKind::SandboxDenied(reason) => {
                Some(RuntimeToolPolicyErrorClassification {
                    event_class: "sandbox.blocked",
                    failure_category: "sandbox_blocked",
                    reason_code: reason,
                    reason,
                })
            }
            RuntimeToolPolicyErrorKind::ManagedNetworkDenied { reason_code, .. } => {
                Some(RuntimeToolPolicyErrorClassification {
                    event_class: "network.blocked",
                    failure_category: "managed_network_denied",
                    reason_code,
                    reason: reason_code,
                })
            }
            RuntimeToolPolicyErrorKind::Timeout(reason) => {
                Some(RuntimeToolPolicyErrorClassification {
                    event_class: "tool.timed_out",
                    failure_category: "timeout",
                    reason_code: reason,
                    reason,
                })
            }
            RuntimeToolPolicyErrorKind::Canceled(reason) => {
                Some(RuntimeToolPolicyErrorClassification {
                    event_class: "tool.canceled",
                    failure_category: "canceled",
                    reason_code: reason,
                    reason,
                })
            }
            RuntimeToolPolicyErrorKind::ExecutionFailed(_) => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeToolPolicyErrorClassification<'a> {
    pub event_class: &'static str,
    pub failure_category: &'static str,
    pub reason_code: &'a str,
    pub reason: &'a str,
}

#[cfg(test)]
mod tests;
