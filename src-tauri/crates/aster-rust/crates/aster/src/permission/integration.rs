//! Integration Module for Tool Permission System
//!
//! This module provides integration between the new `ToolPermissionManager` and
//! the existing permission infrastructure in Aster.
//!
//! Features:
//! - Integration with existing `PermissionManager` for user-defined permissions
//! - Integration with existing `ToolPermissionStore` for permission persistence
//! - Support for existing `Permission` enum (AlwaysAllow, AllowOnce, Cancel, DenyOnce)
//! - Backward-compatible integration with tool_execution module
//!
//! Requirements: 11.1, 11.2, 11.3, 11.4, 11.5

use super::manager::ToolPermissionManager;
use super::permission_confirmation::Permission;
use super::permission_store::ToolPermissionStore;
use super::types::{PermissionContext, PermissionResult, PermissionScope, ToolPermission};
use crate::config::permission::PermissionLevel;
use crate::config::PermissionManager;
use crate::conversation::message::ToolRequest;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Integrated Permission Manager
///
/// Combines the new `ToolPermissionManager` with the existing `PermissionManager`
/// and `ToolPermissionStore` to provide a unified permission checking interface.
///
/// Requirements: 11.1, 11.2
pub struct IntegratedPermissionManager {
    /// The new tool permission manager with advanced features
    tool_permission_manager: ToolPermissionManager,
    /// Reference to the existing permission manager for user-defined permissions
    legacy_permission_manager: Option<Arc<Mutex<PermissionManager>>>,
    /// Reference to the existing tool permission store for persistence
    legacy_permission_store: Option<Arc<Mutex<ToolPermissionStore>>>,
    /// Whether to check legacy systems first
    check_legacy_first: bool,
}

impl IntegratedPermissionManager {
    /// Create a new IntegratedPermissionManager
    ///
    /// # Arguments
    /// * `config_dir` - Optional configuration directory for the new permission system
    ///
    /// # Returns
    /// A new IntegratedPermissionManager instance
    ///
    /// Requirements: 11.1
    pub fn new(config_dir: Option<PathBuf>) -> Self {
        Self {
            tool_permission_manager: ToolPermissionManager::new(config_dir),
            legacy_permission_manager: None,
            legacy_permission_store: None,
            check_legacy_first: true,
        }
    }

    /// Create with existing PermissionManager
    ///
    /// # Arguments
    /// * `config_dir` - Optional configuration directory
    /// * `legacy_manager` - Reference to existing PermissionManager
    ///
    /// Requirements: 11.1
    pub fn with_legacy_manager(
        config_dir: Option<PathBuf>,
        legacy_manager: Arc<Mutex<PermissionManager>>,
    ) -> Self {
        Self {
            tool_permission_manager: ToolPermissionManager::new(config_dir),
            legacy_permission_manager: Some(legacy_manager),
            legacy_permission_store: None,
            check_legacy_first: true,
        }
    }

    /// Create with existing PermissionManager and ToolPermissionStore
    ///
    /// # Arguments
    /// * `config_dir` - Optional configuration directory
    /// * `legacy_manager` - Reference to existing PermissionManager
    /// * `legacy_store` - Reference to existing ToolPermissionStore
    ///
    /// Requirements: 11.1, 11.2
    pub fn with_legacy_systems(
        config_dir: Option<PathBuf>,
        legacy_manager: Arc<Mutex<PermissionManager>>,
        legacy_store: Arc<Mutex<ToolPermissionStore>>,
    ) -> Self {
        Self {
            tool_permission_manager: ToolPermissionManager::new(config_dir),
            legacy_permission_manager: Some(legacy_manager),
            legacy_permission_store: Some(legacy_store),
            check_legacy_first: true,
        }
    }

    /// Set whether to check legacy systems first
    ///
    /// When true (default), the legacy PermissionManager is checked before
    /// the new ToolPermissionManager. This ensures backward compatibility.
    pub fn set_check_legacy_first(&mut self, check_first: bool) {
        self.check_legacy_first = check_first;
    }

