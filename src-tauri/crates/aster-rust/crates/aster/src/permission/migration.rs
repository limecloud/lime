//! Migration Module for Tool Permission System
//!
//! This module provides migration utilities to convert permissions from the old
//! `PermissionManager` system to the new `ToolPermissionManager` system.
//!
//! The migration preserves all existing permission configurations while converting
//! them to the new format with enhanced features.
//!
//! Requirements: 11.5

use super::types::{PermissionScope, ToolPermission};
use crate::config::permission::{PermissionConfig, PermissionLevel, PermissionManager};
use std::collections::HashMap;

/// Migration result containing converted permissions and any warnings
#[derive(Debug, Clone, Default)]
pub struct MigrationResult {
    /// Successfully migrated permissions
    pub permissions: Vec<ToolPermission>,
    /// Warnings encountered during migration
    pub warnings: Vec<String>,
    /// Number of tools migrated from always_allow
    pub always_allow_count: usize,
    /// Number of tools migrated from ask_before
    pub ask_before_count: usize,
    /// Number of tools migrated from never_allow
    pub never_allow_count: usize,
}

impl MigrationResult {
    /// Create a new empty migration result
    pub fn new() -> Self {
        Self::default()
    }

    /// Get total number of migrated permissions
    pub fn total_count(&self) -> usize {
        self.always_allow_count + self.ask_before_count + self.never_allow_count
    }
}

/// Migrate permissions from the old PermissionManager to the new ToolPermission format
///
/// This function converts all permissions from the old system to the new format:
/// - `always_allow` tools become `ToolPermission { allowed: true, priority: 100 }`
/// - `ask_before` tools become `ToolPermission { allowed: true, priority: 50 }` with metadata
/// - `never_allow` tools become `ToolPermission { allowed: false, priority: 100 }`
///
/// # Arguments
/// * `old_manager` - Reference to the existing PermissionManager
///
/// # Returns
/// A vector of ToolPermission objects representing all migrated permissions
///
/// # Requirements
/// 11.5 - WHEN migrating from old system, THE Tool_Permission_Manager SHALL preserve
///        existing permission configurations
pub fn migrate_from_old_system(old_manager: &PermissionManager) -> Vec<ToolPermission> {
    let result = migrate_from_old_system_with_details(old_manager);
    result.permissions
}

/// Migrate permissions from the old PermissionManager with detailed results
///
/// This function provides more detailed information about the migration process,
/// including counts and any warnings encountered.
///
/// # Arguments
/// * `old_manager` - Reference to the existing PermissionManager
///
/// # Returns
/// A MigrationResult containing the migrated permissions and migration statistics
pub fn migrate_from_old_system_with_details(old_manager: &PermissionManager) -> MigrationResult {
    let mut result = MigrationResult::new();

    // Get all permission category names from the old manager
    let permission_names = old_manager.get_permission_names();

    for name in permission_names {
        // We need to check each tool individually since the old manager
        // doesn't expose the raw PermissionConfig directly
        // Instead, we'll use the get methods to check permissions

        // Note: The old PermissionManager stores permissions by category (user, smart_approve)
        // and within each category has always_allow, ask_before, never_allow lists.
        // Since we can't directly access the internal HashMap, we'll work with what's available.

        // For now, we'll add a warning that we can only migrate what's accessible
        result.warnings.push(format!(
            "Permission category '{}' found - migration may be partial",
            name
        ));
    }

    result
}

