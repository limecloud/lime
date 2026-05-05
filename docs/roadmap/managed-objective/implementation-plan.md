# Managed Objective 实施计划

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：把 Managed Objective 拆成可验证阶段，先做受控目标续跑闭环，再扩展到长期业务任务。

依赖文档：

- [./README.md](./README.md)
- [./architecture.md](./architecture.md)
- [./diagrams.md](./diagrams.md)
- [../../aiprompts/query-loop.md](../../aiprompts/query-loop.md)
- [../../aiprompts/task-agent-taxonomy.md](../../aiprompts/task-agent-taxonomy.md)
- [../../aiprompts/state-history-telemetry.md](../../aiprompts/state-history-telemetry.md)

## 1. 实施总原则

1. **不新增 runtime taxonomy**
   - 任何执行都必须落到 `agent turn / subagent turn / automation job`。

2. **先状态，后自动**
   - 先把 objective state 和 audit 写清楚，再允许自动 continuation。

3. **先手动续跑，后空闲续跑**
   - 首期用手动 continue 验证链路，避免一上来就做后台自动循环。

4. **先 evidence audit，后模型总结**
   - 完成判断必须优先消费 artifact / thread_read / evidence pack。

5. **先低风险任务**
   - 首期只做只读 skill / 本地 artifact 产出，不做外部写操作自动化。

## 2. P0：文档与边界落盘

目标：固定 Managed Objective 的定义和禁止项。

任务：

1. 新增 `docs/roadmap/managed-objective/`。
2. 在 `docs/aiprompts/query-loop.md` 中声明 continuation 仍走 Query Loop。
3. 在 `docs/aiprompts/task-agent-taxonomy.md` 中声明 objective 不是第四类执行实体。
4. 在 `docs/aiprompts/state-history-telemetry.md` 中声明 objective projection 只消费 current 读模型。
5. 在 `docs/aiprompts/harness-engine-governance.md` 中声明 audit 只消费 evidence pack。

完成标准：

1. 文档能解释 `/goal` 与 Managed Objective 的区别。
2. 文档能解释 Managed Objective 与 CreoAI / Skill Forge 的区别。
3. 文档明确 `goal_runtime / objective_evidence / objective_scheduler` 这些方向是 dead。

## 3. P1：Objective state scaffold

目标：让系统能保存和读取目标状态，但不自动续跑。

范围：

1. 定义 objective state 最小结构。
2. 绑定 `owner_kind / owner_id`。
3. 支持创建、暂停、恢复、完成、清除。
4. 在 thread read 或 workspace projection 中显示 objective 摘要。
5. 记录 `success_criteria / budget_policy / risk_policy`。

非目标：

1. 不启动下一轮 turn。
2. 不创建 automation job。
3. 不做后台 idle continuation。
4. 不执行任何工具。

完成标准：

1. 一个 agent session 能挂一个 active objective。
2. app 重启后 objective state 可恢复。
3. pause / resume 能改变状态，但不影响 Query Loop 主链。
4. 没有 owner 的 objective 不能进入 active。

建议验证：

1. objective create / read / pause / resume / clear 单测。
2. owner 不存在时拒绝 active 的边界测试。
3. thread read / workspace projection 快照测试。

## 4. P2：Manual continuation turn

目标：让用户手动触发“继续推进目标”，并确保仍走 Query Loop。

范围：

1. 从 objective 生成 continuation metadata。
2. 手动 continue 调用 `agent_runtime_submit_turn`。
3. `TurnInputEnvelope` 记录 objective snapshot。
4. continuation prompt 要求检查目标和已知证据。
5. 执行结果进入 timeline / artifact / thread_read。

非目标：

1. 不做自动 idle continuation。
2. 不做定时后台任务。
3. 不做模型自动 complete 工具。

完成标准：

1. 用户点击继续后，只产生一轮标准 agent turn。
2. 这轮 turn 可在 runtime evidence 中追踪到 objective id。
3. 若有 pending user input 或 paused 状态，手动 continue 被拒绝。
4. `auto_continue` 文稿续写语义不会被误识别为 objective continuation。

建议验证：

1. continuation metadata 组包测试。
2. paused / needs_input 拒绝续跑测试。
3. Query Loop 入口没有新增旁路的契约测试。

## 5. P3：Evidence-based completion audit

目标：把“是否完成”从模型自报升级为 evidence-based audit。

范围：

1. 生成 audit checklist。
2. 读取 `SessionDetail / AgentRuntimeThreadReadModel`。
3. 读取相关 artifact refs。
4. 读取 `agent_runtime_export_evidence_pack`。
5. 输出 `ObjectiveAuditResult`。
6. 根据 audit result 更新 objective status。

完成标准：

