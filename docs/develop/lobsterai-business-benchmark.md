# LobsterAI 业务闭环对标与 Lime AI Agent 规划

## 1. 文档目标

本文从**资深架构师**与**产品经理**双视角，对 `LobsterAI` 与 `Lime` 做业务闭环级对标，明确：

1. 我们应该借鉴什么（高价值能力）
2. 我们不应该照搬什么（避免技术债和垃圾代码）
3. 我们的 P0 / P1 / P2 可执行落地路线

> 结论导向：不做功能堆叠，聚焦「可持续运行的 AI Agent 业务闭环」。

---

## 2. 对标范围与证据基线

### 2.1 LobsterAI 侧（已核对）

- `README_zh.md`
- `src/main/libs/scheduler.ts`
- `src/main/scheduledTaskStore.ts`
- `src/main/libs/coworkRunner.ts`
- `src/main/libs/coworkMemoryExtractor.ts`
- `src/main/im/imGatewayManager.ts`

### 2.2 Lime 侧（已核对）

- `src-tauri/src/services/execution_tracker_service.rs`
- `src-tauri/src/services/heartbeat_service/mod.rs`
- `src-tauri/src/services/heartbeat_service/delivery.rs`
- `src-tauri/src/commands/aster_agent_cmd/mod.rs`
- `src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs`
- `src-tauri/crates/websocket/src/handlers/rpc_handler.rs`
- `src-tauri/crates/core/src/database/schema.rs`

---

## 3. 业务闭环级对比（不是基础功能对比）

## 3.1 触发入口层（用户如何“唤醒”Agent）

### LobsterAI

- 已形成多入口入站闭环：本地 + IM（钉钉/飞书/Telegram/Discord）
- IM 不只是通知，而是可直接触发任务/会话执行

### Lime

- 已具备本地执行与 Heartbeat 任务执行
- WebSocket RPC 的 `agent.run` / `cron.run` 仍是占位实现（TODO）
- 当前“远程入站可控执行”能力不足

### 业务影响

- 我们在“随时触发 Agent”这一增长入口上弱于 LobsterAI
- 无法支撑“移动端/IM 远程运维 Agent”的高频场景

---

## 3.2 任务治理层（任务失败后是否可控）

### LobsterAI

- 任务状态机较完整：running / success / error + 运行历史
- 有 `consecutiveErrors` 连续失败计数
- 达到阈值后自动停用任务（避免无限失败）
- 应用异常退出后会修复 stuck running 状态

### Lime

- Heartbeat 已有：超时、重试、执行记录、通知
- Execution Tracker 已有统一 run 摘要（`agent_runs`）
- 仍缺任务级连续失败降级（自动停用/冷却恢复）

### 业务影响

- 当前可“执行”，但“长期稳定运行”与“自动自愈”不足
- 运维成本会随任务规模快速上升

---

## 3.3 可观测与运营层（能否管理 SLA）

### LobsterAI

- 任务与 run 记录绑定，便于按任务看健康度
- 调度执行结果可做通知回执

### Lime

- `agent_runs` 已统一 chat/skill/heartbeat，这是明显优势
- 但尚未形成“任务健康面板 + 告警阈值 + 运营指标”产品层

### 业务影响

- 我们具备数据基础，但缺面向运营的产品化呈现
- 难支持“团队交付承诺（SLA）”

---

## 3.4 记忆沉淀层（执行是否持续变聪明）

### LobsterAI

- 有对话记忆提取链路（规则 + 守门）
- 更接近“会话后自动沉淀”

### Lime

- 已有统一记忆体系和 `unified_memory_analyze`
- 更偏分析/批处理入口，实时自动沉淀闭环不够强

### 业务影响

- 我们有“记忆能力”，但还未最大化转化为“任务质量随时间提升”

---

## 3.5 权限与安全层（能否在企业场景落地）

### LobsterAI

- 有工具审批机制

### Lime

- `aster_agent_cmd` 已有较完整的权限与沙箱策略
- 安全基础不弱，具备差异化潜力

### 业务影响

- 我们不应牺牲安全换速度
- 应把安全能力作为企业级卖点，而不是负担

