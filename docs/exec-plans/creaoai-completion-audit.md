# CREAO Roadmap Completion Audit

> 状态：P0-P4 最小闭环完成审计通过  
> 日期：2026-05-06  
> 审计目标：确认 `docs/roadmap/creaoai/README.md` 与 `docs/roadmap/creaoai/implementation-plan.md` 中 CREAO-inspired 开发计划，已经收敛到 Lime current 主链，并具备完整、可验证、不过度扩展的 P0-P4 最小实现。

## 0. 审计结论

P0-P4 当前可以判定为 **最小可交付闭环完成**：

```text
Capability Draft
  -> verification gate
  -> workspace-local registration
  -> registered discovery
  -> runtime binding readiness
  -> Query Loop metadata
  -> session-scoped tool_runtime authorization
  -> ToolResult source metadata
  -> Managed Job 草案
  -> automation owner evidence
  -> completion audit input / summary
  -> Harness UI / Workspace UI
  -> evidence-gated Agent envelope / derived Agent card
  -> workspace/team registered discovery sharing
```

关键判定：

1. 没有新增平行 runtime、scheduler、queue、evidence、Marketplace 或 Agent card 存储表。
2. 未验证 draft 不会进入默认 tool surface，也不会注册、运行或自动化。
3. registered / discovered / readiness 只表示可审计存在和候选资格，不等于可调用。
4. 真正调用必须经 `agent_runtime_submit_turn` + `workspace_skill_runtime_enable` + `SkillTool` session allowlist。
5. `success` automation run 只能进入 completion audit input；`completed` 只能由 automation owner、Workspace Skill ToolCall 和 artifact / timeline evidence 共同判定。
6. Agent envelope 是 Workspace 产品组合面，执行 owner 仍是 automation job / Managed Objective / runtime evidence 主链。
7. 本轮额外修正了一个审计缺口：`evidencePackId` 单独存在不再让 Agent envelope 进入 `evidence_ready`，必须有 completed completion audit 且三项 evidence 齐全。

## 1. P0 文档与边界

| 要求 | 证据 | 状态 | 备注 |
| --- | --- | --- | --- |
| 研究和路线图落盘 | `docs/research/creaoai/README.md`、`docs/roadmap/creaoai/README.md`、`docs/roadmap/creaoai/implementation-plan.md` | 完成 | 已固定 CREAO pivot、组织 harness、Agent 产品模型和 Lime 差距。 |
| Skill Forge 不是 runtime | `docs/roadmap/creaoai/README.md`、`docs/roadmap/creaoai/coding-agent-layer.md`、`docs/roadmap/creaoai/architecture-review.md` | 完成 | 文档明确 build-time capability author 与 runtime owner 分离。 |
| generated capability 不能长期执行 | `docs/roadmap/creaoai/README.md`、`docs/exec-plans/creaoai-capability-authoring-p1a-plan.md` | 完成 | Draft 只能进入 verification / registration gate。 |
| 禁止 generated tools 平行 runtime | `docs/roadmap/creaoai/implementation-plan.md`、`docs/exec-plans/creaoai-managed-agent-envelope-p4-plan.md` | 完成 | P3E / P4 都回到 `agent_runtime_submit_turn`、automation、evidence 主链。 |

## 2. P1 workspace-local skill scaffold

| 要求 | 证据 | 状态 | 备注 |
| --- | --- | --- | --- |
| 创建 workspace-local Capability Draft | `src-tauri/src/services/capability_draft_service.rs:create_capability_draft`、`src-tauri/src/commands/capability_draft_cmd.rs`、`src/lib/api/capabilityDrafts.ts` | 完成 | 文件事实源为 `.lime/capability-drafts/<draft_id>/manifest.json`。 |
| Draft 包含 `SKILL.md`、manifest、文件清单和权限摘要 | `CapabilityDraftManifest` / `CapabilityDraftRecord`、`create_capability_draft` 单测 | 完成 | P1A 创建时写入 draft root，路径 guard 拒绝逃逸。 |
| Workspace 可展示 draft 状态 | `src/features/capability-drafts/components/CapabilityDraftPanel.tsx`、`src/components/skills/SkillsWorkspacePage.tsx` | 完成 | UI 明确“未验证前不会注册，也不会自动运行”。 |
| 未验证 draft 不进默认 tool surface | `CapabilityDraftPanel` domain helper、P1A / P1B / P3A 执行计划验证记录 | 完成 | UI 无运行 / 自动化入口；后端注册也拒绝未验证状态。 |
| 从对话请求创建的边界 | `capability_draft_create` 已进入 command catalog / DevBridge / mock；当前产品入口仍是受控 draft store | 完成（最小闭环） | 未实现无限制 autonomous authoring agent；符合 P1A “不做完整 Coding Agent、先证明安全产生能力”的约束。 |

