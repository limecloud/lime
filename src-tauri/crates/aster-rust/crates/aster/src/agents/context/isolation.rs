//! Context Isolation
//!
//! Provides sandboxed execution environments for agents with
//! resource limits and tool permission enforcement.
//!
//! This module implements:
//! - Sandbox creation with configurable resource limits
//! - Tool permission enforcement (allowed/denied lists)
//! - Sandbox state management (active, suspended, terminated)
//! - Automatic cleanup of expired sandboxes

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use super::types::{AgentContext, AgentContextError, AgentContextResult, ContextUpdate};

/// Sandbox state representing the lifecycle of a sandboxed context
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SandboxState {
    /// Sandbox is active and can execute operations
    #[default]
    Active,
    /// Sandbox is suspended due to resource limits or manual suspension
    Suspended,
    /// Sandbox is terminated and cannot be resumed
    Terminated,
}

impl SandboxState {
    /// Check if the sandbox can transition to the given state
    pub fn can_transition_to(&self, target: SandboxState) -> bool {
        match (self, target) {
            // Active can go to Suspended or Terminated
            (SandboxState::Active, SandboxState::Suspended) => true,
            (SandboxState::Active, SandboxState::Terminated) => true,
            // Suspended can go to Active (resume) or Terminated
            (SandboxState::Suspended, SandboxState::Active) => true,
            (SandboxState::Suspended, SandboxState::Terminated) => true,
            // Terminated is final - cannot transition
            (SandboxState::Terminated, _) => false,
            // Same state transitions are allowed (no-op)
            (s1, s2) if *s1 == s2 => true,
            _ => false,
        }
    }
}

/// Resource usage tracking for a sandbox
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceUsage {
    /// Current token count used
    pub tokens_used: usize,
    /// Number of files accessed
    pub files_accessed: usize,
    /// Number of tool results stored
    pub tool_results_count: usize,
    /// Number of tool calls made
    pub tool_calls_made: usize,
}

impl ResourceUsage {
    /// Create new resource usage tracker
    pub fn new() -> Self {
        Self::default()
    }

    /// Add tokens to usage
    pub fn add_tokens(&mut self, count: usize) {
        self.tokens_used += count;
    }

    /// Increment file access count
    pub fn add_file_access(&mut self) {
        self.files_accessed += 1;
    }

    /// Increment tool results count
    pub fn add_tool_result(&mut self) {
        self.tool_results_count += 1;
    }

    /// Increment tool calls count
    pub fn add_tool_call(&mut self) {
        self.tool_calls_made += 1;
    }
}

/// Resource restrictions for a sandbox
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxRestrictions {
    /// Maximum tokens allowed in the sandbox
    pub max_tokens: usize,
    /// Maximum number of files that can be accessed
    pub max_files: usize,
    /// Maximum number of tool results that can be stored
    pub max_tool_results: usize,
    /// Set of tools that are explicitly allowed (if Some, only these tools are allowed)
    pub allowed_tools: Option<HashSet<String>>,
    /// Set of tools that are explicitly denied (checked after allowed_tools)
    pub denied_tools: Option<HashSet<String>>,
}

impl Default for SandboxRestrictions {
    fn default() -> Self {
        Self {
            max_tokens: 100_000,
            max_files: 50,
            max_tool_results: 100,
            allowed_tools: None,
            denied_tools: None,
        }
    }
}

impl SandboxRestrictions {
    /// Create restrictions with custom limits
    pub fn new(max_tokens: usize, max_files: usize, max_tool_results: usize) -> Self {
        Self {
            max_tokens,
            max_files,
            max_tool_results,
            allowed_tools: None,
            denied_tools: None,
        }
    }

    /// Set allowed tools (whitelist)
    pub fn with_allowed_tools(
        mut self,
        tools: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        self.allowed_tools = Some(tools.into_iter().map(|t| t.into()).collect());
        self
    }

