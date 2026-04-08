//! 后台 Shell 管理器
//!
//! 管理后台执行的 Shell 进程，包括状态追踪、输出收集和资源管理
//!
//! # 功能
//! - Shell 进程生命周期管理
//! - 输出流式收集
//! - 进程暂停/恢复支持
//! - 优雅终止

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, RwLock};

use super::types::{ShellOutputEvent, ShellOutputType, ShellStats, ShellStatus};

/// 后台 Shell
pub struct BackgroundShell {
    pub id: String,
    pub command: String,
    pub cwd: String,
    pub process: Option<Child>,
    pub status: ShellStatus,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub exit_code: Option<i32>,
    pub output: Vec<String>,
    pub output_size: usize,
    pub max_runtime: Option<u64>,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// Shell 管理器配置
#[derive(Debug, Clone)]
pub struct ShellManagerOptions {
    pub max_shells: usize,
    pub max_output_size: usize,
    pub default_max_runtime: u64,
}

impl Default for ShellManagerOptions {
    fn default() -> Self {
        Self {
            max_shells: 10,
            max_output_size: 10 * 1024 * 1024, // 10MB
            default_max_runtime: 3600000,      // 1 hour
        }
    }
}

/// Shell 创建结果
#[derive(Debug)]
pub struct CreateShellResult {
    pub success: bool,
    pub id: Option<String>,
    pub error: Option<String>,
}

/// Shell 管理器
pub struct ShellManager {
    shells: Arc<RwLock<HashMap<String, BackgroundShell>>>,
    max_shells: usize,
    max_output_size: usize,
    default_max_runtime: u64,
    event_tx: broadcast::Sender<ShellOutputEvent>,
}

impl ShellManager {
    /// 创建新的 Shell 管理器
    pub fn new(options: ShellManagerOptions) -> Self {
        let (event_tx, _) = broadcast::channel(1000);
        Self {
            shells: Arc::new(RwLock::new(HashMap::new())),
            max_shells: options.max_shells,
            max_output_size: options.max_output_size,
            default_max_runtime: options.default_max_runtime,
            event_tx,
        }
    }

    /// 订阅输出事件
    pub fn subscribe(&self) -> broadcast::Receiver<ShellOutputEvent> {
        self.event_tx.subscribe()
    }

    /// 生成唯一的 Shell ID
    fn generate_shell_id(&self) -> String {
        let uuid_str = uuid::Uuid::new_v4().to_string();
        format!(
            "bash_{}_{}",
            chrono::Utc::now().timestamp_millis(),
            uuid_str.get(..8).unwrap_or(&uuid_str)
        )
    }

    /// 创建并启动后台 Shell
    pub async fn create_shell(
        &self,
        command: &str,
        cwd: Option<&str>,
        max_runtime: Option<u64>,
        metadata: Option<HashMap<String, serde_json::Value>>,
    ) -> CreateShellResult {
        // 检查 shell 数量限制
        let shell_count = self.shells.read().await.len();
        if shell_count >= self.max_shells {
            let cleaned = self.cleanup_completed().await;
            if cleaned == 0 && shell_count >= self.max_shells {
                return CreateShellResult {
                    success: false,
                    id: None,
                    error: Some(format!(
                        "Maximum number of background shells ({}) reached",
                        self.max_shells
                    )),
                };
            }
        }

        let id = self.generate_shell_id();
        let working_dir = cwd.unwrap_or(".").to_string();
        let runtime = max_runtime.unwrap_or(self.default_max_runtime);

        // 创建进程
        let child = match Command::new("bash")
            .arg("-c")
            .arg(command)
            .current_dir(&working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                return CreateShellResult {
                    success: false,
                    id: None,
                    error: Some(format!("Failed to spawn process: {}", e)),
                };
            }
        };

        let shell = BackgroundShell {
            id: id.clone(),
            command: command.to_string(),
            cwd: working_dir,
            process: Some(child),
            status: ShellStatus::Running,
            start_time: chrono::Utc::now().timestamp_millis(),
            end_time: None,
            exit_code: None,
            output: Vec::new(),
            output_size: 0,
            max_runtime: Some(runtime),
            metadata,
        };

        self.shells.write().await.insert(id.clone(), shell);
        self.spawn_output_reader(id.clone()).await;

        CreateShellResult {
            success: true,
            id: Some(id),
            error: None,
        }
    }

