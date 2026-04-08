//! Tool Permission Manager Module
//!
//! This module implements the core `ToolPermissionManager` that provides
//! fine-grained tool permission control for the AI Agent framework.
//!
//! Features:
//! - Three-tier permission architecture (Global, Project, Session)
//! - Parameter-level restrictions
//! - Context-based condition evaluation
//! - Permission merging with configurable strategies
//! - Permission persistence (Global and Project scopes)
//!
//! Requirements: 1.1, 1.4, 1.5, 2.3, 2.4, 5.1, 5.2, 5.3, 5.4

use super::condition::check_conditions;
use super::merger::merge_permissions;
use super::pattern::match_pattern;
use super::policy::ToolPolicyManager;
use super::restriction::check_parameter_restrictions;
use super::types::{
    PermissionContext, PermissionInheritance, PermissionResult, PermissionScope, RestrictionType,
    ToolPermission,
};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;

/// Permission configuration file format
///
/// Used for serializing/deserializing permissions to/from JSON files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionConfig {
    /// Configuration version for future migrations
    pub version: String,
    /// Inheritance configuration
    pub inheritance: PermissionInheritance,
    /// List of permissions
    pub permissions: Vec<ToolPermission>,
}

impl Default for PermissionConfig {
    fn default() -> Self {
        Self {
            version: "1.0.0".to_string(),
            inheritance: PermissionInheritance::default(),
            permissions: Vec::new(),
        }
    }
}

/// File names for permission configuration
const GLOBAL_PERMISSIONS_FILE: &str = "global_permissions.json";
const PROJECT_PERMISSIONS_FILE: &str = "project_permissions.json";

/// Tool Permission Manager
///
/// Manages tool permissions across three scopes: Global, Project, and Session.
/// Provides permission checking, CRUD operations, and configuration management.
///
/// Requirements: 1.1
pub struct ToolPermissionManager {
    /// Global permissions (persisted to file)
    global_permissions: HashMap<String, ToolPermission>,
    /// Project permissions (persisted to file)
    project_permissions: HashMap<String, ToolPermission>,
    /// Session permissions (memory only)
    session_permissions: HashMap<String, ToolPermission>,
    /// Inheritance configuration
    inheritance: PermissionInheritance,
    /// Configuration directory for persistence
    config_dir: Option<PathBuf>,
    /// Custom template registry
    /// Requirements: 7.5
    template_registry: HashMap<String, Vec<ToolPermission>>,
    /// Tool Policy Manager (optional, for new policy system)
    /// Requirements: 5.1, 5.3
    policy_manager: Option<ToolPolicyManager>,
}

impl ToolPermissionManager {
    /// Create a new ToolPermissionManager
    ///
    /// # Arguments
    /// * `config_dir` - Optional configuration directory for persistence
    ///
    /// # Returns
    /// A new ToolPermissionManager instance with default settings
    ///
    /// Requirements: 1.1
    pub fn new(config_dir: Option<PathBuf>) -> Self {
        Self {
            global_permissions: HashMap::new(),
            project_permissions: HashMap::new(),
            session_permissions: HashMap::new(),
            inheritance: PermissionInheritance::default(),
            config_dir,
            template_registry: HashMap::new(),
            policy_manager: None,
        }
    }

    /// Enable the new Tool Policy system
    ///
    /// # Arguments
    /// * `policy_manager` - The ToolPolicyManager to use
    ///
    /// Requirements: 5.1, 5.3
    pub fn with_policy_manager(mut self, policy_manager: ToolPolicyManager) -> Self {
        self.policy_manager = Some(policy_manager);
        self
    }

    /// Set the policy manager
    ///
    /// Requirements: 5.1, 5.3
    pub fn set_policy_manager(&mut self, policy_manager: ToolPolicyManager) {
        self.policy_manager = Some(policy_manager);
    }

    /// Get the policy manager
    pub fn policy_manager(&self) -> Option<&ToolPolicyManager> {
        self.policy_manager.as_ref()
    }

    /// Get mutable policy manager
    pub fn policy_manager_mut(&mut self) -> Option<&mut ToolPolicyManager> {
        self.policy_manager.as_mut()
    }

    /// Get the configuration directory
    pub fn config_dir(&self) -> Option<&PathBuf> {
        self.config_dir.as_ref()
    }

    /// Get the inheritance configuration (reference)
    pub fn inheritance(&self) -> &PermissionInheritance {
        &self.inheritance
    }

    /// Get the inheritance configuration (cloned)
    ///
    /// Returns a clone of the current inheritance configuration.
    /// Use this when you need to modify the configuration or pass it elsewhere.
    ///
    /// Requirements: 6.1, 6.2
    pub fn get_inheritance(&self) -> PermissionInheritance {
        self.inheritance.clone()
    }

    /// Set the inheritance configuration
    ///
    /// Updates the inheritance configuration that controls how permissions
    /// are merged across scopes (Global, Project, Session).
    ///
    /// # Arguments
    /// * `inheritance` - The new inheritance configuration
    ///
    /// Requirements: 6.1, 6.2
    pub fn set_inheritance(&mut self, inheritance: PermissionInheritance) {
        self.inheritance = inheritance;
    }

