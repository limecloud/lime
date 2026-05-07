# Skill Forge Capability Authoring P1A 执行计划

> 状态：P1A 完成，已通过 GUI smoke
> 创建时间：2026-05-05
> 路线图来源：`docs/roadmap/skill-forge/README.md`、`docs/roadmap/skill-forge/coding-agent-layer.md`、`docs/research/pi-mono-coding-agent/README.md`
> 当前目标：实现 P1A 最小模块，让 Lime 能创建、存储、查看未验证 `Capability Draft`，并证明未验证草案不会进入默认 tool surface、不会自动注册、不会自动执行。

## 主目标

把 Skill Forge 的 Coding Agent 启发收敛为 Lime current 主链里的 **Capability Authoring Agent / Skill Forge draft store**：

```text
用户目标
  -> capability generation request
  -> workspace-local draft store
  -> unverified draft manifest
  -> frontend API gateway
  -> Workspace / Skills 工作台 draft review
  -> 后续 P1B / P2 verification gate
```

固定宗旨：

**不是永远限制能力；是永远限制未经验证、未经授权、不可审计的执行。**

## 本轮范围

本轮做：

1. 后端模块化 draft store。
   - 独立 Rust domain 模块，负责 manifest、路径 guard、文件清单和状态。
   - Tauri command 只做薄适配，不承载业务规则。
2. 前端模块化 API 网关。
   - 新增 `src/lib/api/capabilityDrafts.ts`，组件不直接裸 `invoke`。
3. 前端 UI 最小 review surface。
   - 优先接到现有 `SkillsWorkspacePage` 或相邻 feature 模块。
   - 展示 draft 名称、目标、状态、权限摘要、文件清单和“未验证不可运行”。
4. 测试与 smoke。

- 后端路径 guard / manifest 单测。
- 前端 API normalization 单测。
- UI 状态回归：unverified draft 不显示运行/注册动作。
- 契约检查：前端调用、Rust 注册、治理目录册、mock 保持一致。

本轮不做：

1. 不实现完整 Coding Agent。
2. 不实现 verification gate。
3. 不注册 workspace-local skill。
4. 不接 automation job。
5. 不开放 full shell、依赖安装或外部写操作。
6. 不新增平行 runtime、scheduler、evidence pack。

## 模块边界

### 后端

推荐结构：

```text
src-tauri/src/commands/capability_draft_cmd.rs
src-tauri/src/services/capability_draft_service.rs
```

设计原则：

1. `capability_draft_cmd.rs` 只负责 Tauri 参数 / 返回值适配。
2. `capability_draft_service.rs` 负责业务规则、路径 guard、manifest 读写。
3. 文件事实源暂定 workspace-local：`.lime/capability-drafts/<draft_id>/manifest.json`。
4. 写入范围必须限制在 draft root 内，不允许路径逃逸。
5. 状态首期只允许 `unverified / failed_self_check`，不暴露运行能力。

### 前端

推荐结构：

```text
src/lib/api/capabilityDrafts.ts
src/features/capability-drafts/
  domain/
  components/
  CapabilityDraftPanel.tsx
```

设计原则：

1. API 网关统一封装命令名、参数与 normalization。
2. domain 模块负责状态文案、权限文案和按钮可见性。
3. 组件只做展示与用户操作，不拼接命令参数。
4. UI 作为工作台信息面板，不做独立花哨页面。
5. `unverified` 状态只允许查看、继续修复、丢弃；不允许运行和创建任务。

## 分阶段实施

### P1A-0：盘点与落 plan

- [x] 新增本执行计划。
- [x] 盘点现有 skill scaffold、Skills 工作台、Tauri command 注册、mock 和治理目录册。
- [x] 确认不复用 `create_skill_scaffold_for_app`，新增独立 capability draft 命令，避免未验证 draft 进入 Skill reload 主链。

### P1A-1：后端 draft store

- [x] 新增 manifest 类型和状态枚举。
- [x] 新增 draft root 路径解析与 path escape guard。
- [x] 新增 create/list/get 命令。
- [x] 新增 Rust 单测。

### P1A-2：前端 API 与 domain

- [x] 新增 `capabilityDraftsApi`。
- [x] 新增状态 / 权限 / 可操作性 domain helper。
- [x] 新增 API normalization 单测。

### P1A-3：Workspace UI review

- [x] 在 Skills 工作台或相邻模块加入 draft review panel。
- [x] 展示 `unverified` 隔离语义。
- [x] 补 UI 回归测试。

### P1A-4：试跑与验收

- [x] 用 Rust service 定向测试创建一个只读 draft。
- [x] 确认 manifest 与文件清单写入 draft root。
- [x] 确认 UI 能看到 draft。
- [x] 确认未验证 draft 不进入默认 tool surface。
- [x] 通过 DevBridge 真实调用 `capability_draft_create/list/get`。
- [x] 运行定向测试、`npm run test:contracts`。
- [x] `npm run verify:gui-smoke` 全绿通过。

## 验收标准

1. 能创建一个 `unverified` capability draft。
2. draft manifest 包含目标、来源、权限摘要、文件清单和状态。
3. 路径逃逸被拒绝。
4. 未验证 draft 不可运行、不可注册、不可绑定 automation job。
5. 前后端通过单一 API / command 主链连接。
6. 契约检查通过。

## 执行记录

### 2026-05-05

- 已创建执行计划，固定本轮只做 P1A draft store + review surface，不进入 P2/P3/P4。
- 已完成后端模块：`capability_draft_service` 作为文件事实源，`capability_draft_cmd` 只做 Tauri 薄适配，新增 `capability_draft_create/list/get`。
- 已完成前端模块：`capabilityDraftsApi`、`CapabilityDraftPanel` 与 presentation helper，接入 `SkillsWorkspacePage` 右侧工作台。
- 已同步命令边界：`runner.rs`、DevBridge dispatcher、`agentCommandCatalog.capabilityDraftCommands`、`mockPriorityCommands` 的 bridge-truth 列表、`defaultMocks`。
- 已试跑模块功能：Rust 定向测试真实创建 draft root、写入 `SKILL.md` 与 `manifest.json`、list/get 回读，并覆盖路径逃逸拒绝。
- 已验证：前端定向测试 36 个通过，`cargo test ... capability_draft` 通过，`npm run test:contracts` 通过，`npm run typecheck` 通过，`cargo fmt --check` 通过。
- 已通过 DevBridge smoke：在临时 workspace 下真实调用 `capability_draft_create/list/get`，生成 `unverified` draft，落盘 `SKILL.md` 与 `workflow/README.md`，list/get 回读一致。
- 首次执行 `npm run verify:gui-smoke` 时，前序 `bridge health`、`workspace-ready`、`browser-runtime`、`site-adapters`、`agent-service-skill-entry`、`agent-runtime-tool-surface`、`agent-runtime-tool-surface-page` 已通过；当时失败在既有 `smoke:knowledge-gui` 的“知识库总览加载”等待，页面仍停留首页，未命中本轮新增的 Capability Draft 命令、mock 或 Skills 工作台 review surface。
- 已定向复跑 `npm run smoke:knowledge-gui -- --app-url http://127.0.0.1:1420/ --health-url http://127.0.0.1:3030/health --invoke-url http://127.0.0.1:3030/invoke --timeout-ms 600000 --interval-ms 1000` 并通过；前次失败判断为运行中前端 / Tauri 会话抖动，不需要修改知识库代码。
- 已重跑 `npm run verify:gui-smoke` 并全绿通过，P1A 达到 Lime GUI 产品交付门槛。
