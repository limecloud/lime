# Skill Forge Prompt-to-Artifact P5 样例审计

> 日期：2026-05-06
> 状态：P5 demo / smoke / evidence 闭环已完成
> 范围：只读 CLI / fixture 每日报告样例；不新增 runtime、scheduler、queue、Marketplace 或 Agent card 存储表。

## 审计目标

验证一个用户目标能在现有主链内完成：

```text
只读报告目标
  -> Capability Draft
  -> verification gate
  -> workspace-local registration
  -> registered discovery
  -> runtime binding readiness
  -> first artifact / evidence pack
  -> completion audit summary = completed
  -> Workspace Agent envelope 草案入口
```

P5 只证明产品证据链，不把 demo fixture 升级成生产 telemetry，也不绕过 session-scoped runtime enable gate。

## 完成证据

| 阶段 | 结论 | 证据 |
| --- | --- | --- |
| Draft / Verification | prompt-to-artifact smoke 可生成只读报告草案并通过验证 | `scripts/prompt-to-artifact-smoke.mjs` |
| Registration / Discovery | 注册只写入临时 workspace，发现态仍不默认 launch | smoke 输出 `verificationStatus=verified_pending_registration` |
| Binding readiness | binding 只进入 `ready_for_manual_enable`，下一道 gate 仍是手动启用 | smoke 输出 `bindingStatus=ready_for_manual_enable`、`nextGate=manual_runtime_enable` |
| Evidence pack | Markdown artifact、Workspace Skill ToolCall metadata、automation owner metadata 可组合成 completed audit | Rust 定向测试 `skill_forge_p5_readonly_report_artifact_should_complete_agent_envelope_audit` |
| Negative gate | success owner run 缺任一 required evidence 不能误判 completed | 既有负向测试 `completion_audit_summary_should_classify_negative_paths` |
| Workspace UI | incomplete audit 禁用 Agent 草案入口，completed audit 才启用 | `WorkspaceRegisteredSkillsPanel.test.tsx` P5 UI smoke |
| Team boundary | Agent card / sharing / discovery 文案限定 workspace / team，不进入 public Marketplace | `WorkspaceRegisteredSkillsPanel.test.tsx` P5 UI smoke |

## 已执行验证

```bash
node --check scripts/prompt-to-artifact-smoke.mjs
node scripts/prompt-to-artifact-smoke.mjs --timeout-ms 10000 --cleanup --json
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p5-evidence-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib skill_forge_p5_readonly_report_artifact_should_complete_agent_envelope_audit --no-default-features
npx vitest run "src/features/capability-drafts/workspaceSkillAgentAutomationDraft.test.ts" "src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/components/skills/SkillsWorkspacePage.test.tsx" "src/lib/api/capabilityDrafts.test.ts"
npm run typecheck
npm run test:contracts
git diff --check
npm run verify:gui-smoke -- --reuse-running --timeout-ms 300000
```

验证结果：

- 脚本 smoke 通过，输出 `status=passed`。
- Rust 定向测试通过，结果 `1 passed`。
- 前端相关回归通过，结果 `5 files / 52 passed`。
- TypeScript、契约检查和 diff 检查均通过。
- GUI smoke 通过，覆盖 DevBridge、默认 workspace、browser runtime、site adapters、Agent service skill entry、runtime tool surface、knowledge GUI 与 design canvas。

## 边界确认

1. 未新增 `agent_envelope_*` 命令。
2. 未新增 automation scheduler 实现。
3. 未新增 public Marketplace / Skill Store。
4. 未新增 Agent card 持久化表。
5. 未新增 runtime evidence 事实源。
6. 未把 `ready_for_manual_enable` 误当成默认可运行。
7. 未把 success owner run 误当成 completed audit。

## 后续项

1. GUI smoke 已在迁移后通过；如后续继续改真实 Workspace 可见行为，仍需复跑 `npm run verify:gui-smoke`。
2. 历史命名已迁移为中性命名；后续新增文档继续使用 `Skill Forge` / `skill-forge`。
3. 如要接真实外部 API，必须先补只读 policy、fixture dry-run 与人工确认边界。
- 路径迁移后完整复验通过：禁用命名扫描 `forbidden_matches=0`，相对链接检查 `relative_links_ok`；`node --check scripts/prompt-to-artifact-smoke.mjs && node scripts/prompt-to-artifact-smoke.mjs --timeout-ms 10000 --cleanup --json` 通过；Rust evidence 定向测试 `1 passed`；相关前端回归 `5 files / 52 passed`；`npm run typecheck`、`npm run test:contracts`、`git diff --check` 均通过。
