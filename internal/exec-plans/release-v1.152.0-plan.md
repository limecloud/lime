# Lime v1.152.0 发布执行计划

状态：源码发布完成；整体退出条件 7/8（约88%），发布流水线运行中
日期：2026-10-08
基线：`v1.151.0` / `91be2dbd3c5a672b1a53a7b044662c89735b1d53`
起点：`main` / `9acfc35efe12a5ea2769033cbe909aa9e61c472e`
目标：发布当前 TUI 用量、历史回退、统一分页、推理摘要及共享 App Server 修复，完成版本同步、双语发布说明、必要门禁、release commit、tag、main/tag 推送与分发核验。

## 写集与候选范围

- release metadata 写集：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、`RELEASE_NOTES.md`、`RELEASE_NOTES.en.md`、本计划。
- candidate changes：启动时工作树全部 tracked/untracked 产品、文档、测试与结构 inventory；涉及 `lime-rs/crates/{tui,app-server}`、`scripts/{app-server,agent-runtime}`、`docs/ops.md`、`internal/aiprompts/{architecture,commands}.md` 与 TUI 执行计划。
- excluded changes：无主动排除的源码改动；忽略目录中的日志、缓存、编译产物不进入提交。若验证窗口出现并行新增/修改，重新核对候选范围和验证覆盖，不覆盖业务热区。
- 业务源码和现有文档改动只读审阅；本轮先只修改上述七个发布文件。
- Forge 配置和 App Server release manifest 从根包读取版本，无显式旧版本；pnpm 锁文件没有应用版本，保持既有依赖解析。

## 退出条件

- [x] 候选范围冻结并记录完整路径与摘要。
- [x] 根包、CLI、Rust workspace 与本地 Cargo.lock 版本为 `1.152.0`；版本检查通过。
- [x] 双语发布说明只保留 v1.152.0，准确说明本次用户可见行为。
- [x] `npm run typecheck`、contracts、受影响 Rust/脚本/GUI 推理回归通过。
- [x] 真实 CLI/TUI stdio/PTY fixture 与 GUI smoke 通过，记录证据和限制。
- [x] 按仓库危险操作规则取得 commit/tag/push 明确确认；用户于 2026-10-08 回复“继续”。
- [x] 提交 `Release v1.152.0`，创建 tag，推送 main/tag 并核对远端 SHA。
- [ ] 核验 Release workflow、GitHub Release、CLI/npm 与 updater 分发结果。

## 架构确认与分类

