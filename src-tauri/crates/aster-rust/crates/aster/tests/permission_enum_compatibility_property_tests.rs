//! Property-based tests for Permission Enum Compatibility
//!
//! **Property 19: Existing Enum Compatibility**
//! **Validates: Requirements 11.3**
//!
//! These tests verify that the new permission system correctly handles
//! the existing Permission enum (AlwaysAllow, AllowOnce, Cancel, DenyOnce).

use aster::config::permission::PermissionLevel;
use aster::permission::{
    create_permission, is_permission_allowed, is_permission_permanent,
    permission_level_to_permission, permission_level_to_tool_permission,
    permission_to_permission_level, permission_to_result, result_to_permission, Permission,
    PermissionResult, PermissionScope,
};
use proptest::prelude::*;

// ============================================================================
// Generators
// ============================================================================

/// Generate arbitrary Permission enum values
fn arb_permission() -> impl Strategy<Value = Permission> {
    prop_oneof![
        Just(Permission::AlwaysAllow),
        Just(Permission::AllowOnce),
        Just(Permission::Cancel),
        Just(Permission::DenyOnce),
    ]
}

/// Generate arbitrary PermissionLevel enum values
fn arb_permission_level() -> impl Strategy<Value = PermissionLevel> {
    prop_oneof![
        Just(PermissionLevel::AlwaysAllow),
        Just(PermissionLevel::AskBefore),
        Just(PermissionLevel::NeverAllow),
    ]
}

/// Generate arbitrary PermissionScope enum values
fn arb_permission_scope() -> impl Strategy<Value = PermissionScope> {
    prop_oneof![
        Just(PermissionScope::Global),
        Just(PermissionScope::Project),
        Just(PermissionScope::Session),
    ]
}

/// Generate arbitrary tool names
fn arb_tool_name() -> impl Strategy<Value = String> {
    prop::string::string_regex("[a-z][a-z0-9_]{0,19}")
        .unwrap()
        .prop_filter("non-empty tool name", |s| !s.is_empty())
}

/// Generate arbitrary PermissionResult
fn arb_permission_result() -> impl Strategy<Value = PermissionResult> {
    (
        prop::bool::ANY,
        prop::option::of(prop::string::string_regex("[a-zA-Z0-9 ]{0,50}").unwrap()),
        prop::bool::ANY,
    )
        .prop_map(|(allowed, reason, restricted)| PermissionResult {
            allowed,
            reason,
            restricted,
            suggestions: Vec::new(),
            matched_rule: None,
            violations: Vec::new(),
        })
}

