# 参考运行时主链对齐计划

> 状态：进行中  
> 更新时间：2026-04-14  
> 对照基线：本地参考运行时源码镜像（2026-04-14 快照）  
> 目标：把 Lime 与参考运行时的“运行时主链”对齐工作，收口成一份唯一的排期与差距事实源，避免路线图、治理减法和专题计划继续并行漂移。

## 1. 先给结论

Lime 当前不是“能力不够”，而是“主链不够单一”。

已确认的现状：

- `Tool Runtime / MCP / evidence / replay / review / subagent` 已具备较强底座
- `Query Loop`、`Task / Agent taxonomy`、`Remote runtime` 与 `Memory / Compaction` 已完成 current 主链收口
- 现有对齐文档散落在 `roadmap/`、`tech/`、`develop/`、`exec-plans/`，导致排期和治理容易串线

本计划固定一个判断：

**后续“对齐上游运行时”默认指向运行时主链对齐，而不是目录、UI 或命名的 1:1 复制。**

## 2. 对齐口径

### 2.1 对齐什么

默认对齐下面六条运行时主链：

1. `Query Loop`
2. `Tool Runtime`
3. `Memory / Compaction`
4. `Remote / SDK / Server Mode`
5. `Task / Agent / Coordinator`
6. `State / History / Telemetry`

### 2.2 不对齐什么

- 不以上游运行时的目录结构作为目标
- 不先追求 UI 行为逐像素一致
- 不为了对齐而回退 Lime 已有的 GUI、Artifact、Provider、Workspace 优势
- 不把已有专题路线图全部重写成新体系；已有文档保留为下游专项

## 2.3 当前进度

- `M0` 统一排期事实源：`done`
- `M1` Query Loop 收口：`done`
- `M2` Task / Agent taxonomy 收口：`done`
- `M3` Remote runtime 收口：`done`
- `M4` Memory / Compaction 收口：`done`
- `M5` State / History / Telemetry 收口：`done`
- 当前阶段：`六条运行时主链 current 入口已补齐，后续转入守 current 边界与 compat / deprecated 退场`
- 当前进度日志：`docs/exec-plans/upstream-runtime-alignment-progress.md`

## 3. 主链差距矩阵

