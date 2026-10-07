# Lime v1.151.0 发布执行计划

状态：GitHub 桌面 Release 已公开，R2 假成功问题已修复并完成真实补发；等待 CLI/npm 完成
日期：2026-10-07
基线：`v1.150.0` / `1236c5e9229c05234b5fe0f3fa4dbe352a63056f`
目标：发布当前 TUI 交互、状态栏、终端标题及共享配置改动，完成版本同步、双语发布说明、必要门禁、release commit、tag 与远端发布核验。

## 写集与候选范围

- 本轮写集：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、`RELEASE_NOTES.md`、`RELEASE_NOTES.en.md`、本计划。
- 门禁修复扩展写集：五语言 `src/i18n/resources/<locale>/{navigation,scheduledTasks}.json`，仅移除扫描和源码审阅共同确认未使用的 26 个键；保留仍由 Sidebar/任务 UI 使用的键，零文件删除。
- candidate changes：当前工作树的 TUI、core TuiConfig、App Server 公共配置测试、GUI 配置 gateway、终端 fixture/结构守卫和关联文档、执行计划；默认全部进入候选，包括未跟踪源码与测试。
- excluded changes：候选冻结时的 132 个路径全部进入本次发布；用户等待确认期间产生的第五十八阶段 token usage 工作树增量明确留在本地，不扩张已确认的候选。忽略目录下日志/缓存/编译产物不进入源码提交。
- 避让已有产品与文档改动，只读审阅和验证；不覆盖 `release-v1.150.0-plan.md` 或 TUI 开发计划。
- 分发阻塞修复写集扩展：`.github/workflows/release.yml`、独立 updater 补发 workflow、`scripts/electron/` 下 S3 上传脚本/回归与发布守卫、`internal/roadmap/appserver/release-updater.md` 及本计划。只修复已发布候选的 R2 分发，不纳入后续 TUI 开发，不移动 release tag。
- 初始盘点 80 个 tracked 改动；随后发现结构化 task-progress 阶段仍在新增文件。用户要求继续后，以当前候选完成最新 Rust/结构/真实 PTY 验收；验证窗口后产品写集稳定。最终 132 个路径分为 7 个 release metadata、101 个 Rust、10 个 i18n、3 个 frontend、5 个 scripts 和 6 个文档/计划；完整列表见下方。用户最终确认将同时确认这份候选冻结范围。

## 退出条件

- [x] 候选写集已在验证窗口稳定，用户于 2026-10-07 回复“继续”，确认发布冻结范围。
- [x] 所有显式应用版本统一为 `1.151.0`，版本一致性验证通过。
- [x] 双语发布说明只保留 v1.151.0，描述实际候选行为（冻结后复核新增切片）。
- [x] `npm run typecheck` 通过。
- [x] `npm run test:contracts` 和受影响 Rust/前端/结构回归通过。
- [x] 真实 CLI/TUI stdio/PTY fixture 验证；执行 GUI smoke，记录真实结果与环境限制。
- [x] 汇总最终 candidate、暂存摘要、验证和排除项，取得 commit/tag/push 危险操作确认。
- [x] 创建 release commit 和 `v1.151.0` tag，推送 main/tag 并核验远端引用。
- [ ] 核验 Release workflow、GitHub Release、updater 与 CLI 发布状态；未完成的分发明确记录。

## 架构确认与分类

