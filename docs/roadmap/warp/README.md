# Warp 对照下的 Lime 多模态管理路线图

> 状态：current planning source
> 更新时间：2026-05-01
> 目标：吸收 Warp 开源客户端在 Agent Harness、Execution Profile、Artifact、Attachment、Task Index 与 Cloud/Local 分层上的可借鉴原则，把 Lime 的多模态能力收敛成统一运行合同，而不是继续按 `@` 命令和单点 viewer 分散扩张。

## 1. 本路线图回答什么

本目录统一回答下面几类问题：

1. Lime 如何先建立底层多模态运行合同，再把 `@配图`、`@配音`、`@浏览器`、`@读PDF`、`@搜索` 等上层入口绑定上来。
2. Lime 如何把模型路由升级为多模态 capability matrix，而不是只看 provider/model id。
3. Lime 如何建立 `ModalityExecutionProfile`，把模型角色、权限、执行器策略、LimeCore 租户策略合并解释。
4. Lime 如何把图片、音频、PDF、浏览器、网页、PPT、报告等结果纳入领域化 artifact graph。
5. LimeCore 云服务应该补什么：目录、模型 offer、Gateway policy、Scene policy、audit；不应该抢什么：本地 ServiceSkill 与桌面执行主链。

## 2. 参考事实源

外部研究：

1. [../../research/warp/README.md](../../research/warp/README.md)
2. [../../research/warp/architecture-breakdown.md](../../research/warp/architecture-breakdown.md)
3. [../../research/warp/architecture-diagrams.md](../../research/warp/architecture-diagrams.md)
4. [../../research/warp/sequences.md](../../research/warp/sequences.md)
5. [../../research/warp/flowcharts.md](../../research/warp/flowcharts.md)
6. [../../research/warp/agent-harness-and-multimodal-management.md](../../research/warp/agent-harness-and-multimodal-management.md)
7. [../../research/warp/borrowable-patterns.md](../../research/warp/borrowable-patterns.md)
8. [../../research/warp/lime-gap-analysis.md](../../research/warp/lime-gap-analysis.md)
9. [../../research/warp/claudecode-compatibility.md](../../research/warp/claudecode-compatibility.md)

Lime 现有事实源：

1. [../../aiprompts/command-runtime.md](../../aiprompts/command-runtime.md)
2. [../task/README.md](../task/README.md)
3. [../../aiprompts/harness-engine-governance.md](../../aiprompts/harness-engine-governance.md)
4. [../../aiprompts/limecore-collaboration-entry.md](../../aiprompts/limecore-collaboration-entry.md)
5. [../limenextv2/README.md](../limenextv2/README.md)

## 3. 固定结论

### 3.0 ClaudeCode 是主参考，Warp 是补充参考

本路线图不改变 Lime 的主参考顺序：

1. Agent loop、tool protocol、permission、slash command、SkillTool、AgentTool、subagent task 优先参考 `/Users/coso/Documents/dev/js/claudecode`。
2. Execution profile、harness adapter、artifact/attachment 分离、computer use、task index、cloud/local 分层参考 Warp。
3. GUI、viewer、LimeCore 边界、本地优先执行以 Lime current 规划为准。

固定裁决：

**如果 ClaudeCode 与 Warp 在同一问题上表面冲突，Agent 内循环按 ClaudeCode，多模态运行治理按 Warp，产品形态按 Lime。**

### 3.1 多模态管理首先是底层合同管理

`@` 命令、按钮、Scene 都是上层入口，不是底层事实源。

底层必须先声明：

```text
runtime identity
  -> input context
  -> required capabilities
  -> execution profile
  -> model routing
  -> binding / executor
  -> truth source
  -> artifact graph
  -> evidence events
  -> viewer
```

然后上层入口只做绑定：

```text
@command / button / scene
  -> launch metadata
  -> ModalityRuntimeContract
```

如果某个入口需要绕过底层合同才能工作，它就不能算 current。

### 3.2 模型层必须服从任务层和权限层

模型选择顺序固定为：

```text
TaskProfile
  -> Modality capability requirements
  -> CandidateModelSet
  -> User / tenant / profile constraints
  -> RoutingDecision
  -> limit_state / cost / fallback reason
```

不能只因为某模型“更强”就绕过权限、预算、OEM 策略和用户显式锁定。

### 3.3 LimeCore 是云事实源，不是默认执行器

LimeCore 负责：