| 主链 | 参考运行时基线模块 | Lime 当前事实源 | 当前判断 | 主要差距 | 下一刀 |
| --- | --- | --- | --- | --- | --- |
| `Query Loop` | `QueryEngine.ts`、`query.ts`、`query/deps.ts`、`services/tools/*`、`services/compact/*` | `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`、`runtime_api.rs`、`tool_runtime.rs`、`docs/aiprompts/query-loop.md` | `aligned` | `Query Loop` current 事实源与主循环入口已收口；旧的 `alignment/state-model/conversation-efficiency` 专项文档都已退回 compat 历史档案，Artifact 文档族也已改回 current 入口引用；`TurnInputEnvelope -> SessionConfig` 的 turn context snapshot 分叉、`action_runtime` 辅助恢复链旁路，以及 `compact_session` 控制回合的最小上下文边界都已显式化；剩余散落在 `persona_cmd` / `theme_context_cmd` 的一次性临时会话配置已收口为专用 helper，零入口的旧 `AsterAgentWrapper::send_message` 已删除；Tauri 命令层原始 `agent.reply` / `stream_reply_with_policy` 扫描结果也已固定为 `action_runtime(current) + persona/theme_context(compat)` 三处，并补了源码扫描守卫 | 维持 aligned 主链；下一刀转向继续盘点 `src-tauri/src` 非命令层与 README/示例面是否还残留会误导实现者的原始执行旁路叙事 |
| `Tool Runtime` | `src/tools/*`、`services/tools/*`、`services/mcp/*`、`ToolSearchTool` | `src-tauri/src/agent_tools/catalog.rs`、`inventory.rs`、`src-tauri/src/commands/aster_agent_cmd/tool_runtime/*`、`docs/aiprompts/commands.md`、`docs/aiprompts/command-runtime.md`、`docs/prd/tools/architecture.md` | `aligned` | 能力基本齐，但仍需持续防止命名、inventory、mock、MCP 注入回退到第二事实源 | 维持 current 主链，后续只做减法和守卫，不新增并行入口 |
| `Memory / Compaction` | `services/compact/*`、`services/SessionMemory/*`、`memdir/*` | `docs/aiprompts/memory-compaction.md`、`src/lib/api/memoryRuntime.ts`、`src-tauri/src/commands/memory_management_cmd.rs`、`src-tauri/src/services/memory_source_resolver_service.rs`、`src-tauri/src/services/auto_memory_service.rs`、`src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`、`src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`、`src/lib/api/unifiedMemory.ts`、`src-tauri/src/commands/unified_memory_cmd.rs` | `aligned` | `M4` 已建立统一主链：`来源链解析 -> 单回合 prefetch -> runtime_turn prompt augmentation -> session compaction -> working/durable memory 沉淀 -> GUI 稳定读模型`；`project_memory_get` 退回 compat 附属层，`memory_feedback_cmd` 退回 deprecated | 转入 `M5`，固定 `session / thread / turn / request / evidence / history` 的 current 状态地图 |
| `Remote / SDK / Server Mode` | `remote/*`、`server/*`、`entrypoints/sdk/*`、`cli/transports/*` | `docs/aiprompts/remote-runtime.md`、`src/lib/api/channelsRuntime.ts`、`src-tauri/src/commands/gateway_channel_cmd.rs`、`src/lib/webview-api.ts`、`src-tauri/src/commands/browser_connector_cmd.rs`、`src-tauri/src/commands/webview_cmd.rs`、`src-tauri/src/commands/browser_runtime_cmd.rs`、`src-tauri/src/dev_bridge/*`、`src-tauri/src/services/openclaw_service/*`、`src-tauri/src/commands/telegram_remote_cmd.rs` | `aligned` | `M3` 已建立统一 remote 主链：`消息渠道 runtime + 浏览器连接器 / ChromeBridge` 是 current ingress，`DevBridge / OpenClaw` 退回 compat，`telegram_remote_cmd` 退回 deprecated；后续残余减法转入 compat surface 继续处理 | 维持 aligned 主链，后续只做 compat / deprecated 退场减法 |
| `Task / Agent / Coordinator` | `tasks/*`、`tools/AgentTool`、`Task*Tool`、`EnterWorktreeTool`、`RemoteTriggerTool`、`coordinator/*` | `docs/aiprompts/task-agent-taxonomy.md`、`docs/aiprompts/query-loop.md`、`src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs`、`src-tauri/src/services/execution_tracker_service.rs`、`src-tauri/src/services/automation_service/*`、`src-tauri/src/app/scheduler_service.rs` | `aligned` | `M2` 已建立统一 taxonomy：`agent turn / subagent turn / automation job` 是 current 一等执行实体，`ExecutionTracker` 是统一执行摘要层，`SchedulerService` 退回 compat 触发壳；后续残余减法转入 execution tracker / scheduler 专项继续处理 | 维持 aligned 主链，后续只做定点减法与回归修复 |
| `State / History / Telemetry` | `state/*`、`bootstrap/*`、`assistant/sessionHistory.ts`、`cli/transports/ccrClient.ts`、`services/analytics/*` | `docs/aiprompts/state-history-telemetry.md`、`src-tauri/crates/agent/src/session_store.rs`、`src-tauri/src/commands/aster_agent_cmd/dto.rs`、`src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`、`src-tauri/src/services/thread_reliability_projection_service.rs`、`src-tauri/src/services/runtime_handoff_artifact_service.rs`、`src-tauri/src/services/runtime_evidence_pack_service.rs`、`src-tauri/src/services/runtime_replay_case_service.rs`、`src-tauri/src/services/runtime_review_decision_service.rs`、`scripts/harness-eval-history-record.mjs` | `aligned` | `M5` 已建立统一状态地图，并继续完成 compat/deprecated 收口：`reliability / state-model / alignment / conversation-efficiency` 这些重型 compat 文档都已压成历史摘要档案，`telemetry_cmd.rs` 只再保留原始日志面定位 | 维持 current 主链；文档侧重型 compat 路线图已基本收完，下一刀优先回到 current 代码边界继续做减法 |

## 4. 现有文档归位

