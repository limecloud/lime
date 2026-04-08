//! Property-based tests for Migration Preservation
//!
//! **Property 20: Migration Preservation**
//! **Validates: Requirements 11.5**
//!
//! These tests verify that when migrating from the old permission system,
//! all existing permission configurations are preserved.

use aster::config::permission::{PermissionConfig, PermissionLevel, PermissionManager};
use aster::permission::{
    get_original_permission_level, is_migrated_permission, migrate_known_tools,
    migrate_permission_config, migrate_permission_level, MigrationResult, PermissionScope,
    ToolPermission,
};
use proptest::prelude::*;
use tempfile::NamedTempFile;

// ============================================================================
// Generators
// ============================================================================

/// Generate arbitrary tool names (valid identifiers)
fn arb_tool_name() -> impl Strategy<Value = String> {
    prop::string::string_regex("[a-z][a-z0-9_]{0,19}")
        .unwrap()
        .prop_filter("non-empty tool name", |s| !s.is_empty())
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

/// Generate a list of unique tool names
fn arb_tool_names(max_count: usize) -> impl Strategy<Value = Vec<String>> {
    prop::collection::vec(arb_tool_name(), 0..=max_count).prop_map(|names| {
        // Deduplicate while preserving order
        let mut seen = std::collections::HashSet::new();
        names
            .into_iter()
            .filter(|name| seen.insert(name.clone()))
            .collect()
    })
}

/// Generate arbitrary PermissionConfig
fn arb_permission_config() -> impl Strategy<Value = PermissionConfig> {
    (arb_tool_names(5), arb_tool_names(5), arb_tool_names(5)).prop_map(
        |(always_allow, ask_before, never_allow)| {
            // Ensure no overlap between lists
            let mut seen = std::collections::HashSet::new();
            let always_allow: Vec<_> = always_allow
                .into_iter()
                .filter(|n| seen.insert(n.clone()))
                .collect();
            let ask_before: Vec<_> = ask_before
                .into_iter()
                .filter(|n| seen.insert(n.clone()))
                .collect();
            let never_allow: Vec<_> = never_allow
                .into_iter()
                .filter(|n| seen.insert(n.clone()))
                .collect();

            PermissionConfig {
                always_allow,
                ask_before,
                never_allow,
            }
        },
    )
}

// ============================================================================
// Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // ========================================================================
    // Property 20: Migration Preservation
    // ========================================================================

    /// **Feature: tool-permission-system, Property 20: Migration Preservation**
    ///
    /// *For any* PermissionLevel and tool name, migrating should preserve the
    /// allowed/denied semantics.
    ///
    /// **Validates: Requirements 11.5**
    #[test]
    fn prop_migrate_permission_level_preserves_allowed_semantics(
        tool_name in arb_tool_name(),
        level in arb_permission_level(),
        scope in arb_permission_scope(),
    ) {
        let migrated = migrate_permission_level(&tool_name, level.clone(), scope);

        // Verify tool name is preserved
        prop_assert_eq!(
            migrated.tool,
            tool_name,
            "Tool name should be preserved during migration"
        );

        // Verify scope is preserved
        prop_assert_eq!(
            migrated.scope,
            scope,
            "Scope should be preserved during migration"
        );

        // Verify allowed semantics match the original level
        match level {
            PermissionLevel::AlwaysAllow => {
                prop_assert!(
                    migrated.allowed,
                    "AlwaysAllow should migrate to allowed=true"
                );
                prop_assert_eq!(
                    migrated.priority,
                    100,
                    "AlwaysAllow should have high priority"
                );
            }
            PermissionLevel::AskBefore => {
                prop_assert!(
                    migrated.allowed,
                    "AskBefore should migrate to allowed=true (with confirmation)"
                );
                prop_assert_eq!(
                    migrated.priority,
                    50,
                    "AskBefore should have medium priority"
                );
                prop_assert!(
                    migrated.metadata.contains_key("requires_confirmation"),
                    "AskBefore should have requires_confirmation metadata"
                );
            }
            PermissionLevel::NeverAllow => {
                prop_assert!(
                    !migrated.allowed,
                    "NeverAllow should migrate to allowed=false"
                );
                prop_assert_eq!(
                    migrated.priority,
                    100,
                    "NeverAllow should have high priority"
                );
            }
        }
    }

    /// **Feature: tool-permission-system, Property 20: Migration Preservation**
    ///
    /// *For any* migrated permission, the original permission level should be
    /// recoverable from the metadata.
    ///
    /// **Validates: Requirements 11.5**
    #[test]
    fn prop_migration_is_reversible(
        tool_name in arb_tool_name(),
        level in arb_permission_level(),
        scope in arb_permission_scope(),
    ) {
        let migrated = migrate_permission_level(&tool_name, level.clone(), scope);

        // Verify the permission is marked as migrated
        prop_assert!(
            is_migrated_permission(&migrated),
            "Migrated permission should be identifiable"
        );

        // Verify the original level can be recovered
        let recovered = get_original_permission_level(&migrated);
        prop_assert_eq!(
            recovered,
            Some(level),
            "Original permission level should be recoverable"
        );
    }

    /// **Feature: tool-permission-system, Property 20: Migration Preservation**
    ///
    /// *For any* PermissionConfig, all tools should be migrated with correct semantics.
    ///
    /// **Validates: Requirements 11.5**
    #[test]
    fn prop_migrate_permission_config_preserves_all_tools(
        config in arb_permission_config(),
        scope in arb_permission_scope(),
    ) {
        let migrated = migrate_permission_config(&config, "test_category", scope);

        // Calculate expected count
        let expected_count = config.always_allow.len()
            + config.ask_before.len()
            + config.never_allow.len();

        // Verify all tools are migrated
        prop_assert_eq!(
            migrated.len(),
            expected_count,
            "All tools should be migrated"
        );

        // Verify always_allow tools
        for tool in &config.always_allow {
            let perm = migrated.iter().find(|p| &p.tool == tool);
            prop_assert!(perm.is_some(), "always_allow tool should be migrated: {}", tool);
            let perm = perm.unwrap();
            prop_assert!(perm.allowed, "always_allow tool should be allowed");
            prop_assert_eq!(perm.priority, 100, "always_allow should have high priority");
        }

        // Verify ask_before tools
        for tool in &config.ask_before {
            let perm = migrated.iter().find(|p| &p.tool == tool);
            prop_assert!(perm.is_some(), "ask_before tool should be migrated: {}", tool);
            let perm = perm.unwrap();
            prop_assert!(perm.allowed, "ask_before tool should be allowed");
            prop_assert_eq!(perm.priority, 50, "ask_before should have medium priority");
        }

        // Verify never_allow tools
        for tool in &config.never_allow {
            let perm = migrated.iter().find(|p| &p.tool == tool);
            prop_assert!(perm.is_some(), "never_allow tool should be migrated: {}", tool);
            let perm = perm.unwrap();
            prop_assert!(!perm.allowed, "never_allow tool should not be allowed");
            prop_assert_eq!(perm.priority, 100, "never_allow should have high priority");
        }
    }

    /// **Feature: tool-permission-system, Property 20: Migration Preservation**
    ///
    /// *For any* migrated permission, it should have migration metadata.
    ///
    /// **Validates: Requirements 11.5**
    #[test]
    fn prop_migrated_permissions_have_metadata(
        tool_name in arb_tool_name(),
        level in arb_permission_level(),
        scope in arb_permission_scope(),
    ) {
        let migrated = migrate_permission_level(&tool_name, level, scope);

        // Verify migration metadata exists
        prop_assert!(
            migrated.metadata.contains_key("migrated_from"),
            "Migrated permission should have 'migrated_from' metadata"
        );

        // Verify reason is set
        prop_assert!(
            migrated.reason.is_some(),
            "Migrated permission should have a reason"
        );
        prop_assert!(
            migrated.reason.as_ref().unwrap().contains("Migrated"),
            "Reason should mention migration"
        );
    }

    /// **Feature: tool-permission-system, Property 20: Migration Preservation**
    ///
    /// *For any* PermissionConfig with category, the category should be preserved
    /// in the migrated permissions' metadata.
    ///
    /// **Validates: Requirements 11.5**
    #[test]
    fn prop_migration_preserves_category(
        config in arb_permission_config(),
        category in prop::string::string_regex("[a-z_]{1,20}").unwrap(),
        scope in arb_permission_scope(),
    ) {
        let migrated = migrate_permission_config(&config, &category, scope);

        // Verify all migrated permissions have the category in metadata
        for perm in &migrated {
            prop_assert!(
                perm.metadata.contains_key("original_category"),
                "Migrated permission should have 'original_category' metadata"
            );
            prop_assert_eq!(
                perm.metadata.get("original_category"),
                Some(&serde_json::Value::String(category.clone())),
                "Category should be preserved in metadata"
            );
        }
    }

    /// **Feature: tool-permission-system, Property 20: Migration Preservation**
    ///
    /// *For any* empty PermissionConfig, migration should produce empty result.
    ///
    /// **Validates: Requirements 11.5**
    #[test]
    fn prop_empty_config_produces_empty_migration(
        scope in arb_permission_scope(),
    ) {
        let config = PermissionConfig::default();
        let migrated = migrate_permission_config(&config, "test", scope);

        prop_assert!(
            migrated.is_empty(),
            "Empty config should produce empty migration"
        );
    }

    /// **Feature: tool-permission-system, Property 20: Migration Preservation**
    ///
    /// *For any* MigrationResult, the total count should equal the sum of individual counts.
    ///
    /// **Validates: Requirements 11.5**
    #[test]
    fn prop_migration_result_counts_are_consistent(
        always_allow_count in 0usize..10,
        ask_before_count in 0usize..10,
        never_allow_count in 0usize..10,
    ) {
        let mut result = MigrationResult::new();
        result.always_allow_count = always_allow_count;
        result.ask_before_count = ask_before_count;
        result.never_allow_count = never_allow_count;

        prop_assert_eq!(
            result.total_count(),
            always_allow_count + ask_before_count + never_allow_count,
            "Total count should equal sum of individual counts"
        );
    }

    /// **Feature: tool-permission-system, Property 20: Migration Preservation**
    ///
    /// *For any* non-migrated permission, is_migrated_permission should return false.
    ///
    /// **Validates: Requirements 11.5**
    #[test]
    fn prop_non_migrated_permission_not_identified_as_migrated(
        tool_name in arb_tool_name(),
        allowed in prop::bool::ANY,
        priority in -100i32..100,
    ) {
        let permission = ToolPermission {
            tool: tool_name,
            allowed,
            priority,
            ..Default::default()
        };

        prop_assert!(
            !is_migrated_permission(&permission),
            "Non-migrated permission should not be identified as migrated"
        );

        prop_assert!(
            get_original_permission_level(&permission).is_none(),
            "Non-migrated permission should not have recoverable level"
        );
    }

    /// **Feature: tool-permission-system, Property 20: Migration Preservation**
    ///
    /// *For any* tool name with special characters (underscores), migration should preserve it.
    ///
    /// **Validates: Requirements 11.5**
    #[test]
    fn prop_migration_preserves_tool_names_with_underscores(
        prefix in prop::string::string_regex("[a-z]{1,10}").unwrap(),
        suffix in prop::string::string_regex("[a-z]{1,10}").unwrap(),
        level in arb_permission_level(),
        scope in arb_permission_scope(),
    ) {
        let tool_name = format!("{}__{}__tool", prefix, suffix);
        let migrated = migrate_permission_level(&tool_name, level, scope);

        prop_assert_eq!(
            migrated.tool,
            tool_name,
            "Tool name with underscores should be preserved"
        );
    }
}