1. 没有 evidence refs 时不能标记 `completed`。
2. criteria 为 `unknown` 时不能标记 `completed`。
3. 缺用户输入时进入 `needs_input`。
4. 外部依赖失败时进入 `blocked` 或 `failed`。
5. audit result 能在 Workspace 看到摘要和证据入口。

建议验证：

1. satisfied / unsatisfied / unknown checklist 单测。
2. evidence 缺失阻断 complete 测试。
3. needs_input / blocked 状态转换测试。
4. evidence pack 导出引用测试。

## 6. P4：Automation owner binding

目标：让 durable 后台任务可以绑定 objective，但调度仍属于 automation job。

范围：

1. automation job payload 引用 objective id。
2. due job 触发 continuation policy。
3. continuation policy 通过后投递标准 agent turn。
4. job run 和 objective audit 互相引用，但不复制事实。
5. job pause / resume 与 objective pause / resume 行为一致。

非目标：

1. 不新增 objective scheduler。
2. 不新增 objective queue。
3. 不新增 objective run history。
4. 不允许 objective 绕过 automation service。

完成标准：

1. 定时任务能推进 active objective。
2. app 重启后 due job 能恢复或明确 blocked。
3. 用户输入未处理时不会自动续跑。
4. 连续失败会停止并进入 `blocked / failed`。
5. evidence pack 能导出 automation owner 与 objective audit 关系。

建议验证：

1. due job -> continuation policy -> runtime queue 集成测试。
2. pause / resume 同步测试。
3. 连续失败 cutoff 测试。
4. app 重启恢复测试。

## 7. P5：Workspace projection

目标：让用户能理解目标进度、阻塞点和证据。

范围：

1. Objective card：目标、状态、成功标准、下一步。
2. Job card：owner、最近运行、下次运行、失败次数。
3. Audit view：criteria、证据引用、产物引用、决策原因。
4. 操作：pause、resume、manual continue、clear、reopen。
5. 高风险状态提示：needs_input、blocked、budget_limited。

完成标准：

1. 用户能从 objective 看到 evidence。
2. 用户能从 automation job 看到 objective。
3. 用户能从 artifact 回到 objective audit。
4. UI 不自行推断完成状态，只展示后端 projection。

建议验证：

1. Objective card 组件测试。
2. paused / blocked / completed 文案快照测试。
3. GUI smoke：创建目标、手动继续、查看 audit。

## 8. P6：受控自动 continuation

目标：在 P1-P5 稳定后，允许系统在空闲时自动推进目标。

范围：

1. turn finished 后检查 active objective。
2. 通过 guard 后投递下一轮 continuation。
3. 尊重 queued input、pending elicitation、pause、budget、risk。
4. 自动 continuation 有最大轮数、最大耗时、最大成本。
5. 每轮 continuation 都写入 audit 或 run summary。

完成标准：

1. active objective 能在多轮 turn 中继续推进。
2. 用户输入插队时自动续跑停止。
3. budget 耗尽时进入 `budget_limited`。
4. 完成时进入 `completed`，不再续跑。
5. evidence pack 能解释每一轮为什么继续或停止。

建议验证：

1. idle continuation guard 单测。
2. queued input 阻断测试。
3. budget limit 测试。
4. completion 停止续跑测试。
5. 多轮 continuation 端到端 smoke。

## 9. 最小验收场景

### 场景：只读每日报告目标

输入：

```text
为这个已验证的只读 skill 设置一个目标：每天 9 点生成 Markdown 趋势摘要，连续 7 次成功后完成。失败时最多重试 2 次，之后提醒我检查配置。
```

系统应完成：

1. 创建 automation job。
2. 创建并绑定 Managed Objective。
3. 每次 due job 通过 continuation policy。
4. 每次执行走 `agent_runtime_submit_turn`。
5. 产出 Markdown artifact。
6. evidence pack 记录调用、产物、失败、预算与 audit。
7. 满足 7 次成功后 audit 标记 `completed`。
8. 失败超过阈值后进入 `blocked`，并要求用户输入。

不要求：

1. 外部发布。
2. 跨 workspace 共享。
3. 多 agent 自主扩队。
4. 外部写操作自动执行。

## 10. 实现守卫

实现时必须守住：

1. 不新增 `goal_runtime`。
2. 不新增 `objective_scheduler`。
3. 不新增 `objective_queue`。
4. 不新增 `objective_evidence_pack`。
5. 不让 UI 自行判定 completed。
6. 不让 model 自行创建后台 objective。
7. 不让 `auto_continue` 冒充 persistent objective。
8. 不让 unverified skill 被 managed objective 自动执行。

## 11. 推荐落地顺序

1. P0 文档。
2. P1 objective state scaffold。
3. P2 manual continuation。
4. P3 evidence audit。
5. P5 workspace projection。
6. P4 automation owner binding。
7. P6 自动 continuation。

顺序解释：

**先让目标可见、可停、可审计，再让它自动跑。**
