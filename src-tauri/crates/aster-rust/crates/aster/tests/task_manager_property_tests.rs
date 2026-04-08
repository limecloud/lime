//! Property-based tests for TaskManager
//!
//! **Property 5: Background Task Isolation**
//! *For any* set of background tasks, each task SHALL run independently,
//! and one task's failure SHALL NOT affect other tasks.
//!
//! **Property 9: Cancellation Support**
//! *For any* running task, calling kill() SHALL terminate the task
//! and update its status to Killed.
//!
//! **Validates: Requirements 10.1, 10.2, 10.3**

use aster::tools::{TaskManager, TaskStatus, ToolContext, ToolError};
use proptest::prelude::*;
use std::path::PathBuf;
use std::time::Duration;
use tempfile::TempDir;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary session IDs
fn arb_session_id() -> impl Strategy<Value = String> {
    "[a-z0-9-]{8,16}".prop_map(|s| s)
}

/// Generate arbitrary working directory paths
fn arb_working_directory() -> impl Strategy<Value = PathBuf> {
    Just(std::env::temp_dir())
}

/// Generate arbitrary ToolContext
fn arb_tool_context() -> impl Strategy<Value = ToolContext> {
    (arb_working_directory(), arb_session_id()).prop_map(|(working_directory, session_id)| {
        ToolContext::new(working_directory).with_session_id(session_id)
    })
}

/// Generate max concurrent task limits
fn arb_max_concurrent() -> impl Strategy<Value = usize> {
    1usize..=5
}

/// Generate number of tasks to start
fn arb_task_count() -> impl Strategy<Value = usize> {
    1usize..=3
}

// ============================================================================
// Helper Functions
// ============================================================================

fn create_test_manager(temp_dir: &TempDir, max_concurrent: usize) -> TaskManager {
    TaskManager::new()
        .with_output_directory(temp_dir.path().to_path_buf())
        .with_max_concurrent(max_concurrent)
        .with_max_runtime(Duration::from_secs(60))
}

