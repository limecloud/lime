//! Property-based tests for Permission Inheritance Configuration
//!
//! **Property 10: Inheritance Configuration**
//! *For any* inheritance configuration, the permission merger SHALL respect
//! the inherit_global and inherit_project flags when combining permissions.
//!
//! **Validates: Requirements 6.1, 6.2**

use aster::permission::{
    MergeStrategy, PermissionContext, PermissionInheritance, PermissionScope, ToolPermission,
    ToolPermissionManager,
};
use proptest::prelude::*;
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

/// Generate arbitrary MergeStrategy
fn arb_merge_strategy() -> impl Strategy<Value = MergeStrategy> {
    prop_oneof![
        Just(MergeStrategy::Override),
        Just(MergeStrategy::Merge),
        Just(MergeStrategy::Union),
    ]
}

/// Generate arbitrary PermissionInheritance
fn arb_permission_inheritance() -> impl Strategy<Value = PermissionInheritance> {
    (
        prop::bool::ANY,
        prop::bool::ANY,
        prop::bool::ANY,
        arb_merge_strategy(),
    )
        .prop_map(
            |(inherit_global, inherit_project, override_global, merge_strategy)| {
                PermissionInheritance {
                    inherit_global,
                    inherit_project,
                    override_global,
                    merge_strategy,
                }
            },
        )
}

/// Generate a simple ToolPermission
fn create_simple_permission(tool: &str, allowed: bool, scope: PermissionScope) -> ToolPermission {
    ToolPermission {
        tool: tool.to_string(),
        allowed,
        priority: 0,
        conditions: Vec::new(),
        parameter_restrictions: Vec::new(),
        scope,
        reason: None,
        expires_at: None,
        metadata: HashMap::new(),
    }
}

/// Generate a test context
fn create_test_context() -> PermissionContext {
    PermissionContext {
        working_directory: PathBuf::from("/home/user/project"),
        session_id: "test-session".to_string(),
        timestamp: 1700000000,
        user: Some("testuser".to_string()),
        environment: HashMap::new(),
        metadata: HashMap::new(),
    }
}

