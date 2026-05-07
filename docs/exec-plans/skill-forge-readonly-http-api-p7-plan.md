# Skill Forge Read-Only HTTP API P7 执行计划

> 状态：P7 第一刀、第二刀、第三刀与第四刀已落地；Rust 定向测试、capability_draft 全套、模板 / mock / API / UI 回归、DevBridge smoke、typecheck 与 contracts 已通过
> 日期：2026-05-07
> 上游阶段：P6 只读 HTTP/API draft verification、fixture dry-run、structured evidence、authoring 模板与 mock 对齐已完成
> 当前目标：在不打开真实联网 runtime 的前提下，先把真实只读 API 执行前必须具备的 session authorization / policy 边界落进 verification gate。

## 主目标

P7 不直接发真实 HTTP 请求，不保存 token，不新增 API connector store，也不新增 runtime / scheduler。当前四刀只补更靠近真实执行的治理边界：

```text
Capability Draft sourceKind=api
  -> P6 fixture / expected-output / dry-run / no-credentials 全部保留
  -> 额外要求 policy/readonly-http-session.json 或等价 policy 文件
  -> policy 必须声明 session-required / read-only GET / evidence-audited
  -> policy 必须声明 credential_reference，指向用户 session 配置
  -> policy 必须声明 execution_preflight，生成真实请求前的 approval request 与 evidence schema
  -> verification report 必须把 execution_preflight 投影成结构化 evidence，供 API normalizer 与能力草案面板展示
  -> policy 只能说明未来真实执行如何授权和解析凭证引用，不能携带 API key / token
  -> verification 通过后仍只进入 verified_pending_registration
```

## 明确不做

1. 不发真实 HTTP 请求。
2. 不保存外部 API token。
3. 不新增 API connector store。
4. 不新增 adapter runtime、scheduler、queue 或 evidence 事实源。
5. 不把 fixture dry-run evidence 当作真实生产 API evidence。
6. 不允许 POST / PUT / PATCH / DELETE 或外部写操作自动执行。

## 第一刀实现

- [x] 在 `src-tauri/src/services/capability_draft_service.rs` 增加只读 HTTP session authorization policy gate。
- [x] authoring 模板默认生成 `policy/readonly-http-session.json`，声明 session 授权、只读 GET、凭证不落生成文件与 evidence 字段。
- [x] `scripts/readonly-http-api-smoke.mjs` 增加缺 session authorization policy 负向样例。
- [x] 浏览器 mock verification 对齐 `readonly_http_session_authorization` gate。
- [x] 更新路线图 / exec-plan 索引，明确 P7 第一刀不打开真实联网 runtime。

## 第二刀实现

- [x] 在 `src-tauri/src/services/capability_draft_service.rs` 增加 `readonly_http_credential_reference` gate，要求 policy 提供受控 `credential_reference`。
- [x] 扩展 no-credentials scan 到 `policy/` / `policies/`，避免 policy 文件携带 `Authorization`、`Bearer`、`api_key`、`access_token` 等真实凭证字段。
- [x] authoring 模板默认生成 `credential_reference.scope=session`、`source=user_session_config`、`required=false` 与稳定 `reference_id`。
- [x] `scripts/readonly-http-api-smoke.mjs` 增加缺 `credential_reference` 负向样例。
- [x] 浏览器 mock verification 与 mock 回归对齐 `readonly_http_credential_reference` gate。

## 第三刀实现

- [x] 在 `src-tauri/src/services/capability_draft_service.rs` 增加 `readonly_http_execution_preflight` gate，要求 policy 声明执行前检查计划。
- [x] authoring 模板默认生成 `execution_preflight.mode=approval_request`、`endpoint_source=runtime_input`、`method=GET`、`credential_reference_id` 与 `evidence_schema`。
- [x] `scripts/readonly-http-api-smoke.mjs` 增加缺 `execution_preflight` 负向样例。
- [x] 浏览器 mock verification 与 mock 回归对齐 `readonly_http_execution_preflight` gate。