// ============================================================================
// Property Tests - Property 5: Background Task Isolation
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 5: Background Task Isolation**
    ///
    /// Property: Each task gets a unique task_id
    /// *For any* number of tasks started, each task SHALL receive a unique task_id.
    ///
    /// **Validates: Requirements 10.1**
    #[test]
    fn prop_each_task_gets_unique_id(
        task_count in arb_task_count(),
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, task_count + 1);

            let mut task_ids = Vec::new();
            for _ in 0..task_count {
                let result = manager.start("echo test", &context).await;
                prop_assert!(result.is_ok(), "Task should start successfully");
                task_ids.push(result.unwrap());
            }

            // All task IDs should be unique
            let unique_ids: std::collections::HashSet<_> = task_ids.iter().collect();
            prop_assert_eq!(
                unique_ids.len(),
                task_ids.len(),
                "All task IDs should be unique"
            );

            // Clean up
            let _ = manager.kill_all().await;

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 5: Background Task Isolation**
    ///
    /// Property: Task status is queryable after start
    /// *For any* started task, get_status() SHALL return the task's state.
    ///
    /// **Validates: Requirements 10.2**
    #[test]
    fn prop_task_status_queryable_after_start(
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, 5);

            let task_id = manager.start("sleep 5", &context).await.unwrap();

            // Status should be queryable
            let status = manager.get_status(&task_id).await;
            prop_assert!(status.is_some(), "Status should be queryable");

            let state = status.unwrap();
            prop_assert_eq!(state.task_id, task_id.clone(), "Task ID should match");
            prop_assert_eq!(state.command, "sleep 5", "Command should match");

            // Clean up
            let _ = manager.kill(&task_id).await;

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 5: Background Task Isolation**
    ///
    /// Property: One task's failure does not affect other tasks
    /// *For any* set of tasks where one fails, other tasks SHALL continue running
    /// or complete independently.
    ///
    /// **Validates: Requirements 10.1, 10.2**
    #[test]
    fn prop_task_failure_isolation(
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, 5);

            // Start a failing task
            let failing_id = manager.start("exit 1", &context).await.unwrap();

            // Start a successful task
            let success_id = manager.start("echo success", &context).await.unwrap();

            // Wait for both to complete
            tokio::time::sleep(Duration::from_millis(500)).await;

            // Check failing task
            let failing_status = manager.get_status(&failing_id).await;
            prop_assert!(failing_status.is_some(), "Failing task status should exist");
            let failing_state = failing_status.unwrap();
            prop_assert!(
                failing_state.status.is_terminal(),
                "Failing task should be terminal"
            );

            // Check successful task - it should have completed independently
            let success_status = manager.get_status(&success_id).await;
            prop_assert!(success_status.is_some(), "Success task status should exist");
            let success_state = success_status.unwrap();
            prop_assert!(
                success_state.status.is_terminal(),
                "Success task should be terminal"
            );

            // The successful task should have completed successfully
            // (not affected by the failing task)
            prop_assert_eq!(
                success_state.status,
                TaskStatus::Completed,
                "Success task should complete successfully despite other task failing"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 5: Background Task Isolation**
    ///
    /// Property: Task output is isolated to its own file
    /// *For any* task, its output SHALL be written to a unique file.
    ///
    /// **Validates: Requirements 10.6**
    #[test]
    fn prop_task_output_isolation(
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, 5);

            // Start two tasks with different outputs
            let task1_id = manager.start("echo task1_output", &context).await.unwrap();
            let task2_id = manager.start("echo task2_output", &context).await.unwrap();

            // Wait for completion
            tokio::time::sleep(Duration::from_millis(500)).await;

            // Get outputs
            let output1 = manager.get_output(&task1_id, None).await;
            let output2 = manager.get_output(&task2_id, None).await;

            prop_assert!(output1.is_ok(), "Task 1 output should be readable");
            prop_assert!(output2.is_ok(), "Task 2 output should be readable");

            let out1 = output1.unwrap();
            let out2 = output2.unwrap();

            // Outputs should be different (isolated)
            prop_assert!(
                out1.contains("task1_output"),
                "Task 1 output should contain its own output"
            );
            prop_assert!(
                out2.contains("task2_output"),
                "Task 2 output should contain its own output"
            );
            prop_assert!(
                !out1.contains("task2_output"),
                "Task 1 output should not contain task 2's output"
            );
            prop_assert!(
                !out2.contains("task1_output"),
                "Task 2 output should not contain task 1's output"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 5: Background Task Isolation**
    ///
    /// Property: Concurrent task limit is enforced
    /// *For any* max_concurrent setting, starting more tasks than the limit
    /// SHALL fail with an error.
    ///
    /// **Validates: Requirements 10.4**
    #[test]
    fn prop_concurrent_limit_enforced(
        max_concurrent in arb_max_concurrent(),
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, max_concurrent);

            // Start max_concurrent tasks
            let mut task_ids = Vec::new();
            for _ in 0..max_concurrent {
                let result = manager.start("sleep 60", &context).await;
                prop_assert!(result.is_ok(), "Should be able to start up to limit");
                task_ids.push(result.unwrap());
            }

            // Verify running count
            let running = manager.running_count().await;
            prop_assert_eq!(running, max_concurrent, "Running count should match limit");

            // Try to start one more - should fail
            let result = manager.start("sleep 60", &context).await;
            prop_assert!(result.is_err(), "Should fail when limit exceeded");
            prop_assert!(
                matches!(result.unwrap_err(), ToolError::ExecutionFailed(_)),
                "Should be ExecutionFailed error"
            );

            // Clean up
            let _ = manager.kill_all().await;

            Ok(())
        })?;
    }
}

