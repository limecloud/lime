//! Task Manager for Background Task Execution
//!
//! This module implements the `TaskManager` for managing background tasks:
//! - Starting background tasks with unique task_id
//! - Querying task status and output
//! - Killing running tasks
//! - Enforcing maximum concurrent task limit
//! - Automatic cleanup of timed-out tasks
//! - Persisting task output to files for retrieval
//!
//! Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use super::context::ToolContext;
use super::error::ToolError;

#[derive(Debug, Clone)]
pub enum TaskShell {
    PlatformDefault,
    PowerShell { executable_path: PathBuf },
}

/// Default maximum concurrent tasks
pub const DEFAULT_MAX_CONCURRENT: usize = 10;

/// Default maximum runtime for a task (30 minutes)
pub const DEFAULT_MAX_RUNTIME_SECS: u64 = 1800;

/// Task status enumeration
///
/// Represents the current state of a background task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    /// Task is currently running
    Running,
    /// Task completed successfully
    Completed,
    /// Task failed with an error
    Failed,
    /// Task was terminated due to timeout
    TimedOut,
    /// Task was killed by user request
    Killed,
}

impl TaskStatus {
    /// Check if the task is in a terminal state
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::TimedOut | TaskStatus::Killed
        )
    }

    /// Check if the task is still running
    pub fn is_running(&self) -> bool {
        matches!(self, TaskStatus::Running)
    }
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskStatus::Running => write!(f, "running"),
            TaskStatus::Completed => write!(f, "completed"),
            TaskStatus::Failed => write!(f, "failed"),
            TaskStatus::TimedOut => write!(f, "timed_out"),
            TaskStatus::Killed => write!(f, "killed"),
        }
    }
}

/// Task state information
///
/// Contains all information about a background task.
/// Requirements: 10.1
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskState {
    /// Unique task identifier
    pub task_id: String,
    /// The command being executed
    pub command: String,
    /// Current task status
    pub status: TaskStatus,
    /// Path to the output file
    pub output_file: PathBuf,
    /// Task start time (as duration since UNIX_EPOCH for serialization)
    #[serde(with = "instant_serde")]
    pub start_time: Instant,
    /// Task end time (if completed)
    #[serde(with = "option_instant_serde")]
    pub end_time: Option<Instant>,
    /// Exit code (if completed)
    pub exit_code: Option<i32>,
    /// Working directory
    pub working_directory: PathBuf,
    /// Session ID
    pub session_id: String,
}

impl TaskState {
    /// Create a new TaskState for a starting task
    pub fn new(
        task_id: String,
        command: String,
        output_file: PathBuf,
        working_directory: PathBuf,
        session_id: String,
    ) -> Self {
        Self {
            task_id,
            command,
            status: TaskStatus::Running,
            output_file,
            start_time: Instant::now(),
            end_time: None,
            exit_code: None,
            working_directory,
            session_id,
        }
    }

    /// Get the duration the task has been running
    pub fn duration(&self) -> Duration {
        match self.end_time {
            Some(end) => end.duration_since(self.start_time),
            None => self.start_time.elapsed(),
        }
    }

    /// Mark the task as completed
    pub fn mark_completed(&mut self, exit_code: i32) {
        self.status = if exit_code == 0 {
            TaskStatus::Completed
        } else {
            TaskStatus::Failed
        };
        self.end_time = Some(Instant::now());
        self.exit_code = Some(exit_code);
    }

    /// Mark the task as timed out
    pub fn mark_timed_out(&mut self) {
        self.status = TaskStatus::TimedOut;
        self.end_time = Some(Instant::now());
    }

    /// Mark the task as killed
    pub fn mark_killed(&mut self) {
        self.status = TaskStatus::Killed;
        self.end_time = Some(Instant::now());
    }
}

/// Internal task handle for managing running processes
struct TaskHandle {
    /// The child process
    child: Child,
    /// Task state
    state: TaskState,
}

// Manual Debug implementation for TaskHandle since Child doesn't implement Debug
impl std::fmt::Debug for TaskHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TaskHandle")
            .field("state", &self.state)
            .field("child", &"<Child process>")
            .finish()
    }
}

