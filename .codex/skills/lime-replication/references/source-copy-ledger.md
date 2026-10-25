# 源码复制账本

账本建议保存为 `internal/refactor/<domain>-copy-ledger.json`，产品代码只消费迁移后的 Lime owner。不要把 `.lime/verification/**` 或临时 `upstream/` 目录当成产品路径。

## 必填字段

| 字段 | 要求 |
| --- | --- |
| `source_path` | 上游仓库内相对路径；必须可回到冻结 revision |
| `destination_path` | Lime 现役目标路径；禁止永久 `upstream/`/`candidate/` |
| `source_revision` | 完整提交摘要或可复现的包摘要 |
| `source_sha256` / `destination_sha256` | 文件或归档摘要；符号链接记录 link target |
| `copy_status` | `copied` / `migrated-consumer` / `deleted-conflict` / `source-unavailable` / `blocked` |
| `owner` | 唯一 current owner；不能写“待定”后继续扩展 |
| `consumers` | 真实入口、crate、App Server、Desktop/CLI/TUI、插件或加载项 |
| `brand_action` | Lime public boundary 如何处理；协议固定名和外部署名单列 |
| `validation` | 真实命令、Gate 等级和结果文件 |
| `unknowns` | 未取得的源码、平台、运行或依赖证据 |

## 状态转换

```text
copied -> migrated-consumer -> deleted-conflict
copied -> source-unavailable
copied -> blocked
```

`copied` 只表示内容一致；只有现役消费者已切换且命令通过，才可升级为 `migrated-consumer`。删除冲突前必须有 current owner、回流守卫和执行计划退出条件。

## 品牌检查

- `destination_path`、Rust workspace member、package/bin 名称、安装产物和公开命令不得引入 `codex-rs` 或 Codex 产品根名。
- 无品牌的上游路径、文件、模块、类型和函数名默认原样复制；带品牌的外部协议值、法定署名和第三方集成契约按 [品牌边界清单](brand-boundary.md) 登记 `external-source`，不得成为 Lime 自有产品身份。
- 目标目录应直接落在 `lime-rs/crates/**`、`electron/**`、`src/**`、`extensions/**` 或已确认的 Lime owner；不能把永久源码放在 `lime-rs/upstream/**`。
