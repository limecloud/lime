//! Agent Coordinator
//!
//! Coordinates multiple agents with task assignment,
//! load balancing, and deadlock detection.
//!
//! **Feature: agents-alignment**

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use thiserror::Error;
use uuid::Uuid;

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during agent coordination
#[derive(Debug, Error, Clone, PartialEq)]
pub enum CoordinatorError {
    #[error("Agent not found: {0}")]
    AgentNotFound(String),

    #[error("No suitable agent available for task")]
    NoSuitableAgent,

    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Task timeout: {0}")]
    TaskTimeout(String),

    #[error("Synchronization timeout")]
    SyncTimeout,

    #[error("Deadlock detected")]
    DeadlockDetected,

    #[error("Agent already registered: {0}")]
    AgentAlreadyRegistered(String),

    #[error("Invalid task state: {0}")]
    InvalidTaskState(String),
}

pub type CoordinatorResult<T> = Result<T, CoordinatorError>;

// ============================================================================
// Types
// ============================================================================

/// Agent status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum AgentStatus {
    #[default]
    Idle,
    Busy,
    Offline,
}

/// Agent capabilities and state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCapabilities {
    /// Agent ID
    pub agent_id: String,
    /// Agent type (e.g., "explore", "plan", "code")
    pub agent_type: String,
    /// List of capabilities
    pub capabilities: Vec<String>,
    /// Current load (0.0 - 1.0)
    pub current_load: f64,
    /// Maximum concurrent tasks
    pub max_concurrent_tasks: usize,
    /// Current number of tasks
    pub current_tasks: usize,
    /// Agent status
    pub status: AgentStatus,
    /// Last heartbeat time
    pub last_heartbeat: DateTime<Utc>,
}

impl AgentCapabilities {
    pub fn new(agent_id: impl Into<String>, agent_type: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            agent_type: agent_type.into(),
            capabilities: Vec::new(),
            current_load: 0.0,
            max_concurrent_tasks: 1,
            current_tasks: 0,
            status: AgentStatus::Idle,
            last_heartbeat: Utc::now(),
        }
    }

    pub fn with_capabilities(mut self, capabilities: Vec<String>) -> Self {
        self.capabilities = capabilities;
        self
    }

    pub fn with_max_concurrent_tasks(mut self, max: usize) -> Self {
        self.max_concurrent_tasks = max;
        self
    }

    /// Check if agent has a specific capability
    pub fn has_capability(&self, capability: &str) -> bool {
        self.capabilities.iter().any(|c| c == capability)
    }

    /// Check if agent has all required capabilities
    pub fn has_all_capabilities(&self, required: &[String]) -> bool {
        required.iter().all(|r| self.has_capability(r))
    }

    /// Check if agent can accept more tasks
    pub fn can_accept_task(&self) -> bool {
        self.status != AgentStatus::Offline && self.current_tasks < self.max_concurrent_tasks
    }

    /// Update load based on current tasks
    pub fn update_load(&mut self) {
        self.current_load = if self.max_concurrent_tasks > 0 {
            self.current_tasks as f64 / self.max_concurrent_tasks as f64
        } else {
            1.0
        };

        self.status = if self.current_tasks == 0 {
            AgentStatus::Idle
        } else {
            AgentStatus::Busy
        };
    }
}

/// Load balancing strategy
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum LoadBalanceStrategy {
    /// Select agent with lowest load
    #[default]
    LeastBusy,
    /// Round-robin selection
    RoundRobin,
    /// Random selection
    Random,
    /// Select agent with best capability match
    CapabilityMatch,
}

/// Task assignment criteria
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AssignmentCriteria {
    /// Required agent type
    pub required_agent_type: Option<String>,
    /// Required capabilities
    pub required_capabilities: Vec<String>,
    /// Load balancing strategy
    pub load_balance_strategy: LoadBalanceStrategy,
    /// Task priority (0-10)
    pub priority: u8,
    /// Timeout in milliseconds
    pub timeout_ms: Option<u64>,
}

impl AssignmentCriteria {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_agent_type(mut self, agent_type: impl Into<String>) -> Self {
        self.required_agent_type = Some(agent_type.into());
        self
    }

    pub fn with_capabilities(mut self, capabilities: Vec<String>) -> Self {
        self.required_capabilities = capabilities;
        self
    }

    pub fn with_strategy(mut self, strategy: LoadBalanceStrategy) -> Self {
        self.load_balance_strategy = strategy;
        self
    }

    pub fn with_priority(mut self, priority: u8) -> Self {
        self.priority = priority.min(10);
        self
    }

    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }
}

