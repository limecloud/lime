# v1.154.0 发布执行计划

状态：固定候选已通过本地发布门禁，等待一次 commit / tag / push 明确确认。

## 目标与范围

- 目标版本 `1.154.0`、tag `v1.154.0`；前版为 `v1.153.0`。
- 起始 HEAD / 远端 main 为 `287a64efc7e72ef836c6b31eec315a9d35f035a4`；本地和远端目标 tag 均不存在。
- 起始工作区 111 个 tracked / untracked 改动全部作为 release candidate，没有排除文件；产品、文档、测试和门禁一起发布。
- 已提交增量包含 Docs/Pages 修复、MCP arbitrary-precision progress 分派修复、Windows current filesystem/timeout 合同门禁修正。
- 本次产品候选包含顶层 CLI review、TUI 问答与 MCP 表单、ASCII/IME 顺序、终端绘制缓存、Windows 输入解码/模式恢复、外部编辑器解析与 KeepScreen 交接。

## 写集与原则

- 本轮发布写集：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml` workspace version、`lime-rs/Cargo.lock` 的 36 个本地 workspace package version、双语 release notes、本文档。
- Rust manifest / lock 已有产品依赖变更保留，仅定点同步发布版本。pnpm lock 没有显式产品版本，不作无意义改写；Forge 与 sidecar manifest 从版本事实源生成。
- CLI/TUI/MCP、scripts、架构/命令/运维文档和前版记录按已有候选只读审阅与验证，必要修复再单独声明。
- KISS/DRY：同步唯一版本事实源，复用 current 发布工作流和既有测试；YAGNI：不新增发布包装层或兼容路径；SRP：发布 metadata 与业务 owner 各自承担职责。

## 架构确认与分类

- 责任 root，2026-10-10：复核已更新 `internal/aiprompts/architecture.md` 及 CLI/TUI 执行计划的 owner 图，仍为 Product Surface -> App Server JSON-RPC -> shared runtime -> canonical Thread/Turn/Item。
- current：CLI/TUI 与 MCP 的既有 owner、Forge/Squirrel 发布、Electron autoUpdater、共享 stdio 及 PTY 门禁。
- test-only：隔离受控 external backend、MCP stdio/PTY fixture 与测试证据，不等同 live provider。
- compat/deprecated：无新增。dead/deleted：旧 editor parser/空正文拒绝、始终 Restore 的 editor 交接及重复接线在原 owner 直接替换，没有恢复旧 runtime 或第二后端。

## 退出条件

1. 版本事实源统一为 1.154.0，中英 release notes 仅保留当前单页。
2. `verify:app-version`、`typecheck`、contracts、候选受影响 Rust owner 与脚本/launcher 定向测试通过，完成真实 GUI smoke 与 CLI/TUI stdio/PTY 证据。
3. 复核候选快照无未解释漂移、无漏发文件，给出具体 commit/tag/push 确认清单。
4. 获得一次明确危险操作确认后，正常 hook 提交全部 candidate，创建新 tag，推送 main 与 tag 并核实远端 SHA。
5. 跟踪发布工作流与 GitHub/npm/updater 分发；失败保留证据并聚焦修复，不暗改已推送 tag。

## 验证与限制

- 本轮日志目录：`.lime/release/v1.154.0/`；起始候选 SHA256 快照为 `initial-candidate.json`。
- 本轮 fresh 验证结果见下方进度；前序计划证据只用于选择门禁，不能冒充本版验证。
- Windows/MSVC、Windows Terminal 和 editor/shim 实机本地不可验证，留给对应 CI/平台证据；macOS 不能替代 Windows 实跑。
- 前序第88阶段 raw notes 分段、editor 首键和 aggregate 超时仍有历史未闭环记录；本版单次通过不宣称根因全部修复。policy-aware editor_directory 与完整 Codex 对齐仍 partial。
- 按 `AGENTS.md` 与 release skill 的明确规则，commit / tag / push 前需一次危险操作确认。

## 起始产品候选文件

- `docs/ops.md`
- `internal/aiprompts/architecture.md`
- `internal/aiprompts/commands.md`
- `internal/exec-plans/cli-structure-inventory.json`
- `internal/exec-plans/release-v1.153.0-plan.md`
- `internal/exec-plans/tui-cli-codex-sync-next-plan.md`
- `internal/exec-plans/tui-structure-inventory.json`
- `lime-rs/Cargo.lock`
- `lime-rs/Cargo.toml`
- `lime-rs/crates/cli/src/exec/cli.rs`
- `lime-rs/crates/cli/src/main.rs`
- `lime-rs/crates/cli/src/review_cmd.rs`
- `lime-rs/crates/mcp/src/elicitation.rs`
- `lime-rs/crates/mcp/src/elicitation_tests.rs`
- `lime-rs/crates/mcp/src/manager/tests.rs`
- `lime-rs/crates/mcp/src/manager/tests/elicitation.rs`
- `lime-rs/crates/mcp/src/manager/tools.rs`
- `lime-rs/crates/mcp/src/oauth_tests.rs`
- `lime-rs/crates/tui/Cargo.toml`
- `lime-rs/crates/tui/src/app.rs`
- `lime-rs/crates/tui/src/app/input.rs`
- `lime-rs/crates/tui/src/app/input_tests.rs`
- `lime-rs/crates/tui/src/app/interrupts.rs`
- `lime-rs/crates/tui/src/app/thread_interaction_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/agents_navigation.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/completion.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/config.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/draft.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/draft_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/input.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/paste_input.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/vim_search_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/composer.rs`
- `lime-rs/crates/tui/src/bottom_pane/input.rs`
- `lime-rs/crates/tui/src/bottom_pane/input_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/input_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/keymap_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/input.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/input_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/pty_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/render.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/stdio_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/mcp_server_elicitation/tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/mod.rs`
- `lime-rs/crates/tui/src/bottom_pane/paste_burst.rs`
- `lime-rs/crates/tui/src/bottom_pane/render.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/burst_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/confirmation.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/mod.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/paste_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/render.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/render_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/state.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/state_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/request_user_input/tests.rs`
- `lime-rs/crates/tui/src/chatwidget/input.rs`
- `lime-rs/crates/tui/src/external_editor.rs`
- `lime-rs/crates/tui/src/external_editor_tests.rs`
- `lime-rs/crates/tui/src/locale.rs`
- `lime-rs/crates/tui/src/locale/external_editor.rs`
- `lime-rs/crates/tui/src/locale/request_user_input.rs`
- `lime-rs/crates/tui/src/runtime.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/agent_picker.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/approval.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/external_editor.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/footer.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/images.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/request_user_input.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/resume_picker.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/status_line.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/terminal_observer.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/title_setup.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/transcript_export.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/vim_keymap.rs`
- `lime-rs/crates/tui/src/tui.rs`
- `lime-rs/crates/tui/src/tui/event_stream.rs`
- `lime-rs/crates/tui/src/tui/tests.rs`
- `lime-rs/crates/tui/src/tui/windows_console.rs`
- `lime-rs/crates/tui/src/tui/windows_console_tests.rs`
- `lime-rs/crates/tui/src/tui/windows_key_sequence.rs`
- `lime-rs/crates/tui/src/tui/windows_key_sequence_tests.rs`
- `lime-rs/crates/tui/tests/suite/focus_palette.rs`
- `lime-rs/crates/tui/tests/suite/reconnect.rs`
- `lime-rs/crates/tui/tests/suite/resize_reflow.rs`
- `packages/cli/README.md`
- `scripts/README.md`
- `scripts/app-server/cli-exec-gate-b.mjs`
- `scripts/app-server/cli-gate-b.mjs`
- `scripts/app-server/cli-gate-b.test.mjs`
- `scripts/app-server/cli-npm-gate-b.mjs`
- `scripts/app-server/cli-npm-gate-b.test.mjs`
- `scripts/app-server/cli-reasoning-gate-b.mjs`
- `scripts/app-server/cli-review-gate-b.mjs`
- `scripts/app-server/cli-structure-inventory.test.mjs`
- `scripts/app-server/mcp-elicitation-fixture.mjs`
- `scripts/app-server/mcp-elicitation-gate-b.mjs`
- `scripts/app-server/mcp-elicitation-stdio-relay.mjs`
- `scripts/app-server/terminal-gate-binaries.mjs`
- `scripts/app-server/terminal-gate-binaries.test.mjs`
- `scripts/app-server/terminal-gate-fixture.mjs`
- `scripts/app-server/tui-composer-structure.test.mjs`
- `scripts/app-server/tui-external-editor.test.mjs`
- `scripts/app-server/tui-gate-b.mjs`
- `scripts/app-server/tui-gate-b.test.mjs`
- `scripts/app-server/tui-render-scheduling.test.mjs`
- `scripts/app-server/tui-structure-inventory.test.mjs`
- `scripts/app-server/tui-terminal-modes.test.mjs`
- `scripts/governance/cli-boundary.mjs`

## 本轮进度

- 版本一致性通过，workspace lock 的 36 个本地版本同步，无外部依赖版本误改；双语单页 release notes 已格式化。
- `npm --prefix packages/cli test`：9/9 通过，含真实 launcher argv/stdin/exit/signal 与平台包 staging。
- 12 文件定向 Vitest：195/195 通过，覆盖 CLI/TUI inventory、composer、PTY routing、editor、terminal modes、draw scheduling、Forge/release workflow。`.lime/**` 冻结快照明确排除，未执行无关全量前端矩阵。
- `npm run test:contracts` exit0；类型检查、Rust owner 与 GUI smoke 正在运行。
- 起始快照之后发现 TUI 外部 editor fixture 和共享执行计划由其他进程继续修改，新增第97阶段 canonical cwd 工作，处于实施中。已向用户询问最终候选纳入范围；本轮保持该写集只读，提交前必须确认候选稳定并重新验证受影响路径。

- `npm run typecheck` 完整 renderer + node exit0；22 个候选 mjs 的 ESLint exit0。
- Rust 首轮（rust-unit.log，exit101）与 GUI 首轮（gui-smoke.log，exit1）均因 ENOSPC 失败，系统盘最低约202MiB；不将环境失败计作通过。其他进程随后释放空间，incremental 目录消失、可用空间恢复25.55GiB，本轮没有执行删除。
- 重跑使用本轮进程局部 CARGO_INCREMENTAL=0/CARGO_BUILD_JOBS=4，保持依赖/产品配置不变；补齐 CLI bin target 和 TUI integration，再 fresh build CLI/App Server/code-mode-host，避免 unit wrapper 的 --lib 漏跑 CLI bin。

- 候选范围问题尚未收到排除指示；按用户“发布”的既有范围与 release skill 默认规则，当前第97阶段 canonical cwd 改动仍纳入候选审阅和验证，不因没有回复就视为 git 写操作批准。后续必须有 fresh 跨目录 resume/editor 证据与候选冻结复核，最终确认列明全部当前改动。
- 第97变化后定向重验三个受影响守卫：66/66通过，其中新cwd门禁1项；与前轮重叠测试不重复累计为新的总通过数。

- Rust fresh 重跑首段通过：MCP174、TUI1718 lib+23 integration+1 dependency guard。普通 gated PTY early-return 不冒充真实终端证据；CLI bin/build 与 Gate 验收继续。
- GUI 重跑前端/Host构建已通过，App Server fresh build 因 sherpa-onnx-sys1.13.0 GitHub 原生库下载连接超时失败（gui-smoke-retry.log，exit1）。使用仓库 current prepare-sherpa-onnx-runtime 入口补齐同版本缓存，不改依赖/产品实现或使用 mock。

- CLI bin106/106通过（含顶层review解析/复用）；本轮相关Rust共2022项（MCP174+TUI1718+23+1+CLI106），0失败；0测试的辅助target单独保留，不计通过数量。最终build和真实交互继续。
- 当前候选116文件＝起始111与本轮5个新变化路径（root/CLI package版本、双语notes、新发布计划）；Cargo manifest/lock同时含已有产品依赖与本轮发布版本变更，不能只提交其版本行而漏发产品。没有排除项或未解释的新路径。
- 当前源码SHA256另存 validated-source-snapshot.json（本文档因持续追加证据排除），用于最终候选冻结复核。

- 最终 fresh build 的 V8150.4.0复制失败：已解析的共享cache gzip在使用时不存在（rust-candidate-retry.log）；不是Rust测试失败，之前2022项保留。GUI构建正在通过current rusty-v8 helper重下载并核对SHA256；后续仅续跑构建和真实Gate，不重跑已通过owner矩阵。
- 第97 Windows test-only editor fixture同步UTF-8 code page保存/恢复，Unix受测逻辑不变；对应Windows实机仍未验，最终候选冻结时记录此更新。

- GUI完整入口最终仍在V8下载阶段exit1，renderer/Host/typecheck:electron均已成功；原失败记录保留。GitHub资产API下载本轮私有归档与bindings，分别为23542428/39895 bytes，与官方SHA256精确一致（00adbb48…、ca5adf0c…），不绕过current helper校验。
- 固定本轮已验的RUSTY_V8_ARCHIVE与RUSTY_V8_SRC_BINDING_PATH，仅续跑最终cargo build及GUI app-server assets/smoke阶段，避免重跑已经通过的前端构建和owner测试。

- 最终 CLI+App Server+Code Mode Host `--locked` fresh build exit0，构建15m17s（rust-build-final.log）。current terminal snapshot helper冻结完整兄弟文件到binaries，CLI实读版本=1.154.0；CLI/App Server SHA256为22315582…/74059c7c…，完整值在binaries-manifest.json。
- CLI Gate 使用真实PTY启动，显式提供本轮冻结二进制并保留fixture/TTY日志；不复用前版binary，不在测试期间继续写共享target中的受测文件。

- CLI Gate B完整exit0（cli-gate-tty.log）：真实stdio/双TTY、全部5语言、颜色策略、root/exec review、resume/fork、图片、output schema、stdin BOM/encoding、最终文件失败保护、退出码及canonical冷读通过。主Thread01a1253a-cfbb-7440-8127-abc03ff89820、Turn turn_986262348dda4e2e8b833dceccd03697。
- GUI资产默认入口会重新编译同一源码；仅停止本轮run-gui-finish的重复构建子树（exit143，不属于验证通过），然后用current prepareElectronAppServerAssets明确sourceBinary/sourceCodeModeHostBinary复用本轮冻结产物，准备资源不复刻实现、不改产品命令/协议。资源准备中的macOS native Swift helper冷编译仍进行。

## 固定发布候选与最终验证

- 2026-10-10 18:13:02 +0800 固定116文件候选，基线仍为287a64efc7e72ef836c6b31eec315a9d35f035a4；完整源码在`.lime/release/v1.154.0/candidate`，逐文件SHA256在`frozen-candidate.json`。包含第98阶段geometry owner修复；后续工作区变化不自动纳入发布。
- GUI资源准备完成，真实Electron shell smoke exit0（`gui-real-smoke.log`）。Run `standalone-shell-01-20261010101704-14031`，macOS arm64版本1.154.0，真实preload/IPC与`app_server_handle_json_lines`命中38次，mock fallback、renderer/preload/invoke错误均为0；证明桌面壳和设置/布局/恢复，不扩大为live provider或完整Agent chat验收。
- 原第97产物的MCP PTY在raw atomic draft断言失败（`tui-gate-b.log`，exit1）。保留失败，不通过修改framing、断言或timeout遮蔽。
- 固定候选使用独立APFS clone编译缓存`candidate-target`，未写入并行开发target；TUI fresh 1718 lib + 23 integration + 1 dependency guard全部通过（`frozen-tui-build.log`），locked CLI build exit0。与前轮重叠项不累计为新的总测试数。
- 固定候选三个受影响脚本守卫43/43通过（`frozen-tui-guards.log`），版本复核通过，正常pre-commit预检查116文件全部通过；使用独立索引`candidate.index`生成可审阅差异，主暂存区保持原状态。
- 最终CLI SHA256 `e216605d8a222021d193d4630b7458145ac9c28dbc5d6b0ff66401e5065caeca`，App Server SHA256 `74059c7c9b4732c48603b6057f6ad2f381df034a334b6ad0680cd5741a5ab257`。current snapshot helper复制完整runtime siblings，记录在`candidate-binaries-manifest.json`。
- 冻结MCP初次重验因macOS dylib loader缺少本轮进程局部搜索目录失败（`frozen-mcp-gate.log`），未到产品断言。补齐测试进程局部`DYLD_LIBRARY_PATH`后，stdio与真实PTY均exit0（`frozen-mcp-gate-retry.log`）：Thread `01a12562-aed4-7bd2-baa2-066ad4fa3f5b` / `01a12562-ce65-73e1-a1e0-4c18fff98bd5`，raw atomic、draft restored、complete exactly-once、terminal restored。不修改产品或系统环境；历史raw时序缺口不因单次通过宣称根因闭环。
- 常规11个TUI场景在相同源码和二进制上全部exit0（`frozen-tui-gate.log`）。主Thread `01a12563-7806-7e43-91ec-3b8ac47ec4e5`、Turn `turn_c248e15496174103ab15bc71edac4a4b`；raw notes、rich revisit、once、ASCII/IME、canonical cwd/first-arrow/cold-read、typed input/backtrack、图片/skills、focus/resize/reconnect与终端恢复均通过。该结果是本轮固定macOS候选证据，不声明历史间歇性根因全部闭环。
- 几何守卫最终ESLint、发布metadata Prettier检查exit0。源文件逐项SHA256无漂移，CLI实读1.154.0，原暂存区为空、HEAD仍为起始基线、本地tag不存在。

## 提交审阅与保留范围

- 固定候选共116文件：发布metadata为root/CLI package、Cargo workspace/lock版本、双语notes和本文；产品范围为上方111路径清单中的CLI/TUI/MCP、脚本、文档和测试，Cargo manifest/lock同时纳入原有依赖变化。
- `.lime/release/v1.154.0/staged-review.log`和`candidate.patch`提供独立索引的完整可审阅结果；不将持续变化的工作区直接全量暂存。最终确认以固定源码及本文的最终证据为准。
- 冻结后并行开发变化保留在主工作区，提议不纳入本版：`internal/exec-plans/tui-cli-codex-sync-next-plan.md`的新诊断记录、`lime-rs/crates/tui/src/bottom_pane/chat_composer/paste_input.rs`与`lime-rs/crates/tui/src/bottom_pane/request_user_input/state_tests.rs`新增的Unicode前缀/Tab诊断回归；临时`paste_burst.rs`探针已由其owner移除，仍需提交前重新盘点。排除范围须与本次commit/tag/push一并确认，未经批准不提交。
- 执行提交时使用固定候选作为Git worktree，保留正常现有hook，原工作区内容不覆盖；主索引对齐已批准候选后提交，以保留后续并行内容为未提交差异。用户确认后连续完成commit、tag、main/tag推送、远端SHA与workflow核验。
- current owner与test-only fixture分类见上文，无新增compat/deprecated；整体Codex对齐、Windows实机和live provider保持未完成/未验证。本地发布准备完成，端到端发布暂计80%，尚未执行任何commit/tag/push或远端发布。
