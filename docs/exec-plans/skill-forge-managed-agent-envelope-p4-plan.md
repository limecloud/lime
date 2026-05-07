# Skill Forge Managed Execution / Agent Envelope P4 执行计划

> 状态：P4 完成；P0-P4 完成审计通过
> 创建时间：2026-05-06
> 前置计划：`docs/exec-plans/skill-forge-tool-runtime-authorization-p3e-plan.md`
> 路线图来源：`docs/roadmap/skill-forge/README.md`、`docs/roadmap/skill-forge/implementation-plan.md`、`docs/roadmap/managed-objective/README.md`、`docs/aiprompts/quality-workflow.md`
> 当前目标：把 P3E 已可显式启用并可审计调用的 workspace-local skill，推进到“成功运行后可固化为 Workspace 产品面的 Agent envelope 草案”，但不新增 runtime、scheduler 或 marketplace。

## 主目标

P4 第一刀只回答：

```text
一个 P3E 显式启用并成功运行过的 workspace-local skill
  -> 如何被展示成可 rerun 的 Agent envelope 草案
  -> 如何引用来源 draft、verification report、registered directory、session 授权和 evidence
  -> 如何为后续 managed execution / schedule 预留明确边界
```

固定边界：

**Agent envelope 是 Workspace 产品组合面，不是新 runtime；执行仍然回到 `agent_runtime_submit_turn`、automation job、Managed Objective、artifact 和 evidence 主链。**

## 本轮最小切口

第一刀不直接做完整定时任务。先做可验证的 envelope 草案展示与证据消费边界：

1. 定义前端 `AgentEnvelopeDraft` presentation contract，来源必须是 P3A/P3B registered skill、P3C binding、P3E runtime source metadata 或已导出的 evidence pack。
2. 在 Workspace 已注册能力面板中展示 “Agent envelope 草案 / 可固化条件” 区域，只对 ready binding 说明下一步，不创建自动化。
3. 已有 P3E source metadata 时，草案摘要必须能显示 source draft、verification report、registered directory、permission summary 和 session authorization scope。
4. “转成 Agent” 第一刀只做草案入口或 disabled-ready state，不创建 scheduler、不写长期 job、不绕过 `agent_runtime_submit_turn`。
5. 补组件 / presentation 单测，证明 P4 入口不会在未 ready、未 evidence 或 blocked 状态下声称已可自动化。

## 本轮明确不做

1. 不新增 `agent_envelope_*` Tauri 命令。
2. 不新增 scheduler、queue、automation job 存储或后台 runner。
3. 不新增 Agent Marketplace / Skill Store。
4. 不把 P3B / P3C readiness 当成已成功运行。
5. 不把 `workspace_skill_runtime_enable` 升级成长期授权。
6. 不允许模型自报完成后直接创建 Agent；必须引用 artifact / timeline / evidence 或后续 completion audit。

## 最小 Agent envelope 字段

```ts
interface AgentEnvelopeDraft {
  id: string;
  name: string;
  sourceSkill: {
    directory: string;
    registeredSkillDirectory: string;
    sourceDraftId: string;
    sourceVerificationReportId?: string | null;
  };
  runbook: {
    skillName: string;
    permissionSummary: string[];
  };
  permission: {
    authorizationScope: "session" | "manual" | "scheduled";
    externalWriteRequiresConfirmation: boolean;
  };
  evidence: {
    status: "missing" | "source_metadata_only" | "evidence_pack_ready";
    sourceMetadata?: unknown;
    evidencePackId?: string;
  };
  schedule: {
    status: "manual_only" | "draft" | "scheduled";
  };
}
```

第一刀可以只落 presentation 层；后续若需要持久化，必须先回到 Managed Objective / automation job 主链设计，不新增平行实体。

## 第二刀最小切口

第二刀开始接入 managed execution，但只复用现有 automation job，不新增 scheduler / runtime：

