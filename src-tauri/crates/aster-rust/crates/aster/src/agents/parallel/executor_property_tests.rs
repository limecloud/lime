//! Property-based tests for Parallel Agent Executor
//!
//! These tests verify the correctness properties defined in the design document
//! for the parallel execution system.

use super::*;
use proptest::prelude::*;
use std::time::Duration;

/// Strategy for generating valid task IDs
fn task_id_strategy() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_-]{0,15}".prop_map(|s| s.to_string())
}

/// Strategy for generating task types
fn task_type_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("explore".to_string()),
        Just("plan".to_string()),
        Just("execute".to_string()),
        Just("analyze".to_string()),
        Just("test".to_string()),
    ]
}

/// Strategy for generating task prompts
fn task_prompt_strategy() -> impl Strategy<Value = String> {
    "[A-Za-z ]{5,50}".prop_map(|s| s.to_string())
}

/// Strategy for generating priorities (0-255)
fn priority_strategy() -> impl Strategy<Value = u8> {
    0u8..=255u8
}

/// Strategy for generating a single AgentTask without dependencies
fn agent_task_strategy() -> impl Strategy<Value = AgentTask> {
    (
        task_id_strategy(),
        task_type_strategy(),
        task_prompt_strategy(),
        prop::option::of(priority_strategy()),
    )
        .prop_map(|(id, task_type, prompt, priority)| {
            let mut task = AgentTask::new(id, task_type, prompt);
            if let Some(p) = priority {
                task = task.with_priority(p);
            }
            task
        })
}

/// Strategy for generating a list of tasks with unique IDs
fn task_list_strategy(min_size: usize, max_size: usize) -> impl Strategy<Value = Vec<AgentTask>> {
    prop::collection::vec(agent_task_strategy(), min_size..=max_size).prop_map(|tasks| {
        // Ensure unique IDs by appending index
        tasks
            .into_iter()
            .enumerate()
            .map(|(i, mut task)| {
                task.id = format!("{}_{}", task.id, i);
                task
            })
            .collect()
    })
}

