# Memory / Compaction 主链

## 这份文档回答什么

本文件定义 Lime 当前 `Memory / Compaction` 的唯一主链，主要回答：

- 哪些路径负责当前回合的记忆来源解析、会话记忆预取、持久记忆召回与压缩续接
- `memory_runtime_*`、`unified_memory_*`、`agent_runtime_compact_session`、`project_memory_get` 分别属于哪一层
- 哪些页面和稳定读模型只是在消费这条主链，而不是继续定义另一套“真实记忆”
- 哪些旧侧链只能作为附属层或退场面，不能再反向定义当前记忆与压缩事实源

它是 **当前记忆来源、会话记忆、持久记忆与压缩边界的 current 文档**，不是单个页面说明，也不是旧项目资料记忆的聚合注释。

## 什么时候先读

遇到以下任一情况时，先读本文件：

- 调整 `memory_runtime_*`、`memory_get_*`、`memory_toggle_auto`、`memory_update_auto_note`
- 调整 `agent_runtime_compact_session`、自动压缩、summary cache 或 overflow compaction
- 调整 `memory_source_resolver_service.rs`、`auto_memory_service.rs`、runtime agents template scaffold
- 调整 `unified_memory_*`、持久记忆召回、记忆抽取或 unified memory 分析
- 调整 `MemoryPage.tsx`、记忆设置页、线程可靠性面板里的记忆预演与压缩展示
- 讨论“这条记忆应该进工作记忆、持久记忆、Team Memory 还是项目资料层”的边界归属

如果一个需求同时碰到“来源链 + 单回合预取”“会话压缩 + 持久记忆”“Memory 页面 + 线程面板记忆预演”中的两项以上，默认属于本主链。

## 固定主链

后续 Lime 的 `Memory / Compaction` 只允许向下面这条主链收敛：

`记忆来源链解析 -> 单回合 memory prefetch -> runtime_turn prompt augmentation -> session compaction -> working/durable memory 沉淀 -> Memory 页面 / 设置页 / 线程面板稳定读模型`

这条主链的固定判断是：

1. `memory_runtime_*` 是当前 runtime / 上下文记忆的唯一读模型入口。
2. `agent_runtime_compact_session` 是当前手动压缩入口；它属于 Query Loop 下游治理动作，不是另一套聊天系统。
3. `unified_memory_*` 是当前跨会话结构化持久记忆的唯一主表面。
4. `memory_get_effective_sources`、`memory_get_auto_index`、`memory_toggle_auto`、`memory_update_auto_note` 是来源链与自动记忆 control plane，不是第二条 recall pipeline。
5. `project_memory_get` 只保留“项目资料附属层”职责，不能继续抢占 runtime memory / compaction 的主链解释权。

固定规则只有一句：

**后续新增记忆或压缩能力时，只允许接到 `memory_runtime_*`、`unified_memory_*` 和 `agent_runtime_compact_session` 这组 current 边界；不允许再造并列记忆真相。**

## 代码入口地图

### 1. 来源链与自动记忆 control plane

- `src/lib/api/memoryRuntime.ts`
- `src-tauri/src/commands/memory_management_cmd.rs`
- `src-tauri/src/services/memory_source_resolver_service.rs`
- `src-tauri/src/services/auto_memory_service.rs`
- `src-tauri/src/services/runtime_agents_template_service.rs`

当前这里负责：

1. 解析 managed / user / project / local / rules / durable / additional 记忆来源。
2. 初始化 `memdir` 套件，并读取与写入 `MEMORY.md`、四类 `README.md` 与 topic note。
3. 生成 `.lime/AGENTS.md` / `.lime/AGENTS.local.md` 模板与 `.gitignore` 守卫。
4. 为 `feedback / project` 写入执行结构化约束，并拒绝相对日期项目记忆。
5. `memory_cleanup_memdir` 负责去重索引、裁剪 README 历史段落，并把旧 topic 日志收口为当前有效版本。
6. 为 runtime prefetch 和 Memory 页面提供统一来源链读模型，包括 `source_bucket / provider / memory_type / updated_at` 等 memdir 元数据。

固定规则：

- 来源链解析统一收口到 `resolve_effective_sources(...)`。
- 自动记忆目录定位与入口索引统一收口到 `auto_memory_service.rs`。
- `memdir` 默认以 `MEMORY.md -> user|feedback|project|reference` 四类目录组织；topic 文件必须继续挂在这条索引主链下。
- typed topic note 默认按“同 topic 一条当前记忆”维护，后续写入应覆盖旧内容，而不是无限追加时间戳历史。
- `memory_cleanup_memdir` 只做治理减法：清掉重复链接、缺失链接、过旧 README 历史段落和 topic 日志，不再额外长第二套归档真相。
- 页面、Hook 或 runtime 不允许再各自扫描另一套“真实来源链”。

### 2. 单回合 prefetch、工作记忆与压缩状态

