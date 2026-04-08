//! Agent State Manager
//!
//! Manages agent state persistence including save/load,
//! checkpoint management, and state cleanup.
//!
//! This module provides:
//! - Agent state persistence to disk
//! - State loading and listing
//! - Checkpoint creation and management
//! - Automatic cleanup of expired states

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;

use crate::conversation::message::Message;

/// Result type alias for state manager operations
pub type StateManagerResult<T> = Result<T, StateManagerError>;

/// Error types for state manager operations
#[derive(Debug, Error)]
pub enum StateManagerError {
    /// State not found
    #[error("State not found: {0}")]
    NotFound(String),

    /// Checkpoint not found
    #[error("Checkpoint not found: {0}")]
    CheckpointNotFound(String),

    /// I/O error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Serialization error
    #[error("Serialization error: {0}")]
    Serialization(String),

    /// Invalid state
    #[error("Invalid state: {0}")]
    InvalidState(String),
}

impl From<serde_json::Error> for StateManagerError {
    fn from(err: serde_json::Error) -> Self {
        StateManagerError::Serialization(err.to_string())
    }
}

/// Agent state status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentStateStatus {
    /// Agent is currently running
    #[default]
    Running,
    /// Agent is paused
    Paused,
    /// Agent completed successfully
    Completed,
    /// Agent failed with an error
    Failed,
    /// Agent was cancelled
    Cancelled,
}

impl AgentStateStatus {
    /// Check if the state is resumable
    pub fn is_resumable(&self) -> bool {
        matches!(self, Self::Running | Self::Paused | Self::Failed)
    }

    /// Check if the state is terminal (completed, cancelled)
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled)
    }
}

/// Tool call record for state persistence
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    /// Tool call ID
    pub id: String,
    /// Tool name
    pub tool_name: String,
    /// Input parameters
    pub input: serde_json::Value,
    /// Output result (if completed)
    pub output: Option<serde_json::Value>,
    /// Whether the call succeeded
    pub success: Option<bool>,
    /// Error message if failed
    pub error: Option<String>,
    /// Timestamp
    pub timestamp: DateTime<Utc>,
}

impl ToolCallRecord {
    /// Create a new tool call record
    pub fn new(tool_name: impl Into<String>, input: serde_json::Value) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            tool_name: tool_name.into(),
            input,
            output: None,
            success: None,
            error: None,
            timestamp: Utc::now(),
        }
    }

    /// Complete the tool call with success
    pub fn complete_success(&mut self, output: serde_json::Value) {
        self.output = Some(output);
        self.success = Some(true);
    }

    /// Complete the tool call with failure
    pub fn complete_failure(&mut self, error: impl Into<String>) {
        self.success = Some(false);
        self.error = Some(error.into());
    }
}

/// Checkpoint for agent state recovery
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    /// Unique checkpoint identifier
    pub id: String,
    /// Agent ID this checkpoint belongs to
    pub agent_id: String,
    /// Checkpoint name/label
    pub name: Option<String>,
    /// Step number at checkpoint
    pub step: usize,
    /// Messages at checkpoint
    pub messages: Vec<Message>,
    /// Tool calls at checkpoint
    pub tool_calls: Vec<ToolCallRecord>,
    /// Results at checkpoint
    pub results: Vec<serde_json::Value>,
    /// Metadata at checkpoint
    pub metadata: HashMap<String, serde_json::Value>,
    /// Creation timestamp
    pub created_at: DateTime<Utc>,
}

impl Checkpoint {
    /// Create a new checkpoint
    pub fn new(agent_id: impl Into<String>, step: usize) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            agent_id: agent_id.into(),
            name: None,
            step,
            messages: Vec::new(),
            tool_calls: Vec::new(),
            results: Vec::new(),
            metadata: HashMap::new(),
            created_at: Utc::now(),
        }
    }

    /// Set checkpoint name
    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    /// Set messages
    pub fn with_messages(mut self, messages: Vec<Message>) -> Self {
        self.messages = messages;
        self
    }

    /// Set tool calls
    pub fn with_tool_calls(mut self, tool_calls: Vec<ToolCallRecord>) -> Self {
        self.tool_calls = tool_calls;
        self
    }

    /// Set results
    pub fn with_results(mut self, results: Vec<serde_json::Value>) -> Self {
        self.results = results;
        self
    }

    /// Add metadata
    pub fn with_metadata(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.metadata.insert(key.into(), value);
        self
    }
}

