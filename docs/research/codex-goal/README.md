# Codex `/goal` 研究笔记

> 状态：current research reference  
> 更新时间：2026-05-05  
> 来源：本地源码调研 `/Users/coso/Documents/dev/rust/codex`  
> 目标：把 Codex `/goal` 拆成独立 runtime pattern，判断它对 Lime “一轮 agent turn -> 持续推进目标” 的启发与边界。

## 1. 为什么单独成文档

`/goal` 不应该放进 Skill Forge 研究目录里当附属小节。

原因是它研究的不是 Tool-Maker Agent，也不是电商运营自动化，而是另一个更小、更底层的 runtime pattern：

```text
persistent thread goal
  -> idle continuation turn
  -> completion audit
  -> budget / pause / resume / complete 状态机
```

它回答的问题是：

**一个 agent turn 结束后，系统如何知道还要不要继续推进同一个目标。**

这和 Skill Forge 的三层架构有关，但不等同：

| 研究对象 | 主要回答什么 | Lime 对应层 |
| --- | --- | --- |
| Skill Forge / Tool-Maker Agent | 能力如何被生成、验证、注册、长期运行 | Skill Forge / skills pipeline 上游 |
| Codex `/goal` | 一个 thread goal 如何跨多轮 turn 自动续跑直到完成、暂停或耗尽预算 | Query Loop / automation job 上的目标推进控制环 |

固定结论：

**`/goal` 是独立研究对象；它可以作为 Lime Managed Objective 的参考，但不应被写成 Skill Forge 或 Skill Forge 的子章节。**

### 1.1 什么是 Thread Goal Loop

`thread goal loop` 是本文对 Codex `/goal` 这类机制的简写，不是 Codex 源码里的单一类型名。

先拆开看：

1. **thread**
   - 指 Codex 的一个会话线程 / 工作上下文，不是操作系统线程。
   - goal 被持久绑定到 `thread_id`，所以它跟着同一个对话线程延续，而不是跟着某一次模型回复延续。

2. **goal**
   - 指这个 thread 当前要持续推进的目标。
   - Codex 会保存目标文本、状态、token 预算、已用 token、已用时间、创建和更新时间。
   - 它不是 prompt 里一句“请继续努力”，而是 state DB 里的持久状态。

3. **loop**
   - 指 runtime 在一轮 turn 结束并进入 idle 后，会检查这个 thread 是否仍有 active goal。
   - 如果满足续跑条件，runtime 会注入 continuation prompt，启动下一轮普通 task。
   - 下一轮执行结束后再审计目标是否完成；未完成就继续保持 active，等待下一次 idle continuation。

所以 `thread goal loop` 的完整含义是：

```text
同一个会话线程上有一个持久目标
  -> 每轮执行结束后 runtime 检查目标是否仍 active
  -> 空闲且安全时自动发起下一轮 continuation turn
  -> 模型基于当前证据做 completion audit
  -> 完成则 update_goal complete
  -> 未完成则保持 active，下一次 idle 后继续
```

它不是下面这些东西：

1. 不是单次模型调用里的 `while` 循环。
2. 不是 cron 定时任务。
3. 不是 workflow DAG。
4. 不是 Skill Forge。
5. 不是 automation job。
6. 不是 evidence pack。

更接近的心智模型是：

```text
把“帮我完成这个目标”从一次回复，提升为 thread 上的一条持久控制状态。
runtime 负责在合适的时机继续开下一轮 turn。
模型负责在每轮里做事，并在证据足够时请求标记 complete。
```

一个最小例子：

```text
用户：/goal 把这个仓库的本地测试修到通过

第 1 轮：
  Codex 读测试、修一部分问题、运行部分检查，但还没全绿。
  runtime 结算 token/time，goal 仍 active。

idle 后：
  runtime 发现没有用户新输入、没有 pending interrupt、goal 仍 active。
  runtime 注入 continuation prompt，启动第 2 轮。

第 2 轮：
  Codex 继续修剩余测试，运行验证。
  如果证据显示目标完成，模型调用 update_goal complete。
  否则 goal 继续 active，后续再续跑。
```

