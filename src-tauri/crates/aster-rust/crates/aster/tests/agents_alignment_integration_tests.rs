//! Integration Tests for Agents Alignment Modules
//!
//! This module contains end-to-end integration tests that verify
//! the interaction between different agents alignment components:
//! - Context management and isolation
//! - Communication (message bus, shared state, coordinator)
//! - Parallel execution
//! - Monitoring and alerts
//! - Resume and state management
//! - Specialized agents (explore, plan)
//! - Error handling

use aster::agents::{
    // Communication
    AgentCapabilities,
    // Context
    AgentContext,
    AgentContextManager,
    AgentCoordinator,
    AgentErrorKind,
    AgentMessageBus,
    // Monitor
    AgentMonitor,
    // Parallel
    AgentPool,
    AgentResumer,
    // Resume
    AgentState,
    AgentStateManager,
    AgentStateStatus,
    AgentTask,
    AssignmentCriteria,
    ContextInheritanceConfig,
    ContextInheritanceType,
    ContextIsolation,
    DependencyGraph,
    ErrorContext,
    // Error handling
    ErrorHandler,
    // Specialized
    ExploreAgent,
    ExploreOptions,
    LoadBalanceStrategy,
    ParallelAgentConfig,
    ParallelAgentExecutor,
    PerformanceAnalyzer,
    PlanAgent,
    PlanOptions,
    RetryHandler,
    SandboxRestrictions,
    SandboxState,
    SharedStateManager,
    Task,
    ThoroughnessLevel,
    TimeoutHandler,
};
use serde_json::json;
use std::collections::HashSet;
use std::time::Duration;
use tempfile::TempDir;

// ============================================================================
// Context and Isolation Integration Tests
// ============================================================================

/// Test that context creation and inheritance work together correctly
#[test]
fn test_context_creation_and_inheritance_integration() {
    let mut manager = AgentContextManager::new();

    // Create parent context
    let parent = manager.create_context(None, None);
    assert!(!parent.context_id.is_empty());

    // Create child context with inheritance
    let config = ContextInheritanceConfig {
        inherit_conversation: true,
        inherit_files: true,
        inherit_tool_results: false,
        inherit_environment: true,
        max_history_length: Some(10),
        max_file_contexts: Some(5),
        max_tool_results: None,
        filter_sensitive: true,
        compress_context: false,
        target_tokens: None,
        inheritance_type: ContextInheritanceType::Full,
    };

    let child = manager.create_context(Some(&parent), Some(config));
    assert!(!child.context_id.is_empty());
    assert_ne!(parent.context_id, child.context_id);
    assert_eq!(child.parent_context_id, Some(parent.context_id.clone()));
}