/// Task Manager for background task execution
///
/// Manages background tasks with:
/// - Unique task IDs
/// - Concurrent task limits
/// - Timeout enforcement
/// - Output persistence
///
/// Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
#[derive(Debug)]
pub struct TaskManager {
    /// Running tasks (task_id -> TaskHandle)
    tasks: Arc<RwLock<HashMap<String, TaskHandle>>>,
    /// Completed task states (for status queries after completion)
    completed_tasks: Arc<RwLock<HashMap<String, TaskState>>>,
    /// Maximum number of concurrent tasks
    max_concurrent: usize,
    /// Maximum runtime for a task before timeout
    max_runtime: Duration,
    /// Directory for storing task output files
    output_directory: PathBuf,
}

impl Default for TaskManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskManager {
    /// Create a new TaskManager with default settings
    pub fn new() -> Self {
        let output_dir = std::env::temp_dir().join("aster_tasks");
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            completed_tasks: Arc::new(RwLock::new(HashMap::new())),
            max_concurrent: DEFAULT_MAX_CONCURRENT,
            max_runtime: Duration::from_secs(DEFAULT_MAX_RUNTIME_SECS),
            output_directory: output_dir,
        }
    }

    /// Create a TaskManager with custom settings
    pub fn with_config(
        max_concurrent: usize,
        max_runtime: Duration,
        output_directory: PathBuf,
    ) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            completed_tasks: Arc::new(RwLock::new(HashMap::new())),
            max_concurrent,
            max_runtime,
            output_directory,
        }
    }

    /// Set maximum concurrent tasks
    pub fn with_max_concurrent(mut self, max: usize) -> Self {
        self.max_concurrent = max;
        self
    }

    /// Set maximum runtime
    pub fn with_max_runtime(mut self, duration: Duration) -> Self {
        self.max_runtime = duration;
        self
    }

    /// Set output directory
    pub fn with_output_directory(mut self, dir: PathBuf) -> Self {
        self.output_directory = dir;
        self
    }

    /// Get the number of currently running tasks
    pub async fn running_count(&self) -> usize {
        self.tasks.read().await.len()
    }

    /// Get the maximum concurrent tasks limit
    pub fn max_concurrent(&self) -> usize {
        self.max_concurrent
    }

    /// Get the maximum runtime
    pub fn max_runtime(&self) -> Duration {
        self.max_runtime
    }
}

// Serde helpers for Instant (which doesn't implement Serialize/Deserialize)
mod instant_serde {
    use serde::{Deserializer, Serialize, Serializer};
    use std::time::Instant;

    pub fn serialize<S>(instant: &Instant, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        instant.elapsed().as_secs().serialize(serializer)
    }

    pub fn deserialize<'de, D>(_deserializer: D) -> Result<Instant, D::Error>
    where
        D: Deserializer<'de>,
    {
        // We can't truly deserialize an Instant, so we return now
        // This is acceptable since we mainly use this for display purposes
        Ok(Instant::now())
    }
}

mod option_instant_serde {
    use serde::{Deserializer, Serialize, Serializer};
    use std::time::Instant;

    pub fn serialize<S>(instant: &Option<Instant>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match instant {
            Some(i) => Some(i.elapsed().as_secs()).serialize(serializer),
            None => None::<u64>.serialize(serializer),
        }
    }

    pub fn deserialize<'de, D>(_deserializer: D) -> Result<Option<Instant>, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(None)
    }
}

// =============================================================================
// Task Start Implementation (Requirements: 10.1, 10.4)
// =============================================================================

impl TaskManager {
    /// Start a background task
    ///
    /// Creates a new background task with a unique task_id.
    /// The task runs asynchronously and output is persisted to a file.
    ///
    /// Requirements: 10.1, 10.4
    pub async fn start(&self, command: &str, context: &ToolContext) -> Result<String, ToolError> {
        self.start_with_shell(command, context, TaskShell::PlatformDefault)
            .await
    }