// ============================================================================
// Unit Tests for Edge Cases
// ============================================================================

#[cfg(test)]
mod unit_tests {
    use super::*;

    fn create_test_permission_manager() -> PermissionManager {
        let temp_file = NamedTempFile::new().unwrap();
        PermissionManager::new(temp_file.path())
    }

    #[test]
    fn test_migrate_known_tools_with_real_manager() {
        let mut manager = create_test_permission_manager();
        manager.update_user_permission("tool1", PermissionLevel::AlwaysAllow);
        manager.update_user_permission("tool2", PermissionLevel::AskBefore);
        manager.update_user_permission("tool3", PermissionLevel::NeverAllow);

        let result = migrate_known_tools(
            &manager,
            &["tool1", "tool2", "tool3"],
            PermissionScope::Global,
        );

        assert_eq!(result.permissions.len(), 3);
        assert_eq!(result.always_allow_count, 1);
        assert_eq!(result.ask_before_count, 1);
        assert_eq!(result.never_allow_count, 1);

        // Verify each tool
        let tool1 = result
            .permissions
            .iter()
            .find(|p| p.tool == "tool1")
            .unwrap();
        assert!(tool1.allowed);
        assert_eq!(
            get_original_permission_level(tool1),
            Some(PermissionLevel::AlwaysAllow)
        );

        let tool2 = result
            .permissions
            .iter()
            .find(|p| p.tool == "tool2")
            .unwrap();
        assert!(tool2.allowed);
        assert_eq!(
            get_original_permission_level(tool2),
            Some(PermissionLevel::AskBefore)
        );

        let tool3 = result
            .permissions
            .iter()
            .find(|p| p.tool == "tool3")
            .unwrap();
        assert!(!tool3.allowed);
        assert_eq!(
            get_original_permission_level(tool3),
            Some(PermissionLevel::NeverAllow)
        );
    }

