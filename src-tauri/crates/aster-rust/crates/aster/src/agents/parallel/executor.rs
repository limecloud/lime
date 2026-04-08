//! Parallel Agent Executor
//!
//! Executes multiple agent tasks concurrently with dependency management,
//! retry logic, and result merging.
//!
//! # Features
//! - Configurable concurrency limits
//! - Task dependencies and execution ordering
//! - Task priorities and timeouts
//! - Retry on failure with configurable delay
//! - Stop on first error option
//! - Result merging from multiple agents

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::sync::Mutex;
use tokio::time::timeout;

/// Result type alias for executor operations
pub type ExecutorResult<T> = Result<T, ExecutorError>;

/// Error types for executor operations
#[derive(Debug, Error, Clone)]
pub enum ExecutorError {
    /// Task not found
    #[error("Task not found: {0}")]
    TaskNotFound(String),

    /// Task timeout
    #[error("Task timeout: {0}")]
    TaskTimeout(String),

    /// Task failed
    #[error("Task failed: {task_id}, error: {error}")]
    TaskFailed { task_id: String, error: String },

    /// Circular dependency detected
    #[error("Circular dependency detected: {0:?}")]
    CircularDependency(Vec<String>),

    /// Invalid dependency
    #[error("Invalid dependency: task {task_id} depends on non-existent task {dependency}")]
    InvalidDependency { task_id: String, dependency: String },

    /// Execution cancelled
    #[error("Execution cancelled")]
    Cancelled,

    /// All retries exhausted
    #[error("All retries exhausted for task: {0}")]
    RetriesExhausted(String),

    /// Dependency failed
    #[error("Dependency failed: task {task_id} depends on failed task {dependency}")]
    DependencyFailed { task_id: String, dependency: String },
}

/// Task execution status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    /// Task is waiting to be executed
    Pending,
    /// Task is waiting for dependencies
    WaitingForDependencies,
    /// Task is currently running
    Running,
    /// Task completed successfully
    Completed,
    /// Task failed
    Failed,
    /// Task was cancelled
    Cancelled,
    /// Task was skipped (dependency failed)
    Skipped,
}

/// Parallel execution configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParallelAgentConfig {
    /// Maximum number of concurrent tasks
    pub max_concurrency: usize,
    /// Default timeout for tasks
    pub timeout: Duration,
    /// Whether to retry failed tasks
    pub retry_on_failure: bool,
    /// Whether to stop execution on first error
    pub stop_on_first_error: bool,
    /// Maximum number of retries per task
    pub max_retries: usize,
    /// Delay between retries
    pub retry_delay: Duration,
}

impl Default for ParallelAgentConfig {
    fn default() -> Self {
        Self {
            max_concurrency: 4,
            timeout: Duration::from_secs(300), // 5 minutes
            retry_on_failure: true,
            stop_on_first_error: false,
            max_retries: 3,
            retry_delay: Duration::from_secs(1),
        }
    }
}

/// Agent task definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    /// Unique task identifier
    pub id: String,
    /// Type of task (e.g., "explore", "plan", "execute")
    pub task_type: String,
    /// Task prompt or instruction
    pub prompt: String,
    /// Optional description
    pub description: Option<String>,
    /// Additional options for the task
    pub options: Option<HashMap<String, Value>>,
    /// Task priority (higher = more important)
    pub priority: Option<u8>,
    /// IDs of tasks this task depends on
    pub dependencies: Option<Vec<String>>,
    /// Task-specific timeout (overrides config)
    pub timeout: Option<Duration>,
}

impl AgentTask {
    /// Create a new task
    pub fn new(
        id: impl Into<String>,
        task_type: impl Into<String>,
        prompt: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            task_type: task_type.into(),
            prompt: prompt.into(),
            description: None,
            options: None,
            priority: None,
            dependencies: None,
            timeout: None,
        }
    }

    /// Set description
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Set options
    pub fn with_options(mut self, options: HashMap<String, Value>) -> Self {
        self.options = Some(options);
        self
    }

    /// Set priority
    pub fn with_priority(mut self, priority: u8) -> Self {
        self.priority = Some(priority);
        self
    }

    /// Set dependencies
    pub fn with_dependencies(mut self, dependencies: Vec<String>) -> Self {
        self.dependencies = Some(dependencies);
        self
    }

    /// Set timeout
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Get effective priority (default is 0)
    pub fn effective_priority(&self) -> u8 {
        self.priority.unwrap_or(0)
    }

    /// Check if this task has dependencies
    pub fn has_dependencies(&self) -> bool {
        self.dependencies
            .as_ref()
            .map(|d| !d.is_empty())
            .unwrap_or(false)
    }

    /// Get dependencies or empty vec
    pub fn get_dependencies(&self) -> Vec<String> {
        self.dependencies.clone().unwrap_or_default()
    }
}

/// Result of a single agent task execution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResult {
    /// Task ID
    pub task_id: String,
    /// Whether the task succeeded
    pub success: bool,
    /// Result value (if successful)
    pub result: Option<Value>,
    /// Error message (if failed)
    pub error: Option<String>,
    /// Execution duration
    pub duration: Duration,
    /// Number of retries attempted
    pub retries: usize,
    /// Timestamp when task started
    pub started_at: DateTime<Utc>,
    /// Timestamp when task completed
    pub completed_at: DateTime<Utc>,
}