发布候选继续使用 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item -> GUI/terminal projection`。TUI 回退调用既有 `thread/revert`，统一分页读取既有 items/turns API；用量来自 typed notification；摘要与历史使用共享 canonical facts，不新增 method/schema、私有存储或平行后端。共享修复仅保留通知原始文本和区分 reasoning lifecycle snapshot/delta。

已只读复核本候选 `architecture.md` 数据流及 TUI 执行计划第58–65阶段责任开发者确认；本轮发布架构复核责任 root，2026-10-08。current 为领域 projection/history/backtrack/status/notification/materializer owner；test-only 为受控 provider/PTY/Electron 夹具；compat/deprecated 无新增；dead/deleted 为旧 inline owner、历史双轨读取及 raw reasoning 正向 fallback/断言。KISS 使用既有合同，DRY 共用 canonical 转换和用量格式化，SOLID 分离宿主交互、事实投影与通知处理。

## 验证与环境

- 远端只读预检：main 与本地起点一致，`v1.152.0` 不存在。
- 验证日志与候选快照写入忽略目录 `.lime/releases/v1.152.0/`。
- 默认发布门禁采用版本/typecheck/contracts、风险相关回归和真实交互；不自动展开裸全量 lint/test/workspace Rust。
- `npm run verify:app-version`：通过；36 个本地 workspace package 同步，registry 依赖未改。
- `npm run typecheck`：通过，renderer/node 两个 TypeScript 项目完成。
- `npm run test:contracts`：通过，覆盖协议生成物、命令/client、modality、脚本、Forge release、Desktop/CLI 与文档边界。
- 九个受影响夹具/结构/GUI 推理文件的 Vitest：235/235 通过。
- 发布流程/uploader/updater assets 三文件 Vitest：67/67 通过，含大文件分片、失败阻断和实际 workflow 身份 gate。
- `npm run test:rust:unit -- -p tui --all-targets --no-default-features`：1592 unit、23 suite、1 依赖边界守卫全部通过。
- `npm run test:rust:unit -- -p app-server --no-default-features`：1791/1791 通过，含共享 reasoning 通知与 materializer 回归。
- `npm run build:renderer:electron`：通过；保留既有 OEM script/Browserslist 构建提示，未更新依赖。
- `npm run governance:legacy-report`：2068 runtime、1810 Rust runtime；零引用候选、分类漂移和边界违规全部为 0。
- `npm run smoke:tui-gate-b`：通过，使用新构建的 1.152.0 CLI/App Server，thread `01a11a16-ce8e-7823-8cf9-d1438030188e`、turn `turn_3f625bac676149469787216d1a70dd57`；真实 PTY/按键、回退/冷恢复、token/context、reasoning-parts 及原有全部场景，`terminal=restored`。
- 同次真实摘要 stdio：parts thread `01a11a17-f23e-7ba0-9352-793bc1227c06`、turn `turn_fa60b35818f04037a43135fcb115cb70`；resume thread `01a11a17-f73e-74d2-9364-17e770a4cdc2`、turn `turn_1617fc1e591c4857b554737393c76f3b`。notification/canonical/cold-resume、metadata/page/no-started/terminal/raw-hidden 全部通过。专项恢复 PTY 使用 test-only WebSocket server，真实 App Server 单独由上述 stdio 验证，不混同成同一次跨边界证据。
- `npm run smoke:cli-gate-b`：通过，thread `01a11a18-8a25-7ca2-95cd-47afb46a50e3`、turn `turn_9e3a7a87a1ee4bd7b5d3fc301ccc54ad`，真实 lime exec/stdio/App Server、canonical identity、JSONL/stdin/error-exit/zsh completion；详情见本版本日志。
- `npm run smoke:agent-runtime-current-fixture`：整体通过，重建本版 host/sidecar 并使用真实 Electron，覆盖原聚合全部场景（Skills/Experts current 侧栏、审批、rich draft/steer、Plan、MCP、media、typed error retry、Article Editor 等）。最后 Article Thread `01a11a1e-280f-7b02-8b6c-7d418c1666c3`，`liveProviderUsed=false`。不是 live provider、Windows 或专项 Desktop running-reasoning reconnect 证据。
- 桌面 `reasoning-first-visible` 受控 fixture：通过；独立证据前缀 `release-v1.152.0-reasoning`，验证 first-visible、展开单次摘要、raw DOM/visible=false 与完整 canonical summary/content；未提升为单条 canonical Reasoning Item 或显式 raw 开关验证。
- 该专项 Thread `01a11a1e-b676-73e1-abd7-3eb653f5a4b4`；已视读最终展开截图，摘要正文一次、raw 隐藏、最终回答与输入框正常。read-model collector 仍有两条 Reasoning Item，不将完成态 DOM 单次摘要扩张成 canonical item 去重结论。
- `npm run verify:gui-smoke`：通过，run `standalone-shell-01-20261008060746-24854`，macOS arm64、本版 App Server 1.152.0；24/24 assertions，真实 Electron/preload/IPC/JSON-RPC、reload、三尺寸布局和 Memory settings，legacy/mock/error/crash 均为 0。结构化 summary 位于 `.lime/qc/project-gates/<run>/shell-01-electron-smoke/summary.json`；这是壳层 Gate B-F，场景级 canonical identity 由独立 runtime/reasoning fixture 证明。
- 本轮必要门禁全部通过；未执行裸全量 lint/test/workspace Rust，遵循 release skill 的定向验证策略。Windows/打包/npm 安装与 updater 网络分发待 tag workflow；本机受控夹具不提升为 live provider 证明。
- 最终候选稳定：124 个路径，七个 release metadata 与117个产品/测试/文档候选全部纳入；无额外排除项。隔离索引预览与 hash/tree 快照位于 `.lime/releases/v1.152.0/`，未改变实际工作索引或发布引用。
- 15 个受影响脚本定向 ESLint、workspace fmt check 与 `git diff --check`：通过。
- 验证窗口首次 hash 复核：业务候选无漂移；新增两个路径仅为本轮双语发布说明。
- 本地/远端目标 tag 与 GitHub Release 均不存在；main 仍与起点一致。
- Windows、打包安装/更新、npm 四平台安装、live provider 和显式 raw reasoning 配置须按实际证据报告，不借用源码/本机 macOS 证据声称通过。

## 发布状态

- release commit：`26b14f43939d575f9132e58191cd9bb3aa8865fd`（`Release v1.152.0`）；pre-commit 验证124/124通过。与已确认 tree 的差异仅为本计划授权状态记录。
- main/tag：`git push origin main` 与 `git push origin v1.152.0` 均成功，远端两引用与本地 tag 均为上述 SHA。提交后工作树干净。
- Release workflow：[37758324548](https://github.com/limecloud/lime/actions/runs/37758324548)，event=push、headBranch=v1.152.0、headSha 与 release commit 一致，已进入 in_progress。
- 下一步：持续核验原 run 的全部 job、GitHub assets、CLI/npm 和 updater 分发；不移动 tag。
- 完成度：本地准备与 Git 发布100%；整体退出条件7/8（约88%）。远端分发尚未完成，不把推送成功当成完整发布完成。

## Windows 发布证据缺口与补验

原 Windows job API 为 success；结构化 Squirrel 证据已实读：SHA 为 release commit，N-1 1.151.0 -> 1.152.0 的真实 updater 安装和卸载21/21通过，CodeMode artifact也存在。但 job log 的 native-host / packaged-identity 两步没有主体输出，上传明确提示文件不存在。其入口使用 `import.meta.url === file://${process.argv[1]}`，Windows 路径不匹配，导致静默 exit 0；这两项原步骤属于假成功，不能作为 Gate B 证据。