1. `client/skills`
2. `client/scenes`
3. `bootstrap.skillCatalog`
4. `bootstrap.sceneCatalog`
5. Provider offer
6. model catalog
7. Gateway runtime policy
8. Scene run policy / audit
9. 租户级 feature / permission / branding

Lime 负责：

1. 本地工作区
2. Agent turn
3. 本地 ServiceSkill
4. Browser Assist
5. 文件与媒体处理
6. viewer
7. 本地 artifact 与 evidence 主链

固定约束：

**云端优先配置，本地优先执行；只有显式云 run / Gateway call / 托管连接器才进入 LimeCore 执行面。**

### 3.4 Artifact 必须领域化

Lime 的 artifact graph 不应只有 `document` / `file`。

首批 current domain kind：

1. `image_task`
2. `image_output`
3. `audio_task`
4. `audio_output`
5. `transcript`
6. `browser_session`
7. `browser_snapshot`
8. `pdf_extract`
9. `report_document`
10. `presentation_document`
11. `webpage_artifact`
12. `generic_file`

通用文件只作为兜底，不作为多模态默认主结果。

当前 `browser_session` / `browser_snapshot` 不新建平行 task 协议；Browser Assist tool timeline 先通过 evidence `snapshotIndex.browserActionIndex` 进入动作索引层，并通过 `snapshotIndex.taskIndex` 进入与媒体任务一致的 `thread_id / turn_id / content_id / entry_key / modality / skill_id / model_id / executor / cost / limit` 查询口径；Replay / grader 也已把该索引写入 `runtimeFacts.modalityTaskIndex`、suite tags 与合同检查，前端已把同一索引转成任务中心可复用的 facets / rows / filters，`HarnessTaskIndexSection` 已消费该查询模型展示“多模态任务索引”，内嵌“任务中心过滤列表”按 entry / content / executor / cost / limit 过滤同一 rows，`HarnessStatusPanel` 只保留挂载面，并可通过最小 `browser_replay_viewer` 打开复盘。后续完整交互回放、独立主任务中心入口、权限 profile 与截图/DOM/network 深层展开继续消费同一事实源。

当前 `transcript` 已绑定到底层 `audio_transcription` contract；`@转写 / @transcribe / @Audio Extractor` 只是上层入口，前端、Rust metadata、`transcription_generate` task file、CLI 回退入口与 `lime-transcription-worker` 会保留同一份 `audio_transcription` runtime contract snapshot。当前闭环已经能写入 `.lime/tasks/transcription_generate/*.json`，在 payload 下生成 `transcript.pending`，通过 OpenAI-compatible transcription provider seam 回写 `transcript.completed/failed`，并把 transcript 状态/路径/来源/语言/格式/Provider 错误纳入 `list_media_task_artifacts`、聊天任务卡、`.lime/runtime/transcription-generate/*.md` 运行时文档、Evidence Pack `snapshotIndex.transcriptIndex` 与 Replay / grader。第四十三刀已让运行时文档读取 `.lime/runtime/transcripts/*` 文本内容，打开任务卡即可看到可复制校对的转写文本；第四十四刀继续解析 JSON / SRT / VTT transcript 的时间轴与说话人，并在聊天轻卡和运行时文档中展示可逐段编辑校对的段落表；第四十五刀复用 ArtifactDocument 保存链路，保存校对稿时写入 `transcriptCorrection*` / `transcriptSegmentsCorrected` metadata，并明确不改写原始 ASR 输出文件；第四十六刀补上 viewer 内“校对稿已保存”状态卡与 `transcriptCorrectionDiffSummary`，让原文/校对稿的文本长度、段落、说话人数差异可见。后续仍需要更专用的逐段 transcript viewer 交互、更多 ASR adapter 与本地离线 ASR 执行器。

