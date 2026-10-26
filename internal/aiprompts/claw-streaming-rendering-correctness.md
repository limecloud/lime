# Claw Streaming Rendering Correctness

本文约束 Claw / Agent Runtime 主聊天的 reasoning、工具调用、WebSearch / WebFetch 与最终正文流式展示。目标是把展示正确性绑定到结构化事件生命周期，而不是正文内容猜测。

## 建模盘点

Lime 已经建模 typed event / message parts / tool state；当前问题不是缺协议，而是旧 fallback 仍在局部绕过这些事实源。

- typed event：`src/lib/api/agentProtocol.ts` 的 `AgentEvent` 是 App Server current stream event 的前端事实源，包含 `type`、`sequence`、`session_id`、`thread_id`、`turn_id`、`itemId`、`phase` 等 envelope / lifecycle 字段。
- message parts：`src/components/agent/chat/types.ts` 的 `ContentPart[]` 是 MessageList inline renderer 输入，覆盖 `text`、`thinking`、`tool_use`、`action_required`、`file_changes_batch`，并通过 `metadata` 保留 `source / sequence / turnId / itemId / phase` provenance。
- tool state：`AgentToolCallState`、`AgentThreadToolCallItem`、`AgentThreadItem` 与 `agentStreamRuntimeHandler` 里的 `toolLogIdByToolId / toolStartedAtByToolId / toolNameByToolId` 共同承载工具 lifecycle 和完成态 read model。
- 主要缺口：`Message.content` 字符串、无 metadata text part、无 phase `text_delta` 与 `AgentStreamTextOverlayStore` 仍承担 legacy fallback。修复方向是把这些 fallback 收敛到 process boundary / terminal reconcile，而不是按自然语言正文重建 lifecycle。
- 内容工厂、普通 Claw 聊天和 WebTools GUI fixture 必须走同一套 typed event / `ContentPart[]` / tool state 投影，不得为内容工厂保留特殊搜索合并规则。

## 事实源

`current` 事实源是 App Server current stream event / thread item 的 `sequence + turnId + itemId + phase + type`，以及前端 `ContentPart.metadata` 中保留的 provenance。

- `current`：`agentStreamRuntimeHandler.ts`、`agentStreamProcessBoundaryCommit.ts`、`agentStreamCompletionController.ts`、`messageListTimelineContentParts.ts`、`streamingContentPartOrder.ts`、`streamingContentPartSegments.ts`、`contentPartTimeline.ts`。
- `current`：Rust reply policy 的 text delta batching 事实源是 `lime-rs/crates/agent/src/request_tool_policy/stream_text_batcher.rs`；中心执行器只能在 provider / newline / backlog / final boundary 调用 flush，不得重新散落文本拼接策略。
- `current`：Rust reply policy 的 WebSearch / WebFetch 过程状态事实源是 `lime-rs/crates/agent/src/request_tool_policy/web_retrieval_process.rs`；中心执行器只能消费其 `should_emit_synthesis_status()` 结果并发 runtime status，不得重新散落 web tool 完成计数和 final text started 判断。
- `current`：Rust reply policy 的 empty final reply / WebSearch synthesis / intermediate conclusion retry 决策事实源是 `lime-rs/crates/agent/src/request_tool_policy/reply_retry.rs`；中心执行器只能调用 `resolve_reply_retry_mode(...)`、`should_synthesize_web_search_after_enough_evidence(...)` 与错误消息 builder，不得重新保留同名判断、阈值常量或正文检测函数。
- `current`：Rust reply policy 的 WebSearch preflight 事实源是 `lime-rs/crates/agent/src/request_tool_policy/web_search_preflight.rs`；中心执行器只能调用 `execute_web_search_preflight_if_needed(...)` 与 `merge_system_prompt_with_web_search_preflight_context(...)`，不得把 preflight query 构造、URL 提取、coverage summary、prompt appendix 或 turn context 权限检查重新散回中心文件。
- `current`：Rust reply policy 的 request policy config 事实源是 `lime-rs/crates/agent/src/request_tool_policy/policy_config.rs`；中心执行器只消费解析后的 `RequestToolPolicy`，不得重新散落 `search_mode` 解析、工具白/黑名单 env parsing、工具名归一匹配或 request policy system prompt 合并逻辑。
- `current`：Rust reply policy 的 runtime status 事实源是 `lime-rs/crates/agent/src/request_tool_policy/runtime_status.rs`；中心执行器只能调用 status builder 与 `emit_runtime_status_with_projection(...)`，不得重新散落 retry / synthesis / web retrieval status 文案、checkpoint 或 runtime item 持久化投影逻辑。
- `current`：Rust reply policy 的 Agent 自动压缩事件投影事实源是 `lime-rs/crates/agent/src/request_tool_policy/auto_compaction_projection.rs`；中心执行器只能消费 `AutoCompactionProjectionState::project_event(...)`，不得重新散落自动压缩 system notification 过滤、disabled context limit 错误投影或 compaction failure 文案提取。
- `current`：live `message.delta/text_delta` 必须保留 `itemId/phase/sequence/turnId`；显式 `phase=final/final_answer` 且带 `itemId` 的 delta 必须像 commentary 一样进入 `Message.contentParts` 的结构化 text part，不能只停留在 streaming overlay。只有“整轮没有 process boundary”的旧无 phase 文本可进入 assistant final overlay / `Message.content`。如果旧无 phase 文本早于后续 tool / reasoning / plan / action 这类 process boundary，到达 process boundary 时必须先提交为普通 pre-boundary text part 并清除 overlay；它不是最终答复，也不是 commentary thread item。process boundary 之后再到达的旧无 phase / item-scoped legacy 文本必须 fail closed：不进入 final answer，不因缺少 `sequence` 绕过边界。
- `current`：App Server read model / thread item projection 必须保留 agent message `itemId + phase`；同一 `itemId` 的 delta 按 item lifecycle 合并，不能按 turn 级全局文本缓冲合并。
- `current`：live `Message.contentParts` 一旦已经持有结构化 process flow，它就是该 assistant message 的 inline renderer owner；history / timeline hydrate 只能作为稀疏补丁补入缺失的 reasoning / commentary / turn summary，不得再用 timeline 重新生成另一组 WebSearch / WebFetch / tool process 替换 live 组。
- `current`：没有 inline owner 时，timeline 只有包含工具、命令、计划、审批、用户输入请求等结构化 process boundary，才允许构造成完整 inline process flow；纯 reasoning / commentary timeline 不得抢占 renderer owner，必须保留安全思考入口或外置执行轨迹。
- `compat`：历史 `Message.content` 字符串和无 metadata 的 text part，只能作为旧历史兜底。
- `deprecated`：同类型直接合并、completion suffix 盲追加到最后 text、只靠正文签名去重。
- `dead`：通过“已完成思考”、搜索文案、新闻正文、`Finding` 等自然语言正文或展示文案正则识别 reasoning / search / final answer。