    /// Check if a tool is allowed to execute
    ///
    /// # Arguments
    /// * `tool` - The tool name to check
    /// * `params` - The tool parameters
    /// * `context` - The permission context
    ///
    /// # Returns
    /// A PermissionResult containing the decision and details
    ///
    /// # Behavior
    /// 1. If policy_manager is set, check it first (new system takes precedence)
    /// 2. Merge permissions from all scopes according to inheritance config
    /// 3. Find matching rules by tool name (supports wildcards)
    /// 4. Sort by priority (highest first)
    /// 5. For each rule:
    ///    - Skip if expired
    ///    - Evaluate conditions
    ///    - If conditions pass, check parameter restrictions
    ///    - Return result based on rule's allowed flag
    /// 6. If no rules match, allow by default
    ///
    /// Requirements: 2.3, 2.4, 5.1, 5.2, 5.3
    pub fn is_allowed(
        &self,
        tool: &str,
        params: &HashMap<String, Value>,
        context: &PermissionContext,
    ) -> PermissionResult {
        // Step 0: Check policy manager first if enabled (Requirements: 5.1, 5.3)
        if let Some(policy_manager) = &self.policy_manager {
            let decision = policy_manager.is_allowed(tool);
            if !decision.allowed {
                return PermissionResult {
                    allowed: false,
                    reason: Some(decision.reason),
                    restricted: false,
                    suggestions: vec![format!(
                        "Tool denied by policy layer: {:?}",
                        decision.source_layer
                    )],
                    matched_rule: None,
                    violations: Vec::new(),
                };
            }
        }

        // Step 1: Merge permissions from all scopes
        let global_perms: Vec<ToolPermission> = self.global_permissions.values().cloned().collect();
        let project_perms: Vec<ToolPermission> =
            self.project_permissions.values().cloned().collect();
        let session_perms: Vec<ToolPermission> =
            self.session_permissions.values().cloned().collect();

        let merged = merge_permissions(
            &global_perms,
            &project_perms,
            &session_perms,
            &self.inheritance,
        );

        // Step 2: Find matching rules by tool name
        let mut matching_rules: Vec<&ToolPermission> = merged
            .iter()
            .filter(|perm| match_pattern(tool, &perm.tool))
            .collect();

        // Step 3: Sort by priority (highest first) - already sorted by merge_permissions
        // but we re-sort to ensure correct order after filtering
        matching_rules.sort_by(|a, b| b.priority.cmp(&a.priority));

        // Step 4: Evaluate each rule
        for rule in matching_rules {
            // Skip expired rules
            if let Some(expires_at) = rule.expires_at {
                if context.timestamp > expires_at {
                    continue;
                }
            }

            // Evaluate conditions
            if !check_conditions(&rule.conditions, context) {
                continue;
            }

            // Conditions passed - this rule matches
            // Check parameter restrictions
            let restriction_result =
                check_parameter_restrictions(&rule.parameter_restrictions, params);

            match restriction_result {
                Ok(()) => {
                    // All restrictions passed
                    if rule.allowed {
                        return PermissionResult {
                            allowed: true,
                            reason: rule.reason.clone(),
                            restricted: !rule.parameter_restrictions.is_empty(),
                            suggestions: Vec::new(),
                            matched_rule: Some(rule.clone()),
                            violations: Vec::new(),
                        };
                    } else {
                        // Tool is explicitly denied
                        let suggestions = Self::generate_suggestions(rule, &[]);
                        return PermissionResult {
                            allowed: false,
                            reason: rule.reason.clone().or_else(|| {
                                Some(format!("Tool '{}' is denied by permission rule", tool))
                            }),
                            restricted: false,
                            suggestions,
                            matched_rule: Some(rule.clone()),
                            violations: Vec::new(),
                        };
                    }
                }
                Err(violations) => {
                    // Parameter restrictions violated
                    let suggestions = Self::generate_suggestions(rule, &violations);
                    return PermissionResult {
                        allowed: false,
                        reason: Some(format!(
                            "Parameter restrictions violated for tool '{}'",
                            tool
                        )),
                        restricted: true,
                        suggestions,
                        matched_rule: Some(rule.clone()),
                        violations,
                    };
                }
            }
        }

        // Step 5: No rules matched - allow by default
        PermissionResult {
            allowed: true,
            reason: None,
            restricted: false,
            suggestions: Vec::new(),
            matched_rule: None,
            violations: Vec::new(),
        }
    }

    /// Generate suggestions for resolving permission denials
    ///
    /// # Arguments
    /// * `rule` - The matched permission rule
    /// * `violations` - List of parameter violations
    ///
    /// # Returns
    /// A list of suggestions for resolving the denial
    ///
    /// Requirements: 5.3, 5.4
    pub fn generate_suggestions(rule: &ToolPermission, violations: &[String]) -> Vec<String> {
        let mut suggestions = Vec::new();

        // If tool is explicitly denied, suggest alternatives
        if !rule.allowed {
            if let Some(ref reason) = rule.reason {
                suggestions.push(format!("Denial reason: {}", reason));
            }

            // Check if there are conditions that could be satisfied
            if !rule.conditions.is_empty() {
                suggestions.push(
                    "This tool may be allowed under different conditions. \
                     Check the permission conditions."
                        .to_string(),
                );
            }

            // Suggest checking scope
            match rule.scope {
                PermissionScope::Session => {
                    suggestions.push(
                        "This is a session-level restriction. \
                         It will be reset when the session ends."
                            .to_string(),
                    );
                }
                PermissionScope::Project => {
                    suggestions.push(
                        "This is a project-level restriction. \
                         Check project permission configuration."
                            .to_string(),
                    );
                }
                PermissionScope::Global => {
                    suggestions.push(
                        "This is a global restriction. \
                         Contact administrator to modify global permissions."
                            .to_string(),
                    );
                }
            }
        }

        // Add suggestions based on violations
        for violation in violations {
            if violation.contains("whitelist") {
                suggestions.push(format!(
                    "Parameter value not in allowed list. {}",
                    violation
                ));
            } else if violation.contains("blacklist") {
                suggestions.push(format!(
                    "Parameter value is blocked. Try a different value. {}",
                    violation
                ));
            } else if violation.contains("pattern") {
                suggestions.push(format!(
                    "Parameter value doesn't match required format. {}",
                    violation
                ));
            } else if violation.contains("range") {
                suggestions.push(format!(
                    "Parameter value is out of allowed range. {}",
                    violation
                ));
            } else if violation.contains("Required") {
                suggestions.push(format!("Missing required parameter. {}", violation));
            } else {
                suggestions.push(violation.clone());
            }
        }

        // Add suggestion about parameter restrictions if present
        if !rule.parameter_restrictions.is_empty() && violations.is_empty() {
            suggestions.push(
                "This tool has parameter restrictions. \
                 Ensure all parameters meet the requirements."
                    .to_string(),
            );
        }

        suggestions
    }

    /// Add a permission rule
    ///
    /// # Arguments
    /// * `permission` - The permission to add
    /// * `scope` - The scope to add the permission to
    pub fn add_permission(&mut self, permission: ToolPermission, scope: PermissionScope) {
        let key = permission.tool.clone();
        let mut perm = permission;
        perm.scope = scope;

        match scope {
            PermissionScope::Global => {
                self.global_permissions.insert(key, perm);
            }
            PermissionScope::Project => {
                self.project_permissions.insert(key, perm);
            }
            PermissionScope::Session => {
                self.session_permissions.insert(key, perm);
            }
        }
    }

    /// Remove a permission rule
    ///
    /// # Arguments
    /// * `tool` - The tool name pattern to remove
    /// * `scope` - Optional scope to remove from (None removes from all scopes)
    pub fn remove_permission(&mut self, tool: &str, scope: Option<PermissionScope>) {
        match scope {
            Some(PermissionScope::Global) => {
                self.global_permissions.remove(tool);
            }
            Some(PermissionScope::Project) => {
                self.project_permissions.remove(tool);
            }
            Some(PermissionScope::Session) => {
                self.session_permissions.remove(tool);
            }
            None => {
                self.global_permissions.remove(tool);
                self.project_permissions.remove(tool);
                self.session_permissions.remove(tool);
            }
        }
    }

    /// Update a permission rule
    ///
    /// # Arguments
    /// * `tool` - The tool name pattern to update
    /// * `updates` - The partial updates to apply
    /// * `scope` - The scope to update in
    ///
    /// # Returns
    /// `true` if the permission was found and updated, `false` otherwise
    ///
    /// Requirements: 1.1
    pub fn update_permission(
        &mut self,
        tool: &str,
        updates: super::types::ToolPermissionUpdate,
        scope: PermissionScope,
    ) -> bool {
        let permissions = match scope {
            PermissionScope::Global => &mut self.global_permissions,
            PermissionScope::Project => &mut self.project_permissions,
            PermissionScope::Session => &mut self.session_permissions,
        };

        if let Some(perm) = permissions.get_mut(tool) {
            // Apply updates
            if let Some(allowed) = updates.allowed {
                perm.allowed = allowed;
            }
            if let Some(priority) = updates.priority {
                perm.priority = priority;
            }
            if let Some(conditions) = updates.conditions {
                perm.conditions = conditions;
            }
            if let Some(restrictions) = updates.parameter_restrictions {
                perm.parameter_restrictions = restrictions;
            }
            if let Some(reason) = updates.reason {
                perm.reason = reason;
            }
            if let Some(expires_at) = updates.expires_at {
                perm.expires_at = expires_at;
            }
            if let Some(metadata) = updates.metadata {
                perm.metadata = metadata;
            }
            true
        } else {
            false
        }
    }