/// Task execution information (internal tracking)
#[derive(Debug, Clone)]
pub struct TaskExecutionInfo {
    /// The task
    pub task: AgentTask,
    /// Current status
    pub status: TaskStatus,
    /// Number of retries attempted
    pub retries: usize,
    /// Last error (if any)
    pub last_error: Option<String>,
    /// When execution started
    pub started_at: Option<DateTime<Utc>>,
    /// When execution completed
    pub completed_at: Option<DateTime<Utc>>,
    /// Result (if completed)
    pub result: Option<Value>,
}

impl TaskExecutionInfo {
    /// Create new execution info for a task
    pub fn new(task: AgentTask) -> Self {
        Self {
            task,
            status: TaskStatus::Pending,
            retries: 0,
            last_error: None,
            started_at: None,
            completed_at: None,
            result: None,
        }
    }
}

/// Execution progress information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionProgress {
    /// Total number of tasks
    pub total: usize,
    /// Number of completed tasks
    pub completed: usize,
    /// Number of failed tasks
    pub failed: usize,
    /// Number of running tasks
    pub running: usize,
    /// Number of pending tasks
    pub pending: usize,
    /// Number of skipped tasks
    pub skipped: usize,
    /// Whether execution is cancelled
    pub cancelled: bool,
}

/// Result of parallel execution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParallelExecutionResult {
    /// Whether all tasks succeeded
    pub success: bool,
    /// Individual task results
    pub results: Vec<AgentResult>,
    /// Total execution duration
    pub total_duration: Duration,
    /// Number of successful tasks
    pub successful_count: usize,
    /// Number of failed tasks
    pub failed_count: usize,
    /// Number of skipped tasks
    pub skipped_count: usize,
    /// Merged result from all successful tasks
    pub merged_result: Option<MergedResult>,
}

/// Merged result from multiple agent executions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedResult {
    /// Combined outputs from all tasks
    pub outputs: Vec<Value>,
    /// Summary of the merged results
    pub summary: Option<String>,
    /// Metadata about the merge
    pub metadata: HashMap<String, Value>,
}

/// Dependency graph for task execution ordering
#[derive(Debug, Clone)]
pub struct DependencyGraph {
    /// Map of task ID to its dependencies
    dependencies: HashMap<String, HashSet<String>>,
    /// Map of task ID to tasks that depend on it
    dependents: HashMap<String, HashSet<String>>,
    /// All task IDs in the graph
    task_ids: HashSet<String>,
}

impl DependencyGraph {
    /// Create a new empty dependency graph
    pub fn new() -> Self {
        Self {
            dependencies: HashMap::new(),
            dependents: HashMap::new(),
            task_ids: HashSet::new(),
        }
    }

    /// Add a task to the graph
    pub fn add_task(&mut self, task_id: impl Into<String>) {
        let task_id = task_id.into();
        self.task_ids.insert(task_id.clone());
        self.dependencies.entry(task_id).or_default();
    }

    /// Add a dependency: task_id depends on dependency_id
    pub fn add_dependency(&mut self, task_id: impl Into<String>, dependency_id: impl Into<String>) {
        let task_id = task_id.into();
        let dependency_id = dependency_id.into();

        self.task_ids.insert(task_id.clone());
        self.task_ids.insert(dependency_id.clone());

        self.dependencies
            .entry(task_id.clone())
            .or_default()
            .insert(dependency_id.clone());

        self.dependents
            .entry(dependency_id)
            .or_default()
            .insert(task_id);
    }

    /// Get dependencies for a task
    pub fn get_dependencies(&self, task_id: &str) -> HashSet<String> {
        self.dependencies.get(task_id).cloned().unwrap_or_default()
    }

    /// Get tasks that depend on this task
    pub fn get_dependents(&self, task_id: &str) -> HashSet<String> {
        self.dependents.get(task_id).cloned().unwrap_or_default()
    }

    /// Check if a task has unmet dependencies
    pub fn has_unmet_dependencies(&self, task_id: &str, completed: &HashSet<String>) -> bool {
        if let Some(deps) = self.dependencies.get(task_id) {
            deps.iter().any(|d| !completed.contains(d))
        } else {
            false
        }
    }

    /// Get tasks that are ready to execute (no unmet dependencies)
    pub fn get_ready_tasks(
        &self,
        completed: &HashSet<String>,
        running: &HashSet<String>,
    ) -> Vec<String> {
        self.task_ids
            .iter()
            .filter(|id| {
                !completed.contains(*id)
                    && !running.contains(*id)
                    && !self.has_unmet_dependencies(id, completed)
            })
            .cloned()
            .collect()
    }

    /// Check if all tasks are completed
    pub fn all_completed(&self, completed: &HashSet<String>) -> bool {
        self.task_ids.iter().all(|id| completed.contains(id))
    }

    /// Get all task IDs
    pub fn get_all_tasks(&self) -> &HashSet<String> {
        &self.task_ids
    }

    /// Check if the graph contains a task
    pub fn contains(&self, task_id: &str) -> bool {
        self.task_ids.contains(task_id)
    }
}

impl Default for DependencyGraph {
    fn default() -> Self {
        Self::new()
    }
}

