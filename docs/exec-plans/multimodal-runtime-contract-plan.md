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
4. `request_model_resolution` 已开始消费 `TaskProfile.routingSlot`，把 `browser_reasoning_model`、`image_generation_model`、`audio_transcription_model`、`voice_generation_model` 等槽位折叠成最小模型能力需求；候选池会过滤不满足能力的模型，显式用户模型锁定仍保留锁定模型但输出 `*_candidate_missing` gap。

### Phase 3：ModalityExecutionProfile

状态：进行中。

本阶段输出：

1. `docs/roadmap/warp/execution-profile.md`
2. `src/lib/governance/modalityExecutionProfiles.json`
3. `image_generation`、`browser_control`、`pdf_extract`、`voice_generation`、`audio_transcription`、`web_research`、`text_transform` 的最小 execution profile。
4. contract 守卫检查 current contract 必须被 profile 覆盖，且 profile 的模型角色、权限、LimeCore policy、artifact policy 必须覆盖 contract。
5. `src/lib/governance/modalityExecutionProfiles.ts` 把 profile / adapter registry 解析成 launch metadata 快照。
6. Rust runtime contract snapshot、Evidence Pack、Replay 与统一媒体任务索引已经携带 profile / adapter key；媒体任务 worker 已在进入图片、配音、转写执行器前做最小 profile / adapter / executor binding preflight；Browser Assist 工具层现在也会在真实浏览器动作前校验 `browser_control` 的 execution profile、executor adapter 与 executor binding，失败时返回 `runtime_preflight` 工具错误并保留同一 runtime contract metadata，供 Evidence / Replay 识别为被合同阻断；`LimeSkillTool` 现在也会对 current Skill 主链生成治理 registry 驱动的 `modality_runtime_contract` metadata，并在上层显式传入冲突 `execution_profile` / `executor_adapter` / `executor_binding` 时阻断进入 Skill 执行器；旧 `lime_run_service_skill` 仍是 compat guard，但命中 `voice_generation` 时会携带并校验 `service_skill:voice_runtime` 合同，避免旧云运行工具被误看成 current executor；LimeCore policy refs/snapshot 已进入 runtime contract、Evidence Pack 与统一媒体任务索引；后续仍需在 registry 出现明确 `gateway:*` adapter 后接入 Gateway preflight、真实 runtime policy merge、更完整 thread read 决策解释和 GUI 可视化。
7. `thread_read.runtime_summary.modalityRuntime` 现在会从最近 ToolCall / FileArtifact 的同一 `runtime_contract` 投影 `contractKey`、`modality`、`routingSlot`、`requiredCapabilities`、`profileKey`、`executorAdapterKey`、`executorKind` 与 `executorBindingKey`；这只暴露最近合同的 profile / adapter / binding 摘要，不把 thread read 变成上层 `@` 命令事实源。
8. `SessionExecutionRuntimeTaskProfile.routingSlot` 已接入 provider/model resolution 的最小能力 enforcement：非显式用户锁定路径会优先在候选池内选择满足 runtime requirements 的模型，显式用户锁定路径继续 honored，但 `capability_gap` 会暴露 `browser_reasoning_candidate_missing`、`image_generation_candidate_missing` 等 gap code。

### Phase 5：Executor Adapter registry

状态：进行中。

本阶段输出：

1. `src/lib/governance/modalityExecutionProfiles.json` 的 `executor_adapters`
2. `skill:image_generate`、`browser:browser_assist`、`skill:pdf_read`、`service_skill:voice_runtime`、`skill:transcription_generate`、`skill:research`、`skill:text_transform` 的最小 adapter 声明。
3. contract 守卫检查 current contract 的 `executor_binding` 必须能解析到 `executor_kind:binding_key` adapter。
4. adapter 的 progress / cancel / resume / artifact 支持位、artifact output、permission requirements 与 failure mapping 必须覆盖 contract。
5. 前端 `runtime_contract` snapshot 已携带 `executor_adapter` 摘要，避免上层入口继续只传 executor binding。
6. 统一媒体任务索引已经能查询 `execution_profile_keys`、`executor_adapter_keys`、`limecore_policy_refs` 与每条 snapshot 的 `execution_profile_key` / `executor_adapter_key` / `executor_kind` / `executor_binding_key` / `limecore_policy_snapshot_status`；图片、配音、转写 worker 已消费同一 adapter registry 做执行前检查；Browser Assist 工具层已消费同一 `browser_control` runtime contract 做执行前检查，错误结果继续带 `modality_runtime_contract` 与 `last_error(stage=runtime_preflight)`；`LimeSkillTool` 已把 `pdf_read`、`research`、`report_generate`、`site_search`、`summary`、`translation`、`analysis`、`transcription_generate` 映射到 current 底层合同，并把 profile / adapter / binding 快照从治理 JSON 注入 Skill tool metadata；`lime_run_service_skill` 作为旧服务型工具只保留 compat guard，命中 `voice_generation` 时必须通过 `voice_generation_profile`、`service_skill:voice_runtime` adapter 与 `service_skill:voice_runtime` binding 检查，否则返回 `runtime_preflight`；Gateway preflight 仍后置，不能从 Telegram / 微信 / 飞书 / Discord ingress 硬造 `gateway:*` executor adapter。
7. thread read 可见层已开始消费同一 adapter 摘要：`runtime_summary.modalityRuntime` 会并列暴露最近合同的 profile / adapter / binding key，供后续 GUI / evidence 解释复用；真实 Gateway adapter preflight 仍等待 registry 出现明确 `gateway:*` adapter 后再接。
8. provider/model resolution 已消费同一 `routingSlot` 摘要来约束模型候选池：Browser reasoning、图片生成、音频转写、语音生成、结构化文档与 cheap summary 都会先映射成 runtime model capability requirements，再影响候选数、自动重选与 gap 输出。

### Phase 6：LimeCore 目录与策略接线

状态：进行中。

本阶段输出：

