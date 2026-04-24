# Lime 任务层 / 模型层验收标准

> 状态：验收标准已固定，单候选、细粒度路由事件链与 OEM `quota_low` 基础事实源已落地
> 更新时间：2026-04-24
> 作用：固定后续实现完成与否的判断方式，避免只看 UI 是否能切模型。
> 依赖文档：
> - `./rollout-plan.md`
> - `./model-routing.md`
> - `./runtime-integration.md`
> - `./event-chain.md`

## 1. 总体验收目标

实现完成后，Lime 至少要同时满足下面四件事：

1. 单模型时可解释
2. 多模型时可优化
3. `service_models` 能进入统一路由链
4. 自动与设置的优先级可被说明和验证

## 1.1 当前已通过的验收切片

截至 `2026-04-24`，current 主链已经通过下面这组基础验收：

1. 单候选场景会输出 `task_profile / candidate_count / routing_mode / capability_gap / limit_state`
2. `service_models.translation / prompt_rewrite / resource_prompt_rewrite` 已进入统一路由链
3. `task_profile_resolved / candidate_set_resolved / routing_decision_made / routing_fallback_applied / routing_not_possible / single_candidate_only / single_candidate_capability_gap` 已进入 runtime event 与前端协议
4. `cost_estimated / cost_recorded / rate_limit_hit / quota_blocked` 已进入 current runtime 事件链，`quota_low` 也已有统一协议与分类语义
5. `thread_read` 已能稳定读出 `task_kind / routing_mode / decision_source / candidate_count / capability_gap / limit_state / cost_state / limit_event`
6. OEM bootstrap/provider offer 中的 `quotaStatus=low` 或 `state=available_quota_low` 会通过 `harness.oem_routing` 进入 submit-turn metadata，并在后端稳定生成 `quota_low`
7. `history_compress` internal turn 已写入统一 `lime_runtime` metadata，并复用同一组 side events 语义
8. `topic / generation_topic / agent_meta` 辅助会话已补齐统一 `task_profile / routing_decision / limit_state / cost_state` metadata，`agent_generate_title / generate_persona` 也已能回传 auxiliary session 的 `execution_runtime` 诊断快照，但仍停留在 auxiliary/compat 观测面
9. TS 协议解析测试已覆盖新的路由与限额事件链，并补齐 `agent_generate_title` runtime 诊断结果解析

仍待继续的验收切片：

1. 更丰富的多候选自动优选策略
2. 更多 OEM policy 字段、服务端下发配额策略与设置页展示的闭环
3. `topic / generation_topic / agent_meta` 从 auxiliary session metadata 进一步提升到 current runtime 事件 / evidence 主链

## 2. 行为验收

### 2.1 单候选场景

当当前只有一个模型可用时：

1. 系统仍会生成 `TaskProfile`
2. 系统会输出 `candidate_count = 1`
3. 系统会输出 `routing_mode = single_candidate`
4. 系统不会宣称“已自动优选最佳模型”
5. 若能力不满足，会输出明确的 `capability_gap` 或阻断原因

### 2.2 多候选场景

当当前存在多个可用模型时：

1. 系统会按能力先过滤
2. 再按 OEM 与设置约束裁剪
3. 再按成本、限额、连续性优选
4. UI 能解释当前为什么选中该模型

### 2.3 `service_models` 场景

当任务命中 `workspace_preferences.service_models` 时：

1. 系统能识别对应槽位
2. 该设置会进入统一候选解析链
3. 若模型有效，会成为首选输入
4. 若模型失效或受限，会产生可解释回退

### 2.4 OEM 场景

当 OEM 为 `managed` 且只允许一个模型时：

1. 系统不得越界切本地模型
2. 系统必须明确当前受 OEM 约束
3. 若该模型能力不够，系统必须阻断或降级说明

### 2.5 自动与设置平衡

1. 显式 per-turn override 优先于自动策略
2. 会话硬锁定优先于自动策略
3. `service_models` 优先于普通默认模型
4. 自动策略只在允许范围内工作

## 3. 技术验收

以下字段至少应能在 runtime 或稳定读模型中看到：

- `task_kind`
- `settings_source`
- `candidate_count`
- `routing_mode`
- `decision_source`
- `decision_reason`
- `capability_gap`
- `estimated_cost_class`
- `limit_state`

补充说明：

- current submit-turn / internal-turn 主链当前必须稳定覆盖 `translation / prompt_rewrite / resource_prompt_rewrite / history_compress`
- `topic / generation_topic / agent_meta` 当前至少也要在 auxiliary session 元数据里保留同构字段，避免继续做成黑盒辅助调用

## 4. Telemetry 验收

至少应能稳定记录：

- `cost_estimated`
- `cost_recorded`
- `rate_limit_hit`
- `quota_low`
- `single_candidate_only`
- `single_candidate_capability_gap`
- `routing_fallback_applied`
- `routing_not_possible`

## 5. 事件链验收

至少应同时满足：

1. `task_profile_resolved -> routing_decision_made -> cost_recorded` 能形成同一条 turn 事实链
2. `rate_limit_hit / quota_blocked` 能进入 runtime event，而不是只留在 provider 错误文本
3. `single_candidate_only` 与 `single_candidate_capability_gap` 能投影到 thread read 或 diagnostics
4. evidence / review / replay 不需要重新猜测模型路由原因

## 6. UI 验收

前端至少应正确展示：

1. 当前任务类型或任务来源
2. 当前模型决策来源
3. 当前是否只有单候选
4. 当前是否存在能力缺口
5. 当前是否受 OEM 或限额约束

## 7. Evidence / 导出验收

evidence pack、review、analysis 或 thread read 至少应能反映：

1. 本次任务类型
2. 本次候选数量
3. 本次选择/回退原因
4. 本次成本与限额摘要

## 8. 非通过情形

以下情况一旦出现，视为未完成：

1. `service_models` 仍然绕过统一模型解析链
2. 单模型场景仍然对外显示“自动最优模型”
3. OEM 托管限制在 runtime 中不可见
4. 成本和限额只存在于 UI 本地状态
5. evidence 与 UI 使用不同一份模型决策事实
6. OEM 低额度只存在设置页或 bootstrap 本地状态，未进入 turn 级 metadata 与 runtime event

## 9. 建议测试样例

至少覆盖下面这些样例：

1. 只有一个 provider 和一个模型
2. 两个 provider、三个模型，且其中一个模型不支持 tools
3. `service_models.translation` 指向有效模型
4. `service_models.history_compress` 指向失效模型
5. OEM `managed` 且只给一个模型
6. OEM `hybrid` 且允许 fallback 到本地
7. 当前显式 override 与自动策略冲突

## 10. 完成判定

用户问“这套能力完成了么”时，先看主线是否完成：

- `TaskProfile`
- `CandidateModelSet`
- `RoutingDecision`
- 成本/限额事件
- `service_models` 统一进入路由

如果这五件事未同时成立，则不能算真正完成。

## 11. 这一步如何服务主线

本文件的主线收益是：

**把“模型选择看起来更聪明了”这种感性判断，变成可验证的工程完成标准。**
