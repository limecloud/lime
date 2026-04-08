//! Property-based tests for Permission Templates
//!
//! **Property 12: Custom Template Registration**
//! *For any* custom template registered with the system, it SHALL be retrievable
//! and applicable to create permissions.
//!
//! **Validates: Requirements 7.5**

use aster::permission::{PermissionScope, ToolPermission, ToolPermissionManager};
use proptest::prelude::*;
use std::collections::HashMap;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary template name
fn arb_template_name() -> impl Strategy<Value = String> {
    "[a-z_]{3,20}".prop_map(|s| s)
}

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

/// Generate arbitrary template (vector of permissions with unique tool names)
fn arb_template(size: usize) -> impl Strategy<Value = Vec<ToolPermission>> {
    // Generate unique tool names to avoid HashMap key collisions
    prop::collection::hash_set(arb_tool_name(), 1..=size).prop_flat_map(|tools| {
        let tools_vec: Vec<_> = tools.into_iter().collect();
        let len = tools_vec.len();
        prop::collection::vec((prop::bool::ANY, arb_permission_scope()), len..=len).prop_map(
            move |configs| {
                tools_vec
                    .iter()
                    .zip(configs.iter())
                    .map(|(tool, (allowed, scope))| {
                        create_simple_permission(tool, *allowed, *scope)
                    })
                    .collect()
            },
        )
    })
}

