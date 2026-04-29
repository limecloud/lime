# Lime 多模态运行合同实施计划

## 摘要

本计划承接 `docs/roadmap/warp/`，用于把 Warp / ClaudeCode 参考落成 Lime 可检查的底层多模态运行合同。

本轮主目标不是先改 `@` 命令，而是先建立：

1. 底层运行事实源地图
2. `ModalityRuntimeContract` schema
3. 可机器检查的 contract registry
4. 最小治理守卫

## 主线声明

从现在开始，多模态能力默认向下面这条 current 主链收敛：

```text
runtime identity
  -> ModalityRuntimeContract
  -> capability matrix
  -> ModalityExecutionProfile
  -> executor binding
  -> domain artifact graph
  -> evidence / replay / task index
  -> viewer
  -> entry binding
```

`@` 命令、按钮、Scene 只允许作为上层 entry binding，不能直接拥有 task、model、artifact、viewer 或 evidence 的事实写入权。

## 当前阶段

### Phase 0：底层运行事实源盘点

状态：进行中。

本阶段输出：

1. `docs/roadmap/warp/runtime-fact-map.md`
2. 底层 fact source 的 `current / compat / deprecated / dead` 分类
3. 后续 contract registry 的 owner / reader / writer 约束

### Phase 1：ModalityRuntimeContract schema

状态：进行中。

本阶段输出：

1. `docs/roadmap/warp/contract-schema.md`
2. `src/lib/governance/modalityRuntimeContracts.json`
3. `scripts/check-modality-runtime-contracts.mjs`
4. `npm run governance:modality-contracts`

### Phase 2：多模态能力矩阵

状态：进行中。

本阶段输出：

1. `docs/roadmap/warp/capability-matrix.md`
2. `src/lib/governance/modalityCapabilityMatrix.json`
3. contract 守卫检查 `required_capabilities` 与 `routing_slot` 是否引用已登记能力和模型角色

### Phase 7：上层入口绑定

状态：进行中。

本阶段输出：

1. `image_generation.bound_entries` 先登记 `@配图`、`@海报`、`@修图`、`@重绘`、`@分镜` 与显式图片动作。
2. 前端图片 launch 从 `ModalityRuntimeContract` registry 读取 contract 字段，不再在入口文件重复维护底层 contract 常量。
3. 守卫要求 entry binding 声明 `entry_source` 且 `launch_metadata_path` 保持在 `harness.*`。

### Phase 8：Browser Assist 底层合同注入

状态：进行中。

本阶段输出：

1. `browser_control` 先作为底层 Browser Assist 运行合同进入 `harness.browser_assist`，不新增独立 browser task 协议。
2. `@浏览器 / @Browser Agent / @Mini Tester` 仍保留原始用户消息，只把 `browser_requirement`、launch URL 与 contract snapshot 交给后端 runtime 决策。
3. `browser_control.bound_entries` 暂不扩展；`@` 命令只是入口层，不能成为底层 contract 事实源。
4. 后端 `BrowserAssistRuntimeHint` 必须解析并保留 `browser_control` 合同快照，browser tool result metadata 需要携带同一组 contract 字段。
5. Evidence Pack 从 browser tool timeline metadata 导出 `browser_control` 的 `modalityRuntimeContracts`，使浏览器动作也进入 replay 可用的事实源。
6. Replay / grader 必须把 `browser_control` 识别成 Browser Assist 回归样本，检查 browser action trace、禁止 WebSearch 替代真实浏览器动作。

### Phase 9：PDF Extract 底层合同注入

状态：进行中。

本阶段输出：

1. `pdf_extract` 作为文档型底层运行合同进入 `harness.pdf_read_skill_launch.pdf_read_request`，`@读PDF` 仅保留为 entry source。
2. 前端 `@读PDF` 发送时保留原始消息，并注入 `modality_contract_key=pdf_extract`、`required_capabilities`、`routing_slot=base_model` 与 `runtime_contract` 快照。
3. 后端 `prepare_pdf_read_skill_launch_request_metadata` 必须补齐并保留同一组合同字段，避免旧客户端或缺省 metadata 退回普通聊天总结。
4. `Skill(pdf_read)` prompt 必须显式要求真实读取文件、保留合同字段，并禁止 `frontend_direct_pdf_parse` / `generic_chat_summary_only` 偏航。
5. Evidence Pack 必须能从 `Skill(pdf_read)` timeline metadata 导出 `pdf_extract` 的 `modalityRuntimeContracts`，使 PDF 读取不再只停留在入口 prompt 合同里。
6. Replay / grader 必须把 `pdf_extract` 识别成 PDF 读取回归样本，检查 `Skill(pdf_read)` / 文件读取 trace，并禁止 WebSearch、ToolSearch、Grep 或普通聊天替代真实读取。
7. 本阶段暂不把 PDF 单独建成 task artifact 协议；如果后续需要 PDF viewer / artifact UI，再从同一份 `pdf_extract` contract 继续下沉，不能新增平行事实源。
8. 完成底层闭环后，`@读PDF / @pdf / @read_pdf` 只登记为 `pdf_extract.bound_entries`，前端从 registry 读取 `entry_source`，不再把入口当作运行合同事实源。