    /// Get a reference to the underlying ToolPermissionManager
    pub fn tool_permission_manager(&self) -> &ToolPermissionManager {
        &self.tool_permission_manager
    }

    /// Get a mutable reference to the underlying ToolPermissionManager
    pub fn tool_permission_manager_mut(&mut self) -> &mut ToolPermissionManager {
        &mut self.tool_permission_manager
    }

    /// Check if a tool is allowed to execute
    ///
    /// This method integrates both the legacy and new permission systems:
    /// 1. If check_legacy_first is true, check the legacy PermissionManager first
    /// 2. If legacy returns a definitive answer (AlwaysAllow or NeverAllow), use it
    /// 3. Otherwise, fall back to the new ToolPermissionManager
    ///
    /// # Arguments
    /// * `tool` - The tool name to check
    /// * `params` - The tool parameters
    /// * `context` - The permission context
    ///
    /// # Returns
    /// A PermissionResult containing the decision and details
    ///
    /// Requirements: 11.1
    pub async fn is_allowed(
        &self,
        tool: &str,
        params: &HashMap<String, Value>,
        context: &PermissionContext,
    ) -> PermissionResult {
        // Check legacy system first if configured
        if self.check_legacy_first {
            if let Some(legacy_result) = self.check_legacy_permission(tool).await {
                return legacy_result;
            }
        }

        // Fall back to new permission system
        self.tool_permission_manager
            .is_allowed(tool, params, context)
    }

    /// Check permission using the legacy PermissionManager
    ///
    /// # Arguments
    /// * `tool` - The tool name to check
    ///
    /// # Returns
    /// Some(PermissionResult) if the legacy system has a definitive answer,
    /// None if the new system should be consulted
    ///
    /// Requirements: 11.1
    async fn check_legacy_permission(&self, tool: &str) -> Option<PermissionResult> {
        let legacy_manager = self.legacy_permission_manager.as_ref()?;
        let manager = legacy_manager.lock().await;

        // Check user-defined permission
        if let Some(level) = manager.get_user_permission(tool) {
            return Some(Self::permission_level_to_result(level, tool, "user"));
        }

        // Check smart approve permission
        if let Some(level) = manager.get_smart_approve_permission(tool) {
            return Some(Self::permission_level_to_result(
                level,
                tool,
                "smart_approve",
            ));
        }

        None
    }

    /// Convert PermissionLevel to PermissionResult
    ///
    /// # Arguments
    /// * `level` - The permission level from the legacy system
    /// * `tool` - The tool name
    /// * `source` - The source of the permission (e.g., "user", "smart_approve")
    ///
    /// # Returns
    /// A PermissionResult based on the permission level
    fn permission_level_to_result(
        level: PermissionLevel,
        tool: &str,
        source: &str,
    ) -> PermissionResult {
        match level {
            PermissionLevel::AlwaysAllow => PermissionResult {
                allowed: true,
                reason: Some(format!(
                    "Tool '{}' is always allowed by {} permission",
                    tool, source
                )),
                restricted: false,
                suggestions: Vec::new(),
                matched_rule: None,
                violations: Vec::new(),
            },
            PermissionLevel::NeverAllow => PermissionResult {
                allowed: false,
                reason: Some(format!(
                    "Tool '{}' is never allowed by {} permission",
                    tool, source
                )),
                restricted: false,
                suggestions: vec![
                    "This tool is blocked by user configuration.".to_string(),
                    "Update permission settings to allow this tool.".to_string(),
                ],
                matched_rule: None,
                violations: Vec::new(),
            },
            PermissionLevel::AskBefore => PermissionResult {
                allowed: false,
                reason: Some(format!(
                    "Tool '{}' requires approval by {} permission",
                    tool, source
                )),
                restricted: false,
                suggestions: vec!["This tool requires user approval before execution.".to_string()],
                matched_rule: None,
                violations: Vec::new(),
            },
        }
    }

