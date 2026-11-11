# Codex Runtime 缺口对齐实施计划

> 当前状态：active；2026-10-18 重新打开核心机制对齐，以下历史四项完成不代表整个 runtime 已对齐。
> 主目标：CLI/TUI/GUI 经同一 App Server 和 RuntimeCore，具有 Codex 的 Context、Memory、Agent Loop、Tools、Extensions 与 harness 行为。

2026-10-21 继续实施恢复主链：独立切片计划
[`codex-thread-fork-alignment.md`](codex-thread-fork-alignment.md) 记录 ephemeral fork、
rollout path、完整历史返回、归档/分页约束和公共验证。最新普通 fork 的 Default 模式与
多模型/provider 覆盖修复已通过公共回归 26/26 和真实 Electron fork Gate B；此前聚合 current fixture
退出失败的 unknown Item 场景已由同一新产物定向重试通过，后续聚合场景仍未执行。
独立 rollout 完整模型收据/session checkpoint、媒体与协作历史仍未关闭。
整体仍 active / partial；
用户要求完整复刻的范围不缩减，插件、tar.gz、LimeCore 与多模型约束继续有效。

2026-10-21 compressed-only 原线程恢复继续见
[`rollout 模型上下文计划`](codex-rollout-context-alignment.md)：r31 owner/ThreadStore/workspace
76/76、恢复公共回归 44/44、补充线程公共回归 19/19、1.165.0 构建与基础 GUI smoke 通过。
真实 CLI 两次仅压缩历史空索引恢复后，同一线程三轮 completed、输入各一次；archive 保留
压缩字节与实际 mtime，unarchive 更新时间且保持 recency。时间/回滚切片退出条件
3/3（100%）；portable rollout 切片仍为 4/5（80%），不代表整体完成。Electron 归档
聚合在历史长列表等待超时，后续设置归档场景未执行；Agent 聚合 **371 项定向测试与
22 个 Electron 子场景全部通过**，核销此前 Coding Workbench 浏览器标签场景的失败。
完整 TUI、压缩专属 PTY、Windows/live/packaged 与 `verify:local` 仍按同一计划分账。
该切片不代替后台自动压缩，以及 Memory/Tools/Extensions/harness、
插件/tar.gz 与 LimeCore 的剩余合同。

2026-10-21 r33 已实现 unarchive 无归档源的 InvalidRequest 和后台 rollout 压缩，
包括实际 writer ownership/维护锁、冷文件发布/回滚边界、六小时冷却、
默认关闭的 startup gate 与 experimental RPC 握手；协议/schema/Rust/TS client/gateway 同步。
owner 84/84、protocol/client/schema 198/198、公共 RPC 23/23、TS 148/148、
contracts、基础 GUI smoke 与真实 stdio 跨进程 writer 排除/压缩后续聊通过。
34 项输入无漂移；该切片 4/4 完成，整体仍 active / partial。
独立归档 GUI 长列表、完整 PTY、Windows/live/packaged 和全量门禁未核销；
详见同一 rollout 计划及 maintenance-verification-summary-r33.json。

## 当前证据与实施顺序（2026-10-18）

CLI 唯一上游事实源是 `/Users/coso/Documents/dev/rust/codex`，本轮复核 HEAD
`8c076942cb70fba8e5c4732c23f1faabc4aed484`（原记录为 `4eb4a65407d98cebc4c83bf13be440b9fbc78a7c`）。
直接读实现、消费者和测试，不反编译 CLI。已核对 `compact.rs`、`session/turn.rs`、
`context_manager/{history,normalize}.rs`：工作树均与新 HEAD 一致；前后版本的压缩核心实现
与 rollover 行为未变，有变更的两处差异为 typed text 转换。文件 SHA 与对照记录保存在
`/tmp/lime-codex-context-source-evidence-20261018.json`，不将源码检查表述为运行证据。
REA 仅用于公开源码未覆盖的 Desktop 安装包行为；已有 ASAR SHA
`75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`，
静态图 parent `ev_9c3ce94f6ea6e0a65d3db7e2745c6e11eb7874d3f2e6140a0c387bb8d5ee1656`。
本轮 summary view 超出 REA transport 预算，不能当作已完整阅读的行为证据。
未进行 CLI 反编译。源码证据、安装包静态证据与真实进程证据分别记账。

用户已明确开发期间不考虑兼容和迁移，覆盖本计划及共享后端旧文档中的兼容要求。
直接替换 current 消费者并清理旧实现。插件、tar.gz 与 LimeCore 全范围继续保留，
执行优先级先转向下列核心机制；不以 UI 或插件切片完成替代核心完成。

### 多模型、多协议约束（2026-10-18 用户补充）

对齐 Codex 的 Context/Memory/Loop/工具生命周期时，必须继续通过 Lime 的规范内容和
共享模型路由执行。不得把 OpenAI Responses、OpenAI 模型名称、固定 context window、
tokenizer、reasoning effort、服务档位或 remote compaction 可用性设成所有模型的前提。
model catalog、默认选择、model switch、capability/readiness 与 retry/circuit breaker
继续归 `model-provider` 控制面；wire/auth/媒体 lowering 继续归各协议 adapter。
参考分工服从仓库架构：Codex runtime 源码、grok-build model control、OpenCode wire。
用户再次明确：**主对标始终是 Codex（CLI/runtime 源码、Desktop REA）；grok-build
仅参考多模型/多协议处理，不以其 Loop、harness、插件或产品限制替代 Codex。**

每个核心切片的退出条件必须覆盖：

- 四种当前协议族（Chat Completions、Responses、Anthropic Messages、Gemini）的
  规范请求与终态；Azure/Vertex 等认证、部署变体单独记账，不能据四族测试宣称已验证。
- 同一会话 model/provider 切换前后的历史、工具 call/result、摘要与冷重开；不能复用
  上一 provider 的 response ID、连接、凭证或预算。
- 当前选中模型的 context/output budget、generation/reasoning 能力、工具和媒体支持；
  不支持的能力明确拒绝或走有实现的规范转换，不静默丢内容、不伪造成功。
- provider-specific opaque state（含 encrypted reasoning/remote compact）仅在能力和
  路由匹配时消费；可移植模型摘要是共享窗口路径，不能把私有 state 写成跨模型 truth。

本轮 C01 追加四协议 HTTP request capture 和 provider 切换验证；这是可控 provider
集成证据，不能替代真实云模型、Azure/Vertex、Windows 或 Desktop/CLI/TUI host 验收。

Desktop REA 取证（2026-10-21）：对 `/Applications/ChatGPT.app/Contents/Resources/app.asar`
执行 `rea inspect-artifact --integrity-policy record-and-continue`，artifact SHA-256 为
`75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`，Evidence
`ev_d44527fcd437f7a9a6bae94cf4bdeee61132b1f7afa58b241c47a1099c87c939`。REA 记录了 7 个
打包后 native unpacked 文件的完整性矛盾；因此该结果只证明安装包身份与受限 inventory，不能
作为 Desktop runtime 语义证据。后续 Desktop 行为仍须用真实 Electron scenario 或重新取得
完整可信 JS graph，不能从文件名猜测 Context/Memory/Loop 行为。

grok-build 只读参考基线：`2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`，下表源路径相对
`/Users/coso/Documents/dev/rust/grok-build/crates/`；本轮抽取的 10 个文件均与该 HEAD 相同，
摘要在 `/tmp/lime-grok-multimodel-source-evidence.json`。源码检查不是运行验证。

| 可借鉴机制                        | grok-build 源码证据                                                                                                                                                                                          | Lime 承接与实施决定                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型切换是完整 sampling 配置变更  | `codegen/xai-grok-shell/src/session/acp_session_impl/model_switch.rs:handle_set_session_model` 同步 endpoint/backend、凭证、context/output budget、能力与压缩阈值，并 invalidate auth memo                   | 保持 Codex step snapshot/Turn 模型；在既有 route/settings owner 校准，禁止只改 model 字符串。C01 增加四协议切换请求/凭证捕获；C02 继续核对新预算                           |
| 复用 client 必须验证完整路由      | `codegen/xai-grok-shell/src/agent/remote_config/manager/mod.rs:model_shares_route` 检查 endpoint、backend 和 own credentials；`compaction_config.rs:AsyncCompactionCache` 绑定 model_slug/prefix fingerprint | Lime 已有精确 provider/model/endpoint/protocol/credential 的 health key；Responses session 继续由 `model-provider` 管理。不要另建全局缓存；C03/H01 核对 opaque state 失效  |
| reasoning 是模型能力              | `codegen/xai-grok-shell/src/agent/mvp_agent/reasoning_effort.rs:apply_supported_effort` 被创建/切换/summary 共用；manager 支持 effort 对应 wire model                                                        | Lime 已有 `model_capability`、`model_route_contract::provider_reasoning_effort`，C01 复用；effort→model 变体是否需要仍待 catalog 消费链复核，不新增名称猜测                |
| provider 默认值与模型覆盖统一解析 | `codegen/xai-grok-shell/src/agent/model_providers.rs:ConfigModelOverride::with_provider_defaults` 集中处理 backend、context、header/query 与认证优先级                                                       | 参考其优先级显式化；保留 Lime DB/catalog/auth 事实源，不复制 TOML 配置体系或另一套 provider registry                                                                       |
| token 与请求体字节双预算          | `codegen/xai-grok-sampler/src/config.rs:SamplerConfig` 分开 context_window/max_request_bytes；`session/helpers/prepared_compaction_history.rs` 将图片预算转换只做一次，并保留精确采样历史                    | C02/C03 后续应由 current canonical/media lowering owner 处理真实 payload、工具预算和图片；不得照搬供应商固定 30/50MB，也不能静默删用户媒体                                 |
| 错误分类决定重试和恢复            | `codegen/xai-grok-sampler/src/retry.rs:classify_error` 区分 auth、rate limit、token overflow、payload；`session/compaction_config.rs` 区分 turn/sticky/auth/credit 的 suppression                            | Lime 已有 provider transport/health/stream error；C01 失败不替换，后续重试应消费其类型，禁止通用无限重试。grok 的 image-strip/额度策略不直接照搬                           |
| catalog 有来源和就绪状态          | `codegen/xai-grok-shell/src/remote/model_source/oai.rs:cache_origin`、`agent/remote_config/manager/mod.rs` 的 catalog progress；`task_model_policy.rs` 将 provisional 与 complete 分开                       | Lime `model_registry_service` 已有 provider/endpoint/credential scoped cache。继续核对 readiness/default/subagent 选择，不把未加载当成无模型；不采用 xAI family 的产品限制 |

跨模型迁移历史、family-switch compact 和 harness 兼容性最终仍按 Codex 语义和 Lime 真实
能力验证；grok 中“压缩失败也切换”“零 Turn 重建特定 Agent”“首方模型默认继承”等行为
不构成 Lime 的自动需求。Gemini/Vertex 不在该 grok `ApiBackend` 三协议枚举中，继续由
Lime 现有 adapter 负责并独立验证。

| ID  | 机制与上游源码                                                                                                                                                                                                                                  | Lime current 链与已确认边界                                                                                                                                                                                                                      | 状态 / 退出条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | `core/src/compact.rs:run_compact_task_inner_impl` 克隆有效历史、追加摘要指令、请求模型，成功后才 replace；空/不完整响应不应提交窗口                                                                                                             | 原 `context_compaction.rs:build_summary` 的事件摘录已删除；current 为 `context_compaction/operation.rs` → `RuntimeBackend::summarize_context` → `agent::run_context_compaction_with_db` → `agent-runtime::context_compaction::summarize_context` | **in-progress P0**：执行器 3/3、App Server unit 31/31、四协议切换/真实 stdio/fork 已过；并行 actor 取消补丁进入 current Tree 后，本片完整集成 **34/34**，包含此前 4 项公共取消失败且无过滤。retry/overflow/remote compact 等尚未完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| C02 | `core/src/session/turn.rs` 的 pre-sampling、continuation/工具后预算检查及 `run_auto_compact`；`compact_remote*.rs` 为 provider 能力分支                                                                                                         | 生产者/reader/canonical/fork 已切换 `coveredThroughSequence`；边界核心 **5/5**，owner **2029/2029**、新 RPC **3/3**、压缩/stdio **35/35**、fork **1/1** 与 contracts 通过；fresh shell **24/24 Gate B-F**，aggregate 仍在 Workbench 失败         | **partial / known-gap loop P0**：child session-level checkpoint 连续普通 fork/冷恢复已实测，定向 **2/2**、boundary 公共 RPC **5/5**；steer durable admission 核心 **5/5**、actor **41/41**、公共 RPC **1/1**（含冷恢复）通过；模型历史输入来源/覆盖前缀、工具 continuation 后摘要/替换与成功 durable ACK 后推进窗口仍待接入。模型切换按当前预算/原路由能力处理，不以边界切片核销 C02                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| C03 | `core/src/context_manager/{history,normalize,updates}.rs` 管理模型可见上下文、工具 call/output 完整性和 world-state 重注入                                                                                                                      | `agent-runtime/context_history` 为采样/摘要共用预算 owner；原工具历史已原位泛化为 `model_history`，同一 EventLog/receipt 持久化 call/output 与 Responses completed envelope，adapter 拒绝不可表示的原参数                                        | **partial P0**：首轮四 owner **2597/2597**；补无 delta 完成后错误修正，Agent Runtime **246/246**、公共历史/跨四协议/冷恢复/fork **8/8**、错误/取消边界 **2/2**。模型历史七阶段恢复链 **314 项** 与 31 项独立前轮 green 覆盖通过，106 项源码/旧路径守卫通过；本切片 **3/4（75%）**；fresh stdio、真实 CLI native history 冷恢复与 GUI smoke 通过，Agent aggregate 仍在 Workbench 入口失败，后续未执行。见[模型历史计划](codex-model-history-alignment-plan.md)；旧模型原 route 压缩、原生 Anthropic/Gemini signatures、媒体、world-state、rollback 仍开放                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M01 | `memories/write/src/{start,phase1,phase2,runtime}.rs`：root/ephemeral gate、后台提取、全局 lease、受限共享 consolidation Agent、关闭后 artifact/baseline/selection 提交                                                                         | current owner 为 `LocalMemoryBackend`、`runtime/memory.rs`、RuntimeCore/session actor 和 model-provider 路由；精确来源快照、独立 phase-1 ownership、heartbeat/cancellation、shared ephemeral Agent session、workspace diff/baseline 与 selected-source/watermark 已接入。旧 `MemoryStageTwoProvider::sample` direct JSON proposal owner 已删除，phase-2 通过 `MemoryAgent` 进入共享 current provider loop       | **in-progress P0 / shared Agent open**：[Memory harness 计划](codex-memory-agent-harness-alignment.md) 为当前执行入口。精确快照最终定向 **39/39**、ephemeral 公共 JSON-RPC **2/2**、contracts 与治理通过；RuntimeCore **885/885**、agent-runtime **266/266**、client **50/50**、真实 stdio 工具续跑/内存历史/冷恢复对照、GUI shell **24/24** 和三个 Electron 定向场景通过；完整 local 门禁仍待独立续跑终态。仍须 typed internal admission、终态→shutdown→artifact→ownership→baseline→精确 selection 的完整失败矩阵、来源 Thread 生命周期及 reset/删除/disabled scope；不得以共享 Agent 启动证据核销 M01 全部。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| M02 | `memories/read/src/lib.rs`、`citations.rs`、`usage.rs` 的指令注入、引用和使用计数 | `runtime/memory_prompt.rs`、`memory_store`、`agent/durable_memory_fs` 已有读取/注入；配置页、笔记 CRUD 不证明记忆闭环。2026-10-20 已补齐 Codex-shaped `memory/status` public contract：`RuntimeCore -> MemoryAppDataSource -> LocalMemoryBackend`，严格校验 `v1`/四段落 summary 与 consolidation thread count；协议/schema/backend 单测通过。 | **partial / unverified P1**：readiness wire 已对齐，且 consolidated count 已收敛到 M01 的独立状态表；App Server read/search 现在将 citation path 写回状态 owner 的 durable usage counter，tool-runtime 继续输出 versioned `memoryUsage` 分类。完整检索→citation→usage feedback→后台模型 consolidation、memory prompt 注入闭环、禁用/删除/作用域和冷重开一致仍待 M01/M02 pipeline 实现；read-path 真实 provider capture 未完成。旧 `services::ContextMemoryService` 继续 dead-candidate，不得成为新 owner。 |
| L01 | Codex shared Turn/Loop：pending、工具 continuation、终止、错误、预算、Stop；Responses completion 的 end_turn/interrupted                                                                                                                        | 普通 empty/reasoning-only final 的额外采样已删除；显式 follow-up 保留。interrupted SSE/WebSocket 同 reducer 原八阶段 **404/404**，普通 final/interrupted 均 **3/4（75%）**。消息 phase 统一到 agent-protocol，原生文本 receipt 后提前完成        | **partial P0**：[phase 切片](codex-message-phase-alignment-plan.md) 已取得多消息失败 red；提前完成/四 phase/live-cold、delta-only unknown、后续失败/取消 **4/4 green**，相关 Rust 唯一用例 **1149/1149**、selector **8/8**、schema/consumer/contracts 通过；本片 **3/4（75%）**；fresh stdio、真实 CLI 冷恢复和 GUI shell **24/24** 通过，Agent 聚合的 369 项与三个 Desktop controlled 场景通过，随后 Workbench 入口失败；其余聚合未执行，失败原件保留。[完成快照切片](codex-output-snapshot-alignment-plan.md) 保留 **0/2 red**，现 core Rust **1026/1026**、frontend **78/78** 和 contracts 通过，**3/4（75%）**；fresh CLI 无/部分 delta 两组通过、shell **24/24**，stdio 原预算独立复跑通过（首次超时保留），Agent aggregate 在 Workbench 入口失败。诊断副本已证明旧宽泛选择器误点会话标题，current 侧面板/产物夹具完整迁移仍开放。[推理快照切片](codex-reasoning-snapshot-alignment-plan.md) 已接入原完成链并完成核心验证：owner/public Rust **1042/1042**、前端 **123/123**、contracts 通过，真实 CLI no-delta/partial 两组通过；该切片 **4/4 核心退出条件完成，产品验收 partial**。Desktop reasoning Gate B、TUI PTY、Windows、live provider、Plan/Stop/Memory/工具输出 drain、同 Turn compaction 与 sampling stream retry 继续开放；grok 不定义 Loop |
| L02 | `core/src/session/turn.rs:720` 在 `needs_follow_up=false` 时执行 Stop hook；block+continuation fragments 会继续同一 Turn，内部 Memory 整合拒绝递归续跑                                                                                          | `tool-runtime/hook_runtime/stop` 与 `agent-runtime/provider_turn/stop_hooks.rs` 已补 Stop/SubagentStop 执行合同；provider loop 在 terminal completion、pending input 收敛后消费同一 Hook snapshot，block 追加 durable `HookPrompt` 后继续同一 Turn，abort 终止，MemoryConsolidation 拒绝递归续跑                                                                                                                     | **partial / current loop slice complete**：Stop receipt、block/abort、防递归和取消定向回归已过；剩余是实际 CLI/TUI/GUI、managed hook 来源与完整四协议产品验收，不能据 Rust loop slice 宣称 L02 全部完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T01 | `core/src/tools/{router,registry,parallel,orchestrator}.rs` 及 `runtimes/` 的路由、并发、审批与 sandbox 重试                                                                                                                                    | `tool-runtime`、provider step snapshot、App Server reverse requests 已存在；R15–R20 仍有实际平台证据义务                                                                                                                                         | **partial P0**：工具规范及真正执行/输出回填/权限拒绝/进程 drain，不能按工具数宣称等价                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| T02 | `core/src/tools/handlers/{get_context_remaining,new_context_window}.rs`，由 `tools/spec_plan.rs` 条件注册；前者返回真实预算（unknown 保留），后者请求无摘要新窗口并尊重禁用                                                                     | `lime-agent/current_provider_turn/mcp_step_snapshot.rs` 按可信 `lime_runtime.context_policy` 注册 `get_context_remaining` / `new_context`；执行器使用同一 `RuntimeSessionInputHandle` 的 context-scoped input 计数，`new_context` 只请求 rollover，下一 step 清零该 epoch 计数并保留 turn 累计 usage                                                                                                                                        | **current slice complete / product partial**：Codex 条件注册、unknown budget、禁用 fail-closed、无摘要 rollover 和新 epoch 计数已接入；lime-agent 定向定义/执行 **2/2** 通过。真实四协议、CLI/TUI/GUI Gate B、持久窗口替换与 live provider 仍开放，不能据此宣称 T02 全部产品验收                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| E01 | `core/src/hook_runtime.rs` 的 SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop/PreCompact/PostCompact；skills/MCP/plugin 为 runtime 输入                                                                                               | `provider_turn/hook_snapshot.rs` 已把工具执行接 hook gate；C01 已实现压缩模型请求，Pre/PostCompact 生命周期 gate 仍缺                                                                                                                            | **partial P1**：按每个 hook 的阻止/继续/上下文语义核对；Skills/MCP/plugin roots、优先级及 reload 继续挂 S09                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| H01 | runtime harness：`core/src/session/{turn_context,step_context}.rs` 的 Turn grants 与每次 sampling 的不可变 settings/model/environment/MCP/tool/AGENTS snapshot；`ext/extension-api/src/registry.rs` 的 prompt/input/tool/lifecycle contributors | `runtime_backend/request_context` 组装配置、指令和预算；provider loop 已在每次 sampling 只 capture 一次 `RuntimeSessionStepContext`，工具定义/executor 与 Hook source 同用该 context，MCP/Hook snapshot 不一致时 fail closed；本地 function/custom tool call 的 lifecycle/provider metadata 也携带 `runtime_step_context` | **partial P0，已完成 current executor slice**：Codex 对齐实现已覆盖 immutable context capture、tool/Hook snapshot 共享、epoch mismatch fail-closed 和工具生命周期审计字段；`agent-runtime provider_turn` **85/85** 通过。剩余退出条件仍是实际 RuntimeSessionInputHandle 与配置/AGENTS/world-state 热更并发回归、Extensions contributor registry、CLI/TUI/GUI Gate B 和四协议 capture；不能以本 slice 宣称 H01 全部完成。 |
| H02 | verification harness：`core/tests/suite`、`app-server/tests/suite/v2` 的可控 provider、结构化请求捕获、故障与重启验证                                                                                                                           | current fixture 与 GUI smoke 已有，但之前通过的其他切片不证明 C01/M01/C02                                                                                                                                                                        | **in-progress P0**：每项缺口绑定可复现 request/event/history 断言，追加真实 stdio；GUI/CLI/TUI 分别证明 host，不以单元测试数量替代                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 分阶段交付与本轮写集

1. **K0 / 事实校准**：完成六轴矩阵，逐项区分 confirmed gap / partial / unknown；旧排除不能自动沿用。
2. **K1 / Context（当前）**：先 C01 模型摘要与持久窗口，再 C02 同 Turn 压缩和 C03 规范历史、世界状态；删除事件摘录“摘要”生产路径。
3. **K2 / Memory**：M01 模型提取和整合、任务 lease/backoff，再 M02 引用/使用反馈；与会话上下文窗口分离。
4. **K3 / Loop 与 Tools**：L01/T01 逐退出、重试、权限、并发、输出和恢复分支核对与补齐。
5. **K4 / Extensions 与 harness**：E01/H01/H02 贯通所有 core 行为；继续原插件清理和 LimeCore 合同，不创建第二 runtime。

本轮窄写集：`agent-runtime` 摘要执行模块、`agent` provider 接线、App Server
`context_compaction`/`session_control`/`ExecutionBackend` 对应实现、定向测试及本计划。
`runtime/session_lifecycle.rs`、`thread_read.rs`、`turn_execution.rs`、GUI、插件与
`internal/aiprompts/architecture.md` 已有并行修改，本轮保持只读。
现有 owner/依赖方向不变，摘要不引入平行 backend、不新增 public JSON-RPC 方法；
若后续 K2 改变 owner 或持久化架构，必须取得该架构文档的合并窗口并同步图。

K1 首片验收：规范 provider 历史含前窗口和工具结果 → 当前模型生成非空且完整摘要 →
唯一 durable compaction marker → 下一 Turn 和冷重开都消费同一 replacement history。
失败、取消、EOF、空输出不得提交 replacement；工具声明为空且不执行模型返回的工具调用。
验证从 owner integration / public JSON-RPC 起，随后固定产物真实 stdio 和 current fixture。
未实际执行的 Desktop/PTY/Windows/live 不算通过。整体分母仍未冻结，不报告虚构整体百分比。

当前 K1 Verification Contract：

- current owner/输入：App Server 操作队列、规范 provider history、当前 thread settings、共享
  route/capability/精确凭证；摘要执行沿现有 `app-server -> agent -> agent-runtime -> model-provider`。
- 用户结果：`thread/compact/start` 异步产生同一 Turn 的 contextCompaction Item 与终态；
  成功摘要推进唯一窗口并供下一 Turn/冷重开消费。EOF、length、filter、provider error、工具调用、
  空输出和取消不写成功 marker，Item/Turn 必须终结。
- 多模型合同：压缩/后续 sampling 与当前选择的 endpoint/protocol/model/credential 一致；
  跨协议只共享规范历史和文本摘要，不共享旧 `previous_response_id`。
- evidence：执行器 unit；public JSON-RPC + 四种 HTTP SSE adapter 的 lifecycle；同会话
  四协议切换；同一固定 binary 的真实 stdio 重启。Desktop、CLI/PTY 与 live 分别另验。
- 分类：模型摘要/共享路由为 `current`；原启发式摘要为 `dead/deleted`；MockBackend 和
  loopback HTTP provider 仅为显式 `test-only`；本片没有新增 `compat/deprecated` 或迁移。
- 结构：拆分 compaction operation/artifact/tests，各模块继续由既有 owner 持有；未引入
  public RPC、平行 runtime、provider registry 或 DB owner。architecture impact 为 minor，
  本轮未写入有并行改动的全局架构文件；不能据此声明重大架构改动已获确认。

### 本轮记录

- 2026-10-18：K0 首轮完成，C01/C02/M01 已定位；C03/M02/T01/E01/L01 的剩余分支继续核查。
- K1 首片：已接入规范 provider 历史→共享 route/精确凭证→无工具模型摘要→durable window；压缩任务开始消费取消令牌，并新增失败/取消的 Item 终态。原事件摘录摘要已删除，产物、调度、测试已拆分，最大文件 508 行。尚在编译和行为验证，不标完成。
- 原始直接 `cargo test` 未使用仓库 V8 配套环境，依赖构建因 denoland V8 150.4.0 archive 404 失败；已改用 `test:rust:unit` / `test:rust:integration` 的仓库 artifact resolver 重跑。失败日志保留于 `/tmp/lime-core-context-{runtime,app-server}-tests.log`，不计产品失败或通过。
- C01 首片仍不包含 Codex remote compact V2、stream retry/overflow 降窗、Pre/PostCompact hooks、usage attribution、同 Turn compaction 与完整尾窗口策略，分别继续挂 C01/C02/C03/E01；不能用模型请求接通宣称整个 Context 已对齐。
- `agent-runtime` 摘要执行器 3/3 通过（包含预取消不得新发请求、pending stream 取消、完整非空响应和不完整输出拒绝）；首次定向运行发现预取消仍构造 provider request，已在入口检查 token 后回归通过。日志 `/tmp/lime-core-context-runtime-tests-final.log`。
- `test:contracts` 已 exit 0，日志 `/tmp/lime-core-context-contracts.log`。集成 runner 的 `--tests` 会扩大编译范围，已停止本轮该进程，改用同一 V8 artifact resolver 的精确 Cargo `--test` target；不是通过。随后修复新测试模块 path 与 v2 常量导入的编译问题，当前集成仍待终态。
- 压缩 Item identity 修复：原 ID 依赖成功窗口编号，失败后再次尝试会覆盖前一 Item；现改为每次尝试独立 ID，started/failed/interrupted/completed 和 artifact 共用该 ID，成功窗口编号仍只在成功后推进。四协议 lifecycle 补充失败/取消 Item 各留在原 Turn 的断言；输入历史组装失败也进入受控终态。
- 首次 App Server 定向 unit 为 29/31：两处旧断言仍要求启发式事件摘录，已改为显式测试 backend 的模型摘要合同并重跑，不能把首次结果算通过。`docs:boundary` 已通过。最终 unit、四协议 integration、真实 stdio 及 current fixture 仍待终态。
- REA 复用同一 Desktop parent 的 4-module page 再次遇到 transport 预算限制，返回 view `ev_ae40de94208672a34b9bf0a69049fccf63a74f0df212b0de2abcdf386ae6a91f`；不把未读 payload 算证据。随后导出请求在 300 秒超时，未取得 `/tmp/lime-codex-context-rea-evidence-20261018.json` 成功产物；本轮没有新增 Desktop 运行行为结论。
- C02 下一刀的源码触发点已复核：`session/turn.rs:659` 的 `should_roll_over` 要求还有 continuation，工具结果回填后检查预算，再由 `run_auto_compact` 成功替换历史并继续同一 Turn。Lime 对应点为 `agent-runtime/provider_turn.rs` 的工具结果加入 `initial_messages` 后、下一 sampling 前；后续必须把替换历史与 durable window 接回 App Server owner，不能仅在 loop 局部改消息而使冷重开恢复旧窗口，也不能调用会取消当前 Turn 的手动 compaction operation。
- 最终源码的 App Server 定向 unit **31/31 通过**，日志 `/tmp/lime-core-context-app-server-unit-final.log`。首次四协议 integration 为 3/9：Chat/Anthropic SSE fixture 缺少真实协议必填字段，已按 current protocol 修正；stdio 后台 catalog GET 探测原使采样 fixture panic，现明确返回 404，保持手动模型配置为测试前提，不伪造 catalog 成功。
- 四协议测试还定位生产阻塞：compaction task 未登记共享 `RuntimeTurnDriverCompletions`，公共 `turn/interrupt` 返回 `active runtime turn is missing its driver completion`。最小可见性补丁已写 `/tmp/lime-compaction-driver-visibility-proposal.patch`；因 `turn_execution.rs` 处于其他改动写集，依并行协作规则已请求合并窗口，尚未应用。取消场景不能标通过；先重跑不依赖该补丁的切换/stdio/fork 场景。
- current fixture 聚合首次在已有 trace collector 的 5000ms 超时处失败，真实 Electron 子场景尚未执行；此前历史 31、流式终态 34、消息终态 3 项通过，guard 299 通过/1 超时。该 guard 单独复核 **69/69 通过**（`/tmp/lime-core-context-trace-guard-recheck.log`），未改超时或断言，聚合已重跑。首次日志 `/tmp/lime-core-context-current-fixture.log`，不能算 Desktop Gate B。
- SSE/catalog fixture 修复后，精确 `thread_compact_jsonrpc` 重跑 **5/5 通过**，其中包括同一 Thread 的四协议切换、固定二进制真实 stdio 进程退出/重启和持久历史恢复；本次明确过滤 4 个待 driver 修复的取消 lifecycle，不能记为 9/9。固定 App Server SHA256 `0b07966b237a9c8501d80e58aa0a6636a31a29ba03972a4a9c99f001c750bd94`，日志 `/tmp/lime-core-context-app-server-tests-wire-recheck.log`；上游 HTTP 为 loopback 可控 SSE fixture，不是 live provider。该证据不含 `lime exec`、PTY、Electron 或 Windows。
- 同一精确 Cargo 命令中的 `thread_fork_compaction_jsonrpc` **1/1 通过**，证明压缩 replacement + surviving tail 的 fork/冷重开；该命令最终 exit 0。current fixture 聚合重跑的全部四组前置测试通过（31+34+3+300），并通过版本一致性 1.161.0；其下游默认 evidenceDir 仍是 `.lime/qc`，为遵守本轮只写 `/tmp` 的证据边界，已在真实 Electron 子场景开始前停止本轮聚合进程（exit 130）。未修改 runner 或放宽断言，没有恢复 `.lime/qc`；完整聚合、GUI smoke 和 Desktop Gate B 均未通过/未取得，不能用前置测试替代。
- 本轮收尾分类：current 为模型摘要和共享 route/窗口链；原启发式生产摘要为 dead/deleted；HTTP SSE 与 MockBackend 摘要仅为 test-only；没有新增 compat/deprecated 或迁移。关键剩余项为 C01 公共取消接线及其 4 个 lifecycle 回归、C02 同 Turn 压缩和 C03 完整历史策略。整体验收分母尚未冻结，不填虚构总体百分比；本轮未执行 `verify:local`、完整 GUI/CLI/TUI/Windows/live，当前状态仍为 active。

### C03 / 工具历史规范化（2026-10-18，当前切片）

- 上轮归类：progress，完成 31 项 App Server unit、四协议切换/真实 stdio/fork 证据并定位取消阻塞。C01 driver 可见性补丁仍待共享文件合并窗口，不将自动 goal continuation 视为该确认。
- Codex `context_manager/normalize.rs:ensure_call_outputs_present/remove_orphan_outputs` 在每次 `History::for_prompt` 前执行：保留调用、为缺失结果合成 prompt-only `aborted`，移除无调用的结果；raw function/custom/tool-search/local-shell 按各自 family 匹配。合成 raw Item ID 由固定 namespace + 源 Item ID 的 UUID v5 派生，避免重试/恢复时破坏缓存前缀。server tool-search output 可独立存在。
- 已确认 Lime gap：`provider_history` 直接拼接 canonical call/result；`model-provider/safety.rs` 的旧 projection normalizer 只有自身测试引用、无生产消费者，且其丢弃无结果调用的语义不等于 Codex。活动 `thread/inject_items` 又可在 loop 中进入，故规范化唯一 owner 放在既有 `agent-runtime`，普通 sampling 和 context summary 在请求边界共同消费。
- 窄写集：`agent-runtime/src/context_history{.rs,/}`、`lib.rs`、`provider_turn.rs` 的调用点及测试声明、`context_compaction.rs` 的调用点及测试；其 crate manifest 的 UUID v5 feature 和 Rust lock；无消费者旧 normalizer 的 `model-provider/safety{.rs,/tests.rs}`；App Server 定向 request-capture fixture 与本计划。`turn_execution.rs`、`thread_read.rs`、GUI、插件、全局 architecture 继续只读。
- Verification Contract：输入为规范 provider messages（含 raw response items）；输出保留有效 call/result 和媒体/扩展 payload，为缺失输出补 aborted，移除 orphan，重复规范化不增生；原消息和 durable canonical log 不被改写。每次 sampling（含活动注入、empty-response retry）和模型摘要都必须走同一 helper；HTTP request capture/冷重开证明真实生产消费者，不用单测代替 stdio/GUI。
- 文件规模退出条件：`provider_turn.rs` 已超过 1000 行，本切片只加 helper 调用，所有规范化业务逻辑和新行为测试拆到独立模块；不继续堆叠 loop 业务。依赖不更新版本，仅在 `agent-runtime` 启用现有 UUID crate 的 v5 feature并同步 lock，验证 app-version。owner/依赖方向沿原 `agent-runtime -> model-provider`，没有新增 backend、持久化 owner、RPC 或迁移；架构影响为 minor。
- 退出条件：定向 unit + loop/summary 接线验证通过，公开 JSON-RPC 触发的真实 HTTP 捕获能证明规范化及冷重开；旧 helper/测试正向语义删除；contracts、app-version、docs 与 diff 检查通过。媒体 capability stripping、预算/裁剪、world-state 重注入和完整 Context 仍另行核对，不能用本片标 C03 全部完成。
- 实施中：新增 `context_history{.rs,/raw.rs}`，普通 sampling（包括 retry/活动注入）与模型摘要共同消费；按 function/custom/search family 配对，raw local shell 复用 function 输出，保留 server search 与有效媒体/扩展。UUID v5 feature 同步引入锁文件 `sha1_smol`，无版本升级。旧 safety projection normalizer 与 5 项过期正向测试已删除，未新增兼容包装。
- 验证夹具：`provider_turn/tests/context_history.rs` 捕获 empty-response retry 的两次请求且要求工具执行事件为零；`context_compaction/tests.rs` 捕获摘要请求；`thread_compact_jsonrpc/{history,history_protocols}.rs` 从公共 RPC 进入真实 HTTP SSE，覆盖 raw 注入/冷重开/摘要、活动同 Turn 注入，以及四协议 canonical 恢复；持久化断言要求只保留原始记录，不能写虚假工具完成。夹具不是 live provider、stdio、CLI/TUI 或 Electron 证据。
- REA 后续：同一 parent 的 modules page 从 4 缩为 1 仍超 transport（至少 10,555,768 bytes），保留 view `ev_e022fccda2cf66f13832c7665e4fc23c0ad1a37467094abe5018f71bb23323c0`；未取得新增可读 Desktop 行为，不重复相同失败调用。当前工具历史语义仍由 Codex 源码证明。
- 静态门禁结果：`test:contracts`、`verify:app-version`、`governance:legacy-report`、本片 rustfmt 与 diff check 均 exit 0。测试与 source checkpoint 均写 `/tmp`，未恢复 `.lime/qc`。
- 首片定位的校验缺口：Codex `protocol/src/models.rs::ResponseItem::FunctionCallOutput` 的 `call_id` 可空，并可携带 `name`/`namespace`；当时 Lime 的 union 仍要求字符串 `call_id`，normalizer 单测不代表公共注入已支持。该缺口已由下文命名外部工具结果切片直接修正，并补公共入口/持久化/真实 provider 请求回归。
- 定向首轮结果：`agent-runtime --lib context_` 15/15 通过（其中新 normalizer 5 项、loop 接线 1 项、摘要 4 项），随后完整 `agent-runtime` 223/223、`model-provider` 263/263 均通过。`test:contracts` 已 exit 0；新 stdio fixture 从同一构建二进制拷贝固定产物，经 initialize/initialized、注入、sampling、进程退出/重启与摘要，不提升为 CLI/TUI 或 Electron 验收。
- C02 下一刀校准：`session_loop/input_queue.rs::request_context_rollover/capture_step_context` 仅设置请求标记并推进 step 的 `context_epoch`，现有 unit 不证明已执行 compaction。Codex `session/turn.rs:should_roll_over` 在工具/后续采样前运行 `run_auto_compact(MidTurn)`。Lime 必须把模型摘要成功后的 durable replacement 接回同一 Turn，并使失败/取消不提前推进窗口；不能借用会中断 active Turn 的手动 `thread/compact/start`，也不能以 `context_epoch` unit 宣称 C02 完成。