Renderer 只渲染 `ContentPart[]`，不负责排序、去重或生命周期语义判断。

## Invariant

1. `reasoning_delta` 只能更新 active reasoning / thinking，不得进入 assistant final text。
2. reasoning 只有收到 item completed / final summary 后，才允许显示 completed reasoning block。
3. tool / action / file changes / thinking 都是 process boundary；assistant text 不得跨这些边界盲合并。
4. 带 `sequence` 的 text / thinking / tool / action 必须按 sequence 在同一 process run 内排序；缺 sequence 的 part 只能保留到达顺序。
5. text 只有同 provenance、同 `turnId`、同 `itemId`、同 `phase`、同 source 且没有 process boundary 时才允许合并；无 provenance 的旧 text 只允许与相邻无 provenance text 合并。
6. completion reconcile 只能补缺失 suffix；如果最后 text 的 sequence 早于前面的 process boundary，不得把 suffix 追加到该 text。
7. tool / reasoning 这类需要最终答复的 process boundary 之后，必须出现结构化 assistant text delta，或有 artifact / site export / task file 等真实产物信号；工具完成、reasoning 完成、`turn_completed.text` 终态标记本身都不等于 final answer。
8. live streaming 与 thread history hydrate 必须投影成同构 `ContentPart[]`。
9. 有 provenance / sequence 的 current content part 不进入旧的工具叙述正文正则清理路径。
10. streaming overlay 不是全局“当前助手文本”缓冲；overlay 只允许承载 final answer 的可见增量，或 process boundary 尚未出现前的 legacy 可见尾部；一旦该文本被提交进 `ContentPart[]` 或被判定为非 final，必须清除 overlay，避免过程后重复显示。
11. `legacy_unphased` / `item_scoped_legacy` 文本只能在未遇到 process boundary 时作为旧流 final fallback。若它早于 process boundary 到达，则在边界前提交为普通 text part，保留到达顺序；若它晚于 process boundary 到达且没有显式 final phase，则 fail closed。只有显式 `phase=commentary` 的 agent message 才能作为 commentary thread item 展示。
12. provider stream 长时间无结构化事件时，必须由 App Server / Agent current 主链返回 retryable tail failure 或 `turn.failed`，不得让 session / turn 永久停留在 `running`；前端不得用固定 timeout 合成完成态。idle guard 必须同时覆盖 provider stream 已创建后的 `next()` 空闲，以及首个 provider 事件前卡在内部 stream poll 的情况。
13. 完成态 hydrate 不得切换到第二套过程渲染事实源：输出中按时序形成的 `contentParts` 必须继续作为完成后的 renderer 输入；timeline 只允许补缺失的稀疏过程项，不允许重建完整工具组。
14. inline owner 与 timeline owner 必须互斥：`contentParts` 已有过程边界时，timeline 只能 sparse patch；`contentParts` 没有过程边界时，只有带真实 process boundary 的 timeline 才能成为 inline owner。纯 reasoning timeline 不能让“思考中 / 执行轨迹”消失。
15. `phase=final_answer` 的 live 文本不得先用 overlay 临时显示、完成后再由 completion controller 重算。它必须在 streaming 阶段就以 `itemId + phase + sequence` upsert 到同一条 `contentParts` 序列；overlay 只服务无结构化 item 的 legacy final tail。