- `memory_runtime_get_working_memory`
- `memory_runtime_get_extraction_status`
- `memory_runtime_prefetch_for_turn`
- `src/components/memory/memoryLayerMetrics.ts`

当前这里负责：

1. 从 runtime memory 目录聚合 `task_plan.md`、`findings.md`、`progress.md`、`error_log.json`。
2. 读取最近的 compaction summary cache，形成 `latest_compaction / recent_compactions`。
3. 在 `build_turn_memory_prefetch_result(...)` 内统一组装：
   - `rules_source_paths`
   - `working_memory_excerpt`
   - `durable_memories`
   - `team_memory_entries`
   - `latest_compaction`
   - `prompt`
4. 输出 Memory 页面、线程可靠性面板和记忆命中预演共用的稳定读模型。

固定规则：

- working memory 视图统一由 `collect_working_memory_view(...)` 生成。
- durable recall 的回退顺序统一由 `resolve_durable_memory_recall(...)` 决定，不允许 UI 或调用方自己再拼会话优先 / 全局回退逻辑。
- Team Memory shadow 只通过 `request_metadata.harness.team_memory_shadow` 进入 prefetch，不单独长第二条 Team recall 边界。

### 3. Query Loop 集成与压缩执行

- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`
- `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs`

当前这里负责：

1. `runtime_turn.rs` 在提交前调用 `build_turn_memory_prefetch_result(...)`，把来源链、会话记忆、持久记忆与压缩摘要注入 turn prompt augmentation。
2. 回合完成后，`spawn_runtime_memory_capture_task(...)` 会并行沉淀：
   - working memory：`analyze_memory_candidates(...)`
   - durable memory：`analyze_unified_memory_candidates(...)`
3. `agent_runtime_compact_session` 统一走 `compact_runtime_session_internal(...) -> compact_runtime_session_with_trigger(...) -> Agent::perform_context_compaction(...)` 这条 shared compaction core。
4. `compact_runtime_session_with_trigger(...)` 只创建一个最小 control turn 来写时间线与 usage metrics 锚点；真正替换 conversation、更新 summary cache 的核心逻辑仍复用 Aster 的共享 compaction 实现。

固定规则：

- 自动沉淀与手动压缩都属于同一条 Query Loop 下游主链。
- `agent_runtime_compact_session` 只能视为上下文治理动作，不能被包装成第二套独立记忆系统。
- compaction control turn 允许只保留 `thread_id / turn_id` 这组最小 `SessionConfig`；它不参与常规 turn prompt / tool / turn_context snapshot 组包，因此不构成第二事实源。
- 如果一个功能要影响“这轮 prompt 最终用了哪些记忆”，先改 `runtime_turn.rs` 与 `memory_management_cmd.rs`，不要在 UI 层旁路拼装。

### 4. 持久记忆 current surface

- `src/lib/api/unifiedMemory.ts`
- `src-tauri/src/commands/unified_memory_cmd.rs`
- `src-tauri/src/commands/memory_search_cmd.rs`

当前这里负责：

1. `unified_memory` 的 CRUD、list、stats、analyze。
2. 从对话候选中提取跨会话结构化记忆，并写回 `unified_memory` 表。
3. 为 durable recall、关键词搜索、语义搜索、混合搜索提供统一持久层。

固定规则：

- 跨会话结构化沉淀继续只认 `unified_memory_*`。
- `memory_runtime_prefetch_for_turn` 的 durable recall 只能消费 `unified_memory`，不要再造另一套长期记忆表或 JSON 缓存真相。
- memory feedback 不属于当前 durable 主链，它不能反向定义哪些记忆是 current。

### 5. 用户可见稳定读模型

- `src/components/memory/MemoryPage.tsx`
- `src/components/settings-v2/general/memory/index.tsx`
- `src/components/agent/chat/components/AgentThreadMemoryPrefetchPreview.tsx`
- `src/components/agent/chat/components/AgentThreadReliabilityPanel.tsx`
- `src-tauri/src/dev_bridge/dispatcher/memory_runtime.rs`
- `src-tauri/src/dev_bridge/dispatcher/memory.rs`
- `src/lib/dev-bridge/mockPriorityCommands.ts`
- `src/lib/tauri-mock/core.ts`

当前这里负责：

1. Memory 页面按 `来源链 / 会话记忆 / 持久记忆 / Team Memory / 会话压缩` 展示统一读模型。
2. 设置页复用同一套来源链、自动记忆与命中层状态，而不是再长另一份配置解释。
3. 线程可靠性面板与记忆预演卡片继续消费 `memory_runtime_prefetch_for_turn` 的结果。
4. DevBridge dispatcher、mock priority 和默认 mock 只为 current 命令提供桥接与兜底，不构成新的事实源。
5. `MemorySettings` 里的 `整理 memdir` 入口必须继续直连 `memory_cleanup_memdir`，不能在前端本地伪造“已整理”状态。

固定规则：

- 页面层只消费 `memory_runtime_*` / `unified_memory_*` 输出，不自己读磁盘或数据库重组另一套真相。
- 浏览器模式下的 mock priority 只允许模拟 current 命令结果，不能发明额外字段或第二套状态含义。
- memdir prompt source 的 linked item 预取优先级应继续偏向“更具体的 topic note + 最近更新时间”，而不是把 README 索引长期压过真正的当前记忆。

## current / compat / deprecated / dead

### `current`

- `docs/aiprompts/memory-compaction.md`
- `src/lib/api/memoryRuntime.ts`
- `src-tauri/src/commands/memory_management_cmd.rs`
- `src-tauri/src/services/memory_source_resolver_service.rs`
- `src-tauri/src/services/auto_memory_service.rs`
- `src-tauri/src/services/runtime_agents_template_service.rs`
- `src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs` 的 `agent_runtime_compact_session`
- `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs`
- `src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs` 的 `compact_session`
- `src/lib/api/unifiedMemory.ts`
- `src-tauri/src/commands/unified_memory_cmd.rs`
- `src-tauri/src/commands/memory_search_cmd.rs`
- `src/components/memory/MemoryPage.tsx`
- `src/components/settings-v2/general/memory/index.tsx`
- `src/components/agent/chat/components/AgentThreadMemoryPrefetchPreview.tsx`
- `src/components/agent/chat/components/AgentThreadReliabilityPanel.tsx`
- `src-tauri/src/dev_bridge/dispatcher/memory_runtime.rs`
- `src-tauri/src/dev_bridge/dispatcher/memory.rs`
- `src/lib/dev-bridge/mockPriorityCommands.ts`
- `src/lib/tauri-mock/core.ts`

这些路径共同构成当前记忆 / 压缩主链：

- 来源链与自动记忆配置看 `memory_management_cmd.rs`
- 单回合命中与工作记忆 / 压缩状态看 `memory_runtime_*`
- 持久沉淀看 `unified_memory_*`
- 手动压缩看 `agent_runtime_compact_session`
- GUI 与线程面板只消费同一套稳定读模型

### `compat`

- `src/lib/api/memory.ts`
- `src-tauri/src/commands/memory_cmd.rs`
- `src/lib/workspace/projectPrompt.ts`
- `src/components/agent/chat/AgentChatWorkspace.tsx`

保留原因：

- 这组路径仍承接角色、世界观、大纲和项目资料 prompt 的附属层能力。
- 它们当前还会参与 workspace 上下文和创作资料展示。

退出条件：

- 后续若继续保留，必须明确只把它们当“项目资料附属层”，不能再把它们写成 runtime memory / compaction 的唯一事实源。
- 新的记忆预取、压缩、自动沉淀、Team Memory 或 durable recall 能力不允许落到这里。

### `deprecated`

- `src-tauri/src/commands/memory_feedback_cmd.rs`
- `unified_memory_feedback`
- `get_memory_feedback_stats`
- 任何重新恢复独立 `memory feedback` 前端页或 API 网关的新实现

保留原因：

- 仓库里旧的独立记忆反馈前端侧链已经被治理目录册标记为 `dead-candidate`，当前主页面不再暴露这条链。
- Rust 侧反馈命令仍在，但已不属于当前记忆 / 压缩主链。

退出条件：

- 后续若要继续保留反馈能力，应明确挂回 `MemoryPage` 或 durable memory current surface；否则默认按退场面处理。
- 不再允许把反馈链单独扩成新的记忆真相定义者。

### `dead`

- `src-tauri/src/commands/memory_search_cmd.rs.bak`

它只是本地备份残留，不属于任何 current / compat / deprecated 运行面，也不能再被当成实现事实源。

## 最低验证要求

如果本轮改动涉及本主链，至少按边界选择最贴近的验证：

- 纯文档 / 分类回写：`npm run harness:doc-freshness`
- 改 `memory_runtime_*`、`memory_get_*`、`unified_memory_*` 或 DevBridge / mock：相关前端测试 + `npm run test:contracts`
- 改 `runtime_turn.rs`、自动沉淀或 compaction：相关 Rust 定向测试
- 改 Memory 页面、设置页、线程面板：补现有 `*.test.tsx` 稳定断言；必要时再补 `npm run verify:gui-smoke`

## 这一步如何服务主线

`M4` 的目标不是一次性重写所有记忆代码，而是先把记忆 / 压缩事实源收成一条 current 主链。

从现在开始：

- 解释来源链、自动记忆与入口模板时，回到 `memory_management_cmd.rs`
- 解释当前回合命中哪些记忆时，回到 `memory_runtime_prefetch_for_turn`
- 解释跨会话结构化沉淀时，回到 `unified_memory_*`
- 解释会话压缩与续接边界时，回到 `agent_runtime_compact_session`
- 解释角色 / 世界观 / 大纲资料时，视为 `project memory` compat 附属层

这样后续 `M5 State / History / Telemetry` 才不会继续被“工作记忆、持久记忆、项目资料、压缩摘要”几套语言来回打断。
