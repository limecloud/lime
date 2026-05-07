# Skill Forge Query Loop Metadata P3D 执行计划

> 状态：完成
> 创建时间：2026-05-06
> 前置计划：`docs/exec-plans/skill-forge-runtime-binding-p3c-plan.md`
> 路线图来源：`docs/roadmap/skill-forge/implementation-plan.md`、`docs/aiprompts/commands.md`、`docs/aiprompts/quality-workflow.md`
> 当前目标：把 P3C 的 runtime binding readiness 作为 Query Loop 可读上下文投影进单次 `agent_runtime_submit_turn`，但仍不启用真实 SkillTool 执行。

## 主目标

P3D 第一刀只回答：

```text
如果当前回合显式携带 workspace_skill_bindings metadata
  -> Query Loop 能不能读到这些 registered skill 的来源、状态和下一道 gate
  -> 模型能不能据此规划下一步
  -> 同时明确不能声称已运行、不能调用未启用 skill、不能自动化
```

固定宗旨：

**不是永远限制能力；是永远限制未经验证、未经授权、不可审计的执行。**

## 本轮最小切口

本轮只做 Query Loop metadata prompt projection：

1. 新增 `workspace_skill_bindings` / `workspaceSkillBindings` request metadata contract。
2. Rust 在 full runtime system prompt 中注入只读说明块。
3. 说明块把 registered skill 当作“候选能力上下文”，不是可调用工具。
4. prompt 明确禁止模型声称已执行、禁止调用未授权 Skill、禁止创建自动化。
5. 补最小 frontend metadata builder，用于后续 UI / send boundary 统一组装。

本轮明确不做：

1. 不注入 `SkillTool` registry。
2. 不把 P3C binding candidate 变成 `allow_model_skills=true`。
3. 不创建 “运行 / 自动化 / 继续这套方法” UI 入口。
4. 不新增 scheduler、queue、artifact 或 evidence 旁路。
5. 不执行 `.agents/skills/<skill>/scripts`。

## Metadata contract

推荐放在：

```json
{
  "harness": {
    "workspace_skill_bindings": {
      "source": "p3c_runtime_binding",
      "bindings": [
        {
          "directory": "capability-report",
          "name": "只读 CLI 报告",
          "description": "把只读 CLI 输出整理成 Markdown 报告。",
          "binding_status": "ready_for_manual_enable",
          "next_gate": "manual_runtime_enable",
          "query_loop_visible": false,
          "tool_runtime_visible": false,
          "launch_enabled": false,
          "permission_summary": ["Level 0 只读发现"],
          "source_draft_id": "capdraft-...",
          "source_verification_report_id": "capver-..."
        }
      ]
    }
  }
}
```

固定语义：

- `workspace_skill_bindings` 表示“当前回合可读的 registered skill 候选上下文”。
- `query_loop_visible=false` 表示尚未进入长期 Query Loop 目录。
- `tool_runtime_visible=false` 表示尚未进入可调用工具面。
- `launch_enabled=false` 表示前端和模型都不能把它当作可运行能力。

## 实施步骤

### P3D-0：计划与边界

- [x] 新增本执行计划。
- [x] 明确 P3D 只做 Query Loop metadata projection，不做 execution。

### P3D-1：Rust prompt projection

- [x] 新增 `workspace_skill_binding_prompt` 模块。
- [x] 支持 snake_case / camelCase metadata。
- [x] 限制最多投影 5 个 binding，避免 prompt 膨胀。
- [x] 过滤空字段并截断长文本。
- [x] 在 full runtime prompt stage 中插入 `WorkspaceSkillBindings`。
- [x] 补 Rust 单测：无 metadata 不注入、有 binding 注入、禁止执行语义存在、stage 顺序稳定。

### P3D-2：Frontend metadata builder

- [x] 新增 workspace skill binding metadata builder。
- [x] 支持从 `AgentRuntimeWorkspaceSkillBinding` 安全裁剪为 request metadata。
- [x] 保持 `allow_model_skills` 不被自动打开。
- [x] 补 TS 单测。

### P3D-3：文档与校验

- [x] 更新 Skill Forge 路线图 P3D 状态。
- [x] 更新命令 / 质量文档中 metadata 边界。
- [x] 跑 Rust / TS 定向测试、`npm run typecheck`、必要时 `npm run test:contracts`。

## 验收标准

1. 不带 `workspace_skill_bindings` metadata 时 prompt 不变化。
2. 带 metadata 时 prompt 包含 skill 名称、目录、状态、来源与下一道 gate。
3. prompt 明确说明这些 binding 只能用于规划，不能被直接调用或声称已运行。
4. 该 metadata 不会自动打开 `allow_model_skills`。
5. 所有新增测试和契约检查通过。

## 执行记录

### 2026-05-06

- 已创建 P3D 执行计划，确认本轮只把 P3C readiness 作为 Query Loop 可读上下文，不做 tool_runtime 执行授权。
- 已新增 Rust `WorkspaceSkillBindings` prompt stage：支持 `workspace_skill_bindings` / `workspaceSkillBindings`，最多投影 5 个候选 binding，并在 prompt 中明确禁止声称已运行、禁止调用未授权 Skill、禁止创建 automation。
- 已新增前端 `workspaceSkillBindingsMetadata` builder，并接入 `buildHarnessRequestMetadata` 可选参数；默认不改变发送行为，也不写入 `allow_model_skills`。
- 已更新 Skill Forge 路线图、命令边界与质量工作流，明确 P3D 是只读 Query Loop metadata projection，不是 runtime enable。
- 后续 P3E / P4 收口验证已覆盖 P3D 边界：workspace skill metadata builder、harness metadata builder、runtime turn prompt projection、`npm run test:contracts` 与 `npm run typecheck` 均通过；P3D 判定完成。
