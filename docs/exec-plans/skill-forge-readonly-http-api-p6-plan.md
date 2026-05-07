# Skill Forge Read-Only HTTP API P6 执行计划

> 状态：P6 第一刀、fixture input / fixture / expected-output / fixture dry-run / dry-run expected-output binding / dry-run execute / structured evidence / dry-run offline / no-credentials gate 已落地；Rust 定向测试、capability_draft 全套与 DevBridge smoke 已通过；完成审计见 [P6 audit](./skill-forge-readonly-http-api-p6-audit.md)
> 日期：2026-05-07
> 上游阶段：P5 Prompt-to-Artifact demo / smoke / evidence 闭环已完成
> 当前目标：在不扩 runtime 的前提下，把只读 CLI 样例之后的下一类能力推进到“只读 HTTP API adapter”权限 gate。

## 主目标

P6 不做真实外部联网执行，也不新增 adapter runtime。第一刀只补 verification gate 的最小治理能力：

```text
Capability Draft sourceKind=api
  -> generated files 声明 GET / read-only API
  -> permissionSummary 必须显式声明 HTTP / API / 网络只读权限
  -> input contract / sample 必须显式暴露 fixture 输入
  -> tests/ fixture 必须存在，用于后续可重复 dry-run
  -> tests/ expected output 必须存在，用于后续 dry-run 结果比对
  -> scripts/dry-run.* / tests/*.test.* / package.json dry-run 必须提供 fixture dry-run 入口
  -> fixture dry-run 入口必须引用 expected output，确保 dry-run 有可判定标准
  -> fixture dry-run 入口必须在 verification 中离线执行，并产出与 expected output 一致的 JSON
  -> dry-run execute check 必须输出 scriptPath / expectedOutputPath / durationMs / hashes / stdoutPreview evidence
  -> fixture dry-run 入口不得包含 fetch / axios.get / http URL 等真实联网痕迹
  -> generated files 不得包含 Authorization / Bearer / x-api-key / access_token 等凭证字段
  -> static risk scan 允许 read-only GET
  -> POST / PUT / PATCH / DELETE 仍保持失败
  -> verification 通过后仍只进入 verified_pending_registration
```

## 明确不做

1. 不发真实 HTTP 请求。
2. 不保存外部 API token。
3. 不新增 API connector store。
4. 不新增 runtime、scheduler、queue 或 evidence 事实源。
5. 不允许未声明网络只读权限的 API 草案通过 verification。
6. 不允许外部写操作进入自动执行。

## 本轮实现

