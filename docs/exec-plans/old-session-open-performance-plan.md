# 旧会话打开性能优化计划

## 目标

降低打开旧对话的首帧等待和后续 invoke 争抢，优先保证旧会话能快速显示目标会话与最近消息，再逐步补齐历史与执行轨迹。

## 当前进度

- `P0` 已完成：所有非显式全量的 `getSession` 调用补齐 `historyLimit: 40`，避免静默恢复和 missing-from-topics 校验拉取全量历史。
- `P1` 已完成：会话元数据 fallback 回填合并为一次 `updateSessionMetadata`；无本地快照切换时先进入目标会话 hydrating shell；侧边栏 focus refresh 降低为 idle 后台任务。
- `P2` 已推进：加载更多历史已从递增 tail window 改为分页加载；首屏返回最近 `40` 条并带 `history_cursor.oldest_message_id`，加载更早历史时优先用 `historyBeforeMessageId` cursor，每次请求 `50` 条，`historyOffset` 保留为兼容 fallback；历史会话的 MessageList 首帧先渲染文本，timeline 在 idle 后补齐；timeline turn 绑定减少中间数组分配；折叠的 `AgentThreadTimeline` 明细改为展开时再物化；旧历史中已完成的单步 timeline 明细默认只渲染摘要，展开时再物化；已排序的 turn/thread item 不再重复复制排序。
- `2026-04-29` 追加收口：过大的旧会话 transient / persisted snapshot 在恢复前直接丢弃；读取命中的会话快照不再同步刷新 `lastAccessedAt` 以避免点击时重写整张 snapshot map；历史消息与流式 text_delta 统一做 overlap 合并，修复累计快照式 delta 导致的重复吐字；完成态旧消息的执行过程与正文视觉分离，历史 timeline 默认折叠明细；浏览器 DevBridge 模式下跳过低优先级 metadata backfill，并且仅在活跃运行时订阅 team SSE，避免旧会话点击后抢占 bridge 连接。

## 剩余事项

- Cursor 分页已完成：`agent_runtime_get_session` 继续作为 current 主链，新增 `historyBeforeMessageId` 请求字段与 `history_cursor` 响应字段；无 cursor 或缓存恢复缺少 cursor 时继续 fallback 到 `historyOffset`。
- 若用户仍反馈旧会话卡顿，再对 `AgentThreadTimeline` 内部渲染和 thread item 展开策略做专项测量。
- 若后续仍有 CPU / 内存尖峰，下一刀优先检查真实旧会话中是否存在超长 artifact / markdown 表格渲染，以及 `StreamingRenderer` 首屏 markdown 解析成本。
- `verify:local` 已完成通过；此前内嵌 smoke / 后续 smoke 重试中遇到的 DevBridge `fetch failed` 与临时 target 链接 `liblime_lib.dylib` 打开失败，已通过后续重跑消除，按历史环境/并发构建插曲保留记录。

## 验证记录

