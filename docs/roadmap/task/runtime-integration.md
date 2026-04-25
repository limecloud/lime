# Lime current 主链集成方案

> 状态：current runtime 已接入基础链路，并已补齐细粒度路由事件与 OEM `quota_low` 基础事实源
> 更新时间：2026-04-24
> 作用：说明任务层 / 模型层 / 经济事件如何挂回 Lime 现有 current 主链，而不是另造第二条运行时。
> 依赖文档：
> - `docs/aiprompts/query-loop.md`
> - `docs/aiprompts/state-history-telemetry.md`
> - `./task-taxonomy.md`
> - `./model-routing.md`
> - `./event-chain.md`

## 1. 固定前提

本专题不新增第二条执行主链。

统一继续挂回当前链路：

`agent_runtime_submit_turn -> runtime_turn.rs -> request_model_resolution.rs -> stream_reply_once -> thread_read / evidence / review`

## 2. 当前已落地的挂载点

### 2.1 `runtime_turn.rs`

当前已实现：

- 先调用 `resolve_runtime_request_provider(...)`，统一拿到 `provider_config + task_profile + routing_decision + limit_state`
- 把 `task_profile / routing_decision / limit_state / cost_state / limit_event` 写入 turn 级 `lime_runtime` metadata
- 在 prelude 发送：
  - `task_profile_resolved`
  - `candidate_set_resolved`
  - `routing_decision_made`
  - `routing_fallback_applied`
  - `routing_not_possible`
  - `limit_state_updated`
  - `single_candidate_only`
  - `single_candidate_capability_gap`
  - `cost_estimated`

不新增职责：

- 不在这里直接做最终模型优选

### 2.2 `request_model_resolution.rs`

当前已实现：

- 返回 `RuntimeRequestProviderResolution`，不再只回 `ConfigureProviderRequest`
- 统一构建：
  - `TaskProfile`
  - `RoutingDecision`
  - `LimitState`
  - `CostState`
  - `LimitEvent`
- 当前已识别：
  - `service_scene`
  - `summary`
  - `resource_search`
  - `translation`
  - `prompt_rewrite`
  - `artifact`
  - `vision_chat`
  - `search`
  - `task`
  - `chat`
- 当前已输出：
  - `candidate_count`
  - `estimated_cost_class`
  - `capability_gap`
  - `fallback_chain`
  - OEM `managed` / 禁止 fallback 时的 `oem_locked`
  - OEM `quotaStatus=low` 或 `available_quota_low` 对应的 `quota_low`

这里是模型层 current 主边界。

### 2.3 `agentExecutionRuntime.ts`

当前已扩展：

- `task_profile`
- `routing_decision`
- `limit_state`
- `cost_state`
- `limit_event`

让前端消费同一份稳定读模型，而不是自己再猜。

### 2.4 telemetry / thread read / evidence

按 current 主链继续挂：

- RequestLog
- `thread_read`
- evidence pack
- review / replay / analysis

当前已完成的最小收口是：

- `thread_read` 已能稳定投影 `task_kind / routing_mode / decision_source / candidate_count / capability_gap / estimated_cost_class / limit_state / cost_state / limit_event`
- `execution_runtime` 继续作为 evidence / handoff / replay / review 的同一事实入口，不再单独为这条链再造第二套状态

### 2.5 事件链挂载

任务层 / 模型层不再只留下对象，不留下事件。

当前已落地：

- `runtime_turn.rs`
  - `task_profile_resolved`
- `runtime_turn.rs`
  - `candidate_set_resolved`
- `runtime_turn.rs`
  - `routing_decision_made`
- `runtime_turn.rs`
  - `routing_fallback_applied / routing_not_possible`
- `runtime_turn.rs`
  - `limit_state_updated`
- `runtime_turn.rs`
  - `single_candidate_only / single_candidate_capability_gap`
- `runtime_turn.rs`
  - `cost_estimated / cost_recorded`
- `runtime_turn.rs`
  - `rate_limit_hit / quota_low / quota_blocked`
- `agent_runtime_compact_session`
  - `history_compress` internal turn 已写入同一份 `lime_runtime` metadata，并复用同一组 side events 生成逻辑
- `generate_title_with_agent / generate_persona`
  - `topic / generation_topic / agent_meta` 辅助会话已携带同构 `lime_runtime` metadata，但仍停留在 auxiliary/compat 观测面，不算 current submit-turn 事件主链
  - `agent_generate_title / generate_persona` 已开始把 auxiliary session 的 `execution_runtime` 诊断快照回传给命令结果，供调用方读取同构 `task_profile / routing_decision / limit_state / cost_state`
  - 这份命令结果诊断仍属于 auxiliary/compat 本地观察面，不等于 current submit-turn 的 thread read / evidence / replay 真相
- 图片任务稳定工件
  - `@配图` 首发与重试链已把 `agent_generate_title` 的完整结果透传到图片任务协议，并以 `title_generation_result` 固化到 task artifact payload
  - 这一步的定位是“稳定 task artifact 事实层”，用于后续重试、诊断、evidence 消费复读 auxiliary runtime 快照
  - evidence pack 已开始从图片 task artifact 提取 `title_generation_result.execution_runtime`，导出到 `runtime.json / artifacts.json / observabilitySummary.signalCoverage`
  - `runtime_replay_case_service / runtime_analysis_handoff_service / runtime_review_decision_service` 继续通过统一 evidence pack 复用这份辅助 runtime 快照，不再分别单点拼装
  - 它仍不等于 current submit-turn 的 thread/evidence/replay 主链，只是把 auxiliary 观察面从函数返回值提升到可持久化工件，并通过 evidence pack 进入统一消费面

当前已继续补齐：

