//! Agent Resumer
//!
//! Provides agent resume capabilities including
//! resume point detection and state restoration.
//!
//! This module provides:
//! - Resume capability checking
//! - Resume point information retrieval
//! - Agent state restoration from checkpoints
//! - Resume summary generation

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::{AgentState, AgentStateManager, AgentStateStatus, Checkpoint, StateManagerError};

/// Result type alias for resumer operations
pub type ResumerResult<T> = Result<T, ResumerError>;

/// Error types for resumer operations
#[derive(Debug, Error)]
pub enum ResumerError {
    /// Agent not found
    #[error("Agent not found: {0}")]
    AgentNotFound(String),

    /// Agent cannot be resumed
    #[error("Agent cannot be resumed: {0}")]
    CannotResume(String),

    /// Checkpoint not found
    #[error("Checkpoint not found: {0}")]
    CheckpointNotFound(String),

    /// State manager error
    #[error("State manager error: {0}")]
    StateManager(#[from] StateManagerError),

    /// Invalid resume point
    #[error("Invalid resume point: {0}")]
    InvalidResumePoint(String),
}

/// Resume point specification
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ResumePoint {
    /// Resume from the last saved state
    #[default]
    Last,
    /// Resume from a specific checkpoint by ID
    Checkpoint(String),
    /// Resume from the beginning (restart)
    Beginning,
}

/// Options for resuming an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeOptions {
    /// Agent ID to resume
    pub agent_id: String,
    /// Where to resume from
    #[serde(default)]
    pub continue_from: ResumePoint,
    /// Whether to reset error state
    #[serde(default)]
    pub reset_errors: bool,
    /// Additional context to add on resume
    pub additional_context: Option<String>,
}

impl ResumeOptions {
    /// Create new resume options
    pub fn new(agent_id: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            continue_from: ResumePoint::Last,
            reset_errors: false,
            additional_context: None,
        }
    }

    /// Set resume point
    pub fn from_point(mut self, point: ResumePoint) -> Self {
        self.continue_from = point;
        self
    }

    /// Set to resume from a specific checkpoint
    pub fn from_checkpoint(mut self, checkpoint_id: impl Into<String>) -> Self {
        self.continue_from = ResumePoint::Checkpoint(checkpoint_id.into());
        self
    }

    /// Set to reset errors on resume
    pub fn with_reset_errors(mut self, reset: bool) -> Self {
        self.reset_errors = reset;
        self
    }

    /// Set additional context
    pub fn with_additional_context(mut self, context: impl Into<String>) -> Self {
        self.additional_context = Some(context.into());
        self
    }
}

/// Information about a resume point
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumePointInfo {
    /// Whether the agent can be resumed
    pub can_resume: bool,
    /// Agent ID
    pub agent_id: String,
    /// Current status
    pub status: AgentStateStatus,
    /// Current step number
    pub step: usize,
    /// Total steps (if known)
    pub total_steps: Option<usize>,
    /// Whether checkpoints are available
    pub checkpoint_available: bool,
    /// Last checkpoint (if any)
    pub last_checkpoint: Option<Checkpoint>,
    /// Number of errors encountered
    pub error_count: usize,
    /// Suggestions for resuming
    pub suggestions: Option<Vec<String>>,
}

impl ResumePointInfo {
    /// Create a new resume point info for a non-existent agent
    pub fn not_found(agent_id: impl Into<String>) -> Self {
        Self {
            can_resume: false,
            agent_id: agent_id.into(),
            status: AgentStateStatus::default(),
            step: 0,
            total_steps: None,
            checkpoint_available: false,
            last_checkpoint: None,
            error_count: 0,
            suggestions: Some(vec![
                "Agent state not found. Start a new agent instead.".to_string()
            ]),
        }
    }

