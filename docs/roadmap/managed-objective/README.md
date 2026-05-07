# Lime Managed Objective 路线图

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：把“一轮 agent turn”升级为“围绕一个业务目标持续推进，直到完成、阻塞、需要输入或耗尽预算”，同时确保执行仍收敛到 Lime current 主链。

依赖文档：

- [../../research/codex-goal/README.md](../../research/codex-goal/README.md)
- [../../aiprompts/query-loop.md](../../aiprompts/query-loop.md)
- [../../aiprompts/task-agent-taxonomy.md](../../aiprompts/task-agent-taxonomy.md)
- [../../aiprompts/state-history-telemetry.md](../../aiprompts/state-history-telemetry.md)
- [../../aiprompts/harness-engine-governance.md](../../aiprompts/harness-engine-governance.md)
- [../skill-forge/README.md](../skill-forge/README.md)

配套文档：

- [./architecture.md](./architecture.md)
- [./implementation-plan.md](./implementation-plan.md)
- [./diagrams.md](./diagrams.md)
- [./prototype.md](./prototype.md)

## 1. 这套路线图回答什么

`Managed Objective` 回答的问题是：

**当用户给出一个可判断完成的目标后，Lime 如何在多轮 agent turn / subagent turn / automation job 之间持续推进它，并在正确的时候停下来。**

它不回答：

1. skill 如何生成。
2. tool 如何注册。
3. 模型如何选择。
4. automation job 如何调度。
5. evidence pack 如何导出。

这些能力分别已有自己的 current 主链。`Managed Objective` 只能消费它们，不能替代它们。

这也是为什么实现 Skill Forge 方向时，不能只实现 Managed Objective：Coding Agent / Skill Forge 仍然必须作为上游能力生成层单独落地，详见 [../skill-forge/coding-agent-layer.md](../skill-forge/coding-agent-layer.md)。

## 2. 先给结论

`Managed Objective` 是 **目标推进控制层**，不是新 runtime。

固定判断：

1. 前台继续走 `agent turn`。
2. 协作继续走 `subagent turn`。
3. 后台继续走 `automation job`。
4. 续跑继续通过 `agent_runtime_submit_turn` / `runtime_queue`。
5. 完成审计继续消费 `artifact / thread_read / evidence pack`。
6. Workspace 只展示 objective 状态，不反向定义完成真相。

一句话：

**Managed Objective 让现有执行实体“知道为什么继续、何时停止”，但不新增第四类执行实体。**

## 3. 固定主链

后续所有实现必须收敛到下面这条链：

```text
用户目标 / 成功标准
  -> 绑定 owner：agent session / subagent session / automation job
  -> objective state：目标、状态、预算、阻塞原因、审计摘要
  -> continuation policy：是否允许启动下一轮
  -> agent_runtime_submit_turn / runtime_queue
  -> Query Loop / tool_runtime / automation service
  -> timeline / artifact / thread_read / evidence pack
  -> completion audit
  -> continue / needs_input / blocked / budget_limited / completed / failed / paused
```

这条主链意味着：

1. objective state 只保存目标推进状态，不保存另一份执行历史。
2. continuation policy 只决定是否发起下一轮，不执行工具。
3. completion audit 只消费 current 事实源，不让模型自报成为唯一依据。
4. durable 后台能力必须落到 automation job，不允许 objective 自己当 scheduler。
5. 子代理推进必须仍是 child session / subagent turn，不允许 objective 自己创建团队 runtime。

## 4. current / compat / deprecated / dead 分类

### current

后续继续强化的主路径：

1. `agent_runtime_submit_turn -> runtime_turn -> runtime_queue -> stream_reply_once`。
2. `agent turn / subagent turn / automation job` 三类一等执行实体。
3. `SessionDetail / AgentRuntimeThreadReadModel` 状态读模型。
4. `agent_runtime_export_evidence_pack` 证据事实源。
5. `automation job` 作为 durable 后台承载。
6. `Workspace artifact / task center / evidence UI` 作为展示面。

### compat

允许短期存在、但只能做适配的路径：

1. 将旧 prompt 续写语义映射为明确的 objective metadata。
2. 将现有 automation payload 适配为 objective owner。
3. 将已有 thread summary 显示为 objective audit 的辅助上下文。

退出条件：这些适配一旦能直接从 current state / evidence 读取，就删除兼容映射。

### deprecated

禁止继续扩展的方向：

