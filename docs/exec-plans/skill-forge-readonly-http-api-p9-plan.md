# Skill Forge Read-Only HTTP API P9 执行计划

> 状态：P9 第十一刀已落地；approval request artifact 已带最小消费门禁、session credential resolver、输入 schema、session 输入校验 handler、dry evidence plan、最小受控 GET 执行门禁、非敏感 evidence artifact 与 runtime evidence pack 摘要接入
> 日期：2026-05-07
> 上游阶段：P8 已把 `readonly_http_execution_preflight` provenance 串到 registration / discovery，并持久化 pending `approvalRequests[]`
> 当前目标：在不打开 runtime / scheduler / default tool surface 的前提下，让 pending approval artifact 从 session 输入合同推进到一次性受控 GET evidence 结果，并把结果落成可追踪的非敏感 artifact，避免 UI 或后续 runtime 把“已注册 / 已校验 / 已执行一次 GET”误读成“可自动运行”。

## 主目标

P9 主链只做 approval artifact 的消费门禁、session credential resolver、input schema、session input intake、session input submission contract、session-scoped 输入校验 handler、受控 GET preflight 投影、dry evidence plan 与一次性受控 GET evidence 结果；仍不接 runtime / scheduler / default tool surface：

```text
registration.approval_requests[]
  -> consumption_gate.status = awaiting_session_approval
  -> required_inputs 标出 session_user_approval / runtime_endpoint_input / credential_reference / evidence_capture
  -> runtime_execution_enabled=false
  -> credential_storage_enabled=false
  -> credential_resolver.status = awaiting_session_credential
  -> credential_resolver.reference_id / scope=session / source=user_session_config
  -> token_persisted=false / runtime_injection_enabled=false
  -> consumption_input_schema.schema_id = readonly_http_session_approval_v1
  -> fields 标出 session 授权确认、runtime endpoint、凭证引用确认和 evidence 捕获确认
  -> ui_submission_enabled=false / runtime_execution_enabled=false
  -> session_input_intake.status = awaiting_session_inputs
  -> missing_field_keys 标出当前 session 尚未收集的授权输入
  -> endpoint_input_persisted=false / secret_material_status=not_collected
  -> session_input_submission_contract.status = submission_contract_declared
  -> validation_rules 标出一次性 session 输入的校验边界
  -> submission_handler_enabled=true / value_retention=none
  -> capability_draft_submit_approval_session_inputs 只校验 session 输入
  -> validated_pending_runtime_gate 仍不解析凭证、不执行 HTTP、不保存值
  -> controlled_get_preflight.status = ready_for_controlled_get_preflight
  -> request_execution_enabled=false / endpoint_value_returned=false
  -> dry_preflight_plan.status = planned_without_execution
  -> request_url_hash=sha256(endpoint) / network_request_sent=false
  -> capability_draft_execute_controlled_get 在同一份 session 输入合同通过后执行一次性 GET
  -> response_status / response_sha256 / executed_at / response_preview / evidence
  -> .lime/capability-drafts/controlled-get-evidence/<artifact>.json 只保存 hash / status / evidence metadata
  -> agent_runtime_export_evidence_pack 输出 capabilityDraftControlledGetEvidence 摘要
  -> endpoint_value_returned=false / endpoint_input_persisted=false / token_persisted=false
  -> Workspace registered skills panel 展示消费门禁
  -> 后续阶段才能把 evidence 接回 runtime artifact / evidence pack；仍不能直接接 scheduler/default tool surface
```

## 明确不做

1. 不通过 runtime、scheduler、默认 tool surface 或自动化任务发 HTTP 请求；本阶段只允许 `capability_draft_execute_controlled_get` 在当前 session 显式输入通过后执行一次性 GET。
2. 不保存外部 API token。
3. 不新增 connector store、credential store 或 adapter runtime。
4. 不新增 scheduler、queue、长期授权或默认 tool surface。
5. 不把 `pending` approval request、`validated_pending_runtime_gate` 或单次 `executed` 解释成已授权长期运行或已可自动运行。