1. `runtime_contract.limecore_policy_refs` 声明每个 current contract 依赖的 LimeCore 控制面事实源。
2. `runtime_contract.limecore_policy_snapshot` 现在落最小本地默认决策：`status=local_defaults_evaluated`、`decision=allow`、`decision_source=local_default_policy`、`decision_scope=local_defaults_only`。这个 `allow` 只表示本地默认策略没有阻断继续路由，不等于 LimeCore tenant / provider 真实放行。
3. `runtime_contract.limecore_policy_snapshot.policy_inputs` 现在按 ref 生成最小输入清单，标记 `status=declared_only`、`value_source=limecore_pending`；`missing_inputs` 继续列出等待 LimeCore 真实命中的控制面输入。
4. Evidence Pack `modalityRuntimeContracts.snapshotIndex.limecorePolicyIndex` 汇总 policy refs、snapshot status、decision、decision source、policy inputs、missing inputs 与 unresolved refs，方便后续 allow / ask / deny 与 LimeCore audit 对齐。
5. `list_media_task_artifacts` 的统一媒体任务索引输出 policy refs / snapshot status / decision / decision source / missing inputs / unresolved refs，以及 `policy_evaluation` 的 status / decision / blocking / ask / pending refs，让任务列表不必读取隐藏 task JSON 才能知道当前 contract 依赖哪些云控制面、卡在哪类 evaluator 输入。
6. Harness evidence 面板现在展示 `LimeCore 策略缺口` 摘要，直接暴露 policy snapshot、控制面 refs、missing inputs、local default decision、profile / adapter 与 `declared_only / limecore_pending` 输入状态。
7. Replay / grader 现在把 `limecorePolicyIndex` 纳入 suite tags、failure modes、success criteria、blocking checks 与多模态合同检查，要求 replay 继续保留 policy refs / missing inputs / local default decision，不能把本地默认 `allow` 当真实云策略放行。
8. `policy_value_hits[]` / `pending_hit_refs[]` / `policy_value_hit_count` 已进入 runtime contract、Evidence Pack、统一媒体任务索引、前端 normalizer 与浏览器 mock；默认命中数为 `0`，只表达“真实 LimeCore 命中值尚未接入”，不伪造 model catalog / offer / tenant flags。
9. Policy hit resolver seam 已能消费传入的 `status=resolved` 命中值，并自动把对应 ref 从 `missing_inputs` / `pending_hit_refs` 移到 `evaluated_refs`；当所有 refs 都已命中时，最小 `policy_input_evaluator` 会把已命中的 `model_catalog / provider_offer / tenant_feature_flags / gateway_policy` 信号折叠成 `allow / ask / deny` 的可审计决策；仍有 pending refs 时，顶层 `decision` 继续保持 `local_default_policy / local_defaults_only`，避免把输入缺口伪装成真实策略放行。
10. 图片任务执行前的 model registry assessment 现在会作为最小本地 `model_catalog` hit producer 写回同一 `policy_value_hits(status=resolved, value_source=local_model_catalog)`；该 hit 只证明模型目录输入已命中，模型是否具备 `image_generation` 能力仍由 runtime preflight 单独判定。
11. 图片任务进入真实执行器前已能从已解析的本地 runner config / API key 与 task payload provider/model 生成最小 `provider_offer` hit，写回同一 `policy_value_hits(status=resolved, value_source=local_provider_offer)`；该 hit 不序列化 API key，只证明 provider offer 输入已命中，不代表 tenant/provider/gateway 已策略放行。
12. Browser Assist 与 Web Research 类 launch 会从请求侧 `harness.oem_routing` 生成最小 `gateway_policy` hit，写回同一 `policy_value_hits(status=resolved, value_source=request_oem_routing)`；该 hit 只记录 tenant/provider/quota/can_invoke/fallback 等路由输入，不包含 session token，也不把本地默认 `allow` 升级成真实网关放行。
13. 请求侧会从 OEM Cloud bootstrap snapshot 的 `features` 生成最小 `tenant_feature_flags` hit，写回同一 `policy_value_hits(status=resolved, value_source=oem_cloud_bootstrap_features)`；该 hit 只解释租户功能开关输入已命中，不包含 session token。
14. `policy_evaluation` 现在在每个 snapshot 中记录 evaluator 状态：`input_gap` 时只说明还缺控制面输入，`evaluated` 时才允许顶层 `decision_source=policy_input_evaluator`；统一媒体任务索引同步暴露 evaluation status / decision / source 与 blocking / ask / pending refs。该 evaluator 只消费本地已命中的 policy inputs，不接 LimeCore 云 run/poll，也不把 LimeCore 扩张为默认 executor。
15. `thread_read.runtime_summary.limecorePolicy` 现在会从最新 tool metadata / file artifact 中的 runtime contract 读取 LimeCore policy snapshot，投影 contract、snapshot status、顶层 decision、decision source/scope/reason、refs、missing/pending refs、hit count 与 evaluator 摘要；这只解释当前线程最近一次可见 policy 决策输入，不新增命令、不接云 run/poll。
16. `list_media_task_artifacts.modality_runtime_contracts` 现在会把 evaluator 摘要提升为索引字段：`limecore_policy_evaluation_statuses`、`limecore_policy_evaluation_decisions`、`limecore_policy_evaluation_decision_sources`、`limecore_policy_evaluation_blocking_refs`、`limecore_policy_evaluation_ask_refs`、`limecore_policy_evaluation_pending_refs`，并在每条 snapshot 输出对应字段；这让任务列表、恢复层和后续 GUI 卡片能直接区分 pending input gap、ask 与 deny，不读取隐藏 task JSON。
17. 配音与转写任务卡恢复层现在消费同一索引里的 `limecore_policy_evaluation_*` 字段，把 `input_gap` 渲染为 `LimeCore 策略输入待命中: N`，把已评估 `deny / ask` 渲染为阻断或需确认的 refs；这只解释本地 evaluator 输入状态，不把 input gap 当成真实用户确认，也不把本地 `allow` 当云策略放行。
18. 图片任务恢复层现在会从 `runtime_contract.limecore_policy_snapshot.policy_evaluation` 解析 evaluator 摘要并写入 `ImageRuntimeContractSnapshot`；图片 viewer 复用同一文案规则展示 `LimeCore 策略输入待命中 / 阻断 / 需确认` 胶囊标签，让图片任务也能在用户可见层解释 pending input gap、ask 与 deny。
19. `thread_read.runtime_summary` 现在并列暴露 `limecorePolicy` 与 `modalityRuntime`：前者解释最近 policy decision input，后者解释同一合同的 profile / adapter / executor binding；这仍只消费已有 runtime contract，不新增 Tauri command、不接 LimeCore 云 run/poll，也不把 input gap 或本地 default decision 伪装成云端策略结论。

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
3. `browser_control.bound_entries` 只登记 `@浏览器`、`@Browser Agent`、`@Mini Tester`、`@Web Scheduler`、`@Web Manage` 的 entry metadata；`@` 命令仍只是入口层，不能写 task / artifact / viewer 事实源。
4. 后端 `BrowserAssistRuntimeHint` 必须解析并保留 `browser_control` 合同快照，browser tool result metadata 需要携带同一组 contract 字段。
5. Evidence Pack 从 browser tool timeline metadata 导出 `browser_control` 的 `modalityRuntimeContracts`，使浏览器动作也进入 replay 可用的事实源。
6. Evidence Pack 的 `modalityRuntimeContracts.snapshotIndex.browserActionIndex` 必须汇总 action、session、URL、observation 与 screenshot，使 Browser Assist 不再只能靠 raw snapshots 人工查找。
7. Replay / grader 必须把 `browser_control` 识别成 Browser Assist 回归样本，检查 browser action trace / browserActionIndex、禁止 WebSearch 替代真实浏览器动作。

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
7. 本阶段新增最小 `audio_generate` task artifact 协议，把 `voice_generation` 写入标准 `audio_task/audio_output` 产物；聊天区提供最小音频任务卡与运行时文档 viewer，并允许执行器通过同一 task artifact 回写 `audio_output.completed`。当前 `lime-audio-worker` 已接入 OpenAI-compatible speech provider seam：有 current API Key Provider 凭证时写入 `.lime/runtime/audio/*.mp3` 并回写 `payload.audio_output.completed`；未配置 provider / model / client 时必须显式写回 `audio_provider_*` 错误，聊天任务卡与运行时文档 viewer 都从同一 task artifact 展示完成/失败事实，不回退 legacy TTS，也不伪造音频路径。

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

### Phase 13：Audio Transcription 合同注入

状态：进行中。

本阶段输出：