/// Validation result for task dependencies
#[derive(Debug, Clone)]
pub struct ValidationResult {
    /// Whether validation passed
    pub valid: bool,
    /// List of errors found
    pub errors: Vec<String>,
    /// Detected circular dependencies (if any)
    pub circular_dependencies: Option<Vec<String>>,
    /// Missing dependencies (task depends on non-existent task)
    pub missing_dependencies: Vec<(String, String)>,
}

impl ValidationResult {
    /// Create a valid result
    pub fn valid() -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
            circular_dependencies: None,
            missing_dependencies: Vec::new(),
        }
    }

    /// Create an invalid result with errors
    pub fn invalid(errors: Vec<String>) -> Self {
        Self {
            valid: false,
            errors,
            circular_dependencies: None,
            missing_dependencies: Vec::new(),
        }
    }
}

/// Create a dependency graph from a list of tasks
pub fn create_dependency_graph(tasks: &[AgentTask]) -> DependencyGraph {
    let mut graph = DependencyGraph::new();

    for task in tasks {
        graph.add_task(&task.id);
        if let Some(deps) = &task.dependencies {
            for dep in deps {
                graph.add_dependency(&task.id, dep);
            }
        }
    }

    graph
}

/// Validate task dependencies
pub fn validate_task_dependencies(tasks: &[AgentTask]) -> ValidationResult {
    let task_ids: HashSet<String> = tasks.iter().map(|t| t.id.clone()).collect();
    let mut errors = Vec::new();
    let mut missing_deps = Vec::new();

    // Check for missing dependencies
    for task in tasks {
        if let Some(deps) = &task.dependencies {
            for dep in deps {
                if !task_ids.contains(dep) {
                    errors.push(format!(
                        "Task '{}' depends on non-existent task '{}'",
                        task.id, dep
                    ));
                    missing_deps.push((task.id.clone(), dep.clone()));
                }
            }
        }
    }

    // Check for circular dependencies using DFS
    let graph = create_dependency_graph(tasks);
    if let Some(cycle) = detect_cycle(&graph) {
        errors.push(format!("Circular dependency detected: {:?}", cycle));
        return ValidationResult {
            valid: false,
            errors,
            circular_dependencies: Some(cycle),
            missing_dependencies: missing_deps,
        };
    }

    if errors.is_empty() {
        ValidationResult::valid()
    } else {
        ValidationResult {
            valid: false,
            errors,
            circular_dependencies: None,
            missing_dependencies: missing_deps,
        }
    }
}

/// Detect cycles in the dependency graph using DFS
fn detect_cycle(graph: &DependencyGraph) -> Option<Vec<String>> {
    let mut visited = HashSet::new();
    let mut rec_stack = HashSet::new();
    let mut path = Vec::new();

    for task_id in graph.get_all_tasks() {
        if !visited.contains(task_id) {
            if let Some(cycle) =
                dfs_detect_cycle(graph, task_id, &mut visited, &mut rec_stack, &mut path)
            {
                return Some(cycle);
            }
        }
    }

    None
}

/// DFS helper for cycle detection
fn dfs_detect_cycle(
    graph: &DependencyGraph,
    task_id: &str,
    visited: &mut HashSet<String>,
    rec_stack: &mut HashSet<String>,
    path: &mut Vec<String>,
) -> Option<Vec<String>> {
    visited.insert(task_id.to_string());
    rec_stack.insert(task_id.to_string());
    path.push(task_id.to_string());

    for dep in graph.get_dependencies(task_id) {
        if !visited.contains(&dep) {
            if let Some(cycle) = dfs_detect_cycle(graph, &dep, visited, rec_stack, path) {
                return Some(cycle);
            }
        } else if rec_stack.contains(&dep) {
            // Found a cycle - extract the cycle path
            let cycle_start = path.iter().position(|x| x == &dep).unwrap();
            let mut cycle: Vec<String> = path[cycle_start..].to_vec();
            cycle.push(dep);
            return Some(cycle);
        }
    }

    path.pop();
    rec_stack.remove(task_id);
    None
}

/// Merge results from multiple agent executions
pub fn merge_agent_results(results: Vec<AgentResult>) -> MergedResult {
    let outputs: Vec<Value> = results
        .iter()
        .filter(|r| r.success && r.result.is_some())
        .map(|r| r.result.clone().unwrap())
        .collect();

    let successful = results.iter().filter(|r| r.success).count();
    let failed = results.iter().filter(|r| !r.success).count();

    let mut metadata = HashMap::new();
    metadata.insert("total_tasks".to_string(), Value::from(results.len()));
    metadata.insert("successful_tasks".to_string(), Value::from(successful));
    metadata.insert("failed_tasks".to_string(), Value::from(failed));

    let summary = if failed == 0 {
        Some(format!("All {} tasks completed successfully", successful))
    } else {
        Some(format!(
            "{} tasks succeeded, {} tasks failed",
            successful, failed
        ))
    };

    MergedResult {
        outputs,
        summary,
        metadata,
    }
}

/// Parallel Agent Executor
///
/// Executes multiple agent tasks concurrently with configurable
/// concurrency limits, dependency management, and retry logic.
pub struct ParallelAgentExecutor {
    /// Configuration
    config: ParallelAgentConfig,
    /// Task execution info
    tasks: Arc<Mutex<HashMap<String, TaskExecutionInfo>>>,
    /// Whether execution is running
    running: Arc<Mutex<bool>>,
    /// Whether execution has been cancelled
    cancelled: Arc<Mutex<bool>>,
}

