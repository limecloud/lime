use crate::native_overlay::{
    check_runtime_gateway_tool_permissions, RuntimeNativePermissionDecision,
};
use crate::tool_definition::RuntimeToolDefinition;
use crate::tool_executor::{
    RuntimeToolExecutionContext, RuntimeToolExecutionContextInput, RuntimeToolExecutionRequest,
    RuntimeToolExecutorHandle, RuntimeToolTurnContext,
};
use crate::tool_result_projection::{
    runtime_tool_result_to_call_tool_result, RuntimeToolResultParts,
    TOOL_HANDLER_EXECUTED_METADATA_KEY,
};
use rmcp::model::{CallToolResult, ErrorCode, ErrorData};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct RuntimeGatewayToolExecutionRegistration {
    definition: RuntimeToolDefinition,
    executor: RuntimeToolExecutorHandle,
    aliases: &'static [&'static str],
}

#[derive(Clone, Default)]
pub struct RuntimeGatewayToolExecutionRegistry {
    inner: Arc<RwLock<RuntimeGatewayToolExecutionRegistryInner>>,
}

#[derive(Default)]
struct RuntimeGatewayToolExecutionRegistryInner {
    entries: Vec<RuntimeGatewayToolExecutionRegistration>,
    lookup: HashMap<String, usize>,
}

pub struct RuntimeGatewayDispatchToolRequest<'a> {
    pub tool_name: &'a str,
    pub params: &'a Value,
    pub working_directory: PathBuf,
    pub session_id: String,
    pub tool_identity: Option<crate::tool_executor::RuntimeToolExecutionIdentity>,
    pub cancel_token: Option<CancellationToken>,
    pub turn_context: Option<&'a RuntimeToolTurnContext>,
}

pub type RuntimeGatewayDispatchToolResult = Result<CallToolResult, ErrorData>;

impl RuntimeGatewayToolExecutionRegistration {
    pub fn new(
        definition: RuntimeToolDefinition,
        executor: RuntimeToolExecutorHandle,
        aliases: &'static [&'static str],
    ) -> Self {
        Self {
            definition,
            executor,
            aliases,
        }
    }

    pub fn definition(&self) -> RuntimeToolDefinition {
        self.definition.clone()
    }

    pub fn name(&self) -> &str {
        &self.definition.name
    }

    pub fn aliases(&self) -> &'static [&'static str] {
        self.aliases
    }
}

impl RuntimeGatewayToolExecutionRegistry {
    pub fn register(&self, registration: RuntimeGatewayToolExecutionRegistration) {
        let mut inner = self.inner.write().expect("gateway tool registry poisoned");
        inner.remove_by_name(registration.name());
        let index = inner.entries.len();
        register_lookup_name(&mut inner.lookup, registration.name(), index);
        for alias in registration.aliases() {
            register_lookup_name(&mut inner.lookup, alias, index);
        }
        inner.entries.push(registration);
    }

    pub fn canonical_name(&self, tool_name: &str) -> Option<String> {
        self.registration_for(tool_name)
            .map(|registration| registration.name().to_string())
    }

    pub fn definitions(&self) -> Vec<RuntimeToolDefinition> {
        let inner = self.inner.read().expect("gateway tool registry poisoned");
        let mut definitions = inner
            .entries
            .iter()
            .map(RuntimeGatewayToolExecutionRegistration::definition)
            .collect::<Vec<_>>();
        definitions.sort_by(|left, right| left.name.cmp(&right.name));
        definitions
    }

    fn registration_for(&self, tool_name: &str) -> Option<RuntimeGatewayToolExecutionRegistration> {
        let inner = self.inner.read().expect("gateway tool registry poisoned");
        let index = inner.lookup.get(&normalize_lookup_name(tool_name))?;
        inner.entries.get(*index).cloned()
    }
}

impl RuntimeGatewayToolExecutionRegistryInner {
    fn remove_by_name(&mut self, tool_name: &str) {
        let Some(index) = self.lookup.get(&normalize_lookup_name(tool_name)).copied() else {
            return;
        };
        self.entries.remove(index);
        self.rebuild_lookup();
    }

    fn rebuild_lookup(&mut self) {
        self.lookup.clear();
        for (index, entry) in self.entries.iter().enumerate() {
            register_lookup_name(&mut self.lookup, entry.name(), index);
            for alias in entry.aliases() {
                register_lookup_name(&mut self.lookup, alias, index);
            }
        }
    }
}