1. 对 `ready_for_manual_enable` 的 workspace skill，允许从 Workspace 已注册能力面板打开 “Managed Job 草案”。
2. 草案默认 `enabled=false`，用户需要在现有持续流程弹窗里确认调度、权限和输出后再启用。
3. automation payload 仍是 `agent_turn`，执行时继续走 `agent_runtime_submit_turn` / runtime queue。
4. `request_metadata.harness` 必须携带：
   - `agent_envelope`：source draft、verification report、registered skill directory、skill name 与 scheduled session authorization scope。
   - `managed_objective`：owner type 为 `automation_job`，completion audit 要求 artifact / timeline / evidence。
   - `workspace_skill_runtime_enable`：source 为 `agent_envelope_scheduled_run`，每次 automation run 仍在当前 session 内显式打开 allowlist。
5. blocked / 缺少 verification provenance / 缺少 workspace root 的 skill 不能生成 Managed Job 草案。

## 实施步骤

### P4-0：计划与边界

- [x] 新增本执行计划。
- [x] 明确 P4 第一刀是 Agent envelope 草案展示和 evidence 消费边界，不做 scheduler / marketplace / 新 runtime。

### P4-1：Presentation contract

- [x] 新增最小 `AgentEnvelopeDraft` presentation builder。
- [x] 输入优先级固定为：P3E ToolResult source metadata / evidence pack > P3C ready binding > P3B registered skill。
- [x] 缺少 P3E source metadata 或 evidence 时，状态只能是 `source_metadata_only` 或 `missing`，不能显示为可自动化。
- [x] 补单测覆盖 ready、blocked、missing evidence、source metadata 四类状态。

### P4-2：Workspace UI 第一刀

- [x] 在 `WorkspaceRegisteredSkillsPanel` 中展示 Agent envelope 草案摘要。
- [x] ready binding 只显示“可在成功运行后固化为 Agent”，blocked binding 显示阻塞原因。
- [x] “转成 Agent” 入口第一刀只允许 disabled / draft explanation，不创建 automation job。
- [x] 保留 P3E “本回合启用”作为唯一真实运行入口。

### P4-3：Evidence 消费边界

- [x] 明确 timeline / evidence pack 读取 `workspace_skill_source` / `workspace_skill_runtime_enable` 的字段映射。
- [x] 先做 presentation 级消费；同时确认 `timeline.json` 原先未保留 ToolCall source metadata，因此补 evidence exporter 最小透传。
- [x] 避免 UI 伪造证据：P4 Agent envelope 草案只读取 P3E source metadata / evidence pack；timeline 不存在字段时仍保持 `missing`。

### P4-4：验证

- [x] 前端 presentation / component 定向测试。
- [x] `npm run test:contracts` 只在触碰命令 / bridge / mock 时补跑；P4 第一刀未新增命令，沿用 P3E 已通过结果。
- [x] Workspace 可见 UI 改动已补 `npm run verify:gui-smoke -- --reuse-running --timeout-ms 300000`。

### P4-5：Managed Job 草案与 owner metadata

- [x] 新增 `workspaceSkillAgentAutomationDraft` helper，生成现有 `AutomationJobDialog` 可消费的 initial values。
- [x] request metadata 固定写入 `harness.agent_envelope`、`harness.managed_objective` 与 `harness.workspace_skill_runtime_enable`，不新增命令或 runtime。
- [x] Skills 工作台的 Workspace 已注册能力面板增加 “创建 Managed Job 草案”入口，只对 ready binding + verification provenance 可用。
- [x] 创建确认继续复用现有 `AutomationJobDialog` + `createAutomationJob`；默认暂停，避免注册后自动长期运行。
- [x] 补 helper / panel / Skills 工作台定向测试。

### P4-6：Automation owner evidence

- [x] `agent_runtime_export_evidence_pack` 导出前会查询当前 session 关联的 `agent_runs`，把 automation owner runs 注入 evidence pack。
- [x] `runtime.json` 与 `artifacts.json` 新增 `automationOwners`，保留 automation job id、状态、`agent_envelope`、`managed_objective` 与 `workspace_skill_runtime_enable`。
- [x] 该证据仍来自 `agent_runs.metadata` 与 runtime evidence pack，不新增 evidence 事实源。
- [x] Rust 定向测试覆盖 automation owner -> Agent envelope -> P3E runtime enable 的导出关系。