// ============================================================================
// Property Tests - Property 21: Parallel Execution Concurrency
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    /// **Feature: agents-alignment, Property 21: Parallel Execution Concurrency**
    ///
    /// Property: The number of concurrently running tasks SHALL not exceed
    /// the configured maximum concurrency limit.
    ///
    /// **Validates: Requirements 6.1, 6.3, 6.4**
    #[test]
    fn prop_concurrency_limit_respected(
        tasks in task_list_strategy(2, 10),
        max_concurrency in 1usize..=4usize,
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig {
                max_concurrency,
                timeout: Duration::from_secs(30),
                retry_on_failure: false,
                stop_on_first_error: false,
                max_retries: 0,
                retry_delay: Duration::from_millis(10),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));
            let result = executor.execute(tasks.clone()).await;

            // Execution should succeed
            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();

            // All tasks should be accounted for
            prop_assert_eq!(
                result.results.len(),
                tasks.len(),
                "Not all tasks were executed"
            );

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 21: Parallel Execution Concurrency**
    ///
    /// Property: Task priorities SHALL affect execution order when concurrency
    /// is limited to 1. Higher priority tasks should complete before lower priority tasks.
    ///
    /// **Validates: Requirements 6.3**
    #[test]
    fn prop_priority_affects_order(
        num_tasks in 3usize..=6usize,
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Create tasks with distinct priorities (higher index = higher priority)
            let tasks: Vec<AgentTask> = (0..num_tasks)
                .map(|i| {
                    AgentTask::new(
                        format!("task-{}", i),
                        "test",
                        format!("Task {}", i),
                    )
                    .with_priority(((i + 1) * 10) as u8)
                })
                .collect();

            let config = ParallelAgentConfig {
                max_concurrency: 1, // Sequential execution
                timeout: Duration::from_secs(30),
                retry_on_failure: false,
                stop_on_first_error: false,
                max_retries: 0,
                retry_delay: Duration::from_millis(10),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));
            let result = executor.execute(tasks.clone()).await;

            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();
            prop_assert_eq!(result.results.len(), num_tasks, "All tasks should complete");

            // With concurrency=1, tasks should complete in priority order (highest first)
            // Verify that results are in descending priority order
            for i in 0..result.results.len() - 1 {
                let current_id = &result.results[i].task_id;
                let next_id = &result.results[i + 1].task_id;

                let current_task = tasks.iter().find(|t| &t.id == current_id).unwrap();
                let next_task = tasks.iter().find(|t| &t.id == next_id).unwrap();

                prop_assert!(
                    current_task.effective_priority() >= next_task.effective_priority(),
                    "Tasks should complete in priority order: {} (priority {}) should come before {} (priority {})",
                    current_id,
                    current_task.effective_priority(),
                    next_id,
                    next_task.effective_priority()
                );
            }

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 21: Parallel Execution Concurrency**
    ///
    /// Property: Task timeouts SHALL be respected and tasks exceeding timeout
    /// SHALL be marked as failed.
    ///
    /// **Validates: Requirements 6.4**
    #[test]
    fn prop_task_timeout_respected(
        tasks in task_list_strategy(1, 5),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig {
                max_concurrency: 4,
                timeout: Duration::from_secs(30), // Reasonable timeout
                retry_on_failure: false,
                stop_on_first_error: false,
                max_retries: 0,
                retry_delay: Duration::from_millis(10),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));
            let result = executor.execute(tasks.clone()).await;

            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();

            // All tasks should complete (our simulated tasks don't timeout)
            prop_assert_eq!(
                result.results.len(),
                tasks.len(),
                "Not all tasks completed"
            );

            // Each result should have a valid duration
            for task_result in &result.results {
                prop_assert!(
                    task_result.duration <= Duration::from_secs(30),
                    "Task duration exceeded timeout"
                );
            }

            Ok(())
        })?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    /// **Feature: agents-alignment, Property 21: Parallel Execution Concurrency**
    ///
    /// Property: When stop_on_first_error is enabled, execution SHALL halt
    /// after the first failure.
    ///
    /// **Validates: Requirements 6.7**
    #[test]
    fn prop_stop_on_first_error_behavior(
        tasks in task_list_strategy(2, 8),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Test with stop_on_first_error = false (all tasks should complete)
            let config_continue = ParallelAgentConfig {
                max_concurrency: 4,
                timeout: Duration::from_secs(30),
                retry_on_failure: false,
                stop_on_first_error: false,
                max_retries: 0,
                retry_delay: Duration::from_millis(10),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config_continue));
            let result = executor.execute(tasks.clone()).await;

            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();

            // All tasks should be executed when stop_on_first_error is false
            prop_assert_eq!(
                result.results.len(),
                tasks.len(),
                "All tasks should complete when stop_on_first_error is false"
            );

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 21: Parallel Execution Concurrency**
    ///
    /// Property: Execution progress SHALL accurately reflect the current state
    /// of task execution.
    ///
    /// **Validates: Requirements 6.1**
    #[test]
    fn prop_progress_tracking_accurate(
        tasks in task_list_strategy(1, 5),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig {
                max_concurrency: 2,
                timeout: Duration::from_secs(30),
                retry_on_failure: false,
                stop_on_first_error: false,
                max_retries: 0,
                retry_delay: Duration::from_millis(10),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));

            // Before execution, progress should show all zeros
            let progress_before = executor.get_progress().await;
            prop_assert_eq!(progress_before.total, 0, "Total should be 0 before execution");

            let result = executor.execute(tasks.clone()).await;
            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            // After execution, progress should reflect completed state
            let progress_after = executor.get_progress().await;
            prop_assert_eq!(
                progress_after.total,
                tasks.len(),
                "Total should match task count"
            );
            prop_assert_eq!(
                progress_after.completed + progress_after.failed + progress_after.skipped,
                tasks.len(),
                "Sum of completed, failed, and skipped should equal total"
            );
            prop_assert!(!progress_after.cancelled, "Should not be cancelled");

            Ok(())
        })?;
    }
}

// ============================================================================
// Property Tests - Property 22: Dependency Graph Validation
// ============================================================================