pub async fn execute_runtime_gateway_dispatch_tool(
    registry: &RuntimeGatewayToolExecutionRegistry,
    request: RuntimeGatewayDispatchToolRequest<'_>,
) -> Option<RuntimeGatewayDispatchToolResult> {
    let registration = registry.registration_for(request.tool_name)?;
    let canonical_tool_name = registration.name().to_string();

    match check_runtime_gateway_tool_permissions(
        &canonical_tool_name,
        request.params,
        &request.working_directory,
        &request.session_id,
        request.turn_context,
    ) {
        RuntimeNativePermissionDecision::Allow => {}
        RuntimeNativePermissionDecision::Deny(message) => {
            return Some(Err(runtime_gateway_dispatch_error(message, false)));
        }
        RuntimeNativePermissionDecision::Ask(message) => {
            return Some(Err(runtime_gateway_dispatch_error(message, false)));
        }
    }

    if request
        .cancel_token
        .as_ref()
        .is_some_and(CancellationToken::is_cancelled)
    {
        return Some(Err(runtime_gateway_dispatch_error(
            "Tool execution cancelled",
            false,
        )));
    }

    let mut runtime_context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: request.working_directory,
        session_id: request.session_id,
        cancel_token: request.cancel_token,
        workspace_sandbox: None,
    });
    if let Some(identity) = request.tool_identity {
        runtime_context = runtime_context.with_tool_identity(identity);
    }
    let result = registration
        .executor
        .execute(RuntimeToolExecutionRequest {
            tool_name: &canonical_tool_name,
            params: request.params,
            context: &runtime_context,
            turn_context: request.turn_context,
        })
        .await;

    Some(match result {
        Ok(result) => {
            let mut projection = runtime_tool_result_to_call_tool_result(RuntimeToolResultParts {
                success: result.success,
                output: Some(result.output),
                error: result.error,
                metadata: result.metadata,
            });
            if let Some(content) = result.structured_content {
                projection.structured_content = Some(content);
            }
            Ok(projection)
        }
        Err(error) => Err(runtime_gateway_dispatch_error(
            error.message().to_string(),
            error.handler_executed(),
        )),
    })
}

fn runtime_gateway_dispatch_error(message: impl Into<String>, handler_executed: bool) -> ErrorData {
    ErrorData::new(
        ErrorCode::INTERNAL_ERROR,
        message.into(),
        Some(Value::Object(
            [(
                TOOL_HANDLER_EXECUTED_METADATA_KEY.to_string(),
                Value::Bool(handler_executed),
            )]
            .into_iter()
            .collect(),
        )),
    )
}

fn register_lookup_name(lookup: &mut HashMap<String, usize>, name: &str, index: usize) {
    let normalized = normalize_lookup_name(name);
    if normalized.is_empty() {
        return;
    }
    lookup.insert(normalized, index);
}

