//! Property-based tests for ToolRegistry
//!
//! **Property 1: Tool Name Uniqueness**
//! *For any* tool registration, native tools SHALL have priority over MCP tools
//! with the same name, ensuring unique tool resolution.
//!
//! **Property 2: Permission Check Before Execution**
//! *For any* tool execution, permission check SHALL be performed before execution,
//! and denied permissions SHALL prevent execution.
//!
//! **Validates: Requirements 2.1, 8.1, 8.2, 11.3**

use aster::permission::{AuditLogLevel, AuditLogger, ToolPermissionManager};
use aster::tools::{
    McpToolWrapper, PermissionBehavior, PermissionCheckResult, Tool, ToolContext, ToolError,
    ToolRegistry, ToolResult,
};
use async_trait::async_trait;
use proptest::prelude::*;
use std::path::PathBuf;
use std::sync::Arc;

// ============================================================================
// Test Tool Implementations
// ============================================================================

/// A configurable test tool for property testing
struct ConfigurableTestTool {
    name: String,
    description: String,
    permission_behavior: PermissionBehavior,
    should_fail: bool,
}

impl ConfigurableTestTool {
    fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            description: format!("Native tool: {}", name),
            permission_behavior: PermissionBehavior::Allow,
            should_fail: false,
        }
    }

    fn with_description(mut self, desc: &str) -> Self {
        self.description = desc.to_string();
        self
    }

    fn with_permission(mut self, behavior: PermissionBehavior) -> Self {
        self.permission_behavior = behavior;
        self
    }

    fn failing(mut self) -> Self {
        self.should_fail = true;
        self
    }
}

#[async_trait]
impl Tool for ConfigurableTestTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "input": { "type": "string" }
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        if self.should_fail {
            return Err(ToolError::execution_failed("Configured to fail"));
        }

        let input = params
            .get("input")
            .and_then(|v| v.as_str())
            .unwrap_or("default");

        Ok(ToolResult::success(format!("Native processed: {}", input)))
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        match self.permission_behavior {
            PermissionBehavior::Allow => PermissionCheckResult::allow(),
            PermissionBehavior::Deny => PermissionCheckResult::deny("Permission denied by tool"),
            PermissionBehavior::Ask => PermissionCheckResult::ask("Confirmation required"),
        }
    }
}

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary tool names (valid identifiers)
fn arb_tool_name() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_]{2,14}".prop_map(|s| s)
}

/// Generate arbitrary tool descriptions
fn arb_description() -> impl Strategy<Value = String> {
    "[A-Za-z ]{5,30}".prop_map(|s| s)
}

/// Generate arbitrary working directory paths
fn arb_working_directory() -> impl Strategy<Value = PathBuf> {
    prop::collection::vec("[a-z]{1,8}", 1..4)
        .prop_map(|segments| PathBuf::from(format!("/{}", segments.join("/"))))
}

/// Generate arbitrary session IDs
fn arb_session_id() -> impl Strategy<Value = String> {
    "[a-z0-9-]{8,16}".prop_map(|s| s)
}

/// Generate arbitrary ToolContext
fn arb_tool_context() -> impl Strategy<Value = ToolContext> {
    (arb_working_directory(), arb_session_id()).prop_map(|(working_directory, session_id)| {
        ToolContext::new(working_directory).with_session_id(session_id)
    })
}

/// Generate arbitrary permission behavior
#[allow(dead_code)]
fn arb_permission_behavior() -> impl Strategy<Value = PermissionBehavior> {
    prop_oneof![
        Just(PermissionBehavior::Allow),
        Just(PermissionBehavior::Deny),
    ]
}

/// Generate a list of unique tool names
fn arb_unique_tool_names(count: usize) -> impl Strategy<Value = Vec<String>> {
    prop::collection::hash_set(arb_tool_name(), count..=count)
        .prop_map(|set| set.into_iter().collect())
}