- [x] 在 `src-tauri/src/services/capability_draft_service.rs` 增加只读 HTTP / API 权限声明识别。
- [x] static risk scan 在检测到 `fetch(`、`axios.get`、`method: GET`、`http://`、`https://` 等只读网络访问痕迹时，要求 `permissionSummary` 显式声明 HTTP / API / 网络只读权限。
- [x] 保持已有外部写 token 拦截：`POST / PUT / PATCH / DELETE`、高风险业务动作和任意 shell 仍失败。
- [x] 新增正向 Rust 测试：声明只读 HTTP API 权限的草案可以通过 verification。
- [x] 新增负向 Rust 测试：未声明网络只读权限的 HTTP API 草案不能通过 verification。
- [x] 新增 `scripts/readonly-http-api-smoke.mjs`：通过 DevBridge 在临时 workspace 验证正向 / 负向 draft，不发真实 HTTP 请求、不注册、不进入 runtime。
- [x] 增加只读 HTTP fixture gate：HTTP / API 草案必须携带 `tests/` fixture，不能只靠示例输入或真实 URL 进入 pending registration。
- [x] 扩展 smoke：除权限缺失负向样例外，再验证“声明了网络只读权限但缺 fixture”的草案会命中 `readonly_http_fixture` 并失败。
- [x] 增加只读 HTTP expected-output gate：HTTP / API 草案必须携带 `tests/expected-output.*` 或等价输出 fixture，避免只有输入、没有可判定 dry-run 结果。
- [x] 扩展 smoke 脚本：新增“声明了网络只读权限、有 fixture、但缺 expected output”的负向样例，预期命中 `readonly_http_expected_output`。
- [x] 增加只读 HTTP fixture input gate：输入 contract 或 sample 必须暴露 `fixture_path` / fixture 字段，避免运行入口只能填写真实 endpoint。
- [x] 扩展 smoke 脚本：新增“声明了网络只读权限、有 fixture / expected output、但输入 contract 缺 fixture 字段”的负向样例，预期命中 `readonly_http_fixture_input`。
- [x] 增加只读 HTTP fixture dry-run 入口 gate：HTTP / API 草案必须提供 `scripts/dry-run.*`、`tests/*.test.*` 或 `package.json` dry-run 脚本，避免只有 fixture 文件、没有可重复执行的本地校验路径。
- [x] 扩展 smoke 脚本：新增“声明了网络只读权限、有 fixture / expected output / fixture 输入、但缺 fixture dry-run 入口”的负向样例，预期命中 `readonly_http_fixture_dry_run`。
- [x] 增加只读 HTTP fixture dry-run expected-output binding gate：fixture dry-run 入口必须显式引用 `tests/expected-output.*` 或等价 expected output，避免 dry-run 只能输出、不能判定。
- [x] 扩展 smoke 脚本：新增“声明了网络只读权限、有 fixture / expected output / fixture 输入 / dry-run 入口、但入口未绑定 expected output”的负向样例，预期命中 `readonly_http_fixture_dry_run_expected_output`。
- [x] 增加只读 HTTP fixture dry-run execute gate：在所有前置 gate 通过后，用 `node scripts/dry-run.mjs` 在 draft root 内离线执行 dry-run，并比较 stdout JSON 与 `tests/expected-output.json`。
- [x] 扩展 smoke 脚本：新增“声明了网络只读权限、有 fixture / expected output / fixture 输入 / dry-run 入口、但 actual 与 expected 不一致”的负向样例，预期命中 `readonly_http_fixture_dry_run_execute`。
- [x] 增加只读 HTTP fixture dry-run structured evidence：`readonly_http_fixture_dry_run_execute` 正向 check 会输出 `scriptPath`、`expectedOutputPath`、`durationMs`、`exitStatus`、`actualSha256`、`expectedSha256` 与 `stdoutPreview`，供后续 review / evidence 展示消费。
- [x] 扩展前端 API normalizer 与 smoke：verification check 支持 `evidence[]` 归一化；正向 DevBridge smoke 会断言 dry-run execute evidence key 齐全。
- [x] 接入能力草案面板 evidence 审计入口：本次 verification report 带有 evidence 的 check 会在草案卡片内展示脚本、期望输出、耗时、Hash 与 stdout preview，不新增查询命令或 runtime。
- [x] 抽出只读 HTTP/API authoring 模板：`scripts/lib/readonly-http-api-draft-template.mjs` 默认生成 `fixture_path`、`tests/fixture.json`、`tests/expected-output.json`、`scripts/dry-run.mjs` 与只读权限边界；`readonly-http-api-smoke` 复用该模板，避免 smoke 与 authoring 样例分叉。
- [x] 对齐浏览器 mock verification：`capability_draft_verify` 的 mock 路径同样识别只读 HTTP/API 权限、fixture input、fixture、expected output、dry-run、offline、no-credentials 与 execute evidence，避免无后端 GUI 预览出现假通过。
- [x] 增加只读 HTTP fixture dry-run offline gate：fixture dry-run 入口不得包含 `fetch(`、`axios.get`、`http://`、`https://` 等真实联网痕迹，确保 P6 dry-run 只读本地 fixture。
- [x] 扩展 smoke 脚本：新增“声明了网络只读权限、有 fixture dry-run 入口、但入口尝试真实联网”的负向样例，预期命中 `readonly_http_fixture_dry_run_offline`。
- [x] 增加只读 HTTP no-credentials gate：HTTP / API 草案的生成文件不得包含 `Authorization`、`Bearer`、`x-api-key`、`api_key`、`access_token`、`client_secret` 或 `secret_key` 等凭证字段。
- [x] 扩展 smoke 脚本：新增“声明了网络只读权限、有 fixture / expected output / fixture 输入、但含凭证字段”的负向样例，预期命中 `readonly_http_no_credentials`。

## 验证记录

### 2026-05-06

已通过：

```bash
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-capability-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
```

结果：`3 passed`。

已通过 P6 DevBridge smoke：

```bash
node --check "scripts/readonly-http-api-smoke.mjs"
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 30000 --cleanup --json
```

结果摘要：

```json
{
  "status": "passed",
  "positiveVerificationStatus": "verified_pending_registration",
  "negativeVerificationStatus": "verification_failed",
  "negativeFailedCheck": "static_risk_scan",
  "missingFixtureVerificationStatus": "verification_failed",
  "missingFixtureFailedCheck": "readonly_http_fixture",
  "cleanup": true
}
```

本 smoke 只证明 capability draft verification gate 行为：正向只读 HTTP API 草案进入 `verified_pending_registration`，未声明网络只读权限的草案命中 `static_risk_scan` 并失败，缺少 `tests/` fixture 的草案命中 `readonly_http_fixture` 并失败。它不证明真实 HTTP 执行、runtime 注入、注册、调度或长期授权。

