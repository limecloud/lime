//! Tool Base Trait and Types
//!
//! This module defines the core `Tool` trait that all tools must implement.
//! It provides a unified interface for tool execution with:
//! - Name and description for identification
//! - JSON Schema for input validation
//! - Async execution with context
//! - Permission checking
//! - Configurable options
//!
//! Requirements: 1.1, 1.2

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::context::{ToolContext, ToolDefinition, ToolOptions, ToolResult};
use super::error::ToolError;

/// Permission check behavior
///
/// Determines how the tool execution should proceed after permission check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionBehavior {
    /// Allow execution to proceed
    Allow,
    /// Deny execution with a reason
    Deny,
    /// Ask user for confirmation before proceeding
    Ask,
}

/// Result of a permission check
///
/// Contains the behavior decision and optional additional information.
/// Requirements: 1.2
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionCheckResult {
    /// The permission behavior (Allow/Deny/Ask)
    pub behavior: PermissionBehavior,
    /// Optional message explaining the decision
    pub message: Option<String>,
    /// Optional updated parameters (e.g., sanitized inputs)
    pub updated_params: Option<serde_json::Value>,
}

impl PermissionCheckResult {
    /// Create an Allow result
    pub fn allow() -> Self {
        Self {
            behavior: PermissionBehavior::Allow,
            message: None,
            updated_params: None,
        }
    }

    /// Create a Deny result with a reason
    pub fn deny(reason: impl Into<String>) -> Self {
        Self {
            behavior: PermissionBehavior::Deny,
            message: Some(reason.into()),
            updated_params: None,
        }
    }

    /// Create an Ask result with a message for the user
    pub fn ask(message: impl Into<String>) -> Self {
        Self {
            behavior: PermissionBehavior::Ask,
            message: Some(message.into()),
            updated_params: None,
        }
    }

    /// Set updated parameters
    pub fn with_updated_params(mut self, params: serde_json::Value) -> Self {
        self.updated_params = Some(params);
        self
    }

    /// Check if permission is allowed
    pub fn is_allowed(&self) -> bool {
        self.behavior == PermissionBehavior::Allow
    }

    /// Check if permission is denied
    pub fn is_denied(&self) -> bool {
        self.behavior == PermissionBehavior::Deny
    }

    /// Check if user confirmation is required
    pub fn requires_confirmation(&self) -> bool {
        self.behavior == PermissionBehavior::Ask
    }
}

impl Default for PermissionCheckResult {
    fn default() -> Self {
        Self::allow()
    }
}

/// Tool trait - the core interface for all tools
///
/// All tools in the system must implement this trait. It provides:
/// - Identification (name, description)
/// - Input schema for validation
/// - Async execution
/// - Permission checking
/// - Configuration options
///
/// Requirements: 1.1, 1.2
#[async_trait]
pub trait Tool: Send + Sync {
    /// Returns the unique name of the tool
    ///
    /// This name is used for registration and lookup in the tool registry.
    fn name(&self) -> &str;

    /// Returns a human-readable description of the tool
    ///
    /// This description is provided to the LLM to help it understand
    /// when and how to use the tool.
    fn description(&self) -> &str;

    /// Returns a dynamically generated description of the tool
    ///
    /// Override this method when the tool description needs to include
    /// dynamic content (e.g., available skills, current state).
    /// Default implementation returns None, falling back to `description()`.
    fn dynamic_description(&self) -> Option<String> {
        None
    }

    /// Returns the JSON Schema for the tool's input parameters
    ///
    /// This schema is used for:
    /// - Input validation before execution
    /// - Providing parameter information to the LLM
    fn input_schema(&self) -> serde_json::Value;

    /// Execute the tool with the given parameters and context
    ///
    /// This is the main entry point for tool execution.
    ///
    /// # Arguments
    /// * `params` - The input parameters as a JSON value
    /// * `context` - The execution context containing environment info
    ///
    /// # Returns
    /// * `Ok(ToolResult)` - The execution result
    /// * `Err(ToolError)` - If execution fails
    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError>;