// ============================================================================
// Property Tests - Property 1: Tool Name Uniqueness
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 1: Tool Name Uniqueness**
    ///
    /// Property: Native tools have priority over MCP tools with the same name
    /// *For any* tool name registered as both native and MCP, the native tool
    /// SHALL be returned when querying by name.
    ///
    /// **Validates: Requirements 2.1, 11.3**
    #[test]
    fn prop_native_tools_have_priority_over_mcp(
        tool_name in arb_tool_name(),
        native_desc in arb_description(),
        mcp_desc in arb_description()
    ) {
        let mut registry = ToolRegistry::new();

        // Register MCP tool first
        let mcp_tool = McpToolWrapper::new(
            &tool_name,
            &mcp_desc,
            serde_json::json!({}),
            "test_server",
        );
        registry.register_mcp(tool_name.clone(), mcp_tool);

        // Register native tool with same name
        let native_tool = ConfigurableTestTool::new(&tool_name)
            .with_description(&native_desc);
        registry.register(Box::new(native_tool));

        // Query should return native tool
        let tool = registry.get(&tool_name);
        prop_assert!(tool.is_some(), "Tool should be found");
        prop_assert_eq!(
            tool.unwrap().description(),
            native_desc,
            "Native tool should have priority"
        );

        // Verify is_native and is_mcp
        prop_assert!(registry.is_native(&tool_name), "Should be identified as native");
        prop_assert!(!registry.is_mcp(&tool_name), "Should not be identified as MCP (shadowed)");
    }

    /// **Feature: tool-alignment, Property 1: Tool Name Uniqueness**
    ///
    /// Property: Tool count reflects unique names with shadowing
    /// *For any* set of native and MCP tools with overlapping names,
    /// tool_count() SHALL return the count of unique tool names.
    ///
    /// **Validates: Requirements 2.1, 11.3**
    #[test]
    fn prop_tool_count_reflects_unique_names(
        shared_names in arb_unique_tool_names(3),
        native_only_names in arb_unique_tool_names(2),
        mcp_only_names in arb_unique_tool_names(2)
    ) {
        // Skip if there are name collisions between the sets
        let all_names: std::collections::HashSet<_> = shared_names.iter()
            .chain(native_only_names.iter())
            .chain(mcp_only_names.iter())
            .collect();

        if all_names.len() != shared_names.len() + native_only_names.len() + mcp_only_names.len() {
            // Names overlap between sets, skip this test case
            return Ok(());
        }

        let mut registry = ToolRegistry::new();

        // Register shared names as both native and MCP
        for name in &shared_names {
            let mcp_tool = McpToolWrapper::new(name, "MCP", serde_json::json!({}), "server");
            registry.register_mcp(name.clone(), mcp_tool);
            registry.register(Box::new(ConfigurableTestTool::new(name)));
        }

        // Register native-only tools
        for name in &native_only_names {
            registry.register(Box::new(ConfigurableTestTool::new(name)));
        }

        // Register MCP-only tools
        for name in &mcp_only_names {
            let mcp_tool = McpToolWrapper::new(name, "MCP", serde_json::json!({}), "server");
            registry.register_mcp(name.clone(), mcp_tool);
        }

        // Total unique tools = shared + native_only + mcp_only
        let expected_count = shared_names.len() + native_only_names.len() + mcp_only_names.len();
        prop_assert_eq!(
            registry.tool_count(),
            expected_count,
            "Tool count should reflect unique names"
        );

        // Native count = shared + native_only
        prop_assert_eq!(
            registry.native_tool_count(),
            shared_names.len() + native_only_names.len(),
            "Native tool count should be correct"
        );

        // MCP count = shared + mcp_only (MCP tools are still registered, just shadowed)
        prop_assert_eq!(
            registry.mcp_tool_count(),
            shared_names.len() + mcp_only_names.len(),
            "MCP tool count should be correct"
        );
    }

    /// **Feature: tool-alignment, Property 1: Tool Name Uniqueness**
    ///
    /// Property: get_all returns unique tools with native priority
    /// *For any* registry with overlapping native and MCP tools,
    /// get_all() SHALL return each tool name exactly once with native priority.
    ///
    /// **Validates: Requirements 2.1, 11.3**
    #[test]
    fn prop_get_all_returns_unique_tools(
        tool_names in arb_unique_tool_names(5)
    ) {
        let mut registry = ToolRegistry::new();

        // Register all as both native and MCP
        for name in &tool_names {
            let mcp_tool = McpToolWrapper::new(name, "MCP version", serde_json::json!({}), "server");
            registry.register_mcp(name.clone(), mcp_tool);

            let native_tool = ConfigurableTestTool::new(name)
                .with_description("Native version");
            registry.register(Box::new(native_tool));
        }

        let all_tools = registry.get_all();

        // Should have exactly the number of unique names
        prop_assert_eq!(
            all_tools.len(),
            tool_names.len(),
            "get_all should return unique tools only"
        );

        // All should be native versions
        for tool in &all_tools {
            prop_assert_eq!(
                tool.description(),
                "Native version",
                "All tools should be native versions"
            );
        }
    }
}

