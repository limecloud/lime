//! Tool Registry Module
//!
//! This module implements the `ToolRegistry` that manages all available tools
//! in the system. It supports:
//! - Native tool registration (high priority)
//! - MCP tool registration (low priority)
//! - Tool lookup and execution
//! - Permission checking integration
//! - Audit logging integration
//!
//! Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.1, 8.2, 11.3, 11.4

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;

use super::base::{PermissionBehavior, Tool};
use super::context::{ToolContext, ToolDefinition, ToolResult};
use super::error::ToolError;
use crate::permission::{
    AuditLogEntry, AuditLogLevel, AuditLogger, PermissionContext, ToolPermissionManager,
};

/// Callback type for permission requests that require user confirmation
///
/// When a tool's permission check returns `Ask`, this callback is invoked
/// to get user confirmation before proceeding with execution.
pub type PermissionRequestCallback =
    Box<dyn Fn(String, String) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

/// MCP Tool Wrapper
///
/// Wraps an MCP tool to implement the `Tool` trait, allowing MCP tools
/// to be registered alongside native tools in the registry.
///
/// Requirements: 11.1, 11.2
#[derive(Clone)]
pub struct McpToolWrapper {
    /// Tool name
    name: String,
    /// Tool description
    description: String,
    /// Input schema
    input_schema: serde_json::Value,
    /// MCP server name
    server_name: String,
}

impl McpToolWrapper {
    /// Create a new MCP tool wrapper
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: serde_json::Value,
        server_name: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            input_schema,
            server_name: server_name.into(),
        }
    }

    /// Get the MCP server name
    pub fn server_name(&self) -> &str {
        &self.server_name
    }
}

#[async_trait]
impl Tool for McpToolWrapper {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> serde_json::Value {
        self.input_schema.clone()
    }

    async fn execute(
        &self,
        _params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // MCP tool execution is handled externally
        // This is a placeholder that should be overridden by the actual MCP execution logic
        Err(ToolError::execution_failed(
            "MCP tool execution must be handled by the MCP client",
        ))
    }
}

/// Tool Registry
///
/// Manages all available tools in the system, including both native tools
/// and MCP tools. Native tools have higher priority than MCP tools with
/// the same name.
///
/// Requirements: 2.1, 2.2, 2.3
pub struct ToolRegistry {
    /// Native tools (high priority)
    native_tools: HashMap<String, Box<dyn Tool>>,
    /// Compatibility aliases that resolve to canonical native tool names
    native_aliases: HashMap<String, String>,
    /// MCP tools (low priority)
    mcp_tools: HashMap<String, McpToolWrapper>,
    /// Permission manager for checking tool permissions
    permission_manager: Option<Arc<ToolPermissionManager>>,
    /// Audit logger for recording tool executions
    audit_logger: Option<Arc<AuditLogger>>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    /// Create a new empty tool registry
    pub fn new() -> Self {
        Self {
            native_tools: HashMap::new(),
            native_aliases: HashMap::new(),
            mcp_tools: HashMap::new(),
            permission_manager: None,
            audit_logger: None,
        }
    }

    /// Create a new tool registry with permission manager and audit logger
    pub fn with_managers(
        permission_manager: Arc<ToolPermissionManager>,
        audit_logger: Arc<AuditLogger>,
    ) -> Self {
        Self {
            native_tools: HashMap::new(),
            native_aliases: HashMap::new(),
            mcp_tools: HashMap::new(),
            permission_manager: Some(permission_manager),
            audit_logger: Some(audit_logger),
        }
    }

    /// Set the permission manager
    pub fn set_permission_manager(&mut self, manager: Arc<ToolPermissionManager>) {
        self.permission_manager = Some(manager);
    }

    /// Set the audit logger
    pub fn set_audit_logger(&mut self, logger: Arc<AuditLogger>) {
        self.audit_logger = Some(logger);
    }

    /// Get the permission manager
    pub fn permission_manager(&self) -> Option<&Arc<ToolPermissionManager>> {
        self.permission_manager.as_ref()
    }

    /// Get the audit logger
    pub fn audit_logger(&self) -> Option<&Arc<AuditLogger>> {
        self.audit_logger.as_ref()
    }
}

// =============================================================================
// Registration Methods (Requirements: 2.1, 11.4)
// =============================================================================