// ============================================================================
// Property Tests - Property 9: Cancellation Support
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 9: Cancellation Support**
    ///
    /// Property: Kill terminates running task
    /// *For any* running task, calling kill() SHALL terminate it.
    ///
    /// **Validates: Requirements 10.3**
    #[test]
    fn prop_kill_terminates_running_task(
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, 5);

            // Start a long-running task
            let task_id = manager.start("sleep 60", &context).await.unwrap();

            // Verify it's running
            let status_before = manager.get_status(&task_id).await;
            prop_assert!(status_before.is_some(), "Task should exist");
            prop_assert_eq!(
                status_before.unwrap().status,
                TaskStatus::Running,
                "Task should be running"
            );

            // Kill it
            let kill_result = manager.kill(&task_id).await;
            prop_assert!(kill_result.is_ok(), "Kill should succeed");

            // Verify it's killed
            let status_after = manager.get_status(&task_id).await;
            prop_assert!(status_after.is_some(), "Task should still exist in completed");
            prop_assert_eq!(
                status_after.unwrap().status,
                TaskStatus::Killed,
                "Task should be killed"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 9: Cancellation Support**
    ///
    /// Property: Kill on non-existent task returns NotFound
    /// *For any* non-existent task_id, kill() SHALL return NotFound error.
    ///
    /// **Validates: Requirements 10.3**
    #[test]
    fn prop_kill_nonexistent_returns_not_found(
        fake_id in "[a-f0-9-]{36}"
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, 5);

            let result = manager.kill(&fake_id).await;
            prop_assert!(result.is_err(), "Kill should fail for non-existent task");
            prop_assert!(
                matches!(result.unwrap_err(), ToolError::NotFound(_)),
                "Should be NotFound error"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 9: Cancellation Support**
    ///
    /// Property: Kill all terminates all running tasks
    /// *For any* set of running tasks, kill_all() SHALL terminate all of them.
    ///
    /// **Validates: Requirements 10.3**
    #[test]
    fn prop_kill_all_terminates_all(
        task_count in arb_task_count(),
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, task_count + 1);

            // Start multiple long-running tasks
            let mut task_ids = Vec::new();
            for _ in 0..task_count {
                let task_id = manager.start("sleep 60", &context).await.unwrap();
                task_ids.push(task_id);
            }

            // Verify all are running
            let running_before = manager.running_count().await;
            prop_assert_eq!(running_before, task_count, "All tasks should be running");

            // Kill all
            let killed = manager.kill_all().await;
            prop_assert_eq!(killed, task_count, "Should kill all tasks");

            // Verify none are running
            let running_after = manager.running_count().await;
            prop_assert_eq!(running_after, 0, "No tasks should be running");

            // Verify all are killed
            for task_id in &task_ids {
                let status = manager.get_status(task_id).await;
                prop_assert!(status.is_some(), "Task should exist in completed");
                prop_assert_eq!(
                    status.unwrap().status,
                    TaskStatus::Killed,
                    "Task should be killed"
                );
            }

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 9: Cancellation Support**
    ///
    /// Property: Killed task's output is still accessible
    /// *For any* killed task, its output SHALL remain accessible.
    ///
    /// **Validates: Requirements 10.3, 10.6**
    #[test]
    fn prop_killed_task_output_accessible(
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, 5);

            // Start a task that produces output before sleeping
            // Use a command that outputs immediately then sleeps
            let task_id = manager.start("echo before_kill; sleep 60", &context).await.unwrap();

            // Wait a bit for output to be written
            tokio::time::sleep(Duration::from_millis(200)).await;

            // Kill it
            let _ = manager.kill(&task_id).await;

            // Output should still be accessible
            let output = manager.get_output(&task_id, None).await;
            prop_assert!(output.is_ok(), "Output should be accessible after kill");

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 9: Cancellation Support**
    ///
    /// Property: Kill on already completed task returns error
    /// *For any* task that has already completed, kill() SHALL return an error.
    ///
    /// **Validates: Requirements 10.3**
    #[test]
    fn prop_kill_completed_task_returns_error(
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, 5);

            // Start a quick task
            let task_id = manager.start("echo done", &context).await.unwrap();

            // Wait for it to complete
            tokio::time::sleep(Duration::from_millis(500)).await;

            // Verify it completed
            let status = manager.get_status(&task_id).await;
            prop_assert!(status.is_some(), "Task should exist");
            prop_assert!(
                status.unwrap().status.is_terminal(),
                "Task should be completed"
            );

            // Try to kill it - should fail
            let result = manager.kill(&task_id).await;
            prop_assert!(result.is_err(), "Kill should fail for completed task");
            prop_assert!(
                matches!(result.unwrap_err(), ToolError::ExecutionFailed(_)),
                "Should be ExecutionFailed error"
            );

            Ok(())
        })?;
    }
}