    #[test]
    fn test_migrate_known_tools_with_unknown_tools() {
        let manager = create_test_permission_manager();

        let result = migrate_known_tools(
            &manager,
            &["unknown_tool1", "unknown_tool2"],
            PermissionScope::Global,
        );

        // Unknown tools should not be migrated
        assert!(result.permissions.is_empty());
        assert_eq!(result.total_count(), 0);
    }

    #[test]
    fn test_migration_result_default() {
        let result = MigrationResult::new();

        assert!(result.permissions.is_empty());
        assert!(result.warnings.is_empty());
        assert_eq!(result.always_allow_count, 0);
        assert_eq!(result.ask_before_count, 0);
        assert_eq!(result.never_allow_count, 0);
        assert_eq!(result.total_count(), 0);
    }

    #[test]
    fn test_all_permission_levels_migrate_correctly() {
        let levels = vec![
            (PermissionLevel::AlwaysAllow, true, 100),
            (PermissionLevel::AskBefore, true, 50),
            (PermissionLevel::NeverAllow, false, 100),
        ];

        for (level, expected_allowed, expected_priority) in levels {
            let migrated = migrate_permission_level("test_tool", level, PermissionScope::Global);
            assert_eq!(migrated.allowed, expected_allowed);
            assert_eq!(migrated.priority, expected_priority);
        }
    }

    #[test]
    fn test_all_scopes_preserved() {
        let scopes = vec![
            PermissionScope::Global,
            PermissionScope::Project,
            PermissionScope::Session,
        ];

        for scope in scopes {
            let migrated =
                migrate_permission_level("test_tool", PermissionLevel::AlwaysAllow, scope);
            assert_eq!(migrated.scope, scope);
        }
    }

    #[test]
    fn test_empty_tool_name_handled() {
        // Edge case: empty tool name (should still work)
        let migrated =
            migrate_permission_level("", PermissionLevel::AlwaysAllow, PermissionScope::Global);
        assert_eq!(migrated.tool, "");
        assert!(migrated.allowed);
    }

    #[test]
    fn test_long_tool_name_preserved() {
        let long_name = "a".repeat(100);
        let migrated = migrate_permission_level(
            &long_name,
            PermissionLevel::AlwaysAllow,
            PermissionScope::Global,
        );
        assert_eq!(migrated.tool, long_name);
    }
}
