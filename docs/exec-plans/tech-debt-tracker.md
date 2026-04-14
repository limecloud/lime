# 技术债追踪

本文件记录需要持续、小额偿还的技术债，避免把问题堆到一次性大清理。

## 记录规则

1. 每条技术债都要写清具体代码面、影响和下一小步
2. 能回挂路线图主线的，优先回挂路线图；不能回挂的，登记到这里
3. 状态至少区分 `待处理`、`进行中`、`已完成`、`放弃`

## 条目

| ID | 日期 | 区域 | 差距 / 债务 | 影响 | 下一小步 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CCD-001 | 2026-04-14 | Query Loop | Lime 已有 `submit_turn / runtime_turn / tool_runtime / evidence` 主链，但过去缺少单一 Query Loop 事实源；现已补齐 current 文档入口 | 已从“主链解释分散”降到“代码边界仍待继续收口”，后续推进顺序已稳定 | 继续沿 `docs/aiprompts/query-loop.md` 盘点代码侧重复边界，准备下一刀 helper 收口 | `docs/exec-plans/upstream-runtime-alignment-plan.md` | 已完成 |
| CCD-002 | 2026-04-14 | Remote Runtime | Telegram remote、OpenClaw、DevBridge、browser remote/debugging 等入口过去并存且语义混杂；现已补齐 `消息渠道 runtime + 浏览器连接器 / ChromeBridge` 的 current 主链，并明确 `DevBridge / OpenClaw` 为 compat、`telegram_remote_cmd` 为 deprecated | 已从“remote 入口平级并存”降到“只剩 compat / deprecated 退场减法”，后续 remote 主线解释已稳定 | 后续只允许 remote 新能力落到 `gateway_channel_*` 或 `browser connector / ChromeBridge` current ingress；`DevBridge / OpenClaw / telegram_remote_cmd` 默认只做减法和兼容维护 | `docs/exec-plans/upstream-runtime-alignment-plan.md` | 已完成 |
| CCD-003 | 2026-04-14 | Task / Agent | `subagent / automation / execution tracker / scheduler / heartbeat` 过去缺少统一 taxonomy；现已补齐 `agent turn / subagent turn / automation job` current 分型，并明确 `ExecutionTracker` 为摘要层、`SchedulerService` 为 compat 触发壳 | 已从“排期语言混乱”降到“只剩 compat / deprecated 退场减法”，后续主线解释已稳定 | 后续只允许新增长时执行需求落到 `agent turn / subagent turn / automation job` 三类之一；`SchedulerService` 与 `heartbeat_executions` 只继续做减法和退场 | `docs/exec-plans/upstream-runtime-alignment-plan.md` | 已完成 |
| CCD-004 | 2026-04-14 | Memory / Compaction | `memory_runtime_*`、`unified_memory_*`、`agent_runtime_compact_session` 与来源链 control plane 过去缺少统一主链叙事；现已补齐 current 文档入口，并明确 `project_memory_get` 为 compat 附属层、`memory_feedback_cmd` 为 deprecated | 已从“记忆、压缩、恢复分头演进”降到“后续只需守住 current 边界不回流” | 后续只允许新记忆 / 压缩需求落到 `docs/aiprompts/memory-compaction.md` 定义的 current 主链；发现回流时做定点治理 | `docs/exec-plans/upstream-runtime-alignment-plan.md` | 已完成 |
| CCD-005 | 2026-04-14 | State / History / Telemetry | reliability、harness、history、review、replay、evidence 过去分别成文且入口分散；现已补齐 `SessionDetail -> AgentRuntimeThreadReadModel -> RequestLog 关联键 -> export/history` 的 current 状态地图，并明确旧状态模型方案、reliability 计划与原始 request log 浏览面退回附属层 | 已从“状态模型叙事分散”降到“只剩 compat / deprecated 退场减法”，后续主线解释已稳定 | 后续只允许新状态 / 历史 / 遥测能力落到 `docs/aiprompts/state-history-telemetry.md` 定义的 current 主链；优先继续清 `reliability` 计划与 cleanup 旧语义 | `docs/exec-plans/upstream-runtime-alignment-plan.md` | 已完成 |