## 3. P2 verification gate

| 要求 | 证据 | 状态 | 备注 |
| --- | --- | --- | --- |
| 结构、contract、权限、风险、fixture 检查 | `src-tauri/src/services/capability_draft_service.rs:verify_capability_draft` | 完成 | 检查矩阵落为静态 gate，不执行用户脚本。 |
| 缺 contract 不能注册 | `verify_capability_draft_fails_without_contracts`、`register_capability_draft_rejects_verification_failed_draft` | 完成 | 状态进入 `verification_failed`。 |
| 危险 token / 权限不一致失败 | `verify_capability_draft_rejects_dangerous_tokens` | 完成 | 高风险外部写通过静态风险扫描阻断；后续放权必须走授权策略。 |
| 通过后进入 pending registration | `CapabilityDraftStatus::VerifiedPendingRegistration`、`verify_capability_draft_marks_complete_draft_pending_registration` | 完成 | 仍不代表可运行。 |
| verification 结果可消费 | `verification/latest.json`、manifest `lastVerification`、注册 provenance | 完成 | P3A 注册写入 verification report id。 |

## 4. P3 registration / runtime binding

| 阶段 | 要求 | 证据 | 状态 |
| --- | --- | --- | --- |
| P3A | 只注册 `verified_pending_registration` 到当前 workspace `.agents/skills` | `register_capability_draft`、`registration/latest.json`、`.lime/registration.json` | 完成 |
| P3A | 不覆盖已有目录、不修改全局 seeded skill、不运行 | `register_capability_draft_rejects_existing_skill_directory`、P3A plan 验证记录 | 完成 |
| P3B | 显式 `workspaceRoot` discovery，只读返回 provenance / 标准 / 权限 | `list_workspace_registered_skills`、`WorkspaceRegisteredSkillsPanel` | 完成 |
| P3B | `launchEnabled=false`，无运行 / 自动化入口 | `WorkspaceRegisteredSkillRecord.launchEnabled`、P3B tests / GUI smoke | 完成 |
| P3C | readiness projection 在 `agent_runtime_* / inventory` 主链下 | `agent_runtime_list_workspace_skill_bindings`、`runtime_skill_binding_service.rs:list_workspace_skill_bindings` | 完成 |
| P3C | `queryLoopVisible=false`、`toolRuntimeVisible=false`、`launchEnabled=false` | `runtime_skill_binding_service` DTO / tests | 完成 |
| P3D | `workspace_skill_bindings` 只进 Query Loop 只读 prompt | `workspace_skill_binding_prompt.rs`、`workspaceSkillBindingsMetadata.ts` | 完成 |
| P3D | 不打开 `allow_model_skills`，不注入 `SkillTool` registry | `harnessRequestMetadata.ts`、`runtime_turn.rs` tests | 完成 |
| P3E | `workspace_skill_runtime_enable` 显式启用当前 session | `runtime_skill_binding_service.rs:resolve_workspace_skill_runtime_enable`、`runtime_turn.rs` | 完成 |
| P3E | `SkillTool` 被裁剪到 `project:<directory>` / `<directory>` allowlist | `src-tauri/crates/agent/src/tools/skill_tool_gate.rs` | 完成 |
| P3E | ToolResult metadata 写回来源和授权 | `workspace_skill_source` / `workspace_skill_runtime_enable` metadata、SkillTool gate tests | 完成 |

## 5. P4 managed execution / Agent envelope

