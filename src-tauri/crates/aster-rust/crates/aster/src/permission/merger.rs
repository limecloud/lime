//! Permission Merger Module
//!
//! This module implements the permission merging logic for the tool permission system.
//! It handles merging permissions from different scopes (Global, Project, Session)
//! according to priority rules and merge strategies.
//!
//! Requirements: 1.2, 1.3, 6.4, 6.5, 6.6

use super::types::{
    MergeStrategy, ParameterRestriction, PermissionCondition, PermissionInheritance,
    PermissionScope, ToolPermission,
};
use std::collections::HashMap;

/// Merge permissions from all scopes according to inheritance configuration.
///
/// This function combines permissions from Global, Project, and Session scopes
/// following the priority order: Session > Project > Global.
///
/// # Arguments
///
/// * `global` - Permissions defined at the global scope
/// * `project` - Permissions defined at the project scope
/// * `session` - Permissions defined at the session scope
/// * `inheritance` - Configuration for how permissions should be inherited and merged
///
/// # Returns
///
/// A vector of merged permissions, sorted by priority (highest first)
///
/// # Requirements
///
/// - 1.2: Merge permissions from all scopes with Session > Project > Global priority
/// - 1.3: Use higher priority scope's permission when conflicts exist
pub fn merge_permissions(
    global: &[ToolPermission],
    project: &[ToolPermission],
    session: &[ToolPermission],
    inheritance: &PermissionInheritance,
) -> Vec<ToolPermission> {
    let mut result: HashMap<String, ToolPermission> = HashMap::new();

    // Step 1: Add global permissions if inheritance is enabled
    if inheritance.inherit_global {
        for perm in global {
            result.insert(perm.tool.clone(), perm.clone());
        }
    }

    // Step 2: Process project permissions
    if inheritance.inherit_project {
        for perm in project {
            merge_single_permission(&mut result, perm, inheritance);
        }
    }

    // Step 3: Process session permissions (always highest priority)
    // Session permissions always override regardless of inheritance settings
    for perm in session {
        merge_single_permission(&mut result, perm, inheritance);
    }

    // Convert to vector and sort by priority (highest first)
    let mut permissions: Vec<ToolPermission> = result.into_values().collect();
    permissions.sort_by(|a, b| b.priority.cmp(&a.priority));

    permissions
}

/// Merge a single permission into the result map according to the merge strategy.
///
/// # Arguments
///
/// * `result` - The current map of merged permissions
/// * `new_perm` - The new permission to merge
/// * `inheritance` - The inheritance configuration containing the merge strategy
fn merge_single_permission(
    result: &mut HashMap<String, ToolPermission>,
    new_perm: &ToolPermission,
    inheritance: &PermissionInheritance,
) {
    let tool_key = new_perm.tool.clone();

    match result.get(&tool_key) {
        Some(existing) => {
            // Check if we can override based on scope priority
            let can_override = can_override_permission(existing, new_perm, inheritance);

            if can_override {
                let merged = apply_merge_strategy(existing, new_perm, &inheritance.merge_strategy);
                result.insert(tool_key, merged);
            }
        }
        None => {
            // No existing permission, just add the new one
            result.insert(tool_key, new_perm.clone());
        }
    }
}

/// Determine if a new permission can override an existing one based on scope priority.
///
/// # Arguments
///
/// * `existing` - The existing permission
/// * `new_perm` - The new permission attempting to override
/// * `inheritance` - The inheritance configuration
///
/// # Returns
///
/// `true` if the new permission can override the existing one
fn can_override_permission(
    existing: &ToolPermission,
    new_perm: &ToolPermission,
    inheritance: &PermissionInheritance,
) -> bool {
    let existing_priority = scope_priority(existing.scope);
    let new_priority = scope_priority(new_perm.scope);

    // Higher scope priority always wins
    if new_priority > existing_priority {
        return true;
    }

    // Same scope: check if override is allowed
    if new_priority == existing_priority {
        // For Global scope, check override_global flag
        if existing.scope == PermissionScope::Global && !inheritance.override_global {
            return false;
        }
        return true;
    }

    // Lower scope priority cannot override
    false
}

/// Get the numeric priority for a permission scope.
///
/// Higher values indicate higher priority.
/// Session (2) > Project (1) > Global (0)
fn scope_priority(scope: PermissionScope) -> u8 {
    match scope {
        PermissionScope::Global => 0,
        PermissionScope::Project => 1,
        PermissionScope::Session => 2,
    }
}

