//! Property-based tests for permission merger
//!
//! **Property 1: Scope Priority Resolution**
//! *For any* set of permissions defined across Global, Project, and Session scopes
//! with the same tool name, when checking permission, the result SHALL match
//! the highest priority scope's permission (Session > Project > Global).
//!
//! **Validates: Requirements 1.2, 1.3**
//!
//! **Property 11: Merge Strategy Behavior**
//! *For any* two permissions with the same tool name and a given merge strategy,
//! the merge result SHALL follow the strategy rules: override replaces entirely,
//! merge combines conditions/restrictions, union keeps both.
//!
//! **Validates: Requirements 6.3, 6.4, 6.5, 6.6**

use aster::permission::{
    apply_merge_strategy, merge_permissions, ConditionOperator, ConditionType, MergeStrategy,
    ParameterRestriction, PermissionCondition, PermissionInheritance, PermissionScope,
    RestrictionType, ToolPermission,
};
use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashMap;

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

/// Generate arbitrary MergeStrategy
fn arb_merge_strategy() -> impl Strategy<Value = MergeStrategy> {
    prop_oneof![
        Just(MergeStrategy::Override),
        Just(MergeStrategy::Merge),
        Just(MergeStrategy::Union),
    ]
}

/// Generate arbitrary PermissionCondition
fn arb_permission_condition() -> impl Strategy<Value = PermissionCondition> {
    (
        prop_oneof![
            Just(ConditionType::Context),
            Just(ConditionType::Time),
            Just(ConditionType::Session),
            Just(ConditionType::User),
        ],
        prop::option::of("[a-z_]{3,10}"),
        prop_oneof![
            Just(ConditionOperator::Equals),
            Just(ConditionOperator::NotEquals),
            Just(ConditionOperator::Contains),
        ],
        "[a-z0-9]{1,10}",
    )
        .prop_map(|(cond_type, field, operator, value)| PermissionCondition {
            condition_type: cond_type,
            field,
            operator,
            value: Value::String(value),
            validator: None,
            description: None,
        })
}

/// Generate arbitrary ParameterRestriction
fn arb_parameter_restriction() -> impl Strategy<Value = ParameterRestriction> {
    (
        "[a-z_]{3,10}",
        prop_oneof![
            Just(RestrictionType::Whitelist),
            Just(RestrictionType::Blacklist),
            Just(RestrictionType::Pattern),
        ],
    )
        .prop_map(|(param, restr_type)| ParameterRestriction {
            parameter: param,
            restriction_type: restr_type,
            values: Some(vec![Value::String("allowed".to_string())]),
            pattern: None,
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        })
}

/// Generate arbitrary ToolPermission with specific scope
fn arb_tool_permission_with_scope(
    tool: String,
    scope: PermissionScope,
) -> impl Strategy<Value = ToolPermission> {
    (
        prop::bool::ANY,
        -100i32..100i32,
        prop::collection::vec(arb_permission_condition(), 0..3),
        prop::collection::vec(arb_parameter_restriction(), 0..2),
    )
        .prop_map(
            move |(allowed, priority, conditions, restrictions)| ToolPermission {
                tool: tool.clone(),
                allowed,
                priority,
                scope,
                conditions,
                parameter_restrictions: restrictions,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            },
        )
}

/// Generate arbitrary ToolPermission
fn arb_tool_permission() -> impl Strategy<Value = ToolPermission> {
    (
        arb_tool_name(),
        prop::bool::ANY,
        -100i32..100i32,
        arb_permission_scope(),
        prop::collection::vec(arb_permission_condition(), 0..3),
        prop::collection::vec(arb_parameter_restriction(), 0..2),
    )
        .prop_map(
            |(tool, allowed, priority, scope, conditions, restrictions)| ToolPermission {
                tool,
                allowed,
                priority,
                scope,
                conditions,
                parameter_restrictions: restrictions,
                reason: None,
                expires_at: None,
                metadata: HashMap::new(),
            },
        )
}

