# Skill Forge Read-Only HTTP API P6 完成审计

> 日期：2026-05-07
> 状态：P6 第一刀完成审计通过
> 范围：只读 HTTP/API capability draft 的 verification gate、fixture dry-run、structured evidence、authoring 模板与浏览器 mock 对齐；不新增真实 HTTP 执行、token store、connector store、runtime、scheduler、queue 或 evidence 事实源。

## 审计目标

确认 P6 第一刀已经把“只读 HTTP/API adapter”推进到可重复验证的 draft 阶段：

```text
sourceKind=api capability draft
  -> 显式网络只读权限声明
  -> fixture input / tests fixture / expected output
  -> 离线 fixture dry-run 入口
  -> dry-run expected-output binding
  -> verification 内离线执行并比较 actual / expected
  -> structured evidence
  -> 能力草案面板展示本次 verification 证据
  -> verified_pending_registration
```

本审计只判定 P6 第一刀的 draft / verification / evidence 边界，不把它升级为真实联网 adapter runtime。

## 审计结论

P6 第一刀可以判定为 **完成**：

1. 只读 HTTP/API 草案必须声明网络只读权限，未声明时不能通过 verification。
2. 草案必须携带 fixture input、`tests/fixture.json`、`tests/expected-output.json` 与可重复 dry-run 入口。
3. dry-run 入口必须绑定 expected output、保持离线，并在 verification 中执行出与 expected output 一致的 JSON。
4. dry-run execute check 会输出 `scriptPath`、`expectedOutputPath`、`durationMs`、`exitStatus`、`actualSha256`、`expectedSha256` 与 `stdoutPreview` evidence。
5. 前端 API normalizer、能力草案面板和浏览器 mock 都已消费同一组 evidence / gate，不再出现无后端预览假通过。
6. authoring 模板默认生成 P6 合规草案文件，并保留负向样例开关，避免 smoke 与真实样例分叉。
7. P6 仍不发真实 HTTP 请求、不保存凭证、不注册、不进入 runtime、不新增长期调度。

## 完成证据

| 要求 | 事实源 | 判定 |
| --- | --- | --- |
| 网络只读权限声明 | `src-tauri/src/services/capability_draft_service.rs`、`readonly_http` Rust 定向测试、DevBridge smoke | 完成 |
| fixture input gate | `contract/input.schema.json` / `examples/input.sample.json` 的 `fixture_path` 识别、缺失负向 smoke | 完成 |
| fixture / expected output gate | `tests/fixture.json`、`tests/expected-output.json` 存在性校验、缺失负向 smoke | 完成 |
| fixture dry-run 入口 gate | `scripts/dry-run.mjs` / `tests/*.test.*` / `package.json` dry-run 入口识别、缺失负向 smoke | 完成 |
| expected-output binding gate | dry-run 入口必须引用 expected output，未绑定负向样例命中 `readonly_http_fixture_dry_run_expected_output` | 完成 |
| offline / no-credentials gate | dry-run 入口真实联网、生成文件含凭证字段均失败 | 完成 |
| execute / compare gate | verification 内离线执行 `node scripts/dry-run.mjs`，actual / expected 不一致命中 `readonly_http_fixture_dry_run_execute` | 完成 |
| structured evidence | `readonly_http_fixture_dry_run_execute` 正向 check 输出脚本、期望输出、耗时、Hash 与 stdout preview | 完成 |
| 前端 evidence 消费 | `src/lib/api/capabilityDrafts.ts`、`src/features/capability-drafts/components/CapabilityDraftPanel.tsx`、对应回归 | 完成 |
| authoring 模板 | `scripts/lib/readonly-http-api-draft-template.mjs`、`scripts/lib/readonly-http-api-draft-template.test.ts`、`scripts/readonly-http-api-smoke.mjs` | 完成 |
| 浏览器 mock 对齐 | `src/lib/tauri-mock/core.ts`、`src/lib/tauri-mock/core.test.ts` | 完成 |
| 命令边界 | 未新增 Tauri 命令；既有 command catalog / mock / contracts 已通过 `npm run test:contracts` | 完成 |

## 已执行验证

关键验证记录已落在 [P6 执行计划](./skill-forge-readonly-http-api-p6-plan.md)。本审计采用最近通过的完整证据集：

```bash
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-execute-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib readonly_http --no-default-features
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="/tmp/lime-p6-execute-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib capability_draft --no-default-features
node "scripts/readonly-http-api-smoke.mjs" --timeout-ms 10000 --cleanup --json
npx vitest run "src/lib/api/capabilityDrafts.test.ts" "src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx" "src/features/capability-drafts/domain/capabilityDraftPresentation.test.ts"
npx vitest run "scripts/lib/readonly-http-api-draft-template.test.ts"
npx vitest run "src/lib/tauri-mock/core.test.ts"
npm run typecheck
npm run test:contracts
git diff --check
```

结果摘要：

1. `readonly_http`：`10 passed`。
2. `capability_draft`：`26 passed`。
3. DevBridge smoke：`status=passed`，正向草案进入 `verified_pending_registration`，负向草案覆盖缺权限、缺 fixture input、缺 fixture、缺 expected output、缺 dry-run、未绑定 expected output、actual / expected mismatch、dry-run 真实联网与含凭证字段。
4. 前端 API / UI / presentation 回归：`15 passed`。
5. authoring 模板回归：`3 passed`。
6. 浏览器 mock 回归：`26 passed`。
7. `npm run typecheck`、`npm run test:contracts`、`git diff --check` 均通过。
8. 禁用旧名扫描结果：`forbidden_matches=0`。

## 边界确认

以下仍保持未做，且是 P6 第一刀的正确边界：

1. 未发真实 HTTP 请求。
2. 未保存外部 API token。
3. 未新增 API connector store。
4. 未新增 adapter runtime、scheduler、queue 或 evidence 事实源。
5. 未允许外部写操作进入自动执行。
6. 未把 `verified_pending_registration` 当作默认可运行。
7. 未把 fixture dry-run 证据当作真实生产 API 执行证据。

## 收口判定

P6 第一刀已经完成。后续如果继续推进真实 API adapter，应作为新阶段处理：

1. P7：真实只读 API 执行授权，先补用户配置、session 授权、policy gate 与 evidence 记录。
2. P7：API token 只能进入受控凭证层，不能写入 generated files 或 fixture。
3. P7：真实联网执行必须与 fixture dry-run 双轨保留，发布前仍能离线复验。
4. P7：外部写操作继续默认失败，只能通过人工确认或策略批准逐级开放。