    /// Get all permissions
    ///
    /// # Arguments
    /// * `scope` - Optional scope filter (None returns all)
    ///
    /// # Returns
    /// A vector of permissions matching the scope filter
    pub fn get_permissions(&self, scope: Option<PermissionScope>) -> Vec<ToolPermission> {
        match scope {
            Some(PermissionScope::Global) => self.global_permissions.values().cloned().collect(),
            Some(PermissionScope::Project) => self.project_permissions.values().cloned().collect(),
            Some(PermissionScope::Session) => self.session_permissions.values().cloned().collect(),
            None => {
                let mut all = Vec::new();
                all.extend(self.global_permissions.values().cloned());
                all.extend(self.project_permissions.values().cloned());
                all.extend(self.session_permissions.values().cloned());
                all
            }
        }
    }

    /// Get permission for a specific tool
    ///
    /// # Arguments
    /// * `tool` - The tool name to look up
    ///
    /// # Returns
    /// The first matching permission (Session > Project > Global priority)
    pub fn get_tool_permission(&self, tool: &str) -> Option<ToolPermission> {
        // Check session first (highest priority)
        if let Some(perm) = self.session_permissions.get(tool) {
            return Some(perm.clone());
        }

        // Check project
        if let Some(perm) = self.project_permissions.get(tool) {
            return Some(perm.clone());
        }

        // Check global
        if let Some(perm) = self.global_permissions.get(tool) {
            return Some(perm.clone());
        }

        None
    }

    /// Get the number of permissions in each scope
    pub fn permission_counts(&self) -> (usize, usize, usize) {
        (
            self.global_permissions.len(),
            self.project_permissions.len(),
            self.session_permissions.len(),
        )
    }

    /// Clear all permissions in a specific scope
    pub fn clear_scope(&mut self, scope: PermissionScope) {
        match scope {
            PermissionScope::Global => self.global_permissions.clear(),
            PermissionScope::Project => self.project_permissions.clear(),
            PermissionScope::Session => self.session_permissions.clear(),
        }
    }

    /// Clear all permissions
    pub fn clear_all(&mut self) {
        self.global_permissions.clear();
        self.project_permissions.clear();
        self.session_permissions.clear();
    }

    // ========================================================================
    // Template Methods
    // ========================================================================

    /// Register a custom permission template
    ///
    /// Registers a named template that can be applied later using `apply_template`.
    /// If a template with the same name already exists, it will be replaced.
    ///
    /// # Arguments
    /// * `name` - The name to register the template under
    /// * `template` - The vector of permissions that make up the template
    ///
    /// # Example
    /// ```ignore
    /// let mut manager = ToolPermissionManager::new(None);
    /// let custom_template = vec![
    ///     ToolPermission {
    ///         tool: "custom_tool".to_string(),
    ///         allowed: true,
    ///         ..Default::default()
    ///     },
    /// ];
    /// manager.register_template("my_template", custom_template);
    /// ```
    ///
    /// Requirements: 7.5
    pub fn register_template(&mut self, name: &str, template: Vec<ToolPermission>) {
        self.template_registry.insert(name.to_string(), template);
    }

    /// Apply a registered template to a specific scope
    ///
    /// Applies all permissions from the named template to the specified scope.
    /// Each permission's scope field is updated to match the target scope.
    ///
    /// # Arguments
    /// * `name` - The name of the registered template to apply
    /// * `scope` - The scope to apply the template permissions to
    ///
    /// # Returns
    /// `true` if the template was found and applied, `false` if the template doesn't exist
    ///
    /// # Example
    /// ```ignore
    /// let mut manager = ToolPermissionManager::new(None);
    /// manager.register_template("my_template", vec![...]);
    /// manager.apply_template("my_template", PermissionScope::Project);
    /// ```
    ///
    /// Requirements: 7.5
    pub fn apply_template(&mut self, name: &str, scope: PermissionScope) -> bool {
        let Some(template) = self.template_registry.get(name).cloned() else {
            return false;
        };

        for mut perm in template {
            perm.scope = scope;
            self.add_permission(perm, scope);
        }

        true
    }

    /// Get a registered template by name
    ///
    /// # Arguments
    /// * `name` - The name of the template to retrieve
    ///
    /// # Returns
    /// The template permissions if found, None otherwise
    ///
    /// Requirements: 7.5
    pub fn get_template(&self, name: &str) -> Option<&Vec<ToolPermission>> {
        self.template_registry.get(name)
    }

    /// Remove a registered template
    ///
    /// # Arguments
    /// * `name` - The name of the template to remove
    ///
    /// # Returns
    /// The removed template if it existed, None otherwise
    ///
    /// Requirements: 7.5
    pub fn remove_template(&mut self, name: &str) -> Option<Vec<ToolPermission>> {
        self.template_registry.remove(name)
    }

    /// List all registered template names
    ///
    /// # Returns
    /// A vector of all registered template names
    ///
    /// Requirements: 7.5
    pub fn list_templates(&self) -> Vec<&String> {
        self.template_registry.keys().collect()
    }

    /// Check if a template is registered
    ///
    /// # Arguments
    /// * `name` - The name of the template to check
    ///
    /// # Returns
    /// `true` if the template exists, `false` otherwise
    ///
    /// Requirements: 7.5
    pub fn has_template(&self, name: &str) -> bool {
        self.template_registry.contains_key(name)
    }

    // ========================================================================
    // Statistics and Query Methods
    // ========================================================================

    /// Get permission statistics
    ///
    /// Calculates and returns statistics about the current permission configuration.
    ///
    /// # Returns
    /// A `PermissionStats` struct containing:
    /// - total_permissions: Total number of permissions across all scopes
    /// - allowed_tools: Number of permissions with allowed=true
    /// - denied_tools: Number of permissions with allowed=false
    /// - conditional_tools: Number of permissions with at least one condition
    /// - restricted_parameters: Number of permissions with at least one parameter restriction
    ///
    /// Requirements: 9.1
    pub fn get_stats(&self) -> super::types::PermissionStats {
        let all_permissions = self.get_permissions(None);

        let total_permissions = all_permissions.len();
        let allowed_tools = all_permissions.iter().filter(|p| p.allowed).count();
        let denied_tools = all_permissions.iter().filter(|p| !p.allowed).count();
        let conditional_tools = all_permissions
            .iter()
            .filter(|p| !p.conditions.is_empty())
            .count();
        let restricted_parameters = all_permissions
            .iter()
            .filter(|p| !p.parameter_restrictions.is_empty())
            .count();

        super::types::PermissionStats {
            total_permissions,
            allowed_tools,
            denied_tools,
            conditional_tools,
            restricted_parameters,
        }
    }

