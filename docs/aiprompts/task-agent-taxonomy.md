# Task / Agent taxonomy 主链

## 这份文档回答什么

本文件定义 Lime 当前 `Task / Agent / Coordinator` 的唯一 taxonomy，主要回答：

- 哪些对象才算当前一等执行实体
- `agent turn`、`subagent turn`、`automation job`、`scheduler tick`、`execution run` 分别是什么关系
- `execution tracker / scheduler / subagent / automation` 各自属于哪一层，而不是继续互相抢“主入口”
- 哪些旧文档、旧术语、旧路径只能当专项说明或兼容壳，不能再反向定义当前主链

它是 **长时执行与协作编排的 current 事实源**，不是执行追踪专项计划，也不是单个服务的实现说明。

## 什么时候先读

遇到以下任一情况时，先读本文件：

- 调整 `agent_runtime_spawn_subagent`、`send_input`、`wait_agent`、`resume_agent`、`close_agent`
- 调整自动化任务的创建、调度、执行、投递或运行历史
- 调整 `ExecutionTracker`、`agent_runs`、执行状态聚合或 run 级读模型
- 调整 `SchedulerService`、`scheduled_tasks`、`cron.run` 或任何“后台轮询 / 心跳执行”逻辑
- 讨论“这是任务、子代理、自动化还是调度器”的边界归属

如果一个需求同时碰到“子代理 + 自动化”“调度 + 执行追踪”“会话回合 + 长时后台任务”里的两项以上，默认属于本主链。

如果这个需求还需要继续细分“内部服务任务、主对话任务、`service_models` 对应任务画像”，继续补读：

- `docs/roadmap/task/task-taxonomy.md`

## 固定 taxonomy

当前 Lime 只承认下面三类一等执行实体：

1. `agent turn`
   前台会话回合。统一走 `agent_runtime_submit_turn -> runtime_turn -> Query Loop` 主链。

2. `subagent turn`
   父会话派生出的 child session / teammate 回合。它是 `agent turn` 的协作变体，不是另一套执行引擎。

3. `automation job`
   可持久化、可延时、可周期触发的后台任务。它是 durable coordinator，统一由自动化服务承接。

下面两类不是一等执行实体：

- `scheduler tick`
  只是“发现到期任务并触发执行”的兼容触发器，不单独代表一个任务分类。

- `execution run`
  只是跨入口的执行摘要与生命周期记录，不是 coordinator。本层统一由 `ExecutionTracker` 与 `agent_runs` 承载。

固定规则只有一句：

**后续新增长时执行能力时，只允许落成 `agent turn`、`subagent turn` 或 `automation job` 三类之一；不允许再造第四类 runtime taxonomy。**

## 固定心智模型

当前主链统一按下面这张图理解：

`agent turn -> subagent turn / automation job -> ExecutionTracker(agent_runs) -> thread/session/evidence 读模型`

这条主链意味着：

1. `agent turn` 是前台交互入口，主事实源仍然是 `query-loop.md`
2. `subagent turn` 是 child session 的协作入口，复用当前 agent runtime 与会话事实，不单独发明另一套 task 状态机
3. `automation job` 是唯一 durable 后台任务入口，可以触发 agent turn，但不应该自己再发明第二套 run 摘要系统
4. `ExecutionTracker` 只负责“这次执行怎么开始、怎么结束、归因到哪里”，不负责调度、分工或 parent/child 编排
5. `scheduler tick` 只负责触发 due job，不负责定义产品层 task taxonomy

## 代码入口地图

### 1. `agent turn`