    /// Set denied tools (blacklist)
    pub fn with_denied_tools(mut self, tools: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.denied_tools = Some(tools.into_iter().map(|t| t.into()).collect());
        self
    }

    /// Check if a tool is allowed based on the restrictions
    pub fn is_tool_allowed(&self, tool_name: &str) -> bool {
        // If there's an allowed list, tool must be in it
        if let Some(allowed) = &self.allowed_tools {
            if !allowed.contains(tool_name) {
                return false;
            }
        }

        // If there's a denied list, tool must not be in it
        if let Some(denied) = &self.denied_tools {
            if denied.contains(tool_name) {
                return false;
            }
        }

        true
    }

    /// Check if resource usage exceeds any limit
    pub fn check_limits(&self, usage: &ResourceUsage) -> Option<ResourceLimitViolation> {
        if usage.tokens_used > self.max_tokens {
            return Some(ResourceLimitViolation::TokensExceeded {
                used: usage.tokens_used,
                limit: self.max_tokens,
            });
        }
        if usage.files_accessed > self.max_files {
            return Some(ResourceLimitViolation::FilesExceeded {
                used: usage.files_accessed,
                limit: self.max_files,
            });
        }
        if usage.tool_results_count > self.max_tool_results {
            return Some(ResourceLimitViolation::ToolResultsExceeded {
                used: usage.tool_results_count,
                limit: self.max_tool_results,
            });
        }
        None
    }
}

/// Types of resource limit violations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceLimitViolation {
    /// Token limit exceeded
    TokensExceeded { used: usize, limit: usize },
    /// File access limit exceeded
    FilesExceeded { used: usize, limit: usize },
    /// Tool results limit exceeded
    ToolResultsExceeded { used: usize, limit: usize },
}

impl std::fmt::Display for ResourceLimitViolation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResourceLimitViolation::TokensExceeded { used, limit } => {
                write!(f, "Token limit exceeded: {} used, {} allowed", used, limit)
            }
            ResourceLimitViolation::FilesExceeded { used, limit } => {
                write!(
                    f,
                    "File limit exceeded: {} accessed, {} allowed",
                    used, limit
                )
            }
            ResourceLimitViolation::ToolResultsExceeded { used, limit } => {
                write!(
                    f,
                    "Tool results limit exceeded: {} stored, {} allowed",
                    used, limit
                )
            }
        }
    }
}

/// A sandboxed context with resource limits and state management
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxedContext {
    /// Unique sandbox identifier
    pub sandbox_id: String,
    /// Associated agent ID
    pub agent_id: String,
    /// The isolated context
    pub context: AgentContext,
    /// Resource restrictions
    pub restrictions: SandboxRestrictions,
    /// Current sandbox state
    pub state: SandboxState,
    /// Creation timestamp
    pub created_at: DateTime<Utc>,
    /// Expiration timestamp (if set)
    pub expires_at: Option<DateTime<Utc>>,
    /// Current resource usage
    pub resources: ResourceUsage,
    /// Reason for suspension (if suspended)
    pub suspension_reason: Option<String>,
}

impl SandboxedContext {
    /// Create a new sandboxed context
    pub fn new(
        context: AgentContext,
        agent_id: impl Into<String>,
        restrictions: Option<SandboxRestrictions>,
    ) -> Self {
        Self {
            sandbox_id: uuid::Uuid::new_v4().to_string(),
            agent_id: agent_id.into(),
            context,
            restrictions: restrictions.unwrap_or_default(),
            state: SandboxState::Active,
            created_at: Utc::now(),
            expires_at: None,
            resources: ResourceUsage::new(),
            suspension_reason: None,
        }
    }

    /// Set expiration time
    pub fn with_expiration(mut self, expires_at: DateTime<Utc>) -> Self {
        self.expires_at = Some(expires_at);
        self
    }

    /// Set expiration duration from now
    pub fn with_ttl(mut self, ttl: Duration) -> Self {
        self.expires_at = Some(Utc::now() + ttl);
        self
    }

