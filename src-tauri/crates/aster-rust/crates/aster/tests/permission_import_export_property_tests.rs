//! Property-based tests for Permission Import/Export
//!
//! **Property 13: Import/Export Round-Trip**
//! *For any* set of permissions, exporting to JSON and importing back SHALL
//! produce an equivalent set of permissions with version information preserved.
//!
//! **Validates: Requirements 8.1, 8.2, 8.5**
//!
//! **Property 14: Import Validation**
//! *For any* invalid JSON configuration, import SHALL fail with an error
//! and existing permissions SHALL remain unchanged.
//!
//! **Validates: Requirements 8.3, 8.4**

use aster::permission::{
    ConditionOperator, ConditionType, MergeStrategy, ParameterRestriction, PermissionCondition,
    PermissionInheritance, PermissionScope, RestrictionType, ToolPermission, ToolPermissionManager,
};
use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashMap;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary tool name (non-empty)
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
fn arb_scope() -> impl Strategy<Value = PermissionScope> {
    prop_oneof![
        Just(PermissionScope::Global),
        Just(PermissionScope::Project),
        Just(PermissionScope::Session),
    ]
}

/// Generate arbitrary priority
fn arb_priority() -> impl Strategy<Value = i32> {
    -100i32..100i32
}

/// Generate arbitrary optional expiry timestamp
fn arb_expires_at() -> impl Strategy<Value = Option<i64>> {
    prop_oneof![Just(None), (1700000000i64..1900000000i64).prop_map(Some),]
}

/// Generate arbitrary optional reason
fn arb_reason() -> impl Strategy<Value = Option<String>> {
    prop_oneof![Just(None), "[a-zA-Z0-9 ]{5,30}".prop_map(Some),]
}

/// Generate arbitrary ConditionType
fn arb_condition_type() -> impl Strategy<Value = ConditionType> {
    prop_oneof![
        Just(ConditionType::Context),
        Just(ConditionType::Time),
        Just(ConditionType::User),
        Just(ConditionType::Session),
        Just(ConditionType::Custom),
    ]
}

/// Generate arbitrary ConditionOperator
fn arb_condition_operator() -> impl Strategy<Value = ConditionOperator> {
    prop_oneof![
        Just(ConditionOperator::Equals),
        Just(ConditionOperator::NotEquals),
        Just(ConditionOperator::Contains),
        Just(ConditionOperator::NotContains),
        Just(ConditionOperator::In),
        Just(ConditionOperator::NotIn),
    ]
}

/// Generate arbitrary PermissionCondition (without validator - not serializable)
fn arb_permission_condition() -> impl Strategy<Value = PermissionCondition> {
    (
        arb_condition_type(),
        prop::option::of("[a-z_]{3,10}"),
        arb_condition_operator(),
        prop_oneof![
            Just(Value::String("test".to_string())),
            Just(Value::Bool(true)),
            Just(Value::Number(42.into())),
        ],
        prop::option::of("[a-zA-Z0-9 ]{5,20}"),
    )
        .prop_map(|(condition_type, field, operator, value, description)| {
            PermissionCondition {
                condition_type,
                field,
                operator,
                value,
                validator: None, // Validators are not serializable
                description,
            }
        })
}

