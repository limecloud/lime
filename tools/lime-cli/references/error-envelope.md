# 错误包络

错误输出默认 JSON，字段包括：

- `success`
- `error_code`
- `error_message`
- `retryable`
- `hint`
- `task_id`
- `idempotency_key`

常见错误码：

- `invalid_params`
- `task_not_found`
- `io_error`
- `task_conflict`
- `invalid_state`
- `not_retryable`
