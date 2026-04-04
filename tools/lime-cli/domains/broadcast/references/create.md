# broadcast create

示例：

```bash
lime task create broadcast \
  --title "AI 周报" \
  --content "原文内容" \
  --audience "开发者" \
  --tone "理性" \
  --duration-hint-minutes 8 \
  --idempotency-key "broadcast-ai-weekly"
```

输出重点：

- `task_id`
- `task_type = broadcast_generate`
- `status`
- `path`
