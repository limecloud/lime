# Managed Objective 架构蓝图

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：定义 Managed Objective 的分层、状态、输入输出、事实源和禁止越界项。

依赖文档：

- [./README.md](./README.md)
- [../../research/codex-goal/README.md](../../research/codex-goal/README.md)
- [../../aiprompts/query-loop.md](../../aiprompts/query-loop.md)
- [../../aiprompts/task-agent-taxonomy.md](../../aiprompts/task-agent-taxonomy.md)
- [../../aiprompts/harness-engine-governance.md](../../aiprompts/harness-engine-governance.md)

## 1. 事实源声明

从现在开始，`Managed Objective` 只允许向下面这组事实源收敛：

```text
Objective state
  -> owner: agent session / subagent session / automation job
  -> execution: agent_runtime_submit_turn / runtime_queue
  -> facts: SessionDetail / AgentRuntimeThreadReadModel / artifact / evidence pack
  -> projection: Workspace UI / task center / review
```

固定规则：

1. objective state 是目标控制事实源。
2. execution facts 仍属于 Query Loop / automation / subagent 主链。
3. audit facts 仍属于 artifact / evidence pack。
4. UI projection 只能展示，不反向定义完成状态。

## 2. 分层总览

| 层 | 角色 | 输入 | 输出 | 禁止事项 |
| --- | --- | --- | --- | --- |
| Objective Entry | 创建、暂停、恢复、清除目标 | 用户目标、成功标准、owner | objective draft / active objective | 直接执行工具 |
| Owner Binding | 把目标挂到现有执行实体 | session id、subagent session id、automation job id | owner ref | 新增第四类执行实体 |
| Objective State | 保存目标推进状态 | objective metadata、audit result | status、budget、blocker、next action | 保存第二份 runtime history |
| Continuation Policy | 判断能否续跑 | state、queue、pending input、budget、risk | continue / stop decision | 自建 scheduler / queue |
| Runtime Dispatch | 发起下一轮执行 | continuation request | `agent_runtime_submit_turn` / runtime queue item | 绕过 Query Loop |
| Evidence Audit | 判断是否完成 | artifact、thread_read、evidence pack | audit decision | 只采信模型自报 |
| Workspace Projection | 给用户展示与操作 | objective state、audit summary | goal card / task card / evidence link | 成为事实源 |

## 3. 核心对象

### 3.1 `ManagedObjective`

概念对象，最小字段建议：

```text
objective_id
workspace_id
owner_kind: agent_session | subagent_session | automation_job
owner_id
objective_text
success_criteria[]
status
budget_policy
risk_policy
approval_policy
continuation_policy
last_audit_summary
last_evidence_pack_ref?
last_artifact_refs[]
blocker_reason?
created_at
updated_at
```

约束：

1. `owner_kind / owner_id` 必填。
2. `success_criteria` 必须能被审计，不能只是愿景口号。
3. `last_evidence_pack_ref` 是审计引用，不是 evidence pack 的替代品。
4. `continuation_policy` 只描述何时续跑，不包含工具调用实现。

### 3.2 `ObjectiveAuditResult`

概念对象，最小字段建议：

```text
audit_id
objective_id
decision: continue | completed | needs_input | blocked | budget_limited | failed
checked_criteria[]
evidence_refs[]
artifact_refs[]
thread_read_ref?
summary
next_action?
created_at
```

约束：

1. `completed` 必须有 evidence / artifact / thread_read 支撑。
2. `needs_input` 必须写清需要用户补什么。
3. `blocked` 必须写清阻塞来源和可恢复条件。
4. `failed` 必须写清是否允许用户恢复或重新计划。

## 4. 状态模型

Managed Objective 状态不是 run 状态，而是目标推进状态。

推荐状态：

```text
active
verifying
needs_input
blocked
budget_limited
paused
completed
failed
```

状态语义：

| 状态 | 语义 | 是否允许自动续跑 |
| --- | --- | --- |
| `active` | 目标可继续推进 | 允许，需通过 policy guard |
| `verifying` | 正在做完成审计 | 不允许启动新执行 |
| `needs_input` | 缺用户输入或配置 | 不允许，等用户响应 |
| `blocked` | 外部依赖、权限或失败阻塞 | 不允许，等解除阻塞 |
| `budget_limited` | token / 时间 / 成本预算耗尽 | 不允许，等用户调整预算 |
| `paused` | 用户暂停 | 不允许，等用户恢复 |
| `completed` | 审计确认完成 | 不允许 |
| `failed` | 不可恢复失败或用户终止 | 不允许，除非显式重开 |