    /// Check if the sandbox has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            Utc::now() > expires_at
        } else {
            false
        }
    }

    /// Check if the sandbox is active
    pub fn is_active(&self) -> bool {
        self.state == SandboxState::Active && !self.is_expired()
    }

    /// Check if a tool is allowed in this sandbox
    pub fn is_tool_allowed(&self, tool_name: &str) -> bool {
        self.restrictions.is_tool_allowed(tool_name)
    }

    /// Check resource limits and return violation if any
    pub fn check_limits(&self) -> Option<ResourceLimitViolation> {
        self.restrictions.check_limits(&self.resources)
    }

    /// Record token usage and check limits
    pub fn record_tokens(&mut self, count: usize) -> AgentContextResult<()> {
        self.resources.add_tokens(count);
        self.check_and_suspend_if_exceeded()
    }

    /// Record file access and check limits
    pub fn record_file_access(&mut self) -> AgentContextResult<()> {
        self.resources.add_file_access();
        self.check_and_suspend_if_exceeded()
    }

    /// Record tool result and check limits
    pub fn record_tool_result(&mut self) -> AgentContextResult<()> {
        self.resources.add_tool_result();
        self.check_and_suspend_if_exceeded()
    }

    /// Check limits and suspend if exceeded
    fn check_and_suspend_if_exceeded(&mut self) -> AgentContextResult<()> {
        if let Some(violation) = self.check_limits() {
            self.state = SandboxState::Suspended;
            self.suspension_reason = Some(violation.to_string());
            return Err(AgentContextError::ResourceLimitExceeded(
                violation.to_string(),
            ));
        }
        Ok(())
    }
}

/// Context Isolation Manager
///
/// Manages sandboxed execution environments for agents with:
/// - Resource limit enforcement
/// - Tool permission management
/// - Sandbox lifecycle management
/// - Automatic cleanup of expired sandboxes
#[derive(Debug, Default)]
pub struct ContextIsolation {
    /// Map of sandbox ID to sandboxed context
    sandboxes: HashMap<String, SandboxedContext>,
    /// Map of agent ID to sandbox ID for quick lookup
    agent_sandboxes: HashMap<String, String>,
}

impl ContextIsolation {
    /// Create a new context isolation manager
    pub fn new() -> Self {
        Self {
            sandboxes: HashMap::new(),
            agent_sandboxes: HashMap::new(),
        }
    }

    /// Create a new sandbox for an agent context
    pub fn create_sandbox(
        &mut self,
        context: AgentContext,
        agent_id: Option<String>,
        restrictions: Option<SandboxRestrictions>,
    ) -> SandboxedContext {
        let agent_id = agent_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let sandbox = SandboxedContext::new(context, agent_id.clone(), restrictions);

        let sandbox_id = sandbox.sandbox_id.clone();
        self.sandboxes.insert(sandbox_id.clone(), sandbox.clone());
        self.agent_sandboxes.insert(agent_id, sandbox_id);

        sandbox
    }

    /// Create a sandbox with expiration
    pub fn create_sandbox_with_ttl(
        &mut self,
        context: AgentContext,
        agent_id: Option<String>,
        restrictions: Option<SandboxRestrictions>,
        ttl: Duration,
    ) -> SandboxedContext {
        let agent_id = agent_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let sandbox = SandboxedContext::new(context, agent_id.clone(), restrictions).with_ttl(ttl);

        let sandbox_id = sandbox.sandbox_id.clone();
        self.sandboxes.insert(sandbox_id.clone(), sandbox.clone());
        self.agent_sandboxes.insert(agent_id, sandbox_id);

        sandbox
    }

    /// Get a sandbox by ID
    pub fn get_sandbox(&self, sandbox_id: &str) -> Option<&SandboxedContext> {
        self.sandboxes.get(sandbox_id)
    }