## 第一刀实现

- [x] `CapabilityDraftRegistrationApprovalRequest` 新增 `consumption_gate`，默认状态为 `awaiting_session_approval`。
- [x] `consumption_gate.required_inputs` 明确列出 `session_user_approval`、运行时 endpoint 输入、session 凭证引用与 evidence 捕获要求。
- [x] `consumption_gate.runtime_execution_enabled=false`，`credential_storage_enabled=false`，继续阻断真实执行和凭证持久化。
- [x] 前端 API normalizer、浏览器 mock 与 Workspace registered skills 面板同步消费 `consumptionGate`。
- [x] Workspace 面板在 `Session approval request artifact` 中展示“消费门禁”，让下一步从 UI 上仍保持待授权 / 未执行。

## 第二刀实现

- [x] `CapabilityDraftRegistrationApprovalRequest` 新增 `credential_resolver`，只投影凭证引用解析边界，不读取 secret。
- [x] resolver 固定 `status=awaiting_session_credential`、`scope=session`、`source=user_session_config`、`secretMaterialStatus=not_requested`。
- [x] resolver 明确 `tokenPersisted=false`、`runtimeInjectionEnabled=false`，阻断凭证持久化和 runtime 注入。
- [x] 前端 API normalizer、浏览器 mock 与 Workspace registered skills 面板同步消费 `credentialResolver`。
- [x] Workspace 面板在 approval artifact 中展示 `Session credential resolver`，说明凭证只能在后续 session scope 内解析。

## 第三刀实现

- [x] `CapabilityDraftRegistrationApprovalRequest` 新增 `consumption_input_schema`，只定义后续 session 授权输入合同，不提交、不执行。
- [x] schema 固定 `schemaId=readonly_http_session_approval_v1`，字段包含 `session_user_approval`、`runtime_endpoint_input`、`credential_reference_confirmation` 与 `evidence_capture_consent`。
- [x] schema 明确 `uiSubmissionEnabled=false`、`runtimeExecutionEnabled=false`，阻断 UI 提交和真实执行。
- [x] 前端 API normalizer、浏览器 mock 与 Workspace registered skills 面板同步消费 `consumptionInputSchema`。
- [x] Workspace 面板在 approval artifact 中展示 `Approval consumption input schema`，但仍不显示表单提交或立即运行入口。

## 第四刀实现

- [x] `CapabilityDraftRegistrationApprovalRequest` 新增 `session_input_intake`，只投影当前 session 输入接入状态，不收集、不提交、不执行。
- [x] intake 固定 `status=awaiting_session_inputs`、`scope=session`，并把 required / missing / collected field keys 显式区分；当前 `collectedFieldKeys=[]`，`missingFieldKeys` 等于全部 required fields。
- [x] intake 明确 `endpointInputPersisted=false`、`secretMaterialStatus=not_collected`、`tokenPersisted=false`、`uiSubmissionEnabled=false`、`runtimeExecutionEnabled=false`。
- [x] 前端 API normalizer、浏览器 mock 与 Workspace registered skills 面板同步消费 `sessionInputIntake`。
- [x] Workspace 面板在 approval artifact 中展示 `Session input intake` 与 missing inputs，但仍不显示输入框、提交按钮、token 输入或立即运行入口。

## 第五刀实现

- [x] `CapabilityDraftRegistrationApprovalRequest` 新增 `session_input_submission_contract`，声明一次性 session 输入提交校验合同。
- [x] contract 固定 `status=submission_contract_declared`、`scope=session`、`mode=one_time_session_submission`，并列出 `acceptedFieldKeys` 与 `validationRules`。
- [x] validation rules 明确 runtime endpoint 只能是 `http/https URL` 且不写入注册包；credential confirmation 只能匹配凭证引用且不接收 token 明文。
- [x] contract 明确 `valueRetention=none`、`endpointInputPersisted=false`、`secretMaterialAccepted=false`、`tokenPersisted=false`、`uiSubmissionEnabled=false`、`runtimeExecutionEnabled=false`。
- [x] 前端 API normalizer、浏览器 mock 与 Workspace registered skills 面板同步消费 `sessionInputSubmissionContract`。
- [x] Workspace 面板在 approval artifact 中展示 `Session submission contract` 与校验规则，但仍不显示输入框、提交按钮、token 输入或立即运行入口。

