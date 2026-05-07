# Skill Forge Tool Runtime Authorization P3E 执行计划

> 状态：P3E 第一刀已完成，进入 P4 前收口  
> 日期：2026-05-06  
> 主线：`Capability Draft -> verification -> workspace-local skill -> P3B discovery -> P3C readiness -> P3D Query Loop metadata -> P3E tool_runtime authorization`

## 目标

P3E 只回答一个问题：已注册的 workspace-local Skill 如何在单个 session / turn 中经过显式 enable 后进入可调用边界。

本轮不做：

1. Agent Marketplace / Skill Store。
2. 长期自动化、scheduler 或后台 job。
3. 绕过 `agent_runtime_submit_turn` 的平行执行命令。
4. 把 P3D `workspace_skill_bindings` 只读 metadata 直接升级成可调用工具。

## 合同

新增 runtime metadata contract：

```json
{
  "harness": {
    "workspace_skill_runtime_enable": {
      "source": "manual_session_enable",
      "approval": "manual",
      "workspace_root": "/abs/workspace",
      "bindings": [
        {
          "directory": "capability-xxxx",
          "skill": "project:capability-xxxx",
          "source_draft_id": "capdraft-...",
          "source_verification_report_id": "capver-..."
        }
      ]
    }
  }
}
```

约束：

1. `workspace_root` 必须与当前 turn 的 workspace root 一致。
2. `bindings[].directory` 必须来自 P3C `ready_for_manual_enable` binding。
3. `SkillTool` 只在当前 session scope 内启用，并裁剪到 allowlist 中的 Skill 名称。
4. P3E metadata 本身不写 `allow_model_skills`，避免与 P3D 只读候选混淆。
5. Workspace Skill 加载只由 runtime enable gate 触发；注册和 discovery 仍不 reload Skill。

## 任务

### P3E-0：边界确认

- [x] 确认 `agent_runtime_list_workspace_skill_bindings` 仍只做 readiness，不新增命令。
- [x] 确认 P3E 继续走 `agent_runtime_submit_turn` metadata，不创建平行 runtime command。

### P3E-1：Rust runtime gate

- [x] 增加 `workspace_skill_runtime_enable` 解析与 P3C readiness 校验。
- [x] 明确校验 workspace root、registered skill directory 和 verification provenance。
- [x] 显式加载当前 workspace `.agents/skills`，并把 `project:<directory>` 放入 session allowlist。
- [x] 扩展 `LimeSkillTool` session gate：支持 all-access 与 allowlist 两种模式。

### P3E-2：Prompt 与前端 metadata

- [x] 在 full runtime prompt 中投影 runtime enable scope，提示只能调用列出的 workspace-local Skill。
- [x] 增加前端 metadata builder，输出 snake_case `workspace_skill_runtime_enable`，且不写 `allow_model_skills`。
- [x] 在 Workspace 已注册能力面板接入“本回合启用”，跳转到 Agent 后只通过 `initialAutoSendRequestMetadata.harness.workspace_skill_runtime_enable` 显式授权当前回合，不写长期自动化配置。
- [x] 将 P3E enable binding provenance 注入 `SkillTool` session source store，并在 ToolResult metadata 中写回 `workspace_skill_source` / `workspace_skill_runtime_enable`，让 timeline / evidence pack 能追踪 source draft、verification report、registered directory 与 session 授权范围。

### P3E-3：验证

- [x] Rust 定向测试：runtime binding service / runtime turn / agent SkillTool gate。
- [x] 前端定向测试：workspace metadata builder / harness metadata builder / Workspace 已注册能力启用入口。
- [x] 视命令契约变更情况运行 `npm run test:contracts`；本轮不新增命令，主要用于确认未漂移。

## 进度日志

### 2026-05-06

- P3E 第一刀已落到 current 主链：`agent_runtime_submit_turn -> request_metadata.harness.workspace_skill_runtime_enable -> SkillTool session allowlist`。
- 保留 P3D 只读语义：`workspace_skill_bindings` 仍不打开 `allow_model_skills`，不代表可调用。
- Workspace 已注册能力面板已补“本回合启用”入口：只在 P3C `ready_for_manual_enable` binding 上可用，自动发送首回合时注入 P3E metadata，不创建 automation / scheduler / marketplace。
- 前端定向验证已通过：`npx vitest run src/components/agent/chat/utils/workspaceSkillBindingsMetadata.test.ts src/components/agent/chat/utils/harnessRequestMetadata.test.ts src/features/capability-drafts/components/WorkspaceRegisteredSkillsPanel.test.tsx src/components/skills/SkillsWorkspacePage.test.tsx`（4 files / 54 tests）。
- 命令 / harness 契约验证已通过：`npm run test:contracts`。
- 已补 evidence / timeline 的最小来源链路：P3E projection 会把每个 enabled binding 转为 session-scoped `SkillToolSessionSkillSource`，`LimeSkillTool` 执行结果会携带 `workspace_skill_source` 与 snake_case `workspace_skill_runtime_enable` metadata；由于 timeline tool call payload 已保留 ToolResult metadata，后续 evidence pack 可直接消费该字段进入 P4 Agent envelope。
- Rust SkillTool gate 定向验证已通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/tmp/lime-p3e-agent-target cargo test -p lime-agent allowlisted_session_should_preserve_workspace_skill_source_metadata`（1 passed）。
- Rust runtime turn 定向验证已通过：`CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/tmp/lime-p3e-agent-target cargo test -p lime --lib workspace_skill_runtime_enable_metadata_should_force_full_runtime_context`（1 passed）。
- 最新校验已通过：`rustfmt --edition 2021 ...`、`git diff --check -- ...`、`npm run test:contracts`、前端 P3E vitest 定向套件、Rust SkillTool gate 定向测试和 Rust runtime turn 定向测试。

## P3E 收口结论

P3E 已完成当前计划中的最小可交付闭环：

1. 注册后的 workspace-local skill 仍默认不可调用，只作为 P3B / P3C / P3D 的只读候选和 readiness 上下文。
2. 当前 session 只有在 `request_metadata.harness.workspace_skill_runtime_enable` 显式携带 P3C ready binding 后才打开 `SkillTool`。
3. `SkillTool` tool surface 被裁剪到 `project:<directory>` / `<directory>` allowlist，且不通过 `allow_model_skills` 偷开全局 skills。
4. runtime gate 会校验 workspace root、registered skill directory、source draft、verification report 和 readiness provenance。
5. 调用结果会写回 `workspace_skill_source` / `workspace_skill_runtime_enable` metadata，后续 P4 可直接用于 timeline、evidence pack 和 Agent envelope 展示。

下一刀应进入 P4：把成功运行后的 workspace-local skill 包成 Workspace 产品面的 Agent envelope 草案，并继续复用 `agent_runtime_submit_turn`、automation job、Managed Objective、artifact 和 evidence 主链。