### P4-7：Workspace managed job 状态投影

- [x] Workspace 已注册能力面板读取现有 `automation_job` 列表，不新增查询命令。
- [x] 通过 automation payload 的 `request_metadata.harness.agent_envelope` 反查绑定的 workspace skill directory / skill name。
- [x] Agent envelope 草案区域展示 Managed Job 是否已创建、暂停/启用状态、调度摘要、最近运行与错误摘要。
- [x] 状态投影仅显示现有 automation job 事实，不把 registered skill 误报为已运行或已完成。

### P4-8：Pause / resume 最小闭环

- [x] Workspace 已注册能力面板对已匹配的 Managed Job 展示暂停 / 恢复操作。
- [x] 操作复用既有 `updateAutomationJob(job.id, { enabled })`，不新增命令、不新增 scheduler。
- [x] 成功后以返回的 automation job record 更新本地投影，继续以 `enabled` 作为暂停 / 恢复事实源。
- [x] 前端回归覆盖恢复按钮调用 `updateAutomationJob` 并刷新状态摘要。

### P4-9：Managed Objective 状态 / audit 投影

- [x] Workspace managed job 状态区新增 Managed Objective 最小状态投影：`planned` / `paused` / `running` / `blocked` / `verifying`。
- [x] `last_status=success` 只进入 `verifying`，不会直接标为 `completed`。
- [x] Completion Audit 文案明确要求 artifact / timeline / evidence 审计，避免模型自报完成。
- [x] 前端 presentation 单测覆盖 success run 不直接 completed。

### P4-10：Evidence completion audit input

- [x] Evidence pack 的 `automationOwners.runs[]` 新增 `completionAudit` 结构化输入。
- [x] `completionAudit` 会检查 automation run status、`agent_envelope`、`managed_objective`、`workspace_skill_runtime_enable` 与 `managed_objective.completion_audit`。
- [x] 即使 run status 为 `success`，`completionDecision` 仍保持 `not_completed`；真正 completed 必须由后续 artifact / timeline / evidence audit 产生。
- [x] Rust evidence 定向测试覆盖 `audit_input_ready` 与 `not_completed`。

### P4-11：Evidence completion audit summary

- [x] `runtime.json` / `artifacts.json` 新增 `completionAuditSummary`，统一输出 `completed / blocked / needs_input / verifying`。
- [x] `completed` 只允许在 automation owner success、workspace skill ToolCall source metadata、artifact / timeline evidence 同时满足时出现。
- [x] 非 success owner run、缺失 Agent envelope / Managed Objective / runtime enable、缺少 workspace skill ToolCall evidence 时分别落到 `blocked`、`needs_input` 或 `verifying`。
- [x] Rust evidence 定向测试覆盖 evidence 齐全时 summary 才输出 `completed`。
- [x] `summary.md` 新增 Completion Audit 摘要，让人类先读入口也能看到 decision、owner / ToolCall / artifact evidence 和 blocking reasons。

### P4-12：Evidence export UI projection

- [x] `RuntimeEvidencePackExportResult` 新增 `completionAuditSummary`，让导出命令响应也携带 evidence-based completion audit。
- [x] 前端 `AgentRuntimeEvidencePack` 类型和 normalizer 接入 `completion_audit_summary`，兼容 camelCase / snake_case。
- [x] Harness 面板导出问题证据包后展示 Completion Audit 卡片，包含 decision、owner success、Skill ToolCall、artifact evidence 与 blocking reasons。
- [x] 前端 API 与 Harness 面板回归覆盖 completion audit summary 投影。

### P4-13：Agent envelope completion audit gate