## 第六刀实现

- [x] 新增 `capability_draft_submit_approval_session_inputs` 命令，只消费 `approvalId + sessionId + inputs` 并在当前 session scope 内执行字段校验。
- [x] 命令会读取当前 workspace 的 registered skill discovery，定位 pending `approvalRequests[]`，并按 `sessionInputSubmissionContract.validationRules` 校验输入。
- [x] 正向结果固定为 `validated_pending_runtime_gate`，只表示 session 输入有效；仍返回 `runtimeExecutionEnabled=false`、`credentialResolved=false`、`endpointInputPersisted=false`、`secretMaterialAccepted=false`、`tokenPersisted=false`、`valueRetention=none`。
- [x] 负向结果固定为 `rejected`，覆盖缺必填字段、非 `http/https` URL、URL 内嵌凭证、凭证引用不匹配和合同外字段。
- [x] 命令不会回传 endpoint 明文作为结果字段，不读取 token，不解析 credential reference，不写注册包，不进入真实 HTTP runtime。
- [x] 前端 API 网关、DevBridge dispatcher、Rust command registration、治理目录册、浏览器 mock 与 mock priority 已同步。
- [x] Workspace 面板只把 `submitHandler=true` 展示为校验 handler 已存在，仍不展示输入框、提交按钮、token 输入或立即运行入口。

## 第七刀实现

- [x] `SubmitCapabilityDraftApprovalSessionInputsResult` 新增 `controlledGetPreflight` 投影，把 `validated_pending_runtime_gate` 连接到只读执行前门禁。
- [x] `controlledGetPreflight.status` 正向为 `ready_for_controlled_get_preflight`，负向为 `blocked_by_session_input`。
- [x] preflight 投影只回传 gate id、approval id、method、endpoint source、credential reference、evidence schema 与 policy path；不回传 endpoint 明文。
- [x] preflight 固定 `requestExecutionEnabled=false`、`runtimeExecutionEnabled=false`、`endpointValueReturned=false`、`credentialResolved=false`，仍不发真实 HTTP、不解析凭证、不进入 runtime。
- [x] 前端 API normalizer 与浏览器 mock 已同步 `controlledGetPreflight`，并补充正向回归。

## 第八刀实现

- [x] `SubmitCapabilityDraftApprovalSessionInputsResult` 新增 `dryPreflightPlan`，只生成执行前 evidence plan，不执行请求。
- [x] 正向 plan 固定 `status=planned_without_execution`，负向固定 `blocked_by_session_input`。
- [x] plan 只保留 `requestUrlHash=sha256(endpoint)`，不回传 endpoint 明文，并固定 `endpointValueReturned=false`、`endpointInputPersisted=false`。
- [x] plan 固定 `credentialResolutionStage=not_started`、`credentialResolved=false`、`networkRequestSent=false`、`responseCaptured=false`、`requestExecutionEnabled=false`、`runtimeExecutionEnabled=false`。
- [x] plan 投影 `evidenceSchema / plannedEvidenceKeys / policyPath`，让下一刀可按 evidence plan 执行受控 GET 门禁。

## 第九刀实现