发布范围内扩展窄写集：两个 Windows 门禁脚本与对应真实 CLI 回归、Release workflow 的必需证据上传策略、既有 build-windows-test workflow 的原 run 产物补验分支、本计划。改用标准 pathToFileURL；补验仅安装原 run 的签名产物，核对 tag/run/SHA 与原 Windows build success，再在真实 Windows 上运行 CLI 入口回归、Squirrel、CodeMode、native-host 和身份 gate。测试脚本从修复提交读取，产品候选、版本和原 tag 保持既有 SHA，不重新构建或替换发布资产。此路径沿用用户本轮发布与推送确认，不包含并行产品开发。

补验前原 native-host/packaged-identity 标记 unverified；发布分发仍由原 run 完成。修复、补验与最终证据将在此节追加。

修复验证：真实 CLI help/缺参退出/失败文件、原 run 正确身份/错误 SHA/失败构建的实际 YAML shell、发布守卫共55/55通过；定向 ESLint、两份 YAML Prettier、contracts 和 diff check通过。入口修复直接替换旧判断，无 wrapper/新依赖；新分支复用既有 Windows smoke/CodeMode/native/identity owner。原三个桌面构建/API门禁均通过，缓存收尾中。原 Windows native/identity 步骤的假成功记录保留；最终以补验结构化证据为准。