这个词最关键的边界是：

**loop 的拥有者是 runtime，不是模型自发“再来一轮”；goal 的作用域是 thread，不是 workspace 级业务任务。**

## 2. 图纸入口

如果先想通过图理解 Thread Goal Loop，直接看：

- [diagrams.md](./diagrams.md)

该图纸包含：总体架构图、分层架构图、流程图、关键时序图、completion audit 时序图、状态机图、与 Lime Managed Objective 的对照图、最小心智原型图。

## 3. 源码事实地图

以下路径均相对本地 Codex 仓库：

`/Users/coso/Documents/dev/rust/codex`

### 3.1 Feature flag

- `codex-rs/features/src/lib.rs:200`
  - `Feature::Goals`
  - 注释：启用 persisted thread goals 与 automatic goal continuation
- `codex-rs/features/src/lib.rs:1027`
  - key：`goals`
  - stage：`Experimental`
  - 默认关闭
  - menu description：`Set a persistent goal Codex can continue over time`

判断：

**`/goal` 不是稳定默认能力，而是 experimental runtime feature。**

### 3.2 TUI slash command

- `codex-rs/tui/src/slash_command.rs:115`
  - `/goal` 描述为：`set or view the goal for a long-running task`
- `codex-rs/tui/src/chatwidget/slash_dispatch.rs:624`
  - 支持 `/goal <objective>`
  - 支持 `/goal clear`
  - 支持 `/goal pause`
  - 支持 `/goal resume`

判断：

**slash command 只是入口，不是能力本体。能力本体在 core runtime。**

### 3.3 App-server protocol

- `codex-rs/app-server-protocol/src/protocol/common.rs:492`
  - `thread/goal/set`
  - `thread/goal/get`
  - `thread/goal/clear`
- `codex-rs/app-server-protocol/src/protocol/common.rs:1416`
  - `thread/goal/updated`
  - `thread/goal/cleared`
- `codex-rs/app-server-protocol/src/protocol/v2.rs:4218`
  - `ThreadGoal` 结构
- `codex-rs/app-server-protocol/src/protocol/v2.rs:4252`
  - `ThreadGoalSetParams`

判断：

**Codex 把 goal 做成 thread-level protocol surface，而不是只在 TUI 内部实现。**

### 3.4 State DB

- `codex-rs/state/migrations/0029_thread_goals.sql:1`
  - 表：`thread_goals`
  - 主键：`thread_id`
  - 字段：`goal_id / objective / status / token_budget / tokens_used / time_used_seconds / created_at_ms / updated_at_ms`
- `codex-rs/state/src/model/thread_goal.rs:12`
  - 状态：`Active / Paused / BudgetLimited / Complete`

判断：

**目标是持久状态，不是 prompt 里的临时约定。**

### 3.5 Core runtime

核心文件：

- `codex-rs/core/src/goals.rs`

关键点：

- `codex-rs/core/src/goals.rs:266`
  - 注释明确 runtime policy：turn start、tool completion、budget steering、interrupt pause、thread resume restore、idle continuation。
- `codex-rs/core/src/goals.rs:1062`
  - `maybe_continue_goal_if_idle_runtime`
- `codex-rs/core/src/goals.rs:1067`
  - active goal 空闲续跑启动逻辑
- `codex-rs/core/src/goals.rs:1146`
  - active goal continuation candidate 条件
- `codex-rs/core/src/goals.rs:1292`
  - Plan mode 不触发 goal continuation

判断：

**`/goal` 的关键价值是 runtime-owned continuation，而不是模型自发说“我继续”。**

### 3.6 Model-visible tools

- `codex-rs/tools/src/goal_tool.rs:12`
  - `get_goal`
  - `create_goal`
  - `update_goal`
- `codex-rs/tools/src/goal_tool.rs:48`
  - `create_goal` 只能在用户或 system/developer 明确要求时创建，不能从普通任务自动推断。
- `codex-rs/tools/src/goal_tool.rs:62`
  - `update_goal` 只暴露 `complete`。
