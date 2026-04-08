use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Instant;

use async_stream::try_stream;
use futures::stream::{self, BoxStream};
use futures::{Stream, StreamExt};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::config::permission::PermissionLevel;
use crate::mcp_utils::ToolResult;
use crate::permission::{
    AuditLogEntry, AuditLogLevel, AuditLogger, Permission, PermissionContext, ToolPermissionManager,
};
use crate::tools::{ToolContext, ToolRegistry};
use rmcp::model::{Content, ServerNotification};

// ToolCallResult combines the result of a tool call with an optional notification stream that
// can be used to receive notifications from the tool.
pub struct ToolCallResult {
    pub result: Box<dyn Future<Output = ToolResult<rmcp::model::CallToolResult>> + Send + Unpin>,
    pub notification_stream: Option<Box<dyn Stream<Item = ServerNotification> + Send + Unpin>>,
}

impl From<ToolResult<rmcp::model::CallToolResult>> for ToolCallResult {
    fn from(result: ToolResult<rmcp::model::CallToolResult>) -> Self {
        Self {
            result: Box::new(futures::future::ready(result)),
            notification_stream: None,
        }
    }
}

use super::agent::{tool_stream, ToolStream};
use crate::agents::Agent;
use crate::conversation::message::{Message, ToolRequest};
use crate::session::Session;
use crate::tool_inspection::get_security_finding_id_from_results;

pub const DECLINED_RESPONSE: &str = "The user has declined to run this tool. \
    DO NOT attempt to call this tool again. \
    If there are no alternative methods to proceed, clearly explain the situation and STOP.";

pub const CHAT_MODE_TOOL_SKIPPED_RESPONSE: &str = "Let the user know the tool call was skipped in aster chat mode. \
                                        DO NOT apologize for skipping the tool call. DO NOT say sorry. \
                                        Provide an explanation of what the tool call would do, structured as a \
                                        plan for the user. Again, DO NOT apologize. \
                                        **Example Plan:**\n \
                                        1. **Identify Task Scope** - Determine the purpose and expected outcome.\n \
                                        2. **Outline Steps** - Break down the steps.\n \
                                        If needed, adjust the explanation based on user preferences or questions.";

