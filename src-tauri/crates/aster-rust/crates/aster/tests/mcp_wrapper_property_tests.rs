//! Property-based tests for MCP Tool Wrapper
//!
//! **Property 8: MCP Tool Compatibility**
//! *For any* MCP tool registered in the system, it SHALL implement the Tool trait
//! correctly and be accessible through the ToolRegistry.
//!
//! **Validates: Requirements 11.1, 11.2**

use aster::tools::{McpToolWrapper, Tool, ToolContext, ToolRegistry};
use proptest::prelude::*;
use std::path::PathBuf;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary tool names (valid identifiers)
fn arb_tool_name() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_]{2,14}".prop_map(|s| s)
}

/// Generate arbitrary tool descriptions
fn arb_description() -> impl Strategy<Value = String> {
    "[A-Za-z ]{5,50}".prop_map(|s| s)
}

/// Generate arbitrary server names
fn arb_server_name() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9-]{2,14}".prop_map(|s| s)
}

/// Generate arbitrary JSON schema for tool input
fn arb_input_schema() -> impl Strategy<Value = serde_json::Value> {
    prop_oneof![
        // Empty object schema
        Just(serde_json::json!({"type": "object"})),
        // Schema with string property
        Just(serde_json::json!({
            "type": "object",
            "properties": {
                "input": {"type": "string"}
            }
        })),
        // Schema with required properties
        Just(serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"}
            },
            "required": ["path"]
        })),
        // Schema with multiple types
        Just(serde_json::json!({
            "type": "object",
            "properties": {
                "count": {"type": "integer"},
                "enabled": {"type": "boolean"},
                "name": {"type": "string"}
            }
        })),
    ]
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

/// Generate a list of unique tool names
fn arb_unique_tool_names(count: usize) -> impl Strategy<Value = Vec<String>> {
    prop::collection::hash_set(arb_tool_name(), count..=count)
        .prop_map(|set| set.into_iter().collect())
}