    /// 启动输出读取器
    async fn spawn_output_reader(&self, shell_id: String) {
        let shells = Arc::clone(&self.shells);
        let event_tx = self.event_tx.clone();
        let max_output_size = self.max_output_size;

        tokio::spawn(async move {
            let mut shells_guard = shells.write().await;
            if let Some(shell) = shells_guard.get_mut(&shell_id) {
                if let Some(ref mut process) = shell.process {
                    if let Some(stdout) = process.stdout.take() {
                        let shells_clone = Arc::clone(&shells);
                        let id_clone = shell_id.clone();
                        let tx_clone = event_tx.clone();

                        tokio::spawn(async move {
                            let reader = BufReader::new(stdout);
                            let mut lines = reader.lines();
                            while let Ok(Some(line)) = lines.next_line().await {
                                let mut guard = shells_clone.write().await;
                                if let Some(s) = guard.get_mut(&id_clone) {
                                    if s.output_size < max_output_size {
                                        s.output.push(line.clone());
                                        s.output_size += line.len();
                                    }
                                }
                                let _ = tx_clone.send(ShellOutputEvent {
                                    id: id_clone.clone(),
                                    data: line,
                                    output_type: ShellOutputType::Stdout,
                                });
                            }
                        });
                    }
                }
            }
        });
    }

    /// 获取 Shell 状态
    pub async fn get_shell(&self, id: &str) -> Option<ShellStatus> {
        self.shells.read().await.get(id).map(|s| s.status)
    }

    /// 获取 Shell 输出
    pub async fn get_output(&self, id: &str, clear: bool) -> Option<String> {
        let mut shells = self.shells.write().await;
        if let Some(shell) = shells.get_mut(id) {
            let output = shell.output.join("\n");
            if clear {
                shell.output.clear();
            }
            Some(output)
        } else {
            None
        }
    }

    /// 终止 Shell
    pub async fn terminate_shell(&self, id: &str) -> bool {
        let mut shells = self.shells.write().await;
        if let Some(shell) = shells.get_mut(id) {
            if let Some(ref mut process) = shell.process {
                let _ = process.kill().await;
            }
            shell.status = ShellStatus::Terminated;
            shell.end_time = Some(chrono::Utc::now().timestamp_millis());
            true
        } else {
            false
        }
    }

    /// 列出所有 Shell
    pub async fn list_shells(&self) -> Vec<(String, String, ShellStatus, i64, usize)> {
        self.shells
            .read()
            .await
            .values()
            .map(|s| {
                let duration = s
                    .end_time
                    .unwrap_or_else(|| chrono::Utc::now().timestamp_millis())
                    - s.start_time;
                (
                    s.id.clone(),
                    s.command.chars().take(100).collect(),
                    s.status,
                    duration,
                    s.output_size,
                )
            })
            .collect()
    }

    /// 清理已完成的 Shell
    pub async fn cleanup_completed(&self) -> usize {
        let mut shells = self.shells.write().await;
        let to_remove: Vec<String> = shells
            .iter()
            .filter(|(_, s)| {
                matches!(
                    s.status,
                    ShellStatus::Completed | ShellStatus::Failed | ShellStatus::Terminated
                )
            })
            .map(|(id, _)| id.clone())
            .collect();

        let count = to_remove.len();
        for id in to_remove {
            shells.remove(&id);
        }
        count
    }

    /// 终止所有 Shell
    pub async fn terminate_all(&self) -> usize {
        let mut shells = self.shells.write().await;
        let mut terminated = 0;
        for shell in shells.values_mut() {
            if let Some(ref mut process) = shell.process {
                if process.kill().await.is_ok() {
                    terminated += 1;
                }
            }
            shell.status = ShellStatus::Terminated;
        }
        shells.clear();
        terminated
    }

    /// 获取统计信息
    pub async fn get_stats(&self) -> ShellStats {
        let shells = self.shells.read().await;
        let mut stats = ShellStats {
            total: shells.len(),
            running: 0,
            completed: 0,
            failed: 0,
            paused: 0,
            terminated: 0,
            max_shells: self.max_shells,
            available: 0,
        };

        for shell in shells.values() {
            match shell.status {
                ShellStatus::Running => stats.running += 1,
                ShellStatus::Completed => stats.completed += 1,
                ShellStatus::Failed => stats.failed += 1,
                ShellStatus::Paused => stats.paused += 1,
                ShellStatus::Terminated => stats.terminated += 1,
            }
        }

        stats.available = self.max_shells.saturating_sub(stats.running + stats.paused);
        stats
    }
}