/// Test context isolation with sandbox restrictions
#[test]
fn test_context_isolation_with_restrictions() {
    let mut isolation = ContextIsolation::new();
    let context = AgentContext::new();

    let restrictions = SandboxRestrictions {
        max_tokens: 1000,
        max_files: 10,
        max_tool_results: 5,
        allowed_tools: Some(
            ["read_file", "write_file"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        ),
        denied_tools: None,
    };

    let sandbox =
        isolation.create_sandbox(context, Some("agent-1".to_string()), Some(restrictions));
    assert_eq!(sandbox.state, SandboxState::Active);
    assert_eq!(sandbox.restrictions.max_tokens, 1000);

    // Verify tool permissions
    assert!(isolation.is_tool_allowed(&sandbox.sandbox_id, "read_file"));
    assert!(isolation.is_tool_allowed(&sandbox.sandbox_id, "write_file"));
    assert!(!isolation.is_tool_allowed(&sandbox.sandbox_id, "execute_bash"));
}

// ============================================================================
// Communication Integration Tests
// ============================================================================

/// Test message bus and coordinator working together
#[test]
fn test_message_bus_and_coordinator_integration() {
    let mut bus = AgentMessageBus::new();
    let mut coordinator = AgentCoordinator::new();

    // Register agents
    let agent1 =
        AgentCapabilities::new("agent-1", "worker").with_capabilities(vec!["compute".to_string()]);
    let agent2 =
        AgentCapabilities::new("agent-2", "worker").with_capabilities(vec!["io".to_string()]);

    coordinator.register_agent(agent1).unwrap();
    coordinator.register_agent(agent2).unwrap();

    // Subscribe agents to message bus
    bus.subscribe("agent-1", vec!["task".to_string()]);
    bus.subscribe("agent-2", vec!["task".to_string()]);

    // Broadcast a message
    bus.broadcast("task", json!({"action": "process"}), "coordinator")
        .unwrap();

    // Both agents should receive the message
    assert_eq!(bus.queue_size("agent-1"), 1);
    assert_eq!(bus.queue_size("agent-2"), 1);
}

/// Test shared state with coordinator for task assignment
#[test]
fn test_shared_state_with_task_assignment() {
    let mut state = SharedStateManager::new();
    let mut coordinator = AgentCoordinator::new();

    // Register an agent
    let agent = AgentCapabilities::new("worker-1", "compute")
        .with_capabilities(vec!["math".to_string()])
        .with_max_concurrent_tasks(2);
    coordinator.register_agent(agent).unwrap();

    // Store task metadata in shared state
    state.set("task-count", json!(0));

    // Assign a task
    let task = Task::new("compute", json!({"operation": "add", "a": 1, "b": 2}));
    let criteria = AssignmentCriteria::new()
        .with_capabilities(vec!["math".to_string()])
        .with_strategy(LoadBalanceStrategy::LeastBusy);

    let assigned_agent = coordinator.assign_task(task, &criteria).unwrap();
    assert_eq!(assigned_agent, "worker-1");

    // Update shared state
    let count = state.increment("task-count", 1);
    assert_eq!(count, 1);
}

/// Test distributed locking with shared state
#[test]
fn test_distributed_locking() {
    let mut state = SharedStateManager::new();

    // Acquire lock
    let lock = state
        .lock("resource-1", "agent-1", Some(chrono::Duration::seconds(30)))
        .unwrap();
    assert!(state.is_locked("resource-1"));

    // Try to acquire same lock should fail
    let result = state.lock("resource-1", "agent-2", Some(chrono::Duration::seconds(30)));
    assert!(result.is_err());

    // Release lock
    state.unlock(&lock).unwrap();
    assert!(!state.is_locked("resource-1"));

    // Now agent-2 can acquire
    let lock2 = state
        .lock("resource-1", "agent-2", Some(chrono::Duration::seconds(30)))
        .unwrap();
    assert_eq!(lock2.holder, "agent-2");
}

// ============================================================================
// Parallel Execution Integration Tests
// ============================================================================

/// Test parallel executor with dependency graph
#[test]
fn test_parallel_executor_with_dependencies() {
    let config = ParallelAgentConfig {
        max_concurrency: 2,
        timeout: Duration::from_secs(60),
        retry_on_failure: false,
        stop_on_first_error: false,
        max_retries: 0,
        retry_delay: Duration::from_millis(100),
    };

    let _executor = ParallelAgentExecutor::new(Some(config));

    // Create tasks with dependencies
    let _task1 = AgentTask::new("task-1", "compute", "First task");
    let _task2 = AgentTask::new("task-2", "compute", "Second task")
        .with_dependencies(vec!["task-1".to_string()]);
    let _task3 = AgentTask::new("task-3", "compute", "Third task")
        .with_dependencies(vec!["task-1".to_string()]);

    // Build dependency graph
    let mut graph = DependencyGraph::new();
    graph.add_task("task-1");
    graph.add_task("task-2");
    graph.add_task("task-3");
    graph.add_dependency("task-2", "task-1");
    graph.add_dependency("task-3", "task-1");

    // Verify dependencies
    let deps = graph.get_dependencies("task-2");
    assert!(deps.contains("task-1"));

    // Get ready tasks (only task-1 should be ready initially)
    let completed = HashSet::new();
    let running = HashSet::new();
    let ready = graph.get_ready_tasks(&completed, &running);
    assert_eq!(ready.len(), 1);
    assert!(ready.contains(&"task-1".to_string()));
}

/// Test agent pool acquire and release
#[test]
fn test_agent_pool_lifecycle() {
    let mut pool = AgentPool::new(3);

    assert_eq!(pool.pool_size(), 3);
    assert_eq!(pool.available_count(), 3);
    assert_eq!(pool.busy_count(), 0);

    // Acquire workers
    let worker1 = pool.acquire().unwrap().unwrap();
    assert_eq!(pool.available_count(), 2);
    assert_eq!(pool.busy_count(), 1);

    let worker2 = pool.acquire().unwrap().unwrap();
    assert_eq!(pool.available_count(), 1);
    assert_eq!(pool.busy_count(), 2);

    // Release a worker
    pool.release(worker1).unwrap();
    assert_eq!(pool.available_count(), 2);
    assert_eq!(pool.busy_count(), 1);

    // Release the other worker
    pool.release(worker2).unwrap();
    assert_eq!(pool.available_count(), 3);
    assert_eq!(pool.busy_count(), 0);
}

// ============================================================================
// Monitoring Integration Tests
// ============================================================================

/// Test monitor with alert manager integration
#[test]
fn test_monitor_and_alert_integration() {
    let mut monitor = AgentMonitor::new(None);

    // Start tracking an agent
    monitor.start_tracking("agent-1", "worker", Some("Test agent"));

    // Record some metrics
    monitor.record_tokens("agent-1", 100, 50);
    monitor.record_api_call("agent-1", true, Some(Duration::from_millis(200)));
    monitor.record_cost("agent-1", 0.01);

    // Get metrics
    let metrics = monitor.get_metrics("agent-1").unwrap();
    assert_eq!(metrics.tokens_used.input, 100);
    assert_eq!(metrics.tokens_used.output, 50);
    assert_eq!(metrics.api_calls, 1);
}

/// Test performance analyzer with metrics
#[test]
fn test_performance_analyzer() {
    let analyzer = PerformanceAnalyzer::new();

    // The analyzer should be able to analyze empty metrics
    let reports = analyzer.analyze(&[]);
    assert!(reports.is_empty());
}

// ============================================================================
// Resume Integration Tests
// ============================================================================

/// Test state manager and resumer integration
#[tokio::test]
async fn test_state_manager_and_resumer_integration() {
    let temp_dir = TempDir::new().unwrap();
    let state_manager = AgentStateManager::new(Some(temp_dir.path().to_path_buf()));

    // Create and save a state
    let mut state = AgentState::new("agent-1", "worker", "Test prompt");
    state.status = AgentStateStatus::Paused;
    state.current_step = 5;

    state_manager.save_state(&state).await.unwrap();

    // Create resumer and check resume capability
    let resumer = AgentResumer::new(AgentStateManager::new(Some(temp_dir.path().to_path_buf())));
    let can_resume = resumer.can_resume("agent-1").await;
    assert!(can_resume);

    // Get resume point info
    let info = resumer.get_resume_point("agent-1").await;
    assert!(info.can_resume);
    assert_eq!(info.step, 5);
}

// ============================================================================
// Specialized Agents Integration Tests
// ============================================================================

/// Test explore agent with options
#[test]
fn test_explore_agent_creation() {
    let options = ExploreOptions::new("find rust files")
        .with_thoroughness(ThoroughnessLevel::Quick)
        .with_patterns(vec!["*.rs".to_string()])
        .with_max_results(10);

    let _agent = ExploreAgent::new(options);
    // Agent should be created successfully
}

/// Test plan agent with options
#[test]
fn test_plan_agent_creation() {
    let options = PlanOptions::new("Implement a new feature")
        .with_context("This is a Rust project")
        .with_thoroughness(ThoroughnessLevel::Medium)
        .with_constraints(vec!["Must be backward compatible".to_string()]);

    let _agent = PlanAgent::new(options);
    // Agent should be created successfully
}

// ============================================================================
// Error Handling Integration Tests
// ============================================================================

/// Test error handler with timeout handler integration
#[test]
fn test_error_and_timeout_handler_integration() {
    let mut error_handler = ErrorHandler::new();
    let mut timeout_handler = TimeoutHandler::new();

    // Start tracking an agent
    timeout_handler.start_tracking("agent-1");

    // Record an error using the correct API
    let context = ErrorContext::new()
        .with_agent_id("agent-1")
        .with_phase("execution");
    error_handler.record_with_context(AgentErrorKind::Internal, "Test error", context);

    // Get errors for the agent
    let errors = error_handler.get_by_agent("agent-1");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].message, "Test error");

    // Check timeout status
    let status = timeout_handler.check_status("agent-1");
    assert!(status.is_some());
}

