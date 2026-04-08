//! SubAgent 调度器集成测试

#[cfg(test)]
mod integration_tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use chrono::Utc;

    use crate::agents::context::AgentContext;
    use crate::agents::subagent_scheduler::{
        SchedulerConfig, SchedulerResult, SchedulingStrategy, SubAgentExecutor, SubAgentResult,
        SubAgentScheduler, SubAgentTask,
    };

    /// 模拟执行器
    struct MockExecutor {
        call_count: AtomicUsize,
        delay_ms: u64,
    }

    impl MockExecutor {
        fn new(delay_ms: u64) -> Self {
            Self {
                call_count: AtomicUsize::new(0),
                delay_ms,
            }
        }

        fn get_call_count(&self) -> usize {
            self.call_count.load(Ordering::SeqCst)
        }
    }

    #[async_trait::async_trait]
    impl SubAgentExecutor for MockExecutor {
        async fn execute_task(
            &self,
            task: &SubAgentTask,
            _context: &AgentContext,
        ) -> SchedulerResult<SubAgentResult> {
            self.call_count.fetch_add(1, Ordering::SeqCst);

            // 模拟执行延迟
            tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;

            Ok(SubAgentResult {
                task_id: task.id.clone(),
                success: true,
                output: Some(format!("任务 {} 执行完成", task.id)),
                summary: Some(format!("摘要: {}", task.id)),
                error: None,
                duration: Duration::from_millis(self.delay_ms),
                retries: 0,
                started_at: Utc::now(),
                completed_at: Utc::now(),
                token_usage: None,
                metadata: HashMap::new(),
            })
        }
    }

    #[tokio::test]
    async fn test_single_task_execution() {
        let executor = MockExecutor::new(10);
        let scheduler = SubAgentScheduler::new(SchedulerConfig::default(), executor);

        let tasks = vec![SubAgentTask::new("task-1", "test", "测试任务")];

        let result = scheduler.execute(tasks, None).await.unwrap();

        assert!(result.success);
        assert_eq!(result.successful_count, 1);
        assert_eq!(result.failed_count, 0);
    }

    #[tokio::test]
    async fn test_parallel_execution() {
        let executor = MockExecutor::new(50);
        let config = SchedulerConfig::default().with_max_concurrency(3);
        let scheduler = SubAgentScheduler::new(config, executor);

        let tasks = vec![
            SubAgentTask::new("task-1", "test", "任务1"),
            SubAgentTask::new("task-2", "test", "任务2"),
            SubAgentTask::new("task-3", "test", "任务3"),
        ];

        let start = std::time::Instant::now();
        let result = scheduler
            .execute_with_strategy(tasks, None, SchedulingStrategy::Parallel)
            .await
            .unwrap();
        let elapsed = start.elapsed();

        assert!(result.success);
        assert_eq!(result.successful_count, 3);
        // 并行执行应该比串行快
        assert!(elapsed.as_millis() < 150);
    }

    #[tokio::test]
    async fn test_sequential_with_dependencies() {
        let executor = MockExecutor::new(10);
        let scheduler = SubAgentScheduler::new(SchedulerConfig::default(), executor);

        let tasks = vec![
            SubAgentTask::new("task-1", "explore", "分析"),
            SubAgentTask::new("task-2", "code", "实现").with_dependencies(vec!["task-1"]),
            SubAgentTask::new("task-3", "test", "测试").with_dependencies(vec!["task-2"]),
        ];

        let result = scheduler.execute(tasks, None).await.unwrap();

        assert!(result.success);
        assert_eq!(result.successful_count, 3);
    }

    #[tokio::test]
    async fn test_event_callback() {
        let executor = MockExecutor::new(10);
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();

        let scheduler = SubAgentScheduler::new(SchedulerConfig::default(), executor)
            .with_event_callback(move |event| {
                events_clone.lock().unwrap().push(format!("{:?}", event));
            });

        let tasks = vec![SubAgentTask::new("task-1", "test", "测试")];
        let _ = scheduler.execute(tasks, None).await;

        let captured_events = events.lock().unwrap();
        assert!(!captured_events.is_empty());
        // 应该有 Started 和 Completed 事件
        assert!(captured_events.iter().any(|e| e.contains("Started")));
        assert!(captured_events.iter().any(|e| e.contains("Completed")));
    }

    #[tokio::test]
    async fn test_cancel_execution() {
        let executor = MockExecutor::new(1000); // 长延迟
        let scheduler = Arc::new(SubAgentScheduler::new(SchedulerConfig::default(), executor));

        let tasks = vec![
            SubAgentTask::new("task-1", "test", "长任务1"),
            SubAgentTask::new("task-2", "test", "长任务2"),
        ];

        let scheduler_clone = scheduler.clone();
        let handle = tokio::spawn(async move { scheduler_clone.execute(tasks, None).await });

        // 等待一小段时间后取消
        tokio::time::sleep(Duration::from_millis(100)).await;
        scheduler.cancel().await;

        let result = handle.await.unwrap();
        assert!(result.is_err() || !result.unwrap().success);
    }
}
