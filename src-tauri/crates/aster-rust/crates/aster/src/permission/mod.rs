// =============================================================================
// Module Declarations
// =============================================================================

// New tool permission system modules
pub mod audit;
pub mod condition;
pub mod integration;
pub mod manager;
pub mod merger;
pub mod migration;
pub mod pattern;
pub mod policy;
pub mod restriction;
pub mod templates;
pub mod types;

// Existing permission system modules (preserved for backward compatibility)
pub mod permission_confirmation;
pub mod permission_inspector;
pub mod permission_judge;
pub mod permission_store;

// =============================================================================
// New Tool Permission System Exports
// =============================================================================

// Audit logging (Requirements: 10.1, 10.2, 10.3, 10.4, 10.5)
pub use audit::{AuditLogEntry, AuditLogLevel, AuditLogger};

// Condition evaluation (Requirements: 4.1, 4.2, 4.3, 4.4, 4.5)
pub use condition::{check_conditions, evaluate_condition, get_context_field};

// Integration with existing systems (Requirements: 11.1, 11.2, 11.3, 11.4)
pub use integration::{
    create_permission, is_permission_allowed, is_permission_permanent,
    permission_level_to_permission, permission_level_to_tool_permission,
    permission_to_permission_level, permission_to_result, result_to_permission,
    IntegratedPermissionManager,
};

// Permission manager (Requirements: 1.1, 1.4, 1.5, 2.3, 2.4, 5.1, 5.2, 5.3, 5.4, 7.5, 8.1, 8.2, 9.1, 9.2)
pub use manager::{PermissionConfig, ToolPermissionManager};

// Permission merging (Requirements: 1.2, 1.3, 6.4, 6.5, 6.6)
pub use merger::{apply_merge_strategy, merge_permissions};

// Migration utilities (Requirements: 11.5)
pub use migration::{
    get_original_permission_level, is_migrated_permission, migrate_from_old_system,
    migrate_from_old_system_with_details, migrate_known_tools, migrate_permission_config,
    migrate_permission_level, MigrationResult,
};

// Pattern matching (Requirements: 2.1)
pub use pattern::{has_wildcards, match_pattern, pattern_to_regex};

// Parameter restriction validation (Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6)
pub use restriction::{check_parameter_restrictions, validate_restriction};

// Permission templates (Requirements: 7.1, 7.2, 7.3, 7.4, 7.5)
pub use templates::PermissionTemplates;

// Core types (Requirements: 1.1, 2.2, 3.1-3.5, 4.1, 5.1, 6.1-6.3, 9.1-9.3)
pub use types::{
    ConditionOperator, ConditionType, MergeStrategy, ParameterRestriction, PermissionCondition,
    PermissionContext, PermissionFilter, PermissionInheritance, PermissionResult, PermissionScope,
    PermissionStats, RestrictionType, ToolPermission, ToolPermissionUpdate,
};

// =============================================================================
// Existing Permission System Exports (Preserved for Backward Compatibility)
// =============================================================================

// Permission confirmation types
pub use permission_confirmation::{Permission, PermissionConfirmation, PrincipalType};

// Permission inspector
pub use permission_inspector::PermissionInspector;

// Permission judge utilities
pub use permission_judge::{check_tool_permissions, detect_read_only_tools, PermissionCheckResult};

// Permission store
pub use permission_store::ToolPermissionStore;

// =============================================================================
// Tool Policy System Exports (New)
// =============================================================================

// Policy types (Requirements: 1.1, 3.1)
pub use policy::{
    MergedPolicy, PolicyDecision, PolicyError, PolicyLayer, PolicyMerger, PolicyMigration,
    ProfileConfig, ProfileManager, ToolGroups, ToolPolicy, ToolPolicyManager, ToolProfile,
};