- `npm test -- src/components/agent/chat/utils/threadTimelineView.test.ts src/components/agent/chat/components/MessageList.test.tsx` 通过。
- `npm test -- src/components/agent/chat/hooks/agentRuntimeAdapter.test.ts src/components/agent/chat/hooks/agentSessionRefresh.test.ts src/components/agent/chat/hooks/useAsterAgentChat.test.tsx src/components/AppSidebar.test.tsx src/components/agent/chat/components/MessageList.test.tsx src/components/agent/chat/utils/threadTimelineView.test.ts` 通过。
- `npm run typecheck` 通过。
- `npm run lint` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml -p lime-services` 通过；期间修正 `api_key_provider_service.rs` 对运行时 Provider DTO 的显式导入，避免旧凭证池模型导出边界影响编译。
- `npm run verify:gui-smoke` 通过。
- `npm run generate:agent-runtime-clients` 通过，已更新 `agent_runtime_get_session` generated manifest。
- `npm test -- src/components/agent/chat/hooks/agentChatHistory.test.ts src/components/agent/chat/hooks/useAsterAgentChat.test.tsx` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml -p lime-core tail -- --nocapture` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml -p lime-agent history_tail -- --nocapture` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml -p lime-agent get_session_sync_with_history_limit_should_tail_persisted_history -- --nocapture` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml normalize_runtime_session_history -- --nocapture` 通过。
- `npx eslint "src/lib/api/agentRuntime.ts" "src/lib/api/agentRuntime/*.ts" "src/components/agent/chat/hooks/agentChatHistory.ts" "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" --max-warnings 0` 通过。
- `npm run test:contracts` 通过。
- `npm run generate:agent-runtime-clients` 通过，已同步 `historyBeforeMessageId` generated manifest。
- `npm test -- src/components/agent/chat/hooks/agentChatHistory.test.ts src/components/agent/chat/hooks/useAsterAgentChat.test.tsx` 通过（新增 cursor 起始索引与加载更早历史 cursor 请求断言）。
- `npm test -- src/lib/api/agent.test.ts src/components/agent/chat/hooks/agentRuntimeAdapter.test.ts` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml -p lime-core tail -- --nocapture` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml -p lime-agent history_tail -- --nocapture` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml -p lime-agent get_session_sync_with_history_limit_should_tail_persisted_history -- --nocapture` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml normalize_runtime_session_history -- --nocapture` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml should_skip_runtime_queue_snapshots_for_cursor_history_page -- --nocapture` 通过；首次重跑曾撞到并发修改/编译中的 `runtime_evidence_pack_service.rs`，随后重跑通过。
- `npx eslint "src/lib/api/agentRuntime.ts" "src/lib/api/agentRuntime/*.ts" "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/agent/chat/hooks/agentChatHistory.ts" --max-warnings 0` 通过。
- `npm run typecheck` 通过。
- `npm run test:contracts` 通过。
- `npm run verify:local` 前置检查、前端测试、Rust 全量测试均通过；最后内嵌 `verify:gui-smoke` 因 DevBridge `fetch failed` 中断。
- `npm run verify:gui-smoke` 后续重试在 headless Tauri 链接阶段失败，关键错误为临时 target 下 `liblime_lib.dylib` 打开失败；同命令此前已单独通过。
- `npm test -- src/components/agent/chat/components/AgentThreadTimeline.test.tsx src/components/agent/chat/components/MessageList.test.tsx` 通过。
- `npx eslint "src/components/agent/chat/components/AgentThreadTimeline.tsx" "src/components/agent/chat/components/AgentThreadTimeline.test.tsx" "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" --max-warnings 0` 通过。
- `npm test -- src/components/agent/chat/utils/threadTimelineView.test.ts src/components/agent/chat/components/MessageList.test.tsx` 通过。
- `npx eslint "src/components/agent/chat/utils/threadTimelineView.ts" "src/components/agent/chat/utils/threadTimelineView.test.ts" "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" --max-warnings 0` 通过。
- `npm run typecheck` 通过。
- `npm run verify:local` 通过；覆盖 `verify:app-version`、`lint`、`typecheck`、全量前端测试、`test:contracts`、全量 Rust 测试与内嵌 `verify:gui-smoke`。
- `npm test -- src/components/agent/chat/components/AgentThreadTimeline.test.tsx src/components/agent/chat/components/MessageList.test.tsx` 通过（新增旧历史单步 timeline 展开后再物化明细断言）。
- `npx eslint "src/components/agent/chat/components/AgentThreadTimeline.tsx" "src/components/agent/chat/components/AgentThreadTimeline.test.tsx" "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/MessageList.test.tsx" --max-warnings 0` 通过。
- `npm run typecheck` 通过。
- `npm run verify:gui-smoke` 通过。
- `npm test -- src/components/agent/chat/components/AgentThreadTimeline.test.tsx src/components/agent/chat/components/MessageList.test.tsx src/components/agent/chat/hooks/agentChatHistory.test.ts src/components/agent/chat/hooks/agentChatStorage.test.ts src/components/agent/chat/hooks/agentSessionScopedStorage.test.ts src/components/agent/chat/hooks/useAgentRuntimeSyncEffects.test.tsx src/components/agent/chat/hooks/useAsterAgentChat.test.tsx` 通过（7 files / 293 tests）。
- `npx eslint "src/components/agent/chat/hooks/useAgentSession.ts" "src/components/agent/chat/hooks/useAgentRuntimeSyncEffects.ts" "src/components/agent/chat/hooks/useAgentRuntimeSyncEffects.test.tsx" "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" "src/components/agent/chat/hooks/agentChatHistory.ts" "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts" "src/components/agent/chat/hooks/skillCommand.ts" "src/components/agent/chat/components/MessageList.tsx" "src/components/agent/chat/components/AgentThreadTimeline.tsx" "src/components/agent/chat/hooks/agentChatStorage.ts" "src/components/agent/chat/hooks/agentSessionScopedStorage.ts" "src/components/agent/chat/hooks/agentChatHistory.test.ts" "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/components/AgentThreadTimeline.test.tsx" "src/components/agent/chat/hooks/agentChatStorage.test.ts" "src/components/agent/chat/hooks/agentSessionScopedStorage.test.ts" --max-warnings 0` 通过。
- `npm run bridge:health -- --timeout-ms 120000` 通过，DevBridge `/health` 约 `20ms` 就绪。
- Playwright E2E（`http://127.0.0.1:1420/`）：连续切换 `E2E layout anchor -> 你好！👋 很高兴见到你！ -> 你好！有什么我可以帮你的吗？😊 -> E2E layout anchor`，每次 `restoring=0`，耗时约 `109-425ms`，`body/html cursor=auto`，最终 `heap≈121MB`；`assistant-primary-timeline-shell` 高度 `94px`，`openDetails=0`，最终正文不在执行过程 shell 内，未检测到 assistant greeting 重复；等待 `9s` 后 `eventRequests=0`，控制台 `0 error / 1 warning`（仅浏览器模式 i18n 默认语言提示）。