1. `audio_transcription` 作为音频转写底层运行合同进入 `harness.transcription_skill_launch.transcription_task`，`@转写 / @transcribe / @Audio Extractor` 仅保留为 entry source。
2. 前端 `@转写` 发送时保留原始消息，并注入 `modality_contract_key=audio_transcription`、`required_capabilities`、`routing_slot=audio_transcription_model` 与 `runtime_contract` 快照。
3. 后端 `prepare_transcription_skill_launch_request_metadata` 需要为旧客户端或缺省 metadata 补齐同一组合同字段，避免回退成前端直连 ASR、普通文件读取或 generic file transcript。
4. `Skill(transcription_generate)` prompt 必须显式说明当前底层合同，继续压制 ToolSearch / WebSearch / Read / Glob / Grep 首刀偏航。
5. 标准 `transcription_generate` task file 必须写入同一 `audio_transcription` 合同与 `transcript.pending` 子产物，CLI / Agent tool 回退入口不能另写平行协议。
6. 媒体任务索引、Evidence Pack 与 Replay / grader 必须能定位 transcript 状态、来源、语言、输出格式与失败码，使 `audio_transcription` 不再只停留在入口 metadata。
7. 本阶段接入最小 `lime-transcription-worker` 与用户可见恢复层：OpenAI-compatible provider 成功时写入 `.lime/runtime/transcripts/*` 并回写 `transcript.completed`，provider/source/contract 失败时回写 `transcript.failed` 与明确错误码；聊天任务卡和 `.lime/runtime/transcription-generate/*.md` 运行时文档优先消费统一媒体任务索引的 `transcript_*` snapshot，并在完成态读取 `transcript_path` 文本内容供复制校对；当前 viewer 已能从 JSON / SRT / VTT transcript 中解析时间轴与说话人，生成可逐段编辑校对的段落表；保存校对稿时复用 ArtifactDocument 版本链，写入 `transcriptCorrection*` / `transcriptSegmentsCorrected` / `transcriptCorrectionDiffSummary` metadata，不改写原始 ASR 输出，并在 viewer 中展示“校对稿已保存”状态；更多 ASR adapter 与本地离线 ASR 后续继续消费同一 task artifact 与 `transcriptIndex`。

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
21. `voice_generation` 第二十四刀把 `audio_generate` tool result 恢复为聊天区任务卡与 `.lime/runtime/audio-generate/*.md` 运行时文档；打开任务卡不再尝试展示隐藏 `.lime/tasks/audio_generate/*.json`，而是进入可读的音频任务 viewer，同时继续把 task JSON 作为 primary source。
22. `voice_generation` 第二十五刀新增最小 `audio_output` 完成态回写：`complete_audio_generation_task_artifact` 只更新标准 `audio_generate` task file，把 `audio_path / mime_type / duration_ms` 同步写入 payload、`payload.audio_output` 与 `record.result`，并通过同一媒体任务事件刷新前端，不新增云端执行协议。
23. `voice_generation` 第二十六刀把完成态回流接回聊天任务卡：`useWorkspaceAudioTaskPreviewRuntime` 监听同一媒体任务事件并轮询已追踪的 `audio_generate` task file，从 `payload.audio_output` / `record.result.audio_output` 恢复 `audioUrl / mimeType / durationMs`，让执行器回写后能直接在现有轻卡中出现可播放结果。
24. `voice_generation` 第二十七刀新增最小音频执行器骨架：`create_audio_generation_task_artifact` 创建标准 `audio_generate` 后会进入同一媒体任务执行链；在真实音频 provider 尚未接通时，worker 明确把 task 写成 `failed`、`last_error.code=audio_worker_unavailable`、`payload.audio_output.status=failed`，不伪造 `audio_path`，也不回流 `legacy_tts_test_command`。
25. `voice_generation` 第二十八刀把音频执行器从纯骨架推进到 OpenAI-compatible provider seam：worker 通过 current API Key Provider 解析 `provider_id/model/api_key/base_url`，调用 `/audio/speech` 获取真实音频 bytes，保存到 `.lime/runtime/audio/<task_id>.mp3`，并用同一 task artifact 回写 `payload.audio_output.completed`、`record.result.audio_output` 与 `worker_id=lime-audio-worker`；provider 未配置、resolver 缺失或非 OpenAI-compatible client 时分别写回 `audio_provider_unconfigured` / `audio_provider_resolver_unavailable` / `audio_provider_client_missing`，不回 legacy。
26. `voice_generation` 第二十九刀把 worker 失败态回流到聊天音频任务卡：`useWorkspaceAudioTaskPreviewRuntime` 从 `payload.audio_output` / `record.last_error` 解析 `audio_provider_*` 错误码、错误原因与 retryable，不保留失败 artifact 里不存在的 `audio_path`；`TaskMessagePreview` 显示 Provider 错误码和原因，让“未配置 provider / resolver 不可用 / adapter 缺失”成为用户可见事实，而不是泛化成普通失败。
27. `voice_generation` 第三十刀把完成/失败态同步到同一个运行时文档 viewer：音频任务轮询更新 `taskPreview` 的同时，会重建 `.lime/runtime/audio-generate/*.md` 对应的 ArtifactDocument metadata；打开任务卡时看到的是 `audio_output.completed` 的音频路径或 `audio_provider_*` 失败原因，而不是创建任务时的旧“等待执行器”文档。
28. `voice_generation` 第三十一刀把 `audio_output` 细节接入 evidence / replay：`audio_task.modality_runtime_contract` 快照现在携带 `audioOutput.status/audioPath/providerId/model/workerId/errorCode`，`snapshotIndex.audioOutputIndex` 可检索完成/失败态；replay tags、failure modes、expected 与 grader 会区分 `audio_output.completed` 和 Provider 失败，禁止把已完成音频降级成 Markdown 文本、普通聊天或通用文件卡。
29. `voice_generation` 第三十二刀把 `audio_output` 细节接入统一媒体任务索引：`list_media_task_artifacts` 的 `modality_runtime_contracts` 现在输出 `audio_output_count`、`audio_output_statuses`、`audio_output_error_codes` 与每个 snapshot 的 `audio_output_*` 字段；前端类型与浏览器 mock 同步，任务列表/恢复逻辑不必重新打开 task JSON 才能知道音频已完成、失败或缺少 Provider。
30. `voice_generation` 第三十三刀让聊天音频任务恢复优先消费统一媒体任务索引：`useWorkspaceAudioTaskPreviewRuntime` 会先读取 `list_media_task_artifacts(modalityContractKey=voice_generation, taskType=audio_generate)` 的 `audio_output_*` snapshot，把完成态音频路径或 Provider 失败直接同步到任务卡与同一条运行时文档；只有索引缺失该 task 或没有 `audio_output_status` 时才回退读取单个 task artifact。
31. `browser_control` 第三十八刀把同一份 `browserActionIndex` 接入最小 `browser_replay_viewer`：Harness evidence 面板的“打开复盘”会构造 `browser_assist` Artifact，并由 `BrowserAssistRenderer` 消费 `browserActionIndex` 展示 action/session/URL/observation/screenshot 与最近 `browser_session` / `browser_snapshot` 项；本刀不新增 browser task 协议，viewer 仍消费 Evidence Pack 的同一事实源。
32. `audio_transcription` 第三十九刀把 `@转写 / @transcribe / @Audio Extractor` 收为 registry entry binding：前端 `transcription_skill_launch.transcription_task` 与 Rust prompt prepare 都会保留 `audio_transcription` 合同快照，`transcript` artifact graph 也反向登记该 current contract；本刀只建立底层合同，不新增真实转写 worker、完整 transcript viewer 或 replay 索引。
33. `audio_transcription` 第四十刀把 `transcription_generate` task artifact 接到底层合同事实源：Agent tool 与 CLI 回退入口现在写入标准 `.lime/tasks/transcription_generate/*.json`，payload 固化 `audio_transcription` contract、`requested_target=transcript` 与 `transcript.pending`；`list_media_task_artifacts` 输出 transcript 状态/来源/语言/格式，Evidence Pack 输出 `snapshotIndex.transcriptIndex`，Replay / grader 能识别缺失 task trace、缺失 transcript index 与 `transcript.failed`。
34. `audio_transcription` 第四十一刀接入最小 `lime-transcription-worker`：Agent tool 创建 task 后会启动转写执行链，OpenAI-compatible provider 成功时把响应写入 `.lime/runtime/transcripts/<task>.json|txt|srt|vtt` 并回写 `transcript.completed` / `record.result.transcript`；缺少 AppHandle、provider/model、API Key、source 文件、非 OpenAI-compatible adapter 或 provider 请求失败时回写 `transcript.failed` 与 `transcription_*` 错误码，不回退 frontend ASR、普通文件读取或 generic_file transcript。
35. `audio_transcription` 第四十二刀把 transcript 恢复层接回聊天区：`lime_create_transcription_task` 工具结果现在生成 `.lime/runtime/transcription-generate/*.md` 运行时文档；`useWorkspaceTranscriptionTaskPreviewRuntime` 监听同一媒体任务事件并优先按 `audio_transcription + transcription_generate` 查询 `list_media_task_artifacts`，从 `transcript_status/path/source/language/output_format/error_code` snapshot 恢复任务卡和 viewer，索引缺失时才回退读取单个 task artifact。
36. `audio_transcription` 第四十三刀把 transcript 文本接入最小校对 viewer：完成态恢复时读取 `transcript_path` 指向的 `.lime/runtime/transcripts/*` 文本，并把内容嵌入 `.lime/runtime/transcription-generate/*.md` ArtifactDocument 的 `code_block`，打开任务卡即可复制和校对转写文本；失败态仍只展示 `transcription_*` 错误码，不伪造 transcript 内容。
37. `audio_transcription` 第四十四刀把 transcript viewer 从纯文本推进到时间轴/说话人段落层：恢复层会解析 `.json` verbose transcript、SRT 与 VTT 的 segment / speaker / start-end 时间码，写回 `taskPreview.transcriptSegments`、聊天轻卡时间轴预览和 `.lime/runtime/transcription-generate/*.md` 的“转写时间轴（可逐段编辑校对）”表格；仍不读取隐藏 task JSON 作为主路径，也不新增前端 ASR 或 `generic_file` 旁路。
38. `audio_transcription` 第四十五刀把 transcript viewer 从只读校对推进到可保存校对稿：`.lime/runtime/transcription-generate/*.md` ArtifactDocument 会标记 `transcriptCorrectionEnabled`、提示保存不改写原始 ASR 输出；用户编辑“转写文本”或“转写时间轴”并保存时，Workbench 复用同一 ArtifactDocument 版本链写入 `transcriptCorrectionStatus=saved`、`transcriptCorrectionEditedBlockId`、`transcriptCorrectionSourceTranscriptPath`、`transcriptCorrectionTextLength`、`transcriptCorrectionSegmentCount`、`transcriptCorrectionSpeakerCount` 与 `transcriptSegmentsCorrected`，不新增 Tauri command、frontend ASR 或并行 patch 协议。
39. `audio_transcription` 第四十六刀把已保存校对稿显性化：保存后会插入/更新 `transcript-correction-status` callout，显示原始 ASR 输出保持不可变、原文/校对稿文本长度差异、段落差异和说话人数差异；同时写入 `transcriptCorrectionDiffSummary`，让后续专用 transcript viewer、diff 面板或导出器不必重新扫描 block 才能识别校对变更。
40. `Phase 3 / Phase 5` 第四十七刀新增最小 `ModalityExecutionProfile` 与 `ExecutorAdapter` 事实源：`modalityExecutionProfiles.json` 覆盖 7 个 current contracts 与 7 个 executor adapters，`governance:modality-contracts` 会校验 profile 覆盖、adapter 绑定、支持位、产物、权限、LimeCore policy 与 failure mapping；本刀只建立 current 治理事实源，不新增命令、bridge、mock 或运行时执行分支。
41. `Phase 3 / Phase 5` 第四十八刀把 profile / adapter 事实源接入前端 runtime contract resolver：`resolveModalityRuntimeContractBinding()` 现在会从 `modalityExecutionProfiles.json` 解析 `execution_profile` 与 `executor_adapter` 快照，并随 `runtime_contract` 进入所有 current launch metadata；本刀仍不新增 Tauri command、bridge、mock 或 Rust executor 分支，为下一步 Rust runtime preflight / evidence 可视化提供统一输入。
42. `Phase 3 / Phase 5` 第四十九刀把 profile / adapter 快照接入 Evidence Pack：`runtime_evidence_pack_service` 会从 `runtime_contract.execution_profile.profile_key` 与 `runtime_contract.executor_adapter.adapter_key` 提取 `executionProfileKey` / `executorAdapterKey`，并写入 `modalityRuntimeContracts.snapshots[]`、`snapshotIndex.executionProfileKeys`、`snapshotIndex.executorAdapterKeys` 与 `toolTraceIndex.items[]`；本刀仍不改变真实 executor 行为，只让 evidence/replay 主链能看见 Phase 3/5 决策输入。
43. `Phase 3 / Phase 5` 第五十刀把 profile / adapter 快照接入统一媒体任务索引：Rust `runtime_contract` snapshot 现在写入 `execution_profile.profile_key` 与 `executor_adapter.adapter_key`，`list_media_task_artifacts` 的 `modality_runtime_contracts` 输出 `execution_profile_keys`、`executor_adapter_keys`，并在每条 task snapshot 上暴露 `execution_profile_key` / `executor_adapter_key`；前端类型和浏览器 fallback mock 同步，图片、配音、转写任务列表不必重新打开 task JSON 才能查询 profile / adapter。
44. `Phase 3 / Phase 5` 第五十一刀把 adapter registry 接入媒体 worker 执行前检查：图片、配音、转写 worker 在进入真实执行器前会校验同一份 `runtime_contract.execution_profile.profile_key`、`executor_adapter.adapter_key` 与 `executor_binding.executor_kind/binding_key`，不匹配时以 `*_execution_profile_*`、`*_executor_adapter_*`、`*_executor_binding_*` 阻断；`list_media_task_artifacts` 每条 snapshot 同步暴露 `executor_kind` / `executor_binding_key`，Evidence Pack 会把 runtime preflight 阻断识别为 `runtime_preflight` / `blocked`，避免 adapter 错配继续落成普通 provider 失败。
45. `Phase 6` 第五十二刀把最小 LimeCore policy refs/snapshot 种进同一底层主链：central Rust contract helper、前端 runtime contract resolver 与浏览器 fallback mock 都会写入 `limecore_policy_refs` 和 `limecore_policy_snapshot(status=refs_declared, decision=not_evaluated)`；Evidence Pack 新增 `snapshotIndex.limecorePolicyIndex`，统一媒体任务索引新增 `limecore_policy_refs`、`limecore_policy_snapshot_count/statuses` 与每条 snapshot 的 policy refs/status/decision。该刀只让后续 allow / ask / deny 有审计字段，不新增命令、不实现 LimeCore 云 run/poll，也不把上层 `@` 入口提前接成云执行协议。
46. `Phase 6` 第五十三刀把 policy snapshot 从纯 refs seed 推进到本地默认决策摘要：central Rust contract helper、前端 runtime contract resolver 与浏览器 fallback mock 现在写入 `status=local_defaults_evaluated`、`decision=allow`、`decision_source=local_default_policy`、`decision_scope=local_defaults_only`、`decision_reason=declared_policy_refs_with_no_local_deny_rule` 与 `unresolved_refs`；Evidence Pack 和统一媒体任务索引同步暴露 decision source / unresolved refs。该 `allow` 仅表示本地默认策略没有阻断 current 路由，不代表真实 LimeCore tenant policy、provider offer 或 gateway policy 已放行。
47. `Phase 6` 第五十四刀把 policy decision 摘要补成可审计输入清单：`limecore_policy_snapshot.policy_inputs[]` 为每个 policy ref 标记 `declared_only / modality_runtime_contract / limecore_pending`，`missing_inputs[]` 明确哪些控制面输入还未由真实 LimeCore 命中；Evidence Pack 的 `limecorePolicyIndex` 与统一媒体任务索引同步暴露 `missingInputs` / `limecore_policy_missing_inputs`。该刀仍不接云 run/poll，也不把本地默认 `allow` 伪装成 tenant/provider/gateway 放行。
48. `Phase 6` 第五十五刀把 policy gap 推进到 Harness evidence 可见面：`HarnessStatusPanel` 读取 `observabilitySummary.modalityRuntimeContracts.snapshotIndex.limecorePolicyIndex`，展示 `LimeCore 策略缺口` 卡片、控制面 refs、missing inputs、local default decision、profile / adapter 和 `declared_only / limecore_pending` 输入状态；该刀仍不新增命令、不接 LimeCore 云执行，也不把上层 `@` 入口当作策略事实源。
49. `Phase 6` 第五十六刀把 policy gap 推进到 replay/grader 回归面：`runtime_replay_case_service` 现在会从 `limecorePolicyIndex` 派生 `limecore-policy` / `limecore-policy-gap` / `limecore-local-default-policy` suite tags 与 `limecore_policy_missing_inputs` / `limecore_policy_local_defaults_only` failure modes，并把 policy refs、missing inputs、decision source 写入 expected / grader 检查；该刀只增强复盘验收，不新增命令、不接云 run/poll。
50. `Phase 6` 第五十七刀补真实 policy hit value 的空接线结构：`limecore_policy_snapshot`、Evidence Pack `limecorePolicyIndex`、统一媒体任务索引、前端 normalizer/types 与浏览器 fallback mock 都携带 `pending_hit_refs`、`policy_value_hits`、`policy_value_hit_count=0`；这为后续真实 `model_catalog / provider_offer / tenant_feature_flags / gateway_policy` 命中值提供稳定落点，但当前仍不写假值、不接 LimeCore 云调用。
51. `Phase 6` 第五十八刀补最小 policy hit resolver seam：central Rust contract helper 与前端 runtime contract resolver 现在能消费传入的 `policy_value_hits(status=resolved)`，自动派生 `evaluated_refs`、收缩 `missing_inputs / pending_hit_refs`，Evidence Pack、统一媒体任务索引与浏览器 fallback mock 也会在 snapshot 只携带命中值时按同一规则派生待命中 refs；本刀仍不接云 run/poll、不改本地默认 `decision=allow/local_defaults_only`，避免把“输入命中”伪装成真实策略放行。
52. `Phase 6` 第五十九刀接最小本地 `model_catalog` hit producer：图片任务执行前已有的 `model_registry` 能力评估现在会写入 `runtime_contract.limecore_policy_snapshot.policy_value_hits[]`，并把 `model_catalog` 从 `missing_inputs / pending_hit_refs` 移入 `evaluated_refs`；该刀仍不接 `provider_offer / tenant_feature_flags`，也不把目录命中升级成真实策略放行。
53. `Phase 6` 第六十刀接最小本地 `provider_offer` hit producer：图片任务进入真实执行器前会先用已解析的 `ImageGenerationRunnerConfig`、非空 API key 与 task payload 的 `provider_id/model` 写入 `policy_value_hits(status=resolved, value_source=local_provider_offer)`，并把 `provider_offer` 从 `missing_inputs / pending_hit_refs` 移入 `evaluated_refs`；该 hit 只保留 endpoint origin/path、adapter 与 credential 状态，不序列化 API key，也不把本地默认 `allow` 升级成真实策略放行。
54. `Phase 6` 第六十一刀接请求侧 `gateway_policy` hit producer：Browser Assist 与 Web Research 类 launch 会复用 `harness.oem_routing` / Rust `oem_policy` 已有事实源，把 tenant/provider/quota/can_invoke/fallback 输入写入 `policy_value_hits(status=resolved, value_source=request_oem_routing)`，并把 `gateway_policy` 从 `missing_inputs / pending_hit_refs` 移入 `evaluated_refs`；该 hit 不包含 token、不新增 Tauri command、不接 LimeCore 云 run/poll，也不把本地默认 `allow` 升级成真实网关策略放行。
55. `Phase 6` 第六十二刀接请求侧 `tenant_feature_flags` hit producer：Workspace send metadata 会把 OEM Cloud bootstrap snapshot 的 feature flags 以 `harness.tenant_feature_flags` 透传给 Rust runtime；central contract helper 会把该输入写入 `policy_value_hits(status=resolved, value_source=oem_cloud_bootstrap_features)`，并把 `tenant_feature_flags` 从 `missing_inputs / pending_hit_refs` 移入 `evaluated_refs`。该 hit 只记录 boolean feature flags 与 tenant id，不包含 session token，不新增 Tauri command，不接云 run/poll，也不把功能开关命中解释成真实策略放行。
56. `Phase 6` 第六十三刀补最小 allow / ask / deny evaluator seam：central Rust contract helper 与前端 runtime contract resolver 现在都会写入 `policy_evaluation`；当所有 refs 都有 `resolved` hit 且没有阻断信号时，snapshot 进入 `status=policy_inputs_evaluated`、`decision_source=policy_input_evaluator`、`decision_scope=resolved_policy_inputs`，并按 gateway can_invoke / offer_state / quota_low、tenant gatewayEnabled、model_catalog capability 与 provider credential state 推导 `allow / ask / deny`。该 evaluator 只消费已命中的 policy inputs，不接云 run/poll；仍有 missing inputs 时顶层 `decision` 保持本地默认解释。
57. `Phase 6` 第六十四刀把 policy decision explanation 接入 thread read：`AgentRuntimeThreadReadModel` 会扫描最近的 ToolCall metadata / FileArtifact content 中的 runtime contract，把 LimeCore policy snapshot 投影到 `runtime_summary.limecorePolicy`，包含顶层 decision、decision_source/scope/reason、refs、missing/pending refs、hit count 与 evaluator blocking/ask/pending refs。该刀只让现有 thread read 能解释最近一次 policy 决策，不新增 Tauri command、不接云 run/poll，也不把 thread read 变成云审计事实源。
58. `Phase 6` 第六十五刀把 policy evaluator explanation 接入统一媒体任务索引：`list_media_task_artifacts.modality_runtime_contracts` 现在汇总 evaluation status / decision / decision source 与 blocking / ask / pending refs，每条 snapshot 也输出对应字段；Rust index、前端类型、浏览器 fallback mock 与 `mediaTasks` 回归同步。该刀只让任务索引能展示 evaluator 解释，不新增 Tauri command、不接 LimeCore 云 run/poll，也不改变顶层 local default decision 语义。
59. `Phase 6` 第六十六刀把 policy evaluator explanation 接入配音/转写任务卡恢复层：新增共享 meta helper，`useWorkspaceAudioTaskPreviewRuntime` 与 `useWorkspaceTranscriptionTaskPreviewRuntime` 从统一媒体任务索引 snapshot 生成 `LimeCore 策略输入待命中 / 阻断 / 需确认` 轻卡标签，并补 audio input gap 与 transcription deny 回归。该刀只消费现有索引，不新增命令、不碰上层 `@`，也不把 pending input gap 解释成真实用户确认。
60. `Phase 6` 第六十七刀把 policy evaluator explanation 接入图片任务 viewer：`useWorkspaceImageTaskPreviewRuntime` 从图片 task artifact 的 `runtime_contract.limecore_policy_snapshot.policy_evaluation` 解析 snapshot / missing / pending / blocking / ask refs，`ImageTaskViewer` 复用共享 helper 展示 `LimeCore 策略输入待命中: N` 等轻量标签，并补图片恢复与 viewer 回归。该刀只消费已有 runtime contract，不新增命令、不接 LimeCore 云 run/poll，也不把图片上层 `@` 入口改成策略事实源。
61. `Phase 6` 第六十八刀把 policy evaluator explanation 接入图片消息轻卡：`ImageWorkbenchMessagePreview` 复用共享 helper，从 `preview.runtimeContract` 解析同一份 evaluator 摘要，并在聊天区图片预览顶部展示 `LimeCore 策略输入待命中 / 阻断 / 需确认` 胶囊标签；该刀只让图片消息卡消费已有 runtime contract，不新增命令、不接 LimeCore 云 run/poll，也不改图片消息的布局骨架。
62. `Phase 5/6` 第七十一刀把 profile / adapter 摘要接入 thread read：`AgentRuntimeThreadReadModel` 现在会扫描最近 ToolCall metadata / FileArtifact content 中的 runtime contract，并把 `contractKey`、`routingSlot`、`requiredCapabilities`、`profileKey`、`executorAdapterKey`、`executorKind`、`executorBindingKey` 写入 `runtime_summary.modalityRuntime`。该刀只投影已有底层合同，不新增命令、不接云 run/poll，也不把上层 `@` 命令当执行合同事实源。
63. `Phase 5/6` 第七十二刀把 profile / adapter / binding 摘要合入 `SessionExecutionRuntimeTaskProfile`：`build_runtime_task_profile()` 现在会从 request metadata 中已有的 `runtime_contract / modality_runtime_contract` 提取 `modalityContractKey`、`routingSlot`、`executionProfileKey`、`executorAdapterKey`、`executorKind`、`executorBindingKey`，并按 `modalityExecutionProfiles.json` 补齐 `permissionProfileKeys` 与 `userLockPolicy`；`lime_runtime.task_profile` 和 `task_profile_resolved` 事件会承载同一摘要，前端 API 类型与协议测试同步。该刀仍不新增 Tauri command、不接 LimeCore 云 run/poll、不把上层 `@` 命令当事实源；权限判定执行、用户显式模型锁定 enforcement 与真实 `gateway:*` adapter preflight 继续后置。
64. `Phase 5/6` 第七十三刀把 `routingSlot` 推进到最小模型能力 enforcement：`request_model_resolution` 现在会把 `routingSlot` 映射成 runtime model capability requirements，并用它过滤候选池、fallback 候选与多候选自动重选；`browser_reasoning_model` 会要求 reasoning，`image_generation_model` 会允许专用图片模型进入候选池，显式用户模型锁定仍 honored，但 `capability_gap` 会输出对应 `*_candidate_missing`。该刀不新增 Tauri command、不接 LimeCore 云 run/poll、不触碰上层 `@` 命令；完整权限判定和用户确认/阻断执行继续后置。