- `docs/aiprompts/query-loop.md`
- `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`
- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`

固定规则：

- 前台回合只有一条 Query Loop 主链
- 子代理回合如果进入模型执行，仍然复用这条主链
- 不允许为长时任务再造第二套“聊天执行入口”

### 2. `subagent turn`

- `src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs`
- `src-tauri/src/commands/aster_agent_cmd/command_api/subagent_api.rs`
- `src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs`

当前这里负责：

1. spawn child session / teammate
2. 写入父子会话与 team membership
3. 将 child turn 放入后台执行
4. 处理 `send_input / wait / resume / close`
5. 发出 runtime stream/status 事件，维持父子状态投影

固定规则：

- `subagent turn` 当前不是新的 `RunSource`
- 在执行摘要层，它继续复用 `chat` 会话型 run 与 `session_id / parent-child context / evidence` 关联
- 需要新增子代理能力时，优先扩展这里，而不是绕去 scheduler 或自动化任务

### 3. `automation job`

- `src-tauri/src/services/automation_service/mod.rs`
- `src-tauri/src/commands/automation_cmd.rs`
- `src/lib/api/automation.ts`

当前这里负责：

1. `automation_jobs` 的创建、更新、删除与启停
2. 后台轮询和到期任务执行
3. `run_job_now` 手动触发
4. 输出投递、健康聚合与运行历史
5. 与 `ExecutionTracker` 的 `RunSource::Automation` 对接

固定规则：

- durable 后台任务统一走自动化服务
- 如果一个需求需要“稍后执行 / 周期执行 / 无前台会话也能继续跑”，默认先落 `automation job`
- 自动化任务可以触发 agent turn，但不允许自己再维护第二份 run 历史真相

### 4. `execution run`

- `src-tauri/src/services/execution_tracker_service.rs`
- `src-tauri/crates/core/src/database/dao/agent_run.rs`
- `src-tauri/src/commands/execution_run_cmd.rs`

当前这里负责：

1. 为 `chat / skill / automation` 记录统一生命周期摘要
2. 暴露 `agent_runs` 只读查询
3. 统一终态与错误归一化

固定规则：

- `ExecutionTracker` 是观测层，不是 coordinator
- `RunSource::Chat` 覆盖前台与子代理会话型回合
- `RunSource::Skill` 代表独立 skill 执行摘要，不是新的 task taxonomy
- `RunSource::Automation` 代表后台任务执行摘要

### 5. `scheduler tick`

- `src-tauri/src/app/scheduler_service.rs`
- `src-tauri/crates/scheduler/*`
- `docs/develop/scheduler-task-governance-p1.md`

当前这里负责：

1. 轮询 `scheduled_tasks`
2. 发现 due task
3. 执行并标记完成 / 失败

固定规则：

- 它当前是 compat 触发壳，不再是主 taxonomy
- 后续允许做治理减法、冷却恢复、兼容委托
- 不允许继续在这里长新的产品级任务语义、统一状态页或第二套编排模型

## current / compat / deprecated / dead

### `current`

- `docs/aiprompts/task-agent-taxonomy.md`
- `docs/aiprompts/query-loop.md`
- `src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs`
- `src-tauri/src/services/automation_service/*`
- `src-tauri/src/services/execution_tracker_service.rs`
- `agent_runs`
- `automation_jobs`

这些路径共同构成当前唯一 taxonomy：

- 前台执行看 `agent turn`
- 协作执行看 `subagent turn`
- 后台 durable 执行看 `automation job`
- 执行摘要看 `ExecutionTracker`

### `compat`

- `src-tauri/src/app/scheduler_service.rs`
- `src-tauri/crates/scheduler/*`
- `scheduled_tasks`
- `docs/develop/scheduler-task-governance-p1.md`

保留原因：

- 仓库里仍存在到期任务轮询与 `cron.run` 兼容链路
- 这些路径目前仍承接“发现任务并执行”的历史职责

退出条件：

- 后续如果 scheduler 继续留存，也必须明确只做“触发器 / 兼容壳”
- 若有新的后台任务能力，一律先判断能否落到 `automation job`
- 不再允许把 scheduler 写成新的 coordinator 事实源

### `deprecated`

- `docs/develop/execution-tracker-technical-plan.md`
- `docs/develop/execution-tracker-deprecation-plan.md`
- `docs/develop/execution-tracker-p1-p2-roadmap.md`
- 任何新增的 `heartbeat_executions` 写路径或读取依赖
- 任何把 `heartbeat` 当成与 `chat / skill / automation` 并列 run source 的新设计
- 任何把 `scheduler tick / cron / 心跳任务` 当成独立 task taxonomy 的新设计

这些路径仍可作为历史实现说明或退场清单，但不再承担 current taxonomy 定义权。

### `dead`

- `automation_jobs.payload.browser_session`

当前自动化服务已在启动与执行阶段主动停用这类任务；它只能迁移或删除，不能继续创建、更新或恢复为 current 能力。

## 最低验证要求

如果本轮改动涉及本主链，至少按边界选择最贴近的验证：

- 纯文档 / 分类回写：`npm run harness:doc-freshness`
- 改 `ExecutionTracker` 或 `agent_runs`：相关定向 Rust 测试
- 改子代理 runtime：`subagent_runtime.rs` 或 `runtime_turn` 的定向测试
- 改自动化命令 / 服务：自动化服务定向测试，必要时补 `test:contracts`
- 改 scheduler / cron 命令：scheduler 或 websocket RPC 定向测试

## 这一步如何服务主线

`M2` 的目标不是把所有长时执行代码一次性重写，而是先把 taxonomy 收成唯一事实源。

从现在开始：

- 解释前台协作执行时，回到 `agent turn / subagent turn`
- 解释后台 durable 执行时，回到 `automation job`
- 解释执行摘要时，回到 `ExecutionTracker`
- 解释 scheduler 时，默认把它视为 compat 触发壳

这样后续的 `M3 Remote runtime`、`M4 Memory / Compaction`、`M5 State / History / Telemetry` 才不会继续被长时任务边界反复打断。