// ============================================================================
// Property Tests - Property 2: Permission Check Before Execution
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 2: Permission Check Before Execution**
    ///
    /// Property: Denied permission prevents execution
    /// *For any* tool with Deny permission behavior, execution SHALL fail
    /// with PermissionDenied error.
    ///
    /// **Validates: Requirements 8.1, 8.2**
    #[test]
    fn prop_denied_permission_prevents_execution(
        tool_name in arb_tool_name(),
        context in arb_tool_context()
    ) {
        let mut registry = ToolRegistry::new();

        let tool = ConfigurableTestTool::new(&tool_name)
            .with_permission(PermissionBehavior::Deny);
        registry.register(Box::new(tool));

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = serde_json::json!({"input": "test"});
            let result = registry.execute(&tool_name, params, &context, None).await;

            prop_assert!(result.is_err(), "Execution should fail when permission denied");

            match result.unwrap_err() {
                ToolError::PermissionDenied(reason) => {
                    prop_assert!(
                        !reason.is_empty(),
                        "Permission denied should have a reason"
                    );
                }
                other => {
                    prop_assert!(false, "Expected PermissionDenied, got: {:?}", other);
                }
            }

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 2: Permission Check Before Execution**
    ///
    /// Property: Allowed permission enables execution
    /// *For any* tool with Allow permission behavior, execution SHALL proceed
    /// and return the tool's result.
    ///
    /// **Validates: Requirements 8.1, 8.2**
    #[test]
    fn prop_allowed_permission_enables_execution(
        tool_name in arb_tool_name(),
        context in arb_tool_context()
    ) {
        let mut registry = ToolRegistry::new();

        let tool = ConfigurableTestTool::new(&tool_name)
            .with_permission(PermissionBehavior::Allow);
        registry.register(Box::new(tool));

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = serde_json::json!({"input": "test"});
            let result = registry.execute(&tool_name, params, &context, None).await;

            prop_assert!(result.is_ok(), "Execution should succeed when permission allowed");

            let tool_result = result.unwrap();
            prop_assert!(tool_result.is_success(), "Tool result should indicate success");

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 2: Permission Check Before Execution**
    ///
    /// Property: Ask permission without callback denies execution
    /// *For any* tool with Ask permission behavior and no callback provided,
    /// execution SHALL fail with PermissionDenied error.
    ///
    /// **Validates: Requirements 8.1, 8.2**
    #[test]
    fn prop_ask_permission_without_callback_denies(
        tool_name in arb_tool_name(),
        context in arb_tool_context()
    ) {
        let mut registry = ToolRegistry::new();

        let tool = ConfigurableTestTool::new(&tool_name)
            .with_permission(PermissionBehavior::Ask);
        registry.register(Box::new(tool));

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = serde_json::json!({"input": "test"});
            // No callback provided
            let result = registry.execute(&tool_name, params, &context, None).await;

            prop_assert!(result.is_err(), "Execution should fail when Ask without callback");
            prop_assert!(
                matches!(result.unwrap_err(), ToolError::PermissionDenied(_)),
                "Should be PermissionDenied error"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 2: Permission Check Before Execution**
    ///
    /// Property: Permission check happens before tool execution
    /// *For any* tool that would fail during execution, if permission is denied,
    /// the execution failure SHALL NOT occur (permission check happens first).
    ///
    /// **Validates: Requirements 8.1, 8.2**
    #[test]
    fn prop_permission_check_before_execution(
        tool_name in arb_tool_name(),
        context in arb_tool_context()
    ) {
        let mut registry = ToolRegistry::new();

        // Tool that would fail during execution, but has denied permission
        let tool = ConfigurableTestTool::new(&tool_name)
            .with_permission(PermissionBehavior::Deny)
            .failing();
        registry.register(Box::new(tool));

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = serde_json::json!({"input": "test"});
            let result = registry.execute(&tool_name, params, &context, None).await;

            prop_assert!(result.is_err(), "Should fail");

            // Should be PermissionDenied, NOT ExecutionFailed
            // This proves permission check happened before execution
            match result.unwrap_err() {
                ToolError::PermissionDenied(_) => {
                    // Correct - permission check happened first
                }
                ToolError::ExecutionFailed(_) => {
                    prop_assert!(false, "Execution should not have been attempted");
                }
                other => {
                    prop_assert!(false, "Unexpected error: {:?}", other);
                }
            }

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 2: Permission Check Before Execution**
    ///
    /// Property: Tool not found error takes precedence
    /// *For any* non-existent tool name, execution SHALL fail with NotFound error.
    ///
    /// **Validates: Requirements 2.1**
    #[test]
    fn prop_not_found_error_for_missing_tool(
        tool_name in arb_tool_name(),
        context in arb_tool_context()
    ) {
        let registry = ToolRegistry::new(); // Empty registry

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let params = serde_json::json!({"input": "test"});
            let result = registry.execute(&tool_name, params, &context, None).await;

            prop_assert!(result.is_err(), "Should fail for non-existent tool");
            prop_assert!(
                matches!(result.unwrap_err(), ToolError::NotFound(_)),
                "Should be NotFound error"
            );

            Ok(())
        })?;
    }
}

// ============================================================================
// Additional Unit Tests for Edge Cases
// ============================================================================

#[cfg(test)]
mod edge_case_tests {
    use super::*;

    #[test]
    fn test_empty_registry() {
        let registry = ToolRegistry::new();
        assert_eq!(registry.tool_count(), 0);
        assert_eq!(registry.native_tool_count(), 0);
        assert_eq!(registry.mcp_tool_count(), 0);
        assert!(registry.get_all().is_empty());
        assert!(registry.get_definitions().is_empty());
    }

    #[test]
    fn test_registry_with_managers() {
        let permission_manager = Arc::new(ToolPermissionManager::new(None));
        let audit_logger = Arc::new(AuditLogger::new(AuditLogLevel::Info));

        let registry = ToolRegistry::with_managers(permission_manager, audit_logger);

        assert!(registry.permission_manager().is_some());
        assert!(registry.audit_logger().is_some());
    }

    #[tokio::test]
    async fn test_ask_permission_with_approving_callback() {
        let mut registry = ToolRegistry::new();

        let tool = ConfigurableTestTool::new("ask_tool").with_permission(PermissionBehavior::Ask);
        registry.register(Box::new(tool));

        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"input": "test"});

        // Callback that approves
        let callback: aster::tools::PermissionRequestCallback =
            Box::new(|_name, _msg| Box::pin(async { true }));

        let result = registry
            .execute("ask_tool", params, &context, Some(callback))
            .await;
        assert!(result.is_ok(), "Should succeed with approving callback");
    }

    #[tokio::test]
    async fn test_ask_permission_with_denying_callback() {
        let mut registry = ToolRegistry::new();

        let tool = ConfigurableTestTool::new("ask_tool").with_permission(PermissionBehavior::Ask);
        registry.register(Box::new(tool));

        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"input": "test"});

        // Callback that denies
        let callback: aster::tools::PermissionRequestCallback =
            Box::new(|_name, _msg| Box::pin(async { false }));

        let result = registry
            .execute("ask_tool", params, &context, Some(callback))
            .await;
        assert!(result.is_err(), "Should fail with denying callback");
        assert!(matches!(
            result.unwrap_err(),
            ToolError::PermissionDenied(_)
        ));
    }

    #[test]
    fn test_unregister_native_reveals_mcp() {
        let mut registry = ToolRegistry::new();

        // Register MCP first
        let mcp_tool =
            McpToolWrapper::new("shared", "MCP version", serde_json::json!({}), "server");
        registry.register_mcp("shared".to_string(), mcp_tool);

        // Register native
        let native_tool = ConfigurableTestTool::new("shared").with_description("Native version");
        registry.register(Box::new(native_tool));

        // Native should have priority
        assert_eq!(
            registry.get("shared").unwrap().description(),
            "Native version"
        );

        // Unregister native
        registry.unregister("shared");

        // MCP should now be visible
        assert_eq!(registry.get("shared").unwrap().description(), "MCP version");
        assert!(registry.is_mcp("shared"));
    }

    #[test]
    fn test_tool_definitions_match_tools() {
        let mut registry = ToolRegistry::new();

        registry.register(Box::new(ConfigurableTestTool::new("tool1")));
        registry.register(Box::new(ConfigurableTestTool::new("tool2")));

        let definitions = registry.get_definitions();
        let tools = registry.get_all();

        assert_eq!(definitions.len(), tools.len());

        for (def, tool) in definitions.iter().zip(tools.iter()) {
            assert_eq!(def.name, tool.name());
            assert_eq!(def.description, tool.description());
        }
    }

    #[test]
    fn test_mcp_tool_wrapper_properties() {
        let wrapper = McpToolWrapper::new(
            "test_mcp",
            "Test MCP tool description",
            serde_json::json!({"type": "object", "properties": {"x": {"type": "number"}}}),
            "my_server",
        );

        assert_eq!(wrapper.name(), "test_mcp");
        assert_eq!(wrapper.description(), "Test MCP tool description");
        assert_eq!(wrapper.server_name(), "my_server");

        let schema = wrapper.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["x"].is_object());
    }

    #[tokio::test]
    async fn test_mcp_tool_execute_returns_error() {
        let wrapper = McpToolWrapper::new("test", "desc", serde_json::json!({}), "server");
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({});

        let result = wrapper.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::ExecutionFailed(_)));
    }

    #[test]
    fn test_contains_methods() {
        let mut registry = ToolRegistry::new();

        assert!(!registry.contains("tool1"));
        assert!(!registry.contains_native("tool1"));
        assert!(!registry.contains_mcp("tool1"));

        registry.register(Box::new(ConfigurableTestTool::new("tool1")));

        assert!(registry.contains("tool1"));
        assert!(registry.contains_native("tool1"));
        assert!(!registry.contains_mcp("tool1"));

        let mcp_tool = McpToolWrapper::new("tool2", "desc", serde_json::json!({}), "server");
        registry.register_mcp("tool2".to_string(), mcp_tool);

        assert!(registry.contains("tool2"));
        assert!(!registry.contains_native("tool2"));
        assert!(registry.contains_mcp("tool2"));
    }
}