已通过更宽的 capability draft suite：

```bash
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-capability-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
```

结果：`19 passed`。

### 2026-05-07

P6 fixture gate 补充验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/readonly-http-api-smoke.mjs"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-capability-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-capability-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
git diff --check -- "src-tauri/src/services/capability_draft_service.rs" "scripts/readonly-http-api-smoke.mjs" "docs/exec-plans/skill-forge-readonly-http-api-p6-plan.md" "docs/exec-plans/README.md" "docs/roadmap/skill-forge/README.md" "docs/roadmap/skill-forge/implementation-plan.md"
npm run test:contracts
```

结果：`readonly_http` 3 passed；`capability_draft` 19 passed；smoke 返回 `missingFixtureVerificationStatus=verification_failed` 与 `missingFixtureFailedCheck=readonly_http_fixture`；diff check 与 contracts 通过。

P6 expected-output gate 补充验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/readonly-http-api-smoke.mjs"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-expected-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-expected-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
```

结果：`readonly_http` 4 passed；`capability_draft` 20 passed。

DevBridge smoke 已在重启新版 headless 后复跑通过：

```bash
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
```

结果：新增 `missingExpectedOutputVerificationStatus=verification_failed` 与 `missingExpectedOutputFailedCheck=readonly_http_expected_output`，证明缺 expected output 的只读 HTTP/API 草案不会进入 pending registration。

P6 fixture input gate 补充验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/readonly-http-api-smoke.mjs"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-fixture-input-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-fixture-input-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
```

结果：`readonly_http` 5 passed；`capability_draft` 21 passed；smoke 返回 `missingFixtureInputVerificationStatus=verification_failed` 与 `missingFixtureInputFailedCheck=readonly_http_fixture_input`。

P6 no-credentials gate 补充验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/readonly-http-api-smoke.mjs"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-no-credentials-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-no-credentials-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
```

结果：`readonly_http` 6 passed；`capability_draft` 22 passed；smoke 返回 `credentialVerificationStatus=verification_failed` 与 `credentialFailedCheck=readonly_http_no_credentials`。

P6 fixture dry-run 入口 gate 补充验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/readonly-http-api-smoke.mjs"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-dry-run-entry-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-dry-run-entry-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
```

结果：`readonly_http` 7 passed；`capability_draft` 23 passed；smoke 返回 `missingDryRunEntryVerificationStatus=verification_failed` 与 `missingDryRunEntryFailedCheck=readonly_http_fixture_dry_run`。

P6 fixture dry-run offline gate 补充验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/readonly-http-api-smoke.mjs"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-no-credentials-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-no-credentials-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
```

结果：`readonly_http` 8 passed；`capability_draft` 24 passed；smoke 返回 `networkedDryRunVerificationStatus=verification_failed` 与 `networkedDryRunFailedCheck=readonly_http_fixture_dry_run_offline`。

P6 fixture dry-run expected-output binding gate 补充验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/readonly-http-api-smoke.mjs"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-binding-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-binding-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
git diff --check -- "src-tauri/src/services/capability_draft_service.rs" "scripts/readonly-http-api-smoke.mjs" "docs/exec-plans/skill-forge-readonly-http-api-p6-plan.md" "docs/roadmap/skill-forge/README.md" "docs/roadmap/skill-forge/implementation-plan.md"
```

结果：`readonly_http` 9 passed；`capability_draft` 25 passed；smoke 返回 `missingDryRunExpectedOutputBindingVerificationStatus=verification_failed` 与 `missingDryRunExpectedOutputBindingFailedCheck=readonly_http_fixture_dry_run_expected_output`，证明 fixture dry-run 入口未绑定 expected output 的只读 HTTP/API 草案不会进入 pending registration。

P6 fixture dry-run execute gate 补充验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/readonly-http-api-smoke.mjs"
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-execute-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-execute-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
git diff --check -- "src-tauri/src/services/capability_draft_service.rs" "scripts/readonly-http-api-smoke.mjs" "docs/exec-plans/skill-forge-readonly-http-api-p6-plan.md" "docs/roadmap/skill-forge/README.md" "docs/roadmap/skill-forge/implementation-plan.md"
npm run test:contracts
```