// ============================================================================
// Property Tests - Property 8: MCP Tool Compatibility
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 8: MCP Tool Compatibility**
    ///
    /// Property: McpToolWrapper implements Tool trait correctly
    /// *For any* MCP tool wrapper, it SHALL correctly implement name(),
    /// description(), and input_schema() methods.
    ///
    /// **Validates: Requirements 11.1, 11.2**
    #[test]
    fn prop_mcp_wrapper_implements_tool_trait(
        name in arb_tool_name(),
        description in arb_description(),
        server_name in arb_server_name(),
        schema in arb_input_schema()
    ) {
        let wrapper = McpToolWrapper::new(&name, &description, schema.clone(), &server_name);

        // Verify Tool trait methods
        prop_assert_eq!(wrapper.name(), name.as_str(), "name() should return correct name");
        prop_assert_eq!(wrapper.description(), description.as_str(), "description() should return correct description");
        prop_assert_eq!(wrapper.input_schema(), schema, "input_schema() should return correct schema");
        prop_assert_eq!(wrapper.server_name(), server_name.as_str(), "server_name() should return correct server");
    }

    /// **Feature: tool-alignment, Property 8: MCP Tool Compatibility**
    ///
    /// Property: McpToolWrapper generates correct ToolDefinition
    /// *For any* MCP tool wrapper, get_definition() SHALL return a ToolDefinition
    /// with matching name, description, and input_schema.
    ///
    /// **Validates: Requirements 11.1, 11.2**
    #[test]
    fn prop_mcp_wrapper_generates_correct_definition(
        name in arb_tool_name(),
        description in arb_description(),
        server_name in arb_server_name(),
        schema in arb_input_schema()
    ) {
        let wrapper = McpToolWrapper::new(&name, &description, schema.clone(), &server_name);
        let definition = wrapper.get_definition();

        prop_assert_eq!(definition.name, name, "Definition name should match");
        prop_assert_eq!(definition.description, description, "Definition description should match");
        prop_assert_eq!(definition.input_schema, schema, "Definition schema should match");
    }

    /// **Feature: tool-alignment, Property 8: MCP Tool Compatibility**
    ///
    /// Property: MCP tools can be registered and retrieved from registry
    /// *For any* MCP tool, it SHALL be registerable in ToolRegistry and
    /// retrievable by name when no native tool shadows it.
    ///
    /// **Validates: Requirements 11.1, 11.4**
    #[test]
    fn prop_mcp_tools_registerable_and_retrievable(
        name in arb_tool_name(),
        description in arb_description(),
        server_name in arb_server_name(),
        schema in arb_input_schema()
    ) {
        let mut registry = ToolRegistry::new();
        let wrapper = McpToolWrapper::new(&name, &description, schema.clone(), &server_name);

        // Register MCP tool
        registry.register_mcp(name.clone(), wrapper);

        // Verify registration
        prop_assert!(registry.contains(&name), "Registry should contain the tool");
        prop_assert!(registry.contains_mcp(&name), "Tool should be identified as MCP");
        prop_assert!(!registry.contains_native(&name), "Tool should not be identified as native");
        prop_assert!(registry.is_mcp(&name), "is_mcp should return true");

        // Verify retrieval
        let tool = registry.get(&name);
        prop_assert!(tool.is_some(), "Tool should be retrievable");
        prop_assert_eq!(tool.unwrap().name(), name.as_str(), "Retrieved tool should have correct name");
        prop_assert_eq!(tool.unwrap().description(), description.as_str(), "Retrieved tool should have correct description");
    }

    /// **Feature: tool-alignment, Property 8: MCP Tool Compatibility**
    ///
    /// Property: Multiple MCP tools can coexist in registry
    /// *For any* set of MCP tools with unique names, all SHALL be
    /// registerable and retrievable from the registry.
    ///
    /// **Validates: Requirements 11.1, 11.4**
    #[test]
    fn prop_multiple_mcp_tools_coexist(
        names in arb_unique_tool_names(5),
        server_name in arb_server_name()
    ) {
        let mut registry = ToolRegistry::new();

        // Register all MCP tools
        for (i, name) in names.iter().enumerate() {
            let wrapper = McpToolWrapper::new(
                name,
                format!("Tool {}", i),
                serde_json::json!({"type": "object"}),
                &server_name,
            );
            registry.register_mcp(name.clone(), wrapper);
        }

        // Verify all are registered
        prop_assert_eq!(registry.mcp_tool_count(), names.len(), "All MCP tools should be registered");
        prop_assert_eq!(registry.tool_count(), names.len(), "Total tool count should match");

        // Verify all are retrievable
        for name in &names {
            prop_assert!(registry.contains(name), "Tool {} should be in registry", name);
            let tool = registry.get(name);
            prop_assert!(tool.is_some(), "Tool {} should be retrievable", name);
        }

        // Verify get_all returns all tools
        let all_tools = registry.get_all();
        prop_assert_eq!(all_tools.len(), names.len(), "get_all should return all MCP tools");
    }

    /// **Feature: tool-alignment, Property 8: MCP Tool Compatibility**
    ///
    /// Property: MCP tool definitions are included in get_definitions
    /// *For any* MCP tool registered in the registry, its definition SHALL
    /// be included in the result of get_definitions().
    ///
    /// **Validates: Requirements 11.1, 11.2**
    #[test]
    fn prop_mcp_definitions_included_in_get_definitions(
        names in arb_unique_tool_names(3),
        server_name in arb_server_name()
    ) {
        let mut registry = ToolRegistry::new();

        // Register MCP tools
        for name in &names {
            let wrapper = McpToolWrapper::new(
                name,
                format!("Description for {}", name),
                serde_json::json!({"type": "object"}),
                &server_name,
            );
            registry.register_mcp(name.clone(), wrapper);
        }

        // Get all definitions
        let definitions = registry.get_definitions();

        // Verify count
        prop_assert_eq!(definitions.len(), names.len(), "Should have definition for each tool");

        // Verify each tool has a definition
        let def_names: Vec<&str> = definitions.iter().map(|d| d.name.as_str()).collect();
        for name in &names {
            prop_assert!(
                def_names.contains(&name.as_str()),
                "Definition for {} should be included",
                name
            );
        }
    }

    /// **Feature: tool-alignment, Property 8: MCP Tool Compatibility**
    ///
    /// Property: MCP tools can be unregistered
    /// *For any* registered MCP tool, unregister_mcp SHALL remove it
    /// from the registry.
    ///
    /// **Validates: Requirements 11.1**
    #[test]
    fn prop_mcp_tools_can_be_unregistered(
        name in arb_tool_name(),
        description in arb_description(),
        server_name in arb_server_name()
    ) {
        let mut registry = ToolRegistry::new();
        let wrapper = McpToolWrapper::new(&name, &description, serde_json::json!({}), &server_name);

        // Register
        registry.register_mcp(name.clone(), wrapper);
        prop_assert!(registry.contains(&name), "Tool should be registered");

        // Unregister
        let removed = registry.unregister_mcp(&name);
        prop_assert!(removed.is_some(), "Unregister should return the removed tool");
        prop_assert!(!registry.contains(&name), "Tool should no longer be in registry");
        prop_assert_eq!(registry.mcp_tool_count(), 0, "MCP tool count should be 0");
    }

    /// **Feature: tool-alignment, Property 8: MCP Tool Compatibility**
    ///
    /// Property: MCP tool check_permissions defaults to Allow
    /// *For any* MCP tool wrapper, check_permissions SHALL return Allow
    /// by default (permission is handled externally by MCP server).
    ///
    /// **Validates: Requirements 11.2**
    #[test]
    fn prop_mcp_check_permissions_defaults_to_allow(
        name in arb_tool_name(),
        description in arb_description(),
        server_name in arb_server_name(),
        context in arb_tool_context()
    ) {
        let wrapper = McpToolWrapper::new(&name, &description, serde_json::json!({}), &server_name);
        let params = serde_json::json!({"input": "test"});

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let result = wrapper.check_permissions(&params, &context).await;
            prop_assert!(result.is_allowed(), "MCP tool should default to Allow permission");
            Ok(())
        })?;
    }
}

