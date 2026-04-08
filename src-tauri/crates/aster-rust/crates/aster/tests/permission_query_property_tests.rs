//! Property-based tests for Permission Query
//!
//! **Property 16: Permission Query**
//! *For any* query filter, the query result SHALL contain exactly all permissions
//! that match all specified filter criteria.
//!
//! **Validates: Requirements 9.2, 9.3**

use aster::permission::{
    ConditionOperator, ConditionType, ParameterRestriction, PermissionCondition, PermissionFilter,
    PermissionScope, RestrictionType, ToolPermission, ToolPermissionManager,
};
use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashMap;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary PermissionScope
fn arb_permission_scope() -> impl Strategy<Value = PermissionScope> {
    prop_oneof![
        Just(PermissionScope::Global),
        Just(PermissionScope::Project),
        Just(PermissionScope::Session),
    ]
}

// ============================================================================
// Property Tests - Property 16: Permission Query
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 16: Permission Query**
    ///
    /// Property: Filter by allowed returns only matching permissions
    /// *For any* filter with allowed=true, the result SHALL contain only
    /// permissions with allowed=true.
    ///
    /// **Validates: Requirements 9.2, 9.3**
    #[test]
    fn prop_filter_by_allowed(
        num_allowed in 0usize..5,
        num_denied in 0usize..5,
        filter_allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add allowed permissions
        for i in 0..num_allowed {
            let perm = ToolPermission {
                tool: format!("allowed_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Global);
        }

        // Add denied permissions
        for i in 0..num_denied {
            let perm = ToolPermission {
                tool: format!("denied_tool_{}", i),
                allowed: false,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Project,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Project);
        }

        let filter = PermissionFilter::new().with_allowed(filter_allowed);
        let results = manager.query_permissions(filter);

        // All results should have the filtered allowed value
        for perm in &results {
            prop_assert_eq!(
                perm.allowed, filter_allowed,
                "All results should match the allowed filter"
            );
        }

        // Count should match expected
        let expected_count = if filter_allowed { num_allowed } else { num_denied };
        prop_assert_eq!(
            results.len(), expected_count,
            "Result count should match expected"
        );
    }

    /// **Feature: tool-permission-system, Property 16: Permission Query**
    ///
    /// Property: Filter by scope returns only matching permissions
    /// *For any* filter with a specific scope, the result SHALL contain only
    /// permissions from that scope.
    ///
    /// **Validates: Requirements 9.2, 9.3**
    #[test]
    fn prop_filter_by_scope(
        num_global in 0usize..3,
        num_project in 0usize..3,
        num_session in 0usize..3,
        filter_scope in arb_permission_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add global permissions
        for i in 0..num_global {
            let perm = ToolPermission {
                tool: format!("global_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Global);
        }

        // Add project permissions
        for i in 0..num_project {
            let perm = ToolPermission {
                tool: format!("project_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Project,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Project);
        }

        // Add session permissions
        for i in 0..num_session {
            let perm = ToolPermission {
                tool: format!("session_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Session,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Session);
        }

        let filter = PermissionFilter::new().with_scope(filter_scope);
        let results = manager.query_permissions(filter);

        // All results should have the filtered scope
        for perm in &results {
            prop_assert_eq!(
                perm.scope, filter_scope,
                "All results should match the scope filter"
            );
        }

        // Count should match expected
        let expected_count = match filter_scope {
            PermissionScope::Global => num_global,
            PermissionScope::Project => num_project,
            PermissionScope::Session => num_session,
        };
        prop_assert_eq!(
            results.len(), expected_count,
            "Result count should match expected for scope"
        );
    }

    /// **Feature: tool-permission-system, Property 16: Permission Query**
    ///
    /// Property: Filter by has_conditions returns only matching permissions
    /// *For any* filter with has_conditions, the result SHALL contain only
    /// permissions with matching condition status.
    ///
    /// **Validates: Requirements 9.2, 9.3**
    #[test]
    fn prop_filter_by_has_conditions(
        num_with_conditions in 0usize..5,
        num_without_conditions in 0usize..5,
        filter_has_conditions in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add permissions with conditions
        for i in 0..num_with_conditions {
            let perm = ToolPermission {
                tool: format!("conditional_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: vec![PermissionCondition {
                    condition_type: ConditionType::Context,
                    field: Some("working_directory".to_string()),
                    operator: ConditionOperator::Contains,
                    value: Value::String("test".to_string()),
                    validator: None,
                    description: None,
                }],
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Global);
        }

        // Add permissions without conditions
        for i in 0..num_without_conditions {
            let perm = ToolPermission {
                tool: format!("simple_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Project,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Project);
        }

        let filter = PermissionFilter::new().with_has_conditions(filter_has_conditions);
        let results = manager.query_permissions(filter);

        // All results should match the has_conditions filter
        for perm in &results {
            let has_conditions = !perm.conditions.is_empty();
            prop_assert_eq!(
                has_conditions, filter_has_conditions,
                "All results should match the has_conditions filter"
            );
        }

        // Count should match expected
        let expected_count = if filter_has_conditions {
            num_with_conditions
        } else {
            num_without_conditions
        };
        prop_assert_eq!(
            results.len(), expected_count,
            "Result count should match expected"
        );
    }

    /// **Feature: tool-permission-system, Property 16: Permission Query**
    ///
    /// Property: Filter by has_restrictions returns only matching permissions
    /// *For any* filter with has_restrictions, the result SHALL contain only
    /// permissions with matching restriction status.
    ///
    /// **Validates: Requirements 9.2, 9.3**
    #[test]
    fn prop_filter_by_has_restrictions(
        num_with_restrictions in 0usize..5,
        num_without_restrictions in 0usize..5,
        filter_has_restrictions in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add permissions with restrictions
        for i in 0..num_with_restrictions {
            let perm = ToolPermission {
                tool: format!("restricted_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: vec![ParameterRestriction {
                    parameter: "command".to_string(),
                    restriction_type: RestrictionType::Whitelist,
                    values: Some(vec![Value::String("ls".to_string())]),
                    pattern: None,
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: None,
                }],
                scope: PermissionScope::Global,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Global);
        }

        // Add permissions without restrictions
        for i in 0..num_without_restrictions {
            let perm = ToolPermission {
                tool: format!("unrestricted_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Project,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Project);
        }

        let filter = PermissionFilter::new().with_has_restrictions(filter_has_restrictions);
        let results = manager.query_permissions(filter);

        // All results should match the has_restrictions filter
        for perm in &results {
            let has_restrictions = !perm.parameter_restrictions.is_empty();
            prop_assert_eq!(
                has_restrictions, filter_has_restrictions,
                "All results should match the has_restrictions filter"
            );
        }

        // Count should match expected
        let expected_count = if filter_has_restrictions {
            num_with_restrictions
        } else {
            num_without_restrictions
        };
        prop_assert_eq!(
            results.len(), expected_count,
            "Result count should match expected"
        );
    }

    /// **Feature: tool-permission-system, Property 16: Permission Query**
    ///
    /// Property: Filter by tool_pattern returns only matching permissions
    /// *For any* filter with tool_pattern, the result SHALL contain only
    /// permissions whose tool name matches the pattern.
    ///
    /// **Validates: Requirements 9.2, 9.3**
    #[test]
    fn prop_filter_by_tool_pattern(
        num_file_tools in 0usize..3,
        num_bash_tools in 0usize..3,
        num_http_tools in 0usize..3,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add file_* tools
        for i in 0..num_file_tools {
            let perm = ToolPermission {
                tool: format!("file_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Global);
        }

        // Add bash_* tools
        for i in 0..num_bash_tools {
            let perm = ToolPermission {
                tool: format!("bash_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Project,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Project);
        }

        // Add http_* tools
        for i in 0..num_http_tools {
            let perm = ToolPermission {
                tool: format!("http_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Session,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Session);
        }

        // Query for file_* pattern
        let filter = PermissionFilter::new().with_tool_pattern("file_*");
        let results = manager.query_permissions(filter);

        // All results should start with "file_"
        for perm in &results {
            prop_assert!(
                perm.tool.starts_with("file_"),
                "All results should match the tool pattern"
            );
        }

        prop_assert_eq!(
            results.len(), num_file_tools,
            "Result count should match expected for file_* pattern"
        );
    }

    /// **Feature: tool-permission-system, Property 16: Permission Query**
    ///
    /// Property: Combined filters use AND logic
    /// *For any* filter with multiple criteria, the result SHALL contain only
    /// permissions that match ALL criteria.
    ///
    /// **Validates: Requirements 9.2, 9.3**
    #[test]
    fn prop_combined_filters_use_and_logic(
        num_matching in 0usize..3,
        num_partial_match in 0usize..3,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add permissions that match all criteria: allowed=true, has_conditions=true, scope=Global
        for i in 0..num_matching {
            let perm = ToolPermission {
                tool: format!("matching_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: vec![PermissionCondition {
                    condition_type: ConditionType::Context,
                    field: Some("test".to_string()),
                    operator: ConditionOperator::Equals,
                    value: Value::String("value".to_string()),
                    validator: None,
                    description: None,
                }],
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Global);
        }

        // Add permissions that only partially match (allowed=true but no conditions)
        for i in 0..num_partial_match {
            let perm = ToolPermission {
                tool: format!("partial_tool_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(), // No conditions
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Global);
        }

        // Query with combined filters
        let filter = PermissionFilter::new()
            .with_allowed(true)
            .with_has_conditions(true)
            .with_scope(PermissionScope::Global);
        let results = manager.query_permissions(filter);

        // All results should match ALL criteria
        for perm in &results {
            prop_assert!(perm.allowed, "Result should be allowed");
            prop_assert!(!perm.conditions.is_empty(), "Result should have conditions");
            prop_assert_eq!(perm.scope, PermissionScope::Global, "Result should be Global scope");
        }

        // Only fully matching permissions should be returned
        prop_assert_eq!(
            results.len(), num_matching,
            "Only fully matching permissions should be returned"
        );
    }

    /// **Feature: tool-permission-system, Property 16: Permission Query**
    ///
    /// Property: Empty filter returns all permissions
    /// *For any* empty filter, the result SHALL contain all permissions.
    ///
    /// **Validates: Requirements 9.2, 9.3**
    #[test]
    fn prop_empty_filter_returns_all(
        num_global in 0usize..3,
        num_project in 0usize..3,
        num_session in 0usize..3,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add permissions to all scopes
        for i in 0..num_global {
            let perm = ToolPermission {
                tool: format!("global_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Global);
        }

        for i in 0..num_project {
            let perm = ToolPermission {
                tool: format!("project_{}", i),
                allowed: false,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Project,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Project);
        }

        for i in 0..num_session {
            let perm = ToolPermission {
                tool: format!("session_{}", i),
                allowed: true,
                priority: 0,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Session,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            };
            manager.add_permission(perm, PermissionScope::Session);
        }

        // Query with empty filter
        let filter = PermissionFilter::new();
        let results = manager.query_permissions(filter);

        let expected_total = num_global + num_project + num_session;
        prop_assert_eq!(
            results.len(), expected_total,
            "Empty filter should return all permissions"
        );
    }
}
