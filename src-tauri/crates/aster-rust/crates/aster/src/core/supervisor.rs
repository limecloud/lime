//! 组件监督者模式
//!
//! 提供组件生命周期管理，支持失败时指数退避重启

use std::future::Future;
use std::time::Duration;
use tokio::task::JoinHandle;

/// 重启策略
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestartPolicy {
    /// 总是重启（无论成功或失败）
    Always,
    /// 仅失败时重启
    OnFailure,
    /// 不重启
    Never,
}

/// 组件监督者配置
#[derive(Debug, Clone)]
pub struct SupervisorConfig {
    /// 组件名称
    pub name: String,
    /// 初始退避时间（秒）
    pub initial_backoff_secs: u64,
    /// 最大退避时间（秒）
    pub max_backoff_secs: u64,
    /// 重启策略
    pub restart_policy: RestartPolicy,
}

impl SupervisorConfig {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            initial_backoff_secs: 1,
            max_backoff_secs: 60,
            restart_policy: RestartPolicy::OnFailure,
        }
    }

    pub fn with_backoff(mut self, initial_secs: u64, max_secs: u64) -> Self {
        self.initial_backoff_secs = initial_secs;
        self.max_backoff_secs = max_secs;
        self
    }

    pub fn with_restart_policy(mut self, policy: RestartPolicy) -> Self {
        self.restart_policy = policy;
        self
    }
}