    pub async fn start_with_shell(
        &self,
        command: &str,
        context: &ToolContext,
        shell: TaskShell,
    ) -> Result<String, ToolError> {
        // Check concurrent task limit
        let running_count = self.running_count().await;
        if running_count >= self.max_concurrent {
            return Err(ToolError::execution_failed(format!(
                "Maximum concurrent task limit ({}) reached. {} tasks currently running.",
                self.max_concurrent, running_count
            )));
        }

        // Generate unique task ID
        let task_id = Uuid::new_v4().to_string();

        // Ensure output directory exists
        if let Err(e) = tokio::fs::create_dir_all(&self.output_directory).await {
            warn!("Failed to create output directory: {}", e);
        }

        // Create output file path
        let output_file = self.output_directory.join(format!("{}.log", task_id));

        // Build the command
        let mut cmd = self.build_command(command, context, &shell);

        // Create output file for writing
        let output_file_handle = tokio::fs::File::create(&output_file).await.map_err(|e| {
            ToolError::execution_failed(format!("Failed to create output file: {}", e))
        })?;

        // Spawn the process
        let child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ToolError::execution_failed(format!("Failed to spawn process: {}", e)))?;

        // Create task state
        let state = TaskState::new(
            task_id.clone(),
            command.to_string(),
            output_file.clone(),
            context.working_directory.clone(),
            context.session_id.clone(),
        );

        info!(
            "Started background task {} for command: {}",
            task_id, command
        );

        // Create task handle
        let handle = TaskHandle {
            child,
            state: state.clone(),
        };

        // Store the task
        {
            let mut tasks = self.tasks.write().await;
            tasks.insert(task_id.clone(), handle);
        }

        // Spawn a task to monitor the process and capture output
        let tasks_clone = Arc::clone(&self.tasks);
        let completed_clone = Arc::clone(&self.completed_tasks);
        let task_id_clone = task_id.clone();
        let max_runtime = self.max_runtime;

        tokio::spawn(async move {
            Self::monitor_task(
                tasks_clone,
                completed_clone,
                task_id_clone,
                output_file_handle,
                max_runtime,
            )
            .await;
        });

        Ok(task_id)
    }

    /// Build a platform-specific command
    fn build_command(&self, command: &str, context: &ToolContext, shell: &TaskShell) -> Command {
        let mut cmd = match shell {
            TaskShell::PlatformDefault => {
                if cfg!(target_os = "windows") {
                    let mut cmd = Command::new("powershell");
                    cmd.args(["-NoProfile", "-NonInteractive", "-Command", command]);
                    cmd
                } else {
                    let mut cmd = Command::new("sh");
                    cmd.args(["-c", command]);
                    cmd
                }
            }
            TaskShell::PowerShell { executable_path } => {
                let mut cmd = Command::new(executable_path);
                cmd.args(["-NoProfile", "-NonInteractive", "-Command", command]);
                cmd
            }
        };

        cmd.current_dir(&context.working_directory);
        cmd.env("ASTER_TERMINAL", "1");
        cmd.env("ASTER_BACKGROUND", "1");

        for (key, value) in &context.environment {
            cmd.env(key, value);
        }

        cmd
    }

    /// Monitor a running task and capture its output
    async fn monitor_task(
        tasks: Arc<RwLock<HashMap<String, TaskHandle>>>,
        completed_tasks: Arc<RwLock<HashMap<String, TaskState>>>,
        task_id: String,
        output_file: tokio::fs::File,
        max_runtime: Duration,
    ) {
        use tokio::io::AsyncWriteExt;

        let output_file = Arc::new(tokio::sync::Mutex::new(output_file));

        // Get the child process handles
        let (stdout, stderr) = {
            let mut tasks_guard = tasks.write().await;
            if let Some(handle) = tasks_guard.get_mut(&task_id) {
                let stdout = handle.child.stdout.take();
                let stderr = handle.child.stderr.take();
                (stdout, stderr)
            } else {
                return;
            }
        };

        // Read stdout and stderr concurrently using shared output file
        let output_file_stdout = Arc::clone(&output_file);
        let stdout_task = async move {
            if let Some(stdout) = stdout {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut file = output_file_stdout.lock().await;
                    let _ = file.write_all(format!("{}\n", line).as_bytes()).await;
                }
            }
        };

        let output_file_stderr = Arc::clone(&output_file);
        let stderr_task = async move {
            if let Some(stderr) = stderr {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut file = output_file_stderr.lock().await;
                    let _ = file
                        .write_all(format!("[stderr] {}\n", line).as_bytes())
                        .await;
                }
            }
        };

        // Wait for output streams with timeout
        let timeout_result = tokio::time::timeout(max_runtime, async {
            tokio::join!(stdout_task, stderr_task);
        })
        .await;

        // Flush output file
        {
            let mut file = output_file.lock().await;
            let _ = file.flush().await;
        }

        // Update task state based on result
        let mut tasks_guard = tasks.write().await;
        if let Some(mut handle) = tasks_guard.remove(&task_id) {
            if timeout_result.is_err() {
                // Task timed out
                warn!("Task {} timed out after {:?}", task_id, max_runtime);
                handle.state.mark_timed_out();
                // Try to kill the process
                let _ = handle.child.kill().await;
            } else {
                // Wait for the process to complete
                match handle.child.wait().await {
                    Ok(status) => {
                        let exit_code = status.code().unwrap_or(-1);
                        debug!("Task {} completed with exit code {}", task_id, exit_code);
                        handle.state.mark_completed(exit_code);
                    }
                    Err(e) => {
                        error!("Failed to wait for task {}: {}", task_id, e);
                        handle.state.mark_completed(-1);
                    }
                }
            }

            // Move to completed tasks
            let mut completed = completed_tasks.write().await;
            completed.insert(task_id, handle.state);
        }
    }
}

