# CreoAI Capability Discovery P3B 执行计划

> 状态：进行中  
> 创建时间：2026-05-05  
> 前置计划：`docs/exec-plans/creaoai-capability-registration-p3-plan.md`  
> 路线图来源：`docs/roadmap/creaoai/implementation-plan.md`、`docs/aiprompts/skill-standard.md`、`docs/aiprompts/commands.md`  
> 当前目标：让 P3A 已注册到当前 workspace 的 Agent Skill 包可被产品层发现和审计，但仍不进入默认 runtime tool surface。

## 主目标

把 P3A 的文件注册事实推进到最小可见目录闭环：

```text
<workspaceRoot>/.agents/skills/<skill_directory>/
  -> require .lime/registration.json provenance
  -> inspect Agent Skills package
  -> workspace registered skill catalog projection
  -> Skills 工作台只读展示
  -> 后续 runtime gate / Query Loop binding
```

固定宗旨：

**不是永远限制能力；是永远限制未经验证、未经授权、不可审计的执行。**

## 本轮最小切口

本轮只做 **workspace-local registered skill discovery**：

1. 后端新增 workspace 显式入参的已注册能力发现命令。
2. 只扫描 `<workspaceRoot>/.agents/skills`，不再依赖进程 `cwd`。
3. 只返回带 `.lime/registration.json` 的 P3A 注册能力，不把任意项目 skill 都混进 CreoAI 生成链。
4. 返回 Agent Skills 标准检查摘要、资源摘要、权限摘要、来源 draft / verification report。
5. 前端 Skills 工作台展示“已注册但待运行接入”的只读卡片。

本轮明确不做：

1. 不调用 `AsterAgentState::reload_lime_skills()`。
2. 不修改 `get_local_skills_for_app` 的默认语义。
3. 不把 workspace generated skill 合并进 `useSkills("lime")` 的已安装方法列表。
4. 不展示“立即运行 / 自动化 / 继续这套方法”入口。
5. 不接 `agent_runtime_submit_turn`、Query Loop、`tool_runtime` 或 automation job。
6. 不解决 P4 Managed Objective 续跑。

## 为什么不用现有 local skills 列表直接承接

当前 `SkillService::get_catalog_roots(AppType::Lime)` 依赖：

```text
app_paths::resolve_project_skills_dir()
  -> std::env::current_dir()
  -> cwd/.agents/skills
```

但 P3A 注册位置是：

```text
<workspaceRoot>/.agents/skills/<skill_directory>
```

因此如果直接扩 `get_local_skills_for_app`，会把“当前前端项目 workspace”与“后端进程 cwd”继续混在一起，还可能把 generated skill 误投进默认运行面。P3B 第一刀先新增独立 discovery 命令，等目录投影、权限和 UI 语义稳定后，再进入 runtime binding。

## 安全规则

1. **显式 workspaceRoot**：入参必须是存在的绝对目录。
2. **registered-only**：目录必须同时包含 `SKILL.md` 与 `.lime/registration.json`。
3. **不跟随 symlink**：扫描到 symlink 目录直接拒绝，避免通过目录投影读取 workspace 外内容。
4. **不执行文件**：只读 `SKILL.md`、registration metadata 和包资源摘要。
5. **不信任元数据路径**：返回真实扫描到的目录，同时保留 registration summary 作为 provenance。
6. **默认不可运行**：返回对象必须显式标记 `launchEnabled=false` 与 runtime gate 提示。

## 实施步骤

### P3B-0：计划与边界

- [x] 新增本执行计划。
- [x] 明确本轮只做 registered skill discovery，不做 runtime binding。

### P3B-1：后端 discovery service

- [ ] 新增 `ListWorkspaceRegisteredSkillsRequest`。
- [ ] 新增 `WorkspaceRegisteredSkillRecord` DTO。
- [ ] 新增 `list_workspace_registered_skills(...)` 服务函数。
- [ ] 只扫描 `<workspaceRoot>/.agents/skills`。
- [ ] 只返回包含 `.lime/registration.json` 的标准 Skill 包。
- [ ] 补 Rust 单测：空目录、无 registration 忽略、注册后可发现、相对 workspaceRoot 拒绝、symlink 逃逸拒绝。

### P3B-2：命令边界

- [ ] 新增 Tauri command `capability_draft_list_registered_skills`。
- [ ] 同步 `runner.rs`、DevBridge dispatcher。
- [ ] 同步 `agentCommandCatalog`、`mockPriorityCommands`、`defaultMocks`。
- [ ] 运行 `npm run test:contracts`。

### P3B-3：前端 API / UI

- [ ] 扩展 `capabilityDraftsApi.listRegisteredSkills(...)` 与 normalization。
- [ ] 新增 Workspace 已注册能力只读面板。
- [ ] Skills 工作台在 Capability Draft 隔离区附近展示已注册能力。
- [ ] 注册成功后刷新已注册能力面板。
- [ ] 补 API、组件、Skills 工作台回归测试。

### P3B-4：试跑与验收

- [ ] 用 DevBridge 走 `create -> verify -> register -> list_registered_skills`。
- [ ] 确认返回 provenance、标准合规与 `launchEnabled=false`。
- [ ] 确认 UI 展示“已注册但待运行接入”，没有运行或自动化按钮。
- [ ] 根据 GUI 工作台改动补 `npm run verify:gui-smoke`。

## 验收标准

1. 不存在 `.agents/skills` 时返回空数组。
2. 普通 project skill 没有 `.lime/registration.json` 时不会进入 CreoAI registered 列表。
3. P3A 注册后的 skill 能被显式 workspaceRoot 发现。
4. discovery 结果包含来源 draft、verification report、权限摘要和 Agent Skills 标准状态。
5. discovery 结果显式 `launchEnabled=false`。
6. UI 不出现“立即运行 / 自动化 / 继续这套方法”入口。
7. 命令契约、DevBridge、mock、文档和 GUI smoke 保持一致。

## 执行记录

### 2026-05-05

- 已创建 P3B 执行计划，确认第一刀只补 workspace-local registered skill discovery。
- 已确认 P3B 不复用 `get_local_skills_for_app` 的 cwd 语义，也不把 generated skill 直接混进默认已安装方法列表。