/// Agent state for persistence and recovery
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentState {
    /// Unique state identifier (same as agent ID)
    pub id: String,
    /// Agent type
    pub agent_type: String,
    /// Current status
    pub status: AgentStateStatus,
    /// Creation timestamp
    pub created_at: DateTime<Utc>,
    /// Last update timestamp
    pub updated_at: DateTime<Utc>,
    /// Original prompt
    pub prompt: String,
    /// Conversation messages
    pub messages: Vec<Message>,
    /// Tool call records
    pub tool_calls: Vec<ToolCallRecord>,
    /// Results collected
    pub results: Vec<serde_json::Value>,
    /// Current checkpoint (if any)
    pub checkpoint: Option<Checkpoint>,
    /// All checkpoints
    pub checkpoints: Vec<Checkpoint>,
    /// Current step number
    pub current_step: usize,
    /// Total steps (if known)
    pub total_steps: Option<usize>,
    /// Error count
    pub error_count: usize,
    /// Retry count
    pub retry_count: usize,
    /// Maximum retries allowed
    pub max_retries: usize,
    /// Custom metadata
    pub metadata: HashMap<String, serde_json::Value>,
}

impl AgentState {
    /// Create a new agent state
    pub fn new(
        id: impl Into<String>,
        agent_type: impl Into<String>,
        prompt: impl Into<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: id.into(),
            agent_type: agent_type.into(),
            status: AgentStateStatus::Running,
            created_at: now,
            updated_at: now,
            prompt: prompt.into(),
            messages: Vec::new(),
            tool_calls: Vec::new(),
            results: Vec::new(),
            checkpoint: None,
            checkpoints: Vec::new(),
            current_step: 0,
            total_steps: None,
            error_count: 0,
            retry_count: 0,
            max_retries: 3,
            metadata: HashMap::new(),
        }
    }

    /// Set status
    pub fn with_status(mut self, status: AgentStateStatus) -> Self {
        self.status = status;
        self.updated_at = Utc::now();
        self
    }

    /// Set max retries
    pub fn with_max_retries(mut self, max_retries: usize) -> Self {
        self.max_retries = max_retries;
        self
    }

    /// Set total steps
    pub fn with_total_steps(mut self, total: usize) -> Self {
        self.total_steps = Some(total);
        self
    }

    /// Add a message
    pub fn add_message(&mut self, message: Message) {
        self.messages.push(message);
        self.updated_at = Utc::now();
    }

    /// Add a tool call
    pub fn add_tool_call(&mut self, tool_call: ToolCallRecord) {
        self.tool_calls.push(tool_call);
        self.updated_at = Utc::now();
    }

    /// Add a result
    pub fn add_result(&mut self, result: serde_json::Value) {
        self.results.push(result);
        self.updated_at = Utc::now();
    }

    /// Increment step
    pub fn increment_step(&mut self) {
        self.current_step += 1;
        self.updated_at = Utc::now();
    }

    /// Record an error
    pub fn record_error(&mut self) {
        self.error_count += 1;
        self.updated_at = Utc::now();
    }

    /// Record a retry
    pub fn record_retry(&mut self) {
        self.retry_count += 1;
        self.updated_at = Utc::now();
    }

    /// Reset error state
    pub fn reset_errors(&mut self) {
        self.error_count = 0;
        self.retry_count = 0;
        self.updated_at = Utc::now();
    }

    /// Set metadata
    pub fn set_metadata(&mut self, key: impl Into<String>, value: serde_json::Value) {
        self.metadata.insert(key.into(), value);
        self.updated_at = Utc::now();
    }

    /// Create a checkpoint from current state
    pub fn create_checkpoint(&mut self, name: Option<&str>) -> Checkpoint {
        let mut checkpoint = Checkpoint::new(&self.id, self.current_step)
            .with_messages(self.messages.clone())
            .with_tool_calls(self.tool_calls.clone())
            .with_results(self.results.clone());

        if let Some(n) = name {
            checkpoint = checkpoint.with_name(n);
        }

        for (k, v) in &self.metadata {
            checkpoint = checkpoint.with_metadata(k.clone(), v.clone());
        }

        self.checkpoint = Some(checkpoint.clone());
        self.checkpoints.push(checkpoint.clone());
        self.updated_at = Utc::now();

        checkpoint
    }

    /// Restore from a checkpoint
    pub fn restore_from_checkpoint(&mut self, checkpoint: &Checkpoint) {
        self.current_step = checkpoint.step;
        self.messages = checkpoint.messages.clone();
        self.tool_calls = checkpoint.tool_calls.clone();
        self.results = checkpoint.results.clone();
        self.metadata = checkpoint.metadata.clone();
        self.checkpoint = Some(checkpoint.clone());
        self.updated_at = Utc::now();
    }

    /// Check if can be resumed
    pub fn can_resume(&self) -> bool {
        self.status.is_resumable()
    }

    /// Get the latest checkpoint
    pub fn latest_checkpoint(&self) -> Option<&Checkpoint> {
        self.checkpoints.last()
    }

    /// Get age of the state
    pub fn age(&self) -> ChronoDuration {
        Utc::now().signed_duration_since(self.created_at)
    }

    /// Check if state is expired based on max age
    pub fn is_expired(&self, max_age: Duration) -> bool {
        let age = self.age();
        if let Ok(max_age_chrono) = ChronoDuration::from_std(max_age) {
            age > max_age_chrono
        } else {
            false
        }
    }
}

