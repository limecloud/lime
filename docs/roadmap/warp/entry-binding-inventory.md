# Phase 7 Entry Binding Inventory

> 目标：把上层 `@` 命令、按钮和 Scene 入口收成可机器检查的 entry binding，确保入口只补 launch metadata，不直接写 task、artifact、viewer、model routing、permission profile 或 LimeCore policy。

## 1. 当前事实源

- 事实源：`src/lib/governance/modalityRuntimeContracts.json`
- 守卫：`scripts/check-modality-runtime-contracts.mjs`
- 验证入口：`npm run governance:modality-contracts`

Entry binding 嵌在对应底层 contract 的 `bound_entries[]` 中；contract 本身才拥有 `truth_source / artifact_kinds / viewer_surface / evidence_events / executor_binding / routing_slot`。

## 2. Phase 7 验收口径

1. 每个 `current` contract 至少有一个 entry binding。
2. `entry_key` 在全 registry 内唯一。
3. `entry_source` 必须引用同一 contract 下的某个 `entry_key`，允许按钮或别名复用主入口来源。
4. `launch_metadata_path` 必须停留在 `harness.*`。
5. Entry binding 不得携带底层字段：`truth_source`、`artifact_kinds`、`viewer_surface`、`evidence_events`、`executor_binding`、`routing_slot`。
6. Scene entry 只有在 contract 显式声明 `client_scenes` 或 `scene_policy` policy ref 后才允许登记。

## 3. Current entry binding 清单

| Contract | 代表入口 | 已绑定入口 | 当前结论 |
| --- | --- | --- | --- |
| `image_generation` | `@配图` | `at_image_command`、`at_poster_command`、`at_image_edit_command`、`at_image_variation_command`、`at_storyboard_command`、`document_inline_image_action`、`image_workbench_followup_action` | current |
| `browser_control` | `@浏览器` | `at_browser_command`、`at_browser_agent_command`、`at_mini_tester_command`、`at_web_scheduler_command`、`at_web_manage_command` | current |
| `pdf_extract` | `@读PDF` | `at_pdf_read_command` | current |
| `voice_generation` | `@配音` | `at_voice_command` | current |
| `audio_transcription` | `@转写` | `at_transcription_command` | current |
| `web_research` | `@搜索` | `at_search_command`、`at_deep_search_command`、`at_site_search_command`、`at_report_command`、`at_competitor_command` | current |
| `text_transform` | `@总结` | `at_file_read_command`、`at_summary_command`、`at_translation_command`、`at_analysis_command`、`at_publish_compliance_command`、`at_logo_decomposition_command` | current |

这些入口均只声明 `entry_key / entry_kind / display_name / launch_metadata_path / entry_source / default_input_mapping / entry_visibility_policy`，不拥有底层事实源字段。

## 4. `/scene-key` 结论

`/scene-key` 暂不登记为 current entry binding。

原因：Scene 入口的目录事实源必须来自 LimeCore `client/scenes` 或 `bootstrap.sceneCatalog`，且 cloud run / scene policy 需要进入显式 audit；当前主线只完成了 policy ref / hit / evaluator seam，没有把 Scene catalog 注册成 current contract。

当前分类：`planned`，不是 `compat`，也不是 `current`。

退出条件：当 LimeCore `client_scenes / scene_policy` 命中值、Scene catalog fallback、Scene run audit 与对应 contract 都进入同一 registry 后，才能新增 `entry_kind=scene` 的 binding。

## 5. 下一步

Phase 7 不继续批量扩张 `@` 命令。下一步进入 Phase 8：把任务索引与复盘统一到 `contract_key / entry_key / executor / artifact / policy / evidence` 可查询主链。
