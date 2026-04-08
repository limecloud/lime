# 后台任务模块

本模块提供完整的后台任务管理功能，包括任务队列、Shell管理、超时处理和状态持久化。

## 模块概览

### 1. 类型定义 (types.rs)

共享类型定义，包括：
- `TaskPriority` - 任务优先级 (High/Normal/Low)
- `TaskStatus` - 任务状态 (Pending/Running/Completed/Failed/Cancelled)
- `TaskType` - 任务类型 (Bash/Agent/Generic)
- `ShellStatus` - Shell 状态
- `PersistedTaskState` - 持久化任务状态
- `PersistedAgentState` - 持久化 Agent 状态

### 2. 任务队列 (task_queue.rs)

简单的任务队列实现，支持：
- FIFO 队列
- 优先级支持
- 并发控制 (默认最大10个并发任务)
- 状态管理


### 3. Shell 管理器 (shell_manager.rs)

管理后台执行的 Shell 进程：
- Shell 进程生命周期管理
- 输出流式收集 (stdout/stderr)
- 输出大小限制 (默认10MB)
- 优雅终止 (SIGTERM → SIGKILL)

### 4. 超时管理器 (timeout.rs)

任务超时管理：
- 超时时间管理 (默认120秒，最大600秒)
- 优雅终止策略
- 超时延长和重置
- 剩余时间查询

### 5. 持久化管理器 (persistence.rs)

任务状态持久化：
- 任务状态持久化 (保存到 ~/.aster/background-tasks/)
- Agent 状态持久化 (保存到 ~/.aster/agents/)
- 自动过期清理 (默认24小时)

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块入口和导出 |
| `types.rs` | 共享类型定义 |
| `task_queue.rs` | 任务队列实现 |
| `shell_manager.rs` | Shell 管理器 |
| `timeout.rs` | 超时处理 |
| `persistence.rs` | 状态持久化 |

## 使用示例

```rust
use aster::background::{
    SimpleTaskQueue, TaskQueueOptions,
    ShellManager, ShellManagerOptions,
    TimeoutManager, TimeoutConfig,
    PersistenceManager, PersistenceOptions,
};

// 创建任务队列
let queue = SimpleTaskQueue::new(TaskQueueOptions::default());

// 创建 Shell 管理器
let shell_mgr = ShellManager::new(ShellManagerOptions::default());

// 创建超时管理器
let timeout_mgr = TimeoutManager::new(TimeoutConfig::default());

// 创建持久化管理器
let persistence = PersistenceManager::new(PersistenceOptions::default()).await?;
```