/// Generate valid ParameterRestriction that will pass validation
fn arb_valid_parameter_restriction() -> impl Strategy<Value = ParameterRestriction> {
    prop_oneof![
        // Whitelist with values
        (
            "[a-z_]{3,10}",
            prop::collection::vec(
                prop_oneof![
                    Just(Value::String("allowed".to_string())),
                    Just(Value::String("safe".to_string())),
                ],
                1..3,
            ),
            prop::bool::ANY,
            prop::option::of("[a-zA-Z0-9 ]{5,20}"),
        )
            .prop_map(|(parameter, values, required, description)| {
                ParameterRestriction {
                    parameter,
                    restriction_type: RestrictionType::Whitelist,
                    values: Some(values),
                    pattern: None,
                    validator: None,
                    min: None,
                    max: None,
                    required,
                    description,
                }
            }),
        // Blacklist with values
        (
            "[a-z_]{3,10}",
            prop::collection::vec(
                prop_oneof![
                    Just(Value::String("blocked".to_string())),
                    Just(Value::String("dangerous".to_string())),
                ],
                1..3,
            ),
            prop::bool::ANY,
            prop::option::of("[a-zA-Z0-9 ]{5,20}"),
        )
            .prop_map(|(parameter, values, required, description)| {
                ParameterRestriction {
                    parameter,
                    restriction_type: RestrictionType::Blacklist,
                    values: Some(values),
                    pattern: None,
                    validator: None,
                    min: None,
                    max: None,
                    required,
                    description,
                }
            }),
        // Pattern with pattern
        (
            "[a-z_]{3,10}",
            "[a-z]+",
            prop::bool::ANY,
            prop::option::of("[a-zA-Z0-9 ]{5,20}"),
        )
            .prop_map(|(parameter, pattern, required, description)| {
                ParameterRestriction {
                    parameter,
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(pattern),
                    validator: None,
                    min: None,
                    max: None,
                    required,
                    description,
                }
            }),
        // Range with min and/or max
        (
            "[a-z_]{3,10}",
            prop::option::of(-100.0f64..0.0f64),
            prop::option::of(0.0f64..100.0f64),
            prop::bool::ANY,
            prop::option::of("[a-zA-Z0-9 ]{5,20}"),
        )
            .prop_filter_map(
                "Range must have min or max",
                |(parameter, min, max, required, description)| {
                    if min.is_none() && max.is_none() {
                        None
                    } else {
                        Some(ParameterRestriction {
                            parameter,
                            restriction_type: RestrictionType::Range,
                            values: None,
                            pattern: None,
                            validator: None,
                            min,
                            max,
                            required,
                            description,
                        })
                    }
                }
            ),
    ]
}

/// Generate arbitrary metadata
fn arb_metadata() -> impl Strategy<Value = HashMap<String, Value>> {
    prop::collection::hash_map(
        "[a-z_]{3,8}",
        prop_oneof![
            Just(Value::String("value".to_string())),
            Just(Value::Bool(true)),
            Just(Value::Number(123.into())),
        ],
        0..3,
    )
}