### C03 / 工具配对切片验收记录

- 当前行为与结构：每次 sampling/summary 从同一 `context_history` owner 生成模型可见副本；工具调用保留，缺结果补 prompt-only aborted；function/custom/search 分 family，server search 独立输出保留；raw 合成输出使用既有 raw-item 通道，避免 Responses tool-role lowering 过滤。没有新增后端、RPC、迁移、兼容包装或第二套 provider 规则。
- 清理分类：上述规范化模块为 `current`；`model-provider/safety.rs` 无消费者旧 projection normalizer、5 个 projection 类型、5 项过期正向测试为 `dead/deleted`；HTTP SSE、canonical 不完整历史和 stdio provisioning 为 `test-only`；无新增 `compat/deprecated`。
- 验证：`cargo test --manifest-path "lime-rs/Cargo.toml" -p agent-runtime -p model-provider --lib --no-fail-fast` exit 0，分别 223/223、263/263；`cargo test --manifest-path "lime-rs/Cargo.toml" -p app-server --test thread_compact_jsonrpc history --no-fail-fast` exit 0，8/8。两命令均经 `resolveRustyV8CargoEnv` 注入仓库既有 V8 artifact，未变更全局环境。
- 证据：`/tmp/lime-context-history-unit{,-full}.log`、`/tmp/lime-context-history-jsonrpc.log`、`/tmp/lime-context-history-{contracts,version,governance}.log`、`/tmp/lime-context-history-source-checkpoint.json`。本次 App Server binary SHA-256 为 `8205e45c5ea38cbe88bad6d8ff39070eed7101a6b2920612584f1cceb48ec9d5`；stdio 先复制同一二进制，再执行真实 initialize/initialized、采样、关闭/重启与摘要。没有使用 stale binary override。
- 边界：四协议 canonical fixture、Responses raw 冷重开/活动注入/摘要共 6 个 public RPC + HTTP 场景；另 2 个为真实 stdio 进程边界。媒体原样保留只在独立 normalizer unit 验证，HTTP fixture 使用声明支持的文本和结构化文本结果，未以 text-only 模型承诺图片能力；Azure/Vertex、live provider、Windows、CLI 和 PTY 仍未验证。
- Desktop current fixture：`cancel-then-continue` exit 0，证据 `/tmp/lime-context-history-gui-evidence/context-history-summary.json`，run=`standalone-context-history`，`Gate B controlled fixture`。真实 Electron/preload、115 次 `app_server_handle_json_lines`、当前 `turn/start`/`turn/interrupt`/`thread/read`、同 session 的取消/继续、read model 和可见状态均通过；legacy/mock fallback、页面错误/崩溃均为 0，正常退出与临时环境清理通过。backend 为显式 external/test-only，绕过生产 provider/tool executor，不证明 GUI 实际执行了本片 normalizer；其生产模型消费由前述 HTTP/stdio 证明。首次 fixture 卡在启动前 cargo metadata，已仅终止自己的进程（143）；随后通过 `APP_SERVER_BIN` 指向刚构建并核验的二进制重跑通过，未手动设置 build-ready 跳过前端校验。日志 `/tmp/lime-context-history-gui-fixture{,-fixed-bin}.log`。 Desktop 启动沿既有 `ensureElectronAppServerRuntimeBinary -> ensureMacBinaryRpath` 准备 macOS 产物；准备后 SHA-256 为 `74ed3a272977bcf22ab393b27a6af84e8c9e52023e80e36ed90423a0e5e12b11`，与 stdio 测试前的原始产物摘要分别记录，不混称相同 digest。
- 本片行为/结构/清理完成度：100%（仅限本节工具配对合同）；声明的 Rust/App Server/stdio 验证为 8/8 + 486/486，定向 Desktop controlled fixture 为 1/1。整体 C03 仍为 partial；整个核心对齐分母未冻结，不填总体百分比。聚合 `smoke:agent-runtime-current-fixture` 无证据目录参数，本轮未整体重跑；默认 `verify:gui-smoke`、`verify:local`、完整 CLI/TUI/Windows/live 未执行。本轮验证 current 工作树但不接管其他 GUI/插件改动，也不声明全仓发布门禁完成。
- 避让写集：`turn_execution.rs`、`thread_read.rs`、`session_lifecycle.rs`、GUI、插件、全局 `architecture.md` 及相邻未知未跟踪产物保持只读。架构影响 minor，现有 owner 和依赖方向不变；root 已核对，无重大架构图变更。
- 下一刀继续 Codex 主线：C01 取消 driver 的共享文件合并窗口；C02 同 Turn 压缩；C03 外部命名结果/媒体/预算/world-state；M01 模型记忆流水线与 L02 Stop hook 仍未关闭。插件、tar.gz、LimeCore 范围没有取消，grok 仍仅参考多模型。

### C03 命名外部工具结果合同（2026-10-18，本片完成）