1. 只靠 slash command 实现 `/goal`，但没有持久状态与审计。
2. 在 Query Loop 外新增 objective runner。
3. 让 automation job、UI、review 各自判断“目标是否完成”。
4. 给 objective 新增独立 queue、scheduler、tool registry 或 evidence exporter。
5. 把 `auto_continue` 当成 persistent objective。

### dead

可以直接否定的方向：

1. `goal_runtime` 作为第四类 runtime taxonomy。
2. `objective_evidence` 作为 evidence pack 的平行事实源。
3. 未绑定 owner 的后台 objective 自动执行。
4. 未经 artifact / evidence / thread_read 审计的自动完成状态。

## 5. 与 Codex `/goal` 的关系

[Codex `/goal`](../../research/codex-goal/README.md) 给 Lime 的启发是：

```text
persistent thread goal（同一会话线程上的持久目标状态）
  -> idle continuation
  -> completion audit
  -> budget / pause / resume / complete
```

这条链在研究文档里称为 [thread goal loop](../../research/codex-goal/README.md#11-什么是-thread-goal-loop)：

1. `thread` 是会话线程，不是系统线程。
2. `goal` 是绑定在该线程上的持久目标状态。
3. `loop` 是 runtime 在每轮 turn 结束后检查是否要继续发起下一轮 continuation turn。

但 Lime 不能照搬：

1. Codex `/goal` 是 thread-level experimental feature。
2. 它没有 Lime 的 automation job / workspace artifact / evidence pack 体系。
3. 它没有 `needs_input / blocked / failed / verifying` 这类业务状态。
4. 它的完成判断更依赖 prompt discipline，Lime 必须引入结构化 evidence audit。

因此本路线图只借鉴 runtime pattern，不复制 command surface。

## 6. 与 Skill Forge / Skill Forge 的关系

Skill Forge 路线图关注：

```text
能力生成 -> Skill / Adapter 编译 -> verification gate -> 注册 -> 执行
```

Managed Objective 关注：

```text
已存在的执行实体 -> 围绕目标继续推进 -> 审计完成或停止
```

二者关系：

1. Skill Forge 生产可复用能力。
2. Managed Objective 驱动这些能力围绕目标持续运行。
3. automation job / subagent / Query Loop 仍是实际执行者。
4. evidence pack 仍是完成审计事实源。

固定边界：

**不要把 Managed Objective 塞进 Skill Forge，也不要把 Skill Forge 当作 objective runtime。**

## 7. 首个推荐场景

推荐首个场景仍然保持低风险：

```text
给一个已验证的只读 workspace-local skill 创建每日目标：每天 9 点生成 Markdown 趋势摘要，直到满足“连续 7 天产出并无失败”或用户暂停。
```

这个场景能覆盖：

1. objective 绑定 automation job。
2. 每次运行走 Query Loop。
3. artifact 保存 Markdown 报告。
4. evidence pack 记录 skill 调用、产物、失败和审计。
5. completion audit 判断是否继续。
6. 失败时进入 `needs_input / blocked`，而不是盲目续跑。

首期不做：

1. 外部发布。
2. 自动下单或付款。
3. 自动改价。
4. 跨 workspace objective。
5. 多 agent 自主扩队。

## 8. 先读顺序

建议按下面顺序阅读和实现：

1. [../../research/codex-goal/README.md](../../research/codex-goal/README.md)
2. [../../aiprompts/task-agent-taxonomy.md](../../aiprompts/task-agent-taxonomy.md)
3. [../../aiprompts/query-loop.md](../../aiprompts/query-loop.md)
4. [../../aiprompts/state-history-telemetry.md](../../aiprompts/state-history-telemetry.md)
5. [./architecture.md](./architecture.md)
6. [./implementation-plan.md](./implementation-plan.md)
7. [./diagrams.md](./diagrams.md)

## 9. 完成判定

这套路线图完成时，Lime 至少应该能做到：

1. 用户能给 agent session 或 automation job 设置明确目标。
2. 系统能保存 objective state，并在 app 重启后恢复。
3. 系统能在安全条件满足时触发下一轮 continuation turn。
4. 系统能在证据不足、缺输入、阻塞、预算耗尽时停止自动续跑。
5. 系统能用 evidence pack / artifact / thread_read 支撑完成审计。
6. Workspace 能展示目标、状态、下一步、阻塞原因和证据入口。

一句话：

**目标推进不是“AI 再努力一点”，而是 runtime 用状态、预算、证据和停止条件把多轮执行管起来。**