    /// Create resume point info from an agent state
    pub fn from_state(state: &AgentState) -> Self {
        let can_resume = state.can_resume();
        let checkpoint_available = !state.checkpoints.is_empty();
        let last_checkpoint = state.latest_checkpoint().cloned();

        let mut suggestions = Vec::new();

        if can_resume {
            if checkpoint_available {
                suggestions
                    .push("Resume from the last checkpoint for a clean restart.".to_string());
            }
            if state.error_count > 0 {
                suggestions.push(format!(
                    "Consider resetting errors ({} errors encountered).",
                    state.error_count
                ));
            }
            if state.status == AgentStateStatus::Failed {
                suggestions.push("Agent failed. Review errors before resuming.".to_string());
            }
        } else {
            match state.status {
                AgentStateStatus::Completed => {
                    suggestions.push("Agent completed successfully. No resume needed.".to_string());
                }
                AgentStateStatus::Cancelled => {
                    suggestions.push("Agent was cancelled. Start a new agent instead.".to_string());
                }
                _ => {}
            }
        }

        Self {
            can_resume,
            agent_id: state.id.clone(),
            status: state.status,
            step: state.current_step,
            total_steps: state.total_steps,
            checkpoint_available,
            last_checkpoint,
            error_count: state.error_count,
            suggestions: if suggestions.is_empty() {
                None
            } else {
                Some(suggestions)
            },
        }
    }
}

/// Agent Resumer for resuming interrupted agents
#[derive(Debug)]
pub struct AgentResumer {
    /// State manager for loading/saving states
    state_manager: AgentStateManager,
}

impl AgentResumer {
    /// Create a new AgentResumer
    pub fn new(state_manager: AgentStateManager) -> Self {
        Self { state_manager }
    }

    /// Get a reference to the state manager
    pub fn state_manager(&self) -> &AgentStateManager {
        &self.state_manager
    }

    /// Check if an agent can be resumed
    pub async fn can_resume(&self, id: &str) -> bool {
        match self.state_manager.load_state(id).await {
            Ok(Some(state)) => state.can_resume(),
            _ => false,
        }
    }

    /// Get resume point information for an agent
    pub async fn get_resume_point(&self, id: &str) -> ResumePointInfo {
        match self.state_manager.load_state(id).await {
            Ok(Some(state)) => ResumePointInfo::from_state(&state),
            _ => ResumePointInfo::not_found(id),
        }
    }

    /// Resume an agent from a saved state
    ///
    /// This method loads the agent state and optionally:
    /// - Restores from a specific checkpoint
    /// - Resets error state
    /// - Adds additional context
    pub async fn resume(&self, options: ResumeOptions) -> ResumerResult<AgentState> {
        // Load the state
        let state = self.state_manager.load_state(&options.agent_id).await?;
        let mut state =
            state.ok_or_else(|| ResumerError::AgentNotFound(options.agent_id.clone()))?;

        // Check if resumable
        if !state.can_resume() {
            return Err(ResumerError::CannotResume(format!(
                "Agent {} is in status {:?} and cannot be resumed",
                options.agent_id, state.status
            )));
        }

        // Handle resume point
        match &options.continue_from {
            ResumePoint::Last => {
                // Resume from current state - no changes needed
            }
            ResumePoint::Checkpoint(checkpoint_id) => {
                // Find and restore from checkpoint
                let checkpoint = self
                    .state_manager
                    .load_checkpoint(&options.agent_id, checkpoint_id)
                    .await?
                    .ok_or_else(|| ResumerError::CheckpointNotFound(checkpoint_id.clone()))?;

                state.restore_from_checkpoint(&checkpoint);
            }
            ResumePoint::Beginning => {
                // Reset to beginning
                state.current_step = 0;
                state.messages.clear();
                state.tool_calls.clear();
                state.results.clear();
                state.checkpoint = None;
            }
        }

        // Reset errors if requested
        if options.reset_errors {
            state.reset_errors();
        }

        // Add additional context if provided
        if let Some(context) = &options.additional_context {
            state.set_metadata("additional_context", serde_json::json!(context));
        }

        // Update status to running if it was paused or failed
        if state.status == AgentStateStatus::Paused || state.status == AgentStateStatus::Failed {
            state.status = AgentStateStatus::Running;
        }

        // Save the updated state
        self.state_manager.save_state(&state).await?;

        Ok(state)
    }