impl PartialEq for AgentState {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for AgentState {}

/// Filter for listing agent states
#[derive(Debug, Clone, Default)]
pub struct StateFilter {
    /// Filter by agent type
    pub agent_type: Option<String>,
    /// Filter by status
    pub status: Option<AgentStateStatus>,
    /// Filter by minimum creation time
    pub created_after: Option<DateTime<Utc>>,
    /// Filter by maximum creation time
    pub created_before: Option<DateTime<Utc>>,
    /// Filter by having checkpoints
    pub has_checkpoints: Option<bool>,
    /// Maximum number of results
    pub limit: Option<usize>,
}

impl StateFilter {
    /// Create a new filter
    pub fn new() -> Self {
        Self::default()
    }

    /// Filter by agent type
    pub fn with_agent_type(mut self, agent_type: impl Into<String>) -> Self {
        self.agent_type = Some(agent_type.into());
        self
    }

    /// Filter by status
    pub fn with_status(mut self, status: AgentStateStatus) -> Self {
        self.status = Some(status);
        self
    }

    /// Filter by creation time range
    pub fn created_between(mut self, after: DateTime<Utc>, before: DateTime<Utc>) -> Self {
        self.created_after = Some(after);
        self.created_before = Some(before);
        self
    }

    /// Filter by having checkpoints
    pub fn with_checkpoints(mut self, has: bool) -> Self {
        self.has_checkpoints = Some(has);
        self
    }

    /// Limit results
    pub fn with_limit(mut self, limit: usize) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Check if a state matches this filter
    pub fn matches(&self, state: &AgentState) -> bool {
        if let Some(ref agent_type) = self.agent_type {
            if &state.agent_type != agent_type {
                return false;
            }
        }

        if let Some(status) = self.status {
            if state.status != status {
                return false;
            }
        }

        if let Some(after) = self.created_after {
            if state.created_at < after {
                return false;
            }
        }

        if let Some(before) = self.created_before {
            if state.created_at > before {
                return false;
            }
        }

        if let Some(has_checkpoints) = self.has_checkpoints {
            let has = !state.checkpoints.is_empty();
            if has != has_checkpoints {
                return false;
            }
        }

        true
    }
}

/// Agent State Manager for persistence and recovery
#[derive(Debug)]
pub struct AgentStateManager {
    /// Storage directory for states
    storage_dir: PathBuf,
}

impl Default for AgentStateManager {
    fn default() -> Self {
        Self::new(None)
    }
}

impl AgentStateManager {
    /// Create a new AgentStateManager
    pub fn new(storage_dir: Option<PathBuf>) -> Self {
        let storage_dir = storage_dir.unwrap_or_else(|| PathBuf::from(".aster/states"));
        Self { storage_dir }
    }

    /// Get the storage directory
    pub fn storage_dir(&self) -> &PathBuf {
        &self.storage_dir
    }