// ============================================================================
// Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // ========================================================================
    // Property 19: Existing Enum Compatibility
    // ========================================================================

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* existing Permission enum value (AlwaysAllow, AllowOnce, Cancel, DenyOnce),
    /// the new system SHALL correctly interpret and handle it.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_permission_to_result_preserves_allowed_semantics(
        permission in arb_permission(),
        tool_name in arb_tool_name(),
    ) {
        let result = permission_to_result(&permission, &tool_name);

        // Verify that allowed permissions produce allowed results
        match permission {
            Permission::AlwaysAllow | Permission::AllowOnce => {
                prop_assert!(result.allowed, "AlwaysAllow and AllowOnce should produce allowed=true");
            }
            Permission::Cancel | Permission::DenyOnce => {
                prop_assert!(!result.allowed, "Cancel and DenyOnce should produce allowed=false");
            }
        }
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* Permission enum value, converting to result and back should preserve
    /// the allowed/denied semantics.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_permission_result_round_trip_preserves_allowed(
        permission in arb_permission(),
        tool_name in arb_tool_name(),
        is_permanent in prop::bool::ANY,
    ) {
        let result = permission_to_result(&permission, &tool_name);
        let back = result_to_permission(&result, is_permanent);

        // The allowed semantics should be preserved
        let original_allowed = matches!(permission, Permission::AlwaysAllow | Permission::AllowOnce);
        let round_trip_allowed = matches!(back, Permission::AlwaysAllow | Permission::AllowOnce);

        prop_assert_eq!(
            original_allowed,
            round_trip_allowed,
            "Round trip should preserve allowed semantics"
        );
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* PermissionLevel, converting to Permission should produce a valid Permission.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_permission_level_to_permission_is_valid(
        level in arb_permission_level(),
    ) {
        let permission = permission_level_to_permission(level.clone());

        // AlwaysAllow level should produce AlwaysAllow permission
        if level == PermissionLevel::AlwaysAllow {
            prop_assert_eq!(permission.clone(), Permission::AlwaysAllow);
        }

        // Other levels should produce a denial (DenyOnce)
        if level == PermissionLevel::AskBefore || level == PermissionLevel::NeverAllow {
            prop_assert_eq!(permission.clone(), Permission::DenyOnce);
        }
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* Permission, converting to PermissionLevel should produce a valid level.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_permission_to_permission_level_is_valid(
        permission in arb_permission(),
    ) {
        let level = permission_to_permission_level(&permission);

        // AlwaysAllow should map to AlwaysAllow level
        if permission == Permission::AlwaysAllow {
            prop_assert_eq!(level.clone(), PermissionLevel::AlwaysAllow);
        }

        // Other permissions should map to AskBefore (not NeverAllow, as denials are temporary)
        if matches!(permission, Permission::AllowOnce | Permission::Cancel | Permission::DenyOnce) {
            prop_assert_eq!(level.clone(), PermissionLevel::AskBefore);
        }
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* Permission, is_permission_allowed should correctly identify allowed permissions.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_is_permission_allowed_correct(
        permission in arb_permission(),
    ) {
        let allowed = is_permission_allowed(&permission);

        match permission {
            Permission::AlwaysAllow | Permission::AllowOnce => {
                prop_assert!(allowed, "AlwaysAllow and AllowOnce should be allowed");
            }
            Permission::Cancel | Permission::DenyOnce => {
                prop_assert!(!allowed, "Cancel and DenyOnce should not be allowed");
            }
        }
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* Permission, is_permission_permanent should correctly identify permanent permissions.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_is_permission_permanent_correct(
        permission in arb_permission(),
    ) {
        let permanent = is_permission_permanent(&permission);

        match permission {
            Permission::AlwaysAllow => {
                prop_assert!(permanent, "AlwaysAllow should be permanent");
            }
            Permission::AllowOnce | Permission::Cancel | Permission::DenyOnce => {
                prop_assert!(!permanent, "AllowOnce, Cancel, and DenyOnce should not be permanent");
            }
        }
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* allowed/permanent combination, create_permission should produce the correct Permission.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_create_permission_correct(
        allowed in prop::bool::ANY,
        permanent in prop::bool::ANY,
    ) {
        let permission = create_permission(allowed, permanent);

        // Verify the created permission matches the inputs
        prop_assert_eq!(is_permission_allowed(&permission), allowed);

        // Permanent only matters for allowed permissions
        if allowed && permanent {
            prop_assert_eq!(permission, Permission::AlwaysAllow);
        } else if allowed && !permanent {
            prop_assert_eq!(permission, Permission::AllowOnce);
        } else {
            prop_assert_eq!(permission, Permission::DenyOnce);
        }
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* PermissionLevel and scope, converting to ToolPermission should preserve semantics.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_permission_level_to_tool_permission_preserves_semantics(
        tool_name in arb_tool_name(),
        level in arb_permission_level(),
        scope in arb_permission_scope(),
    ) {
        let tool_perm = permission_level_to_tool_permission(&tool_name, level.clone(), scope);

        // Verify tool name is preserved
        prop_assert_eq!(tool_perm.tool, tool_name);

        // Verify scope is preserved
        prop_assert_eq!(tool_perm.scope, scope);

        // Verify allowed flag matches the level
        match level {
            PermissionLevel::AlwaysAllow => {
                prop_assert!(tool_perm.allowed, "AlwaysAllow should produce allowed=true");
            }
            PermissionLevel::AskBefore | PermissionLevel::NeverAllow => {
                prop_assert!(!tool_perm.allowed, "AskBefore and NeverAllow should produce allowed=false");
            }
        }

        // Verify reason contains migration info
        prop_assert!(
            tool_perm.reason.is_some(),
            "Migrated permission should have a reason"
        );
        prop_assert!(
            tool_perm.reason.as_ref().unwrap().contains("Migrated"),
            "Reason should mention migration"
        );
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* PermissionResult, result_to_permission should produce a valid Permission
    /// that preserves the allowed semantics.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_result_to_permission_preserves_allowed(
        result in arb_permission_result(),
        is_permanent in prop::bool::ANY,
    ) {
        let permission = result_to_permission(&result, is_permanent);

        // Verify allowed semantics are preserved
        prop_assert_eq!(
            is_permission_allowed(&permission),
            result.allowed,
            "result_to_permission should preserve allowed semantics"
        );

        // Verify permanence is respected for allowed results
        if result.allowed {
            if is_permanent {
                prop_assert_eq!(permission, Permission::AlwaysAllow);
            } else {
                prop_assert_eq!(permission, Permission::AllowOnce);
            }
        }
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* Permission, the result should contain the tool name in the reason.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_permission_to_result_includes_tool_name(
        permission in arb_permission(),
        tool_name in arb_tool_name(),
    ) {
        let result = permission_to_result(&permission, &tool_name);

        // The reason should contain the tool name
        prop_assert!(
            result.reason.is_some(),
            "Result should have a reason"
        );
        prop_assert!(
            result.reason.as_ref().unwrap().contains(&tool_name),
            "Reason should contain the tool name"
        );
    }

    /// **Feature: tool-permission-system, Property 19: Existing Enum Compatibility**
    ///
    /// *For any* denied Permission, the result should have suggestions.
    ///
    /// **Validates: Requirements 11.3**
    #[test]
    fn prop_denied_permission_has_suggestions(
        permission in arb_permission(),
        tool_name in arb_tool_name(),
    ) {
        let result = permission_to_result(&permission, &tool_name);

        // Denied permissions should have suggestions
        if matches!(permission, Permission::Cancel | Permission::DenyOnce) {
            prop_assert!(
                !result.suggestions.is_empty(),
                "Denied permissions should have suggestions"
            );
        }
    }
}

// ============================================================================
// Unit Tests for Edge Cases
// ============================================================================

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_all_permission_variants_handled() {
        // Ensure all Permission variants are handled
        let permissions = vec![
            Permission::AlwaysAllow,
            Permission::AllowOnce,
            Permission::Cancel,
            Permission::DenyOnce,
        ];

        for perm in permissions {
            let result = permission_to_result(&perm, "test_tool");
            assert!(result.reason.is_some());
        }
    }

    #[test]
    fn test_all_permission_level_variants_handled() {
        // Ensure all PermissionLevel variants are handled
        let levels = vec![
            PermissionLevel::AlwaysAllow,
            PermissionLevel::AskBefore,
            PermissionLevel::NeverAllow,
        ];

        for level in levels {
            let perm = permission_level_to_permission(level.clone());
            // Should not panic
            let _ = is_permission_allowed(&perm);
        }
    }

    #[test]
    fn test_permission_level_to_tool_permission_all_scopes() {
        let scopes = vec![
            PermissionScope::Global,
            PermissionScope::Project,
            PermissionScope::Session,
        ];

        for scope in scopes {
            let tool_perm = permission_level_to_tool_permission(
                "test_tool",
                PermissionLevel::AlwaysAllow,
                scope,
            );
            assert_eq!(tool_perm.scope, scope);
        }
    }

    #[test]
    fn test_empty_tool_name_handled() {
        // Edge case: empty tool name
        let result = permission_to_result(&Permission::AlwaysAllow, "");
        assert!(result.allowed);
        assert!(result.reason.is_some());
    }

    #[test]
    fn test_special_characters_in_tool_name() {
        // Edge case: special characters in tool name
        let result = permission_to_result(&Permission::AlwaysAllow, "tool_with_special_chars_123");
        assert!(result.allowed);
        assert!(result
            .reason
            .unwrap()
            .contains("tool_with_special_chars_123"));
    }
}