- [x] 新增 `capability_draft_execute_controlled_get` 命令，只在同一份 session 输入合同通过后执行一次性 `GET`。
- [x] 命令复用 registered skill discovery 中的 pending approval artifact，并重新校验 `session_user_approval`、`runtime_endpoint_input`、`credential_reference_confirmation` 与 `evidence_capture_consent`；校验失败返回 `blocked`，不发送网络请求。
- [x] 正向结果返回 `executed`，并只输出 `requestUrlHash`、`responseStatus`、`responseSha256`、`responseBytes`、`responsePreview`、`responsePreviewTruncated`、`executedAt` 与 evidence；不回传 endpoint 明文。
- [x] 网络失败返回 `request_failed`，只保留 `requestUrlHash`、`executedAt` 与错误类别 evidence，不泄露 endpoint。
- [x] 命令固定 `endpointValueReturned=false`、`endpointInputPersisted=false`、`credentialResolved=false`、`tokenPersisted=false`、`runtimeExecutionEnabled=false`，不保存 endpoint/token、不解析 credential reference、不注入 runtime。
- [x] 前端 API 网关、DevBridge dispatcher、Rust command registration、治理目录册、浏览器 mock 与 mock priority 已同步。
- [x] 本刀不改 Workspace UI，不展示 token 输入、调度入口、默认运行入口或自动化入口。

## 第十刀实现

- [x] `capability_draft_execute_controlled_get` 正向和 `request_failed` 结果会写入非敏感 evidence artifact：`.lime/capability-drafts/controlled-get-evidence/<artifact>.json`。
- [x] artifact 只保存 `requestUrlHash`、method、response status、response sha256、response bytes、executedAt、credential reference id、布尔安全边界和 evidence metadata。
- [x] artifact 固定 `containsEndpointValue=false`、`containsTokenValue=false`、`containsResponsePreview=false`，不保存 endpoint 明文、token 明文或 response preview 正文。
- [x] 命令返回 `evidenceArtifact`，包含 artifact id、相对路径、绝对路径、content sha256 与安全布尔字段，供下一阶段接回 runtime artifact / evidence pack 主链。
- [x] session 输入校验失败的 `blocked` 结果不落 artifact，避免把未执行请求伪装成执行证据。

## 第十一刀实现

- [x] `agent_runtime_export_evidence_pack` 会扫描当前 workspace 的 `.lime/capability-drafts/controlled-get-evidence/*.json`，只收集 `sessionId` 等于当前 session 的受控 GET evidence artifact。
- [x] `runtime.json` 与 `artifacts.json` 新增 `capabilityDraftControlledGetEvidence` 摘要，包含 artifact id、相对路径、content sha256、approval id、status、method、requestUrlHash、response status、response sha256、response bytes、executedAt、credential reference id、safety flags 与 evidence keys。
- [x] `summary.md` 新增受控 GET evidence 计数，作为人工读取 evidence pack 的入口。
- [x] 摘要固定只输出 hash / status / response metadata / evidence keys，不复制 endpoint 明文、token 明文或 response preview 正文；若 artifact safety flags 不是安全值，会跳过并计入 `skippedUnsafeArtifactCount`。
- [x] 本刀只接 evidence pack 可消费摘要，不把该 artifact 计入 completion audit 的 completed 判定，不注入 Query Loop / runtime，不进入 scheduler/default tool surface。

## 验证计划

