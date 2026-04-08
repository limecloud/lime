//! Property-based tests for Agent Resumer
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.
//!
//! **Feature: agents-alignment**
//!
//! Properties tested:
//! - Property 33: Resume Capability Check
//! - Property 34: Agent Resume Behavior

use proptest::prelude::*;
use tempfile::TempDir;

use super::resumer::{AgentResumer, ResumeOptions, ResumePoint, ResumePointInfo};
use super::state_manager::{AgentState, AgentStateManager, AgentStateStatus};

// Strategy for generating agent IDs
fn agent_id_strategy() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_-]{0,15}".prop_map(|s| s.to_string())
}

// Strategy for generating agent types
fn agent_type_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("explore".to_string()),
        Just("plan".to_string()),
        Just("execute".to_string()),
        Just("test".to_string()),
        Just("custom".to_string()),
    ]
}

// Strategy for generating prompts
fn prompt_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 .,!?]{1,100}".prop_map(|s| s.to_string())
}

// Strategy for generating resumable statuses
fn resumable_status_strategy() -> impl Strategy<Value = AgentStateStatus> {
    prop_oneof![
        Just(AgentStateStatus::Running),
        Just(AgentStateStatus::Paused),
        Just(AgentStateStatus::Failed),
    ]
}

// Strategy for generating non-resumable (terminal) statuses
fn terminal_status_strategy() -> impl Strategy<Value = AgentStateStatus> {
    prop_oneof![
        Just(AgentStateStatus::Completed),
        Just(AgentStateStatus::Cancelled),
    ]
}

// Strategy for generating any status
fn status_strategy() -> impl Strategy<Value = AgentStateStatus> {
    prop_oneof![
        Just(AgentStateStatus::Running),
        Just(AgentStateStatus::Paused),
        Just(AgentStateStatus::Completed),
        Just(AgentStateStatus::Failed),
        Just(AgentStateStatus::Cancelled),
    ]
}

// Strategy for generating a complete agent state
fn agent_state_strategy() -> impl Strategy<Value = AgentState> {
    (
        agent_id_strategy(),
        agent_type_strategy(),
        prompt_strategy(),
        status_strategy(),
        0usize..100usize,                   // current_step
        prop::option::of(1usize..200usize), // total_steps
        0usize..10usize,                    // error_count
        0usize..5usize,                     // retry_count
        prop::bool::ANY,                    // has_checkpoint
    )
        .prop_map(
            |(
                id,
                agent_type,
                prompt,
                status,
                step,
                total_steps,
                errors,
                retries,
                has_checkpoint,
            )| {
                let mut state = AgentState::new(id, agent_type, prompt).with_status(status);
                state.current_step = step;
                if let Some(total) = total_steps {
                    state.total_steps = Some(total);
                }
                state.error_count = errors;
                state.retry_count = retries;
                if has_checkpoint {
                    state.create_checkpoint(Some("auto-checkpoint"));
                }
                state
            },
        )
}

