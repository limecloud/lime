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

媒体任务 Phase 8 索引守卫：`image_task / image_output / audio_task / audio_output / transcript` 必须声明 `entry_key / thread_id / turn_id / content_id / modality / skill_id / model_id / cost_state / limit_state / estimated_cost_class / limit_event_kind / quota_low / executor_kind / executor_binding_key / limecore_policy_snapshot_status`。运行期 `list_media_task_artifacts.modality_runtime_contracts` 必须把 payload 中的 `entry_key / entry_source` 投影为稳定 `entry_key` 与聚合 `entry_keys`，把 `thread_id / turn_id / content_id` 投影为 snapshot 身份锚点与聚合 `thread_ids / turn_ids / content_ids`，把 `modality / skill_id / model_id` 投影为 snapshot 查询字段与聚合 `modalities / skill_ids / model_ids`，把 `cost_state / limit_state`、`runtime_summary` 与 `task_profile` 中已有的成本/限额摘要投影为 `cost_states / limit_states / estimated_cost_classes / limit_event_kinds / quota_low_count`，并把 executor binding 投影为聚合 `executor_kinds / executor_binding_keys`。这一步只稳定查询字段，不改变上层 `@` 命令触发语义，也不把本地默认 policy snapshot 伪造成云端 LimeCore 决策。

## 3. 当前索引覆盖

| Artifact kind           | 状态           | Contract                                      | 核心索引 | 领域扩展                                          |
| ----------------------- | -------------- | --------------------------------------------- | -------- | ------------------------------------------------- |
| `image_task`            | current        | `image_generation`                            | 已覆盖   | 图片任务 payload / runtime contract               |
| `image_output`          | current        | `image_generation`                            | 已覆盖   | 图片输出关联                                      |
| `audio_task`            | current        | `voice_generation`                            | 已覆盖   | `audio_output_status`                             |
| `audio_output`          | current        | `voice_generation`                            | 已覆盖   | `audio_output_status / audio_output_path`         |
| `transcript`            | partial        | `audio_transcription`                         | 已覆盖   | `transcript_*` source / language / error code     |
| `browser_session`       | partial        | `browser_control`                             | 已覆盖   | `browser_session_id / action_count / last_url`    |
| `browser_snapshot`      | partial        | `browser_control`                             | 已覆盖   | `observation_count / screenshot_count / last_url` |
| `pdf_extract`           | partial        | `pdf_extract`                                 | 已覆盖   | `source_path`                                     |
| `report_document`       | partial        | `pdf_extract / web_research / text_transform` | 已覆盖   | `source_count`                                    |
| `presentation_document` | planned        | 未进入 current                                | 已预留   | 后续 presentation contract                        |
| `webpage_artifact`      | planned        | `web_research`                                | 已预留   | `url`                                             |
| `generic_file`          | current compat | `text_transform`                              | 已覆盖   | `path`，只能兜底                                  |

## 4. 仍未宣称完成的字段

Phase 8 目标字段中，`entry_key / thread_id / turn_id / content_id / modality / skill_id / model_id / cost_state / limit_state / estimated_cost_class / limit_event_kind / quota_low / executor_kind / executor_binding_key / limecore_policy_snapshot_status` 已先在媒体任务索引中稳定：`src/lib/governance/modalityArtifactGraph.json` 的媒体 artifact kind 已声明这些字段，Rust snapshot 与浏览器 mock 也会从 task payload / runtime contract / runtime summary / task profile 回填同名查询字段和聚合维度。

Evidence Pack 侧已新增 `modalityRuntimeContracts.snapshotIndex.taskIndex`：Browser / PDF / Web Research / Text Transform / Voice Service 等非媒体 tool trace snapshot 会从 `runtime_contract`、`entry_source`、thread item、metadata、`runtime_summary` 与 `task_profile` 中提取 `thread_id / turn_id / content_id / entry_key / modality / skill_id / model_id / executor_kind / executor_binding_key / cost_state / limit_state / estimated_cost_class / limit_event_kind / quota_low`，并用同一索引对象暴露聚合数组与 `items[]`。Replay / grader 已开始消费同一 `taskIndex`：`input.json.runtimeContext.runtimeFacts.modalityTaskIndex` 会输出 compact 摘要，suite tags 会标记 `modality-task-index / modality-task-identity / modality-task-cost-limit`，`expected.json` 与 `grader.md` 会要求保留身份锚点、executor 维度与成本/限额摘要。前端已新增 `src/lib/agentRuntime/modalityTaskIndexPresentation.ts`，把 Evidence `taskIndex` 转成任务中心可复用的 facets / rows / exact filters，`src/components/agent/chat/components/HarnessTaskIndexSection.tsx` 负责消费这层查询模型展示“多模态任务索引”和内嵌“任务中心过滤列表”，按 entry / content / executor / cost / limit 过滤同一 rows；`HarnessStatusPanel` 只负责挂载该 section，不再内联 taskIndex 查询/列表逻辑。`scripts/check-modality-runtime-contracts.mjs` 已补 `task index presentation guard`，检查 helper、section 与 panel 之间的 current 边界，防止后续把任务中心过滤重新写回巨型面板或绕过共享 rows。当前审计 Evidence、Replay、客服诊断、任务中心查询消费层与媒体任务列表使用同一查询口径；这一步不新增命令、不改变上层 `@` 入口，也不把本地默认 LimeCore policy 解释成云端策略结论。

以下项仍不能宣称全量完成：

- `thread_id / turn_id / content_id / entry_key`（Evidence、Replay、Harness 诊断与任务中心过滤列表已消费同一 rows；后续只剩把相同 rows 搬到更独立的主任务中心入口）
- `modality / skill_id / model_id / executor_kind / executor_binding_key`（Evidence、Replay、Harness 诊断与任务中心过滤列表已消费同一 rows；后续只剩把相同 rows 搬到更独立的主任务中心入口）
- `cost_state / limit_state / estimated_cost_class / limit_event_kind / quota_low`（Evidence、Replay、Harness 诊断与任务中心过滤列表已消费已有摘要；更多 executor 只允许回填真实 runtime 摘要，不允许造假）
- `limecore_policy_snapshot`（媒体索引已稳定 snapshot status / decision 摘要，完整 snapshot 对象仍不作为查询字段复制）

这些字段不能用文档伪造成已完整覆盖；后续如果新增独立主任务中心入口，也必须直接消费 `modalityTaskIndexPresentation` 的 rows 与媒体任务索引，而不是另建事实源。`HarnessStatusPanel` 现在不再作为 taskIndex 查询实现点，只保留挂载面。

## 5. 下一刀建议

下一步优先做 Phase 8 收口验收：如果产品上需要独立主任务中心入口，只允许复用 `HarnessTaskIndexSection` / `modalityTaskIndexPresentation` 的 rows；否则应回到权限 enforcement、云端 policy evaluator 或 Gateway adapter 这些尚未完成的主链。
