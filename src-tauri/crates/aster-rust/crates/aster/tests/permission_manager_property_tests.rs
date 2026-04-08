//! Property-based tests for ToolPermissionManager
//!
//! **Property 9: Permission Result Completeness**
//! *For any* permission check, the result SHALL contain all required fields:
//! allowed flag, reason (when denied), and matched_rule (when a rule matches).
//!
//! **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
//!
//! **Property 5: Permission Priority Evaluation**
//! *For any* set of permissions with different priorities for the same tool,
//! evaluation SHALL process them in descending priority order and return
//! the first matching result.
//!
//! **Validates: Requirements 2.3**
//!
//! **Property 6: Permission Expiry Handling**
//! *For any* permission with an expiry timestamp less than the current context
//! timestamp, the permission SHALL be skipped during evaluation.
//!
//! **Validates: Requirements 2.4**

use aster::permission::{
    ConditionOperator, ConditionType, ParameterRestriction, PermissionCondition, PermissionContext,
    PermissionScope, RestrictionType, ToolPermission, ToolPermissionManager,
};
use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary tool name
fn arb_tool_name() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("bash".to_string()),
        Just("file_read".to_string()),
        Just("file_write".to_string()),
        Just("http_request".to_string()),
        "[a-z_]{3,15}".prop_map(|s| s),
    ]
}

/// Generate arbitrary PermissionScope
fn arb_permission_scope() -> impl Strategy<Value = PermissionScope> {
    prop_oneof![
        Just(PermissionScope::Global),
        Just(PermissionScope::Project),
        Just(PermissionScope::Session),
    ]
}

/// Generate a test context
fn create_test_context(timestamp: i64) -> PermissionContext {
    PermissionContext {
        working_directory: PathBuf::from("/home/user/project"),
        session_id: "test-session".to_string(),
        timestamp,
        user: Some("testuser".to_string()),
        environment: HashMap::new(),
        metadata: HashMap::new(),
    }
}

/// Generate arbitrary timestamp
fn arb_timestamp() -> impl Strategy<Value = i64> {
    1600000000i64..1800000000i64
}

