# Lime v1.148.0 发布执行计划

状态：本地发布门禁与Desktop/CLI/TUI真实Gate通过；候选冻结，执行commit/tag/push
日期：2026-10-01（北京时间）
目标：将当前候选发布为 `v1.148.0`，完成版本同步、双语 release notes、验证、commit、tag、main/tag 推送及远端状态复核。

## 范围与候选

- 起始基线：`v1.147.0`（`1cbc94e5f`），当前 `HEAD` 为 `4d0bb94cf`。
- release metadata：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、`RELEASE_NOTES.md`、`RELEASE_NOTES.en.md`、本计划和 `internal/exec-plans/README.md`。
- candidate changes：当前工作树全部已跟踪改动与未跟踪候选文件，覆盖 TUI 输入/编辑器/Vim、Thread input 与交互恢复、App Server prompt history/turn/queue/projection、协议生成物、CLI/TUI stdio/PTY fixtures、GUI 相关消费测试、文档和结构 inventory。最终完整文件清单见本计划末尾。
- 未发现独立个人实验或临时文件；没有人工排除项。当前 TUI/CLI 对齐总计划仍为 `partial/in-progress`，本计划只记录实际门禁结果，不把未验证切片写成完成。

## 版本事实源

- 目标版本：`1.148.0`；tag：`v1.148.0`；前版：`v1.147.0`。
- Forge 从根 `package.json` 读取版本；pnpm lock 无独立发布版本；Rust workspace 及 Cargo lock 内部包版本同步到 `1.148.0`。
- 双语 release notes 采用当前版本单页策略。

## 验证记录

- [x] `npm run verify:app-version`：版本一致性检查通过，目标为 `1.148.0`。
- [x] `npm run typecheck`：renderer 与 node TypeScript 检查通过。
- [x] `npm run test:contracts`：protocol types 无漂移，App Server client 299 checks、命令/脚本/发布/文档边界守卫通过；`app-server-protocol` crate 133/133 通过。
- [x] TUI：当前library `1450/1450`通过；同工作树完整all-targets `1450 library + 18 integration + 1 dependency guard`和严格Clippy通过，落盘日志 `/tmp/lime-thread-interaction-all-targets-recovery.log`、`/tmp/lime-thread-interaction-clippy-recovery.log`。
- [x] App Server：`npm run test:rust:integration -- -p app-server --test prompt_history_jsonrpc --test user_input_limit_jsonrpc`实际扩大为全部test targets，library `1788/1788`、binary `27/27`及integration全部通过；新增prompt history `2/2`、input limit `1/1`通过。
- [x] 前端定向Vitest：prompt history、current boundary、Codex origin、TUI fixture/结构守卫`64/64`；GUI Inputbar与EmptyState`150/150`通过（已有React act warning）。
- [x] `npm run verify:gui-smoke`：真实Electron/App Server `1.148.0`、重载、3种窗口尺寸、memory settings通过，summary `.lime/qc/project-gates/standalone-shell-01-20261001121857-88407/shell-01-electron-smoke/summary.json`。
- [x] `npm run smoke:cli-gate-b`：fresh当前二进制真实stdio通过，日志 `/tmp/lime-release-v1.148.0-cli-gate-b.log`。
- [x] `npm run smoke:tui-gate-b`：首次新输入断言误将JSON对象键顺序当成数据不同；已改为Node deepStrictEqual，保留全对象字段/数组顺序要求，守卫`22/22`与完整11场景真实PTY复验通过。thread `01a0f76a-4911-7f12-975a-4388bad23e4a`、turn `turn_d0a68acd89294c80b5ace4cf575a9d3e`；thread-input/typed-input实际stdio、queue/edit、agents、notes、images/skills/history、keymap、focus/resize/reconnect与terminal恢复通过。日志 `/tmp/lime-release-v1.148.0-tui-gate-b.log`。
- [x] workspace fmt、`git diff --check`与`git diff --cached --check`；冻结252个文件，`40101 insertions(+), 13389 deletions(-)`。
- [ ] 远端 Actions、Release 资产、npm optional packages 与安装证据

