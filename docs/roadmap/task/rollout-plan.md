# Lime 任务层 / 模型层分阶段落地计划

> 状态：分阶段计划已建立，P0 / P1 / P2 已落地，P4 完成基础收口
> 更新时间：2026-04-23
> 作用：给后续实现提供分阶段顺序，避免一上来就做理想化全自动多模型。
> 依赖文档：
> - `./runtime-integration.md`
> - `./acceptance.md`

## 1. 固定实施原则

这套能力必须按下面顺序推进：

1. 先把语言和数据结构立住
2. 再把候选解析立住
3. 先让单模型现实可解释
4. 再让多模型现实可优化
5. 最后做 UI、telemetry 和 evidence 收口

## 2. 分阶段计划

| 阶段 | 目标 | 关键产物 | 当前状态 | 退出条件 |
| --- | --- | --- | --- | --- |
| P0 | 文档与类型冻结 | 本专题文档包、统一术语 | 已完成 | 团队对设计无歧义 |
| P1 | 候选集解析收口 | `TaskProfile`、`CandidateModelSet`、设置来源归一 | 已完成基础收口 | 能稳定区分 `0 / 1 / N` 候选 |
| P2 | 单候选解释型路由 | `RoutingDecision`、单模型降级与阻断 | 已完成 | 单模型场景有清晰解释与事件 |
| P3 | 多候选自动优选 | 自动优选与 fallback chain | 进行中 | 多候选场景下自动策略可用 |
| P4 | OEM / telemetry / UI 收口 | OEM policy、thread read、evidence、前端展示 | 已完成基础收口 | UI 与导出链消费同一事实 |

## 3. 当前实现快照

截至 `2026-04-23`，已经落地的 current 主链切片：

1. `TaskProfile / RoutingDecision / LimitState` 已进入 `turn_context.metadata.lime_runtime`
2. `service_models.translation` 已进入统一路由链，不再只是设置页静态配置
3. `task_profile_resolved / routing_decision_made / limit_state_updated` 已作为 runtime 事件发出
4. `thread_read` 与前端协议已能消费这组稳定事实
5. `npm run verify:local` 已完整通过

## 4. P0：文档与类型冻结

目标：

- 把 `TaskProfile / CandidateModelSet / RoutingDecision / LimitState` 讲清楚
- 把自动与设置平衡讲清楚

关键工作：

- 本专题文档包
- docs 导航和主链回链

退出条件：

- 后续实现者不再需要临时决定“service_models 算不算硬锁”

## 5. P1：候选集解析收口

目标：

- 先统一回答“当前真实可选空间是什么”

关键边界：

- `runtime_turn.rs`
- `request_model_resolution.rs`
- OEM runtime / control plane
- provider pool

关键工作：

1. 收口所有设置来源
2. 统一生成 `CandidateModelSet`
3. 把 `candidate_count` 写入 runtime

退出条件：

- 任何 turn 都能稳定回答当前是 `0 / 1 / N` 候选

## 6. P2：单候选解释型路由

目标：

- 先把现实主路径做好：只有一个模型时也要行为正确

关键工作：

1. 实现 `routing_mode = single_candidate`
2. 写入能力缺口与限额状态
3. 把 `single_candidate_only`、`capability_gap` 做成底层事件

退出条件：

- 单模型场景不会再伪装成多模型自动选择

## 7. P3：多候选自动优选

目标：

- 在候选集真正大于 1 时引入自动优选

关键工作：

1. 先按能力过滤
2. 再按 OEM 与设置约束裁剪
3. 再按连续性、成本、限额选择
4. 支持 fallback chain

退出条件：

- 多模型场景下能够给出可解释 `RoutingDecision`

## 8. P4：OEM / telemetry / UI 收口

目标：

- 让这套设计真正进入 current 消费层

关键工作：

1. 扩展 execution runtime 读模型
2. 扩展 RequestLog / thread read / evidence
3. 前端展示 routing mode、decision source、limit state
4. 把 review / replay / analysis 消费链打通

退出条件：

- UI 和 evidence 使用同一份 runtime 事实

## 9. 风险排序

### 高风险

1. `service_models` 继续作为旁路执行面
2. OEM 与本地策略互相打架
3. 单模型场景语义不清，导致用户误解

### 中风险

1. 多候选优选策略过早引入，掩盖基础问题
2. 价格数据缺失导致假成本判断

### 低风险

1. UI 文案与底层语义暂时不同步

## 10. 当前建议的先后次序

推荐真实实施顺序：

1. `request_model_resolution.rs` 先做候选解析
2. 再补 `RoutingDecision`
3. 再扩展 execution runtime 和 thread read
4. 最后做前端解释层

## 11. 这一步如何服务主线

本文件的主线收益是：

**防止 Lime 一步跳进“理想化全自动多模型”，而忽略当前最真实的单模型、服务模型设置和 OEM 约束主路径。**