    /// Get a mutable sandbox by ID
    pub fn get_sandbox_mut(&mut self, sandbox_id: &str) -> Option<&mut SandboxedContext> {
        self.sandboxes.get_mut(sandbox_id)
    }

    /// Get the isolated context for an agent
    pub fn get_isolated_context(&self, agent_id: &str) -> Option<&AgentContext> {
        self.agent_sandboxes
            .get(agent_id)
            .and_then(|sandbox_id| self.sandboxes.get(sandbox_id))
            .map(|sandbox| &sandbox.context)
    }

    /// Get sandbox by agent ID
    pub fn get_sandbox_by_agent(&self, agent_id: &str) -> Option<&SandboxedContext> {
        self.agent_sandboxes
            .get(agent_id)
            .and_then(|sandbox_id| self.sandboxes.get(sandbox_id))
    }

    /// Get mutable sandbox by agent ID
    pub fn get_sandbox_by_agent_mut(&mut self, agent_id: &str) -> Option<&mut SandboxedContext> {
        if let Some(sandbox_id) = self.agent_sandboxes.get(agent_id).cloned() {
            self.sandboxes.get_mut(&sandbox_id)
        } else {
            None
        }
    }

    /// Update a sandbox's context
    pub fn update_sandbox(
        &mut self,
        sandbox_id: &str,
        updates: ContextUpdate,
    ) -> AgentContextResult<()> {
        let sandbox = self
            .sandboxes
            .get_mut(sandbox_id)
            .ok_or_else(|| AgentContextError::NotFound(sandbox_id.to_string()))?;

        // Check if sandbox is active
        if sandbox.state != SandboxState::Active {
            return Err(AgentContextError::InvalidStateTransition(format!(
                "Cannot update sandbox in {:?} state",
                sandbox.state
            )));
        }

        // Check if expired
        if sandbox.is_expired() {
            sandbox.state = SandboxState::Terminated;
            return Err(AgentContextError::InvalidStateTransition(
                "Sandbox has expired".to_string(),
            ));
        }

        // Apply updates to context
        let context = &mut sandbox.context;

        if let Some(messages) = updates.add_messages {
            context.conversation_history.extend(messages);
        }

        if let Some(files) = updates.add_files {
            for file in files {
                sandbox.resources.add_file_access();
                context.file_context.push(file);
            }
        }

        if let Some(results) = updates.add_tool_results {
            for result in results {
                sandbox.resources.add_tool_result();
                context.tool_results.push(result);
            }
        }

        if let Some(env) = updates.set_environment {
            context.environment.extend(env);
        }

        if let Some(prompt) = updates.set_system_prompt {
            context.system_prompt = Some(prompt);
        }

        if let Some(dir) = updates.set_working_directory {
            context.working_directory = dir;
        }

        if let Some(tags) = updates.add_tags {
            for tag in tags {
                context.metadata.add_tag(tag);
            }
        }

        if let Some(custom) = updates.set_custom_metadata {
            for (key, value) in custom {
                context.metadata.set_custom(key, value);
            }
        }

        context.metadata.touch();

        // Check resource limits after update
        sandbox.check_and_suspend_if_exceeded()?;

        Ok(())
    }

    /// Check if a tool is allowed in a sandbox
    pub fn is_tool_allowed(&self, sandbox_id: &str, tool_name: &str) -> bool {
        self.sandboxes
            .get(sandbox_id)
            .map(|s| s.is_tool_allowed(tool_name))
            .unwrap_or(false)
    }

    /// Suspend a sandbox
    pub fn suspend(&mut self, sandbox_id: &str) -> AgentContextResult<()> {
        let sandbox = self
            .sandboxes
            .get_mut(sandbox_id)
            .ok_or_else(|| AgentContextError::NotFound(sandbox_id.to_string()))?;

        if !sandbox.state.can_transition_to(SandboxState::Suspended) {
            return Err(AgentContextError::InvalidStateTransition(format!(
                "Cannot suspend sandbox in {:?} state",
                sandbox.state
            )));
        }

        sandbox.state = SandboxState::Suspended;
        sandbox.suspension_reason = Some("Manually suspended".to_string());
        Ok(())
    }