## 测试门槛

- `streamingContentPartSegments.unit.test.ts`：provenance text 不合并、无 provenance text 可合并、thinking 增量重叠合并。
- `streamingContentPartOrder.unit.test.ts`：sequence-bearing text / thinking / tool 排序，缺 sequence 不跨 run 重排。
- `agentStreamCompletionController.test.ts`：final suffix 不追加到早于 process boundary 的 text；tool / reasoning 后没有 assistant final text 时 fail closed。
- `agentStreamTextDeltaLifecycle.unit.test.ts`：process boundary 后无 sequence 的 legacy delta 也不得进入 final overlay；显式 `phase=final_answer` 不受影响；纯旧 provider 在整轮没有 process boundary 时保留兼容 fallback。
- `agentStreamRuntimeHandler.unit.test.ts`：工具先到、早期 text 后到、后续 text 再到的乱序事件；工具完成后没有最终正文不能把工具前开场白当完成；工具边界前 legacy text 必须提交为普通 pre-boundary text part 并清除 overlay，不得伪装为 commentary 或最终答复；显式 `phase=final_answer` 在 `turn_completed` 前已经进入结构化 `contentParts`，且不依赖 overlay。
- `messageListItemProjection.webRetrieval.unit.test.ts`：完成后同时存在 live `contentParts` 与 remote `timelineItems` 时，renderer 必须以 `contentParts` 为 owner，只允许 timeline reasoning / commentary 稀疏补丁进入同一过程流。
- `MessageList.reasoningFlow.test.tsx`：WebTools 已由 inline `contentParts` 持有时，完成态不得再出现 `assistant-primary-timeline-shell` / `agent-thread-timeline:leading` 第二组过程流；纯 reasoning timeline 仍保留首字状态或外置执行轨迹。
- `StreamingRenderer.webSearch.sequence.test.tsx`：WebSearch / WebFetch / thinking / text 的 collapsed 与展开态顺序。
- `streamingProjectionGuard.unit.test.ts`：核心投影文件不得重新引入展示文案或内容正则生命周期判断。

Agent Runtime / Claw chat 主路径改动至少跑 `npm run smoke:agent-runtime-current`；按受影响的 GUI 输入、工具或恢复边界补充定向回归。
修复 provider idle / 无法完成任务类问题时，还必须跑 `cargo test --manifest-path "lime-rs/Cargo.toml" -p lime-agent stream_message_reply_with_policy_should -- --nocapture`，覆盖取消、tail failure retry、provider idle retry、首事件前 provider idle fail-closed 与 App Server current fixture 完成态。
修复 WebSearch preflight / synthesis / web tool 排版时，还必须跑 `cargo test --manifest-path "lime-rs/Cargo.toml" -p lime-agent web_search_preflight -- --nocapture`、`cargo test --manifest-path "lime-rs/Cargo.toml" -p lime-agent web_search_synthesis_boundary -- --nocapture` 与 受影响的现役工具展示回归。
修改 request policy config / `search_mode` / `web_search` 解析时，还必须跑 `cargo test --manifest-path "lime-rs/Cargo.toml" -p lime-agent request_tool_policy -- --nocapture`，并补 App Server / scheduler 的调用方定向测试，证明 public re-export 和 system prompt 合并链路没有漂移。
修改 runtime status 或 auto compaction projection 时，还必须跑 `cargo test --manifest-path "lime-rs/Cargo.toml" -p lime-agent request_tool_policy -- --nocapture` 与 `npm run smoke:agent-runtime-current`；若 WebSearch / WebFetch 过程状态或完成排版受影响，再补 受影响的现役工具展示回归。

## E2E 诊断护栏

- GUI listener 与 smoke / 诊断 probe 不得直接争抢同一个消费式 `app_server_drain_events` 通道。
- 正式前端 `AppServerEventBus` 仍使用默认 destructive drain，保持单一 GUI 事件投影。
- 只有 smoke / 诊断路径可以显式传 `includeRecent=true`，读取 Electron Host bounded recent notification replay；该 replay 只用于第二观察者校验，不是新的生产事件源。
- 诊断 probe 必须断言结构化 lifecycle：同一 turn 内至少观察到 `tool.started`、`tool.result` 与 `turn.completed`，不能用最终正文、搜索文案或展示文案推断工具生命周期。