impl ToolRegistry {
    fn default_native_aliases(name: &str) -> &'static [&'static str] {
        match name {
            "Agent" => &["AgentTool"],
            "AskUserQuestion" => &["AskUserQuestionTool"],
            "Bash" => &["BashTool"],
            "Config" => &["ConfigTool"],
            "Edit" => &["FileEditTool"],
            "Read" => &["FileReadTool"],
            "Write" => &["FileWriteTool"],
            "EnterPlanMode" => &["EnterPlanModeTool"],
            "ExitPlanMode" => &["ExitPlanModeTool"],
            "EnterWorktree" => &["EnterWorktreeTool"],
            "ExitWorktree" => &["ExitWorktreeTool"],
            "Glob" => &["GlobTool"],
            "Grep" => &["GrepTool"],
            "LSP" => &["LSPTool"],
            "NotebookEdit" => &["NotebookEditTool"],
            "PowerShell" => &["PowerShellTool"],
            "RemoteTrigger" => &["RemoteTriggerTool"],
            "SendUserMessage" => &["BriefTool"],
            "Skill" => &["SkillTool"],
            "Sleep" => &["SleepTool"],
            "ToolSearch" => &["ToolSearchTool"],
            "WebFetch" => &["WebFetchTool"],
            "WebSearch" => &["WebSearchTool"],
            _ => &[],
        }
    }

    fn find_native_key(&self, name: &str) -> Option<&String> {
        self.native_tools
            .keys()
            .find(|registered| registered.eq_ignore_ascii_case(name))
    }

    fn find_native_alias_key(&self, name: &str) -> Option<&String> {
        self.native_aliases
            .keys()
            .find(|registered| registered.eq_ignore_ascii_case(name))
    }

    fn resolve_native_key(&self, name: &str) -> Option<&String> {
        if let Some(registered) = self.find_native_key(name) {
            return Some(registered);
        }

        let canonical_name = self
            .find_native_alias_key(name)
            .and_then(|alias| self.native_aliases.get(alias))?;
        self.find_native_key(canonical_name)
    }

    fn remove_native_aliases_for(&mut self, canonical_name: &str) {
        self.native_aliases
            .retain(|_, target| !target.eq_ignore_ascii_case(canonical_name));
    }

    fn find_mcp_key(&self, name: &str) -> Option<&String> {
        self.mcp_tools
            .keys()
            .find(|registered| registered.eq_ignore_ascii_case(name))
    }

    /// Register a native tool
    ///
    /// Native tools have higher priority than MCP tools with the same name.
    /// If a native tool with the same name already exists, it will be replaced.
    ///
    /// # Arguments
    /// * `tool` - The tool to register
    ///
    /// Requirements: 2.1
    pub fn register(&mut self, tool: Box<dyn Tool>) {
        let name = tool.name().to_string();
        let aliases = tool
            .aliases()
            .iter()
            .copied()
            .chain(Self::default_native_aliases(&name).iter().copied())
            .collect::<Vec<_>>();
        if let Some(existing_name) = self.find_native_key(&name).cloned() {
            self.remove_native_aliases_for(&existing_name);
            self.native_tools.remove(&existing_name);
        }
        if let Some(existing_alias_name) = self.find_native_alias_key(&name).cloned() {
            self.native_aliases.remove(&existing_alias_name);
        }

        self.native_tools.insert(name.clone(), tool);
        self.remove_native_aliases_for(&name);

        for alias in aliases {
            let alias = alias.trim();
            if alias.is_empty() || alias.eq_ignore_ascii_case(&name) {
                continue;
            }
            if self.find_native_key(alias).is_some() {
                continue;
            }
            if let Some(existing_alias_name) = self.find_native_alias_key(alias).cloned() {
                self.native_aliases.remove(&existing_alias_name);
            }
            self.native_aliases.insert(alias.to_string(), name.clone());
        }
    }

    /// Register an MCP tool
    ///
    /// MCP tools have lower priority than native tools. If a native tool
    /// with the same name exists, the MCP tool will be shadowed.
    ///
    /// # Arguments
    /// * `name` - The tool name
    /// * `tool` - The MCP tool wrapper
    ///
    /// Requirements: 11.4
    pub fn register_mcp(&mut self, name: String, tool: McpToolWrapper) {
        if let Some(existing_name) = self.find_mcp_key(&name).cloned() {
            self.mcp_tools.remove(&existing_name);
        }
        self.mcp_tools.insert(name, tool);
    }

    /// Unregister a native tool
    ///
    /// # Arguments
    /// * `name` - The name of the tool to unregister
    ///
    /// # Returns
    /// The unregistered tool if it existed
    pub fn unregister(&mut self, name: &str) -> Option<Box<dyn Tool>> {
        let key = self.find_native_key(name).cloned()?;
        self.remove_native_aliases_for(&key);
        self.native_tools.remove(&key)
    }

    /// Unregister an MCP tool
    ///
    /// # Arguments
    /// * `name` - The name of the tool to unregister
    ///
    /// # Returns
    /// The unregistered MCP tool wrapper if it existed
    pub fn unregister_mcp(&mut self, name: &str) -> Option<McpToolWrapper> {
        let key = self.find_mcp_key(name).cloned()?;
        self.mcp_tools.remove(&key)
    }

    /// Check if a tool is registered (native or MCP)
    ///
    /// # Arguments
    /// * `name` - The tool name to check
    ///
    /// # Returns
    /// `true` if the tool is registered
    pub fn contains(&self, name: &str) -> bool {
        self.resolve_native_key(name).is_some() || self.find_mcp_key(name).is_some()
    }

    /// Check if a native tool is registered
    pub fn contains_native(&self, name: &str) -> bool {
        self.resolve_native_key(name).is_some()
    }

    /// Check if an MCP tool is registered
    pub fn contains_mcp(&self, name: &str) -> bool {
        self.find_mcp_key(name).is_some()
    }

    /// Get the number of registered native tools
    pub fn native_tool_count(&self) -> usize {
        self.native_tools.len()
    }

    /// Get the number of registered MCP tools
    pub fn mcp_tool_count(&self) -> usize {
        self.mcp_tools.len()
    }

    /// Get the total number of registered tools
    pub fn tool_count(&self) -> usize {
        // Count unique tool names (native tools shadow MCP tools)
        let mut names: std::collections::HashSet<&str> =
            self.native_tools.keys().map(|s| s.as_str()).collect();
        for name in self.mcp_tools.keys() {
            names.insert(name.as_str());
        }
        names.len()
    }
}