    /// Check permission for a tool request using the legacy store
    ///
    /// # Arguments
    /// * `tool_request` - The tool request to check
    ///
    /// # Returns
    /// Some(bool) if the legacy store has a cached decision, None otherwise
    ///
    /// Requirements: 11.2
    pub async fn check_legacy_store(&self, tool_request: &ToolRequest) -> Option<bool> {
        let legacy_store = self.legacy_permission_store.as_ref()?;
        let store = legacy_store.lock().await;
        store.check_permission(tool_request)
    }

    /// Record a permission decision in the legacy store
    ///
    /// # Arguments
    /// * `tool_request` - The tool request
    /// * `allowed` - Whether the tool was allowed
    /// * `expiry_duration` - Optional expiry duration
    ///
    /// Requirements: 11.2
    pub async fn record_legacy_permission(
        &self,
        tool_request: &ToolRequest,
        allowed: bool,
        expiry_duration: Option<std::time::Duration>,
    ) -> anyhow::Result<()> {
        if let Some(legacy_store) = &self.legacy_permission_store {
            let mut store = legacy_store.lock().await;
            store.record_permission(tool_request, allowed, expiry_duration)?;
        }
        Ok(())
    }

    /// Check permission using both legacy store and new system
    ///
    /// This method provides a comprehensive permission check that:
    /// 1. Checks the legacy ToolPermissionStore for cached decisions
    /// 2. Falls back to the legacy PermissionManager
    /// 3. Finally checks the new ToolPermissionManager
    ///
    /// # Arguments
    /// * `tool` - The tool name
    /// * `tool_request` - Optional tool request for store lookup
    /// * `params` - The tool parameters
    /// * `context` - The permission context
    ///
    /// # Returns
    /// A PermissionResult containing the decision and details
    ///
    /// Requirements: 11.1, 11.2
    pub async fn check_permission_comprehensive(
        &self,
        tool: &str,
        tool_request: Option<&ToolRequest>,
        params: &HashMap<String, Value>,
        context: &PermissionContext,
    ) -> PermissionResult {
        // 1. Check legacy store first if we have a tool request
        if let Some(request) = tool_request {
            if let Some(allowed) = self.check_legacy_store(request).await {
                return PermissionResult {
                    allowed,
                    reason: Some(format!(
                        "Tool '{}' {} by cached permission",
                        tool,
                        if allowed { "allowed" } else { "denied" }
                    )),
                    restricted: false,
                    suggestions: Vec::new(),
                    matched_rule: None,
                    violations: Vec::new(),
                };
            }
        }

        // 2. Check legacy PermissionManager
        if self.check_legacy_first {
            if let Some(legacy_result) = self.check_legacy_permission(tool).await {
                return legacy_result;
            }
        }

        // 3. Fall back to new permission system
        self.tool_permission_manager
            .is_allowed(tool, params, context)
    }

    /// Sync permissions from legacy store to new system
    ///
    /// This method is useful for migration scenarios where you want to
    /// import existing cached permissions into the new system.
    ///
    /// Note: This is a one-way sync and doesn't modify the legacy store.
    ///
    /// Requirements: 11.2, 11.5
    pub fn set_legacy_store(&mut self, store: Arc<Mutex<ToolPermissionStore>>) {
        self.legacy_permission_store = Some(store);
    }

    /// Set the legacy permission manager
    ///
    /// Requirements: 11.1
    pub fn set_legacy_manager(&mut self, manager: Arc<Mutex<PermissionManager>>) {
        self.legacy_permission_manager = Some(manager);
    }

    /// Check if legacy systems are configured
    pub fn has_legacy_systems(&self) -> bool {
        self.legacy_permission_manager.is_some() || self.legacy_permission_store.is_some()
    }

    /// Get reference to legacy permission manager if set
    pub fn legacy_permission_manager(&self) -> Option<&Arc<Mutex<PermissionManager>>> {
        self.legacy_permission_manager.as_ref()
    }