    /// Set the storage directory
    pub fn set_storage_dir(&mut self, dir: PathBuf) {
        self.storage_dir = dir;
    }

    /// Get the file path for a state
    fn state_file_path(&self, id: &str) -> PathBuf {
        self.storage_dir.join(format!("{}.json", id))
    }

    /// Get the checkpoints directory for an agent
    fn checkpoints_dir(&self, agent_id: &str) -> PathBuf {
        self.storage_dir.join("checkpoints").join(agent_id)
    }

    /// Get the file path for a checkpoint
    fn checkpoint_file_path(&self, agent_id: &str, checkpoint_id: &str) -> PathBuf {
        self.checkpoints_dir(agent_id)
            .join(format!("{}.json", checkpoint_id))
    }

    /// Save agent state to disk
    pub async fn save_state(&self, state: &AgentState) -> StateManagerResult<()> {
        // Create storage directory if it doesn't exist
        tokio::fs::create_dir_all(&self.storage_dir).await?;

        let file_path = self.state_file_path(&state.id);
        let json = serde_json::to_string_pretty(state)?;
        tokio::fs::write(file_path, json).await?;

        Ok(())
    }

    /// Load agent state from disk
    pub async fn load_state(&self, id: &str) -> StateManagerResult<Option<AgentState>> {
        let file_path = self.state_file_path(id);

        if !file_path.exists() {
            return Ok(None);
        }

        let json = tokio::fs::read_to_string(&file_path).await?;
        let state: AgentState = serde_json::from_str(&json)?;

        Ok(Some(state))
    }

    /// List all saved agent states with optional filtering
    pub async fn list_states(
        &self,
        filter: Option<StateFilter>,
    ) -> StateManagerResult<Vec<AgentState>> {
        if !self.storage_dir.exists() {
            return Ok(Vec::new());
        }

        let mut states = Vec::new();
        let mut entries = tokio::fs::read_dir(&self.storage_dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();

            // Skip directories and non-JSON files
            if path.is_dir() || path.extension().is_none_or(|ext| ext != "json") {
                continue;
            }

            // Try to load the state
            if let Ok(json) = tokio::fs::read_to_string(&path).await {
                if let Ok(state) = serde_json::from_str::<AgentState>(&json) {
                    // Apply filter if provided
                    if let Some(ref f) = filter {
                        if f.matches(&state) {
                            states.push(state);
                        }
                    } else {
                        states.push(state);
                    }
                }
            }
        }

        // Sort by creation time (newest first)
        states.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        // Apply limit if specified
        if let Some(ref f) = filter {
            if let Some(limit) = f.limit {
                states.truncate(limit);
            }
        }

        Ok(states)
    }

    /// Delete agent state from disk
    pub async fn delete_state(&self, id: &str) -> StateManagerResult<bool> {
        let file_path = self.state_file_path(id);

        if !file_path.exists() {
            return Ok(false);
        }

        tokio::fs::remove_file(&file_path).await?;

        // Also delete checkpoints directory if it exists
        let checkpoints_dir = self.checkpoints_dir(id);
        if checkpoints_dir.exists() {
            tokio::fs::remove_dir_all(&checkpoints_dir).await?;
        }

        Ok(true)
    }

    /// Cleanup expired states based on max age
    pub async fn cleanup_expired(&self, max_age: Duration) -> StateManagerResult<usize> {
        if !self.storage_dir.exists() {
            return Ok(0);
        }

        let mut cleaned = 0;
        let mut entries = tokio::fs::read_dir(&self.storage_dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();

            // Skip directories and non-JSON files
            if path.is_dir() || path.extension().is_none_or(|ext| ext != "json") {
                continue;
            }

            // Try to load and check if expired
            if let Ok(json) = tokio::fs::read_to_string(&path).await {
                if let Ok(state) = serde_json::from_str::<AgentState>(&json) {
                    if state.is_expired(max_age) {
                        // Delete the state file
                        if tokio::fs::remove_file(&path).await.is_ok() {
                            cleaned += 1;

                            // Also delete checkpoints directory
                            let checkpoints_dir = self.checkpoints_dir(&state.id);
                            let _ = tokio::fs::remove_dir_all(&checkpoints_dir).await;
                        }
                    }
                }
            }
        }

        Ok(cleaned)
    }

