---
name: lime-cli
description: Lime CLI 平台技能，统一任务创建、状态查询、重试、队列与幂等语义。
---

# Lime CLI

## 何时使用

- 需要把业务能力从 GUI 或内部 API 中解耦出来时
- 需要让 Agent 通过 `Bash` 显式执行任务时
- 需要结构化 JSON、可测试、可排队、可重试、可幂等的任务边界时

## 优先命令

- `lime task create <domain> ...`
- `lime task status <task-id>`
- `lime task list --status failed`
- `lime task retry <task-id>`
- `lime task cancel <task-id>`
- `lime task result <task-id>`
- `lime skill list`
- `lime skill show <domain>`
- `lime doctor`

## 执行规则

- 默认输出 JSON，不要依赖自然语言解析。
- 创建任务时，优先带 `--idempotency-key`，避免重复提交。
- 遇到失败时先看 `retryable`、`hint`、`status` 字段。
- 需要业务域细节时，继续看 `references/` 或各域目录下的 `SKILL.md`。