/// Apply the merge strategy to combine two permissions.
///
/// # Arguments
///
/// * `existing` - The existing permission
/// * `new_perm` - The new permission to merge
/// * `strategy` - The merge strategy to apply
///
/// # Returns
///
/// The merged permission
///
/// # Requirements
///
/// - 6.4: Override strategy replaces entirely
/// - 6.5: Merge strategy combines conditions and restrictions
/// - 6.6: Union strategy keeps both
pub fn apply_merge_strategy(
    existing: &ToolPermission,
    new_perm: &ToolPermission,
    strategy: &MergeStrategy,
) -> ToolPermission {
    match strategy {
        MergeStrategy::Override => {
            // Complete replacement - use the new permission entirely
            new_perm.clone()
        }
        MergeStrategy::Merge => {
            // Merge conditions and restrictions from both permissions
            merge_permissions_combine(existing, new_perm)
        }
        MergeStrategy::Union => {
            // For union, we keep the new permission but combine conditions/restrictions
            // The new permission's allowed/priority/scope take precedence
            merge_permissions_union(existing, new_perm)
        }
    }
}

/// Merge two permissions by combining their conditions and restrictions.
///
/// The new permission's basic properties (allowed, priority, scope, etc.) take precedence,
/// but conditions and restrictions are combined from both.
fn merge_permissions_combine(
    existing: &ToolPermission,
    new_perm: &ToolPermission,
) -> ToolPermission {
    let mut merged = new_perm.clone();

    // Combine conditions (avoiding duplicates)
    let mut combined_conditions = existing.conditions.clone();
    for cond in &new_perm.conditions {
        if !combined_conditions
            .iter()
            .any(|c| conditions_equal(c, cond))
        {
            combined_conditions.push(cond.clone());
        }
    }
    merged.conditions = combined_conditions;

    // Combine parameter restrictions (avoiding duplicates by parameter name)
    let mut combined_restrictions = existing.parameter_restrictions.clone();
    for restr in &new_perm.parameter_restrictions {
        // Check if there's already a restriction for this parameter
        if let Some(pos) = combined_restrictions
            .iter()
            .position(|r| r.parameter == restr.parameter)
        {
            // Replace with the new restriction (higher priority)
            combined_restrictions[pos] = restr.clone();
        } else {
            combined_restrictions.push(restr.clone());
        }
    }
    merged.parameter_restrictions = combined_restrictions;

    // Merge metadata
    let mut combined_metadata = existing.metadata.clone();
    combined_metadata.extend(new_perm.metadata.clone());
    merged.metadata = combined_metadata;

    merged
}

/// Merge two permissions using union strategy.
///
/// Similar to merge, but preserves all conditions and restrictions from both
/// without deduplication based on content.
fn merge_permissions_union(existing: &ToolPermission, new_perm: &ToolPermission) -> ToolPermission {
    let mut merged = new_perm.clone();

    // Union all conditions
    let mut all_conditions = existing.conditions.clone();
    all_conditions.extend(new_perm.conditions.clone());
    merged.conditions = all_conditions;

    // Union all parameter restrictions
    let mut all_restrictions = existing.parameter_restrictions.clone();
    all_restrictions.extend(new_perm.parameter_restrictions.clone());
    merged.parameter_restrictions = all_restrictions;

    // Merge metadata (new takes precedence for conflicts)
    let mut combined_metadata = existing.metadata.clone();
    combined_metadata.extend(new_perm.metadata.clone());
    merged.metadata = combined_metadata;

    merged
}

/// Check if two conditions are equal (for deduplication purposes).
fn conditions_equal(a: &PermissionCondition, b: &PermissionCondition) -> bool {
    a.condition_type == b.condition_type
        && a.field == b.field
        && a.operator == b.operator
        && a.value == b.value
}