本计划是排期总入口，不替代现有专题方案。现有文档按下列方式归位：

| 文档群 | 归属主链 | 角色 |
| --- | --- | --- |
| `docs/roadmap/lime-aster-codex-alignment-roadmap.md` | `Query Loop`、`State / History / Telemetry` | Aster/Codex umbrella 历史专项档案，已吸收原状态模型与执行效率子专题，不再承担仓库级总排期或 current 实施入口职责 |
| `docs/roadmap/reliability/*` | `State / History / Telemetry` | Reliability control plane 专项 |
| `docs/tech/harness/*`、`docs/roadmap/harness-engine/*` | `State / History / Telemetry`、`Memory / Compaction` | Evidence / replay / review / observability / cleanup 专项 |
| `docs/develop/execution-tracker-technical-plan.md`、`docs/develop/execution-tracker-p1-p2-roadmap.md`、`docs/develop/scheduler-task-governance-p1.md` | `Task / Agent / Coordinator` | 长时执行与治理专项 |
| `docs/aiprompts/commands.md`、`docs/aiprompts/command-runtime.md`、`docs/prd/tools/*` | `Tool Runtime` | 当前工具面与协议事实源 |

如果后续新增专项文档，必须先标明它属于哪条主链；如果说不清主链归属，就不允许单独立项。

## 5. 排期纪律

从本计划起，后续排期默认遵守以下规则：

1. 同一时间只允许 `1` 条主链作为主任务。
2. 每轮最多再搭配 `1` 条服务主链的治理任务。
3. 所有任务必须声明：
   - 所属主链
   - 当前分类：`current / compat / deprecated / dead`
   - 阶段出口
4. 治理减法如果不能直接缩短主链，就登记到 `docs/exec-plans/tech-debt-tracker.md`，不直接插队。
5. 专题路线图完成后，必须回写本计划的矩阵状态，避免“专题 done，但总盘子仍 unknown”。

## 6. 推荐推进顺序

### `M0` 统一排期事实源

- 建立本计划，固定六条主链
- 把现有对齐文档回挂到单一总入口
- 把当前未收口差距登记进技术债追踪

### `M1` Query Loop 收口

- 为 Lime 补一份单一 Query Loop 事实图
- 明确 `submit_turn -> turn runtime -> tool orchestration -> compaction -> evidence` 的 current 主链
- 退出条件：不再需要横跳多份文档才能解释 Lime 主循环

当前进度（2026-04-14）：

