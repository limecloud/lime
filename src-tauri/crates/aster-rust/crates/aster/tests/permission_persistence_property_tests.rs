//! Property-based tests for Permission Persistence
//!
//! **Property 2: Permission Persistence Round-Trip**
//! *For any* valid ToolPermission in Global or Project scope, saving to file
//! and then loading SHALL produce an equivalent permission object.
//!
//! **Validates: Requirements 1.4**
//!
//! **Property 3: Session Memory-Only Storage**
//! *For any* permission added to Session scope, it SHALL exist in memory
//! but SHALL NOT be persisted to any configuration file.
//!
//! **Validates: Requirements 1.5**

use aster::permission::{
    ConditionOperator, ConditionType, MergeStrategy, ParameterRestriction, PermissionCondition,
    PermissionInheritance, PermissionScope, RestrictionType, ToolPermission, ToolPermissionManager,
};
use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tempfile::TempDir;

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

/// Generate arbitrary PermissionScope (Global or Project only for persistence)
fn arb_persistable_scope() -> impl Strategy<Value = PermissionScope> {
    prop_oneof![
        Just(PermissionScope::Global),
        Just(PermissionScope::Project),
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

/// Generate arbitrary RestrictionType
fn arb_restriction_type() -> impl Strategy<Value = RestrictionType> {
    prop_oneof![
        Just(RestrictionType::Whitelist),
        Just(RestrictionType::Blacklist),
        Just(RestrictionType::Pattern),
        Just(RestrictionType::Range),
    ]
}

/// Generate arbitrary ParameterRestriction (without validator - not serializable)
fn arb_parameter_restriction() -> impl Strategy<Value = ParameterRestriction> {
    (
        "[a-z_]{3,10}",
        arb_restriction_type(),
        prop::option::of(prop::collection::vec(
            prop_oneof![
                Just(Value::String("allowed".to_string())),
                Just(Value::String("safe".to_string())),
            ],
            0..3,
        )),
        prop::option::of("[a-z]+"),
        prop::option::of(-100.0f64..0.0f64),
        prop::option::of(0.0f64..100.0f64),
        prop::bool::ANY,
        prop::option::of("[a-zA-Z0-9 ]{5,20}"),
    )
        .prop_map(
            |(parameter, restriction_type, values, pattern, min, max, required, description)| {
                ParameterRestriction {
                    parameter,
                    restriction_type,
                    values,
                    pattern,
                    validator: None, // Validators are not serializable
                    min,
                    max,
                    required,
                    description,
                }
            },
        )
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

/// Generate arbitrary ToolPermission for persistence testing
fn arb_tool_permission(scope: PermissionScope) -> impl Strategy<Value = ToolPermission> {
    (
        arb_tool_name(),
        prop::bool::ANY,
        arb_priority(),
        prop::collection::vec(arb_permission_condition(), 0..2),
        prop::collection::vec(arb_parameter_restriction(), 0..2),
        arb_reason(),
        arb_expires_at(),
        arb_metadata(),
    )
        .prop_map(
            move |(
                tool,
                allowed,
                priority,
                conditions,
                parameter_restrictions,
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
// Helper Functions
// ============================================================================

/// Compare two ToolPermissions for equality (ignoring validators which aren't serialized)
/// Uses approximate comparison for floating-point values
fn permissions_equal(a: &ToolPermission, b: &ToolPermission) -> bool {
    a.tool == b.tool
        && a.allowed == b.allowed
        && a.priority == b.priority
        && a.scope == b.scope
        && a.reason == b.reason
        && a.expires_at == b.expires_at
        && a.metadata == b.metadata
        && a.conditions.len() == b.conditions.len()
        && a.parameter_restrictions.len() == b.parameter_restrictions.len()
        && a.conditions
            .iter()
            .zip(b.conditions.iter())
            .all(|(ca, cb)| {
                ca.condition_type == cb.condition_type
                    && ca.field == cb.field
                    && ca.operator == cb.operator
                    && ca.value == cb.value
                    && ca.description == cb.description
            })
        && a.parameter_restrictions
            .iter()
            .zip(b.parameter_restrictions.iter())
            .all(|(ra, rb)| {
                ra.parameter == rb.parameter
                    && ra.restriction_type == rb.restriction_type
                    && ra.values == rb.values
                    && ra.pattern == rb.pattern
                    && f64_approx_eq(ra.min, rb.min)
                    && f64_approx_eq(ra.max, rb.max)
                    && ra.required == rb.required
                    && ra.description == rb.description
            })
}

/// Compare two Option<f64> values with tolerance for floating-point precision
fn f64_approx_eq(a: Option<f64>, b: Option<f64>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(va), Some(vb)) => (va - vb).abs() < 1e-10,
        _ => false,
    }
}

// ============================================================================
// Property Tests - Property 2: Permission Persistence Round-Trip
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 2: Permission Persistence Round-Trip**
    ///
    /// Property: Global permissions round-trip through save/load
    /// *For any* valid ToolPermission in Global scope, saving to file and then
    /// loading SHALL produce an equivalent permission object.
    ///
    /// **Validates: Requirements 1.4**
    #[test]
    fn prop_global_permission_round_trip(
        perm in arb_tool_permission(PermissionScope::Global),
        inheritance in arb_permission_inheritance(),
    ) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config_dir = temp_dir.path().to_path_buf();

        // Create manager and add permission
        let mut manager = ToolPermissionManager::new(Some(config_dir.clone()));
        manager.set_inheritance(inheritance.clone());
        manager.add_permission(perm.clone(), PermissionScope::Global);

        // Save permissions
        manager.save_permissions(PermissionScope::Global)
            .expect("Failed to save global permissions");

        // Create new manager and load
        let mut loaded_manager = ToolPermissionManager::new(Some(config_dir));
        loaded_manager.load_permissions();

        // Verify permission was loaded correctly
        let loaded_perms = loaded_manager.get_permissions(Some(PermissionScope::Global));
        prop_assert_eq!(loaded_perms.len(), 1, "Should have exactly one permission");

        let loaded_perm = &loaded_perms[0];
        prop_assert!(
            permissions_equal(&perm, loaded_perm),
            "Loaded permission should equal original. Original: {:?}, Loaded: {:?}",
            perm, loaded_perm
        );

        // Verify inheritance was loaded correctly
        prop_assert_eq!(
            loaded_manager.inheritance(),
            &inheritance,
            "Inheritance should be preserved"
        );
    }

    /// **Feature: tool-permission-system, Property 2: Permission Persistence Round-Trip**
    ///
    /// Property: Project permissions round-trip through save/load
    /// *For any* valid ToolPermission in Project scope, saving to file and then
    /// loading SHALL produce an equivalent permission object.
    ///
    /// **Validates: Requirements 1.4**
    #[test]
    fn prop_project_permission_round_trip(
        perm in arb_tool_permission(PermissionScope::Project),
    ) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config_dir = temp_dir.path().to_path_buf();

        // Create manager and add permission
        let mut manager = ToolPermissionManager::new(Some(config_dir.clone()));
        manager.add_permission(perm.clone(), PermissionScope::Project);

        // Save permissions
        manager.save_permissions(PermissionScope::Project)
            .expect("Failed to save project permissions");

        // Create new manager and load
        let mut loaded_manager = ToolPermissionManager::new(Some(config_dir));
        loaded_manager.load_permissions();

        // Verify permission was loaded correctly
        let loaded_perms = loaded_manager.get_permissions(Some(PermissionScope::Project));
        prop_assert_eq!(loaded_perms.len(), 1, "Should have exactly one permission");

        let loaded_perm = &loaded_perms[0];
        prop_assert!(
            permissions_equal(&perm, loaded_perm),
            "Loaded permission should equal original. Original: {:?}, Loaded: {:?}",
            perm, loaded_perm
        );
    }

    /// **Feature: tool-permission-system, Property 2: Permission Persistence Round-Trip**
    ///
    /// Property: Multiple permissions round-trip correctly
    /// *For any* set of valid ToolPermissions, saving and loading SHALL preserve
    /// all permissions.
    ///
    /// **Validates: Requirements 1.4**
    #[test]
    fn prop_multiple_permissions_round_trip(
        global_perms in prop::collection::vec(arb_tool_permission(PermissionScope::Global), 1..5),
        project_perms in prop::collection::vec(arb_tool_permission(PermissionScope::Project), 1..5),
    ) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config_dir = temp_dir.path().to_path_buf();

        // Create manager and add permissions
        let mut manager = ToolPermissionManager::new(Some(config_dir.clone()));
        for perm in &global_perms {
            manager.add_permission(perm.clone(), PermissionScope::Global);
        }
        for perm in &project_perms {
            manager.add_permission(perm.clone(), PermissionScope::Project);
        }

        // Save permissions
        manager.save_permissions(PermissionScope::Global)
            .expect("Failed to save global permissions");
        manager.save_permissions(PermissionScope::Project)
            .expect("Failed to save project permissions");

        // Create new manager and load
        let mut loaded_manager = ToolPermissionManager::new(Some(config_dir));
        loaded_manager.load_permissions();

        // Verify counts (note: HashMap deduplicates by tool name)
        let (global_count, project_count, session_count) = loaded_manager.permission_counts();
        prop_assert!(global_count > 0, "Should have global permissions");
        prop_assert!(project_count > 0, "Should have project permissions");
        prop_assert_eq!(session_count, 0, "Should have no session permissions");
    }

    /// **Feature: tool-permission-system, Property 2: Permission Persistence Round-Trip**
    ///
    /// Property: Empty permissions save/load correctly
    /// *For any* manager with no permissions, saving and loading SHALL result
    /// in an empty permission set.
    ///
    /// **Validates: Requirements 1.4**
    #[test]
    fn prop_empty_permissions_round_trip(
        scope in arb_persistable_scope(),
    ) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config_dir = temp_dir.path().to_path_buf();

        // Create manager with no permissions
        let manager = ToolPermissionManager::new(Some(config_dir.clone()));

        // Save empty permissions
        manager.save_permissions(scope)
            .expect("Failed to save empty permissions");

        // Create new manager and load
        let mut loaded_manager = ToolPermissionManager::new(Some(config_dir));
        loaded_manager.load_permissions();

        // Verify no permissions loaded
        let loaded_perms = loaded_manager.get_permissions(Some(scope));
        prop_assert_eq!(loaded_perms.len(), 0, "Should have no permissions");
    }
}