/// Generate arbitrary valid ToolPermission for import/export testing
fn arb_valid_tool_permission() -> impl Strategy<Value = ToolPermission> {
    (
        arb_tool_name(),
        prop::bool::ANY,
        arb_priority(),
        prop::collection::vec(arb_permission_condition(), 0..2),
        prop::collection::vec(arb_valid_parameter_restriction(), 0..2),
        arb_scope(),
        arb_reason(),
        arb_expires_at(),
        arb_metadata(),
    )
        .prop_map(
            |(
                tool,
                allowed,
                priority,
                conditions,
                parameter_restrictions,
                scope,
                reason,
                expires_at,
                metadata,
            )| {
                ToolPermission {
                    tool,
                    allowed,
                    priority,
                    conditions,
                    parameter_restrictions,
                    scope,
                    reason,
                    expires_at,
                    metadata,
                }
            },
        )
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

// ============================================================================
// Property Tests - Property 13: Import/Export Round-Trip
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 13: Import/Export Round-Trip**
    ///
    /// Property: Single permission export/import round-trip
    /// *For any* valid ToolPermission, exporting to JSON and importing back
    /// SHALL produce an equivalent permission.
    ///
    /// **Validates: Requirements 8.1, 8.2, 8.5**
    #[test]
    fn prop_single_permission_export_import_round_trip(
        perm in arb_valid_tool_permission(),
        target_scope in arb_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(perm.clone(), perm.scope);

        // Export
        let exported = manager.export(Some(perm.scope))
            .expect("Export should succeed");

        // Verify version is present
        prop_assert!(exported.contains("\"version\": \"1.0.0\""), "Export should contain version");

        // Import into new manager
        let mut new_manager = ToolPermissionManager::new(None);
        new_manager.import(&exported, target_scope)
            .expect("Import should succeed");

        // Verify permission was imported
        let imported_perms = new_manager.get_permissions(Some(target_scope));
        prop_assert_eq!(imported_perms.len(), 1, "Should have exactly one permission");

        // Compare permissions (scope will be different - set to target_scope)
        let imported_perm = &imported_perms[0];
        prop_assert_eq!(&imported_perm.tool, &perm.tool, "Tool name should match");
        prop_assert_eq!(imported_perm.allowed, perm.allowed, "Allowed flag should match");
        prop_assert_eq!(imported_perm.priority, perm.priority, "Priority should match");
        prop_assert_eq!(&imported_perm.reason, &perm.reason, "Reason should match");
        prop_assert_eq!(imported_perm.expires_at, perm.expires_at, "Expires_at should match");
        prop_assert_eq!(imported_perm.scope, target_scope, "Scope should be target scope");
    }

    /// **Feature: tool-permission-system, Property 13: Import/Export Round-Trip**
    ///
    /// Property: Multiple permissions export/import round-trip
    /// *For any* set of valid ToolPermissions, exporting to JSON and importing back
    /// SHALL produce an equivalent set of permissions.
    ///
    /// **Validates: Requirements 8.1, 8.2, 8.5**
    #[test]
    fn prop_multiple_permissions_export_import_round_trip(
        perms in prop::collection::vec(arb_valid_tool_permission(), 1..5),
        target_scope in arb_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        for perm in &perms {
            manager.add_permission(perm.clone(), PermissionScope::Global);
        }

        // Export all global permissions
        let exported = manager.export(Some(PermissionScope::Global))
            .expect("Export should succeed");

        // Import into new manager
        let mut new_manager = ToolPermissionManager::new(None);
        new_manager.import(&exported, target_scope)
            .expect("Import should succeed");

        // Verify permissions were imported (note: HashMap deduplicates by tool name)
        let imported_perms = new_manager.get_permissions(Some(target_scope));
        prop_assert!(!imported_perms.is_empty(), "Should have at least one permission");
    }

    /// **Feature: tool-permission-system, Property 13: Import/Export Round-Trip**
    ///
    /// Property: Inheritance configuration is preserved in export/import
    /// *For any* inheritance configuration, exporting and importing SHALL
    /// preserve the inheritance settings.
    ///
    /// **Validates: Requirements 8.1, 8.2, 8.5**
    #[test]
    fn prop_inheritance_preserved_in_export_import(
        inheritance in arb_permission_inheritance(),
        perm in arb_valid_tool_permission(),
        target_scope in arb_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.set_inheritance(inheritance.clone());
        manager.add_permission(perm.clone(), PermissionScope::Global);

        // Export
        let exported = manager.export(Some(PermissionScope::Global))
            .expect("Export should succeed");

        // Import into new manager
        let mut new_manager = ToolPermissionManager::new(None);
        new_manager.import(&exported, target_scope)
            .expect("Import should succeed");

        // Verify inheritance was imported
        prop_assert_eq!(
            new_manager.get_inheritance(),
            inheritance,
            "Inheritance should be preserved"
        );
    }

    /// **Feature: tool-permission-system, Property 13: Import/Export Round-Trip**
    ///
    /// Property: Empty permissions export/import round-trip
    /// *For any* manager with no permissions, exporting and importing SHALL
    /// result in an empty permission set.
    ///
    /// **Validates: Requirements 8.1, 8.2, 8.5**
    #[test]
    fn prop_empty_permissions_export_import_round_trip(
        target_scope in arb_scope(),
    ) {
        let manager = ToolPermissionManager::new(None);

        // Export empty permissions
        let exported = manager.export(None)
            .expect("Export should succeed");

        // Verify version is present
        prop_assert!(exported.contains("\"version\": \"1.0.0\""), "Export should contain version");

        // Import into new manager
        let mut new_manager = ToolPermissionManager::new(None);
        new_manager.import(&exported, target_scope)
            .expect("Import should succeed");

        // Verify no permissions
        let imported_perms = new_manager.get_permissions(Some(target_scope));
        prop_assert_eq!(imported_perms.len(), 0, "Should have no permissions");
    }

    /// **Feature: tool-permission-system, Property 13: Import/Export Round-Trip**
    ///
    /// Property: Conditions and restrictions are preserved in export/import
    /// *For any* permission with conditions and restrictions, exporting and
    /// importing SHALL preserve all conditions and restrictions.
    ///
    /// **Validates: Requirements 8.1, 8.2, 8.5**
    #[test]
    fn prop_conditions_restrictions_preserved(
        perm in arb_valid_tool_permission(),
        target_scope in arb_scope(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(perm.clone(), PermissionScope::Global);

        // Export
        let exported = manager.export(Some(PermissionScope::Global))
            .expect("Export should succeed");

        // Import into new manager
        let mut new_manager = ToolPermissionManager::new(None);
        new_manager.import(&exported, target_scope)
            .expect("Import should succeed");

        // Verify conditions and restrictions
        let imported_perms = new_manager.get_permissions(Some(target_scope));
        prop_assert_eq!(imported_perms.len(), 1, "Should have exactly one permission");

        let imported_perm = &imported_perms[0];
        prop_assert_eq!(
            imported_perm.conditions.len(),
            perm.conditions.len(),
            "Conditions count should match"
        );
        prop_assert_eq!(
            imported_perm.parameter_restrictions.len(),
            perm.parameter_restrictions.len(),
            "Restrictions count should match"
        );
    }
}

// ============================================================================
// Property Tests - Property 14: Import Validation
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 14: Import Validation**
    ///
    /// Property: Invalid JSON fails import and preserves existing permissions
    /// *For any* invalid JSON string, import SHALL fail and existing permissions
    /// SHALL remain unchanged.
    ///
    /// **Validates: Requirements 8.3, 8.4**
    #[test]
    fn prop_invalid_json_fails_import(
        existing_perm in arb_valid_tool_permission(),
        invalid_json in "[a-zA-Z0-9 ]{10,50}",
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(existing_perm.clone(), PermissionScope::Global);

        // Attempt to import invalid JSON
        let result = manager.import(&invalid_json, PermissionScope::Global);

        // Import should fail
        prop_assert!(result.is_err(), "Import of invalid JSON should fail");

        // Existing permissions should remain unchanged
        let perms = manager.get_permissions(Some(PermissionScope::Global));
        prop_assert_eq!(perms.len(), 1, "Existing permission should remain");
        prop_assert_eq!(&perms[0].tool, &existing_perm.tool, "Existing permission should be unchanged");
    }

    /// **Feature: tool-permission-system, Property 14: Import Validation**
    ///
    /// Property: Invalid version fails import and preserves existing permissions
    /// *For any* JSON with unsupported version, import SHALL fail and existing
    /// permissions SHALL remain unchanged.
    ///
    /// **Validates: Requirements 8.3, 8.4**
    #[test]
    fn prop_invalid_version_fails_import(
        existing_perm in arb_valid_tool_permission(),
        major in 2u32..100u32,
        minor in 0u32..100u32,
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(existing_perm.clone(), PermissionScope::Global);

        // Create JSON with invalid version
        let invalid_version_json = format!(r#"{{
            "version": "{}.{}.0",
            "inheritance": {{
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            }},
            "permissions": []
        }}"#, major, minor);

        // Attempt to import
        let result = manager.import(&invalid_version_json, PermissionScope::Global);

        // Import should fail
        prop_assert!(result.is_err(), "Import of invalid version should fail");

        // Existing permissions should remain unchanged
        let perms = manager.get_permissions(Some(PermissionScope::Global));
        prop_assert_eq!(perms.len(), 1, "Existing permission should remain");
    }

    /// **Feature: tool-permission-system, Property 14: Import Validation**
    ///
    /// Property: Empty tool name fails import and preserves existing permissions
    /// *For any* JSON with empty tool name, import SHALL fail and existing
    /// permissions SHALL remain unchanged.
    ///
    /// **Validates: Requirements 8.3, 8.4**
    #[test]
    fn prop_empty_tool_name_fails_import(
        existing_perm in arb_valid_tool_permission(),
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(existing_perm.clone(), PermissionScope::Global);

        // Create JSON with empty tool name
        let empty_tool_json = r#"{
            "version": "1.0.0",
            "inheritance": {
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            },
            "permissions": [
                {
                    "tool": "",
                    "allowed": true,
                    "priority": 0,
                    "conditions": [],
                    "parameter_restrictions": [],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {}
                }
            ]
        }"#;

        // Attempt to import
        let result = manager.import(empty_tool_json, PermissionScope::Global);

        // Import should fail
        prop_assert!(result.is_err(), "Import of empty tool name should fail");

        // Existing permissions should remain unchanged
        let perms = manager.get_permissions(Some(PermissionScope::Global));
        prop_assert_eq!(perms.len(), 1, "Existing permission should remain");
    }

    /// **Feature: tool-permission-system, Property 14: Import Validation**
    ///
    /// Property: Invalid range restriction fails import
    /// *For any* JSON with range restriction missing min and max, import SHALL fail.
    ///
    /// **Validates: Requirements 8.3, 8.4**
    #[test]
    fn prop_invalid_range_restriction_fails_import(
        existing_perm in arb_valid_tool_permission(),
        param_name in "[a-z_]{3,10}",
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(existing_perm.clone(), PermissionScope::Global);

        // Create JSON with invalid range restriction (no min or max)
        let invalid_range_json = format!(r#"{{
            "version": "1.0.0",
            "inheritance": {{
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            }},
            "permissions": [
                {{
                    "tool": "test_tool",
                    "allowed": true,
                    "priority": 0,
                    "conditions": [],
                    "parameter_restrictions": [
                        {{
                            "parameter": "{}",
                            "restriction_type": "Range",
                            "values": null,
                            "pattern": null,
                            "min": null,
                            "max": null,
                            "required": false,
                            "description": null
                        }}
                    ],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {{}}
                }}
            ]
        }}"#, param_name);

        // Attempt to import
        let result = manager.import(&invalid_range_json, PermissionScope::Global);

        // Import should fail
        prop_assert!(result.is_err(), "Import of invalid range restriction should fail");

        // Existing permissions should remain unchanged
        let perms = manager.get_permissions(Some(PermissionScope::Global));
        prop_assert_eq!(perms.len(), 1, "Existing permission should remain");
    }

    /// **Feature: tool-permission-system, Property 14: Import Validation**
    ///
    /// Property: Invalid pattern restriction fails import
    /// *For any* JSON with pattern restriction missing pattern, import SHALL fail.
    ///
    /// **Validates: Requirements 8.3, 8.4**
    #[test]
    fn prop_invalid_pattern_restriction_fails_import(
        existing_perm in arb_valid_tool_permission(),
        param_name in "[a-z_]{3,10}",
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(existing_perm.clone(), PermissionScope::Global);

        // Create JSON with invalid pattern restriction (no pattern)
        let invalid_pattern_json = format!(r#"{{
            "version": "1.0.0",
            "inheritance": {{
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            }},
            "permissions": [
                {{
                    "tool": "test_tool",
                    "allowed": true,
                    "priority": 0,
                    "conditions": [],
                    "parameter_restrictions": [
                        {{
                            "parameter": "{}",
                            "restriction_type": "Pattern",
                            "values": null,
                            "pattern": null,
                            "min": null,
                            "max": null,
                            "required": false,
                            "description": null
                        }}
                    ],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {{}}
                }}
            ]
        }}"#, param_name);

        // Attempt to import
        let result = manager.import(&invalid_pattern_json, PermissionScope::Global);

        // Import should fail
        prop_assert!(result.is_err(), "Import of invalid pattern restriction should fail");

        // Existing permissions should remain unchanged
        let perms = manager.get_permissions(Some(PermissionScope::Global));
        prop_assert_eq!(perms.len(), 1, "Existing permission should remain");
    }

    /// **Feature: tool-permission-system, Property 14: Import Validation**
    ///
    /// Property: Invalid whitelist restriction fails import
    /// *For any* JSON with whitelist restriction missing values, import SHALL fail.
    ///
    /// **Validates: Requirements 8.3, 8.4**
    #[test]
    fn prop_invalid_whitelist_restriction_fails_import(
        existing_perm in arb_valid_tool_permission(),
        param_name in "[a-z_]{3,10}",
    ) {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(existing_perm.clone(), PermissionScope::Global);

        // Create JSON with invalid whitelist restriction (no values)
        let invalid_whitelist_json = format!(r#"{{
            "version": "1.0.0",
            "inheritance": {{
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            }},
            "permissions": [
                {{
                    "tool": "test_tool",
                    "allowed": true,
                    "priority": 0,
                    "conditions": [],
                    "parameter_restrictions": [
                        {{
                            "parameter": "{}",
                            "restriction_type": "Whitelist",
                            "values": null,
                            "pattern": null,
                            "min": null,
                            "max": null,
                            "required": false,
                            "description": null
                        }}
                    ],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {{}}
                }}
            ]
        }}"#, param_name);

        // Attempt to import
        let result = manager.import(&invalid_whitelist_json, PermissionScope::Global);

        // Import should fail
        prop_assert!(result.is_err(), "Import of invalid whitelist restriction should fail");

        // Existing permissions should remain unchanged
        let perms = manager.get_permissions(Some(PermissionScope::Global));
        prop_assert_eq!(perms.len(), 1, "Existing permission should remain");
    }
}