/// Task definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Task ID
    pub id: String,
    /// Task type
    pub task_type: String,
    /// Task data
    pub data: Value,
    /// Priority (0-10)
    pub priority: u8,
    /// Created time
    pub created_at: DateTime<Utc>,
    /// Timeout in milliseconds
    pub timeout_ms: Option<u64>,
}

impl Task {
    pub fn new(task_type: impl Into<String>, data: Value) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            task_type: task_type.into(),
            data,
            priority: 5,
            created_at: Utc::now(),
            timeout_ms: None,
        }
    }

    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = id.into();
        self
    }

    pub fn with_priority(mut self, priority: u8) -> Self {
        self.priority = priority.min(10);
        self
    }

    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }
}

/// Task status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    Pending,
    Assigned,
    Running,
    Completed,
    Failed,
    Timeout,
}

/// Task result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    /// Task ID
    pub task_id: String,
    /// Executing agent ID
    pub agent_id: String,
    /// Whether successful
    pub success: bool,
    /// Result data
    pub result: Option<Value>,
    /// Error message
    pub error: Option<String>,
    /// Start time
    pub start_time: DateTime<Utc>,
    /// End time
    pub end_time: DateTime<Utc>,
    /// Duration in milliseconds
    pub duration_ms: i64,
}

/// Task assignment record
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct TaskAssignment {
    task: Task,
    agent_id: String,
    status: TaskStatus,
    assigned_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    result: Option<TaskResult>,
}

/// Deadlock information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeadlockInfo {
    /// Detection time
    pub detected_at: DateTime<Utc>,
    /// Involved agents
    pub involved_agents: Vec<String>,
    /// Involved resources
    pub involved_resources: Vec<String>,
    /// Dependency chain
    pub dependency_chain: Vec<DependencyLink>,
}

/// A link in the dependency chain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyLink {
    /// Agent waiting
    pub agent: String,
    /// Agent being waited for
    pub waiting_for: String,
    /// Resource being waited for
    pub resource: String,
}

/// Synchronization barrier
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct SyncBarrier {
    id: String,
    agent_ids: HashSet<String>,
    arrived: HashSet<String>,
    created_at: DateTime<Utc>,
}

/// Coordinator statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CoordinatorStats {
    pub total_agents: usize,
    pub active_agents: usize,
    pub offline_agents: usize,
    pub total_tasks: usize,
    pub pending_tasks: usize,
    pub running_tasks: usize,
    pub completed_tasks: usize,
    pub failed_tasks: usize,
    pub average_load: f64,
}

/// Coordinator event
#[derive(Debug, Clone)]
pub enum CoordinatorEvent {
    AgentRegistered(AgentCapabilities),
    AgentUnregistered {
        agent_id: String,
    },
    AgentStatusChanged {
        agent_id: String,
        status: AgentStatus,
    },
    AgentOffline {
        agent_id: String,
    },
    TaskAssigned {
        task_id: String,
        agent_id: String,
    },
    TaskStarted {
        task_id: String,
        agent_id: String,
    },
    TaskCompleted(TaskResult),
    TaskFailed {
        task_id: String,
        error: String,
    },
    DeadlockDetected(DeadlockInfo),
    SyncBarrierReached {
        barrier_id: String,
    },
}

// ============================================================================
// Agent Coordinator
// ============================================================================

/// Type alias for event callback functions
type EventCallback = Box<dyn Fn(&CoordinatorEvent) + Send + Sync>;

/// Agent Coordinator
///
/// Coordinates multiple agents with task assignment,
/// load balancing, and deadlock detection.
pub struct AgentCoordinator {
    /// Registered agents
    agents: HashMap<String, AgentCapabilities>,
    /// Task assignments (task_id -> assignment)
    task_assignments: HashMap<String, TaskAssignment>,
    /// Resource dependencies (agent_id -> resources waiting for)
    resource_dependencies: HashMap<String, HashSet<String>>,
    /// Resource holders (resource -> agent_id holding it)
    resource_holders: HashMap<String, String>,
    /// Synchronization barriers
    sync_barriers: HashMap<String, SyncBarrier>,
    /// Round-robin index for load balancing
    round_robin_index: usize,
    /// Event callbacks
    event_callbacks: Vec<EventCallback>,
    /// Heartbeat timeout in seconds
    heartbeat_timeout_secs: i64,
}