---

## 4. 核心差距总结（结合 AI Agent 业务）

我们当前最大缺口不是“模型效果”，而是：

1. **远程入站触发能力未产品化**（尤其 IM 双向控制）
2. **任务失败治理不完整**（缺连续失败自动降级）
3. **运营闭环不完整**（缺任务健康/SLA 可视化）
4. **记忆与任务执行未强耦合**（难形成复利）

---

## 5. 策略原则：抄什么，不抄什么

## 5.1 建议借鉴（高价值）

1. 任务状态模型（含连续失败治理）
2. 调度失败闭环（重试、超时、自动停用、恢复）
3. 远程触发 + 回执通知闭环
4. 记忆提取守门策略（避免低质量记忆污染）

## 5.2 明确不照搬（避免垃圾代码）

1. 不照搬 Electron 主进程式“大一统”实现
2. 不在 Tauri/Rust 侧重复造两套调度器
3. 不引入与现有 `ExecutionTracker` 并行的第二追踪系统
4. 不在 P0 阶段做多 IM 平台大而全接入

---

## 6. Lime 可执行路线图（业务优先）

## P0（必须，2~3 周）：先打通“远程可控最小闭环”

### 目标

让用户可通过单一远程入口触发 Agent 任务，并可看到可靠回执。

### 范围

1. 选 1 个 IM 通道（建议 Telegram）做**入站控制**（不是仅通知）
2. 定义统一远程命令协议（run/list/stop/status）
3. 所有远程触发执行统一写入 `agent_runs`
4. 增加危险操作人工确认门控（复用现有权限体系）

### 验收

1. 远程触发成功率 >= 95%
2. run 追踪覆盖率 100%
3. 危险命令 0 例“无确认直通”

---

## P1（应做，3~5 周）：任务治理产品化

### 目标

让任务系统可持续运行，失败可自愈、可降级、可恢复。

### 范围

1. 任务级连续失败计数（`consecutive_failures`）
2. 自动停用与冷却恢复策略（Circuit Breaker）
3. 任务健康面板（最近状态、失败趋势、重试次数）
4. 告警规则（连续失败、超时飙升、悬挂 run）

### 验收

1. 连续失败任务自动降级覆盖率 100%
2. 故障任务平均恢复时间下降 >= 40%
3. 任务状态查询延迟 P95 < 300ms

---

## P2（可做，中期）：业务化与生态化

### 目标

把 Agent 从“可用工具”升级为“可复制业务单元”。

### 范围

1. 场景模板化（运营巡检、内容分发、客服分流等）
2. 团队协作与审计（角色、审批、操作追踪）
3. 记忆-任务闭环强化（任务后自动提炼可复用记忆）
4. 聚合运营指标（SLA、成功率、成本、失败 TopN）

### 验收

1. 模板场景复用率 >= 60%
2. 关键业务任务 SLA 可量化并可审计
3. 人工介入频次显著下降

---

## 7. 架构落地约束（防止代码膨胀）

1. **单一追踪事实源**：`agent_runs` 继续作为统一执行摘要表
2. **能力复用优先**：复用 `HeartbeatService`、`ExecutionTracker`、`aster_agent_cmd` 权限体系
3. **分层扩展**：新增“触发适配层/治理层”，不侵入核心执行引擎
4. **渐进交付**：每个阶段只做可验证的最小闭环，不并行开大面

---

## 8. 架构师 + 产品经理联合结论

### 架构师视角

Lime 的底座（追踪、权限、沙箱、Provider 能力）已经具备，当前应避免重构冲动，重点补齐远程触发和任务治理层。

### 产品经理视角

下一阶段最该投入的是“可持续运行的 Agent 闭环能力”，而非继续堆叠新模型或新工具入口。谁先形成远程触发 + 失败治理 + SLA 可视化，谁就先拿到企业场景的真实粘性。

---

## 9. 下一步执行建议

建议下一步立即启动 P0 设计拆分，输出三个可开发工单组：

1. **远程触发协议与命令面**（入口）
2. **任务治理状态模型**（稳定性）
3. **任务健康与追踪看板**（运营）