当前 `execution_profile` / `executor_adapter` 已从治理 registry 进入前端 launch metadata、Rust runtime contract snapshot、Evidence Pack、Replay 与 `list_media_task_artifacts` 统一媒体任务索引。任务列表可以直接查询 `entry_key`、`thread_id`、`turn_id`、`content_id`、`modality`、`skill_id`、`model_id`、`cost_state`、`limit_state`、`estimated_cost_class`、`limit_event_kind`、`quota_low`、`profile_key`、`adapter_key`、`executor_kind`、`executor_binding_key`、`limecore_policy_refs` 与最小 `limecore_policy_snapshot(status=local_defaults_evaluated, decision=allow, decision_scope=local_defaults_only, policy_inputs, missing_inputs, pending_hit_refs, policy_value_hits, policy_value_hit_count, policy_evaluation)`；其中 `entry_key / thread_id / turn_id / content_id / modality / skill_id / model_id / cost_state / limit_state` 先由媒体任务 payload、runtime contract、runtime summary 与 task profile 归一投影而来，不改变上层 `@` 命令触发语义；Evidence Pack 的 `snapshotIndex.taskIndex` 已把非媒体 runtime contract snapshot 的同组身份、executor、成本/限额字段也归一到同一查询口径，Replay / grader、前端任务中心查询模型、`HarnessTaskIndexSection` 与内嵌任务中心过滤列表已消费该索引作为复盘、过滤和客服诊断验收项；`task index presentation guard` 会阻止该过滤面回流成面板内联平行实现。Harness evidence 面板已展示 `LimeCore 策略缺口`，Replay / grader 也会把 `limecorePolicyIndex` 转成 suite tags、failure modes、success criteria 与 blocking checks，直接暴露 refs、missing inputs、pending hit refs、local default decision、profile / adapter 与 `declared_only / limecore_pending` 输入状态；图片、配音、转写媒体 worker 已在进入真实执行器前做最小 adapter preflight。当前默认 `policy_value_hits=[]`、`policy_value_hit_count=0` 只表示真实 LimeCore 控制面命中值尚未接入；如果已有 `status=resolved` 的命中值，resolver seam 会把该 ref 转入 `evaluated_refs` 并从 `missing_inputs / pending_hit_refs` 移除。图片任务执行前的本地 model registry assessment 已成为最小 `model_catalog` hit producer，会写入 `policy_value_hits(status=resolved, value_source=local_model_catalog)`；图片任务进入真实执行器前也会从已解析的 runner config/API key 与 task payload provider/model 生成最小 `provider_offer` hit，写入 `value_source=local_provider_offer`，且不序列化 API key；Browser Assist 与 Web Research 类 launch 现在也会从请求侧 `harness.oem_routing` 生成最小 `gateway_policy` hit，写入 `value_source=request_oem_routing`，只解释 tenant/provider/quota/can*invoke/fallback 等路由输入已命中；Workspace send metadata 还会从 OEM Cloud bootstrap snapshot 的 `features` 生成 `tenant_feature_flags` hit，写入 `value_source=oem_cloud_bootstrap_features`，只解释租户功能开关输入已命中且不包含 session token。当前 snapshot 还会携带 `policy_evaluation`：所有 refs resolved 时，最小 `policy_input_evaluator` 才会把已命中的 policy inputs 折叠为 `allow / ask / deny`；仍有 missing inputs 时，顶层 `decision` 继续保持 `local_default_policy / local_defaults_only`，不能解释为真实 tenant / provider / gateway 放行。`thread_read.runtime_summary.limecorePolicy` 已能投影最近一次 runtime contract 的 policy decision explanation，包含顶层 decision、missing/pending refs、hit count 与 evaluator blocking/ask/pending refs；统一媒体任务索引也已汇总 `limecore_policy_evaluation_statuses / decisions / decision_sources / blocking_refs / ask_refs / pending_refs`，每条 snapshot 同步输出 `limecore_policy_evaluation*\*`字段，让任务列表和恢复层无需打开隐藏 task JSON 就能区分 input gap、ask 与 deny；配音与转写任务卡恢复层已消费这些字段并展示`LimeCore 策略输入待命中 / 阻断 / 需确认`meta，图片任务 viewer 与图片消息轻卡也会从 task artifact runtime contract 的`policy_evaluation`展示同一类标签。后续云端 LimeCore policy decision、Browser / 通用 Skill preflight、独立主任务中心入口与更多任务卡可视化继续消费同一事实源，不另开上层`@` 命令事实源。权限确认方面，Evidence Pack / Replay 已把 `not_requested / requested` 未解决确认作为交付阻断事实；未解决确认现在也会在 prelude 后、模型执行前阻断 turn；`runtime_permission_confirmation:<turn_id>` 会作为真实 `RequestUserInput/elicitation` 写入 timeline 并通过既有 `agent_runtime_respond_action` 完成/拒绝写回，下一轮恢复请求会把 completed response 合并为 `confirmationStatus=resolved/denied` 后再由同一 turn gating 判定。这个闭环仍是本地最小确认/恢复入口，不等于完整权限系统、自动恢复 GUI 或 LimeCore 云授权。显式用户模型锁定方面，`request_model_resolution` 会继续 honored 用户指定模型，但当该模型缺少当前 `routingSlot` 要求能力时会输出 `user_locked_capability_gap`，runtime turn 会在模型执行前阻断并提示切换模型或取消本轮显式锁定，避免把已知不满足 execution profile 的模型继续执行。

