# url-parse create

示例：

```bash
lime task create url-parse \
  --url "https://example.com/article" \
  --summary "文章摘要" \
  --key-point "观点一" \
  --key-point "观点二" \
  --extract-status ready \
  --idempotency-key "article-example"
```

输出重点：

- `task_id`
- `task_type = url_parse`
- `status`
- `normalized_status`
