# Skill Forge Read-Only HTTP API P8 执行计划

> 状态：P8 第三刀已落地；registration provenance 会携带 P7 preflight evidence，并持久化 pending session approval request artifact
> 日期：2026-05-07
> 上游阶段：P7 已要求 session authorization policy、credential reference 与 execution preflight，并把 preflight 输出为结构化 verification evidence
> 当前目标：不打开真实 HTTP runtime 的前提下，把 preflight evidence 从 verification report 串到注册后的 provenance / discovery 投影，并持久化只读授权请求 artifact，避免注册包只保留 report id 或纯 UI 预览而丢失关键授权门禁证据。

## 主目标

P8 前三刀只做 provenance 延续、授权预览与 pending 授权请求 artifact，不做真实联网执行：

```text
Capability Draft sourceKind=api
  -> P7 verification report 生成 readonly_http_execution_preflight evidence
  -> capability_draft_register 读取最新 passed verification report
  -> registration/latest.json 与 .agents/skills/<skill>/.lime/registration.json 记录 verification_gates
  -> capability_draft_list_registered_skills 投影 registration.verification_gates
  -> API normalizer / Workspace registered skills panel 展示 preflight provenance
  -> registration.approval_requests 持久化 pending session approval request artifact
  -> Workspace registered skills panel 展示 approval request artifact
  -> 仍不进入 runtime / scheduler / connector store
```

## 明确不做

1. 不发真实 HTTP 请求。
2. 不保存外部 API token。
3. 不新增 session credential store、connector store 或 adapter runtime。
4. 不新增 scheduler、queue、Agent rerun 或默认 tool surface。
5. 不把 registered discovery 解释成“已可运行”；它仍只证明当前 workspace 可发现带 provenance 的 Skill 包。

## 第一刀实现

- [x] `CapabilityDraftRegistrationSummary` 新增 `verification_gates`，只持久化 passed verification report 中的 `readonly_http_execution_preflight` evidence。
- [x] `capability_draft_register` 注册前读取并校验最新 verification report 与 manifest provenance 一致，避免 stale report 被写入注册摘要。
- [x] `capability_draft_list_registered_skills` 通过既有 registration metadata 自动投影 preflight provenance。
- [x] 浏览器 mock register / registered discovery 复制同一组 preflight provenance。
- [x] `src/lib/api/capabilityDrafts.ts` normalizer 支持 `verificationGates` / `verification_gates`。
- [x] `WorkspaceRegisteredSkillsPanel` 展示注册 provenance 中的 preflight evidence，并补稳定回归。

## 第二刀实现

- [x] `WorkspaceRegisteredSkillsPanel` 从 `readonly_http_execution_preflight` provenance 派生 `Session approval preview`，不新增命令、不读取 token、不发真实 HTTP。
- [x] preview 只展示未来授权请求会用到的 `Endpoint` 来源、`method`、`credentialReferenceId`、`evidenceSchema` 与 `policyPath`。
- [x] 当 endpoint 仍来自运行时输入时，展示 `runtime_input`，不伪造 URL。
- [x] UI 明确标注 `未授权 / 未执行 / 未保存凭证`，避免把注册发现误解成可运行能力。
- [x] `WorkspaceRegisteredSkillsPanel.test.tsx` 补回归断言，确保 preview 与“仍不提供立即运行入口”同时成立。

## 第三刀实现

- [x] `CapabilityDraftRegistrationSummary` 新增 `approval_requests`，从 `readonly_http_execution_preflight` provenance 生成 `pending` 授权请求 artifact。
- [x] artifact 字段固定为 `approvalId / status / sourceCheckId / skillDirectory / endpointSource / method / credentialReferenceId / evidenceSchema / policyPath / createdAt`。
- [x] artifact 只允许从 passed preflight gate 派生，并要求 `method=GET`、`credentialReferenceId`、`policyPath` 与非空 `evidenceSchema`；不保存 token、不保存明文 endpoint。
- [x] `capability_draft_list_registered_skills`、前端 API normalizer、浏览器 mock 与 Workspace 面板同步投影 `approvalRequests`。
- [x] Workspace 面板把第二刀 preview 升级为 `Session approval request artifact`，展示 `pending / 未执行 / 未保存凭证`，但仍不提供真实 HTTP 执行入口。

## 第二刀后验证清障

- [x] `src/lib/layered-design/subjectMatting.ts` 的 PNG 编码路径在构造 `ImageData` 前复制出 `Uint8ClampedArray<ArrayBuffer>`，消除全仓 `typecheck` 中 `ArrayBufferLike` 与 DOM `ImageDataArray` 的类型不匹配。
- [x] 清障只影响类型兼容与 Canvas 编码输入形态，不改变 P8 注册 provenance、approval preview、命令边界或真实 HTTP runtime。