/// Test retry handler configuration
#[test]
fn test_retry_handler_configuration() {
    let handler = RetryHandler::new();

    // Handler should be created successfully
    // Start tracking an operation
    let mut handler = handler;
    let state = handler.start("test-operation");
    assert_eq!(state.attempt, 0);
}

// ============================================================================
// Cross-Module Integration Tests
// ============================================================================

/// Test full workflow: context -> communication -> execution -> monitoring
#[test]
fn test_full_agent_workflow() {
    // 1. Create context
    let mut context_manager = AgentContextManager::new();
    let _context = context_manager.create_context(None, None);

    // 2. Set up communication
    let mut bus = AgentMessageBus::new();
    let mut coordinator = AgentCoordinator::new();

    let agent = AgentCapabilities::new("worker-1", "compute")
        .with_capabilities(vec!["process".to_string()]);
    coordinator.register_agent(agent).unwrap();
    bus.subscribe("worker-1", vec![]);

    // 3. Set up monitoring
    let mut monitor = AgentMonitor::new(None);
    monitor.start_tracking("worker-1", "compute", Some("Integration test agent"));

    // 4. Assign task
    let task = Task::new("process", json!({"data": "test"}));
    let criteria = AssignmentCriteria::new().with_capabilities(vec!["process".to_string()]);
    let assigned = coordinator.assign_task(task, &criteria).unwrap();
    assert_eq!(assigned, "worker-1");

    // 5. Record metrics
    monitor.record_tokens("worker-1", 50, 25);
    monitor.record_api_call("worker-1", true, Some(Duration::from_millis(100)));

    // 6. Verify metrics
    let metrics = monitor.get_metrics("worker-1").unwrap();
    assert_eq!(metrics.tokens_used.total, 75);
}

