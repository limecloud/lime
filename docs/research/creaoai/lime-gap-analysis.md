# CREAO 对照 Lime 的偏差分析

> 状态：current research reference  
> 更新时间：2026-05-06
> 目标：判断 Lime 当前路线和 CREAO 访谈启发是否冲突，并明确后续应该补哪些产品、运行和组织闭环。

## 1. 总判断

Lime 当前方向不冲突。

更准确的判断是：

**Lime 已有底座，但 skills pipeline 还偏静态，Agent 产品面还偏薄；CREAO 启发的是把“能力生成、验证、注册、rerun、Agent 固化、反馈改进”补成闭环。**

也就是说，问题不是 Lime 缺 tool，也不是缺 skill 标准，而是缺少：

```text
Coding Agent 自动生成 capability
  -> 编译进 Lime Skill 标准
  -> 验证后注册
  -> 进入 tool_runtime / automation job
  -> 成功任务主动固化为 Agent envelope
  -> artifact / evidence / telemetry 形成可审计与可改进闭环
```

补充宗旨：

**CREAO 启发不等于无限放权。Lime 后续应坚持“权限永远显式受控，能力逐级开放”；限制的是未经验证、未经授权、不可审计的执行，不是限制 agent 的理解、设计和编码能力。**

## 2. Lime 已经接近的部分

Lime 当前已经具备以下相关底座：

1. Agent Skills 作为唯一技能包格式标准。
2. Skill 是 bundle，不是单个 Markdown。
3. ServiceSkill / SkillCatalog 作为产品投影层。
4. SiteAdapterSpec 作为站点 adapter 标准。
5. Query Loop 统一 submit turn、metadata、tool runtime、queue、evidence。
6. tool catalog 已有 capability、lifecycle、permission plane。
7. workspace、artifact、subagent、automation、evidence pack 已进入主链。

这些说明 Lime 不需要另起炉灶。

## 3. Lime 当前缺口

真正缺口集中在八点：

1. **Coding Agent / Capability Authoring 层偏弱**
   - Lime 原本不是 terminal coding agent，现有强项是 Query Loop、Workspace、Artifact、Automation 和 Evidence；弱项是让 agent 受控地读取 CLI / API / docs、写 adapter / contract / tests、并修复 verification 失败。
   - 这部分可参考 [../pi-mono-coding-agent/README.md](../pi-mono-coding-agent/README.md) 的工具 allowlist、可插拔工具后端、session/runtime/services 分层和 deterministic test harness，但不能照搬其全仓库 shell/write 权限。

2. **生成态能力缺少标准入口**
   - 用户还不能稳定地让 agent 生成 workspace-local skill / adapter，并进入统一校验和注册。

3. **验证 gate 不够产品化**
   - dry-run、schema 校验、权限声明、fixture test 还没有形成 generated capability 的默认门禁。

4. **长期任务纪律不够强**
   - durable automation、runtime queue、subagent 已有，但“持久目标 -> 空闲续跑 -> completion audit -> complete / blocked / needs_input”还未成为所有 managed skill 的统一行为。
   - 这一缺口与 [Codex `/goal`](../codex-goal/README.md) 的 persistent objective / continuation loop 直接相关，但 Lime 不能照搬 thread-level `/goal`，必须折回 `agent turn / subagent turn / automation job` 与 evidence pack。

5. **Workspace 对生成能力的可见性不足**
   - 用户需要看到哪些能力是 agent 生成的、来源是什么、权限是什么、最近运行如何、证据在哪里。

6. **Agent envelope 产品层不足**
   - 访谈中 Skill 只是 runbook；Lime 还需要把 verified skill 与 memory、widget、schedule、permission、evidence 组合成可 rerun Agent，而不是只展示“已注册技能”。

7. **Proactive agentization 不足**
   - CREAO 的 aha moment 是成功任务后主动建议“继续这套方法 / 转成 Agent”。Lime 目前更偏手工注册和手工进入下一 gate，缺少从成功 turn 到 reusable agent 的产品转化面。

8. **Sandbox / Memory / Outcome feedback 缺口**
   - Lime 已有 evidence 与 runtime 主链，但还需要明确 sandbox profile、三层 memory 回流，以及 evidence 与 telemetry / experiment 的边界：evidence 证明做了什么，outcome feedback 证明有没有用。