    /// Query permissions with filters
    ///
    /// Returns all permissions that match the specified filter criteria.
    /// All filter conditions are combined with AND logic.
    ///
    /// # Arguments
    /// * `filter` - The filter criteria to apply
    ///
    /// # Returns
    /// A vector of permissions matching all specified filter criteria.
    ///
    /// # Filter Behavior
    /// - `allowed`: Filter by allowed flag (true/false)
    /// - `scope`: Filter by permission scope (Global/Project/Session)
    /// - `has_conditions`: Filter by whether permission has conditions
    /// - `has_restrictions`: Filter by whether permission has parameter restrictions
    /// - `tool_pattern`: Filter by tool name pattern (supports wildcards)
    ///
    /// Requirements: 9.2, 9.3
    pub fn query_permissions(&self, filter: super::types::PermissionFilter) -> Vec<ToolPermission> {
        let all_permissions = self.get_permissions(filter.scope);

        all_permissions
            .into_iter()
            .filter(|perm| {
                // Filter by allowed
                if let Some(allowed) = filter.allowed {
                    if perm.allowed != allowed {
                        return false;
                    }
                }

                // Filter by has_conditions
                if let Some(has_conditions) = filter.has_conditions {
                    let perm_has_conditions = !perm.conditions.is_empty();
                    if perm_has_conditions != has_conditions {
                        return false;
                    }
                }

                // Filter by has_restrictions
                if let Some(has_restrictions) = filter.has_restrictions {
                    let perm_has_restrictions = !perm.parameter_restrictions.is_empty();
                    if perm_has_restrictions != has_restrictions {
                        return false;
                    }
                }

                // Filter by tool_pattern
                if let Some(ref pattern) = filter.tool_pattern {
                    if !match_pattern(&perm.tool, pattern) {
                        return false;
                    }
                }

                true
            })
            .collect()
    }

    // ========================================================================
    // Persistence Methods
    // ========================================================================

    /// Load permissions from configuration files
    ///
    /// Loads Global permissions from the config directory and Project permissions
    /// from the project-specific configuration. Session permissions are not loaded
    /// as they are memory-only.
    ///
    /// # Behavior
    /// - If config_dir is None, no permissions are loaded
    /// - If a config file doesn't exist, that scope starts empty
    /// - If a config file is invalid, an error is logged and that scope starts empty
    ///
    /// Requirements: 1.4
    pub fn load_permissions(&mut self) {
        let Some(config_dir) = &self.config_dir else {
            return;
        };

        // Load global permissions
        let global_path = config_dir.join(GLOBAL_PERMISSIONS_FILE);
        if global_path.exists() {
            match Self::load_config_file(&global_path) {
                Ok(config) => {
                    self.inheritance = config.inheritance;
                    for perm in config.permissions {
                        let key = perm.tool.clone();
                        self.global_permissions.insert(key, perm);
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "Failed to load global permissions from {:?}: {}",
                        global_path,
                        e
                    );
                }
            }
        }

        // Load project permissions
        let project_path = config_dir.join(PROJECT_PERMISSIONS_FILE);
        if project_path.exists() {
            match Self::load_config_file(&project_path) {
                Ok(config) => {
                    for perm in config.permissions {
                        let key = perm.tool.clone();
                        self.project_permissions.insert(key, perm);
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "Failed to load project permissions from {:?}: {}",
                        project_path,
                        e
                    );
                }
            }
        }

        // Session permissions are NOT loaded - they are memory-only (Requirement 1.5)
    }

    /// Load a permission configuration file
    fn load_config_file(path: &PathBuf) -> Result<PermissionConfig> {
        let file = File::open(path)
            .with_context(|| format!("Failed to open permission config file: {:?}", path))?;
        let reader = BufReader::new(file);
        let config: PermissionConfig = serde_json::from_reader(reader)
            .with_context(|| format!("Failed to parse permission config file: {:?}", path))?;
        Ok(config)
    }

    /// Save permissions to configuration files
    ///
    /// Saves permissions to the appropriate configuration file based on scope.
    /// Session permissions are NOT saved as they are memory-only.
    ///
    /// # Arguments
    /// * `scope` - The scope to save (Global or Project only)
    ///
    /// # Returns
    /// * `Ok(())` if save was successful
    /// * `Err` if save failed or if trying to save Session scope
    ///
    /// # Behavior
    /// - Creates the config directory if it doesn't exist
    /// - Writes to a temporary file first, then atomically renames
    /// - Session scope returns an error (memory-only)
    ///
    /// Requirements: 1.4, 1.5
    pub fn save_permissions(&self, scope: PermissionScope) -> Result<()> {
        // Session permissions are NOT persisted (Requirement 1.5)
        if scope == PermissionScope::Session {
            anyhow::bail!("Session permissions cannot be persisted - they are memory-only");
        }

        let Some(config_dir) = &self.config_dir else {
            anyhow::bail!("No config directory configured for persistence");
        };

        // Ensure config directory exists
        fs::create_dir_all(config_dir)
            .with_context(|| format!("Failed to create config directory: {:?}", config_dir))?;

        let (file_name, permissions) = match scope {
            PermissionScope::Global => (GLOBAL_PERMISSIONS_FILE, &self.global_permissions),
            PermissionScope::Project => (PROJECT_PERMISSIONS_FILE, &self.project_permissions),
            PermissionScope::Session => unreachable!(), // Already handled above
        };

        let config = PermissionConfig {
            version: "1.0.0".to_string(),
            inheritance: self.inheritance.clone(),
            permissions: permissions.values().cloned().collect(),
        };

        let file_path = config_dir.join(file_name);
        let temp_path = file_path.with_extension("tmp");

        // Write to temporary file first
        let file = File::create(&temp_path)
            .with_context(|| format!("Failed to create temp file: {:?}", temp_path))?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, &config)
            .with_context(|| format!("Failed to write permission config: {:?}", temp_path))?;

        // Atomically rename temp file to target file
        fs::rename(&temp_path, &file_path)
            .with_context(|| format!("Failed to rename temp file to: {:?}", file_path))?;

