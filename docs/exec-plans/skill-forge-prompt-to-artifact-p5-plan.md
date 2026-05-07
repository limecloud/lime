# Prompt-to-Artifact P5 执行计划

> 状态：P5 demo / smoke / evidence 闭环已完成
> 日期：2026-05-06
> 前置审计：`P0-P4 completion audit`
> 路线图来源：现有主路线图与本执行计划
> 当前目标：在 P0-P4 已完成的能力链路上，跑通一个真实 “只读 CLI / 公开 API 每日报告” prompt-to-artifact E2E 样例，证明从用户目标到 workspace artifact、evidence-based completion audit 与 Agent envelope 固化建议的完整产品闭环。

## 主目标

P5 不再扩 runtime 面，而是把 P0-P4 的工程能力组合成一个可重复验证的产品样例：

```text
用户目标：每天 9 点读取只读 CLI / fixture 输出，生成 Markdown 趋势摘要
  -> Capability Draft
  -> verification gate
  -> workspace-local registration
  -> registered discovery / binding readiness
  -> session runtime enable
  -> first run artifact
  -> Managed Job 草案
  -> automation owner evidence
  -> completion audit summary = completed
  -> Workspace Agent envelope 草案 / derived Agent card
```

固定边界：

**P5 只产出演示数据集、脚本化 smoke 与产品证据，不新增 runtime、scheduler、queue、Marketplace 或 Agent card 存储表。**

## 本轮最小切口

P5 第一刀只做一个可重复的 read-only demo，不接外部网络、不安装依赖、不执行危险 shell：

1. 使用临时 workspace。
2. 生成一个标准 read-only CLI report Capability Draft。
3. draft 文件只包含：`SKILL.md`、`contract/input.schema.json`、`contract/output.schema.json`、`examples/input.json`、`tests/fixture.json`、`scripts/README.md` 或等价 wrapper 说明。
4. 通过 `capability_draft_verify`。
5. 通过 `capability_draft_register` 注册到 `.agents/skills/<skill_directory>`。
6. 通过 `capability_draft_list_registered_skills` 与 `agent_runtime_list_workspace_skill_bindings` 证明 discovery / readiness。
7. 构造一次受控 first-run evidence：必须包含 Workspace Skill ToolCall source metadata、Markdown artifact、automation owner run metadata。
8. 调用 `agent_runtime_export_evidence_pack` 或等价服务导出 evidence pack。
9. 断言 `completionAuditSummary.decision=completed` 且 required evidence 三项为 true。
10. 在 Workspace UI / component 测试中证明 completed audit 会启用 “转成 Agent 草案”，未 completed 不会启用。

## 明确不做

1. 不接真实外部 API。
2. 不安装 CLI 依赖。
3. 不做外部写操作。
4. 不新增 `agent_envelope_*` 命令。
5. 不新增 automation scheduler 实现。
6. 不复制 public Marketplace / Skill Store。
7. 不把 P5 demo 数据写入用户真实 workspace。
8. 不把 demo fixture 当成 production telemetry。

## Prompt-to-artifact 验收清单

| 阶段 | 验收 | 证据位置 |
| --- | --- | --- |
| Draft | `capability_draft_create` 生成 read-only report draft | smoke log / temp workspace manifest |
| Verification | 缺 contract 会失败，完整 draft 会 pending registration | Rust / DevBridge smoke |
| Registration | 注册只写当前 workspace `.agents/skills` | `.lime/registration.json` / registered skill record |
| Discovery | registered discovery 返回 provenance、权限、标准检查 | `capability_draft_list_registered_skills` |
| Binding | readiness 为 `ready_for_manual_enable`，仍默认不可运行 | `agent_runtime_list_workspace_skill_bindings` |
| Runtime enable | request metadata 含 `workspace_skill_runtime_enable` | smoke generated metadata |
| First artifact | 生成 Markdown artifact，路径落当前 workspace | artifact file / evidence pack |
| Owner evidence | automation owner metadata 含 Agent envelope 与 Managed Objective | `runtime.json` / `artifacts.json` |
| Completion audit | summary 为 `completed`，三项 required evidence 为 true | `completionAuditSummary` |
| Workspace Agent | completed audit 后才启用 Agent envelope action | component / GUI smoke |

## 实施步骤

### P5-0：计划与边界

- [x] 新增本执行计划。
- [x] 明确 P5 是 demo / smoke / evidence，不扩 P4 runtime。

### P5-1：脚本化 prompt-to-artifact smoke

- [x] 新增 `scripts/prompt-to-artifact-smoke.mjs`。
- [x] 复用 DevBridge invoke 链路：health -> create -> verify -> register -> list registered -> list binding。
- [x] 使用临时 workspace，结束后默认保留路径供调试；可提供 `--cleanup` 清理。
- [x] 输出结构化 JSON summary，包含 draft id、verification report id、registered directory、binding status 与 next gate。

### P5-2：Evidence fixture / service smoke

- [x] 补 Rust service 层定向测试，把 read-only report artifact、ToolCall source metadata、automation owner run 组合成 completed `completionAuditSummary`。
- [x] 验证 `success` owner run 缺任一 evidence 时仍为 `verifying / needs_input / blocked`。
- [x] 不新增 evidence 事实源。

### P5-3：Workspace UI E2E smoke

- [x] 扩展或新增 Workspace registered skills smoke，注入 completed audit summary。
- [x] 断言 “转成 Agent 草案”只在 completed audit 后可点击。
- [x] 断言 Agent card、sharing、discovery 文案存在且限定 workspace / team。

### P5-4：文档和验证收口