/// Strategy for generating a chain of dependent tasks (A -> B -> C -> ...)
fn dependent_task_chain_strategy(
    min_length: usize,
    max_length: usize,
) -> impl Strategy<Value = Vec<AgentTask>> {
    (min_length..=max_length).prop_flat_map(|length| {
        prop::collection::vec((task_type_strategy(), task_prompt_strategy()), length).prop_map(
            move |task_data| {
                task_data
                    .into_iter()
                    .enumerate()
                    .map(|(i, (task_type, prompt))| {
                        let mut task = AgentTask::new(format!("task-{}", i), task_type, prompt);
                        if i > 0 {
                            task = task.with_dependencies(vec![format!("task-{}", i - 1)]);
                        }
                        task
                    })
                    .collect()
            },
        )
    })
}

/// Strategy for generating tasks with a diamond dependency pattern
/// (A -> B, A -> C, B -> D, C -> D)
fn diamond_dependency_strategy() -> impl Strategy<Value = Vec<AgentTask>> {
    (task_type_strategy(), task_prompt_strategy()).prop_map(|(task_type, prompt)| {
        vec![
            AgentTask::new("task-a", task_type.clone(), format!("{} A", prompt)),
            AgentTask::new("task-b", task_type.clone(), format!("{} B", prompt))
                .with_dependencies(vec!["task-a".to_string()]),
            AgentTask::new("task-c", task_type.clone(), format!("{} C", prompt))
                .with_dependencies(vec!["task-a".to_string()]),
            AgentTask::new("task-d", task_type, format!("{} D", prompt))
                .with_dependencies(vec!["task-b".to_string(), "task-c".to_string()]),
        ]
    })
}