// ============================================================================
// Property Tests - Property 3: Session Memory-Only Storage
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 3: Session Memory-Only Storage**
    ///
    /// Property: Session permissions exist in memory
    /// *For any* permission added to Session scope, it SHALL exist in memory.
    ///
    /// **Validates: Requirements 1.5**
    #[test]
    fn prop_session_permission_exists_in_memory(
        tool in arb_tool_name(),
        allowed in prop::bool::ANY,
        priority in arb_priority(),
    ) {
        let mut manager = ToolPermissionManager::new(None);

        let perm = ToolPermission {
            tool: tool.clone(),
            allowed,
            priority,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };

        manager.add_permission(perm.clone(), PermissionScope::Session);

        // Verify permission exists in memory
        let session_perms = manager.get_permissions(Some(PermissionScope::Session));
        prop_assert_eq!(session_perms.len(), 1, "Should have one session permission");
        prop_assert_eq!(&session_perms[0].tool, &tool, "Tool name should match");
        prop_assert_eq!(session_perms[0].allowed, allowed, "Allowed flag should match");
    }

    /// **Feature: tool-permission-system, Property 3: Session Memory-Only Storage**
    ///
    /// Property: Session permissions cannot be saved
    /// *For any* attempt to save Session scope, it SHALL fail with an error.
    ///
    /// **Validates: Requirements 1.5**
    #[test]
    fn prop_session_permission_save_fails(
        tool in arb_tool_name(),
    ) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config_dir = temp_dir.path().to_path_buf();

        let mut manager = ToolPermissionManager::new(Some(config_dir));

        let perm = ToolPermission {
            tool,
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

        // Attempt to save session permissions should fail
        let result = manager.save_permissions(PermissionScope::Session);
        prop_assert!(result.is_err(), "Saving session permissions should fail");
    }

    /// **Feature: tool-permission-system, Property 3: Session Memory-Only Storage**
    ///
    /// Property: Session permissions are not loaded from disk
    /// *For any* manager, loading permissions SHALL NOT load any session permissions.
    ///
    /// **Validates: Requirements 1.5**
    #[test]
    fn prop_session_permissions_not_loaded(
        global_perm in arb_tool_permission(PermissionScope::Global),
    ) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config_dir = temp_dir.path().to_path_buf();

        // Create manager with global and session permissions
        let mut manager = ToolPermissionManager::new(Some(config_dir.clone()));
        manager.add_permission(global_perm.clone(), PermissionScope::Global);

        let session_perm = ToolPermission {
            tool: "session_tool".to_string(),
            allowed: false,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some("Session only".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager.add_permission(session_perm, PermissionScope::Session);

        // Save global permissions (session cannot be saved)
        manager.save_permissions(PermissionScope::Global)
            .expect("Failed to save global permissions");

        // Create new manager and load
        let mut loaded_manager = ToolPermissionManager::new(Some(config_dir));
        loaded_manager.load_permissions();

        // Verify session permissions were NOT loaded
        let (_, _, session_count) = loaded_manager.permission_counts();
        prop_assert_eq!(session_count, 0, "Session permissions should not be loaded");

        // Verify global permissions were loaded
        let global_perms = loaded_manager.get_permissions(Some(PermissionScope::Global));
        prop_assert_eq!(global_perms.len(), 1, "Global permissions should be loaded");
    }

    /// **Feature: tool-permission-system, Property 3: Session Memory-Only Storage**
    ///
    /// Property: Session permissions are isolated per manager instance
    /// *For any* session permission added to one manager, it SHALL NOT appear
    /// in another manager instance.
    ///
    /// **Validates: Requirements 1.5**
    #[test]
    fn prop_session_permissions_isolated(
        tool in arb_tool_name(),
    ) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config_dir = temp_dir.path().to_path_buf();

        // Create first manager with session permission
        let mut manager1 = ToolPermissionManager::new(Some(config_dir.clone()));
        let perm = ToolPermission {
            tool: tool.clone(),
            allowed: true,
            priority: 0,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        };
        manager1.add_permission(perm, PermissionScope::Session);

        // Create second manager
        let mut manager2 = ToolPermissionManager::new(Some(config_dir));
        manager2.load_permissions();

        // Verify session permission is NOT in second manager
        let session_perms = manager2.get_permissions(Some(PermissionScope::Session));
        prop_assert_eq!(session_perms.len(), 0, "Session permissions should be isolated");

        // Verify first manager still has the session permission
        let manager1_session = manager1.get_permissions(Some(PermissionScope::Session));
        prop_assert_eq!(manager1_session.len(), 1, "First manager should still have session permission");
    }
}