## 4. 目录文档分工

1. [runtime-fact-map.md](./runtime-fact-map.md)
   - Phase 0 底层运行事实源地图，明确 current / compat / deprecated / dead 分类。
2. [contract-schema.md](./contract-schema.md)
   - Phase 1 `ModalityRuntimeContract` 字段语义与机器校验入口。
3. [capability-matrix.md](./capability-matrix.md)
   - Phase 2 多模态能力矩阵、模型角色槽位与 capability gap 口径。
4. [execution-profile.md](./execution-profile.md)
   - Phase 3 / Phase 5 `ModalityExecutionProfile`、executor adapter registry 与治理守卫。
5. [artifact-graph.md](./artifact-graph.md)
   - Phase 4 领域化产物图，明确 artifact kind、truth source、viewer、evidence 与 task index 映射。
6. [implementation-plan.md](./implementation-plan.md)
   - 分阶段开发计划、改动面、验收输出和验证入口。
7. [evolution-guide.md](./evolution-guide.md)
   - Lime 自下而上的演进总图、泳道图、阶段门禁和每轮收口模板。
8. [acceptance.md](./acceptance.md)
   - 关键场景验收标准，防止路线图停留在抽象层。

当前机器可检查事实源：

1. `src/lib/governance/modalityRuntimeContracts.json`
2. `src/lib/governance/modalityCapabilityMatrix.json`
3. `src/lib/governance/modalityArtifactGraph.json`
4. `src/lib/governance/modalityExecutionProfiles.json`
5. `docs/roadmap/warp/entry-binding-inventory.md`
6. `docs/roadmap/warp/task-index-inventory.md`
7. `src/lib/governance/modalityExecutionProfiles.ts`
8. `scripts/check-modality-runtime-contracts.mjs`
9. `npm run governance:modality-contracts`

后续如果继续推进，再按需新增：

1. `limecore-integration.md`
2. `browser-computer-use.md`
3. `migration-map.md`

## 5. 分阶段总览

| 阶段    | 目标                                    | 主产物                                                       |
| ------- | --------------------------------------- | ------------------------------------------------------------ |
| Phase 0 | 盘点底层运行事实源                      | runtime fact map                                             |
| Phase 1 | 建底层运行合同 schema                   | `ModalityRuntimeContract` + governance check                 |
| Phase 2 | 扩展模型能力矩阵                        | modality capability matrix + routing evidence                |
| Phase 3 | 建统一 execution profile                | `modalityExecutionProfiles.json` + profile / policy guard    |
| Phase 4 | 领域化 artifact graph                   | domain artifact kinds + viewer mapping                       |
| Phase 5 | 建 executor / Browser typed action 边界 | executor adapter registry + browser evidence                 |
| Phase 6 | LimeCore 目录与策略接线                 | policy refs/snapshot + hit producers + evaluator explanation |
| Phase 7 | 绑定上层入口                            | `@` / button / scene launch mapping                          |
| Phase 8 | 任务索引与复盘                          | modality task index + audit + replay hooks                   |

## 6. 当前必须避免的误区

1. 把 Warp 参考理解成“把 Lime 改成终端产品”。
2. 把多模态管理理解成“加更多模型/provider”。
3. 把 LimeCore 理解成“所有 `@` 命令的云执行器”。
4. 把 CLI harness 当作 current 首发捷径。
5. 把 artifact graph 降级成更多文件卡。
6. 把 `@` 命令盘点误当成底层建设起点。
7. 在没有底层运行合同前继续新增 `@` 命令。
8. 让 viewer 自己猜 truth source。

## 7. 这一步如何服务主线

本路线图的直接主线收益只有一句话：

**它把 Lime 当前已经存在但分散在 runtime identity、skill、task、viewer、模型设置、LimeCore bootstrap 和 evidence 里的多模态能力，先收敛成底层运行合同，再让 `@` 命令等入口复用这条 current 主线。**