impl ParallelAgentExecutor {
    /// Create a new executor with optional configuration
    pub fn new(config: Option<ParallelAgentConfig>) -> Self {
        Self {
            config: config.unwrap_or_default(),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(false)),
            cancelled: Arc::new(Mutex::new(false)),
        }
    }

    /// Create a new executor with specific configuration
    pub fn with_config(config: ParallelAgentConfig) -> Self {
        Self::new(Some(config))
    }

    /// Get the current configuration
    pub fn config(&self) -> &ParallelAgentConfig {
        &self.config
    }

    /// Execute tasks without dependencies (parallel execution)
    pub async fn execute(
        &mut self,
        tasks: Vec<AgentTask>,
    ) -> ExecutorResult<ParallelExecutionResult> {
        // Create dependency graph (no dependencies)
        let graph = create_dependency_graph(&tasks);
        self.execute_with_graph(tasks, graph).await
    }

    /// Execute tasks with dependencies
    pub async fn execute_with_dependencies(
        &mut self,
        tasks: Vec<AgentTask>,
    ) -> ExecutorResult<ParallelExecutionResult> {
        // Validate dependencies first
        let validation = validate_task_dependencies(&tasks);
        if !validation.valid {
            if let Some(cycle) = validation.circular_dependencies {
                return Err(ExecutorError::CircularDependency(cycle));
            }
            if let Some((task_id, dep)) = validation.missing_dependencies.first() {
                return Err(ExecutorError::InvalidDependency {
                    task_id: task_id.clone(),
                    dependency: dep.clone(),
                });
            }
        }

        let graph = create_dependency_graph(&tasks);
        self.execute_with_graph(tasks, graph).await
    }

    /// Execute tasks with a pre-built dependency graph
    async fn execute_with_graph(
        &mut self,
        tasks: Vec<AgentTask>,
        graph: DependencyGraph,
    ) -> ExecutorResult<ParallelExecutionResult> {
        let start_time = Utc::now();

        // Initialize task tracking
        {
            let mut task_map = self.tasks.lock().await;
            task_map.clear();
            for task in &tasks {
                task_map.insert(task.id.clone(), TaskExecutionInfo::new(task.clone()));
            }
        }

        // Set running state
        {
            *self.running.lock().await = true;
            *self.cancelled.lock().await = false;
        }

        // Track completed and failed tasks
        let completed = Arc::new(Mutex::new(HashSet::<String>::new()));
        let failed = Arc::new(Mutex::new(HashSet::<String>::new()));
        let results = Arc::new(Mutex::new(Vec::<AgentResult>::new()));

        // Sort tasks by priority (higher priority first)
        let mut sorted_tasks = tasks.clone();
        sorted_tasks.sort_by_key(|b| std::cmp::Reverse(b.effective_priority()));

        // Execute tasks
        let execution_result = self
            .execute_tasks_with_deps(
                sorted_tasks,
                graph,
                completed.clone(),
                failed.clone(),
                results.clone(),
            )
            .await;

        // Set running state to false
        *self.running.lock().await = false;

        // Handle execution errors
        if let Err(_e) = execution_result {
            // Still return partial results
            let results_vec = results.lock().await.clone();
            let end_time = Utc::now();
            let duration = (end_time - start_time).to_std().unwrap_or(Duration::ZERO);

            return Ok(ParallelExecutionResult {
                success: false,
                results: results_vec.clone(),
                total_duration: duration,
                successful_count: results_vec.iter().filter(|r| r.success).count(),
                failed_count: results_vec.iter().filter(|r| !r.success).count(),
                skipped_count: 0,
                merged_result: Some(merge_agent_results(results_vec)),
            });
        }

        // Build final result
        let results_vec = results.lock().await.clone();
        let end_time = Utc::now();
        let duration = (end_time - start_time).to_std().unwrap_or(Duration::ZERO);

        let successful_count = results_vec.iter().filter(|r| r.success).count();
        let failed_count = results_vec.iter().filter(|r| !r.success).count();
        let skipped_count = {
            let task_map = self.tasks.lock().await;
            task_map
                .values()
                .filter(|t| t.status == TaskStatus::Skipped)
                .count()
        };

        Ok(ParallelExecutionResult {
            success: failed_count == 0 && skipped_count == 0,
            results: results_vec.clone(),
            total_duration: duration,
            successful_count,
            failed_count,
            skipped_count,
            merged_result: Some(merge_agent_results(results_vec)),
        })
    }

    /// Execute tasks respecting dependencies
    async fn execute_tasks_with_deps(
        &self,
        tasks: Vec<AgentTask>,
        graph: DependencyGraph,
        completed: Arc<Mutex<HashSet<String>>>,
        failed: Arc<Mutex<HashSet<String>>>,
        results: Arc<Mutex<Vec<AgentResult>>>,
    ) -> ExecutorResult<()> {
        let task_map: HashMap<String, AgentTask> =
            tasks.iter().map(|t| (t.id.clone(), t.clone())).collect();
        // Preserve the sorted order from the input tasks
        let pending: Arc<Mutex<VecDeque<String>>> =
            Arc::new(Mutex::new(tasks.iter().map(|t| t.id.clone()).collect()));
        let running: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

        loop {
            // Check if cancelled
            if *self.cancelled.lock().await {
                return Err(ExecutorError::Cancelled);
            }

            // Get ready tasks
            let ready_tasks: Vec<String> = {
                let completed_guard = completed.lock().await;
                let running_guard = running.lock().await;
                let mut pending_guard = pending.lock().await;

                let mut ready = Vec::new();
                let mut still_pending = VecDeque::new();

                while let Some(task_id) = pending_guard.pop_front() {
                    if !graph.has_unmet_dependencies(&task_id, &completed_guard)
                        && !running_guard.contains(&task_id)
                    {
                        // Check if any dependency failed
                        let failed_guard = failed.lock().await;
                        let deps = graph.get_dependencies(&task_id);
                        let has_failed_dep = deps.iter().any(|d| failed_guard.contains(d));
                        drop(failed_guard);

                        if has_failed_dep && self.config.stop_on_first_error {
                            // Skip this task
                            let mut task_info = self.tasks.lock().await;
                            if let Some(info) = task_info.get_mut(&task_id) {
                                info.status = TaskStatus::Skipped;
                            }
                            continue;
                        }

                        ready.push(task_id);
                    } else {
                        still_pending.push_back(task_id);
                    }
                }

                *pending_guard = still_pending;
                ready
            };

            // Check if we're done
            {
                let _completed_guard = completed.lock().await;
                let running_guard = running.lock().await;
                let pending_guard = pending.lock().await;

                if pending_guard.is_empty() && running_guard.is_empty() && ready_tasks.is_empty() {
                    break;
                }

                // If nothing is ready and nothing is running, we might be stuck
                if ready_tasks.is_empty() && running_guard.is_empty() && !pending_guard.is_empty() {
                    // This shouldn't happen if validation passed, but handle it
                    break;
                }
            }

            // Spawn tasks (limited by concurrency)
            // Only spawn up to max_concurrency tasks, put the rest back in pending
            let mut tasks_to_spawn = Vec::new();
            let mut tasks_to_defer = Vec::new();

            for (i, task_id) in ready_tasks.into_iter().enumerate() {
                if i < self.config.max_concurrency {
                    tasks_to_spawn.push(task_id);
                } else {
                    tasks_to_defer.push(task_id);
                }
            }

            // Put deferred tasks back in pending (at the front to maintain priority order)
            {
                let mut pending_guard = pending.lock().await;
                for task_id in tasks_to_defer.into_iter().rev() {
                    pending_guard.push_front(task_id);
                }
            }

            let mut handles = Vec::new();
            for task_id in tasks_to_spawn {
                let task = match task_map.get(&task_id) {
                    Some(t) => t.clone(),
                    None => continue,
                };

                // Mark as running
                {
                    running.lock().await.insert(task_id.clone());
                    let mut task_info = self.tasks.lock().await;
                    if let Some(info) = task_info.get_mut(&task_id) {
                        info.status = TaskStatus::Running;
                        info.started_at = Some(Utc::now());
                    }
                }

                let completed = completed.clone();
                let failed = failed.clone();
                let running = running.clone();
                let results = results.clone();
                let tasks_info = self.tasks.clone();
                let config = self.config.clone();
                let cancelled = self.cancelled.clone();

                let handle = tokio::spawn(async move {
                    // Execute task with retries
                    let result = execute_single_task(&task, &config, &cancelled).await;

                    // Update tracking
                    let task_id = task.id.clone();
                    {
                        let mut task_info = tasks_info.lock().await;
                        if let Some(info) = task_info.get_mut(&task_id) {
                            info.completed_at = Some(Utc::now());
                            if result.success {
                                info.status = TaskStatus::Completed;
                                info.result = result.result.clone();
                            } else {
                                info.status = TaskStatus::Failed;
                                info.last_error = result.error.clone();
                            }
                            info.retries = result.retries;
                        }
                    }

                    // Update completed/failed sets
                    if result.success {
                        completed.lock().await.insert(task_id.clone());
                    } else {
                        failed.lock().await.insert(task_id.clone());
                    }

                    // Remove from running
                    running.lock().await.remove(&task_id);

                    // Add to results
                    results.lock().await.push(result);
                });

                handles.push(handle);
            }

            // Wait for at least one task to complete before checking again
            if !handles.is_empty() {
                // Wait for all spawned tasks in this batch
                for handle in handles {
                    let _ = handle.await;
                }
            } else {
                // Small delay to prevent busy loop
                tokio::time::sleep(Duration::from_millis(10)).await;
            }

            // Check stop_on_first_error
            if self.config.stop_on_first_error {
                let failed_guard = failed.lock().await;
                if !failed_guard.is_empty() {
                    // Cancel remaining tasks
                    *self.cancelled.lock().await = true;
                    break;
                }
            }
        }

        Ok(())
    }

    /// Cancel execution
    pub async fn cancel(&mut self, task_id: Option<&str>) {
        if let Some(id) = task_id {
            // Cancel specific task
            let mut task_info = self.tasks.lock().await;
            if let Some(info) = task_info.get_mut(id) {
                info.status = TaskStatus::Cancelled;
            }
        } else {
            // Cancel all
            *self.cancelled.lock().await = true;
        }
    }

    /// Get current execution progress
    pub async fn get_progress(&self) -> ExecutionProgress {
        let task_info = self.tasks.lock().await;
        let cancelled = *self.cancelled.lock().await;

        let mut completed = 0;
        let mut failed = 0;
        let mut running = 0;
        let mut pending = 0;
        let mut skipped = 0;

        for info in task_info.values() {
            match info.status {
                TaskStatus::Completed => completed += 1,
                TaskStatus::Failed => failed += 1,
                TaskStatus::Running => running += 1,
                TaskStatus::Pending | TaskStatus::WaitingForDependencies => pending += 1,
                TaskStatus::Cancelled | TaskStatus::Skipped => skipped += 1,
            }
        }

        ExecutionProgress {
            total: task_info.len(),
            completed,
            failed,
            running,
            pending,
            skipped,
            cancelled,
        }
    }

    /// Check if execution is currently running
    pub async fn is_running(&self) -> bool {
        *self.running.lock().await
    }

    /// Check if execution has been cancelled
    pub async fn is_cancelled(&self) -> bool {
        *self.cancelled.lock().await
    }
}