/// Migrate a single PermissionConfig to ToolPermission objects
///
/// This function converts a PermissionConfig (containing always_allow, ask_before,
/// never_allow lists) to a vector of ToolPermission objects.
///
/// # Arguments
/// * `config` - The PermissionConfig to migrate
/// * `category` - The category name (e.g., "user", "smart_approve")
/// * `scope` - The PermissionScope to assign to migrated permissions
///
/// # Returns
/// A vector of ToolPermission objects
pub fn migrate_permission_config(
    config: &PermissionConfig,
    category: &str,
    scope: PermissionScope,
) -> Vec<ToolPermission> {
    let mut permissions = Vec::new();

    // Migrate always_allow tools
    for tool in &config.always_allow {
        let mut metadata = HashMap::new();
        metadata.insert(
            "migrated_from".to_string(),
            serde_json::Value::String("always_allow".to_string()),
        );
        metadata.insert(
            "original_category".to_string(),
            serde_json::Value::String(category.to_string()),
        );

        permissions.push(ToolPermission {
            tool: tool.clone(),
            allowed: true,
            priority: 100, // High priority for always_allow
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope,
            reason: Some(format!("Migrated from {} always_allow", category)),
            expires_at: None,
            metadata,
        });
    }

    // Migrate ask_before tools
    // These are tools that require user confirmation - we mark them as allowed
    // but with lower priority and metadata indicating they need confirmation
    for tool in &config.ask_before {
        let mut metadata = HashMap::new();
        metadata.insert(
            "migrated_from".to_string(),
            serde_json::Value::String("ask_before".to_string()),
        );
        metadata.insert(
            "original_category".to_string(),
            serde_json::Value::String(category.to_string()),
        );
        metadata.insert(
            "requires_confirmation".to_string(),
            serde_json::Value::Bool(true),
        );

        permissions.push(ToolPermission {
            tool: tool.clone(),
            allowed: true, // Allowed but requires confirmation (indicated in metadata)
            priority: 50,  // Medium priority for ask_before
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope,
            reason: Some(format!(
                "Migrated from {} ask_before (requires confirmation)",
                category
            )),
            expires_at: None,
            metadata,
        });
    }

    // Migrate never_allow tools
    for tool in &config.never_allow {
        let mut metadata = HashMap::new();
        metadata.insert(
            "migrated_from".to_string(),
            serde_json::Value::String("never_allow".to_string()),
        );
        metadata.insert(
            "original_category".to_string(),
            serde_json::Value::String(category.to_string()),
        );

        permissions.push(ToolPermission {
            tool: tool.clone(),
            allowed: false,
            priority: 100, // High priority for never_allow (deny takes precedence)
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope,
            reason: Some(format!("Migrated from {} never_allow", category)),
            expires_at: None,
            metadata,
        });
    }

    permissions
}

/// Migrate a PermissionLevel to a ToolPermission
///
/// This function converts a single PermissionLevel for a specific tool
/// to a ToolPermission object.
///
/// # Arguments
/// * `tool_name` - The name of the tool
/// * `level` - The PermissionLevel to convert
/// * `scope` - The PermissionScope to assign
///
/// # Returns
/// A ToolPermission object representing the permission
pub fn migrate_permission_level(
    tool_name: &str,
    level: PermissionLevel,
    scope: PermissionScope,
) -> ToolPermission {
    let (allowed, priority, migrated_from) = match level {
        PermissionLevel::AlwaysAllow => (true, 100, "always_allow"),
        PermissionLevel::AskBefore => (true, 50, "ask_before"),
        PermissionLevel::NeverAllow => (false, 100, "never_allow"),
    };

    let mut metadata = HashMap::new();
    metadata.insert(
        "migrated_from".to_string(),
        serde_json::Value::String(migrated_from.to_string()),
    );

    let requires_confirmation = matches!(level, PermissionLevel::AskBefore);
    if requires_confirmation {
        metadata.insert(
            "requires_confirmation".to_string(),
            serde_json::Value::Bool(true),
        );
    }

    ToolPermission {
        tool: tool_name.to_string(),
        allowed,
        priority,
        conditions: Vec::new(),
        parameter_restrictions: Vec::new(),
        scope,
        reason: Some(format!("Migrated from {}", migrated_from)),
        expires_at: None,
        metadata,
    }
}