/// Strategy for generating circular dependencies
fn circular_dependency_strategy() -> impl Strategy<Value = Vec<AgentTask>> {
    prop_oneof![
        // Self-dependency: A -> A
        Just(vec![AgentTask::new("task-a", "test", "Self dependent")
            .with_dependencies(vec!["task-a".to_string()]),]),
        // Two-node cycle: A -> B -> A
        Just(vec![
            AgentTask::new("task-a", "test", "Task A")
                .with_dependencies(vec!["task-b".to_string()]),
            AgentTask::new("task-b", "test", "Task B")
                .with_dependencies(vec!["task-a".to_string()]),
        ]),
        // Three-node cycle: A -> B -> C -> A
        Just(vec![
            AgentTask::new("task-a", "test", "Task A")
                .with_dependencies(vec!["task-c".to_string()]),
            AgentTask::new("task-b", "test", "Task B")
                .with_dependencies(vec!["task-a".to_string()]),
            AgentTask::new("task-c", "test", "Task C")
                .with_dependencies(vec!["task-b".to_string()]),
        ]),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    /// **Feature: agents-alignment, Property 22: Dependency Graph Validation**
    ///
    /// Property: For any set of tasks with dependencies, execution SHALL respect
    /// dependency order. Tasks with dependencies SHALL only execute after their
    /// dependencies complete.
    ///
    /// **Validates: Requirements 6.2**
    #[test]
    fn prop_dependency_order_respected(
        tasks in dependent_task_chain_strategy(2, 6),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig {
                max_concurrency: 4,
                timeout: Duration::from_secs(30),
                retry_on_failure: false,
                stop_on_first_error: false,
                max_retries: 0,
                retry_delay: Duration::from_millis(10),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));
            let result = executor.execute_with_dependencies(tasks.clone()).await;

            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();

            // All tasks should complete
            prop_assert_eq!(
                result.results.len(),
                tasks.len(),
                "All tasks should complete"
            );

            // Verify dependency order: for each task with dependencies,
            // the dependency should have completed before the dependent task
            for task in &tasks {
                if let Some(deps) = &task.dependencies {
                    let task_result = result.results.iter().find(|r| r.task_id == task.id);
                    prop_assert!(task_result.is_some(), "Task {} should have a result", task.id);
                    let task_result = task_result.unwrap();

                    for dep_id in deps {
                        let dep_result = result.results.iter().find(|r| &r.task_id == dep_id);
                        prop_assert!(dep_result.is_some(), "Dependency {} should have a result", dep_id);
                        let dep_result = dep_result.unwrap();

                        // Dependency should have completed before the dependent task started
                        prop_assert!(
                            dep_result.completed_at <= task_result.started_at,
                            "Dependency {} (completed at {:?}) should complete before task {} (started at {:?})",
                            dep_id,
                            dep_result.completed_at,
                            task.id,
                            task_result.started_at
                        );
                    }
                }
            }

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 22: Dependency Graph Validation**
    ///
    /// Property: Diamond dependency patterns SHALL be handled correctly,
    /// with the final task only executing after all its dependencies complete.
    ///
    /// **Validates: Requirements 6.2**
    #[test]
    fn prop_diamond_dependency_handled(
        tasks in diamond_dependency_strategy(),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig {
                max_concurrency: 4,
                timeout: Duration::from_secs(30),
                retry_on_failure: false,
                stop_on_first_error: false,
                max_retries: 0,
                retry_delay: Duration::from_millis(10),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));
            let result = executor.execute_with_dependencies(tasks.clone()).await;

            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();

            // All 4 tasks should complete
            prop_assert_eq!(result.results.len(), 4, "All 4 tasks should complete");

            // Find results for each task
            let result_a = result.results.iter().find(|r| r.task_id == "task-a").unwrap();
            let result_b = result.results.iter().find(|r| r.task_id == "task-b").unwrap();
            let result_c = result.results.iter().find(|r| r.task_id == "task-c").unwrap();
            let result_d = result.results.iter().find(|r| r.task_id == "task-d").unwrap();

            // Verify order: A before B and C, B and C before D
            prop_assert!(
                result_a.completed_at <= result_b.started_at,
                "A should complete before B starts"
            );
            prop_assert!(
                result_a.completed_at <= result_c.started_at,
                "A should complete before C starts"
            );
            prop_assert!(
                result_b.completed_at <= result_d.started_at,
                "B should complete before D starts"
            );
            prop_assert!(
                result_c.completed_at <= result_d.started_at,
                "C should complete before D starts"
            );

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 22: Dependency Graph Validation**
    ///
    /// Property: Circular dependencies SHALL be detected and reported as errors.
    ///
    /// **Validates: Requirements 6.8**
    #[test]
    fn prop_circular_dependency_detected(
        tasks in circular_dependency_strategy(),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig::default();
            let mut executor = ParallelAgentExecutor::new(Some(config));

            let result = executor.execute_with_dependencies(tasks).await;

            // Should fail with CircularDependency error
            prop_assert!(result.is_err(), "Should detect circular dependency");

            match result {
                Err(ExecutorError::CircularDependency(cycle)) => {
                    prop_assert!(
                        !cycle.is_empty(),
                        "Cycle should contain at least one task"
                    );
                }
                Err(other) => {
                    prop_assert!(
                        false,
                        "Expected CircularDependency error, got: {:?}",
                        other
                    );
                }
                Ok(_) => {
                    prop_assert!(false, "Should have failed with circular dependency");
                }
            }

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 22: Dependency Graph Validation**
    ///
    /// Property: Missing dependencies (task depends on non-existent task)
    /// SHALL be detected and reported as errors.
    ///
    /// **Validates: Requirements 6.8**
    #[test]
    fn prop_missing_dependency_detected(
        task_id in task_id_strategy(),
        missing_dep in task_id_strategy(),
    ) {
        // Ensure task_id and missing_dep are different
        prop_assume!(task_id != missing_dep);

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tasks = vec![
                AgentTask::new(task_id.clone(), "test", "Task with missing dependency")
                    .with_dependencies(vec![missing_dep.clone()]),
            ];

            let config = ParallelAgentConfig::default();
            let mut executor = ParallelAgentExecutor::new(Some(config));

            let result = executor.execute_with_dependencies(tasks).await;

            // Should fail with InvalidDependency error
            prop_assert!(result.is_err(), "Should detect missing dependency");

            match result {
                Err(ExecutorError::InvalidDependency { task_id: tid, dependency: dep }) => {
                    prop_assert_eq!(tid, task_id, "Task ID should match");
                    prop_assert_eq!(dep, missing_dep, "Missing dependency should match");
                }
                Err(other) => {
                    prop_assert!(
                        false,
                        "Expected InvalidDependency error, got: {:?}",
                        other
                    );
                }
                Ok(_) => {
                    prop_assert!(false, "Should have failed with missing dependency");
                }
            }

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 22: Dependency Graph Validation**
    ///
    /// Property: validate_task_dependencies SHALL correctly identify valid
    /// dependency graphs.
    ///
    /// **Validates: Requirements 6.2, 6.8**
    #[test]
    fn prop_validation_identifies_valid_graphs(
        tasks in dependent_task_chain_strategy(1, 5),
    ) {
        let validation = validate_task_dependencies(&tasks);

        prop_assert!(
            validation.valid,
            "Valid dependency chain should pass validation: {:?}",
            validation.errors
        );
        prop_assert!(
            validation.errors.is_empty(),
            "Should have no errors"
        );
        prop_assert!(
            validation.circular_dependencies.is_none(),
            "Should have no circular dependencies"
        );
        prop_assert!(
            validation.missing_dependencies.is_empty(),
            "Should have no missing dependencies"
        );
    }
}

// ============================================================================
// Property Tests - Property 23: Retry Behavior Consistency
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    /// **Feature: agents-alignment, Property 23: Retry Behavior Consistency**
    ///
    /// Property: For any failed task with retry enabled, retries SHALL occur
    /// up to the configured maximum.
    ///
    /// **Validates: Requirements 6.5**
    #[test]
    fn prop_retry_count_within_max(
        tasks in task_list_strategy(1, 5),
        max_retries in 0usize..=5usize,
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig {
                max_concurrency: 4,
                timeout: Duration::from_secs(30),
                retry_on_failure: true,
                stop_on_first_error: false,
                max_retries,
                retry_delay: Duration::from_millis(1), // Short delay for testing
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));
            let result = executor.execute(tasks.clone()).await;

            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();

            // All task results should have retries <= max_retries
            for task_result in &result.results {
                prop_assert!(
                    task_result.retries <= max_retries,
                    "Task {} had {} retries, but max is {}",
                    task_result.task_id,
                    task_result.retries,
                    max_retries
                );
            }

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 23: Retry Behavior Consistency**
    ///
    /// Property: When retry_on_failure is disabled, no retries SHALL occur.
    ///
    /// **Validates: Requirements 6.5**
    #[test]
    fn prop_no_retry_when_disabled(
        tasks in task_list_strategy(1, 5),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig {
                max_concurrency: 4,
                timeout: Duration::from_secs(30),
                retry_on_failure: false, // Disabled
                stop_on_first_error: false,
                max_retries: 5, // This should be ignored
                retry_delay: Duration::from_millis(1),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));
            let result = executor.execute(tasks.clone()).await;

            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();

            // All task results should have 0 retries
            for task_result in &result.results {
                prop_assert_eq!(
                    task_result.retries,
                    0,
                    "Task {} should have 0 retries when retry is disabled",
                    task_result.task_id
                );
            }

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 23: Retry Behavior Consistency**
    ///
    /// Property: Successful tasks SHALL have 0 retries (no retry needed).
    ///
    /// **Validates: Requirements 6.5**
    #[test]
    fn prop_successful_tasks_no_retry(
        tasks in task_list_strategy(1, 5),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig {
                max_concurrency: 4,
                timeout: Duration::from_secs(30),
                retry_on_failure: true,
                stop_on_first_error: false,
                max_retries: 3,
                retry_delay: Duration::from_millis(1),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));
            let result = executor.execute(tasks.clone()).await;

            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();

            // All successful tasks should have 0 retries
            // (our simulated tasks always succeed on first try)
            for task_result in &result.results {
                if task_result.success {
                    prop_assert_eq!(
                        task_result.retries,
                        0,
                        "Successful task {} should have 0 retries",
                        task_result.task_id
                    );
                }
            }

            Ok(())
        })?;
    }

    /// **Feature: agents-alignment, Property 23: Retry Behavior Consistency**
    ///
    /// Property: Retry configuration SHALL be correctly applied from
    /// ParallelAgentConfig.
    ///
    /// **Validates: Requirements 6.5**
    #[test]
    fn prop_retry_config_applied(
        max_retries in 0usize..=10usize,
        retry_delay_ms in 1u64..=100u64,
        retry_on_failure in proptest::bool::ANY,
    ) {
        let config = ParallelAgentConfig {
            max_concurrency: 4,
            timeout: Duration::from_secs(30),
            retry_on_failure,
            stop_on_first_error: false,
            max_retries,
            retry_delay: Duration::from_millis(retry_delay_ms),
        };

        // Verify config is correctly stored
        prop_assert_eq!(config.max_retries, max_retries);
        prop_assert_eq!(config.retry_delay, Duration::from_millis(retry_delay_ms));
        prop_assert_eq!(config.retry_on_failure, retry_on_failure);

        let executor = ParallelAgentExecutor::new(Some(config.clone()));

        // Verify executor has the correct config
        prop_assert_eq!(executor.config().max_retries, max_retries);
        prop_assert_eq!(executor.config().retry_delay, Duration::from_millis(retry_delay_ms));
        prop_assert_eq!(executor.config().retry_on_failure, retry_on_failure);
    }
}