// ============================================================================
// Additional Unit Tests for Edge Cases
// ============================================================================

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_save_without_config_dir_fails() {
        let manager = ToolPermissionManager::new(None);
        let result = manager.save_permissions(PermissionScope::Global);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("No config directory"));
    }

    #[test]
    fn test_load_without_config_dir_is_noop() {
        let mut manager = ToolPermissionManager::new(None);
        manager.load_permissions(); // Should not panic
        assert_eq!(manager.permission_counts(), (0, 0, 0));
    }

    #[test]
    fn test_load_nonexistent_files_is_noop() {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config_dir = temp_dir.path().to_path_buf();

        let mut manager = ToolPermissionManager::new(Some(config_dir));
        manager.load_permissions(); // Should not panic
        assert_eq!(manager.permission_counts(), (0, 0, 0));
    }

    #[test]
    fn test_config_exists() {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config_dir = temp_dir.path().to_path_buf();

        let mut manager = ToolPermissionManager::new(Some(config_dir.clone()));

        // Initially no config exists
        assert!(!manager.config_exists(PermissionScope::Global));
        assert!(!manager.config_exists(PermissionScope::Project));

        // Add and save a permission
        let perm = ToolPermission {
            tool: "test".to_string(),
            allowed: true,
            ..Default::default()
        };
        manager.add_permission(perm, PermissionScope::Global);
        manager.save_permissions(PermissionScope::Global).unwrap();

        // Now global config exists
        assert!(manager.config_exists(PermissionScope::Global));
        assert!(!manager.config_exists(PermissionScope::Project));
    }

    #[test]
    fn test_get_config_path() {
        let config_dir = PathBuf::from("/test/config");
        let manager = ToolPermissionManager::new(Some(config_dir.clone()));

        assert_eq!(
            manager.get_config_path(PermissionScope::Global),
            Some(config_dir.join("global_permissions.json"))
        );
        assert_eq!(
            manager.get_config_path(PermissionScope::Project),
            Some(config_dir.join("project_permissions.json"))
        );
    }
}