    /// Resume a suspended sandbox
    pub fn resume(&mut self, sandbox_id: &str) -> AgentContextResult<()> {
        let sandbox = self
            .sandboxes
            .get_mut(sandbox_id)
            .ok_or_else(|| AgentContextError::NotFound(sandbox_id.to_string()))?;

        if !sandbox.state.can_transition_to(SandboxState::Active) {
            return Err(AgentContextError::InvalidStateTransition(format!(
                "Cannot resume sandbox in {:?} state",
                sandbox.state
            )));
        }

        // Check if expired before resuming
        if sandbox.is_expired() {
            sandbox.state = SandboxState::Terminated;
            return Err(AgentContextError::InvalidStateTransition(
                "Cannot resume expired sandbox".to_string(),
            ));
        }

        sandbox.state = SandboxState::Active;
        sandbox.suspension_reason = None;
        Ok(())
    }

    /// Terminate a sandbox
    pub fn terminate(&mut self, sandbox_id: &str) -> AgentContextResult<()> {
        let sandbox = self
            .sandboxes
            .get_mut(sandbox_id)
            .ok_or_else(|| AgentContextError::NotFound(sandbox_id.to_string()))?;

        if !sandbox.state.can_transition_to(SandboxState::Terminated) {
            return Err(AgentContextError::InvalidStateTransition(format!(
                "Cannot terminate sandbox in {:?} state",
                sandbox.state
            )));
        }

        sandbox.state = SandboxState::Terminated;
        Ok(())
    }

    /// Cleanup a specific sandbox (remove from memory)
    pub fn cleanup(&mut self, sandbox_id: &str) {
        if let Some(sandbox) = self.sandboxes.remove(sandbox_id) {
            self.agent_sandboxes.remove(&sandbox.agent_id);
        }
    }

    /// Cleanup all expired sandboxes
    /// Returns the number of sandboxes cleaned up
    pub fn cleanup_expired(&mut self) -> usize {
        let expired_ids: Vec<String> = self
            .sandboxes
            .iter()
            .filter(|(_, sandbox)| sandbox.is_expired())
            .map(|(id, _)| id.clone())
            .collect();

        let count = expired_ids.len();

        for sandbox_id in expired_ids {
            self.cleanup(&sandbox_id);
        }

        count
    }

    /// Get all sandbox IDs
    pub fn list_sandbox_ids(&self) -> Vec<String> {
        self.sandboxes.keys().cloned().collect()
    }

    /// Get all sandboxes in a specific state
    pub fn list_sandboxes_by_state(&self, state: SandboxState) -> Vec<&SandboxedContext> {
        self.sandboxes
            .values()
            .filter(|s| s.state == state)
            .collect()
    }

    /// Get sandbox count
    pub fn sandbox_count(&self) -> usize {
        self.sandboxes.len()
    }