## 验证计划

本轮最低验证：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p8-readonly-http-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
npm run typecheck
npm run test:contracts
npm run verify:gui-smoke
npx eslint "src/lib/api/capabilityDrafts.ts" "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.tsx" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" --max-warnings 0
git diff --check
```

第二刀最低验证：

```bash
npx vitest run "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx"
npm run typecheck
npm run test:contracts
npx eslint "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.tsx" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" --max-warnings 0
npm run verify:gui-smoke
git diff --check -- "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.tsx" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "docs/exec-plans/skill-forge-readonly-http-api-p8-plan.md" "docs/roadmap/skill-forge/README.md" "docs/roadmap/skill-forge/implementation-plan.md"
```

第三刀最低验证：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs" "src-tauri/src/services/runtime_skill_binding_service.rs"
npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"
npx eslint "src/lib/api/capabilityDrafts.ts" "src/lib/api/capabilityDrafts.test.ts" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.tsx" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" --max-warnings 0
npm run typecheck
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p8-approval-artifact-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
CARGO_INCREMENTAL=0 cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
npm run test:contracts
npm run verify:gui-smoke
git diff --check -- "src-tauri/src/services/capability_draft_service.rs" "src-tauri/src/services/runtime_skill_binding_service.rs" "src/lib/api/capabilityDrafts.ts" "src/lib/api/capabilityDrafts.test.ts" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.tsx" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "docs/exec-plans/skill-forge-readonly-http-api-p8-plan.md" "docs/roadmap/skill-forge/README.md" "docs/roadmap/skill-forge/implementation-plan.md"
```

结果：

1. `capability_draft` Rust 全套：`30 passed`，覆盖 registration provenance 与 registered discovery 投影。
2. API normalizer / Workspace registered skills 面板 / 浏览器 mock 回归：`40 passed`，覆盖 `verification_gates -> verificationGates`、preflight provenance 展示与 mock register 后的 provenance。
3. 第一刀 / 第二刀 `npm run typecheck`、`npm run test:contracts`、`npm run verify:gui-smoke`、定向 eslint 与 `git diff --check` 通过。
4. 禁用旧名扫描结果：`forbidden_matches=0`。
5. GUI smoke 复用已有 headless Tauri 环境，覆盖 workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface page、knowledge GUI 与 design canvas smoke。
6. 第二刀 UI 回归：`npx vitest run "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx"` 通过，`7 passed`，覆盖 approval preview、`runtime_input` endpoint、policy path 与仍不展示立即运行入口。
7. 第二刀契约 / UI 主路径：`npm run test:contracts`、定向 eslint、`npm run verify:gui-smoke`、定向 `git diff --check` 与禁用旧名扫描通过。
8. 第二刀后验证清障已完成：`npm run typecheck` 通过；`src/lib/layered-design/subjectMatting.test.ts` 通过，`5 passed`；`npm run smoke:design-canvas` 通过，确认清障没有破坏设计画布主路径。
9. 第三刀 API / UI / mock 回归：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"` 通过，`40 passed`。
10. 第三刀定向 eslint 通过。
11. 第三刀后续清障已消除 `src/lib/layered-design/cleanPlate.test.ts:88` 的 typecheck 阻断；`npm run typecheck` 在 P9 验证中通过。
12. 第三刀 Rust 定向测试已通过：`CARGO_INCREMENTAL=0 cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`30 passed`；此前使用 `/tmp/lime-p8-approval-artifact-target` 的尝试被 `/tmp` 空间不足阻断，已改用仓库既有 target 复测。
13. 第三刀契约 / GUI 主路径已通过：`npm run test:contracts` 通过；`npm run verify:gui-smoke` 通过，覆盖 workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface page、knowledge GUI 与 design canvas smoke。

## 完成标准

1. 只读 HTTP/API 草案通过 P7 verification 后注册，registration summary 必须携带 `readonly_http_execution_preflight` provenance。
2. provenance 至少包含 `method=GET`、`credentialReferenceId=readonly_api_session` 与 `evidenceSchema`。
3. registered discovery 与浏览器 mock 返回同一组 provenance。
4. Workspace registered skills 面板能展示该 provenance，但仍不展示运行、自动化或真实联网入口。
5. 注册前必须校验最新 verification report 与 manifest `lastVerification` 一致。
6. Workspace registered skills 面板能基于 provenance 派生授权请求预览，并明确该预览不是已授权、已执行或已保存凭证。
7. Registration summary 必须持久化 pending approval request artifact，并通过 registered discovery / mock / API normalizer / Workspace 面板同源展示。