- 主对标仍为 Codex。已直接读取 `protocol/src/models.rs:1173` 的 `ResponseItem::FunctionCallOutput`：`call_id`、`name`、`namespace` 均为可选字段。`ResponseInputItem::FunctionCallOutput` 的必填 ID 不适用于 history-only `thread/inject_items`。缺 ID 的结果不参与 call/result 配对；不生成假调用或假完成。
- 写集限定 `agent-protocol/src/response_item.rs` 和新 `response_item/tests.rs`、本进程既有 `thread_compact_jsonrpc/history.rs`、原来干净的 `thread_inject_items_jsonrpc.rs` 及本计划。直接修正唯一校验 union；App Server 继续校验后持久化原始 JSON，普通采样和模型摘要共用 C03 normalizer。
- `ThreadInjectItemsParams.items` 在 Rust schema、typed clients 和 Host 通道一直为 JSON values；本片不改变 envelope、方法或 JSON schema，不新建平行 DTO/转换层。退出条件为命名结果通过公共入口、原始字段/缺失/null 状态在 durable log 与 Responses 请求中保持、冷重开与同 Turn 注入/摘要不丢失；非法字段和远程图片仍拒绝。
- 多模型边界保持：原始 Responses item 仅在支持它的路由消费，不将 provider opaque state 盲转为四协议共享内容。四协议 canonical 工具历史测试继续作为独立回归；不据 Responses 命名结果宣称跨协议转换已实现。
- C02 只读接线结论：`provider_turn` 的工具回填后需异步获得 App Server durable window 提交 ACK，再替换活动 history 并推进 epoch；`AgentEvent` 同步回调/host channel 不能充当持久化确认。现有手动 `compact_session_now` 会取消活动 Turn 并新建压缩 Turn，不可复用为同 Turn 行为。所需共享写点为 `turn_execution.rs` 的 `ExecutionRequest`/sink 装配以及既有 `AgentSessionConfig` 承载；继续避让其它进程的 Turn/恢复/GUI/插件/architecture 热区，不把本片标成 C02 完成。
- 验证：新增 `response_item` 定向 unit 3/3 通过；同一编译产物的完整协议库测试 46/46 通过（3 项已包含，不能重复相加）。`thread_compact_jsonrpc history` 8/8、`thread_inject_items_jsonrpc` 2/2 均 exit 0；前者包含四协议 canonical 历史，以及 Responses 原始命名结果的活动注入/冷重开/模型摘要和真实 stdio 进程重启。后者补非法 namespace、缺 output 和命名远程图片的公共入口拒绝。`test:contracts`、定向 rustfmt、diff check 均 exit 0，生成类型无漂移；7 个本片与 Codex 源文件摘要在验收时无漂移。
- 证据：`/tmp/lime-context-external-result-{unit,protocol-full,jsonrpc-history,contracts}.log`、`/tmp/lime-context-external-result-source-checkpoint.json`。首次集成命令误选整个 compact target，已在等待构建锁时只停止自己的 Cargo（exit 1），随后以 `history` 过滤重跑；首次不计通过，已知 C01 取消 driver 场景没有被本片关闭。
- Desktop REA：原整包 parent 的 `modules` page offset 16/limit 1 仍超 10 MiB，保留 view `ev_f1653eba2a9b26848b7e1795c5c7f148b9f7ca4ba8ea6c7dc855571a8ec6c119`，不重复同输入。改为从同一 ASAR 提取两份原始模块（共 172656 bytes），ASAR SHA 仍为 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`；提取清单与模块 SHA 在 `/tmp/lime-context-external-result-rea-extraction.json`。REA parent `ev_a2581e7d24c79624652e0f10e031d873253f5ee5ff21788e160bf709fa046079` 成功解析 2 文件、零 parse failure，但 semantic graph 触及 100000 节点上限，为 partial。再收窄到原始 `.vite/build/conversation-turn-mutations-szl89rld.js`，SHA `116870fb4aa77e0d56a9c1aef70b7c6b21a7ea30ef5b601a6d2a7cb7b719c3ec`；parent `ev_83540c1cd6213bb97133356f8dfe9fab0b18e0b2133d8484a545de841ca35a13` 无节点裁剪，语义仍有 2990 unknown。两次 `contextCompaction` 语义 trace 为 partial/零匹配（后次 `ev_ebc991fe411687425e9b74a9bc3099e4f40311a9aac3ff357435afbedafd97d8`），不能据此判定能力缺失或完整行为。完整返回的 summary/trace 保留 `/tmp/lime-context-external-result-rea-{summary,mutations-summary,mutations-trace}.json`；本片不新增 Desktop 运行结论，工具结果语义仍由 Codex CLI 源码和 Lime HTTP/stdio 证明。
- 分类与完成度：校验 union/既有注入、历史、摘要主链为 `current`；新增夹具为 `test-only`；无新增 compat/deprecated、迁移、双读写或新后端，本片无需删除其它实现。命名外部结果行为/结构合同完成度 100%，整体 C03 仍 partial，核心总分母未冻结，不填虚构总体百分比。没有 GUI/Host 代码变化，未重复上一片 Desktop controlled fixture；本片不声明 GUI、`lime exec`、PTY、Windows、live、Azure/Vertex 或 `verify:local` 全仓验收通过。
- 架构影响 minor：owner 与依赖方向不变，root 已核对，无重大架构图变更。避让写集仍为 Turn/恢复/GUI/插件/architecture 热区；下一刀由本进程继续 C03 媒体/预算核对及 C02 共享入口接线，插件、tar.gz、LimeCore 范围保持；整体核心对齐仍 active。

### L02 / Stop 输入、裁决与管道执行（2026-10-18，首片已验证，Loop 未完成）

- 主目标不变：Codex CLI/runtime 直接读源码，Desktop 复用 REA 安装包证据；grok 仅参考多模型。C01/C02 的共享 Turn 装配文件仍待合并窗口，本片先补 L02 执行器，不将配置枚举或 parser 通过当作 Loop 对齐完成。
- 窄写集：`tool-runtime/src/hook_lifecycle{.rs,/stop.rs}`、`hook_gated_executor.rs` 的 context literal、`hook_runtime{.rs,/stop.rs,/stop/tests.rs,/tests.rs}` 和本计划。Turn/恢复/GUI/插件/architecture 热区继续只读；没有新 public RPC、crate、持久化 owner 或迁移。
- Codex 事实源：`hooks/src/schema.rs` 的 Stop/SubagentStop 输入与输出；`events/stop.rs:parse_completed`、`engine/mod.rs:ConfiguredHandler::can_apply_control_effects`、`engine/dispatcher.rs:select_handlers_for_matcher_inputs`；`core/src/session/turn.rs:720`、`core/src/hook_runtime.rs:run_turn_stop_hooks`。
- Verification Contract：current owner 是既有 CommandHookReporter。输入必须含 canonical thread/turn、当前模型/权限、nullable transcript/last message、stop_hook_active；SubagentStop 另有 agent ID/type/transcript，不夹带工具字段。失败缺上下文不启动命令；真实命令 stdin、report、Started/Completed 和裁决 ID 关联同一 invocation。
- 裁决：只有同步 Hook 能 block/stop；exit 2 必须有非空 stderr，JSON block 必须有非空 reason；`continue:false` 优先且缺 stopReason 不造默认文案；执行/JSON 失败是 Failed，不变成续跑反馈。Stop 不消费工具 additionalContext/updatedInput；systemMessage 记录 Warning。根 Stop 忽略 matcher，SubagentStop 按 agent_type 匹配。
- Lime 适配：`processor/v2_notifications/hook.rs` 按 `run.id` 去重 Started/Completed，故重复 Stop 必须保留每次 invocation 的独立后缀；执行器与 evaluation 共用同一 ID 算法，避免重复续跑被通知层吞掉。不是复制 Codex minified 名称，也不新增平行 lifecycle owner。
- 结构：Stop 专用输入/输出拆成小模块；既有 270 行内联测试机械迁至 `hook_runtime/tests.rs`，避免继续扩大原 773 行执行器。owner/依赖方向不变，架构影响 minor；root 已确认，无重大架构图变更。
- 本片退出条件：执行器真实命令/生命周期集成、裁决边界回归和受影响 owner 测试通过；定向格式与文档检查通过。实际 Loop Stop 消费、canonical root/child/internal 来源、持久 HookPrompt、取消与防递归后续仍须贯通，L02 保持未完成。
- 首次 Hook 领域定向 `cargo test -p tool-runtime --lib hook_` **41/41 通过**，包含 9 项新增 Stop 单元/真实子进程与生命周期场景；日志 `/tmp/lime-stop-hooks-domain.log`。`test:rust:related` 继续编译 7 个 owner/反向依赖，`test:contracts` 已确认生成协议无漂移，终态待记录；不提前计为通过。
- 后续直接读取 Codex `engine/command_runner.rs:276` 与 `command_runner_tests.rs:263/297`，确认 Lime 另有真实执行缺口：stdin 在 timeout 外串行写入，写满 pipe 时无法超时，也无法同时 drain stdout/stderr；提前退出的 Hook BrokenPipe 会丢失有效输出。已将 stdin/write 和 wait/output 放在同一 deadline 下 `try_join`，BrokenPipe 不覆盖真实退出结果。为验证最终代码，停止了本进程原 related Cargo（尚处 App Server 编译阶段、exit 1，无测试通过结论）；最终改用完整 owner 测试与消费者编译验证，不冒充 7 crate related 全过。
- 同轮对齐 `NullableString::from_path` 的 display string 与 `output_parser::parse_json` 的 JSON object→wire 两阶段校验。新增 1 MiB 不读 stdin 的快速退出、双输出 pipe drain/输入阻塞超时、非 UTF-8 路径三项回归；后两项是 Unix/macOS 范围，Windows 真实进程证据仍须独立取得。进程树取消清理与 Started 的取消终态没有被本片关闭，继续归 L02 后续。
- 最终完整 `tool-runtime --lib` **522/522 通过**（包含 12 项 Stop 输入/裁决/真实命令与生命周期测试），日志 `/tmp/lime-stop-hooks-owner-final.log`。`test:contracts` 已 exit 0（`/tmp/lime-stop-hooks-contracts.log`）；9 个 Codex 源文件和 Desktop ASAR SHA 均复核未漂移。消费者 `cargo check -p agent-runtime -p lime-agent -p app-server` 正在执行；最终文档/格式/摘要复核待记录。
- 最终消费者 `cargo check -p agent-runtime -p lime-agent -p app-server` **exit 0**，日志 `/tmp/lime-stop-hooks-consumers-check.log`；定向 rustfmt、scoped diff 与 docs boundary 通过。收尾再核对 `events/common.rs:matches_matcher` 与 `engine/matcher.rs:HookMatcher`，确认沿用的 exact/alternation/regex matcher 合同一致；参考源摘要清单扩至 11 文件，记录 `/tmp/lime-stop-hooks-source-checkpoint.json`。不重新执行已经通过的 contracts 或扩大到全仓测试。
- 分类与完成度：既有 `tool-runtime` 为唯一 `current` owner，Stop 借用工具输入/通用裁决的路径已直接替换；无新增 compat/deprecated、迁移或后端。输入、裁决、同步管道 I/O 这 3 项本片合同 **3/3，100%**；这不是 L02 整体完成度。现有 controlled GUI fixture 绕过生产 Hook 执行器，故本片不将其作为 Stop 证据；没有新增 public RPC、Host、GUI 或 Loop 接线，未跑 GUI/CLI/PTY/Windows/live、Azure/Vertex 或 `verify:local`。不进入全仓 release evidence。
- 下一刀仍是生产 Loop：保留同一不可变 step Hook snapshot，按 AgentGraph 识别 root/ThreadSpawn/internal 来源；将 XML-escaped、user-role HookPrompt 通过 canonical owner 持久提交后再同 Turn 续跑，补取消终态与 Memory 防递归。不得把 `forked_from_thread_id` 当 ThreadSpawn，也不得使用 developer-only 队列代替 HookPrompt 的 durable ACK。所需 Turn/协议/恢复/GUI 热区继续依共享写集规则协调，本进程不夹写。插件、tar.gz、LimeCore 范围不取消。
- Desktop REA 补查：复用原两模块 parent 的 `hookPrompt` literal trace（`ev_c3aba915577df7b23486eca48bfabb10e523925d9159aa8d30f900b73570e939`）与 semantic trace（`ev_d57a859ea6415db8a75411fe4d1b352d352c2fa445505d454b8483e87322a2f5`）均零匹配，后者 partial，不能作为缺失证据。随后只分析同一 ASAR 原始 `execution-fde3a4937b6a.js`（119857 bytes、SHA `5c300497b7331bfa317231251e1097385405b70f2746b1fe8959c74e56735811`），parent `ev_961bb054a031f73fa6c600cc84e98e6a6c41ddee0adc1c2bdbbb02701e54689c` 零 parse failure，semantic 仍触及 100000 节点上限。
- 为明确覆盖边界，从该原始模块按 AST 提取 `[79517,81522)` 的 2005-byte 原字节函数片段（SHA `855a473ada87be2263e3e7411027e4fafae07889f8ade9faa56cbb1d6b84937e`），含 `hookPrompt`→`type/id/fragmentCount` 的静态返回分支。片段 REA parent `ev_f84c800b746671dee842fa2d067bff922ddb081b8f5f0181b6f848e143ff3d6f` 无裁剪/parse failure，但有 108 unknown；`hookPrompt` semantic seed 仍零匹配/partial（`ev_84f4d5391dff4ea5e786b423f5daa2c2c489b00d0192cf01e5aa45391793bfce`）。不把人工读到原字节的分支包装成 REA 已证明运行链路，也不把 minified 函数名当上游源符号。清单、summary/trace 均保留 `/tmp/lime-stop-hooks-rea-*.json`；没有新增 Desktop 运行行为结论。

### C03 工具文本历史裁剪（2026-10-18，本片完成；C03 整体 partial）

- 主对标是 Codex `context_manager/history.rs:record_item_with_metadata`、`utils/output-truncation`、`utils/string/truncate.rs` 和 `protocol::TruncationPolicy`；grok 不参与该行为裁决。
- 已确认断链：`ModelRequestPolicySnapshot.truncation_policy` 未进入 `RuntimeReplyModelRequestPolicy`；恢复投影固定 10KB，活动 Turn 直接回填完整工具结果。新模型的预算因此不能统一影响普通采样、重试和模型摘要。
- 窄写集：`agent-protocol/src/{lib.rs,truncation.rs}`；`model-provider/src/provider_stream{.rs,/tests.rs}`；`agent/src/model_request_policy{.rs,/tests.rs}`；`tool-runtime/src/tool_io{.rs,/tests.rs}` 和 `unified_exec/output.rs` 的类型引用；本进程已有 `agent-runtime/context_history`、`context_compaction`、`provider_turn` 及其定向测试；原先干净的 `app-server/runtime/provider_history{.rs,/canonical.rs}`；已有 `thread_compact_jsonrpc` 测试模块与本计划。避让 Turn 持久化、恢复投影、GUI、插件、全局 architecture 共享热区。
- Verification Contract：唯一内容预算类型归 `agent-protocol`；当前模型策略沿现有 harness→model request policy 传给普通采样和摘要。共享历史处理仅裁剪请求副本，保留完整 durable log、call/result identity、success/error 与媒体/opaque 字段。文本使用 Codex UTF-8 首尾保留和 20% serialization allowance；Tokens 是明确的 byte heuristic，不假定所有模型共享 OpenAI tokenizer。删除旧固定 10KB 投影裁剪与退役类型，无兼容包装。
- 本片退出条件：显式模型预算传递和不同策略的采样/摘要、同 Turn 工具后续采样/空回复重试、原始与结构化文本输出、四协议 HTTP capture 的冷恢复与摘要验证；相关 owner 测试、contracts、格式和文档检查通过。媒体/audio 的完整成本策略、每项持久 provenance 预算与 world-state 重注入仍属 C03 后续，不能将本片写为完整 Context 对齐。
- 架构影响 minor：复用协议、model policy、工具 I/O 与历史 owner，无新 crate、RPC、后端或存储。大文件只作最小接线/删除旧逻辑，新增处理与测试落独立模块；本轮 root 确认依赖方向不变，不宣称共享架构图的重大变更已确认。
- 验证预算 `budget:tight`，负责人 root，风险 P0。公开入口复用 `thread/start`、`thread/resume`、`turn/start`、`thread/inject_items` 和 `thread/compact/start`；结果消费由既有 provider request 和 canonical lifecycle 持有。没有新 Host 命令或 GUI 投影，新增行为的证据等级为 domain + App Server integration，通用 current fixture 只作为额外回归，不能代替 provider 采样证据。
- 源码摘要 `/tmp/lime-history-truncation-source-checkpoint.json` 记录本片 6 个 Codex 文件和后续 catalog/工具预算核对的 2 个文件；8 文件在收尾检查时均与 HEAD 一致，前 6 文件相对实施基线也无漂移。CLI 直接读源码；本片没有新增 Desktop 行为结论，不重复先前零匹配的 REA trace。
- 进一步定位到 catalog 边界：`ModelLimits` 尚无工具输出预算字段，`model_request_policy_value` 不将 `modelRegistry` 自动变成该策略；因此显式 harness 策略传递、默认裁剪、catalog per-model 配置与真实 model/provider 切换须分别记账。本片不凭独立策略测试宣称后两项已完成；后续应在既有 model catalog owner 内贯通，不能用 OpenAI 模型名猜预算或套用 context/output 总预算。
- 首次消费者 check 在编译第三方依赖时遇到缓存中的 `memchr` rmeta 缺失，exit 101；日志 `/tmp/lime-history-truncation-check.log`，不作为实现失败或通过证据。定向 owner 测试正在重新编译依赖；`test:contracts` 已 exit 0，日志 `/tmp/lime-history-truncation-contracts.log`。其余终态待记录。
- 工具 I/O 定向 14/14 通过；随后使用同一已编译测试产物复核完整 `tool-runtime`，**523/523 通过**，包含 unified exec、生命周期、权限、Hook 与新裁剪回归；14 项已包含，不重复累计。日志 `/tmp/lime-history-truncation-tool-owner-full.log`。runtime/agent 的定向测试与 current fixture 继续执行，尚不记整体通过。
- runtime 测试构建发现 5 处遗漏的构造器调用，均在原来干净的 `reply_backend/tests.rs` 与 `reply_session.rs` 测试块；本轮追加认领并仅补 `truncation: None` 对应参数。首次 owner 测试 exit 101，不计通过；修正后重跑日志 `/tmp/lime-history-truncation-runtime-final.log`。生产 App Server 构建已通过；这不替代 domain/API 测试。
- 修正后 `agent-runtime context_history` **9/9**、`context_compaction` **5/5**、`lime-agent model_request_policy` **21/21** 全部通过；前两组互不重叠。覆盖同 Turn 真实工具执行后的 continuation/空回复重试、不同显式 Bytes/Tokens 预算的摘要请求，以及只有裁剪策略时不激活 Responses 专属设置。日志 `/tmp/lime-history-truncation-runtime-final.log`，进程 exit 0。
- 公共 JSON-RPC + HTTP capture **5/5** 通过：Chat、Responses、Anthropic、Gemini 的 canonical 冷恢复/采样/摘要各一场景；Responses 原始命名结果从 `thread/inject_items` 进入、冷恢复、采样与摘要一场景。均断言 durable 原文不因裁剪而改变；四协议使用默认预算，原始 opaque/envelope 只覆盖 Responses，不能扩称跨协议 opaque 转换或真实 provider/model 切换。日志 `/tmp/lime-history-truncation-integration-tests.log`；该 runner 连同后续两组定向回归最终 exit 0。
- 聚合 `smoke:agent-runtime-current-fixture` 已完成前置 frontend fixture guards 和生产 sidecar 构建，但在第一个 unknown-item GUI 场景启动前卡在 `cargo metadata --no-deps`；仅停止本进程所属 npm/fixture/metadata，exit 143，不计聚合通过，也不沿用目录内早先的同名 summary。本轮新证据改存 `/tmp/lime-history-truncation-gui-evidence`，通过既有 `APP_SERVER_BIN` 使用刚构建的 packaged sidecar，重跑 unknown-item 与 cancel-then-continue；不手动设置 build-ready、不覆盖并行 GUI/fixture 源码。日志 `/tmp/lime-history-truncation-{current-fixture,gui-fixed-bin}.log`。
- 后续 catalog/预算合同按 Codex `session/step_settings_tests.rs:model_resolution_preserves_startup_overrides_and_instruction_provenance`、`tools/context.rs:ExecCommandToolOutput::model_output_policy` 校准：当前模型 catalog 与显式设置合成同一 step snapshot，工具请求上限取不超过模型预算的值；每项已含 allowance 的持久 override 不再重复放大。Lime 需在既有 `core/models/model_registry.rs:ModelLimits`、`runtime_backend/request_context` 与 model policy owner 补齐，单独验证同会话 provider/model 切换和冷重开；不能把总 context/output budget 当作工具预算。
- App Server `provider_history` 定向回归 **29/29** 通过，包含投影保留完整 inline 输出、历史 call/result 顺序和媒体恢复；它不替代前述真实 HTTP sampling 断言。独立 `model-provider provider_stream::tests` **60/60** 通过，包含 policy、wire support 和 trace 消费；runner exit 0。
- 定向 Desktop controlled fixture **2/2** 通过，进程 exit 0：unknown-item 与 cancel-then-continue 的 summary 分别为 `/tmp/lime-history-truncation-gui-evidence/history-truncation-{unknown-item,cancel-then-continue}-summary.json`；run ID 分别为 `standalone-history-truncation-unknown-item` / `standalone-history-truncation-cancel-then-continue`。真实 Electron/preload/current JSON-RPC/用户可见状态/read model 与正常退出均通过，`app_server_handle_json_lines` 命中分别为 64/105，legacy/mock fallback、page error/crash 均为 0。backend 为显式 external/test-only，绕过生产 provider/tool executor，不能据此宣称 GUI 实际执行了新裁剪，也不证明完整 harness snapshot。初次 packaged binary SHA 为 `9a858eb8d05759298cb60a8368e08cba6299708259ff2c02f9034fc437f64f71`；此次按 source freshness 重新构建 renderer/sidecar 后再跑，最终 SHA 为 `6960628697a6dfb051af06ca90516390753d48ea6ed07126db851beb97751343`，标准 GUI smoke 后复核相同，不混称初次 digest。
- `npm run verify:gui-smoke` **exit 0，24/24 断言通过**，run ID `history-truncation-20261018-gui`；日志 `/tmp/lime-history-truncation-gui-smoke.log`、summary `/tmp/lime-history-truncation-gui-smoke/summary.json`。证据等级 `Gate B-F`：真实 Electron 启动/renderer reload、preload/IPC、App Server JSON-RPC、Workbench、Memory 设置路由和三种尺寸布局；不证明 provider turn、Memory 模型流水线、打包发布产物或 Codex Desktop 像素一致。该命令已重新构建 renderer、Host 和 sidecar，并通过版本一致性检查。
- 结构与清理验收：唯一预算类型、模型 policy 和 `context_history` 请求视图为 `current`；原 `ToolOutputTruncationPolicy`、无用 token 二分 helper / `drain_max_bytes` 与固定恢复投影裁剪为 `dead/deleted`，源码/消费者/领域文档扫描无剩余引用。loopback HTTP 与 external backend 仅为 `test-only`；无新增 compat/deprecated、迁移或第二后端。采样/摘要共用裁剪，避免重复制定规则；owner 与依赖方向不变，架构影响 minor，root 已确认。
- 本片合同完成度 **4/4，100%**：显式策略进入 runtime、Codex UTF-8/allowance 文本预算、采样副本与 durable 原文分离、普通采样/重试/摘要共用处理；四协议 HTTP 与上述 Host 回归分别满足各自证据范围。22 个 scoped Rust 文件摘要在 `/tmp/lime-history-truncation-implementation-checkpoint.json`，包含未跟踪新文件的 whitespace 检查；本片格式、diff 与 docs boundary 最终结果见 `/tmp/lime-history-truncation-validation-summary.json`。整个 C03 仍 partial，核心对齐整体分母未冻结，不填虚构总体百分比；`verify:local`、CLI/TUI/PTY、Windows、live、Azure/Vertex 未运行，本片没有这些 host/platform/认证路径改动或证据，不作为全仓 release evidence。
- 下一刀：C03 catalog 预算与逐项 provenance、媒体成本；C01 公共取消 driver 与 C02 同 Turn durable ACK 继续等待既有共享 Turn 装配写集的合并窗口。Stop 生产 Loop、Memory 模型流水线、插件/tar.gz/LimeCore 范围继续保留。Turn/恢复/GUI/插件/全局 architecture 热区和相邻未知未跟踪产物保持避让；本片只认领上述明确文件与测试，不覆盖并行工作。

### C03 当前模型 catalog 工具预算（2026-10-18，本片已验证，C03 未完成）

- 主目标：Codex 为 runtime/harness 的唯一主对标；CLI 直接读取源码，Desktop 行为才使用 REA。grok 只参考多模型控制面，不决定本片预算语义。
- Codex 事实源：`models-manager/src/model_info.rs:with_config_overrides`、`core/src/session/step_settings.rs:resolve_model_info`、`protocol/src/openai_models.rs:ModelInfo`。工具预算是模型顶层字段，独立于 context/output 总量；每次按当前模型解析，显式配置覆盖 catalog，缺失使用 Bytes(10_000)。现有 Lime harness 的 typed mode/limit override 保留；Codex token-only 配置的完整配置入口不在本片伪称已对齐。
- 已确认缺口：后端 `EnhancedModelMetadata`、API/native catalog parser 丢失预算；策略先命中其他字段后遮住 catalog；renderer 的 `source:model_registry` 派生快照可能滞后于真实路由。
- 窄写集：`core/src/models/model_registry.rs` 的字段和初始化；`services/src/model_registry_service.rs` 的 DTO/转换接线与新 `model_registry_service/truncation_tests.rs`；既有 `agent/src/model_request_policy{.rs,/tests.rs}` 与新 `model_request_policy/truncation{.rs,_tests.rs}`；`app-server/src/runtime_backend/model_registry_metadata.rs` 的 direct config 字段接线；本进程持有的 `thread_compact_jsonrpc/{model.rs,model_fixture.rs}` 和新 catalog 预算测试；`src/lib/model/modelTruncationPolicy{.ts,.test.ts}` 的零预算修正；本计划。大文件只加必要字段/初始化/模块声明，新增算法和测试落小模块；本片退出条件是不向现有超限文件增加业务算法。
- 优先级合同：逐字段读取显式 harness 预算，再读取服务端当前 `config.modelRegistry` / `config.model_registry`（standalone metadata 可为顶层 registry）；`source:model_registry` 的客户端派生预算不作为 override。其他策略字段不能遮住预算。无声明不按模型名、协议、context/output 限额猜测；零预算有效。direct config 只提取 typed 预算，不复制凭证或任意 capabilities。
- Verification Contract（root，budget:normal，P0）：真实公共 `modelProvider/fetchModels` → 协议相应 catalog HTTP → credential/endpoint scoped cache → 当前 route → 同一 model policy → sampling/summary。验证同一会话四协议/model/provider 切换、不同 Bytes/Tokens/零预算、冷重开、durable 原文；单测覆盖 override、过期派生提示、字段合成和缺省。catalog HTTP 属 test-only，不访问 live provider。
- 架构影响 minor：沿既有 catalog/model policy/runtime owner，无新 crate、RPC、依赖或存储 owner；无需改公共 picker DTO。避让 GUI、插件、Turn/恢复持久化和全局 architecture 共享热区，不运行协作消息、不启动子 Agent。没有兼容层或迁移。
- 退出条件：受影响 catalog/策略 owner 单测、四协议公共 JSON-RPC + HTTP 集成、前端预算定向回归、contracts、格式与文档边界检查通过；Host 回归按实际变更选择。逐项持久 provenance、工具请求上限、媒体成本、C01/C02/Stop/Memory 和插件/tar.gz/LimeCore 总范围继续开放。
- 结构补充：认领 `core/src/models/model_registry/tests.rs`，仅机械移出既有两项测试，使 catalog 类型文件保持 1000 行以内；认领原 `history_truncation.rs` 的既有 canonical log seed helper 提取，供新测试复用，不复制事件构造规则。
- 真实入口首次验证暴露能力合成断链：catalog 只有推断提示时遮住同模型显式能力，`thread/start` 报 `capability_snapshot_missing`。追加认领原本干净的 `services/src/model_registry_service/runtime_metadata.rs`，复用既有 ProviderModelConfig capability 应用规则；只在缓存为 InferredHint 时补能力，不替换 catalog 预算，也不覆盖显式/canonical catalog 能力。规则的唯一 helper 供声明模型构造与解析共用，避免第二套判断。Gemini 测试修正为该已配置 `/v1` base 的实际 `/v1/models`，不改生产 URL 规则。
- 普通 `OpenaiResponse` 的标准 base 接入既有 OpenAI catalog parser；显式 `/responses`、`/codex` 和 Codex provider 的专用发现策略保持独立。依据 Codex `codex-api/src/endpoint/models.rs` 的独立 ModelsClient 和 `models-manager/src/manager.rs`，不将采样协议等同于 catalog 不可用。旧“普通 Responses 只用手填图片模型”测试已直接替换为 loopback HTTP 场景。缓存 taxonomy version 提升为 4，旧解析结果必须重新取 catalog；无数据迁移或兼容层。
- 验证进度：最终 `lime-agent model_request_policy` **28/28**、`lime-services model_registry_service` **84/84** 通过（含 native parser、cache scope、普通 Responses HTTP、能力合成 9 组合）；日志 `/tmp/lime-catalog-truncation-rust-final.log`。首次 service run 的旧图片模型断言失败与首次 HTTP 集成 **0/5** 已保留在 `/tmp/lime-catalog-truncation-{domain,integration}.log`，不计为通过；修正后的完整 App Server compaction fixture、direct metadata 和 core 测试终态待记录。
- 前端定向 **15/15**、`npm run test:contracts` **exit 0**；日志 `/tmp/lime-catalog-truncation-{frontend,contracts}.log`。源码参考清单 `/tmp/lime-catalog-truncation-source-checkpoint.json` 的 7 个 Codex 文件均匹配参考 HEAD `8c076942cb70fba8e5c4732c23f1faabc4aed484`。本片无新增 Desktop 行为结论，不把普通源仓分析替换成反编译，也不将旧 REA trace 零匹配视为缺失证据。
- `npm run verify:gui-smoke` **exit 0，24/24**；run=`catalog-truncation-20261018-gui`，summary `/tmp/lime-catalog-truncation-gui-smoke/summary.json`，日志 `/tmp/lime-catalog-truncation-gui-smoke.log`。真实 Electron/preload/IPC/App Server JSON-RPC、reload、Workbench、Memory 设置路由与三尺寸布局为 Gate B-F；没有 provider Turn 或新预算执行证据，预算行为以真实 HTTP 集成为准。该 run 标准构建路径生成的 app-server 产物 SHA 为 `4cd391241dfce7745e602c409b1b1cb561a3919d069ccaa32036f6885a7ea448`，不等同打包发布或 Codex Desktop 像素一致。
- 第二次完整 compaction fixture 运行暴露两个独立缺口：原有取消场景命中 C01（`active runtime turn is missing its driver completion`）；新增预算场景在 `turn/start` 的 current model catalog 选择阶段再次被 InferredHint 遮住，报 `model_catalog_has_no_executable_selection`。追加认领原本干净的 `app-server/src/local_data_source/model_providers/catalog.rs` 一行接线，catalog picker 与 route metadata 共同消费 services 的同一 `merge_declared_capabilities`，不写第二套规则。完整 fixture 不记通过，预算场景修正后必须独立重跑；C01 属共享 Turn/取消热区，维持已记录未完成状态，不修改测试来掩盖失败。
- 最新定向预算 run 首次为 **4/5**，Responses 只有最终目录请求数断言失败；真实 sampling/summary 预算、路由和冷 resume 断言均已通过。定位到夹具把全部非 POST 当目录请求，也为 `/v1/responses` WebSocket 握手返回目录 JSON。已限定 `GET /v1/models`（允许 query），其它请求返回原 404；未放宽缓存断言、未修改生产缓存或 transport。依据 current client 的 `responses_websocket_url` / `send_responses_websocket` 复核该路径，最终重跑日志 `/tmp/lime-catalog-truncation-rust-final-v3.log`。
- 原完整 26 项 fixture 已 exit 101：**17 pass / 9 fail**，其中 5 项是修正前的 catalog 入口、4 项是 C01 公共取消 driver；不是最终预算实现的通过记录。第二次完整 GUI build 停止于 renderer 构建，exit 143，不计通过；最后仅 Rust 接线有变化，最终验证复用首轮已验证的 renderer，经标准 app-server asset 构建 fresh sidecar 后直接运行真实 Electron smoke，不设置 build-ready 或绕过 freshness。
- 最终 Rust run **exit 0**：catalog 四协议冷重开/同会话切换 **5/5**、history truncation **5/5**、runtime metadata **4/4**、route resolver **12/12**、provider catalog **16/16**、services registry **84/84**，合计 **126**；日志 `/tmp/lime-catalog-truncation-rust-final-v3.log`。加上此前最终策略 **28/28** 与 core 类型 **2/2**（对应源码摘要未漂移），本片受影响验证共 **156 项**，不重复累计旧 run。前端 15/15、contracts exit 0 保持有效，本片后续未改变这些边界。
- 最终 Host 回归：`npm run electron:build:app-server-assets` **exit 0**；随后 `LIME_GATE_RUN_ID=catalog-truncation-20261018-gui-final LIME_ELECTRON_SMOKE_EVIDENCE_DIR=/tmp/lime-catalog-truncation-gui-smoke-final node scripts/electron/smoke.mjs` **exit 0，24/24**。日志 `/tmp/lime-catalog-truncation-{sidecar-final,gui-smoke-final}.log`，summary `/tmp/lime-catalog-truncation-gui-smoke-final/summary.json`；最终 sidecar SHA `5be9b8252a9dce6e89eb623a629f6ba0737a7c26f00336f6a9aa98f79667ef52` 与 resource manifest 相同。renderer 复用首轮产物；证据仅为 Gate B-F 启动/重载/preload/IPC/JSON-RPC/Workbench/设置路由/三尺寸布局，不证明 GUI 执行新预算、provider Turn、完整 Memory、发布包或 Desktop 像素一致。
- 源码与结构检查：7 个 Codex 参考文件仍匹配记录 HEAD；17 个实现文件（15 Rust）摘要无漂移，定向 rustfmt、scoped diff、新文件 whitespace 已通过，清单 `/tmp/lime-catalog-truncation-implementation-checkpoint.json`。最终检查与证据汇总 `/tmp/lime-catalog-truncation-validation-summary.json`。TS `EnhancedModelMetadata.truncation_policy` 已有 typed consumer，本片补后端缺失字段；无新增 RPC、依赖、schema 方法或凭证透传。
- 分类与完成度：catalog、当前模型 policy、共享 capability merge 为唯一 `current`；HTTP 夹具为 `test-only`。普通 Responses 的目录禁用假设及旧“仅手填图片模型”断言已直接替换；无新增 compat/deprecated、迁移或平行后端，未恢复已删除 runtime。本片 **4/4 合同、100%**：native catalog/cache 保留独立预算、显式配置与当前路由逐字段优先级、picker/route 共用能力规则、四协议真实请求及 durable 原文验证。逐项产生时预算尚未对齐；整个 C03、C01/C02/Stop/Memory 和完整目标仍 active，不填写虚构总体百分比。
- 未验证边界：本片未修复或重新验收 C01 公共取消 driver；不把先前完整 fixture 的 4 项失败关闭。未跑全仓 `verify:local`、本片预算的真实 stdio/`lime exec`/PTY、Windows、live provider、Azure/Vertex；本片没有这些 Host/平台/认证入口改动，不能进入全仓 release evidence。避让 Turn/恢复/GUI/插件/全局 architecture 热区；下一刀归当前进程的 C03 逐项预算/provenance 校准与合并窗口内接线，插件/tar.gz/LimeCore 总范围继续保留。owner/依赖方向未变，架构影响 minor，root 已核对；DRY 由统一预算类型和同一个 capability merge 规则保证。

### C03 逐项预算来源与恢复（2026-10-18—19，普通工具预算已验证；整体 active）

- 主目标仍为 Codex 核心机制对齐；本片只关闭普通/custom/MCP 工具的产生时预算子合同。CLI/runtime 直接读取 Codex 源码，Desktop 结论要求 REA；grok 只参考多模型。原始 Responses envelope、内容 provenance、媒体、世界状态与命令逐次历史不随本片关闭。
- Codex 依据：`session/mod.rs:record_prepared_conversation_items` 在工具结果持久化前捕获产生时模型预算并保留工具 override；`tools/registry.rs:AnyToolResult::into_response` 生成 history-only envelope；`history/src/lib.rs:ResponseItemEnvelope / CodexHarnessMetadata` 分开保存原始 item 与 host metadata；`context_manager/history.rs` 重放已含 allowance 的 token budget；`codex-api/src/sse/responses.rs` 以完整 OutputItemDone 确认调用。10 个源文件全部匹配参考 HEAD `8c076942cb70fba8e5c4732c23f1faabc4aed484`，摘要 `/tmp/lime-origin-budget-source-checkpoint.json`。
- 写集为 38 个 Rust 文件，准确清单 `/tmp/lime-origin-budget-write-set.json`，最终摘要 `/tmp/lime-origin-budget-final-source-snapshot.json`，检查 `/tmp/lime-origin-budget-implementation-checkpoint.json`。算法落在 `provider_turn/history_budget.rs`、`current_client/stream/call_identity.rs` 等小模块；超限主文件只接线，退出条件为本片结束后不再向主文件堆叠该算法。DTO 构造点仅机械补 `None`。避让取消/driver、GUI、插件、全局 architecture 和其它未跟踪产物。
- current 实现：step snapshot 捕获模型预算；执行上下文、typed result 和 lifecycle 透传工具 override（含零）；canonical 生成器删除普通 metadata 中伪造的保留字段，仅从 typed host 值写 `ThreadItem.metadata.history_token_limit`；恢复读取同一字段。sampling/continuation/summary 只裁请求副本，durable 原文不改，已保存预算不再加 allowance。emitter 完整透传 command ACK/error/start/trace/delta；该透传不等于完整命令历史已对齐。
- 真实 Read 暴露并修复两个断链：后置 `file.read` 与工具同 ID，被泛 `file.*` 投影为 File 并覆盖 Tool；现将该诊断同时排除出 Item materializer 和通知层的 Item 要求，保留原始事件、未知生命周期继续严格失败。Responses added/参数事件的 call/item/index ID 原来拆成两次调用；现由一个 identity owner 关联，参数 done 只累积，完整 output_item.done 决定最终参数，completed 不重复分发。删除旧 `response_call_key`，不留兼容 helper。

普通工具预算的三个退出合同均已通过（3/3）：① override/零值优先，allowance 恰好一次；② 原文和预算跨冷恢复、模型切换、fork 保持；③ sampling/continuation/summary 共用逐项规则，四协议 wire 不带 host metadata。该行为/结构/清理子合同完成度 100%；完整 provenance 合同和 C03 整体仍为 partial。

| 验证                       | 最终结果与证据                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| owner 领域首轮             | 965/965：tool-runtime 523、agent-runtime 228、model-provider 147、agent protocol 24、current_provider_turn 43；`/tmp/lime-origin-budget-domain.log`。该 runner 后续集成失败，不能称整个首轮成功；其中 147 项由最终 150 项替代，不重复累计       |
| Responses/current client   | 150/150，exit 0，1.162.0；`/tmp/lime-origin-budget-stream-final.log`，含 3 个新增 identity/final-item 合同                                                                                                                                      |
| App Server 最终定向 runner | 95/95，exit 0；通知 9、投影 45、origin 4、catalog 5、历史裁剪 5、provider_history 27；`/tmp/lime-origin-budget-final-domain-v2.log`。通知首组为 1.161.0，其余为 1.162.0，源码摘要一致                                                           |
| 跨 crate 编译              | model-provider/tool-runtime/agent-runtime/lime-agent/app-server/lime-server `check --tests` exit 0，1.162.0；`/tmp/lime-origin-budget-check-final.log`                                                                                          |
| 静态与合同                 | contracts、rustfmt、scoped diff、版本、docs 均 exit 0；`/tmp/lime-origin-budget-scoped-checks.log`、`/tmp/lime-origin-budget-final-static.log`、`/tmp/lime-origin-budget-docs-final.log`                                                        |
| 独立 Electron shell        | 24/24，exit 0，1.162.0；`/tmp/lime-origin-budget-gui-smoke-final/summary.json`，日志 `/tmp/lime-origin-budget-gui-smoke-final.log`                                                                                                              |
| current fixture aggregate  | exit 1；前置 368 executed pass，另 61 skipped；真实 Electron 3 场景通过、第 4 个 Coding Workbench 失败，后续未执行。`/tmp/lime-origin-budget-current-fixture-fixed-bin.log`，完整证据索引 `/tmp/lime-origin-budget-fixture-evidence-index.json` |

- HTTP 集成的 14/14 包含 origin 4、catalog 5、历史裁剪 5。origin 从公共 provider 配置/目录与 thread/turn RPC 进入 native HTTP SSE，首次响应执行真实 Read；Chat/Responses/Anthropic/Gemini 的产生时预算分别为 29/77/0/154。断言 continuation、冷重开后四协议切换、fork、父线程模型摘要、canonical payload/metadata 和 durable 原文均不丢失；原文含 HEAD/MIDDLE/TAIL，裁后 MIDDLE 不到模型，wire 不泄漏 host key。没有弱化这些断言，不是手工 seed 或 live provider 证据。
- 独立 shell 的正式命令为 `LIME_GATE_RUN_ID=origin-budget-20261018-gui-final LIME_ELECTRON_SMOKE_EVIDENCE_DIR=/tmp/lime-origin-budget-gui-smoke-final node scripts/electron/smoke.mjs`。此前通过正式 builder 刷新，并由 `inspectElectronFixtureBuildFreshness` 证明 renderer/host/sidecar 均 ready；报告 `/tmp/lime-origin-budget-final-gui-freshness-ready.json`。sidecar SHA `ce06585d5bc7ce41ea8055dc841459abff528d58a8b863cf803f1a65d07185bb` 与 release/resource manifest 一致。Gate B-F 证明真实 Electron 启动/重载、preload/IPC、46 次 `app_server_handle_json_lines`、App Server JSON-RPC、Workbench/Memory 设置路由与三尺寸布局；错误、legacy 命令和 mock fallback 均为 0。不含 provider Turn 或本片预算执行，不证明 live、CLI/TUI、打包发布或 Codex Desktop 像素一致。
- aggregate 最终使用脚本支持的 `APP_SERVER_BIN` 绑定上述已核验二进制，run=`origin-budget-20261018-current-fixed-bin`；仍经过正式 freshness 构建，未手设 build-ready 或时间戳。unknown-item、home-hotpath、home-hotpath-greeting 为 3/3 `Gate B controlled fixture`、external/test-only。Coding Workbench 经 GUI 编码、terminal read model 与历史恢复后，在 `openWorkbench` 报“点击工作台后未出现工作台内容”；失败截图已核对，不能算通过。该 helper 仍搜索旧 workbench/harness selector 和全页面“工作台”文案，当前 GUI 已提供 `thread-side-panel-toggle` 与 `thread-side-panel-navigation.mjs`；实际误点目标未记录，不能仅凭源码判定产品根因。该脚本与 GUI 为并行脏写集，本片不覆盖；需要由其 current owner 同步入口、记录 clicked selector 后定向重跑。失败 summary 本身无 runId，证据索引按本 aggregate 输出的确切 failureSummary 路径关联，不伪造 runId。
- 失败尝试保留：origin 首轮 0/4 暴露 Read fork 覆盖、Responses 夹具缺 output_item.done 及 phantom invalid call；第二轮 0/4 暴露通知层仍要求 file.read 生成 Item，修正后最终严格 4/4。最初诊断 helper 误读 snake_case item ID，已改为 canonical camelCase，不计产品回归。初次 GUI 构建仅停止本进程重复 renderer 树（exit 143），精确核验自身遗留锁后清理；后两次 aggregate 卡于临时 HOME 隐藏 rustup 工具链、metadata 触发网络下载，仅停止已核验的自身子树（均 143），未停止其它 builder/候选仓。日志 `/tmp/lime-origin-budget-{domain,final-domain,gui-smoke,current-fixture,current-fixture-final}.log`；不掩盖失败，不把启动前阻塞计为产品通过。
- Desktop REA 只补静态边界：同一原始 mutations 模块 parent `ev_83540c1cd6213bb97133356f8dfe9fab0b18e0b2133d8484a545de841ca35a13` 的模块 page 返回前 4/8 个角色；`untrusted_input` semantic trace `ev_8d6ced1d5fb888933c75c2118583665066a60aa65745b01a3cc22b86b974d235` 为 partial/零 seed，feature trace `ev_1ad1410553ee5c4d9bce7999e1a7e496fac916d46c746df7e216fcbeb2439589` 为 no-match。完整返回 `/tmp/lime-origin-budget-desktop-rea-followup.json`；不能据此推断能力缺失或完整信任链，未新增 Desktop 运行行为结论。
- 下一刀仍按 Codex：`record_prepared_conversation_items` 先更新 annotated history，再保存 `RolloutItem::ResponseItem`，最后发送 raw item 通知；命令 UI 聚合不是逐次模型历史。Lime emitter 抑制 write_stdin/已归属命令的普通 lifecycle，`publish_snapshot` 保存聚合观察，provider_history/fork 的 call/result union 只有 Tool/Dynamic/MCP。先补真实 exec + 至少两次 write_stdin 的请求/结果、冷恢复和 fork 捕获，再定位 lossless model-history 接线；不能从聚合 Command 输出或最近 20 条交互猜原始调用。若改变模型历史与产品投影关系，实施前更新 architecture；仍复用 current event store、Thread/Turn/Item identity 与唯一 RuntimeCore。
- raw Responses 的独立 envelope、完整 content provenance/retained-source revision 仍开放。依据 `history_user_authorization.rs:record_retained_message`，compaction_output 不成为原始授权，子 Agent 继承上下文不提升为本地用户授权，已投递助手文本不是用户授权，client_authored 与 harness_authored_configuration 独立于 role。多协议只改变 wire lowering，不改变 host 事实，不盲转 Responses opaque state。媒体与 world-state 重注入另验。
- 分类：预算/恢复/identity 为 current；HTTP/external 夹具为 test-only；旧无关联 key helper 为 dead/deleted，无新增 compat/deprecated、迁移或第二后端。当前 owner/依赖方向未变，架构影响 minor，root 已核对。DRY 由统一预算类型、单一捕获点和 identity owner 保证；KISS/YAGNI 不预建迁移与双轨。
- 未完成门禁：完整 current fixture 为 partial；未跑全仓 verify:local、本片预算的真实 stdio/lime exec/PTY、Windows、live provider、Azure/Vertex，不能进入全仓 release evidence。C01 公共取消 driver、C02 同 Turn 压缩、Memory、Stop/Harness 其它合同及插件/tar.gz/LimeCore 总范围仍 active；不能因本片通过关闭旧失败。整体验收分母未冻结，不填虚构总体百分比。最终汇总 `/tmp/lime-origin-budget-validation-summary.json`。

## 历史切片（2026-08-17，以下完成结论仅限原四项）

> 状态：实施完成；四项 runtime 主线、全仓 release evidence 与真实 Electron GUI smoke 均已通过
> 更新时间：2026-08-17
> 目标：只补齐 Codex 中 Lime 已确认缺失且属于 Lime 产品范围的 runtime 语义，不引入远端 exec-server、账号、marketplace 或第二套业务后端。

## 1. 范围与 owner

本次只处理四项：

1. Responses WebSocket 的 Turn-scoped 增量请求复用、`previous_response_id`、严格前缀校验、完整请求回退和 Responses prompt cache key。
2. MCP 工具级 `annotations.read_only_hint` 并发判定。
3. Codex 标准 `AGENTS.md` / `AGENTS.override.md` 项目规则发现兼容。
4. Async Hook 的 active/idle 结果归属、additional context 注入和生命周期隔离。

owner 固定为：

```text
Responses wire/session  -> lime-rs/crates/model-provider
Turn/session orchestration -> lime-rs/crates/agent-runtime / current provider adapter
MCP tool definition/execution -> lime-rs/crates/tool-runtime
AGENTS discovery/prompt assembly -> lime-rs/crates/agent + scheduler
Hook execution lifecycle -> lime-rs/crates/tool-runtime + agent runtime session owner
```

不做：

- Codex 远端 `exec-server`、`environment/*`、remote control、账号/计费和 marketplace。
- 用 mock 替代生产 bridge、provider 或 App Server。
- 恢复已退役 runtime、compat crate 或第二业务后端。
- 将 provider-specific remote compaction 替换 Lime 当前 durable provider-neutral compaction。

## 2. Agent Verification Contract

```text
改动名称：Codex Runtime 缺口对齐
执行计划文件：internal/exec-plans/codex-runtime-gap-alignment-plan.md
负责人：root
预算标签：budget:normal
风险等级：P0/P1
影响模块：model-provider、agent-runtime、tool-runtime、agent prompt/scheduler
不做范围：GUI 视觉、Electron IPC 新命令、远端 exec-server、live Provider
```

### Current 主链

```text
thread/turn start
  -> App Server runtime
  -> agent-runtime provider_turn / session actor
  -> model-provider current client / Responses wire
  -> tool-runtime MCP/Hook owner
  -> Thread/Turn/Item projection
```

本次不新增 App Server JSON-RPC 方法，不改变 Electron Desktop Host 边界；WebSocket 请求复用只在 provider 网络 owner 内生效。

### Happy Path

```text
同一 Turn 的第二次 Responses 请求历史是第一次请求的严格前缀
  -> 发送 previous_response_id + 新增 input
  -> 服务端返回 response.completed
  -> 保存 response id / output baseline

MCP 工具声明 read_only_hint=true
  -> step snapshot 将其标记为可并发
  -> provider_turn 与其它可并发工具并行执行

工作目录存在标准 AGENTS.md
  -> 从项目根到 cwd 按顺序加载
  -> 同层 AGENTS.override.md 优先
  -> 有界合并到 runtime prompt

Async Hook 在 active Turn 完成
  -> 不阻塞当前 sampling
  -> 结果在下一次 active sampling 注入

Async Hook 在 idle 完成
  -> 缓存在 session actor
  -> 下一次用户 Turn 开始前注入
```

### Evidence Layers

| Layer               | 是否需要 | 证据                                                  |
| ------------------- | -------- | ----------------------------------------------------- |
| deterministic-smoke | 是       | Rust unit/integration tests、provider request capture |
| runtime-transcript  | 是       | provider turn、MCP、Hook lifecycle 事件断言           |
| gui-trace           | 否       | 本次不改 GUI owner                                    |
| release-artifact    | 否       | 本次不改版本、Forge 或依赖                            |

### 必跑命令

```bash
npm run test:rust:related -- lime-rs/crates/model-provider lime-rs/crates/tool-runtime lime-rs/crates/agent-runtime lime-rs/crates/agent
npm run verify:local
```

按实际影响补充：

```bash
npm run test:contracts
npm run smoke:agent-runtime-current-fixture
```

未跑命令必须在完成记录中说明原因。由于本次不改 GUI、Electron IPC 或 App Server schema，`verify:gui-smoke` 不是最低门槛；若实际改动穿透这些边界，立即扩大验证范围。

## 3. 阶段与退出条件

### 阶段 A：Responses WebSocket 增量请求

- [x] 增加可测试的请求属性比较和 response item 前缀比较。
- [x] 为 Responses 请求引入 Turn-scoped session 状态，禁止跨 Thread/Turn 共享历史。
- [x] 记录 `response_id`、服务端新增 output items 和 `prompt_cache_key`。
- [x] 前缀不匹配、模型/工具/指令/路由/压缩变化时发送完整请求。
- [x] 连接失败或 HTTP fallback 使用完整逻辑请求，不把压缩 delta 当作 replay truth。
- [x] 添加连续请求、前缀失败、属性变化、空 delta、模型切换和压缩边界测试。

退出条件：provider capture 能证明增量请求和完整回退均符合预期，且不同 Turn 不共享 continuation state。

### 阶段 B：MCP 工具级并发

- [x] 在 `McpStepSnapshot` 捕获 route 时合并 server opt-in 与 `read_only_hint`。
- [x] 保持 hint 缺失/false 默认串行。
- [x] 补工具级 snapshot 单测和 provider_turn 执行测试。

退出条件：只读 hint 工具可与安全工具并发，未声明工具仍被串行护栏保护。

### 阶段 C：标准 AGENTS 发现

- [x] 兼容标准全局 `AGENTS.md` 与项目层 `AGENTS.md` / `AGENTS.override.md`。
- [x] 保留项目根到 cwd 的顺序、项目根边界、去重和总预算。
- [x] 明确 `.lime/AGENTS.md` 是否作为 Lime 专属 fallback；不得无记录改变优先级。
- [x] 补 global/project/nested/override/budget/symlink 回归。

退出条件：标准 Codex 项目规则可被 Lime runtime 读取，并且现有 `.lime` 规则行为没有未记录的回归。

### 阶段 D：Async Hooks

- [x] 保留 Hook snapshot 不可变和 trust/fail-closed 边界。
- [x] 将 async handler 从同步裁决路径分离，结果通过 session-owned channel 回传。
- [x] active Turn 结果注入下一次 sampling，idle 结果在下一 Turn 前消费。
- [x] session close、turn cancel、重复结果和 warning/context 生命周期有测试。

退出条件：async hook 不阻塞当前 sampling，结果不会注入错误 Turn，也不会在 session 关闭后产生副作用。

## 4. 进度记录

- 2026-08-16：完成 Codex/Lime 静态对比，确认四项范围；已有上下文 fragment、compaction、model switch、tool cancellation、MCP immutable snapshot、Multi-Agent 和 App Server transport 不重复建设。
- 2026-08-16：建立本计划，开始阶段 A。
- 2026-08-16：完成阶段 A：Responses WebSocket Turn-scoped session、严格前缀增量、`previous_response_id`、完整回退和 Responses prompt cache key；补充真实 WebSocket capture 与 lowering 回归。
- 2026-08-16：完成阶段 B：MCP 工具级 `annotations.read_only_hint=true` 并发；缺失/false 继续串行；补充 snapshot 与 provider-turn 回归。
- 2026-08-16：完成阶段 C：标准全局/项目 `AGENTS.md`、`AGENTS.override.md` 发现，并保留 `.lime` fallback、根边界、顺序、去重、预算和 symlink 语义；补充标准路径与 fallback 回归。
- 2026-08-16：完成阶段 D：Async Hook discovery、后台 command、生命周期 Started/Completed、active steer、idle mailbox、warning/context 投影和 cancellation 隔离；补充 discovery、runtime、session-loop 回归。
- 2026-08-16：修复 `lime-skills` 对编码本地 `skill://%2F.../SKILL.md` 的 URI 判定，避免把本地路径误当远程 authority；标准 `skill://server/...` 行为保持不变，3 个 URI 选择回归通过。
- 2026-08-16：清理五个 locale 中无源码引用的 7 个旧 Harness / Registered Skills key，`i18n:unused` 恢复为 `unused=0`，保留同文件其它既有文案改动。
- 2026-08-16：同步当前 Codex 参考源漂移：Codex 已从 `ModelInfo` 移除 `supports_parallel_tool_calls` 并在 Prompt 固定为 `true`；治理测试同时接受历史字段转发和当前固定值形态，不改变 Lime runtime 策略。
- 2026-08-16：完成不间断 `npm run verify:local` 复验：i18n、lint、typecheck、120 个 Vitest 批次和 contracts 全部通过；Rust changed selector 对并行工作树中的 `lime-rs/resources/default-skills/transcription_generate/SKILL.md` 按 fail-closed 退出，随后以 workspace unit/integration 扩大覆盖。
- 2026-08-16：workspace Rust unit 全部通过；workspace integration 在执行到 `app-server/tests/media_task_jsonrpc.rs` 时仅 `image_task_complete_rejects_wrong_task_type` 因独立媒体夹具缺少 `media_model_ref` 失败。本计划四个 owner 的定向、反向依赖和 current fixture 回归仍全部通过，未越界修改媒体链。
- 2026-08-16：重新执行真实 Electron GUI smoke、workspace rustfmt 与 diff 检查，均通过；旧 `audio.rs` 格式阻塞已消除。
- 2026-08-17：修复 Skills JSON-RPC 测试对进程级 `LIME_CONFIG_PATH` 的并行竞争；`RuntimeCore` 注入 `app_config_path`，生产路径与测试均改为显式配置文件，`skills_jsonrpc` 4/4 通过并以 4 线程重复 30 次无失败。
- 2026-08-17：修复 Rust 1.95 Clippy `never_loop` blocker；`LocalExecutionProcessHandle::next_event` 移除语义上不会重复的外层循环，保留 `try_recv`、`final_rx` 与 biased `select` 行为；`tool-runtime` 356/356、带 Rusty V8 artifact 的 Clippy 和全量 rustfmt 均通过。
- 2026-08-17：恢复媒体 fixture 后完成第二次 `npm run verify:local:full`；版本/i18n/lint/typecheck、120 个 Vitest 批次、contracts、workspace Rust unit/integration、Clippy 与真实 Electron GUI smoke 全部通过，退出码 0。最新 GUI evidence 为 `standalone-shell-01-20260817001202-86438`，result=`pass`。

## 5. 完成记录

```text
主线目标是否完成：是；四项 Codex runtime 缺口均已在 Lime current owner 内实现并有回归覆盖。
实现完成度：100%（阶段 A/B/C/D 全部完成）。
已跑验证：
  - `cargo test --manifest-path "lime-rs/Cargo.toml" -p model-provider --no-fail-fast`：258 passed。
  - `cargo test --manifest-path "lime-rs/Cargo.toml" -p tool-runtime --no-fail-fast`：356 passed。
  - `cargo test --manifest-path "lime-rs/Cargo.toml" -p agent-runtime --no-fail-fast`：210 passed。
  - `cargo test --manifest-path "lime-rs/Cargo.toml" -p lime-agent prompt::runtime_agents --no-fail-fast`：14 passed。
  - `cargo test --manifest-path "lime-rs/Cargo.toml" -p lime-core app_paths --no-fail-fast`：18 passed。
  - `cargo check --manifest-path "lime-rs/Cargo.toml" -p lime-agent`：通过。
  - `npm run test:rust:related -- lime-rs/crates/model-provider lime-rs/crates/tool-runtime lime-rs/crates/agent-runtime lime-rs/crates/agent`：通过；覆盖 owner 及反向依赖 `agent-runtime`、`app-server`、`lime-agent`、`lime-cli`、`lime-embedding`、`lime-mcp`、`lime-media-runtime`、`lime-processor`、`lime-scheduler`、`lime-server`、`lime-services`、`lime-skills`、`model-provider`、`tool-runtime`。
  - `npm run test:contracts`：通过（app-server-client 299 checks，其他 contracts/governance/docs 检查通过）。
  - `npm run smoke:agent-runtime-current-fixture`：通过；真实 Electron、preload、App Server sidecar、GUI fixture 全链路通过。
  - `npm run verify:local`：通过；i18n、lint、typecheck、完整 120 个 Vitest 批次和下游 contracts 均通过。
  - `npm run verify:local:full`：通过（退出码 0）；覆盖版本/i18n/lint/typecheck、Vitest、contracts、workspace Rust unit/integration、Clippy 与真实 Electron GUI smoke。
  - `npm run test:rust:unit -- --workspace`：通过；workspace 所有 Rust lib unit tests 无失败。
  - `npm run test:rust:integration -- --workspace`：通过；workspace integration 全部测试通过，媒体任务 fixture 已恢复。
  - `npm run verify:gui-smoke`：通过；最新证据 `standalone-shell-01-20260817001202-86438` result=`pass`，真实 Electron renderer、preload、App Server sidecar、工作台重载和 memory settings smoke 全链路通过。
  - `cargo test -p lime-skills agent_selection::tests::selects_skill_from`：3 passed。
  - `npm run i18n:unused -- --check`：通过，`unused=0`。
  - `npm test -- --run src/lib/governance/codexModelToolCallPolicyOrigin.test.ts src/lib/governance/codexModelExecutionPolicyOrigin.test.ts`：5 passed。
  - `cargo fmt --manifest-path "lime-rs/Cargo.toml" --all -- --check`：通过。
  - `git diff --check`：通过；计划文件无尾随空白。
未跑或未通过验证及原因：无。第二次 `npm run verify:local:full` 已取得零退出码，覆盖完整 Rust workspace、Clippy、contracts、Vitest 和真实 Electron GUI smoke。
环境依赖：Rust V8 测试需先运行 `node "scripts/lib/rusty-v8-artifacts.mjs"`，将其输出的 `RUSTY_V8_ARCHIVE` 与 `RUSTY_V8_SRC_BINDING_PATH` 作为 Cargo 命令级环境变量；本次已使用临时 artifact 完成验证。
残余风险：Async Hook 结果依赖 `pending_input` 注入；无该上下文的直接 provider 调用路径只保证执行与生命周期投影，不会追加 provider 上下文。失败/阻断/中止结果当前通过 `AgentEvent::Warning` 投影，尚无专用 warning protocol。
是否达到 Lime 本次实现门槛：是；current owner、定向测试、related 反向依赖、workspace 全量 Rust、Clippy、contracts、完整 Vitest 和真实 Electron GUI smoke 均通过。
是否可进入全仓 release evidence：是；`npm run verify:local:full` 已通过，媒体 fixture 与本机磁盘 blocker 均已消除。
治理分类：`current` 为 model-provider、tool-runtime、agent-runtime 与标准 AGENTS prompt owner；`compat` 仅保留 `.lime/AGENTS.md` fallback 且不承接新语义；`deprecated` 无新增；`dead`/已删除 runtime 未恢复，无第二套后端或生产 mock fallback。
下一刀：本计划无剩余 runtime 实现任务；后续按发布负责人节奏消费本次 release evidence，不需要恢复任何旧 runtime 或 compat 入口。
```

## 6. 架构确认

```text
架构影响：非重大。保持 provider 网络、tool-runtime、agent-runtime 和 prompt owner 不变；不新增 crate、协议方法或跨层事实源。
架构图已更新：不适用；本次只在既有 owner 内补齐行为和测试。
责任开发者确认：root，2026-08-17
确认内容：已核对目录归属、数据流、依赖方向、协议边界和验证门禁。
```

### C03 / 命令逐次模型历史（2026-10-19，核心通过；GUI smoke 通过，aggregate 被 Workbench 阻塞）

- 对标优先级：Codex CLI 直接源码为核心合同，Desktop 延用已有 REA 原模块证据；grok 只参考多模型控制面。本片不从 Desktop 零匹配推断行为，也不以 grok 替代 Codex。
- REA 复核：复用 parent `ev_83540c1cd6213bb97133356f8dfe9fab0b18e0b2133d8484a545de841ca35a13` 的 summary view `ev_905ac8d0c98e7935eb82e2f0510b2fcf1458be651645706f78c3ba93ac0c881f`；提取目录 SHA `d0fe48d8f83565d0f9ed724491cbe4e802a2528f8e2447cf44076499a8f5b2f8`，只覆盖 1 个 52,799-byte JavaScript 文件，semantic coverage 为 unknown。该静态切片不证明整包 Electron 运行或本片模型历史语义；不重复 producer、不反编译 CLI，也不把图中零匹配当能力缺失。
- 源码依据：Codex history::ResponseItemEnvelope 将原 item 与 harness metadata 分开；Session::record_prepared_conversation_items 写入 ordered rollout；WriteStdinHandler::handle_call 保留每次 invocation 的 call_id/参数；AnyToolResult::into_response 以该 call_id 构造独立输出。聚合 command UI 不能替代这些逐次记录。
- Verification Contract：负责人 root，budget:normal，P1；公共 thread/start、turn/start、thread/resume、thread/fork、thread/compact/start 进入既有 RuntimeCore/model-provider/tool-runtime/EventLog。真实 shell 以 stdin 握手执行 exec_command + 两次 write_stdin，HTTP SSE 仅替代上游模型，记录即时 continuation、冷重开、fork、summary 的完整调用/结果顺序；失败必须显式终止测试，不跳过、不放宽断言。macOS/Unix 实测与 Windows/live/GUI 分别报告。
- 最初窄写集为 thread_compact_jsonrpc/{model_fixture,model_tool_reply,model,command_history}.rs 与本节；实际复现后按下文扩为生产历史链与对应 owner 测试。GUI/right-surface、插件、取消 driver 继续只读。已有 origin-budget 四协议低预算断言保持原义。
- 结构：fixture 增加按真实请求返回下一工具调用的脚本和独立 call_id，复用既有 native HTTP/catalog owner；生产补丁已经接入持久 ACK、内部通知隔离、fork seed 和工具历史 metadata envelope，最终 owner 和集成终态见下文。没有生产 mock、第二后端或兼容入口；工具封套不能替代完整 Context/Memory provenance。
- 退出条件：即时、冷重开、fork、summary 四阶段逐次调用/输出严格一致，写入失败可阻止后续 sampling；定向 owner/integration、contracts、fresh current fixture 与风险匹配产品门禁通过。六项核心合同已通过，独立 GUI smoke 通过；完整 aggregate 尚未通过。全目标仍 active，C03 partial。

- 实测红灯：Chat 的真实 exec + 两次 write_stdin 即时 6 条 call/result 完整；冷重开变为零条，严格断言失败。日志 /tmp/lime-command-history-red.log；macOS FSEvents 初始化耗时已采样定位，不冒充历史失败原因。
- 生产补丁写集扩为 agent-runtime::{tool_history,session_config,provider_turn,lib}、agent::current_provider_turn 的历史 ACK 通道、model-provider::CurrentProviderMessage 的内部 serde、App Server runtime::{event_sink,turn_execution/tool_history,provider_history/tool_history,thread_fork} 与 runtime_backend 的最小接线及 architecture。turn_execution.rs 仅增加 typed 内部记录分发和 ACK，业务逻辑拆子模块，不触及取消 driver。mention_selection 测试仅补配置字段。
- 冻结合同：本片只覆盖模型工具调用/结果的 lossless envelope；用户授权、inherited/client-authored/retained provenance 继续待对齐，不能把工具记录当完整 Context/Memory。既有 channel 顺序先处理 UI 事件，再经同一 session driver 持久化内部记录；receipt 成功后才能执行工具/继续采样，错误直接终止且禁止 reroute。内部记录不生成 Item、不广播 GUI；fork 在原 sequence 的 baseline 槽继承，不增加第二历史 store。

- 多协议 identity 补丁：Gemini parser 原本每个响应把 next_tool_call_id 重置为零；多次采样反复使用 tool_0，会破坏 Codex 所需的逐次 call/output identity。model-provider::current_client/gemini.rs 只在缺失上游 id 时生成独立随机 call ID，并保留显式上游 id；不扩张 Gemini wire 字段，不更改工具/loop owner。新增独立 identity tests，保留原 native wire lowering；opencode 当前同样使用局部计数，不能把参考实现当正确性证明。grok 没有用于定义本片核心合同。

- 文件规模退出条件：provider_turn/provider_history/turn_execution 原大文件只保留 helper 调用、typed event 分发和消费者选择；历史校验、预算封套、ACK、fork 复制逻辑分别归独立 tool_history 小模块。新增 thread_fork/tool_history.rs 从接近 900 行入口迁出本片复制循环；不借本片继续扩张原入口业务。公共 RPC/schema 未新增字段，内部 serde 与 RuntimeEventSink 接口已同步生产消费者/测试；架构图和 root 确认已在 architecture.md 同步。

- 本片核心验收分母冻结为 6 项：逐次 call/raw arguments、逐次原输出+产生时预算、写入 ACK/失败停止、冷恢复及四协议切换、fork 及 fork 冷恢复、模型摘要。其通过率只用于本片核心合同；current aggregate/真实 Electron/CLI/TUI/Windows/live 为单独产品门禁，不能互相替代，也不能把 6/6 算成完整对齐。最终结果为 6/6，产品边界见下文。

- 验证检查点：contracts 已 exit 0，最新写集 rustfmt/scoped diff/docs boundary 已通过；四协议 command_history 与相关集成已取得下述终态，owner ACK/失败停止、Gemini identity 与 provider history 回归依序执行。此前四-crate check 早于测试 helper 最后增强，不替代最终验证。源码 26 个 Rust 文件与 Codex 5 个源文件的摘要均未漂移；测试模块声明按 rustfmt 重排，不改测试断言。

- 运行检查点：四协议真实 exec + 两次 write_stdin 的 command_history **4/4 通过**，每项同时覆盖即时 6 条记录、冷恢复、四协议切换、fork/冷 fork 和模型摘要；日志 `/tmp/lime-command-history-integration.log`，构建 exit 0，测试 183.84s。复用同一最新测试二进制执行其余相关集成 **26/26 通过**，含历史规范化/预算、模型路由切换及两项真实 stdio 冷重启；日志 `/tmp/lime-command-history-regression.log`，exit 0，386.40s。原 C01 的 4 项取消 lifecycle 显式过滤，4 项已独立通过的命令测试未重复运行，不记作整套 34/34。
- stdio 等待分析：两项测试在固定产物复制后的 debug SHA256 软件计算上耗时，采样 `/tmp/lime-command-history-regression.sample` 已定位 `model_stdio::fixed_binary -> sha2::sha256::soft`；随后自行完成，固定 App Server SHA 为 `35806b90047e9dced61abc44326725ef85fbaa8d62260eaf52c2cf53bf48f547`。未延长超时或削弱断言。owner 首次排队任务仅等待 Cargo 锁，已停止并保留中止日志，再以 `-j 1` 重排以降低并发编译内存；该中止不计通过。最终 owner 与 fresh 产品门禁仍待终态。

- fork 压缩回归 `compacted_thread_fork_replays_replacement_and_surviving_tail_after_restart` **1/1 通过**，exit 0，测试 6.66s；日志 `/tmp/lime-command-history-fork-compaction.log`。该回归证明压缩后的 replacement 与保留尾部可跨 fork/冷恢复，不代表 C01 取消或 C02 同 Turn 压缩完成。本片累计已通过 31 项集成。
- 仓库验证账本：[命令逐次历史验证](artifacts/codex-command-history-20261019/validation.json)，保留 Codex 源码/写集摘要、红绿日志摘要、最终 34 项完整集成与 fork 压缩、owner、GUI smoke 和 aggregate 失败终态；前述 31 项是修复前历史基线。

- 构建调度：fresh renderer 构建在与 Rust 并行时因本机内存竞争被本轮主动 SIGINT，正式 helper 已释放自己的锁，后续串行重建；日志 `/tmp/lime-command-history-product-build-interrupted.log`，不计通过。App Server unit 编译采样位于 monomorphize partition，VM 快照约 4 GB 工作内存换出；主动停止本轮该 rustc 后，以 `--config profile.test.package.app-server.debug=0 --config profile.test.package.app-server.codegen-units=16 -j 1` 重跑相同四 crate/断言。仅命令级构建配置变化，没有生产 manifest、源码、测试范围或断言改动；原 exit 101 明确为本轮 SIGTERM，不计业务失败或成功。

- owner 实际红灯：完成编译后 agent-runtime 的 4 项历史测试为 **2 pass / 2 fail**；两个失败均在已有 raw arguments 严格断言处，尚未执行到故障注入。`prepare_provider_tool_call` 无参数修正时也用 `CurrentProviderToolCall::new` 重编码 JSON，导致上游原文空白丢失；这是生产行为缺口，不按测试问题处理。红灯完整保留 `/tmp/lime-command-history-owner-raw-arguments-red.log`，未删除或放宽原断言。
- 最小修复：Codex `tools/router.rs::build_tool_call` 原样传递 `FunctionCall.arguments`；Lime 将既有准备 helper 迁至 `provider_turn/tool_call.rs`，无 argument change 时使用 `from_raw` 保留原文，实际参数修正继续序列化修正后的内容，并由既有修复回归追加 raw/parsed 一致性断言。保持修复 metadata、权限、工具执行和错误合同；不把此补丁描述为完整原始 ResponseItem 或修复前 provenance。写集增加该小模块，源码总数 27；本轮 31 项集成是此修复前基线，修复后须重跑受影响集成与 owner，未重跑前不当作最终源码证据。
- 修复后 Agent Runtime 验证：原断言下历史/故障注入 **4/4 通过**，原有参数修正/取消竞争/超时不重放 **3/3 通过**；随后复用同一最终二进制执行完整 owner suite **232/232 通过**，0 ignored/filtered，测试 1.43s。前述 7 项包含在 232 中，不重复累加。日志 `/tmp/lime-command-history-runtime-owner-full.log`；二进制 SHA `31e3c5d58cdae3913ebb9fd87647b3562d8228ff985a5918499065a0aaf7d20a`。App Server/host receipt、Gemini、provider history 与新产物集成/产品门禁继续待收取。
- 其余 owner 终态：App Server session receipt 与 agent host receipt **2/2 通过**；Model Provider 完整 **268/268 通过**（5.97s，含 Gemini identity），另 Gemini 定向 **6/6** 为该 suite 子集；provider history **27/27 通过**。最终源码 contracts exit 0。日志分别为 `/tmp/lime-command-history-owner-final.log`、`provider-owner-full.log`、`gemini-final.log`、`provider-history-final.log`、`contracts-final.log`，均使用相同 `/tmp/lime-command-history-` 前缀。没有将子集重复累加。
- 并行变化检查：fresh 构建前发现 `turn_execution.rs` 与 `thread_compact_jsonrpc/model.rs` 摘要变更，预检立即停止，尚未开始构建或产品场景；记录 `/tmp/lime-command-history-product-source-drift-summary.json`。暂停两处源码写入并发出基线偏好询问；只读检查确认 current Tree 带有另一任务的 actor compaction 取消修正及 canonical Turn Item ID 断言修正。本轮保留当前内容、只更新验证基线与账本，不回退、不夹写；完整重建后改跑 **34 项集成、不再过滤此前 4 项 C01 取消测试**。这两项并行源码修改不计本轮实现归属，C01 的其它压缩合同仍未完成。
- 最终源码集成终态：**34/34 通过**，0 ignored/filtered，测试 80.52s；fork 压缩 **1/1 通过**，1.93s。覆盖原 4 项命令历史、26 项相关回归及此前 4 项 C01 取消失败，均以重新构建的 current Tree 执行；真实 stdio 固定二进制 SHA 为 `c34d5e233db11ef4b3b54d48f9e3053a54d3e53b6fd4d97f33d47a59d43e9250`。日志 `/tmp/lime-command-history-integration-final.log`、`/tmp/lime-command-history-fork-compaction-final.log`。旧的过滤结果只保留为历史基线，不再代表本轮最终范围。
- 本片核心 **6/6、100%**：原文参数（无实际参数修正）、逐次原输出/产生时预算、durable receipt/失败停止、冷恢复/四协议、fork/冷 fork、摘要。既有显式参数修正保留执行一致性和 repair metadata，修正前完整 ResponseItem/provenance 仍待对齐。该百分比只属于本片六项核心合同；真实 Electron aggregate、GUI shell、CLI/TUI/Windows/live 和 C03 整体继续分别记账，不作为完整目标完成声明。
- 产品终态：`npm run verify:gui-smoke` **exit 0、24/24**；真实 Electron 1.162.0 完成初始化、重载、Memory 设置和三个 viewport，`app_server_handle_json_lines` 命中 42 次，invoke/legacy/mock fallback 等错误均为 0。summary 为 `.lime/qc/project-gates/command-history-1792351601616/shell-01-electron-smoke/summary.json`，SHA 与 bridge/边界已入验证账本，日志 `/tmp/lime-command-history-gui-smoke-final.log`。这是 shell 的 Gate B-F，不证明本片 provider prompt、Thread/Turn/Item identity、live、打包发布或 Codex Desktop 像素一致。
- 完整 `smoke:agent-runtime-current-fixture` **exit 1**：前端定向实际执行的 31、34、3、300 项通过（部分含预设过滤）；真实 Electron 的 unknown-item、home-hotpath、home-hotpath-greeting 三场景通过，均为 external backend controlled fixture，只证明对应 Electron/IPC/read model 链。第 4 个 Coding Workbench 在 `open-workbench` 报“点击工作台后未出现工作台内容”，后续 aggregate 场景未运行。编码回合、历史重载和 timeline 已完成，invokeErrors=[]；helper 残留旧 Canvas/harness selectors，截图也未出现目标内容。GUI 缺陷或过期 fixture 的根因仍未区分；不跳过、不放宽断言、不恢复旧 UI。失败证据 `.lime/qc/gui-evidence/code-artifact-workbench-electron-fixture/code-artifact-workbench-gui-coding-input-regression-{summary.json,failure.png}`，日志 `/tmp/lime-command-history-current-fixture-final.log`；由持有 GUI/right-surface 写集的 current owner 处理。
- 最终流水线已结束（`2026-10-18T19:28:34.505Z`），exit 1 仅来自上述 aggregate 失败；独立 GUI smoke 无 pending。前后 27 个 Rust 源文件摘要一致、source drift=[]、固定 sidecar frozen drift=[]；固定产物为实文件而非 symlink。`/tmp/lime-command-history-product-summary.json` 的终态、阶段日志及 GUI summary SHA 已同步仓库验证账本；本轮收尾复核 27 文件仍无漂移。构建期间 Host 并行变化曾被标准 freshness 拦截，仅补建 stale host 后全部 fresh，未绕过检查。
- 分类与下一刀：逐次模型历史为 `current`，HTTP/SSE 和 external backend 为 `test-only`；本片无新增 compat/deprecated、迁移或第二存储。原 Gemini 响应内重置 counter 和无修正时重编码参数已直接替换；未恢复 retired runtime。核心合同 100%，产品验收 partial，整个 C03 和完整目标保持 active；总体验收分母未冻结，不编造总体百分比。下一刀继续 Codex C03 的完整 provenance/媒体/world-state/rollback，及 C02 同 Turn 压缩、Memory、Stop/harness；插件、tar.gz 与 LimeCore 总范围保留。避让 GUI/right-surface、插件和并行取消修正；`lime exec`/PTY、Windows、live、Azure/Vertex 与全仓 verify:local 未在本片验收。

### C03 / 来源与授权证据复核（2026-10-19，仅源码审计，尚未实施）

本轮直接追读 Codex `history/src/{lib,retained_context,retained_context_tests}.rs`、`core/src/session/mod.rs` 与 `context_manager/{history,history_user_authorization,history_tests,normalize}.rs`；HEAD 仍为 `8c076942cb70fba8e5c4732c23f1faabc4aed484`。源文件摘要和 Lime 对照链落在上述验证账本的 `followUpAudit`，不新增 Desktop REA 或运行行为结论，grok 不定义这些合同。

| 源码合同                                                                                                                                                                                                                                     | Lime 已读链路与边界                                                                                                                                                                                        | 下一实施义务                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResponseItemEnvelope` 原 item 与 `CodexHarnessMetadata` 分离；`record_prepared_conversation_items` 注入产生时预算、输入接受顺序和 MCP checkpoint，再记 annotated history/rollout                                                            | `ToolHistoryRecord` 目前只为工具消息分离输出预算；`CurrentProviderMessage` 只有 role/content，修正过的调用进入历史。不能将六项工具合同扩称全部原始模型历史                                                 | 在既有 history/EventLog owner 中直接收敛通用封套，区分原始 item、执行修正与 host metadata；不增加第二存储或 provider wire 字段                |
| `record_retained_message` / `restore_retained_context` 区分 Original/Checkpoint、Local/Inherited；worker 不将继承上下文纳入本地授权，独立 root 恢复时有明确收养路径                                                                          | `provider_history/canonical::append_fork_item` 把 UserMessage 还原为普通 provider input；该输出本身不携带来源/完整性。现有 `thread_guardian` 精确操作批准仍为 current，但不能证明 retained evidence 已对齐 | 沿真实 AgentGraph/来源识别承接 inherited 与 root adoption，跨 fork/冷恢复保持；不能只按 `forked_from_thread_id` 猜子 Agent                    |
| `accepted_order_survives_delayed_recording_and_checkpoint_replay` 证明接受顺序可早于落盘，rollback 按该顺序移除后续证据；`delivered_assistant_context_invalidates_reviews_without_changing_authorization` 区分 assistant delivery 与用户授权 | 当前 EventLog sequence 与 receipt 证明写入顺序/持久成功，没有证明接受顺序或授权回滚语义                                                                                                                    | queue/steer/延后记录、checkpoint、恢复、fork、rollback 共用同一来源规则；取消/拒绝输入不凭占号成为授权                                        |
| `retains_only_harness_authored_configuration_updates` 只保留 harness 来源的配置更新；`mark_retained_sources_incomplete` 在缩短时撤销完整 review delivery 证明；compaction output 不记作原始用户/assistant exchange                           | raw item 校验和 prompt-only 工具裁剪已存在；不能据此推断来源过滤与 retained completeness 已实现。有限标识符搜索为零只作导航证据                                                                            | host metadata 由可信 owner 生成，不能由模型或 client raw payload 自授；缩短/checkpoint/摘要不升级为完整原始指令；四协议 wire 不泄漏 host 字段 |

实施前 Verification Contract：负责人 root，P0；沿既有 RuntimeCore/EventLog 和模型路由，直接替换消费者，不新增兼容迁移或并行 backend。六项后续合同见账本，尚未有完成项；覆盖 envelope、host 来源、继承/完整性、接受顺序/回滚、摘要/缩短、opaque provider state 的原路由能力绑定。四协议切换共享可移植内容，不跨路由复用私有状态；Azure/Vertex 单列。需要改共享 Turn/fork/protocol 写集时先取得合并窗口并同步 architecture，当前仅审计和本计划/账本有写入，不把标识符搜索、上游单测阅读或旧 owner 通过写成 Lime 新行为已验收。

### C03 / 原始工具调用与执行修正分离（2026-10-19，核心通过；shell smoke 通过，aggregate 被 Workbench 阻塞）

- 上轮归类 progress：核心工具历史与最终产品门禁终态已入库，完整 provenance 六项仅源码审计，未以计划替代实现。本片继续原目标，不以 Workbench 阻塞停止独立 runtime 工作。
- Codex 事实源：`core/src/stream_events_utils.rs:handle_output_item_done` 将原始 `item` 交 `record_completed_response_item` 后执行由 `ToolRouter::build_tool_call(item.clone())` 派生的 call；`tools/router.rs` 不改写模型给出的 `FunctionCall.arguments`。Lime 当前 helper 的执行修正会覆盖 `assistant_content`，包括 alias/schema-invalid 调用；native canonical 转换又只保留 parsed input，使 Chat/Responses 的 raw 参数空白再次丢失。这两条是生产缺口，grok 不参与语义裁决。
- 窄写集：`agent-runtime/provider_turn/tool_call.rs`、大循环的 helper 接线、工具历史 identity 校验与定向测试；`runtime-core/llm_protocol/canonical.rs` 的 typed raw arguments；`model-provider/current_client{.rs,/lowering.rs,/history_tests.rs}`；既有 `thread_compact_jsonrpc/origin_budget.rs` 的四协议真实 Read/fork/冷恢复/摘要回归，以及本计划、architecture 和本片验证账本。旧 27 文件源码摘要已复核无漂移；原已归属本进程的准备/历史模块继续演进，GUI、插件、turn_execution 和 model.rs 并行修改保持只读。
- Verification Contract：root，budget:normal，P0。沿既有 `turn/start -> RuntimeCore -> agent-runtime -> model-provider/tool-runtime -> EventLog`，模型历史保留收到的 name/raw arguments，执行继续使用当前 snapshot 修正结果，二者以同一 call_id 关联。返回模型的 result name 绑定原始调用（Gemini 等依靠 name 的协议也必须一致）；repair metadata 只属于执行/lifecycle，不伪装模型输出。原始 malformed/unknown/schema-invalid 调用和相应失败输出可恢复，禁止用内部 invalid sentinel 替换模型历史。
- 退出条件分母五项：① model call 与 execution 修正分离；② Chat/Responses raw 参数经 canonical 到 native wire 不重新编码，Anthropic/Gemini 保留原结构；③ durable 原文跨冷恢复/四协议切换；④ fork/摘要保持原调用与独立产生时预算；⑤ invalid call 只回填错误、不执行、不重放，持久失败仍阻止工具/后续采样。测试从新增/更新严格断言的红灯开始，随后 owner、四协议公共 RPC 集成、contracts 与 current fixture，GUI smoke 按主链门槛单独记录；失败不放宽断言。live、Azure/Vertex、CLI/PTY、Windows、发布包和完整 provenance 仍需独立验收。
- 文件规模退出条件：大 `provider_turn.rs` 仅增加 helper 接线，不增加内联业务；从超大 `provider_turn/tests.rs` 直接迁出相关 repair/invalid 回归到专门小模块。canonical raw arguments 是同一 provider-neutral contract 的字段，所有 native 消费者同步，禁止把 host 私有字段塞入 provider metadata 或建立后处理旁路。架构敏感数据流更新须在同一片同步 architecture 与 root 确认；没有新 RPC、兼容迁移、第二存储或后端。
- 首轮 owner：Runtime 233/233、Provider 270/270、RuntimeCore 69/69 和 contracts exit 0。随后真实四协议 Read 集成 **0/4**，四项均暴露现有执行修正将 `file_path` 复制成 `path` 后保留旧键，真实 Read serde decoder 报 `duplicate field path`；伪 executor 的 unit 未覆盖该缺口。日志和产物摘要保留为 `/tmp/lime-original-tool-call-preliminary-{origin-budget.log,product-summary.json}`。该 runner 已因断言失败自行结束，未发送进程信号，未开始 fresh 产品构建；不得记作通过或中断。
- 写集扩展仅服务同一合同：流解析的共享 `CurrentProviderToolCall::from_raw`、`current_client/stream.rs` 原名接线和 Gemini parser/identity tests 保留原 name；`tool-runtime/tool_call_surface` 在执行副本消费 alias 并记录删除，真实 Read 必须成功，canonical 参数不得重复。该 761 行模块的测试迁至独立 `tests.rs`，避免继续堆叠。先增强原名断言取得红灯，再修生产并重跑 owner/真实集成；分母五项不变。GUI、Electron、App Server 并行 command/Turn 文件不新增写入。
- 入口原名红灯 **0/2**：共享 raw 构造器把空白名改为 `""`、Gemini 把 `" read_file "` 改为 `"read_file"`；已删除入口 trim，并保留缺失 name 字段的错误检查。Responses function/custom 流测试也逐生命周期要求原名一致。完整 owner 第一次复验另发现一项历史断言要求清洗后空名，已迁为原 `item.name` 的逐字断言；最终四 owner **Runtime 233/233、Provider 271/271、RuntimeCore 69/69、Tool Runtime 523/523**，exit 0。为在最终冻结源码后构建证据，仅中止了已核验属于本进程的验证 runner/Cargo/rustc 子树（exit 143）；被中止轮次不计任何通过，记录 `/tmp/lime-original-tool-call-assertion-interruption.json`。
- 最终公共 RPC 定向 **4/4**：真实 Read 使用带空白原名和 alias 参数；文本流夹具发带格式空白的原参数，Gemini 保持结构化原值，后续 Chat/Responses 原字符串逐字相等。continuation、冷恢复/四协议切换、fork、summary 和独立原预算（含 0）均通过，durable/canonical 投影保持一致。最终 contracts exit 0；fresh build、完整 target、stdio 和 GUI 场景仍待终态，不预记通过。
- 本片能力边界：尚未实现 malformed 字符串历史切入 Anthropic/Gemini 结构化参数协议时的显式拒绝；当前原样字符串保存与合法结构化历史验证不核销该缺口。后续在既有 native lowering owner 明确不可表示的转换，禁止静默修正原历史。完整 Responses item/envelope、provenance 和 inherited 授权等仍属于 C03 未完成范围。
- 最终验证：`npm run test:rust:unit -- -j 1 --no-fail-fast -p runtime-core -p model-provider -p agent-runtime -p tool-runtime` exit 0，共 **1096/1096**；完整 `thread_compact_jsonrpc` **34/34**，含真实 stdio 压缩/工具历史及进程重启；`thread_fork_compaction_jsonrpc` **1/1**；`npm run test:contracts` exit 0。两项原始业务红灯、入口原名红灯、真实 Read 的 0/4 失败及修复后的终态均进入 [本片验证账本](artifacts/codex-original-tool-call-20261019/validation.json)，不以最终绿灯覆盖失败经过。
- fresh 产品门禁：正式 `ensureElectronFixtureBuild` 构建并通过 `inspectElectronFixtureBuildFreshness`（renderer/host/sidecar 全 ready），未设置 build-ready 或伪造时间戳。sidecar 与依赖库复制到独立目录并记录 SHA；stdio/GUI 均指定该固定 binary，最终 36 项源码摘要和固定产物均无漂移。`npm run verify:gui-smoke` exit 0、**24/24**，run `original-tool-call-1792353852492`，59 次 current JSON-RPC bridge 命中、legacy/mock 命中均 0。该证据明确为 **Gate B-F**：真实 Electron 启动、reload、preload/IPC、App Server、设置和三尺寸布局；不证明本片 raw-call 场景的 Desktop Thread/Turn/Item identity，也不证明 live provider、发布包或 Desktop 像素等价。
- aggregate 终态：`npm run smoke:agent-runtime-current-fixture` exit 1。前三个真实 Electron 场景通过；第 4 个 Coding Workbench 在 `open-workbench` 等待 180 秒后报“点击工作台后未出现工作台内容”，后续场景未运行。GUI/夹具根因仍未分清，不修改并行 GUI owner、不放宽断言、不标 aggregate 或 release 通过。完整 `verify:local` 未跑，本片只声明上述 owner/公共 RPC/stdio/contracts 与独立 shell 证据；Windows、CLI/PTY、live 和 Azure/Vertex 仍未验。
- 完成口径：冻结的五项原始调用/执行核心合同 **5/5（100%）**；C03 仍 partial，总体“完整对齐”保持 active，不报告整体百分比。`current` 为既有 provider、tool、Loop 和 EventLog owner；没有新增 `compat/deprecated`、迁移、RPC 或平行存储。已删除覆盖模型历史的执行修正、入口原名 trim、native 字符串重编码和重复 alias 执行行为；两个超大测试区的相关测试已迁入小模块。测试专用 `catalog_truncation::fixture_with_tool` 因新真实 alias 场景不再使用，保留为下一片直接清理项，不属于生产路径。
- 下一刀：在现有 lowering 边界明确拒绝不可表示的原参数转换，并清理上述未使用夹具；随后继续 C02 同 Turn 压缩和 C03 完整模型历史/来源授权合同。Memory、Stop/harness、插件/tar.gz 与 LimeCore 仍按总计划推进，grok 继续只参考多模型控制面。

### C03 / 原参数跨协议表示边界（2026-10-19，核心通过；shell smoke 通过，aggregate 被 Workbench 阻塞）

- 上轮为 progress，36 项核心源码摘要已按上一片账本核对无漂移。主目标和 K1 阶段不变：Codex CLI 直接源码、Desktop 已有 REA 证据为主；grok 只参考多模型控制面。Codex 原始 FunctionCall.arguments 与派生执行分离的合同继续适用；Lime 必须在既有 native adapter 明确处理结构化协议不能表示的原文，不能改写历史来伪装成功。
- 正向源码证据：`current_client::from_raw` 为 malformed raw 保存原字符串及 parsed/fallback input；Anthropic `lowering::anthropic_message` 直接写 `input`，Gemini `assistant_parts` 直接写 `args`，当前均没有对象/原文一致性检查。现有 `CurrentProviderError::invalid_request` 是非重试请求错误；`stream_with_continuation` 在 native lowering 成功后才发送请求。本片直接使用该 owner，不新增协议、后端或兼容格式。
- 窄写集：`model-provider/current_client` 的结构化参数 helper/模块注册、两个 lowering 入口和 `history_tests`；将 1364 行 `lowering.rs` 的原 tests 迁入独立模块（业务约 831 行，本片入口只接线，后续按协议继续拆分）；既有 `thread_compact_jsonrpc` 的 model fixture/模块注册、新跨协议拒绝集成，以及未使用的 `catalog_truncation::fixture_with_tool` 删除；本计划、architecture 和独立验证账本。GUI、Electron、插件和 App Server 生产 Turn/fork 文件只读。
- Verification Contract：root，budget:normal，P0。① malformed/非对象/原文与 parsed input 不一致的工具历史在 Anthropic/Gemini native 边界以 InvalidRequest、retryable=false 拒绝，HTTP sampling 零调用且不泄漏参数；② Chat/Responses 保留原字符串，合法结构化参数不修正、不泄漏 host 字段；③ 公共 RPC 中 Chat 原无效调用及失败输出跨冷恢复保留，切换结构化协议后失败终结且不发 sampling，不改写 durable 历史，切回 Chat 仍可继续并 fork；④ 清理未使用测试夹具与过大 inline 测试，不恢复兼容路径。上述四项为本片分母，不代表整个 C03。
- 验证先取得 native/HTTP 严格断言红灯，再实现并运行 provider/Loop owner、公共 RPC 跨协议与完整压缩集成、contracts；受影响 current fixture 和独立 GUI smoke分别记账。长任务和 C02 核心实施继续推进；不以本片或旧门禁代表同 Turn 压缩、完整 provenance、Memory、Stop/harness 或插件/tar.gz/LimeCore 已完成。
- 已取得真实红灯 **0/3**：非对象 input 被直接写入 native 请求、parsed 副本改写被发送、malformed 历史触发 HTTP（实际 1、期望 0）；日志 `/tmp/lime-history-representation-red.log`。没有放宽断言。生产检查集中在 `current_client::tool_arguments::ensure_structured_history`，两个 native lowering 入口只接线，错误为非重试 InvalidRequest，错误不含原参数。
- 修复后 `agent-runtime` **233/233**、`model-provider` **274/274**，共 **507/507**；`npm run test:contracts` exit 0。公共 RPC 新场景 **1/1**，随后完整 `thread_compact_jsonrpc` **35/35**、`thread_fork_compaction_jsonrpc` **1/1** 均 exit 0；单项包含在完整 35 中，不重复累加。公共 RPC 验证的是合法 JSON 的非对象 string；malformed 语法和 raw/parsed 不一致由 native/client HTTP 严格测试覆盖，不混称端到端。
- 公共链确认原始失败 call/result 跨真实 DB/EventLog 冷恢复保持；切换 Anthropic/Gemini 后 Turn failed、sampling POST 为零、原两条 durable 工具记录不变，切回 Chat 与 fork 均继续成功。新 Turn 的合法输入照常持久化，不能把“工具历史不变”扩称整个 EventLog 不变。
- 正式 fresh build 已通过标准 helper 和 freshness 检查，renderer/host/sidecar 全 ready；sidecar 与依赖固定到独立实文件目录，App Server SHA `59c17e4aafe89669e7b43a47303968a4398f190a440b4af0d4eab3d5be35001b`。stdio/GUI 使用该固定 binary；不设置 build-ready、不伪造时间戳。runner 已在 `2026-10-18T20:24:39.495Z` 结束，最终 exit 1 仅来自 aggregate；39 项核心源码与固定产物均无漂移。
- 清理：删除无消费者的测试专用 `fixture_with_tool`，`lowering.rs` 从 1364 行拆出 524 行 tests，生产入口现 834 行；本片不向其继续堆叠业务，后续协议模块拆分沿既有 owner 完成。没有新增 compat/deprecated、迁移、RPC/schema、store 或生产 mock。architecture 已同步 native 表示检查的数据流和 root 确认；scoped rustfmt、diff 与 docs boundary exit 0。
- 本片四项核心合同 **4/4（100%）**，整体 C03 partial、“完整对齐” active；该百分比不包含 Desktop aggregate、完整 provenance、同 Turn 压缩或总体目标。[本片验证账本](artifacts/codex-history-representation-20261019/validation.json) 记录红绿断言、源码/产物和实际产品终态。
- 本次 aggregate 已 exit 1：前端定向实际执行 **31/34/3/300** 项通过（有预设过滤），前三个真实 Electron 场景通过；Coding Workbench 再次在 `open-workbench` 的 180 秒等待后失败，后续 aggregate 场景未执行。对应 session `01a150ab-d024-7bd2-b363-78276ce525dc`，invokeErrors=[]；错误不能归因为本片 native 参数拒绝，GUI/fixture 根因仍待其 owner 定位。日志 `/tmp/lime-history-representation-current-fixture-final.log` 与本次失败 summary/SHA 入账；没有跳过、放宽断言或夹写并行 GUI。
- 独立 `npm run verify:gui-smoke` **exit 0、24/24**，run `history-representation-1792354987534`；真实 Electron/preload/IPC/App Server、重载、Memory 设置、三个 viewport 通过，current JSON-RPC bridge 56 次，legacy/mock/error 均 0。此证据为 **Gate B-F**，不证明本片工具历史的 Desktop Turn identity、完整 Memory 流水线、live、发布包或 Codex Desktop 像素一致。summary SHA `70363c58ea6a11e28bbc203295186c886f01bc297ee50997374de1a501b237c9` 已入账；没有 pending 门禁。
- 收尾分类：表示检查和历史恢复仍归既有 `current` owner，HTTP/SSE 夹具为 `test-only`，闲置夹具为 `dead/deleted`，本片无新增 `compat/deprecated`。未跑完整 `verify:local`、lime exec/PTY、Windows、live、Azure/Vertex 和发布包；不以本片结果进入全仓 release evidence。下一刀按下节先完成 C02 的同 Turn durable compaction，完整 provenance、Memory、Stop/harness、插件/tar.gz 与 LimeCore 继续开放。

### C02 / 同 Turn 压缩再次源码定位（2026-10-19，仅审计，尚未实施）

- 直接读取 Codex `session/{turn,context_window,mod,rollout_reconstruction}.rs`、`compact.rs`、`rollout/src/model_context.rs`，HEAD 为 `8c076942cb70fba8e5c4732c23f1faabc4aed484`；源码 SHA 与 Lime 链路记录在 [C02 审计](artifacts/codex-history-representation-20261019/c02-source-audit.json)。Desktop 仅复核已有 REA retained record，grok 没有用于定义本项合同。
- Codex 的 `should_roll_over` 在仍需 continuation 时调用 `run_auto_compact(MidTurn)`，成功后继续同一 Turn；`replace_compacted_history` 持久化 replacement 和配套上下文，冷恢复以该 checkpoint 加后续 suffix 重建。模型切换的旧模型摘要/新模型 replacement 与 remote compact 能力分支也有明确 owner，不能把 OpenAI 专有 wire 强加给 Lime 其他协议。
- Lime 已确认三个必须一起修的点：① tool result 持久 ACK 后、下一 sampling 前接入摘要与替换；② durable 窗口必须表达同 Turn 内已覆盖的历史边界，不能仍从 `tailStartTurnId` 首 event 回灌整个 Turn；③ `capture_step_context` 的 rollover flag 不能在摘要/持久失败时提前推进成功 epoch。现有 `compact_session_now` 会取消 active Turn 并创建压缩 Turn，禁止直接用作 inline handler。
- 下一实现沿现有 agent-runtime Loop、App Server ordered channel/receipt、context compaction 和 EventLog owner 完成，不新增第二后端或临时历史 store。必须同时验证同 Turn identity/无工具重放、窗口持久边界/较新输入顺序、摘要失败/取消/持久失败、冷恢复/fork、四协议原路由与凭证、低预算/禁用/最终响应不误压缩。上述为实施前义务，**不计完成项或行为证据**；共享 Turn/恢复文件在落补丁前继续核对最新写集，避让外部修改。

### C02 / 持久前缀边界实施（2026-10-19，核心通过；shell 通过，aggregate 被 Workbench 阻塞）

- 上轮为 progress；39 项核心源码与上一片最终账本核对无漂移。主目标仍为完整对齐、当前阶段 K1；先替换会阻断同 Turn 压缩恢复的 coarse Turn 边界，再贯通 Loop，不以边界重构核销 C02 其余五项义务。
- Verification Contract：root，P0，budget:normal。沿同一 EventLog，compaction marker 用 `coveredThroughSequence` 明确已被 replacement 覆盖的前缀；provider transcript 只恢复 replacement 加序号大于该边界的后缀，后缀允许在同 Turn 且早于 marker 落盘。边界缺失/非法/嵌套冲突不能丢弃历史，fork 对不完整 marker 拒绝；不得按旧 Turn 字段猜边界。生产者、canonical private payload、thread fork 与 AgentControl child fork 同步更换，不保留旧字段或迁移。
- 窄写集：`agent-protocol/thread.rs` 的内部 compaction 字段；App Server `context_compaction{.rs,/boundary.rs,/operation.rs,/tests.rs}`、`provider_history{.rs,/tests.rs,/boundary_tests.rs}`；`thread_item_projection/materializer/lowering.rs` 与 typed tests；`thread_fork{.rs,/tests.rs}`；`agent_control{.rs,/fork.rs}` 与 fork tests；`context_packet.rs`、`memory_prompt.rs` 的已有摘要 metadata 消费者；`runtime/tests/{sessions,context_auto_compaction}.rs`、`thread_fork_compaction_jsonrpc`、新 boundary 公共 RPC 回归；本计划、architecture 和本片账本。GUI/Host/command、Loop/取消 driver 与插件只读，本片不恢复第二历史 store。
- 文件规模退出条件：1567 行 `provider_history.rs` 迁出原 inline tests；993 行 `agent_control.rs` 将现有 fork 构建与验证迁至小模块，本片逻辑留在该模块。架构图同步唯一序号边界和 child 序号重映射，并由 root 确认。
- 验证先取得同 Turn/完整前缀及旧字段回流的红灯，再跑 producer/reader/canonical/fork 单测和真实公共 RPC 冷恢复/fork/stdio 回归、contracts、fresh 产品门禁。生产自动 Loop 尚未接线；测试控制 backend 写 marker 的证据只能证明边界及恢复，不能写成自动压缩或 live provider 验收。

- 实施发现：普通 thread fork 原先只校验 canonical Item，raw marker 的 top/artifact 冲突会在投影后丢失，可能使 fail-open 源会话与 fork 的 provider history 不一致。窄写集增加 thread_fork/compaction.rs，在原 EventLog 上校验选中 checkpoint 及 canonical 字段一致性，再创建 child；不校验 fork 截断范围之外的后续 marker。补公共 RPC 拒绝回归，属于本片既定无损恢复合同。

- 下一片组合义务（只读定位，未实测）：AgentControl child 的 marker 为 session-level（turn_id=None）；普通 thread_fork 当前从 canonical Items 生成 seed，thread_fork/tool_history::copy_model_records 只补逐次工具记录。必须追加 child → 普通 fork → 冷恢复的公共回归，并核对 session-level checkpoint 的保留和截断规则；本片只核销各自已验证的普通 compaction fork 与 AgentControl provider 冷恢复，不将此组合或完整 C02 标为已完成。随后接入生产 Loop 的摘要/替换及成功 ACK，不推进失败/取消 epoch。

- 核心终态：reader 先取得 **1 pass / 3 fail**，实现后定向 **4/4**；完整 owner 首次暴露 ItemId 规范化匹配和旧 fixture 缺 nested coverage，均已修正。最终生产/owner 源码完整 **App Server 1983/1983 + agent-protocol 46/46 = 2029/2029**，`--test-threads=1`，0 ignored/filtered。此前默认并发的 Skills watcher 通知等待超时、四线程的 stdio partial-failure 通知超时均保留；两项单独复现各 **1/1**，没有改测试超时/断言或跳过。最终 serial owner 后仅新增 integration test 的取证对象修正，owner library 与 unit 源码摘要一致。
- 公共 RPC 首轮 **1/3**：两个恢复测试误将 RuntimeCore 重建占位事件当作 durable EventLog 比较，离线逐字符差异仅为时间戳 `Z` 与 `+00:00`。已按真正合同直接逐字段比较 EventLog 原始记录，继续严格比较 provider transcript 和公开 Item；没有忽略时间戳、放宽 transcript 或改生产行为。最终新 RPC **3/3**（同 Turn marker 前/后 suffix、无 tail Turn 的完整前缀、冲突 marker 在 child 创建前拒绝），冷恢复和 fork 的公开 contextCompaction 仍 type/id only。
- 最终源码完整压缩集成 **35/35**（含两项真实 stdio、四协议 route/credential、取消/失败/恢复/摘要与工具历史）、独立 fork compaction **1/1**，contracts exit 0。三项新 boundary RPC 与原 35/1 属不同测试二进制，不重复累计；owner 里已包含的定向子集不再累计。scope rustfmt/diff 已过，architecture 图已由 root 确认。
- 本片五项核心合同 **5/5（100%）**：生产前缀/schema、精确 suffix/fail-open、AgentControl child 序号重映射/冷恢复、普通 fork/冷恢复 transcript 与 id-only 公共 Item、原 marker 冲突拒绝。该分母只含本片明确场景，**C02 partial / 总体 active**；child 二次普通 fork、生产 Loop/成功 epoch、完整 C03/Memory/Stop/harness/插件/tar.gz/LimeCore 不在已完成范围。
- fresh 构建经正式 helper 与 freshness 检查，renderer/host/sidecar 全 ready；运行 2539.905s。固定 sidecar 与依赖到独立实文件目录，App Server SHA `a63188f65412ebfd9de287d7cde363eaddd1c0fda790fd0a6959f5067f966872`；stdio 和后续 GUI 指向同一固定 binary。当前 59 项核心源码无漂移，产品终态和账本将继续收取；没有设置 build-ready 或伪造时间戳。

- 产品终态：runner 已于 `2026-10-18T22:17:04.212Z` 结束，exit 1 仅来自 `smoke:agent-runtime-current-fixture`。其前端定向执行 **31/34/3/300** 项通过（存在预设过滤）；前三个真实 Electron 场景通过，第 4 Coding Workbench 在 `open-workbench` 报“点击工作台后未出现工作台内容”，后续未运行。失败 session `01a15107-552a-74d1-8668-555470fb18cd`，invokeErrors=[]；未修改 GUI/fixture 或放宽断言，不将未区分的 GUI/夹具原因归为本片边界逻辑。
- 独立 `verify:gui-smoke` **exit 0 / 24/24 Gate B-F**，run `compaction-boundary-1792361755107`；真实 Electron/preload/IPC/App Server、reload、Memory 设置和三尺寸布局通过，current bridge **58** 次，legacy/mock/error 均 0。该证据不证明本片工具 Turn 的 Desktop identity、生产自动压缩、live、完整 Memory 或 Desktop 像素等价。
- fresh helper 在 aggregate 阶段发现写集外 `tui/src/runtime_pty_tests/composer.rs` 更新，按正常 freshness 流程重新准备 assets；本片没有设置 build-ready，未触碰该并行写集。stdio/GUI 继续使用固定实文件 sidecar；最终 **59 项核心源码、Codex 六项源码和固定产物无漂移**。
- 收尾分类：序号边界、provider reader 和两个 fork owner 为 `current`；旧 Turn 边界字段/helpers 为 `dead/deleted`，唯一旧字段字面量是负向回流测试；受控 marker backend 为 `test-only`；本片没有新增 `compat/deprecated`、迁移、RPC 或 store。provider_history.rs 已从 1567 行迁出原 tests 至现 720 行；agent_control.rs 从 993 行拆分 fork owner 至现 635 行。未跑完整 `verify:local`、CLI/TUI PTY、Windows、live、Azure/Vertex、发布包，不将本片证据写成全仓 release 通过。
- [本片独立验证账本](artifacts/codex-compaction-boundary-20261019/validation.json) 保留红绿断言、两次并发 owner 超时与最终 serial 通过、公共 RPC 取证纠正、源码/产物摘要和产品失败终态；本片核心 **5/5（100%）**，C02 与总体继续 partial/active。下一刀先实测并修复 child session-level checkpoint 的二次普通 fork 组合，再贯通 tool durable ACK 后的同 Turn inline compaction，保留较新 steer/mailbox 输入，并使摘要/取消/持久失败不推进 epoch。Memory、Stop/harness、C03 完整 provenance 和插件/tar.gz/LimeCore 继续按总计划推进，grok 只参考多模型。

### C02 / child checkpoint 连续 fork（2026-10-19，核心完成，产品阻塞）

- 主目标：按 Codex 持久模型上下文语义修复 AgentControl child → 普通 fork → 冷恢复，不新增兼容层。Codex 是事实源；grok 仅供多模型控制面参考。
- 窄写集：`app-server/src/runtime/thread_fork.rs` 接线、`thread_fork/compaction.rs`、`runtime/tests/agent_control/fork.rs` 及其测试子模块、`app-server/tests/thread_compaction_boundary_jsonrpc.rs` 及相邻专用测试；本计划和 architecture 的本片段落。其余 Loop owner 暂只读，后续接入前另行记录。避让 GUI、Electron、command、TUI 与其他未知脏文件；不提交或操作分支。
- Verification Contract：root；budget:normal；P1。主链为公共 `thread/fork` → RuntimeCore → 原 EventLog + canonical seed → 同一 Thread/Turn/Item read model → 冷恢复后的 provider history。不改 RPC/schema、provider wire、工具执行或权限；前端网关/Host/GUI 无新接线。
- 输入/终态：session-level checkpoint 必须在完整 fork 与再次 fork 保留；last/before 前缀只保留截断点之前的 checkpoint；坏 marker 在 child 创建之前拒绝；源 EventLog 不变。无工具重放，无新 store，无兼容双读。失败停在 fork 校验层。
- Codex 源码定位：`core/src/agent/control/spawn.rs::keep_forked_rollout_item` 保留 `RolloutItem::Compacted`；`core/src/thread_manager.rs::fork_history_from_snapshot` 和 `truncate_before_nth_user_message` 对完整/前缀 snapshot 分支；`core/src/thread_rollout_truncation.rs` 按 rollout 位置切分。这里只声明源码证据，不冒充 Desktop REA/runtime 证据。
- 退出条件（冻结分母 4 项）：① child checkpoint 连续 fork 当场/冷恢复 transcript 一致；② full/last/before 截断不泄露未来摘要；③非法/冲突 session marker 拒绝且无 child 副作用；④公共 JSON-RPC 恢复与相关原回归通过，源 durable history 不变。
- 验证：先新增失败回归，再定向 Rust、相关 fork/compaction 集成、contracts/scoped fmt/diff/docs；Agent fixture 与 GUI smoke 按质量规则记录真实执行结果。deterministic-smoke/runtime-transcript 必需，release-artifact/live/Windows 不在本片；Desktop 结果单独分级，不代替 fork transcript。无 supervisor/LLM judge。
- 回写入口：失败先落稳定 Rust/RPC 回归；账本使用独立 `artifacts/codex-child-checkpoint-fork-20261019/validation.json`，不覆盖上一片 evidence。架构影响为既有 fork history 数据完整性修复；完成前同步 architecture 数据流并确认。C02 与总体维持 partial/active，之后继续同 Turn inline compaction。
- 首轮定向 **0/2**：连续 fork 首先在 `thread_fork/settings.rs::fork_thread_snapshot` 因合法缺省 `Thread.metadata = null` 被拒绝。`Thread::new` 默认即为 Null，AgentControl 无路由默认时也不生成 metadata；这是实测前置缺口，不改测试伪造路由。窄写集补该 settings 函数，仅规范化缺省 null，非对象的其它非法值继续拒绝。压缩 marker 的丢失仍须公共 RPC 和修复后的连续 fork 实证。
- 公共 RPC 红灯 **0/2**：完整 fork 实际向模型重发原对话而非 replacement；冲突 session marker 未被检查即创建 child。修复后连续 fork 定向 **2/2**、完整 boundary RPC **5/5**（含原三项）通过，覆盖 full/last/before、两次普通 fork、冷恢复后下一 Turn 的精确 provider transcript、非法 marker 拒绝与源日志不变。fork owner、原 fork 集成和 fresh 产品门禁继续执行，未据此核销生产 inline Loop。
- 结构：业务逻辑集中于既有 `thread_fork/compaction.rs`（123 行），root 仅接线和冷恢复 marker 准入（893 行）；退出条件是不再向 root 堆叠业务。settings 仅规范化 canonical 缺省 null。本片无 RPC/schema、依赖、锁文件、工具或 provider wire 改动，无 compat/deprecated。架构图已更新，责任开发者 root 于 2026-10-19 核对 owner、历史边界和冷恢复数据流。
- 启动器失败单独保留：原 integration wrapper 追加 `--tests` 导致编译无关测试，主动结束后改用精确测试二进制；一次裸 Cargo 漏带仓库 V8 配置触发 404，已恢复 `resolveRustyV8CargoEnv` 校验产物配置。两次均不算测试通过或产品失败；原日志和后续真实红绿结果在独立账本。
- 下一片只读定位补充：`provider_turn.rs` 在工具执行前取出 pending input，在 `record_outputs` durable ACK 后才把本组结果与先前取出的 pending messages 加入 loop history；`turn_execution.rs::steer_turn/steer_existing_actor_turn` 则先让 actor 接受输入，再 append durable input。输入可能在工具期间持久化但尚未进入模型历史，甚至可能先被 actor 消费而尚未持久化。因此“以最近工具 output 的序号覆盖最新 EventLog snapshot”仍可能吞掉未摘要输入；只删除 `capture_step_context` 的提前 epoch 更新也不构成生产 Loop 实现。下一片须先以可复现并发 barrier 测试冻结已接纳进模型历史且已持久的输入前缀与待递送 suffix，再接摘要与成功提交 ACK；不得凭文本去重、最新 snapshot 替换或提前推进 epoch。此为 source observation，尚未新增相应并发测试或生产改动。
- 已继续定位上游解决方式：Codex `session/turn.rs::run_hooks_and_record_inputs` 与 `hook_runtime.rs::record_pending_input` 在下一 step capture 前记录被接纳的模型输入；`session/mod.rs::record_prepared_conversation_items` 保留 annotated item 的 `user_input_order`、source identity 和独立输出预算。`replace_compacted_history` 的 Prefix 分支在提交前验证 captured prefix generation/len 与 auth owner generation，接回当前未变 suffix，成功 state update 才推进窗口；Complete 分支用稳定 item identity 保留摘要输入 snapshot 之后的 goal edits。下一片沿这些源码语义完善 current 模型历史/输入归属，不以 grok Loop 或猜测替代。详细源文件 SHA 与边界见本片 `inline-source-audit.json`，不声明并发运行验证已完成。
- 最终 fork owner **20/20**（按 fork 过滤，包含上述两项，非额外累计）、原 fork 公共集成 **7/7**、boundary RPC **5/5** 均通过。完整压缩公共集成 **35/35**、0 ignored/filtered，含真实 stdio 冷重启、四协议切换与工具历史；标准 stdio smoke exit 0（backend=unavailable / thread fail-closed，只证明初始化和拒绝边界）。最终 contracts/scoped fmt/diff 通过。
- fresh helper 正常重建 renderer 与 App Server 并通过三段 readiness，没有设置 build-ready override。固定 sidecar 为独立目录 `lime-child-checkpoint-fork-sidecar-edAfAN/app-server`，SHA `dd1bdd3150afbcb36ca9a226f7ea243752fe02974577c63e7cb9ea9497b7b016`；真实 stdio 与后续产品门禁指定同一实文件。核心 61 项源码、Codex 8 项参考源码及固定 binary 在结束时均无漂移。产品四阶段终态为 compaction integration=0、stdio=0、Agent fixture=1、GUI smoke=0；aggregate exit 1。独立 shell smoke 的真实 summary 为 pass，覆盖 Electron 启动/重载、preload/IPC、App Server 初始化、设置与三尺寸布局，不覆盖 provider Turn 或 Codex 像素一致性。Agent fixture 前三项真实 Electron 场景通过，第四 Coding Workbench 在 `open-workbench` 报“点击工作台后未出现工作台内容”，后续聚合场景未执行；根因尚未区分 GUI 与夹具，未修改断言或超时绕过。core 合同 4/4（100%），产品阻塞，不核销整个 C02。原日志/summary 和 SHA 已存入独立账本及本片 artifact 目录。
- 产品 fixture 的正常 freshness 检查发现写集外 `useCanvasWorkbenchFileTreeState.ts` 更新，按 helper 原流程重建 renderer；本片不修改并行 GUI、不设置 build-ready、不用旧 renderer 绕过新源码。产品门禁验证当前工作树，固定 sidecar 与 61 项核心源码另行校验归属和无漂移。完整 `verify:local`、CLI/TUI PTY、Windows、live、Azure/Vertex 和发布包不在本片完成口径；全仓/全平台与生产 inline Loop 继续开放。

### L01 / 显式 continuation（2026-10-19，owner 通过，公开回归/产品待验）

- 主目标仍是 Codex Loop 对齐，grok 仅参考多模型。负责人 root；budget:normal；P0。Codex `codex-api/src/sse/responses.rs::partial_answer_phase_survives_item_start_and_completion` 与 `core/src/session/turn.rs` 为依据，先补能穿过真实 current backend、共享路由与 Responses adapter 的公共回归。
- 本片准备写集仅新 `app-server/tests/turn_continuation_jsonrpc.rs` 与相邻 `turn_continuation_jsonrpc/provider.rs`、本计划；工具历史 receipt 的冻结生产源码、现有 fixture 和并行 GUI/Electron 保持不变。测试使用显式 loopback HTTP provider，无 live/真实云凭证，不把 fixture 服务当生产 fallback。
- 输入/可见结果：公开 `thread/start`、`turn/start`，首个 Responses response 带部分文本和 `end_turn=false`，第二次 sampling 产生最终文本；两个 response 必须属于同一 canonical Turn，第二请求包含完整原输入和首段模型历史，最终只发布一次该 Turn terminal。
- 失败终态：无 pending input 或工具时不能把 `end_turn=false` 当正常 Stop；真正 final 不得无限续跑；取消/provider error/工具执行仍走原终态与权限。先取实际红灯，不以源码差异冒充已复现。
- 后续实施需直接扩展规范 continuation 信号并同步 adapter/consumer，不把 Responses 私有字段强加给所有模型、不靠空文本猜测；以四协议正常完成/工具续跑/显式续跑能力、同 Turn identity、请求次数与取消/冷恢复验收。生产写集和完整退出分母在 receipt 核心/产品验证结束后冻结，当前准备不计实现完成。
- 公共回归已在未改生产源码的基线上真实失败：`end_turn=false` 首段可见文本后仅 **1 次 sampling，预期 2 次**；不是编译、夹具或超时失败。原日志归档为 `codex-explicit-continuation-20261019/red.log`，receipt 的 74 项核心源码仍无漂移。测试经真实 current backend、route 和 Responses HTTP/SSE adapter，使用 loopback provider 与 fake key，不等同 live provider、Electron 或 CLI/PTY 证据。
- 同一上游分支还明确把 `response.incomplete` 的 `reason=interrupted` 转为非终结完成，其它 incomplete 保留错误；Lime reducer 目前忽略该事件，流关闭后报 transport error。Codex `core/tests/suite/scenarios_partial_answers.rs` 另验证 `partial_answer`/`commentary`/`final_answer` 跨后续采样和 fork 保留；不能把仅修 `end_turn` 写成 phase/envelope 已对齐。这两项目前为源码定位，尚未取得独立运行红灯。
- 实施写集冻结：`runtime-core/llm_protocol/canonical.rs` 增加内部规范 follow-up 信号；`model-provider/current_client/stream.rs` 和新 `stream/responses.rs` 直接拆分既有 Responses owner，再接线该信号；Gemini 及其它完整 Finish 构造显式无续跑请求；`agent-runtime/provider_turn.rs` 消费信号，沿现有 transcript、pending-input、预算与取消边界继续；既有测试的完整构造同步，新 owner 测试放 `provider_turn/tests/continuation.rs`，adapter 测试放 `stream_tests.rs`，公共回归补冷恢复。`server/handlers/provider_calls.rs` 仅同步内部 event 构造/解构，不扩展该 sampling endpoint 的行为。没有新增 public RPC/schema、依赖、工具、权限、迁移或兼容包装。
- 本片核心退出分母 4 项：①公共红灯与 adapter `end_turn=false/true/absent` 归一；②同一 canonical Turn 继续，partial 历史只入下一请求一次，真正 final 只终结一次，冷恢复保留两段；③工具仅执行一次、取消与预算阻止下一 sampling，后续错误禁止重放；④受影响 owner/四协议/stdio 回归和架构/证据落库。完整 message phase/raw envelope、interrupted incomplete、普通 empty completion 与 Stop 仍分别开放，不以这四项核销 L01。
- 文件规模退出：把 1460 行 `stream.rs` 的既有 Responses reducer/helpers 迁入约 700 行单一模块，parent 回落约 780 行。既有超大 `provider_turn.rs` 本片只做规范信号、pending-input 和已存在预算检查的有限接线/移动（新增业务行不超过 20），测试不向 root 堆叠；完整 sampling driver 拆分跟随 H01 snapshot owner，不能继续向其追加独立业务。
- 验证调度调整：receipt 核心回归结束后保存其 74 项源码终态，再实施本片；两片共享一次最终 fresh build、固定 sidecar、stdio/current fixture/GUI 产品门禁。此前核心证据只绑定其冻结版本，不能拿旧结果替代本片回归；合并产品验收同时记录最终完整源码摘要，并保持每个场景真实失败/未执行状态。此调整只减少重复产品构建，不减少退出合同。
- 实施已应用：14 项源码/测试窄写集全部经原 SHA 核对后写入，连同前置核心与独立 provider fixture 冻结为 **81 项**；未知 GUI/Electron/command/TUI 改动继续避让。`Finish.needs_follow_up` 不改 `FinishReason`；共享 Loop 保存本次 assistant transcript，接受当前 pending/mailbox 后继续，并复用现有取消/预算/工具执行边界。七项 owner 和一项 adapter 回归、公共冷恢复扩展已落地，尚未运行通过，不计本片核心完成。当前 root 仅有限接线与移动既有预算分支，Responses parent 为 777 行、新模块 697 行；架构图/依赖方向已由 root 确认。
- 首次编译因拆分时无条件 re-export 了 `cfg(test)` helper 失败，未执行测试，按作者错误保留日志；已改条件导出并收窄 header helper 可见性，冻结 revision 2 后重新验证。`npm run test:contracts`、`npm run docs:boundary` 和 scoped diff 已 exit 0，81 项冻结源码无漂移。Rust 定向仍在编译，不把契约/格式检查算行为绿灯。
- 第二次编译定位媒体终态构造缺字段；全工作区完整 Finish 构造复核同时发现摘要测试的 shorthand 构造。窄写集补入此前干净的 `media-runtime/src/llm_events.rs` 与 `agent-runtime/src/context_compaction/tests.rs`，均仅显式设置 false，冻结 revision 3 为 **83 项**。原编译失败单列，不算产品红灯；没有放宽断言或改额外业务。Codex `compact.rs` 的独立摘要采样在 Completed 使用 `..`，不消费普通 Turn 的 follow-up，因此 Lime 摘要行为未擅自扩展。新增媒体构造将以对应 worker 回归覆盖，Loop 及公共冷恢复验证仍在进行。

- 第三轮 owner 实测为 5 通过、1 失败；失败来自新测试把 runtime world-state 的 user-role 消息也计为用户输入，属于测试作者错误。修正为下一 sampling 历史精确等于首个完整 transcript 加一段 partial assistant，公共测试同步核对完整前缀及原输入仅一次；未改生产逻辑或放宽重复检查。原过滤词漏掉 reasoning 测试，revision 4 改用 continuation 覆盖全部本片测试，83 项源码重新冻结。原失败日志独立归档，尚不声明本片核心通过。

- revision 4 已终态 exit 0：本片新 Loop **7/7**、adapter **1/1**；额外匹配的 agent-runtime 3 项、App Server 9 项与 model-provider 1 项通过但不计新增合同，runtime-core 0 匹配不算覆盖。公开 JSON-RPC 冷恢复和完整 owner/consumer/媒体/四协议/stdio 回归正在运行；编译只读采样捕获 active LLVM codegen，未重启或改 profile。83 项冻结核心无漂移，核心 **2/4（50%）**；产品未开始，L01/总体仍 active。
- 等待构建期间的插件/tar.gz/Core 只读复核见 `artifacts/codex-plugin-tar-review-20261019/source-audit.json`：三方分享压缩上限均为 50 MiB；高优先级 manifest 目录被 Core 当缺失的源码差异需先补独立 tar.gz 红灯。未修改 Core 或本片冻结 Rust 源码，不以此复核核销插件清理/发布到 Turn。

- revision 4 公共回归取得第二个真实产品红灯：同 Turn 采样 2 次、完整下一请求与一次 terminal 均通过，但冷恢复后 assistant envelope 实际 1 个、预期 2 个；后续阶段自动停止未执行。现有恢复 owner 未消费 durable `provider.step`，连续采样内容被合成同一消息。本片追加认领 `provider_history.rs` 与独立 `provider_history/continuation_tests.rs`，按已有 step 分界 flush assistant/tool-result，不做正文去重或 phase 推断，不新增事件/store；revision 5 共 84 项源码冻结，三个投影回归及公共复跑待验。原失败与未执行状态已归档，核心维持 2/4。

- 等待 Rust 构建期间，Core 的 manifest 目录差异已取得独立真实 tar.gz 红灯并直接修复。Codex `find_plugin_manifest_path` 为依据，Core 原 root/Codex/Claude 目录在发布和分享中 6 项错误接受、Cursor 目录 2 项错误诊断；修复保留每次扫描的目录 identity，并在唯一 manifest selector 拒绝目录叶子和非目录父路径。新场景 **22/22**、定向顶层 **21/21**，标准 `make verify-contracts`、`GOMAXPROCS=1 make verify-go`（10 模块 vet/test，27 个带测试包）和 diff 检查均 exit 0。七项 Core 源码无漂移；本片退出合同 **4/4（100%）**，仅代表 manifest 路径选择，不能核销完整插件/tar.gz 或实际 Core/MySQL 到 Turn。实现、原红灯和摘要位于 `/Users/coso/Documents/dev/ai/limecloud/limecore/docs/exec-plans/codex-plugin-manifest-directory.md` 及相邻 artifact 账本。Lime manifest selector 已从源码确认拒绝对应非普通路径，本轮没有新增客户端插件运行证据。current 为原 scanner 链，错误回落已直接替换，无 compat/deprecated、迁移或新 store；root 确认 owner/依赖方向不变，Rust 84 项冻结集与并行 GUI 写集未改动。

- Core 本片后续因隐式目录重新打开：Codex `plugin_bundle_archive::unpack_plugin_bundle_tar` 对普通文件父路径及目录条目调用 `create_dir_all`，因此没有独立 TypeDir header 的祖先仍为目录；前一版 Core 只保留显式 TypeDir，遗漏此分支。新增四格式 × 子文件/子目录 × 发布/分享 **16 场景**（总 38），正在未改生产逻辑的基线上取 red。后续沿 Core 既有祖先冲突检查循环保留目录 identity，不另建 scanner/index。此前 22 场景与标准门禁只绑定已归档 revision 1；扩展范围 revision 2 当前未验证，不沿用 4/4 或宣称整个 tar.gz 已对齐。Rust 冻结源码不受影响。

- Core revision 2 已取得真实 red：原 22 项仍通过，新 16 项失败，分为 **12 项错误接受、4 项 Cursor 缺失诊断错误**。修复在原祖先冲突检查循环中复用 `isPluginManifestPath` 保留四种候选的隐式目录事实；没有扩大 generic metadata 语义、无额外扫描/store/迁移。扩展定向 **38/38** 与顶层 **21/21** 已通过，七项 Core 源码无漂移；标准 Go/contracts 正在复验，本片暂为 **2/4（50%）**。实际客户端新归档、真实 Core/MySQL 发布到 Turn 和全插件清理仍开放。

- revision 5 恢复 owner 已终态 exit 0：匹配 **36/36**，其中新 sampling 分界合同 **3/3**；原 snapshot、工具历史、边界、输入与模型切换恢复回归同时通过。84 项冻结核心无漂移，原日志与摘要已归档。完整七阶段回归已启动，首项公共 JSON-RPC 冷恢复尚待结果，核心维持 **2/4（50%）**，不以 owner unit 替代公共或产品证据。

- L01 下一片普通 final 已补独立公共回归准备：窄写集仅新 `app-server/tests/turn_final_completion_jsonrpc.rs` 与相邻 `provider.rs`，共八项四协议×空/仅推理正常完成，核对采样次数、单一 canonical Turn 终态、冷恢复不重写 EventLog 和下一请求推理历史。只有 loopback HTTP/SSE 与 fake key，不访问 live provider；目前仅完成格式检查，**未编译、未执行、不计通过**。准备账本见 `artifacts/codex-final-completion-20261019/validation.json`；当前 revision 5 的 84 项源码保持冻结，先收恢复验证再运行新 red，不把 interrupted incomplete、Stop 或完整 phase 夹进同一语义改动。架构正文两处“按 grok 对齐/语义按 grok”旧规范同步为 Codex 主对标、grok 仅参考多模型机制，未改 provider 行为。

- Core revision 2 最终通过：隐式/显式目录场景 **38/38**、定向顶层 **21/21**；标准 `make verify-contracts` 与 `GOMAXPROCS=1 make verify-go` 均 exit 0，覆盖 10 模块 vet/test、27 个带测试包。七项冻结源码无漂移，本片 **4/4（100%）** 仅代表 manifest 路径 identity。日志及 SHA 归档于 Core 对应 artifact；无 compat/deprecated、迁移或新 store。客户端执行这批新归档、真实 Core/MySQL 到 Turn 与完整插件/tar.gz 继续开放。

- L01 revision 5 公共冷恢复最终 **1/1** 通过：同 Turn 两次 sampling、精确 transcript、一次 terminal 与冷恢复后的两个 assistant envelope 均成立。原红灯与本次 green 分别归档；84 项核心源码无漂移。核心进度 **3/4（75%）**，完整 owner/消费者/四协议/stdio 回归仍运行，fresh 产品验收尚未启动；不据该公共夹具宣称 Desktop/CLI/TUI 或整个 L01 完成。

### C02 / tool history receipt（2026-10-19，核心完成，合并产品验收待运行）

- 主对标固定为 Codex：CLI/runtime 直接读源码，Desktop 使用 REA；grok 仅参考多模型控制面。本片是 annotated history / prefix commit 的持久化前置，不能核销 C02 或宣称同 Turn 自动压缩已接入。
- Verification Contract：负责人 root；budget:normal；P1。窄写集为 `agent-runtime/tool_history.rs` 及两个 provider-turn 测试、`agent/current_provider_turn/tool_history.rs`、App Server `event_sink.rs` / `turn_execution.rs` 的 receipt 类型与 `turn_execution/tool_history.rs`、相邻测试、本计划和 architecture 对应段。既有 runtime 文件继承本进程前片写集；GUI/Electron/command/TUI/provider wire 保持只读。
- Source evidence：Codex `hook_runtime.rs::record_pending_input` 记录工具输出并确保 rollout materialized；`session/mod.rs::record_prepared_conversation_items` 让同一 annotated item 进入 history/rollout。Lime 沿现有 EventLog 返回实际 event identity/sequence；这是 Lime 接线选择，不声称上游有相同 ACK API。
- Current 链：现有 `turn/start` → RuntimeCore → provider loop → ordered host channel → session channel → AppendingRuntimeEventSink → 同一 EventLog；read model/公开 Item/notification 仍由既有 projection 管理，无新 RPC/schema、权限、工具、网络或 store。GUI 不增加文案或交互。
- Happy / failure：成功 ACK 必须关联实际追加的工具历史记录；终态导致空 append、写盘失败、缺失 durable owner、channel 关闭均不能确认成功。下一步工具执行/采样继续受既有 ACK barrier 约束，失败禁止 reroute。显式 fixture backend 只证明公共协议/持久化接线，不冒充真实模型或真实工具执行。
- 核心退出分母 4 项：①复现终态空 append 被错误 ACK；②receipt 保留实际 EventLog identity/sequence 并穿过两个 channel，缺失 identity 失败；③公共 JSON-RPC 与冷恢复仍精确消费同一模型工具记录；④相关失败/四协议回归、架构与证据落库。
- Evidence：deterministic-smoke / runtime-transcript 必需；gui-trace 使用 existing current fixture 和 shell smoke 单独记账；release-artifact 不需要（无发布变更）。先跑定向 Rust/公共 RPC，之后完整受影响压缩集成、contracts、scoped fmt/diff/docs 与产品门禁。未验证的 live、Windows、Azure/Vertex、CLI/TUI PTY 和全仓门禁不纳入完成口径；不使用 supervisor / LLM judge。
- 架构影响：既有敏感边界的 ACK 从空确认改为实际记录 receipt，无 owner/存储/依赖方向变化；实现后更新 architecture 对应图，由 root 确认。完整 input provenance、模型历史 generation/prefix、压缩失败不推进窗口等仍是下一片明确退出义务。
- 独立账本：`artifacts/codex-history-receipt-20261019/validation.json`；原始失败、测试作者错误与产品失败分别记录。
- 已复现真实红灯：Completed Turn 未增加 EventLog 记录，`persist_tool_history` 却返回 `Ok(())`（1 failed）。current 实现改为返回实际 `HistoryReceipt(event_id, sequence)`，两个 channel 原样传递；无 EventLog writer、空追加与写盘失败拒绝 ACK。提取 App Server 测试到独立模块，root 不堆新业务。contracts 已 exit 0；修正后 App Server owner **5/5** 通过，跨 channel / RPC / 产品门禁仍待验证。一次 standalone runtime 编译遇到 libc `.rmeta` 缓存缺失，尚未运行测试，作为基础设施失败单列；随后以 App Server 依赖图继续验证。
- 下一片只读定位已落在 `next-input-source-audit.json`：steer 的 input commit 仍不携带 source receipt；mailbox 有 `message_id/source_turn_id`，但转成模型消息后只剩 XML 文本；loader 已同时持有 delivery events 和 consumed messages，可按明确 identity 接线，禁止解析正文回推。工具前 drain、输出 ACK 后才进入 live history 的 pending 输入必须保留实际 admission order。后续 generalized owner 应直接替换 narrow tools-only record 链，不能另建 store 或以最新序号替代 annotated prefix。当前 green 编译遇到并行构建/内存换页而耗时较长，未完成验证仍保持开放。
- 输入来源审计补齐 `thread_inject_items`、`thread_guardian` 和 async-hook producer：raw/批准入口先持久化再尝试当前 Turn 投递，但队列值丢失 source identity；async hook 通过 developer input 注入。下一片须覆盖初始/steer、raw、精确批准、hook、mailbox 以及取消/冷恢复时已接受但尚未进入模型历史的输入。Codex `input_queue.rs::response_item_serde_preserves_legacy_shape_and_rejects_metadata` 明确拒绝把 host annotation 经 TurnInput 序列化，并忽略外部伪造的 `client_authored` / `harness_authored_configuration`；Lime provenance 同样只能由可信 owner 赋值，不解析 raw item 或 XML 来获得授权/来源。此为源码义务，尚未实现 generalized input history。
- owner 首次运行 **3 passed / 2 failed**：原产品红灯、无 writer、无 owner 已通过；另外两项是测试作者错误（尚未创建的按需 EventLog 目录、payload 自动附加的 session metadata）。测试已改为先真实 persist 再制造写盘失败，并完整反序列化比较 typed record；生产实现未因这两项失败改变。修正后 owner **5/5**，0 failed/ignored，通过日志 `owner-final.log` 已归档；顺序回归 runner 继续跨 channel / RPC / 四协议验证，不将编译进展计为通过。
- 按用户最新要求同步根 `AGENTS.md`、`overview.md`、`governance.md` 与架构导航，删除“model control 服从 grok-build / primary reference”的规则表述：Codex 是唯一主对标；grok 仅提供多模型机制参考，Lime 保留多模型、多协议。未改动现有 provider 或并行 GUI 实现。
- 新增只读上游依据：`history/src/lib.rs::ResponseItemEnvelope` 把工具预算、来源和输入接受顺序放在 history-only metadata；`session/async_compaction.rs` 的 speculative 分支受 remote V2 gate 限制，不能推广成 Lime 所有协议的前提。`session/tests.rs::settings_checkpoint_waits_for_accepted_settings_persistence` 用确定性 pending barrier 验证 settings checkpoint；`compaction_persists_resume_metadata_and_companion_records` 验证摘要 snapshot 后 goal edit、同批伴随记录和 rollback attribution。源码中 live replacement 在 rollout persistence 之前发生；Lime 的 EventLog 失败不得成功 ACK 是本地事务合同，不能误写为 Codex 的相同持久化实现。上述上游测试只读，未在本机执行。
- L01 补充源码差异：Lime `reply_loop.rs` / `provider_turn.rs` 当前对 empty/reasoning-only 正常完成重采样两次，源自 grok 参考；Codex `session/turn.rs` 的 sampling 以 `needs_follow_up=false` 开始，工具/preempt/`end_turn=false` 等信号设置 continuation，正常 Completed 返回该信号，外层再合并 pending input 并运行 Stop。未观察到这条普通完成链以“无可见文本”触发固定两次重采样；stream-error retry 是另一条链。该差异继续挂 L01，不能沿用“按 grok 已对齐”或旧 forbidden 断言核销；本片不改冻结源码，四协议终态/显式 continuation/Stop 语义后续一起验收。源码审计不等于已运行上游或 Lime 新行为。
- receipt 跨 channel 回归已终态：agent-runtime 工具历史 **6/6**、lime-agent host **2/2**、调用链 **4/4**；同批 App Server **5/5** 与 owner-final 重复，不累计。公共 JSON-RPC **1/1** 已通过：两组 call/output receipt 与实际 EventLog identity/sequence 精确对应，相同输出保留独立 identity、预算 17 跨冷恢复保持，resume 不重写 EventLog、下一 Turn 精确恢复模型记录。该测试使用显式 backend，不执行真实 provider 或工具。完整四协议压缩回归正在执行，fresh 产品门禁仍未开始，不标核心第四项完成。
- 最终冻结基线完整 `thread_compact_jsonrpc` **35/35** 已通过（含两项真实 stdio、四协议 route/credential、失败/取消、冷恢复/fork/摘要与工具历史）；runner exit 0、74 项核心和 Codex 4 项参考源码均无漂移，原日志及 summary/SHA 已归档。本片四项核心合同 **4/4（100%）**，不等于 C02 或总体完成。产品门禁按上述调度与 L01 修复共用最终版本，尚未执行；旧 35 项结果仅绑定本片冻结基线，不作为 L01 新版本证据。current 为同一工具历史/EventLog receipt 链；空成功 ACK 为 dead/deleted，没有新增 compat/deprecated、迁移、RPC 或 store。

### C02 / steer durable admission（2026-10-19，核心完成，产品阻塞）

- 主目标：继续 Codex Context / Agent Loop 对齐，先关闭 actor 已消费、EventLog 未持久的 steer 输入竞态；同 Turn 自动压缩、完整 annotated history 仍单独开放。Codex 是主对标，grok 仅参考多模型。
- 负责人 root；budget:normal；P1。窄写集：`agent-runtime/src/session_loop.rs`、`session_loop/{actor,handle,input_queue}.rs` 及相邻 input commit 子模块/测试；`app-server/src/runtime/turn_execution.rs` 的两个 steer 入口及新 `turn_execution/input_commit.rs`；`runtime/tests.rs` 与专用 `runtime/tests/input_commit.rs`；本计划与 architecture 对应段。既有脏 runtime 文件为上一片本进程写集；避让 GUI、Electron、command、TUI、provider wire 和其它未知产物。上一片 runner 结束前不改其冻结源码。
- Source evidence：Codex HEAD `8c076942cb70fba8e5c4732c23f1faabc4aed484`，`session/turn.rs::run_hooks_and_record_inputs` 在 step 前调用 `hook_runtime::record_pending_input`，工具输入仍保留 durable barrier；`session/mod.rs::record_prepared_conversation_items` 统一 annotated history/rollout。本片借鉴其接纳顺序，在 Lime 既有 actor + EventLog 中实现；不声称 Codex 有相同回调 API，不新增 Desktop REA 结论。
- Current 主链：现有 GUI/CLI/TUI gateway → App Server `turn/steer` 或内部 active `turn/start` → RuntimeCore → actor 验证 active turn → turn-input guard 内 durable commit → pending queue → provider step；同一 EventLog 投影 canonical Thread/Turn/Item。Host、public schema 和网关签名不变，无新工具/审批/权限、artifact store 或兼容层；界面继续消费既有 Item 通知。
- Happy / failure：同一 canonical Turn 的输入 commit 后才能消费；active id 不匹配或 finishing 时不执行 commit；写入失败不入队、不唤醒 mailbox；相同文本的独立输入仍各自保留。失败停在 admission，不能以模型已执行的输入回报失败。并发 start 的已创建候选不应误 steer 进另一个 actor Turn。
- 冻结核心退出分母 5 项：①公开 steer 写入失败后队列为空；②内部 active-start 同样 fail closed；③queue guard 的确定性 barrier 证明 commit 完成前不消费，失败/finishing/错 id 不污染队列；④成功事件与消费者输入共享 actor 确认的 Turn，重复文本不去重；⑤相关 actor/RPC/恢复回归通过，架构和实际证据落库。
- 验证：先在现有 API 补可复现失败回归，再定向 Rust；补 public JSON-RPC 成功/拒绝/冷恢复，contracts、scoped fmt/diff/docs；随后按质量规则跑 current fixture / GUI smoke，保留实际失败和未执行范围。deterministic-smoke、runtime-transcript 必需；gui-trace 使用现有产品门禁单独分级；release-artifact、live、Windows、CLI/TUI PTY 与全仓 verify:local 不作为本片完成声明。无 supervisor / LLM judge。
- 结构退出：`turn_execution.rs` 已 3055 行，本片只移出两个 steer 入口并接线，不在 root 堆业务；`input_queue.rs` 已 872 行，commit 逻辑进入相邻专用模块。无依赖/schema/锁文件变更。实现前后保存窄写集摘要，发现非本人变化停写。
- 回写：失败写入专用 Rust/RPC 回归；独立账本 `artifacts/codex-steer-admission-20261019/validation.json`。架构影响是输入接纳顺序和持久化 barrier，完成前更新 architecture 图并由 root 确认。该 5 项合同不代表生产 inline compaction、C02 或总体完成。

- 首轮测试编译暴露夹具对 legacy `AgentInput` / `EventLogRecord` 的类型用法错误，已修正，不能计为产品红灯。随后当前 production 基线的两个写失败回归均实际泄露 `User(uncommitted)`；成功回归初次把 canonical 三条生命周期当三次输入，已限定 `message.created`，不计产品缺陷。
- 实施：actor 将 App Server commit 置于 turn-input guard 内，失败不入队、不 reopen mailbox；公开 steer 与内部 active-start 共用 receipt owner。两个入口和辅助函数从 3055 行 root 移入 `turn_execution/input_commit.rs`，root 减少业务；canonical 新 Turn 改为已有 StartTask operation，阻止候选输入隐式交给另一个 active Turn。确定性 actor barrier **3/3** 已通过（同步 commit 暂停时消费/finishing 均 pending；成功、失败与错 id/finishing 各守边界）。这不是 inline summary 的完成证据。

- 后续源码定位：Codex `context_manager/history.rs` 的 `history_version` 只在 rewrite 时推进，正常 append 保留 generation；`record_annotated_items` 把同一 envelope 的 retained source 和每条工具输出 budget 交给 live history 与 rollout，不能用“每次 append 都增 generation”替代。Lime 本片仅 durable admission，`Vec<CurrentProviderMessage>` 仍缺逐条 source/order，tool receipt 仍无 sequence；下一刀须在既有 EventLog/current model history owner 直接统一 annotation/admission，再做保留 suffix 的 prefix commit。禁止以最新 EventLog watermark、文本去重或提前 rollover 充当模型历史覆盖边界。详细观测/推断分开记录于 `codex-steer-admission-20261019/next-history-source-audit.json`，对应并发/summary 运行合同仍未实测。

- 修复后 App Server 写失败/成功定向 **3/3**；完整 actor 相关 **41/41**（包含新增 barrier 3 项）通过。公共 JSON-RPC **1/1** 通过，含错 target、真实写入失败拒绝、同文本两次各自 Item、取消后冷恢复与下一 Turn 精确 `initial + equal + equal` history，EventLog 不重写。RPC 初次仅因测试假设少了 canonical `item_` 前缀而失败，现改核对公开 client identity/内容/非空 Item ID；未改生产 ID。
- contracts 最终 exit 0，scoped fmt/diff/docs 通过；全套本片 owner + 相关 session/queue/terminal 回归和 fresh 产品门禁继续。一次排队后的 Cargo 构建因外部 V8 缓存消失而中断，已用任务独立缓存及仓库 SHA 校验 helper 恢复；无依赖/锁文件或系统环境改动，原日志保留，不计产品失败。核心当前 4/5（80%），第五项尚待最终回归终态；生产 inline summary / C02 / 总体继续开放。

- 最终窄 owner **4/4**（包含候选跨 Turn 隔离）、queue 过滤 **18/18**、session operations **15/15**、turn lifecycle **30/30** 通过。此前 actor **41/41** 和公共 RPC **1/1** 仍有效，不重复累计其中 input-commit tests。core 合同 **5/5（100%）**；生产 inline compaction 与 C02 保持 partial。source/core 72 项和 Codex 参考无漂移。
- fresh 产品第一尝试在场景前被正常 freshness 拒绝：长 sidecar build 期间，并行 GUI 更新 `WorkspaceDirectoryTree.tsx`，renderer 变 stale，host/sidecar 已 ready。原失败已归档，不算产品场景失败或通过；下一尝试正常重建 renderer，不绕过 readiness，不修改并行 GUI。

- 产品第二次尝试正常重建 renderer 后三段 ready，冻结 sidecar `lime-steer-admission-sidecar-44CJdZ/app-server`，SHA `70ee60e621690fb63c4815f2c6b5ae2bc3c4932d84a9f25b66badc4adfc0745f`。stdio 首次 5 秒 initialize timeout；相同 binary、未改 5 秒预算重跑通过（unavailable/backend 初始化和 thread fail-closed），首次失败原因未定位并保留。Agent aggregate 前三个 Electron 场景通过，Coding Workbench 在 `open-workbench` 再次报“点击工作台后未出现工作台内容”，本次 identity `01a15192-df44-7552-9c20-f6962e39187e`，后续聚合场景未执行；没有放宽断言/超时或改写 GUI。独立 GUI smoke 继续，产品整体不可标通过。此次失败 summary 原文已归档，不能沿用上一轮结果。

- 产品最终终态：首次 stdio exit 1（初始化 5 秒超时，原因未定位）；同 binary/同 timeout 单独重跑 exit 0；Agent aggregate exit 1（上述 Workbench，后续未执行）；独立 shell smoke exit 0，本次真实 summary **24/24 Gate B-F**。shell 证明 Electron 启动/重载、preload/IPC、App Server 初始化、设置与三尺寸布局，不证明 provider Turn、完整 Desktop identity、live 或像素一致性；不拿上一轮 24/24 充数。runner 最终 exit 1，所有 stage 均已结束，无遗留运行器。
- 结束核验：核心 72 项、Codex 4 项参考源码与固定 binary SHA 无漂移；所有产品日志/summary、独立 stdio 重跑、回归及失败启动器已归档附 SHA。current：durable steer admission、receipt、StartTask identity 和定向恢复合同；compat/deprecated/dead-deleted 本片均无新增。结构：原 3055 行 root 收至 2813，两个入口由 291 行 `turn_execution/input_commit.rs` 承接，专用测试分离；input commit 逻辑 39 行，不向 868 行 input_queue root 堆业务。架构图和 owner/数据流已由 root 于 2026-10-19 确认。core **5/5（100%）**，产品 **blocked**，C02/总体继续 partial/active，总体分母未冻结不报虚假百分比。
- 未验证：全仓 verify:local、CLI/TUI PTY、Windows、live、Azure/Vertex 和发布包；本片证据不足以覆盖这些范围。下一刀回到 Codex annotated model-history owner/source/order/receipt 和 generation-checked prefix replacement，再接同 Turn 自动压缩；grok 继续仅作为多模型控制面参考。Workbench 与首次 stdio 超时保留独立阻塞，不修改并行 GUI 写集。

### L01 / 普通 final 完成语义（2026-10-19，已原位替换，验证中）

- 主对标：Codex `session/turn.rs::try_run_sampling_request` 以 `Completed.end_turn` 和工具结果标记 follow-up；外层再检查 pending input/Stop。无可见文本不单独触发续跑。源码与 SHA 见 `artifacts/codex-final-completion-20261019/validation.json`；grok 不定义该 Loop 合同。
- Verification Contract：root；current owner 为共享 `agent-runtime::provider_turn` 与现有 `reply_loop`，输入仍是规范 provider events，输出为原 Turn 的一次 terminal；四协议 adapter、权限、工具与持久化 owner 不变。普通空/仅推理 final 结束，显式 follow-up/工具/pending input 继续；错误、length、transport EOF 和取消不改作正常完成。
- 窄写集：现有 provider Turn/Loop、三个原测试位置迁入 `tests/final_completion.rs`、`tests/context_history.rs` 改验显式续跑、公共四协议夹具两文件、architecture 对应两段与本计划。五项实现/测试已逐项核对 before/candidate SHA 后应用，两段架构描述只做 literal 替换；连同前置核心及公共测试冻结为 **88 项**，避让 GUI/Electron。
- 八项公共夹具使用 loopback HTTP/SSE 与 fake key：四协议 × empty/reasoning-only；验证一次请求、route/auth、单一 Turn terminal、精确 usage/输出计数、冷恢复不改 EventLog 和下一请求的推理历史。已编译并取得真实行为 red：**0/8**，八项均为预期 1 次采样、实际 2 次；没有 fixture 解析或超时失败。cold/usage 断言在首个采样计数失败后尚未执行；不作为 live、stdio、Electron 或 PTY 证据。
- 退出合同四项：①未改生产逻辑下取得行为 red；②原位删除 empty retry 枚举/预算/状态/快照分支及重复计数器，并直接迁移旧正向断言；③四协议、工具结果、提醒/快照、取消与完整受影响 owner/公共恢复回归；④架构文档、分类与 fresh 产品门禁逐项归档。当前 **2/4（50%）**，生产已替换并取得 34 项 final 过滤 owner green，公共/完整/产品仍待验；普通 final 与 interrupted incomplete/Stop/完整 phase 分片处理。
- 结构退出条件：超长 `provider_turn.rs` 与测试 root 只做删除及迁移，新增行为测试独立成小模块；无新 RPC/schema、依赖、迁移、compat flag 或第二 runtime。架构 owner/依赖方向保持，由 root 实施后复核并确认。

- continuation revision 5 完整 owner 首次终态 exit 101：Agent Runtime **244/244**、App Server **1991/1994**；失败为两项历史导入性能预算和工具确认超时（零 provider request / attempts=0），原因尚未确认。保留原日志、两个预算原值和一次文件系统采样，不放宽断言。剩余 model-provider/runtime-core、消费者、公共压缩/receipt/steer 正在独立补跑，三个失败按原断言单独复核；产品仍在正常 fresh 构建。核心继续 **3/4**，不宣称整组通过。
- 原四 crate 加 `--no-fail-fast` 复核已终态：Agent Runtime **244/244**、App Server **1992/1994**、model-provider **275/275**、runtime-core **69/69**。两个历史导入仍失败：1200 commands 耗时 **38.305266792s** 超出原 30s，后台多 Turn 超出原 60s；工具确认本次通过，但仍按原断言独立复核。完整原日志已归档 `full-owners-recheck.log`；消费者、公共回归和产品门禁尚在执行，不能预记通过。
- 调度转入最终源码：旧产品正常完成构建后，freshness 拒绝 renderer/Host 的并行 `dialog.ts/dialogOptions.ts` 新改动，sidecar 新鲜；三项产品场景均未执行。失败日志/summary 已归档，不绕过 readiness。旧 consumer 构建与 corpus 等锁队列已由 root 精确结束本进程子树，exit 143、未执行测试；公共/消费者/媒体与原三个失败的独立复核全部保留，改在本片最终源码执行。该调整由新生产版本触发，原四 owner 失败不抹除、不降低覆盖或预算。fresh 产品门禁延后至相关 Loop 源码稳定后统一运行，未通过前本片不标完成。
- 分类：current 为原共享 Turn/Loop、每步 snapshot、四协议完成信号与 durable usage/history；empty retry 枚举/常量/状态、重试快照/assistant 回退分支和重复 counter 已 dead/deleted；compat/deprecated 无新增。provider root **2157→2085**，测试 root **4593→4326**，completion 测试独立 224 行。root 已确认原 owner/依赖方向与架构图，没有新增 store、RPC、依赖或第二 runtime。共享 tar.gz 75 包的独立验证跟踪在插件计划，不据其结果核销 L01。

- 当前最终源码回归已启动（session **9155**）：12 阶段保留原四 owner、四协议 final/continuation、consumer/media、压缩/receipt/steer 及原预算独立复核；每阶段前后核对 88 项核心 SHA，并核对共享 corpus 两仓各五项源码/index 和全部 75 包。runner 语法、七项 Rust 格式及窄 diff 已通过，首阶段 final 过滤 owner 已实际通过 **34/34**（8+23+3；runtime-core 本过滤为 0 项），共享 corpus 阶段继续；公共/完整结果待验。产品 runner 尚未启动，保留上述延期与未通过限制。

- 本轮中间结果：75 包共享 corpus 通过、公共显式 continuation/冷恢复通过；普通 final 公共 **7/8**，完整四 owner **2580/2581**。两个失败的原始日志已归档到 final-completion 账本，剩余 consumer/media/公共恢复与原预算复核继续，不停在途构建。公共失败发生在最后的 Responses delta 明文回传断言；owner 失败发生在旧工具输出夹具的第三次采样计数，截断/生命周期断言尚未触达。
- 校准直接依据 Codex `sse/responses.rs:354–357,397–405`、`stream_events_utils.rs:93–105,315–395` 与 `protocol/models.rs:1095–1107`：推理 delta 用于展示，完成的 `output_item.done` 才把含 summary/content/encrypted_content 的原始 item 放入会话历史。不能把 delta 伪造为 Responses reasoning envelope。准备纠正公共夹具：补真实 added，明确仅 delta 不生成可回传 item；其它协议仍保留各自推理回传断言。完整已完成 reasoning/raw envelope 接线继续为 L01 开放项，不能据此负向断言核销。
- 工具输出夹具将把第二步普通 Stop 改为显式 follow-up，并将名称中的旧 retry 迁出；保留三次请求、九组截断预算、原始 lifecycle 输出与重复结果检查。三项候选只在临时目录，待 88 项冻结回归终态后应用、复核摘要并重新运行受影响 target；没有恢复 empty retry、降低预算或删去失败证据。当前仍 **2/4（50%）**，产品未验。

### L01 / interrupted incomplete（2026-10-19，核心回归通过，产品待验）

- 直接读 Codex Responses reducer 419–475：只有 incomplete_details.reason=interrupted 转为 Completed.end_turn=false，覆盖响应中相反的值；content_filter 和其它 incomplete 保留独立错误，后者携带 response identity/usage。session/turn.rs 即使取消也先保存该错误已报告的 spending，不把它更新为正常 context baseline。来源 SHA 与范围见 [source-audit.json](artifacts/codex-interrupted-completion-20261019/source-audit.json)；grok 不参与本项语义定义。
- 已在临时目录准备现有公共 continuation 合同的 interrupted 变体，首个响应改为 response.incomplete/interrupted 且 end_turn=true，验证同 Turn 两次采样、两个精确 usage envelope、单 terminal、原请求完整保留与冷恢复两段历史。两项公共测试已应用且格式检查通过，已编译并取得公共 red **0/1**：Turn 被错误报为 transport EOF/failed；生产及六项 owner/transport 测试候选仍在临时目录，当前 88 项冻结源码与 corpus 不变。
- 为并行取得下一片行为证据，已核对摘要后仅应用两项独立新公共测试文件；它们不参与本轮 --lib 或既有指定 integration target，不改 88 项冻结生产/测试源码，不停止在途构建。先用独立 target 取得真实 red；仍须收当前最终源码完整回归后才允许修改 current reducer/owner。四项退出分母为：①公共行为 red；②interrupted 归一与 owner；③同 Turn/冷恢复及相关回归；④架构与分级产品证据。当前 **1/4（25%）**。非 interrupted 的 typed error/accounting、完整 phase/raw envelope、Stop/H01 分别开放，不以这份准备核销。
- 独立公共 red 已启动，session **76028**；沿既有 V8 resolver/cache 与 Cargo -j1 排队，不新建 target cache、不停原构建，也未降低断言/预算。已终态 exit 101，公共行为 **0 passed / 1 failed**，断言实际 failed/预期 completed，错误为 stream closed before response.completed；后续采样次数/usage/cold 断言尚未触达。原日志已归档，不计 fixture/编译/超时失败。
- 后续真实源码校准：Codex 仅从 output_item.done 调度工具，Completed 只提供续跑/用量。临时候选增加第 5 项 owner 回归：普通/custom 参数 done 但 item 尚未 done 时，中断输出数组也不能触发执行；已 done 的工具不重复发射。候选仅复用 accounting/输出块关闭，output-array/buffered-call fallback 保留在普通 completed 分支。未改冻结生产源码，也未取得该候选的编译/green。

### L02 / 生产 Stop Loop 源码复核（2026-10-19，只读）

- 证据及源码 SHA 见 [stop-loop-source-audit.json](artifacts/codex-history-receipt-20261019/stop-loop-source-audit.json)。Codex 在工具与 pending input 无续跑需求后，使用当前 StepContext 执行 Stop；全部有序 block fragments 持久化为 user-role HookPrompt，设置 `stop_hook_active` 后继续同一 Turn。stop 优先于 block；MemoryConsolidation 拒绝递归续跑。
- Lime 当前 Hook snapshot 只接工具 gate；最终响应未调 Stop。现有 generic `blocking_reason()` 只取首项，不足以代替 Stop 的完整聚合；`forked_from_thread_id` 也不能代替 typed ThreadSpawn/internal 来源。下一片先沿 App Server 追踪来源、transcript 和 durable HookPrompt owner，再接 snapshot/取消/失败，不猜字段、不重建第二 store。本次无生产改动或新增运行证据，L02/H01 仍开放。
- 来源追踪已补：canonical Thread 的 `parent_thread_id/agent_role` 来自持久 spawn edge/agent identity，与普通 `forked_from_id` 独立；Turn admission 目前只捕获后者。public `ThreadSource` 是分析分类，`SessionSource` 是 host 来源，均不能单独替代 lifecycle source。canonical transcript 路径另存在 `canonical_threads.rollout_path`，不能直接信任客户端 metadata 的 path 别名。后续沿 current repository 捕获来源和路径，不另建身份表。

- durable HookPrompt 接线复核：当前 hook_snapshot::apply 只把捕获快照交给工具门控，Stop 必须保留同一 snapshot/reporter，不能在响应后重抓。现有 ToolHistoryRecord 只接受 assistant call/tool output，不能冒充 user-role HookPrompt；后续应直接把同一 ordered host channel/实际 HistoryReceipt owner 泛化为 annotated model history，供 C02 和 Stop 共用，不另建日志或旁路 ACK。完整观测与窄搜索范围见 stop-loop 审计 durablePromptFollowUp；本次只读，未计生产完成项。

### M01 / Memory 状态 schema 复核（2026-10-19，只读）

- 等待在途构建期间，M01 的现有 [Memory owner 审计](artifacts/codex-history-receipt-20261019/memory-owner-source-audit.json) 已补 schema 事实：当前 projection/canonical schema 没有 Memory claim/lease/output 表；Codex 使用独立 memory DB 保存 outputs、job ownership、lease、输入/成功 watermark 和 consolidation readiness。尚未决定或修改 Lime DB 路径；下一片先核对独立 DB 与 current App Server state/删除边界，不把 UI sequence 或可删除 index 当模型提取水位，也不回用 legacy core agent 表。此为只读定位，不计 M01 实现进度。

- M01 删除/文件边界补查：StorageRoots 已统一提供显式 AgentRoot/sqlite_root，MemoryBackend 使用同一注入根；新 durable Memory 路径应在此 owner 扩展，不能落可删除 index 或凭 parent/home 推断。Codex 在删 canonical Thread/spawn graph 前清理所有已存在版本的提取 job/output，失败保留重试图；已选 phase2 输出删除还会触发重整合。reset、Thread 删除、scope 禁用及过期 worker 不得复活输出将随 M01 生产流水线共同验收。详见 memory-owner 审计 filesystemAndDeleteFollowUp；本次只读，无 schema/生产实现，也未增加完成项。

- M01 模型请求补查：Codex phase1 使用显式 extract_model 或 provider.memory_extraction_preferred_model，再经 ModelsManager/同 provider ModelClient 取能力与认证；不能给 Lime 所有 provider 填一个模型名。当前导出流程写入 workspace Markdown candidate 只属显式 export，并非模型提取。phase1 的版本化严格输出契约、idle/source/lease claim 和有界并发已记录到 memory-owner 审计 modelPipelineFollowUp，实际版本须由 current config/readiness 定义。grok 只参考 catalog/readiness/default，不能定义 Memory 生命周期；本次只读，不核销 M01。

- C02/Stop 后续共同前置补查见 [model-history-source-audit.json](artifacts/codex-history-receipt-20261019/model-history-source-audit.json)：Codex `ResponseItemEnvelope` 分离原始 item 与 host metadata，record/replay 保持来源身份、输入顺序和历史截断预算；public retain 注解与内部来源分开。Lime 当前 durable receipt owner 仍只接受工具记录，21 个 Rust 消费者须在同一替换中迁移，不能另建 append store。Responses completed reasoning/raw item、phase 和原始 item 次序仍有缺口；既有非 Responses raw-history 拒绝守卫继续保留。此次只读，不改生产 API/event/schema，也不计 C02/Stop 完成。
- 同一审计补记多协议限制：canonical `Reasoning` 已有 encrypted/metadata，但 current content 仍只携带文本；Anthropic stream 忽略 signature delta、lowering 未输出 signature；Gemini thought 文本流未传入已有 metadata 路径。普通 final 的文本历史 green 不能证明原生签名 reasoning 被真实 provider 接受。后续在同一 envelope owner 补请求捕获、冷恢复和协议切换回归，不新增第二套内容模型或厂商 Loop；grok 仍只参考多模型控制面。
- Responses completed reasoning 下一片见[模型历史切片计划](codex-model-history-alignment-plan.md)：独立 test/helper 不触碰冻结 final helper；实际公共回归 **0/3 red**，分别复现 encrypted include 缺失、live 和 cold 的 summary/encrypted_content/带前缀 item ID 丢失。运行 63.30s，前后 92 项当前观测源码无漂移；phase 和原始顺序断言尚未触达，无生产修复。Codex client 会移除无前缀旧 ID，故测试使用带前缀 producer ID；本片 **1/4（25%）**，不替代 L01/C02/C03 总体完成率。

- 同一 model-history 审计的 samplingRetryFollowUp 已补 Codex 同 sampling 重试边界：重建已提交历史、等待在途工具和 server retry deadline；executed_tool_calls 仅记录/附加请求元数据，不负责调度或通用去重。Lime 已有建连/HTTP status 重试，不能与可见输出后的 sampling 重试混算；后者须等 shared history owner 完整后用断流行为 red 推进。只读定位，不增加 L01 完成项。

- 运行环境重启续接（2026-10-19）：旧进程及 `/tmp` 已消失，88 项冻结源码无漂移，前八阶段原始终态日志均在仓库。仅恢复 receipt、steer、原 import 性能与工具确认四阶段；不重跑已有八阶段，也不修改 profile/预算。候选从仓库 review patch 重建并核对原 SHA；恢复后的 runner/summary/log 均进入本片 artifacts，完整结果前不应用生产候选。详见 final 账本 environmentRecovery。
- 普通 final 另补实际 CLI 验收脚本准备：复用现有 terminal-gate-binaries、loopback provider 与被动 stdio recorder，检查 Chat/Responses 空 final 的单 sampling、精确 usage、单 terminal、同 Thread/Turn identity 与冷 thread/read；仍用既有 30s/90s 预算。只有语法检查，未 build/执行，不计 CLI Gate B；其它协议、reasoning-only 与 TUI PTY 仍单独开放。
- receipt 实际回归 **1/1** 通过（66.56s），父 runner 随后因并行进程已校准 `context_history.rs` 的测试摘要漂移正确停止；没有把本轮记成 88 项全程无漂移。只读复核与候选仅差测试名/断言诊断，保留对方文件并退出写集，记录显式 test-only revision；当前只恢复 steer/import 性能/工具确认三项，随后只写两项公共夹具并复核 context_history。原日志、原摘要与差异见 final 账本 observedParallelTestCorrection/sourceRevisionAfterParallelTest。
- steer **1/1** 已通过；原 import 性能日志虽 **2/2**，阶段后 lowering 漂移使其未获接受。并行进程随后自行恢复生产文件并删除 synthetic helper，保留正负向测试；本进程没有接管或覆盖。r3 仅续跑缺失阶段，import **2/2**、工具确认 **1/1** 已实际通过；两项公共夹具校准实际通过 **2/2 + 8/8**。review-only 接管补丁已过时且未应用；接管询问不再是阻塞。原失败日志和显式测试版本保留，不改写为原冻结版本全绿。
- interrupted 已应用同一 SSE/WebSocket reducer 的源码修正与六项 owner/transport 回归，架构图及 owner 由 root 确认。首次编译因本进程准备的测试子模块路径错误而失败，实际执行测试 0 项；补显式 path 后重跑，不改生产语义、预算或断言。八阶段实际通过 **404/404**：provider **282**、公共 interrupted **1**、普通 final **8**、continuation **1**、Loop **68**、history **34**、receipt **1**、compaction **9**。92 项冻结源码前后核对通过；原编译失败单独归档。普通 final 和 interrupted 均为 **3/4（75%）**，fresh renderer/sidecar 产品构建已开始，stdio、真实 CLI、Agent fixture 与 GUI smoke 未取得终态；Windows/live/TUI 不由本链证明。
- fresh 产品链已终态：stdio 初次 5 秒 initialize 超时；认领原先干净的 `scripts/app-server/stdio-smoke.mjs`，只给子进程注入隔离 AppData，同固定 sidecar/原预算复验通过，scripts governance 通过。真实 CLI empty final **2/2**、GUI smoke **exit 0**；Agent fixture 在 Coding Workbench 入口失败，后续聚合场景未执行。四阶段及独立 stdio 复验的原日志/SHA 全部保留，未推定超时唯一根因，也未放宽工作台断言。普通 final/interrupted 仍 **3/4（75%）**、产品 blocked；GUI 并行写集只读，下一刀继续 completed model history 的多模型边界。


### L01 / reasoning 完成快照切片收尾（2026-10-19，核心通过；产品 partial）

- 主事实源仍为 Codex CLI 源码 `core/src/event_mapping.rs::parse_turn_item` 与
  `core/src/stream_events_utils.rs::handle_output_item_done`；REA 只保留 Desktop 静态 timeline
  证据，grok 只参考多模型控制面。Lime 沿既有 `provider_turn → Agent protocol →
  App Server ReasoningEventState → canonical Thread/Turn/Item → thread-store` 完成接线，
  没有新增 runtime、store、兼容迁移或 public RPC。
- 完成事件只携带安全的 summary/content 文本数组；receipt 后按 identity 替换 reasoning
  snapshot，支持无 delta、partial、空数组、空白文本、重复 end、失败/取消保留已完成
  Item、live/cold、fork/history，并过滤 `encrypted_content` 与 `producer`。嵌套 canonical
  Item 也必须显式携带 summary/content 数组才能取得 snapshot authority，bodyless completion
  保留已有 delta。
- 最终 owner/public Rust 回归 **1042/1042**，前端六个测试文件 **123/123**，
  `npm run test:contracts`、rustfmt、diff-check、docs boundary 均通过。独立 `lime exec`/
  `exec resume` 的 no-delta 与 partial fixture 均通过，使用同一固定 CLI/App Server 二进制，
  包含独立 stdio、cold `thread/read` 与 loopback Responses；证据账本为
  `artifacts/codex-reasoning-snapshot-20261019/regression-final-summary.json`。
- 分类：共享完成快照属于 `current`；HTTP/SSE loopback 与 fixture 属 `test-only`；本片无
  `compat/deprecated`，没有恢复 Lime 旧插件或第二后端。该切片核心 **4/4**，但不能替代
  L01 整体、C02/C03、Memory、Stop/harness、工具 drain 或总体验收。Desktop reasoning
  Gate B、TUI PTY、Windows、live provider 与 Workbench 旧夹具迁移仍未完成，继续保持总体
  `active / partial`。

### 2026-10-20 M01/M02 memory owner implementation slice

- **Codex source basis**：直接读取 `state/src/runtime/memories.rs` 的 stage1 claim、phase2 global lease、成功/失败 watermark；读取 `memories/write/src/start.rs`、`phase1.rs`、`phase2.rs` 的启动 gate、模型抽取、并发、heartbeat 和受限 consolidation agent；读取 `memories/read/src/citations.rs`、`usage.rs` 的 citation 与 versioned usage 规则。
- **本轮 current 写集**：`app-server/src/memory_store/state.rs` 建立唯一 `memory_state.sqlite` owner；rollout content hash/status、phase2 owner lease/expiry、failure reason 与 completion watermark 进入状态表。`memory/status` 只读状态表的 consolidated count，摘要文件和 processed rollout 是投影。并发 consolidation 没有 lease 就 fail closed；reset 清理状态表。
- **M02 接线**：`app-server/src/memory_store/citations.rs` 解析结构化或 Codex XML citation，thread item projection 填充 v2 `AgentMessage.memoryCitation`；`tool-runtime` memory read/search 输出 `memoryUsage` 的 v1/v2 与 artifact kind 分类。当前尚未把 usage feedback 持久化到 memory DB，也未把 citation/usage 接到完整 Codex read prompt pipeline。
- **验证**：`app-server-protocol` 143/143 与 schema fixture 1/1 通过；`app-server-client` 50/50 通过；本轮 Rust 定向文件 `rustfmt --edition 2021 --check` 通过。`app-server`/`tool-runtime` 编译仍被 rusty_v8 v150.4.0 macOS arm64 预编译 archive HTTP 404 阻塞，不能把未编译写成行为通过；全仓 `git diff --check` 仍受并行改动 `src/components/app-sidebar/sidebarSessions.ts` EOF 空行影响。
- **未关闭退出条件**：Codex phase1 模型抽取与 strict structured output、stage1 output snapshot、phase2 consolidation agent、heartbeat、selected-output watermark 提交、线程删除/禁用 scope 清理、持久 usage 计数、memory prompt 注入、四协议 provider capture、cold/fork recovery。

### 2026-10-20 M01 状态租约与选中快照收敛

- **Codex 对照**：直接按 `state/src/runtime/memories.rs` 的 stage-1/global phase-2 lease、heartbeat、失败 retry、no-output 删除旧 output，以及 phase-2 成功时重写 `selected_for_phase2` 集合的语义核对；本刀没有使用 grok 作为 runtime 依据。
- **Current 改动**：`app-server/src/memory_store/state.rs` 为 phase-1 与 phase-2 增加 owner heartbeat；phase-2 增加 `retry_at`、`retry_remaining`、`last_success_at`，失败保留错误并退避；stage-1 provider 失败保存 `last_error`；stage-1 no-output 清除旧 raw/summary/slug 和 phase-2 selection；phase-2 snapshot 在同一事务先清空旧 selection，再提交新 selection、watermark 和成功时间。
- **执行接线**：`memory_store/consolidation.rs` 在本地 consolidation 运行期间启动可取消 heartbeat task，提交或失败前停止 heartbeat；lease 失效时 snapshot commit 失败并保留状态，避免把未拥有的 phase-2 结果标记为成功。
- **验证**：rustfmt 与 scoped diff-check 通过；把 `state.rs` 放入最小独立 Rust harness（复用仓库已构建的 rusqlite/sha2/hex/tempfile）后，6/6 owner tests 通过，覆盖 phase-2 heartbeat owner、stage-1 no-output 清理和旧 selection 清除。随后使用仓库 `npm run test:rust:related -- ...` wrapper 完成当前 App Server 编译并运行 1947 项 lib tests，其中 **1945 通过**；Memory owner、consolidation、plugin archive 与协议相关测试均通过。剩余 2 个失败是既有 `processor::thread::projection::tests::canonical_item_metadata_does_not_cross_the_v2_boundary` 与 `runtime::read_model::tests::canonical_file_read_projects_as_file_artifact`，不触及本刀写集；未把全量命令写成通过。
- **边界**：本刀只闭合 durable lease/selection 状态，不宣称 Memory pipeline 完成。真实 phase-1 provider 调度、模型能力/预算/协议路由、phase-2 consolidation agent、线程删除/disabled scope、持久 usage feedback、prompt 注入、四协议 provider capture 与 cold/fork recovery 仍开放。

### 2026-10-20 M01 phase-1 provider sampling 与 structured-output contract

- **Codex 对照**：直接按 `memories/write/src/phase1.rs` 的 claim → build request → provider sampling → strict parse → success/no-output/failure 语义实现；grok-build 仅保留为多模型 route/readiness 参考，不参与 Memory lifecycle 或 Agent Loop 定义。
- **Canonical contract**：`runtime-core/src/llm_protocol/canonical.rs` 与 `model-provider/src/current_client.rs` 增加 provider-neutral `output_schema`/`output_schema_strict`；`agent-runtime/src/provider_turn.rs` 从 `TurnContextOverride.output_schema` 注入每个 sampling step。四类 lowering 均落到原生请求：Chat Completions `response_format.json_schema`、Responses `text.format`、Anthropic `output_config.format`、Gemini `generationConfig.responseSchema`。
- **Memory current owner**：`app-server/src/memory_store.rs` 新增 `MemoryStageOneProvider`、route-scoped request 与 `LocalMemoryBackend::run_stage1`。它读取 pending source，按 source claim durable lease，启动可取消 heartbeat，使用当前 route 的 provider/model/protocol/credential 参数调用 provider，严格解析 v1/v2 schema，原子保存 output snapshot；空输出清理旧 snapshot，解析/provider/lease 失败进入 retry/backoff。`add_note` 同步注册 stage-1 source，避免新 notes 脱离 claim 图。
- **共享后端接线**：`MemoryAppDataSource`、`ExecutionBackend`、`RuntimeCore::run_memory_stage1` 与 `RuntimeBackend` 已提供同一 App Server → RuntimeBackend → Memory state 链；RuntimeBackend 使用 `run_direct_text_generation_with_db`，不填固定 OpenAI 模型名，路由参数由调用方显式提供。
- **验证**：`model-provider` structured-output lowering 定向测试 **1/1** 通过；App Server stage-1 provider/strict parse/durable snapshot 测试 **1/1** 通过；App Server `cargo check --lib`（注入已校验的 rusty_v8 archive/binding）通过；rustfmt 与 scoped diff-check 通过。未把与本刀无关的既有 agent-runtime continuation 测试错误写成失败原因。
- **未关闭退出条件**：真实 startup/export 调度尚未自动触发 `RuntimeCore::run_memory_stage1`；route selection/readiness 仍需由调用方提供并覆盖 model switch；phase-2 必须改为受限 Codex agent/harness sampling；thread delete/disabled scope、usage feedback、prompt/cold/fork recovery、LimeCore 真实 Core/MySQL 链路与四协议 HTTP capture 仍开放。

### 2026-10-20 M01 phase-2 provider consolidation 与 L02 Stop Loop 接线

- **Codex 事实源**：Memory phase-2 直接对照 `memories/write/src/phase2.rs` 的受限 consolidation agent、source identity 校验、输出大小上限、accept/review 分支和全局 lease；Stop Loop 直接对照 `core/src/session/turn.rs:718-764` 与 `core/src/hook_runtime.rs::run_turn_stop_hooks`。grok-build 仍只用于多模型 route/readiness，不参与 Loop 或 Memory 语义。
- **Memory current owner**：`app-server/src/memory_store/consolidation.rs` 现在以当前 session provider route 调用 strict JSON consolidation harness；输入只来自 durable stage-1 snapshots，输出限制 128 KiB，单条 memory artifact 限制 9000 字符，未知/重复/缺失/symlink source 直接 fail closed。accept 归档到 `processed` 并提交 selected-source watermark，review 移到 `extensions/ad_hoc/review` 并写入 SQLite durable review 状态；phase-2 lease 有可取消 heartbeat，失效时拒绝 snapshot commit。旧本地 `classify_note`/拼接 consolidation owner 已删除。
- **L02 current 接线**：`agent-runtime/provider_turn.rs` 在每个 sampling step 保留同一 immutable Hook snapshot/reporter；只有 provider 完成、无工具 continuation、无 pending input 时才执行 Stop evaluation。Block 将带原因的 continuation prompt 追加回同一 Turn 并设置 `stop_hook_active`，Abort 结束 Turn；Hook source/reporter failure 仍 fail closed。新增 Stop block/abort 回归，provider-turn 定向测试 **76/76** 通过。
- **契约验证**：`memory_store::tests` **13/13** 通过；`npm run test:contracts` 通过（protocol 1058 类型、App Server client 296 项及 governance checks）；`cargo check -p agent-runtime` 与 Stop hook 定向测试通过。因当前 hook prompt 尚未提升为 canonical user-role `HookPrompt` Item，本片不宣称完整 durable HookPrompt 对齐。
- **失败闭环补强**：发现 duplicate source 在第二条 entry 才失败时会先移动第一条 source；现已改为先完整校验 provider proposal，再执行任何 archive/review/write，unknown/duplicate/missing/symlink/oversized/provider failure 均保持原 source 不动。新增 fail-closed 回归后 `memory_store::tests` **14/14** 通过。
- **未关闭退出条件**：Memory startup/export 自动调度、phase-2 多模型能力/readiness、usage feedback→consolidation→prompt 注入、thread delete/disabled scope/cold/fork recovery、四协议真实 provider capture、LimeCore Core/MySQL 链路；Stop 的 canonical HookPrompt durable receipt、ThreadSpawn/SubagentStop 来源、取消终态、Memory 防递归和 GUI/TUI/CLI 实证仍开放。下一刀优先把同一 history receipt owner 扩展为 HookPrompt，再补 Stop 的来源与取消语义；插件、tar.gz 和 LimeCore 范围继续保留。
### M02 / Codex HookPrompt canonical item 接线（2026-10-20）

- **事实源**：Codex `core/src/session/turn.rs` 在 Stop block 时调用 `build_hook_prompt_message`，生成 user-role response item，写入同一 Turn 后设置 `stop_hook_active` 继续；`core/src/event_mapping.rs` 与 `thread-store` 将该 XML message 解析为 `TurnItem::HookPrompt` 并恢复到 history。grok-build 不参与本项语义。
- **current owner**：`agent-protocol::ThreadItemPayload::HookPrompt` 与 `HookPromptFragment` 是唯一 canonical 类型；`agent-runtime::provider_turn` 负责 Stop evaluation、fragment identity 和同 Turn provider user lowering；`lime-agent` 负责 Item started/completed 生命周期；App Server materializer/projection、provider history 和 fork lowering 只做投影/恢复，不建立第二 store。
- **已实施**：Stop block 不再注入 Lime 专有 developer continuation 文本；按 `hook_run_id` 保留所有阻断 fragment，构造成 `<hook_prompt hook_run_id="…">…</hook_prompt>` user message；同一 Turn 发出 durable `item.started`/`item.completed`；App Server v2 `HookPrompt`、canonical item materializer、ThreadItem projection、provider history cold restart 和 fork seed 均已接线。XML 文本/属性做转义，空 run id fail closed。
- **验证**：`cargo check -p agent-runtime`、`cargo check -p app-server` 通过；agent-runtime provider-turn **81/81**；HookPrompt lowering **5/5**；provider-history HookPrompt 恢复 **1/1**；Memory **14/14** 与 `npm run test:contracts` 继续通过。曾有一次未设置 Rusty V8 本地归档的测试命中上游 404，复用本地归档后通过，不计产品失败。
- **未关闭**：ThreadSpawn/SubagentStop 的 typed source、父子 transcript path、取消终态、MemoryConsolidation Stop 防递归、startup/export 自动触发、四协议真实 provider capture、GUI/TUI/CLI 真实 Gate B、插件/tar.gz 与 LimeCore 仍开放。当前 HookPrompt receipt 由 canonical EventLog item lifecycle 承担，尚未把 Codex rollout 的独立 response-item receipt API 全量复刻。
- **下一刀**：先补 SubagentStop source/agent id/type/matcher/transcript 与取消回归，再将 HookPrompt receipt 接入同一 history owner 的 durable acknowledgement；随后处理 Memory prompt 注入闭环和插件/tar.gz/LimeCore。不会恢复旧 Lime 插件标准或兼容包装。

### L02 / typed stop target 收尾（2026-10-20）

- **Codex 事实源**：`core/src/hook_runtime.rs::run_turn_stop_hooks` 将 ThreadSpawn 子会话派发到 `SubagentStop`；synthetic subagent 不派发用户 lifecycle hook；MemoryConsolidation 使用独立 target。`hooks/src/events/stop.rs` 的 matcher 只读取 `agent_type`，而 `core/src/session/turn.rs` 在 Memory stop block 时直接结束，不能递归续跑。
- **Lime current 改动**：`RuntimeStopHookTarget` 新增 `MemoryConsolidation` 与 `Disabled`；`AgentSessionSource` 明确区分 Root、ThreadSpawn、SyntheticSubagent、MemoryConsolidation；ThreadSpawn 保留父/子 transcript path、child thread 作为 `agent_id`、空角色回退 `default`，普通 fork 仍走 `Stop`。Memory target 只接收 system/managed/unknown hook source，block 直接返回错误；Disabled fail closed 且不序列化为用户 hook。child transcript lookup 错误直接失败并回滚部分 spawn。
- **验证**：受影响文件 `rustfmt --edition 2021 --check` 与窄 `git diff --check` 通过；治理扫描仍为 2361 源码、1608 测试、0 dead-candidate、0 分类漂移、0 边界违规。Rust 定向 wrapper 曾受共享 target 并行构建破坏和 rusty_v8 macOS arm64 archive 404 阻塞，当前不能把本片写成测试 green，需在独占稳定 target 后重跑。
- **Remaining**：app-server child source cold recovery integration test、取消 terminal regression、HookPrompt durable ACK、Memory startup/export scheduling 与 prompt/usage/cold/fork 闭环、四协议 provider capture、插件/tar.gz 与 LimeCore Core/MySQL → 客户端 Turn 实证。
- **补验结果**：共享构建结束后，原定向 wrapper 通过：`agent-runtime` 5/5、`app-server` 19/19、`tool-runtime` 2/2。新增取消终态回归 1/1 通过；ThreadSpawn provider-defaults 重启恢复 1/1 通过，且验证 `agentControlSource.kind=thread_spawn`、`parentThreadId` 在冷恢复后仍存在。child transcript path 按 Codex 语义保持可选：canonical rollout 尚未落盘时允许缺失，若存在则必须为非空路径。
- **状态修正**：本片不再受 Rust 编译环境阻塞；剩余项收敛为 HookPrompt 独立 durable ACK、Memory 自动调度/usage/prompt/cold/fork、四协议真实 capture、tar.gz/LimeCore 发布到客户端 Turn，以及 GUI/TUI/CLI Gate B。
- **Memory 现状复核**：`processor/thread/lifecycle.rs` 已在 root thread start 后调用 `RuntimeCore::spawn_memory_stage1_startup`，并按同一 session route 顺序尝试 phase-1、phase-2；ephemeral、disabled、subagent/agent source 会跳过。剩余项是 provider readiness 失败后的可观测重试、usage feedback→prompt 注入以及真实 cold/fork 证据，不能把已有 spawn 接线误写成完整 Memory 闭环。

### request_user_input 取消生命周期（2026-10-20）

- **Codex 事实源**：`core/src/tools/handlers/dynamic.rs` 先发 dynamic tool `item.started`，取消等待后仍发 `item.completed`，并由 `finishes_on_cancellation()` 收束生命周期；取消不能放宽 sequence verifier。
- **Lime current 改动**：`app-server/src/runtime/turn_execution.rs` 在 `turn/interrupt` 与 action cancel 路径复核已持久化 start；并发 start 未落库时按 `item.started → item.completed` 同批提交，request_user_input action 缺少 tool item 时构造 canonical `Tool` item，取消后重新读取 pending action，避免 completion without start。
- **验证状态**：r14/r15 的原失败保留。并行类型冲突修正、sidecar 重建后，r18 真实 Electron Gate B 通过：选项＋自由文本、切线程题稿恢复、精确 Escape interrupt、无伪造空回答，正常 Main code0/signalnull，零 invoke/console/page/mock 错误。严格 verifier 保持不变。收据见 [validation-r18.json](artifacts/request-user-input-20261020/validation-r18.json)。同候选标准 GUI smoke 为 24/24；后续异步接线与当前混合树需独立结算，不能据此声明完整 GUI 完成。


### 2026-10-20 L02 HookPrompt durable receipt（active）

- 主目标继续为 Codex CLI 源码 + Desktop REA 完整对齐；grok 只参考多模型，不参与 runtime/harness/插件语义。上一片 source/cancel/cold 恢复之后，本片补 receipt-before-Item/next-sampling，详见 [执行计划](./codex-hook-prompt-receipt-alignment.md)。
- Codex `session/turn.rs`/`record_response_item_and_emit_turn_item` 证明先记录、再 Item、再同 Turn 输入续跑；Lime 新 red 回归 2/2 复现当前无 ACK/写盘拒绝仍续跑。现役 ModelHistoryRecord/EventLog 被直接扩展为 typed user input record，未新增 store/公开 RPC/兼容层。
- Stop owner 拆至 `provider_turn/stop_hooks.rs`；缺 recorder/写盘失败拒绝 Item/采样/reroute；成功后原子重开 steer/mailbox。Memory block 或 abort 均拒绝，synthetic 禁用。恢复按 turn/source identity 去重，fork 沿既有 copy owner。
- 已取得当前 owner 测试 265/265、provider-history 38/38。public JSON-RPC live/cold/fork、fragment 全量校验补验与产品门禁正在取终态；本条不得当作整体完成。REA CLI 已复核保全 timeline parent，完整返回和源码 SHA 入本片 artifacts；静态证据不证明后端提交顺序。
- 架构 32.2 已由 root 确认；Memory startup 已有真实接线，usage/prompt/retry/cold/fork、四协议 HTTP capture、GUI/CLI/TUI Gate B、插件/tar.gz/LimeCore Core/MySQL 仍开放。不恢复旧 Lime 插件，不考虑历史兼容。


L02 receipt 当前验证补记：owner 265/265、Stop补验5/5、provider-history38/38、ordered host2/2、public Stop cold/fork2/2与原工具receipt1/1均通过；fresh独立GUI smoke exit0。Agent聚合前置369项和三个Electron场景通过，Coding Workbench打开失败，后续场景未执行。本地门禁lint/typecheck通过后因MessageList旧夹具缺文本在95批失败；只读发现并行4行修正后从原批续跑，原失败与复验分账。当前implementation摘要12项未漂移，产品义务不核销，整体目标active。

下一刀固定为 [Memory consolidation Agent harness](./codex-memory-agent-harness-alignment.md)：Codex `phase2.rs`/`runtime.rs` 的受限内部Agent启动和终态/lease/artifact/ownership/watermark顺序。该后续切片现已接入同一 RuntimeCore 的内部会话、真实工具循环、native patch OS helper、关闭后 artifact/baseline 与精确快照提交，旧 phase2 direct sampling/proposal 已删除；当前为 implementation-under-validation，进度和最终源码证据以该执行计划为准。已有 typed Memory Stop 或旧前提验证均不能代替本片真实 harness 验收。无旧插件或兼容层回流。


L02最终验证补记：前端续跑95–140共46批/5497项通过，历史1–94批未重跑；原本地门禁exit1与两次失败保留，后续聚合阶段不宣称通过。独立GUI smoke和core/domain/public JSON-RPC证据通过，Agent fixture的工作台打开失败仍开放，L02 receipt切片5/6（83%），整体目标active。该条是 L02 收尾时的历史状态；后续 Memory 共享 Agent 已进入独立生产实施与验收，详见当前 Memory harness 计划。本片12项源码摘要无漂移。完整分账见 `artifacts/codex-hook-prompt-receipt-20261020/verification-summary.json`。

### 2026-10-21 H01 immutable step identity consumption

- **Codex 事实源**：直接对照 `core/src/session/turn.rs` 的“每次 sampling capture 一次 StepContext”，以及 `session/step_context.rs`、`session/world_state.rs` 对同一 settings/environment/tool/Hook 视图的约束。REA 只用于 Desktop 安装包身份取证，本刀不从打包文件名推断 runtime 语义。
- **Current 改动**：`agent-runtime/provider_turn.rs` 每次 sampling 只 capture 一次 `RuntimeSessionStepContext`，并将它传入工具与 Hook snapshot；snapshot context 不一致时在 provider request 前 fail closed。工具 function/custom call 在写入模型历史后，执行侧携带 `runtime_step_context` metadata（session/turn/step/epoch/mailbox phase），因此 tool executor、MCP/lifecycle 与 durable receipt 能关联同一 sampling 授权边界；provider wire 不携带该 Lime-local metadata。
- **验证**：`agent-runtime provider_turn` **85/85**、新增 immutable tool metadata 回归 **1/1**；`cargo check -p lime-agent -p app-server` 通过；Rusty V8 使用仓库缓存归档，未改网络或依赖。工作区存在并行 GUI/Rust 改动，未执行回滚、提交或推送。
- **状态**：H01 current executor slice 已完成，整体 H01 仍 partial。未关闭：真实 `RuntimeSessionInputHandle` 并发热更/rollover、AGENTS/extensions contributor registry 的统一 snapshot、四协议 HTTP capture、CLI/TUI/GUI Gate B、Windows/Linux/live provider 与 packaged artifact。下一刀继续 Memory harness 的 typed internal admission/终态提交，或按 P0 顺序补 C02/C03 未关闭的跨模型 history/compaction 证据；不恢复旧插件或兼容层。

### 2026-10-21 T02 context window tools 与 C02 epoch rollover

- **Codex 事实源**：直接读取 `core/src/tools/handlers/get_context_remaining.rs`、`new_context_window.rs` 与 `core/src/session/turn.rs`。预算工具必须返回当前模型窗口的真实剩余量，未知时保留 `null`；新窗口工具只请求 context rollover，由 Turn loop 在下一次 sampling 边界执行，无摘要重置且不改变环境状态。
- **Current 改动**：`lime-agent/current_provider_turn/mcp_step_snapshot.rs` 仅在可信 `lime_runtime.context_policy` 且未禁用 auto-compaction 时注册 `get_context_remaining` / `new_context`。`CurrentTurnToolExecutor` 从同一 active `RuntimeSessionInputHandle` 读取当前 epoch 的输入 token 计数；缺预算或缺 session owner 时不伪造数值。`new_context` 仅设置 typed rollover 请求，不能绕过 provider loop。`RuntimeSessionStepState` 增加 context-scoped input counter，epoch 推进时清零，turn 累计 usage 继续保留。
- **同 Turn compaction**：`maybe_compact_after_step` 成功收到 App Server replacement 后推进同一 session 的 `context_epoch`，并校验 capability receipt 的 epoch；取消、失败、空 replacement 不推进。后续 tool/Hook snapshot 只能看到新 epoch。
- **验证**：lime-agent context tool 定向 **2/2** 通过；agent-runtime provider-turn **86/86** 通过（含 compaction epoch、工具 metadata、snapshot fail-closed）。`cargo check -p lime-agent` 通过。未把该 slice 扩写为四协议/CLI/TUI/GUI/Windows/Linux/live 或 packaged 验收；T02/C02、Extensions contributor registry、Memory usage/prompt/cold/fork、插件/tar.gz/LimeCore 仍保持 active。

### 2026-10-21 C02 durable same-turn replacement boundary

- **Codex 对照**：`core/src/session/turn.rs::run_auto_compact` 只有在模型摘要成功后才安装新的 provider-visible history；压缩窗口和后续 continuation 必须使用同一 durable history 边界，不能把并发 steer/tool 事件错误纳入已发送的摘要前缀。
- **Current 改动**：`RuntimeCore::commit_same_turn_compaction` 现在在单一 RuntimeCore state lock 内读取当前事件前缀、构造 `session_context_compaction.v3` replacement，并通过 `RuntimeCoreEventAppender::append_external_runtime_events_locked` 完成事件日志、projection 和内存状态提交；移除了原先的 read/unlock/relock 间隙。provider loop 仍只在 durable commit 成功后推进 `context_epoch` 和替换本地 messages，失败或取消不推进。
- **验证**：`cargo check -p app-server -p agent-runtime` 通过；App Server `runtime::tests::context_auto_compaction` **2/2**、provider-history **37/37**、agent-runtime provider-turn **88/88**、plugin tar.gz archive **4/4** 通过；`npm run test:contracts` 通过。`thread_compact_jsonrpc` 仍有 7 个与本刀无关的既有 fixture/network 失败（catalog budget 断言 3 项、interactive command fixture 4 项），已保留原始失败证据。
- **边界**：本刀只关闭 durable same-turn replacement 的并发窗口；四协议真实 HTTP capture、provider opaque state、Memory usage/prompt/cold/fork、Extensions contributor registry、CLI/TUI/GUI Gate B、插件发布到 LimeCore 仍开放。

### 2026-10-21 C02 durable receipt projection

- **Codex 对照**：`core/src/compact.rs` 在替换历史成功后继续沿同一 Turn 的事件流发布 ContextCompaction Item；实时消费与 rollout replay 使用同一 canonical 事件身份，不重新构造一个临时 compaction。Lime 的同 Turn replacement 已在 state lock 内完成 durable append，但此前 `CurrentProviderTurnEvent::MidTurnCompaction` 被丢弃，导致实时 sink 看不到已提交 marker。
- **Current 改动**：`RuntimeMidTurnCompactionResult` 携带已提交 `durable_event_id`；App Server commit 从 `append_external_runtime_events_locked` 返回的 canonical notification 中提取该 id。provider loop 将 `MidTurnCompaction` 转成 `ContextCompactionCompleted`，App Server event mapper 通过现有 `emit_preappended_by_id` 发布原事件，禁止重复写入；无 receipt 的纯 runtime fixture 只发 transient signal，不能伪造 durable history。
- **验证**：`cargo check -p agent-runtime -p lime-agent -p app-server` 通过；agent-runtime compaction 定向 **3/3** 通过；App Server mapper 回归覆盖 durable receipt 转发与无 receipt transient 并通过；`tool-runtime` 新增 PreCompact/PostCompact 输入合同回归 **1/1** 通过，验证 `model`、`trigger`、`transcript_path`、事件名和 session/turn identity。
- **边界**：本刀只补实时 canonical projection 与重复写入防线；Pre/PostCompact hook 的独立输入断言、同 Turn tool result/pending steer/cold recovery 矩阵、Responses opaque state、Memory usage/prompt/cold/fork、Extensions contributor registry、插件发布到 LimeCore、CLI/TUI/GUI Gate B 仍开放。

### 2026-10-21 C03 model switch opaque-state boundary

- **Codex 对照**：Codex 的 model switch 会重新解析当前模型的 context/compaction capability；Responses continuation id、reasoning encrypted content 和 provider-native item 只在兼容 route 内复用。不能因为 provider、endpoint 和 credential 相同就把旧模型的 native response item 继续发送给新模型。
- **Current 改动**：`model-provider::current_client::health::history_producer` 将 model 纳入 route fingerprint。相同 provider 但切换 model 后，`prepare_request` 走既有 portable lowering，只保留可迁移 assistant text/summary，不复用旧 response id、encrypted content、producer 或 continuation state；同模型同 route 仍保留原生 Responses history。
- **验证**：`model-provider::current_client::history` 定向 **3/3** 通过，覆盖同 provider model switch、四协议/凭证/版本切换和未知 native item fail-closed；原始 durable history 不被 request copy 修改。
- **边界**：本刀关闭 model identity 的 native state 复用漏洞；Anthropic/Gemini 原生签名、媒体与 world-state、Responses 跨重启 opaque continuation、真实四协议 HTTP capture、Memory、Extensions、插件/LimeCore 和 CLI/TUI/GUI Gate B 仍开放。

### 2026-10-21 Codex Interrupt lifecycle 接线（current，仍需产品验收）

- **Codex 事实源**：`codex-rs/core/src/hook_runtime.rs::run_turn_interrupt_hooks` 在活动 Turn 已脱离后，先 flush transcript，再构造 `session_id/turn_id/transcript_path/cwd/hook_event_name/model/permission_mode`，只对 root session 派发 `Interrupt`；`hooks/src/events/interrupt.rs` 的命令输出只接受空 stdout 或 `{systemMessage}`，非 JSON、非零退出和超时均失败并产生 Hook lifecycle 记录。ThreadSpawn/Synthetic/MemoryConsolidation 不走 root Interrupt。
- **Current owner**：`tool-runtime::hook_lifecycle::RuntimeInterruptHookContext` 和 `hook_runtime/interrupt.rs` 固化输入/输出合同；`lime-agent::run_interrupt_hooks` 复用现有 discovery、CommandHookReporter、MCP executor、HookStarted/HookCompleted emitter；`ExecutionBackend::run_interrupt_hooks` 仍由 RuntimeBackend 持有 route/session/plugin/MCP owner；`RuntimeSessionActor::stop_active_task` 的 `RuntimeSessionTask::interrupt` 是唯一显式取消接线，和普通 `abort` 分离，Review/Compact replacement 不会误发 Interrupt；CLI/TUI、Desktop 共享同一 App Server/RuntimeCore 主链。
- **已实施**：`turn/interrupt`/session actor 取消活动 task 后调用 RuntimeBackend Interrupt runner；Root 之外按 typed `RuntimeStopHookTarget` 跳过；命令 Hook 输入字段与 Codex 名称对齐；Interrupt 输出严格 fail-closed，`systemMessage` 映射 warning；MCP Hook 仍复用 thread-scoped AgentRuntimeState，不新增 backend、registry 或兼容层。
- **验证状态**：已完成 rustfmt 与 `git diff --check`；新增 Interrupt parser/input 单测代码，待 Rust owner 测试执行。当前工作区 Cargo 无可用 macOS arm64 Rusty V8 预编译归档，`V8_FROM_SOURCE=1` 又因仅安装 CommandLineTools、缺 Xcode `xcodebuild` 被阻塞；此环境原因不能记为测试通过或实现失败。
- **未关闭**：取消前 canonical rollout/transcript flush 的真实 durable ACK、Interrupt lifecycle 在 stdio/PTY/Electron 的 Gate B、async hook completion 收据、四协议 provider capture、GUI/TUI/CLI/Windows/live/packaged 验证；Memory、插件/tar.gz/LimeCore 主链继续开放。下一刀优先在可用 Rust/Xcode 环境执行 `tool-runtime` Interrupt 测试、`agent-runtime` session interrupt 回归、App Server `turn/interrupt` JSON-RPC 与真实 stdio/PTY/Electron evidence。

### 2026-10-21 M02 memory read-path 与 usage telemetry（current，核心实现已补）

- **Codex 事实源**：`ext/memories/src/prompts.rs` 与 `templates/memories/read_path_v2.md` 要求把
  `memory_summary.md` 作为已注入的路由摘要，按需搜索 `MEMORY.md`、渐进读取 rollout/skills，
  对记忆事实保持可验证边界；显式 remember/forget/correction 通过 notes 追加，模型输出使用
  `<oai-mem-citation>` 记录实际使用的来源。`memories/read/src/usage.rs` 对 shell read/search
  仅在命令可解析时分类 `MEMORY.md`、summary、raw、rollout summaries 和 skills，并区分 v1/v2。
- **Lime current 改动**：`runtime/context_packet.rs` 的 Memory summary developer block 已补齐
  渐进式读取、不可当作事实、`memoryStore/addNote` 写入边界与 Codex citation 模板；保留 Lime 的
  workspace/global scope 和多模型 provider route，不把 OpenAI 模型或固定窗口写入提示。
  `tool-runtime/memory_usage.rs` 复用现有 Codex-derived command parser，`unified_exec` 将解析成功
  的 memory usage 分类写入 `memoryUsage` 结果元数据，未知命令 fail closed；结构化
  `memoryStore/read/search` 的 durable usage counter 继续由 `LocalMemoryBackend` 负责。
- **验证**：目标文件 `rustfmt --edition 2021 --check` 通过；Rust 定向测试被本机 `rusty_v8`
  `v150.4.0` arm64 预编译归档 404 阻塞，未把该环境结果记为通过。需在可用 Rust/V8 环境执行
  `cargo test --manifest-path "lime-rs/Cargo.toml" -p tool-runtime memory_usage --lib`，并补真实
  exec→memory usage→phase-2 selection、citation→usage→consolidation/cold restart 证据。
- **剩余**：read-path 的真实四协议 provider capture、workspace/global citation scope 精确归属、
  Memory 自动重试与 usage/prompt/cold/fork 闭环仍开放；本片不核销 M01 共享 Agent harness。


### 2026-10-21：独立 rollout 的权威模型上下文（实施中）

按 Codex `RolloutItem` / `CompactedItem` / rollout reconstruction 继续补齐文件恢复；
实施、源码证据、窄写集、Verification Contract 和终态见
[codex-rollout-context-alignment.md](codex-rollout-context-alignment.md)。
本轮已接入原生模型记录、session checkpoint、usage、portable 输入媒体和目标 fork seed；
旧 schema 直接清退。最终 integration 尚在运行，不核销 CLI/TUI/GUI、live、Windows、
完整聚合、Memory/Extensions、插件/tar.gz 或 LimeCore 的开放义务。

### 2026-10-21：Portable rollout 的四协议恢复进展

沿 Codex 完整源代码的 ResponseItemEnvelope/rollout reconstruction，独立 schema 3 rollout
已保存完整 runtime/model records、session compaction checkpoint、用量和输入图片。
本轮补齐 provider stream 的 Anthropic 分片签名与 Gemini signed text/thought，
复用 existing completed-item -> durable history ACK，不新增 runtime/store/public method。
公共 JSON-RPC 六 target 54/54、provider owner 181/181、contracts 与治理检查通过；
4 同协议 + 12 跨协议均验证 plain ephemeral、zstd durable/cold 和新索引的原 Thread 恢复。
Responses 仍只重放完整原生 reasoning，不从显示 delta 伪造 reasoning；跨协议可见回答保留。
owner lib、Electron/GUI、CLI/PTY 和本地聚合门禁尚在验证，不计全 Codex 100%。
详见 [当前计划](codex-rollout-context-alignment.md) 与其 evidence 分账。
当前开放范围仍含 assistant media/collab arguments/unknown extension 的恢复、压缩文件的空索引自动发现、
Memory/Extensions/harness 其余项、插件/tar.gz/LimeCore；不恢复旧插件或兼容层。

Portable rollout 验收补记：完整 CLI Gate B r14 exit 0，含真实 runtime SIGINT、冷恢复、
fork、reasoning/五语言及三类 Command shutdown；基础真实 PTY r15 证明一次键盘提交、
alternate-screen 进出、termios 恢复与同一 cold Thread/Turn，使用 controlled external backend，
不替代完整 TUI 聚合。两个门禁夹具按 canonical thread 隔离后台 Memory 采样；请求证据及
Codex `memories/write/src/phase2.rs` 证明额外请求属于独立 consolidation Agent，未改 Memory
实现或降低用户 Turn exactly-once 要求。原全局脚本序号导致跨线程回复的失败保留。
owner r8 编译因 target 临时目录 ENOENT 未执行；完整 TUI 构建取消；renderer 收据 invalid，
新 Electron fork 未跑；Agent 聚合在 371 项定向通过后构建锁超时；本地门禁在 presentation
夹具批次 153 pass/11 fail 后退出。结果均在 [计划与证据](codex-rollout-context-alignment.md)
分账。本切片退出条件 3/5（60%），整体 active，未核销剩余 runtime/插件/LimeCore 义务。

### 2026-11-10 可度量的对齐基线与第一刀清理（audit current）

- **状态**：active；本轮只建立口径、修构建图脱节，不宣称任何 runtime 语义完成。
- **事实源**：`npm run inventory:upstream-alignment` 生成 `internal/refactor/upstream-alignment-audit.json`，
  上游 revision 由脚本读取 Codex HEAD，不再手写。
- **当前数字**（2026-11-10 第二十九轮后）：lime-rs `2747` 文件 / `849,027` 行；Codex `5932` 文件 /
  `2,323,902` 行；与上游逐字节一致 `31` 个；同名文件可比 `1501` 个，分桶
  `>=0.95: 48`、`0.80-0.95: 24`、`0.50-0.80: 38`、`0.20-0.50: 42`、`<0.20: 1349`。
  口径说明：`identical` 只统计未适配文件，品牌适配（如 `.codex` → `.lime`）会让该数下降，
  不代表复制回退；判断对齐看“同名相似度分桶 + 消费者接线”，不看单一 identical。
  结论：主链仍是“读上游后自研”，不是 `AGENTS.md` 要求的复制优先；后续每刀必须让该口径变化，
  不能用“看过 Codex”代替复制与接线。
- **crate 覆盖**：`app-server*`、`protocol`、`config`、`execpolicy`、`apply-patch`、`skills`、
  `mcp`、`model-provider` 已有同语义 owner；`thread-store`、`rollout`、`state`、`history`、
  `file-search`、`hooks`、`memories`、`sandboxing`、`windows-sandbox-rs`、`cli`、`tui` 为 partial；
  `linux-sandbox`、`exec-server` 为 absent；`otel` 按产品边界 excluded。
- **构建图脱节**：`lime-server`（12.8k，axum HTTP API 栈）、`lime-embedding`（772，可选 ONNX）
  经 `cargo metadata` 确认零消费者、零 `[[bin]]`。本轮删除 `lime-embedding` 及其 workspace
  依赖，`Cargo.lock` 同步剪掉 `fastembed`/`ort`/`hf-hub`；`lime-server` 连同 `lime-processor`、
  `lime-websocket` 牵涉“服务端能力是否保留”的产品判定，本轮不删，登记为待定项。
  `app-server-daemon` 同样零消费者，但它是 Codex 已有能力，属未接线而非应删除，保留为移植目标。
- **验证**：`npm run governance:scripts` 通过；`cargo check -p cli -p tui` 通过（CLI/TUI 两个
  surface 不因本次清理回归）。`app-server` 的本机编译阻塞已解除：`rusty_v8 v150.4.0` 的
  `ptrcomp_sandbox` 归档未发布（404），改用同版本 `ptrcomp_release` 归档 + 匹配 binding 做本地替代：
  `RUSTY_V8_ARCHIVE=<...>/librusty_v8_ptrcomp_release_aarch64-apple-darwin.a.gz`、
  `RUSTY_V8_SRC_BINDING_PATH=$CARGO_HOME/registry/src/*/v8-150.4.0/gen/src_binding_ptrcomp_release_aarch64-apple-darwin.rs`，
  `cargo check -p app-server` 通过。该替代**不含 V8 sandbox**，只能作为编译与非 V8-sandbox 路径证据，
  不能记为 V8 sandbox 行为验收；正式门禁仍需发布归档或 `V8_FROM_SOURCE=1`。
- **旧口径**：`internal/refactor/codex-source-baseline.json` 是 2026-10-25 的一次性取样记录
  （destination 指向已禁止的 `lime-rs/upstream`），不能作为 current 复制完成度；现行口径以上面
  的 audit JSON 为准。
- **本轮代码复制（2026-11-10 第二轮）**：整目录复制 Codex `codex-rs/utils/path-uri`（revision
  `1885417cd45a8da5bfdeb7864a5380a7481d48f2`，Apache-2.0）到 `lime-rs/crates/utils-path-uri`，
  包名 `lime-utils-path-uri`；仅把 `codex_utils_absolute_path` 改为 `lime_utils_absolute_path`，
  其余目录、文件、类型与测试保持上游原名。`cargo test -p lime-utils-path-uri` 83/83 通过。
  它当前零消费者，audit 标记为 `pending-wiring`，是 permissions/sandboxing 复制的前置 owner。
- **本轮代码复制（2026-11-10 第三轮）**：复制 Codex `protocol/src/permissions.rs`、
  `protocol/src/permissions/`、`protocol/src/permissions_tests.rs`（共 `6,286` 行，Apache-2.0，
  revision `1885417cd45a8da5bfdeb7864a5380a7481d48f2`）到 `lime-rs/crates/permissions`
  （包名 `lime-permissions`），并逐字复制 `SandboxPolicy`/`NetworkAccess`/`WritableRoot`
  三个领域类型到 `sandbox_policy.rs`。仅做两类适配：`crate::protocol::` → `crate::sandbox_policy::`、
  `codex_utils_*` → `lime_utils_*`，并补回上游 `SandboxPolicy::get_writable_roots_with_cwd`。
  `cargo test -p lime-permissions` **65/65 通过**；`cargo fmt --check` 通过。该 crate 零消费者，
  audit 标记 `pending-wiring`。
- **决策记录（本轮已定）**：采用 (a) 新建领域 `permissions` owner；wire DTO 继续留在
  `app-server-protocol`，两者映射只在接线处做一次，不把领域匹配逻辑塞回 wire crate。
  下一步是复制 `sandboxing/src/seatbelt.rs` 与四个 `.sbpl` 资源到 `tool-runtime`，直接消费
  `lime-permissions` 的领域类型。

- **下一刀依据**：Codex `protocol/src/permissions.rs`（2,647 行）依赖 `PathUri`、`AbsolutePathBuf`、
  `globset`，并通过 71 处引用耦合 `SandboxPolicy`/`NetworkAccess`/`WritableRoot`；Lime 目前只有
  wire 形态的同名类型（`app-server-protocol` v2）。因此 sandboxing 复制前必须先决定：
  (a) 新建领域 `permissions` crate 并复制 Codex 的 `SandboxPolicy` 等类型，或
  (b) 把 `permissions` 适配到 Lime 现有 wire 类型。该决策影响协议层，需在下一轮先出架构结论再动代码。

- **本轮代码复制（2026-11-10 第四轮）**：复制 `sandboxing/src/seatbelt.rs`、
  `sandboxing/src/seatbelt_scratch.rs` 与四个 `.sbpl` 资源到
  `tool-runtime/src/sandbox/`，直接消费 `lime-permissions` 的领域类型。复制后按产品边界裁剪：
  移除 Codex 托管网络代理接线（`codex-network-proxy` 为 32k 行 rama/AWS/OTEL 依赖，Lime 不托管 MITM 代理）、
  移除 `codex_uds` daemon socket 保护（Lime 无 UDS daemon）、移除 Codex home 符号链接 opt-out
  （Lime 无该配置项），并把 let-chain 改为 edition 2021 可编译形式。保留全部文件系统策略逻辑：
  protected metadata、symlink 归一化、glob deny、fcntl deny、ancestor unlink deny。
  新增两个模块测试；`cargo test -p tool-runtime --lib seatbelt` **4/4 通过**（含既有 command 测试）。
  **该模块尚未接入 `prepare_sandbox_command`**，生产路径仍是旧字符串策略；接线是下一刀。
- **本轮品牌适配**：`PROTECTED_METADATA_PATH_NAMES` 中 `.codex` 改为 `.lime`（其余 `.git`/`.agents`/`.aws`
  保留），内部 `codex-project-roots://` 前缀与 `*_dot_codex` 标识改为 `lime-*`/`*_dot_lime`；
  复制文件的 `codex-rs` 来源注释保留。品牌适配后 permissions 测试 `65/65` 仍通过。
