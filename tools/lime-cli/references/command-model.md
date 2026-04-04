# 命令模型

## 主命令

- `lime task create <domain> ...`
- `lime task status <task-id>`
- `lime task list`
- `lime task retry <task-id>`
- `lime task cancel <task-id>`
- `lime task result <task-id>`
- `lime skill list`
- `lime skill show <name>`
- `lime doctor`

## 输出约定

- 标准输出默认 JSON
- 标准错误默认结构化错误 JSON
- 所有任务命令都应返回 `task_id`、`task_type`、`status`、`path`

## 兼容入口

- 保留 `lime media image|cover|video generate` 作为兼容别名
- 新主线统一收敛到 `lime task create ...`