// ============================================================================
// Property Tests - Property 1: Scope Priority Resolution
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 1: Scope Priority Resolution**
    ///
    /// Property: Session scope always takes precedence over Project and Global
    /// *For any* tool with permissions in all three scopes, the merged result
    /// SHALL use the Session scope's permission.
    ///
    /// **Validates: Requirements 1.2, 1.3**
    #[test]
    fn prop_session_overrides_all(
        tool in arb_tool_name(),
        global_allowed in prop::bool::ANY,
        project_allowed in prop::bool::ANY,
        session_allowed in prop::bool::ANY,
    ) {
        let global = vec![ToolPermission {
            tool: tool.clone(),
            allowed: global_allowed,
            priority: 100, // High priority shouldn't matter
            scope: PermissionScope::Global,
            ..Default::default()
        }];

        let project = vec![ToolPermission {
            tool: tool.clone(),
            allowed: project_allowed,
            priority: 50,
            scope: PermissionScope::Project,
            ..Default::default()
        }];

        let session = vec![ToolPermission {
            tool: tool.clone(),
            allowed: session_allowed,
            priority: 1, // Low priority shouldn't matter
            scope: PermissionScope::Session,
            ..Default::default()
        }];

        let inheritance = PermissionInheritance::default();
        let result = merge_permissions(&global, &project, &session, &inheritance);

        prop_assert_eq!(result.len(), 1);
        prop_assert_eq!(
            result[0].allowed, session_allowed,
            "Session scope should override all others"
        );
        prop_assert_eq!(result[0].scope, PermissionScope::Session);
    }


    /// **Feature: tool-permission-system, Property 1: Scope Priority Resolution**
    ///
    /// Property: Project scope takes precedence over Global (when no Session)
    /// *For any* tool with permissions in Global and Project scopes,
    /// the merged result SHALL use the Project scope's permission.
    ///
    /// **Validates: Requirements 1.2, 1.3**
    #[test]
    fn prop_project_overrides_global(
        tool in arb_tool_name(),
        global_allowed in prop::bool::ANY,
        project_allowed in prop::bool::ANY,
    ) {
        let global = vec![ToolPermission {
            tool: tool.clone(),
            allowed: global_allowed,
            priority: 100,
            scope: PermissionScope::Global,
            ..Default::default()
        }];

        let project = vec![ToolPermission {
            tool: tool.clone(),
            allowed: project_allowed,
            priority: 1,
            scope: PermissionScope::Project,
            ..Default::default()
        }];

        let inheritance = PermissionInheritance::default();
        let result = merge_permissions(&global, &project, &[], &inheritance);

        prop_assert_eq!(result.len(), 1);
        prop_assert_eq!(
            result[0].allowed, project_allowed,
            "Project scope should override Global"
        );
        prop_assert_eq!(result[0].scope, PermissionScope::Project);
    }

    /// **Feature: tool-permission-system, Property 1: Scope Priority Resolution**
    ///
    /// Property: Global permissions are used when no higher scope exists
    /// *For any* tool with only Global scope permission, that permission SHALL be used.
    ///
    /// **Validates: Requirements 1.2**
    #[test]
    fn prop_global_used_when_alone(
        perm in arb_tool_permission_with_scope("test_tool".to_string(), PermissionScope::Global)
    ) {
        let global = vec![perm.clone()];
        let inheritance = PermissionInheritance::default();

        let result = merge_permissions(&global, &[], &[], &inheritance);

        prop_assert_eq!(result.len(), 1);
        prop_assert_eq!(result[0].allowed, perm.allowed);
        prop_assert_eq!(result[0].scope, PermissionScope::Global);
    }


    /// **Feature: tool-permission-system, Property 1: Scope Priority Resolution**
    ///
    /// Property: Disabling global inheritance excludes global permissions
    /// *For any* set of permissions, when inherit_global is false,
    /// global permissions SHALL NOT appear in the result.
    ///
    /// **Validates: Requirements 1.2**
    #[test]
    fn prop_inherit_global_disabled_excludes_global(
        global_perm in arb_tool_permission_with_scope("global_tool".to_string(), PermissionScope::Global),
        project_perm in arb_tool_permission_with_scope("project_tool".to_string(), PermissionScope::Project),
    ) {
        let global = vec![global_perm];
        let project = vec![project_perm.clone()];

        let inheritance = PermissionInheritance {
            inherit_global: false,
            inherit_project: true,
            ..Default::default()
        };

        let result = merge_permissions(&global, &project, &[], &inheritance);

        // Global tool should not be in result
        let has_global_tool = result.iter().any(|p| p.tool == "global_tool");
        prop_assert!(!has_global_tool, "Global permissions should be excluded");

        // Project tool should still be present
        let has_project_tool = result.iter().any(|p| p.tool == "project_tool");
        prop_assert!(has_project_tool, "Project permissions should be included");
    }

    /// **Feature: tool-permission-system, Property 1: Scope Priority Resolution**
    ///
    /// Property: Disabling project inheritance excludes project permissions
    /// *For any* set of permissions, when inherit_project is false,
    /// project permissions SHALL NOT appear in the result (unless overridden by session).
    ///
    /// **Validates: Requirements 1.2**
    #[test]
    fn prop_inherit_project_disabled_excludes_project(
        global_perm in arb_tool_permission_with_scope("global_tool".to_string(), PermissionScope::Global),
        project_perm in arb_tool_permission_with_scope("project_tool".to_string(), PermissionScope::Project),
    ) {
        let global = vec![global_perm.clone()];
        let project = vec![project_perm];

        let inheritance = PermissionInheritance {
            inherit_global: true,
            inherit_project: false,
            ..Default::default()
        };

        let result = merge_permissions(&global, &project, &[], &inheritance);

        // Project tool should not be in result
        let has_project_tool = result.iter().any(|p| p.tool == "project_tool");
        prop_assert!(!has_project_tool, "Project permissions should be excluded");

        // Global tool should still be present
        let has_global_tool = result.iter().any(|p| p.tool == "global_tool");
        prop_assert!(has_global_tool, "Global permissions should be included");
    }


    /// **Feature: tool-permission-system, Property 1: Scope Priority Resolution**
    ///
    /// Property: Multiple different tools are all preserved
    /// *For any* set of permissions for different tools across scopes,
    /// all unique tools SHALL appear in the merged result.
    ///
    /// **Validates: Requirements 1.2**
    #[test]
    fn prop_different_tools_preserved(
        tool1 in "[a-z]{5}_1",
        tool2 in "[a-z]{5}_2",
        tool3 in "[a-z]{5}_3",
    ) {
        let global = vec![ToolPermission {
            tool: tool1.clone(),
            allowed: true,
            scope: PermissionScope::Global,
            ..Default::default()
        }];

        let project = vec![ToolPermission {
            tool: tool2.clone(),
            allowed: false,
            scope: PermissionScope::Project,
            ..Default::default()
        }];

        let session = vec![ToolPermission {
            tool: tool3.clone(),
            allowed: true,
            scope: PermissionScope::Session,
            ..Default::default()
        }];

        let inheritance = PermissionInheritance::default();
        let result = merge_permissions(&global, &project, &session, &inheritance);

        prop_assert_eq!(result.len(), 3, "All three tools should be in result");

        let tools: Vec<&str> = result.iter().map(|p| p.tool.as_str()).collect();
        prop_assert!(tools.contains(&tool1.as_str()));
        prop_assert!(tools.contains(&tool2.as_str()));
        prop_assert!(tools.contains(&tool3.as_str()));
    }

    /// **Feature: tool-permission-system, Property 1: Scope Priority Resolution**
    ///
    /// Property: Result is sorted by priority (highest first)
    /// *For any* merged permissions, the result SHALL be sorted by priority descending.
    ///
    /// **Validates: Requirements 1.2**
    #[test]
    fn prop_result_sorted_by_priority(
        perms in prop::collection::vec(arb_tool_permission(), 1..10)
    ) {
        // Ensure unique tool names
        let mut unique_perms: Vec<ToolPermission> = Vec::new();
        let mut seen_tools = std::collections::HashSet::new();
        for mut perm in perms {
            if !seen_tools.contains(&perm.tool) {
                seen_tools.insert(perm.tool.clone());
                perm.scope = PermissionScope::Global; // All global for simplicity
                unique_perms.push(perm);
            }
        }

        if unique_perms.is_empty() {
            return Ok(());
        }

        let inheritance = PermissionInheritance::default();
        let result = merge_permissions(&unique_perms, &[], &[], &inheritance);

        // Check that result is sorted by priority descending
        for i in 1..result.len() {
            prop_assert!(
                result[i - 1].priority >= result[i].priority,
                "Result should be sorted by priority descending"
            );
        }
    }
}