// =============================================================================
// Query Methods (Requirements: 2.2, 2.3, 2.4)
// =============================================================================

impl ToolRegistry {
    /// Get a tool by name (native tools have priority)
    ///
    /// # Arguments
    /// * `name` - The tool name to look up
    ///
    /// # Returns
    /// A reference to the tool if found, with native tools taking priority
    ///
    /// Requirements: 2.2
    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        // Native tools have priority over MCP tools
        if let Some(tool) = self
            .resolve_native_key(name)
            .and_then(|registered| self.native_tools.get(registered))
        {
            return Some(tool.as_ref());
        }
        if let Some(tool) = self
            .find_mcp_key(name)
            .and_then(|registered| self.mcp_tools.get(registered))
        {
            return Some(tool as &dyn Tool);
        }
        None
    }

    /// Get all registered tools
    ///
    /// Returns all tools with native tools taking priority over MCP tools
    /// with the same name.
    ///
    /// # Returns
    /// A vector of references to all registered tools
    ///
    /// Requirements: 2.3
    pub fn get_all(&self) -> Vec<&dyn Tool> {
        let mut tools: Vec<&dyn Tool> = Vec::new();
        let mut seen_names: std::collections::HashSet<&str> = std::collections::HashSet::new();

        // Add native tools first (higher priority)
        for (name, tool) in &self.native_tools {
            tools.push(tool.as_ref());
            seen_names.insert(name.as_str());
        }

        // Add MCP tools that aren't shadowed by native tools
        for (name, tool) in &self.mcp_tools {
            if !seen_names.contains(name.as_str()) {
                tools.push(tool as &dyn Tool);
            }
        }

        tools
    }

    /// Get all tool definitions for LLM consumption
    ///
    /// Returns definitions for all tools, with native tools taking priority
    /// over MCP tools with the same name.
    ///
    /// # Returns
    /// A vector of tool definitions
    ///
    /// Requirements: 2.4
    pub fn get_definitions(&self) -> Vec<ToolDefinition> {
        self.get_all()
            .iter()
            .map(|tool| tool.get_definition())
            .collect()
    }

    /// Get all native tool names
    pub fn native_tool_names(&self) -> Vec<&str> {
        self.native_tools.keys().map(|s| s.as_str()).collect()
    }

    /// Get all MCP tool names
    pub fn mcp_tool_names(&self) -> Vec<&str> {
        self.mcp_tools.keys().map(|s| s.as_str()).collect()
    }

    /// Get all tool names (unique, native tools shadow MCP tools)
    pub fn tool_names(&self) -> Vec<&str> {
        let mut names: std::collections::HashSet<&str> =
            self.native_tools.keys().map(|s| s.as_str()).collect();
        for name in self.mcp_tools.keys() {
            names.insert(name.as_str());
        }
        names.into_iter().collect()
    }

    /// Check if a tool is a native tool
    pub fn is_native(&self, name: &str) -> bool {
        self.resolve_native_key(name).is_some()
    }

    /// Check if a tool is an MCP tool (and not shadowed by a native tool)
    pub fn is_mcp(&self, name: &str) -> bool {
        self.find_native_key(name).is_none() && self.find_mcp_key(name).is_some()
    }
}