// ============================================================================
// Property Tests - Property 10: Inheritance Configuration
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: set_inheritance and get_inheritance are consistent (round-trip)
    /// *For any* PermissionInheritance configuration, setting it and then getting it
    /// SHALL return an equivalent configuration.
    ///
    /// **Validates: Requirements 6.1, 6.2**
    #[test]
    fn prop_inheritance_set_get_roundtrip(
        inheritance in arb_permission_inheritance()
    ) {
        let mut manager = ToolPermissionManager::new(None);

        manager.set_inheritance(inheritance.clone());
        let retrieved = manager.get_inheritance();

        prop_assert_eq!(
            retrieved.inherit_global, inheritance.inherit_global,
            "inherit_global should be preserved"
        );
        prop_assert_eq!(
            retrieved.inherit_project, inheritance.inherit_project,
            "inherit_project should be preserved"
        );
        prop_assert_eq!(
            retrieved.override_global, inheritance.override_global,
            "override_global should be preserved"
        );
        prop_assert_eq!(
            retrieved.merge_strategy, inheritance.merge_strategy,
            "merge_strategy should be preserved"
        );
    }

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: inherit_global=false excludes global permissions from is_allowed
    /// *For any* tool with only global permission, when inherit_global is false,
    /// the permission SHALL NOT be applied (default allow).
    ///
    /// **Validates: Requirements 6.1**
    #[test]
    fn prop_inherit_global_false_excludes_global_in_is_allowed(
        tool in arb_tool_name(),
        global_allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add global permission
        let perm = create_simple_permission(&tool, global_allowed, PermissionScope::Global);
        manager.add_permission(perm, PermissionScope::Global);

        // Disable global inheritance
        manager.set_inheritance(PermissionInheritance {
            inherit_global: false,
            inherit_project: true,
            override_global: true,
            merge_strategy: MergeStrategy::Override,
        });

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // Global permission should be excluded, so default allow
        prop_assert!(
            result.allowed,
            "With inherit_global=false, global permissions should be excluded"
        );
        prop_assert!(
            result.matched_rule.is_none(),
            "No rule should match when global inheritance is disabled"
        );
    }

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: inherit_project=false excludes project permissions from is_allowed
    /// *For any* tool with only project permission, when inherit_project is false,
    /// the permission SHALL NOT be applied (default allow).
    ///
    /// **Validates: Requirements 6.2**
    #[test]
    fn prop_inherit_project_false_excludes_project_in_is_allowed(
        tool in arb_tool_name(),
        project_allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add project permission
        let perm = create_simple_permission(&tool, project_allowed, PermissionScope::Project);
        manager.add_permission(perm, PermissionScope::Project);

        // Disable project inheritance
        manager.set_inheritance(PermissionInheritance {
            inherit_global: true,
            inherit_project: false,
            override_global: true,
            merge_strategy: MergeStrategy::Override,
        });

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // Project permission should be excluded, so default allow
        prop_assert!(
            result.allowed,
            "With inherit_project=false, project permissions should be excluded"
        );
        prop_assert!(
            result.matched_rule.is_none(),
            "No rule should match when project inheritance is disabled"
        );
    }

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: inherit_global=true includes global permissions
    /// *For any* tool with global permission, when inherit_global is true,
    /// the permission SHALL be applied.
    ///
    /// **Validates: Requirements 6.1**
    #[test]
    fn prop_inherit_global_true_includes_global(
        tool in arb_tool_name(),
        global_allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add global permission
        let perm = create_simple_permission(&tool, global_allowed, PermissionScope::Global);
        manager.add_permission(perm, PermissionScope::Global);

        // Enable global inheritance (default)
        manager.set_inheritance(PermissionInheritance {
            inherit_global: true,
            inherit_project: true,
            override_global: true,
            merge_strategy: MergeStrategy::Override,
        });

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert_eq!(
            result.allowed, global_allowed,
            "With inherit_global=true, global permissions should be applied"
        );
        prop_assert!(
            result.matched_rule.is_some(),
            "Global rule should match when inheritance is enabled"
        );
    }

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: inherit_project=true includes project permissions
    /// *For any* tool with project permission, when inherit_project is true,
    /// the permission SHALL be applied.
    ///
    /// **Validates: Requirements 6.2**
    #[test]
    fn prop_inherit_project_true_includes_project(
        tool in arb_tool_name(),
        project_allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add project permission
        let perm = create_simple_permission(&tool, project_allowed, PermissionScope::Project);
        manager.add_permission(perm, PermissionScope::Project);

        // Enable project inheritance (default)
        manager.set_inheritance(PermissionInheritance {
            inherit_global: true,
            inherit_project: true,
            override_global: true,
            merge_strategy: MergeStrategy::Override,
        });

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert_eq!(
            result.allowed, project_allowed,
            "With inherit_project=true, project permissions should be applied"
        );
        prop_assert!(
            result.matched_rule.is_some(),
            "Project rule should match when inheritance is enabled"
        );
    }

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: Session permissions are always included regardless of inheritance
    /// *For any* tool with session permission, regardless of inheritance settings,
    /// the session permission SHALL always be applied.
    ///
    /// **Validates: Requirements 6.1, 6.2**
    #[test]
    fn prop_session_always_included(
        tool in arb_tool_name(),
        session_allowed in prop::bool::ANY,
        inherit_global in prop::bool::ANY,
        inherit_project in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add session permission
        let perm = create_simple_permission(&tool, session_allowed, PermissionScope::Session);
        manager.add_permission(perm, PermissionScope::Session);

        // Set arbitrary inheritance (should not affect session)
        manager.set_inheritance(PermissionInheritance {
            inherit_global,
            inherit_project,
            override_global: true,
            merge_strategy: MergeStrategy::Override,
        });

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        prop_assert_eq!(
            result.allowed, session_allowed,
            "Session permissions should always be applied regardless of inheritance"
        );
        prop_assert!(
            result.matched_rule.is_some(),
            "Session rule should always match"
        );
        prop_assert_eq!(
            result.matched_rule.as_ref().unwrap().scope,
            PermissionScope::Session,
            "Matched rule should be from Session scope"
        );
    }

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: Disabling both global and project inheritance only uses session
    /// *For any* tool with permissions in all scopes, when both inherit_global
    /// and inherit_project are false, only session permissions SHALL be used.
    ///
    /// **Validates: Requirements 6.1, 6.2**
    #[test]
    fn prop_disable_both_uses_only_session(
        tool in arb_tool_name(),
        global_allowed in prop::bool::ANY,
        project_allowed in prop::bool::ANY,
        session_allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add permissions in all scopes
        manager.add_permission(
            create_simple_permission(&tool, global_allowed, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission(&tool, project_allowed, PermissionScope::Project),
            PermissionScope::Project,
        );
        manager.add_permission(
            create_simple_permission(&tool, session_allowed, PermissionScope::Session),
            PermissionScope::Session,
        );

        // Disable both global and project inheritance
        manager.set_inheritance(PermissionInheritance {
            inherit_global: false,
            inherit_project: false,
            override_global: true,
            merge_strategy: MergeStrategy::Override,
        });

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // Only session should be used
        prop_assert_eq!(
            result.allowed, session_allowed,
            "Only session permission should be used when both inheritances are disabled"
        );
        prop_assert!(
            result.matched_rule.is_some(),
            "Session rule should match"
        );
        prop_assert_eq!(
            result.matched_rule.as_ref().unwrap().scope,
            PermissionScope::Session,
            "Matched rule should be from Session scope"
        );
    }

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: Multiple inheritance configuration changes are independent
    /// *For any* sequence of inheritance configurations, each set_inheritance
    /// SHALL completely replace the previous configuration.
    ///
    /// **Validates: Requirements 6.1, 6.2**
    #[test]
    fn prop_inheritance_changes_are_independent(
        first_config in arb_permission_inheritance(),
        second_config in arb_permission_inheritance(),
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Set first configuration
        manager.set_inheritance(first_config.clone());
        let first_retrieved = manager.get_inheritance();
        prop_assert_eq!(first_retrieved.clone(), first_config.clone());

        // Set second configuration
        manager.set_inheritance(second_config.clone());
        let second_retrieved = manager.get_inheritance();
        prop_assert_eq!(second_retrieved.clone(), second_config.clone());

        // First config should be completely replaced
        // (unless they happen to be equal)
        if first_config != second_config {
            prop_assert_ne!(
                first_retrieved, second_retrieved,
                "Different configs should produce different results"
            );
        }
    }

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: Default inheritance includes all scopes
    /// *For any* new ToolPermissionManager, the default inheritance SHALL
    /// include both global and project permissions.
    ///
    /// **Validates: Requirements 6.1, 6.2**
    #[test]
    fn prop_default_inheritance_includes_all(
        tool in arb_tool_name(),
        global_allowed in prop::bool::ANY,
    ) {
        let mut manager = ToolPermissionManager::new(None);

        // Add only global permission
        let perm = create_simple_permission(&tool, global_allowed, PermissionScope::Global);
        manager.add_permission(perm, PermissionScope::Global);

        // Don't change inheritance (use default)
        let default_inheritance = manager.get_inheritance();
        prop_assert!(
            default_inheritance.inherit_global,
            "Default should inherit global"
        );
        prop_assert!(
            default_inheritance.inherit_project,
            "Default should inherit project"
        );

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed(&tool, &params, &context);

        // Global permission should be applied with default inheritance
        prop_assert_eq!(
            result.allowed, global_allowed,
            "Default inheritance should include global permissions"
        );
    }

    /// **Feature: tool-permission-system, Property 10: Inheritance Configuration**
    ///
    /// Property: inheritance() returns reference to same data as get_inheritance()
    /// *For any* inheritance configuration, inheritance() and get_inheritance()
    /// SHALL return equivalent data.
    ///
    /// **Validates: Requirements 6.1, 6.2**
    #[test]
    fn prop_inheritance_ref_equals_get_inheritance(
        config in arb_permission_inheritance()
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.set_inheritance(config.clone());

        let ref_result = manager.inheritance();
        let cloned_result = manager.get_inheritance();

        prop_assert_eq!(
            ref_result.inherit_global, cloned_result.inherit_global,
            "inheritance() and get_inheritance() should return same inherit_global"
        );
        prop_assert_eq!(
            ref_result.inherit_project, cloned_result.inherit_project,
            "inheritance() and get_inheritance() should return same inherit_project"
        );
        prop_assert_eq!(
            ref_result.override_global, cloned_result.override_global,
            "inheritance() and get_inheritance() should return same override_global"
        );
        prop_assert_eq!(
            ref_result.merge_strategy.clone(), cloned_result.merge_strategy,
            "inheritance() and get_inheritance() should return same merge_strategy"
        );
    }
}