    /// Save a checkpoint to disk
    pub async fn save_checkpoint(&self, checkpoint: &Checkpoint) -> StateManagerResult<()> {
        let checkpoints_dir = self.checkpoints_dir(&checkpoint.agent_id);
        tokio::fs::create_dir_all(&checkpoints_dir).await?;

        let file_path = self.checkpoint_file_path(&checkpoint.agent_id, &checkpoint.id);
        let json = serde_json::to_string_pretty(checkpoint)?;
        tokio::fs::write(file_path, json).await?;

        Ok(())
    }

    /// Load a checkpoint from disk
    pub async fn load_checkpoint(
        &self,
        agent_id: &str,
        checkpoint_id: &str,
    ) -> StateManagerResult<Option<Checkpoint>> {
        let file_path = self.checkpoint_file_path(agent_id, checkpoint_id);

        if !file_path.exists() {
            return Ok(None);
        }

        let json = tokio::fs::read_to_string(&file_path).await?;
        let checkpoint: Checkpoint = serde_json::from_str(&json)?;

        Ok(Some(checkpoint))
    }

    /// List all checkpoints for an agent
    pub async fn list_checkpoints(&self, agent_id: &str) -> StateManagerResult<Vec<Checkpoint>> {
        let checkpoints_dir = self.checkpoints_dir(agent_id);

        if !checkpoints_dir.exists() {
            return Ok(Vec::new());
        }

        let mut checkpoints = Vec::new();
        let mut entries = tokio::fs::read_dir(&checkpoints_dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();

            // Skip non-JSON files
            if path.extension().is_none_or(|ext| ext != "json") {
                continue;
            }

            if let Ok(json) = tokio::fs::read_to_string(&path).await {
                if let Ok(checkpoint) = serde_json::from_str::<Checkpoint>(&json) {
                    checkpoints.push(checkpoint);
                }
            }
        }

        // Sort by step number
        checkpoints.sort_by_key(|c| c.step);

        Ok(checkpoints)
    }

    /// Delete a checkpoint
    pub async fn delete_checkpoint(
        &self,
        agent_id: &str,
        checkpoint_id: &str,
    ) -> StateManagerResult<bool> {
        let file_path = self.checkpoint_file_path(agent_id, checkpoint_id);

        if !file_path.exists() {
            return Ok(false);
        }

        tokio::fs::remove_file(&file_path).await?;
        Ok(true)
    }

    /// Check if a state exists
    pub async fn state_exists(&self, id: &str) -> bool {
        self.state_file_path(id).exists()
    }

    /// Get the count of saved states
    pub async fn state_count(&self) -> StateManagerResult<usize> {
        if !self.storage_dir.exists() {
            return Ok(0);
        }

        let mut count = 0;
        let mut entries = tokio::fs::read_dir(&self.storage_dir).await?;

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if !path.is_dir() && path.extension().is_some_and(|ext| ext == "json") {
                count += 1;
            }
        }

        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_state(id: &str) -> AgentState {
        AgentState::new(id, "test_agent", "Test prompt")
    }

    #[test]
    fn test_agent_state_creation() {
        let state = AgentState::new("agent-1", "test_agent", "Test prompt");

        assert_eq!(state.id, "agent-1");
        assert_eq!(state.agent_type, "test_agent");
        assert_eq!(state.prompt, "Test prompt");
        assert_eq!(state.status, AgentStateStatus::Running);
        assert_eq!(state.current_step, 0);
        assert_eq!(state.error_count, 0);
        assert!(state.messages.is_empty());
        assert!(state.checkpoints.is_empty());
    }

    #[test]
    fn test_agent_state_status_resumable() {
        assert!(AgentStateStatus::Running.is_resumable());
        assert!(AgentStateStatus::Paused.is_resumable());
        assert!(AgentStateStatus::Failed.is_resumable());
        assert!(!AgentStateStatus::Completed.is_resumable());
        assert!(!AgentStateStatus::Cancelled.is_resumable());
    }

    #[test]
    fn test_agent_state_status_terminal() {
        assert!(!AgentStateStatus::Running.is_terminal());
        assert!(!AgentStateStatus::Paused.is_terminal());
        assert!(!AgentStateStatus::Failed.is_terminal());
        assert!(AgentStateStatus::Completed.is_terminal());
        assert!(AgentStateStatus::Cancelled.is_terminal());
    }

