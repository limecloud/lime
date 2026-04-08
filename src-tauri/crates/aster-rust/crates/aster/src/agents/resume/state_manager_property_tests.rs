//! Property-based tests for Agent State Manager
//!
//! Properties tested:
//! - Property 5: Context Persistence Round-Trip
//! - Property 32: State Listing and Cleanup

use proptest::prelude::*;
use std::time::Duration;
use tempfile::TempDir;

use super::state_manager::{
    AgentState, AgentStateManager, AgentStateStatus, Checkpoint, StateFilter, ToolCallRecord,
};

fn agent_id_strategy() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_-]{0,15}".prop_map(|s| s.to_string())
}
fn agent_type_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("explore".to_string()),
        Just("plan".to_string()),
        Just("execute".to_string()),
        Just("test".to_string()),
        Just("custom".to_string()),
    ]
}

fn prompt_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 .,!?]{1,100}".prop_map(|s| s.to_string())
}

fn status_strategy() -> impl Strategy<Value = AgentStateStatus> {
    prop_oneof![
        Just(AgentStateStatus::Running),
        Just(AgentStateStatus::Paused),
        Just(AgentStateStatus::Completed),
        Just(AgentStateStatus::Failed),
        Just(AgentStateStatus::Cancelled),
    ]
}

fn tool_call_record_strategy() -> impl Strategy<Value = ToolCallRecord> {
    ("[a-z_]{1,20}".prop_map(|s| s.to_string()), prop::bool::ANY).prop_map(
        |(tool_name, success)| {
            let mut record = ToolCallRecord::new(tool_name, serde_json::json!({"arg": "value"}));
            if success {
                record.complete_success(serde_json::json!({"result": "ok"}));
            } else {
                record.complete_failure("Test error");
            }
            record
        },
    )
}

fn agent_state_strategy() -> impl Strategy<Value = AgentState> {
    (
        agent_id_strategy(),
        agent_type_strategy(),
        prompt_strategy(),
        status_strategy(),
        0usize..100usize,
        0usize..10usize,
        0usize..5usize,
        prop::collection::vec(tool_call_record_strategy(), 0..5),
        prop::collection::vec(
            prop::bool::ANY.prop_map(|b| serde_json::json!({"value": b})),
            0..5,
        ),
    )
        .prop_map(
            |(id, agent_type, prompt, status, step, errors, retries, tool_calls, results)| {
                let mut state = AgentState::new(id, agent_type, prompt).with_status(status);
                state.current_step = step;
                state.error_count = errors;
                state.retry_count = retries;
                for tc in tool_calls {
                    state.add_tool_call(tc);
                }
                for r in results {
                    state.add_result(r);
                }
                state
            },
        )
}