// =============================================================================
// Execution Methods (Requirements: 2.5, 2.6, 8.1, 8.2)
// =============================================================================

impl ToolRegistry {
    /// Execute a tool by name with permission checking and audit logging
    ///
    /// This method:
    /// 1. Looks up the tool by name
    /// 2. Performs permission check (if permission manager is configured)
    /// 3. Handles permission request callback for 'Ask' behavior
    /// 4. Executes the tool
    /// 5. Records audit log (if audit logger is configured)
    ///
    /// # Arguments
    /// * `name` - The tool name to execute
    /// * `params` - The tool parameters
    /// * `context` - The execution context
    /// * `on_permission_request` - Optional callback for permission requests
    ///
    /// # Returns
    /// * `Ok(ToolResult)` - The execution result
    /// * `Err(ToolError)` - If the tool is not found, permission denied, or execution fails
    ///
    /// Requirements: 2.5, 2.6, 8.1, 8.2
    pub async fn execute(
        &self,
        name: &str,
        params: serde_json::Value,
        context: &ToolContext,
        on_permission_request: Option<PermissionRequestCallback>,
    ) -> Result<ToolResult, ToolError> {
        let start_time = Instant::now();

        // Step 1: Look up the tool
        let tool = self.get(name).ok_or_else(|| ToolError::not_found(name))?;

        // Step 2: Check tool-level permissions
        let permission_result = tool.check_permissions(&params, context).await;

        // Handle tool-level permission check result
        match permission_result.behavior {
            PermissionBehavior::Deny => {
                let reason = permission_result
                    .message
                    .unwrap_or_else(|| format!("Permission denied for tool '{}'", name));

                // Log permission denial
                self.log_permission_denied(name, &params, context, &reason, start_time.elapsed());

                return Err(ToolError::permission_denied(reason));
            }
            PermissionBehavior::Ask => {
                // Handle user confirmation request
                if let Some(callback) = on_permission_request {
                    let message = permission_result.message.unwrap_or_else(|| {
                        format!("Tool '{}' requires permission to execute", name)
                    });

                    let approved = callback(name.to_string(), message.clone()).await;

                    if !approved {
                        self.log_permission_denied(
                            name,
                            &params,
                            context,
                            "User denied permission",
                            start_time.elapsed(),
                        );
                        return Err(ToolError::permission_denied("User denied permission"));
                    }
                } else {
                    // No callback provided, deny by default
                    let reason =
                        "Permission request requires user confirmation but no callback provided";
                    self.log_permission_denied(
                        name,
                        &params,
                        context,
                        reason,
                        start_time.elapsed(),
                    );
                    return Err(ToolError::permission_denied(reason));
                }
            }
            PermissionBehavior::Allow => {
                // Permission granted, continue
            }
        }

        // Step 3: Check system-level permissions (if permission manager is configured)
        if let Some(ref permission_manager) = self.permission_manager {
            let perm_context = self.create_permission_context(context);
            let params_map = self.params_to_hashmap(&params);
            let perm_result = permission_manager.is_allowed(name, &params_map, &perm_context);

            if !perm_result.allowed {
                let reason = perm_result
                    .reason
                    .unwrap_or_else(|| format!("Permission denied for tool '{}'", name));

                self.log_permission_denied(name, &params, context, &reason, start_time.elapsed());

                return Err(ToolError::permission_denied(reason));
            }
        }

        // Step 4: Execute the tool
        let params_to_use = permission_result.updated_params.unwrap_or(params.clone());
        let result = tool.execute(params_to_use, context).await;

        // Step 5: Log the execution
        let duration = start_time.elapsed();
        match &result {
            Ok(tool_result) => {
                self.log_tool_execution(name, &params, context, tool_result, duration);
            }
            Err(err) => {
                self.log_tool_error(name, &params, context, err, duration);
            }
        }

        result
    }