// ============================================================================
// Additional Property Tests for Task State
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 5: Background Task Isolation**
    ///
    /// Property: Task state contains correct metadata
    /// *For any* started task, its state SHALL contain the correct command,
    /// working directory, and session ID.
    ///
    /// **Validates: Requirements 10.1**
    #[test]
    fn prop_task_state_contains_correct_metadata(
        session_id in arb_session_id()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, 5);
            let working_dir = std::env::temp_dir();
            let context = ToolContext::new(working_dir.clone())
                .with_session_id(&session_id);

            let command = "echo metadata_test";
            let task_id = manager.start(command, &context).await.unwrap();

            let status = manager.get_status(&task_id).await;
            prop_assert!(status.is_some(), "Task should exist");

            let state = status.unwrap();
            prop_assert_eq!(state.command, command, "Command should match");
            prop_assert_eq!(state.session_id, session_id, "Session ID should match");
            prop_assert_eq!(state.working_directory, working_dir, "Working directory should match");

            // Clean up
            let _ = manager.kill(&task_id).await;

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 5: Background Task Isolation**
    ///
    /// Property: list_tasks returns all tasks
    /// *For any* set of started tasks, list_tasks() SHALL return all of them.
    ///
    /// **Validates: Requirements 10.2**
    #[test]
    fn prop_list_tasks_returns_all(
        task_count in arb_task_count(),
        context in arb_tool_context()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, task_count + 1);

            let mut task_ids = Vec::new();
            for _ in 0..task_count {
                let task_id = manager.start("sleep 60", &context).await.unwrap();
                task_ids.push(task_id);
            }

            let all_tasks = manager.list_tasks().await;
            prop_assert_eq!(
                all_tasks.len(),
                task_count,
                "list_tasks should return all tasks"
            );

            // Verify all task IDs are present
            let listed_ids: std::collections::HashSet<_> =
                all_tasks.iter().map(|t| t.task_id.clone()).collect();
            for task_id in &task_ids {
                prop_assert!(
                    listed_ids.contains(task_id),
                    "All started tasks should be in list"
                );
            }

            // Clean up
            let _ = manager.kill_all().await;

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 5: Background Task Isolation**
    ///
    /// Property: task_exists correctly reports existence
    /// *For any* task_id, task_exists() SHALL return true if and only if
    /// the task exists (running or completed).
    ///
    /// **Validates: Requirements 10.2**
    #[test]
    fn prop_task_exists_correct(
        context in arb_tool_context(),
        fake_id in "[a-f0-9-]{36}"
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let manager = create_test_manager(&temp_dir, 5);

            // Non-existent task
            prop_assert!(
                !manager.task_exists(&fake_id).await,
                "Non-existent task should not exist"
            );

            // Start a task
            let task_id = manager.start("echo test", &context).await.unwrap();

            // Should exist while running
            prop_assert!(
                manager.task_exists(&task_id).await,
                "Running task should exist"
            );

            // Wait for completion
            tokio::time::sleep(Duration::from_millis(500)).await;

            // Should still exist after completion
            prop_assert!(
                manager.task_exists(&task_id).await,
                "Completed task should still exist"
            );

            Ok(())
        })?;
    }
}