状态转换：

```text
active -> verifying -> completed
active -> verifying -> active
active -> needs_input
active -> blocked
active -> budget_limited
active -> paused
active -> failed
paused -> active
needs_input -> active
blocked -> active
budget_limited -> active
completed -> active  # 仅限 replace / reopen 新目标
failed -> active     # 仅限用户显式 retry / reopen
```

固定边界：

1. `running` 是 owner 执行状态，不是 objective 状态。
2. `scheduled` 是 automation job 状态，不是 objective 状态。
3. `queued` 是 runtime queue 状态，不是 objective 状态。

## 5. Continuation Policy

自动续跑必须同时满足这些 guard：

1. objective status 是 `active`。
2. owner 仍存在且未被删除。
3. 当前没有 active turn。
4. runtime queue 没有同 owner 的未完成 continuation。
5. 没有 queued user input。
6. 没有 pending elicitation / pending approval。
7. 没有 user pause / interrupt。
8. budget policy 未耗尽。
9. risk policy 允许下一步动作。
10. 最近 audit 没有判定 `needs_input / blocked / completed / failed`。

触发来源只能是：

1. 前一轮 turn 完成。
2. automation job 到期。
3. 用户 resume。
4. 用户补齐输入或解除阻塞。
5. 手动点击继续。

禁止触发来源：

1. UI 轮询看到状态未完成就直接续跑。
2. evidence 导出脚本反向触发 runtime。
3. review / replay / analysis 消费方触发下一轮。
4. model 自己在普通回复里创建后台 continuation。

## 6. Completion Audit

完成审计必须按下面顺序读事实：

```text
objective success criteria
  -> current owner state
  -> SessionDetail / AgentRuntimeThreadReadModel
  -> artifacts
  -> evidence pack
  -> optional model audit prompt
  -> ObjectiveAuditResult
```

审计规则：

1. 先把目标转成可检查 criteria。
2. 每条 criteria 至少要标注 `satisfied / unsatisfied / unknown`。
3. `unknown` 不能被当作完成。
4. 外部动作结果必须有 tool call / artifact / evidence 引用。
5. 模型总结只能作为解释层，不能替代 facts。
6. 没有足够证据时默认 `continue`、`needs_input` 或 `blocked`，不要默认 `completed`。

## 7. 与现有主链的接口

### 7.1 Query Loop

- continuation turn 必须继续走 `agent_runtime_submit_turn`。
- continuation prompt 只能作为 `request_metadata` / prompt augmentation 的一部分。
- `TurnInputEnvelope` 必须能看见 objective metadata snapshot。

### 7.2 Task / Agent taxonomy

- objective owner 只能是 `agent turn / subagent turn / automation job` 对应的持久实体。
- objective 不新增 run source。
- execution tracker 仍只记录真实执行，不记录“目标想象中的进度”。

### 7.3 State / History / Telemetry

- objective projection 必须消费 `SessionDetail / AgentRuntimeThreadReadModel`。
- objective audit 引用 evidence pack，不复制 evidence pack。
- history record / dashboard 只能展示 objective audit 派生结果。

### 7.4 Harness Engine

- `agent_runtime_export_evidence_pack` 是 audit 的结构化输入。
- audit result 可以成为 evidence 的消费结果，但不能成为 evidence 源。
- replay / review 可以复用 audit result，但不能重建另一套 completion truth。

### 7.5 Automation Service

- automation job 是 durable owner。
- due job 可以触发 continuation policy。
- automation payload 可以包含 objective id，但不能让 objective 自建调度表。

## 8. 权限与风险边界

Managed Objective 必须继承 runtime 的权限纪律：

1. 外部写操作默认 `needs_approval`。
2. 金钱、发布、删除、改价、下单默认不允许自动续跑。
3. 浏览器登录态缺失应进入 `needs_input`。
4. API 凭证缺失应进入 `needs_input`。
5. 连续失败应进入 `blocked` 或 `failed`，不能无限重试。
6. 预算耗尽应进入 `budget_limited`，不能自动扩预算。

## 9. 最小实现边界

首期最小可交付不需要：

1. DAG workflow。
2. 多 agent 自主扩队。
3. 独立 objective scripting language。
4. UI 可视化工作流编辑器。
5. 外部写操作全自动执行。

首期必须具备：

1. owner binding。
2. objective state。
3. continuation guard。
4. evidence-based audit。
5. stop conditions。
6. workspace projection。

一句话：

**Managed Objective 的复杂度应该来自“停止条件和证据”，不是来自新调度器。**