- 多候选自动优选已进入 `request_model_resolution.rs` current 主链，并输出更完整的 `decision_reason`
- `thread_read` 已补齐 `decision_reason / fallback_chain / oem_policy / runtime_summary / auxiliary_task_runtime`，且当 current `execution_runtime` 缺失时，会从 auxiliary runtime task artifact 快照回退提升 `task_kind / service_model_slot / routing_mode / decision_source / decision_reason / candidate_count / fallback_chain / capability_gap / estimated_cost_class`
- `runtime_handoff_artifact_service / runtime_evidence_pack_service / runtime_replay_case_service / runtime_analysis_handoff_service` 已统一消费这组 current runtime 事实，减少旧的手工推断

仍待后续补齐：

- 更多 OEM policy 字段、服务端下发配额策略与设置页展示的闭环
- `topic / generation_topic / agent_meta` 已补齐 current submit-turn 入口识别、`service_model_slot` 映射与基础 side-event 覆盖；当前剩余缺口收缩为：补更完整的端到端验证与把 auxiliary 事实进一步沉到更稳定的 submit-turn 运行时来源。

这些事件的关系见 [event-chain.md](./event-chain.md)。

## 3. 设置来源如何进入 current 主链

建议统一识别下面这些来源：

| 来源 | 在 current 主链中的角色 |
| --- | --- |
| per-turn override | 硬锁定输入 |
| 会话模型 | 会话偏好或锁定输入 |
| `service_models` | 任务级偏好输入 |
| `service_scene_launch` | 场景级偏好输入 |
| OEM `providerPreference/defaultModel` | OEM policy 输入；基础 `quota_low` 已从 bootstrap offer 透传到 turn metadata |
| provider pool | 本地可用性输入 |

固定规则：

- 这些都只能作为路由输入
- 不应各自绕过统一解析链

当前已落地的优先级顺序：

1. 显式 `provider_config`
2. request 显式 `providerPreference / modelPreference`
3. `service_scene_launch`
4. `service_models.translation / prompt_rewrite / resource_prompt_rewrite`
5. session 默认 provider/model
6. 无候选时返回 `no_candidate`

补充说明：

- `service_models.history_compress` 已进入 current internal turn 统一事实链
- `service_models.topic / generation_topic / agent_meta` 当前已进入 auxiliary session 的统一 metadata，但还没有进入 submit-turn 的 current 路由优先级序列

## 4. `service_models` 的集成方式

Lime 当前已经存在：

- `workspace_preferences.service_models`
- 媒体服务设置页
- `useServiceModelsConfig`
- 多个内部服务任务对这些配置的消费

当前已落地原则：

1. `service_models` 先映射到 `TaskProfile.settings_source`
2. 再映射到 `CandidateModelSet` 的首选候选
3. 最终由 `RoutingDecision` 决定是否使用、回退还是阻断

当前已接入的槽位：

- `translation`
- `prompt_rewrite`
- `resource_prompt_rewrite`

当前已接入 current internal turn 事实链、但还未提升到 submit-turn 统一路由序列的槽位：

- `history_compress`

当前仅完成 auxiliary session metadata 对齐的槽位：

- `topic`
- `generation_topic`
- `agent_meta`

不允许继续维持：

- 某些服务任务直接偷读 `service_models` 决定最终模型
- 某些服务任务完全不进入统一模型层

## 5. 单模型集成语义

当 current runtime 只能解析到一个候选时：

- `CandidateModelSet.candidate_count = 1`
- `RoutingDecision.routing_mode = single_candidate`

必须继续做：

1. 能力校验
2. 限额与成本状态写入
3. 降级解释

不允许继续做：

- UI 假装进入了智能多模型选择

## 6. 建议增加的 runtime 元数据

建议在 turn 级 metadata 或 runtime state 中保留：

- `task_kind`
- `settings_source`
- `candidate_count`
- `routing_mode`
- `decision_source`
- `decision_reason`
- `capability_gap`
- `estimated_cost_class`
- `limit_state`
- `oem_mode`
- `fallback_chain`

## 7. thread read 与 evidence 的扩展建议

后续 thread read 至少应能稳定读出：

- 当前任务类型
- 当前路由模式
- 当前决策来源
- 当前是否单候选
- 当前是否存在能力缺口
- 当前 rate limit / quota / parallel budget 摘要
- 当前 OEM 是否限制回退

evidence pack 应继续消费这些事实，而不是自己重算。

## 8. current 主链里必须避免的事情

1. 在前端选择器里偷偷决定最终 provider/model。
2. 在某个服务任务调用点里新造第二套模型解析。
3. 在 OEM 接入层里直接强改最终模型而不留下 `RoutingDecision`。
4. 在 evidence 导出时重新猜测本次为什么选了这个模型。
5. 让路由与限额只存在函数内部，不进入 runtime event。

## 9. 分阶段集成建议

### 阶段 1：定义与透传

当前状态：已完成

- 先在 runtime metadata 中补齐 `TaskProfile` 与 `RoutingDecision` 壳

### 阶段 2：候选集解析

当前状态：已完成基础收口

- 先统一把设置、OEM、本地候选收口成 `CandidateModelSet`

### 阶段 3：单候选解释型路由

当前状态：已完成

- 先把单模型现实讲清楚并落盘

### 阶段 4：多候选自动优选

当前状态：已具备候选计数、成本档和 fallback 基础，但 richer 自动优选仍待继续

- 在候选集大于 1 时做自动优化

### 阶段 5：evidence 与 UI 收口

当前状态：已完成 thread read / protocol 基础收口，后续继续扩展更细粒度经济事件展示

- 把 thread read、evidence、review、UI 统一改成消费这组 runtime 事实

## 10. 这一步如何服务主线

本文件的主线收益是：

**保证这套设计是往 Lime current 主链里长，而不是平行再造一套“模型调度系统”。**
