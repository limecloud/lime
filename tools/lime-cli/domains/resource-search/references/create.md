# resource-search create

示例：

```bash
lime task create resource-search \
  --resource-type image \
  --query "城市夜景" \
  --usage "封面" \
  --count 6 \
  --constraint "蓝色电影感" \
  --idempotency-key "resource-search-cover-1"
```

输出重点：

- `task_id`
- `task_type = modal_resource_search`
- `status`
- `path`