## 4. current / compat / deprecated / dead 分类

### 4.1 current

后续应继续强化的主路径：

1. `Agent Skill Bundle` 作为技能包标准。
2. `ServiceSkill / SkillCatalog` 作为用户可见产品投影。
3. `SiteAdapterSpec` 作为站点类 adapter 标准。
4. `agent_runtime_submit_turn -> runtime_turn -> tool_runtime -> evidence` 作为执行主链。
5. `workspace / artifact / evidence pack` 作为任务产物与事实源。
6. `tool catalog` 中的 capability / lifecycle / permission plane。
7. 未来 Managed Objective 只能作为目标推进控制层挂到 `agent turn / subagent turn / automation job`，不能成为第四类 runtime。
8. `Agent envelope` 只能作为 Workspace / automation / memory / evidence 的产品组合面，不允许新增平行执行实体。
9. 组织 harness 的结果只能回到 `docs/roadmap/`、`docs/exec-plans/`、telemetry、artifact 和 evidence 主链。

### 4.2 compat

可以作为过渡支撑，但不应成为主叙事：

1. 手工创建的本地 skill scaffold。
2. seeded / fallback skill 目录。
3. debug-only DevBridge 调试入口。
4. 现有单场景 skill launch metadata。

这些可以继续服务 current 主链，但不能反向定义 generated capability 标准。

### 4.3 deprecated

后续不应继续扩展的表达和实现方向：

1. 把 generated capability 当成独立 runtime family。
2. 把 adapter 当成用户可见产品场景本体。
3. 为单个自动化场景自建状态机、scheduler、artifact 和 evidence。
4. 仅靠 prompt 描述权限与参数，而不进入结构化 contract。
5. 让高风险 API 调用只由模型自行判断是否安全。
6. 把 `/goal` 或 Managed Objective 当成新的长期执行实体，绕过 automation job 和 Query Loop。
7. 把 verified skill 直接当完整 Agent，跳过 memory、widget、schedule、permission 和 evidence 产品面。
8. 把 outcome telemetry 塞进 evidence pack，造成“执行事实”和“效果验证”事实源混淆。

### 4.4 dead

后续应明确判死的方向：

1. `GeneratedTool` 作为与 Skill / ServiceSkill / Adapter 平级的长期主类型。
2. agent 生成代码后绕过 tool_runtime 直接执行。
3. 外部 API / CLI 原始 schema 直接成为 Lime 运行时协议。
4. 为“更像 CREAO”而复制电商垂类产品结构。
5. 为自动化能力新增第二套 evidence pack。
6. 为了复刻 CREAO 而新增平行 AI PM、AB testing、memory 或 marketplace 系统。
7. 把公开 Marketplace 放在 workspace/team-scoped sharing 之前作为 P3/P4 主线。

## 5. 对 Lime 开发计划的直接要求

后续 `docs/roadmap/creaoai/` 必须做到：

1. 把 Skill Forge 写成 skills pipeline 的上游阶段，而不是新 runtime。
2. 把 generated capability 的结果固定为 Skill Bundle / Adapter Spec / ServiceSkill 投影。
3. 把 verification gate 写成注册前硬门槛。
4. 把 tool_runtime 与 evidence pack 写成唯一执行和事实源。
5. 把 workspace-local visibility 纳入首批产品验收。
6. 把 Codex `/goal` 参考单独留在 `docs/research/codex-goal/`；CREAO roadmap 只引用它来解释长期目标推进，不把它写成 Skill Forge 的一部分。
7. 把 Agent envelope 写成 Skill Forge 之后的产品层：成功任务可建议固化为 Agent，但执行仍走 automation job / Managed Objective。
8. 把 sandbox profile、memory 回流、outcome telemetry 写为 P3E/P4 之后的扩展约束，不抢当前 `tool_runtime` 授权裁剪主线。

## 6. 一句话结论

**CREAO 启发不推翻 Lime 的 skills pipeline；它要求 Lime 把 skills pipeline 从“安装和调用技能”升级为“生成、编译、验证、注册、rerun，并把成功任务固化为可审计 Agent”。**