- 已完成第一刀：`docs/aiprompts/query-loop.md` 已成为 Query Loop current 入口
- 已完成第二刀实现：`runtime_turn.rs` 已将 `run_start_metadata`、`runtime_status_session_config`、`build_session_config` 的重复拼装收口为稳定 helper，主循环可读性继续提升
- 已完成第三刀实现：单次流式执行成功后的 Artifact 自动落盘与记忆沉淀已收口为统一 helper，主成功分支与降级成功分支不再各自维护重复收尾逻辑
- 已完成第四刀实现：两处 `stream_reply_once` 的运行时事件记录闭包已收口为统一 helper，主分支与降级分支共享同一条事件记录路径
- 已完成第五刀实现：`RunFinishDecision` 组装与 terminal result 收尾已收口为统一 helper，主循环不再内联 success/error 两套终态处理
- 已完成第六刀实现：主执行分支与降级到 ReAct 的分支已共用“单次流式尝试” helper，`build_runtime_user_message(...)`、`build_session_config()`、`stream_reply_once(...)` 与成功收尾逻辑不再在主循环中重复展开
- 已完成第七刀实现：`CodeOrchestrated` 的扩展启用、失败降级、扩展清理已收口为统一策略 helper，`with_run_custom(...)` 内只保留一次 Query Loop 执行入口
- 已完成第八刀实现：runtime turn 初始化、status 投射与 service preload 事件已收口为统一前奏 helper，主循环的前置准备阶段已压成单一语义块
- 已完成第九刀实现：`run_start_metadata`、`timeline_recorder`、`runtime_status_session_config` 与流式 `session_config` 构建状态已收口为统一 execution context，主循环不再散落拼装这组前置状态
- 已完成第十刀实现：`run_observation`、`run_finish decision` 与 terminal finalize 链路已回收到 execution context，主循环不再手工拼接 tracked execution 与终态收尾
- 已完成第十一刀实现：`skill_tool_session_access` 与 `cancel_token` 已收口为统一 session scope，异常路径与正常路径共享同一套会话级清理边界
- 已完成第十二刀实现：`runtime_snapshot -> runtime_projection_snapshot -> turn_state -> turn_input_envelope` 已收口为统一 `build_runtime_turn_artifacts(...)` helper，主循环不再内联读取 snapshot、派生 thread/turn 和构建 turn 输入诊断
- 已完成第十三刀实现：`service_skill_preload -> prepared execution -> prelude/execute handoff` 已收口为 `prepare_runtime_turn_execution(...)` 与 `RuntimeTurnPreparedExecution`，submit 主路径已压成更明确的 `prepare -> execute` 语义块
- 已完成第十四刀实现：`provider_continuation -> workspace sandbox apply -> tracker/session scope bootstrap` 已收口为 `prepare_runtime_turn_submit_bootstrap(...)`，submit 主路径不再内联铺开这组前置副作用和运行期参数拼装
- 已完成第十五刀实现：`request.provider_config -> configure_provider/configure_provider_from_pool -> persist_session_provider_routing` 已收口为 `apply_runtime_turn_provider_config(...)`，submit 主路径不再内联铺开 provider apply 分支
- 已完成第十六刀实现：`resolved_prompt -> prompt augmentation -> requested/effective strategy persist` 已收口为 `prepare_runtime_turn_prompt_strategy(...)`，submit 主路径不再内联铺开 prompt/strategy 组装与持久化
- 已完成第十七刀实现：`tool surface metadata -> MCP warmup -> skill launch metadata normalize -> turn_input_builder seed` 已收口为 `prepare_runtime_turn_request(...)`，submit 主路径不再内联铺开 request prepare 分支
- 已完成第十八刀实现：`runtime_chat_mode -> web_search/request_tool_policy -> execution_profile` 已收口为 `prepare_runtime_turn_policy(...)`，submit 主路径不再内联铺开 policy resolve 逻辑
- 已完成第十九刀实现：`auto_continue -> workspace repair warning -> session_state_snapshot/working_dir update -> session_recent_runtime_context` 已收口为 `prepare_runtime_turn_session(...)`，submit 主路径的 session 级前置准备已压成单一 helper
- 已完成第二十刀实现：`session/policy/request/prompt_strategy -> provider apply/bootstrap` 已收口为 `prepare_runtime_turn_submit_preparation(...)`，submit 主路径已提升为单一 preflight 准备块
- 已完成第二十一刀实现：`sync_browser_assist_runtime_hint -> prepare_runtime_turn_execution -> agent guard -> emit_prelude_and_execute` 已收口为 `execute_runtime_turn_submit(...)`，submit 主路径当前已压成 `prepare -> scoped execute` 两段主骨架
- 已完成第二十二刀实现：`provider_config resolve -> harness metadata normalize -> workspace resolve/turn id/runtime_config` 已收口为 `prepare_runtime_turn_ingress_context(...)`，入口上下文边界不再散落在主路径中
- 已完成第二十三刀实现：`agent init/session_store check -> support tools register` 已收口为 `prepare_runtime_turn_entry(...)`，主路径的运行时入口准备已形成独立阶段
- 已完成第二十四刀实现：`model_skill_tool_access derive -> with_runtime_turn_session_scope -> execute_runtime_turn_submit` 已收口为 `execute_runtime_turn_with_session_scope(...)`，主路径不再拆包又重组 `submit_preparation`
- 已完成第二十五刀实现：`execute_aster_chat_request(...)` 已把 `entry -> ingress -> submit_preparation -> session_scope_execute` 提升为单一 `execute_runtime_turn_pipeline(...)` 调用，`M1` 外层 orchestration 收口完成
- 已补最小 Rust 定向校验：`env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-runtime-turn-2" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib commands::aster_agent_cmd::runtime_turn::tests:: -- --nocapture` 通过（`37 passed`，仅剩 `workspace_tools.rs` 既有 dead_code warning）
- 已补文档新鲜度校验：`npm run harness:doc-freshness` 通过（`clean`）
- 已补格式化校验：`cargo fmt --manifest-path "src-tauri/Cargo.toml" --all` 通过
- `M1` 退出判断：已满足“不再需要横跳多份文档才能解释 Lime 主循环”的出口条件，后续不再继续细切 `M1`

