# Lime 成本 / 限额 / 配额事件底座

> 状态：提案
> 更新时间：2026-04-23
> 作用：定义成本、限额、配额和并发预算为什么必须沉到底层 runtime，以及统一事件模型应如何设计。
> 依赖文档：
> - `./model-routing.md`
> - `./runtime-integration.md`
> - `docs/aiprompts/state-history-telemetry.md`

## 1. 固定目标

后续 Lime 的“用户成本问题”不能只停留在：

- 模型卡片上的价格文案
- 设置页提示
- 一次性 toast

而要进入 runtime 底层，成为可记录、可导出、可回放、可审计的事实。

## 2. 为什么单模型也必须有经济事件

即使当前只有一个模型，系统仍然需要知道：

1. 这个任务成本是否过高
2. 当前模型是否已到 rate limit
3. 当前 OEM quota 是否不足
4. 当前 provider parallel budget 是否打满
5. 当前只能使用单候选是否导致更贵或更慢

所以成本/限额事件与“是否多模型”无关。

## 3. 底层信号来源

后续统一从这些来源读取：

| 来源 | 作用 |
| --- | --- |
| 模型注册表 `pricing` | 估算成本 |
| 实际 token usage | 记录真实消耗 |
| provider runtime governor | 并发预算与排队状态 |
| OEM offer / quota | 会话级配额与使用限制 |
| provider 错误与 rate limit 错误 | 限流事实 |

## 4. 建议的核心对象

### 4.1 `LimitState`

描述当前约束快照，最少包含：

- `rate_limit_status`
- `quota_status`
- `parallel_budget`
- `active_count`
- `queued_count`
- `oem_access_mode`
- `single_candidate_only`

### 4.2 `RoutingEvent`

建议的事件类型：

- `cost_estimated`
- `cost_recorded`
- `rate_limit_hit`
- `quota_low`
- `quota_blocked`
- `provider_parallel_budget_reached`
- `single_candidate_only`
- `single_candidate_capability_gap`
- `routing_fallback_applied`
- `routing_not_possible`

## 5. 事件语义

### 5.1 `cost_estimated`

在真正 dispatch 前产生。

用途：

- 告知当前预计成本档
- 帮助自动策略判断是否需要避开高成本候选

### 5.2 `cost_recorded`

在 provider 返回 usage 后产生。

用途：

- 记录真实开销
- 写入 telemetry 和 evidence

### 5.3 `rate_limit_hit`

表示 provider 或 OEM 限流已发生。

用途：

- 驱动 fallback
- 写入 thread read

### 5.4 `single_candidate_only`

表示当前没有真正路由空间。

用途：

- 对外解释当前为什么不能自动切模型
- 对内指导产品不要伪造自动优选

### 5.5 `single_candidate_capability_gap`

表示当前唯一候选不满足任务能力。

用途：

- 明确降级或阻断原因

## 6. 事件落点

统一要求这些事件进入：

1. runtime turn metadata
2. RequestLog / request telemetry
3. `AsterSessionExecutionRuntime`
4. `thread_read`
5. evidence pack

不允许只留在页面本地状态。

## 7. UI 只是消费层

前端可以展示：

- 成本档
- 限流告警
- 当前只能用单模型
- 当前任务被 OEM 配额限制

但 UI 不应：

- 自己估算真实成本
- 自己定义 rate limit 状态
- 自己猜测是否 single candidate

## 8. 与自动调度的关系

自动调度只消费这些经济事件，不生产最终真相。

例如：

- `cost_estimated = high` 且存在更便宜同能力候选时，可切换
- `single_candidate_only = true` 时，不应对外宣称“已自动优化”
- `quota_low` 时可提示用户改用本地候选，但前提是 OEM 模式允许

## 9. 与 `service_models` 的关系

如果任务来自 `service_models`：

- 仍然要产生成本和限额事件
- 不能因为它是内部服务任务，就不记录经济信号

## 10. 当前必须避免的误区

1. 只有多模型时才需要成本事件。
2. `pricing` 缺失时伪造成本最优结论。
3. provider 并发预算只显示在调试面，不写入 runtime。
4. OEM 配额只在 OEM 页面展示，不进入 turn 事实。

## 11. 这一步如何服务主线

本文件的主线收益是：

**让 Lime 后续讨论用户成本问题时，讨论的是一条 runtime 事实链，而不是零散 UI 文案。**