// ============================================================================
// Edge Case Unit Tests
// ============================================================================

#[cfg(test)]
mod edge_case_tests {
    use super::*;

    #[tokio::test]
    async fn test_get_output_with_line_limit() {
        let temp_dir = TempDir::new().unwrap();
        let manager = create_test_manager(&temp_dir, 5);
        let context = ToolContext::new(std::env::temp_dir());

        // Create a task with multiple lines of output
        let task_id = manager
            .start(
                "echo line1; echo line2; echo line3; echo line4; echo line5",
                &context,
            )
            .await
            .unwrap();

        // Wait for completion
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Get last 2 lines
        let output = manager.get_output(&task_id, Some(2)).await.unwrap();
        let lines: Vec<&str> = output.lines().collect();
        assert!(lines.len() <= 2, "Should return at most 2 lines");
    }

    #[tokio::test]
    async fn test_get_output_nonexistent_task() {
        let temp_dir = TempDir::new().unwrap();
        let manager = create_test_manager(&temp_dir, 5);

        let result = manager.get_output("nonexistent-task-id", None).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::NotFound(_)));
    }

    #[tokio::test]
    async fn test_list_running_tasks() {
        let temp_dir = TempDir::new().unwrap();
        let manager = create_test_manager(&temp_dir, 5);
        let context = ToolContext::new(std::env::temp_dir());

        // Start a long-running task
        let task_id = manager.start("sleep 60", &context).await.unwrap();

        // List running tasks
        let running = manager.list_running_tasks().await;
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].task_id, task_id);
        assert_eq!(running[0].status, TaskStatus::Running);

        // Clean up
        let _ = manager.kill(&task_id).await;
    }

    #[test]
    fn test_task_status_display() {
        assert_eq!(TaskStatus::Running.to_string(), "running");
        assert_eq!(TaskStatus::Completed.to_string(), "completed");
        assert_eq!(TaskStatus::Failed.to_string(), "failed");
        assert_eq!(TaskStatus::TimedOut.to_string(), "timed_out");
        assert_eq!(TaskStatus::Killed.to_string(), "killed");
    }

    #[test]
    fn test_task_status_is_terminal() {
        assert!(!TaskStatus::Running.is_terminal());
        assert!(TaskStatus::Completed.is_terminal());
        assert!(TaskStatus::Failed.is_terminal());
        assert!(TaskStatus::TimedOut.is_terminal());
        assert!(TaskStatus::Killed.is_terminal());
    }

    #[test]
    fn test_task_status_is_running() {
        assert!(TaskStatus::Running.is_running());
        assert!(!TaskStatus::Completed.is_running());
        assert!(!TaskStatus::Failed.is_running());
        assert!(!TaskStatus::TimedOut.is_running());
        assert!(!TaskStatus::Killed.is_running());
    }

    #[test]
    fn test_task_manager_builder_pattern() {
        let manager = TaskManager::new()
            .with_max_concurrent(20)
            .with_max_runtime(Duration::from_secs(3600))
            .with_output_directory(PathBuf::from("/custom/output"));

        assert_eq!(manager.max_concurrent(), 20);
        assert_eq!(manager.max_runtime(), Duration::from_secs(3600));
    }

    #[tokio::test]
    async fn test_task_manager_default_values() {
        let manager = TaskManager::new();
        assert_eq!(
            manager.max_concurrent(),
            aster::tools::DEFAULT_MAX_CONCURRENT
        );
        assert_eq!(
            manager.max_runtime(),
            Duration::from_secs(aster::tools::DEFAULT_MAX_RUNTIME_SECS)
        );
        assert_eq!(manager.running_count().await, 0);
    }
}