### `M2` Task / Agent taxonomy 收口

- 为 Lime 定义统一的 task / agent / coordinator 分型
- 将 `execution tracker / scheduler / subagent / automation` 收回同一语义层
- 退出条件：所有长时执行入口都能归到唯一 taxonomy

当前进度（2026-04-14）：

- 已完成第一刀：`docs/aiprompts/task-agent-taxonomy.md` 已成为 Task / Agent / Coordinator current 入口
- 已完成第二刀：`ExecutionTracker / subagent runtime / automation service / scheduler trigger` 的 `current / compat / deprecated / dead` 已有明确归类
- 已完成第三刀：`docs/README.md`、`docs/aiprompts/README.md`、`docs/aiprompts/overview.md`、`AGENTS.md` 已同步回挂新入口，仓库导航不再继续把 scheduler/heartbeat 叙事误当 current 主线
- `M2` 退出判断：已满足“所有长时执行入口都能归到唯一 taxonomy”的出口条件，后续不再把 execution tracker、scheduler、subagent、automation 分散解释为多条平级主线

### `M3` Remote runtime 收口

- 盘点 remote/dev bridge/browser remote/IM remote 入口
- 声明唯一 current remote runtime
- 退出条件：remote 不再是多个并列产品旁路

当前进度（2026-04-14）：

- 已完成第一刀：`docs/aiprompts/remote-runtime.md` 已成为 Remote runtime current 入口
- 已完成第二刀：`gateway_channel_* + browser connector / ChromeBridge` 已明确为 current remote ingress，`DevBridge / OpenClaw` 已归到 compat，`telegram_remote_cmd` 已归到 deprecated
- 已完成第三刀：`docs/README.md`、`docs/aiprompts/README.md`、`docs/aiprompts/overview.md`、`AGENTS.md` 已同步回挂新入口，仓库导航不再继续把 debug 桥或单通道 Telegram 入口误当 remote 主线
- `M3` 退出判断：已满足“remote 不再是多个并列产品旁路”的出口条件，后续只在 current ingress 上新增能力，其余 remote 面默认只做减法与兼容维护

### `M4` Memory / Compaction 收口

- 固定压缩边界、记忆预取、恢复和用户可见状态的主链
- 退出条件：`memory_runtime_*` 与 `compact_session` 不再被当成分散能力点看待

当前进度（2026-04-14）：

- 已完成第一刀：`docs/aiprompts/memory-compaction.md` 已成为 Memory / Compaction current 入口
- 已完成第二刀：`来源链解析 -> 单回合 prefetch -> runtime_turn prompt augmentation -> session compaction -> working/durable memory 沉淀 -> GUI 稳定读模型` 已明确为 current 主链
- 已完成第三刀：`project_memory_get` 与角色/世界观/大纲资料链已明确退回 compat 附属层，`memory_feedback_cmd` 已退回 deprecated，`memory_search_cmd.rs.bak` 已标记为 dead
- 已完成第四刀：`docs/README.md`、`docs/aiprompts/README.md`、`docs/aiprompts/overview.md`、`AGENTS.md` 已同步回挂新入口，仓库导航不再继续把项目资料聚合或旧 feedback 侧链误当成记忆 / 压缩主线
- `M4` 退出判断：已满足“`memory_runtime_*` 与 `compact_session` 不再被当成分散能力点看待”的出口条件，后续只允许在 current 边界继续长记忆 / 压缩能力

### `M5` State / History / Telemetry 收口

- 把 reliability、harness、history、review、replay 的事实源统一成一张状态地图
- 退出条件：session / thread / turn / request / evidence / history 的读模型叙事收口

当前进度（2026-04-14）：