/// Execute a single task with retry logic
async fn execute_single_task(
    task: &AgentTask,
    config: &ParallelAgentConfig,
    cancelled: &Arc<Mutex<bool>>,
) -> AgentResult {
    let start_time = Utc::now();
    let task_timeout = task.timeout.unwrap_or(config.timeout);
    let max_retries = if config.retry_on_failure {
        config.max_retries
    } else {
        0
    };

    let mut retries = 0;
    #[allow(unused_assignments)]
    let mut last_error = None;

    loop {
        // Check if cancelled
        if *cancelled.lock().await {
            return AgentResult {
                task_id: task.id.clone(),
                success: false,
                result: None,
                error: Some("Cancelled".to_string()),
                duration: (Utc::now() - start_time).to_std().unwrap_or(Duration::ZERO),
                retries,
                started_at: start_time,
                completed_at: Utc::now(),
            };
        }

        // Execute with timeout
        let execution = timeout(task_timeout, simulate_task_execution(task));

        match execution.await {
            Ok(Ok(result)) => {
                return AgentResult {
                    task_id: task.id.clone(),
                    success: true,
                    result: Some(result),
                    error: None,
                    duration: (Utc::now() - start_time).to_std().unwrap_or(Duration::ZERO),
                    retries,
                    started_at: start_time,
                    completed_at: Utc::now(),
                };
            }
            Ok(Err(e)) => {
                last_error = Some(e.to_string());
            }
            Err(_) => {
                last_error = Some(format!("Task timed out after {:?}", task_timeout));
            }
        }

        // Check if we should retry
        if retries >= max_retries {
            break;
        }

        retries += 1;
        tokio::time::sleep(config.retry_delay).await;
    }

    AgentResult {
        task_id: task.id.clone(),
        success: false,
        result: None,
        error: last_error,
        duration: (Utc::now() - start_time).to_std().unwrap_or(Duration::ZERO),
        retries,
        started_at: start_time,
        completed_at: Utc::now(),
    }
}

