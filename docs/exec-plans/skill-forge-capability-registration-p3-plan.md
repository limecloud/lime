# Skill Forge Capability Registration P3 执行计划

> 状态：P3A 完成；已通过 DevBridge 注册链路验证与 GUI smoke
> 创建时间：2026-05-05
> 前置计划：`docs/exec-plans/skill-forge-capability-authoring-p1a-plan.md`、`docs/exec-plans/skill-forge-capability-verification-p1b-plan.md`
> 路线图来源：`docs/roadmap/skill-forge/implementation-plan.md`、`docs/aiprompts/skill-standard.md`
> 当前目标：把已通过 verification gate 的 `Capability Draft` 注册为当前 workspace 的本地 Agent Skill 包，但仍不接运行、不接自动化、不进入默认 tool surface。

## 主目标

把 P1B 的 `verified_pending_registration` 推进到最小可追踪注册闭环：

```text
workspace-local capability draft
  -> verified_pending_registration
  -> registration gate
  -> <workspaceRoot>/.agents/skills/<skill_directory>/
  -> draft manifest lastRegistration
  -> Skills 工作台 review surface
  -> 后续 P3B / P4 runtime binding
```

固定宗旨：

**不是永远限制能力；是永远限制未经验证、未经授权、不可审计的执行。**

## 本轮范围

本轮做：

1. 后端最小 registration gate。
   - 新增 `capability_draft_register` 命令。
   - 只允许 `verified_pending_registration` 状态进入注册。
   - 注册前再次校验 draft 文件清单完整性与 Agent Skills 标准合规。
   - 将 draft 生成文件复制到 `<workspaceRoot>/.agents/skills/<skill_directory>/`。
   - 写入 draft 侧 `registration/latest.json` 和 manifest `lastRegistration`。
2. 前端 API / domain / UI 接入。
   - `capabilityDraftsApi.register(...)` 统一封装命令。
   - UI 只在 `verified_pending_registration` 显示“注册到当前 Workspace”。
   - 注册后展示目录与来源，不显示“立即运行 / 自动化”。
3. 命令治理与 mock 同步。
   - Rust 注册、DevBridge dispatcher、`agentCommandCatalog`、`mockPriorityCommands`、`defaultMocks` 保持一致。
4. 定向验证。

本轮不做：

1. 不调用 `AsterAgentState::reload_lime_skills()`。
2. 不修改全局 seeded skill 或用户级 Lime skill 目录。
3. 不把已注册 skill 自动放进默认 tool surface。
4. 不新增 runtime binding、scheduler、automation job 或 Managed Objective。
5. 不执行 draft 中的脚本，不做 dry-run、shell、依赖安装或外部写操作。
6. 不解决现有 `resolve_project_skills_dir()` 依赖进程 cwd 的完整 catalog 可见性问题；这属于 P3B discovery/runtime binding。

## P3A / P3B 边界

本计划只交付 **P3A：workspace-local file registration**。

```text
P3A: verified draft -> workspace .agents/skills package -> provenance
P3B: workspace catalog discovery -> skill launch metadata -> tool_runtime surface
P4 : managed execution / automation / objective loop
```

这样拆分的原因：

1. registration 是文件与来源事实，不等于可运行能力。
2. catalog discovery 需要解决 workspace 选择、进程 cwd、SkillService root 和 runtime session 的一致性，不能顺手塞进复制文件命令里。
3. runtime binding 必须回到 `agent_runtime_submit_turn -> Query Loop -> tool_runtime -> artifact/evidence` 主链，不能让 `capability_draft_register` 变成第二套执行入口。

## 注册规则

1. **状态前置**：仅允许 `verified_pending_registration`。
2. **标准前置**：`SKILL.md` 必须通过 Agent Skills 标准检查；P1B 的静态 gate 通过不等于标准合规。
3. **路径前置**：只复制 manifest `generatedFiles` 清单内的相对路径，继续拒绝绝对路径、`..`、平台相关路径与 symlink。
4. **目标位置**：只写当前 `workspaceRoot/.agents/skills/<skill_directory>/`。
5. **冲突处理**：目标目录已存在时拒绝，不覆盖、不合并、不删除用户已有目录。
6. **来源记录**：注册摘要必须包含 draft id、verification report id、权限摘要、文件数量、注册时间与目标目录。
7. **可见性限制**：注册完成只表示“workspace 中已有标准 skill 包”，不表示已经进入运行时工具面。

## 实施步骤

### P3-0：计划与边界

- [x] 新增本执行计划。
- [x] 明确本轮只做 P3A registration，不做 P3B discovery/runtime binding。

### P3-1：后端 registration service

- [x] 新增 registration summary / request / result 类型。
- [x] 新增注册目录派生、目标路径 guard、文件复制与 provenance 写入。
- [x] 新增 `register_capability_draft(...)` 服务函数。
- [x] 注册后更新 manifest 状态为 `registered`。
- [x] 补 Rust 单测：未验证拒绝、验证失败拒绝、标准不合规拒绝、标准草案可注册、目标目录冲突拒绝。

### P3-2：命令边界