    /// Create a PermissionContext from ToolContext
    fn create_permission_context(&self, context: &ToolContext) -> PermissionContext {
        PermissionContext {
            working_directory: context.working_directory.clone(),
            session_id: context.session_id.clone(),
            timestamp: chrono::Utc::now().timestamp(),
            user: context.user.clone(),
            environment: context.environment.clone(),
            metadata: HashMap::new(),
        }
    }

    /// Convert JSON params to HashMap for permission checking
    fn params_to_hashmap(&self, params: &serde_json::Value) -> HashMap<String, serde_json::Value> {
        match params {
            serde_json::Value::Object(map) => {
                map.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
            }
            _ => HashMap::new(),
        }
    }

    /// Log a permission denial
    fn log_permission_denied(
        &self,
        tool_name: &str,
        params: &serde_json::Value,
        context: &ToolContext,
        reason: &str,
        duration: std::time::Duration,
    ) {
        if let Some(ref logger) = self.audit_logger {
            let entry = AuditLogEntry::new("permission_denied", tool_name)
                .with_level(AuditLogLevel::Warn)
                .with_parameters(self.params_to_hashmap(params))
                .with_context(self.create_permission_context(context))
                .with_duration_ms(duration.as_millis() as u64)
                .add_metadata("reason", serde_json::json!(reason));

            logger.log(entry);
        }
    }

    /// Log a successful tool execution
    fn log_tool_execution(
        &self,
        tool_name: &str,
        params: &serde_json::Value,
        context: &ToolContext,
        result: &ToolResult,
        duration: std::time::Duration,
    ) {
        if let Some(ref logger) = self.audit_logger {
            let level = if result.is_success() {
                AuditLogLevel::Info
            } else {
                AuditLogLevel::Warn
            };

            let entry = AuditLogEntry::new("tool_execution", tool_name)
                .with_level(level)
                .with_parameters(self.params_to_hashmap(params))
                .with_context(self.create_permission_context(context))
                .with_duration_ms(duration.as_millis() as u64)
                .add_metadata("success", serde_json::json!(result.is_success()))
                .add_metadata(
                    "output_size",
                    serde_json::json!(result.output.as_ref().map(|s| s.len()).unwrap_or(0)),
                );

            logger.log_tool_execution(entry);
        }
    }

    /// Log a tool execution error
    fn log_tool_error(
        &self,
        tool_name: &str,
        params: &serde_json::Value,
        context: &ToolContext,
        error: &ToolError,
        duration: std::time::Duration,
    ) {
        if let Some(ref logger) = self.audit_logger {
            let entry = AuditLogEntry::new("tool_error", tool_name)
                .with_level(AuditLogLevel::Error)
                .with_parameters(self.params_to_hashmap(params))
                .with_context(self.create_permission_context(context))
                .with_duration_ms(duration.as_millis() as u64)
                .add_metadata("error", serde_json::json!(error.to_string()));

            logger.log_tool_execution(entry);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::PermissionCheckResult;
    use std::path::PathBuf;

    /// A simple test tool for unit testing
    struct TestTool {
        name: String,
        should_fail: bool,
        permission_behavior: PermissionBehavior,
        aliases: &'static [&'static str],
    }

    impl TestTool {
        fn new(name: &str) -> Self {
            Self {
                name: name.to_string(),
                should_fail: false,
                permission_behavior: PermissionBehavior::Allow,
                aliases: &[],
            }
        }

        fn failing(name: &str) -> Self {
            Self {
                name: name.to_string(),
                should_fail: true,
                permission_behavior: PermissionBehavior::Allow,
                aliases: &[],
            }
        }

        fn with_permission(name: &str, behavior: PermissionBehavior) -> Self {
            Self {
                name: name.to_string(),
                should_fail: false,
                permission_behavior: behavior,
                aliases: &[],
            }
        }

        fn with_aliases(name: &str, aliases: &'static [&'static str]) -> Self {
            Self {
                name: name.to_string(),
                should_fail: false,
                permission_behavior: PermissionBehavior::Allow,
                aliases,
            }
        }
    }

