# 任务生命周期

## 规范状态

- `pending`
- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

## 当前文件记录中的原始状态

- `pending_submit` 会被归一为 `pending`
- `queued` 保持不变
- `processing` / `in_progress` 会被归一为 `running`
- `completed` / `success` 会被归一为 `succeeded`

## 操作建议

- 创建后立即使用 `lime task status <task-id>`
- 查看队列时使用 `lime task list --status queued`
- 失败任务通过 `lime task retry <task-id>` 创建新尝试