## 第四刀实现

- [x] `readonly_http_execution_preflight` 正向 check 输出结构化 evidence：`preflightMode`、`endpointSource`、`method`、`credentialReferenceId`、`evidenceSchema` 与 `policyPath`。
- [x] 浏览器 mock verification 输出同一组 preflight evidence，避免无后端 GUI 预览缺审计字段。
- [x] `src/lib/api/capabilityDrafts.ts` 既有 normalizer 保留 preflight evidence，并补 API 回归覆盖 `credentialReferenceId` / `evidenceSchema`。
- [x] 能力草案面板展示 `只读 HTTP 执行 preflight` 证据块，补 `CapabilityDraftPanel.test.tsx` 稳定断言。
- [x] `scripts/readonly-http-api-smoke.mjs` 正向 smoke 断言 preflight evidence keys，避免 gate 只返回 passed 而没有 approval request evidence。

## 验证计划

本轮最低验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/lib/readonly-http-api-draft-template.mjs"
node --check "scripts/readonly-http-api-smoke.mjs"
npx vitest run "scripts/lib/readonly-http-api-draft-template.test.ts"
npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx" "scripts/lib/readonly-http-api-draft-template.test.ts" "src/lib/tauri-mock/core.test.ts"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p7-readonly-http-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p7-readonly-http-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
npm run typecheck
npm run test:contracts
npx eslint "scripts/lib/readonly-http-api-draft-template.mjs" "scripts/lib/readonly-http-api-draft-template.test.ts" "scripts/readonly-http-api-smoke.mjs" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" "src/lib/api/capabilityDrafts.ts" "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/CapabilityDraftPanel.tsx" "src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx" --max-warnings 0
git diff --check
```

结果：

1. `readonly_http` Rust 定向测试：`13 passed`。
2. `capability_draft` Rust 全套：`29 passed`。
3. authoring 模板回归：`3 passed`。
4. 浏览器 mock 回归：`26 passed`，并覆盖 preflight evidence。
5. API normalizer 与能力草案面板回归通过，能力草案面板可展示 preflight evidence。
6. DevBridge smoke：`status=passed`，新增 `positivePreflightEvidenceKeys`，并保留 `missingSessionAuthorizationFailedCheck=readonly_http_session_authorization`、`missingCredentialReferenceFailedCheck=readonly_http_credential_reference` 与 `missingExecutionPreflightFailedCheck=readonly_http_execution_preflight`。
7. `npm run typecheck`、`npm run test:contracts`、定向 eslint 与 `git diff --check` 通过。
8. 禁用旧名扫描结果：`forbidden_matches=0`。

本轮只改能力草案面板内的 verification evidence 展示，已补稳定组件回归；未改 GUI 壳、Workspace 主路径或 DevBridge 启动链，因此不把 `npm run verify:gui-smoke` 列为第四刀最低门槛。

## 完成标准

1. P7 正向只读 HTTP/API 草案仍能通过 verification，且 `readonly_http_fixture_dry_run_execute` evidence 保持完整。
2. 缺少 session authorization policy 的只读 HTTP/API 草案必须失败，并命中 `readonly_http_session_authorization`。
3. 缺少受控 `credential_reference` 的只读 HTTP/API 草案必须失败，并命中 `readonly_http_credential_reference`。
4. 缺少 `execution_preflight` 的只读 HTTP/API 草案必须失败，并命中 `readonly_http_execution_preflight`。
5. 正向 `readonly_http_execution_preflight` 必须携带 approval request evidence，至少包含 preflight mode、endpoint source、GET、credential reference 与 evidence schema。
6. policy 文件不得绕过 no-credentials gate；凭证仍不能写入 generated files。
7. mock、template、smoke、API normalizer、能力草案面板与 Rust verification gate 对齐。
8. verification 通过后仍只代表 pending registration，不代表真实 HTTP 已可运行。