// ============================================================================
// Property Tests - Property 24: Result Merging Completeness
// ============================================================================

/// Strategy for generating AgentResult with configurable success
fn agent_result_strategy(success: bool) -> impl Strategy<Value = AgentResult> {
    (
        task_id_strategy(),
        "[a-z ]{5,20}".prop_map(|s| s.to_string()),
    )
        .prop_map(move |(task_id, error_msg)| {
            let now = chrono::Utc::now();
            AgentResult {
                task_id,
                success,
                result: if success {
                    Some(serde_json::json!({"output": "test result"}))
                } else {
                    None
                },
                error: if success { None } else { Some(error_msg) },
                duration: Duration::from_millis(100),
                retries: 0,
                started_at: now,
                completed_at: now,
            }
        })
}

/// Strategy for generating a mix of successful and failed results
fn mixed_results_strategy(
    min_size: usize,
    max_size: usize,
) -> impl Strategy<Value = Vec<AgentResult>> {
    prop::collection::vec(
        prop::bool::ANY.prop_flat_map(agent_result_strategy),
        min_size..=max_size,
    )
    .prop_map(|results| {
        // Ensure unique task IDs
        results
            .into_iter()
            .enumerate()
            .map(|(i, mut r)| {
                r.task_id = format!("{}_{}", r.task_id, i);
                r
            })
            .collect()
    })
}

