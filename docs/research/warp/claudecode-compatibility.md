# ClaudeCode 与 Warp 参考边界

> 状态：current research reference  
> 更新时间：2026-04-29  
> 研究样本：`/Users/coso/Documents/dev/js/claudecode` 与 `/Users/coso/Documents/dev/rust/warp`  
> 目标：明确 Lime 主要参考 ClaudeCode 时，Warp 研究不会抢主线，也不会把 Lime 带回终端产品或外部 CLI 执行器路线。

## 1. 先给结论

不冲突。

但前提是把二者放在不同层级：

```text
ClaudeCode
  -> Agent 内循环
  -> Tool / Skill / Command / Permission
  -> Subagent / Task lifecycle
  -> Session / transcript / structured IO

Warp
  -> Run identity / task index
  -> Execution profile = model roles + permission profile
  -> Harness adapter for executor diversity
  -> Attachment / Artifact 分离
  -> Computer use / cloud-local split

Lime
  -> GUI 多模态桌面产品
  -> 本地优先执行
  -> 领域化 artifact graph + viewer
  -> LimeCore catalog / policy / model offer / gateway / audit
```

一句话：

**ClaudeCode 是 Lime Agent Runtime 的主参考；Warp 是多模态运行治理与执行器分层的补充参考。**

## 2. ClaudeCode 应作为主参考的部分

本地 `claudecode` 更接近 Lime 当前要建立的 Agent 主链，尤其是这些层：

1. `ToolUseContext` 与 tool protocol
   - 参考：`/Users/coso/Documents/dev/js/claudecode/src/Tool.ts`
   - 对 Lime 的价值：工具执行、上下文、状态更新、进度、通知、MCP、权限都通过统一上下文传递。

2. Permission modes / rules / decisions
   - 参考：`/Users/coso/Documents/dev/js/claudecode/src/types/permissions.ts`
   - 对 Lime 的价值：`allow / deny / ask`、规则来源、工作目录、session 与 policy 来源都可以被解释。

3. Slash command / skill command
   - 参考：`/Users/coso/Documents/dev/js/claudecode/src/types/command.ts`、`/Users/coso/Documents/dev/js/claudecode/src/commands.ts`
   - 对 Lime 的价值：命令不是字符串分支，而是带来源、可见性、模型、工具 allowlist、hooks、fork context 的 descriptor。

4. SkillTool / AgentTool
   - 参考：`/Users/coso/Documents/dev/js/claudecode/src/tools/SkillTool/SkillTool.ts`、`/Users/coso/Documents/dev/js/claudecode/src/tools/AgentTool/AgentTool.tsx`
   - 对 Lime 的价值：技能可以 inline 或 fork，子代理有独立上下文、模型、权限、任务输出和进度。

5. Task lifecycle
   - 参考：`/Users/coso/Documents/dev/js/claudecode/src/Task.ts`、`/Users/coso/Documents/dev/js/claudecode/src/tasks.ts`
   - 对 Lime 的价值：`local_bash / local_agent / remote_agent / workflow / monitor` 等 task type 有统一 status、output file、kill 入口。

这些是 Lime 应该优先对齐的“Agent 内核语义”。

## 3. Warp 只补 ClaudeCode 没有显式解决的部分

Warp 的价值不在于替代 ClaudeCode，而在于提醒 Lime 补齐多模态产品会遇到的外层治理问题：

1. Execution Profile
   - ClaudeCode 的权限体系很强，但模型角色、模态能力、executor 策略不一定天然收在同一个 profile。
   - Warp 的 `AIExecutionProfile` 提醒 Lime 把 `base_model / image_generation_model / browser_reasoning_model` 与 `read_files / web_search / browser_control / media_upload` 放到同一解释层。

2. Harness Adapter
   - ClaudeCode 更像内置 agent/tool runtime。
   - Warp 的第三方 harness 提醒 Lime：外部 CLI、本地工具、云端 run 都只能作为 typed executor adapter，不能成为模型自由 shell。