- **下一刀细节**：接线需要一次 wire→domain 转换（`app-server-protocol::SandboxPolicy` 与
  `GrantedPermissionProfile` → `lime_permissions::FileSystemSandboxPolicy`），并把
  `tool-runtime/src/sandbox/command.rs::prepare_seatbelt_command` 替换为
  `seatbelt::create_seatbelt_command_args`；同时把 `.lime`/`.agents` 加入
  `PROTECTED_METADATA_PATH_NAMES`（Lime 现有行为，Codex 只有 `.codex`/`.git`），并跑既有
  `sandbox::command` 回归。之后再做 Linux landlock/bwrap 与 Windows。

- **本轮接线（2026-11-10 第五轮，current）**：`prepare_sandbox_command` 的 Seatbelt 分支已从手写
  字符串策略切换为 Codex 派生的 `seatbelt::create_seatbelt_command_args`。新增唯一的 wire→domain
  转换：`app-server-protocol::SandboxPolicy`/`GrantedPermissionProfile` →
  `lime_permissions::SandboxPolicy`/`FileSystemSandboxPolicy`（含 read/write/entries/glob depth、
  special path、相对路径按 cwd 绝对化）。bubblewrap 的受保护元数据改用
  `lime_permissions::PROTECTED_METADATA_PATH_NAMES`（`.git`/`.agents`/`.lime`/`.aws`）。
  失败路径显式化：`InvalidPath`、`Seatbelt`，非 macOS 的 Seatbelt backend 继续 fail closed。
  既有两条 seatbelt 断言从“旧字符串格式”改为语义断言（deny default、writable 根、`.git` 保护 regex、
  network-outbound、授权写路径参数）。
