# Managed Objective 图纸

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：用图固定 Managed Objective 与 Query Loop、automation job、evidence pack、Workspace 的边界。

配套原型：

- [prototype.md](./prototype.md)

本文负责架构图、状态图、时序图和流程图；产品 UI 原型统一放在 `prototype.md`。

## 1. 总体主链图

```mermaid
flowchart TB
    User[用户目标 / 成功标准] --> Entry[Objective Entry]
    Entry --> State[Managed Objective State<br/>目标 / 状态 / 预算 / 阻塞 / audit 摘要]
    State --> Owner{Owner Binding}
    Owner --> Session[Agent Session]
    Owner --> Subagent[Subagent Session]
    Owner --> Job[Automation Job]

    State --> Policy[Continuation Policy<br/>guard / budget / risk / pause]
    Policy -->|允许继续| Submit[agent_runtime_submit_turn]
    Policy -->|停止| Stop[needs_input / blocked / budget / paused / completed]

    Submit --> Queue[runtime_queue]
    Queue --> Runtime[Query Loop / tool_runtime]
    Runtime --> Facts[timeline / artifact / thread_read]
    Facts --> Evidence[evidence pack]
    Evidence --> Audit[Completion Audit]
    Audit --> State
    State --> Workspace[Workspace Projection]
    Workspace --> User
```

固定判断：

1. Objective state 只控制目标推进。
2. Runtime execution 仍属于 Query Loop。
3. Durable 触发仍属于 automation job。
4. 完成审计读取 evidence pack 后回写 objective state。

## 2. 不是第四类 runtime 图

```mermaid
flowchart LR
    RuntimeTaxonomy[Current Runtime Taxonomy] --> AgentTurn[agent turn]
    RuntimeTaxonomy --> SubagentTurn[subagent turn]
    RuntimeTaxonomy --> AutomationJob[automation job]

    Objective[Managed Objective<br/>control layer] --> AgentTurn
    Objective --> SubagentTurn
    Objective --> AutomationJob

    Dead[dead direction] -.禁止.-> GoalRuntime[goal_runtime]
    Dead -.禁止.-> ObjectiveQueue[objective_queue]
    Dead -.禁止.-> ObjectiveScheduler[objective_scheduler]
    Dead -.禁止.-> ObjectiveEvidence[objective_evidence]
```

固定判断：

**Managed Objective 只能挂到现有执行实体，不能成为第四类 taxonomy。**

## 3. 状态机图

```mermaid
stateDiagram-v2
    [*] --> active
    active --> verifying: turn 完成 / 手动审计
    verifying --> completed: evidence 满足全部 criteria
    verifying --> active: 未完成且可继续
    active --> needs_input: 缺输入 / 缺配置 / 缺确认
    active --> blocked: 外部依赖失败 / 权限阻塞
    active --> budget_limited: 预算耗尽
    active --> paused: 用户暂停 / interrupt
    active --> failed: 不可恢复失败

    needs_input --> active: 用户补齐输入
    blocked --> active: 阻塞解除
    budget_limited --> active: 用户调整预算
    paused --> active: 用户恢复
    failed --> active: 用户显式 reopen
    completed --> active: replace / reopen 新目标

    completed --> [*]
    failed --> [*]
```

固定判断：

1. `running / queued / scheduled` 不属于 objective 状态。
2. `completed` 必须来自 audit。
3. `needs_input / blocked / budget_limited / paused` 都会阻止自动续跑。

## 4. Manual continuation 时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant W as Workspace UI
    participant O as Objective State
    participant P as Continuation Policy
    participant Q as Query Loop
    participant E as Evidence Pack
    participant A as Audit

    U->>W: 点击继续目标
    W->>O: 读取 active objective
    O->>P: 请求 continuation decision
    P-->>W: 允许继续
    W->>Q: agent_runtime_submit_turn(objective metadata)
    Q-->>E: 导出执行事实
    E->>A: 提供 audit 输入
    A->>O: 写入 audit result
    O-->>W: 更新状态与下一步
```

固定判断：

**手动 continue 也必须走 `agent_runtime_submit_turn`，不能成为 UI 私有执行入口。**

## 5. Automation owner 时序图

```mermaid
sequenceDiagram
    participant S as Scheduler Tick
    participant J as Automation Job
    participant O as Objective State
    participant P as Continuation Policy
    participant R as Runtime Queue
    participant Q as Query Loop
    participant E as Evidence Pack
    participant A as Audit

    S->>J: 发现 due job
    J->>O: 读取绑定 objective
    O->>P: 检查 guard / budget / risk
    alt 不允许继续
        P-->>J: stop reason
        J-->>O: 写入 needs_input / blocked / budget_limited
    else 允许继续
        P-->>J: continue request
        J->>R: 投递标准 runtime turn
        R->>Q: 执行 agent turn
        Q->>E: 写入证据
        E->>A: 完成审计
        A->>O: 更新 objective status
        O-->>J: 更新 job run 摘要
    end
```

固定判断：

1. scheduler tick 只发现 due job。
2. automation job 是 durable owner。
3. objective 不自建 scheduler。
4. Query Loop 仍执行真实 turn。

## 6. Completion audit 流程图

```mermaid
flowchart TD
    Start[开始 audit] --> Criteria[读取 success criteria]
    Criteria --> Thread[读取 AgentRuntimeThreadReadModel]
    Thread --> Artifact[读取 artifact refs]
    Artifact --> Evidence[读取 evidence pack]
    Evidence --> Check{每条 criteria 是否有证据}

    Check -->|全部满足| Complete[completed]
    Check -->|部分不满足但可继续| Continue[continue / active]
    Check -->|缺用户输入| NeedsInput[needs_input]
    Check -->|外部阻塞| Blocked[blocked]
    Check -->|预算耗尽| Budget[budget_limited]
    Check -->|不可恢复| Failed[failed]

    Complete --> Result[ObjectiveAuditResult]
    Continue --> Result
    NeedsInput --> Result
    Blocked --> Result
    Budget --> Result
    Failed --> Result
```

固定判断：

1. `unknown` 不能判完成。
2. 模型总结只解释 evidence，不替代 evidence。
3. audit result 是 objective state 的输入，不是 evidence pack 的替代品。

## 7. 与 CreoAI / Skill Forge 的关系图

```mermaid
flowchart TB
    Forge[Skill Forge<br/>生成能力] --> Draft[Generated Capability Draft]
    Draft --> Gate[Verification Gate]
    Gate --> Skill[Workspace-local Skill]

    Skill --> Job[Automation Job / Agent Session]
    Job --> Objective[Managed Objective<br/>目标推进控制层]
    Objective --> Runtime[Query Loop / tool_runtime]
    Runtime --> Evidence[evidence pack / artifact]
    Evidence --> Objective

    Objective -.不是.-> ForgeRuntime[Skill Forge Runtime]
    Objective -.不是.-> ToolRegistry[Generated Tool Registry]
```

固定判断：

1. Skill Forge 负责生成能力。
2. Managed Objective 负责推进目标。
3. 两者都必须回到 current runtime 和 evidence 主链。

## 8. 后续改图规则

后续如果实现修改了状态机、owner 绑定或 audit 输入，必须同步更新本文。更新时遵守：

1. 图中不能新增第四类 runtime。
2. 图中不能让 objective 直接执行 tool。
3. 图中不能出现 evidence pack 的平行替代品。
4. 图中不能把 UI 画成完成状态事实源。