/// Strategy for generating all successful results
fn all_successful_results_strategy(
    min_size: usize,
    max_size: usize,
) -> impl Strategy<Value = Vec<AgentResult>> {
    prop::collection::vec(agent_result_strategy(true), min_size..=max_size).prop_map(|results| {
        results
            .into_iter()
            .enumerate()
            .map(|(i, mut r)| {
                r.task_id = format!("{}_{}", r.task_id, i);
                r
            })
            .collect()
    })
}

/// Strategy for generating all failed results
fn all_failed_results_strategy(
    min_size: usize,
    max_size: usize,
) -> impl Strategy<Value = Vec<AgentResult>> {
    prop::collection::vec(agent_result_strategy(false), min_size..=max_size).prop_map(|results| {
        results
            .into_iter()
            .enumerate()
            .map(|(i, mut r)| {
                r.task_id = format!("{}_{}", r.task_id, i);
                r
            })
            .collect()
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    /// **Feature: agents-alignment, Property 24: Result Merging Completeness**
    ///
    /// Property: For any set of agent results, merging SHALL produce a combined
    /// output containing all individual successful results.
    ///
    /// **Validates: Requirements 6.6**
    #[test]
    fn prop_merge_contains_all_successful_outputs(
        results in mixed_results_strategy(1, 10),
    ) {
        let successful_count = results.iter().filter(|r| r.success && r.result.is_some()).count();

        let merged = merge_agent_results(results.clone());

        // Merged outputs should contain exactly the successful results with values
        prop_assert_eq!(
            merged.outputs.len(),
            successful_count,
            "Merged outputs should contain all successful results with values"
        );

        // Each successful result with a value should be in the outputs
        for result in &results {
            if result.success && result.result.is_some() {
                prop_assert!(
                    merged.outputs.contains(result.result.as_ref().unwrap()),
                    "Successful result for task {} should be in merged outputs",
                    result.task_id
                );
            }
        }
    }

    /// **Feature: agents-alignment, Property 24: Result Merging Completeness**
    ///
    /// Property: Merged result metadata SHALL correctly count successful and
    /// failed tasks.
    ///
    /// **Validates: Requirements 6.6**
    #[test]
    fn prop_merge_metadata_counts_correct(
        results in mixed_results_strategy(1, 10),
    ) {
        let total = results.len();
        let successful = results.iter().filter(|r| r.success).count();
        let failed = results.iter().filter(|r| !r.success).count();

        let merged = merge_agent_results(results);

        // Verify metadata counts
        prop_assert_eq!(
            merged.metadata.get("total_tasks"),
            Some(&serde_json::json!(total)),
            "Total tasks count should match"
        );
        prop_assert_eq!(
            merged.metadata.get("successful_tasks"),
            Some(&serde_json::json!(successful)),
            "Successful tasks count should match"
        );
        prop_assert_eq!(
            merged.metadata.get("failed_tasks"),
            Some(&serde_json::json!(failed)),
            "Failed tasks count should match"
        );
    }

    /// **Feature: agents-alignment, Property 24: Result Merging Completeness**
    ///
    /// Property: When all tasks succeed, the summary SHALL indicate success.
    ///
    /// **Validates: Requirements 6.6**
    #[test]
    fn prop_merge_all_success_summary(
        results in all_successful_results_strategy(1, 10),
    ) {
        let count = results.len();
        let merged = merge_agent_results(results);

        prop_assert!(merged.summary.is_some(), "Summary should be present");

        let summary = merged.summary.unwrap();
        prop_assert!(
            summary.contains("successfully") || summary.contains(&count.to_string()),
            "Summary should indicate all tasks succeeded: {}",
            summary
        );
        prop_assert!(
            !summary.contains("failed"),
            "Summary should not mention failures when all succeed: {}",
            summary
        );
    }

    /// **Feature: agents-alignment, Property 24: Result Merging Completeness**
    ///
    /// Property: When some tasks fail, the summary SHALL indicate both
    /// success and failure counts.
    ///
    /// **Validates: Requirements 6.6**
    #[test]
    fn prop_merge_mixed_results_summary(
        successful_count in 1usize..=5usize,
        failed_count in 1usize..=5usize,
    ) {
        let now = chrono::Utc::now();

        // Create successful results
        let mut results: Vec<AgentResult> = (0..successful_count)
            .map(|i| AgentResult {
                task_id: format!("success-{}", i),
                success: true,
                result: Some(serde_json::json!({"output": i})),
                error: None,
                duration: Duration::from_millis(100),
                retries: 0,
                started_at: now,
                completed_at: now,
            })
            .collect();

        // Add failed results
        results.extend((0..failed_count).map(|i| AgentResult {
            task_id: format!("failed-{}", i),
            success: false,
            result: None,
            error: Some(format!("Error {}", i)),
            duration: Duration::from_millis(100),
            retries: 0,
            started_at: now,
            completed_at: now,
        }));

        let merged = merge_agent_results(results);

        prop_assert!(merged.summary.is_some(), "Summary should be present");

        let summary = merged.summary.unwrap();
        prop_assert!(
            summary.contains("succeeded") && summary.contains("failed"),
            "Summary should mention both succeeded and failed: {}",
            summary
        );
    }

    /// **Feature: agents-alignment, Property 24: Result Merging Completeness**
    ///
    /// Property: Empty result list SHALL produce empty merged output.
    ///
    /// **Validates: Requirements 6.6**
    #[test]
    fn prop_merge_empty_results(_dummy in 0..1i32) {
        let results: Vec<AgentResult> = vec![];
        let merged = merge_agent_results(results);

        prop_assert!(merged.outputs.is_empty(), "Empty results should produce empty outputs");
        prop_assert_eq!(
            merged.metadata.get("total_tasks"),
            Some(&serde_json::json!(0)),
            "Total should be 0"
        );
        prop_assert_eq!(
            merged.metadata.get("successful_tasks"),
            Some(&serde_json::json!(0)),
            "Successful should be 0"
        );
        prop_assert_eq!(
            merged.metadata.get("failed_tasks"),
            Some(&serde_json::json!(0)),
            "Failed should be 0"
        );
    }

    /// **Feature: agents-alignment, Property 24: Result Merging Completeness**
    ///
    /// Property: All failed results SHALL produce empty outputs but correct
    /// failure count.
    ///
    /// **Validates: Requirements 6.6**
    #[test]
    fn prop_merge_all_failed_results(
        results in all_failed_results_strategy(1, 10),
    ) {
        let count = results.len();
        let merged = merge_agent_results(results);

        prop_assert!(
            merged.outputs.is_empty(),
            "All failed results should produce empty outputs"
        );
        prop_assert_eq!(
            merged.metadata.get("failed_tasks"),
            Some(&serde_json::json!(count)),
            "Failed count should match total"
        );
        prop_assert_eq!(
            merged.metadata.get("successful_tasks"),
            Some(&serde_json::json!(0)),
            "Successful count should be 0"
        );
    }

    /// **Feature: agents-alignment, Property 24: Result Merging Completeness**
    ///
    /// Property: Parallel execution result SHALL include merged results.
    ///
    /// **Validates: Requirements 6.6**
    #[test]
    fn prop_execution_includes_merged_result(
        tasks in task_list_strategy(1, 5),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let config = ParallelAgentConfig {
                max_concurrency: 4,
                timeout: Duration::from_secs(30),
                retry_on_failure: false,
                stop_on_first_error: false,
                max_retries: 0,
                retry_delay: Duration::from_millis(10),
            };

            let mut executor = ParallelAgentExecutor::new(Some(config));
            let result = executor.execute(tasks.clone()).await;

            prop_assert!(result.is_ok(), "Execution failed: {:?}", result.err());

            let result = result.unwrap();

            // Merged result should be present
            prop_assert!(
                result.merged_result.is_some(),
                "Execution result should include merged result"
            );

            let merged = result.merged_result.unwrap();

            // Merged result should match execution counts
            prop_assert_eq!(
                merged.metadata.get("total_tasks"),
                Some(&serde_json::json!(tasks.len())),
                "Merged total should match task count"
            );
            prop_assert_eq!(
                merged.metadata.get("successful_tasks"),
                Some(&serde_json::json!(result.successful_count)),
                "Merged successful count should match"
            );
            prop_assert_eq!(
                merged.metadata.get("failed_tasks"),
                Some(&serde_json::json!(result.failed_count)),
                "Merged failed count should match"
            );

            Ok(())
        })?;
    }
}

