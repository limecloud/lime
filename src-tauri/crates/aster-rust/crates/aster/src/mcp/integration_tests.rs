//! Integration Property-Based Tests
//!
//! This module contains property-based tests for the MCP integration module.
//!
//! # Property Coverage
//!
//! - Property 24: Permission Integration
//!   - *For any* MCP tool call, the System SHALL apply the same permission rules as for built-in tools.
//!   - **Validates: Requirements 7.5**

use proptest::prelude::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::mcp::integration::McpIntegration;
use crate::mcp::tool_manager::McpTool;
use crate::permission::{
    PermissionContext, PermissionScope, ToolPermission, ToolPermissionManager,
};

/// Generate a random tool name
fn arb_tool_name() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_]{2,15}".prop_map(|s| s.to_string())
}

/// Generate a random server name
fn arb_server_name() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_]{2,10}".prop_map(|s| s.to_string())
}

/// Generate a random permission context
fn arb_permission_context() -> impl Strategy<Value = PermissionContext> {
    (
        "[a-z0-9]{8,16}",                // session_id
        prop::option::of("[a-z]{3,10}"), // user
    )
        .prop_map(|(session_id, user)| PermissionContext {
            working_directory: std::path::PathBuf::from("/tmp"),
            session_id,
            timestamp: chrono::Utc::now().timestamp(),
            user,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        })
}