        Ok(())
    }

    /// Get the path to a permission config file
    pub fn get_config_path(&self, scope: PermissionScope) -> Option<PathBuf> {
        self.config_dir.as_ref().map(|dir| {
            let file_name = match scope {
                PermissionScope::Global => GLOBAL_PERMISSIONS_FILE,
                PermissionScope::Project => PROJECT_PERMISSIONS_FILE,
                PermissionScope::Session => return dir.join("session_permissions.json"), // Not actually used
            };
            dir.join(file_name)
        })
    }

    /// Check if a config file exists for the given scope
    pub fn config_exists(&self, scope: PermissionScope) -> bool {
        self.get_config_path(scope)
            .map(|p| p.exists())
            .unwrap_or(false)
    }

    // ========================================================================
    // Import/Export Methods
    // ========================================================================

    /// Export permissions to JSON format
    ///
    /// Exports permissions from the specified scope(s) to a JSON string.
    /// The exported configuration includes version information for future migrations.
    ///
    /// # Arguments
    /// * `scope` - Optional scope filter. If None, exports all scopes.
    ///
    /// # Returns
    /// * `Ok(String)` - JSON string containing the exported permissions
    /// * `Err` - If serialization fails
    ///
    /// # Format
    /// The exported JSON follows the PermissionConfig format:
    /// ```json
    /// {
    ///   "version": "1.0.0",
    ///   "inheritance": { ... },
    ///   "permissions": [ ... ]
    /// }
    /// ```
    ///
    /// Requirements: 8.1, 8.5
    pub fn export(&self, scope: Option<PermissionScope>) -> Result<String> {
        let permissions = self.get_permissions(scope);

        let config = PermissionConfig {
            version: "1.0.0".to_string(),
            inheritance: self.inheritance.clone(),
            permissions,
        };

        serde_json::to_string_pretty(&config).context("Failed to serialize permissions to JSON")
    }

    /// Import permissions from JSON format
    ///
    /// Imports permissions from a JSON string into the specified scope.
    /// The import validates the configuration format before applying changes.
    /// If validation fails, existing permissions remain unchanged.
    ///
    /// # Arguments
    /// * `config_json` - JSON string containing the permission configuration
    /// * `scope` - The scope to import permissions into
    ///
    /// # Returns
    /// * `Ok(())` - If import was successful
    /// * `Err` - If validation or parsing fails (existing permissions unchanged)
    ///
    /// # Behavior
    /// - Validates JSON format before modifying any permissions
    /// - Replaces all permissions in the target scope with imported ones
    /// - Updates inheritance configuration from the imported config
    /// - Sets the scope field of all imported permissions to the target scope
    ///
    /// Requirements: 8.2, 8.3, 8.4
    pub fn import(&mut self, config_json: &str, scope: PermissionScope) -> Result<()> {
        // Parse and validate the configuration first (before modifying anything)
        let config: PermissionConfig = serde_json::from_str(config_json)
            .context("Failed to parse permission configuration JSON")?;

        // Validate version (for future compatibility)
        Self::validate_config_version(&config.version)?;

        // Validate all permissions in the config
        for perm in &config.permissions {
            Self::validate_permission(perm)?;
        }

        // All validation passed - now apply the changes
        // Clear existing permissions in the target scope
        self.clear_scope(scope);

        // Import permissions with the target scope
        for mut perm in config.permissions {
            perm.scope = scope;
            let key = perm.tool.clone();
            match scope {
                PermissionScope::Global => {
                    self.global_permissions.insert(key, perm);
                }
                PermissionScope::Project => {
                    self.project_permissions.insert(key, perm);
                }
                PermissionScope::Session => {
                    self.session_permissions.insert(key, perm);
                }
            }
        }

        // Update inheritance configuration
        self.inheritance = config.inheritance;

        Ok(())
    }

    /// Validate configuration version
    ///
    /// Checks if the configuration version is supported.
    /// Currently supports version "1.0.0".
    fn validate_config_version(version: &str) -> Result<()> {
        // For now, we only support version 1.0.0
        // Future versions can add migration logic here
        match version {
            "1.0.0" => Ok(()),
            _ => anyhow::bail!(
                "Unsupported configuration version: {}. Supported versions: 1.0.0",
                version
            ),
        }
    }

    /// Validate a single permission
    ///
    /// Performs basic validation on a permission to ensure it's well-formed.
    fn validate_permission(perm: &ToolPermission) -> Result<()> {
        // Tool name must not be empty
        if perm.tool.is_empty() {
            anyhow::bail!("Permission tool name cannot be empty");
        }

        // Validate parameter restrictions
        for restriction in &perm.parameter_restrictions {
            if restriction.parameter.is_empty() {
                anyhow::bail!("Parameter restriction parameter name cannot be empty");
            }

            // Range restrictions must have at least min or max
            if restriction.restriction_type == RestrictionType::Range
                && restriction.min.is_none()
                && restriction.max.is_none()
            {
                anyhow::bail!(
                    "Range restriction for parameter '{}' must have at least min or max",
                    restriction.parameter
                );
            }

            // Pattern restrictions must have a pattern
            if restriction.restriction_type == RestrictionType::Pattern
                && restriction.pattern.is_none()
            {
                anyhow::bail!(
                    "Pattern restriction for parameter '{}' must have a pattern",
                    restriction.parameter
                );
            }

            // Whitelist/Blacklist restrictions should have values
            if (restriction.restriction_type == RestrictionType::Whitelist
                || restriction.restriction_type == RestrictionType::Blacklist)
                && restriction.values.is_none()
            {
                anyhow::bail!(
                    "{:?} restriction for parameter '{}' must have values",
                    restriction.restriction_type,
                    restriction.parameter
                );
            }
        }

        Ok(())
    }
}

impl Default for ToolPermissionManager {
    fn default() -> Self {
        Self::new(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permission::types::{
        ConditionOperator, ConditionType, ParameterRestriction, PermissionCondition,
        RestrictionType,
    };

    fn create_test_context() -> PermissionContext {
        PermissionContext {
            working_directory: PathBuf::from("/home/user/project"),
            session_id: "test-session".to_string(),
            timestamp: 1700000000,
            user: Some("testuser".to_string()),
            environment: HashMap::new(),
            metadata: HashMap::new(),
        }
    }

    fn create_simple_permission(
        tool: &str,
        allowed: bool,
        scope: PermissionScope,
    ) -> ToolPermission {
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

    #[test]
    fn test_new_manager() {
        let manager = ToolPermissionManager::new(None);
        assert!(manager.config_dir().is_none());
        assert_eq!(manager.permission_counts(), (0, 0, 0));
    }

    #[test]
    fn test_new_manager_with_config_dir() {
        let config_dir = PathBuf::from("/tmp/config");
        let manager = ToolPermissionManager::new(Some(config_dir.clone()));
        assert_eq!(manager.config_dir(), Some(&config_dir));
    }

    #[test]
    fn test_add_permission() {
        let mut manager = ToolPermissionManager::new(None);
        let perm = create_simple_permission("bash", true, PermissionScope::Global);

        manager.add_permission(perm, PermissionScope::Global);

        assert_eq!(manager.permission_counts(), (1, 0, 0));
        assert!(manager.get_tool_permission("bash").is_some());
    }

    #[test]
    fn test_add_permission_different_scopes() {
        let mut manager = ToolPermissionManager::new(None);

        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission("file_read", true, PermissionScope::Project),
            PermissionScope::Project,
        );
        manager.add_permission(
            create_simple_permission("http_get", true, PermissionScope::Session),
            PermissionScope::Session,
        );

        assert_eq!(manager.permission_counts(), (1, 1, 1));
    }

    #[test]
    fn test_remove_permission_specific_scope() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission("bash", false, PermissionScope::Session),
            PermissionScope::Session,
        );

        manager.remove_permission("bash", Some(PermissionScope::Global));

        assert_eq!(manager.permission_counts(), (0, 0, 1));
    }

