//! Property-based tests for Permission Statistics
//!
//! **Property 15: Statistics Calculation**
//! *For any* set of permissions, the statistics SHALL accurately reflect
//! the counts of total, allowed, denied, conditional, and restricted permissions.
//!
//! **Validates: Requirements 9.1**

use aster::permission::{
    ConditionOperator, ConditionType, ParameterRestriction, PermissionCondition, PermissionScope,
    RestrictionType, ToolPermission, ToolPermissionManager,
};
use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashMap;

// ============================================================================
// Arbitrary Generators
// ============================================================================

// Note: The following generators are kept for potential future use but are
// currently unused in the active tests.

/// Generate arbitrary condition
#[allow(dead_code)]
fn arb_condition() -> impl Strategy<Value = PermissionCondition> {
    (
        prop_oneof![
            Just(ConditionType::Context),
            Just(ConditionType::Time),
            Just(ConditionType::User),
        ],
        "[a-z_]{3,10}".prop_map(|s| s),
    )
        .prop_map(|(condition_type, field)| PermissionCondition {
            condition_type,
            field: Some(field),
            operator: ConditionOperator::Equals,
            value: Value::String("test".to_string()),
            validator: None,
            description: None,
        })
}

/// Generate arbitrary parameter restriction
#[allow(dead_code)]
fn arb_restriction() -> impl Strategy<Value = ParameterRestriction> {
    "[a-z_]{3,10}".prop_map(|param| ParameterRestriction {
        parameter: param,
        restriction_type: RestrictionType::Whitelist,
        values: Some(vec![Value::String("allowed".to_string())]),
        pattern: None,
        validator: None,
        min: None,
        max: None,
        required: false,
        description: None,
    })
}

// ============================================================================
// Property Tests - Property 15: Statistics Calculation
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 15: Statistics Calculation**
    ///
    /// Property: Total permissions count is accurate
    /// *For any* set of permissions added to the manager, the total_permissions
    /// statistic SHALL equal the actual number of permissions.
    ///
    /// **Validates: Requirements 9.1**
    #[test]
    fn prop_total_permissions_accurate(
        num_global in 0usize..5,
        num_project in 0usize..5,
        num_session in 0usize..5,
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

        let stats = manager.get_stats();
        let expected_total = num_global + num_project + num_session;

        prop_assert_eq!(
            stats.total_permissions, expected_total,
            "Total permissions should equal sum of all scopes"
        );
    }

    /// **Feature: tool-permission-system, Property 15: Statistics Calculation**
    ///
    /// Property: Allowed and denied counts are accurate and sum to total
    /// *For any* set of permissions, allowed_tools + denied_tools SHALL equal total_permissions.
    ///
    /// **Validates: Requirements 9.1**
    #[test]
    fn prop_allowed_denied_sum_to_total(
        num_allowed in 0usize..10,
        num_denied in 0usize..10,
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

        let stats = manager.get_stats();

        prop_assert_eq!(
            stats.allowed_tools, num_allowed,
            "Allowed tools count should be accurate"
        );
        prop_assert_eq!(
            stats.denied_tools, num_denied,
            "Denied tools count should be accurate"
        );
        prop_assert_eq!(
            stats.allowed_tools + stats.denied_tools, stats.total_permissions,
            "Allowed + denied should equal total"
        );
    }

    /// **Feature: tool-permission-system, Property 15: Statistics Calculation**
    ///
    /// Property: Conditional tools count is accurate
    /// *For any* set of permissions with varying conditions, conditional_tools
    /// SHALL equal the count of permissions with non-empty conditions.
    ///
    /// **Validates: Requirements 9.1**
    #[test]
    fn prop_conditional_tools_accurate(
        num_with_conditions in 0usize..5,
        num_without_conditions in 0usize..5,
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

        let stats = manager.get_stats();

        prop_assert_eq!(
            stats.conditional_tools, num_with_conditions,
            "Conditional tools count should be accurate"
        );
    }

    /// **Feature: tool-permission-system, Property 15: Statistics Calculation**
    ///
    /// Property: Restricted parameters count is accurate
    /// *For any* set of permissions with varying restrictions, restricted_parameters
    /// SHALL equal the count of permissions with non-empty parameter_restrictions.
    ///
    /// **Validates: Requirements 9.1**
    #[test]
    fn prop_restricted_parameters_accurate(
        num_with_restrictions in 0usize..5,
        num_without_restrictions in 0usize..5,
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

        let stats = manager.get_stats();

        prop_assert_eq!(
            stats.restricted_parameters, num_with_restrictions,
            "Restricted parameters count should be accurate"
        );
    }

    /// **Feature: tool-permission-system, Property 15: Statistics Calculation**
    ///
    /// Property: Empty manager has zero stats
    /// *For any* empty manager, all statistics SHALL be zero.
    ///
    /// **Validates: Requirements 9.1**
    #[test]
    fn prop_empty_manager_zero_stats(_seed in 0u32..1000) {
        let manager = ToolPermissionManager::new(None);
        let stats = manager.get_stats();

        prop_assert_eq!(stats.total_permissions, 0, "Empty manager should have 0 total");
        prop_assert_eq!(stats.allowed_tools, 0, "Empty manager should have 0 allowed");
        prop_assert_eq!(stats.denied_tools, 0, "Empty manager should have 0 denied");
        prop_assert_eq!(stats.conditional_tools, 0, "Empty manager should have 0 conditional");
        prop_assert_eq!(stats.restricted_parameters, 0, "Empty manager should have 0 restricted");
    }

    /// **Feature: tool-permission-system, Property 15: Statistics Calculation**
    ///
    /// Property: Stats are consistent after adding and removing permissions
    /// *For any* sequence of add/remove operations, stats SHALL remain accurate.
    ///
    /// **Validates: Requirements 9.1**
    #[test]
    fn prop_stats_consistent_after_operations(
        num_to_add in 1usize..5,
        num_to_remove in 0usize..3,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add permissions
        for i in 0..num_to_add {
            let perm = ToolPermission {
                tool: format!("tool_{}", i),
                allowed: i % 2 == 0, // Alternate allowed/denied
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

        // Remove some permissions
        let actual_removed = num_to_remove.min(num_to_add);
        for i in 0..actual_removed {
            manager.remove_permission(&format!("tool_{}", i), Some(PermissionScope::Global));
        }

        let stats = manager.get_stats();
        let expected_remaining = num_to_add - actual_removed;

        prop_assert_eq!(
            stats.total_permissions, expected_remaining,
            "Stats should reflect remaining permissions after removal"
        );
    }
}