暂不做：

1. 暂不把所有 `@`、按钮、Scene 批量登记到 `bound_entries`；已进入主链的 `image_generation`、`browser_control`、`pdf_extract`、`voice_generation`、`web_research`、`text_transform`、`audio_transcription` 继续按合同逐条收口，未进入 current 事实源的入口不批量扩张。
2. 暂不把 LimeCore 写成默认执行器；LimeCore 仍只作为 catalog / policy / offer / audit 控制面。
3. 暂不批量改造视频、PDF、搜索、研报等其他 viewer；已补到最小 viewer / index 的 browser 与 voice 继续沿同一事实源演进，未形成稳定 artifact graph 的能力先不另开 viewer 协议。
4. 暂不新增 PDF task artifact / reader viewer；PDF 本轮只收 executor trace、evidence 和 replay，避免在底层事实源未完全稳定前再开一套产物协议。
5. 暂不新增完整音频工作台，也暂不把 Gemini / Azure 专有语音 API、LimeCore 云 run/poll 或语音后处理工作流并入主链；voice 目前只提供最小 `audio_generate` 任务卡、运行时文档 viewer、OpenAI-compatible speech provider seam 与完成/失败态回流。未配置可用 provider 时仍必须显式失败，不伪造云端提交，也不把普通聊天文本或通用文件卡当作音频产物。
6. 暂不新增独立 `report_generation` 合同；`@研报 / @竞品` 继续走 `report_skill_launch -> Skill(report_generate)` 主链，但其底层能力归属先收敛到 `web_research`，避免把 report artifact 协议提前扩张成第二套事实源。
7. 暂不新增独立 `summary_generation`、`translation`、`analysis`、`publish_compliance` 或 `logo_decomposition` 合同；这组轻量文本/文档转换入口先统一收敛到 `text_transform`，避免把上层 `@` 命令提前扩张成平行底层事实源。
8. 暂不新增非 OpenAI-compatible ASR adapter 或本地离线 ASR 执行器；`audio_transcription` 当前交付标准 `transcription_generate` task writer、`lime-transcription-worker`、`transcript.completed/failed` 回写、统一媒体任务索引、聊天任务卡、可编辑校对运行时文档 viewer、JSON/SRT/VTT 时间轴与说话人段落展示、ArtifactDocument 版本化校对稿保存、校对稿状态/差异摘要、Evidence `transcriptIndex` 与 Replay 检查。
9. 暂不在本刀实现完整权限判定 enforcement、用户确认/阻断执行、LimeCore 云端 allow / ask / deny evaluator、真实 `gateway:*` adapter preflight 或完整 GUI/evidence 可视化；当前已让图片、配音、转写媒体 worker 消费 Phase 3 / Phase 5 的 profile / adapter 事实源做最小执行前检查，并把 Browser Assist preflight、通用 Skill metadata/preflight、`lime_run_service_skill` voice compat guard、Phase 6 的 LimeCore policy refs/snapshot、model/offer/gateway/tenant hit producers、最小本地 policy input evaluator、thread read 摘要、`SessionExecutionRuntimeTaskProfile` profile/adapter/binding merge、`routingSlot` 模型能力 enforcement、统一媒体任务索引 explanation、配音/转写任务卡 meta、图片 viewer policy 标签与图片消息轻卡标签接进 current 主链。显式用户模型锁定已能输出 capability gap，但还没有接用户确认或阻断执行。后续继续把同一决策扩展到权限执行、确认式用户锁定处理、云端策略 evaluator、真实 Gateway adapter、更多任务卡与更多 GUI 可视化。

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
- 旧 `lime_run_service_skill` 只能作为服务型场景 compat guard；`voice_generation` 必须携带并校验 `service_skill:voice_runtime` 合同，不允许恢复云 run/poll。

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
- 2026-04-30：继续第十八刀 `web_research` evidence/replay：`runtime_evidence_pack_service` 现在会从 `Skill(research)` / `Skill(site_search)` tool timeline 的 args 或 metadata 导出 `web_research` 的 `modalityRuntimeContracts`，`source=web_research_skill_trace.modality_runtime_contract`、`routingEvent=executor_invoked`、`routingOutcome=accepted/failed`、`expectedRoutingSlot=report_generation_model`；`runtime_replay_case_service` 同步增加 `web-research`、`research-skill`、`web-research-trace` tags，并在 expected / grader 中要求继续走 `Skill(research)` / `Skill(site_search)` 与真实 search*query / `lime_site*\*`证据，禁止`model_memory_only_answer`、`local_file_search_before_research_skill`、ToolSearch 或普通聊天替代。
- 2026-04-30：继续第十九刀 `web_research` 索引化：`runtime_evidence_pack_service` 的 `modalityRuntimeContracts` 现在输出 `snapshotIndex`，汇总 `contractKeys`、`sourceCounts`、`routingOutcomeCounts`、`expectedRoutingSlots` 与 `toolTraceIndex.items`；`web_research` replay input 会携带同一份索引，使回归样本能直接定位 `executorBindingKey=research`、`entrySource=at_search_command` 与 `web_research_skill_trace`，不再只能扫描 raw snapshots。
- 2026-04-30：继续第二十刀 `web_research` 报告型子入口：`web_research.bound_entries` 纳入 `at_report_command` 与 `at_competitor_command`，前端 `@研报 / @竞品` 发送会在 `harness.report_skill_launch.report_request` 注入同一份 `web_research` contract；Rust `report_skill_launch` prepare / prompt 也补齐合同字段，同时保留首刀 `Skill(report_generate)`，并把 evidence / replay 扩展到 `report_generate` trace，避免另开 `report_generation` 平行事实源。
- 2026-04-30：继续第二十一刀 `text_transform`：新增 `text_transform` contract 并登记 `at_file_read_command`、`at_summary_command`、`at_translation_command`、`at_analysis_command`、`at_publish_compliance_command`、`at_logo_decomposition_command`；前端 `@读文件 / @总结 / @翻译 / @分析 / @发布合规 / @Logo拆解`、Rust summary/translation/analysis prepare 与 prompt、evidence `text_transform_skill_trace`、replay tags / expected / grader 已统一收敛到同一份底层合同，入口层不再新增 summary / translation / analysis 平行事实源。
- 2026-04-30：继续第二十二刀 `voice_generation` evidence/replay：`runtime_evidence_pack_service` 现在会从 voice runtime / service scene timeline args 或 metadata 导出 `voice_generation` 的 `modalityRuntimeContracts`，`source=voice_generation_service_scene_trace.modality_runtime_contract`、`routingEvent=executor_invoked`、`routingOutcome=accepted/failed`、`expectedRoutingSlot=voice_generation_model`；`runtime_replay_case_service` 同步增加 `voice-generation`、`voice-runtime`、`voice-generation-trace` tags，并在 expected / grader 中要求继续走 `service_scene_launch(scene_key=voice_runtime)` / 本地 ServiceSkill runtime 或后续 audio_task/audio_output 证据，禁止 `legacy_tts_test_command`、伪造云端提交、普通聊天文本或通用文件卡替代。
- 2026-04-30：继续第二十三刀 `voice_generation` audio artifact protocol：新增 `audio_generate` task type、`create_audio_generation_task_artifact` Tauri 命令与 `lime_create_audio_generation_task` Agent tool，只写入标准 `audio_task/audio_output` 产物，不生成真实音频、不提交云端；前端 API、DevBridge mock、`list_media_task_artifacts` contract index、evidence `audio_task.modality_runtime_contract` 与 replay grader 已同步消费同一份 `voice_generation` 合同快照，下一刀再补 audio viewer / 真实 worker。
- 2026-04-30：继续第二十四刀 `voice_generation` audio preview/viewer：`lime_create_audio_generation_task` 工具结果现在会带回 `source_text / voice / audio_path / duration_ms` 等任务元数据，前端 `taskPreviewFromToolResult` 可生成 `audio_generate` 任务卡，并同步生成 `.lime/runtime/audio-generate/*.md` 运行时文档 viewer；聊天区任务卡采用 Lime 现有轻卡视觉，打开后进入可读文档而不是暴露隐藏 task JSON，真实音频 worker 与完整音频工作台继续后置。
- 2026-04-30：继续第二十五刀 `voice_generation` audio_output 回写闭环：新增 `complete_audio_generation_task_artifact` 命令与前端 API / DevBridge mock / governance catalog / mockPriority 同步，执行器可把标准 `audio_generate` task 从 pending 更新为 `succeeded`，并把完成态 `audio_output` 同时写入 payload 与 result；本刀仍不引入真实音频 worker、LimeCore 云执行 run/poll 或 legacy TTS。
- 2026-04-30：继续第二十六刀 `voice_generation` audio preview runtime：新增 `useWorkspaceAudioTaskPreviewRuntime`，聊天工作区会监听 `lime://creation_task_submitted` 并轮询仍在 running 或缺少音频 URL 的 `audio_generate` 任务，从标准 task artifact 恢复完成态 `audio_output` 到任务卡；这一步把第二十五刀写回口真正接回用户可见轻卡，但仍不新增完整音频工作台。
- 2026-04-30：继续第二十七刀 `voice_generation` audio worker skeleton：`create_audio_generation_task_artifact` 现在会在 emit 标准媒体任务事件后启动 `lime-audio-worker` 骨架；骨架先把任务推进到 `running`，随后在真实 provider 未接通时写回 `audio_worker_unavailable` 可重试失败与 `payload.audio_output.status=failed`，不生成假 `audio_path`、不调用 legacy TTS，也不新增 LimeCore 云 run/poll 协议。
- 2026-04-30：继续第二十八刀 `voice_generation` OpenAI-compatible audio provider seam：`lime-audio-worker` 不再停在纯骨架失败，而是从标准 `audio_generate` task payload / 全局 `media_defaults.voice` 解析 provider 与 model，通过 current API Key Provider 主链拿到 OpenAI-compatible `api_key/base_url`，调用 `/audio/speech` 返回真实音频 bytes 后保存到 `.lime/runtime/audio/<task_id>.mp3`，再回写 `payload.audio_output.completed` 与 `record.result.audio_output`；无 AppHandle、DbConnection、ApiKeyProviderService、provider/model/API Key 或非 OpenAI-compatible client 时写回明确 `audio_provider_*` 失败码，不回退 `legacy_tts_test_command`、`test_tts`、伪云端提交或通用文件卡。
- 2026-04-30：继续第二十九刀 `voice_generation` audio failure preview：聊天区 `useWorkspaceAudioTaskPreviewRuntime` 现在会从标准 `audio_generate` task artifact 的 `payload.audio_output` / `record.last_error` 读取 `audio_provider_*` 错误码、错误原因与 retryable，并在失败 artifact 没有 `audio_path` 时清空任务卡音频路径；`TaskMessagePreview` 同步展示 Provider 错误码和原因，让未配置 provider、resolver 不可用或 adapter 缺失直接回到用户可见任务卡，不再泛化成普通失败，也不伪造音频结果。
- 2026-04-30：继续第三十刀 `voice_generation` audio viewer sync：`useWorkspaceAudioTaskPreviewRuntime` 在从标准 `audio_generate` task artifact 恢复完成/失败态时，会同步重建同一条 `.lime/runtime/audio-generate/*.md` 运行时文档的 ArtifactDocument metadata；打开聊天任务卡时，viewer 会展示 `audio_output.completed` 的真实音频路径，或展示 `audio_provider_*` 错误码与原因，不再停留在创建任务时的“等待音频执行器”文档。
- 2026-04-30：继续第三十一刀 `voice_generation` audio evidence/replay details：`runtime_evidence_pack_service` 现在会从 `audio_generate` task artifact 导出 `audioOutput` 摘要，并在 `snapshotIndex.audioOutputIndex` 汇总 audio output 状态、Provider 错误码与 worker；`runtime_replay_case_service` 同步把 `audio-output-completed` / `audio-output-failed` 纳入 suite tags / failure modes，并在 expected / grader 中要求 replay 保留 `audio_output.completed` 与真实 `audio_path`，或显式处理 Provider 失败，不允许回退 legacy TTS、伪造音频路径、普通聊天文本或通用文件卡。
- 2026-04-30：继续第三十二刀 `voice_generation` audio task index details：`media_task_cmd` 的 `list_media_task_artifacts` 索引现在把 `audio_output` 完成/失败事实直接纳入 `modality_runtime_contracts`，包含按状态汇总、Provider 错误码汇总，以及每个 task snapshot 的 `audio_output_status/path/mime_type/duration_ms/error_code/retryable`；`src/lib/api/agentRuntime/types.ts` 与浏览器 fallback mock 同步更新，避免浏览器链路或前端恢复逻辑只能靠重新读取隐藏 task JSON 才能判断音频产物状态。
- 2026-04-30：继续第三十三刀 `voice_generation` audio index restore：聊天工作区的 `useWorkspaceAudioTaskPreviewRuntime` 现在会先按 `voice_generation + audio_generate` 查询统一媒体任务索引，从 snapshot 的 `audio_output_status/path/mime_type/duration_ms/error_code/retryable` 直接恢复任务卡和 `.lime/runtime/audio-generate/*.md` viewer；索引缺失或旧 task 没有 `audio_output_status` 时才保留原来的单 task artifact 读取兜底，避免主路径继续依赖隐藏 task JSON。
- 2026-04-30：继续第三十四刀 `Phase 4 artifact graph`：新增 `docs/roadmap/warp/artifact-graph.md` 与 `src/lib/governance/modalityArtifactGraph.json`，把 `image/audio/browser/pdf/report/presentation/webpage/generic_file` 的 artifact kind、truth source、viewer、evidence 与 task index 字段落成可检查事实源；`governance:modality-contracts` 现在会校验 contract 的 `artifact_kinds` 必须能在 artifact graph 中找到 truth source / viewer / evidence 交集，防止新增多模态能力继续退回未知 viewer 或通用文件卡旁路。
- 2026-04-30：继续第三十五刀 `browser_control entry binding`：`browser_control.bound_entries` 现在登记 `@浏览器 / @browser / @browse`、`@Browser Agent`、`@Mini Tester`、`@Web Scheduler`、`@Web Manage`，所有入口只声明 `harness.browser_assist` launch metadata、默认输入映射与可见性策略；前端 Browser Assist launch 会按触发词从 registry 派生 `entry_source`，不再把所有浏览器别名压成同一个入口来源，也不让入口直接写 task / artifact / viewer。
- 2026-04-30：继续第三十六刀 `browser_control browserActionIndex`：`runtime_evidence_pack_service` 现在会从 Browser Assist tool metadata 提取 `browserAction` 摘要，并在 `modalityRuntimeContracts.snapshotIndex.browserActionIndex` 汇总 actionCount、sessionCount、lastUrl、observationCount、screenshotCount、backend/status/action 计数与逐项 `browser_session` / `browser_snapshot` artifactKind；`runtime_replay_case_service` 同步把 `browser-action-index` 纳入 suite tags / expected / grader，要求 replay 继续导出可查询 browser session/snapshot 索引，而不是只靠 raw snapshots 或 WebSearch 替代。
- 2026-04-30：继续第三十七刀 `browser_control Harness visible index`：Evidence Pack 的 `observabilitySummary.modalityRuntimeContracts.snapshotIndex.browserActionIndex` 现在会携带裁剪后的 Browser Assist 摘要，前端 `AgentRuntimeEvidencePack` 类型与 normalizer 同步解析该索引；`HarnessStatusPanel` 在导出问题证据包后展示 Browser Assist 索引卡，直接暴露 action/session/URL/observation/screenshot 与最近 `browser_session` / `browser_snapshot` 项，证明浏览器复盘已从 runtime.json 人工查找前进到用户可见 evidence 面板。
- 2026-04-30：继续第三十八刀 `browser_control browser_replay_viewer`：`HarnessStatusPanel` 的 Browser Assist 索引卡新增“打开复盘”，以 evidence pack + `browserActionIndex` 构造临时 `browser_assist` Artifact；`BrowserAssistRenderer` 现在可从 artifact meta 或 JSON content 读取 `browserActionIndex`，渲染最小 `browser_replay_viewer`，展示动作统计、最近 URL、会话/target/entry、截图可用性与最近 `browser_session` / `browser_snapshot`。这一步把 evidence 可见摘要推进到 Lime 内部复盘面，但仍不新增 browser task 文件协议；完整交互回放、权限 profile 可视化与截图/DOM/network 深层展开继续后置。
- 2026-04-30：继续第三十九刀 `audio_transcription contract`：新增 current `audio_transcription` contract，绑定 `@转写 / @transcribe / @Audio Extractor` 到 `harness.transcription_skill_launch.transcription_task`；前端 `@转写` metadata 现在携带 `modality_contract_key=audio_transcription`、`required_capabilities=[text_generation,audio_transcription]`、`routing_slot=audio_transcription_model` 与 `runtime_contract`，Rust `transcription_skill_launch` 也会为旧 metadata 补齐同一合同并在 prompt 中禁止 `frontend_direct_asr`、`generic_file_transcript`、转写前 ToolSearch/WebSearch 偏航。`transcript` artifact graph 已反向登记该合同；真实转写 worker、transcript viewer 与 evidence/replay 索引继续后置。
- 2026-04-30：继续第四十刀 `audio_transcription transcript task/index/evidence/replay`：`lime_create_transcription_task`、`create_transcription_task_artifact_inner` 与 CLI `lime task create transcription` / `lime media transcription generate` 现在写入同一标准 `transcription_generate` task file，payload 固化 `audio_transcription` 合同、`requested_target=transcript` 与 `transcript.pending`；`list_media_task_artifacts` 增加 `transcript_count/statuses/error_codes` 与每个 task 的 `transcript_*` snapshot，Evidence Pack 增加 `snapshotIndex.transcriptIndex`，Replay / grader 增加 `audio-transcription`、`transcription-task-trace`、`transcript-index` 标签与缺失/失败阻断检查。真实 ASR worker、完成态 transcript 回写和专属 transcript viewer 仍作为下一刀。
- 2026-04-30：继续第四十一刀 `audio_transcription transcription worker`：`lime_create_transcription_task` 现在在创建标准 `transcription_generate` task 后启动 `lime-transcription-worker`；worker 校验 `audio_transcription` contract、读取本地 source file 或下载 `source_url`，通过 current API Key Provider 解析 OpenAI-compatible credential，调用 `/audio/transcriptions`，成功时写入 `.lime/runtime/transcripts/*` 并回写 `transcript.completed`、`transcript_path`、`provider_id/model` 与 `record.result.transcript`；失败时回写 `transcript.failed` 和 `transcription_provider_*` / `transcription_source_*` / contract 错误码，不回退 frontend ASR、普通文件读取或 generic_file transcript。最小 GUI 恢复层已在第四十二刀接回，文本校对已在第四十三刀接回，时间轴/说话人段落展示已在第四十四刀接回；编辑保存型 transcript viewer、更多 ASR adapter 与本地离线 ASR 继续后置。
- 2026-04-30：继续第四十二刀 `audio_transcription transcript visible restore`：聊天工作区新增 `useWorkspaceTranscriptionTaskPreviewRuntime`，会优先从 `list_media_task_artifacts(modalityContractKey=audio_transcription, taskType=transcription_generate)` 的 `transcript_*` snapshot 恢复完成/失败态，把 `transcript_path`、source、language、outputFormat、Provider 错误码同步到任务卡与 `.lime/runtime/transcription-generate/*.md` 运行时文档；只有索引缺失时才回退读取单个 task artifact，避免用户可见路径继续依赖隐藏 task JSON 或 generic_file transcript。
- 2026-04-30：继续第四十三刀 `audio_transcription transcript proofreading viewer`：`useWorkspaceTranscriptionTaskPreviewRuntime` 在完成态恢复时读取 `transcript_path` 对应文本，并把 `transcriptText` 写回任务预览和 `.lime/runtime/transcription-generate/*.md` 运行时文档；`buildTranscriptionTaskArtifactDocument` 现在输出“转写文本（可编辑校对）”代码块，让打开任务卡即可在 Lime 内部读取、复制与校对 transcript，而不是只看到路径或退回 generic_file。
- 2026-04-30：继续第四十四刀 `audio_transcription transcript timeline viewer`：新增 transcript segment 解析器，支持从 OpenAI verbose JSON、SRT 与 VTT 读取 `start/end/speaker/text`，并把结果回写到聊天任务卡时间轴预览与 `.lime/runtime/transcription-generate/*.md` ArtifactDocument 表格；本刀只消费同一 `transcription_generate` task file 与 `transcript_path` 输出，不新增协议、Tauri command、frontend ASR 或 generic_file 旁路。编辑保存型 transcript viewer、更多 ASR adapter 与本地离线 ASR 继续后置。
- 2026-04-30：继续第四十五刀 `audio_transcription transcript correction save`：复用现有 ArtifactDocument Workbench 编辑保存链路，让转写运行时文档的文本与时间轴从“可复制校对”推进到“可保存校对稿”；生成文档会标记 `transcriptCorrectionEnabled` / `transcriptCorrectionSource=artifact_document_version` 并提示保存不改写原始 ASR 输出，保存时补 `transcriptCorrectionStatus=saved`、编辑 block、原始 transcript 路径、文本长度、段落/说话人数与 `transcriptSegmentsCorrected`。本刀没有新增 Tauri command、Rust worker 分支、frontend ASR 或 generic_file patch 旁路。
- 2026-04-30：继续第四十六刀 `audio_transcription transcript correction status`：保存校对稿时会在同一 ArtifactDocument 中插入/更新 `transcript-correction-status` 成功提示块，明确“校对稿已保存为当前运行时文档的新版本；原始 ASR 输出文件保持不变”，并写入 `transcriptCorrectionDiffSummary`，汇总原文/校对稿文本长度、段落数量、变更段落和说话人数差异。该状态仍随同一 `.lime/runtime/transcription-generate/*.md` 运行时文档版本保存，不新增命令、worker 分支或并行 patch artifact。
- 2026-04-30：继续第四十七刀 `Phase 3 / Phase 5 execution profile registry`：新增 `docs/roadmap/warp/execution-profile.md` 与 `src/lib/governance/modalityExecutionProfiles.json`，把 7 个 current contracts 的 profile、artifact policy、LimeCore policy refs 与 executor adapters 落成机器事实源；`check-modality-runtime-contracts.mjs` 现在会读取 profile registry，校验每个 current contract 都被 profile 覆盖、每个 `executor_binding` 都有 adapter、adapter 支持位/产物/权限/failure mapping 与 contract 对齐。该刀不改 Tauri command、bridge、mock 或真实 executor 行为，只把 Phase 3/5 的主线底座从文档要求推进成可阻断错误配置的 current 守卫。
- 2026-04-30：继续第四十八刀 `Phase 3 / Phase 5 profile resolver`：新增 `src/lib/governance/modalityExecutionProfiles.ts` 与定向测试，`resolveModalityRuntimeContractBinding()` 会把 current contract 对应的 `execution_profile`、`executor_adapter`、`executionProfileKey`、`executorAdapterKey` 注入同一 runtime contract binding；所有现有上层入口继续只调用 runtime contract resolver，即可随 launch metadata 携带 profile / adapter 快照。本刀没有新增命令、bridge、mock、Rust executor 或 GUI surface，只把上一刀的机器事实源推进到前端主路径输入。
- 2026-04-30：继续第四十九刀 `Phase 3 / Phase 5 evidence snapshot`：`runtime_evidence_pack_service` 现在会从 runtime contract 中提取 `executionProfileKey` 与 `executorAdapterKey`，并写入 `modalityRuntimeContracts.snapshots[]`、`snapshotIndex.executionProfileKeys`、`snapshotIndex.executorAdapterKeys` 与 `toolTraceIndex.items[]`；图片 contract preflight 失败样本与 web_research Skill trace 样本都增加断言，证明 profile / adapter 已进入 evidence 主链，而不是只停留在前端 metadata 或治理 JSON。本刀未改命令、bridge、mock、GUI 或真实 executor 行为。
- 2026-04-30：继续第五十刀 `Phase 3 / Phase 5 task index snapshot`：Rust 多模态 `runtime_contract` snapshot 现在随 central contract helper 写入 `execution_profile.profile_key` 与 `executor_adapter.adapter_key`；`list_media_task_artifacts` 会把这些字段汇总到 `modality_runtime_contracts.execution_profile_keys`、`executor_adapter_keys`，并在每条 snapshot 输出 `execution_profile_key` / `executor_adapter_key`。前端 `MediaTaskModalityRuntimeContractIndex` 类型、浏览器 fallback mock、图片/配音/转写任务恢复测试同步更新，证明 profile / adapter 已进入统一媒体任务索引，而不是只停留在 evidence/replay。
- 2026-04-30：继续第五十一刀 `Phase 3 / Phase 5 media worker adapter preflight`：`validate_*_task_execution_contract` 现在会在图片、配音、转写 worker 进入真实执行器前校验 `execution_profile.profile_key`、`executor_adapter.adapter_key` 与 `executor_binding.executor_kind/binding_key`，错配时以 `runtime_preflight` 阶段阻断，而不是等 provider/worker 泛化失败；`list_media_task_artifacts` snapshot 同步暴露 `executor_kind` / `executor_binding_key`，浏览器 fallback mock 与前端类型跟进，Evidence Pack 也会把这类阻断标记为 `runtime_preflight` / `blocked`。
- 2026-05-01：继续第五十二刀 `Phase 6 policy snapshot seed`：central Rust contract helper、前端 runtime contract resolver 与浏览器 fallback mock 现在都会携带 `limecore_policy_refs` 与最小 `limecore_policy_snapshot(status=refs_declared, decision=not_evaluated)`；`list_media_task_artifacts` 汇总 policy refs/status/decision，Evidence Pack 增加 `snapshotIndex.limecorePolicyIndex`，前端 normalizer 与测试同步。该刀不新增命令、不实现真实 LimeCore 云执行，只把后续 allow / ask / deny 需要的审计字段接入 current 主链。
- 2026-05-01：继续第五十三刀 `Phase 6 local policy decision summary`：`limecore_policy_snapshot` 从 `not_evaluated` 推进到本地默认 `allow` 摘要，并写入 `decision_source=local_default_policy`、`decision_scope=local_defaults_only`、`decision_reason=declared_policy_refs_with_no_local_deny_rule` 与 `unresolved_refs`；统一媒体任务索引和 Evidence Pack 同步暴露这些解释字段。该刀仍不新增命令、不调用 LimeCore 云、不碰上层 `@` 入口；真实 tenant / provider / gateway policy 命中值继续后置。
- 2026-05-01：继续第五十四刀 `Phase 6 policy input gap summary`：`limecore_policy_snapshot` 新增 `policy_inputs[]` 与 `missing_inputs[]`，把每个 policy ref 标成 `declared_only / limecore_pending`；Evidence Pack `limecorePolicyIndex` 与统一媒体任务索引同步输出 missing inputs，让后续接入真实 LimeCore `model_catalog / provider_offer / tenant_feature_flags / gateway_policy` 命中值时有稳定 diff 面。该刀不新增命令、不触发云执行，也不修改上层 `@`。
- 2026-05-01：收口第五十四刀验证：定向前端/Rust 测试、`typecheck`、`governance:modality-contracts`、`test:contracts`、`harness:doc-freshness`、相关文件 `git diff --check` 与 `verify:local` 均已通过；GUI smoke 复用 headless Tauri 与 DevBridge，证明本轮底层审计字段接线没有破坏 workspace、browser runtime、site adapter 与 agent runtime tool surface 主路径。
- 2026-05-01：继续第五十五刀 `Phase 6 policy gap evidence visibility`：Harness evidence 面板新增 `LimeCore 策略缺口` 摘要卡，直接从 `limecorePolicyIndex` 展示 policy snapshot 数、refs、missing inputs、local default decision、profile / adapter、decision scope/reason 与 `declared_only / limecore_pending` 输入状态；该刀只消费现有 evidence 字段，不新增 Tauri command、不接 LimeCore 云 run/poll、不触碰上层 `@` 入口。
- 2026-05-01：继续第五十六刀 `Phase 6 policy gap replay grader`：Replay case 现在会把 `limecorePolicyIndex` 转成 suite tags、failure modes、success criteria、blocking checks 与多模态合同检查，要求回放继续保留 policy refs、missing inputs、`local_default_policy` / `local_defaults_only` 解释；该刀确保 policy gap 能被复盘验收，而不是只停留在 evidence UI。
- 2026-05-01：继续第五十七刀 `Phase 6 policy hit value wiring`：在不接云 run/poll 的前提下，为真实 LimeCore policy 命中值补空接线结构：`policy_value_hits[]` 保持空、`pending_hit_refs[]` 指向等待命中的 refs、`policy_value_hit_count=0`，并贯通 runtime contract、Evidence Pack、任务索引、前端类型/normalizer 与 mock；后续接真实 LimeCore 值时只需填充同一字段，不再改协议外形。
- 2026-05-01：继续第五十八刀 `Phase 6 policy hit resolver seam`：`policy_value_hits(status=resolved)` 现在会被 central runtime contract helper、前端 resolver、Evidence Pack、媒体任务索引与浏览器 mock 统一识别；命中的 ref 会进入 `evaluated_refs`，未命中的 ref 继续留在 `missing_inputs / pending_hit_refs`。该刀只建立“真实命中值写入与派生待命中 refs”的 seam，不接 LimeCore 云 run/poll，也不把本地默认 decision 升级成真实 allow / ask / deny。
- 2026-05-01：继续第五十九刀 `Phase 6 local model_catalog hit producer`：图片任务执行前复用已有 model registry assessment，把命中的模型目录事实写入 `policy_value_hits(status=resolved, value_source=local_model_catalog)`，同步更新 `runtime_contract` snapshot、当前 attempt input snapshot 与统一媒体任务索引；该刀只让 `model_catalog` 输入从 pending 变成 resolved，不接 provider offer / tenant flags，也不把本地默认 `allow` 解释成云策略放行。
- 2026-05-01：继续第六十刀 `Phase 6 local provider_offer hit producer`：图片任务进入真实执行器前复用已解析的本地 runner config/API key 与 task payload provider/model，把 `provider_offer` 写入 `policy_value_hits(status=resolved, value_source=local_provider_offer)`，同步收缩 `missing_inputs / pending_hit_refs`；snapshot 只记录 endpoint origin/path、adapter 与 credential 状态，不写 API key，不新增 Tauri command，也不接 LimeCore 云 run/poll。
- 2026-05-01：继续第六十一刀 `Phase 6 request gateway_policy hit producer`：Browser Assist 与 Web Research 类 launch 复用请求侧 `harness.oem_routing`，把 tenant/provider/quota/can_invoke/fallback 等真实路由输入写入对应 runtime contract 的 `policy_value_hits(status=resolved, value_source=request_oem_routing)`；命中后 `gateway_policy` 会进入 `evaluated_refs`，但 `decision` 仍保持 `local_default_policy / local_defaults_only`，不新增命令、不接云 run/poll，也不伪造 tenant feature flags。
- 2026-05-01：继续第六十二刀 `Phase 6 request tenant_feature_flags hit producer`：Workspace send metadata 从 OEM Cloud bootstrap snapshot 的 `features` 生成 `harness.tenant_feature_flags`，Rust runtime contract helper 在所有 request metadata runtime contract 中写入 `policy_value_hits(status=resolved, value_source=oem_cloud_bootstrap_features)`；命中后 `tenant_feature_flags` 会进入 `evaluated_refs`，但 `decision` 仍保持 `local_default_policy / local_defaults_only`，不新增命令、不接云 run/poll，也不把 feature flags 当作真实 allow / ask / deny evaluator。
- 2026-05-01：继续第六十三刀 `Phase 6 policy input evaluator seam`：central Rust contract helper 与前端 runtime contract resolver 新增 `policy_evaluation`，当所有 refs 都有 resolved hit 时用 `policy_input_evaluator` 给出 `allow / ask / deny` 顶层决策；gateway `can_invoke=false` / blocked、tenant `gatewayEnabled=false`、model catalog 不支持目标能力或 provider credential 非 configured 会产生 `deny`，quota low / subscribe required / logged out 会产生 `ask`。仍有 missing inputs 时只记录 `policy_evaluation.status=input_gap`，顶层仍保持 `local_default_policy / local_defaults_only`，不接云 run/poll、不新增命令。
- 2026-05-01：继续第六十四刀 `Phase 6 thread read policy explanation`：`AgentRuntimeThreadReadModel` 现在会从最新 tool metadata / file artifact 中的 runtime contract 提取 `limecore_policy_snapshot`，并写入 `runtime_summary.limecorePolicy`；上层读取 thread read 时可直接看到 contract key、snapshot status、顶层 decision/source/scope/reason、refs、missing/pending refs、hit count 与 evaluator blocking/ask/pending refs。本刀不新增命令、不接 LimeCore 云 run/poll，也不把 thread read 结果当云端 audit 事实源。
- 2026-05-01：继续第六十五刀 `Phase 6 media task policy evaluation index`：`list_media_task_artifacts` 的 `modality_runtime_contracts` 现在汇总 `policy_evaluation` status / decision / source 与 blocking / ask / pending refs，每条 snapshot 也输出同名 `limecore_policy_evaluation_*` 字段；前端类型、浏览器 fallback mock 与 mediaTasks 回归同步。该刀只把 evaluator explanation 推到任务索引，不新增命令、不接云 run/poll，也不把 input gap 的 evaluator `ask` 覆盖成顶层真实策略结论。
- 2026-05-01：继续第六十六刀 `Phase 6 task card policy evaluation meta`：配音与转写任务卡恢复层现在会消费统一媒体任务索引的 `limecore_policy_evaluation_*` snapshot，通过共享 helper 生成 `LimeCore 策略输入待命中: N`、`LimeCore 策略输入阻断: <ref>` 或 `LimeCore 策略输入需确认: <ref>` meta 标签；audio input gap 与 transcription deny 都有稳定回归。该刀只让现有任务卡展示 evaluator explanation，不新增 Tauri command、不接 LimeCore 云 run/poll，也不触碰上层 `@` 命令。
- 2026-05-01：继续第六十七刀 `Phase 6 image viewer policy evaluation meta`：图片任务恢复层现在会从 `runtime_contract.limecore_policy_snapshot.policy_evaluation` 解析 LimeCore evaluator 摘要，写入 `ImageRuntimeContractSnapshot` 并在图片 viewer 的运行合同标签旁展示 `LimeCore 策略输入待命中 / 阻断 / 需确认`；本刀只消费已有 task artifact runtime contract，不新增命令、不接 LimeCore 云 run/poll，也不修改图片上层入口。
- 2026-05-01：继续第六十八刀 `Phase 6 image message card policy evaluation meta`：图片消息轻卡现在从 `preview.runtimeContract` 读取同一 LimeCore evaluator 摘要，并在预览顶部 meta pills 展示 `LimeCore 策略输入待命中 / 阻断 / 需确认`；本刀只消费已有图片 runtime contract，不新增命令、不接 LimeCore 云 run/poll，也不改变轻卡打开 viewer 的导航能力。
- 2026-05-01：继续第六十九刀 `Phase 5 voice service compat guard`：旧 `lime_run_service_skill` 命中 `voice_generation / voice_runtime / at_voice_command / voice_generation_model` 时，会生成 `modality_runtime_contract` metadata 并校验 `contract_key=voice_generation`、`execution_profile=voice_generation_profile`、`executor_adapter=service_skill:voice_runtime`、`executor_binding=service_skill:voice_runtime`；错配返回 `runtime_preflight`，通过也只返回 compat guard，不执行云 run/poll。该刀把旧服务型工具收成 guard，不把它升级为 current executor，也不提前硬造 `gateway:*` adapter。
- 2026-05-02：继续第七十刀 `Phase 5/6 Rust preflight verification seam`：`WebSearchPreflightRequest` 现在从 `lime_agent` crate 正式导出，真实 WebSearch preflight 集成测试改为使用请求对象调用；automation runtime turn 与 DevBridge session 创建调用点同步补齐新增缺省参数，恢复 `cargo test -p lime <filter>` 对 Phase 5/6 Rust 集成测试编译面的覆盖。该刀不新增执行器、不改变 `@` 入口、不接 LimeCore 云 run/poll，只清掉阻挡后续 executor/policy preflight 定向验证的旧 API 漂移。
- 2026-05-02：继续第七十一刀 `Phase 5/6 thread read modality runtime summary`：`AgentRuntimeThreadReadModel` 现在会从最近 ToolCall metadata / FileArtifact content 的同一 `runtime_contract` 提取 profile / adapter / binding 摘要，并写入 `runtime_summary.modalityRuntime`；`limecorePolicy` 继续解释 policy decision input，`modalityRuntime` 解释 profile / adapter / executor binding。该刀不新增 Tauri command、不接 LimeCore 云 run/poll，也不把上层 `@` 命令升级成底层合同事实源。
- 2026-05-02：继续第七十二刀 `Phase 5/6 TaskProfile execution profile merge`：`SessionExecutionRuntimeTaskProfile` 新增 `modalityContractKey`、`routingSlot`、`executionProfileKey`、`executorAdapterKey`、`executorKind`、`executorBindingKey`、`permissionProfileKeys` 与 `userLockPolicy`；Rust request model resolution 会从 request metadata 已有 runtime contract 合并这些字段，并按 `modalityExecutionProfiles.json` 补齐 profile 权限与用户锁定策略，`task_profile_resolved` 前端协议测试也覆盖透传。该刀只推进 current runtime task profile 事实源，不新增命令、不接云 run/poll，也不让 `@` 命令成为底层执行合同事实源。
- 2026-05-02：继续第七十三刀 `Phase 5/6 routingSlot capability enforcement`：`request_model_resolution` 现在从 `SessionExecutionRuntimeTaskProfile.routingSlot` 派生 runtime model capability requirements，并把它用于候选模型计数、catalog fallback 与多候选自动重选；非显式用户锁定路径会优先选择满足 runtime slot 的模型，显式用户锁定路径继续 honored，但会通过 `capability_gap` 输出 `browser_reasoning_candidate_missing` / `image_generation_candidate_missing` 等 gap。该刀不新增 Tauri command、不接 LimeCore 云 run/poll、不把上层 `@` 命令当底层事实源；完整权限判定、用户确认/阻断执行与真实 `gateway:*` adapter preflight 继续后置。