资源限制：此前 `lime-rs/target` 约 103 GiB，已按用户授权删除生成产物以恢复验证空间；源代码与 Git 跟踪文件未删除。

历史失败：related扩展带入既有MCP并发进度测试挂起并终止；直接Cargo入口触发上游V8预编译包404，改用仓库runner的SHA-256校验缓存。首次App Server/TUI和GUI构建因ENOSPC失败，清理生成产物后已补齐上述关键门禁，不把历史失败改写成通过。未执行全仓lint/Vitest/Cargo/Clippy、Windows/MSVC、live provider；跨平台发布以远端结果为准。

## Git 发布门禁

用户已明确“我出去了,我完全授权,不要找我确认,完成发布”。清理生成产物、必要修复、全部候选commit/tag/main与tag推送及发布收口均在该授权内，不再重复询问。冻结候选后复核staged摘要，连续执行全部Git写操作，再复核本地状态、提交和远端引用。

本轮窄写集：release metadata与TUI Gate脚本两处结构化断言修复；其余候选产品源码避让原写入进程，仅验证并纳入发布。

发布提交 `dd9a851a007cd1bbe6c10393b64293f7877e87e1` 已通过 pre-commit hook，`main` 与 `v1.148.0` 已推送并复核远端同SHA。Release run：<https://github.com/limecloud/lime/actions/runs/36861855091>；Quality run：<https://github.com/limecloud/lime/actions/runs/36861825791>。发布后的并发TUI对齐计划改动留在工作树，不并入已冻结tag。

远端 Frontend Full job `110367752138` 已通过 lint、typecheck 与完整Vitest：120批次、1592个测试文件、11282个测试通过，1个既有跳过测试。Integrity、真实GUI smoke与文档部署已通过；Rust/Windows及发布矩阵继续等待远端最终结果。

Electron macOS arm64 job `110367868504` 已通过构建、资源检查、打包native host Gate B与资产上传。Windows x64 job `110367868627` 已通过真实Squirrel安装/N-1升级、CodeMode Gate B、native host Gate B、候选身份检查与资产上传。macOS x64尚在构建，GitHub Release仍保持draft。

## 架构与分类

主链保持 `Desktop Host / CLI-TUI Host -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item -> GUI/terminal projection`。本轮 TUI 输入生命周期与 prompt history identity 收敛复用既有 owner，不新增平行 runtime、历史存储或兼容后端。

- current：TUI/CLI 输入、交互恢复、prompt history、App Server projection、协议/fixture 与发布事实源。
- compat / deprecated：无新增。
- dead / deleted：旧重复输入/附件投影在当前改动中原位替换；本轮不删除文件。

## 候选提交文件清单

全部 252 个文件；release metadata 8 个，candidate changes 244 个；无排除项。

### release metadata

- `RELEASE_NOTES.en.md`
- `RELEASE_NOTES.md`
- `internal/exec-plans/README.md`
- `internal/exec-plans/release-v1.148.0-plan.md`
- `lime-rs/Cargo.lock`
- `lime-rs/Cargo.toml`
- `package.json`
- `packages/cli/package.json`

### candidate changes