    #[test]
    fn test_agent_state_increment_step() {
        let mut state = create_test_state("agent-1");
        assert_eq!(state.current_step, 0);

        state.increment_step();
        assert_eq!(state.current_step, 1);

        state.increment_step();
        assert_eq!(state.current_step, 2);
    }

    #[test]
    fn test_agent_state_error_tracking() {
        let mut state = create_test_state("agent-1");
        assert_eq!(state.error_count, 0);
        assert_eq!(state.retry_count, 0);

        state.record_error();
        assert_eq!(state.error_count, 1);

        state.record_retry();
        assert_eq!(state.retry_count, 1);

        state.reset_errors();
        assert_eq!(state.error_count, 0);
        assert_eq!(state.retry_count, 0);
    }

    #[test]
    fn test_checkpoint_creation() {
        let checkpoint = Checkpoint::new("agent-1", 5).with_name("test_checkpoint");

        assert!(!checkpoint.id.is_empty());
        assert_eq!(checkpoint.agent_id, "agent-1");
        assert_eq!(checkpoint.step, 5);
        assert_eq!(checkpoint.name, Some("test_checkpoint".to_string()));
    }

    #[test]
    fn test_agent_state_create_checkpoint() {
        let mut state = create_test_state("agent-1");
        state.current_step = 3;
        state.set_metadata("key", serde_json::json!("value"));

        let checkpoint = state.create_checkpoint(Some("checkpoint-1"));

        assert_eq!(checkpoint.agent_id, "agent-1");
        assert_eq!(checkpoint.step, 3);
        assert_eq!(checkpoint.name, Some("checkpoint-1".to_string()));
        assert!(state.checkpoint.is_some());
        assert_eq!(state.checkpoints.len(), 1);
    }

    #[test]
    fn test_agent_state_restore_from_checkpoint() {
        let mut state = create_test_state("agent-1");
        state.current_step = 5;
        state.add_result(serde_json::json!({"result": 1}));

        let checkpoint = state.create_checkpoint(Some("cp-1"));

        // Modify state
        state.current_step = 10;
        state.add_result(serde_json::json!({"result": 2}));

        // Restore
        state.restore_from_checkpoint(&checkpoint);

        assert_eq!(state.current_step, 5);
        assert_eq!(state.results.len(), 1);
    }

    #[test]
    fn test_tool_call_record() {
        let mut record = ToolCallRecord::new("test_tool", serde_json::json!({"arg": "value"}));

        assert!(!record.id.is_empty());
        assert_eq!(record.tool_name, "test_tool");
        assert!(record.success.is_none());

        record.complete_success(serde_json::json!({"output": "result"}));
        assert_eq!(record.success, Some(true));
        assert!(record.output.is_some());
    }

    #[test]
    fn test_tool_call_record_failure() {
        let mut record = ToolCallRecord::new("test_tool", serde_json::json!({}));
        record.complete_failure("Test error");

        assert_eq!(record.success, Some(false));
        assert_eq!(record.error, Some("Test error".to_string()));
    }

    #[test]
    fn test_state_filter_matches() {
        let state = AgentState::new("agent-1", "test_agent", "prompt")
            .with_status(AgentStateStatus::Running);

        // Empty filter matches all
        let filter = StateFilter::new();
        assert!(filter.matches(&state));

        // Type filter
        let filter = StateFilter::new().with_agent_type("test_agent");
        assert!(filter.matches(&state));

        let filter = StateFilter::new().with_agent_type("other_agent");
        assert!(!filter.matches(&state));

        // Status filter
        let filter = StateFilter::new().with_status(AgentStateStatus::Running);
        assert!(filter.matches(&state));

        let filter = StateFilter::new().with_status(AgentStateStatus::Completed);
        assert!(!filter.matches(&state));
    }

    #[test]
    fn test_state_filter_checkpoints() {
        let mut state = create_test_state("agent-1");

        let filter = StateFilter::new().with_checkpoints(false);
        assert!(filter.matches(&state));

        let filter = StateFilter::new().with_checkpoints(true);
        assert!(!filter.matches(&state));

        state.create_checkpoint(None);

        let filter = StateFilter::new().with_checkpoints(true);
        assert!(filter.matches(&state));
    }