    /// Create a summary of the resume point for an agent
    ///
    /// This generates a human-readable summary of the agent's current state
    /// and what would happen if it were resumed.
    pub async fn create_resume_summary(&self, id: &str) -> ResumerResult<String> {
        let state = self.state_manager.load_state(id).await?;
        let state = state.ok_or_else(|| ResumerError::AgentNotFound(id.to_string()))?;

        let mut summary = String::new();

        // Header
        summary.push_str(&format!("# Resume Summary for Agent: {}\n\n", state.id));

        // Status
        summary.push_str("## Status\n");
        summary.push_str(&format!("- Current Status: {:?}\n", state.status));
        summary.push_str(&format!("- Can Resume: {}\n", state.can_resume()));
        summary.push_str(&format!("- Agent Type: {}\n\n", state.agent_type));

        // Progress
        summary.push_str("## Progress\n");
        summary.push_str(&format!("- Current Step: {}\n", state.current_step));
        if let Some(total) = state.total_steps {
            summary.push_str(&format!("- Total Steps: {}\n", total));
            let progress = (state.current_step as f64 / total as f64 * 100.0).min(100.0);
            summary.push_str(&format!("- Progress: {:.1}%\n", progress));
        }
        summary.push_str(&format!("- Messages: {}\n", state.messages.len()));
        summary.push_str(&format!("- Tool Calls: {}\n", state.tool_calls.len()));
        summary.push_str(&format!("- Results: {}\n\n", state.results.len()));

        // Errors
        if state.error_count > 0 || state.retry_count > 0 {
            summary.push_str("## Errors\n");
            summary.push_str(&format!("- Error Count: {}\n", state.error_count));
            summary.push_str(&format!("- Retry Count: {}\n", state.retry_count));
            summary.push_str(&format!("- Max Retries: {}\n\n", state.max_retries));
        }

        // Checkpoints
        summary.push_str("## Checkpoints\n");
        if state.checkpoints.is_empty() {
            summary.push_str("- No checkpoints available\n\n");
        } else {
            summary.push_str(&format!(
                "- Available Checkpoints: {}\n",
                state.checkpoints.len()
            ));
            for (i, cp) in state.checkpoints.iter().enumerate() {
                let name = cp.name.as_deref().unwrap_or("unnamed");
                summary.push_str(&format!("  {}. {} (step {})\n", i + 1, name, cp.step));
            }
            summary.push('\n');
        }

        // Timestamps
        summary.push_str("## Timestamps\n");
        summary.push_str(&format!(
            "- Created: {}\n",
            state.created_at.format("%Y-%m-%d %H:%M:%S UTC")
        ));
        summary.push_str(&format!(
            "- Last Updated: {}\n\n",
            state.updated_at.format("%Y-%m-%d %H:%M:%S UTC")
        ));

        // Original prompt (truncated if too long)
        summary.push_str("## Original Prompt\n");
        let prompt_preview = if state.prompt.len() > 200 {
            // Use char_indices to find a safe UTF-8 boundary
            let truncate_at = state
                .prompt
                .char_indices()
                .take_while(|(i, _)| *i < 200)
                .last()
                .map(|(i, c)| i + c.len_utf8())
                .unwrap_or(0);
            format!(
                "{}...",
                state.prompt.get(..truncate_at).unwrap_or(&state.prompt)
            )
        } else {
            state.prompt.clone()
        };
        summary.push_str(&format!("{}\n\n", prompt_preview));

        // Recommendations
        summary.push_str("## Recommendations\n");
        if !state.can_resume() {
            match state.status {
                AgentStateStatus::Completed => {
                    summary.push_str("- Agent completed successfully. No resume needed.\n");
                }
                AgentStateStatus::Cancelled => {
                    summary.push_str("- Agent was cancelled. Consider starting a new agent.\n");
                }
                _ => {}
            }
        } else {
            if !state.checkpoints.is_empty() {
                summary.push_str(
                    "- Consider resuming from the latest checkpoint for a clean restart.\n",
                );
            }
            if state.error_count > 0 {
                summary.push_str(&format!(
                    "- {} errors encountered. Consider using reset_errors option.\n",
                    state.error_count
                ));
            }
            if state.status == AgentStateStatus::Failed {
                summary.push_str("- Agent failed. Review errors before resuming.\n");
            }
            if state.status == AgentStateStatus::Paused {
                summary.push_str("- Agent is paused. Resume to continue execution.\n");
            }
        }

        Ok(summary)
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
    fn test_resume_point_default() {
        let point = ResumePoint::default();
        assert_eq!(point, ResumePoint::Last);
    }

    #[test]
    fn test_resume_options_builder() {
        let options = ResumeOptions::new("agent-1")
            .from_checkpoint("cp-1")
            .with_reset_errors(true)
            .with_additional_context("Extra context");

        assert_eq!(options.agent_id, "agent-1");
        assert_eq!(
            options.continue_from,
            ResumePoint::Checkpoint("cp-1".to_string())
        );
        assert!(options.reset_errors);
        assert_eq!(
            options.additional_context,
            Some("Extra context".to_string())
        );
    }

    #[test]
    fn test_resume_point_info_not_found() {
        let info = ResumePointInfo::not_found("agent-1");

        assert!(!info.can_resume);
        assert_eq!(info.agent_id, "agent-1");
        assert!(info.suggestions.is_some());
    }

    #[test]
    fn test_resume_point_info_from_running_state() {
        let state = create_test_state("agent-1");
        let info = ResumePointInfo::from_state(&state);

        assert!(info.can_resume);
        assert_eq!(info.agent_id, "agent-1");
        assert_eq!(info.status, AgentStateStatus::Running);
        assert!(!info.checkpoint_available);
    }

    #[test]
    fn test_resume_point_info_from_completed_state() {
        let state = create_test_state("agent-1").with_status(AgentStateStatus::Completed);
        let info = ResumePointInfo::from_state(&state);

        assert!(!info.can_resume);
        assert!(info.suggestions.is_some());
        let suggestions = info.suggestions.unwrap();
        assert!(suggestions.iter().any(|s| s.contains("completed")));
    }

    #[test]
    fn test_resume_point_info_from_failed_state() {
        let mut state = create_test_state("agent-1").with_status(AgentStateStatus::Failed);
        state.error_count = 3;
        let info = ResumePointInfo::from_state(&state);

        assert!(info.can_resume);
        assert_eq!(info.error_count, 3);
        assert!(info.suggestions.is_some());
    }

    #[test]
    fn test_resume_point_info_with_checkpoint() {
        let mut state = create_test_state("agent-1");
        state.create_checkpoint(Some("test-checkpoint"));
        let info = ResumePointInfo::from_state(&state);

        assert!(info.can_resume);
        assert!(info.checkpoint_available);
        assert!(info.last_checkpoint.is_some());
    }

    #[tokio::test]
    async fn test_resumer_can_resume_nonexistent() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
        let resumer = AgentResumer::new(state_manager);

        assert!(!resumer.can_resume("nonexistent").await);
    }