本轮最低验证：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs" "src-tauri/src/commands/capability_draft_cmd.rs" "src-tauri/src/dev_bridge/dispatcher/capability_drafts.rs"
npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"
npx eslint "src/lib/api/capabilityDrafts.ts" "src/lib/api/capabilityDrafts.test.ts" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.tsx" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" --max-warnings 0
CARGO_INCREMENTAL=0 cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
npx vitest run "src/lib/layered-design/cleanPlate.test.ts"
npm run typecheck
npm run test:contracts
npm run verify:gui-smoke
git diff --check -- "src-tauri/src/services/capability_draft_service.rs" "src-tauri/src/commands/capability_draft_cmd.rs" "src-tauri/src/dev_bridge/dispatcher/capability_drafts.rs" "src-tauri/src/app/runner.rs" "src/lib/governance/agentCommandCatalog.json" "src/lib/dev-bridge/mockPriorityCommands.ts" "src/lib/api/capabilityDrafts.ts" "src/lib/api/capabilityDrafts.test.ts" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.tsx" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/layered-design/cleanPlate.test.ts" "docs/exec-plans/skill-forge-readonly-http-api-p9-plan.md" "docs/roadmap/skill-forge/README.md" "docs/roadmap/skill-forge/implementation-plan.md"
```

结果：

1. P9 API / UI / mock 回归：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"` 通过，`40 passed`。
2. P9 定向 eslint 通过。
3. P9 Rust 定向测试：`CARGO_INCREMENTAL=0 cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`30 passed`。
4. `npm run test:contracts` 通过，未新增 Tauri 命令，既有 capability draft 命令契约未漂移。
5. `src/lib/layered-design/cleanPlate.test.ts` 的 typecheck 阻断已最小清障：将 `result.analysis.outputs.cleanPlate` 改为 optional access，不改变测试语义；定向回归通过，`3 passed`。
6. `npm run typecheck` 通过。
7. `npm run verify:gui-smoke` 初次在构建 headless Tauri 时被磁盘空间阻断；磁盘恢复到约 `62Gi` 后，已复用就绪 `DevBridge` 补跑剩余关键段：`smoke:agent-runtime-tool-surface-page`、`smoke:knowledge-gui`、`smoke:design-canvas` 均通过。前半段在同一轮 `verify:gui-smoke` 中已通过：workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface。
8. 本轮中断遗留的临时 smoke Tauri 进程已清理，仅清理由 `/var/folders/.../lime-gui-smoke-tauri-*.json` 启动的本轮 smoke 进程，不触碰其它 dev 进程。
9. 定向 `git diff --check` 通过；禁用旧名扫描通过，`forbidden_matches=0`。
10. P9 第二刀 API / UI / mock 回归再次通过：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"` 通过，`40 passed`，覆盖 `credentialResolver` normalizer、mock register / discovery 与 Workspace 展示。
11. P9 第二刀定向 eslint 通过；`npm run typecheck` 通过。
12. P9 第二刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`30 passed`。
13. P9 第二刀 `npm run test:contracts` 通过；未新增 Tauri 命令。
14. P9 第二刀 `npm run verify:gui-smoke` 完整通过，覆盖 workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface、runtime tool surface page、knowledge GUI 与 design canvas。
15. P9 第三刀 API / UI / mock 回归再次通过：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"` 通过，`40 passed`，覆盖 `consumptionInputSchema` normalizer、mock register / discovery 与 Workspace 展示。
16. P9 第三刀定向 eslint 通过；`npm run typecheck` 通过。
17. P9 第三刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`30 passed`。
18. P9 第三刀 `npm run test:contracts` 通过；未新增 Tauri 命令，只扩展既有 capability draft register / discovery 响应结构。
19. P9 第三刀 `npm run verify:gui-smoke` 完整通过，覆盖 workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface、runtime tool surface page、knowledge GUI 与 design canvas；收尾清理本轮 smoke Chrome profiles。
20. P9 第四刀 API / UI / mock 回归再次通过：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"` 通过，`40 passed`，覆盖 `sessionInputIntake` normalizer、mock register / discovery 与 Workspace 展示。
21. P9 第四刀定向 eslint 通过；`npm run typecheck` 通过。
22. P9 第四刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`30 passed`。
23. P9 第四刀 `npm run test:contracts` 通过；未新增 Tauri 命令，只扩展既有 capability draft register / discovery 响应结构。
24. P9 第四刀 `npm run verify:gui-smoke` 完整通过，覆盖 workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface、runtime tool surface page、knowledge GUI 与 design canvas；收尾清理本轮 smoke Chrome profiles。
25. P9 第五刀 API / UI / mock 回归再次通过：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"` 通过，`40 passed`，覆盖 `sessionInputSubmissionContract` normalizer、mock register / discovery 与 Workspace 展示。
26. P9 第五刀定向 eslint 通过。
27. P9 第五刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`30 passed`。
28. P9 第五刀 `npm run typecheck` 通过。
29. P9 第五刀 `npm run test:contracts` 通过；未新增 Tauri 命令，只扩展既有 capability draft register / discovery 响应结构。
30. P9 第五刀 `npm run verify:gui-smoke` 完整通过，覆盖 workspace ready、browser runtime、site adapters、agent service skill entry、runtime tool surface、runtime tool surface page、knowledge GUI 与 design canvas；本轮因 DevBridge 未就绪重新拉起 headless Tauri 并编译临时 target，收尾已清理 smoke Chrome profiles 并停止本轮 headless Tauri 环境。
31. P9 第六刀定向 eslint 通过，覆盖前端 API、mock 与 Workspace registered skills 面板。
32. P9 第六刀 API / UI / mock 回归通过：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/lib/tauri-mock/core.test.ts"` 通过，`41 passed`，覆盖新增 session 输入提交校验命令的 API normalizer 与浏览器 mock。
33. P9 第六刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-capability-draft-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`32 passed`；因本地已有 headless Tauri 占用默认 artifact lock，本轮使用独立临时 target 目录完成定向验证。
34. P9 第七刀定向 eslint 通过，覆盖 `controlledGetPreflight` 前端 API 与浏览器 mock。
35. P9 第七刀 API / mock 回归通过：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/lib/tauri-mock/core.test.ts"` 通过，`34 passed`。
36. P9 第七刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-capability-draft-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`32 passed`。
37. P9 第八刀定向 eslint 通过，覆盖 `dryPreflightPlan` 前端 API 与浏览器 mock。
38. P9 第八刀 API / mock 回归通过：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/lib/tauri-mock/core.test.ts"` 通过，`34 passed`。
39. P9 第八刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-capability-draft-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`32 passed`。
40. P9 第九刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-capability-draft-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`34 passed`，覆盖一次性受控 GET 正向 evidence 与非法 session 输入阻断。
41. P9 第九刀 API / mock 回归通过：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/lib/tauri-mock/core.test.ts"` 通过，`35 passed`，覆盖 `capability_draft_execute_controlled_get` API normalizer 与浏览器 mock。
42. P9 第九刀定向 eslint 通过，覆盖前端 API 与浏览器 mock。
43. P9 第九刀 `npm run typecheck` 通过。
44. P9 第九刀 `npm run test:contracts` 通过，新增命令已同步前端 API、Rust 注册、DevBridge dispatcher、治理目录册、mock priority 与 default mock。
45. `npm run verify:local` 已尝试执行；因当前工作树 216 个改动触发全量 smart 批次，失败点落在既有 `src/lib/teamMemorySync.test.ts` 的 `crypto.subtle.digest` 环境缺失，和本刀受控 GET 命令无直接关系。本刀仍以定向 Rust / API / mock / eslint / typecheck / contracts 作为交付证明。
46. P9 第十刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-capability-draft-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features` 通过，`34 passed`，覆盖非敏感 evidence artifact 落盘、不保存 endpoint 明文、不保存 response preview。
47. P9 第十刀 API / mock 回归通过：`npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/lib/tauri-mock/core.test.ts"` 通过，`35 passed`，覆盖 `evidenceArtifact` normalizer 与浏览器 mock。
48. P9 第十刀定向 eslint 通过，覆盖前端 API 与浏览器 mock。
49. P9 第十刀收口 `npm run typecheck` 通过。
50. P9 第十刀收口 `npm run test:contracts` 通过，确认 capability draft 命令、DevBridge、治理目录册、mock priority 与 default mock 契约未漂移。
51. P9 第十刀收口定向 `git diff --check` 通过，覆盖 capability draft 命令、API、mock、命令治理文档与路线图文档。
52. P9 第十刀收口禁用旧名扫描通过：`if rg -n -i "c[r]eao" "docs/research" "docs/roadmap" "docs/exec-plans"; then exit 1; else echo "forbidden_matches=0"; fi` 输出 `forbidden_matches=0`。
53. P9 第十一刀 Rust 定向测试通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-runtime-evidence-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib evidence_pack_should_project_controlled_get_evidence_without_sensitive_values --no-default-features` 通过，覆盖当前 session artifact 过滤、`runtime.json` / `artifacts.json` / `summary.md` 摘要投影，以及 endpoint/token/response preview 不进入 evidence pack。
54. P9 第十一刀 runtime evidence pack 回归通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-runtime-evidence-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib runtime_evidence_pack --no-default-features` 通过，`28 passed`。
55. P9 第十一刀 `npm run test:contracts` 通过，确认 `agent_runtime_export_evidence_pack` 所在运行时证据导出主链与命令契约没有漂移。
56. P9 第十一刀定向 `git diff --check` 通过；禁用旧名扫描通过，`forbidden_matches=0`。