/// Simulate task execution (placeholder for actual agent execution)
async fn simulate_task_execution(task: &AgentTask) -> Result<Value, String> {
    // This is a placeholder - in real implementation, this would
    // invoke the actual agent with the task prompt

    // Simulate some work
    tokio::time::sleep(Duration::from_millis(10)).await;

    // Return a simple result
    Ok(serde_json::json!({
        "task_id": task.id,
        "task_type": task.task_type,
        "status": "completed",
        "output": format!("Executed task: {}", task.prompt)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_agent_task_creation() {
        let task = AgentTask::new("task-1", "explore", "Find all Rust files");

        assert_eq!(task.id, "task-1");
        assert_eq!(task.task_type, "explore");
        assert_eq!(task.prompt, "Find all Rust files");
        assert!(task.description.is_none());
        assert!(task.options.is_none());
        assert!(task.priority.is_none());
        assert!(task.dependencies.is_none());
        assert!(task.timeout.is_none());
    }

    #[test]
    fn test_agent_task_builder() {
        let task = AgentTask::new("task-1", "plan", "Create implementation plan")
            .with_description("Detailed planning task")
            .with_priority(5)
            .with_dependencies(vec!["task-0".to_string()])
            .with_timeout(Duration::from_secs(60));

        assert_eq!(task.description, Some("Detailed planning task".to_string()));
        assert_eq!(task.priority, Some(5));
        assert_eq!(task.dependencies, Some(vec!["task-0".to_string()]));
        assert_eq!(task.timeout, Some(Duration::from_secs(60)));
    }

    #[test]
    fn test_task_effective_priority() {
        let task_no_priority = AgentTask::new("t1", "test", "test");
        assert_eq!(task_no_priority.effective_priority(), 0);

        let task_with_priority = AgentTask::new("t2", "test", "test").with_priority(10);
        assert_eq!(task_with_priority.effective_priority(), 10);
    }

    #[test]
    fn test_task_has_dependencies() {
        let task_no_deps = AgentTask::new("t1", "test", "test");
        assert!(!task_no_deps.has_dependencies());

        let task_empty_deps = AgentTask::new("t2", "test", "test").with_dependencies(vec![]);
        assert!(!task_empty_deps.has_dependencies());

        let task_with_deps =
            AgentTask::new("t3", "test", "test").with_dependencies(vec!["t1".to_string()]);
        assert!(task_with_deps.has_dependencies());
    }

    #[test]
    fn test_dependency_graph_creation() {
        let mut graph = DependencyGraph::new();
        graph.add_task("task-1");
        graph.add_task("task-2");
        graph.add_dependency("task-2", "task-1");

        assert!(graph.contains("task-1"));
        assert!(graph.contains("task-2"));
        assert!(!graph.contains("task-3"));

        let deps = graph.get_dependencies("task-2");
        assert!(deps.contains("task-1"));

        let dependents = graph.get_dependents("task-1");
        assert!(dependents.contains("task-2"));
    }

    #[test]
    fn test_dependency_graph_ready_tasks() {
        let mut graph = DependencyGraph::new();
        graph.add_task("task-1");
        graph.add_task("task-2");
        graph.add_task("task-3");
        graph.add_dependency("task-2", "task-1");
        graph.add_dependency("task-3", "task-2");

        let completed = HashSet::new();
        let running = HashSet::new();

        // Only task-1 should be ready initially
        let ready = graph.get_ready_tasks(&completed, &running);
        assert_eq!(ready.len(), 1);
        assert!(ready.contains(&"task-1".to_string()));

        // After task-1 completes, task-2 should be ready
        let mut completed = HashSet::new();
        completed.insert("task-1".to_string());
        let ready = graph.get_ready_tasks(&completed, &running);
        assert_eq!(ready.len(), 1);
        assert!(ready.contains(&"task-2".to_string()));

        // After task-2 completes, task-3 should be ready
        completed.insert("task-2".to_string());
        let ready = graph.get_ready_tasks(&completed, &running);
        assert_eq!(ready.len(), 1);
        assert!(ready.contains(&"task-3".to_string()));
    }

    #[test]
    fn test_create_dependency_graph_from_tasks() {
        let tasks = vec![
            AgentTask::new("task-1", "test", "test"),
            AgentTask::new("task-2", "test", "test").with_dependencies(vec!["task-1".to_string()]),
            AgentTask::new("task-3", "test", "test")
                .with_dependencies(vec!["task-1".to_string(), "task-2".to_string()]),
        ];

        let graph = create_dependency_graph(&tasks);

        assert!(graph.contains("task-1"));
        assert!(graph.contains("task-2"));
        assert!(graph.contains("task-3"));

        assert!(graph.get_dependencies("task-1").is_empty());
        assert_eq!(graph.get_dependencies("task-2").len(), 1);
        assert_eq!(graph.get_dependencies("task-3").len(), 2);
    }

    #[test]
    fn test_validate_valid_dependencies() {
        let tasks = vec![
            AgentTask::new("task-1", "test", "test"),
            AgentTask::new("task-2", "test", "test").with_dependencies(vec!["task-1".to_string()]),
        ];

        let result = validate_task_dependencies(&tasks);
        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_validate_missing_dependency() {
        let tasks = vec![AgentTask::new("task-1", "test", "test")
            .with_dependencies(vec!["non-existent".to_string()])];

        let result = validate_task_dependencies(&tasks);
        assert!(!result.valid);
        assert!(!result.errors.is_empty());
        assert_eq!(result.missing_dependencies.len(), 1);
    }

    #[test]
    fn test_validate_circular_dependency() {
        let tasks = vec![
            AgentTask::new("task-1", "test", "test").with_dependencies(vec!["task-2".to_string()]),
            AgentTask::new("task-2", "test", "test").with_dependencies(vec!["task-1".to_string()]),
        ];

        let result = validate_task_dependencies(&tasks);
        assert!(!result.valid);
        assert!(result.circular_dependencies.is_some());
    }

    #[test]
    fn test_validate_self_dependency() {
        let tasks =
            vec![AgentTask::new("task-1", "test", "test")
                .with_dependencies(vec!["task-1".to_string()])];

        let result = validate_task_dependencies(&tasks);
        assert!(!result.valid);
        assert!(result.circular_dependencies.is_some());
    }

    #[test]
    fn test_merge_agent_results() {
        let results = vec![
            AgentResult {
                task_id: "task-1".to_string(),
                success: true,
                result: Some(json!({"output": "result1"})),
                error: None,
                duration: Duration::from_secs(1),
                retries: 0,
                started_at: Utc::now(),
                completed_at: Utc::now(),
            },
            AgentResult {
                task_id: "task-2".to_string(),
                success: true,
                result: Some(json!({"output": "result2"})),
                error: None,
                duration: Duration::from_secs(2),
                retries: 0,
                started_at: Utc::now(),
                completed_at: Utc::now(),
            },
            AgentResult {
                task_id: "task-3".to_string(),
                success: false,
                result: None,
                error: Some("Failed".to_string()),
                duration: Duration::from_secs(1),
                retries: 3,
                started_at: Utc::now(),
                completed_at: Utc::now(),
            },
        ];

        let merged = merge_agent_results(results);

        assert_eq!(merged.outputs.len(), 2); // Only successful results
        assert!(merged.summary.is_some());
        assert_eq!(merged.metadata.get("total_tasks"), Some(&json!(3)));
        assert_eq!(merged.metadata.get("successful_tasks"), Some(&json!(2)));
        assert_eq!(merged.metadata.get("failed_tasks"), Some(&json!(1)));
    }

    #[test]
    fn test_parallel_config_default() {
        let config = ParallelAgentConfig::default();

        assert_eq!(config.max_concurrency, 4);
        assert_eq!(config.timeout, Duration::from_secs(300));
        assert!(config.retry_on_failure);
        assert!(!config.stop_on_first_error);
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.retry_delay, Duration::from_secs(1));
    }

    #[tokio::test]
    async fn test_executor_creation() {
        let executor = ParallelAgentExecutor::new(None);
        assert!(!executor.is_running().await);
        assert!(!executor.is_cancelled().await);
    }

    #[tokio::test]
    async fn test_executor_simple_execution() {
        let mut executor = ParallelAgentExecutor::new(Some(ParallelAgentConfig {
            max_concurrency: 2,
            timeout: Duration::from_secs(10),
            retry_on_failure: false,
            stop_on_first_error: false,
            max_retries: 0,
            retry_delay: Duration::from_millis(100),
        }));

        let tasks = vec![
            AgentTask::new("task-1", "test", "Test task 1"),
            AgentTask::new("task-2", "test", "Test task 2"),
        ];

        let result = executor.execute(tasks).await.unwrap();

        assert!(result.success);
        assert_eq!(result.results.len(), 2);
        assert_eq!(result.successful_count, 2);
        assert_eq!(result.failed_count, 0);
    }

    #[tokio::test]
    async fn test_executor_with_dependencies() {
        let mut executor = ParallelAgentExecutor::new(Some(ParallelAgentConfig {
            max_concurrency: 2,
            timeout: Duration::from_secs(10),
            retry_on_failure: false,
            stop_on_first_error: false,
            max_retries: 0,
            retry_delay: Duration::from_millis(100),
        }));

        let tasks = vec![
            AgentTask::new("task-1", "test", "First task"),
            AgentTask::new("task-2", "test", "Second task")
                .with_dependencies(vec!["task-1".to_string()]),
            AgentTask::new("task-3", "test", "Third task")
                .with_dependencies(vec!["task-2".to_string()]),
        ];

        let result = executor.execute_with_dependencies(tasks).await.unwrap();

        assert!(result.success);
        assert_eq!(result.results.len(), 3);
        assert_eq!(result.successful_count, 3);
    }

    #[tokio::test]
    async fn test_executor_circular_dependency_error() {
        let mut executor = ParallelAgentExecutor::new(None);

        let tasks = vec![
            AgentTask::new("task-1", "test", "test").with_dependencies(vec!["task-2".to_string()]),
            AgentTask::new("task-2", "test", "test").with_dependencies(vec!["task-1".to_string()]),
        ];

        let result = executor.execute_with_dependencies(tasks).await;

        assert!(matches!(result, Err(ExecutorError::CircularDependency(_))));
    }

    #[tokio::test]
    async fn test_executor_invalid_dependency_error() {
        let mut executor = ParallelAgentExecutor::new(None);

        let tasks = vec![AgentTask::new("task-1", "test", "test")
            .with_dependencies(vec!["non-existent".to_string()])];

        let result = executor.execute_with_dependencies(tasks).await;

        assert!(matches!(
            result,
            Err(ExecutorError::InvalidDependency { .. })
        ));
    }

    #[tokio::test]
    async fn test_executor_progress() {
        let executor = ParallelAgentExecutor::new(None);

        let progress = executor.get_progress().await;

        assert_eq!(progress.total, 0);
        assert_eq!(progress.completed, 0);
        assert_eq!(progress.failed, 0);
        assert_eq!(progress.running, 0);
        assert_eq!(progress.pending, 0);
        assert!(!progress.cancelled);
    }

    #[tokio::test]
    async fn test_executor_concurrency_limit() {
        let mut executor = ParallelAgentExecutor::new(Some(ParallelAgentConfig {
            max_concurrency: 1, // Only 1 at a time
            timeout: Duration::from_secs(10),
            retry_on_failure: false,
            stop_on_first_error: false,
            max_retries: 0,
            retry_delay: Duration::from_millis(100),
        }));

        let tasks = vec![
            AgentTask::new("task-1", "test", "Test 1"),
            AgentTask::new("task-2", "test", "Test 2"),
            AgentTask::new("task-3", "test", "Test 3"),
        ];

        let result = executor.execute(tasks).await.unwrap();

        assert!(result.success);
        assert_eq!(result.results.len(), 3);
    }

    #[tokio::test]
    async fn test_executor_priority_ordering() {
        let mut executor = ParallelAgentExecutor::new(Some(ParallelAgentConfig {
            max_concurrency: 1, // Execute one at a time to verify order
            timeout: Duration::from_secs(10),
            retry_on_failure: false,
            stop_on_first_error: false,
            max_retries: 0,
            retry_delay: Duration::from_millis(100),
        }));

        let tasks = vec![
            AgentTask::new("low", "test", "Low priority").with_priority(1),
            AgentTask::new("high", "test", "High priority").with_priority(10),
            AgentTask::new("medium", "test", "Medium priority").with_priority(5),
        ];

        let result = executor.execute(tasks).await.unwrap();

        assert!(result.success);
        // Tasks should complete in priority order: high (10), medium (5), low (1)
        assert_eq!(result.results[0].task_id, "high");
        assert_eq!(result.results[1].task_id, "medium");
        assert_eq!(result.results[2].task_id, "low");
    }
}