    /// Get reference to legacy permission store if set
    pub fn legacy_permission_store(&self) -> Option<&Arc<Mutex<ToolPermissionStore>>> {
        self.legacy_permission_store.as_ref()
    }
}

impl Default for IntegratedPermissionManager {
    fn default() -> Self {
        Self::new(None)
    }
}

// ============================================================================
// Permission Enum Conversion
// ============================================================================

/// Convert the existing Permission enum to a PermissionResult
///
/// This function provides compatibility with the existing Permission enum
/// (AlwaysAllow, AllowOnce, Cancel, DenyOnce) used in the tool_execution module.
///
/// # Arguments
/// * `permission` - The existing Permission enum value
/// * `tool` - The tool name for context
///
/// # Returns
/// A PermissionResult that represents the same decision
///
/// Requirements: 11.3
pub fn permission_to_result(permission: &Permission, tool: &str) -> PermissionResult {
    match permission {
        Permission::AlwaysAllow => PermissionResult {
            allowed: true,
            reason: Some(format!("Tool '{}' is always allowed", tool)),
            restricted: false,
            suggestions: Vec::new(),
            matched_rule: None,
            violations: Vec::new(),
        },
        Permission::AllowOnce => PermissionResult {
            allowed: true,
            reason: Some(format!("Tool '{}' is allowed for this execution", tool)),
            restricted: false,
            suggestions: Vec::new(),
            matched_rule: None,
            violations: Vec::new(),
        },
        Permission::Cancel => PermissionResult {
            allowed: false,
            reason: Some(format!("Tool '{}' execution was cancelled", tool)),
            restricted: false,
            suggestions: vec![
                "The user cancelled this tool execution.".to_string(),
                "Try a different approach or ask for clarification.".to_string(),
            ],
            matched_rule: None,
            violations: Vec::new(),
        },
        Permission::DenyOnce => PermissionResult {
            allowed: false,
            reason: Some(format!("Tool '{}' is denied for this execution", tool)),
            restricted: false,
            suggestions: vec![
                "The user denied this specific tool execution.".to_string(),
                "You may try again with different parameters.".to_string(),
            ],
            matched_rule: None,
            violations: Vec::new(),
        },
    }
}

/// Convert a PermissionResult to the existing Permission enum
///
/// This function provides reverse compatibility, converting the new
/// PermissionResult back to the existing Permission enum.
///
/// # Arguments
/// * `result` - The PermissionResult to convert
/// * `is_permanent` - Whether the decision should be permanent (AlwaysAllow vs AllowOnce)
///
/// # Returns
/// The corresponding Permission enum value
///
/// Requirements: 11.3
pub fn result_to_permission(result: &PermissionResult, is_permanent: bool) -> Permission {
    if result.allowed {
        if is_permanent {
            Permission::AlwaysAllow
        } else {
            Permission::AllowOnce
        }
    } else {
        // For denials, we use DenyOnce as the default
        // Cancel is typically used for user-initiated cancellation
        Permission::DenyOnce
    }
}

/// Convert PermissionLevel to Permission enum
///
/// # Arguments
/// * `level` - The PermissionLevel from the config system
///
/// # Returns
/// The corresponding Permission enum value
///
/// Requirements: 11.3
pub fn permission_level_to_permission(level: PermissionLevel) -> Permission {
    match level {
        PermissionLevel::AlwaysAllow => Permission::AlwaysAllow,
        PermissionLevel::AskBefore => Permission::DenyOnce, // Requires approval
        PermissionLevel::NeverAllow => Permission::DenyOnce,
    }
}

/// Convert Permission enum to PermissionLevel
///
/// # Arguments
/// * `permission` - The Permission enum value
///
/// # Returns
/// The corresponding PermissionLevel
///
/// Requirements: 11.3
pub fn permission_to_permission_level(permission: &Permission) -> PermissionLevel {
    match permission {
        Permission::AlwaysAllow => PermissionLevel::AlwaysAllow,
        Permission::AllowOnce => PermissionLevel::AskBefore, // One-time allow still needs asking next time
        Permission::Cancel | Permission::DenyOnce => PermissionLevel::AskBefore, // Denials don't persist as NeverAllow
    }
}