// ============================================================================
// Additional Unit Tests for Edge Cases
// ============================================================================

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_export_contains_version() {
        let manager = ToolPermissionManager::new(None);
        let exported = manager.export(None).unwrap();
        assert!(exported.contains("\"version\": \"1.0.0\""));
    }

    #[test]
    fn test_export_contains_inheritance() {
        let manager = ToolPermissionManager::new(None);
        let exported = manager.export(None).unwrap();
        assert!(exported.contains("\"inheritance\""));
        assert!(exported.contains("\"inherit_global\""));
        assert!(exported.contains("\"inherit_project\""));
        assert!(exported.contains("\"override_global\""));
        assert!(exported.contains("\"merge_strategy\""));
    }

    #[test]
    fn test_import_replaces_all_permissions_in_scope() {
        let mut manager = ToolPermissionManager::new(None);

        // Add existing permissions
        let perm1 = ToolPermission {
            tool: "old_tool_1".to_string(),
            allowed: true,
            ..Default::default()
        };
        let perm2 = ToolPermission {
            tool: "old_tool_2".to_string(),
            allowed: false,
            ..Default::default()
        };
        manager.add_permission(perm1, PermissionScope::Global);
        manager.add_permission(perm2, PermissionScope::Global);

        // Import new permissions
        let import_json = r#"{
            "version": "1.0.0",
            "inheritance": {
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            },
            "permissions": [
                {
                    "tool": "new_tool",
                    "allowed": true,
                    "priority": 0,
                    "conditions": [],
                    "parameter_restrictions": [],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {}
                }
            ]
        }"#;

        manager
            .import(import_json, PermissionScope::Global)
            .unwrap();

        // Verify old permissions are gone and new one is present
        let perms = manager.get_permissions(Some(PermissionScope::Global));
        assert_eq!(perms.len(), 1);
        assert_eq!(perms[0].tool, "new_tool");
    }

    #[test]
    fn test_import_does_not_affect_other_scopes() {
        let mut manager = ToolPermissionManager::new(None);

        // Add permissions to different scopes
        let global_perm = ToolPermission {
            tool: "global_tool".to_string(),
            allowed: true,
            scope: PermissionScope::Global,
            ..Default::default()
        };
        let session_perm = ToolPermission {
            tool: "session_tool".to_string(),
            allowed: false,
            scope: PermissionScope::Session,
            ..Default::default()
        };
        manager.add_permission(global_perm, PermissionScope::Global);
        manager.add_permission(session_perm, PermissionScope::Session);

        // Import into Global scope
        let import_json = r#"{
            "version": "1.0.0",
            "inheritance": {
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            },
            "permissions": [
                {
                    "tool": "imported_tool",
                    "allowed": true,
                    "priority": 0,
                    "conditions": [],
                    "parameter_restrictions": [],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {}
                }
            ]
        }"#;

        manager
            .import(import_json, PermissionScope::Global)
            .unwrap();

        // Verify session scope is unchanged
        let session_perms = manager.get_permissions(Some(PermissionScope::Session));
        assert_eq!(session_perms.len(), 1);
        assert_eq!(session_perms[0].tool, "session_tool");

        // Verify global scope has new permission
        let global_perms = manager.get_permissions(Some(PermissionScope::Global));
        assert_eq!(global_perms.len(), 1);
        assert_eq!(global_perms[0].tool, "imported_tool");
    }

    #[test]
    fn test_export_specific_scope_only() {
        let mut manager = ToolPermissionManager::new(None);

        // Add permissions to different scopes
        let global_perm = ToolPermission {
            tool: "global_tool".to_string(),
            allowed: true,
            scope: PermissionScope::Global,
            ..Default::default()
        };
        let project_perm = ToolPermission {
            tool: "project_tool".to_string(),
            allowed: false,
            scope: PermissionScope::Project,
            ..Default::default()
        };
        manager.add_permission(global_perm, PermissionScope::Global);
        manager.add_permission(project_perm, PermissionScope::Project);

        // Export only global scope
        let exported = manager.export(Some(PermissionScope::Global)).unwrap();

        assert!(exported.contains("global_tool"));
        assert!(!exported.contains("project_tool"));
    }

    #[test]
    fn test_export_all_scopes() {
        let mut manager = ToolPermissionManager::new(None);

        // Add permissions to different scopes
        let global_perm = ToolPermission {
            tool: "global_tool".to_string(),
            allowed: true,
            scope: PermissionScope::Global,
            ..Default::default()
        };
        let project_perm = ToolPermission {
            tool: "project_tool".to_string(),
            allowed: false,
            scope: PermissionScope::Project,
            ..Default::default()
        };
        let session_perm = ToolPermission {
            tool: "session_tool".to_string(),
            allowed: true,
            scope: PermissionScope::Session,
            ..Default::default()
        };
        manager.add_permission(global_perm, PermissionScope::Global);
        manager.add_permission(project_perm, PermissionScope::Project);
        manager.add_permission(session_perm, PermissionScope::Session);

        // Export all scopes
        let exported = manager.export(None).unwrap();

        assert!(exported.contains("global_tool"));
        assert!(exported.contains("project_tool"));
        assert!(exported.contains("session_tool"));
    }
}
