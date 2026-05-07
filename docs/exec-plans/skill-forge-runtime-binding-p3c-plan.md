# Skill Forge Runtime Binding P3C 执行计划

> 状态：完成
> 创建时间：2026-05-06
> 前置计划：`docs/exec-plans/skill-forge-capability-discovery-p3b-plan.md`
> 路线图来源：`docs/roadmap/skill-forge/implementation-plan.md`、`docs/aiprompts/commands.md`、`docs/aiprompts/quality-workflow.md`
> 当前目标：把 P3B 已发现的 workspace-local registered skill 推进为运行时可审计的 binding readiness projection，但仍不开放默认执行面。

## 主目标

P3C 第一刀只回答一个问题：

```text
当前 workspace 里哪些 P3A/P3B registered skill
  -> 已经具备进入 Query Loop / tool_runtime 的候选资格
  -> 还卡在哪个 gate
  -> 为什么现在仍不能直接运行
```

固定宗旨：

**不是永远限制能力；是永远限制未经验证、未经授权、不可审计的执行。**

## 本轮最小切口

本轮新增 `agent_runtime_*` 主链下的只读投影命令：

```text
agent_runtime_list_workspace_skill_bindings
  -> workspaceRoot
  -> P3B registered skills
  -> binding readiness / policy gate / next gate
  -> Skills 工作台只读展示
```

本轮只做：

1. 显式按 `workspaceRoot` 读取 P3B registered skill。
2. 返回 runtime binding candidate / blocked / next gate 等只读状态。
3. 明确标注 `queryLoopVisible=false`、`toolRuntimeVisible=false`、`launchEnabled=false`。
4. 前端只展示“runtime binding 候选 / 待启用”，不展示运行、自动化或继续方法入口。
5. 同步 `agentRuntimeCommandSchema`、generated manifest、DevBridge、mock、命令目录册和文档。

本轮明确不做：

1. 不调用 `AsterAgentState::reload_lime_skills()`。
2. 不修改 `SkillService::get_catalog_roots` 的 cwd 语义。
3. 不把 workspace registered skill 合并进默认 `useSkills("lime")`。
4. 不把 generated skill 注入 `SkillTool` global registry。
5. 不改变 `agent_runtime_submit_turn` 的工具可见性。
6. 不创建 automation job 或 Managed Objective。

## 为什么 P3C 第一刀仍然只读

P3B 已证明“文件存在且可审计”，但它还没有证明：

1. Query Loop 该如何在当前 session 中发现这个 skill。
2. `tool_runtime` 该如何裁剪它的权限、caller、surface 和 sandbox。
3. evidence pack 该如何记录来源 draft、verification report、registration 和运行事实。
4. 当前 workspace 与后端进程 `cwd` 不一致时，运行时 loader 该读哪个 root。

因此 P3C 不能直接把 registered skill 交给现有 `SkillTool` 执行。第一刀先把 binding gate 明文化，让后续每一步都有事实源可验证。

## 安全规则

1. **workspace 显式入参**：不从进程 `cwd` 推断当前项目。
2. **registered-only**：只消费 P3B 已认可的 `.lime/registration.json` provenance。
3. **只读 projection**：不执行 `SKILL.md`、scripts、CLI 或外部 API。
4. **默认不可运行**：所有结果必须显式 `launchEnabled=false`。
5. **gate 可解释**：每条 binding 都必须说明当前状态、阻塞原因和下一道 gate。
6. **后续执行回主链**：真正执行只能继续走 `agent_runtime_submit_turn -> Query Loop -> tool_runtime -> artifact/evidence`。

## 实施步骤

### P3C-0：计划与边界

- [x] 新增本执行计划。
- [x] 明确第一刀只做 runtime binding readiness projection，不做 execution。

### P3C-1：后端 binding service

- [x] 新增 workspace skill binding DTO。
- [x] 新增 `list_workspace_skill_bindings(...)` 服务函数。
- [x] 复用 P3B registered discovery 的 symlink / provenance / 标准检查边界。
- [x] 返回 `ready_for_manual_enable` / `blocked` 等 binding 状态。
- [x] 补 Rust 单测：空 workspace、相对 workspaceRoot 拒绝、registered skill 变成 binding candidate、缺 provenance blocked、非标准项 blocked。

### P3C-2：agent runtime 命令边界

