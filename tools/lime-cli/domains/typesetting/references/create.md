# typesetting create

示例：

```bash
lime task create typesetting \
  --target-platform xiaohongshu \
  --content "原文内容" \
  --rule "短段落" \
  --rule "保留原意" \
  --idempotency-key "typesetting-xhs-article-1"
```

输出重点：

- `task_id`
- `task_type = typesetting`
- `status`
- `path`