- `codex-rs/core/src/tools/handlers/goal.rs:161`
  - handler 层再次拒绝非 complete 状态更新。

判断：

**模型可以读取和完成 goal，但不能自行 pause、resume 或 budget-limit。控制权被分给用户和系统。**

### 3.7 Continuation prompt

- `codex-rs/core/templates/goals/continuation.md:1`
  - `Continue working toward the active thread goal.`
- `codex-rs/core/templates/goals/continuation.md:17`
  - 完成前必须做 completion audit。
- `codex-rs/core/templates/goals/continuation.md:26`
  - 只有审计证明目标实际完成，才调用 `update_goal complete`。
- `codex-rs/core/templates/goals/budget_limit.md:1`
  - budget 达到后，系统提示不再开始新的实质工作，只总结进展、剩余工作和下一步。

判断：

**Codex 的完成判定主要依赖 prompt-level audit + `update_goal complete` 工具闭环。**

## 4. `/goal` 的系统结构

可以稳定抽象为五层：

```text
TUI / API Entry
  -> ThreadGoal State
  -> Goal Runtime Hooks
  -> Idle Continuation Scheduler
  -> Model Audit + update_goal
```

### 4.1 入口层

入口层包括：

1. `/goal <objective>`
2. `/goal pause`
3. `/goal resume`
4. `/goal clear`
5. `thread/goal/set|get|clear`

它只负责创建、查询和用户控制，不负责执行目标。

### 4.2 状态层

状态层是 `thread_goals` 表。

它记录：

1. 当前目标是什么。
2. 当前状态是否 active。
3. token 预算和已用 token。
4. 已用时间。
5. 创建和更新时间。

它不记录：

1. 结构化任务 DAG。
2. 多 step checklist。
3. artifact refs。
4. evidence refs。
5. workspace-level job 关系。

### 4.3 Runtime hook 层

runtime 会监听：

1. turn started。
2. tool completed。
3. turn finished。
4. task aborted。
5. external set / clear。
6. thread resumed。
7. maybe continue if idle。

它负责：

1. 捕获 active goal 的 token baseline。
2. 结算 token/time usage。
3. budget 达到时注入 budget steering。
4. interrupt 时暂停 active goal。
5. resume 后恢复 runtime accounting。

### 4.4 Continuation scheduler 层

核心判断：

```text
if feature enabled
and not Plan mode
and no active turn
and no queued input
and no pending trigger mailbox input
and persisted thread has active goal
then inject continuation developer prompt
and start a new regular task
```

这解释了为什么它能把“一轮 turn”升级为“多轮持续推进”。

### 4.5 Audit completion 层

模型在 continuation prompt 中被要求：

1. 把 objective 转成 success criteria。
2. 建 prompt-to-artifact checklist。
3. 检查真实文件、命令输出、测试、PR 状态等证据。
4. 不把代理信号直接当完成。
5. 不确定就继续。
6. 真完成才调用 `update_goal complete`。

固定判断：

**`update_goal complete` 是模型可调用的完成出口，但完成判断仍是 prompt discipline，而不是强结构化 verifier。**

## 5. 状态机

Codex `/goal` 的状态机很小：

```text
active
  -> paused          用户 pause 或 interrupt
  -> budget_limited  runtime 预算耗尽
  -> complete        模型 update_goal complete 或外部设置

paused
  -> active          用户 resume
  -> complete        外部设置
  -> clear           用户 clear

budget_limited
  -> complete        只有目标真的完成才 complete
  -> clear           用户 clear

complete
  -> active          replace goal 时新 goal active
  -> clear           用户 clear
```

注意：

1. 没有 `blocked`。
2. 没有 `needs_input`。
3. 没有 `failed`。
4. 没有 `verifying`。
5. 没有 `scheduled`。

