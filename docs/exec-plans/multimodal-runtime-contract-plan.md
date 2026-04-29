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

暂不做：

1. 暂不把所有 `@`、按钮、Scene 批量登记到 `bound_entries`；仍等 Phase 7。
2. 暂不改 viewer 或 workspace UI 视觉面。
3. 暂不把 LimeCore 写成默认执行器；LimeCore 仍只作为 catalog / policy / offer / audit 控制面。

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
