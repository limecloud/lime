# CreoAI Capability Verification P1B 执行计划

> 状态：P1B 完成，已通过 GUI smoke  
> 创建时间：2026-05-05  
> 前置计划：`docs/exec-plans/creaoai-capability-authoring-p1a-plan.md`  
> 路线图来源：`docs/roadmap/creaoai/implementation-plan.md`、`docs/roadmap/creaoai/coding-agent-layer.md`、`docs/roadmap/creaoai/architecture-review.md`  
> 当前目标：在 P1A `Capability Draft` 事实源上补最小 verification gate，让草案可以被结构化检查并进入 `verification_failed` 或 `verified_pending_registration`，但仍不注册、不运行、不接自动化。

## 主目标

把 P1A 的“未验证草案可见”推进到“草案可以被门禁检查”：

```text
workspace-local capability draft
  -> static verification gate
  -> verification report
  -> manifest status update
  -> Skills 工作台 review surface
  -> 后续 P3 registration
```

固定宗旨：

**不是永远限制能力；是永远限制未经验证、未经授权、不可审计的执行。**

## 本轮范围

本轮做：

1. 后端最小 verification gate。
   - 新增 `capability_draft_verify` 命令。
   - 只做结构、contract、权限声明、危险 token 静态扫描和 fixture 存在性检查。
   - 输出 `verification/latest.json` 报告，并同步 manifest 状态。
2. 前端 API / domain / UI 接入。
   - `capabilityDraftsApi.verify(...)` 统一封装命令。
   - UI 暴露“运行验证”按钮，但不暴露“运行草案 / 注册方法 / 自动化”。
   - 展示最近验证摘要与失败建议。
3. 命令治理与 mock 同步。
   - Rust 注册、DevBridge、`agentCommandCatalog`、`mockPriorityCommands`、`defaultMocks` 保持一致。
4. 定向验证。

本轮不做：

1. 不执行用户生成脚本。
2. 不开放 shell、安装依赖、联网 dry-run 或外部写操作。
3. 不注册 workspace-local skill。
4. 不把 `verified_pending_registration` 草案放进 tool surface。
5. 不新增 evidence pack 主链，只保留可后续消费的 verification report 文件。

## 最小检查矩阵

| 检查                     | 目标                                                                  | 失败后状态            |
| ------------------------ | --------------------------------------------------------------------- | --------------------- |
| `package_structure`      | `SKILL.md` 存在，manifest 文件清单与磁盘一致                          | `verification_failed` |
| `skill_readme_quality`   | `SKILL.md` 内容不是空壳，包含可读任务说明                             | `verification_failed` |
| `input_contract`         | 存在 `contract/input.schema.json` 或等价输入 schema                   | `verification_failed` |
| `output_contract`        | 存在 `contract/output.schema.json` 或等价输出 schema                  | `verification_failed` |
| `permission_declaration` | 权限摘要非空，并能解释只读 / 草案内写入边界                           | `verification_failed` |
| `static_risk_scan`       | 未出现删除、发布、付款、依赖安装、任意 shell、HTTP 写操作等危险 token | `verification_failed` |
| `fixture_presence`       | 至少存在 `tests/` 或 `examples/` 作为后续 dry-run 输入                | `verification_failed` |

通过后状态只到：

```text
verified_pending_registration
```

它表示“可以进入 P3 注册设计”，不表示现在已经能运行。

## 实施步骤

### P1B-0：计划与边界

- [x] 新增本执行计划。
- [x] 确认 P1B 只做静态 gate，不做注册和执行。

### P1B-1：后端 verification service

- [x] 扩展 draft 状态：`verification_failed / verified_pending_registration`。
- [x] 新增 verification report 类型、summary、check item。
- [x] 新增 `verify_capability_draft(...)` 服务函数。
- [x] 写入 `verification/latest.json` 并更新 manifest。
- [x] 补 Rust 单测：通过、缺 contract 失败、危险 token 失败。

### P1B-2：命令边界

- [x] 新增 Tauri command `capability_draft_verify`。
- [x] 同步 `runner.rs`、DevBridge dispatcher。
- [x] 同步 `agentCommandCatalog`、`mockPriorityCommands`、`defaultMocks`。
- [x] 运行 `npm run test:contracts`。

### P1B-3：前端 API / UI

- [x] 扩展 `capabilityDraftsApi.verify(...)` 与 normalization。
- [x] 扩展 domain helper：状态文案、能否验证、验证摘要。
- [x] 在 `CapabilityDraftPanel` 展示验证按钮与最近结果。
- [x] 补 API、domain、UI 回归测试。

### P1B-4：试跑与验收

- [x] 用 DevBridge 创建一个完整 draft 并验证通过。
- [x] 用 DevBridge 创建一个危险 draft 并验证失败。
- [x] 运行前后端定向测试。
- [x] 根据改动风险补 `npm run verify:gui-smoke` 或记录原因。

## 验收标准

1. 完整草案能进入 `verified_pending_registration`。
2. 缺 input/output contract 的草案会进入 `verification_failed`。
3. 出现危险 token 的草案会进入 `verification_failed`，并给出可修复建议。
4. UI 能触发 verification gate 并刷新状态。
5. 即使验证通过，也没有运行、注册或自动化入口。
6. 命令契约、mock 与文档保持一致。

## 执行记录

### 2026-05-05

- 已完成后端 verification gate：`capability_draft_service` 扩展状态、report、check item 与 `verify_capability_draft(...)`，验证报告落到 `verification/latest.json`，manifest 同步 `lastVerification` 与 `verificationStatus`。
- 已完成命令边界：新增 `capability_draft_verify`，同步 Tauri 注册、DevBridge dispatcher、`agentCommandCatalog.capabilityDraftCommands`、`mockPriorityCommands` 与 `defaultMocks`。
- 已完成前端接入：`capabilityDraftsApi.verify(...)`、状态 / 验证摘要 domain helper、`CapabilityDraftPanel` 的“运行验证”按钮和最近验证摘要；验证通过后仍只显示“待注册”，没有运行、注册或自动化按钮。
- 已通过 Rust 定向测试：`cargo test --manifest-path src-tauri/Cargo.toml capability_draft`，6 个 capability draft 测试通过。
- 已通过前端定向测试：`npm test -- src/lib/api/capabilityDrafts.test.ts src/features/capability-drafts/domain/capabilityDraftPresentation.test.ts src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx src/components/skills/SkillsWorkspacePage.test.tsx`，39 个测试通过。
- 已通过契约与类型检查：`npm run test:contracts`、`npm run typecheck`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`。
- 已通过 DevBridge smoke：完整草案验证后进入 `verified_pending_registration`；包含 `method: "POST"` 的危险草案验证后进入 `verification_failed`，失败项为 `static_risk_scan`。
- 已通过 GUI smoke：`npm run verify:gui-smoke` 全绿，覆盖 DevBridge、workspace-ready、browser-runtime、site-adapters、agent-service-skill-entry、agent-runtime-tool-surface、agent-runtime-tool-surface-page 与 knowledge-gui。