- **验证（第五轮）**：`cargo test -p tool-runtime --lib` **626 passed / 0 failed**（含 23 项 sandbox
  测试）；`cargo check -p cli -p tui` 通过；`rustfmt --check` 通过。生产路径现在真正使用 Codex
  seatbelt 策略生成器，CLI/TUI/GUI 共用同一执行链。

- **运行证据（2026-11-10 第六轮）**：新增 macOS 真实执行测试
  `seatbelt_policy_allows_workspace_write_and_denies_outside_write`：用生产 `prepare_sandbox_command`
  生成参数后真实 spawn `/bin/sh`，断言工作区内写成功、`$HOME` 下写被内核拒绝
  （`Operation not permitted`），命令仍正常结束。该测试只证 macOS seatbelt 文件系统边界，
  不冒充 Linux/Windows 或网络隔离证据。测试同时记录一个事实：macOS `TMPDIR` 是
  workspace-write 默认可写根，拒绝用例必须指向 TMPDIR 之外。
- **本轮清理**：移除无消费者的 `MacosSeatbeltProfile::FileSystemHelper`、`EnvironmentNetworkProxy`
  错误与 `UnixDomainSocketPolicy::AllowAll`，合并重复的 seatbelt 构造函数；`cargo check -p tool-runtime`
  不再产生该模块 dead_code 警告。`cargo test -p tool-runtime --lib` **627 passed / 0 failed**。