// =============================================================================
// Task Query Implementation (Requirements: 10.2, 10.6)
// =============================================================================

impl TaskManager {
    /// Get the status of a task
    ///
    /// Returns the current state of a task, or None if not found.
    ///
    /// Requirements: 10.2
    pub async fn get_status(&self, task_id: &str) -> Option<TaskState> {
        // Check running tasks first
        {
            let tasks = self.tasks.read().await;
            if let Some(handle) = tasks.get(task_id) {
                return Some(handle.state.clone());
            }
        }

        // Check completed tasks
        {
            let completed = self.completed_tasks.read().await;
            if let Some(state) = completed.get(task_id) {
                return Some(state.clone());
            }
        }

        None
    }

    /// Get the output file path of a task
    pub async fn get_output_file_path(&self, task_id: &str) -> Option<PathBuf> {
        self.get_status(task_id)
            .await
            .map(|state| state.output_file)
    }

    /// Get the output of a task
    ///
    /// Returns the output from the task's output file.
    /// Optionally limits to the last N lines.
    ///
    /// Requirements: 10.6
    pub async fn get_output(
        &self,
        task_id: &str,
        lines: Option<usize>,
    ) -> Result<String, ToolError> {
        // Find the output file path
        let output_file = {
            // Check running tasks
            let tasks = self.tasks.read().await;
            if let Some(handle) = tasks.get(task_id) {
                handle.state.output_file.clone()
            } else {
                // Check completed tasks
                let completed = self.completed_tasks.read().await;
                if let Some(state) = completed.get(task_id) {
                    state.output_file.clone()
                } else {
                    return Err(ToolError::not_found(format!("Task not found: {}", task_id)));
                }
            }
        };

        // Read the output file
        let content = tokio::fs::read_to_string(&output_file).await.map_err(|e| {
            ToolError::execution_failed(format!("Failed to read output file: {}", e))
        })?;

        // Apply line limit if specified
        match lines {
            Some(n) if n > 0 => {
                let all_lines: Vec<&str> = content.lines().collect();
                let start = all_lines.len().saturating_sub(n);
                Ok(all_lines[start..].join("\n"))
            }
            _ => Ok(content),
        }
    }

    /// List all tasks (running and completed)
    pub async fn list_tasks(&self) -> Vec<TaskState> {
        let mut result = Vec::new();

        // Add running tasks
        {
            let tasks = self.tasks.read().await;
            for handle in tasks.values() {
                result.push(handle.state.clone());
            }
        }

        // Add completed tasks
        {
            let completed = self.completed_tasks.read().await;
            for state in completed.values() {
                result.push(state.clone());
            }
        }

        result
    }

    /// List only running tasks
    pub async fn list_running_tasks(&self) -> Vec<TaskState> {
        let tasks = self.tasks.read().await;
        tasks.values().map(|h| h.state.clone()).collect()
    }

    /// Check if a task exists
    pub async fn task_exists(&self, task_id: &str) -> bool {
        self.get_status(task_id).await.is_some()
    }
}

// =============================================================================
// Task Termination Implementation (Requirements: 10.3)
// =============================================================================

