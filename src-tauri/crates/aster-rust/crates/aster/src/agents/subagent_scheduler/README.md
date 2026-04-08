# SubAgent 调度器模块

基于 Anthropic 最佳实践实现的 SubAgent 调度系统。

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    主 Agent (Orchestrator)                   │
│  - 全局规划和任务分解                                          │
│  - 维护全局状态和上下文摘要                                     │
│  - 协调子 Agent 执行顺序                                       │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   SubAgent A    │ │   SubAgent B    │ │   SubAgent C    │
│  独立上下文窗口  │ │  独立上下文窗口  │ │  独立上下文窗口  │
│  专注单一任务    │ │  专注单一任务    │ │  专注单一任务    │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             ▼
                    精炼摘要返回主 Agent
                   (1,000-2,000 tokens)
```

## 核心组件

| 文件 | 说明 |
|------|------|
| `types.rs` | 核心类型定义（任务、结果、进度、事件） |
| `config.rs` | 调度器配置（并发数、超时、重试策略） |
| `strategy.rs` | 调度策略选择器（自适应、并行、串行） |
| `summary.rs` | 结果摘要生成器 |
| `executor.rs` | 核心调度执行器 |

## 使用示例

```rust
use aster::agents::subagent_scheduler::{
    SubAgentScheduler, SchedulerConfig, SubAgentTask,
};

// 创建执行器（需要实现 SubAgentExecutor trait）
let executor = MyExecutor::new();

// 创建调度器
let config = SchedulerConfig::default();
let scheduler = SubAgentScheduler::new(config, executor);

// 定义任务
let tasks = vec![
    SubAgentTask::new("task-1", "explore", "分析项目结构"),
    SubAgentTask::new("task-2", "code", "实现功能 A"),
    SubAgentTask::new("task-3", "test", "编写测试")
        .with_dependencies(vec!["task-2"]),
];

// 执行任务
let result = scheduler.execute(tasks, None).await?;
```

## 调度策略

- **SingleAgent**: 单任务直接执行
- **Sequential**: 串行执行（有依赖关系）
- **Parallel**: 并行执行（独立任务）
- **BreadthFirst**: 广度优先（研究任务）
- **Adaptive**: 自动选择最优策略

## 配置选项

```rust
SchedulerConfig {
    max_concurrency: 5,        // 最大并发数
    default_timeout: 5min,     // 默认超时
    retry_on_failure: true,    // 失败重试
    max_retries: 3,            // 最大重试次数
    stop_on_first_error: false,// 首错停止
    auto_summarize: true,      // 自动摘要
}
```

## 事件回调

```rust
scheduler.with_event_callback(|event| {
    match event {
        SchedulerEvent::TaskStarted { task_id, .. } => { ... }
        SchedulerEvent::TaskCompleted { task_id, .. } => { ... }
        SchedulerEvent::Progress(progress) => { ... }
        _ => {}
    }
});
```