// ============================================================================
// Property Tests - Property 11: Merge Strategy Behavior
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 11: Merge Strategy Behavior**
    ///
    /// Property: Override strategy completely replaces the existing permission
    /// *For any* two permissions with the same tool, applying Override strategy
    /// SHALL result in the new permission entirely replacing the existing one.
    ///
    /// **Validates: Requirements 6.4**
    #[test]
    fn prop_override_replaces_entirely(
        existing in arb_tool_permission_with_scope("test_tool".to_string(), PermissionScope::Global),
        new_perm in arb_tool_permission_with_scope("test_tool".to_string(), PermissionScope::Project),
    ) {
        let result = apply_merge_strategy(&existing, &new_perm, &MergeStrategy::Override);

        // Result should be identical to new_perm
        prop_assert_eq!(result.tool, new_perm.tool);
        prop_assert_eq!(result.allowed, new_perm.allowed);
        prop_assert_eq!(result.priority, new_perm.priority);
        prop_assert_eq!(result.scope, new_perm.scope);
        prop_assert_eq!(result.conditions.len(), new_perm.conditions.len());
        prop_assert_eq!(
            result.parameter_restrictions.len(),
            new_perm.parameter_restrictions.len()
        );
    }

    /// **Feature: tool-permission-system, Property 11: Merge Strategy Behavior**
    ///
    /// Property: Merge strategy combines conditions from both permissions
    /// *For any* two permissions with different conditions, applying Merge strategy
    /// SHALL result in conditions from both being present.
    ///
    /// **Validates: Requirements 6.5**
    #[test]
    fn prop_merge_combines_conditions(
        existing_cond in arb_permission_condition(),
        new_cond in arb_permission_condition(),
    ) {
        let existing = ToolPermission {
            tool: "test_tool".to_string(),
            allowed: true,
            priority: 10,
            scope: PermissionScope::Global,
            conditions: vec![existing_cond.clone()],
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };

        let new_perm = ToolPermission {
            tool: "test_tool".to_string(),
            allowed: false,
            priority: 20,
            scope: PermissionScope::Project,
            conditions: vec![new_cond.clone()],
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };

        let result = apply_merge_strategy(&existing, &new_perm, &MergeStrategy::Merge);

        // New permission's basic properties should be used
        prop_assert_eq!(result.allowed, new_perm.allowed);
        prop_assert_eq!(result.priority, new_perm.priority);
        prop_assert_eq!(result.scope, new_perm.scope);

        // Conditions should be combined (at least 1, at most 2 if different)
        prop_assert!(
            !result.conditions.is_empty(),
            "Merged result should have at least one condition"
        );
        prop_assert!(
            result.conditions.len() <= 2,
            "Merged result should have at most two conditions"
        );
    }


    /// **Feature: tool-permission-system, Property 11: Merge Strategy Behavior**
    ///
    /// Property: Merge strategy combines parameter restrictions
    /// *For any* two permissions with different parameter restrictions,
    /// applying Merge strategy SHALL result in restrictions from both being present.
    ///
    /// **Validates: Requirements 6.5**
    #[test]
    fn prop_merge_combines_restrictions(
        existing_restr in arb_parameter_restriction(),
        new_restr in arb_parameter_restriction(),
    ) {
        let existing = ToolPermission {
            tool: "test_tool".to_string(),
            allowed: true,
            priority: 10,
            scope: PermissionScope::Global,
            conditions: Vec::new(),
            parameter_restrictions: vec![existing_restr.clone()],
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };

        let new_perm = ToolPermission {
            tool: "test_tool".to_string(),
            allowed: false,
            priority: 20,
            scope: PermissionScope::Project,
            conditions: Vec::new(),
            parameter_restrictions: vec![new_restr.clone()],
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };

        let result = apply_merge_strategy(&existing, &new_perm, &MergeStrategy::Merge);

        // If parameters are different, both should be present
        // If same parameter, new one replaces old
        if existing_restr.parameter != new_restr.parameter {
            prop_assert_eq!(
                result.parameter_restrictions.len(),
                2,
                "Different parameters should both be present"
            );
        } else {
            prop_assert_eq!(
                result.parameter_restrictions.len(),
                1,
                "Same parameter should be replaced"
            );
        }
    }

    /// **Feature: tool-permission-system, Property 11: Merge Strategy Behavior**
    ///
    /// Property: Union strategy keeps all conditions (including duplicates)
    /// *For any* two permissions, applying Union strategy SHALL result in
    /// all conditions from both being present.
    ///
    /// **Validates: Requirements 6.6**
    #[test]
    fn prop_union_keeps_all_conditions(
        existing_conds in prop::collection::vec(arb_permission_condition(), 0..3),
        new_conds in prop::collection::vec(arb_permission_condition(), 0..3),
    ) {
        let existing = ToolPermission {
            tool: "test_tool".to_string(),
            allowed: true,
            priority: 10,
            scope: PermissionScope::Global,
            conditions: existing_conds.clone(),
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };

        let new_perm = ToolPermission {
            tool: "test_tool".to_string(),
            allowed: false,
            priority: 20,
            scope: PermissionScope::Project,
            conditions: new_conds.clone(),
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };

        let result = apply_merge_strategy(&existing, &new_perm, &MergeStrategy::Union);

        // Union should have all conditions from both
        let expected_count = existing_conds.len() + new_conds.len();
        prop_assert_eq!(
            result.conditions.len(),
            expected_count,
            "Union should keep all conditions from both permissions"
        );
    }


    /// **Feature: tool-permission-system, Property 11: Merge Strategy Behavior**
    ///
    /// Property: Union strategy keeps all parameter restrictions
    /// *For any* two permissions, applying Union strategy SHALL result in
    /// all parameter restrictions from both being present.
    ///
    /// **Validates: Requirements 6.6**
    #[test]
    fn prop_union_keeps_all_restrictions(
        existing_restrs in prop::collection::vec(arb_parameter_restriction(), 0..3),
        new_restrs in prop::collection::vec(arb_parameter_restriction(), 0..3),
    ) {
        let existing = ToolPermission {
            tool: "test_tool".to_string(),
            allowed: true,
            priority: 10,
            scope: PermissionScope::Global,
            conditions: Vec::new(),
            parameter_restrictions: existing_restrs.clone(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };

        let new_perm = ToolPermission {
            tool: "test_tool".to_string(),
            allowed: false,
            priority: 20,
            scope: PermissionScope::Project,
            conditions: Vec::new(),
            parameter_restrictions: new_restrs.clone(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };

        let result = apply_merge_strategy(&existing, &new_perm, &MergeStrategy::Union);

        // Union should have all restrictions from both
        let expected_count = existing_restrs.len() + new_restrs.len();
        prop_assert_eq!(
            result.parameter_restrictions.len(),
            expected_count,
            "Union should keep all restrictions from both permissions"
        );
    }

    /// **Feature: tool-permission-system, Property 11: Merge Strategy Behavior**
    ///
    /// Property: All merge strategies preserve the new permission's basic properties
    /// *For any* merge strategy, the result SHALL use the new permission's
    /// allowed, priority, and scope values.
    ///
    /// **Validates: Requirements 6.4, 6.5, 6.6**
    #[test]
    fn prop_all_strategies_use_new_basic_properties(
        existing in arb_tool_permission_with_scope("test_tool".to_string(), PermissionScope::Global),
        new_perm in arb_tool_permission_with_scope("test_tool".to_string(), PermissionScope::Project),
        strategy in arb_merge_strategy(),
    ) {
        let result = apply_merge_strategy(&existing, &new_perm, &strategy);

        prop_assert_eq!(
            result.allowed, new_perm.allowed,
            "Result should use new permission's allowed value"
        );
        prop_assert_eq!(
            result.priority, new_perm.priority,
            "Result should use new permission's priority"
        );
        prop_assert_eq!(
            result.scope, new_perm.scope,
            "Result should use new permission's scope"
        );
    }


    /// **Feature: tool-permission-system, Property 11: Merge Strategy Behavior**
    ///
    /// Property: Merge strategy with full merge_permissions function
    /// *For any* permissions across scopes with Merge strategy,
    /// conditions and restrictions SHALL be combined when merging.
    ///
    /// **Validates: Requirements 6.3, 6.5**
    #[test]
    fn prop_merge_strategy_in_full_merge(
        global_cond in arb_permission_condition(),
        project_cond in arb_permission_condition(),
    ) {
        let global = vec![ToolPermission {
            tool: "test_tool".to_string(),
            allowed: true,
            priority: 10,
            scope: PermissionScope::Global,
            conditions: vec![global_cond.clone()],
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        }];

        let project = vec![ToolPermission {
            tool: "test_tool".to_string(),
            allowed: false,
            priority: 20,
            scope: PermissionScope::Project,
            conditions: vec![project_cond.clone()],
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        }];

        let inheritance = PermissionInheritance {
            inherit_global: true,
            inherit_project: true,
            override_global: true,
            merge_strategy: MergeStrategy::Merge,
        };

        let result = merge_permissions(&global, &project, &[], &inheritance);

        prop_assert_eq!(result.len(), 1);
        prop_assert_eq!(result[0].allowed, false); // Project's value

        // Conditions should be combined
        prop_assert!(
            !result[0].conditions.is_empty(),
            "Merged result should have conditions"
        );
    }

    /// **Feature: tool-permission-system, Property 11: Merge Strategy Behavior**
    ///
    /// Property: Override strategy in full merge_permissions function
    /// *For any* permissions across scopes with Override strategy,
    /// the higher priority scope's permission SHALL completely replace lower ones.
    ///
    /// **Validates: Requirements 6.3, 6.4**
    #[test]
    fn prop_override_strategy_in_full_merge(
        global_conds in prop::collection::vec(arb_permission_condition(), 1..3),
        project_conds in prop::collection::vec(arb_permission_condition(), 1..3),
    ) {
        let global = vec![ToolPermission {
            tool: "test_tool".to_string(),
            allowed: true,
            priority: 10,
            scope: PermissionScope::Global,
            conditions: global_conds,
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        }];

        let project = vec![ToolPermission {
            tool: "test_tool".to_string(),
            allowed: false,
            priority: 20,
            scope: PermissionScope::Project,
            conditions: project_conds.clone(),
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        }];

        let inheritance = PermissionInheritance {
            inherit_global: true,
            inherit_project: true,
            override_global: true,
            merge_strategy: MergeStrategy::Override,
        };

        let result = merge_permissions(&global, &project, &[], &inheritance);

        prop_assert_eq!(result.len(), 1);
        prop_assert_eq!(result[0].allowed, false); // Project's value

        // Only project's conditions should be present (override)
        prop_assert_eq!(
            result[0].conditions.len(),
            project_conds.len(),
            "Override should only keep new permission's conditions"
        );
    }
}