### Phase 10：Voice Generation 服务型合同注入

状态：进行中。

本阶段输出：

1. `voice_generation` 作为音频型底层运行合同进入 `harness.service_scene_launch.service_scene_run`，`@配音` 仅保留为 entry source。
2. 前端 `@配音 / @voice / @dubbing` 发送时保留原始消息，并注入 `modality_contract_key=voice_generation`、`required_capabilities`、`routing_slot=voice_generation_model` 与 `runtime_contract` 快照。
3. 后端 `prepare_service_scene_launch_request_metadata` 对 `scene_key=voice_runtime` / `entry_source=at_voice_command` 的旧客户端 metadata 补齐同一组合同字段。
4. 服务型场景 prompt 必须显式说明当前底层合同，禁止退回 `legacy_tts_test_command` 或伪造“云端已提交”。
5. Evidence Pack 必须能从 voice runtime / service scene timeline args 或 metadata 导出 `voice_generation` 的 `modalityRuntimeContracts`，使配音合同进入 replay 可评分事实源。
6. Replay / grader 必须把 `voice_generation` 识别成本地 ServiceSkill/voice runtime 回归样本，检查 `service_scene_launch(scene_key=voice_runtime)` 或后续 audio_task/audio_output 证据，并禁止 `legacy_tts_test_command`、伪造云端提交、普通聊天文本或通用文件卡替代。
7. 本阶段新增最小 `audio_generate` task artifact 协议，把 `voice_generation` 写入标准 `audio_task/audio_output` 产物；`audio viewer` 与真实音频 worker 继续后置，避免提前拆出第二套音频执行事实源。

### Phase 11：Web Research 合同注入

状态：进行中。

本阶段输出：

1. `web_research` 作为混合型底层运行合同进入 `harness.research_skill_launch.research_request`、`harness.deep_search_skill_launch.deep_search_request`、`harness.site_search_skill_launch.site_search_request` 与 `harness.report_skill_launch.report_request`。
2. `@搜索 / @深搜 / @站点搜索 / @研报 / @竞品` 仅保留为 entry source；前端发送时注入 `modality_contract_key=web_research`、`required_capabilities`、`routing_slot=report_generation_model` 与 `runtime_contract` 快照。
3. 后端 `prepare_*_skill_launch_request_metadata` 需要为旧客户端或缺省 metadata 补齐同一组合同字段，避免回退成模型记忆回答、本地文件搜索或通用 WebSearch 旁路。
4. research / deep search prompt 必须显式要求首刀 `Skill(research)`，site search prompt 必须说明它是 `web_research` 合同下的站点搜索子入口且首刀 `Skill(site_search)`。
5. Evidence Pack 必须能从 `Skill(research)` / `Skill(site_search)` / `Skill(report_generate)` timeline args 或 metadata 导出 `web_research` 的 `modalityRuntimeContracts`，使联网研究进入 replay 可评分事实源。
6. Evidence Pack 的 `modalityRuntimeContracts.snapshotIndex` 必须提供可检索摘要：按 contract key、source、routing outcome、expected routing slot 与 tool trace 汇总，使联网研究不只能靠 raw snapshots 人工查找。
7. Replay / grader 必须把 `web_research` 识别成联网研究回归样本，检查 `Skill(research)` / `Skill(site_search)` / `Skill(report_generate)`、`search_query` / `lime_site_*` 工具时间线，并禁止模型记忆、本地文件搜索、ToolSearch 或通用 WebSearch 旁路替代真实研究。
8. 本阶段不新增独立 `report_generation` contract；`@研报 / @竞品` 先作为 `web_research` 下的报告型子入口，后续只有当 report artifact、执行器或 viewer 形成独立事实源时才拆子合同。

### Phase 12：Text Transform 合同注入

状态：进行中。

本阶段输出：

1. `text_transform` 作为文档型底层运行合同进入 `harness.summary_skill_launch.summary_request`、`harness.translation_skill_launch.translation_request` 与 `harness.analysis_skill_launch.analysis_request`。
2. `@读文件 / @总结 / @翻译 / @分析 / @发布合规 / @Logo拆解` 仅保留为 entry source；前端发送时注入 `modality_contract_key=text_transform`、`required_capabilities`、`routing_slot=base_model` 与 `runtime_contract` 快照。
3. 后端 `prepare_*_skill_launch_request_metadata` 需要为旧客户端或缺省 metadata 补齐同一组合同字段，避免回退成前端直出文本、ToolSearch、WebSearch 或普通聊天摘要。
4. summary / translation / analysis prompt 必须显式要求首刀 `Skill(summary)` / `Skill(translation)` / `Skill(analysis)`，显式文件路径场景可保留 `list_directory` / `read_file` 证据，但不能绕过底层合同。
5. Evidence Pack 必须能从 `Skill(summary)` / `Skill(translation)` / `Skill(analysis)` timeline args 或 metadata 导出 `text_transform` 的 `modalityRuntimeContracts`，使轻量文本/文档转换也进入 replay 可评分事实源。
6. Replay / grader 必须把 `text_transform` 识别成文本转换回归样本，检查文本转换 Skill trace 与必要文件读取证据，并禁止 `frontend_direct_text_transform`、ToolSearch、WebSearch 或普通聊天替代。
7. 本阶段不拆 `summary_generation`、`translation`、`analysis`、`publish_compliance` 或 `logo_decomposition` 平行 contract；只有当独立 artifact、执行器或 viewer 形成稳定事实源时才拆子合同。