// ============================================================================
// Property Tests - Property 12: Custom Template Registration
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 12: Custom Template Registration**
    ///
    /// Property: Registered templates are retrievable
    /// *For any* custom template registered with the system, it SHALL be retrievable
    /// using get_template.
    ///
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_registered_template_is_retrievable(
        name in arb_template_name(),
        template in arb_template(5),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let template_clone = template.clone();

        manager.register_template(&name, template);

        // Template should be retrievable
        prop_assert!(
            manager.has_template(&name),
            "Registered template should exist"
        );

        let retrieved = manager.get_template(&name);
        prop_assert!(
            retrieved.is_some(),
            "get_template should return the template"
        );

        let retrieved_template = retrieved.unwrap();
        prop_assert_eq!(
            retrieved_template.len(),
            template_clone.len(),
            "Retrieved template should have same number of permissions"
        );

        // Verify each permission matches
        for (original, retrieved) in template_clone.iter().zip(retrieved_template.iter()) {
            prop_assert_eq!(
                &original.tool,
                &retrieved.tool,
                "Tool names should match"
            );
            prop_assert_eq!(
                original.allowed,
                retrieved.allowed,
                "Allowed flags should match"
            );
        }
    }

    /// **Feature: tool-permission-system, Property 12: Custom Template Registration**
    ///
    /// Property: Applied templates create permissions in target scope
    /// *For any* registered template applied to a scope, all permissions from
    /// the template SHALL be added to that scope.
    ///
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_applied_template_creates_permissions(
        name in arb_template_name(),
        template in arb_template(5),
        target_scope in arb_permission_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let template_len = template.len();

        manager.register_template(&name, template);
        let result = manager.apply_template(&name, target_scope);

        prop_assert!(result, "apply_template should return true for registered template");

        // Get permissions in target scope
        let scope_permissions = manager.get_permissions(Some(target_scope));

        prop_assert_eq!(
            scope_permissions.len(),
            template_len,
            "All template permissions should be added to target scope"
        );

        // All permissions should have the target scope
        for perm in &scope_permissions {
            prop_assert_eq!(
                perm.scope,
                target_scope,
                "Applied permissions should have target scope"
            );
        }
    }

    /// **Feature: tool-permission-system, Property 12: Custom Template Registration**
    ///
    /// Property: Applying non-existent template returns false
    /// *For any* template name that is not registered, apply_template SHALL
    /// return false and not modify any permissions.
    ///
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_apply_nonexistent_template_returns_false(
        name in arb_template_name(),
        target_scope in arb_permission_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        // Don't register any template

        let result = manager.apply_template(&name, target_scope);

        prop_assert!(!result, "apply_template should return false for non-existent template");

        // No permissions should be added
        let all_permissions = manager.get_permissions(None);
        prop_assert!(
            all_permissions.is_empty(),
            "No permissions should be added when template doesn't exist"
        );
    }

    /// **Feature: tool-permission-system, Property 12: Custom Template Registration**
    ///
    /// Property: Registering template with same name replaces previous
    /// *For any* two templates registered with the same name, the second
    /// registration SHALL replace the first.
    ///
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_register_replaces_existing(
        name in arb_template_name(),
        template1 in arb_template(3),
        template2 in arb_template(5),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let template2_len = template2.len();
        let template2_clone = template2.clone();

        manager.register_template(&name, template1);
        manager.register_template(&name, template2);

        let retrieved = manager.get_template(&name).unwrap();

        prop_assert_eq!(
            retrieved.len(),
            template2_len,
            "Second template should replace first"
        );

        // Verify it's the second template
        for (original, retrieved) in template2_clone.iter().zip(retrieved.iter()) {
            prop_assert_eq!(
                &original.tool,
                &retrieved.tool,
                "Should have second template's tools"
            );
        }
    }

    /// **Feature: tool-permission-system, Property 12: Custom Template Registration**
    ///
    /// Property: Removed templates are no longer retrievable
    /// *For any* registered template that is removed, it SHALL no longer be
    /// retrievable or applicable.
    ///
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_removed_template_not_retrievable(
        name in arb_template_name(),
        template in arb_template(3),
    ) {
        let mut manager = ToolPermissionManager::new(None);

        manager.register_template(&name, template);
        prop_assert!(manager.has_template(&name), "Template should exist after registration");

        let removed = manager.remove_template(&name);
        prop_assert!(removed.is_some(), "remove_template should return the removed template");

        prop_assert!(!manager.has_template(&name), "Template should not exist after removal");
        prop_assert!(
            manager.get_template(&name).is_none(),
            "get_template should return None after removal"
        );

        // Applying removed template should fail
        let apply_result = manager.apply_template(&name, PermissionScope::Global);
        prop_assert!(!apply_result, "apply_template should return false for removed template");
    }

    /// **Feature: tool-permission-system, Property 12: Custom Template Registration**
    ///
    /// Property: list_templates returns all registered template names
    /// *For any* set of registered templates, list_templates SHALL return
    /// all their names.
    ///
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_list_templates_returns_all_names(
        names in prop::collection::hash_set(arb_template_name(), 1..5),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let names_vec: Vec<_> = names.iter().cloned().collect();

        for name in &names_vec {
            manager.register_template(name, vec![]);
        }

        let listed = manager.list_templates();

        prop_assert_eq!(
            listed.len(),
            names_vec.len(),
            "list_templates should return all registered names"
        );

        for name in &names_vec {
            prop_assert!(
                listed.contains(&name),
                "list_templates should include '{}'", name
            );
        }
    }

    /// **Feature: tool-permission-system, Property 12: Custom Template Registration**
    ///
    /// Property: Template can be applied to multiple scopes
    /// *For any* registered template, it SHALL be applicable to all three scopes
    /// independently.
    ///
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_template_applicable_to_all_scopes(
        name in arb_template_name(),
        template in arb_template(2),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let template_len = template.len();

        manager.register_template(&name, template);

        // Apply to all scopes
        let global_result = manager.apply_template(&name, PermissionScope::Global);
        let project_result = manager.apply_template(&name, PermissionScope::Project);
        let session_result = manager.apply_template(&name, PermissionScope::Session);

        prop_assert!(global_result, "Should apply to Global scope");
        prop_assert!(project_result, "Should apply to Project scope");
        prop_assert!(session_result, "Should apply to Session scope");

        // Check counts in each scope
        let (global_count, project_count, session_count) = manager.permission_counts();

        prop_assert_eq!(global_count, template_len, "Global should have template permissions");
        prop_assert_eq!(project_count, template_len, "Project should have template permissions");
        prop_assert_eq!(session_count, template_len, "Session should have template permissions");
    }

    /// **Feature: tool-permission-system, Property 12: Custom Template Registration**
    ///
    /// Property: Empty template can be registered and applied
    /// *For any* empty template, it SHALL be registerable and applicable
    /// without errors.
    ///
    /// **Validates: Requirements 7.5**
    #[test]
    fn prop_empty_template_works(
        name in arb_template_name(),
        target_scope in arb_permission_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        let empty_template: Vec<ToolPermission> = vec![];

        manager.register_template(&name, empty_template);

        prop_assert!(manager.has_template(&name), "Empty template should be registered");

        let retrieved = manager.get_template(&name).unwrap();
        prop_assert!(retrieved.is_empty(), "Retrieved empty template should be empty");

        let result = manager.apply_template(&name, target_scope);
        prop_assert!(result, "Empty template should be applicable");

        let permissions = manager.get_permissions(Some(target_scope));
        prop_assert!(permissions.is_empty(), "No permissions should be added from empty template");
    }
}