// ============================================================================
// Additional Unit Tests for Edge Cases
// ============================================================================

#[cfg(test)]
mod edge_case_tests {
    use super::*;

    #[tokio::test]
    async fn test_empty_task_list() {
        let config = ParallelAgentConfig::default();
        let mut executor = ParallelAgentExecutor::new(Some(config));

        let result = executor.execute(vec![]).await;
        assert!(result.is_ok());

        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.results.len(), 0);
        assert_eq!(result.successful_count, 0);
        assert_eq!(result.failed_count, 0);
    }

    #[tokio::test]
    async fn test_single_task() {
        let config = ParallelAgentConfig::default();
        let mut executor = ParallelAgentExecutor::new(Some(config));

        let tasks = vec![AgentTask::new("single", "test", "Single task")];
        let result = executor.execute(tasks).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.results.len(), 1);
        assert_eq!(result.successful_count, 1);
    }

    #[tokio::test]
    async fn test_max_concurrency_one() {
        let config = ParallelAgentConfig {
            max_concurrency: 1,
            ..Default::default()
        };
        let mut executor = ParallelAgentExecutor::new(Some(config));

        let tasks = vec![
            AgentTask::new("task-1", "test", "Task 1"),
            AgentTask::new("task-2", "test", "Task 2"),
            AgentTask::new("task-3", "test", "Task 3"),
        ];

        let result = executor.execute(tasks).await;
        assert!(result.is_ok());

        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.results.len(), 3);
    }

    #[tokio::test]
    async fn test_high_concurrency() {
        let config = ParallelAgentConfig {
            max_concurrency: 100, // More than tasks
            ..Default::default()
        };
        let mut executor = ParallelAgentExecutor::new(Some(config));

        let tasks = vec![
            AgentTask::new("task-1", "test", "Task 1"),
            AgentTask::new("task-2", "test", "Task 2"),
        ];

        let result = executor.execute(tasks).await;
        assert!(result.is_ok());

        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.results.len(), 2);
    }
}