// ============================================================================
// Additional Unit Tests for Edge Cases
// ============================================================================

#[test]
fn test_mcp_wrapper_clone() {
    let wrapper = McpToolWrapper::new("test", "Test tool", serde_json::json!({}), "server");
    let cloned = wrapper.clone();

    assert_eq!(wrapper.name(), cloned.name());
    assert_eq!(wrapper.description(), cloned.description());
    assert_eq!(wrapper.server_name(), cloned.server_name());
}

#[test]
fn test_mcp_wrapper_with_complex_schema() {
    let schema = serde_json::json!({
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path"
            },
            "options": {
                "type": "object",
                "properties": {
                    "recursive": {"type": "boolean"},
                    "depth": {"type": "integer"}
                }
            }
        },
        "required": ["path"]
    });

    let wrapper = McpToolWrapper::new("complex_tool", "Complex tool", schema.clone(), "server");
    assert_eq!(wrapper.input_schema(), schema);
}

#[test]
fn test_mcp_tool_names_list() {
    let mut registry = ToolRegistry::new();

    registry.register_mcp(
        "tool1".to_string(),
        McpToolWrapper::new("tool1", "Tool 1", serde_json::json!({}), "server"),
    );
    registry.register_mcp(
        "tool2".to_string(),
        McpToolWrapper::new("tool2", "Tool 2", serde_json::json!({}), "server"),
    );

    let names = registry.mcp_tool_names();
    assert_eq!(names.len(), 2);
    assert!(names.contains(&"tool1"));
    assert!(names.contains(&"tool2"));
}

#[tokio::test]
async fn test_mcp_execute_returns_error() {
    // MCP tools should return an error when executed directly
    // (execution should be handled by MCP client)
    let wrapper = McpToolWrapper::new("test", "Test", serde_json::json!({}), "server");
    let context = ToolContext::new(PathBuf::from("/tmp"));
    let params = serde_json::json!({});

    let result = wrapper.execute(params, &context).await;
    assert!(result.is_err());
}