## 本轮最小闭环

第一轮已完成治理底座；当前纠偏后的最小闭环必须至少贯通一个真实运行时 vertical slice。

### 已完成治理底座

1. 新增 runtime fact map 文档。
2. 新增 contract schema 文档。
3. 新增首批底层 contract registry。
4. 新增 contract 校验脚本。
5. 接入 npm 脚本，作为后续 `verify:local` 集成前的显式检查入口。

### 当前实现闭环

1. 选择 `image_generation` 作为第一条 current vertical slice。
2. Rust 运行时在 `harness.image_skill_launch` 与内部 `image_task` 上注入 `modality_contract_key=image_generation`、`modality=image`、`required_capabilities`、`routing_slot` 与 `runtime_contract` 快照。
3. `lime_create_image_generation_task` 工具 schema、别名归一化与 request builder 接受并补齐 contract 字段。
4. `image_generate` task artifact payload 固化同一组 contract 字段，artifact 成为图片生成 contract 的 truth source。
5. DevBridge / browser mock 与前端 `CreateImageGenerationTaskArtifactRequest` 类型同步 contract 字段，避免浏览器链路变成假绿。
6. 图片工作台 viewer 从 task artifact / 工作台状态读取 `runtimeContract`，展示“按合同路由 / 合同阻止 / registry 能力缺口”。
7. `browser_control` 第九刀从 registry 解析 `browser_reasoning_model` 合同，并写入 `harness.browser_assist`，使 Browser Assist 首刀能看到 `modality_contract_key=browser_control`、`required_capabilities`、`routing_slot` 与 `runtime_contract` 快照。
8. `browser_control` 第十/十一刀在 Rust 侧解析同一份合同，并把 browser tool timeline metadata 纳入 evidence `modalityRuntimeContracts`，不再只停留在前端 request metadata。
9. `browser_control` 第十二刀把 evidence 快照继续写入 replay tags / expected checks / grader，要求回放继续走 Browser Assist、产生 browser action trace，并显式禁止 WebSearch 替代。
10. `pdf_extract` 第十三刀把 `@读PDF` 上层入口接到底层 `Skill(pdf_read)` 运行合同，前端和 Rust 侧都会保留同一份 contract snapshot。
11. `pdf_extract` 第十四刀把 `Skill(pdf_read)` timeline metadata 纳入 evidence `modalityRuntimeContracts`，并让 replay / grader 继续检查 PDF 读取 trace，形成入口 -> executor -> evidence -> replay 的闭环。
12. `pdf_extract` 第十五刀把 `@读PDF / @pdf / @read_pdf` 收为 registry entry binding，前端发送只消费 registry 派生的 `entry_source`，入口层不再拥有底层 contract 常量。
13. `voice_generation` 第十六刀把 `@配音` 服务型入口接到底层 `voice_runtime` 运行合同，前端与 Rust prompt 侧都会保留同一份 contract snapshot。
14. `voice_generation` 第二十二刀把 voice runtime / service scene timeline args 或 metadata 纳入 evidence `modalityRuntimeContracts`，并让 replay / grader 继续检查 `service_scene_launch(scene_key=voice_runtime)` 或后续 audio_task/audio_output 证据。
15. `web_research` 第十七刀把 `@搜索 / @深搜 / @站点搜索` 收为 registry entry binding，并把三条 research launch metadata 与 Rust prompt 收敛到同一份 `web_research` contract snapshot。
16. `web_research` 第十八刀把 `Skill(research)` / `Skill(site_search)` tool timeline args 或 metadata 纳入 evidence `modalityRuntimeContracts`，并让 replay / grader 继续检查联网研究 executor trace，形成入口 -> executor -> evidence -> replay 的闭环。
17. `web_research` 第十九刀把 evidence `modalityRuntimeContracts` 从 raw snapshots 扩展为 `snapshotIndex`，提供 contract/source/routing/tool trace 汇总，使联网研究合同进入可检索索引层。
18. `web_research` 第二十刀把 `@研报 / @竞品` 收为报告型子入口：入口仍走 `report_skill_launch -> Skill(report_generate)`，底层合同、evidence、replay 统一归入 `web_research`。
19. `text_transform` 第二十一刀把 `@读文件 / @总结 / @翻译 / @分析 / @发布合规 / @Logo拆解` 收为文本/文档转换子入口：入口仍分别走 `summary_skill_launch`、`translation_skill_launch`、`analysis_skill_launch`，底层合同、evidence、replay 统一归入 `text_transform`。
20. `voice_generation` 第二十三刀新增最小 `audio_generate` artifact protocol：`create_audio_generation_task_artifact` / `lime_create_audio_generation_task` 写入标准 `audio_task/audio_output` payload，前端 API、DevBridge mock、task index、evidence pack 与 replay grader 都消费同一份 `voice_generation` 合同快照。