- [x] `AgentEnvelopeDraftPresentation` 接入 `completionAuditSummary` 作为 evidence-ready 的结构化输入。
- [x] 只有 `decision=completed` 且 automation owner / workspace skill ToolCall / artifact-or-timeline 三项 evidence 全为 true 时才进入 `evidence_ready`。
- [x] `verifying` 或缺 ToolCall evidence 不会误报为可固化 Agent envelope。
- [x] Presentation 单测覆盖 completed 正向与 verifying 负向 gate。

### P4-14：Workspace Agent envelope evidence-gated action

- [x] `WorkspaceRegisteredSkillsPanel` 新增 `completionAuditSummariesByDirectory` 注入边界，不新增命令、不读取平行 runtime。
- [x] 当指定 skill 的 completion audit 已 `completed` 且证据齐全时，“转成 Agent 草案”入口启用。
- [x] 入口复用既有 `onCreateManagedAutomationDraft(binding)` / Managed Job 草案链，不新增 Agent envelope 存储或 scheduler。
- [x] Workspace 组件回归覆盖 completed audit 打开入口并传回对应 binding。

### P4-15：Workspace recent run audit action

- [x] 匹配到 Managed Job 后，Workspace 已注册能力面板展示“审计最近运行”。
- [x] 点击后复用既有 `get_automation_run_history(job.id, 5)` 查最近 automation run，不新增查询命令。
- [x] 找到 run `session_id` 后复用 `agent_runtime_export_evidence_pack(sessionId)` 获取 `completionAuditSummary`。
- [x] audit summary 回填到当前 skill directory，并驱动 Agent envelope evidence gate / “转成 Agent 草案”入口。

### P4-16：Agent envelope card composition

- [x] Agent envelope presentation 补齐 `Memory` 与 `Widget` 摘要。
- [x] Workspace 已注册能力面板展示 Runbook、Memory、Widget、Permission、Schedule、Evidence 六块组成。
- [x] Memory 只引用 verification report 与后续运行修正，不新增独立 memory runtime。
- [x] Widget 只展示 Managed Job 状态、最近产物、审计结论和下一步动作，不新增执行实体。

### P4-17：Derived Agent card / workspace sharing

- [x] Agent card 采用派生展示：`workspace-local/<skill-directory>` 来自 registered skill + Managed Job + completion audit。
- [x] 未完成 audit 时只显示草案等待态，不创建平行持久化实体。
- [x] sharing 范围先限定当前 workspace / team，不进入 public Marketplace。
- [x] Workspace 回归覆盖 completed audit 后展示 derived Agent card 与 sharing 摘要。

### P4-18：Workspace/team sharing discovery boundary

- [x] Agent envelope presentation 展示 registered skill discovery 路径：`.agents/skills/<skill-directory>`。
- [x] 同 workspace 成员通过既有 registered skill discovery 发现 Agent card 来源，不新增 sharing 命令。
- [x] 共享复用同一 Managed Job / evidence 事实源，不复制 automation job 或 evidence。
- [x] 前端回归覆盖 sharing discovery 文案。

## 验收标准