- **Linux 可行性结论（2026-11-10 第七轮）**：`rustup target add x86_64-unknown-linux-gnu` 后，
  `lime-permissions`（含 `permissions` 全部 Linux 分支代码）交叉 `cargo check` 通过，Linux 编译验证可用。
  Codex `linux-sandbox` 整包复制的依赖闭包为：`codex-sandboxing`（与 Lime 现役 tool-runtime sandbox
  循环）、`codex-network-proxy`（32k，Lime 不托管代理）、`codex-install-context`、
  `codex-process-hardening`、`codex-uds`、`seccompiler`/`landlock`/`rustix`/`ignore`，并需要新增
  `lime-linux-sandbox` helper 二进制与 Electron/CLI 打包项。该整包复制登记为独立切片，
  在 Linux 运行环境可验收前不宣称完成；本轮先做可验证的语义对齐。
- **本轮 Linux 语义对齐**：`prepare_bubblewrap_command` 不再自己计算可写根和 `.git/.lime/.agents`，
  改为与 seatbelt 共用 `domain_file_system_policy` + `resolve_for_enforcement(PreserveMutableRoots)`：
  bwrap 的 `--bind` 来自领域 `writable_roots`，`--ro-bind` 来自每条根的 `read_only_subpaths`
  （含 `.git`/`.agents`/`.lime`/`.aws`），网络开关来自领域 network policy。
  删除重复的 `append_bubblewrap_permissions`/`special_path`/`append_bubblewrap_path`。
  这样两个后端由同一个 policy owner 驱动，不再各写一套根解析。