/// Generate a random tool permission
fn arb_tool_permission(tool_pattern: String, allowed: bool) -> ToolPermission {
    ToolPermission {
        tool: tool_pattern,
        allowed,
        priority: 100,
        scope: PermissionScope::Session,
        conditions: Vec::new(),
        parameter_restrictions: Vec::new(),
        reason: Some(if allowed {
            "Test allow rule".to_string()
        } else {
            "Test deny rule".to_string()
        }),
        expires_at: None,
        metadata: HashMap::new(),
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Property 24: Permission Integration**
    ///
    /// *For any* MCP tool call, the System SHALL apply the same permission rules as for built-in tools.
    ///
    /// This property verifies that:
    /// 1. When a tool is explicitly allowed, the permission check returns allowed=true
    /// 2. When a tool is explicitly denied, the permission check returns allowed=false
    /// 3. When no rule matches, the default behavior is to allow
    ///
    /// **Feature: mcp-alignment, Property 24: Permission Integration**
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_permission_integration_allowed_tools(
        server_name in arb_server_name(),
        tool_name in arb_tool_name(),
        context in arb_permission_context(),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Create integration with permission manager
            let mut integration = McpIntegration::new();
            let perm_manager = Arc::new(RwLock::new(ToolPermissionManager::new(None)));

            // Add an allow rule for the tool
            let full_tool_name = format!("{}_{}", server_name, tool_name);
            let permission = arb_tool_permission(full_tool_name.clone(), true);
            perm_manager.write().await.add_permission(permission, PermissionScope::Session);

            integration.set_permission_manager(perm_manager);

            // Check permission
            let args = serde_json::Map::new();
            let result = integration
                .check_tool_permission(&server_name, &tool_name, &args, &context)
                .await;

            // Should be allowed
            assert!(result.allowed, "Tool with allow rule should be allowed");
            assert!(result.matched_rule.is_some(), "Should have matched rule");
        });
    }

    /// **Property 24: Permission Integration - Denied Tools**
    ///
    /// *For any* MCP tool call with a deny rule, the System SHALL deny the call.
    ///
    /// **Feature: mcp-alignment, Property 24: Permission Integration**
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_permission_integration_denied_tools(
        server_name in arb_server_name(),
        tool_name in arb_tool_name(),
        context in arb_permission_context(),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Create integration with permission manager
            let mut integration = McpIntegration::new();
            let perm_manager = Arc::new(RwLock::new(ToolPermissionManager::new(None)));

            // Add a deny rule for the tool
            let full_tool_name = format!("{}_{}", server_name, tool_name);
            let permission = arb_tool_permission(full_tool_name.clone(), false);
            perm_manager.write().await.add_permission(permission, PermissionScope::Session);

            integration.set_permission_manager(perm_manager);

            // Check permission
            let args = serde_json::Map::new();
            let result = integration
                .check_tool_permission(&server_name, &tool_name, &args, &context)
                .await;

            // Should be denied
            assert!(!result.allowed, "Tool with deny rule should be denied");
            assert!(result.matched_rule.is_some(), "Should have matched rule");
        });
    }

    /// **Property 24: Permission Integration - Default Allow**
    ///
    /// *For any* MCP tool call without matching rules, the System SHALL allow by default.
    ///
    /// **Feature: mcp-alignment, Property 24: Permission Integration**
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_permission_integration_default_allow(
        server_name in arb_server_name(),
        tool_name in arb_tool_name(),
        context in arb_permission_context(),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Create integration with permission manager but no rules
            let mut integration = McpIntegration::new();
            let perm_manager = Arc::new(RwLock::new(ToolPermissionManager::new(None)));
            integration.set_permission_manager(perm_manager);

            // Check permission
            let args = serde_json::Map::new();
            let result = integration
                .check_tool_permission(&server_name, &tool_name, &args, &context)
                .await;

            // Should be allowed by default
            assert!(result.allowed, "Tool without rules should be allowed by default");
            assert!(result.matched_rule.is_none(), "Should not have matched rule");
        });
    }

    /// **Property 24: Permission Integration - Wildcard Patterns**
    ///
    /// *For any* MCP tool call matching a wildcard pattern, the System SHALL apply the rule.
    ///
    /// **Feature: mcp-alignment, Property 24: Permission Integration**
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_permission_integration_wildcard_patterns(
        server_name in arb_server_name(),
        tool_name in arb_tool_name(),
        context in arb_permission_context(),
        allowed in prop::bool::ANY,
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Create integration with permission manager
            let mut integration = McpIntegration::new();
            let perm_manager = Arc::new(RwLock::new(ToolPermissionManager::new(None)));

            // Add a wildcard rule for all tools from this server
            let wildcard_pattern = format!("{}_*", server_name);
            let permission = arb_tool_permission(wildcard_pattern, allowed);
            perm_manager.write().await.add_permission(permission, PermissionScope::Session);

            integration.set_permission_manager(perm_manager);

            // Check permission
            let args = serde_json::Map::new();
            let result = integration
                .check_tool_permission(&server_name, &tool_name, &args, &context)
                .await;

            // Should match the wildcard rule
            assert_eq!(result.allowed, allowed, "Tool should match wildcard rule");
            assert!(result.matched_rule.is_some(), "Should have matched wildcard rule");
        });
    }

    /// **Property 24: Permission Integration - Filter Consistency**
    ///
    /// *For any* list of tools, filtering by permission should only include allowed tools.
    ///
    /// **Feature: mcp-alignment, Property 24: Permission Integration**
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_permission_integration_filter_consistency(
        server_name in arb_server_name(),
        tool_names in prop::collection::vec(arb_tool_name(), 1..5),
        denied_index in 0usize..5,
        context in arb_permission_context(),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Create integration with permission manager
            let mut integration = McpIntegration::new();
            let perm_manager = Arc::new(RwLock::new(ToolPermissionManager::new(None)));

            // Create tools
            let tools: Vec<McpTool> = tool_names
                .iter()
                .map(|name| McpTool::new(name.clone(), server_name.clone(), serde_json::json!({})))
                .collect();

            // Deny one tool if index is valid
            if denied_index < tool_names.len() {
                let denied_tool = &tool_names[denied_index];
                let full_tool_name = format!("{}_{}", server_name, denied_tool);
                let permission = arb_tool_permission(full_tool_name, false);
                perm_manager.write().await.add_permission(permission, PermissionScope::Session);
            }

            integration.set_permission_manager(perm_manager);

            // Filter tools
            let allowed_tools = integration.filter_allowed_tools(tools.clone(), &context).await;

            // Verify filtering
            if denied_index < tool_names.len() {
                // The denied tool should not be in the filtered list
                let denied_tool_name = &tool_names[denied_index];
                let has_denied = allowed_tools.iter().any(|t| &t.name == denied_tool_name);
                assert!(!has_denied, "Denied tool should not be in filtered list");
                assert_eq!(allowed_tools.len(), tools.len() - 1, "Should have one less tool");
            } else {
                // All tools should be allowed
                assert_eq!(allowed_tools.len(), tools.len(), "All tools should be allowed");
            }
        });
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[tokio::test]
    async fn test_permission_integration_with_manager() {
        let mut integration = McpIntegration::new();
        let perm_manager = Arc::new(RwLock::new(ToolPermissionManager::new(None)));

        // Add a deny rule
        let permission = arb_tool_permission("server_denied_tool".to_string(), false);
        perm_manager
            .write()
            .await
            .add_permission(permission, PermissionScope::Session);

        integration.set_permission_manager(perm_manager);

        let context = PermissionContext {
            working_directory: std::path::PathBuf::from("/tmp"),
            session_id: "test".to_string(),
            timestamp: 0,
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        };

        // Check denied tool
        let args = serde_json::Map::new();
        let result = integration
            .check_tool_permission("server", "denied_tool", &args, &context)
            .await;
        assert!(!result.allowed);

        // Check allowed tool (no rule)
        let result = integration
            .check_tool_permission("server", "allowed_tool", &args, &context)
            .await;
        assert!(result.allowed);
    }

    #[tokio::test]
    async fn test_is_tool_allowed() {
        let mut integration = McpIntegration::new();
        let perm_manager = Arc::new(RwLock::new(ToolPermissionManager::new(None)));

        // Add a deny rule
        let permission = arb_tool_permission("server_blocked".to_string(), false);
        perm_manager
            .write()
            .await
            .add_permission(permission, PermissionScope::Session);

        integration.set_permission_manager(perm_manager);

        let context = PermissionContext {
            working_directory: std::path::PathBuf::from("/tmp"),
            session_id: "test".to_string(),
            timestamp: 0,
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        };

        assert!(
            !integration
                .is_tool_allowed("server", "blocked", &context)
                .await
        );
        assert!(
            integration
                .is_tool_allowed("server", "other", &context)
                .await
        );
    }

    #[tokio::test]
    async fn test_get_denied_tools() {
        let mut integration = McpIntegration::new();
        let perm_manager = Arc::new(RwLock::new(ToolPermissionManager::new(None)));

        // Add deny rules
        let permission1 = arb_tool_permission("tool1".to_string(), false);
        let permission2 = arb_tool_permission("tool2".to_string(), false);
        let permission3 = arb_tool_permission("tool3".to_string(), true); // allowed

        {
            let mut manager = perm_manager.write().await;
            manager.add_permission(permission1, PermissionScope::Session);
            manager.add_permission(permission2, PermissionScope::Session);
            manager.add_permission(permission3, PermissionScope::Session);
        }

        integration.set_permission_manager(perm_manager);

        let context = PermissionContext {
            working_directory: std::path::PathBuf::from("/tmp"),
            session_id: "test".to_string(),
            timestamp: 0,
            user: None,
            environment: HashMap::new(),
            metadata: HashMap::new(),
        };

        let denied = integration.get_denied_tools(&context).await;
        assert_eq!(denied.len(), 2);
        assert!(denied.contains(&"tool1".to_string()));
        assert!(denied.contains(&"tool2".to_string()));
        assert!(!denied.contains(&"tool3".to_string()));
    }
}