    /// Check permissions before executing the tool
    ///
    /// This method is called before `execute` to determine if the tool
    /// should be allowed to run with the given parameters.
    ///
    /// Default implementation allows all executions.
    ///
    /// # Arguments
    /// * `params` - The input parameters to check
    /// * `context` - The execution context
    ///
    /// # Returns
    /// A `PermissionCheckResult` indicating whether to allow, deny, or ask
    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }

    /// Get the tool definition for LLM consumption
    ///
    /// Returns a `ToolDefinition` containing the name, description,
    /// and input schema in a format suitable for LLM tool calling.
    ///
    /// Default implementation constructs from name(), dynamic_description() or description(),
    /// and input_schema(). Prefers dynamic_description() if available.
    fn get_definition(&self) -> ToolDefinition {
        let description = self
            .dynamic_description()
            .unwrap_or_else(|| self.description().to_string());
        ToolDefinition {
            name: self.name().to_string(),
            description,
            input_schema: self.input_schema(),
        }
    }

    /// Get the tool's configuration options
    ///
    /// Returns the `ToolOptions` for this tool, including retry settings,
    /// timeout configuration, etc.
    ///
    /// Default implementation returns default options.
    fn options(&self) -> ToolOptions {
        ToolOptions::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A simple test tool for unit testing
    struct TestTool {
        name: String,
        should_fail: bool,
    }

    impl TestTool {
        fn new(name: &str) -> Self {
            Self {
                name: name.to_string(),
                should_fail: false,
            }
        }

        fn failing(name: &str) -> Self {
            Self {
                name: name.to_string(),
                should_fail: true,
            }
        }
    }

    #[async_trait]
    impl Tool for TestTool {
        fn name(&self) -> &str {
            &self.name
        }

        fn description(&self) -> &str {
            "A test tool for unit testing"
        }

        fn input_schema(&self) -> serde_json::Value {
            serde_json::json!({
                "type": "object",
                "properties": {
                    "input": { "type": "string" }
                },
                "required": ["input"]
            })
        }

        async fn execute(
            &self,
            params: serde_json::Value,
            _context: &ToolContext,
        ) -> Result<ToolResult, ToolError> {
            if self.should_fail {
                return Err(ToolError::execution_failed("Test failure"));
            }

            let input = params
                .get("input")
                .and_then(|v| v.as_str())
                .unwrap_or("default");

            Ok(ToolResult::success(format!("Processed: {}", input)))
        }
    }

    #[test]
    fn test_permission_check_result_allow() {
        let result = PermissionCheckResult::allow();
        assert!(result.is_allowed());
        assert!(!result.is_denied());
        assert!(!result.requires_confirmation());
        assert!(result.message.is_none());
        assert!(result.updated_params.is_none());
    }

    #[test]
    fn test_permission_check_result_deny() {
        let result = PermissionCheckResult::deny("Access denied");
        assert!(!result.is_allowed());
        assert!(result.is_denied());
        assert!(!result.requires_confirmation());
        assert_eq!(result.message, Some("Access denied".to_string()));
    }

    #[test]
    fn test_permission_check_result_ask() {
        let result = PermissionCheckResult::ask("Do you want to proceed?");
        assert!(!result.is_allowed());
        assert!(!result.is_denied());
        assert!(result.requires_confirmation());
        assert_eq!(result.message, Some("Do you want to proceed?".to_string()));
    }

    #[test]
    fn test_permission_check_result_with_updated_params() {
        let params = serde_json::json!({"sanitized": true});
        let result = PermissionCheckResult::allow().with_updated_params(params.clone());
        assert!(result.is_allowed());
        assert_eq!(result.updated_params, Some(params));
    }

    #[test]
    fn test_permission_check_result_default() {
        let result = PermissionCheckResult::default();
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_tool_trait_basic() {
        let tool = TestTool::new("test_tool");

        assert_eq!(tool.name(), "test_tool");
        assert_eq!(tool.description(), "A test tool for unit testing");

        let schema = tool.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["input"].is_object());
    }

    #[tokio::test]
    async fn test_tool_execute_success() {
        let tool = TestTool::new("test_tool");
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"input": "hello"});

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert_eq!(result.output, Some("Processed: hello".to_string()));
    }

    #[tokio::test]
    async fn test_tool_execute_failure() {
        let tool = TestTool::failing("failing_tool");
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"input": "hello"});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::ExecutionFailed(_)));
    }

    #[tokio::test]
    async fn test_tool_default_check_permissions() {
        let tool = TestTool::new("test_tool");
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"input": "hello"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }

    #[test]
    fn test_tool_get_definition() {
        let tool = TestTool::new("test_tool");
        let def = tool.get_definition();

        assert_eq!(def.name, "test_tool");
        assert_eq!(def.description, "A test tool for unit testing");
        assert_eq!(def.input_schema["type"], "object");
    }

    #[test]
    fn test_tool_default_options() {
        let tool = TestTool::new("test_tool");
        let opts = tool.options();

        assert_eq!(opts.max_retries, 3);
        assert!(opts.enable_dynamic_timeout);
    }

    #[test]
    fn test_permission_behavior_equality() {
        assert_eq!(PermissionBehavior::Allow, PermissionBehavior::Allow);
        assert_eq!(PermissionBehavior::Deny, PermissionBehavior::Deny);
        assert_eq!(PermissionBehavior::Ask, PermissionBehavior::Ask);
        assert_ne!(PermissionBehavior::Allow, PermissionBehavior::Deny);
    }

    #[test]
    fn test_permission_check_result_serialization() {
        let result = PermissionCheckResult::deny("test reason");
        let json = serde_json::to_string(&result).unwrap();
        let deserialized: PermissionCheckResult = serde_json::from_str(&json).unwrap();

        assert_eq!(result.behavior, deserialized.behavior);
        assert_eq!(result.message, deserialized.message);
    }
}