- **验证（第七轮）**：`cargo test -p tool-runtime --lib` **627 passed / 0 failed**（sandbox 24 项，
  含真实 macOS seatbelt 执行）；`cargo check -p cli -p tui` 通过；`rustfmt --check` 通过；
  `cargo check --target x86_64-unknown-linux-gnu -p lime-permissions` 通过。
  限制：本机无 Linux 运行环境，bwrap 参数只做了 macOS 上的构造断言与领域策略交叉编译，
  不能记为 Linux 运行时验收；tool-runtime 因 v8 Linux 归档缺失无法整体交叉编译。

- **本轮 CLI 对齐（2026-11-10 第八轮）**：新增 `lime agents`，与 Codex `AgentsCommand` 对齐
  （连接参数、`-C/--cd`、`--remote`、locale），启动 TUI 后直接打开 agent command center 并刷新线程列表。
  实现只加一个 `TuiOptions.open_agents_overview` 布尔与启动刷新，不建第二套会话或投影。
  CLI 命令面现状：与 Codex 对齐的有 exec/review/resume/queue/archive/delete/unarchive/fork/
  mcp/plugin/app-server/debug/features/sandbox/execpolicy/completion/agents；仍缺 `doctor`（Codex 13k）、
  `apply`、`migrate-rollouts`、`migrate-nfs-db`；login/logout/update/app/remote-control 按产品边界排除。
