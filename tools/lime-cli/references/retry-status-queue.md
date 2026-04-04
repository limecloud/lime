# 重试、状态与队列

## 状态查询

- 单任务：`lime task status <task-id>`
- 批量查看：`lime task list`
- 按状态过滤：`lime task list --status failed`

## 重试

- 只允许对 `failed` 或 `cancelled` 的任务执行 `retry`
- `retry` 会创建新的任务记录
- 新任务会保留原输入，并记录 `source_task_id`

## 队列观察

- `queued` 表示任务已进入待处理状态
- 列表结果应作为 Agent 的事实源，不依赖额外自然语言解释