这说明 Codex `/goal` 是 [thread goal loop](#11-什么是-thread-goal-loop)，不是完整业务任务状态机。

## 6. 它到底是不是 RALF 类循环

可以说像，但要限定范围。

相似点：

1. 都是“检查当前状态 -> 做下一步 -> 再检查 -> 直到完成”。
2. 都强调不要把局部进展误判为完成。
3. 都试图把单次 agent response 升级成持续推进。

不同点：

1. Codex `/goal` 是 runtime-managed，不只是 prompt 手法。
2. 它有持久 goal state 和 token/time accounting。
3. 它会在 idle 时自动开 continuation turn。
4. 它没有完整 workflow DAG 或 business process schema。
5. 它的完成审计仍主要依赖模型执行 prompt checklist。

固定表述：

**Codex `/goal` 是 RALF-like loop 的 runtime 化最小实现，不是完整业务 workflow engine。**

## 7. 它不是什么

### 7.1 不是 Skill Forge

Skill Forge 负责：

```text
能力缺口 -> 生成 Skill Bundle / Adapter / Contract / Test -> Verification -> Registration
```

Codex `/goal` 负责：

```text
active objective -> idle continuation turn -> audit -> complete / continue
```

二者一前一后：

- Skill Forge 生产能力。
- Goal loop 使用能力持续推进目标。

### 7.2 不是 skills pipeline

skills pipeline 负责：

1. 能力包标准。
2. 产品投影。
3. slot schema。
4. runtime binding。
5. catalog 发现。

`/goal` 负责：

1. 目标持久化。
2. 空闲续跑。
3. 状态控制。
4. 完成审计。

二者不冲突，但也不能互相替代。

### 7.3 不是 automation job

automation job 负责：

1. durable scheduling。
2. 到点触发。
3. 后台执行。
4. 运行历史。

`/goal` 负责：

1. 目标是否仍 active。
2. 当前是否该继续下一轮。
3. 什么时候标记 complete。

在 Lime 里，goal-like 机制应挂到 automation job 或 agent session 上，而不是替代 automation job。

### 7.4 不是 evidence pack

evidence pack 负责记录事实：

1. timeline。
2. artifacts。
3. tool calls。
4. verification outcomes。
5. request telemetry。

Codex `/goal` 本身不导出类似 Lime evidence pack 的结构化证据包。它通过 prompt 要求模型检查证据，但状态表不保存 artifact/evidence refs。

固定判断：

**Lime 如果借鉴 `/goal`，完成审计必须比 Codex 更结构化，默认消费 evidence pack，而不能只靠模型自报。**

## 8. 对 Lime 的映射

### 8.1 Lime 已有底座

Lime 当前已经有下面这些相关事实源：

1. `docs/aiprompts/query-loop.md`
   - `agent_runtime_submit_turn -> runtime_turn -> TurnInputEnvelope -> runtime_queue -> stream_reply_once -> timeline / artifact / memory -> thread_read / evidence / replay / review`
2. `docs/aiprompts/task-agent-taxonomy.md`
   - 一等执行实体只有 `agent turn / subagent turn / automation job`
3. `docs/aiprompts/skill-standard.md`
   - runtime binding 为 `agent_turn / browser_assist / automation_job / native_skill`
4. `docs/aiprompts/harness-engine-governance.md`
   - evidence pack 是运行时事实源
5. `src-tauri/src/services/automation_service/executor.rs`
   - automation job 当前可把 payload 映射成一次 agent turn 并进入 runtime queue
6. `src-tauri/src/commands/aster_agent_cmd/prompt_context.rs`
   - 已有 `auto_continue`，但它是文稿续写 prompt augmentation，不是持久目标 runtime

### 8.2 Lime 当前缺口

Codex `/goal` 暴露出 Lime 的一个具体缺口：

**Lime 有 durable scheduling 和 agent turn，但缺少一个持久 objective 驱动多轮 continuation 的控制层。**

更细地说，缺四件事：

1. **Objective state**
   - 当前没有类似 `thread_goals` 的目标状态事实源。

2. **Idle continuation policy**
   - 当前 runtime queue 能接下一条 queued turn，但没有“active objective 仍未完成时自动生成下一轮 continuation turn”的通用策略。

3. **Completion audit contract**
   - 当前 evidence pack 很强，但还没有被 goal-like 状态机明确用作“完成审计输入”。

4. **Goal 与 automation/subagent/session 的绑定关系**
   - 当前自动化可以跑一轮 agent turn，但“这个 job 的业务目标是否已完成、是否需要继续、是否 blocked”还不是统一事实。

### 8.3 Lime 不应照搬的部分

1. 不应新增第四类执行实体。
2. 不应只做 `/goal` slash command。
3. 不应把 goal 状态只绑定 thread。
4. 不应只靠模型调用 `update_goal complete` 判断完成。
5. 不应绕过 automation job 做新的 durable scheduler。
6. 不应让 goal loop 反过来定义 Skill / ServiceSkill / Adapter 标准。

## 9. Lime 借鉴方向

后续如果进入 roadmap，建议把这层暂称为：

**Managed Objective Layer**

但它必须是控制层，不是新的 runtime taxonomy。

推荐落位：

```text
agent session / automation job
  -> objective state
  -> continuation policy
  -> Query Loop agent turn
  -> artifact / evidence
  -> audit result
  -> continue / pause / needs_input / blocked / complete
```

最小对象不应直接照抄 Codex，而应结合 Lime：

```text
objective_id
workspace_id
session_id?
automation_job_id?
root_turn_id?
status
objective_text
success_criteria[]
budget_policy
risk_policy
approval_policy
artifact_refs[]
evidence_pack_refs[]
last_audit_summary
created_at
updated_at
```

推荐状态比 Codex 更多：

```text
active
paused
needs_input
blocked
budget_limited
complete
failed
```

原因：

1. Lime 有业务自动化，不只是 coding thread。
2. Lime 有 slot filling / elicitation。
3. Lime 有外部权限、浏览器登录态、workspace artifact。
4. Lime 有 evidence pack，可以支持更强审计。

## 10. 和 Skill Forge 研究的关系

Codex `/goal` 可以补 Skill Forge 三层架构里的第二层视角：

```text
Skill Forge 三层：
Coding Agent / Agent Builder
  -> Autonomous Execution / Runtime
  -> Workspace / Agent App Surface

Codex /goal 对应：
Autonomous Execution / Runtime 里的 persistent objective + continuation loop 子模式
```

但它不覆盖：

1. Tool-Maker Agent。
2. Generated Capability Draft。
3. Skill / Adapter 编译。
4. Workspace-local skill catalog。
5. 业务任务中心。

因此两个研究目录应分工：

- `docs/research/skill-forge/`：研究“能力如何被 agent 生成并长期运行”。
- `docs/research/codex-goal/`：研究“目标如何跨 turn 被 runtime 持续推进”。

## 11. 研究结论

1. Codex `/goal` 是独立 runtime pattern，不是普通 slash command。
2. 它把 thread-level objective 持久化，并在 idle 时自动启动 continuation turn。
3. 它的完成闭环依赖 model-visible `update_goal complete` 与 continuation prompt 的 completion audit。
4. 它比纯 prompt RALF 稳，因为 runtime 负责状态、预算、暂停、恢复和续跑。
5. 它又比完整业务 workflow 小，因为没有 DAG、workspace job、artifact/evidence refs 和复杂阻塞态。
6. 对 Lime 的真正启发是补一层 Managed Objective，而不是复制 `/goal` 命令。
7. Managed Objective 必须折回 Lime 现有 `agent turn / subagent turn / automation job` taxonomy，不允许成为第四类 runtime。
8. Lime 如果实现这层，完成审计应消费 evidence pack，而不是只靠模型自报。

## 12. 已落成的 Lime 路线图

这个研究已经落成独立 Lime roadmap：

1. `docs/roadmap/managed-objective/README.md`
2. `docs/roadmap/managed-objective/architecture.md`
3. `docs/roadmap/managed-objective/implementation-plan.md`
4. `docs/roadmap/managed-objective/diagrams.md`

它不直接塞进 `docs/roadmap/skill-forge/`，除非只是说明两者关系。

一句话：

**Codex `/goal` 研究应服务 Lime 的目标推进控制层；Skill Forge 研究应服务 Lime 的能力生成与长期业务自动化闭环。两者有关，但必须分开建模。**