- [x] 新增 Tauri command `capability_draft_register`。
- [x] 同步 `runner.rs`、DevBridge dispatcher。
- [x] 同步 `agentCommandCatalog`、`mockPriorityCommands`、`defaultMocks`。
- [x] 运行 `npm run test:contracts`。

### P3-3：前端 API / UI

- [x] 扩展 `capabilityDraftsApi.register(...)` 与 normalization。
- [x] 扩展 domain helper：`canRegisterCapabilityDraft`、注册摘要展示。
- [x] 在 `CapabilityDraftPanel` 展示注册按钮和注册目录。
- [x] 补 API、domain、UI 回归测试。

### P3-4：试跑与验收

- [x] 用 DevBridge 创建完整标准 draft，验证通过后注册。
- [x] 通过 Rust service 定向测试确认生成 `<workspaceRoot>/.agents/skills/<skill_directory>/SKILL.md`。
- [x] 通过 Rust service 定向测试确认 manifest 进入 `registered` 并记录 `lastRegistration`。
- [x] 通过前端回归测试确认 UI 仍没有运行或自动化入口。
- [x] 根据改动风险补 `npm run verify:gui-smoke`。

## 验收标准

1. 未验证或验证失败 draft 无法注册。
2. P1B 静态 gate 通过但 Agent Skills 标准不合规的 draft 仍无法注册。
3. 标准合规 draft 能注册到当前 workspace 的 `.agents/skills`。
4. 注册动作不会覆盖已有 skill 目录。
5. 注册后 manifest 和 `registration/latest.json` 能追踪来源、权限和 verification report。
6. UI 能看到注册结果，但没有运行、自动化或外部写入口。
7. 命令契约、mock、文档与 GUI smoke 保持一致。

## 执行记录

### 2026-05-05

- 已创建 P3A 执行计划，明确本轮只做 workspace-local file registration。
- 已确认 `create_skill_scaffold_for_app` 是人工 scaffold 主链，不复用为 draft registration；P3A 使用独立 `capability_draft_register`，避免未验证 / 未授权能力进入 Skill reload 或运行时主链。
- 已完成后端 P3A registration gate：只允许 `verified_pending_registration`，注册前复核 manifest 文件完整性与 Agent Skills 标准，复制到当前 workspace 的 `.agents/skills/<skill_directory>/`，并写入 draft / registered skill 两侧 provenance。
- 已完成命令边界同步：`capability_draft_register` 已接入 Tauri command、`runner.rs`、DevBridge dispatcher、`agentCommandCatalog`、`mockPriorityCommands`、`defaultMocks` 与前端 API 网关。
- 已完成 Skills 工作台最小 UI：只有 `verified_pending_registration` 显示“注册到 Workspace”，注册成功只展示目录与来源提示，仍不展示立即运行、自动化或 runtime binding 入口。
- 校验通过：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`。
- 校验通过：`CARGO_TARGET_DIR=src-tauri/target-codex-p3 cargo test --manifest-path src-tauri/Cargo.toml capability_draft`，11 个 capability draft 定向测试通过。
- 校验通过：`npm test -- src/lib/api/capabilityDrafts.test.ts src/features/capability-drafts/domain/capabilityDraftPresentation.test.ts src/features/capability-drafts/components/CapabilityDraftPanel.test.tsx src/components/skills/SkillsWorkspacePage.test.tsx`，4 个文件 42 个测试通过。
- 校验通过：`npm run test:contracts`，命令契约、Harness 契约、modality runtime contracts 与 cleanup report contract 通过。
- 已做稳健性补强：注册复制使用目标目录独占创建，避免 race 下覆盖或合并已有 workspace skill 目录；manifest 写入失败时同步清理 draft 侧 registration summary，避免留下不可达 provenance。
- GUI smoke 首次尝试时，`smoke:knowledge-gui` 点击旧 `ariaLabel=知识库` 失败，当前导航按钮实际为 `灵感库` / `项目资料` 等；这是 Knowledge 导航 smoke 断言与当前 UI 命名不一致，非 P3A Capability Draft 注册链路改动。
- 已收口 Knowledge GUI smoke 导航断言：`scripts/knowledge-gui-smoke.mjs` 从旧的 `知识库` 导航切到当前 `项目资料` 入口，并更新 Agent 页资料使用文案断言。
- 校验通过：`npm run smoke:knowledge-gui -- --app-url http://127.0.0.1:1420/ --health-url http://127.0.0.1:3030/health --invoke-url http://127.0.0.1:3030/invoke --timeout-ms 300000 --interval-ms 1000`。
- 校验通过：`npm run verify:gui-smoke -- --reuse-running --timeout-ms 300000`，完整 GUI smoke 通过。
- DevBridge 链路验证通过：通过 `capability_draft_create -> capability_draft_verify -> capability_draft_register` 创建标准 draft，验证结果 `passed`，注册后 manifest 状态为 `registered`，并确认生成 `.agents/skills/<skill_directory>/SKILL.md` 与 `.lime/registration.json`。
- 已知非本轮阻塞：`npm run typecheck` 仍受 `src/lib/layered-design/imageTasks.ts` 既有类型问题影响，错误为 `LayeredDesignImageRuntimeContract` 不能赋给 `Record<string, unknown>`；本计划不顺手修 layered-design 旁支。