- `docs/ops.md`
- `internal/aiprompts/architecture.md`
- `internal/aiprompts/commands.md`
- `internal/exec-plans/tui-cli-codex-sync-next-plan.md`
- `internal/exec-plans/tui-structure-inventory.json`
- `lime-rs/crates/agent-protocol/src/input.rs`
- `lime-rs/crates/app-server-protocol/schema/json/app_server_protocol.schemas.json`
- `lime-rs/crates/app-server-protocol/schema/json/v2/ClientRequest.json`
- `lime-rs/crates/app-server-protocol/schema/json/v2/PromptHistoryAppendParams.json`
- `lime-rs/crates/app-server-protocol/schema/json/v2/PromptHistoryAppendResponse.json`
- `lime-rs/crates/app-server-protocol/schema/json/v2/PromptHistoryEntry.json`
- `lime-rs/crates/app-server-protocol/schema/json/v2/PromptHistoryReadResponse.json`
- `lime-rs/crates/app-server-protocol/src/protocol/v2/prompt_history.rs`
- `lime-rs/crates/app-server-protocol/src/protocol/v2/tests.rs`
- `lime-rs/crates/app-server/src/processor/prompt_history.rs`
- `lime-rs/crates/app-server/src/processor/thread/projection.rs`
- `lime-rs/crates/app-server/src/processor/thread/projection/tests.rs`
- `lime-rs/crates/app-server/src/processor/thread/projection/thread.rs`
- `lime-rs/crates/app-server/src/processor/thread_queue.rs`
- `lime-rs/crates/app-server/src/processor/turn.rs`
- `lime-rs/crates/app-server/src/processor/turn/input.rs`
- `lime-rs/crates/app-server/src/processor/turn/tests.rs`
- `lime-rs/crates/app-server/src/runtime/prompt_history.rs`
- `lime-rs/crates/app-server/src/runtime/turn_start.rs`
- `lime-rs/crates/app-server/tests/config_jsonrpc.rs`
- `lime-rs/crates/app-server/tests/prompt_history_jsonrpc.rs`
- `lime-rs/crates/app-server/tests/thread_control_jsonrpc.rs`
- `lime-rs/crates/app-server/tests/user_input_limit_jsonrpc.rs`
- `lime-rs/crates/core/src/config/mod.rs`
- `lime-rs/crates/core/src/config/tui_keymap.rs`
- `lime-rs/crates/core/src/config/tui_keymap/vim.rs`
- `lime-rs/crates/tui/Cargo.toml`
- `lime-rs/crates/tui/src/app.rs`
- `lime-rs/crates/tui/src/app/agent_center/hints.rs`
- `lime-rs/crates/tui/src/app/agent_center/input.rs`
- `lime-rs/crates/tui/src/app/agent_center/keymap_tests.rs`
- `lime-rs/crates/tui/src/app/agent_center/mod.rs`
- `lime-rs/crates/tui/src/app/agent_center/render.rs`
- `lime-rs/crates/tui/src/app/agent_center_tests.rs`
- `lime-rs/crates/tui/src/app/agent_navigation.rs`
- `lime-rs/crates/tui/src/app/agent_picker.rs`
- `lime-rs/crates/tui/src/app/agent_picker/tests.rs`
- `lime-rs/crates/tui/src/app/agents_overview.rs`
- `lime-rs/crates/tui/src/app/agents_overview_render.rs`
- `lime-rs/crates/tui/src/app/agents_overview_tests.rs`
- `lime-rs/crates/tui/src/app/agents_overview_threads.rs`
- `lime-rs/crates/tui/src/app/agents_overview_view.rs`
- `lime-rs/crates/tui/src/app/app_server_events.rs`
- `lime-rs/crates/tui/src/app/event_dispatch.rs`
- `lime-rs/crates/tui/src/app/history_search_tests.rs`
- `lime-rs/crates/tui/src/app/input_flow.rs`
- `lime-rs/crates/tui/src/app/input_submission.rs`
- `lime-rs/crates/tui/src/app/input_submission_tests.rs`
- `lime-rs/crates/tui/src/app/interaction.rs`
- `lime-rs/crates/tui/src/app/message_history.rs`
- `lime-rs/crates/tui/src/app/message_history_tests.rs`
- `lime-rs/crates/tui/src/app/pending_interactive_replay.rs`
- `lime-rs/crates/tui/src/app/pending_interactive_replay_tests.rs`
- `lime-rs/crates/tui/src/app/reasoning_shortcuts.rs`
- `lime-rs/crates/tui/src/app/reasoning_shortcuts_tests.rs`
- `lime-rs/crates/tui/src/app/right_click_paste.rs`
- `lime-rs/crates/tui/src/app/session_lifecycle.rs`
- `lime-rs/crates/tui/src/app/session_lifecycle_tests.rs`
- `lime-rs/crates/tui/src/app/skills.rs`
- `lime-rs/crates/tui/src/app/startup.rs`
- `lime-rs/crates/tui/src/app/tests.rs`
- `lime-rs/crates/tui/src/app/thread_events.rs`
- `lime-rs/crates/tui/src/app/thread_input.rs`
- `lime-rs/crates/tui/src/app/thread_input_tests.rs`
- `lime-rs/crates/tui/src/app/thread_interaction_tests.rs`
- `lime-rs/crates/tui/src/app/transcript_presentation.rs`
- `lime-rs/crates/tui/src/app/transcript_presentation_tests.rs`
- `lime-rs/crates/tui/src/app_event.rs`
- `lime-rs/crates/tui/src/app_event_sender.rs`
- `lime-rs/crates/tui/src/app_server_session.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/agents_navigation.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/attachment_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/attachment_state_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/completion.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/completion_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/draft.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/draft_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/external_edit.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/footer_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/footer_state_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/history.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/history_response_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/history_search.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/history_search_draft.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/history_search_draft_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/history_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/input.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/input_keymap_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/layout.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/mentions.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/mentions_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/mouse.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/paste_input.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/pending_paste.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/pending_paste_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/popup_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/popup_state_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/reconnect.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/reconnect_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/render.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/render_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/structured_input_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/submission.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/submission_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/vim_history.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/vim_history_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer_history.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer_history/search.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer_history/search_batch.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer_history/search_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer_history/tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/footer.rs`
- `lime-rs/crates/tui/src/bottom_pane/input_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/keymap_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/list_selection_view.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/render.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/schema.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/mod.rs`
- `lime-rs/crates/tui/src/bottom_pane/pending_input_preview.rs`
- `lime-rs/crates/tui/src/bottom_pane/render.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/layout.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/mod.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/render.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/render_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/selection_popup_common.rs`
- `lime-rs/crates/tui/src/bottom_pane/selection_row_layout.rs`
- `lime-rs/crates/tui/src/bottom_pane/shortcut_overlay.rs`
- `lime-rs/crates/tui/src/bottom_pane/shortcut_overlay_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/editing.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/elements.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/elements_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/input.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/input_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/mouse.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/vim.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/vim/input.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/vim/keymap_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/vim/navigation.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/vim_commands.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/vim_commands_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/vim_register.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/vim_register_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/textarea/vim_search.rs`
- `lime-rs/crates/tui/src/clipboard_paste.rs`
- `lime-rs/crates/tui/src/diff_render.rs`
- `lime-rs/crates/tui/src/diff_render/style.rs`
- `lime-rs/crates/tui/src/diff_render/style_tests.rs`
- `lime-rs/crates/tui/src/diff_render/tests.rs`
- `lime-rs/crates/tui/src/entry.rs`
- `lime-rs/crates/tui/src/keymap.rs`
- `lime-rs/crates/tui/src/keymap/agents.rs`
- `lime-rs/crates/tui/src/keymap/editor.rs`
- `lime-rs/crates/tui/src/keymap/editor_tests.rs`
- `lime-rs/crates/tui/src/keymap/list.rs`
- `lime-rs/crates/tui/src/keymap/list_tests.rs`
- `lime-rs/crates/tui/src/keymap/tests.rs`
- `lime-rs/crates/tui/src/keymap/vim.rs`
- `lime-rs/crates/tui/src/keymap/vim_tests.rs`
- `lime-rs/crates/tui/src/lib.rs`
- `lime-rs/crates/tui/src/local_settings.rs`
- `lime-rs/crates/tui/src/locale.rs`
- `lime-rs/crates/tui/src/locale/composer.rs`
- `lime-rs/crates/tui/src/locale/pickers.rs`
- `lime-rs/crates/tui/src/locale/reasoning.rs`
- `lime-rs/crates/tui/src/mention_codec.rs`
- `lime-rs/crates/tui/src/mention_codec_tests.rs`
- `lime-rs/crates/tui/src/model_catalog.rs`
- `lime-rs/crates/tui/src/model_catalog/reasoning.rs`
- `lime-rs/crates/tui/src/model_catalog/reasoning_tests.rs`
- `lime-rs/crates/tui/src/model_picker.rs`
- `lime-rs/crates/tui/src/model_picker/effort.rs`
- `lime-rs/crates/tui/src/model_picker/effort_tests.rs`
- `lime-rs/crates/tui/src/model_picker/input.rs`
- `lime-rs/crates/tui/src/model_picker/keymap_tests.rs`
- `lime-rs/crates/tui/src/model_picker/render.rs`
- `lime-rs/crates/tui/src/model_picker/render_tests.rs`
- `lime-rs/crates/tui/src/resume_picker.rs`
- `lime-rs/crates/tui/src/resume_picker/host.rs`
- `lime-rs/crates/tui/src/resume_picker/input.rs`
- `lime-rs/crates/tui/src/resume_picker/layout.rs`
- `lime-rs/crates/tui/src/resume_picker/render.rs`
- `lime-rs/crates/tui/src/resume_picker/tests.rs`
- `lime-rs/crates/tui/src/resume_picker/tests/keymap.rs`
- `lime-rs/crates/tui/src/resume_picker/tests/navigation.rs`
- `lime-rs/crates/tui/src/resume_picker/tests/rendering.rs`
- `lime-rs/crates/tui/src/resume_picker/tests/toolbar.rs`
- `lime-rs/crates/tui/src/runtime.rs`
- `lime-rs/crates/tui/src/runtime/input_submission.rs`
- `lime-rs/crates/tui/src/runtime/input_submission_tests.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/agent_picker.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/composer.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/diff_display.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/images.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/model_picker.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/pending_paste.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/reasoning_shortcuts.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/request_user_input.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/resume_picker.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/skills.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/thread_input.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/vim_keymap.rs`
- `lime-rs/crates/tui/src/settings.rs`
- `lime-rs/crates/tui/src/style.rs`
- `lime-rs/crates/tui/src/style/contrast.rs`
- `lime-rs/crates/tui/src/style/contrast_tests.rs`
- `lime-rs/crates/tui/src/style/selection.rs`
- `lime-rs/crates/tui/src/terminal_hyperlinks/paragraph.rs`
- `lime-rs/crates/tui/src/terminal_hyperlinks/paragraph_tests.rs`
- `lime-rs/crates/tui/src/terminal_palette.rs`
- `lime-rs/crates/tui/src/terminal_palette/perceptual.rs`
- `lime-rs/crates/tui/src/transcript_view/follow_control.rs`
- `lime-rs/crates/tui/src/transcript_view/follow_control_tests.rs`
- `lime-rs/crates/tui/src/view.rs`
- `lime-rs/crates/tui/src/view/tests.rs`
- `lime-rs/crates/tui/src/view/tests/composer.rs`
- `lime-rs/crates/tui/src/view/tests/navigation.rs`
- `lime-rs/crates/tui/src/view/tests/suggestions.rs`
- `packages/app-server-client/src/generated/protocol-types.ts`
- `packages/cli/README.md`
- `scripts/app-server/terminal-gate-fixture.mjs`
- `scripts/app-server/terminal-gate-fixture.test.mjs`
- `scripts/app-server/tui-composer-structure.test.mjs`
- `scripts/app-server/tui-gate-b.mjs`
- `scripts/app-server/tui-gate-b.test.mjs`
- `scripts/app-server/tui-structure-inventory.test.mjs`
- `src/components/agent/chat/components/EmptyState.tsx`
- `src/components/agent/chat/components/Inputbar/hooks/useInputbarController.ts`
- `src/lib/api/promptHistory.current-boundary.test.ts`
- `src/lib/api/promptHistory.test.ts`
- `src/lib/governance/codexModelResponsesPolicyOrigin.test.ts`