    #[async_trait]
    impl Tool for TestTool {
        fn name(&self) -> &str {
            &self.name
        }

        fn description(&self) -> &str {
            "A test tool for unit testing"
        }

        fn input_schema(&self) -> serde_json::Value {
            serde_json::json!({
                "type": "object",
                "properties": {
                    "input": { "type": "string" }
                },
                "required": ["input"]
            })
        }

        fn aliases(&self) -> &'static [&'static str] {
            self.aliases
        }

        async fn execute(
            &self,
            params: serde_json::Value,
            _context: &ToolContext,
        ) -> Result<ToolResult, ToolError> {
            if self.should_fail {
                return Err(ToolError::execution_failed("Test failure"));
            }

            let input = params
                .get("input")
                .and_then(|v| v.as_str())
                .unwrap_or("default");

            Ok(ToolResult::success(format!("Processed: {}", input)))
        }

        async fn check_permissions(
            &self,
            _params: &serde_json::Value,
            _context: &ToolContext,
        ) -> PermissionCheckResult {
            match self.permission_behavior {
                PermissionBehavior::Allow => PermissionCheckResult::allow(),
                PermissionBehavior::Deny => PermissionCheckResult::deny("Test denial"),
                PermissionBehavior::Ask => PermissionCheckResult::ask("Test confirmation required"),
            }
        }
    }

    fn create_test_context() -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("test-session")
            .with_user("test-user")
    }

    #[test]
    fn test_registry_new() {
        let registry = ToolRegistry::new();
        assert_eq!(registry.native_tool_count(), 0);
        assert_eq!(registry.mcp_tool_count(), 0);
        assert_eq!(registry.tool_count(), 0);
    }

    #[test]
    fn test_registry_register_native_tool() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::new("test_tool")));

        assert_eq!(registry.native_tool_count(), 1);
        assert!(registry.contains("test_tool"));
        assert!(registry.contains_native("test_tool"));
        assert!(!registry.contains_mcp("test_tool"));
    }

    #[test]
    fn test_registry_lookup_is_case_insensitive_for_current_surface_names() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::new("Bash")));

        assert!(registry.contains("Bash"));
        assert!(registry.contains("bash"));
        assert!(registry.contains_native("bash"));
        assert!(registry.get("bash").is_some());
    }

    #[tokio::test]
    async fn test_registry_resolves_native_aliases_during_lookup_and_execution() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::with_aliases(
            "TaskStop",
            &["TaskStopTool", "KillShell"],
        )));

        assert!(registry.contains("TaskStopTool"));
        assert!(registry.contains_native("killshell"));
        assert!(registry.is_native("KillShell"));
        assert!(registry.get("TaskStopTool").is_some());

        let definitions = registry.get_definitions();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "TaskStop");

        let context = create_test_context();
        let result = registry
            .execute(
                "KillShell",
                serde_json::json!({ "input": "hello" }),
                &context,
                None,
            )
            .await
            .expect("alias should resolve to native tool");
        assert_eq!(result.output.as_deref(), Some("Processed: hello"));
    }

    #[test]
    fn test_registry_unregister_clears_native_aliases() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::with_aliases(
            "TaskOutput",
            &["TaskOutputTool"],
        )));

        assert!(registry.contains("TaskOutputTool"));
        let removed = registry.unregister("TaskOutput");
        assert!(removed.is_some());
        assert!(!registry.contains("TaskOutputTool"));
    }

    #[test]
    fn test_registry_register_mcp_tool() {
        let mut registry = ToolRegistry::new();
        let mcp_tool = McpToolWrapper::new(
            "mcp_tool",
            "An MCP tool",
            serde_json::json!({}),
            "test_server",
        );
        registry.register_mcp("mcp_tool".to_string(), mcp_tool);

        assert_eq!(registry.mcp_tool_count(), 1);
        assert!(registry.contains("mcp_tool"));
        assert!(!registry.contains_native("mcp_tool"));
        assert!(registry.contains_mcp("mcp_tool"));
    }

    #[test]
    fn test_registry_native_priority_over_mcp() {
        let mut registry = ToolRegistry::new();

        // Register MCP tool first
        let mcp_tool = McpToolWrapper::new(
            "shared_tool",
            "MCP version",
            serde_json::json!({}),
            "test_server",
        );
        registry.register_mcp("shared_tool".to_string(), mcp_tool);

        // Register native tool with same name
        registry.register(Box::new(TestTool::new("shared_tool")));

        // Native tool should take priority
        let tool = registry.get("shared_tool").unwrap();
        assert_eq!(tool.description(), "A test tool for unit testing");
        assert!(registry.is_native("shared_tool"));
        assert!(!registry.is_mcp("shared_tool"));
    }

    #[test]
    fn test_registry_get_nonexistent() {
        let registry = ToolRegistry::new();
        assert!(registry.get("nonexistent").is_none());
    }

    #[test]
    fn test_registry_get_all() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::new("tool1")));
        registry.register(Box::new(TestTool::new("tool2")));

        let mcp_tool = McpToolWrapper::new(
            "mcp_tool",
            "An MCP tool",
            serde_json::json!({}),
            "test_server",
        );
        registry.register_mcp("mcp_tool".to_string(), mcp_tool);

        let all_tools = registry.get_all();
        assert_eq!(all_tools.len(), 3);
    }

    #[test]
    fn test_registry_get_all_with_shadowing() {
        let mut registry = ToolRegistry::new();

        // Register MCP tool
        let mcp_tool = McpToolWrapper::new(
            "shared_tool",
            "MCP version",
            serde_json::json!({}),
            "test_server",
        );
        registry.register_mcp("shared_tool".to_string(), mcp_tool);

        // Register native tool with same name
        registry.register(Box::new(TestTool::new("shared_tool")));

        // Should only return 1 tool (native shadows MCP)
        let all_tools = registry.get_all();
        assert_eq!(all_tools.len(), 1);
        assert_eq!(all_tools[0].description(), "A test tool for unit testing");
    }

    #[test]
    fn test_registry_get_definitions() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::new("tool1")));
        registry.register(Box::new(TestTool::new("tool2")));

        let definitions = registry.get_definitions();
        assert_eq!(definitions.len(), 2);

        let names: Vec<&str> = definitions.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"tool1"));
        assert!(names.contains(&"tool2"));
    }

    #[test]
    fn test_registry_unregister() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::new("test_tool")));

        assert!(registry.contains("test_tool"));

        let removed = registry.unregister("test_tool");
        assert!(removed.is_some());
        assert!(!registry.contains("test_tool"));
    }

    #[test]
    fn test_registry_unregister_mcp() {
        let mut registry = ToolRegistry::new();
        let mcp_tool = McpToolWrapper::new(
            "mcp_tool",
            "An MCP tool",
            serde_json::json!({}),
            "test_server",
        );
        registry.register_mcp("mcp_tool".to_string(), mcp_tool);

        assert!(registry.contains("mcp_tool"));

        let removed = registry.unregister_mcp("mcp_tool");
        assert!(removed.is_some());
        assert!(!registry.contains("mcp_tool"));
    }

    #[test]
    fn test_registry_tool_names() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::new("native1")));
        registry.register(Box::new(TestTool::new("native2")));

        let mcp_tool =
            McpToolWrapper::new("mcp1", "An MCP tool", serde_json::json!({}), "test_server");
        registry.register_mcp("mcp1".to_string(), mcp_tool);

        let native_names = registry.native_tool_names();
        assert_eq!(native_names.len(), 2);

        let mcp_names = registry.mcp_tool_names();
        assert_eq!(mcp_names.len(), 1);

        let all_names = registry.tool_names();
        assert_eq!(all_names.len(), 3);
    }

    #[tokio::test]
    async fn test_registry_execute_success() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::new("test_tool")));

        let context = create_test_context();
        let params = serde_json::json!({"input": "hello"});

        let result = registry.execute("test_tool", params, &context, None).await;
        assert!(result.is_ok());

        let tool_result = result.unwrap();
        assert!(tool_result.is_success());
        assert_eq!(tool_result.output, Some("Processed: hello".to_string()));
    }

    #[tokio::test]
    async fn test_registry_execute_not_found() {
        let registry = ToolRegistry::new();
        let context = create_test_context();
        let params = serde_json::json!({});

        let result = registry
            .execute("nonexistent", params, &context, None)
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::NotFound(_)));
    }

    #[tokio::test]
    async fn test_registry_execute_tool_failure() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::failing("failing_tool")));

        let context = create_test_context();
        let params = serde_json::json!({"input": "hello"});

        let result = registry
            .execute("failing_tool", params, &context, None)
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::ExecutionFailed(_)));
    }

    #[tokio::test]
    async fn test_registry_execute_permission_denied() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::with_permission(
            "denied_tool",
            PermissionBehavior::Deny,
        )));

        let context = create_test_context();
        let params = serde_json::json!({"input": "hello"});

        let result = registry
            .execute("denied_tool", params, &context, None)
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ToolError::PermissionDenied(_)
        ));
    }

    #[tokio::test]
    async fn test_registry_execute_permission_ask_approved() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::with_permission(
            "ask_tool",
            PermissionBehavior::Ask,
        )));

        let context = create_test_context();
        let params = serde_json::json!({"input": "hello"});

        // Create a callback that approves the request
        let callback: PermissionRequestCallback =
            Box::new(|_name, _message| Box::pin(async { true }));

        let result = registry
            .execute("ask_tool", params, &context, Some(callback))
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_registry_execute_permission_ask_denied() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::with_permission(
            "ask_tool",
            PermissionBehavior::Ask,
        )));

        let context = create_test_context();
        let params = serde_json::json!({"input": "hello"});

        // Create a callback that denies the request
        let callback: PermissionRequestCallback =
            Box::new(|_name, _message| Box::pin(async { false }));

        let result = registry
            .execute("ask_tool", params, &context, Some(callback))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ToolError::PermissionDenied(_)
        ));
    }

    #[tokio::test]
    async fn test_registry_execute_permission_ask_no_callback() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(TestTool::with_permission(
            "ask_tool",
            PermissionBehavior::Ask,
        )));

        let context = create_test_context();
        let params = serde_json::json!({"input": "hello"});

        // No callback provided - should deny
        let result = registry.execute("ask_tool", params, &context, None).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ToolError::PermissionDenied(_)
        ));
    }

    #[test]
    fn test_mcp_tool_wrapper() {
        let wrapper = McpToolWrapper::new(
            "test_mcp",
            "Test MCP tool",
            serde_json::json!({"type": "object"}),
            "test_server",
        );

        assert_eq!(wrapper.name(), "test_mcp");
        assert_eq!(wrapper.description(), "Test MCP tool");
        assert_eq!(wrapper.server_name(), "test_server");
        assert_eq!(wrapper.input_schema()["type"], "object");
    }

    #[test]
    fn test_registry_with_managers() {
        let permission_manager = Arc::new(ToolPermissionManager::new(None));
        let audit_logger = Arc::new(AuditLogger::new(AuditLogLevel::Info));

        let registry =
            ToolRegistry::with_managers(permission_manager.clone(), audit_logger.clone());

        assert!(registry.permission_manager().is_some());
        assert!(registry.audit_logger().is_some());
    }

    #[test]
    fn test_registry_set_managers() {
        let mut registry = ToolRegistry::new();

        assert!(registry.permission_manager().is_none());
        assert!(registry.audit_logger().is_none());

        let permission_manager = Arc::new(ToolPermissionManager::new(None));
        let audit_logger = Arc::new(AuditLogger::new(AuditLogLevel::Info));

        registry.set_permission_manager(permission_manager);
        registry.set_audit_logger(audit_logger);

        assert!(registry.permission_manager().is_some());
        assert!(registry.audit_logger().is_some());
    }
}