impl TaskManager {
    /// Kill a running task
    ///
    /// Attempts to terminate the task. On Unix systems, we use tokio's
    /// kill method which sends SIGKILL. For graceful termination,
    /// we first try to wait with a short timeout.
    ///
    /// Requirements: 10.3
    pub async fn kill(&self, task_id: &str) -> Result<(), ToolError> {
        let mut tasks = self.tasks.write().await;

        if let Some(mut handle) = tasks.remove(task_id) {
            info!("Killing task {}", task_id);

            // Try to wait briefly first (gives process a chance to finish naturally)
            let graceful_timeout = Duration::from_millis(100);
            match tokio::time::timeout(graceful_timeout, handle.child.wait()).await {
                Ok(Ok(status)) => {
                    // Process already finished
                    let exit_code = status.code().unwrap_or(-1);
                    debug!(
                        "Task {} already finished with exit code {}",
                        task_id, exit_code
                    );
                    handle.state.mark_completed(exit_code);
                }
                _ => {
                    // Process still running, kill it
                    debug!("Task {} still running, sending kill signal", task_id);
                    let _ = handle.child.kill().await;
                    // Wait for the process to actually terminate
                    let _ = handle.child.wait().await;
                    handle.state.mark_killed();
                }
            }

            // Move to completed tasks
            let mut completed = self.completed_tasks.write().await;
            completed.insert(task_id.to_string(), handle.state);

            Ok(())
        } else {
            // Check if it's already completed
            let completed = self.completed_tasks.read().await;
            if completed.contains_key(task_id) {
                Err(ToolError::execution_failed(format!(
                    "Task {} has already completed",
                    task_id
                )))
            } else {
                Err(ToolError::not_found(format!("Task not found: {}", task_id)))
            }
        }
    }

    /// Kill all running tasks
    pub async fn kill_all(&self) -> usize {
        let task_ids: Vec<String> = {
            let tasks = self.tasks.read().await;
            tasks.keys().cloned().collect()
        };

        let mut killed = 0;
        for task_id in task_ids {
            if self.kill(&task_id).await.is_ok() {
                killed += 1;
            }
        }

        killed
    }
}

// =============================================================================
// Timeout Cleanup Implementation (Requirements: 10.5)
// =============================================================================

impl TaskManager {
    /// Cleanup timed-out tasks
    ///
    /// Checks all running tasks and terminates those that have exceeded
    /// the maximum runtime. Returns the number of tasks cleaned up.
    ///
    /// Requirements: 10.5
    pub async fn cleanup_timed_out(&self) -> usize {
        let timed_out_ids: Vec<String> = {
            let tasks = self.tasks.read().await;
            tasks
                .iter()
                .filter(|(_, handle)| handle.state.duration() > self.max_runtime)
                .map(|(id, _)| id.clone())
                .collect()
        };

        let mut cleaned = 0;
        for task_id in timed_out_ids {
            warn!("Cleaning up timed-out task: {}", task_id);

            let mut tasks = self.tasks.write().await;
            if let Some(mut handle) = tasks.remove(&task_id) {
                // Kill the process
                let _ = handle.child.kill().await;

                // Update state
                handle.state.mark_timed_out();

                // Move to completed tasks
                let mut completed = self.completed_tasks.write().await;
                completed.insert(task_id, handle.state);

                cleaned += 1;
            }
        }

        cleaned
    }

    /// Cleanup old completed tasks
    ///
    /// Removes completed task records older than the specified duration.
    /// Also removes their output files.
    pub async fn cleanup_old_completed(&self, max_age: Duration) -> usize {
        let old_task_ids: Vec<String> = {
            let completed = self.completed_tasks.read().await;
            completed
                .iter()
                .filter(|(_, state)| state.end_time.is_some_and(|end| end.elapsed() > max_age))
                .map(|(id, _)| id.clone())
                .collect()
        };

        let mut cleaned = 0;
        for task_id in old_task_ids {
            let mut completed = self.completed_tasks.write().await;
            if let Some(state) = completed.remove(&task_id) {
                // Remove output file
                if let Err(e) = tokio::fs::remove_file(&state.output_file).await {
                    debug!("Failed to remove output file for task {}: {}", task_id, e);
                }
                cleaned += 1;
            }
        }

        cleaned
    }