/// Check if a Permission represents an allowed action
///
/// # Arguments
/// * `permission` - The Permission enum value
///
/// # Returns
/// true if the permission allows the action
///
/// Requirements: 11.3
pub fn is_permission_allowed(permission: &Permission) -> bool {
    matches!(permission, Permission::AlwaysAllow | Permission::AllowOnce)
}

/// Check if a Permission is permanent (affects future executions)
///
/// # Arguments
/// * `permission` - The Permission enum value
///
/// # Returns
/// true if the permission is permanent
///
/// Requirements: 11.3
pub fn is_permission_permanent(permission: &Permission) -> bool {
    matches!(permission, Permission::AlwaysAllow)
}

/// Create a Permission from an allowed flag and permanence
///
/// # Arguments
/// * `allowed` - Whether the action is allowed
/// * `permanent` - Whether the decision is permanent
///
/// # Returns
/// The corresponding Permission enum value
///
/// Requirements: 11.3
pub fn create_permission(allowed: bool, permanent: bool) -> Permission {
    match (allowed, permanent) {
        (true, true) => Permission::AlwaysAllow,
        (true, false) => Permission::AllowOnce,
        (false, _) => Permission::DenyOnce,
    }
}

// ============================================================================
// ToolPermission Conversion
// ============================================================================