/// Check if two restrictions are equal (for deduplication purposes).
#[allow(dead_code)]
fn restrictions_equal(a: &ParameterRestriction, b: &ParameterRestriction) -> bool {
    a.parameter == b.parameter
        && a.restriction_type == b.restriction_type
        && a.values == b.values
        && a.pattern == b.pattern
        && a.min == b.min
        && a.max == b.max
        && a.required == b.required
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn create_test_permission(
        tool: &str,
        allowed: bool,
        priority: i32,
        scope: PermissionScope,
    ) -> ToolPermission {
        ToolPermission {
            tool: tool.to_string(),
            allowed,
            priority,
            scope,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        }
    }

    fn create_permission_with_condition(
        tool: &str,
        allowed: bool,
        scope: PermissionScope,
        condition: PermissionCondition,
    ) -> ToolPermission {
        ToolPermission {
            tool: tool.to_string(),
            allowed,
            priority: 0,
            scope,
            conditions: vec![condition],
            parameter_restrictions: Vec::new(),
            reason: None,
            expires_at: None,
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn test_scope_priority_ordering() {
        assert!(
            scope_priority(PermissionScope::Session) > scope_priority(PermissionScope::Project)
        );
        assert!(scope_priority(PermissionScope::Project) > scope_priority(PermissionScope::Global));
    }

    #[test]
    fn test_merge_empty_permissions() {
        let inheritance = PermissionInheritance::default();
        let result = merge_permissions(&[], &[], &[], &inheritance);
        assert!(result.is_empty());
    }

    #[test]
    fn test_merge_global_only() {
        let global = vec![create_test_permission(
            "bash",
            true,
            10,
            PermissionScope::Global,
        )];
        let inheritance = PermissionInheritance::default();

        let result = merge_permissions(&global, &[], &[], &inheritance);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].tool, "bash");
        assert!(result[0].allowed);
    }

    #[test]
    fn test_session_overrides_global() {
        let global = vec![create_test_permission(
            "bash",
            true,
            10,
            PermissionScope::Global,
        )];
        let session = vec![create_test_permission(
            "bash",
            false,
            5,
            PermissionScope::Session,
        )];
        let inheritance = PermissionInheritance::default();

        let result = merge_permissions(&global, &[], &session, &inheritance);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].tool, "bash");
        assert!(!result[0].allowed); // Session's value
        assert_eq!(result[0].scope, PermissionScope::Session);
    }

    #[test]
    fn test_project_overrides_global() {
        let global = vec![create_test_permission(
            "bash",
            true,
            10,
            PermissionScope::Global,
        )];
        let project = vec![create_test_permission(
            "bash",
            false,
            5,
            PermissionScope::Project,
        )];
        let inheritance = PermissionInheritance::default();

        let result = merge_permissions(&global, &project, &[], &inheritance);

        assert_eq!(result.len(), 1);
        assert!(!result[0].allowed); // Project's value
        assert_eq!(result[0].scope, PermissionScope::Project);
    }

    #[test]
    fn test_session_overrides_project() {
        let project = vec![create_test_permission(
            "bash",
            true,
            10,
            PermissionScope::Project,
        )];
        let session = vec![create_test_permission(
            "bash",
            false,
            5,
            PermissionScope::Session,
        )];
        let inheritance = PermissionInheritance::default();

        let result = merge_permissions(&[], &project, &session, &inheritance);

        assert_eq!(result.len(), 1);
        assert!(!result[0].allowed); // Session's value
        assert_eq!(result[0].scope, PermissionScope::Session);
    }

    #[test]
    fn test_inherit_global_disabled() {
        let global = vec![create_test_permission(
            "bash",
            true,
            10,
            PermissionScope::Global,
        )];
        let inheritance = PermissionInheritance {
            inherit_global: false,
            ..Default::default()
        };

        let result = merge_permissions(&global, &[], &[], &inheritance);

        assert!(result.is_empty());
    }

    #[test]
    fn test_inherit_project_disabled() {
        let project = vec![create_test_permission(
            "bash",
            true,
            10,
            PermissionScope::Project,
        )];
        let inheritance = PermissionInheritance {
            inherit_project: false,
            ..Default::default()
        };

        let result = merge_permissions(&[], &project, &[], &inheritance);

        assert!(result.is_empty());
    }

    #[test]
    fn test_multiple_tools_merged() {
        let global = vec![
            create_test_permission("bash", true, 10, PermissionScope::Global),
            create_test_permission("file_read", true, 5, PermissionScope::Global),
        ];
        let project = vec![create_test_permission(
            "file_write",
            false,
            8,
            PermissionScope::Project,
        )];
        let session = vec![create_test_permission(
            "bash",
            false,
            3,
            PermissionScope::Session,
        )];
        let inheritance = PermissionInheritance::default();

        let result = merge_permissions(&global, &project, &session, &inheritance);

        assert_eq!(result.len(), 3);

        // Find each tool
        let bash = result.iter().find(|p| p.tool == "bash").unwrap();
        let file_read = result.iter().find(|p| p.tool == "file_read").unwrap();
        let file_write = result.iter().find(|p| p.tool == "file_write").unwrap();

        assert!(!bash.allowed); // Session override
        assert!(file_read.allowed); // Global
        assert!(!file_write.allowed); // Project
    }

    #[test]
    fn test_result_sorted_by_priority() {
        let global = vec![
            create_test_permission("low", true, 1, PermissionScope::Global),
            create_test_permission("high", true, 100, PermissionScope::Global),
            create_test_permission("medium", true, 50, PermissionScope::Global),
        ];
        let inheritance = PermissionInheritance::default();

        let result = merge_permissions(&global, &[], &[], &inheritance);

        assert_eq!(result.len(), 3);
        assert_eq!(result[0].tool, "high");
        assert_eq!(result[1].tool, "medium");
        assert_eq!(result[2].tool, "low");
    }

    #[test]
    fn test_merge_strategy_override() {
        use super::super::types::{ConditionOperator, ConditionType};

        let existing_condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Contains,
            value: json!("/old/path"),
            validator: None,
            description: None,
        };

        let new_condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Contains,
            value: json!("/new/path"),
            validator: None,
            description: None,
        };

        let existing = create_permission_with_condition(
            "bash",
            true,
            PermissionScope::Global,
            existing_condition,
        );
        let new_perm = create_permission_with_condition(
            "bash",
            false,
            PermissionScope::Project,
            new_condition,
        );

        let result = apply_merge_strategy(&existing, &new_perm, &MergeStrategy::Override);

        assert!(!result.allowed);
        assert_eq!(result.conditions.len(), 1);
        assert_eq!(result.conditions[0].value, json!("/new/path"));
    }

    #[test]
    fn test_merge_strategy_merge() {
        use super::super::types::{ConditionOperator, ConditionType};

        let existing_condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Contains,
            value: json!("/old/path"),
            validator: None,
            description: None,
        };

        let new_condition = PermissionCondition {
            condition_type: ConditionType::Time,
            field: Some("timestamp".to_string()),
            operator: ConditionOperator::Range,
            value: json!({"min": 0, "max": 100}),
            validator: None,
            description: None,
        };

        let existing = create_permission_with_condition(
            "bash",
            true,
            PermissionScope::Global,
            existing_condition,
        );
        let new_perm = create_permission_with_condition(
            "bash",
            false,
            PermissionScope::Project,
            new_condition,
        );

        let result = apply_merge_strategy(&existing, &new_perm, &MergeStrategy::Merge);

        assert!(!result.allowed); // New permission's value
        assert_eq!(result.conditions.len(), 2); // Both conditions combined
    }

    #[test]
    fn test_merge_strategy_union() {
        use super::super::types::{ConditionOperator, ConditionType};

        let condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Contains,
            value: json!("/path"),
            validator: None,
            description: None,
        };

        let existing = create_permission_with_condition(
            "bash",
            true,
            PermissionScope::Global,
            condition.clone(),
        );
        let new_perm =
            create_permission_with_condition("bash", false, PermissionScope::Project, condition);

        let result = apply_merge_strategy(&existing, &new_perm, &MergeStrategy::Union);

        assert!(!result.allowed); // New permission's value
        assert_eq!(result.conditions.len(), 2); // Both conditions kept (even duplicates)
    }

    #[test]
    fn test_override_global_disabled() {
        let global = vec![create_test_permission(
            "bash",
            true,
            10,
            PermissionScope::Global,
        )];
        let global2 = vec![create_test_permission(
            "bash",
            false,
            5,
            PermissionScope::Global,
        )];
        let inheritance = PermissionInheritance {
            override_global: false,
            ..Default::default()
        };

        // First merge global
        let mut result: HashMap<String, ToolPermission> = HashMap::new();
        for perm in &global {
            result.insert(perm.tool.clone(), perm.clone());
        }

        // Try to merge another global permission
        for perm in &global2 {
            merge_single_permission(&mut result, perm, &inheritance);
        }

        // Should keep the original since override_global is false
        let bash = result.get("bash").unwrap();
        assert!(bash.allowed); // Original value preserved
    }
}