- [x] 新增 `docs/exec-plans/skill-forge-prompt-to-artifact-p5-audit.md` 记录 P5 样例证据。
- [x] 更新本执行计划与 `docs/exec-plans/README.md` 的 P5 状态。
- [x] 运行 P5 smoke、相关 vitest、`npm run test:contracts`；本轮只补测试与文档，未改用户可见 UI 实现，暂不追加 GUI smoke。

## 验证策略

最低验证：

```bash
node scripts/prompt-to-artifact-smoke.mjs --timeout-ms 120000
npx vitest run src/features/capability-drafts/agentEnvelopeDraftPresentation.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx src/features/capability-drafts/workspaceSkillAgentAutomationDraft.test.ts
npm run test:contracts
```

如果触碰 Rust evidence service：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features completion_audit_summary_should_classify_negative_paths evidence_pack_should_export_automation_owner_agent_envelope_metadata
```

如果触碰 Skills 工作台可见行为：

```bash
npm run verify:gui-smoke -- --reuse-running --timeout-ms 300000
```

## P5 完成标准

1. 能从一个 read-only report prompt 生成、验证、注册 workspace-local skill。
2. 能用同一 workspace 发现 registered skill 并拿到 readiness。
3. 能构造或运行一次 first artifact，并导出 evidence pack。
4. completion audit summary 能基于 owner / ToolCall / artifact evidence 输出 `completed`。
5. Workspace 只在 completed audit 后启用 Agent envelope action。
6. 全链路证据写回 repo 文档，不只存在终端输出或聊天上下文。

## 执行记录

### 2026-05-06

- 已从 P0-P4 completion audit 回到主线，确认 P5 第一刀只做 prompt-to-artifact demo / smoke / evidence，不新增 runtime、scheduler、queue、Marketplace 或 Agent card 存储表。
- 已新增 `scripts/prompt-to-artifact-smoke.mjs`：脚本创建临时 workspace，走 DevBridge `capability_draft_create -> capability_draft_verify -> capability_draft_register -> capability_draft_list_registered_skills -> agent_runtime_list_workspace_skill_bindings`，并断言 registered discovery 仍 `launchEnabled=false`、binding 为 `ready_for_manual_enable` 且仍不可默认进入 tool runtime。
- 已验证脚本语法与帮助输出：`node --check scripts/prompt-to-artifact-smoke.mjs`、`node scripts/prompt-to-artifact-smoke.mjs --help`。
- DevBridge smoke 已通过：`node scripts/prompt-to-artifact-smoke.mjs --timeout-ms 10000 --cleanup --json`，输出 `status=passed`、`verificationStatus=verified_pending_registration`、`bindingStatus=ready_for_manual_enable`、`nextGate=manual_runtime_enable`。
- Rust evidence 定向测试已通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p5-evidence-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib skill_forge_p5_readonly_report_artifact_should_complete_agent_envelope_audit --no-default-features`，结果 `1 passed`。
- P5-2 只复用 runtime evidence pack 既有事实源：Markdown artifact、Workspace Skill ToolCall metadata、automation owner metadata；负向路径沿用 `completion_audit_summary_should_classify_negative_paths` 覆盖，未新增 runtime、scheduler 或 evidence source。
- 复跑脚本 smoke 通过：`node --check scripts/prompt-to-artifact-smoke.mjs`、`node scripts/prompt-to-artifact-smoke.mjs --timeout-ms 10000 --cleanup --json`。
- 前端定向回归已通过：`npx vitest run "src/features/capability-drafts/workspaceSkillAgentAutomationDraft.test.ts" "src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx" "src/components/skills/SkillsWorkspacePage.test.tsx" "src/lib/api/capabilityDrafts.test.ts"`，结果 `4 files / 45 passed`。
- 契约回归已通过：`npm run test:contracts`；`git diff --check` 无 whitespace error。
- P5-3 Workspace UI component smoke 已补充并通过：`npx vitest run "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx"`，结果 `7 passed`；新增断言覆盖 incomplete audit 禁用 Agent 草案入口、completed audit 启用入口，以及 Agent card / workspace-team sharing / registered discovery 文案。
- P5-3 后复跑相关前端回归：`npx vitest run "src/features/capability-drafts/workspaceSkillAgentAutomationDraft.test.ts" "src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/components/skills/SkillsWorkspacePage.test.tsx" "src/lib/api/capabilityDrafts.test.ts"`，结果 `5 files / 52 passed`。
- 复跑 `npm run typecheck`、`npm run test:contracts`、`git diff --check` 均通过；本轮没有改用户可见 UI 实现，GUI smoke 留到真实 Workspace 行为变更时再跑。
- 新增 P5 样例审计：`docs/exec-plans/skill-forge-prompt-to-artifact-p5-audit.md`，集中记录 prompt-to-artifact smoke、Rust evidence、Workspace UI smoke、边界确认与后续项；同步更新 `docs/exec-plans/README.md` 索引。
- 路径迁移后完整复验通过：禁用命名扫描 `forbidden_matches=0`，相对链接检查 `relative_links_ok`；`node --check scripts/prompt-to-artifact-smoke.mjs && node scripts/prompt-to-artifact-smoke.mjs --timeout-ms 10000 --cleanup --json` 通过；Rust evidence 定向测试 `1 passed`；相关前端回归 `5 files / 52 passed`；`npm run typecheck`、`npm run test:contracts`、`git diff --check` 均通过。
- GUI 主路径 smoke 已补跑通过：`npm run verify:gui-smoke -- --reuse-running --timeout-ms 300000`，覆盖 DevBridge、workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface、knowledge GUI 与 design canvas。