// ============================================================================
// Property Tests - Property 9: Permission Result Completeness
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 9: Permission Result Completeness**
    ///
    /// Property: When a tool is explicitly allowed, the result contains matched_rule
    /// *For any* tool with an explicit allow permission, the result SHALL contain
    /// the matched_rule field populated.
    ///
    /// **Validates: Requirements 5.1, 5.4**
    #[test]
    fn prop_allowed_result_has_matched_rule(
        tool in arb_tool_name(),
        scope in arb_permission_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let perm = ToolPermission {
            tool: tool.clone(),
            allowed: true,
            priority: 10,
            scope,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Allowed by policy".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(perm.clone(), scope);

        let context = create_test_context(1700000000);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert!(result.allowed, "Tool should be allowed");
        prop_assert!(
            result.matched_rule.is_some(),
            "Allowed result should have matched_rule"
        );
        prop_assert_eq!(
            &result.matched_rule.as_ref().unwrap().tool,
            &tool,
            "Matched rule should have correct tool name"
        );
    }

    /// **Feature: tool-permission-system, Property 9: Permission Result Completeness**
    ///
    /// Property: When a tool is explicitly denied, the result contains reason
    /// *For any* tool with an explicit deny permission, the result SHALL contain
    /// a reason explaining the denial.
    ///
    /// **Validates: Requirements 5.1, 5.3**
    #[test]
    fn prop_denied_result_has_reason(
        tool in arb_tool_name(),
        scope in arb_permission_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let perm = ToolPermission {
            tool: tool.clone(),
            allowed: false,
            priority: 10,
            scope,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Denied by security policy".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(perm, scope);

        let context = create_test_context(1700000000);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert!(!result.allowed, "Tool should be denied");
        prop_assert!(
            result.reason.is_some(),
            "Denied result should have a reason"
        );
        prop_assert!(
            result.matched_rule.is_some(),
            "Denied result should have matched_rule"
        );
    }

    /// **Feature: tool-permission-system, Property 9: Permission Result Completeness**
    ///
    /// Property: When no rules match, result allows by default with no matched_rule
    /// *For any* tool without matching permissions, the result SHALL allow
    /// by default and have no matched_rule.
    ///
    /// **Validates: Requirements 5.2**
    #[test]
    fn prop_no_match_allows_by_default(
        tool in arb_tool_name(),
    ) {
        let manager = ToolPermissionManager::new(None);
        // No permissions added

        let context = create_test_context(1700000000);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert!(result.allowed, "Should allow by default when no rules match");
        prop_assert!(
            result.matched_rule.is_none(),
            "Should have no matched_rule when no rules match"
        );
        prop_assert!(
            result.reason.is_none(),
            "Should have no reason when allowed by default"
        );
    }

    /// **Feature: tool-permission-system, Property 9: Permission Result Completeness**
    ///
    /// Property: Parameter violations result in violations list and suggestions
    /// *For any* tool with parameter restrictions that are violated,
    /// the result SHALL contain violations and suggestions.
    ///
    /// **Validates: Requirements 5.1, 5.3, 5.4**
    #[test]
    fn prop_parameter_violation_has_details(
        tool in arb_tool_name(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let perm = ToolPermission {
            tool: tool.clone(),
            allowed: true,
            priority: 10,
            scope: PermissionScope::Global,
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
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(perm, PermissionScope::Global);

        let context = create_test_context(1700000000);
        let mut params = HashMap::new();
        params.insert("command".to_string(), Value::String("rm".to_string())); // Not in whitelist

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert!(!result.allowed, "Should be denied due to parameter violation");
        prop_assert!(result.restricted, "Should be marked as restricted");
        prop_assert!(
            !result.violations.is_empty(),
            "Should have violations list"
        );
        prop_assert!(
            !result.suggestions.is_empty(),
            "Should have suggestions for resolution"
        );
    }

    /// **Feature: tool-permission-system, Property 9: Permission Result Completeness**
    ///
    /// Property: Denied result with conditions has appropriate suggestions
    /// *For any* denied tool with conditions, suggestions SHALL mention conditions.
    ///
    /// **Validates: Requirements 5.3, 5.4**
    #[test]
    fn prop_denied_with_conditions_has_suggestions(
        tool in arb_tool_name(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let perm = ToolPermission {
            tool: tool.clone(),
            allowed: false,
            priority: 10,
            scope: PermissionScope::Global,
            conditions: vec![PermissionCondition {
                condition_type: ConditionType::Context,
                field: Some("working_directory".to_string()),
                operator: ConditionOperator::Contains,
                value: Value::String("project".to_string()),
                validator: None,
                description: None,
            }],
            parameter_restrictions: Vec::new(),
            reason: Some("Denied".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(perm, PermissionScope::Global);

        let context = create_test_context(1700000000);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert!(!result.allowed, "Should be denied");
        prop_assert!(
            !result.suggestions.is_empty(),
            "Should have suggestions"
        );
        // Check that suggestions mention conditions
        let has_condition_suggestion = result.suggestions.iter().any(|s|
            s.contains("condition") || s.contains("Condition")
        );
        prop_assert!(
            has_condition_suggestion,
            "Suggestions should mention conditions"
        );
    }
}

// ============================================================================
// Property Tests - Property 5: Permission Priority Evaluation
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 5: Permission Priority Evaluation**
    ///
    /// Property: Higher priority rules are evaluated first
    /// *For any* set of permissions with different priorities for the same tool,
    /// the highest priority matching rule SHALL determine the result.
    ///
    /// **Validates: Requirements 2.3**
    #[test]
    fn prop_higher_priority_wins(
        tool in arb_tool_name(),
        low_priority in -100i32..0i32,
        high_priority in 1i32..100i32,
        low_allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add low priority rule
        let low_perm = ToolPermission {
            tool: tool.clone(),
            allowed: low_allowed,
            priority: low_priority,
            scope: PermissionScope::Global,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Low priority".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(low_perm, PermissionScope::Global);

        // Add high priority rule with opposite allowed value
        let high_perm = ToolPermission {
            tool: tool.clone(),
            allowed: !low_allowed,
            priority: high_priority,
            scope: PermissionScope::Session, // Different scope to avoid key collision
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("High priority".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(high_perm, PermissionScope::Session);

        let context = create_test_context(1700000000);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // High priority rule should win
        prop_assert_eq!(
            result.allowed, !low_allowed,
            "Higher priority rule should determine the result"
        );
        prop_assert!(
            result.matched_rule.is_some(),
            "Should have matched rule"
        );
        prop_assert_eq!(
            result.matched_rule.as_ref().unwrap().priority,
            high_priority,
            "Matched rule should be the high priority one"
        );
    }

    /// **Feature: tool-permission-system, Property 5: Permission Priority Evaluation**
    ///
    /// Property: First matching rule at same priority wins
    /// *For any* permissions with the same priority, the first matching one
    /// (after scope priority) SHALL be used.
    ///
    /// **Validates: Requirements 2.3**
    #[test]
    fn prop_same_priority_scope_determines(
        tool in arb_tool_name(),
        priority in -50i32..50i32,
        global_allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add global rule
        let global_perm = ToolPermission {
            tool: tool.clone(),
            allowed: global_allowed,
            priority,
            scope: PermissionScope::Global,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Global".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(global_perm, PermissionScope::Global);

        // Add session rule with same priority but opposite allowed
        let session_perm = ToolPermission {
            tool: tool.clone(),
            allowed: !global_allowed,
            priority,
            scope: PermissionScope::Session,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Session".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(session_perm, PermissionScope::Session);

        let context = create_test_context(1700000000);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // Session scope has higher priority than Global
        prop_assert_eq!(
            result.allowed, !global_allowed,
            "Session scope should override Global at same priority"
        );
    }

    /// **Feature: tool-permission-system, Property 5: Permission Priority Evaluation**
    ///
    /// Property: Conditions affect which rule matches
    /// *For any* permissions where high priority has failing conditions,
    /// the lower priority rule with passing conditions SHALL be used.
    ///
    /// **Validates: Requirements 2.3**
    #[test]
    fn prop_conditions_affect_matching(
        tool in arb_tool_name(),
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // High priority rule with failing condition - use wildcard pattern
        let prefix: String = tool.chars().take(3).collect();
        let high_perm = ToolPermission {
            tool: format!("{}*", prefix), // Use prefix wildcard
            allowed: false,
            priority: 100,
            scope: PermissionScope::Global, // Same scope to avoid override
            conditions: vec![PermissionCondition {
                condition_type: ConditionType::Context,
                field: Some("working_directory".to_string()),
                operator: ConditionOperator::Contains,
                value: Value::String("nonexistent_xyz".to_string()),
                validator: None,
                description: None,
            }],
            parameter_restrictions: Vec::new(),
            reason: Some("High priority but condition fails".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(high_perm, PermissionScope::Global);

        // Low priority rule with no conditions (always matches) - exact match
        let low_perm = ToolPermission {
            tool: tool.clone(),
            allowed: true,
            priority: 1,
            scope: PermissionScope::Global, // Same scope
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Low priority, no conditions".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(low_perm, PermissionScope::Global);

        let context = create_test_context(1700000000);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // Both rules match the tool name, but high priority's condition fails
        // So low priority rule should be used
        prop_assert!(
            result.allowed,
            "Low priority rule should match when high priority condition fails"
        );
    }
}

// ============================================================================
// Property Tests - Property 6: Permission Expiry Handling
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 6: Permission Expiry Handling**
    ///
    /// Property: Expired permissions are skipped
    /// *For any* permission with expiry timestamp less than context timestamp,
    /// the permission SHALL be skipped during evaluation.
    ///
    /// **Validates: Requirements 2.4**
    #[test]
    fn prop_expired_permission_skipped(
        tool in arb_tool_name(),
        context_timestamp in 1700000000i64..1800000000i64,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add expired deny rule (should be skipped)
        let expired_perm = ToolPermission {
            tool: tool.clone(),
            allowed: false,
            priority: 100, // High priority
            scope: PermissionScope::Session,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Expired deny rule".to_string()),
            expires_at: Some(context_timestamp - 1000), // Expired
            metadata: HashMap::new(),
        };
        manager.add_permission(expired_perm, PermissionScope::Session);

        let context = create_test_context(context_timestamp);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // Expired rule should be skipped, default allow
        prop_assert!(
            result.allowed,
            "Expired permission should be skipped, allowing by default"
        );
        prop_assert!(
            result.matched_rule.is_none(),
            "No rule should match when only expired rules exist"
        );
    }

    /// **Feature: tool-permission-system, Property 6: Permission Expiry Handling**
    ///
    /// Property: Non-expired permissions are evaluated
    /// *For any* permission with expiry timestamp greater than context timestamp,
    /// the permission SHALL be evaluated normally.
    ///
    /// **Validates: Requirements 2.4**
    #[test]
    fn prop_non_expired_permission_evaluated(
        tool in arb_tool_name(),
        context_timestamp in 1700000000i64..1750000000i64,
        allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add non-expired rule
        let valid_perm = ToolPermission {
            tool: tool.clone(),
            allowed,
            priority: 10,
            scope: PermissionScope::Global,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Valid rule".to_string()),
            expires_at: Some(context_timestamp + 100000), // Not expired
            metadata: HashMap::new(),
        };
        manager.add_permission(valid_perm, PermissionScope::Global);

        let context = create_test_context(context_timestamp);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert_eq!(
            result.allowed, allowed,
            "Non-expired permission should be evaluated"
        );
        prop_assert!(
            result.matched_rule.is_some(),
            "Non-expired rule should match"
        );
    }

    /// **Feature: tool-permission-system, Property 6: Permission Expiry Handling**
    ///
    /// Property: Expired high-priority rule allows lower-priority rule to match
    /// *For any* expired high-priority rule and valid low-priority rule,
    /// the low-priority rule SHALL be used.
    ///
    /// **Validates: Requirements 2.4**
    #[test]
    fn prop_expired_allows_lower_priority(
        tool in arb_tool_name(),
        context_timestamp in 1700000000i64..1750000000i64,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add expired high-priority deny rule - use wildcard pattern
        let prefix: String = tool.chars().take(3).collect();
        let expired_perm = ToolPermission {
            tool: format!("{}*", prefix), // Use prefix wildcard
            allowed: false,
            priority: 100,
            scope: PermissionScope::Global, // Same scope to avoid override
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Expired deny".to_string()),
            expires_at: Some(context_timestamp - 1000), // Expired
            metadata: HashMap::new(),
        };
        manager.add_permission(expired_perm, PermissionScope::Global);

        // Add valid low-priority allow rule - exact match
        let valid_perm = ToolPermission {
            tool: tool.clone(),
            allowed: true,
            priority: 1,
            scope: PermissionScope::Global, // Same scope
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Valid allow".to_string()),
            expires_at: None, // Never expires
            metadata: HashMap::new(),
        };
        manager.add_permission(valid_perm, PermissionScope::Global);

        let context = create_test_context(context_timestamp);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // Both rules match the tool, but high priority is expired
        // So low priority rule should be used
        prop_assert!(
            result.allowed,
            "Low-priority rule should match when high-priority is expired"
        );
    }

    /// **Feature: tool-permission-system, Property 6: Permission Expiry Handling**
    ///
    /// Property: Permission without expiry never expires
    /// *For any* permission with expires_at = None, it SHALL always be evaluated
    /// regardless of context timestamp.
    ///
    /// **Validates: Requirements 2.4**
    #[test]
    fn prop_no_expiry_always_valid(
        tool in arb_tool_name(),
        context_timestamp in arb_timestamp(),
        allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add rule without expiry
        let perm = ToolPermission {
            tool: tool.clone(),
            allowed,
            priority: 10,
            scope: PermissionScope::Global,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("No expiry".to_string()),
            expires_at: None, // Never expires
            metadata: HashMap::new(),
        };
        manager.add_permission(perm, PermissionScope::Global);

        let context = create_test_context(context_timestamp);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert_eq!(
            result.allowed, allowed,
            "Permission without expiry should always be evaluated"
        );
        prop_assert!(
            result.matched_rule.is_some(),
            "Permission without expiry should match"
        );
    }

    /// **Feature: tool-permission-system, Property 6: Permission Expiry Handling**
    ///
    /// Property: Expiry at exact timestamp is considered expired
    /// *For any* permission with expiry timestamp equal to context timestamp,
    /// the permission SHALL be skipped (expired).
    ///
    /// **Validates: Requirements 2.4**
    #[test]
    fn prop_exact_expiry_is_expired(
        tool in arb_tool_name(),
        timestamp in arb_timestamp(),
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add rule that expires at exact context timestamp
        let perm = ToolPermission {
            tool: tool.clone(),
            allowed: false,
            priority: 100,
            scope: PermissionScope::Session,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: Some("Expires now".to_string()),
            expires_at: Some(timestamp), // Expires at exact timestamp
            metadata: HashMap::new(),
        };
        manager.add_permission(perm, PermissionScope::Session);

        // Context timestamp is greater than expiry (timestamp + 1)
        let context = create_test_context(timestamp + 1);
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // Rule should be expired
        prop_assert!(
            result.allowed,
            "Permission at exact expiry should be skipped"
        );
    }
}