// **Property 33: Resume Capability Check**
//
// *For any* agent state, resume capability check SHALL correctly identify
// resumable states (not completed/cancelled) and provide accurate resume point information.
//
// **Validates: Requirements 12.1, 12.2**
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // Feature: agents-alignment, Property 33: Resume Capability Check
    // Validates: Requirements 12.1, 12.2
    #[test]
    fn property_33_can_resume_returns_true_for_resumable_states(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        status in resumable_status_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a state with resumable status
            let state = AgentState::new(id.clone(), agent_type, prompt)
                .with_status(status);
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);

            // can_resume should return true for resumable states
            let can_resume = resumer.can_resume(&id).await;
            prop_assert!(
                can_resume,
                "can_resume should return true for status {:?}",
                status
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 33: Resume Capability Check
    // Validates: Requirements 12.1, 12.2
    #[test]
    fn property_33_can_resume_returns_false_for_terminal_states(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        status in terminal_status_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a state with terminal status
            let state = AgentState::new(id.clone(), agent_type, prompt)
                .with_status(status);
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);

            // can_resume should return false for terminal states
            let can_resume = resumer.can_resume(&id).await;
            prop_assert!(
                !can_resume,
                "can_resume should return false for status {:?}",
                status
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 33: Resume Capability Check
    // Validates: Requirements 12.1, 12.2
    #[test]
    fn property_33_can_resume_returns_false_for_nonexistent(
        id in agent_id_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
            let resumer = AgentResumer::new(state_manager);

            // can_resume should return false for nonexistent agents
            let can_resume = resumer.can_resume(&id).await;
            prop_assert!(
                !can_resume,
                "can_resume should return false for nonexistent agent"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 33: Resume Capability Check
    // Validates: Requirements 12.1, 12.2
    #[test]
    fn property_33_get_resume_point_returns_accurate_info(
        state in agent_state_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Save the state
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);

            // Get resume point info
            let info = resumer.get_resume_point(&state.id).await;

            // Verify accuracy of resume point info
            prop_assert_eq!(
                &info.agent_id,
                &state.id,
                "Agent ID should match"
            );
            prop_assert_eq!(
                info.status,
                state.status,
                "Status should match"
            );
            prop_assert_eq!(
                info.step,
                state.current_step,
                "Step should match"
            );
            prop_assert_eq!(
                info.total_steps,
                state.total_steps,
                "Total steps should match"
            );
            prop_assert_eq!(
                info.error_count,
                state.error_count,
                "Error count should match"
            );
            prop_assert_eq!(
                info.can_resume,
                state.can_resume(),
                "can_resume should match state.can_resume()"
            );
            prop_assert_eq!(
                info.checkpoint_available,
                !state.checkpoints.is_empty(),
                "checkpoint_available should match"
            );

            // If checkpoints exist, last_checkpoint should be present
            if !state.checkpoints.is_empty() {
                prop_assert!(
                    info.last_checkpoint.is_some(),
                    "last_checkpoint should be present when checkpoints exist"
                );
            }

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 33: Resume Capability Check
    // Validates: Requirements 12.1, 12.2
    #[test]
    fn property_33_get_resume_point_nonexistent_returns_not_found(
        id in agent_id_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
            let resumer = AgentResumer::new(state_manager);

            // Get resume point info for nonexistent agent
            let info = resumer.get_resume_point(&id).await;

            // Should indicate cannot resume
            prop_assert!(
                !info.can_resume,
                "can_resume should be false for nonexistent agent"
            );
            prop_assert_eq!(
                &info.agent_id,
                &id,
                "Agent ID should match the requested ID"
            );
            prop_assert!(
                info.suggestions.is_some(),
                "Suggestions should be provided for nonexistent agent"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 33: Resume Capability Check
    // Validates: Requirements 12.1, 12.2
    #[test]
    fn property_33_resume_point_provides_suggestions_for_failed_states(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        error_count in 1usize..10usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a failed state with errors
            let mut state = AgentState::new(id.clone(), agent_type, prompt)
                .with_status(AgentStateStatus::Failed);
            state.error_count = error_count;
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);

            // Get resume point info
            let info = resumer.get_resume_point(&id).await;

            // Should be resumable
            prop_assert!(
                info.can_resume,
                "Failed states should be resumable"
            );

            // Should have suggestions
            prop_assert!(
                info.suggestions.is_some(),
                "Failed states should have suggestions"
            );

            // Suggestions should mention errors or failed status
            let suggestions = info.suggestions.unwrap();
            let has_relevant_suggestion = suggestions.iter().any(|s| {
                s.contains("error") || s.contains("failed") || s.contains("Failed")
            });
            prop_assert!(
                has_relevant_suggestion,
                "Suggestions should mention errors or failed status"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 33: Resume Capability Check
    // Validates: Requirements 12.1, 12.2
    #[test]
    fn property_33_resume_point_indicates_checkpoint_availability(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        num_checkpoints in 0usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a state with specified number of checkpoints
            let mut state = AgentState::new(id.clone(), agent_type, prompt);
            for i in 0..num_checkpoints {
                state.current_step = i;
                state.create_checkpoint(Some(&format!("checkpoint-{}", i)));
            }
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);

            // Get resume point info
            let info = resumer.get_resume_point(&id).await;

            // Verify checkpoint availability
            let expected_available = num_checkpoints > 0;
            prop_assert_eq!(
                info.checkpoint_available,
                expected_available,
                "checkpoint_available should be {} when {} checkpoints exist",
                expected_available,
                num_checkpoints
            );

            // Verify last_checkpoint presence
            if num_checkpoints > 0 {
                prop_assert!(
                    info.last_checkpoint.is_some(),
                    "last_checkpoint should be present when checkpoints exist"
                );
            } else {
                prop_assert!(
                    info.last_checkpoint.is_none(),
                    "last_checkpoint should be None when no checkpoints exist"
                );
            }

            Ok(())
        })?;
    }
}

// Additional unit tests for edge cases
#[tokio::test]
async fn property_33_resume_point_info_from_state_consistency() {
    // Test that ResumePointInfo::from_state produces consistent results
    let state =
        AgentState::new("test-agent", "test", "Test prompt").with_status(AgentStateStatus::Running);

    let info = ResumePointInfo::from_state(&state);

    assert!(info.can_resume);
    assert_eq!(info.agent_id, "test-agent");
    assert_eq!(info.status, AgentStateStatus::Running);
    assert!(!info.checkpoint_available);
    assert!(info.last_checkpoint.is_none());
}

#[tokio::test]
async fn property_33_resume_options_builder_consistency() {
    // Test ResumeOptions builder
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

    // Test from_point
    let options2 = ResumeOptions::new("agent-2").from_point(ResumePoint::Beginning);
    assert_eq!(options2.continue_from, ResumePoint::Beginning);
}

// **Property 34: Agent Resume Behavior**
//
// *For any* resumable agent, resuming SHALL restore state from the specified point
// (last or checkpoint), optionally reset errors, and include additional context.
//
// **Validates: Requirements 12.3, 12.4, 12.5, 12.6**
proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // Feature: agents-alignment, Property 34: Agent Resume Behavior
    // Validates: Requirements 12.3, 12.4, 12.5, 12.6
    #[test]
    fn property_34_resume_from_last_preserves_state(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        status in resumable_status_strategy(),
        current_step in 0usize..100usize,
        error_count in 0usize..10usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a resumable state
            let mut state = AgentState::new(id.clone(), agent_type.clone(), prompt.clone())
                .with_status(status);
            state.current_step = current_step;
            state.error_count = error_count;
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);
            let options = ResumeOptions::new(id.clone());

            // Resume from last
            let resumed = resumer.resume(options).await;
            prop_assert!(resumed.is_ok(), "Resume should succeed for resumable state");

            let resumed = resumed.unwrap();

            // Verify state is preserved
            prop_assert_eq!(
                resumed.current_step,
                current_step,
                "Current step should be preserved"
            );
            prop_assert_eq!(
                &resumed.agent_type,
                &agent_type,
                "Agent type should be preserved"
            );
            prop_assert_eq!(
                &resumed.prompt,
                &prompt,
                "Prompt should be preserved"
            );

            // Status should be Running after resume
            prop_assert_eq!(
                resumed.status,
                AgentStateStatus::Running,
                "Status should be Running after resume"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 34: Agent Resume Behavior
    // Validates: Requirements 12.3, 12.4
    #[test]
    fn property_34_resume_from_checkpoint_restores_checkpoint_state(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        checkpoint_step in 1usize..50usize,
        final_step in 50usize..100usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create state and checkpoint at an earlier step
            let mut state = AgentState::new(id.clone(), agent_type, prompt);
            state.current_step = checkpoint_step;
            state.add_result(serde_json::json!({"checkpoint_result": true}));
            let checkpoint = state.create_checkpoint(Some("test-checkpoint"));

            // Advance state further
            state.current_step = final_step;
            state.add_result(serde_json::json!({"later_result": true}));

            state_manager.save_state(&state).await.unwrap();
            state_manager.save_checkpoint(&checkpoint).await.unwrap();

            let resumer = AgentResumer::new(state_manager);
            let options = ResumeOptions::new(id.clone())
                .from_checkpoint(&checkpoint.id);

            // Resume from checkpoint
            let resumed = resumer.resume(options).await;
            prop_assert!(resumed.is_ok(), "Resume from checkpoint should succeed");

            let resumed = resumed.unwrap();

            // Verify state is restored to checkpoint
            prop_assert_eq!(
                resumed.current_step,
                checkpoint_step,
                "Current step should be restored to checkpoint step"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 34: Agent Resume Behavior
    // Validates: Requirements 12.4
    #[test]
    fn property_34_resume_with_reset_errors_clears_error_state(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        error_count in 1usize..10usize,
        retry_count in 1usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a failed state with errors
            let mut state = AgentState::new(id.clone(), agent_type, prompt)
                .with_status(AgentStateStatus::Failed);
            state.error_count = error_count;
            state.retry_count = retry_count;
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);
            let options = ResumeOptions::new(id.clone())
                .with_reset_errors(true);

            // Resume with reset errors
            let resumed = resumer.resume(options).await;
            prop_assert!(resumed.is_ok(), "Resume with reset errors should succeed");

            let resumed = resumed.unwrap();

            // Verify errors are reset
            prop_assert_eq!(
                resumed.error_count,
                0,
                "Error count should be reset to 0"
            );
            prop_assert_eq!(
                resumed.retry_count,
                0,
                "Retry count should be reset to 0"
            );
            prop_assert_eq!(
                resumed.status,
                AgentStateStatus::Running,
                "Status should be Running after resume"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 34: Agent Resume Behavior
    // Validates: Requirements 12.5
    #[test]
    fn property_34_resume_with_additional_context_adds_metadata(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        additional_context in "[a-zA-Z0-9 ]{1,50}".prop_map(|s| s.to_string())
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a resumable state
            let state = AgentState::new(id.clone(), agent_type, prompt);
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);
            let options = ResumeOptions::new(id.clone())
                .with_additional_context(additional_context.clone());

            // Resume with additional context
            let resumed = resumer.resume(options).await;
            prop_assert!(resumed.is_ok(), "Resume with additional context should succeed");

            let resumed = resumed.unwrap();

            // Verify additional context is added to metadata
            let context = resumed.metadata.get("additional_context");
            prop_assert!(
                context.is_some(),
                "Additional context should be in metadata"
            );
            prop_assert_eq!(
                context.unwrap(),
                &serde_json::json!(additional_context),
                "Additional context value should match"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 34: Agent Resume Behavior
    // Validates: Requirements 12.3
    #[test]
    fn property_34_resume_from_beginning_resets_state(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        current_step in 1usize..100usize,
        num_results in 1usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a state with progress
            let mut state = AgentState::new(id.clone(), agent_type, prompt);
            state.current_step = current_step;
            for i in 0..num_results {
                state.add_result(serde_json::json!({"result": i}));
            }
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);
            let options = ResumeOptions::new(id.clone())
                .from_point(ResumePoint::Beginning);

            // Resume from beginning
            let resumed = resumer.resume(options).await;
            prop_assert!(resumed.is_ok(), "Resume from beginning should succeed");

            let resumed = resumed.unwrap();

            // Verify state is reset
            prop_assert_eq!(
                resumed.current_step,
                0,
                "Current step should be reset to 0"
            );
            prop_assert!(
                resumed.messages.is_empty(),
                "Messages should be cleared"
            );
            prop_assert!(
                resumed.tool_calls.is_empty(),
                "Tool calls should be cleared"
            );
            prop_assert!(
                resumed.results.is_empty(),
                "Results should be cleared"
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 34: Agent Resume Behavior
    // Validates: Requirements 12.3
    #[test]
    fn property_34_resume_fails_for_terminal_states(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        status in terminal_status_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a terminal state
            let state = AgentState::new(id.clone(), agent_type, prompt)
                .with_status(status);
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);
            let options = ResumeOptions::new(id.clone());

            // Resume should fail for terminal states
            let result = resumer.resume(options).await;
            prop_assert!(
                result.is_err(),
                "Resume should fail for terminal status {:?}",
                status
            );

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 34: Agent Resume Behavior
    // Validates: Requirements 12.6
    #[test]
    fn property_34_create_resume_summary_contains_required_info(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy(),
        current_step in 0usize..100usize,
        total_steps in prop::option::of(1usize..200usize),
        error_count in 0usize..10usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a state
            let mut state = AgentState::new(id.clone(), agent_type.clone(), prompt);
            state.current_step = current_step;
            if let Some(total) = total_steps {
                state.total_steps = Some(total);
            }
            state.error_count = error_count;
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);

            // Create resume summary
            let summary = resumer.create_resume_summary(&id).await;
            prop_assert!(summary.is_ok(), "Create resume summary should succeed");

            let summary = summary.unwrap();

            // Verify summary contains required information
            prop_assert!(
                summary.contains(&id),
                "Summary should contain agent ID"
            );
            prop_assert!(
                summary.contains("Status"),
                "Summary should contain Status section"
            );
            prop_assert!(
                summary.contains("Progress"),
                "Summary should contain Progress section"
            );
            prop_assert!(
                summary.contains(&format!("Current Step: {}", current_step)),
                "Summary should contain current step"
            );

            if let Some(total) = total_steps {
                prop_assert!(
                    summary.contains(&format!("Total Steps: {}", total)),
                    "Summary should contain total steps when available"
                );
            }

            if error_count > 0 {
                prop_assert!(
                    summary.contains("Errors"),
                    "Summary should contain Errors section when errors exist"
                );
            }

            Ok(())
        })?;
    }

    // Feature: agents-alignment, Property 34: Agent Resume Behavior
    // Validates: Requirements 12.3
    #[test]
    fn property_34_resume_persists_updated_state(
        id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        prompt in prompt_strategy()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Create a paused state
            let state = AgentState::new(id.clone(), agent_type, prompt)
                .with_status(AgentStateStatus::Paused);
            state_manager.save_state(&state).await.unwrap();

            let resumer = AgentResumer::new(state_manager);
            let options = ResumeOptions::new(id.clone())
                .with_additional_context("Test context");

            // Resume
            let _resumed = resumer.resume(options).await.unwrap();

            // Load state again to verify persistence
            let loaded = resumer.state_manager().load_state(&id).await.unwrap();
            prop_assert!(loaded.is_some(), "State should be persisted");

            let loaded = loaded.unwrap();
            prop_assert_eq!(
                loaded.status,
                AgentStateStatus::Running,
                "Persisted state should have Running status"
            );
            prop_assert!(
                loaded.metadata.contains_key("additional_context"),
                "Persisted state should contain additional context"
            );

            Ok(())
        })?;
    }
}