    /// Start a background cleanup task that periodically cleans up timed-out tasks
    pub fn start_cleanup_task(self: Arc<Self>, interval: Duration) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval_timer = tokio::time::interval(interval);
            loop {
                interval_timer.tick().await;
                let cleaned = self.cleanup_timed_out().await;
                if cleaned > 0 {
                    info!("Cleaned up {} timed-out tasks", cleaned);
                }
            }
        })
    }
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn create_test_context() -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("test-session")
            .with_user("test-user")
    }

    fn create_test_manager(temp_dir: &TempDir) -> TaskManager {
        TaskManager::new()
            .with_output_directory(temp_dir.path().to_path_buf())
            .with_max_concurrent(5)
            .with_max_runtime(Duration::from_secs(60))
    }

    // TaskStatus Tests

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
    fn test_task_status_display() {
        assert_eq!(TaskStatus::Running.to_string(), "running");
        assert_eq!(TaskStatus::Completed.to_string(), "completed");
        assert_eq!(TaskStatus::Failed.to_string(), "failed");
        assert_eq!(TaskStatus::TimedOut.to_string(), "timed_out");
        assert_eq!(TaskStatus::Killed.to_string(), "killed");
    }

    // TaskState Tests

    #[test]
    fn test_task_state_new() {
        let state = TaskState::new(
            "task-123".to_string(),
            "echo hello".to_string(),
            PathBuf::from("/tmp/task-123.log"),
            PathBuf::from("/tmp"),
            "session-1".to_string(),
        );

        assert_eq!(state.task_id, "task-123");
        assert_eq!(state.command, "echo hello");
        assert_eq!(state.status, TaskStatus::Running);
        assert!(state.end_time.is_none());
        assert!(state.exit_code.is_none());
    }

    #[test]
    fn test_task_state_mark_completed() {
        let mut state = TaskState::new(
            "task-123".to_string(),
            "echo hello".to_string(),
            PathBuf::from("/tmp/task-123.log"),
            PathBuf::from("/tmp"),
            "session-1".to_string(),
        );

        state.mark_completed(0);
        assert_eq!(state.status, TaskStatus::Completed);
        assert!(state.end_time.is_some());
        assert_eq!(state.exit_code, Some(0));

        let mut state2 = TaskState::new(
            "task-456".to_string(),
            "exit 1".to_string(),
            PathBuf::from("/tmp/task-456.log"),
            PathBuf::from("/tmp"),
            "session-1".to_string(),
        );

        state2.mark_completed(1);
        assert_eq!(state2.status, TaskStatus::Failed);
        assert_eq!(state2.exit_code, Some(1));
    }

    #[test]
    fn test_task_state_mark_timed_out() {
        let mut state = TaskState::new(
            "task-123".to_string(),
            "sleep 100".to_string(),
            PathBuf::from("/tmp/task-123.log"),
            PathBuf::from("/tmp"),
            "session-1".to_string(),
        );

        state.mark_timed_out();
        assert_eq!(state.status, TaskStatus::TimedOut);
        assert!(state.end_time.is_some());
    }

    #[test]
    fn test_task_state_mark_killed() {
        let mut state = TaskState::new(
            "task-123".to_string(),
            "sleep 100".to_string(),
            PathBuf::from("/tmp/task-123.log"),
            PathBuf::from("/tmp"),
            "session-1".to_string(),
        );

        state.mark_killed();
        assert_eq!(state.status, TaskStatus::Killed);
        assert!(state.end_time.is_some());
    }

    // TaskManager Tests

    #[test]
    fn test_task_manager_default() {
        let manager = TaskManager::new();
        assert_eq!(manager.max_concurrent(), DEFAULT_MAX_CONCURRENT);
        assert_eq!(
            manager.max_runtime(),
            Duration::from_secs(DEFAULT_MAX_RUNTIME_SECS)
        );
    }

    #[test]
    fn test_task_manager_builder() {
        let manager = TaskManager::new()
            .with_max_concurrent(20)
            .with_max_runtime(Duration::from_secs(3600))
            .with_output_directory(PathBuf::from("/custom/output"));

        assert_eq!(manager.max_concurrent(), 20);
        assert_eq!(manager.max_runtime(), Duration::from_secs(3600));
    }

    #[tokio::test]
    async fn test_task_manager_running_count() {
        let manager = TaskManager::new();
        assert_eq!(manager.running_count().await, 0);
    }

    #[tokio::test]
    async fn test_start_simple_task() {
        let temp_dir = TempDir::new().unwrap();
        let manager = create_test_manager(&temp_dir);
        let context = create_test_context();

        let command = "echo hello";

        let result = manager.start(command, &context).await;
        assert!(result.is_ok());

        let task_id = result.unwrap();
        assert!(!task_id.is_empty());

        // Wait a bit for the task to complete
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Check status
        let status = manager.get_status(&task_id).await;
        assert!(status.is_some());
    }

    #[tokio::test]
    async fn test_start_task_concurrent_limit() {
        let temp_dir = TempDir::new().unwrap();
        let manager = TaskManager::new()
            .with_output_directory(temp_dir.path().to_path_buf())
            .with_max_concurrent(1)
            .with_max_runtime(Duration::from_secs(60));
        let context = create_test_context();

        let command = if cfg!(target_os = "windows") {
            "timeout /t 10"
        } else {
            "sleep 10"
        };

        // Start first task
        let result1 = manager.start(command, &context).await;
        assert!(result1.is_ok());

        // Try to start second task - should fail due to limit
        let result2 = manager.start(command, &context).await;
        assert!(result2.is_err());

        // Clean up
        let _ = manager.kill_all().await;
    }

    #[tokio::test]
    async fn test_get_status_not_found() {
        let manager = TaskManager::new();
        let status = manager.get_status("nonexistent-task").await;
        assert!(status.is_none());
    }

    #[tokio::test]
    async fn test_get_output_not_found() {
        let manager = TaskManager::new();
        let result = manager.get_output("nonexistent-task", None).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::NotFound(_)));
    }

    #[tokio::test]
    async fn test_get_output_with_lines() {
        let temp_dir = TempDir::new().unwrap();
        let manager = create_test_manager(&temp_dir);
        let context = create_test_context();

        // Create a task that outputs multiple lines
        let command = if cfg!(target_os = "windows") {
            "echo line1 && echo line2 && echo line3"
        } else {
            "echo line1; echo line2; echo line3"
        };

        let task_id = manager.start(command, &context).await.unwrap();

        // Wait for completion
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Get last 2 lines
        let output = manager.get_output(&task_id, Some(2)).await;
        assert!(output.is_ok());
    }

    #[tokio::test]
    async fn test_kill_task() {
        let temp_dir = TempDir::new().unwrap();
        let manager = create_test_manager(&temp_dir);
        let context = create_test_context();

        let command = if cfg!(target_os = "windows") {
            "timeout /t 60"
        } else {
            "sleep 60"
        };

        let task_id = manager.start(command, &context).await.unwrap();

        // Kill the task
        let result = manager.kill(&task_id).await;
        assert!(result.is_ok());

        // Check status
        let status = manager.get_status(&task_id).await;
        assert!(status.is_some());
        assert_eq!(status.unwrap().status, TaskStatus::Killed);
    }

    #[tokio::test]
    async fn test_kill_nonexistent_task() {
        let manager = TaskManager::new();
        let result = manager.kill("nonexistent-task").await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::NotFound(_)));
    }

    #[tokio::test]
    async fn test_list_tasks() {
        let temp_dir = TempDir::new().unwrap();
        let manager = create_test_manager(&temp_dir);
        let context = create_test_context();

        // Start a task
        let command = "echo hello";
        let _ = manager.start(command, &context).await.unwrap();

        // Wait a bit
        tokio::time::sleep(Duration::from_millis(100)).await;

        // List tasks
        let tasks = manager.list_tasks().await;
        assert!(!tasks.is_empty());
    }

    #[tokio::test]
    async fn test_task_exists() {
        let temp_dir = TempDir::new().unwrap();
        let manager = create_test_manager(&temp_dir);
        let context = create_test_context();

        let task_id = manager.start("echo hello", &context).await.unwrap();

        assert!(manager.task_exists(&task_id).await);
        assert!(!manager.task_exists("nonexistent").await);
    }

    #[tokio::test]
    async fn test_kill_all() {
        let temp_dir = TempDir::new().unwrap();
        let manager = create_test_manager(&temp_dir);
        let context = create_test_context();

        let command = if cfg!(target_os = "windows") {
            "timeout /t 60"
        } else {
            "sleep 60"
        };

        // Start multiple tasks
        let _ = manager.start(command, &context).await.unwrap();
        let _ = manager.start(command, &context).await.unwrap();

        // Kill all
        let killed = manager.kill_all().await;
        assert_eq!(killed, 2);

        // Verify no running tasks
        assert_eq!(manager.running_count().await, 0);
    }
}