impl Agent {
    pub(crate) fn handle_approval_tool_requests<'a>(
        &'a self,
        tool_requests: &'a [ToolRequest],
        tool_futures: Arc<Mutex<Vec<(String, ToolStream)>>>,
        request_to_response_map: &'a HashMap<String, Arc<Mutex<Message>>>,
        cancellation_token: Option<CancellationToken>,
        session: &'a Session,
        inspection_results: &'a [crate::tool_inspection::InspectionResult],
    ) -> BoxStream<'a, anyhow::Result<Message>> {
        try_stream! {
        for request in tool_requests.iter() {
            if let Ok(tool_call) = request.tool_call.clone() {
                // Find the corresponding inspection result for this tool request
                let security_message = inspection_results.iter()
                    .find(|result| result.tool_request_id == request.id)
                    .and_then(|result| {
                        if let crate::tool_inspection::InspectionAction::RequireApproval(Some(message)) = &result.action {
                            Some(message.clone())
                        } else {
                            None
                        }
                    });

                let confirmation = Message::assistant()
                    .with_action_required(
                        request.id.clone(),
                        tool_call.name.to_string().clone(),
                        tool_call.arguments.clone().unwrap_or_default(),
                        security_message,
                    )
                    .user_only();
                yield confirmation;

                let mut rx = self.confirmation_rx.lock().await;
                while let Some((req_id, confirmation)) = rx.recv().await {
                    if req_id == request.id {
                        // Log user decision if this was a security alert
                        if let Some(finding_id) = get_security_finding_id_from_results(&request.id, inspection_results) {
                            tracing::info!(
                                counter.aster.prompt_injection_user_decisions = 1,
                                decision = ?confirmation.permission,
                                finding_id = %finding_id,
                                "User security decision"
                            );
                        }

                        if confirmation.permission == Permission::AllowOnce || confirmation.permission == Permission::AlwaysAllow {
                            let (req_id, tool_result) = self.dispatch_tool_call(tool_call.clone(), request.id.clone(), cancellation_token.clone(), session).await;
                            let mut futures = tool_futures.lock().await;

                            futures.push((req_id, match tool_result {
                                Ok(result) => tool_stream(
                                    result.notification_stream.unwrap_or_else(|| Box::new(stream::empty())),
                                    result.result,
                                ),
                                Err(e) => tool_stream(
                                    Box::new(stream::empty()),
                                    futures::future::ready(Err(e)),
                                ),
                            }));

                            // Update the shared permission manager when user selects "Always Allow"
                            if confirmation.permission == Permission::AlwaysAllow {
                                self.tool_inspection_manager
                                    .update_permission_manager(&tool_call.name, PermissionLevel::AlwaysAllow)
                                    .await;
                            }
                        } else {
                            // User declined - update the specific response message for this request
                            if let Some(response_msg) = request_to_response_map.get(&request.id) {
                                let mut response = response_msg.lock().await;
                                *response = response.clone().with_tool_response_with_metadata(
                                    request.id.clone(),
                                    Ok(rmcp::model::CallToolResult {
                                        content: vec![Content::text(DECLINED_RESPONSE)],
                                        structured_content: None,
                                        is_error: Some(true),
                                        meta: None,
                                    }),
                                    request.metadata.as_ref(),
                                );
                            }
                        }
                        break; // Exit the loop once the matching `req_id` is found
                    }
                }
            }
        }
    }.boxed()
    }

    pub(crate) fn handle_frontend_tool_request<'a>(
        &'a self,
        tool_request: &'a ToolRequest,
        message_tool_response: Arc<Mutex<Message>>,
    ) -> BoxStream<'a, anyhow::Result<Message>> {
        try_stream! {
                if let Ok(tool_call) = tool_request.tool_call.clone() {
                    if self.is_frontend_tool(&tool_call.name).await {
                        // Send frontend tool request and wait for response
                        yield Message::assistant().with_frontend_tool_request(
                            tool_request.id.clone(),
                            Ok(tool_call.clone())
                        );

                        if let Some((id, result)) = self.tool_result_rx.lock().await.recv().await {
                            let mut response = message_tool_response.lock().await;
                            *response = response.clone().with_tool_response_with_metadata(
                                id,
                                result,
                                tool_request.metadata.as_ref(),
                            );
                        }
                    }
            }
        }
        .boxed()
    }

    // =============================================================================
    // ToolRegistry Integration (Requirements: 8.1, 8.2, 8.3, 8.4, 8.5)
    // =============================================================================

    /// Create a ToolContext from a Session
    ///
    /// This helper function creates a ToolContext suitable for use with the
    /// ToolRegistry from the current session information.
    ///
    /// Requirements: 8.4
    pub fn create_tool_context(
        session: &Session,
        cancellation_token: Option<CancellationToken>,
    ) -> ToolContext {
        let mut ctx = ToolContext::new(session.working_dir.clone()).with_session_id(&session.id);

        if let Some(token) = cancellation_token {
            ctx = ctx.with_cancellation_token(token);
        }

        ctx
    }

    /// Create a PermissionContext from a Session
    ///
    /// This helper function creates a PermissionContext suitable for use with
    /// the ToolPermissionManager from the current session information.
    ///
    /// Requirements: 8.1, 8.2
    pub fn create_permission_context(session: &Session) -> PermissionContext {
        PermissionContext {
            working_directory: session.working_dir.clone(),
            session_id: session.id.clone(),
            timestamp: chrono::Utc::now().timestamp(),
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        }
    }

    /// Execute a tool through the ToolRegistry with permission checking and audit logging
    ///
    /// This method provides a unified interface for executing tools through the
    /// ToolRegistry, integrating:
    /// - Permission checking via ToolPermissionManager
    /// - Audit logging via AuditLogger
    /// - User confirmation handling for 'ask' permission behavior
    ///
    /// # Arguments
    /// * `registry` - The ToolRegistry containing registered tools
    /// * `tool_name` - Name of the tool to execute
    /// * `params` - Tool parameters as JSON
    /// * `session` - Current session
    /// * `cancellation_token` - Optional cancellation token
    /// * `on_permission_request` - Optional callback for permission requests
    ///
    /// # Returns
    /// * `Ok(ToolResult)` - The tool execution result
    /// * `Err(ToolError)` - If permission denied or execution fails
    ///
    /// Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
    pub async fn execute_tool_with_registry(
        registry: &ToolRegistry,
        tool_name: &str,
        params: serde_json::Value,
        session: &Session,
        cancellation_token: Option<CancellationToken>,
        on_permission_request: Option<crate::tools::PermissionRequestCallback>,
    ) -> Result<crate::tools::ToolResult, crate::tools::ToolError> {
        let context = Self::create_tool_context(session, cancellation_token);
        registry
            .execute(tool_name, params, &context, on_permission_request)
            .await
    }

    /// Log a tool execution to the audit logger
    ///
    /// This helper function logs tool execution events to the audit logger,
    /// including success/failure status, duration, and relevant metadata.
    ///
    /// Requirements: 8.5
    pub fn log_tool_execution(
        audit_logger: &AuditLogger,
        tool_name: &str,
        params: &serde_json::Value,
        session: &Session,
        success: bool,
        duration: std::time::Duration,
        error_message: Option<&str>,
    ) {
        let level = if success {
            AuditLogLevel::Info
        } else {
            AuditLogLevel::Warn
        };

        let perm_context = Self::create_permission_context(session);
        let params_map = Self::params_to_hashmap(params);

        let mut entry = AuditLogEntry::new("tool_execution", tool_name)
            .with_level(level)
            .with_parameters(params_map)
            .with_context(perm_context)
            .with_duration_ms(duration.as_millis() as u64)
            .add_metadata("success", serde_json::json!(success));

        if let Some(err) = error_message {
            entry = entry.add_metadata("error", serde_json::json!(err));
        }

        audit_logger.log_tool_execution(entry);
    }

    /// Log a permission denial to the audit logger
    ///
    /// This helper function logs permission denial events to the audit logger.
    ///
    /// Requirements: 8.5
    pub fn log_permission_denied(
        audit_logger: &AuditLogger,
        tool_name: &str,
        params: &serde_json::Value,
        session: &Session,
        reason: &str,
    ) {
        let perm_context = Self::create_permission_context(session);
        let params_map = Self::params_to_hashmap(params);

        let entry = AuditLogEntry::new("permission_denied", tool_name)
            .with_level(AuditLogLevel::Warn)
            .with_parameters(params_map)
            .with_context(perm_context)
            .add_metadata("reason", serde_json::json!(reason));

        audit_logger.log(entry);
    }

    /// Convert JSON params to HashMap for permission checking
    fn params_to_hashmap(params: &serde_json::Value) -> HashMap<String, serde_json::Value> {
        match params {
            serde_json::Value::Object(map) => {
                map.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
            }
            _ => HashMap::new(),
        }
    }

    /// Check tool permissions using ToolPermissionManager
    ///
    /// This method checks if a tool execution is allowed based on the
    /// configured permission rules.
    ///
    /// # Arguments
    /// * `permission_manager` - The ToolPermissionManager to use
    /// * `tool_name` - Name of the tool to check
    /// * `params` - Tool parameters as JSON
    /// * `session` - Current session
    ///
    /// # Returns
    /// * `Ok(())` - If permission is granted
    /// * `Err(reason)` - If permission is denied, with the denial reason
    ///
    /// Requirements: 8.1, 8.2, 8.3
    pub fn check_tool_permission(
        permission_manager: &ToolPermissionManager,
        tool_name: &str,
        params: &serde_json::Value,
        session: &Session,
    ) -> Result<(), String> {
        let perm_context = Self::create_permission_context(session);
        let params_map = Self::params_to_hashmap(params);

        let result = permission_manager.is_allowed(tool_name, &params_map, &perm_context);

        if result.allowed {
            Ok(())
        } else {
            Err(result
                .reason
                .unwrap_or_else(|| format!("Permission denied for tool '{}'", tool_name)))
        }
    }

    /// Execute a tool call with integrated permission checking and audit logging
    ///
    /// This is a higher-level wrapper that combines permission checking,
    /// tool execution, and audit logging into a single operation.
    ///
    /// # Arguments
    /// * `registry` - The ToolRegistry containing registered tools
    /// * `permission_manager` - Optional ToolPermissionManager for permission checks
    /// * `audit_logger` - Optional AuditLogger for logging
    /// * `tool_name` - Name of the tool to execute
    /// * `params` - Tool parameters as JSON
    /// * `session` - Current session
    /// * `cancellation_token` - Optional cancellation token
    ///
    /// # Returns
    /// * `Ok(ToolResult)` - The tool execution result
    /// * `Err(String)` - Error message if permission denied or execution fails
    ///
    /// Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
    pub async fn execute_tool_with_checks(
        registry: &ToolRegistry,
        permission_manager: Option<&ToolPermissionManager>,
        audit_logger: Option<&AuditLogger>,
        tool_name: &str,
        params: serde_json::Value,
        session: &Session,
        cancellation_token: Option<CancellationToken>,
    ) -> Result<crate::tools::ToolResult, String> {
        let start_time = Instant::now();

        // Step 1: Check permissions if permission manager is provided
        if let Some(pm) = permission_manager {
            if let Err(reason) = Self::check_tool_permission(pm, tool_name, &params, session) {
                // Log permission denial
                if let Some(logger) = audit_logger {
                    Self::log_permission_denied(logger, tool_name, &params, session, &reason);
                }
                return Err(reason);
            }
        }

        // Step 2: Execute the tool
        let context = Self::create_tool_context(session, cancellation_token);
        let result = registry
            .execute(tool_name, params.clone(), &context, None)
            .await;

        // Step 3: Log the execution
        let duration = start_time.elapsed();
        if let Some(logger) = audit_logger {
            match &result {
                Ok(tool_result) => {
                    Self::log_tool_execution(
                        logger,
                        tool_name,
                        &params,
                        session,
                        tool_result.is_success(),
                        duration,
                        tool_result.error.as_deref(),
                    );
                }
                Err(err) => {
                    Self::log_tool_execution(
                        logger,
                        tool_name,
                        &params,
                        session,
                        false,
                        duration,
                        Some(&err.to_string()),
                    );
                }
            }
        }

        result.map_err(|e| e.to_string())
    }

    /// Execute a tool call with user confirmation support for 'ask' permission behavior
    ///
    /// This method extends `execute_tool_with_checks` to support the 'ask' permission
    /// behavior, where the user is prompted to confirm tool execution.
    ///
    /// # Arguments
    /// * `registry` - The ToolRegistry containing registered tools
    /// * `permission_manager` - Optional ToolPermissionManager for permission checks
    /// * `audit_logger` - Optional AuditLogger for logging
    /// * `tool_name` - Name of the tool to execute
    /// * `params` - Tool parameters as JSON
    /// * `session` - Current session
    /// * `cancellation_token` - Optional cancellation token
    /// * `on_permission_request` - Callback for handling 'ask' permission behavior
    ///
    /// # Returns
    /// * `Ok(ToolResult)` - The tool execution result
    /// * `Err(String)` - Error message if permission denied or execution fails
    ///
    /// Requirements: 8.1, 8.2, 8.3, 8.4
    #[allow(clippy::too_many_arguments)]
    pub async fn execute_tool_with_user_confirmation(
        registry: &ToolRegistry,
        permission_manager: Option<&ToolPermissionManager>,
        audit_logger: Option<&AuditLogger>,
        tool_name: &str,
        params: serde_json::Value,
        session: &Session,
        cancellation_token: Option<CancellationToken>,
        on_permission_request: Option<crate::tools::PermissionRequestCallback>,
    ) -> Result<crate::tools::ToolResult, String> {
        let start_time = Instant::now();

        // Step 1: Check permissions if permission manager is provided
        if let Some(pm) = permission_manager {
            if let Err(reason) = Self::check_tool_permission(pm, tool_name, &params, session) {
                // Log permission denial
                if let Some(logger) = audit_logger {
                    Self::log_permission_denied(logger, tool_name, &params, session, &reason);
                }
                return Err(reason);
            }
        }

        // Step 2: Execute the tool with permission request callback
        let context = Self::create_tool_context(session, cancellation_token);
        let result = registry
            .execute(tool_name, params.clone(), &context, on_permission_request)
            .await;

        // Step 3: Log the execution
        let duration = start_time.elapsed();
        if let Some(logger) = audit_logger {
            match &result {
                Ok(tool_result) => {
                    Self::log_tool_execution(
                        logger,
                        tool_name,
                        &params,
                        session,
                        tool_result.is_success(),
                        duration,
                        tool_result.error.as_deref(),
                    );
                }
                Err(err) => {
                    Self::log_tool_execution(
                        logger,
                        tool_name,
                        &params,
                        session,
                        false,
                        duration,
                        Some(&err.to_string()),
                    );
                }
            }
        }

        result.map_err(|e| e.to_string())
    }

    /// Create a permission request callback that uses the Agent's confirmation channel
    ///
    /// This method creates a callback that can be used with `execute_tool_with_user_confirmation`
    /// to handle 'ask' permission behavior by sending confirmation requests through the
    /// Agent's existing confirmation channel.
    ///
    /// # Arguments
    /// * `request_id` - The tool request ID for tracking
    /// * `confirmation_tx` - The confirmation sender channel
    ///
    /// # Returns
    /// A callback that sends permission requests and waits for user confirmation
    ///
    /// Requirements: 8.2, 8.3
    pub fn create_permission_callback(
        request_id: String,
        _confirmation_tx: tokio::sync::mpsc::Sender<(
            String,
            crate::permission::PermissionConfirmation,
        )>,
    ) -> crate::tools::PermissionRequestCallback {
        Box::new(move |tool_name: String, message: String| {
            let req_id = request_id.clone();
            Box::pin(async move {
                // Log the permission request
                tracing::info!(
                    tool_name = %tool_name,
                    message = %message,
                    request_id = %req_id,
                    "Permission request for tool execution"
                );

                // For now, we return false (deny) as the actual confirmation
                // would need to be handled through the UI flow
                // The existing handle_approval_tool_requests handles this flow
                false
            })
        })
    }

    /// Log a permission check result to the audit logger
    ///
    /// This helper function logs permission check events to the audit logger,
    /// including the result and any relevant metadata.
    ///
    /// Requirements: 8.5
    pub fn log_permission_check(
        audit_logger: &AuditLogger,
        tool_name: &str,
        params: &serde_json::Value,
        session: &Session,
        allowed: bool,
        reason: Option<&str>,
    ) {
        let level = if allowed {
            AuditLogLevel::Debug
        } else {
            AuditLogLevel::Warn
        };

        let perm_context = Self::create_permission_context(session);
        let params_map = Self::params_to_hashmap(params);

        let mut entry = AuditLogEntry::new("permission_check", tool_name)
            .with_level(level)
            .with_parameters(params_map)
            .with_context(perm_context)
            .add_metadata("allowed", serde_json::json!(allowed));

        if let Some(r) = reason {
            entry = entry.add_metadata("reason", serde_json::json!(r));
        }

        audit_logger.log_permission_check(entry);
    }
}