首轮补验 [37762285799](https://github.com/limecloud/lime/actions/runs/37762285799)，脚本修复 SHA `af182ed24a041d361486c565399b357a162130a0`：原 run/tag 身份与依赖安装通过；两个 Vitest suite 在 Windows 加载阶段报 `SyntaxError: Invalid or unexpected token`，未收集测试，尚未安装或运行原候选。保留失败记录，不作为产品失败或通过证据。补验步骤改用原生 Node 的真实子进程断言，验证两个入口 help、native 缺参非零退出和 packaged 缺证据结构化失败；本地完整 Vitest 回归保留，真实产品安装与全部 Gate B 不降级。

原生 Node 的实际 YAML shell 在本机执行通过；两文件 Vitest 12/12、workflow Prettier 与 diff check 通过。2026-10-08 10:23 UTC，原 R2 job success；公开 R2 current/versioned 共18个 URL 的内容或长度核对18/18通过，三个 feed 与 GitHub digest/原始字节一致，mac feed 的 currentRelease/updateTo.version 为1.152.0。GitHub Release已公开（非 draft、非 prerelease），9个桌面资产 uploaded/size>0且含SHA256；CLI/npm仍构建中，暂不宣称完整分发完成。

## 候选路径清单

当前 124 个路径：release metadata 7、Rust 97、scripts 15、文档/计划 5。忽略目录产物不纳入；未主动排除源码。提交前重新核对 hash 与路径集合。

```text
RELEASE_NOTES.en.md
RELEASE_NOTES.md
docs/ops.md
internal/aiprompts/architecture.md
internal/aiprompts/commands.md
internal/exec-plans/release-v1.152.0-plan.md
internal/exec-plans/tui-cli-codex-sync-next-plan.md
internal/exec-plans/tui-structure-inventory.json
lime-rs/Cargo.lock
lime-rs/Cargo.toml
lime-rs/crates/app-server/src/processor/v2_notifications.rs
lime-rs/crates/app-server/src/processor/v2_notifications/model_tests.rs
lime-rs/crates/app-server/src/processor/v2_notifications/reasoning.rs
lime-rs/crates/app-server/src/processor/v2_notifications/reasoning_tests.rs
lime-rs/crates/app-server/src/processor/v2_notifications/tests.rs
lime-rs/crates/app-server/src/runtime/thread_item_projection/materializer.rs
lime-rs/crates/app-server/src/runtime/thread_item_projection/typed_tests/incremental.rs
lime-rs/crates/tui/src/app.rs
lime-rs/crates/tui/src/app/agents_overview.rs
lime-rs/crates/tui/src/app/app_server_requests.rs
lime-rs/crates/tui/src/app/history_pagination.rs
lime-rs/crates/tui/src/app/history_replacement.rs
lime-rs/crates/tui/src/app/history_ui.rs
lime-rs/crates/tui/src/app/history_ui_tests.rs
lime-rs/crates/tui/src/app/input_flow.rs
lime-rs/crates/tui/src/app/interaction.rs
lime-rs/crates/tui/src/app/message_history.rs
lime-rs/crates/tui/src/app/reconnect.rs
lime-rs/crates/tui/src/app/session_lifecycle.rs
lime-rs/crates/tui/src/app/session_lifecycle_tests.rs
lime-rs/crates/tui/src/app/startup.rs
lime-rs/crates/tui/src/app/status_line.rs
lime-rs/crates/tui/src/app/status_line_tests.rs
lime-rs/crates/tui/src/app/thread_events.rs
lime-rs/crates/tui/src/app/transcript_presentation.rs
lime-rs/crates/tui/src/app_backtrack.rs
lime-rs/crates/tui/src/app_backtrack/io.rs
lime-rs/crates/tui/src/app_backtrack/stdio_tests.rs
lime-rs/crates/tui/src/app_backtrack/tests.rs
lime-rs/crates/tui/src/app_event.rs
lime-rs/crates/tui/src/app_server_session.rs
lime-rs/crates/tui/src/app_server_session/history.rs
lime-rs/crates/tui/src/bottom_pane/chat_composer/footer_state.rs
lime-rs/crates/tui/src/bottom_pane/chat_composer/history.rs
lime-rs/crates/tui/src/bottom_pane/chat_composer_history.rs
lime-rs/crates/tui/src/bottom_pane/chat_composer_history/user_input.rs
lime-rs/crates/tui/src/bottom_pane/composer.rs
lime-rs/crates/tui/src/bottom_pane/footer.rs
lime-rs/crates/tui/src/bottom_pane/footer_tests.rs
lime-rs/crates/tui/src/bottom_pane/pending_input_preview.rs
lime-rs/crates/tui/src/bottom_pane/status_line_setup.rs
lime-rs/crates/tui/src/bottom_pane/status_line_setup_tests.rs
lime-rs/crates/tui/src/bottom_pane/status_surface_preview.rs
lime-rs/crates/tui/src/bottom_pane/title_setup.rs
lime-rs/crates/tui/src/chatwidget/footer.rs
lime-rs/crates/tui/src/chatwidget/input.rs
lime-rs/crates/tui/src/entry.rs
lime-rs/crates/tui/src/history_cell/messages.rs
lime-rs/crates/tui/src/history_cell/mod.rs
lime-rs/crates/tui/src/history_cell/reasoning.rs
lime-rs/crates/tui/src/history_cell/reasoning_tests.rs
lime-rs/crates/tui/src/lib.rs
lime-rs/crates/tui/src/locale.rs
lime-rs/crates/tui/src/locale/backtrack.rs
lime-rs/crates/tui/src/locale/status_line.rs
lime-rs/crates/tui/src/locale/token_usage.rs
lime-rs/crates/tui/src/pager_overlay.rs
lime-rs/crates/tui/src/pager_overlay/browsing.rs
lime-rs/crates/tui/src/pager_overlay/render.rs
lime-rs/crates/tui/src/pager_overlay/search_tests.rs
lime-rs/crates/tui/src/pager_overlay/tests.rs
lime-rs/crates/tui/src/projection.rs
lime-rs/crates/tui/src/projection/history.rs
lime-rs/crates/tui/src/projection/history_tests.rs
lime-rs/crates/tui/src/projection/items.rs
lime-rs/crates/tui/src/projection/reasoning.rs
lime-rs/crates/tui/src/projection/reasoning_stdio_tests.rs
lime-rs/crates/tui/src/projection/streaming.rs
lime-rs/crates/tui/src/projection/streaming_tests.rs
lime-rs/crates/tui/src/projection/token_usage.rs
lime-rs/crates/tui/src/projection/token_usage_tests.rs
lime-rs/crates/tui/src/projection_tests.rs
lime-rs/crates/tui/src/resume_picker/host.rs
lime-rs/crates/tui/src/resume_picker_transcript_preview.rs
lime-rs/crates/tui/src/resume_picker_transcript_preview_tests.rs
lime-rs/crates/tui/src/runtime.rs
lime-rs/crates/tui/src/runtime/input_submission_tests.rs
lime-rs/crates/tui/src/runtime_pty_tests.rs
lime-rs/crates/tui/src/runtime_pty_tests/backtrack.rs
lime-rs/crates/tui/src/runtime_pty_tests/config.rs
lime-rs/crates/tui/src/runtime_pty_tests/footer.rs
lime-rs/crates/tui/src/runtime_pty_tests/images.rs
lime-rs/crates/tui/src/runtime_pty_tests/reasoning.rs
lime-rs/crates/tui/src/runtime_pty_tests/skills.rs
lime-rs/crates/tui/src/runtime_pty_tests/status_line.rs
lime-rs/crates/tui/src/runtime_pty_tests/task_progress.rs
lime-rs/crates/tui/src/runtime_pty_tests/token_usage.rs
lime-rs/crates/tui/src/status/helpers.rs
lime-rs/crates/tui/src/status/helpers_tests.rs
lime-rs/crates/tui/src/status/mod.rs
lime-rs/crates/tui/src/thread_transcript.rs
lime-rs/crates/tui/src/transcript_view/disclosure.rs
lime-rs/crates/tui/src/view.rs
lime-rs/crates/tui/tests/suite/focus_palette.rs
lime-rs/crates/tui/tests/suite/history_pagination.rs
lime-rs/crates/tui/tests/suite/history_pagination/fixtures.rs
lime-rs/crates/tui/tests/suite/reconnect.rs
package.json
packages/cli/package.json
scripts/agent-runtime/claw-chat-current-fixture-expert-actions.mjs
scripts/agent-runtime/claw-chat-current-fixture-gui-completion-waits.mjs
scripts/agent-runtime/claw-chat-current-fixture-runtime-surface-assertions.mjs
scripts/agent-runtime/claw-chat-current-fixture-scenario-flow.mjs
scripts/agent-runtime/claw-chat-current-fixture-skills-workspace.mjs
scripts/agent-runtime/claw-chat-current-fixture-smoke-skills-runtime-guards.mjs
scripts/agent-runtime/claw-chat-current-fixture-smoke.test.mjs
scripts/agent-runtime/reasoning-fixture.mjs
scripts/agent-runtime/reasoning-fixture.test.mjs
scripts/app-server/terminal-gate-fixture.mjs
scripts/app-server/terminal-gate-fixture.test.mjs
scripts/app-server/tui-composer-structure.test.mjs
scripts/app-server/tui-gate-b.mjs
scripts/app-server/tui-gate-b.test.mjs
scripts/app-server/tui-structure-inventory.test.mjs
```