暂不做：

1. 暂不把所有 `@`、按钮、Scene 批量登记到 `bound_entries`；本轮只绑定 `image_generation` 第一条 vertical slice。
2. 暂不把 LimeCore 写成默认执行器；LimeCore 仍只作为 catalog / policy / offer / audit 控制面。
3. 暂不批量改造视频、语音、PDF、搜索等其他 viewer；先让 `image_generation` vertical slice 收口。
4. 暂不新增 PDF task artifact / reader viewer；PDF 本轮只收 executor trace、evidence 和 replay，避免在底层事实源未完全稳定前再开一套产物协议。
5. 暂不新增 audio viewer / 真实音频 worker；voice 本轮只落最小 `audio_generate` artifact protocol，不伪造云端提交，也不把普通聊天文本或通用文件卡当作音频产物。
6. 暂不新增独立 `report_generation` 合同；`@研报 / @竞品` 继续走 `report_skill_launch -> Skill(report_generate)` 主链，但其底层能力归属先收敛到 `web_research`，避免把 report artifact 协议提前扩张成第二套事实源。
7. 暂不新增独立 `summary_generation`、`translation`、`analysis`、`publish_compliance` 或 `logo_decomposition` 合同；这组轻量文本/文档转换入口先统一收敛到 `text_transform`，避免把上层 `@` 命令提前扩张成平行底层事实源。

## 分类

### current

- `ModalityRuntimeContract`
- `runtime fact map`
- `domain artifact graph`
- `execution profile`
- `capability matrix`
- `evidence pack`
- `LimeCore catalog / policy` 作为云控制面

### compat

- 旧 `@` 命令 metadata，只能绑定到底层 contract
- 旧 `generic_file` 展示，只能作为兜底 artifact kind
- 旧本地 CLI adapter，只能作为 typed `local_cli` executor

### deprecated

- 入口直接创建多模态 task
- viewer 自己猜 artifact 类型
- skill 内部自由选择 Bash / WebSearch / ToolSearch 作为首刀

### dead

- 把 LimeCore 当成所有多模态入口的默认执行器
- 用 `@` 命令名作为底层 contract 主键
- 用通用文件卡承载所有多模态结果

## 进度日志