1. blocked 或未 ready 的 registered skill 不出现可固化为 Agent 的积极入口。
2. ready binding 可以看到 Agent envelope 草案组成：Skill / permission / schedule / evidence。
3. UI 明确说明“成功运行后固化”，不能把注册、发现或 readiness 说成已经运行成功。
4. “转成 Agent” 第一刀不创建 automation job、不新增 scheduler、不写长期授权。
5. source draft、verification report、registered directory 与 session 授权范围能够从 P3E metadata / evidence 进入草案摘要。
6. 组件测试覆盖 P4 入口不会破坏 P3E “本回合启用”的唯一真实运行入口。
7. Managed Job 草案只能复用现有 automation job，payload 必须仍是 `agent_turn`，且每次运行都通过 `workspace_skill_runtime_enable` 做 session-scoped allowlist。
8. Evidence pack 必须能导出 automation owner 与 Agent envelope / Managed Objective / workspace skill runtime enable 的关系，不能只靠前端草案说明。
9. Workspace 面板必须能从已有 automation job 反投影 Managed Job 状态，展示下次运行 / 最近运行，而不是只提供创建入口。
10. 暂停 / 恢复必须只修改 automation job 的 `enabled` 状态，不允许创建平行 pause state。
11. `success` run 只能作为 completion audit 输入，不能直接把 Managed Objective 判为 completed。
12. Evidence pack 必须显式导出 completion audit input，作为后续 completed / blocked / needs_input 判定的唯一输入之一。
13. Evidence pack 必须显式导出 completion audit summary，且 `completed` 只能由 automation owner、workspace skill ToolCall 和 artifact / timeline 证据共同判定。
14. `summary.md` 必须能直接展示 completion audit 结论和阻塞原因，不能要求用户只靠 JSON 手工定位。
15. 导出问题证据包后的 UI 必须展示 completion audit summary，避免用户只能打开落盘文件才能知道 Managed Objective 是否完成。
16. Agent envelope presentation 只能在 completion audit `completed` 且必要 evidence 齐全时进入 evidence-ready，不能把 `verifying` 或缺证据状态当成可固化。
17. Workspace 的“转成 Agent 草案”只能由 completed completion audit 打开，并且必须复用现有 Managed Job 草案创建链。
18. Workspace 的最近运行审计必须复用 `get_automation_run_history` 和 `agent_runtime_export_evidence_pack`，不能新增平行 evidence 查询或 runtime。
19. Agent envelope 草案必须展示 Runbook、Memory、Widget、Permission、Schedule、Evidence 六块组成，且 Memory / Widget 只能是产品组合面摘要。
20. Agent card 首期只能作为 registered skill + Managed Job + completion audit 的派生卡片，不新增存储表；sharing 先限定 workspace / team。
21. Workspace/team sharing 只能复用 registered skill discovery、Managed Job 与 evidence 事实源，不能新增 sharing 命令、Marketplace 或复制执行实体。

## 执行记录

### 2026-05-06

