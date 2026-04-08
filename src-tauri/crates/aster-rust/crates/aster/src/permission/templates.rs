//! Permission Templates Module
//!
//! This module provides pre-defined permission templates for common use cases.
//! Templates can be applied to quickly configure permission rules.
//!
//! Available templates:
//! - `read_only`: Allows only read operations
//! - `safe`: Blocks dangerous commands
//! - `project_only`: Restricts operations to project directory
//! - `time_restricted`: Limits tool usage to specific hours
//!
//! Requirements: 7.1, 7.2, 7.3, 7.4, 7.5

use super::types::{
    ConditionOperator, ConditionType, ParameterRestriction, PermissionCondition, PermissionScope,
    RestrictionType, ToolPermission,
};
use std::collections::HashMap;
use std::path::Path;

/// Permission Templates
///
/// Provides factory methods for creating pre-defined permission configurations.
pub struct PermissionTemplates;

impl PermissionTemplates {
    /// Read-only mode template
    ///
    /// Creates permissions that allow only read operations.
    /// Blocks all write, delete, and execute operations.
    ///
    /// # Returns
    /// A vector of permissions that:
    /// - Allow file_read, file_list, file_search tools
    /// - Deny file_write, file_delete, file_create tools
    /// - Deny bash and shell execution tools
    ///
    /// Requirements: 7.1
    pub fn read_only() -> Vec<ToolPermission> {
        vec![
            // Allow read operations
            ToolPermission {
                tool: "file_read".to_string(),
                allowed: true,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some("Read-only mode: file reading allowed".to_string()),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("read_only"))]),
            },
            ToolPermission {
                tool: "file_list".to_string(),
                allowed: true,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some("Read-only mode: directory listing allowed".to_string()),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("read_only"))]),
            },
            ToolPermission {
                tool: "file_search".to_string(),
                allowed: true,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some("Read-only mode: file search allowed".to_string()),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("read_only"))]),
            },
            // Deny write operations
            ToolPermission {
                tool: "file_write".to_string(),
                allowed: false,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some("Read-only mode: file writing denied".to_string()),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("read_only"))]),
            },
            ToolPermission {
                tool: "file_delete".to_string(),
                allowed: false,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some("Read-only mode: file deletion denied".to_string()),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("read_only"))]),
            },
            ToolPermission {
                tool: "file_create".to_string(),
                allowed: false,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some("Read-only mode: file creation denied".to_string()),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("read_only"))]),
            },
            // Deny execution tools
            ToolPermission {
                tool: "bash".to_string(),
                allowed: false,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some("Read-only mode: bash execution denied".to_string()),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("read_only"))]),
            },
            ToolPermission {
                tool: "shell_*".to_string(),
                allowed: false,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some("Read-only mode: shell execution denied".to_string()),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("read_only"))]),
            },
        ]
    }

    /// Safe mode template
    ///
    /// Creates permissions that block dangerous commands while allowing safe operations.
    /// Uses parameter restrictions to block specific dangerous patterns.
    ///
    /// # Returns
    /// A vector of permissions that:
    /// - Allow bash with blacklisted dangerous commands
    /// - Block sudo, rm -rf, chmod 777, and other dangerous patterns
    ///
    /// Requirements: 7.2
    pub fn safe() -> Vec<ToolPermission> {
        vec![
            // Allow bash with restrictions
            ToolPermission {
                tool: "bash".to_string(),
                allowed: true,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: vec![
                    ParameterRestriction {
                        parameter: "command".to_string(),
                        restriction_type: RestrictionType::Blacklist,
                        values: Some(vec![
                            serde_json::json!("rm -rf /"),
                            serde_json::json!("rm -rf /*"),
                            serde_json::json!("sudo rm -rf"),
                            serde_json::json!(":(){:|:&};:"), // Fork bomb
                            serde_json::json!("mkfs"),
                            serde_json::json!("dd if=/dev/zero"),
                            serde_json::json!("> /dev/sda"),
                        ]),
                        pattern: None,
                        validator: None,
                        min: None,
                        max: None,
                        required: false,
                        description: Some("Block dangerous shell commands".to_string()),
                    },
                    ParameterRestriction {
                        parameter: "command".to_string(),
                        restriction_type: RestrictionType::Pattern,
                        values: None,
                        // Block commands starting with sudo
                        pattern: Some(r"^(?!sudo\s).*$".to_string()),
                        validator: None,
                        min: None,
                        max: None,
                        required: false,
                        description: Some("Block sudo commands".to_string()),
                    },
                ],
                scope: PermissionScope::Global,
                reason: Some(
                    "Safe mode: bash allowed with dangerous command restrictions".to_string(),
                ),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("safe"))]),
            },
            // Allow file operations with restrictions
            ToolPermission {
                tool: "file_write".to_string(),
                allowed: true,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    // Block writing to system directories
                    pattern: Some(r"^(?!/etc|/usr|/bin|/sbin|/boot|/sys|/proc).*$".to_string()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some("Block writing to system directories".to_string()),
                }],
                scope: PermissionScope::Global,
                reason: Some(
                    "Safe mode: file writing allowed except system directories".to_string(),
                ),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("safe"))]),
            },
            // Block dangerous file operations
            ToolPermission {
                tool: "file_delete".to_string(),
                allowed: true,
                priority: 100,
                conditions: Vec::new(),
                parameter_restrictions: vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    // Block deleting system files
                    pattern: Some(r"^(?!/etc|/usr|/bin|/sbin|/boot|/sys|/proc|/).*$".to_string()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some("Block deleting system files".to_string()),
                }],
                scope: PermissionScope::Global,
                reason: Some("Safe mode: file deletion allowed except system files".to_string()),
                expires_at: None,
                metadata: HashMap::from([("template".to_string(), serde_json::json!("safe"))]),
            },
        ]
    }

    /// Project-only template
    ///
    /// Creates permissions that restrict all operations to the specified project directory.
    /// Operations outside the project directory are denied.
    ///
    /// # Arguments
    /// * `project_dir` - The project directory path to restrict operations to
    ///
    /// # Returns
    /// A vector of permissions that:
    /// - Allow file operations only within the project directory
    /// - Use working_directory condition to enforce restriction
    ///
    /// Requirements: 7.3
    pub fn project_only(project_dir: &Path) -> Vec<ToolPermission> {
        let project_path = project_dir.to_string_lossy().to_string();

        vec![
            // Allow file operations within project
            ToolPermission {
                tool: "file_*".to_string(),
                allowed: true,
                priority: 100,
                conditions: vec![PermissionCondition {
                    condition_type: ConditionType::Context,
                    field: Some("working_directory".to_string()),
                    operator: ConditionOperator::Contains,
                    value: serde_json::json!(project_path),
                    validator: None,
                    description: Some(format!("Only allow within project: {}", project_path)),
                }],
                parameter_restrictions: vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    // Ensure path starts with project directory or is relative
                    pattern: Some(format!(r"^({}|\.|\.\.).*$", regex::escape(&project_path))),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some(format!("Path must be within project: {}", project_path)),
                }],
                scope: PermissionScope::Project,
                reason: Some(format!(
                    "Project-only mode: operations restricted to {}",
                    project_path
                )),
                expires_at: None,
                metadata: HashMap::from([
                    ("template".to_string(), serde_json::json!("project_only")),
                    ("project_dir".to_string(), serde_json::json!(project_path)),
                ]),
            },
            // Allow bash within project
            ToolPermission {
                tool: "bash".to_string(),
                allowed: true,
                priority: 100,
                conditions: vec![PermissionCondition {
                    condition_type: ConditionType::Context,
                    field: Some("working_directory".to_string()),
                    operator: ConditionOperator::Contains,
                    value: serde_json::json!(project_path.clone()),
                    validator: None,
                    description: Some(format!("Only allow bash within project: {}", project_path)),
                }],
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Project,
                reason: Some(format!(
                    "Project-only mode: bash restricted to {}",
                    project_path
                )),
                expires_at: None,
                metadata: HashMap::from([
                    ("template".to_string(), serde_json::json!("project_only")),
                    ("project_dir".to_string(), serde_json::json!(project_path)),
                ]),
            },
            // Deny operations outside project (lower priority fallback)
            ToolPermission {
                tool: "*".to_string(),
                allowed: false,
                priority: 50,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Project,
                reason: Some(
                    "Project-only mode: operations outside project directory denied".to_string(),
                ),
                expires_at: None,
                metadata: HashMap::from([
                    ("template".to_string(), serde_json::json!("project_only")),
                    ("project_dir".to_string(), serde_json::json!(project_path)),
                ]),
            },
        ]
    }

    /// Time-restricted template
    ///
    /// Creates permissions that limit tool usage to specific hours of the day.
    /// Tools are only allowed during the specified time window.
    ///
    /// # Arguments
    /// * `start_hour` - Start hour (0-23) when tools are allowed
    /// * `end_hour` - End hour (0-23) when tools stop being allowed
    ///
    /// # Returns
    /// A vector of permissions that:
    /// - Allow all tools during the specified time window
    /// - Deny all tools outside the time window
    ///
    /// # Note
    /// If start_hour > end_hour, the time window wraps around midnight.
    /// For example, start_hour=22, end_hour=6 allows tools from 10 PM to 6 AM.
    ///
    /// Requirements: 7.4
    pub fn time_restricted(start_hour: u32, end_hour: u32) -> Vec<ToolPermission> {
        // Clamp hours to valid range
        let start = start_hour.min(23);
        let end = end_hour.min(23);

        vec![
            // Allow all tools during time window
            ToolPermission {
                tool: "*".to_string(),
                allowed: true,
                priority: 100,
                conditions: vec![PermissionCondition {
                    condition_type: ConditionType::Time,
                    field: Some("hour".to_string()),
                    operator: ConditionOperator::Range,
                    value: serde_json::json!({
                        "min": start,
                        "max": end
                    }),
                    validator: None,
                    description: Some(format!("Allow tools between {}:00 and {}:00", start, end)),
                }],
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some(format!(
                    "Time-restricted mode: tools allowed between {}:00 and {}:00",
                    start, end
                )),
                expires_at: None,
                metadata: HashMap::from([
                    ("template".to_string(), serde_json::json!("time_restricted")),
                    ("start_hour".to_string(), serde_json::json!(start)),
                    ("end_hour".to_string(), serde_json::json!(end)),
                ]),
            },
            // Deny all tools outside time window (lower priority fallback)
            ToolPermission {
                tool: "*".to_string(),
                allowed: false,
                priority: 50,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Global,
                reason: Some(format!(
                    "Time-restricted mode: tools denied outside {}:00 - {}:00",
                    start, end
                )),
                expires_at: None,
                metadata: HashMap::from([
                    ("template".to_string(), serde_json::json!("time_restricted")),
                    ("start_hour".to_string(), serde_json::json!(start)),
                    ("end_hour".to_string(), serde_json::json!(end)),
                ]),
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_only_template() {
        let permissions = PermissionTemplates::read_only();

        // Should have multiple permissions
        assert!(!permissions.is_empty());

        // Check that read operations are allowed
        let read_perms: Vec<_> = permissions
            .iter()
            .filter(|p| {
                p.tool.contains("read") || p.tool.contains("list") || p.tool.contains("search")
            })
            .collect();
        assert!(read_perms.iter().all(|p| p.allowed));

        // Check that write operations are denied
        let write_perms: Vec<_> = permissions
            .iter()
            .filter(|p| {
                p.tool.contains("write") || p.tool.contains("delete") || p.tool.contains("create")
            })
            .collect();
        assert!(write_perms.iter().all(|p| !p.allowed));

        // Check that bash is denied
        let bash_perm = permissions.iter().find(|p| p.tool == "bash");
        assert!(bash_perm.is_some());
        assert!(!bash_perm.unwrap().allowed);

        // Check metadata
        assert!(permissions
            .iter()
            .all(|p| { p.metadata.get("template") == Some(&serde_json::json!("read_only")) }));
    }

    #[test]
    fn test_safe_template() {
        let permissions = PermissionTemplates::safe();

        // Should have permissions
        assert!(!permissions.is_empty());

        // Check that bash is allowed with restrictions
        let bash_perm = permissions.iter().find(|p| p.tool == "bash");
        assert!(bash_perm.is_some());
        let bash = bash_perm.unwrap();
        assert!(bash.allowed);
        assert!(!bash.parameter_restrictions.is_empty());

        // Check metadata
        assert!(permissions
            .iter()
            .all(|p| { p.metadata.get("template") == Some(&serde_json::json!("safe")) }));
    }

    #[test]
    fn test_project_only_template() {
        let project_dir = Path::new("/home/user/myproject");
        let permissions = PermissionTemplates::project_only(project_dir);

        // Should have permissions
        assert!(!permissions.is_empty());

        // Check that file operations have conditions
        let file_perm = permissions.iter().find(|p| p.tool == "file_*");
        assert!(file_perm.is_some());
        let file = file_perm.unwrap();
        assert!(file.allowed);
        assert!(!file.conditions.is_empty());

        // Check that there's a deny-all fallback
        let deny_all = permissions.iter().find(|p| p.tool == "*" && !p.allowed);
        assert!(deny_all.is_some());

        // Check metadata contains project_dir
        assert!(permissions
            .iter()
            .all(|p| { p.metadata.get("template") == Some(&serde_json::json!("project_only")) }));
        assert!(permissions.iter().any(|p| {
            p.metadata.get("project_dir") == Some(&serde_json::json!("/home/user/myproject"))
        }));
    }

    #[test]
    fn test_time_restricted_template() {
        let permissions = PermissionTemplates::time_restricted(9, 17);

        // Should have 2 permissions (allow during hours, deny outside)
        assert_eq!(permissions.len(), 2);

        // Check allow permission
        let allow_perm = permissions.iter().find(|p| p.allowed);
        assert!(allow_perm.is_some());
        let allow = allow_perm.unwrap();
        assert!(!allow.conditions.is_empty());
        assert_eq!(allow.priority, 100);

        // Check deny permission
        let deny_perm = permissions.iter().find(|p| !p.allowed);
        assert!(deny_perm.is_some());
        let deny = deny_perm.unwrap();
        assert_eq!(deny.priority, 50);

        // Check metadata
        assert!(permissions.iter().all(|p| {
            p.metadata.get("template") == Some(&serde_json::json!("time_restricted"))
        }));
        assert!(permissions.iter().any(|p| {
            p.metadata.get("start_hour") == Some(&serde_json::json!(9))
                && p.metadata.get("end_hour") == Some(&serde_json::json!(17))
        }));
    }

    #[test]
    fn test_time_restricted_clamps_hours() {
        let permissions = PermissionTemplates::time_restricted(25, 30);

        // Hours should be clamped to 23
        let allow_perm = permissions.iter().find(|p| p.allowed).unwrap();
        assert_eq!(
            allow_perm.metadata.get("start_hour"),
            Some(&serde_json::json!(23))
        );
        assert_eq!(
            allow_perm.metadata.get("end_hour"),
            Some(&serde_json::json!(23))
        );
    }
}