/// 启动组件监督者
///
/// 在后台 tokio 任务中循环执行组件闭包，失败时按指数退避重启。
/// 成功完成时根据 `RestartPolicy` 决定是否重启。
///
/// # 参数
/// - `config`: 监督者配置
/// - `run_component`: 返回 `Result<(), E>` 的异步闭包
///
/// # 返回
/// `JoinHandle<()>`，可用于取消监督者
pub fn spawn_component_supervisor<F, Fut, E>(
    config: SupervisorConfig,
    run_component: F,
) -> JoinHandle<()>
where
    F: Fn() -> Fut + Send + 'static,
    Fut: Future<Output = Result<(), E>> + Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    tokio::spawn(async move {
        let mut current_backoff_secs = config.initial_backoff_secs;

        loop {
            tracing::info!(component = %config.name, "组件启动");

            match run_component().await {
                Ok(()) => {
                    tracing::info!(component = %config.name, "组件正常退出");
                    current_backoff_secs = config.initial_backoff_secs;

                    match config.restart_policy {
                        RestartPolicy::Always => {
                            tracing::info!(component = %config.name, "策略为 Always，立即重启");
                            continue;
                        }
                        RestartPolicy::OnFailure | RestartPolicy::Never => {
                            tracing::info!(component = %config.name, "组件停止");
                            break;
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(
                        component = %config.name,
                        error = %e,
                        backoff_secs = current_backoff_secs,
                        "组件失败，等待退避后重启"
                    );

                    match config.restart_policy {
                        RestartPolicy::Never => {
                            tracing::info!(component = %config.name, "策略为 Never，不重启");
                            break;
                        }
                        RestartPolicy::Always | RestartPolicy::OnFailure => {
                            tokio::time::sleep(Duration::from_secs(current_backoff_secs)).await;
                            current_backoff_secs =
                                (current_backoff_secs * 2).min(config.max_backoff_secs);
                        }
                    }
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    #[test]
    fn supervisor_config_defaults() {
        let config = SupervisorConfig::new("test");
        assert_eq!(config.name, "test");
        assert_eq!(config.initial_backoff_secs, 1);
        assert_eq!(config.max_backoff_secs, 60);
        assert_eq!(config.restart_policy, RestartPolicy::OnFailure);
    }

    #[test]
    fn supervisor_config_builder() {
        let config = SupervisorConfig::new("comp")
            .with_backoff(2, 30)
            .with_restart_policy(RestartPolicy::Always);
        assert_eq!(config.initial_backoff_secs, 2);
        assert_eq!(config.max_backoff_secs, 30);
        assert_eq!(config.restart_policy, RestartPolicy::Always);
    }

    #[test]
    fn restart_policy_equality() {
        assert_eq!(RestartPolicy::Always, RestartPolicy::Always);
        assert_ne!(RestartPolicy::Always, RestartPolicy::Never);
        assert_ne!(RestartPolicy::OnFailure, RestartPolicy::Never);
    }

    #[tokio::test]
    async fn supervisor_stops_on_success_with_on_failure_policy() {
        let counter = Arc::new(AtomicU32::new(0));
        let counter_clone = counter.clone();

        let config = SupervisorConfig::new("test").with_restart_policy(RestartPolicy::OnFailure);

        let handle = spawn_component_supervisor(config, move || {
            let c = counter_clone.clone();
            async move {
                c.fetch_add(1, Ordering::SeqCst);
                Ok::<(), String>(())
            }
        });

        handle.await.unwrap();
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn supervisor_stops_on_failure_with_never_policy() {
        let counter = Arc::new(AtomicU32::new(0));
        let counter_clone = counter.clone();

        let config = SupervisorConfig::new("test").with_restart_policy(RestartPolicy::Never);

        let handle = spawn_component_supervisor(config, move || {
            let c = counter_clone.clone();
            async move {
                c.fetch_add(1, Ordering::SeqCst);
                Err::<(), String>("boom".to_string())
            }
        });

        handle.await.unwrap();
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn supervisor_stops_on_success_with_never_policy() {
        let counter = Arc::new(AtomicU32::new(0));
        let counter_clone = counter.clone();

        let config = SupervisorConfig::new("test").with_restart_policy(RestartPolicy::Never);

        let handle = spawn_component_supervisor(config, move || {
            let c = counter_clone.clone();
            async move {
                c.fetch_add(1, Ordering::SeqCst);
                Ok::<(), String>(())
            }
        });

        handle.await.unwrap();
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn supervisor_retries_on_failure_with_on_failure_policy() {
        let counter = Arc::new(AtomicU32::new(0));
        let counter_clone = counter.clone();

        let config = SupervisorConfig::new("test")
            .with_backoff(0, 0) // 无退避，加速测试
            .with_restart_policy(RestartPolicy::OnFailure);

        let handle = spawn_component_supervisor(config, move || {
            let c = counter_clone.clone();
            async move {
                let count = c.fetch_add(1, Ordering::SeqCst) + 1;
                if count < 3 {
                    Err::<(), String>(format!("fail #{count}"))
                } else {
                    Ok(())
                }
            }
        });

        handle.await.unwrap();
        assert_eq!(counter.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn supervisor_always_restarts_on_success() {
        let counter = Arc::new(AtomicU32::new(0));
        let counter_clone = counter.clone();

        let config = SupervisorConfig::new("test").with_restart_policy(RestartPolicy::Always);

        let handle = spawn_component_supervisor(config, move || {
            let c = counter_clone.clone();
            async move {
                let count = c.fetch_add(1, Ordering::SeqCst) + 1;
                if count >= 3 {
                    // 通过 abort 退出循环（模拟外部取消）
                    // 这里用 pending 让外部 abort
                    std::future::pending::<Result<(), String>>().await
                } else {
                    Ok(())
                }
            }
        });

        // 等待计数器达到 3
        loop {
            if counter.load(Ordering::SeqCst) >= 3 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        handle.abort();
        assert!(counter.load(Ordering::SeqCst) >= 3);
    }

    #[tokio::test]
    async fn supervisor_cancellation_via_abort() {
        let config = SupervisorConfig::new("test")
            .with_backoff(100, 100)
            .with_restart_policy(RestartPolicy::OnFailure);

        let handle = spawn_component_supervisor(config, || async {
            Err::<(), String>("always fail".to_string())
        });

        // 立即取消
        handle.abort();
        let result = handle.await;
        assert!(result.is_err()); // JoinError::Cancelled
    }
}