    #[test]
    fn test_remove_permission_all_scopes() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission("bash", false, PermissionScope::Session),
            PermissionScope::Session,
        );

        manager.remove_permission("bash", None);

        assert_eq!(manager.permission_counts(), (0, 0, 0));
    }

    #[test]
    fn test_get_permissions_by_scope() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission("file_read", true, PermissionScope::Project),
            PermissionScope::Project,
        );

        let global = manager.get_permissions(Some(PermissionScope::Global));
        let project = manager.get_permissions(Some(PermissionScope::Project));
        let all = manager.get_permissions(None);

        assert_eq!(global.len(), 1);
        assert_eq!(project.len(), 1);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_get_tool_permission_priority() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission("bash", false, PermissionScope::Session),
            PermissionScope::Session,
        );

        let perm = manager.get_tool_permission("bash").unwrap();
        // Session has higher priority
        assert!(!perm.allowed);
        assert_eq!(perm.scope, PermissionScope::Session);
    }

    #[test]
    fn test_is_allowed_no_rules() {
        let manager = ToolPermissionManager::new(None);
        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed("any_tool", &params, &context);

        assert!(result.allowed);
        assert!(result.matched_rule.is_none());
    }

    #[test]
    fn test_is_allowed_explicit_allow() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed("bash", &params, &context);

        assert!(result.allowed);
        assert!(result.matched_rule.is_some());
    }

    #[test]
    fn test_is_allowed_explicit_deny() {
        let mut manager = ToolPermissionManager::new(None);
        let mut perm = create_simple_permission("bash", false, PermissionScope::Global);
        perm.reason = Some("Dangerous command".to_string());
        manager.add_permission(perm, PermissionScope::Global);

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed("bash", &params, &context);

        assert!(!result.allowed);
        assert!(result.matched_rule.is_some());
        assert!(result.reason.is_some());
    }

    #[test]
    fn test_is_allowed_wildcard_pattern() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("file_*", true, PermissionScope::Global),
            PermissionScope::Global,
        );

        let context = create_test_context();
        let params = HashMap::new();

        assert!(manager.is_allowed("file_read", &params, &context).allowed);
        assert!(manager.is_allowed("file_write", &params, &context).allowed);
        assert!(manager.is_allowed("file_delete", &params, &context).allowed);
    }

    #[test]
    fn test_is_allowed_expired_rule() {
        let mut manager = ToolPermissionManager::new(None);
        let mut perm = create_simple_permission("bash", false, PermissionScope::Global);
        perm.expires_at = Some(1600000000); // Expired
        manager.add_permission(perm, PermissionScope::Global);

        let context = create_test_context(); // timestamp = 1700000000

        let params = HashMap::new();
        let result = manager.is_allowed("bash", &params, &context);

        // Expired rule should be skipped, default allow
        assert!(result.allowed);
    }

    #[test]
    fn test_is_allowed_with_conditions() {
        let mut manager = ToolPermissionManager::new(None);
        let mut perm = create_simple_permission("bash", true, PermissionScope::Global);
        perm.conditions = vec![PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Contains,
            value: serde_json::json!("project"),
            validator: None,
            description: None,
        }];
        manager.add_permission(perm, PermissionScope::Global);

        let context = create_test_context(); // working_directory contains "project"
        let params = HashMap::new();

        let result = manager.is_allowed("bash", &params, &context);
        assert!(result.allowed);
    }

    #[test]
    fn test_is_allowed_conditions_not_met() {
        let mut manager = ToolPermissionManager::new(None);
        let mut perm = create_simple_permission("bash", true, PermissionScope::Global);
        perm.conditions = vec![PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Contains,
            value: serde_json::json!("safe_directory"),
            validator: None,
            description: None,
        }];
        manager.add_permission(perm, PermissionScope::Global);

        let context = create_test_context(); // working_directory does NOT contain "safe_directory"
        let params = HashMap::new();

        let result = manager.is_allowed("bash", &params, &context);
        // Condition not met, rule skipped, default allow
        assert!(result.allowed);
        assert!(result.matched_rule.is_none());
    }

    #[test]
    fn test_is_allowed_parameter_restriction_pass() {
        let mut manager = ToolPermissionManager::new(None);
        let mut perm = create_simple_permission("bash", true, PermissionScope::Global);
        perm.parameter_restrictions = vec![ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![serde_json::json!("ls"), serde_json::json!("cat")]),
            pattern: None,
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        }];
        manager.add_permission(perm, PermissionScope::Global);

        let context = create_test_context();
        let mut params = HashMap::new();
        params.insert("command".to_string(), serde_json::json!("ls"));

        let result = manager.is_allowed("bash", &params, &context);
        assert!(result.allowed);
        assert!(result.restricted);
    }

    #[test]
    fn test_is_allowed_parameter_restriction_fail() {
        let mut manager = ToolPermissionManager::new(None);
        let mut perm = create_simple_permission("bash", true, PermissionScope::Global);
        perm.parameter_restrictions = vec![ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![serde_json::json!("ls"), serde_json::json!("cat")]),
            pattern: None,
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        }];
        manager.add_permission(perm, PermissionScope::Global);

        let context = create_test_context();
        let mut params = HashMap::new();
        params.insert("command".to_string(), serde_json::json!("rm -rf"));

        let result = manager.is_allowed("bash", &params, &context);
        assert!(!result.allowed);
        assert!(result.restricted);
        assert!(!result.violations.is_empty());
    }

    #[test]
    fn test_is_allowed_priority_order() {
        let mut manager = ToolPermissionManager::new(None);

        // Low priority: allow
        let mut low_perm = create_simple_permission("bash", true, PermissionScope::Global);
        low_perm.priority = 1;
        manager.add_permission(low_perm, PermissionScope::Global);

        // High priority: deny
        let mut high_perm = create_simple_permission("bash", false, PermissionScope::Session);
        high_perm.priority = 10;
        manager.add_permission(high_perm, PermissionScope::Session);

        let context = create_test_context();
        let params = HashMap::new();

        let result = manager.is_allowed("bash", &params, &context);
        // High priority rule should win
        assert!(!result.allowed);
    }

    #[test]
    fn test_generate_suggestions_denied() {
        let mut perm = create_simple_permission("bash", false, PermissionScope::Global);
        perm.reason = Some("Security policy".to_string());

        let suggestions = ToolPermissionManager::generate_suggestions(&perm, &[]);

        assert!(!suggestions.is_empty());
        assert!(suggestions.iter().any(|s| s.contains("Security policy")));
    }

    #[test]
    fn test_generate_suggestions_with_violations() {
        let perm = create_simple_permission("bash", true, PermissionScope::Global);
        let violations = vec!["Parameter 'command' value \"rm\" is not in whitelist".to_string()];

        let suggestions = ToolPermissionManager::generate_suggestions(&perm, &violations);

        assert!(!suggestions.is_empty());
        assert!(suggestions.iter().any(|s| s.contains("whitelist")));
    }

    #[test]
    fn test_clear_scope() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission("file", true, PermissionScope::Session),
            PermissionScope::Session,
        );

        manager.clear_scope(PermissionScope::Global);

        assert_eq!(manager.permission_counts(), (0, 0, 1));
    }

    #[test]
    fn test_clear_all() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission("file", true, PermissionScope::Session),
            PermissionScope::Session,
        );

        manager.clear_all();

        assert_eq!(manager.permission_counts(), (0, 0, 0));
    }

    #[test]
    fn test_set_inheritance() {
        let mut manager = ToolPermissionManager::new(None);
        let new_inheritance = PermissionInheritance {
            inherit_global: false,
            inherit_project: true,
            override_global: false,
            merge_strategy: crate::permission::types::MergeStrategy::Merge,
        };

        manager.set_inheritance(new_inheritance.clone());

        assert_eq!(manager.inheritance(), &new_inheritance);
    }

    #[test]
    fn test_update_permission_allowed() {
        use crate::permission::types::ToolPermissionUpdate;

        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );

        let update = ToolPermissionUpdate::new().with_allowed(false);
        let result = manager.update_permission("bash", update, PermissionScope::Global);

        assert!(result);
        let perm = manager.get_tool_permission("bash").unwrap();
        assert!(!perm.allowed);
    }

    #[test]
    fn test_update_permission_priority() {
        use crate::permission::types::ToolPermissionUpdate;

        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );

        let update = ToolPermissionUpdate::new().with_priority(100);
        let result = manager.update_permission("bash", update, PermissionScope::Global);

        assert!(result);
        let perm = manager.get_tool_permission("bash").unwrap();
        assert_eq!(perm.priority, 100);
    }

    #[test]
    fn test_update_permission_reason() {
        use crate::permission::types::ToolPermissionUpdate;

        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );

        let update = ToolPermissionUpdate::new().with_reason(Some("Updated reason".to_string()));
        let result = manager.update_permission("bash", update, PermissionScope::Global);

        assert!(result);
        let perm = manager.get_tool_permission("bash").unwrap();
        assert_eq!(perm.reason, Some("Updated reason".to_string()));
    }

    #[test]
    fn test_update_permission_not_found() {
        use crate::permission::types::ToolPermissionUpdate;

        let mut manager = ToolPermissionManager::new(None);

        let update = ToolPermissionUpdate::new().with_allowed(false);
        let result = manager.update_permission("nonexistent", update, PermissionScope::Global);

        assert!(!result);
    }

    #[test]
    fn test_update_permission_wrong_scope() {
        use crate::permission::types::ToolPermissionUpdate;

        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );

        // Try to update in Session scope where it doesn't exist
        let update = ToolPermissionUpdate::new().with_allowed(false);
        let result = manager.update_permission("bash", update, PermissionScope::Session);

        assert!(!result);
        // Original permission should be unchanged
        let perm = manager.get_tool_permission("bash").unwrap();
        assert!(perm.allowed);
    }

    #[test]
    fn test_update_permission_multiple_fields() {
        use crate::permission::types::ToolPermissionUpdate;

        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Project),
            PermissionScope::Project,
        );

        let update = ToolPermissionUpdate::new()
            .with_allowed(false)
            .with_priority(50)
            .with_reason(Some("Security update".to_string()))
            .with_expires_at(Some(1800000000));

        let result = manager.update_permission("bash", update, PermissionScope::Project);

        assert!(result);
        let perm = manager.get_tool_permission("bash").unwrap();
        assert!(!perm.allowed);
        assert_eq!(perm.priority, 50);
        assert_eq!(perm.reason, Some("Security update".to_string()));
        assert_eq!(perm.expires_at, Some(1800000000));
    }

    #[test]
    fn test_update_permission_clear_reason() {
        use crate::permission::types::ToolPermissionUpdate;

        let mut manager = ToolPermissionManager::new(None);
        let mut perm = create_simple_permission("bash", true, PermissionScope::Global);
        perm.reason = Some("Initial reason".to_string());
        manager.add_permission(perm, PermissionScope::Global);

        // Clear the reason by setting it to None
        let update = ToolPermissionUpdate::new().with_reason(None);
        let result = manager.update_permission("bash", update, PermissionScope::Global);

        assert!(result);
        let perm = manager.get_tool_permission("bash").unwrap();
        assert!(perm.reason.is_none());
    }

    // ========================================================================
    // Export/Import Tests
    // ========================================================================

    #[test]
    fn test_export_empty() {
        let manager = ToolPermissionManager::new(None);
        let result = manager.export(None);

        assert!(result.is_ok());
        let json = result.unwrap();
        assert!(json.contains("\"version\": \"1.0.0\""));
        assert!(json.contains("\"permissions\": []"));
    }

    #[test]
    fn test_export_with_permissions() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission("file_read", false, PermissionScope::Project),
            PermissionScope::Project,
        );

        let result = manager.export(None);

        assert!(result.is_ok());
        let json = result.unwrap();
        assert!(json.contains("\"version\": \"1.0.0\""));
        assert!(json.contains("\"bash\""));
        assert!(json.contains("\"file_read\""));
    }

    #[test]
    fn test_export_specific_scope() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("bash", true, PermissionScope::Global),
            PermissionScope::Global,
        );
        manager.add_permission(
            create_simple_permission("file_read", false, PermissionScope::Project),
            PermissionScope::Project,
        );

        let result = manager.export(Some(PermissionScope::Global));

        assert!(result.is_ok());
        let json = result.unwrap();
        assert!(json.contains("\"bash\""));
        assert!(!json.contains("\"file_read\""));
    }

    #[test]
    fn test_import_valid_config() {
        let mut manager = ToolPermissionManager::new(None);
        let config_json = r#"{
            "version": "1.0.0",
            "inheritance": {
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            },
            "permissions": [
                {
                    "tool": "bash",
                    "allowed": true,
                    "priority": 10,
                    "conditions": [],
                    "parameter_restrictions": [],
                    "scope": "Global",
                    "reason": "Test permission",
                    "expires_at": null,
                    "metadata": {}
                }
            ]
        }"#;

        let result = manager.import(config_json, PermissionScope::Global);

        assert!(result.is_ok());
        assert_eq!(manager.permission_counts(), (1, 0, 0));
        let perm = manager.get_tool_permission("bash").unwrap();
        assert!(perm.allowed);
        assert_eq!(perm.priority, 10);
    }

    #[test]
    fn test_import_invalid_json() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("existing", true, PermissionScope::Global),
            PermissionScope::Global,
        );

        let result = manager.import("invalid json", PermissionScope::Global);

        assert!(result.is_err());
        // Existing permissions should remain unchanged
        assert_eq!(manager.permission_counts(), (1, 0, 0));
    }

    #[test]
    fn test_import_invalid_version() {
        let mut manager = ToolPermissionManager::new(None);
        let config_json = r#"{
            "version": "99.0.0",
            "inheritance": {
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            },
            "permissions": []
        }"#;

        let result = manager.import(config_json, PermissionScope::Global);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Unsupported configuration version"));
    }

    #[test]
    fn test_import_empty_tool_name() {
        let mut manager = ToolPermissionManager::new(None);
        let config_json = r#"{
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

        let result = manager.import(config_json, PermissionScope::Global);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("tool name cannot be empty"));
    }

    #[test]
    fn test_import_replaces_existing() {
        let mut manager = ToolPermissionManager::new(None);
        manager.add_permission(
            create_simple_permission("old_tool", true, PermissionScope::Global),
            PermissionScope::Global,
        );

        let config_json = r#"{
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
                    "allowed": false,
                    "priority": 5,
                    "conditions": [],
                    "parameter_restrictions": [],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {}
                }
            ]
        }"#;

        let result = manager.import(config_json, PermissionScope::Global);

        assert!(result.is_ok());
        assert_eq!(manager.permission_counts(), (1, 0, 0));
        assert!(manager.get_tool_permission("old_tool").is_none());
        assert!(manager.get_tool_permission("new_tool").is_some());
    }

    #[test]
    fn test_import_sets_target_scope() {
        let mut manager = ToolPermissionManager::new(None);
        let config_json = r#"{
            "version": "1.0.0",
            "inheritance": {
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            },
            "permissions": [
                {
                    "tool": "bash",
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

        // Import into Session scope (different from the scope in JSON)
        let result = manager.import(config_json, PermissionScope::Session);

        assert!(result.is_ok());
        assert_eq!(manager.permission_counts(), (0, 0, 1));
        let perm = manager.get_tool_permission("bash").unwrap();
        assert_eq!(perm.scope, PermissionScope::Session);
    }

    #[test]
    fn test_export_import_round_trip() {
        let mut manager = ToolPermissionManager::new(None);
        let mut perm = create_simple_permission("bash_*", true, PermissionScope::Global);
        perm.priority = 42;
        perm.reason = Some("Test reason".to_string());
        manager.add_permission(perm, PermissionScope::Global);

        // Export
        let exported = manager.export(Some(PermissionScope::Global)).unwrap();

        // Create new manager and import
        let mut new_manager = ToolPermissionManager::new(None);
        let result = new_manager.import(&exported, PermissionScope::Global);

        assert!(result.is_ok());
        let imported_perm = new_manager.get_tool_permission("bash_*").unwrap();
        assert_eq!(imported_perm.tool, "bash_*");
        assert!(imported_perm.allowed);
        assert_eq!(imported_perm.priority, 42);
        assert_eq!(imported_perm.reason, Some("Test reason".to_string()));
    }

    #[test]
    fn test_import_invalid_range_restriction() {
        let mut manager = ToolPermissionManager::new(None);
        let config_json = r#"{
            "version": "1.0.0",
            "inheritance": {
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            },
            "permissions": [
                {
                    "tool": "bash",
                    "allowed": true,
                    "priority": 0,
                    "conditions": [],
                    "parameter_restrictions": [
                        {
                            "parameter": "count",
                            "restriction_type": "Range",
                            "values": null,
                            "pattern": null,
                            "min": null,
                            "max": null,
                            "required": false,
                            "description": null
                        }
                    ],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {}
                }
            ]
        }"#;

        let result = manager.import(config_json, PermissionScope::Global);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must have at least min or max"));
    }

    #[test]
    fn test_import_invalid_pattern_restriction() {
        let mut manager = ToolPermissionManager::new(None);
        let config_json = r#"{
            "version": "1.0.0",
            "inheritance": {
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            },
            "permissions": [
                {
                    "tool": "bash",
                    "allowed": true,
                    "priority": 0,
                    "conditions": [],
                    "parameter_restrictions": [
                        {
                            "parameter": "command",
                            "restriction_type": "Pattern",
                            "values": null,
                            "pattern": null,
                            "min": null,
                            "max": null,
                            "required": false,
                            "description": null
                        }
                    ],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {}
                }
            ]
        }"#;

        let result = manager.import(config_json, PermissionScope::Global);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must have a pattern"));
    }

    #[test]
    fn test_import_invalid_whitelist_restriction() {
        let mut manager = ToolPermissionManager::new(None);
        let config_json = r#"{
            "version": "1.0.0",
            "inheritance": {
                "inherit_global": true,
                "inherit_project": true,
                "override_global": true,
                "merge_strategy": "Override"
            },
            "permissions": [
                {
                    "tool": "bash",
                    "allowed": true,
                    "priority": 0,
                    "conditions": [],
                    "parameter_restrictions": [
                        {
                            "parameter": "command",
                            "restriction_type": "Whitelist",
                            "values": null,
                            "pattern": null,
                            "min": null,
                            "max": null,
                            "required": false,
                            "description": null
                        }
                    ],
                    "scope": "Global",
                    "reason": null,
                    "expires_at": null,
                    "metadata": {}
                }
            ]
        }"#;

        let result = manager.import(config_json, PermissionScope::Global);

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must have values"));
    }

    // ========================================================================
    // Template Tests
    // ========================================================================

    #[test]
    fn test_register_template() {
        let mut manager = ToolPermissionManager::new(None);
        let template = vec![create_simple_permission(
            "custom_tool",
            true,
            PermissionScope::Global,
        )];

        manager.register_template("my_template", template);

        assert!(manager.has_template("my_template"));
        assert!(manager.get_template("my_template").is_some());
    }

    #[test]
    fn test_register_template_replaces_existing() {
        let mut manager = ToolPermissionManager::new(None);
        let template1 = vec![create_simple_permission(
            "tool1",
            true,
            PermissionScope::Global,
        )];
        let template2 = vec![create_simple_permission(
            "tool2",
            false,
            PermissionScope::Global,
        )];

        manager.register_template("my_template", template1);
        manager.register_template("my_template", template2);

        let template = manager.get_template("my_template").unwrap();
        assert_eq!(template.len(), 1);
        assert_eq!(template[0].tool, "tool2");
    }

    #[test]
    fn test_apply_template() {
        let mut manager = ToolPermissionManager::new(None);
        let template = vec![
            create_simple_permission("tool1", true, PermissionScope::Global),
            create_simple_permission("tool2", false, PermissionScope::Global),
        ];

        manager.register_template("my_template", template);
        let result = manager.apply_template("my_template", PermissionScope::Project);

        assert!(result);
        assert_eq!(manager.permission_counts(), (0, 2, 0));

        // Check that scope was updated
        let perm = manager.get_tool_permission("tool1").unwrap();
        assert_eq!(perm.scope, PermissionScope::Project);
    }

    #[test]
    fn test_apply_template_not_found() {
        let mut manager = ToolPermissionManager::new(None);

        let result = manager.apply_template("nonexistent", PermissionScope::Global);

        assert!(!result);
        assert_eq!(manager.permission_counts(), (0, 0, 0));
    }

    #[test]
    fn test_remove_template() {
        let mut manager = ToolPermissionManager::new(None);
        let template = vec![create_simple_permission(
            "tool1",
            true,
            PermissionScope::Global,
        )];

        manager.register_template("my_template", template);
        let removed = manager.remove_template("my_template");

        assert!(removed.is_some());
        assert!(!manager.has_template("my_template"));
    }

    #[test]
    fn test_remove_template_not_found() {
        let mut manager = ToolPermissionManager::new(None);

        let removed = manager.remove_template("nonexistent");

        assert!(removed.is_none());
    }

    #[test]
    fn test_list_templates() {
        let mut manager = ToolPermissionManager::new(None);
        manager.register_template("template1", vec![]);
        manager.register_template("template2", vec![]);
        manager.register_template("template3", vec![]);

        let templates = manager.list_templates();

        assert_eq!(templates.len(), 3);
        assert!(templates.iter().any(|t| *t == "template1"));
        assert!(templates.iter().any(|t| *t == "template2"));
        assert!(templates.iter().any(|t| *t == "template3"));
    }

    #[test]
    fn test_has_template() {
        let mut manager = ToolPermissionManager::new(None);
        manager.register_template("exists", vec![]);

        assert!(manager.has_template("exists"));
        assert!(!manager.has_template("not_exists"));
    }

    #[test]
    fn test_apply_template_to_different_scopes() {
        let mut manager = ToolPermissionManager::new(None);
        let template = vec![create_simple_permission(
            "tool",
            true,
            PermissionScope::Global,
        )];

        manager.register_template("my_template", template);

        // Apply to Global
        manager.apply_template("my_template", PermissionScope::Global);
        assert_eq!(manager.permission_counts(), (1, 0, 0));

        // Apply to Session
        manager.apply_template("my_template", PermissionScope::Session);
        assert_eq!(manager.permission_counts(), (1, 0, 1));

        // Check scopes are correct
        let global_perms = manager.get_permissions(Some(PermissionScope::Global));
        let session_perms = manager.get_permissions(Some(PermissionScope::Session));

        assert_eq!(global_perms[0].scope, PermissionScope::Global);
        assert_eq!(session_perms[0].scope, PermissionScope::Session);
    }
}