impl Default for AgentCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentCoordinator {
    /// Create a new coordinator
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
            task_assignments: HashMap::new(),
            resource_dependencies: HashMap::new(),
            resource_holders: HashMap::new(),
            sync_barriers: HashMap::new(),
            round_robin_index: 0,
            event_callbacks: Vec::new(),
            heartbeat_timeout_secs: 15,
        }
    }

    /// Set heartbeat timeout
    pub fn with_heartbeat_timeout(mut self, secs: i64) -> Self {
        self.heartbeat_timeout_secs = secs;
        self
    }

    // ========================================================================
    // Agent Management
    // ========================================================================

    /// Register an agent
    pub fn register_agent(&mut self, capabilities: AgentCapabilities) -> CoordinatorResult<()> {
        if self.agents.contains_key(&capabilities.agent_id) {
            return Err(CoordinatorError::AgentAlreadyRegistered(
                capabilities.agent_id.clone(),
            ));
        }

        let agent_id = capabilities.agent_id.clone();
        self.agents.insert(agent_id.clone(), capabilities.clone());
        self.emit_event(CoordinatorEvent::AgentRegistered(capabilities));

        Ok(())
    }

    /// Unregister an agent
    pub fn unregister_agent(&mut self, agent_id: &str) -> CoordinatorResult<()> {
        if self.agents.remove(agent_id).is_none() {
            return Err(CoordinatorError::AgentNotFound(agent_id.to_string()));
        }

        // Clean up resource dependencies
        self.resource_dependencies.remove(agent_id);

        // Clean up resource holders
        self.resource_holders.retain(|_, holder| holder != agent_id);

        self.emit_event(CoordinatorEvent::AgentUnregistered {
            agent_id: agent_id.to_string(),
        });

        Ok(())
    }

    /// Update agent status
    pub fn update_agent_status(
        &mut self,
        agent_id: &str,
        status: AgentStatus,
    ) -> CoordinatorResult<()> {
        let agent = self
            .agents
            .get_mut(agent_id)
            .ok_or_else(|| CoordinatorError::AgentNotFound(agent_id.to_string()))?;

        agent.status = status;
        agent.last_heartbeat = Utc::now();

        self.emit_event(CoordinatorEvent::AgentStatusChanged {
            agent_id: agent_id.to_string(),
            status,
        });

        Ok(())
    }

    /// Update agent heartbeat
    pub fn heartbeat(&mut self, agent_id: &str) -> CoordinatorResult<()> {
        let agent = self
            .agents
            .get_mut(agent_id)
            .ok_or_else(|| CoordinatorError::AgentNotFound(agent_id.to_string()))?;

        agent.last_heartbeat = Utc::now();

        // If agent was offline, bring it back
        if agent.status == AgentStatus::Offline {
            agent.status = if agent.current_tasks == 0 {
                AgentStatus::Idle
            } else {
                AgentStatus::Busy
            };
        }

        Ok(())
    }

    /// Get agent by ID
    pub fn get_agent(&self, agent_id: &str) -> Option<&AgentCapabilities> {
        self.agents.get(agent_id)
    }

    /// Get mutable agent by ID
    pub fn get_agent_mut(&mut self, agent_id: &str) -> Option<&mut AgentCapabilities> {
        self.agents.get_mut(agent_id)
    }

    /// Get all agents
    pub fn get_agents(&self) -> Vec<&AgentCapabilities> {
        self.agents.values().collect()
    }

    /// Get agents by type
    pub fn get_agents_by_type(&self, agent_type: &str) -> Vec<&AgentCapabilities> {
        self.agents
            .values()
            .filter(|a| a.agent_type == agent_type)
            .collect()
    }

    /// Get agents with capability
    pub fn get_agents_with_capability(&self, capability: &str) -> Vec<&AgentCapabilities> {
        self.agents
            .values()
            .filter(|a| a.has_capability(capability))
            .collect()
    }

    /// Check agent health and mark offline if heartbeat timeout
    pub fn check_agent_health(&mut self) {
        let now = Utc::now();
        let timeout = Duration::seconds(self.heartbeat_timeout_secs);

        let offline_agents: Vec<String> = self
            .agents
            .iter()
            .filter(|(_, agent)| {
                agent.status != AgentStatus::Offline
                    && now.signed_duration_since(agent.last_heartbeat) > timeout
            })
            .map(|(id, _)| id.clone())
            .collect();

        for agent_id in offline_agents {
            if let Some(agent) = self.agents.get_mut(&agent_id) {
                agent.status = AgentStatus::Offline;
                self.emit_event(CoordinatorEvent::AgentOffline {
                    agent_id: agent_id.clone(),
                });
            }
        }
    }

    // ========================================================================
    // Task Assignment
    // ========================================================================

    /// Assign a task to an agent based on criteria
    pub fn assign_task(
        &mut self,
        task: Task,
        criteria: &AssignmentCriteria,
    ) -> CoordinatorResult<String> {
        // Select an agent
        let agent_id = self.select_agent(criteria)?;

        // Update agent load
        if let Some(agent) = self.agents.get_mut(&agent_id) {
            agent.current_tasks += 1;
            agent.update_load();
        }

        // Create assignment
        let assignment = TaskAssignment {
            task: task.clone(),
            agent_id: agent_id.clone(),
            status: TaskStatus::Assigned,
            assigned_at: Utc::now(),
            started_at: None,
            result: None,
        };

        self.task_assignments.insert(task.id.clone(), assignment);

        self.emit_event(CoordinatorEvent::TaskAssigned {
            task_id: task.id.clone(),
            agent_id: agent_id.clone(),
        });

        Ok(agent_id)
    }

    /// Select an agent based on criteria
    fn select_agent(&mut self, criteria: &AssignmentCriteria) -> CoordinatorResult<String> {
        // Filter candidates
        let mut candidates: Vec<&AgentCapabilities> = self
            .agents
            .values()
            .filter(|agent| agent.can_accept_task())
            .collect();

        // Filter by agent type
        if let Some(ref agent_type) = criteria.required_agent_type {
            candidates.retain(|agent| &agent.agent_type == agent_type);
        }

        // Filter by capabilities
        if !criteria.required_capabilities.is_empty() {
            candidates.retain(|agent| agent.has_all_capabilities(&criteria.required_capabilities));
        }

        if candidates.is_empty() {
            return Err(CoordinatorError::NoSuitableAgent);
        }

        // Apply load balancing strategy
        let selected = match criteria.load_balance_strategy {
            LoadBalanceStrategy::LeastBusy => {
                candidates.sort_by(|a, b| {
                    a.current_load
                        .partial_cmp(&b.current_load)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                candidates[0]
            }
            LoadBalanceStrategy::RoundRobin => {
                self.round_robin_index = (self.round_robin_index + 1) % candidates.len();
                candidates[self.round_robin_index]
            }
            LoadBalanceStrategy::Random => {
                use std::collections::hash_map::DefaultHasher;
                use std::hash::{Hash, Hasher};

                let mut hasher = DefaultHasher::new();
                Utc::now().timestamp_nanos_opt().hash(&mut hasher);
                let index = (hasher.finish() as usize) % candidates.len();
                candidates[index]
            }
            LoadBalanceStrategy::CapabilityMatch => {
                // Sort by number of matching capabilities (descending)
                let required = &criteria.required_capabilities;
                candidates.sort_by(|a, b| {
                    let a_match = a
                        .capabilities
                        .iter()
                        .filter(|c| required.contains(c))
                        .count();
                    let b_match = b
                        .capabilities
                        .iter()
                        .filter(|c| required.contains(c))
                        .count();
                    b_match.cmp(&a_match)
                });
                candidates[0]
            }
        };

        Ok(selected.agent_id.clone())
    }

    /// Mark a task as started
    pub fn start_task(&mut self, task_id: &str) -> CoordinatorResult<()> {
        let assignment = self
            .task_assignments
            .get_mut(task_id)
            .ok_or_else(|| CoordinatorError::TaskNotFound(task_id.to_string()))?;

        if assignment.status != TaskStatus::Assigned {
            return Err(CoordinatorError::InvalidTaskState(format!(
                "Task {} is not in Assigned state",
                task_id
            )));
        }

        assignment.status = TaskStatus::Running;
        assignment.started_at = Some(Utc::now());

        // Clone agent_id before emitting event to avoid borrow issues
        let agent_id = assignment.agent_id.clone();

        self.emit_event(CoordinatorEvent::TaskStarted {
            task_id: task_id.to_string(),
            agent_id,
        });

        Ok(())
    }

    /// Complete a task
    pub fn complete_task(&mut self, task_id: &str, result: TaskResult) -> CoordinatorResult<()> {
        let assignment = self
            .task_assignments
            .get_mut(task_id)
            .ok_or_else(|| CoordinatorError::TaskNotFound(task_id.to_string()))?;

        // Update agent load
        if let Some(agent) = self.agents.get_mut(&assignment.agent_id) {
            agent.current_tasks = agent.current_tasks.saturating_sub(1);
            agent.update_load();
        }

        assignment.status = if result.success {
            TaskStatus::Completed
        } else {
            TaskStatus::Failed
        };
        assignment.result = Some(result.clone());

        self.emit_event(CoordinatorEvent::TaskCompleted(result));

        Ok(())
    }

    /// Fail a task
    pub fn fail_task(&mut self, task_id: &str, error: String) -> CoordinatorResult<()> {
        let assignment = self
            .task_assignments
            .get_mut(task_id)
            .ok_or_else(|| CoordinatorError::TaskNotFound(task_id.to_string()))?;

        // Update agent load
        if let Some(agent) = self.agents.get_mut(&assignment.agent_id) {
            agent.current_tasks = agent.current_tasks.saturating_sub(1);
            agent.update_load();
        }

        assignment.status = TaskStatus::Failed;

        self.emit_event(CoordinatorEvent::TaskFailed {
            task_id: task_id.to_string(),
            error,
        });

        Ok(())
    }

    /// Get task assignment
    pub fn get_task(&self, task_id: &str) -> Option<(&Task, TaskStatus)> {
        self.task_assignments
            .get(task_id)
            .map(|a| (&a.task, a.status))
    }

    /// Get task result
    pub fn get_task_result(&self, task_id: &str) -> Option<&TaskResult> {
        self.task_assignments
            .get(task_id)
            .and_then(|a| a.result.as_ref())
    }

    /// Get tasks assigned to an agent
    pub fn get_agent_tasks(&self, agent_id: &str) -> Vec<&Task> {
        self.task_assignments
            .values()
            .filter(|a| a.agent_id == agent_id)
            .map(|a| &a.task)
            .collect()
    }

    /// Get pending tasks
    pub fn get_pending_tasks(&self) -> Vec<&Task> {
        self.task_assignments
            .values()
            .filter(|a| a.status == TaskStatus::Pending || a.status == TaskStatus::Assigned)
            .map(|a| &a.task)
            .collect()
    }

    /// Get running tasks
    pub fn get_running_tasks(&self) -> Vec<&Task> {
        self.task_assignments
            .values()
            .filter(|a| a.status == TaskStatus::Running)
            .map(|a| &a.task)
            .collect()
    }

    // ========================================================================
    // Resource Dependencies and Deadlock Detection
    // ========================================================================

    /// Record that an agent is waiting for a resource
    pub fn record_resource_dependency(&mut self, agent_id: &str, resource: &str) {
        self.resource_dependencies
            .entry(agent_id.to_string())
            .or_default()
            .insert(resource.to_string());
    }

    /// Remove a resource dependency
    pub fn remove_resource_dependency(&mut self, agent_id: &str, resource: &str) {
        if let Some(resources) = self.resource_dependencies.get_mut(agent_id) {
            resources.remove(resource);
            if resources.is_empty() {
                self.resource_dependencies.remove(agent_id);
            }
        }
    }

    /// Record that an agent holds a resource
    pub fn record_resource_holder(&mut self, resource: &str, agent_id: &str) {
        self.resource_holders
            .insert(resource.to_string(), agent_id.to_string());
    }

    /// Remove a resource holder
    pub fn remove_resource_holder(&mut self, resource: &str) {
        self.resource_holders.remove(resource);
    }

    /// Detect deadlock using cycle detection in the wait-for graph
    pub fn detect_deadlock(&self) -> Option<DeadlockInfo> {
        // Build wait-for graph: agent -> agents it's waiting for
        let mut wait_for_graph: HashMap<String, HashSet<String>> = HashMap::new();

        for (agent_id, resources) in &self.resource_dependencies {
            let mut waiting_for = HashSet::new();

            for resource in resources {
                if let Some(holder) = self.resource_holders.get(resource) {
                    if holder != agent_id {
                        waiting_for.insert(holder.clone());
                    }
                }
            }

            if !waiting_for.is_empty() {
                wait_for_graph.insert(agent_id.clone(), waiting_for);
            }
        }

        // Detect cycle using DFS
        if let Some(cycle) = self.detect_cycle(&wait_for_graph) {
            // Build deadlock info
            let mut involved_resources = HashSet::new();
            let mut dependency_chain = Vec::new();

            for i in 0..cycle.len() {
                let agent = &cycle[i];
                let next_agent = &cycle[(i + 1) % cycle.len()];

                // Find the resource this agent is waiting for from next_agent
                if let Some(resources) = self.resource_dependencies.get(agent) {
                    for resource in resources {
                        if let Some(holder) = self.resource_holders.get(resource) {
                            if holder == next_agent {
                                involved_resources.insert(resource.clone());
                                dependency_chain.push(DependencyLink {
                                    agent: agent.clone(),
                                    waiting_for: next_agent.clone(),
                                    resource: resource.clone(),
                                });
                                break;
                            }
                        }
                    }
                }
            }

            let deadlock_info = DeadlockInfo {
                detected_at: Utc::now(),
                involved_agents: cycle,
                involved_resources: involved_resources.into_iter().collect(),
                dependency_chain,
            };

            return Some(deadlock_info);
        }

        None
    }

    /// Detect cycle in the wait-for graph using DFS
    fn detect_cycle(&self, graph: &HashMap<String, HashSet<String>>) -> Option<Vec<String>> {
        let mut visited = HashSet::new();
        let mut rec_stack = HashSet::new();
        let mut path = Vec::new();

        for node in graph.keys() {
            if !visited.contains(node) {
                if let Some(cycle) =
                    self.dfs_cycle(node, graph, &mut visited, &mut rec_stack, &mut path)
                {
                    return Some(cycle);
                }
            }
        }

        None
    }

    /// DFS helper for cycle detection
    fn dfs_cycle(
        &self,
        node: &str,
        graph: &HashMap<String, HashSet<String>>,
        visited: &mut HashSet<String>,
        rec_stack: &mut HashSet<String>,
        path: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        visited.insert(node.to_string());
        rec_stack.insert(node.to_string());
        path.push(node.to_string());

        if let Some(neighbors) = graph.get(node) {
            for neighbor in neighbors {
                if !visited.contains(neighbor) {
                    if let Some(cycle) = self.dfs_cycle(neighbor, graph, visited, rec_stack, path) {
                        return Some(cycle);
                    }
                } else if rec_stack.contains(neighbor) {
                    // Found a cycle - extract it from path
                    let cycle_start = path.iter().position(|n| n == neighbor).unwrap();
                    return Some(path[cycle_start..].to_vec());
                }
            }
        }

        rec_stack.remove(node);
        path.pop();
        None
    }

    // ========================================================================
    // Synchronization
    // ========================================================================

    /// Create a synchronization barrier for agents
    pub fn create_sync_barrier(&mut self, agent_ids: Vec<String>) -> String {
        let barrier_id = Uuid::new_v4().to_string();
        let barrier = SyncBarrier {
            id: barrier_id.clone(),
            agent_ids: agent_ids.into_iter().collect(),
            arrived: HashSet::new(),
            created_at: Utc::now(),
        };
        self.sync_barriers.insert(barrier_id.clone(), barrier);
        barrier_id
    }

    /// Agent arrives at a barrier
    pub fn arrive_at_barrier(
        &mut self,
        barrier_id: &str,
        agent_id: &str,
    ) -> CoordinatorResult<bool> {
        let barrier = self
            .sync_barriers
            .get_mut(barrier_id)
            .ok_or_else(|| CoordinatorError::TaskNotFound(format!("Barrier {}", barrier_id)))?;

        if !barrier.agent_ids.contains(agent_id) {
            return Err(CoordinatorError::AgentNotFound(agent_id.to_string()));
        }

        barrier.arrived.insert(agent_id.to_string());

        // Check if all agents have arrived
        let all_arrived = barrier.arrived.len() == barrier.agent_ids.len();

        if all_arrived {
            self.emit_event(CoordinatorEvent::SyncBarrierReached {
                barrier_id: barrier_id.to_string(),
            });
        }

        Ok(all_arrived)
    }

    /// Check if all agents have arrived at a barrier
    pub fn is_barrier_reached(&self, barrier_id: &str) -> bool {
        self.sync_barriers
            .get(barrier_id)
            .map(|b| b.arrived.len() == b.agent_ids.len())
            .unwrap_or(false)
    }

    /// Remove a barrier
    pub fn remove_barrier(&mut self, barrier_id: &str) {
        self.sync_barriers.remove(barrier_id);
    }

    /// Get agents that haven't arrived at a barrier
    pub fn get_pending_agents(&self, barrier_id: &str) -> Vec<String> {
        self.sync_barriers
            .get(barrier_id)
            .map(|b| b.agent_ids.difference(&b.arrived).cloned().collect())
            .unwrap_or_default()
    }

    // ========================================================================
    // Statistics and Events
    // ========================================================================

    /// Get coordinator statistics
    pub fn get_stats(&self) -> CoordinatorStats {
        let agents: Vec<&AgentCapabilities> = self.agents.values().collect();
        let active_agents = agents
            .iter()
            .filter(|a| a.status != AgentStatus::Offline)
            .count();
        let offline_agents = agents.len() - active_agents;

        let total_load: f64 = agents.iter().map(|a| a.current_load).sum();
        let average_load = if agents.is_empty() {
            0.0
        } else {
            total_load / agents.len() as f64
        };

        let mut pending_tasks = 0;
        let mut running_tasks = 0;
        let mut completed_tasks = 0;
        let mut failed_tasks = 0;

        for assignment in self.task_assignments.values() {
            match assignment.status {
                TaskStatus::Pending | TaskStatus::Assigned => pending_tasks += 1,
                TaskStatus::Running => running_tasks += 1,
                TaskStatus::Completed => completed_tasks += 1,
                TaskStatus::Failed | TaskStatus::Timeout => failed_tasks += 1,
            }
        }

        CoordinatorStats {
            total_agents: agents.len(),
            active_agents,
            offline_agents,
            total_tasks: self.task_assignments.len(),
            pending_tasks,
            running_tasks,
            completed_tasks,
            failed_tasks,
            average_load,
        }
    }

    /// Register an event callback
    pub fn on_event<F>(&mut self, callback: F)
    where
        F: Fn(&CoordinatorEvent) + Send + Sync + 'static,
    {
        self.event_callbacks.push(Box::new(callback));
    }

    /// Emit an event to all callbacks
    fn emit_event(&self, event: CoordinatorEvent) {
        for callback in &self.event_callbacks {
            callback(&event);
        }
    }

    /// Clear all event callbacks
    pub fn clear_event_callbacks(&mut self) {
        self.event_callbacks.clear();
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_agent_registration() {
        let mut coordinator = AgentCoordinator::new();

        let agent = AgentCapabilities::new("agent1", "explore")
            .with_capabilities(vec!["search".to_string(), "read".to_string()]);

        coordinator.register_agent(agent.clone()).unwrap();

        assert!(coordinator.get_agent("agent1").is_some());
        assert_eq!(coordinator.get_agents().len(), 1);

        // Duplicate registration should fail
        assert!(coordinator.register_agent(agent).is_err());
    }

    #[test]
    fn test_agent_unregistration() {
        let mut coordinator = AgentCoordinator::new();

        let agent = AgentCapabilities::new("agent1", "explore");
        coordinator.register_agent(agent).unwrap();

        coordinator.unregister_agent("agent1").unwrap();
        assert!(coordinator.get_agent("agent1").is_none());

        // Unregistering non-existent agent should fail
        assert!(coordinator.unregister_agent("agent1").is_err());
    }

    #[test]
    fn test_task_assignment_least_busy() {
        let mut coordinator = AgentCoordinator::new();

        // Register two agents with different loads
        let mut agent1 = AgentCapabilities::new("agent1", "worker").with_max_concurrent_tasks(10);
        agent1.current_tasks = 5;
        agent1.update_load();

        let agent2 = AgentCapabilities::new("agent2", "worker").with_max_concurrent_tasks(10);

        coordinator.register_agent(agent1).unwrap();
        coordinator.register_agent(agent2).unwrap();

        let task = Task::new("test", json!({}));
        let criteria = AssignmentCriteria::new().with_strategy(LoadBalanceStrategy::LeastBusy);

        let assigned_agent = coordinator.assign_task(task, &criteria).unwrap();

        // Should assign to agent2 (less busy)
        assert_eq!(assigned_agent, "agent2");
    }

    #[test]
    fn test_task_assignment_by_type() {
        let mut coordinator = AgentCoordinator::new();

        let agent1 = AgentCapabilities::new("agent1", "explore");
        let agent2 = AgentCapabilities::new("agent2", "plan");

        coordinator.register_agent(agent1).unwrap();
        coordinator.register_agent(agent2).unwrap();

        let task = Task::new("test", json!({}));
        let criteria = AssignmentCriteria::new().with_agent_type("plan");

        let assigned_agent = coordinator.assign_task(task, &criteria).unwrap();
        assert_eq!(assigned_agent, "agent2");
    }

    #[test]
    fn test_task_assignment_by_capability() {
        let mut coordinator = AgentCoordinator::new();

        let agent1 =
            AgentCapabilities::new("agent1", "worker").with_capabilities(vec!["read".to_string()]);
        let agent2 = AgentCapabilities::new("agent2", "worker")
            .with_capabilities(vec!["read".to_string(), "write".to_string()]);

        coordinator.register_agent(agent1).unwrap();
        coordinator.register_agent(agent2).unwrap();

        let task = Task::new("test", json!({}));
        let criteria = AssignmentCriteria::new()
            .with_capabilities(vec!["read".to_string(), "write".to_string()]);

        let assigned_agent = coordinator.assign_task(task, &criteria).unwrap();
        assert_eq!(assigned_agent, "agent2");
    }

    #[test]
    fn test_no_suitable_agent() {
        let mut coordinator = AgentCoordinator::new();

        let agent = AgentCapabilities::new("agent1", "explore");
        coordinator.register_agent(agent).unwrap();

        let task = Task::new("test", json!({}));
        let criteria = AssignmentCriteria::new().with_agent_type("plan");

        let result = coordinator.assign_task(task, &criteria);
        assert!(matches!(result, Err(CoordinatorError::NoSuitableAgent)));
    }

    #[test]
    fn test_task_lifecycle() {
        let mut coordinator = AgentCoordinator::new();

        let agent = AgentCapabilities::new("agent1", "worker").with_max_concurrent_tasks(5);
        coordinator.register_agent(agent).unwrap();

        let task = Task::new("test", json!({})).with_id("task1");
        let criteria = AssignmentCriteria::new();

        coordinator.assign_task(task, &criteria).unwrap();

        // Check task is assigned
        let (_, status) = coordinator.get_task("task1").unwrap();
        assert_eq!(status, TaskStatus::Assigned);

        // Start task
        coordinator.start_task("task1").unwrap();
        let (_, status) = coordinator.get_task("task1").unwrap();
        assert_eq!(status, TaskStatus::Running);

        // Complete task
        let result = TaskResult {
            task_id: "task1".to_string(),
            agent_id: "agent1".to_string(),
            success: true,
            result: Some(json!({"output": "done"})),
            error: None,
            start_time: Utc::now(),
            end_time: Utc::now(),
            duration_ms: 100,
        };
        coordinator.complete_task("task1", result).unwrap();

        let (_, status) = coordinator.get_task("task1").unwrap();
        assert_eq!(status, TaskStatus::Completed);
    }

    #[test]
    fn test_deadlock_detection() {
        let mut coordinator = AgentCoordinator::new();

        // Create a circular wait scenario:
        // agent1 holds resource1, waits for resource2
        // agent2 holds resource2, waits for resource1

        coordinator.record_resource_holder("resource1", "agent1");
        coordinator.record_resource_holder("resource2", "agent2");

        coordinator.record_resource_dependency("agent1", "resource2");
        coordinator.record_resource_dependency("agent2", "resource1");

        let deadlock = coordinator.detect_deadlock();
        assert!(deadlock.is_some());

        let info = deadlock.unwrap();
        assert_eq!(info.involved_agents.len(), 2);
        assert!(info.involved_agents.contains(&"agent1".to_string()));
        assert!(info.involved_agents.contains(&"agent2".to_string()));
    }

    #[test]
    fn test_no_deadlock() {
        let mut coordinator = AgentCoordinator::new();

        // No circular wait
        coordinator.record_resource_holder("resource1", "agent1");
        coordinator.record_resource_dependency("agent2", "resource1");

        let deadlock = coordinator.detect_deadlock();
        assert!(deadlock.is_none());
    }

    #[test]
    fn test_sync_barrier() {
        let mut coordinator = AgentCoordinator::new();

        let barrier_id = coordinator.create_sync_barrier(vec![
            "agent1".to_string(),
            "agent2".to_string(),
            "agent3".to_string(),
        ]);

        // First agent arrives
        let all_arrived = coordinator
            .arrive_at_barrier(&barrier_id, "agent1")
            .unwrap();
        assert!(!all_arrived);
        assert!(!coordinator.is_barrier_reached(&barrier_id));

        // Second agent arrives
        let all_arrived = coordinator
            .arrive_at_barrier(&barrier_id, "agent2")
            .unwrap();
        assert!(!all_arrived);

        // Third agent arrives
        let all_arrived = coordinator
            .arrive_at_barrier(&barrier_id, "agent3")
            .unwrap();
        assert!(all_arrived);
        assert!(coordinator.is_barrier_reached(&barrier_id));
    }

    #[test]
    fn test_get_pending_agents() {
        let mut coordinator = AgentCoordinator::new();

        let barrier_id =
            coordinator.create_sync_barrier(vec!["agent1".to_string(), "agent2".to_string()]);

        coordinator
            .arrive_at_barrier(&barrier_id, "agent1")
            .unwrap();

        let pending = coordinator.get_pending_agents(&barrier_id);
        assert_eq!(pending.len(), 1);
        assert!(pending.contains(&"agent2".to_string()));
    }

    #[test]
    fn test_coordinator_stats() {
        let mut coordinator = AgentCoordinator::new();

        let agent1 = AgentCapabilities::new("agent1", "worker").with_max_concurrent_tasks(5);
        let mut agent2 = AgentCapabilities::new("agent2", "worker").with_max_concurrent_tasks(5);
        agent2.status = AgentStatus::Offline;

        coordinator.register_agent(agent1).unwrap();
        coordinator.register_agent(agent2).unwrap();

        let stats = coordinator.get_stats();
        assert_eq!(stats.total_agents, 2);
        assert_eq!(stats.active_agents, 1);
        assert_eq!(stats.offline_agents, 1);
    }
}
