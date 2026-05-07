# Skill Forge Read-Only HTTP API P10 执行计划

> 状态：P10 第六刀已落地；runtime evidence pack 端到端回归与 GUI smoke 均已通过
> 日期：2026-05-07
> 上游阶段：P9 已把 pending approval artifact 推进到一次性受控 GET，并把非敏感 evidence artifact 接入 runtime evidence pack 摘要
> 当前目标：让 completion audit 明确看见 Read-Only HTTP API 的外部读取 evidence，作为后续 Agent envelope / Managed Objective 审计输入，但仍保持“只有 owner、Workspace Skill ToolCall、artifact / timeline 证据齐全才 completed”的安全边界。

## 主目标

P10 主链只做 completion audit 消费，不扩展执行面：

```text
.lime/capability-drafts/controlled-get-evidence/<artifact>.json
  -> agent_runtime_export_evidence_pack 只扫描当前 session 的安全 artifact
  -> runtime.json / artifacts.json 输出 capabilityDraftControlledGetEvidence
  -> completionAuditSummary 计入 controlledGetEvidenceArtifactCount / controlledGetEvidenceExecutedCount
  -> requiredEvidence.controlledGetEvidence 只表示有 executed 受控 GET evidence
  -> controlled GET evidence 不能单独 completed
  -> completed 判定仍由 automation owner、Workspace Skill ToolCall、artifact / timeline 证据共同决定
```

## 明确不做

1. 不新增 Tauri 命令、前端入口、输入框、token 输入或调度入口。
2. 不把受控 GET evidence 注入 Query Loop、runtime 或 default tool surface。
3. 不保存 endpoint 明文、token 明文或 response preview 正文。
4. 不让单独受控 GET artifact 把 completion audit 推到 `completed`。
5. 不把 `request_failed` 计作 successful external evidence。

## 第一刀实现

- [x] `completionAuditSummary` 新增 `controlledGetEvidenceArtifactCount`、`controlledGetEvidenceExecutedCount`、`controlledGetEvidenceScannedArtifactCount`、`controlledGetEvidenceSkippedUnsafeArtifactCount` 与 `controlledGetEvidenceStatusCounts`。
- [x] `completionAuditSummary.requiredEvidence.controlledGetEvidence` 只在存在 `status=executed`、已发送请求、已捕获响应、且有 request / response hash 的受控 GET evidence 时为 `true`。
- [x] `summary.md` 的 Completion Audit 区域展示受控 GET evidence executed / artifact 计数，方便人工从摘要入口确认外部只读证据是否进入审计。
- [x] `runtime.json`、`artifacts.json` 与导出返回值中的 `completionAuditSummary` 均消费同一份受控 GET evidence 摘要。
- [x] 单独受控 GET evidence 不会触发 `completed`；缺 Workspace Skill ToolCall 时仍保持 `verifying` 并输出阻塞原因。
- [x] completion audit 只输出计数、状态分布和布尔 required evidence，不复制 endpoint、token 或 response preview。

## 第二刀实现

- [x] 前端 `AgentRuntimeCompletionAuditSummary` normalizer 识别 `controlledGetEvidence*` 计数、status 分布与 `requiredEvidence.controlledGetEvidence`，让导出返回值不丢失外部只读 evidence 输入。
- [x] Agent envelope presentation 的 evidence label 展示 `受控 GET <executed>/<artifact> executed`，让 Workspace 固化入口能解释 Read-Only HTTP API 的 external evidence 是否已经出现。
- [x] 只要存在 completion audit summary，即使还未 `completed`，Agent envelope 也保持 `source_metadata_ready / 等待 Completion Audit`，避免把已有审计输入误显示成“还没有成功运行证据”。
- [x] `controlledGetEvidence=true` 仍不能单独打开 Agent envelope 固化入口；`actionEnabled` 继续只认 completed audit 以及 automation owner / Workspace Skill ToolCall / artifact-or-timeline 三项证据。
- [x] 前端回归覆盖：completed audit 会展示受控 GET evidence；仅有受控 GET evidence 时仍 disabled，并显示缺 Workspace Skill ToolCall / artifact evidence 的阻塞原因。

## 第三刀实现

- [x] Workspace registered skill 若带 `readonly_http_execution_preflight` verification gate / approval request，创建 Managed Job 草案时会把 `requiresControlledGetEvidence=true` 传入 Agent automation draft。
- [x] Agent automation draft 的 `managed_objective` 新增 `required_external_evidence=["controlled_get_evidence"]` 与 `completion_evidence_policy.controlled_get_evidence_required=true`，让 Read-Only HTTP API 目标显式要求 external read evidence。
- [x] `completionAuditSummary` 新增 `controlledGetEvidenceRequired`，并在 owner metadata 声明该 policy 时，把缺 executed 受控 GET evidence 判为 `missing_controlled_get_evidence`。
- [x] Read-Only HTTP API owner 即使具备 automation owner、Workspace Skill ToolCall 与 artifact / timeline evidence，缺受控 GET evidence 时仍保持 `verifying`；补齐 executed evidence 后才允许 `completed`。
- [x] 普通非 HTTP / 未声明该 policy 的 managed objective 不受影响，仍只按 automation owner、Workspace Skill ToolCall 与 artifact / timeline 三项 evidence 判定 completed。

## 第四刀实现