- **验证（第八轮）**：`cargo test -p cli` 2/2；`cargo test -p tui --lib runtime` 29/29；
  `cargo test -p tui --no-run` 通过；`cargo build -p cli` 后 `lime agents --help` 与 `lime --help`
  均显示新命令；`rustfmt --check` 通过。

- **2026-11-10 第九轮（agents 接线测试与 PTY 结论）**：把 `lime agents` 的选项构造抽成
  `agents_tui_options`，新增 CLI 测试 `agents_command_opens_overview_with_shared_connection_options`：
  断言子命令解析、`open_agents_overview=true`、`--cd`/`--model`/`--provider` 透传。`cargo test -p cli`
  通过（含 8 项 lib 测试）。真实 PTY 验收**未完成**：用 `script` 自建 PTY 跑 `lime agents` 只能看到
  备用屏幕进入、标题设置，没有稳定渲染出 overview 文本，不能作为验收证据；正确路径是给
  `tui-gate-b.mjs` 增加 `agents-command` 场景（`LIME_TUI_GATE_B_SCENARIOS` 可单选），由现有
  PTY harness 断言首屏、快捷键与终端恢复。
- **顺带发现**：仓库已有 `scripts/lib/rusty-v8-artifacts.mjs`，从 `openai/codex` release 解析
  `ptrcomp_sandbox_release` 归档并带校验和；`resolveRustyV8CargoEnv` 已能在本机解析出 sandbox
  版本归档路径。后续 build/gate 应使用该官方解析器，而不是手工 `ptrcomp_release` 替代；
  第五轮记录的“V8 sandbox 未验证”限制因此可以在下一次全量构建时消除。

- **2026-11-10 第十轮（agents 真实 PTY 验收通过）**：`runtime_pty_tests.rs` 新增
  `agents-command` 场景：CLI 以 `agents` 启动、跳过 composer 等待、断言首屏出现
  “Agent command center” 与 `f9 open`/`ctrl+x q back`，按 `ctrl+x q` 返回 composer 后退出。
  `tui-gate-b.mjs` 支持无 Turn 场景（ledger 可选、`thread=none`、marker 断言），
  并允许 `LIME_TUI_GATE_B_SCENARIOS=agents-command` 单选。
- **证据（第十轮）**：`LIME_TUI_GATE_B_SCENARIOS=agents-command node scripts/app-server/tui-gate-b.mjs`
  退出码 0，输出 `TUI_AGENTS_COMMAND_OK screen=overview back=composer`，总体
  `[smoke:tui-gate-b] ok ... terminal=restored`；同一命令跑 `agents-overview` 回归退出码 0
  （`events=turn.started,message.delta agents-overview=ok`）。这证明 `lime agents` 在真实 PTY、
  真实 App Server 与 external backend 下能直接进入 command center 并返回。
- **复现命令**：
  `LIME_CLI_BIN=lime-rs/target/debug/lime APP_SERVER_BIN=lime-rs/target/debug/app-server
  LIME_TUI_GATE_B_SCENARIOS=agents-command node scripts/app-server/tui-gate-b.mjs`
  （构建二进制时使用 `scripts/lib/rusty-v8-artifacts.mjs` 的官方 V8 归档）。

- **2026-11-10 第十一轮（V8 sandbox 验证限制解除）**：改用仓库既有
  `scripts/lib/rusty-v8-artifacts.mjs::resolveRustyV8CargoEnv` 解析官方
  `ptrcomp_sandbox_release` 归档（22MB，缓存于 `~/Library/Caches/Lime/rusty-v8`），
  `cargo clean -p v8` 后以该 env 重建 `app-server`，v8 build 输出确认 binding 为
  `src_binding_ptrcomp_sandbox_release_aarch64-apple-darwin.rs`，构建 47s 通过。
  第五轮“V8 sandbox 未验证”的限制**已消除**；此前手工 `ptrcomp_release` 替代不再使用。
- **验证（第十一轮）**：`cargo build -p app-server`（sandbox V8）通过；
  `cargo test -p tool-runtime --lib` 连续 3 次 **627 passed / 0 failed**；
  `LIME_TUI_GATE_B_SCENARIOS=agents-command node scripts/app-server/tui-gate-b.mjs`
  在 sandbox-V8 二进制上退出码 0（`[smoke:tui-gate-b] ok ... terminal=restored`）。
  诚实记录：该套件首次运行出现 1 个未复现失败（随后 3 次全绿），未定位到具体用例；
  按既有稳定性处理，后续全量门禁需观察是否复发。
- **复现命令**：
  `node -e "import('./scripts/lib/rusty-v8-artifacts.mjs').then(m=>console.log(m.resolveRustyV8CargoEnv({repoRoot:process.cwd()})))"`
  取 env 后 `cargo clean -p v8 && cargo build -p app-server`。

- **2026-11-10 第十二轮（持久化 owner 第一刀：删除死抽象链）**：查证并删除整条无消费者的
  “SessionRepository” 持久化链（7 个文件，约 4,306 行）：`thread-store/src/session_repository.rs`
  （trait，无实现者）、`session_record.rs`、`agent/src/lime_session_repository.rs`（从未被构造）、
  `agent/src/session_record_sql.rs`、`core/src/database/agent_session_repository.rs` + tests、
  `core/src/database/dao/agent.rs`（仅被该 repository 使用）。同步移除四个 crate 的模块声明。
  删除后全仓无 `AgentDao`/`SessionRecordRow`/`LimeSessionRepository` 残留引用。
- **验证（第十二轮）**：`cargo test -p lime-core --lib` **549 passed**；
  `cargo test -p thread-store --lib` **35 passed**；`src/lib/governance/projectThreadFirstBoundary.test.ts`
  **10/10 通过**（守卫清单已从被删旧文件换成 `thread-store/store.rs`、`history.rs`、
  `app-server/runtime/canonical_thread_store.rs`、`canonical_rollout.rs` 四个现役 owner）。
- **并发阻塞（如实记录）**：本轮进行中用户并行修改 `lime-services`（`cloud_desktop_service.rs`
  引用尚未落盘的 `purchase`/`ecs` 模块），导致 `lime-agent`、`app-server` 当前无法编译；
  与本轮删除无关，也不触碰该热区。等并行改动落地后需补跑 `cargo check -p lime-agent -p app-server`
  与持久化定向测试。

- **2026-11-10 第十三轮（持久化死 DAO 清理）**：按“模块无引用 + 类型无引用”双重查证，删除
  `core/src/database/dao/` 下 6 个无消费者 DAO（`agent_thread_incident`、`agent_turn_outcome`、
  `browser_environment_preset`、`browser_profile`、`orchestrator`、`providers`，共 1,864 行），
  同步移除模块声明。对应 SQLite 表与 schema/migration 保留（数据不丢），仅删除无人读写的 Rust 访问层。
  删除后 `AgentThreadIncident*`/`BrowserProfile*`/`OrchestratorDao`/`ProviderDao` 在全仓零引用。
- **验证（第十三轮）**：`cargo test -p lime-core --lib` **538 passed / 0 failed**（删除的 11 个内联测试
  随模块移除）；`cargo check -p cli -p tui` 通过（两个 surface 不受 services 并行改动影响）。
- **并行阻塞仍在**：`lime-services` 的 `cloud_desktop_service/ecs.rs` 仍声明缺失的 `purchase`
  子模块，`purchase_ecs`/`inspect_ecs_purchase` 方法未落地，`lime-agent` 与 `app-server`
  继续无法编译；未触碰该热区。CLI/TUI 与 core/thread-store 不受影响，本轮验证基于这些 crate。

- **2026-11-10 第十四轮（apply-patch 定位算法对齐）**：整文件复制 Codex
  `apply-patch/src/seek_sequence.rs`（Apache-2.0，revision `1885417cd4`）到
  `patch-apply/src/seek_sequence.rs`，仅把 `pub(crate)` 改为 `pub` 以保留 Lime 现有导出；
  保留 Lime 原有的 Unicode 标点归一化回归测试。行为差异：上游在 `eof=true` 时使用
  `eof_start.max(start)`（Lime 旧实现忽略 start），更贴近 `git apply` 的定位语义。
- **验证（第十四轮）**：`cargo test -p patch-apply` **21 passed / 0 failed**；
  `cargo check -p cli -p tui` 通过。注意：本轮审计口径包含用户并行改动，文件/行数增量
  不完全来自本切片。
- **并行阻塞更新**：`lime-services` 仍未编译通过（`purchase_ecs`/`inspect_ecs_purchase`/
  `validate_ecs_purchase_receipt` 为 private），`tool-runtime`、`lime-agent`、`app-server`
  本轮均无法编译验证；未触碰该热区。

- **2026-11-10 第十五轮（services 恢复后补验收）**：`lime-services` 已可编译，补齐第十二/十三轮
  删除链在消费者侧的验证：
  - `cargo check -p lime-agent -p app-server` ✅（SessionRepository/DAO 删除后无编译回归）；
  - `cargo test -p app-server --lib runtime::canonical_thread_store -- --test-threads=1`
    **101 passed / 0 failed**（含 workspace migration、rollout 去重与归档 provenance）；
  - `cargo test -p tool-runtime --lib` 在跳过两个环境依赖用例后 **625 passed / 0 failed**。
- **测试隔离缺口（如实记录，非本轮引入）**：并行运行本机 App Server 时，
  `computer_use::tests::turn::presentation_outlives_one_action_but_finishes_on_revocation_or_policy_change`
  会因机器级 Computer Use 输入租约被占用而失败（`Computer Use desktop resource is busy in another
  App Server`）；`primary_runtime::tests::checksum_failure_and_canceled_reinstall_keep_previous_installation`
  在并发文件锁下报 EAGAIN。两者都是测试隔离问题，不是本轮改动回归；未修改测试以掩盖。
  建议后续把 OS 输入租约与安装目录在测试内做成 per-test 隔离。
- **备注**：本轮曾尝试给 presentation 测试加有界等待，确认根因是跨进程租约后已回退，未保留该改动。

- **2026-11-10 第十六轮（并发测试隔离调查）**：对 tool-runtime 全量套件的偶发失败做了定位实验：
  - 多线程运行：`computer_use::tests::turn::presentation_outlives_one_action_but_finishes_on_revocation_or_policy_change`
    在 `ControlBroker::acquire` 处报 “Computer Use desktop resource is busy in another App Server”；
    `primary_runtime::tests::checksum_failure_and_canceled_reinstall_keep_previous_installation` 偶发 EAGAIN；
  - `--test-threads=1`：**627 passed / 0 failed**，连续稳定；
  - 仅给两个“持有 OS 租约”的测试加进程内串行锁**无效**（仍偶发失败），说明竞争不止来自这两个用例，
    更像 presentation/lease 释放时序暴露的真实竞态，而非纯测试隔离问题。
  已回退实验性测试改动，不改测试掩盖问题。**结论**：在该竞态修复前，tool-runtime 全量建议用
  `--test-threads=1`；需要一次带日志的专项定位（presentation 结束、`release` 与 `finish_turn` 的时序）。
- **本轮补跑**：`cargo test -p app-server --lib runtime::canonical_thread_store -- --test-threads=1`
  再次 **101 passed / 0 failed**，持久化收口稳定。

- **2026-11-10 第十七轮（seatbelt 引号路径缺陷修复）**：全量 `app-server --lib` 单线程运行暴露
  `command_exec::tests::memory_workspace_policy_reaches_the_real_process` 失败：可写根
  `extra "scope"` 含引号时，复制的 Codex 策略生成器把路径写进 `(regex #"...")` 原始字符串，
  SBPL 在第一个 `"` 处截断，`sandbox-exec` 报 `unbound variable: scope"/\.git`。
  修复：受保护元数据不再内联 regex，改为 `-DPROTECTED_METADATA_<n>` 参数 +
  `(require-not (literal (param ...)))` / `(require-not (subpath (param ...)))`，
  语义等价（精确路径 + 子树）且对任意路径字符安全；删除因此不再使用的
  `seatbelt_protected_metadata_name_regex`。
- **验证（第十七轮）**：全量 `app-server --lib -- --test-threads=1` **2039 passed / 0 failed**
  （435s，含持久化 101 项与 command_exec 18 项）；`command_exec::` **18/18**（含引号路径用例）；
  `tool-runtime --lib -- --test-threads=1` **627/627**；seatbelt sandbox 测试 **24/24**
  （断言改为校验 `PROTECTED_METADATA` 参数）；`rustfmt --check` 通过。

- **2026-11-10 第十九轮（computer_use 租约交接竞态定位与测试修正）**：根因定位到
  `ComputerUseService::execute`：适配器动作在 `tokio::spawn` 的 owned task 中执行，lease 的
  `Arc<ControlLease>` 由该 task 在结束时释放；`execute_for_turn` 返回后 OS 锁的交接发生在
  另一个调度 tick，测试原先“立即 acquire”会偶发看到 busy。修复放在测试侧：用 2s 有界等待
  轮询 `ControlBroker::acquire`，交接成功即返回，超时仍失败（不会掩盖泄漏）。
  同时给 `broker_tests` 的 fence 断言补上实际错误输出，便于下次定位。
- **验证（第十九轮）**：`computer_use::` 连续 **10/10** 通过；全量 `tool-runtime --lib`
  多线程连续 **5/5** 通过（此前约 1/4 概率失败）。随后用户并行 `cargo build` 占用 target 锁，
  额外的 10 轮重复验证主动中止，不记为通过。
- **纠偏**：第十六轮曾尝试“串行化两个持租约测试”，无效并已回退；本轮的有界等待才对应真实时序。

- **2026-11-10 第二十/二十一轮（rollout owner 抽取尝试，已回退）**：目标是把
  `app-server/src/runtime/canonical_rollout`（约 2.7k 行）抽成独立 `rollout` crate，对齐 Codex
  的 `codex-rollout` owner。实际依赖闭包比预期大：`canonical_rollout` 还依赖 app-server runtime 的
  `SidecarStore`（600 行）、`turn_input_events`（168 行）、`input_media`（671 行）与
  `RuntimeEvent`/`event_sink`。**结论**：必须先抽“rollout 媒体/输入事件支持层”，才能抽 rollout
  本体；单一 crate 抽取会把 app-server runtime 的一半一起搬走。
  本轮已完整回退（crate 目录、workspace/app-server 依赖、模块声明、导入全部恢复），
  `cargo check -p app-server` 通过（EXIT 0），工作树无残留 `rollout` crate 引用。
- **风险备注**：回退时以 git HEAD 恢复了 `canonical_rollout` 文件；此前未观察到该模块的未提交改动，
  但若并行进程曾修改它，需要重新应用。
- **下一刀候选（按依赖顺序）**：
  1. 先抽 `runtime/media` 支持层（sidecar + input_media + turn_input_events + RuntimeEvent）；
  2. 再抽 `rollout` crate；
  3. 之后才做 `canonical_thread_store` 与 `thread-store` 的存储契约收敛。

- **2026-11-10 第二十二轮（CLI 沙箱 Gate B 固化）**：新增
  `scripts/app-server/cli-sandbox-gate-b.mjs` 与 `npm run verify:cli-sandbox`：创建临时
  `permissions.cli-sandbox-gate`（`extends: ":workspace"`）配置，真实执行
  `lime sandbox -P cli-sandbox-gate -C <workspace> -- /bin/sh -c ...`，断言工作区内写成功、
  `$HOME` 下写被拒且输出包含 `Operation not permitted`。门禁在非 macOS 上显式 skip。
- **证据（第二十二轮）**：`npm run verify:cli-sandbox` 退出码 0，输出
  `CLI_SANDBOX_OK workspace-write=allowed home-write=denied seatbelt=Operation not permitted`。
  这是 CLI → App Server → tool-runtime → seatbelt 整条链的真实执行证据（此前只有 tool-runtime
  单测与 app-server 测试）。`npm run governance:scripts` 通过。

- **2026-11-10 第二十三轮（Windows 编译验证能力）**：`rustup target add x86_64-pc-windows-msvc` 后，
  以下 crate 交叉 `cargo check --target x86_64-pc-windows-msvc` **全部通过**：
  `lime-permissions`（含 `windows_glob` 等 Windows 分支）、`app-server-protocol`、
  `lime-utils-absolute-path`、`lime-utils-path-uri`。
  这为后续 Windows 沙箱策略对齐提供了编译级验证；但含 C 构建脚本的 crate（rusqlite / aws-lc-sys /
  ring）需要 MSVC 工具链，`tool-runtime`、`app-server` 的 Windows 目标仍无法在本机交叉编译，
  运行时验收仍需 Windows 环境。
- **附带结论（未采用）**：尝试用“模块引用计数”启发式扫死代码，`app-server`/`tool-runtime` 的候选
  大量是 `cfg(test)` 模块或被跨 crate 路径引用的 pub 模块（启发式只看 crate 内文本），不可靠，
  未据此删除任何代码。

- **2026-11-10 第二十四轮（lime doctor）**：新增 `lime doctor`：检查 CLI 版本、App Server 二进制
  解析结果，并通过真实 App Server 握手读取 visible model catalog；任一检查失败返回非零退出码。
  这是 Codex `doctor` 的**有意子集**：Codex 的 13k 还包含 auth/update/config-layer/平台专项诊断，
  其中登录、更新与账号检查按产品边界排除，config-layer 诊断留待后续。接线复用现有
  `ConnectionArgs` 与 `list_models`，不建第二套会话或 RPC 客户端。
- **验证（第二十四轮）**：真实运行 `lime doctor` 输出
  `[ok] cli version 1.173.0` / `[ok] app server binary …/app-server` /
  `[ok] app server handshake (26 visible models)`，退出码 0；指定不存在的 `--app-server` 时
  两条 `[fail]` 且退出码 1；`cargo test -p cli` 通过（lib 8 项含 doctor/agents 解析）；`rustfmt` 通过。
  CLI 命令面剩余缺口：`apply`、`migrate-rollouts`、`migrate-nfs-db`（`agents` 已于第八轮补齐）。

- **2026-11-10 第二十五轮（doctor config-layer 诊断）**：`lime doctor` 新增 `config/read` 检查：
  报告配置层数、origin 数，并把 `disabled_reason` 的层以 `[warn]` 列出（例如项目 `.lime` 未受信任时
  的 Project 层被禁用）。二进制缺失、握手失败、config 读取失败计入 `[fail]` 并使退出码非零；
  warn 不影响退出码。
- **验证（第二十五轮）**：真实运行输出 `[ok] config loaded (2 layers, 321 origins)` 与
  `[warn] 1 config layer(s) disabled: Project … not trusted`，退出码 0；`cargo test -p cli` 通过；
  `rustfmt --check` 通过。

- **2026-11-10 第二十六轮（doctor 数据目录与目录摘要）**：`lime doctor` 新增：
  - 模型目录摘要：provider 数量与默认模型；
  - 数据目录可写探测（`lime_core::app_paths::preferred_data_dir`，缺失时创建，写入并删除探针文件；
    失败计 `[fail]`）；
  - 数据库存在性（`resolve_database_path`）。
  CLI 仅为这三项新增 `lime-core` 依赖（此前已通过 tui 间接在依赖树中）。
- **验证（第二十六轮）**：真实运行输出
  `[ok] model catalog: 3 provider(s), default model …` / `[ok] data dir writable ~/Library/Application Support/lime` /
  `[ok] database present`，退出码 0；`cargo test -p cli` 通过；`rustfmt` 通过。

- **2026-11-10 第二十七轮（doctor provider 摘要）**：`lime doctor` 从 `config/read` 的 config JSON
  提取顶层 `default_provider` 与 `providers.*.enabled`，输出默认 provider 与已启用的内置 provider
  列表（没有启用项时不输出该行，避免把自定义 API-key provider 误报为缺失）。纯本地读取，不发
  网络请求，不探测 provider 可用性。
- **验证（第二十七轮）**：真实运行新增 `[ok] default provider openai`，退出码 0；
  `cargo test -p cli` 通过；`rustfmt` 通过。

- **2026-11-10 第二十八轮（doctor --json）**：`lime doctor` 改为先收集结构化检查再渲染：
  文本模式输出 `[ok|warn|fail] <check> <detail>`，`--json` 输出
  `{ ok, checks: [{ id, status, detail }] }`；退出码仍由是否存在 `fail` 决定。
  检查集合与上一轮一致（cli_version、app_server_binary、app_server_handshake、model_catalog、
  config、config_layers、default_provider、builtin_providers、data_dir、database）。
- **验证（第二十八轮）**：文本与 `--json` 均退出码 0，JSON 可被 `json.load` 解析（9 项检查）；
  `--json --app-server /tmp/missing-doctor` 输出 `"ok": false` 且退出码 1；`cargo test -p cli`、`rustfmt` 通过。

- **2026-11-10 第二十九轮（file-search 整包复制）**：Codex `codex-rs/file-search`（1,716 行，无
  `codex-*` 依赖：anyhow/clap/crossbeam-channel/ignore/nucleo(git pin)/serde/tokio）整目录复制到
  `lime-rs/crates/file-search`，edition 使用 2024 以保留上游 let-chain；仅把 `codex_file_search`
  改为 `file_search`、二进制名改为 `lime-file-search`。**未接线**：app-server 现役
  `fuzzy_file_search.rs`（341 行）仍是 current 搜索实现；下一刀把消费者切到新 crate 后删除旧实现。
- **验证（第二十九轮）**：`cargo check -p file-search` 通过；`cargo test -p file-search`
  **18 passed / 0 failed**；`rustfmt --check` 通过。审计口径：逐字节一致 27→31，>=0.95 分桶 43→48。

- **2026-11-11 第三十轮（file-search 接线）**：app-server `fuzzy_file_search` 的手写遍历与打分已被
  `file-search` crate（nucleo）替换：创建会话、下发 query、等待 `walk_complete` 快照（10s 上限、
  取消优先），再把 `FileMatch` 映射回现有 RPC 契约（相对 path、root wire 值、file_name、
  match_type、indices）。删除旧的 `fuzzy_score` / `push_match` / `should_skip_directory` /
  `compare_results`。行为差异：忽略规则改为按 `.gitignore` 生效（原先只有硬编码目录黑名单），
  排序由 nucleo 计算。
- **验证（第三十轮）**：`cargo test -p app-server --lib fuzzy_file_search` **3/3**；
  `cargo test -p app-server --test fuzzy_file_search_jsonrpc` **1/1**（indices 仍为 `[4,5,6]`，
  相对路径与 `file_name` 契约不变）；`rustfmt --check` 通过。
- **命名口径（用户要求）**：不再在代码/工具中出现 `Codex`、`codex-rs`、`copy` 字样。源码归属注释
  统一改为 `Adapted from upstream ...` 并保留 revision 与 `licenses/OpenAI-NOTICE.txt` 指针；
  对齐审计脚本/产物更名为 `scripts/app-server/upstream-alignment-audit.mjs`、
  `internal/refactor/upstream-alignment-audit.json`，npm 脚本为 `inventory:upstream-alignment`。
  绝对路径中的上游目录名属于文件系统事实，保留。

- **2026-11-11 第三十一轮（TUI 全量套件与一个时序缺陷）**：`cargo test -p tui --lib` 全量
  **1884 项**中 1883 项稳定通过；`tui::event_stream::tests::queued_paste_survives_slow_consumption_and_fair_draws_on_all_surfaces`
  在整机有并发负载时约 2/3~5/6 概率失败（单独运行 5/5 通过）。失败有两种表现：
  1. 每个 Draw 必须 flush paste burst 的断言在 keys≈draws 时失败；
  2. 最终渲染仍看到原始 burst 文本而非原子粘贴标签。
  两次尝试（放宽 draw 计数、把固定 25ms 等待改为 2s 有界轮询）都不能消除，已**全部回退**，
  不留下被削弱的测试。根因判断：burst flush 依赖宿主时钟，并发负载下流的事件交错与渲染时机
  变化；属测试时序假设与该实现（时钟注入缺失）的问题，需要专门的确定性时钟/显式 tick 方案，
  不能靠放宽断言掩盖。**当前口径**：TUI 全量门禁记为“1883/1884，含 1 个已知时序缺陷”，
  不宣称全绿。

- **2026-11-11 第三十二轮（TUI 时序用例的确定性尝试）**：针对上一轮的 paste-burst 时序用例又做了三组
  实验：显式传入更晚的 flush 时刻、在调用点注入固定步进的输入时钟、放宽 draw 计数。结果：前两组仍无法
  稳定（调用点时钟不足以覆盖 burst 检测对帧调度与内部状态的真实时间依赖），第三组会掩盖真实行为；
  全部回退，工作树未保留被削弱的断言。结论：需要把可注入时钟下沉到 composer/paste-burst owner，
  而不是在测试调用点伪造时间；在该改造完成前，TUI 全量口径维持 “1883/1884，含 1 个已知时序缺陷”。

- **2026-11-11 第三十三轮（TUI 门禁隔离）**：确认 `queued_paste_survives_slow_consumption_and_fair_draws_on_all_surfaces`
  的失败来自 burst 检测读取宿主时间（调用点注入无法覆盖），在人为负载下不稳定。按“不削弱断言、
  不掩盖行为”的原则，将该用例显式 `#[ignore]`（附原因注释），保留 `--ignored` 可手动执行；
  其余 1883 项全量连续 3 轮 **0 失败**。计划中登记为**隔离待修**，不计入 paste 原子性覆盖；
  后续需把时钟注入下沉到 composer/paste-burst 后恢复该用例。
- **当前 TUI 口径**：`cargo test -p tui --lib` **1883 passed / 0 failed / 1 ignored**（连续 3 轮）；
  不能表述为“全绿无缺口”，ignored 项必须与追踪项一起报告。

- **2026-11-11 第三十四轮（纠偏：撤销 doctor）**：`npm run test:contracts` 暴露两处治理冲突，均来自
  第二十四至二十八轮的 `doctor` 改动：
  1. `cli-boundary` 明确把 `Doctor(` 列为 retired 变体，重新加入属于恢复已退役命令；
  2. CLI crate 不允许依赖 `lime-core`，而 doctor 的数据目录检查引入了该依赖。
  已**完整撤销** doctor 命令、相关测试、`lime-core` 依赖与导入；`governance:cli-boundary` 通过，
  `cargo test -p cli` 通过（8 项），`npm run test:contracts` **整体通过**。
  结论：doctor 不属于当前对齐面；若未来要提供诊断入口，需先改治理决策并在计划中登记理由，
  不能以“功能对齐”为由绕过 retired 名单。
- **当前口径**：TUI `1883 passed / 1 ignored`（时序用例隔离待修）；CLI 命令面维持 `agents` 等已批准项；
  契约与治理门禁全绿。

- **2026-11-11 第三十五轮（解除 TUI 隔离）**：把该用例的三个时间消费点（draw tick、key 处理、
  final flush）统一改为本地逻辑时钟 `input_now`（每事件 +1ms，flush 前 +200ms），不再读取
  `stream.input_time()` 或固定 sleep 决定时序；严格断言（每个 draw 必须 flush、`draws == keys-1`）
  原样保留，`#[ignore]` 已移除。整机全量 **1884/1884 连续 3 轮通过**（本轮累计 9 轮通过）。
  修正第三十二轮的判断：调用点逻辑时钟是有效手段，之前失败来自同一补丁里的其它改动组合；
  阻塞式 stall 仍保留为真实停顿，但不推进逻辑时钟（已在注释中写明）。
- **当前 TUI 口径**：`cargo test -p tui --lib` **1884 passed / 0 failed / 0 ignored**。

- **2026-11-11 第三十六轮（重构边界复核）**：
  1. 复核 `lime-server`（12.8k，零消费者、无 bin）是否可删：`internal/bussniss/lime-oem-cloud-phase1-plan.md`
     明确把 `lime-rs/crates/server` 列为 OEM 网关层“直接复用”资产，属于**计划内休眠**而非死代码，
     因此保留，并从删除候选中移除；审计仍将其标为 unreachable，但不再作为清理目标。
  2. 复核 `execpolicy` 与上游的剩余差异：均绑定上游新增的 reviewer 语义（`Decision::PromptUser`）
     或规则语法（`PrefixPattern.canonical_matching`），需要产品决策与消费者迁移，不能机械同步；
     本轮未改动该 crate，基线 `cargo test -p execpolicy` **34 项通过**。
  3. 更新 `upstream-alignment-audit` 的 owner 映射：`file-search`、`permissions`、`utils-path-uri`
     标为 equivalent；重跑审计。
- **结论**：结构性对齐已进入“每个剩余差异都牵涉产品语义”的阶段；后续优先做有明确上游证据、
  可独立验收的小切片，避免再发起无法收口的整块抽取。

- **2026-11-11 第三十七轮（Windows ACL 评估与版本门禁）**：评估把 `execution_process/windows_acl.rs`
  的 ACL 计划改为消费 `lime-permissions` 的 `resolve_for_enforcement`（与 macOS/Linux 同一策略 owner）。
  结论：这是安全关键路径，且本机只能在 Windows 目标做编译检查、无法运行验证，改写 ACL 语义后
  没有运行时证据，风险不可接受；**暂缓**，需 Windows 环境与 Gate B 后再做。
  版本一致性门禁 `npm run verify:app-version` 通过（1.173.0）。跨 crate 的合并回归因用户并行编译
  app-server 集成测试占用 target 锁而中止；各 crate 的独立结果沿用前几轮记录（core 538、
  thread-store 35、permissions 65、patch-apply 21、file-search 18、execpolicy 34）。
- **方向请求**：结构性抽取已到“需要产品语义决策”的边界，Windows 改写需要 Windows 验证环境；
  下一轮请明确优先级（Windows 策略 / GUI 盘点 / 其他），或由我按“可独立验收的小切片”继续。

- **2026-11-11 第三十八轮（GUI 表面台账刷新 + 治理回归修复）**：
  1. `governance/surfaces.yml` 原有 25 条规则中 19 条指向已不存在的文件（channels 旧页、openclaw、
     tauri-event、smart-input 等），已按现役事实重建为 12 条 current：App/RootRouter/AppSidebar/
     AppPageContent/AgentChatWorkspace/ImConfigPage/settings sections/appearance/channels debug/
     channelsRuntime/update-notification；渠道管理 owner 更正为 `src/components/channels/ImConfigPage.tsx`。
     注意 `governance/` 在 `.gitignore` 内，该台账是本地文件，不入库；入库的是下一条的 catalog/测试修复。
  2. 修复第十三轮删除 `core/src/database/dao/agent.rs` 遗留的治理回归：`legacySurfaceCatalog.json`
     的 2 处 `allowedPaths` 去掉已删路径；把“必须存在 AgentDao 旧 API”的测试改为**回流守卫**
     （文件不得存在，`dao/*.rs` 不得再出现 `AgentDao`）。
- **验证（第三十八轮）**：`surfaces.yml` 解析出 12 条规则且全部指向现存文件；`legacySurfaceCatalog.test.ts`
  229/229；`npx vitest run src/lib/governance` **52 文件 / 460 项全通过**（期间一次 3 项失败为并发负载下
  的超时抖动，重跑通过）。

- **2026-11-11 第三十九轮（KPI 口径修正 + GUI 现状确认）**：
  1. 复核 `app-server-daemon`：零消费者，但被 `internal/roadmap/appserver/service-extraction.md`
     与 `internal/roadmap/appserver/implementation-plan.md` 明确保留为 sidecar 管理组件，属计划内休眠；
     与 `lime-server` 一样不做删除。
  2. `upstream-alignment-audit` 增加 `dormant-by-plan` 状态与计划路径，日志拆分为
     `unreachable / pendingWiring / dormantByPlan`；当前结果：**unreachable=0、pendingWiring=0、
     dormantByPlan=2**。此前 `deadCrates=2` 的口径会误导为“可删死代码”，已纠正。
  3. GUI 侧确认：`internal/exec-plans/codex-desktop-home-hero-20261110.md` 正在推进首页 Hero 且
     有明确未完成项（项目选择器接线、git/非 git 文案分支、像素级并排验收）；本轮不改 GUI 代码，
     避免与在写切片冲突。
- **验证（第三十九轮）**：`npm run inventory:upstream-alignment` 通过，JSON 中两条休眠 crate 均带
  `plan` 路径；审计脚本 `node --check` 通过。

- **2026-11-11 第四十轮（CLI 账本纠错：MCP OAuth logout）**：`cli-codex-test-inventory.md` 原先写着
  `mcpServer/oauth/logout` 协议缺失、CLI 明确失败；实际核对：protocol 常量/参数/响应与 catalog、
  App Server dispatch 与 `local_data_source/mcp.rs::logout_oauth`、MCP manager `logout_oauth`、
  CLI `mcp logout` 均已存在，已有 App Server 用例 `mcp_oauth_logout_returns_removal_state`。
  已把该段改为“已接通”，并把剩余缺口限定为**真实 OAuth 服务的 Gate B**（需要可达的
  streamable_http 授权服务），本地单测不替代该证据。
- **验证（第四十轮）**：`cargo test -p app-server --lib mcp_oauth_logout` 1 项通过；
  `cargo test -p cli mcp` 7 项通过；`node --check` 不涉及。

- **下一刀（按收益/风险排序）**：
  1. `sandboxing` owner 对齐：把 Codex `sandboxing` 复制进 `tool-runtime` 现役沙箱 owner，
     替换手写 seatbelt 字符串与自研 Windows WFP；窄写集 `lime-rs/crates/tool-runtime/src/sandbox*`、
     `tool-runtime/Cargo.toml`、`licenses/`、本计划；退出条件是同一 policy 在三平台 fail closed，
     CLI/TUI/App Server 共用同一执行路径。
  2. 持久化 owner 收敛：`thread-store` 吸收 `app-server/runtime/canonical_rollout` 与
     `core/src/database` 的会话 DAO，消除三处写入。
  3. `exec-server` 评估：确认进程内执行是否需要换成 Codex 的 JSON-RPC 执行边界，先出架构图再动代码。
  4. `app-server` 体量：85 个文件超 1000 行，先按 runtime/projection/rollout 拆 crate，再谈逐文件拆分。
  以上每一刀都要同时给出 CLI/TUI/GUI 三个 surface 的无回归证据（三者共用同一 App Server 与
  RuntimeCore，不得为某个 surface 建第二 runtime）。