    #[tokio::test]
    async fn test_resumer_can_resume_running() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let state = create_test_state("agent-1");
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        assert!(resumer.can_resume("agent-1").await);
    }

    #[tokio::test]
    async fn test_resumer_can_resume_completed() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let state = create_test_state("agent-1").with_status(AgentStateStatus::Completed);
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        assert!(!resumer.can_resume("agent-1").await);
    }

    #[tokio::test]
    async fn test_resumer_get_resume_point_nonexistent() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
        let resumer = AgentResumer::new(state_manager);

        let info = resumer.get_resume_point("nonexistent").await;
        assert!(!info.can_resume);
        assert_eq!(info.agent_id, "nonexistent");
    }

    #[tokio::test]
    async fn test_resumer_get_resume_point_existing() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let mut state = create_test_state("agent-1");
        state.current_step = 5;
        state.total_steps = Some(10);
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        let info = resumer.get_resume_point("agent-1").await;

        assert!(info.can_resume);
        assert_eq!(info.agent_id, "agent-1");
        assert_eq!(info.step, 5);
        assert_eq!(info.total_steps, Some(10));
    }

    #[tokio::test]
    async fn test_resumer_resume_from_last() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let mut state = create_test_state("agent-1").with_status(AgentStateStatus::Paused);
        state.current_step = 5;
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        let options = ResumeOptions::new("agent-1");

        let resumed = resumer.resume(options).await.unwrap();

        assert_eq!(resumed.current_step, 5);
        assert_eq!(resumed.status, AgentStateStatus::Running);
    }

    #[tokio::test]
    async fn test_resumer_resume_from_checkpoint() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        // Create state with checkpoint
        let mut state = create_test_state("agent-1");
        state.current_step = 3;
        let checkpoint = state.create_checkpoint(Some("cp-1"));

        // Advance state further
        state.current_step = 10;
        state.add_result(serde_json::json!({"result": "later"}));
        state_manager.save_state(&state).await.unwrap();
        state_manager.save_checkpoint(&checkpoint).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        let options = ResumeOptions::new("agent-1").from_checkpoint(&checkpoint.id);

        let resumed = resumer.resume(options).await.unwrap();

        // Should be restored to checkpoint state
        assert_eq!(resumed.current_step, 3);
    }

    #[tokio::test]
    async fn test_resumer_resume_from_beginning() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let mut state = create_test_state("agent-1");
        state.current_step = 10;
        state.add_result(serde_json::json!({"result": "test"}));
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        let options = ResumeOptions::new("agent-1").from_point(ResumePoint::Beginning);

        let resumed = resumer.resume(options).await.unwrap();

        assert_eq!(resumed.current_step, 0);
        assert!(resumed.messages.is_empty());
        assert!(resumed.tool_calls.is_empty());
        assert!(resumed.results.is_empty());
    }

    #[tokio::test]
    async fn test_resumer_resume_with_reset_errors() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let mut state = create_test_state("agent-1").with_status(AgentStateStatus::Failed);
        state.error_count = 5;
        state.retry_count = 3;
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        let options = ResumeOptions::new("agent-1").with_reset_errors(true);

        let resumed = resumer.resume(options).await.unwrap();

        assert_eq!(resumed.error_count, 0);
        assert_eq!(resumed.retry_count, 0);
        assert_eq!(resumed.status, AgentStateStatus::Running);
    }

    #[tokio::test]
    async fn test_resumer_resume_with_additional_context() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let state = create_test_state("agent-1");
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        let options =
            ResumeOptions::new("agent-1").with_additional_context("Extra context for resume");

        let resumed = resumer.resume(options).await.unwrap();

        let context = resumed.metadata.get("additional_context");
        assert!(context.is_some());
        assert_eq!(
            context.unwrap(),
            &serde_json::json!("Extra context for resume")
        );
    }

    #[tokio::test]
    async fn test_resumer_resume_nonexistent_fails() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
        let resumer = AgentResumer::new(state_manager);

        let options = ResumeOptions::new("nonexistent");
        let result = resumer.resume(options).await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ResumerError::AgentNotFound(_)
        ));
    }

    #[tokio::test]
    async fn test_resumer_resume_completed_fails() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let state = create_test_state("agent-1").with_status(AgentStateStatus::Completed);
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        let options = ResumeOptions::new("agent-1");
        let result = resumer.resume(options).await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ResumerError::CannotResume(_)));
    }

    #[tokio::test]
    async fn test_resumer_resume_invalid_checkpoint_fails() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let state = create_test_state("agent-1");
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        let options = ResumeOptions::new("agent-1").from_checkpoint("nonexistent-checkpoint");
        let result = resumer.resume(options).await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ResumerError::CheckpointNotFound(_)
        ));
    }

    #[tokio::test]
    async fn test_resumer_create_resume_summary() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

        let mut state = create_test_state("agent-1");
        state.current_step = 5;
        state.total_steps = Some(10);
        state.error_count = 2;
        state.create_checkpoint(Some("checkpoint-1"));
        state_manager.save_state(&state).await.unwrap();

        let resumer = AgentResumer::new(state_manager);
        let summary = resumer.create_resume_summary("agent-1").await.unwrap();

        // Verify summary contains expected sections
        assert!(summary.contains("Resume Summary"));
        assert!(summary.contains("agent-1"));
        assert!(summary.contains("Status"));
        assert!(summary.contains("Progress"));
        assert!(summary.contains("Current Step: 5"));
        assert!(summary.contains("Total Steps: 10"));
        assert!(summary.contains("Checkpoints"));
        assert!(summary.contains("checkpoint-1"));
        assert!(summary.contains("Errors"));
        assert!(summary.contains("Error Count: 2"));
    }

    #[tokio::test]
    async fn test_resumer_create_resume_summary_nonexistent_fails() {
        let temp_dir = TempDir::new().unwrap();
        let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
        let resumer = AgentResumer::new(state_manager);

        let result = resumer.create_resume_summary("nonexistent").await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ResumerError::AgentNotFound(_)
        ));
    }
}