fn normalize_lookup_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_executor::{
        RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionResult,
        RuntimeToolExecutor, RuntimeToolPolicyErrorKind,
    };
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct CapturingExecutor {
        calls: AtomicUsize,
    }

    impl RuntimeToolExecutor for CapturingExecutor {
        fn execute<'a>(
            &'a self,
            request: RuntimeToolExecutionRequest<'a>,
        ) -> RuntimeToolExecutionFuture<'a> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                Ok(RuntimeToolExecutionResult::new(
                    true,
                    request.tool_name.to_string(),
                    None,
                    HashMap::new(),
                ))
            })
        }
    }

    #[derive(Default)]
    struct FailingExecutor;

    impl RuntimeToolExecutor for FailingExecutor {
        fn execute<'a>(
            &'a self,
            _request: RuntimeToolExecutionRequest<'a>,
        ) -> RuntimeToolExecutionFuture<'a> {
            Box::pin(async move {
                Err(RuntimeToolExecutionError::new(
                    "failed from gateway",
                    Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                        "gateway_failed".to_string(),
                    )),
                ))
            })
        }
    }

    #[tokio::test]
    async fn registry_executes_registered_gateway_tool_by_alias() {
        let registry = RuntimeGatewayToolExecutionRegistry::default();
        let executor = Arc::new(CapturingExecutor::default());
        registry.register(RuntimeGatewayToolExecutionRegistration::new(
            RuntimeToolDefinition::new("tool_search", "Search tools", json!({ "type": "object" })),
            RuntimeToolExecutorHandle::new(executor.clone()),
            &["ToolSearch"],
        ));

        let result = execute_runtime_gateway_dispatch_tool(
            &registry,
            RuntimeGatewayDispatchToolRequest {
                tool_name: "ToolSearch",
                params: &json!({ "query": "browser" }),
                working_directory: PathBuf::from("."),
                session_id: "session-gateway-1".to_string(),
                tool_identity: None,
                cancel_token: None,
                turn_context: None,
            },
        )
        .await
        .expect("tool_search should be registered")
        .expect("tool_search should execute");

        assert_eq!(executor.calls.load(Ordering::SeqCst), 1);
        assert_eq!(result.content.len(), 1);
        assert_eq!(
            registry.canonical_name("ToolSearch").as_deref(),
            Some("tool_search")
        );
    }

    #[tokio::test]
    async fn denied_gateway_permission_returns_error_before_executor() {
        let registry = RuntimeGatewayToolExecutionRegistry::default();
        let executor = Arc::new(CapturingExecutor::default());
        registry.register(RuntimeGatewayToolExecutionRegistration::new(
            RuntimeToolDefinition::new("memory_read", "Read memory", json!({ "type": "object" })),
            RuntimeToolExecutorHandle::new(executor.clone()),
            &[],
        ));

        let result = execute_runtime_gateway_dispatch_tool(
            &registry,
            RuntimeGatewayDispatchToolRequest {
                tool_name: "memory_read",
                params: &json!({ "path": "../MEMORY.md" }),
                working_directory: PathBuf::from("."),
                session_id: "session-gateway-2".to_string(),
                tool_identity: None,
                cancel_token: None,
                turn_context: None,
            },
        )
        .await
        .expect("memory_read should be registered");

        let error = result.expect_err("permission denial should fail");
        assert_eq!(
            error
                .data
                .as_ref()
                .and_then(|data| data.get(TOOL_HANDLER_EXECUTED_METADATA_KEY)),
            Some(&Value::Bool(false))
        );
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn unknown_gateway_tool_returns_none_for_fallback() {
        let registry = RuntimeGatewayToolExecutionRegistry::default();
        let result = execute_runtime_gateway_dispatch_tool(
            &registry,
            RuntimeGatewayDispatchToolRequest {
                tool_name: "exec_command",
                params: &json!({ "command": "echo hi" }),
                working_directory: PathBuf::from("."),
                session_id: "session-gateway-3".to_string(),
                tool_identity: None,
                cancel_token: None,
                turn_context: None,
            },
        )
        .await;

        assert!(result.is_none());
    }

    #[tokio::test]
    async fn definitions_returns_current_tool_definitions_without_aliases() {
        let registry = RuntimeGatewayToolExecutionRegistry::default();
        registry.register(RuntimeGatewayToolExecutionRegistration::new(
            RuntimeToolDefinition::new("z_tool", "Z tool", json!({ "type": "object" })),
            RuntimeToolExecutorHandle::new(Arc::new(CapturingExecutor::default())),
            &["legacy_z"],
        ));
        registry.register(RuntimeGatewayToolExecutionRegistration::new(
            RuntimeToolDefinition::new("a_tool", "A tool", json!({ "type": "object" })),
            RuntimeToolExecutorHandle::new(Arc::new(CapturingExecutor::default())),
            &["legacy_a"],
        ));

        let names = registry
            .definitions()
            .into_iter()
            .map(|definition| definition.name)
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["a_tool", "z_tool"]);
        assert_eq!(
            registry.canonical_name("legacy_z").as_deref(),
            Some("z_tool")
        );
    }

    #[tokio::test]
    async fn executor_failure_projects_error_data() {
        let registry = RuntimeGatewayToolExecutionRegistry::default();
        registry.register(RuntimeGatewayToolExecutionRegistration::new(
            RuntimeToolDefinition::new("tool_search", "Search tools", json!({ "type": "object" })),
            RuntimeToolExecutorHandle::new(Arc::new(FailingExecutor)),
            &[],
        ));

        let result = execute_runtime_gateway_dispatch_tool(
            &registry,
            RuntimeGatewayDispatchToolRequest {
                tool_name: "tool_search",
                params: &json!({ "query": "browser" }),
                working_directory: PathBuf::from("."),
                session_id: "session-gateway-4".to_string(),
                tool_identity: None,
                cancel_token: None,
                turn_context: None,
            },
        )
        .await
        .expect("tool_search should be registered");

        let Err(error) = result else {
            panic!("gateway executor failure should be projected as ErrorData");
        };
        assert!(error.message.contains("failed from gateway"));
        assert_eq!(
            error
                .data
                .as_ref()
                .and_then(|data| data.get(TOOL_HANDLER_EXECUTED_METADATA_KEY)),
            Some(&Value::Bool(true))
        );
    }
}