候选继续沿用 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item -> GUI/terminal projection`。状态栏/标题使用 TUI presentation owner，共享配置仍经已有 `config/read` 与 `config/batchWrite`，不新增协议后端、私有存储或平行 runtime。已只读复核 `architecture.md` 中共享 picker/config/OSC 与 typed plan -> projection/plans -> status facts 的架构图及责任开发者确认：task-progress 直接消费 canonical checklist，text-only 历史不猜测计数，无新增协议/存储 owner。发布复核责任开发者 root，2026-10-07。

current：TUI 交互、共享 keymap/config、status/title picker、canonical facts 与 managed OSC；compat/deprecated：无新增；dead/deleted：重复布局/保存与旧提示分支已由候选直接迁移，不恢复已退役入口。本轮只同步发版事实源，遵循 KISS/DRY，不新增版本包装层。

## 验证与环境

- `npm run verify:app-version`：通过，根包/CLI/workspace 为 1.151.0；Cargo.lock 的 36 个本地 workspace package 已同步，未改 registry dependency。
- `npm run typecheck`：通过，renderer/node TypeScript 两个项目均完成。
- `npm run test:rust:unit -- -p tui --no-default-features`：1545/1545 通过。
- `npm run test:rust:unit -- -p lime-core tui_keymap --no-default-features`：8/8 通过。
- `npm run test:contracts`：通过，涵盖协议生成物、命令/客户端、harness、modality、脚本、Forge release、Desktop/CLI 和文档边界。
- 前端/结构定向：`npx vitest run src/lib/api/appConfig.test.ts scripts/app-server/tui-composer-structure.test.mjs scripts/app-server/tui-gate-b.test.mjs`，84/84 通过。
- `npm run verify:local` 首轮：失败于 26 个既有未引用翻译键（navigation 20、scheduledTasks 6）。已逐项核对 current consumer 并同步五语言移除；修复后 `npm run i18n:unused` 通过，语言资源定向 13/13 通过。按 release workflow 的定向策略继续验证各边界，未把 local-ci 自动展开的裸全量 lint/test/Rust 矩阵作为默认发布门禁。
- `npm run i18n:check`：五语言 namespace/key 100% 一致，missing/extra 均为 0；受影响 TS/终端脚本 ESLint 与 workspace fmt check 通过。
- 继续执行时初始后台进程和 `/tmp` 日志已不存在；未把这些未收回退出码的公共配置/GUI/CLI 构建视为通过。后续证据日志统一保存到忽略目录 `.lime/releases/v1.151.0/`，当前无 Cargo 并行构建竞争。
- 继续执行后标准 Git SSH 与 GitHub CLI keyring 均可用，远端 main 仍为基线 SHA，目标 tag 不存在；无需临时 transport。公开分发核验使用标准 GitHub CLI。
- 最新 `npm run test:contracts` 再次通过。
- 直接定向 `cargo test --manifest-path "lime-rs/Cargo.toml" -p app-server --test config_jsonrpc`：1/1 通过，覆盖共享 YAML、状态栏/标题 ordered/empty 与 shape 拒绝；使用仓库校验 V8 缓存，未扩大为 App Server 全部测试 target。
- 最新六个定向文件（GUI config、terminal fixture、结构、TUI Gate guard、语言资源）：99/99 通过。
- 最新 `npm run typecheck`、五语言 `i18n:check`、`i18n:unused -- --check`、受影响 ESLint、workspace fmt check 均通过。
- 最新 `cargo test --manifest-path "lime-rs/Cargo.toml" -p tui --all-targets --no-default-features`：1545 unit + 23 suite + 1 dependency guard 通过。
- 最新 `npm run governance:legacy-report`：2068 runtime + 1776 Rust runtime，零引用候选/分类漂移/边界违规均为 0。
- 串行重跑 `npm run smoke:tui-gate-b`：通过，thread `01a115ea-4aa8-76f3-b42e-df72571085f4`、turn `turn_4816f662ef09484dbf19a9276ed49af7`，typed plan -> task-progress、真实 PTY/alternate screen/按键、状态栏/标题/配置、queue/history/Vim/reconnect 等 current 场景通过，`terminal=restored`。初次等待 artifact lock 的超时不计为交互失败，最新无锁竞争证据为准。
- `npm run smoke:cli-gate-b`：通过，thread `01a115eb-7231-7873-8fd7-db9faf80b6ce`、turn `turn_6b7f877cd2d74a83a8c1dd66ed17cdf5`，真实 CLI/stdio/App Server/canonical ledger，JSONL/stdin/error exit/zsh completion 均通过。CLI/TUI 使用显式受控 provider fixture，不宣称 live provider。
- `npm run verify:gui-smoke`：通过，macOS arm64 v1.151.0，run `standalone-shell-01-20261007103302-41350`，结构化 summary 为 pass，24/24 assertions。真实 Electron startup/reload、preload/IPC、`app_server_handle_json_lines`（38 次）、current App Server methods、settings/memory 与三尺寸 responsive layout 已验证；legacy/mock fallback/error/crash 均为 0。证据位于 `.lime/qc/project-gates/<run>/shell-01-electron-smoke/summary.json`。这是 SHELL-01 壳层 Gate B-F，不扩张为 Desktop provider turn / Thread/Turn/Item identity 或 packaged/Windows/live provider 证明；跨平台打包、安装/更新和 npm 分发由 tag workflow 验证。
- 初始 Git SSH 只读查询失败于 `No user exists for uid 501`；上次保留的临时 libssh2 transport 只读查询成功。远端 main 为基线 SHA，`v1.151.0` 不存在；未修改全局 Git/SSH 配置。
- GitHub CLI 缓存 token 无效，GitHub API DNS 查询失败；保持 HTTPS 校验的 `curl --resolve` 成功读取公开 API。v1.150.0 已于 2026-10-05T02:33:14Z 正式发布，14 个资产，作为本版本 N-1 基线。
- Desktop smoke 历史记录为缺 structured summary；本次重新执行并记录，不宣称 Windows/live provider 已验证。

## 发布引用与完成度

- release commit：`91be2dbd3c5a672b1a53a7b044662c89735b1d53`（`Release v1.151.0`）；pre-commit 验证 132/132 通过。与已确认 tree 的差异仅为本计划授权状态更新，产品候选未变。
- main/tag：`git push origin main` 与 `git push origin v1.151.0` 均成功；远端 main、`refs/tags/v1.151.0` 与本地 tag 均为上述 SHA。
- Release workflow：[37610907191](https://github.com/limecloud/lime/actions/runs/37610907191)，event=push，headBranch=v1.151.0，headSha 与发布提交一致。Prepare、Windows x64、macOS arm64/x64 构建和 Electron assets publish 均 success；四平台 CLI 与 R2 job 已启动，流水线仍 in_progress。
- [GitHub Release v1.151.0](https://github.com/limecloud/lime/releases/tag/v1.151.0)：2026-10-07T11:38:13Z 公开，isDraft=false、isPrerelease=false，当前 9 个桌面资产；CLI 资产将在后续 job 完成后补齐。
- R2 job `112772481582`：API conclusion/step 为 success，但逐项日志复核发现 12 次大文件上传均被 Wrangler 300 MiB 限制拒绝，只有 6 次 feed 元数据上传成功。生成的子 shell 缺少 `set -e`，最后 feed 成功掩盖前面的错误，因此该 job 不作为 R2 分发成功证据。旧对象清理因 Wrangler 无 list 命令跳过。日志保存 `.lime/releases/v1.151.0/r2-publish.log`。
- R2 修复采用现有 API token 按 Cloudflare 官方合同派生 S3 凭证，通过 runner 既有 AWS CLI 分片上传；首个失败立即阻断，先所有 payload 后 feed，每个对象通过 HEAD 比对大小、类型、缓存策略及源 SHA-256 元数据。独立 workflow 核对原 tag/run SHA、原三个构建与资产 publish 成功，下载该 run 的原始 staged artifacts，不重打 tag、不重新构建候选。
- 本机对 stable 下 darwin-arm64/darwin-x64 的 `RELEASES.json` 和 win32-x64 的 `RELEASES` 直连均返回 curl 28 / SSL connection timeout；公开 feed 读取未验证，不将上传证据扩张为本机实测成功。
- 上传修复验证：四文件 Vitest 76/76（新 uploader 9、资产 12、workflow 43、docs 12）；定向 ESLint、`npm run test:contracts`（含 scripts governance）、diff check 通过。补发 YAML/Bash syntax、原 run 身份核对及 jq gate 正向/单平台失败拒绝通过。大文件与失败分支是显式 unit fixture；本机 AWS CLI 的 Python 2.7 interpreter 缺失，真实 S3 上传待 Ubuntu runner 验证，不修改本机全局工具或凭证。
- 沿用用户已确认的发布提交/推送授权，仅暂存本计划声明的 8 个发布流程修复路径，后续产品开发不进入修复提交；未来 R2 job 移除 continue-on-error，缺失 payload 不再标记整个发布成功。
- 修复 commit `0be7d79ddf62917df3d478fde4873d6bfce080d6` 已推送；补发 run `37616940818` 在身份/gate 步骤停止，未执行上传：jq quoted expression 内含续行反斜杠。已修正并将 workflow 原始 shell 直接执行纳入回归，覆盖正确源、错误 SHA、失败原构建三分支，避免仅 syntax check 或变换后表达式漏检。
- 第二修复 commit `53541cd4a6c1221d3415265f0f3356696ca10923` 已推送；uploader/recovery 最新 12/12 与 ESLint 通过，补发 run `37617265298` 已通过原身份/构建门禁并执行真实上传。新增 R2 guard 放入既有 `scripts/electron/lib/release-workflow-candidate-guard.mjs`，避免主 guard 超过原 1000 行边界。
- [R2 补发 run 37617265298](https://github.com/limecloud/lime/actions/runs/37617265298) 最终 success，2026-10-07T11:57:33Z 完成 18/18 独立对象校验（current/versioned payload 12、feed 6）；全部源摘要与大小匹配 GitHub 的 9 个桌面 assets digest/size，payload 全部通过后才上传 feed。完整日志与结构化摘要为 `.lime/releases/v1.151.0/r2-recovery.log`、`r2-recovery-summary.json`。R2 发布证据以本次补发为准，原假成功 job 保留作问题记录。guard 移至既有 helper 后 43/43 与 ESLint 再次通过。
- 本轮准备与 Git 发布完成度 100%，端到端分发完成度 90%；下一刀为核验跨平台构建、GitHub assets、R2 updater 与 CLI/npm 发布。纯 evidence 更新不移动发布 tag。
- 最终发布候选已暂存：132 个路径，`git diff --cached --stat` 为 12184 insertions / 1744 deletions（此行加入前）；无未暂存或未跟踪遗漏，cached diff check 通过。7 个 metadata 与 125 个 candidate 分组清单如下。用户确认后创建 `Release v1.151.0` commit、`v1.151.0` tag 并推送 `origin/main` 与 tag，随后核验发布 workflow。
- TUI 开发者已回写第五十七阶段功能/终端验收完成，并开始登记第五十八阶段；本候选的实际产品能力截至已验证的 task-progress。最终 git 写操作只使用这份已暂存候选；后续并行开发不得夹入未验证内容。无 tag 覆盖/force push/源码删除。
- 用户危险操作确认：“继续”。执行前复核暂存 tree 仍为 `42d3702fbe863dda46d7c53fd0152b7ced688479`，132 files / 12186 insertions / 1744 deletions，与确认前完全一致；后续只补本计划的授权/证据状态。远端 main 仍为基线，目标 tag 未存在。工作树后续 token usage 增量不暂存、不回滚。

## 最终候选路径

### Release metadata（7）

```text
RELEASE_NOTES.en.md
RELEASE_NOTES.md
internal/exec-plans/release-v1.151.0-plan.md
lime-rs/Cargo.lock
lime-rs/Cargo.toml
package.json
packages/cli/package.json
```

### Candidate changes（125）

```text
docs/ops.md
internal/aiprompts/architecture.md
internal/aiprompts/commands.md
internal/exec-plans/release-v1.150.0-plan.md
internal/exec-plans/tui-cli-codex-sync-next-plan.md
internal/exec-plans/tui-structure-inventory.json
lime-rs/crates/app-server/tests/config_jsonrpc.rs
lime-rs/crates/core/src/config/tui_keymap.rs
lime-rs/crates/tui/src/app.rs
lime-rs/crates/tui/src/app/agent_center/hints.rs
lime-rs/crates/tui/src/app/agent_center/keymap_tests.rs
lime-rs/crates/tui/src/app/agent_picker.rs
lime-rs/crates/tui/src/app/agent_picker/tests.rs
lime-rs/crates/tui/src/app/event_dispatch.rs
lime-rs/crates/tui/src/app/interaction.rs
lime-rs/crates/tui/src/app/reasoning_shortcuts.rs
lime-rs/crates/tui/src/app/right_click_paste.rs
lime-rs/crates/tui/src/app/startup.rs
lime-rs/crates/tui/src/app/status_controls.rs
lime-rs/crates/tui/src/app/status_line.rs
lime-rs/crates/tui/src/app/status_line_tests.rs
lime-rs/crates/tui/src/app/terminal_title.rs
lime-rs/crates/tui/src/app/terminal_title_tests.rs
lime-rs/crates/tui/src/app/thread_events.rs
lime-rs/crates/tui/src/app/thread_input.rs
lime-rs/crates/tui/src/app/transcript_export.rs
lime-rs/crates/tui/src/app_server_session.rs
lime-rs/crates/tui/src/app_server_session/config.rs
lime-rs/crates/tui/src/bottom_pane/approval_overlay.rs
lime-rs/crates/tui/src/bottom_pane/approval_render.rs
lime-rs/crates/tui/src/bottom_pane/approval_render_tests.rs
lime-rs/crates/tui/src/bottom_pane/chat_composer/layout.rs
lime-rs/crates/tui/src/bottom_pane/command_popup.rs
lime-rs/crates/tui/src/bottom_pane/custom_prompt_view.rs
lime-rs/crates/tui/src/bottom_pane/custom_prompt_view/picker.rs
lime-rs/crates/tui/src/bottom_pane/custom_prompt_view_tests.rs
lime-rs/crates/tui/src/bottom_pane/footer.rs
lime-rs/crates/tui/src/bottom_pane/keymap_tests.rs
lime-rs/crates/tui/src/bottom_pane/list_selection_view.rs
lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation.rs
lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/render.rs
lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/tests.rs
lime-rs/crates/tui/src/bottom_pane/mod.rs
lime-rs/crates/tui/src/bottom_pane/multi_select_picker.rs
lime-rs/crates/tui/src/bottom_pane/render.rs
lime-rs/crates/tui/src/bottom_pane/request_user_input/mod.rs
lime-rs/crates/tui/src/bottom_pane/shortcut_overlay.rs
lime-rs/crates/tui/src/bottom_pane/shortcut_overlay_tests.rs
lime-rs/crates/tui/src/bottom_pane/status_line_setup.rs
lime-rs/crates/tui/src/bottom_pane/status_line_setup_tests.rs
lime-rs/crates/tui/src/bottom_pane/status_surface_preview.rs
lime-rs/crates/tui/src/bottom_pane/textarea/vim.rs
lime-rs/crates/tui/src/bottom_pane/title_setup.rs
lime-rs/crates/tui/src/bottom_pane/title_setup_tests.rs
lime-rs/crates/tui/src/chatwidget.rs
lime-rs/crates/tui/src/chatwidget/footer.rs
lime-rs/crates/tui/src/chatwidget/interaction.rs
lime-rs/crates/tui/src/chatwidget/status_controls.rs
lime-rs/crates/tui/src/chatwidget/transcript.rs
lime-rs/crates/tui/src/chatwidget/transcript_export.rs
lime-rs/crates/tui/src/chatwidget/transcript_export_tests.rs
lime-rs/crates/tui/src/footer_hint.rs
lime-rs/crates/tui/src/keymap/list.rs
lime-rs/crates/tui/src/keymap/list_tests.rs
lime-rs/crates/tui/src/lib.rs
lime-rs/crates/tui/src/local_settings.rs
lime-rs/crates/tui/src/locale.rs
lime-rs/crates/tui/src/locale/pickers.rs
lime-rs/crates/tui/src/locale/status_line.rs
lime-rs/crates/tui/src/locale/title.rs
lime-rs/crates/tui/src/model_picker/keymap_tests.rs
lime-rs/crates/tui/src/model_picker/render.rs
lime-rs/crates/tui/src/model_picker/render_tests.rs
lime-rs/crates/tui/src/projection.rs
lime-rs/crates/tui/src/projection/plans.rs
lime-rs/crates/tui/src/projection/plans_tests.rs
lime-rs/crates/tui/src/projection_tests.rs
lime-rs/crates/tui/src/resume_picker/host.rs
lime-rs/crates/tui/src/resume_picker/render.rs
lime-rs/crates/tui/src/resume_picker/tests/keymap.rs
lime-rs/crates/tui/src/resume_picker/tests/toolbar.rs
lime-rs/crates/tui/src/runtime.rs
lime-rs/crates/tui/src/runtime_pty_tests.rs
lime-rs/crates/tui/src/runtime_pty_tests/agent_picker.rs
lime-rs/crates/tui/src/runtime_pty_tests/approval.rs
lime-rs/crates/tui/src/runtime_pty_tests/config.rs
lime-rs/crates/tui/src/runtime_pty_tests/cursor_style.rs
lime-rs/crates/tui/src/runtime_pty_tests/resume_picker.rs
lime-rs/crates/tui/src/runtime_pty_tests/status_line.rs
lime-rs/crates/tui/src/runtime_pty_tests/task_progress.rs
lime-rs/crates/tui/src/runtime_pty_tests/terminal_title.rs
lime-rs/crates/tui/src/runtime_pty_tests/thread_input.rs
lime-rs/crates/tui/src/runtime_pty_tests/title_setup.rs
lime-rs/crates/tui/src/runtime_pty_tests/transcript_export.rs
lime-rs/crates/tui/src/runtime_pty_tests/vim_keymap.rs
lime-rs/crates/tui/src/settings.rs
lime-rs/crates/tui/src/slash_command.rs
lime-rs/crates/tui/src/terminal_title.rs
lime-rs/crates/tui/src/terminal_title_tests.rs
lime-rs/crates/tui/src/tui.rs
lime-rs/crates/tui/src/view.rs
lime-rs/crates/tui/src/view/tests.rs
lime-rs/crates/tui/src/view/tests/composer.rs
lime-rs/crates/tui/src/view/tests/cursor.rs
lime-rs/crates/tui/src/view/tests/interaction.rs
lime-rs/crates/tui/src/view/tests/presentation.rs
lime-rs/crates/tui/src/width.rs
scripts/app-server/terminal-gate-fixture.mjs
scripts/app-server/terminal-gate-fixture.test.mjs
scripts/app-server/tui-composer-structure.test.mjs
scripts/app-server/tui-gate-b.mjs
scripts/app-server/tui-gate-b.test.mjs
src/i18n/resources/en-US/navigation.json
src/i18n/resources/en-US/scheduledTasks.json
src/i18n/resources/ja-JP/navigation.json
src/i18n/resources/ja-JP/scheduledTasks.json
src/i18n/resources/ko-KR/navigation.json
src/i18n/resources/ko-KR/scheduledTasks.json
src/i18n/resources/zh-CN/navigation.json
src/i18n/resources/zh-CN/scheduledTasks.json
src/i18n/resources/zh-TW/navigation.json
src/i18n/resources/zh-TW/scheduledTasks.json
src/lib/api/appConfig.test.ts
src/lib/api/appConfig.ts
src/lib/api/appConfigTypes.ts
```