- [x] Agent envelope `evidence_ready` gate 增加防御性检查：若 `completionAuditSummary.controlledGetEvidenceRequired=true`，必须同时满足 `requiredEvidence.controlledGetEvidence=true`。
- [x] 即使收到异常或旧版后端返回的 `decision=completed`，只要缺 required controlled GET evidence，Workspace 固化入口仍保持 `source_metadata_ready`，`actionEnabled=false`。
- [x] evidence label 在该异常状态下会显示 `受控 GET required 0/0 executed` 与“缺受控 GET evidence，不能固化为 Agent”，避免前端误导用户。

## 第五刀实现

- [x] 新增 runtime evidence pack 端到端回归：同一个 owner metadata 声明 Read-Only HTTP API 受控 GET evidence policy，且 session 已有 Workspace Skill ToolCall 与 artifact / timeline 证据。
- [x] 未落盘 `.lime/capability-drafts/controlled-get-evidence/*.json` 时，`agent_runtime_export_evidence_pack` 的 `completionAuditSummary.decision=verifying`，并输出 `missing_controlled_get_evidence`。
- [x] 落盘当前 session 的 executed 受控 GET evidence artifact 后，同一个导出入口会得到 `completionAuditSummary.decision=completed`，并在 `runtime.json` / `summary.md` 中投影 required / executed 计数。
- [x] 回归同时断言 evidence pack 不复制 endpoint 明文、token 明文或 response preview 正文，保持 P9 / P10 的非敏感 evidence 边界。

## 第六刀实现

- [x] 复用已有 headless Tauri / DevBridge 环境执行 GUI smoke，验证 Workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface、runtime tool surface page、knowledge GUI 与 design canvas 主路径。
- [x] GUI smoke 证明 P10 的 Read-Only HTTP API completion policy、Agent envelope gate 与 Workspace / Skills 相关改动未破坏桌面壳、DevBridge、默认 workspace 与主要页面主路径。
- [x] 本刀只做产品可交付验证，不新增命令、不新增 UI 字段、不打开 runtime / scheduler / default tool surface。

## 验证计划

本轮最低验证：

```bash
rustfmt --edition 2021 "src-tauri/src/services/runtime_evidence_pack_service.rs"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-runtime-evidence-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib runtime_evidence_pack --no-default-features
npm run test:contracts
git diff --check -- "src-tauri/src/services/runtime_evidence_pack_service.rs" "docs/exec-plans/skill-forge-readonly-http-api-p10-plan.md" "docs/exec-plans/README.md" "docs/roadmap/skill-forge/README.md" "docs/roadmap/skill-forge/implementation-plan.md"
if rg -n -i "c[r]eao" "docs/aiprompts" "docs/research" "docs/roadmap" "docs/exec-plans"; then exit 1; else echo "forbidden_matches=0"; fi
```

结果：

- [x] Rust runtime evidence pack 回归：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-runtime-evidence-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib runtime_evidence_pack --no-default-features` 通过，`29 passed`。
- [x] `npm run test:contracts` 通过，确认本刀未造成命令契约、Harness 契约、modality runtime contracts 或 cleanup report contract 漂移。
- [x] 定向 `git diff --check` 通过，覆盖 runtime evidence pack 服务、P10 执行计划与路线图入口。
- [x] 禁用旧名扫描通过：`forbidden_matches=0`。
- [x] P10 第二刀前端定向回归：`npx vitest run "src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/api/agent.test.ts"` 通过，`51 passed`。
- [x] P10 第二刀定向 eslint 通过，覆盖 Agent Runtime normalizer / types、Agent envelope presentation 与相关测试。
- [x] P10 第二刀 `npm run typecheck` 通过。
- [x] P10 第二刀定向 `git diff --check` 通过。
- [x] P10 第二刀禁用旧名扫描通过：`forbidden_matches=0`。
- [x] P10 第三刀 Rust runtime evidence pack 回归：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-runtime-evidence-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib runtime_evidence_pack --no-default-features` 通过，`30 passed`。
- [x] P10 第三刀前端定向回归：`npx vitest run "src/features/capability-drafts/workspaceSkillAgentAutomationDraft.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts" "src/lib/api/agent.test.ts"` 通过，`56 passed`。
- [x] P10 第三刀定向 eslint 通过，覆盖 Skills Workspace、Workspace registered skills 面板、Agent automation draft、Agent envelope presentation 与 Agent Runtime normalizer / types。
- [x] P10 第三 / 第四刀 `npm run typecheck` 复跑通过。
- [x] P10 第三刀定向 `git diff --check` 通过。
- [x] P10 第三刀禁用旧名扫描通过：`forbidden_matches=0`。
- [x] P10 第四刀 Agent envelope 定向回归：`npx vitest run "src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts"` 通过，`8 passed`。
- [x] P10 第四刀定向 eslint 通过，覆盖 Agent envelope presentation 与测试。
- [x] P10 第四刀定向 `git diff --check` 通过；禁用旧名扫描通过：`forbidden_matches=0`。
- [x] P10 第五刀 Rust 定向回归：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-runtime-evidence-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib evidence_pack_should_complete_readonly_http_policy_only_with_controlled_get_evidence --no-default-features` 通过，`1 passed`。
- [x] P10 第五刀 runtime evidence pack 回归：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-runtime-evidence-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib runtime_evidence_pack --no-default-features` 通过，`31 passed`。
- [x] P10 第六刀 GUI smoke：`npm run verify:gui-smoke` 通过，复用既有 headless 环境，覆盖 workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface、runtime tool surface page、knowledge GUI 与 design canvas。