fn checkpoint_strategy() -> impl Strategy<Value = Checkpoint> {
    (
        agent_id_strategy(),
        0usize..100usize,
        prop::option::of("[a-z_]{1,20}".prop_map(|s| s.to_string())),
        prop::collection::vec(
            prop::bool::ANY.prop_map(|b| serde_json::json!({"value": b})),
            0..3,
        ),
    )
        .prop_map(|(agent_id, step, name, results)| {
            let mut checkpoint = Checkpoint::new(agent_id, step);
            if let Some(n) = name {
                checkpoint = checkpoint.with_name(n);
            }
            checkpoint = checkpoint.with_results(results);
            checkpoint
        })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    #[test]
    fn property_5_state_persistence_round_trip(state in agent_state_strategy()) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
            let save_result = manager.save_state(&state).await;
            prop_assert!(save_result.is_ok(), "Save should succeed");
            let load_result = manager.load_state(&state.id).await;
            prop_assert!(load_result.is_ok(), "Load should succeed");
            let loaded = load_result.unwrap();
            prop_assert!(loaded.is_some(), "Loaded state should exist");
            let loaded = loaded.unwrap();
            prop_assert_eq!(&loaded.id, &state.id, "ID should match");
            prop_assert_eq!(&loaded.agent_type, &state.agent_type, "Agent type should match");
            prop_assert_eq!(loaded.status, state.status, "Status should match");
            Ok(())
        })?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    #[test]
    fn property_5_checkpoint_persistence_round_trip(checkpoint in checkpoint_strategy()) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
            let save_result = manager.save_checkpoint(&checkpoint).await;
            prop_assert!(save_result.is_ok(), "Save checkpoint should succeed");
            let load_result = manager.load_checkpoint(&checkpoint.agent_id, &checkpoint.id).await;
            prop_assert!(load_result.is_ok(), "Load checkpoint should succeed");
            let loaded = load_result.unwrap();
            prop_assert!(loaded.is_some(), "Loaded checkpoint should exist");
            let loaded = loaded.unwrap();
            prop_assert_eq!(&loaded.id, &checkpoint.id, "Checkpoint ID should match");
            prop_assert_eq!(&loaded.agent_id, &checkpoint.agent_id, "Agent ID should match");
            prop_assert_eq!(loaded.step, checkpoint.step, "Step should match");
            Ok(())
        })?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    #[test]
    fn property_32_list_states_returns_all_saved(base_states in prop::collection::vec(agent_state_strategy(), 1..10)) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

            // Ensure unique state IDs by appending index
            let states: Vec<AgentState> = base_states
                .into_iter()
                .enumerate()
                .map(|(i, mut state)| {
                    state.id = format!("{}-{}", state.id, i);
                    state
                })
                .collect();

            for state in &states {
                let result = manager.save_state(state).await;
                prop_assert!(result.is_ok(), "Save should succeed");
            }
            let listed = manager.list_states(None).await;
            prop_assert!(listed.is_ok(), "List should succeed");
            let listed = listed.unwrap();
            prop_assert_eq!(listed.len(), states.len(), "Listed states count should match");
            for state in &states {
                let found = listed.iter().any(|s| s.id == state.id);
                prop_assert!(found, "State {} should be in the list", state.id);
            }
            Ok(())
        })?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    #[test]
    fn property_32_filter_by_agent_type(
        agent_type in agent_type_strategy(),
        num_matching in 1usize..5usize,
        num_other in 1usize..5usize
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
            for i in 0..num_matching {
                let state = AgentState::new(format!("matching-{}", i), agent_type.clone(), "prompt");
                manager.save_state(&state).await.unwrap();
            }
            let other_type = if agent_type == "other" { "different" } else { "other" };
            for i in 0..num_other {
                let state = AgentState::new(format!("other-{}", i), other_type, "prompt");
                manager.save_state(&state).await.unwrap();
            }
            let filter = StateFilter::new().with_agent_type(agent_type.clone());
            let filtered = manager.list_states(Some(filter)).await.unwrap();
            prop_assert_eq!(filtered.len(), num_matching, "Filtered list should contain only matching agent types");
            Ok(())
        })?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    #[test]
    fn property_32_delete_state_removes_from_list(state in agent_state_strategy()) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
            manager.save_state(&state).await.unwrap();
            let listed = manager.list_states(None).await.unwrap();
            prop_assert!(listed.iter().any(|s| s.id == state.id), "State should exist before deletion");
            let deleted = manager.delete_state(&state.id).await.unwrap();
            prop_assert!(deleted, "Delete should return true");
            let listed = manager.list_states(None).await.unwrap();
            prop_assert!(!listed.iter().any(|s| s.id == state.id), "State should not exist after deletion");
            Ok(())
        })?;
    }
}

#[tokio::test]
async fn property_32_cleanup_expired_removes_old_states() {
    use chrono::{Duration as ChronoDuration, Utc};
    let temp_dir = TempDir::new().unwrap();
    let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
    let mut old_state = AgentState::new("old-state", "test", "prompt");
    old_state.created_at = Utc::now() - ChronoDuration::hours(25);
    old_state.updated_at = old_state.created_at;
    manager.save_state(&old_state).await.unwrap();
    let recent_state = AgentState::new("recent-state", "test", "prompt");
    manager.save_state(&recent_state).await.unwrap();
    let all_states = manager.list_states(None).await.unwrap();
    assert_eq!(all_states.len(), 2, "Should have 2 states before cleanup");
    let cleaned = manager
        .cleanup_expired(Duration::from_secs(24 * 60 * 60))
        .await
        .unwrap();
    assert_eq!(cleaned, 1, "Should have cleaned 1 expired state");
    let remaining = manager.list_states(None).await.unwrap();
    assert_eq!(remaining.len(), 1, "Should have 1 state after cleanup");
}

#[tokio::test]
async fn property_32_list_checkpoints_returns_sorted() {
    let temp_dir = TempDir::new().unwrap();
    let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
    let steps = vec![5, 2, 8, 1, 3];
    for step in &steps {
        let checkpoint = Checkpoint::new("agent-1", *step);
        manager.save_checkpoint(&checkpoint).await.unwrap();
    }
    let checkpoints = manager.list_checkpoints("agent-1").await.unwrap();
    assert_eq!(checkpoints.len(), 5, "Should have 5 checkpoints");
    for i in 1..checkpoints.len() {
        assert!(
            checkpoints[i - 1].step <= checkpoints[i].step,
            "Checkpoints should be sorted"
        );
    }
}

#[tokio::test]
async fn property_32_delete_state_also_deletes_checkpoints() {
    let temp_dir = TempDir::new().unwrap();
    let manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));
    let mut state = AgentState::new("agent-1", "test", "prompt");
    let checkpoint = state.create_checkpoint(Some("cp-1"));
    manager.save_state(&state).await.unwrap();
    manager.save_checkpoint(&checkpoint).await.unwrap();
    let checkpoints = manager.list_checkpoints("agent-1").await.unwrap();
    assert_eq!(checkpoints.len(), 1, "Should have 1 checkpoint");
    manager.delete_state("agent-1").await.unwrap();
    let checkpoints = manager.list_checkpoints("agent-1").await.unwrap();
    assert_eq!(
        checkpoints.len(),
        0,
        "Checkpoints should be deleted with state"
    );
}