结果：`readonly_http` 10 passed；`capability_draft` 26 passed；DevBridge smoke、diff check 与 contracts 通过；smoke 返回 `mismatchedDryRunVerificationStatus=verification_failed` 与 `mismatchedDryRunFailedCheck=readonly_http_fixture_dry_run_execute`。新增 `readonly_http_fixture_dry_run_execute` 后，正向草案会在 verification 内离线执行 `scripts/dry-run.mjs` 并比较 `tests/expected-output.json`；actual / expected 不一致时命中该 gate 并阻断 pending registration。该执行仍只发生在 fixture / expected / binding / offline / no-credentials 等前置 gate 全部通过后，不发真实 HTTP 请求、不注册、不进入 runtime。

P6 fixture dry-run structured evidence 补充验证已通过：

```bash
rustfmt --edition 2021 "src-tauri/src/services/capability_draft_service.rs"
node --check "scripts/readonly-http-api-smoke.mjs"
npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx" "src/features/capability-drafts/domain/capabilityDraftPresentation.test.ts"
npm run typecheck
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-execute-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-execute-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
npm run test:contracts
```

结果：前端 3 个定向测试文件 `15 passed`；`npm run typecheck` 通过；`readonly_http` 10 passed；`capability_draft` 26 passed；contracts 通过；DevBridge smoke 返回 `positiveDryRunExecuteEvidenceKeys=["scriptPath","expectedOutputPath","durationMs","exitStatus","actualSha256","expectedSha256","stdoutPreview"]`。这证明 `readonly_http_fixture_dry_run_execute` 不再只靠 message 文案表达结果，verification report 已携带后续 review / evidence 展示可消费的结构化 evidence。

P6 fixture dry-run evidence UI 消费补充验证已通过：

```bash
npx vitest run "src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx"
npm run typecheck
```

结果：`CapabilityDraftPanel.test.tsx` 4 passed；`npm run typecheck` 通过。该回归证明运行验证后，草案卡片会从本次 verification report 展示 `验证证据`、`只读 HTTP fixture dry-run 执行`、脚本路径、expected output、耗时与 Hash 摘要；这只是消费已返回的 evidence，不新增命令、不触发真实 HTTP、不注册、不进入 runtime。

P6 只读 HTTP/API authoring 模板补充验证已通过：

```bash
node --check "scripts/lib/readonly-http-api-draft-template.mjs"
node --check "scripts/readonly-http-api-smoke.mjs"
npx vitest run "scripts/lib/readonly-http-api-draft-template.test.ts"
```

结果：模板脚本与 smoke 语法检查通过；模板测试 `3 passed`。该回归证明默认 authoring 样例会生成 P6 verification 可接受的 fixture input、fixture、expected output 与离线 dry-run；负向开关仍能构造缺 fixture input、缺 expected output、缺 dry-run、未绑定 expected output、真实联网 dry-run、actual/expected mismatch 与凭证字段等失败样例。

P6 浏览器 mock verification 对齐补充验证已通过：

```bash
npx vitest run "src/lib/tauri-mock/core.test.ts"
npm run typecheck
npx eslint "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" --max-warnings 0
```

结果：`core.test.ts` 26 passed；`npm run typecheck` 与 eslint 通过。该回归证明 mock 模式下完整只读 HTTP/API 草案会进入 `verified_pending_registration`，`readonly_http_fixture_dry_run_execute` 会返回 `scriptPath` 与 `expectedOutputPath` evidence；缺网络只读权限的 API 草案会命中 `static_risk_scan` 并失败。

补充卫生检查：

```bash
node --check "scripts/readonly-http-api-smoke.mjs"
git diff --check -- "src-tauri/src/services/capability_draft_service.rs" "src/lib/api/capabilityDrafts.ts" "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/CapabilityDraftPanel.tsx" "src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx" "src/features/capability-drafts/domain/capabilityDraftPresentation.test.ts" "scripts/lib/readonly-http-api-draft-template.mjs" "scripts/lib/readonly-http-api-draft-template.test.ts" "scripts/readonly-http-api-smoke.mjs" "src/lib/tauri-mock/core.ts" "src/lib/tauri-mock/core.test.ts" "docs/exec-plans/skill-forge-readonly-http-api-p6-plan.md" "docs/roadmap/skill-forge/README.md" "docs/roadmap/skill-forge/implementation-plan.md"
```

结果：通过。

命名扫描结果：`forbidden_matches=0`。

## 下一步

1. 若后续要真实联网，只能先补 fixture dry-run、用户配置、session 授权和 evidence 记录，不能直接在 P6 打开网络执行。
2. 外部写操作仍必须保持默认失败；后续只能通过人工确认或 policy gate 单独开放。
3. P6 后续如果继续做 API adapter authoring，只能扩展 draft / verification / dry-run，不直接新增 runtime 或 scheduler。