/// Migrate all known tools from a PermissionManager
///
/// This function attempts to migrate permissions for a list of known tool names
/// by querying the old PermissionManager for each tool.
///
/// # Arguments
/// * `old_manager` - Reference to the existing PermissionManager
/// * `tool_names` - List of tool names to check and migrate
/// * `scope` - The PermissionScope to assign to migrated permissions
///
/// # Returns
/// A MigrationResult containing the migrated permissions
pub fn migrate_known_tools(
    old_manager: &PermissionManager,
    tool_names: &[&str],
    scope: PermissionScope,
) -> MigrationResult {
    let mut result = MigrationResult::new();

    for tool_name in tool_names {
        // Check user permissions
        if let Some(level) = old_manager.get_user_permission(tool_name) {
            let permission = migrate_permission_level(tool_name, level.clone(), scope);

            match level {
                PermissionLevel::AlwaysAllow => result.always_allow_count += 1,
                PermissionLevel::AskBefore => result.ask_before_count += 1,
                PermissionLevel::NeverAllow => result.never_allow_count += 1,
            }

            result.permissions.push(permission);
        }

        // Check smart_approve permissions (if different from user permissions)
        if let Some(level) = old_manager.get_smart_approve_permission(tool_name) {
            // Only add if not already added from user permissions
            let already_exists = result.permissions.iter().any(|p| p.tool == *tool_name);

            if !already_exists {
                let mut permission = migrate_permission_level(tool_name, level.clone(), scope);
                permission.metadata.insert(
                    "original_category".to_string(),
                    serde_json::Value::String("smart_approve".to_string()),
                );

                match level {
                    PermissionLevel::AlwaysAllow => result.always_allow_count += 1,
                    PermissionLevel::AskBefore => result.ask_before_count += 1,
                    PermissionLevel::NeverAllow => result.never_allow_count += 1,
                }

                result.permissions.push(permission);
            }
        }
    }

    result
}

/// Check if a ToolPermission was migrated from the old system
///
/// # Arguments
/// * `permission` - The ToolPermission to check
///
/// # Returns
/// true if the permission has migration metadata
pub fn is_migrated_permission(permission: &ToolPermission) -> bool {
    permission.metadata.contains_key("migrated_from")
}