- 2026-04-29：创建本计划；固定本轮从 Phase 0/1 开始，先做底层 fact map、contract schema 和轻量守卫，不改上层 `@` 命令。
- 2026-04-29：已新增 `runtime-fact-map.md`、`contract-schema.md`、`modalityRuntimeContracts.json` 与 `check-modality-runtime-contracts.mjs`；首批 5 个 current contract 为 `image_generation`、`browser_control`、`pdf_extract`、`voice_generation`、`web_research`，`bound_entries` 暂为空，等待 Phase 7 再接上层入口。
- 2026-04-29：已接入 `npm run governance:modality-contracts` 并通过；同时通过 `npm run harness:doc-freshness`、脚本语法检查和本轮触达 Markdown 链接 / code fence 检查。
- 2026-04-29：继续推进 Phase 2，新增 `capability-matrix.md` 与 `modalityCapabilityMatrix.json`；首批登记 13 个 capability 与 9 个 model role，并扩展 contract 守卫校验 `required_capabilities` / `routing_slot` 引用关系。
- 2026-04-29：已把 `npm run governance:modality-contracts` 接入 `npm run test:contracts`；`test:contracts`、`harness:doc-freshness`、脚本语法检查与本轮触达 Markdown 链接 / code fence 检查通过。
- 2026-04-29：开始真实运行时实现，完成 `image_generation` vertical slice 第一刀：`prepare_image_skill_launch_request_metadata` 注入底层 contract，`lime_create_image_generation_task` request builder / schema 补齐 contract 字段，`create_image_generation_task_artifact_inner` 将 `modality_contract_key`、`required_capabilities`、`routing_slot`、`runtime_contract` 写入 `image_generate` artifact payload，并补 Rust / TS 定向断言。
- 2026-04-29：验证通过 `npm run test:contracts`、`npm test -- src/components/agent/chat/workspace/useWorkspaceImageWorkbenchActionRuntime.test.tsx src/lib/tauri-mock/core.test.ts`、`npm run typecheck`，并通过 `CARGO_TARGET_DIR=src-tauri/target/codex-modality-contract cargo test --manifest-path src-tauri/Cargo.toml test_prepare_image_skill_launch_request_metadata_materializes_input_refs`；继续补跑图片 artifact / tool request Rust 定向测试时，当前工作区已有 `src-tauri/crates/agent/src/session_store.rs` 编译错误阻断，错误点不属于本轮 `image_generation` contract 改动。
- 2026-04-29：继续 `image_generation` vertical slice 第二刀：在图片任务 worker 进入 `lime_media_runtime::execute_image_generation_task_with_hook` 前读取 task artifact 的 contract / required capabilities / routing slot，并对明显文本模型候选（例如 `gpt-5.2`）输出 `image_generation_model_capability_gap`，阻止 contract 要求的图片生成任务误路由到普通文本模型。
- 2026-04-29：第二刀验证通过 `npm run test:contracts` 与 `npm run typecheck`；Rust 定向测试 `CARGO_TARGET_DIR=src-tauri/target/codex-modality-contract cargo test --manifest-path src-tauri/Cargo.toml validate_image_generation_task_execution_contract_should_reject_text_model_candidate` 被当前工作区已有 `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs` 缺少 `AgentRuntimeSessionHistoryCursor` import 的编译错误阻断，未继续扩大范围修 unrelated 编译债。
- 2026-04-29：已用最小 import 修复 `runtime_api.rs` 的 `AgentRuntimeSessionHistoryCursor` 编译阻塞，并补通 `image_generation` preflight 的 Rust 定向验证：明显文本模型会被 `image_generation_model_capability_gap` 阻止，`gpt-image-1` 类图片模型候选可通过。
- 2026-04-29：继续 `image_generation` vertical slice 第三刀：`runtime_evidence_pack_service` 现在会从 `.lime/tasks/image_generate/*.json` 提取 `ModalityRuntimeContract` 与 routing 决策快照，写入 `runtime.json` / `artifacts.json` 的 `modalityRuntimeContracts`，并把 `modalityRuntimeContract` 纳入 `observabilitySummary.signalCoverage`；当 preflight 失败时，evidence 中可直接看到 `routingEvent=routing_not_possible`、`routingOutcome=blocked`、`failureCode=image_generation_model_capability_gap`。
- 2026-04-29：第三刀验证通过 `CARGO_TARGET_DIR=src-tauri/target/codex-modality-contract cargo test --manifest-path src-tauri/Cargo.toml should_export_modality_runtime_contract_snapshot_from_failed_image_task`、`validate_image_generation_task_execution_contract_should_accept_image_model_candidate`、`should_export_auxiliary_runtime_snapshots_from_image_task_artifact`、`npm run test:contracts`、`npm run typecheck` 与 `git diff --check`。
- 2026-04-29：继续 `image_generation` vertical slice 第四刀：`runtime_replay_case_service` 现在从 evidence `runtime.json` 读取 `modalityRuntimeContracts`，写入 replay `input.json` / `expected.json` / `grader.md` / `evidence-links.json`；同时把 `modality-runtime-contract`、`modality-image_generation`、`routing-not-possible` 纳入 suite tags，把 `modality_contract_routing_blocked` 与 `image_generation_model_capability_gap` 纳入 failure modes，并在 grader 中增加“多模态运行合同检查”，使模型误路由样本可被回归评分而不是只停留在 evidence 里。
- 2026-04-29：第四刀验证通过 `CARGO_TARGET_DIR=src-tauri/target/codex-modality-contract cargo test --manifest-path src-tauri/Cargo.toml should_carry_modality_runtime_contract_into_replay_case`、`should_export_runtime_replay_case_to_workspace`、`npm run test:contracts` 与 `git diff --check`。
- 2026-04-29：继续 `image_generation` vertical slice 第五刀：图片任务 worker 的模型能力 preflight 从纯字符串启发式推进到 `ModelRegistryState` / `EnhancedModelMetadata`，优先按 `task_families` 与 `output_modalities` 判断 `ImageGeneration` / `ImageEdit` / `Image` 输出能力；只有 registry 找不到模型时才回退到文本模型启发式，避免 `gpt-5.2` 这类普通文本模型误进图片执行器，同时允许 registry 明确声明的图片模型通过。
- 2026-04-29：第五刀进一步把 registry 判定结果持久化为 `image_generate` task payload 的 `model_capability_assessment`，并同步进入 evidence `modalityRuntimeContracts.snapshots[].modelCapabilityAssessment` 与 replay 的 `modalityContractChecks`，让后续回归能区分 `model_registry` 判定和 heuristic fallback，而不是只看到最终失败码。
- 2026-04-29：第五刀验证通过 `CARGO_TARGET_DIR=src-tauri/target/codex-modality-contract cargo test --manifest-path src-tauri/Cargo.toml assess_image_generation_model_capability_should_use_output_modality`、`assess_image_generation_model_capability_should_reject_registered_text_model`、`assess_image_generation_model_capability_should_match_provider_model_id`、`validate_image_generation_task_execution_contract_should_reject_registry_text_model`、`validate_image_generation_task_execution_contract_should_trust_registry_image_model`、`patch_image_task_model_capability_assessment_should_persist_registry_snapshot`、`should_export_modality_runtime_contract_snapshot_from_failed_image_task`、`should_carry_modality_runtime_contract_into_replay_case`、`npm run test:contracts` 与本轮触达文件 `git diff --check`。
- 2026-04-29：继续 `image_generation` vertical slice 第六刀：`list_media_task_artifacts` 现在可以按 `modalityContractKey` 与 `routingOutcome` 筛选图片任务，并在返回结果中附带 `modality_runtime_contracts` 索引摘要；索引包含 contract keys、routing outcome 计数、blocked 计数、registry assessment 计数与每个 task 的 routing snapshot，使 task index 成为多模态运行合同的可检索事实源，而不是只能靠单个 task file 或 evidence pack 反查。
- 2026-04-29：第六刀同步前端 `ListMediaTaskArtifactsRequest` / `ListMediaTaskArtifactsOutput` 类型与浏览器 fallback mock；图片任务恢复测试继续使用统一媒体任务接口，mock 也返回相同 `modality_runtime_contracts` 结构，避免浏览器链路假绿。
- 2026-04-29：第六刀验证通过 `CARGO_TARGET_DIR=src-tauri/target/codex-modality-contract cargo test --manifest-path src-tauri/Cargo.toml list_media_task_artifacts_inner_should_index_modality_contract_routing_blocks`、`media_task_artifact_controls_should_share_same_task_file_protocol`、`npm test -- src/lib/api/mediaTasks.test.ts src/lib/tauri-mock/core.test.ts src/components/agent/chat/workspace/useWorkspaceImageTaskPreviewRuntime.test.tsx`、`npm run typecheck`、`npm run test:contracts` 与本轮触达文件 `git diff --check`。
- 2026-04-29：继续 `image_generation` vertical slice 第七刀：前端图片任务恢复 runtime 现在会从 task artifact payload / `last_error` 解析 `runtimeContract` 快照，写入 `ImageWorkbenchTask` 与 `MessageImageWorkbenchPreview`；图片工作台 viewer 增加轻量胶囊标签，区分“运行合同 · 已按 image_generation 路由”“运行合同阻止 · image_generation_model_capability_gap”以及“模型能力来自 model_registry · 不支持图片生成”，让第六刀 task index 的路由事实进入用户可见 viewer。
- 2026-04-29：第七刀验证通过 `npm test -- src/components/agent/chat/components/ImageTaskViewer.test.tsx src/components/agent/chat/workspace/useWorkspaceImageTaskPreviewRuntime.test.tsx`、`npm run typecheck`、`npm run test:contracts`、`npm run verify:gui-smoke` 与本轮触达文件 `git diff --check`。
- 2026-04-29：继续 `image_generation` vertical slice 第八刀：`image_generation.bound_entries` 现在登记 `@配图 / @image / /image / @Vision 1`、`@海报 / @Flyer 3`、`@修图`、`@重绘`、`@分镜`、文稿正文配图和图片工作台续做入口；entry binding 只声明 `entry_source`、`launch_metadata_path` 和 input mapping，不拥有 task / artifact / viewer / evidence 事实源。
- 2026-04-29：第八刀新增 `src/lib/governance/modalityRuntimeContracts.ts`，前端 `imageSkillLaunch.ts` 改为从 registry 读取 `contractKey / modality / requiredCapabilities / routingSlot / runtimeContract`，避免上层入口继续硬编码底层 contract；守卫同步要求 entry binding 声明 `entry_source` 且 launch metadata 留在 `harness.*`。
- 2026-04-29：第八刀验证通过 `npm run governance:modality-contracts`、`npm test -- src/lib/governance/modalityRuntimeContracts.test.ts`、`npm test -- src/components/agent/chat/workspace/useWorkspaceImageWorkbenchActionRuntime.test.tsx src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx`、`npm run typecheck`、`npm run test:contracts`、`npm run verify:gui-smoke` 与本轮触达文件 `git diff --check`。
- 2026-04-29：继续第九刀 `browser_control`：泛化 `ModalityRuntimeContract` registry resolver，新增 Browser Assist launch metadata helper；`@浏览器 / @Browser Agent / @Mini Tester` 发送时保留原始消息并关闭 WebSearch，同时把 `browser_control` 合同快照注入 `harness.browser_assist`，`buildHarnessRequestMetadata` 负责保留这些底层合同字段并补齐 profile / backend / auto launch。
- 2026-04-29：第九刀验证通过 `npm test -- src/lib/governance/modalityRuntimeContracts.test.ts src/components/agent/chat/utils/harnessRequestMetadata.test.ts src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx`、`npm run governance:modality-contracts`、`npm run typecheck`、`npm run test:contracts`、`npm run verify:gui-smoke` 与本轮触达文件 whitespace / `git diff --check`。
- 2026-04-29：继续第十刀 `browser_control` 后端消费：新增 Rust 侧 `BROWSER_CONTROL_*` contract 常量与 `browser_control_runtime_contract()`，`BrowserAssistRuntimeHint` 现在会从 `harness.browser_assist` 解析 `modality_contract_key=browser_control`、`required_capabilities`、`routing_slot`、`runtime_contract` 与 `entry_source`；`LimeBrowserMcpTool` 成功或失败结果都会把这组字段写入 tool result metadata，让 Browser Assist 动作进入 runtime timeline 事实源。
- 2026-04-29：继续第十一刀 `browser_control` evidence：`runtime_evidence_pack_service` 现在会从 browser tool call metadata 导出 `modalityRuntimeContracts` snapshot，`source=browser_action_trace.modality_runtime_contract`、`routingEvent=browser_action_requested`、`routingOutcome=accepted`，使 Browser Assist 不再只能依赖图片 task artifact 的合同导出路径。
- 2026-04-29：第十/十一刀验证通过 `CARGO_TARGET_DIR=src-tauri/target/codex-modality-contract cargo test --manifest-path src-tauri/Cargo.toml test_extract_browser_assist_runtime_hint_from_harness_metadata`、`test_lime_browser_tool_attaches_modality_contract_metadata`、`should_export_browser_control_contract_snapshot_from_tool_metadata`、`npm run test:contracts`、`npm run verify:gui-smoke` 与本轮触达文件 `git diff --check`。
- 2026-04-29：继续第十二刀 `browser_control` replay/grader：`runtime_replay_case_service` 现在会把 `browser_control` 合同识别为 Browser Assist 回归样本，补 `browser-control`、`browser-assist`、`browser-action-trace` suite tags；`expected.json` / `grader.md` 会要求继续使用 `mcp__lime-browser__*`，禁止 WebSearch / 普通聊天替代真实浏览器动作，并检查 `browser_action_trace` / `browser_action_requested` 证据。
- 2026-04-29：第十二刀验证通过 `CARGO_TARGET_DIR=src-tauri/target/codex-modality-contract cargo test --manifest-path src-tauri/Cargo.toml should_carry_browser_control_contract_into_replay_grader_checks`、`should_carry_modality_runtime_contract_into_replay_case`、`npm run test:contracts`、`npm run verify:gui-smoke` 与本轮触达文件 `git diff --check`。
- 2026-04-29：继续第十三刀 `pdf_extract`：新增前端 registry resolver `resolvePdfExtractRuntimeContractBinding()`，`@读PDF` 发送时在 `harness.pdf_read_skill_launch.pdf_read_request` 注入 `pdf_extract` contract 快照；Rust 侧新增 `PDF_EXTRACT_*` 常量、`pdf_extract_runtime_contract()` 与 `insert_pdf_extract_contract_fields()`，`prepare_pdf_read_skill_launch_request_metadata` 会把缺省合同字段补齐到 launch 与 request，系统 prompt 显式要求 Skill(pdf_read) 保留 contract 字段、真实读取 PDF，并禁止 `frontend_direct_pdf_parse` / `generic_chat_summary_only`。
- 2026-04-29：第十三刀验证通过 `npm test -- src/lib/governance/modalityRuntimeContracts.test.ts src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx`、`npm run governance:modality-contracts`、`npm run typecheck`、`npm run test:contracts`、`npm run verify:gui-smoke`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`CARGO_TARGET_DIR=src-tauri/target/codex-modality-contract cargo test --manifest-path src-tauri/Cargo.toml pdf_read_skill_launch`、`cargo test --manifest-path src-tauri/Cargo.toml` 与本轮触达文件 `git diff --check`；`npm run verify:local` 初跑曾在全量 Rust 阶段暴露 PDF 断言误落到 resource_search 测试，已修复并用全量 `cargo test` 复验通过。
- 2026-04-29：继续第十四刀 `pdf_extract` evidence/replay：`runtime_evidence_pack_service` 现在会从 `Skill(pdf_read)` tool timeline metadata 或其 `args.pdf_read_request` 合同快照导出 `pdf_extract` 的 `modalityRuntimeContracts`，`source=pdf_read_skill_trace.modality_runtime_contract`、`routingEvent=executor_invoked`、`routingOutcome=accepted/failed`、`expectedRoutingSlot=base_model`。
- 2026-04-29：第十四刀同步 `runtime_replay_case_service`：replay tags 增加 `modality-pdf_extract`、`pdf-extract`、`pdf-read-skill`、`pdf-read-trace`，`expected.json` / `grader.md` 明确要求继续走 `Skill(pdf_read)` 或真实 `list_directory` / `read_file` 文件读取证据，并禁止 `frontend_direct_pdf_parse`、`generic_chat_summary_only`、ToolSearch、WebSearch 或 Grep 替代真实读 PDF。
- 2026-04-29：继续第十五刀 `pdf_extract` entry binding：`modalityRuntimeContracts.json` 现在登记 `at_pdf_read_command`，覆盖 `@读PDF / @pdf / @read_pdf`，并把 launch path 固定为 `harness.pdf_read_skill_launch.pdf_read_request`；`useWorkspaceSendActions` 从 `resolvePdfExtractRuntimeContractBinding().boundEntrySources` 读取 `entry_source`，只保留 `PDF_EXTRACT_DEFAULT_ENTRY_SOURCE` 作为 registry 缺省 fallback。
- 2026-04-29：继续第十六刀 `voice_generation`：新增前端 registry resolver `resolveVoiceGenerationRuntimeContractBinding()`，`voice_generation.bound_entries` 登记 `at_voice_command`；`@配音` 发送时在 `harness.service_scene_launch.service_scene_run` 注入 `voice_generation` contract 快照，后端 `prepare_service_scene_launch_request_metadata` 也会为 `voice_runtime` 旧 metadata 补齐合同字段，服务型场景 prompt 会输出底层合同、所需能力与 `runtime_contract(JSON)`，并禁止退回 `legacy_tts_test_command`。
- 2026-04-29：继续第十七刀 `web_research`：新增前端 registry resolver `resolveWebResearchRuntimeContractBinding()`，`web_research.bound_entries` 登记 `at_search_command`、`at_deep_search_command` 与 `at_site_search_command`；`@搜索 / @深搜 / @站点搜索` 发送时分别在 research / deep search / site search request 中注入 `web_research` contract 快照，Rust 侧 prepare 函数也会把缺省合同字段补齐到 launch 与 request，prompt 显式输出底层合同、所需能力与 `runtime_contract(JSON)`，并禁止退回模型记忆、本地文件搜索、通用 WebSearch 或 ToolSearch 偏航。
- 2026-04-30：继续第十八刀 `web_research` evidence/replay：`runtime_evidence_pack_service` 现在会从 `Skill(research)` / `Skill(site_search)` tool timeline 的 args 或 metadata 导出 `web_research` 的 `modalityRuntimeContracts`，`source=web_research_skill_trace.modality_runtime_contract`、`routingEvent=executor_invoked`、`routingOutcome=accepted/failed`、`expectedRoutingSlot=report_generation_model`；`runtime_replay_case_service` 同步增加 `web-research`、`research-skill`、`web-research-trace` tags，并在 expected / grader 中要求继续走 `Skill(research)` / `Skill(site_search)` 与真实 search_query / `lime_site_*` 证据，禁止 `model_memory_only_answer`、`local_file_search_before_research_skill`、ToolSearch 或普通聊天替代。
- 2026-04-30：继续第十九刀 `web_research` 索引化：`runtime_evidence_pack_service` 的 `modalityRuntimeContracts` 现在输出 `snapshotIndex`，汇总 `contractKeys`、`sourceCounts`、`routingOutcomeCounts`、`expectedRoutingSlots` 与 `toolTraceIndex.items`；`web_research` replay input 会携带同一份索引，使回归样本能直接定位 `executorBindingKey=research`、`entrySource=at_search_command` 与 `web_research_skill_trace`，不再只能扫描 raw snapshots。
- 2026-04-30：继续第二十刀 `web_research` 报告型子入口：`web_research.bound_entries` 纳入 `at_report_command` 与 `at_competitor_command`，前端 `@研报 / @竞品` 发送会在 `harness.report_skill_launch.report_request` 注入同一份 `web_research` contract；Rust `report_skill_launch` prepare / prompt 也补齐合同字段，同时保留首刀 `Skill(report_generate)`，并把 evidence / replay 扩展到 `report_generate` trace，避免另开 `report_generation` 平行事实源。
- 2026-04-30：继续第二十一刀 `text_transform`：新增 `text_transform` contract 并登记 `at_file_read_command`、`at_summary_command`、`at_translation_command`、`at_analysis_command`、`at_publish_compliance_command`、`at_logo_decomposition_command`；前端 `@读文件 / @总结 / @翻译 / @分析 / @发布合规 / @Logo拆解`、Rust summary/translation/analysis prepare 与 prompt、evidence `text_transform_skill_trace`、replay tags / expected / grader 已统一收敛到同一份底层合同，入口层不再新增 summary / translation / analysis 平行事实源。
- 2026-04-30：继续第二十二刀 `voice_generation` evidence/replay：`runtime_evidence_pack_service` 现在会从 voice runtime / service scene timeline args 或 metadata 导出 `voice_generation` 的 `modalityRuntimeContracts`，`source=voice_generation_service_scene_trace.modality_runtime_contract`、`routingEvent=executor_invoked`、`routingOutcome=accepted/failed`、`expectedRoutingSlot=voice_generation_model`；`runtime_replay_case_service` 同步增加 `voice-generation`、`voice-runtime`、`voice-generation-trace` tags，并在 expected / grader 中要求继续走 `service_scene_launch(scene_key=voice_runtime)` / 本地 ServiceSkill runtime 或后续 audio_task/audio_output 证据，禁止 `legacy_tts_test_command`、伪造云端提交、普通聊天文本或通用文件卡替代。
- 2026-04-30：继续第二十三刀 `voice_generation` audio artifact protocol：新增 `audio_generate` task type、`create_audio_generation_task_artifact` Tauri 命令与 `lime_create_audio_generation_task` Agent tool，只写入标准 `audio_task/audio_output` 产物，不生成真实音频、不提交云端；前端 API、DevBridge mock、`list_media_task_artifacts` contract index、evidence `audio_task.modality_runtime_contract` 与 replay grader 已同步消费同一份 `voice_generation` 合同快照，下一刀再补 audio viewer / 真实 worker。
