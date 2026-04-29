# Lime 任务层 / 模型层架构蓝图

> 状态：提案
> 更新时间：2026-04-23
> 作用：固定这套设计的分层、职责、输入输出和不能越界的边界。
> 依赖文档：
> - `./overview.md`
> - `./task-taxonomy.md`
> - `./model-routing.md`
> - `./runtime-integration.md`
> - `./diagrams.md`

## 1. 固定架构目标

本蓝图只追求四个目标：

1. 把“任务定义”和“模型选择”解耦。
2. 支持单模型退化与多模型优化两种现实。
3. 让 `service_models`、会话模型、OEM 下发和自动策略进入同一条路由链。
4. 让成本/限额事件成为底层 runtime 事实。

## 2. 分层总览

后续统一按下面六层理解：

| 层 | 角色 | 输入 | 输出 |
| --- | --- | --- | --- |
| Product / UX Layer | 收集用户意图与显式设置 | 用户输入、模型选择器、设置页、OEM 状态展示 | 提交请求、显式锁定、展示解释 |
| Task Layer | 识别任务类型与能力需求 | 用户输入、工作台命令、服务任务入口、`service_models` | `TaskProfile` |
| Candidate Resolution Layer | 解析真实候选空间 | `TaskProfile`、会话状态、设置、OEM、configured providers、模型注册表 | `CandidateModelSet` |
| Model Routing Layer | 决定最终执行模型或降级模式 | `TaskProfile`、`CandidateModelSet`、限额与成本状态 | `RoutingDecision`、`ConfigureProviderRequest` |
| Runtime Execution Layer | 真正执行 turn 与副作用 | `ConfigureProviderRequest`、Query Loop 输入 | 运行时事件、timeline、artifact、usage |
| Cost / Limit / Telemetry Layer | 记录经济与约束信号 | usage、quota、rate limit、并发预算 | `RoutingEvent`、`LimitState`、RequestLog、thread read |

## 3. 每层固定职责

### 3.1 Product / UX Layer

允许承担的职责：

- 收集用户显式选择
- 传递 `request_metadata`
- 展示当前决策来源、限制、成本档

不允许承担的职责：

- 自己决定最终 provider/model
- 自己推断“当前可用候选集”
- 自己定义成本/限额真相

### 3.2 Task Layer

允许承担的职责：

- 判断这次任务是 `main_chat`、`translation`、`history_compress`、`service_scene` 还是内部服务任务
- 声明需要的能力、预算档、延迟目标、可见性

不允许承担的职责：

- 直接指定真实执行模型
- 跳过候选解析直接写死 provider/model

### 3.3 Candidate Resolution Layer

它是本专题新增的关键层，负责回答：

- 当前是否存在显式锁定
- 当前 `service_models` 是否为本任务提供首选模型
- 当前 OEM 是否限制候选集
- 当前本地 provider/model 是否可用
- 当前真实候选数量到底是 `0 / 1 / N`

这层输出的是“当前可选空间”，而不是“最后一定选谁”。

### 3.4 Model Routing Layer

这层只在候选空间已知的前提下工作。

它负责：

- 当 `candidate_count = 0` 时返回阻断理由
- 当 `candidate_count = 1` 时返回单候选透传或降级解释
- 当 `candidate_count > 1` 时做自动优选
- 生成统一 `RoutingDecision`

### 3.5 Runtime Execution Layer

它继续复用当前 Query Loop 主链：

- `agent_runtime_submit_turn`
- `runtime_turn.rs`
- `request_model_resolution.rs`
- `stream_reply_once(...)`

本专题不会新增第二条执行主链。

### 3.6 Cost / Limit / Telemetry Layer

这层负责把下面这些信号沉到底层：

- 估算成本
- 实际成本
- rate limit
- OEM quota
- provider parallel budget
- single candidate / no candidate / capability gap

## 4. 三个核心对象

### 4.1 `TaskProfile`

任务层产物，描述：

- `task_kind`
- `user_visibility`
- `latency_target`
- `budget_class`
- `required_capabilities`
- `fallback_policy`
- `settings_source`

### 4.2 `CandidateModelSet`

候选解析层产物，描述：

- 当前候选列表
- 候选来源
- 哪些被 OEM 或设置排除
- 是否只有单候选
- 是否存在硬约束

### 4.3 `RoutingDecision`

模型路由层产物，描述：

- 最终 provider/model
- `routing_mode`
- `decision_source`
- `decision_reason`
- `candidate_count`
- `degradation_reason`
- `fallback_chain`
- `limit_state_snapshot`

## 5. 设置面如何进入这套架构

### 5.1 会话模型设置

角色：

- 主对话默认偏好
- 显式锁定来源之一

### 5.2 `service_models`

角色：

- 任务级服务模型偏好输入
- 对 `topic / generation_topic / translation / history_compress / agent_meta / prompt_rewrite / resource_prompt_rewrite` 等内部服务任务提供首选模型

关键约束：

- `service_models` 不能继续是统一路由的旁路
- 它必须进入 `TaskProfile -> CandidateModelSet -> RoutingDecision`

### 5.3 OEM 设置

角色：

- 候选约束
- 配额约束
- 默认推荐

### 5.4 自动策略

角色：

- 在允许范围内做优化
- 不是最终事实源

## 6. 单模型与多模型的统一语义

这套设计不把“单模型”当异常，而把它当作主路径之一。

### 6.1 单模型

系统应输出：

- `routing_mode = single_candidate`
- 当前唯一候选是谁
- 当前能力缺口是什么
- 当前成本与限额状态是什么
- 是否需要用户显式切换或补充能力

### 6.2 多模型

系统才进入真正优选：

- 按任务能力需求过滤
- 按 OEM 与设置约束裁剪
- 按成本、限额、连续性、稳定性选择

## 7. 不允许继续发生的事情

1. `service_models` 直接绕过统一 runtime 模型解析。
2. OEM `defaultModel` 被前端直接当作最终真实模型。
3. UI 继续自己猜测“当前其实能不能切模型”。
4. 单模型场景里继续讲“自动多模型智能调度”。
5. 成本与限额只展示在面板，不进入 runtime 事实。

## 8. 建议落点

建议实现时优先落在这些边界：

- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`
  - 生成 `TaskProfile`
- `src-tauri/src/commands/aster_agent_cmd/request_model_resolution.rs`
  - 生成 `CandidateModelSet`
  - 生成 `RoutingDecision`
- `src/lib/api/agentExecutionRuntime.ts`
  - 扩展 execution runtime 读模型
- `src/lib/api/oemCloudControlPlane.ts`
  - 扩展 OEM policy 字段
- `src/components/settings-v2/agent/media-services/index.tsx`
  - 作为任务级偏好设置的 UI 来源之一，不再暗中充当执行真相

## 9. 这一步如何服务主线

这一步最大的主线收益是：

**把 Lime 当前“模型选择相关逻辑很多，但没有统一层次”的状态，收敛成可实现、可回写、可验收的六层架构。**