3. Attachment / Artifact 分离
   - ClaudeCode 的 message、attachment、tool_result 对 Agent loop 足够自然。
   - Lime 多模态需要更强的领域化 artifact graph：`image_task`、`audio_output`、`pdf_extract`、`browser_snapshot`、`presentation_document`。

4. Computer Use
   - ClaudeCode 有 WebFetch、WebSearch、Bash、MCP、AgentTool 等工具语义。
   - Warp 的 computer use 提醒 Lime：浏览器/桌面操作应是 high-risk typed action，不能被降级成普通搜索。

5. Cloud / Local split
   - ClaudeCode 的 remote session 对远端协作有价值。
   - Warp 的 cloud agent / local agent 分层提醒 LimeCore：云端应优先做目录、策略、模型 offer、Gateway、audit，普通本地 ServiceSkill 不默认云端代跑。

## 4. 冲突点与裁决规则

| 维度 | ClaudeCode 优先 | Warp 补充 | Lime 裁决 |
| --- | --- | --- | --- |
| Agent loop | tool_use / tool_result / context / permission | conversation / run identity | 内循环按 ClaudeCode；跨 artifact / audit 关联键按 Lime 自己的 run identity |
| Skill / command | slash command、SkillTool、fork context | skill provider precedence | 技能执行按 ClaudeCode；目录来源和优先级可借 Warp |
| Permission | mode、rule source、allow/deny/ask | profile 把模型与权限合并 | `ModalityExecutionProfile` 合并二者，不让模型路由绕过权限 |
| Task / subagent | Task type、status、output、kill | task index、cloud/local source | task 生命周期按 ClaudeCode；任务中心索引按 Lime 多模态需求扩展 |
| Artifact | message / attachment / tool_result | Artifact / Screenshot / File | Lime 自建领域 artifact graph，不照搬任一方 |
| Browser | tool 调用语义 | typed computer action | Browser Assist 走 typed browser action + evidence |
| Remote / cloud | remote session / bridge | cloud agent / harness | LimeCore 做 control plane；显式 cloud run 才进入云执行 |
| UI | terminal REPL | terminal/workspace | 二者 UI 都不照搬，Lime 仍是 GUI 桌面产品 |

如果二者出现表面冲突，默认裁决顺序：

1. Agent/tool/permission/skill/subagent 语义优先参考 ClaudeCode。
2. 多模态 artifact、execution profile、executor adapter、task index、cloud-local 分层参考 Warp。
3. 用户可见 GUI、工作台、viewer、LimeCore 协同以 Lime 现有 current 规划为准。

## 5. 对 `docs/roadmap/warp/` 的约束

`docs/roadmap/warp/` 不是“把 Lime 改成 Warp”。

它只负责把 Warp 暴露的外层治理能力翻译为 Lime 多模态计划：

```text
ClaudeCode-style Agent Runtime
  -> Lime ModalityRuntimeContract
  -> Lime ModalityExecutionProfile
  -> Lime domain artifact graph
  -> Lime evidence / viewer / task index
  -> LimeCore catalog / policy / audit
```

固定约束：

1. 不用 Warp 替换 ClaudeCode 作为主参考。
2. 不把第三方 CLI harness 作为 Lime current 多模态入口。
3. 不把 LimeCore 写成所有 `@` 命令的默认执行器。
4. 不把 Warp 的通用 `FILE` artifact 粒度照搬到 Lime。
5. 不把终端 UI、pane、tab、shell workflow 搬成 Lime 主导航。

## 6. 最终判断

ClaudeCode 和 Warp 不冲突，因为它们解决的是不同层的问题：

```text
ClaudeCode 解决“Agent 怎么安全、可控、可恢复地思考和调用工具”
Warp 解决“多 executor、多产物、多运行地点时，运行身份和治理怎么统一”
Lime 需要解决“多模态创作产品怎么把这些能力变成可见、可审计、可复用的 GUI 工作流”
```

所以 Lime 的正确路线是：

**主干学 ClaudeCode，外壳治理学 Warp，产品体验和云边界坚持 Lime 自己的 current 规划。**