    #[tokio::test]
    async fn test_state_manager_save_load() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let state = create_test_state("agent-1");
        manager.save_state(&state).await.unwrap();

        let loaded = manager.load_state("agent-1").await.unwrap();
        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.id, "agent-1");
        assert_eq!(loaded.agent_type, "test_agent");
    }

    #[tokio::test]
    async fn test_state_manager_load_nonexistent() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let loaded = manager.load_state("nonexistent").await.unwrap();
        assert!(loaded.is_none());
    }

    #[tokio::test]
    async fn test_state_manager_delete() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let state = create_test_state("agent-1");
        manager.save_state(&state).await.unwrap();

        let deleted = manager.delete_state("agent-1").await.unwrap();
        assert!(deleted);

        let loaded = manager.load_state("agent-1").await.unwrap();
        assert!(loaded.is_none());

        // Delete nonexistent
        let deleted = manager.delete_state("agent-1").await.unwrap();
        assert!(!deleted);
    }

    #[tokio::test]
    async fn test_state_manager_list_states() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        // Save multiple states
        for i in 1..=3 {
            let state = AgentState::new(format!("agent-{}", i), "test_agent", "prompt");
            manager.save_state(&state).await.unwrap();
        }

        let states = manager.list_states(None).await.unwrap();
        assert_eq!(states.len(), 3);
    }

    #[tokio::test]
    async fn test_state_manager_list_with_filter() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        // Save states with different types
        let state1 = AgentState::new("agent-1", "type_a", "prompt");
        let state2 = AgentState::new("agent-2", "type_b", "prompt");
        let state3 = AgentState::new("agent-3", "type_a", "prompt");

        manager.save_state(&state1).await.unwrap();
        manager.save_state(&state2).await.unwrap();
        manager.save_state(&state3).await.unwrap();

        let filter = StateFilter::new().with_agent_type("type_a");
        let states = manager.list_states(Some(filter)).await.unwrap();
        assert_eq!(states.len(), 2);
    }

    #[tokio::test]
    async fn test_state_manager_list_with_limit() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        for i in 1..=5 {
            let state = AgentState::new(format!("agent-{}", i), "test", "prompt");
            manager.save_state(&state).await.unwrap();
        }

        let filter = StateFilter::new().with_limit(2);
        let states = manager.list_states(Some(filter)).await.unwrap();
        assert_eq!(states.len(), 2);
    }

    #[tokio::test]
    async fn test_checkpoint_save_load() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let checkpoint = Checkpoint::new("agent-1", 5)
            .with_name("test_checkpoint")
            .with_results(vec![serde_json::json!({"result": 1})]);

        manager.save_checkpoint(&checkpoint).await.unwrap();

        let loaded = manager
            .load_checkpoint("agent-1", &checkpoint.id)
            .await
            .unwrap();
        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.step, 5);
        assert_eq!(loaded.name, Some("test_checkpoint".to_string()));
    }

    #[tokio::test]
    async fn test_list_checkpoints() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        // Save multiple checkpoints
        for step in [1, 3, 2] {
            let checkpoint = Checkpoint::new("agent-1", step);
            manager.save_checkpoint(&checkpoint).await.unwrap();
        }

        let checkpoints = manager.list_checkpoints("agent-1").await.unwrap();
        assert_eq!(checkpoints.len(), 3);
        // Should be sorted by step
        assert_eq!(checkpoints[0].step, 1);
        assert_eq!(checkpoints[1].step, 2);
        assert_eq!(checkpoints[2].step, 3);
    }

    #[tokio::test]
    async fn test_state_count() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        assert_eq!(manager.state_count().await.unwrap(), 0);

        for i in 1..=3 {
            let state = create_test_state(&format!("agent-{}", i));
            manager.save_state(&state).await.unwrap();
        }

        assert_eq!(manager.state_count().await.unwrap(), 3);
    }

    #[tokio::test]
    async fn test_state_exists() {
        let temp_dir = TempDir::new().unwrap();
        let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        assert!(!manager.state_exists("agent-1").await);

        let state = create_test_state("agent-1");
        manager.save_state(&state).await.unwrap();

        assert!(manager.state_exists("agent-1").await);
    }
}