- [x] 新增 Tauri command `agent_runtime_list_workspace_skill_bindings`。
- [x] 同步 `runner.rs`、DevBridge dispatcher。
- [x] 同步 `agentRuntimeCommandSchema.json` 并生成 `commandManifest.generated.ts`。
- [x] 同步 `agentCommandCatalog`、`mockPriorityCommands`、`defaultMocks`。
- [x] 运行 `npm run test:contracts`。

### P3C-3：前端 API / UI

- [x] 扩展 `src/lib/api/agentRuntime/inventoryClient.ts`。
- [x] 扩展 `WorkspaceRegisteredSkillsPanel`：展示 binding 状态与 next gate。
- [x] 保持不出现“立即运行 / 自动化 / 继续这套方法”入口。
- [x] 补 API、组件、Skills 工作台回归测试。

### P3C-4：试跑与验收

- [x] Rust 定向测试通过。
- [x] 前端定向测试通过。
- [x] `npm run test:contracts` 通过。
- [x] 若 Skills 工作台 UI 可见行为变化，补 `npm run verify:gui-smoke`。

## 验收标准

1. `agent_runtime_list_workspace_skill_bindings` 只接受显式 `workspaceRoot`。
2. 返回结果只包含 P3B registered skill。
3. 每条结果包含来源 draft、verification report、registration、权限摘要和 next gate。
4. 每条结果默认 `queryLoopVisible=false`、`toolRuntimeVisible=false`、`launchEnabled=false`。
5. UI 展示 runtime binding 状态，但不出现运行、自动化或继续方法入口。
6. 命令契约、DevBridge、mock、文档和 GUI smoke 保持一致。

## 执行记录

### 2026-05-06

- 已创建 P3C 执行计划，确认命令归属为 `agent_runtime_* / inventory` 主链，而不是继续扩 `capability_draft_*`。
- 已确认第一刀不接 `SkillTool`、不 reload、不修改 cwd-based loader，只补 workspace binding readiness projection。
- 已完成后端 `runtime_skill_binding_service`、Tauri command、DevBridge dispatcher、前端 API 网关、默认 mock、治理目录册与 Skills 工作台只读 binding 状态展示。
- 已把 P3C 语义固定为 `workspaceRoot -> P3B registered skills -> runtime binding readiness / next gate`，结果显式返回 `queryLoopVisible=false`、`toolRuntimeVisible=false` 与 `launchEnabled=false`。
- Rust 定向测试通过：
  - `CARGO_TARGET_DIR="src-tauri/target-codex-p3c-novoice" cargo test --manifest-path "src-tauri/Cargo.toml" --no-default-features runtime_skill_binding`
  - 结果：`5` 个 runtime skill binding 测试通过，`1224` 个测试按过滤器跳过。
  - 首次编译曾被既有媒体任务编译问题阻断；已补最小阻塞修复后复跑通过。
- 前端定向回归通过：
  - `npm test -- "src/lib/api/agentRuntime/inventoryClient.test.ts" "src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx" "src/components/skills/SkillsWorkspacePage.test.tsx" "src/lib/api/capabilityDrafts.test.ts"`
  - 结果：`4` 个文件、`41` 个测试通过。
- 运行时 API 目录校验通过：
  - `npm run typecheck`
  - `npx eslint "src/lib/api/agentRuntime.ts" "src/lib/api/agentRuntime/*.ts" --max-warnings 0`
- 命令契约通过：
  - `npm run test:contracts`
  - 结果：agent runtime generated manifest、command contracts、harness contracts、modality runtime contracts 与 cleanup report contract 均通过。
- GUI smoke 复跑通过：
  - `npm run verify:gui-smoke -- --reuse-running --timeout-ms 300000`
  - 首次运行在 `smoke:knowledge-gui` 的文件管理器资料导入等待处失败；复跑通过 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface、Knowledge GUI 与 Design Canvas。

## P3C 收口结论

P3C runtime binding readiness projection 第一刀已达到本计划可交付门槛：P3B registered skill 可以在 `agent_runtime_* / inventory` 主链下被投影为 workspace skill binding candidate，并明确说明当前 binding status、next gate、来源 provenance 与权限摘要；但仍不会进入 Query Loop、SkillTool registry、默认 tool surface，也不会暴露运行、自动化或继续方法入口。

下一阶段应继续单独推进：

```text
runtime binding readiness
  -> workspace-scoped Query Loop metadata
  -> tool_runtime 授权裁剪
  -> 当前 session 显式启用 generated skill
  -> artifact / evidence 调用记录
```