    /// Get active sandbox count
    pub fn active_sandbox_count(&self) -> usize {
        self.sandboxes.values().filter(|s| s.is_active()).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::context::types::FileContext;

    #[test]
    fn test_sandbox_state_transitions() {
        // Active -> Suspended
        assert!(SandboxState::Active.can_transition_to(SandboxState::Suspended));
        // Active -> Terminated
        assert!(SandboxState::Active.can_transition_to(SandboxState::Terminated));
        // Suspended -> Active
        assert!(SandboxState::Suspended.can_transition_to(SandboxState::Active));
        // Suspended -> Terminated
        assert!(SandboxState::Suspended.can_transition_to(SandboxState::Terminated));
        // Terminated -> anything is false
        assert!(!SandboxState::Terminated.can_transition_to(SandboxState::Active));
        assert!(!SandboxState::Terminated.can_transition_to(SandboxState::Suspended));
        // Same state is allowed
        assert!(SandboxState::Active.can_transition_to(SandboxState::Active));
    }

    #[test]
    fn test_resource_usage_tracking() {
        let mut usage = ResourceUsage::new();
        assert_eq!(usage.tokens_used, 0);
        assert_eq!(usage.files_accessed, 0);

        usage.add_tokens(100);
        assert_eq!(usage.tokens_used, 100);

        usage.add_file_access();
        assert_eq!(usage.files_accessed, 1);

        usage.add_tool_result();
        assert_eq!(usage.tool_results_count, 1);

        usage.add_tool_call();
        assert_eq!(usage.tool_calls_made, 1);
    }

    #[test]
    fn test_sandbox_restrictions_default() {
        let restrictions = SandboxRestrictions::default();
        assert_eq!(restrictions.max_tokens, 100_000);
        assert_eq!(restrictions.max_files, 50);
        assert_eq!(restrictions.max_tool_results, 100);
        assert!(restrictions.allowed_tools.is_none());
        assert!(restrictions.denied_tools.is_none());
    }

    #[test]
    fn test_sandbox_restrictions_tool_allowed() {
        // No restrictions - all tools allowed
        let restrictions = SandboxRestrictions::default();
        assert!(restrictions.is_tool_allowed("bash"));
        assert!(restrictions.is_tool_allowed("read_file"));

        // With allowed list
        let restrictions =
            SandboxRestrictions::default().with_allowed_tools(vec!["bash", "read_file"]);
        assert!(restrictions.is_tool_allowed("bash"));
        assert!(restrictions.is_tool_allowed("read_file"));
        assert!(!restrictions.is_tool_allowed("write_file"));

        // With denied list
        let restrictions = SandboxRestrictions::default().with_denied_tools(vec!["bash"]);
        assert!(!restrictions.is_tool_allowed("bash"));
        assert!(restrictions.is_tool_allowed("read_file"));

        // With both allowed and denied
        let restrictions = SandboxRestrictions::default()
            .with_allowed_tools(vec!["bash", "read_file", "write_file"])
            .with_denied_tools(vec!["write_file"]);
        assert!(restrictions.is_tool_allowed("bash"));
        assert!(restrictions.is_tool_allowed("read_file"));
        assert!(!restrictions.is_tool_allowed("write_file")); // Denied takes precedence
        assert!(!restrictions.is_tool_allowed("other")); // Not in allowed list
    }

    #[test]
    fn test_sandbox_restrictions_check_limits() {
        let restrictions = SandboxRestrictions::new(100, 5, 10);

        // Within limits
        let usage = ResourceUsage {
            tokens_used: 50,
            files_accessed: 3,
            tool_results_count: 5,
            tool_calls_made: 0,
        };
        assert!(restrictions.check_limits(&usage).is_none());

        // Token limit exceeded
        let usage = ResourceUsage {
            tokens_used: 150,
            files_accessed: 3,
            tool_results_count: 5,
            tool_calls_made: 0,
        };
        assert!(matches!(
            restrictions.check_limits(&usage),
            Some(ResourceLimitViolation::TokensExceeded { .. })
        ));

        // File limit exceeded
        let usage = ResourceUsage {
            tokens_used: 50,
            files_accessed: 10,
            tool_results_count: 5,
            tool_calls_made: 0,
        };
        assert!(matches!(
            restrictions.check_limits(&usage),
            Some(ResourceLimitViolation::FilesExceeded { .. })
        ));

        // Tool results limit exceeded
        let usage = ResourceUsage {
            tokens_used: 50,
            files_accessed: 3,
            tool_results_count: 15,
            tool_calls_made: 0,
        };
        assert!(matches!(
            restrictions.check_limits(&usage),
            Some(ResourceLimitViolation::ToolResultsExceeded { .. })
        ));
    }

    #[test]
    fn test_sandboxed_context_creation() {
        let context = AgentContext::new();
        let sandbox = SandboxedContext::new(context, "agent-1", None);

        assert!(!sandbox.sandbox_id.is_empty());
        assert_eq!(sandbox.agent_id, "agent-1");
        assert_eq!(sandbox.state, SandboxState::Active);
        assert!(sandbox.is_active());
        assert!(!sandbox.is_expired());
    }

    #[test]
    fn test_sandboxed_context_with_ttl() {
        let context = AgentContext::new();
        let sandbox = SandboxedContext::new(context, "agent-1", None).with_ttl(Duration::hours(1));

        assert!(sandbox.expires_at.is_some());
        assert!(!sandbox.is_expired());

        // Create an already expired sandbox
        let context = AgentContext::new();
        let sandbox =
            SandboxedContext::new(context, "agent-2", None).with_ttl(Duration::seconds(-1));

        assert!(sandbox.is_expired());
        assert!(!sandbox.is_active());
    }

    #[test]
    fn test_sandboxed_context_record_resources() {
        let context = AgentContext::new();
        let restrictions = SandboxRestrictions::new(100, 5, 10);
        let mut sandbox = SandboxedContext::new(context, "agent-1", Some(restrictions));

        // Record within limits
        assert!(sandbox.record_tokens(50).is_ok());
        assert_eq!(sandbox.resources.tokens_used, 50);

        // Record exceeding limits
        let result = sandbox.record_tokens(100);
        assert!(result.is_err());
        assert_eq!(sandbox.state, SandboxState::Suspended);
    }

    #[test]
    fn test_context_isolation_create_sandbox() {
        let mut isolation = ContextIsolation::new();
        let context = AgentContext::new();

        let sandbox = isolation.create_sandbox(context, Some("agent-1".to_string()), None);

        assert!(!sandbox.sandbox_id.is_empty());
        assert_eq!(sandbox.agent_id, "agent-1");
        assert_eq!(isolation.sandbox_count(), 1);

        // Can retrieve by sandbox ID
        assert!(isolation.get_sandbox(&sandbox.sandbox_id).is_some());

        // Can retrieve by agent ID
        assert!(isolation.get_isolated_context("agent-1").is_some());
    }

    #[test]
    fn test_context_isolation_suspend_resume() {
        let mut isolation = ContextIsolation::new();
        let context = AgentContext::new();
        let sandbox = isolation.create_sandbox(context, Some("agent-1".to_string()), None);
        let sandbox_id = sandbox.sandbox_id.clone();

        // Suspend
        assert!(isolation.suspend(&sandbox_id).is_ok());
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Suspended
        );

        // Resume
        assert!(isolation.resume(&sandbox_id).is_ok());
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Active
        );