| 要求 | 证据 | 状态 | 备注 |
| --- | --- | --- | --- |
| 绑定 automation job，不新增 scheduler | `workspaceSkillAgentAutomationDraft.ts`、`SkillsWorkspacePage.tsx` | 完成 | 创建入口复用 `AutomationJobDialog` + `createAutomationJob`，默认暂停。 |
| payload 仍为 `agent_turn` | `buildWorkspaceSkillAgentAutomationInitialValues` | 完成 | `request_metadata.harness` 写入 `agent_envelope`、`managed_objective`、`workspace_skill_runtime_enable`。 |
| 支持暂停 / 恢复 | `WorkspaceRegisteredSkillsPanel.tsx` 调用 `updateAutomationJob(job.id, { enabled })` | 完成 | 不新增平行 pause state。 |
| app 重启后状态恢复或阻塞 | `WorkspaceRegisteredSkillsPanel` 每次加载复用 `getAutomationJobs()` 读取持久 job 事实 | 完成 | 恢复以 automation job storage 为事实源；失败显示 last_status / last_error。 |
| 失败可见步骤 / 原因 / 下一步 | `buildWorkspaceSkillManagedAutomationPresentation`、completion audit label | 完成 | Workspace 显示 blocked / paused / planned / verifying 文案；Harness 显示 audit blocking reasons。 |
| 产物 / timeline / evidence 可审计 | `runtime_evidence_pack_service.rs` | 完成 | `timeline.json` 保留 Workspace Skill ToolCall source metadata。 |
| automation owner evidence | `export_runtime_evidence_pack_with_owner_runs`、`runtime.json` / `artifacts.json` 的 `automationOwners` | 完成 | owner run、Agent envelope、Managed Objective、runtime enable 关系进入 evidence。 |
| completion audit input | `automationOwners.runs[].completionAudit` | 完成 | `success` run 仍为 `not_completed` 输入。 |
| completion audit summary | `build_completion_audit_summary_json`、`completionAuditSummary` normalizer / Harness UI | 完成 | `completed / blocked / needs_input / verifying` 由 evidence 判定。 |
| Agent envelope evidence gate | `agentEnvelopeDraftPresentation.ts` | 完成 | 只有 `completionAuditSummary.decision=completed` 且三项 evidence 齐全才 actionEnabled。 |
| 最近运行审计 | `WorkspaceRegisteredSkillsPanel.tsx` 调用 `getAutomationRunHistory` + `exportAgentRuntimeEvidencePack` | 完成 | 不新增 evidence 查询命令。 |
| Agent card / sharing | `agentEnvelopeDraftPresentation.ts`、Workspace panel tests | 完成 | `workspace-local/<skill-directory>` 派生展示；共享限定 workspace / team。 |

## 6. 验证证据

已记录通过的关键验证：

1. P1A：`capability_draft_create/list/get` Rust / frontend / DevBridge / `npm run verify:gui-smoke`。
2. P1B：`capability_draft_verify` Rust / frontend / DevBridge / `npm run test:contracts` / `npm run verify:gui-smoke`。
3. P3A：`capability_draft_register` Rust / frontend / DevBridge / `npm run test:contracts` / `npm run verify:gui-smoke`。
4. P3B：registered discovery Rust / frontend / DevBridge / `npm run test:contracts` / `npm run verify:gui-smoke`。
5. P3C：runtime binding readiness Rust / frontend / `npm run typecheck` / `npm run test:contracts` / GUI smoke。
6. P3D：workspace skill metadata prompt projection Rust / TS 定向测试，且文档边界已同步。
7. P3E：workspace skill runtime enable metadata、SkillTool allowlist/source metadata、runtime turn 定向测试、`npm run test:contracts`。
8. P4：Agent envelope presentation / Workspace panel / Skills workspace / Harness panel / Rust evidence pack 定向测试、`npm run typecheck`、`npm run test:contracts`、GUI smoke。
9. 本审计轮复跑：`npx vitest run src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx`，12 passed。

## 7. 非目标确认

以下仍保持未做，且是正确边界：

1. 未新增 public Marketplace / Skill Store。
2. 未新增 `agent_envelope_*` command 或 Agent card 存储表。
3. 未新增独立 scheduler / queue / generated tool runtime / evidence 系统。
4. 未允许未验证 draft 进入默认 tool surface。
5. 未允许外部写操作在无人工确认时自动执行。
6. 未把 `workspace_skill_bindings` readiness metadata 自动升级为可调用工具。
7. 未把 automation `success` 直接判定为 Managed Objective `completed`。

## 8. 收口判定

P0-P4 的 CREAO-inspired 最小开发计划已经完成；后续如果继续推进，应作为新阶段处理：

1. P5：真实 prompt-to-artifact 产品 E2E 场景，把“只读 CLI 每日报告”跑成完整演示数据集。
2. P5：外部写操作的人类确认策略和 policy-approved scheduled write。
3. P5：多 skill managed workflow 与 team-scoped sharing 的权限模型。
4. P5：proactive agentization 信号，基于 rerun 频率、阻塞原因和修复次数建议固化 Agent。

当前 P0-P4 不需要继续补平行实现；下一步应只做验证样例或 P5 扩展，而不是扩大 P4 的 runtime 面。