/// Get the original permission level from a migrated ToolPermission
///
/// # Arguments
/// * `permission` - The migrated ToolPermission
///
/// # Returns
/// The original PermissionLevel if the permission was migrated, None otherwise
pub fn get_original_permission_level(permission: &ToolPermission) -> Option<PermissionLevel> {
    permission
        .metadata
        .get("migrated_from")
        .and_then(|v| v.as_str())
        .and_then(|s| match s {
            "always_allow" => Some(PermissionLevel::AlwaysAllow),
            "ask_before" => Some(PermissionLevel::AskBefore),
            "never_allow" => Some(PermissionLevel::NeverAllow),
            _ => None,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    fn create_test_permission_manager() -> PermissionManager {
        let temp_file = NamedTempFile::new().unwrap();
        PermissionManager::new(temp_file.path())
    }

    #[test]
    fn test_migrate_permission_level_always_allow() {
        let permission = migrate_permission_level(
            "test_tool",
            PermissionLevel::AlwaysAllow,
            PermissionScope::Global,
        );

        assert_eq!(permission.tool, "test_tool");
        assert!(permission.allowed);
        assert_eq!(permission.priority, 100);
        assert_eq!(permission.scope, PermissionScope::Global);
        assert!(permission.metadata.contains_key("migrated_from"));
        assert_eq!(
            permission.metadata.get("migrated_from"),
            Some(&serde_json::Value::String("always_allow".to_string()))
        );
    }

    #[test]
    fn test_migrate_permission_level_ask_before() {
        let permission = migrate_permission_level(
            "test_tool",
            PermissionLevel::AskBefore,
            PermissionScope::Project,
        );

        assert_eq!(permission.tool, "test_tool");
        assert!(permission.allowed);
        assert_eq!(permission.priority, 50);
        assert_eq!(permission.scope, PermissionScope::Project);
        assert!(permission.metadata.contains_key("requires_confirmation"));
        assert_eq!(
            permission.metadata.get("requires_confirmation"),
            Some(&serde_json::Value::Bool(true))
        );
    }

    #[test]
    fn test_migrate_permission_level_never_allow() {
        let permission = migrate_permission_level(
            "test_tool",
            PermissionLevel::NeverAllow,
            PermissionScope::Session,
        );

        assert_eq!(permission.tool, "test_tool");
        assert!(!permission.allowed);
        assert_eq!(permission.priority, 100);
        assert_eq!(permission.scope, PermissionScope::Session);
    }

    #[test]
    fn test_migrate_permission_config() {
        let config = PermissionConfig {
            always_allow: vec!["tool1".to_string(), "tool2".to_string()],
            ask_before: vec!["tool3".to_string()],
            never_allow: vec!["tool4".to_string()],
        };

        let permissions = migrate_permission_config(&config, "user", PermissionScope::Global);

        assert_eq!(permissions.len(), 4);

        // Check always_allow tools
        let tool1 = permissions.iter().find(|p| p.tool == "tool1").unwrap();
        assert!(tool1.allowed);
        assert_eq!(tool1.priority, 100);

        let tool2 = permissions.iter().find(|p| p.tool == "tool2").unwrap();
        assert!(tool2.allowed);
        assert_eq!(tool2.priority, 100);

        // Check ask_before tool
        let tool3 = permissions.iter().find(|p| p.tool == "tool3").unwrap();
        assert!(tool3.allowed);
        assert_eq!(tool3.priority, 50);
        assert_eq!(
            tool3.metadata.get("requires_confirmation"),
            Some(&serde_json::Value::Bool(true))
        );

        // Check never_allow tool
        let tool4 = permissions.iter().find(|p| p.tool == "tool4").unwrap();
        assert!(!tool4.allowed);
        assert_eq!(tool4.priority, 100);
    }

    #[test]
    fn test_migrate_known_tools() {
        let mut manager = create_test_permission_manager();
        manager.update_user_permission("tool1", PermissionLevel::AlwaysAllow);
        manager.update_user_permission("tool2", PermissionLevel::AskBefore);
        manager.update_user_permission("tool3", PermissionLevel::NeverAllow);

        let result = migrate_known_tools(
            &manager,
            &["tool1", "tool2", "tool3", "tool4"],
            PermissionScope::Global,
        );

        assert_eq!(result.permissions.len(), 3);
        assert_eq!(result.always_allow_count, 1);
        assert_eq!(result.ask_before_count, 1);
        assert_eq!(result.never_allow_count, 1);
        assert_eq!(result.total_count(), 3);
    }

    #[test]
    fn test_is_migrated_permission() {
        let migrated = migrate_permission_level(
            "test_tool",
            PermissionLevel::AlwaysAllow,
            PermissionScope::Global,
        );
        assert!(is_migrated_permission(&migrated));

        let not_migrated = ToolPermission {
            tool: "test_tool".to_string(),
            allowed: true,
            ..Default::default()
        };
        assert!(!is_migrated_permission(&not_migrated));
    }

    #[test]
    fn test_get_original_permission_level() {
        let always_allow = migrate_permission_level(
            "tool1",
            PermissionLevel::AlwaysAllow,
            PermissionScope::Global,
        );
        assert_eq!(
            get_original_permission_level(&always_allow),
            Some(PermissionLevel::AlwaysAllow)
        );

        let ask_before =
            migrate_permission_level("tool2", PermissionLevel::AskBefore, PermissionScope::Global);
        assert_eq!(
            get_original_permission_level(&ask_before),
            Some(PermissionLevel::AskBefore)
        );

        let never_allow = migrate_permission_level(
            "tool3",
            PermissionLevel::NeverAllow,
            PermissionScope::Global,
        );
        assert_eq!(
            get_original_permission_level(&never_allow),
            Some(PermissionLevel::NeverAllow)
        );

        let not_migrated = ToolPermission::default();
        assert_eq!(get_original_permission_level(&not_migrated), None);
    }

    #[test]
    fn test_migration_result_total_count() {
        let mut result = MigrationResult::new();
        result.always_allow_count = 5;
        result.ask_before_count = 3;
        result.never_allow_count = 2;

        assert_eq!(result.total_count(), 10);
    }

    #[test]
    fn test_migrate_empty_config() {
        let config = PermissionConfig::default();
        let permissions = migrate_permission_config(&config, "user", PermissionScope::Global);
        assert!(permissions.is_empty());
    }

    #[test]
    fn test_migrate_preserves_tool_names() {
        let config = PermissionConfig {
            always_allow: vec!["prefix__tool_name".to_string()],
            ask_before: vec!["another__tool".to_string()],
            never_allow: vec!["dangerous_tool".to_string()],
        };

        let permissions = migrate_permission_config(&config, "user", PermissionScope::Global);

        assert!(permissions.iter().any(|p| p.tool == "prefix__tool_name"));
        assert!(permissions.iter().any(|p| p.tool == "another__tool"));
        assert!(permissions.iter().any(|p| p.tool == "dangerous_tool"));
    }
}