        // Terminate
        assert!(isolation.terminate(&sandbox_id).is_ok());
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Terminated
        );

        // Cannot resume terminated
        assert!(isolation.resume(&sandbox_id).is_err());
    }

    #[test]
    fn test_context_isolation_cleanup() {
        let mut isolation = ContextIsolation::new();

        // Create some sandboxes
        let context1 = AgentContext::new();
        let sandbox1 = isolation.create_sandbox(context1, Some("agent-1".to_string()), None);
        let sandbox1_id = sandbox1.sandbox_id.clone();

        let context2 = AgentContext::new();
        let _sandbox2 = isolation.create_sandbox(context2, Some("agent-2".to_string()), None);

        assert_eq!(isolation.sandbox_count(), 2);

        // Cleanup one
        isolation.cleanup(&sandbox1_id);
        assert_eq!(isolation.sandbox_count(), 1);
        assert!(isolation.get_sandbox(&sandbox1_id).is_none());
        assert!(isolation.get_isolated_context("agent-1").is_none());
    }

    #[test]
    fn test_context_isolation_cleanup_expired() {
        let mut isolation = ContextIsolation::new();

        // Create an expired sandbox
        let context1 = AgentContext::new();
        let _sandbox1 = isolation.create_sandbox_with_ttl(
            context1,
            Some("agent-1".to_string()),
            None,
            Duration::seconds(-1), // Already expired
        );

        // Create a non-expired sandbox
        let context2 = AgentContext::new();
        let _sandbox2 = isolation.create_sandbox_with_ttl(
            context2,
            Some("agent-2".to_string()),
            None,
            Duration::hours(1),
        );

        assert_eq!(isolation.sandbox_count(), 2);

        // Cleanup expired
        let cleaned = isolation.cleanup_expired();
        assert_eq!(cleaned, 1);
        assert_eq!(isolation.sandbox_count(), 1);
        assert!(isolation.get_isolated_context("agent-1").is_none());
        assert!(isolation.get_isolated_context("agent-2").is_some());
    }

    #[test]
    fn test_context_isolation_is_tool_allowed() {
        let mut isolation = ContextIsolation::new();
        let context = AgentContext::new();
        let restrictions =
            SandboxRestrictions::default().with_allowed_tools(vec!["bash", "read_file"]);

        let sandbox =
            isolation.create_sandbox(context, Some("agent-1".to_string()), Some(restrictions));

        assert!(isolation.is_tool_allowed(&sandbox.sandbox_id, "bash"));
        assert!(isolation.is_tool_allowed(&sandbox.sandbox_id, "read_file"));
        assert!(!isolation.is_tool_allowed(&sandbox.sandbox_id, "write_file"));
        assert!(!isolation.is_tool_allowed("nonexistent", "bash"));
    }

    #[test]
    fn test_context_isolation_update_sandbox() {
        let mut isolation = ContextIsolation::new();
        let context = AgentContext::new();
        let sandbox = isolation.create_sandbox(context, Some("agent-1".to_string()), None);
        let sandbox_id = sandbox.sandbox_id.clone();

        let updates = ContextUpdate {
            add_files: Some(vec![FileContext::new("/test.rs", "fn main() {}")]),
            ..Default::default()
        };

        assert!(isolation.update_sandbox(&sandbox_id, updates).is_ok());

        let sandbox = isolation.get_sandbox(&sandbox_id).unwrap();
        assert_eq!(sandbox.context.file_context.len(), 1);
        assert_eq!(sandbox.resources.files_accessed, 1);
    }

    #[test]
    fn test_context_isolation_update_suspended_sandbox_fails() {
        let mut isolation = ContextIsolation::new();
        let context = AgentContext::new();
        let sandbox = isolation.create_sandbox(context, Some("agent-1".to_string()), None);
        let sandbox_id = sandbox.sandbox_id.clone();

        // Suspend the sandbox
        isolation.suspend(&sandbox_id).unwrap();

        // Try to update - should fail
        let updates = ContextUpdate {
            add_files: Some(vec![FileContext::new("/test.rs", "fn main() {}")]),
            ..Default::default()
        };

        assert!(isolation.update_sandbox(&sandbox_id, updates).is_err());
    }

    #[test]
    fn test_context_isolation_list_by_state() {
        let mut isolation = ContextIsolation::new();

        // Create sandboxes in different states
        let context1 = AgentContext::new();
        let sandbox1 = isolation.create_sandbox(context1, Some("agent-1".to_string()), None);

        let context2 = AgentContext::new();
        let sandbox2 = isolation.create_sandbox(context2, Some("agent-2".to_string()), None);
        isolation.suspend(&sandbox2.sandbox_id).unwrap();

        let context3 = AgentContext::new();
        let sandbox3 = isolation.create_sandbox(context3, Some("agent-3".to_string()), None);
        isolation.terminate(&sandbox3.sandbox_id).unwrap();

        // List by state
        let active = isolation.list_sandboxes_by_state(SandboxState::Active);
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].sandbox_id, sandbox1.sandbox_id);

        let suspended = isolation.list_sandboxes_by_state(SandboxState::Suspended);
        assert_eq!(suspended.len(), 1);

        let terminated = isolation.list_sandboxes_by_state(SandboxState::Terminated);
        assert_eq!(terminated.len(), 1);
    }
}