/// Test isolation with shared state coordination
#[test]
fn test_isolation_with_shared_state() {
    let mut isolation = ContextIsolation::new();
    let mut state = SharedStateManager::new();

    // Create isolated sandbox
    let context = AgentContext::new();
    let restrictions = SandboxRestrictions {
        max_tokens: 500,
        max_files: 5,
        max_tool_results: 3,
        allowed_tools: None,
        denied_tools: Some(["dangerous_tool".to_string()].iter().cloned().collect()),
    };

    let sandbox = isolation.create_sandbox(
        context,
        Some("isolated-agent".to_string()),
        Some(restrictions),
    );

    // Store sandbox info in shared state
    state.set(
        format!("sandbox:{}", sandbox.sandbox_id),
        json!({
            "agent_id": sandbox.agent_id,
            "state": "active",
            "max_tokens": sandbox.restrictions.max_tokens
        }),
    );

    // Verify shared state
    let sandbox_info = state
        .get(&format!("sandbox:{}", sandbox.sandbox_id))
        .unwrap();
    assert_eq!(sandbox_info["state"], "active");
}

/// Test coordinator with deadlock detection
#[test]
fn test_coordinator_deadlock_detection() {
    let mut coordinator = AgentCoordinator::new();

    // Register agents
    let agent1 = AgentCapabilities::new("agent-1", "worker");
    let agent2 = AgentCapabilities::new("agent-2", "worker");
    coordinator.register_agent(agent1).unwrap();
    coordinator.register_agent(agent2).unwrap();

    // Create circular dependency
    coordinator.record_resource_dependency("agent-1", "resource-A");
    coordinator.record_resource_holder("resource-A", "agent-2");
    coordinator.record_resource_dependency("agent-2", "resource-B");
    coordinator.record_resource_holder("resource-B", "agent-1");

    // Detect deadlock
    let deadlock = coordinator.detect_deadlock();
    assert!(deadlock.is_some());

    let info = deadlock.unwrap();
    assert!(info.involved_agents.contains(&"agent-1".to_string()));
    assert!(info.involved_agents.contains(&"agent-2".to_string()));
}