- 已完成第一刀：`docs/aiprompts/state-history-telemetry.md` 已成为 State / History / Telemetry current 入口
- 已完成第二刀：`agent_sessions / agent_messages -> SessionDetail -> AgentRuntimeThreadReadModel -> RequestLog 关联键 -> handoff/evidence/replay/analysis/review -> history-record/trend/cleanup/dashboard -> HarnessStatusPanel / AgentThreadReliabilityPanel` 已明确为 current 主链
- 已完成第三刀：原 `state-model` 历史子专题、`docs/roadmap/reliability/*` 与 `telemetry_cmd.rs` 已明确退回 compat；cleanup 报表里残留的 `requestTelemetry:unlinked` 旧语义已明确为 deprecated
- 已完成第四刀：`docs/README.md`、`docs/aiprompts/README.md`、`docs/aiprompts/overview.md`、`AGENTS.md` 已同步回挂新入口，仓库导航不再继续把状态模型专题计划、reliability 计划或原始 request log 控制台误当成 current 主链
- 已完成第五刀：`docs/roadmap/reliability/README.md` 已补成 compat 目录入口；cleanup 核心脚本已把旧 `requestTelemetry:unlinked` 样本折叠为 `known_gap`，避免旧历史语义继续充当现役状态类别
- 已完成第六刀：`docs/roadmap/reliability/*.md` 全部补上 compat 提示，正文开头先回挂 `state-history-telemetry.md`；`telemetry_cmd.rs` 也已明确只暴露原始 `RequestLog` 与聚合统计，不再和 thread read / evidence 主链抢解释权
- 已完成第七刀：`docs/roadmap/reliability/*.md` 顶部重复的上位文档列表已压成统一 `README + current 主链 + PR 对应映射` 导航，专项正文不再继续堆叠第二套入口说明
- 已完成第八刀：整组 `docs/roadmap/reliability/*` 已进一步压缩为 compat 历史摘要档案，只保留落地结果、current 映射与延后增强项；重复的目标/问题/范围/实施清单正文已回退到仓库历史
- 已完成第九刀：原 `state-model` 历史摘要已完成压缩并最终并入 `docs/roadmap/lime-aster-codex-alignment-roadmap.md`，current 入口固定回到 `query-loop / state-history-telemetry / upstream-runtime-alignment-plan`
- 已完成第十刀：`docs/roadmap/lime-aster-codex-alignment-roadmap.md` 已固定为 compat umbrella 历史档案，只保留阶段映射、状态模型与执行效率的核心判断
- 已完成第十一刀：原 `conversation-execution-efficiency` 历史摘要已并入 `alignment-roadmap`，`docs/roadmap/artifacts/*` 对运行时边界的引用也已统一改回 `query-loop / task-agent-taxonomy / state-history-telemetry / upstream-runtime-alignment-plan`
- `M5` 退出判断：已满足“session / thread / turn / request / evidence / history 的读模型叙事收口”的出口条件，后续只允许在 current 边界上继续长能力

## 7. 当前默认判断

- `Tool Runtime` 继续视为 `current`
- `Query Loop`、`Task / Agent / Coordinator`、`Remote / SDK / Server Mode`、`Memory / Compaction`、`State / History / Telemetry` 视为 `aligned`

当前最值得继续推进的一刀固定为：

**文档侧重型 compat 路线图已基本压成历史摘要档案；当前已收口 `TurnInputEnvelope -> SessionConfig` 的 turn context snapshot 分叉、`action_runtime` 辅助恢复链的 turn context 旁路，并显式化 `compact_session` 控制回合的最小上下文边界；剩余散落在 `persona_cmd` / `theme_context_cmd` 的一次性临时会话配置也已收口为专用 helper，零入口旧发送壳已删除；Tauri 命令层原始执行面也已固定为 3 处并补了源码扫描守卫。下一刀转向继续盘点 `src-tauri/src` 非命令层与 README/示例面是否还残留会误导实现者的原始执行旁路叙事。**

这样做的原因是：六条运行时主链的 current 入口已经补齐；cleanup 的旧 `unlinked` 语义、telemetry 原始浏览面定位，以及 `reliability / state-model / alignment / conversation-efficiency` 这些重型 compat 文档都已经被收紧。继续留在文档治理上的边际收益已经明显下降，下一步更值得回到 current 代码边界继续做减法。