- 已从 P3E 收口进入 P4，确认第一刀应消费 `workspace_skill_source` / `workspace_skill_runtime_enable`，而不是新增平行执行命令。
- 已确认现有 `WorkspaceRegisteredSkillsPanel` 仍保留 P3C / P3E 边界：只对 `ready_for_manual_enable` 展示“本回合启用”，并明确不创建自动化。
- 已新增 `agentEnvelopeDraftPresentation` presentation builder：ready binding 默认是 `manual_enable_required`，blocked binding 是 `blocked`，P3E source metadata 是 `source_metadata_ready`，evidence pack 是 `evidence_ready`；所有状态第一刀都不创建长期任务。
- 已接入 `WorkspaceRegisteredSkillsPanel`：每个 registered skill 展示 Agent envelope 草案的 runbook、permission、manual rerun schedule 与 evidence 状态；P3E “本回合启用”仍是唯一真实运行入口。
- 定向验证已通过：`npx vitest run src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx src/components/skills/SkillsWorkspacePage.test.tsx -t "应在我的方法工作台展示 Workspace 已注册能力|buildAgentEnvelopeDraftPresentation|WorkspaceRegisteredSkillsPanel"`（3 files，9 passed / 29 skipped）。
- TypeScript 校验已通过：`npm run typecheck`。
- 全量 `src/components/skills/SkillsWorkspacePage.test.tsx` 当前仍有既有文案迁移断言失败（例如“我的方法” vs “我的 Skills”、“你来给”前缀等），与本 P4 第一刀无直接关系；本轮只修正了 P4 新增 disabled action 与 P3E enable button 的选择器歧义。
- 已补 evidence pack timeline 最小透传：`timeline.json` 的 ToolCall item 会在存在 P3E metadata 时写出 `workspaceSkillToolCall.workspaceSkillSource` 与 `workspaceSkillToolCall.workspaceSkillRuntimeEnable`，让 Agent envelope 可追踪 source draft、verification report、registered directory 与 session 授权范围。
- Rust evidence 定向验证已通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/tmp/lime-p4-agent-envelope-target cargo test --manifest-path src-tauri/Cargo.toml -p lime --lib timeline_should_preserve_workspace_skill_source_metadata_for_agent_envelope`（1 passed）。
- GUI smoke 已通过：`npm run verify:gui-smoke -- --reuse-running --timeout-ms 300000`。首次 smoke 曾暴露 Skills 页面文案断言与 `react-syntax-highlighter` / `refractor` ESM 测试环境问题；已把断言对齐当前 UI，并在相关测试中 mock Markdown syntax highlighter，复跑通过 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface、runtime tool surface page、Knowledge GUI 与 Design Canvas。
- 已新增 Managed Job 草案入口：`workspaceSkillAgentAutomationDraft` 会为 ready binding 生成 `AutomationJobDialogInitialValues`，并把 `agent_envelope` / `managed_objective` / `workspace_skill_runtime_enable` 写入 automation payload 的 `request_metadata.harness`。
- 已接入 `SkillsWorkspacePage`：Workspace 已注册能力面板可打开现有持续流程弹窗，提交后调用既有 `createAutomationJob`；默认 `enabled=false`，不绕过用户确认和 automation 主链。
- 定向验证已通过：`npx vitest run src/features/capability-drafts/workspaceSkillAgentAutomationDraft.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx`（7 passed）。
- Skills 工作台回归已通过：`npx vitest run src/components/skills/SkillsWorkspacePage.test.tsx`（30 passed）。
- TypeScript 校验已复跑通过：`npm run typecheck`。
- 已补 automation owner evidence：`agent_runtime_export_evidence_pack` 会把当前 session 的 `agent_runs` 注入导出服务，`runtime.json` / `artifacts.json` 写出 `automationOwners`。
- Rust evidence 定向验证已通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/tmp/lime-p4-agent-owner-target cargo test --manifest-path src-tauri/Cargo.toml -p lime --lib evidence_pack_should_export_automation_owner_agent_envelope_metadata`（1 passed）。
- 已补 Workspace managed job 状态投影：`WorkspaceRegisteredSkillsPanel` 会读取既有 automation jobs，并按 `agent_envelope.directory` / `skill` 显示 Managed Job 创建状态、schedule 与最近运行。
- 前端定向验证已复跑通过：`npx vitest run src/features/capability-drafts/workspaceSkillAgentAutomationDraft.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx src/components/skills/SkillsWorkspacePage.test.tsx`（38 passed）。
- 已补 pause / resume 最小闭环：Workspace managed job 状态区可调用既有 `updateAutomationJob` 切换 `enabled`。
- 已补 Managed Objective 状态 / audit 投影：success run 显示 `verifying`，等待 artifact / timeline / evidence 审计。
- 已补 evidence completion audit input：`automationOwners.runs[].completionAudit` 输出 `audit_input_ready` / `missing_inputs` / `blocked_by_run_status`，并保持 `completionDecision=not_completed`。
- 已补 evidence completion audit summary：`runtime.json` / `artifacts.json` 输出 `completionAuditSummary`，在 automation owner success、workspace skill ToolCall source metadata 与 artifact / timeline 证据齐全时才输出 `completed`。
- 已补 completion audit summary 负向回归：覆盖缺 automation owner -> `needs_input`、owner run error -> `blocked`、缺 audit inputs -> `needs_input`、缺 workspace skill ToolCall evidence -> `verifying`。
- 已补 `summary.md` Completion Audit 人类可读入口：导出 decision、owner success count、Workspace Skill ToolCall evidence、artifact evidence 与 blocking reasons。
- Rust evidence 负向定向验证已通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/tmp/lime-p4-agent-owner-target cargo test --manifest-path src-tauri/Cargo.toml -p lime --lib completion_audit_summary_should_classify_negative_paths`（1 passed）。
- Rust evidence 定向验证已复跑通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/tmp/lime-p4-agent-owner-target cargo test --manifest-path src-tauri/Cargo.toml -p lime --lib evidence_pack_should_export_automation_owner_agent_envelope_metadata`（1 passed）。
- Rust timeline 定向验证已复跑通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/tmp/lime-p4-agent-owner-target cargo test --manifest-path src-tauri/Cargo.toml -p lime --lib timeline_should_preserve_workspace_skill_source_metadata_for_agent_envelope`（1 passed）。
- 已补 evidence export UI projection：`RuntimeEvidencePackExportResult`、前端 normalizer 和 Harness 面板均接入 `completionAuditSummary`，导出问题证据包后可直接看到 evidence-based decision 与 blocking reasons。
- 前端定向验证已通过：`npx vitest run src/lib/api/agent.test.ts src/components/agent/chat/components/HarnessStatusPanel.test.tsx`（77 passed）。
- TypeScript 校验已通过：`npm run typecheck`。
- 命令契约校验已通过：`npm run test:contracts`，覆盖 agent runtime client manifest、命令契约、harness metadata contract、modality contracts 与 cleanup report contract。
- GUI smoke 已复跑通过：`npm run verify:gui-smoke -- --reuse-running --timeout-ms 300000`，覆盖 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface、runtime tool surface page、Knowledge GUI 与 Design Canvas。首次复跑曾在 `smoke:agent-service-skill-entry` 出现 Vitest worker `onTaskUpdate` 通信超时；单独复跑该 smoke 与完整 GUI smoke 均通过。
- 已补 Agent envelope completion audit gate：presentation contract 消费 `completionAuditSummary`，completed + 三项 evidence 齐全才进入 `evidence_ready`；verifying / 缺 ToolCall evidence 仍不可固化。
- 前端 presentation 定向验证已通过：`npx vitest run src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts`（6 passed）。
- 已补 Workspace Agent envelope evidence-gated action：`WorkspaceRegisteredSkillsPanel` 支持按 directory 注入 completion audit summary，completed + evidence 齐全后“转成 Agent 草案”复用 Managed Job 草案创建链。
- 前端 Workspace 定向验证已通过：`npx vitest run src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx`（12 passed）。
- 已补 Workspace recent run audit action：匹配 Managed Job 后可点击“审计最近运行”，通过 `getAutomationRunHistory` 找 session，再用 `exportAgentRuntimeEvidencePack` 导出并回填 `completion_audit_summary`，随后 evidence-gated Agent envelope 入口启用。
- Skills 工作台回归已通过：`npx vitest run src/components/skills/SkillsWorkspacePage.test.tsx`（30 passed）。
- GUI smoke 已在 recent run audit action 后复跑通过：`npm run verify:gui-smoke -- --reuse-running --timeout-ms 300000`，覆盖 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface、runtime tool surface page、Knowledge GUI 与 Design Canvas。
- 已补 Agent envelope card composition：Workspace 草案区展示 Runbook、Memory、Widget、Permission、Schedule、Evidence 六块组成，仍不新增执行实体。
- 前端定向验证已通过：`npx vitest run src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx`（12 passed）。
- TypeScript 校验已复跑通过：`npm run typecheck`。
- 已补 derived Agent card / workspace sharing 摘要：completed audit 后显示 `workspace-local/<skill-directory>` 派生 Agent card 与 workspace / team 共享范围；未完成审计时显示草案等待态。
- 前端定向验证已复跑通过：`npx vitest run src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx`（12 passed）。
- 已补 workspace/team sharing discovery 边界：Agent card 摘要展示 `.agents/skills/<skill-directory>` 的 registered discovery 来源，并说明复用同一 Managed Job / evidence。
- 前端定向验证已复跑通过：`npx vitest run src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx`（12 passed）。
- 已完成 P0-P4 completion audit：新增 `docs/exec-plans/skill-forge-completion-audit.md`，逐项映射 roadmap / implementation-plan 的 P0-P4 要求到代码、测试、命令验证和文档证据。
- 审计发现并修正 Agent envelope gate 的一个边界：仅 `evidencePackId` 存在时不再进入 `evidence_ready`；必须 `completionAuditSummary.decision=completed` 且 automation owner / Workspace Skill ToolCall / artifact-or-timeline 三项 evidence 齐全。
- 前端定向验证已复跑通过：`npx vitest run src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx`（12 passed）。
