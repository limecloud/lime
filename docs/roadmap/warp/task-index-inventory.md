# Phase 8 Task Index Inventory

> 目标：把多模态任务、产物、复盘和审计收敛到同一条可查询索引主链，避免任务中心、Evidence、Replay、客服诊断各自建立事实源。

## 1. 当前事实源

- 领域产物索引声明：`src/lib/governance/modalityArtifactGraph.json` 的 `artifact_kinds[].task_index_fields`
- 运行期媒体任务索引：`list_media_task_artifacts.modality_runtime_contracts`
- 审计事实源：Evidence Pack `modalityRuntimeContracts.snapshotIndex`
- 复盘事实源：Replay case `runtimeFacts` 与 `modalityContractChecks`
- 守卫：`scripts/check-modality-runtime-contracts.mjs`
- 验证入口：`npm run governance:modality-contracts`

## 2. Phase 8 最低机器验收

所有 `current` / `partial` artifact kind 的 `task_index_fields` 必须包含稳定核心字段：

1. `task_id`
2. `contract_key`
3. `artifact_kind`
4. `status`
5. `created_at`
6. `updated_at`

同时，`task_index_fields` 不允许重复字段。这个守卫保证 task index 至少能按任务、合同、产物类型、状态和时间恢复，不会退回只能打开隐藏 JSON 的人工排查。

## 3. 当前索引覆盖

| Artifact kind | 状态 | Contract | 核心索引 | 领域扩展 |
| --- | --- | --- | --- | --- |
| `image_task` | current | `image_generation` | 已覆盖 | 图片任务 payload / runtime contract |
| `image_output` | current | `image_generation` | 已覆盖 | 图片输出关联 |
| `audio_task` | current | `voice_generation` | 已覆盖 | `audio_output_status` |
| `audio_output` | current | `voice_generation` | 已覆盖 | `audio_output_status / audio_output_path` |
| `transcript` | partial | `audio_transcription` | 已覆盖 | `transcript_*` source / language / error code |
| `browser_session` | partial | `browser_control` | 已覆盖 | `browser_session_id / action_count / last_url` |
| `browser_snapshot` | partial | `browser_control` | 已覆盖 | `observation_count / screenshot_count / last_url` |
| `pdf_extract` | partial | `pdf_extract` | 已覆盖 | `source_path` |
| `report_document` | partial | `pdf_extract / web_research / text_transform` | 已覆盖 | `source_count` |
| `presentation_document` | planned | 未进入 current | 已预留 | 后续 presentation contract |
| `webpage_artifact` | planned | `web_research` | 已预留 | `url` |
| `generic_file` | current compat | `text_transform` | 已覆盖 | `path`，只能兜底 |

## 4. 仍未宣称完成的字段

Phase 8 目标字段中的以下项当前只在部分链路、metadata 或 Evidence/Replay 中可见，还没有统一成所有 artifact kind 的稳定 task index 字段：

- `thread_id`
- `turn_id`
- `content_id`
- `entry_key`
- `modality`
- `skill_id`
- `model_id`
- `executor_kind`
- `cost_state`
- `limit_state`
- `limecore_policy_snapshot`

这些字段不能用文档伪造成已完整覆盖；后续应逐步从现有 `runtime_contract`、`entry_source`、`task_profile`、`limecore_policy_snapshot` 与 Evidence `snapshotIndex` 中回填到统一 task index。

## 5. 下一刀建议

下一步优先把 `entry_source` 归一为可查询 `entry_key`，并把 `executor_kind / executor_binding_key / limecore_policy_snapshot` 从 `list_media_task_artifacts.modality_runtime_contracts.snapshots[]` 提升为稳定 task index 查询维度。