## 完成标准

1. 每条只读 HTTP pending approval request 都必须携带 `consumptionGate`。
2. `consumptionGate` 必须明确真实执行和凭证持久化仍关闭。
3. API normalizer / browser mock / Workspace UI 看到同一份 gate。
4. UI 不展示立即运行、自动化、真实联网或 token 保存入口。
5. 每条只读 HTTP pending approval request 都必须携带 `credentialResolver`，并明确 secret 未请求、token 未持久化、runtime 注入未启用。
6. 每条只读 HTTP pending approval request 都必须携带 `consumptionInputSchema`，并明确 UI 提交和 runtime 执行仍关闭。
7. 每条只读 HTTP pending approval request 都必须携带 `sessionInputIntake`，并明确 required / missing / collected 输入状态、endpoint 不持久化、secret 未收集、token 未持久化。
8. 每条只读 HTTP pending approval request 都必须携带 `sessionInputSubmissionContract`，并明确一次性输入可接受字段、校验规则、无值保留、submit handler 只做 session 输入校验。
9. `capability_draft_submit_approval_session_inputs` 校验通过只能返回 `validated_pending_runtime_gate`，不能持久化 endpoint、不能接收 secret、不能解析凭证、不能执行真实 HTTP。
10. `controlledGetPreflight` 只能投影执行前门禁状态和审计元数据，必须保持 `requestExecutionEnabled=false`、`runtimeExecutionEnabled=false`、`endpointValueReturned=false`。
11. `dryPreflightPlan` 只能保留 `requestUrlHash` 与 planned evidence keys，必须保持 `networkRequestSent=false`、`responseCaptured=false`、`credentialResolved=false`、`endpointValueReturned=false`。
12. `capability_draft_execute_controlled_get` 只能在 session 输入合同通过后执行一次性 `GET`，并返回当前命令 evidence；它不能回传 endpoint 明文、不能保存 endpoint/token、不能解析 credential reference、不能注入 runtime。
13. `capability_draft_execute_controlled_get` 的正向结果必须包含 `responseStatus`、`responseSha256`、`executedAt` 与 response preview；负向校验失败必须 `networkRequestSent=false`。
14. `capability_draft_execute_controlled_get` 的正向和 `request_failed` 结果必须返回 `evidenceArtifact`，并把非敏感执行证据写入 `.lime/capability-drafts/controlled-get-evidence/<artifact>.json`。
15. evidence artifact 只能保存 hash、status、response metadata 与 evidence metadata，必须固定 `containsEndpointValue=false`、`containsTokenValue=false`、`containsResponsePreview=false`，不能保存 endpoint 明文、token 明文或 response preview 正文。
16. `blocked` 结果不能落 evidence artifact，避免把未执行请求伪装成执行证据。
17. `agent_runtime_export_evidence_pack` 必须能按当前 session 读取 controlled GET evidence artifact，并在 `runtime.json` / `artifacts.json` / `summary.md` 中输出非敏感 `capabilityDraftControlledGetEvidence` 摘要。
18. evidence pack 摘要不能复制 endpoint 明文、token 明文或 response preview 正文，也不能把 controlled GET artifact 直接计入 completion audit completed 判定。
19. 后续若要继续消费该 artifact，必须继续走 session-scoped approval / credential resolver / 受控 GET evidence，再接回 runtime artifact / evidence pack，而不是直接接 scheduler/default tool surface。