/// Convert a PermissionLevel to a ToolPermission
///
/// Creates a new ToolPermission based on the legacy PermissionLevel.
///
/// # Arguments
/// * `tool` - The tool name
/// * `level` - The permission level
/// * `scope` - The scope for the new permission
///
/// # Returns
/// A ToolPermission representing the same permission
///
/// Requirements: 11.5
pub fn permission_level_to_tool_permission(
    tool: &str,
    level: PermissionLevel,
    scope: PermissionScope,
) -> ToolPermission {
    let (allowed, reason) = match level {
        PermissionLevel::AlwaysAllow => {
            (true, Some("Migrated from legacy: AlwaysAllow".to_string()))
        }
        PermissionLevel::AskBefore => (
            false,
            Some("Migrated from legacy: AskBefore (requires approval)".to_string()),
        ),
        PermissionLevel::NeverAllow => {
            (false, Some("Migrated from legacy: NeverAllow".to_string()))
        }
    };

    ToolPermission {
        tool: tool.to_string(),
        allowed,
        priority: 0,
        conditions: Vec::new(),
        parameter_restrictions: Vec::new(),
        scope,
        reason,
        expires_at: None,
        metadata: HashMap::new(),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_to_result_always_allow() {
        let result = permission_to_result(&Permission::AlwaysAllow, "test_tool");
        assert!(result.allowed);
        assert!(result.reason.is_some());
    }

    #[test]
    fn test_permission_to_result_allow_once() {
        let result = permission_to_result(&Permission::AllowOnce, "test_tool");
        assert!(result.allowed);
    }

    #[test]
    fn test_permission_to_result_cancel() {
        let result = permission_to_result(&Permission::Cancel, "test_tool");
        assert!(!result.allowed);
        assert!(!result.suggestions.is_empty());
    }

    #[test]
    fn test_permission_to_result_deny_once() {
        let result = permission_to_result(&Permission::DenyOnce, "test_tool");
        assert!(!result.allowed);
    }

    #[test]
    fn test_result_to_permission_allowed_permanent() {
        let result = PermissionResult {
            allowed: true,
            reason: None,
            restricted: false,
            suggestions: Vec::new(),
            matched_rule: None,
            violations: Vec::new(),
        };
        assert_eq!(result_to_permission(&result, true), Permission::AlwaysAllow);
    }

    #[test]
    fn test_result_to_permission_allowed_temporary() {
        let result = PermissionResult {
            allowed: true,
            reason: None,
            restricted: false,
            suggestions: Vec::new(),
            matched_rule: None,
            violations: Vec::new(),
        };
        assert_eq!(result_to_permission(&result, false), Permission::AllowOnce);
    }

    #[test]
    fn test_result_to_permission_denied() {
        let result = PermissionResult {
            allowed: false,
            reason: None,
            restricted: false,
            suggestions: Vec::new(),
            matched_rule: None,
            violations: Vec::new(),
        };
        assert_eq!(result_to_permission(&result, false), Permission::DenyOnce);
    }

    #[test]
    fn test_permission_level_to_permission() {
        assert_eq!(
            permission_level_to_permission(PermissionLevel::AlwaysAllow),
            Permission::AlwaysAllow
        );
        assert_eq!(
            permission_level_to_permission(PermissionLevel::AskBefore),
            Permission::DenyOnce
        );
        assert_eq!(
            permission_level_to_permission(PermissionLevel::NeverAllow),
            Permission::DenyOnce
        );
    }

    #[test]
    fn test_permission_to_permission_level() {
        assert_eq!(
            permission_to_permission_level(&Permission::AlwaysAllow),
            PermissionLevel::AlwaysAllow
        );
        assert_eq!(
            permission_to_permission_level(&Permission::AllowOnce),
            PermissionLevel::AskBefore
        );
        assert_eq!(
            permission_to_permission_level(&Permission::Cancel),
            PermissionLevel::AskBefore
        );
        assert_eq!(
            permission_to_permission_level(&Permission::DenyOnce),
            PermissionLevel::AskBefore
        );
    }

    #[test]
    fn test_is_permission_allowed() {
        assert!(is_permission_allowed(&Permission::AlwaysAllow));
        assert!(is_permission_allowed(&Permission::AllowOnce));
        assert!(!is_permission_allowed(&Permission::Cancel));
        assert!(!is_permission_allowed(&Permission::DenyOnce));
    }

    #[test]
    fn test_is_permission_permanent() {
        assert!(is_permission_permanent(&Permission::AlwaysAllow));
        assert!(!is_permission_permanent(&Permission::AllowOnce));
        assert!(!is_permission_permanent(&Permission::Cancel));
        assert!(!is_permission_permanent(&Permission::DenyOnce));
    }

    #[test]
    fn test_create_permission() {
        assert_eq!(create_permission(true, true), Permission::AlwaysAllow);
        assert_eq!(create_permission(true, false), Permission::AllowOnce);
        assert_eq!(create_permission(false, true), Permission::DenyOnce);
        assert_eq!(create_permission(false, false), Permission::DenyOnce);
    }

    #[test]
    fn test_permission_level_to_tool_permission() {
        let perm = permission_level_to_tool_permission(
            "test_tool",
            PermissionLevel::AlwaysAllow,
            PermissionScope::Global,
        );
        assert_eq!(perm.tool, "test_tool");
        assert!(perm.allowed);
        assert_eq!(perm.scope, PermissionScope::Global);

        let perm = permission_level_to_tool_permission(
            "test_tool",
            PermissionLevel::NeverAllow,
            PermissionScope::Project,
        );
        assert!(!perm.allowed);
        assert_eq!(perm.scope, PermissionScope::Project);
    }

    #[test]
    fn test_integrated_permission_manager_default() {
        let manager = IntegratedPermissionManager::default();
        assert!(manager.legacy_permission_manager.is_none());
        assert!(manager.legacy_permission_store.is_none());
        assert!(manager.check_legacy_first);
    }

    #[test]
    fn test_permission_level_to_result() {
        let result = IntegratedPermissionManager::permission_level_to_result(
            PermissionLevel::AlwaysAllow,
            "test_tool",
            "user",
        );
        assert!(result.allowed);

        let result = IntegratedPermissionManager::permission_level_to_result(
            PermissionLevel::NeverAllow,
            "test_tool",
            "user",
        );
        assert!(!result.allowed);

        let result = IntegratedPermissionManager::permission_level_to_result(
            PermissionLevel::AskBefore,
            "test_tool",
            "user",
        );
        assert!(!result.allowed);
    }
}
