# Lime v1.147.0 发布执行计划

状态：源码及桌面 Release 已发布；完整发版完成度 95%，npm darwin-arm64 版本可见性/安装被暂存或后台处理状态阻塞；完整 Rust CI 未通过
日期：2026-10-01（北京时间）
目标：将全部当前未提交/未跟踪候选发布为 `v1.147.0`，完成 commit、tag、main/tag 推送与远端 Actions/Release/npm 复核。

## 范围与授权

- 起始基线：`a123afaf538005e5ac1d9ad9956ea4c262355ea8`；`main`、`origin/main` 与 `v1.146.0` 一致。
- 用户已回复“确认”，并进一步要求“继续”“全部都要递交”。commit、tag、推送授权有效；当前候选包含全部 tracked/untracked 文件。
- `release metadata`：根 npm/CLI package、Rust workspace/Cargo lock、双语单页 release notes、本计划与执行计划导航。
- `candidate changes`：TUI 任务中心、popup/composer/keymap/clipboard/history/status、CLI 权限与 Plugin、MCP OAuth logout 和登录关联、App Server protocol/schema/generated client、stdio/PTY fixtures、inventory、文档及 npm OIDC release workflow/guard。
- 用户“全部”要求覆盖此前排除的 `internal/exec-plans/release-v1.142.1-plan.md`，本次按历史记录纳入；它不替代本计划作为当前发版 owner。无人工排除的 tracked/untracked 文件。
- 本轮写集：上述 release metadata，以及 CLI surface Gate B 中过时 logout 断言与对应守卫、PTY suggestions 格式修复、popup 键盘路由中的输入缓冲同步，以及审批详情 PTY 的状态等待修复。已有产品源码修改由原写入进程收口，保留其修改。

## 版本事实源

- 版本 `1.147.0`；tag `v1.147.0`；前版 `v1.146.0`。
- 同步 `package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml` 和 Cargo lock 的 36 个 workspace 包版本；不升级依赖。
- Forge 从根 package 读取版本；pnpm lock 无独立发布版本；App Server 产物 manifest 由 current 打包链生成。
- 中文 primary、英文 companion release notes 均采用当前版本单页策略。

## 验证证据

- [x] `npm run verify:app-version`：`1.147.0`。
- [x] `npm run typecheck`：最终全部候选收口时重跑通过。
- [x] `npm run test:contracts`：299 checks 和全部边界/治理通过；后续新增切片仅在 TUI presentation/fixture，无协议/client 修改。
- [x] CLI all-targets：library `8/8`、binary `51/51`、integration `2/2`；protocol library `133/133`、schema fixture `1/1`。
- [x] 最终 TUI all-targets：library `1182/1182`、integration `18/18`、manager `1/1`。
- [x] lime-core `config::` `122/122`、lime-mcp `oauth::` `9/9`、App Server `mcp_oauth_` 公共 JSON-RPC `3/3`。
- [x] App Server client `139/139`、CLI npm `9/9`、发布/Gate/MCP fixture 定向 `72/72`；后续 TUI/CLI fixture 守卫按变更重跑。
- [x] 真实 CLI Gate B：thread `01a0f2a1-f625-7681-8c92-61a711f42c25`、turn `turn_d39fda17da364fa282d883a34e04aec5`，stdio/read model/JSONL/stdin/error/completion 通过。
- [x] 真实 CLI surface Gate B：MCP、features、Plugin、debug、execpolicy、queue、sandbox；OAuth logout 覆盖未知服务、stdio 拒绝与两次无凭据幂等。
- [x] 真实 Electron `verify:gui-smoke`：App Server `1.147.0`，壳加载/重载、三种窗口尺寸、设置页通过；summary `standalone-shell-01-20260930135938-87372/shell-01-electron-smoke/summary.json`。
- [x] 后续 TUI PTY Gate B：thread `01a0f2c1-621c-78e0-8883-cb17c2bf6e39`、turn `turn_df8c6a55eb1047449c6dc1919b2211b1`，canonical 事件链、queue-edit、agents-overview、sticky-prompt、main-find、focus-palette、resize/reflow、reconnect、terminal restore 通过。
- [x] 新增 popup suggestions 的真实 PTY complete 场景：thread `01a0f2da-fdb0-7ab1-a385-7fc2f18b5310`、turn `turn_119fe14e70834002a85dca8b9e96a823`。
- [x] 新增审批只读详情 PTY approval 场景：thread `01a0f2de-501a-7a00-ae59-306a1d6cc148`；打开/关闭详情不提前决定 protected request。
- [x] popup 输入缓冲修复回归 `2/2`；最终 TUI/CLI fixture 守卫 `25/25`。
- [x] 最终完整 TUI PTY Gate B：thread `01a0f2df-7413-7be1-9157-fcb9b2aa8e7d`、turn `turn_5f90cbe039074ccc862a38d09dee5f9a`；complete/approval/user-input/interrupt/failure/queue-edit/agents-overview、focus-palette/resize-reflow/reconnect 和 terminal restore 通过。
- [x] workspace fmt 与 `git diff --check`；新增 PTY suggestions 文件格式已修复。
- [x] git 写操作和全部候选递交授权。
- [x] `Release v1.147.0` commit `1cbc94e5f7f00b58f0580fafab1b202fdf4e9d0c`，183 文件；轻量 tag `v1.147.0` 与 main 已分别推送，远端两引用一致；提交 hook `182` 通过、`0` 失败。
- [x] Release run `36735313925`：Windows x64、macOS arm64/x64 Electron 构建与产物门禁成功，GitHub Release 于 `2026-09-30T16:11:46Z` 正式公开；Docs run `36735269856` 成功。
- [x] GitHub Release 的 9 个 Electron installer/archive/updater 资产已复核；`Publish Electron updater assets to Cloudflare R2` 成功。
- [x] Release run `36735313925` 完成，全部 11 个 job 成功；四个平台 CLI tarball 和 npm 根包均上传，GitHub Release 共 14 个资产。
- [x] `Publish CLI npm packages` job `110008773233`：四个平台包和根包均获得 npm 成功回执，根包 `1.147.0`、`latest=1.147.0` 和四个 optionalDependencies 已从 registry 复核。
- [ ] npm 平台版本：`18:09:14Z` 最终复核 linux-x64、win32-x64、darwin-x64 的声明版本均可查询；darwin-arm64 仍 E404，不能据 publisher job 成功声明四平台安装通过。
- [x] GitHub darwin-arm64 tarball SHA-256 `b0a971ca4ef666b704a1fadf7149bbe63c09d9052247cd4d2bb89bcb2518c524` 与资产 digest 一致；CLI/App Server/Code Mode host 和动态库齐全，实际 CLI 输出 `lime 1.147.0`。
- [ ] 从 npm 实际安装根包，经 launcher 与 sibling App Server 执行 CLI/TUI packaged Gate B；测试脚本冻结于 `v1.147.0`，使用隔离临时安装、缓存和 app data。
- [ ] main Quality run `36739923150`（`ba252e56950d2ea2d94622736e6c936fd89f4d86`）：Frontend Full、GUI Smoke、Integrity、Windows Shell Runtime 成功；Rust Full attempt 2 在既有 MCP 并发进度测试挂起后触及 60 分钟限制而 cancelled，Quality results failure，不能声明完整 CI 通过。
- [x] 远端 tag 保持 `1cbc94e5f7f00b58f0580fafab1b202fdf4e9d0c`；main 的两项后续测试修复已推送，不改写公开 tag。

## 修复与限制

初次并发 TUI 编译遇到尚未落盘模块，后续 popup 生命周期与两项 selection geometry/style 回归曾失败；原写入进程收口后，最终 `1182/1182` 全目标回归通过，旧失败结果不冒充通过。CLI surface fixture 原先仍期待 logout 协议缺失，本轮迁移到已实现 current 合同并以真实 CLI 复跑通过。无凭据 logout 不冒充 live OAuth 凭据删除证据。

真实 PTY 发现 `/status` 最后一个字符仍留在 paste-burst 缓冲中，弹窗提前消费 Enter 后该字符重新写回草稿。本轮在 popup 路由前同步 due input，并让活跃 paste 内的 Enter/Tab 保持草稿文本；补 owner 回归且真实 complete 通过。审批详情 PTY 原先只等待页面间共用提示，修为同时观察审批选项恢复及详情标题消失，不增加固定等待或跳过断言。

Rust 构建使用仓库 rusty-v8 artifact resolver 的已校验缓存，未修改系统环境变量或依赖。App Server 保留既有两处 dead-code warning；本轮不宣称全量 lint/Vitest/Cargo/Clippy 矩阵通过。跨平台 Forge、Windows 真机、签名/公证与 npm 分发由 GitHub runner 验证。

## 发布后的定向修复

远端 Frontend Full 的唯一已知失败为 `scripts/app-server/tui-history-pagination-fixture.mjs` 未登记在 ExternalBackend 测试夹具允许清单。该 fixture、测试与 support 在 `v1.146.0..v1.147.0` diff 为空，是既有守卫漏登记。检查确认 fixture 使用隔离临时 app data、受控 backend 和真实 CLI/App Server，不属于生产默认入口。

本轮补 `src/lib/governance/appServerRuntimeBoundary.testSupport.ts` 的精确允许路径，保留全目录扫描与生产 Runtime 默认断言；失败守卫定向 `2/2` 和 `npm run typecheck` 通过。作为 main 的独立测试修复提交，保持发布 tag 原提交，不宣称旧 tag 的 Quality run 已通过。推送后并发会话开始的下一项 request-user-input 改造属于发布后工作，保留其工作树，不覆盖、不并入本次标签。

第一项测试守卫修复提交 `faa8be408f3d78a23bcb35b91f30afb8e737c26e` 已推送 main，Quality run `36737461083`。该 run 的 Frontend Full 又在 batch `49/119` 发现既有 Coding roadmap 文案守卫漂移：README 已将下一刀改为 current-SHA Windows large-output evidence，旧断言仍要求先前的 unelevated runner 原文。本轮让 README 和 implementation 的断言分别守住当前证据缺口与既有 unelevated runner，不改路线图事实。

Rust Full 失败是既有 `paginated_history_jsonrpc_preserves_canonical_thread_turn_item_identity` 仍给出非规范 item ID `answer-item` 并要求原样返回；实际返回 `item_answer-item`，正文与 turn identity 均正确。迁移 fixture 输入和断言到规范 `item_answer`，保持公共 JSON-RPC 的 identity/text 检查，并补实际响应诊断；整个 `thread_v2_jsonrpc` target `19/19` 通过，没有 production/runtime 修改。

扩大治理目录验证：`47` files 通过、`440` tests 通过；唯一失败是本机外部 Codex checkout 的可选 `codexModelResponsesPolicyOrigin` 源码形状已经变化，不属于本次 Lime/tag 改动，保留失败记录、不修改外部仓库或跳过断言。两个 CI 失败守卫已通过。最后 `npm run typecheck`、owned Rust fmt 与 diff check 通过。

第二项测试修复提交 `ba252e56950d2ea2d94622736e6c936fd89f4d86` 已推送 main。其 Quality run `36739923150` 的 Frontend Full、GUI Smoke、Integrity、Windows Shell Runtime 均成功。Rust Full 首次在既有故障注入测试 `active_wait_recovers_terminal_result_written_after_initial_repair` 报 `spawned child child-thread has no durable identity`；该测试在先前 App Server library `1785/1785` 和本地定向复跑中通过，测试侧以固定 `40ms` sleep 删除/恢复 child identity，保留偶发失败记录。本轮未改生产逻辑或该测试。

执行 `gh run rerun 36739923150 --failed` 后，attempt 2 的 App Server library `1785/1785`、上述故障注入测试及分页 canonical identity 测试均通过。随后既有 `bridge_client::tests::concurrent_callers_receive_only_their_request_progress` 自 `17:13:56Z` 挂起，`17:52:35Z` 达到 Rust Full 的 60 分钟限制，job cancelled。该 bridge 文件在 `v1.146.0..v1.147.0` 无变更；不增加 CI 时限来掩盖挂起。新 cargo 定向复跑等待并发会话的 artifact 锁，120 秒退出；已有本地 MCP library 测试产物的精确复跑 `1/1`、`0.37s` 通过，只算缓存产物观察，不冒充新源码完整验证。该挂起根因尚未解决，保留为后续质量缺口。

本机读取 `updates.limecloud.com` 遇到 TLS EOF/`SSL_ERROR_SYSCALL`，未绕过证书，因此 R2 job 成功不提升为本机 CDN 可达性证据。最终 registry、公开资产和 CI 状态仍以远端收口结果为准。

## 远端分发复核

- 正式 Release：<https://github.com/limecloud/lime/releases/tag/v1.147.0>，非 draft、非 prerelease，发布时间北京时间 `2026-10-01 00:11:46`。
- 发布 Actions：<https://github.com/limecloud/lime/actions/runs/36735313925>，Electron 三平台、CLI 四平台、GitHub 资产、R2、npm publisher 全部成功。
- npm 发布日志：linux-x64 `17:22:49Z`、darwin-x64 `17:23:14Z`、darwin-arm64 `17:23:37Z`、win32-x64 `17:24:05Z`、根包 `17:24:11Z`，均出现对应 `+ @limecloud/...@1.147.0...` 成功回执，没有以重复版本跳过发布。
- 根包声明 `@limecloud/lime-linux-x64@1.147.0-linux-x64`、`@limecloud/lime-win32-x64@1.147.0-win32-x64`、`@limecloud/lime-darwin-x64@1.147.0-darwin-x64`、`@limecloud/lime-darwin-arm64@1.147.0-darwin-arm64`。截至 `2026-09-30T17:32:50Z`，本机 npm 和直接版本接口查询平台版本仍为 E404，保留事实差异，不冒充 registry/安装已通过。
- 截至 `17:40:11Z`，隔离 `npm install @limecloud/lime@1.147.0` 仅安装根包，launcher 实际报 `Missing optional dependency @limecloud/lime-darwin-arm64`；npm 官方状态页无活跃故障。本轮重跑已授权的 publisher job，复用原 tag/tarball，不改写版本或公开 tag；等待重跑和 registry 结果。
- Publisher attempt 2 / job `110016584431` 成功收尾：linux-x64、darwin-x64、win32-x64 返回对应版本已发布的 E403，darwin-arm64 返回 `E409 Cannot publish over previously staged version "1.147.0-darwin-arm64"`，根包已存在。原 workflow 的重复版本分支将这些状态跳过，因此 job 绿色不能替代 registry/安装证据。首次五个发布回执均明确提示包正在后台处理，暂存是否需要人工批准仍须账号侧核查。
- 截至 `2026-09-30T18:04:49Z`，macOS arm64 平台版本仍 E404；本机 `npm whoami` 返回 E401，不能查询账号侧 staged 详情。已请求维护者在 npmjs.com 的 Staged Packages 核查该版本；若存在待批准版本，通过本人 2FA 批准。官方流程：<https://docs.npmjs.com/staged-publishing>；未索取凭证/2FA code，未改账户安全设置或删除暂存版本。
- 最终 registry 复核 `2026-09-30T18:09:14Z`：linux-x64、win32-x64、darwin-x64 均返回根包声明的 `1.147.0-<platform>` 版本；darwin-arm64 仍返回 HTTP 404。因此实际剩余分发缺口收窄到 arm64，暂存或后台处理状态仍须账号侧确认，不把三平台可见性冒充四平台完成。
- 为把产物做成可核查结果，将已校验的 GitHub darwin-arm64 tarball 安装到隔离目录，与从 registry 安装的 `1.147.0` 根包组合。实际 launcher `--version` 和 sibling App Server CLI Gate B 通过：thread `01a0f372-370f-73d2-a106-ffcf51f18764`、turn `turn_a1f48e924c594c2bac097ea7c6d2330b`；stdio、canonical 事件/read model、JSONL/stdin/error exit/completion 通过。这是 GitHub tarball staging/本机 arm64 packaged 证据，不能宣称纯 npm registry 安装已通过。
- 额外 packaged TUI 复核未取得通过证据：隔离脚本快照没有 Rust workspace manifest，fixture 的 Rust PTY driver 无法启动；不在占用中的共享 target 再跑重型构建。发布冻结时的源码完整 TUI PTY Gate B 已通过，保留两个证据口径。
- 原 tag SHA 与发布提交保持不变；后续测试修复只进入 main。发布冻结后继续发生的并发 TUI 修改保留工作树，未并入 tag。

## 剩余退出条件

1. 维护者核查 npm 暂存状态及必要的本人认证，或 registry 后台处理完成，使根包声明的四个平台版本实际可查询。
2. 重试隔离的纯 npm registry 安装，并经真实 launcher 与 sibling App Server 获得分发证据；当前不能推荐该版本 npm 安装已经可用。
3. MCP 并发进度测试挂起另行在既有 MCP owner 排查，必要时补有诊断的有界等待；未解决前保持完整 Rust CI 未通过，不改写原发布 tag。

本轮最终收尾只写本发布计划。并发会话的 TUI、App Server projection/config、CLI 文档及 fixture 新改动均避让，不纳入后续证据提交。

## 架构与分类

主链保持 `Desktop Host / CLI-TUI Host -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item -> GUI/terminal projection`。MCP OAuth 扩展仍归既有 protocol/App Server/MCP credential owner；新增 TUI helper 是 presentation 内部分工，没有平行 runtime/history store 或新的 public boundary。本次无重大架构变更。

- current：CLI/TUI、MCP OAuth、protocol/schema/client 与 Forge/GitHub/npm 发布链。
- compat / deprecated：本轮无新增。
- dead / deleted：不恢复已退役 runtime/发布路径，本轮不删除文件。
- 历史记录：v1.142.1 发布计划按用户“全部”要求纳入，不升级为 current。

版本同步和窄 fixture 修复保持 KISS/DRY；不引入兼容包装或新依赖。

## 候选提交文件清单

全部 `183` 个文件，release metadata `8` 个，candidate changes `175` 个。

### release metadata

- `RELEASE_NOTES.en.md`
- `RELEASE_NOTES.md`
- `internal/exec-plans/README.md`
- `internal/exec-plans/release-v1.147.0-plan.md`
- `lime-rs/Cargo.lock`
- `lime-rs/Cargo.toml`
- `package.json`
- `packages/cli/package.json`

### candidate changes

- `.github/workflows/release.yml`
- `docs/ops.md`
- `internal/aiprompts/commands.md`
- `internal/exec-plans/release-v1.142.1-plan.md`
- `internal/exec-plans/tui-cli-codex-sync-next-plan.md`
- `internal/exec-plans/tui-structure-inventory.json`
- `lime-rs/crates/app-server-protocol/schema/json/app_server_protocol.schemas.json`
- `lime-rs/crates/app-server-protocol/schema/json/manifest.json`
- `lime-rs/crates/app-server-protocol/schema/json/v0/AppServerClientRequest.json`
- `lime-rs/crates/app-server-protocol/schema/json/v0/AppServerRequestMethod.json`
- `lime-rs/crates/app-server-protocol/schema/json/v0/McpServerOauthLoginParams.json`
- `lime-rs/crates/app-server-protocol/schema/json/v0/McpServerOauthLoginResponse.json`
- `lime-rs/crates/app-server-protocol/schema/json/v0/McpServerOauthLogoutParams.json`
- `lime-rs/crates/app-server-protocol/schema/json/v0/McpServerOauthLogoutResponse.json`
- `lime-rs/crates/app-server-protocol/schema/json/v2/McpServerOauthLoginCompletedNotification.json`
- `lime-rs/crates/app-server-protocol/schema/json/v2/ServerNotification.json`
- `lime-rs/crates/app-server-protocol/src/protocol/v0/catalog.rs`
- `lime-rs/crates/app-server-protocol/src/protocol/v0/client_request.rs`
- `lime-rs/crates/app-server-protocol/src/protocol/v0/mcp.rs`
- `lime-rs/crates/app-server-protocol/src/protocol/v0/method_names.rs`
- `lime-rs/crates/app-server-protocol/src/protocol/v0/schema_types.rs`
- `lime-rs/crates/app-server-protocol/src/protocol/v0/tests/catalog.rs`
- `lime-rs/crates/app-server-protocol/src/protocol/v2/mcp.rs`
- `lime-rs/crates/app-server-protocol/src/schema_export/registry.rs`
- `lime-rs/crates/app-server/src/local_data_source/impls/mcp.rs`
- `lime-rs/crates/app-server/src/local_data_source/mcp.rs`
- `lime-rs/crates/app-server/src/processor/dispatch.rs`
- `lime-rs/crates/app-server/src/processor/mcp.rs`
- `lime-rs/crates/app-server/src/processor/tests/mcp.rs`
- `lime-rs/crates/app-server/src/runtime/app_data/mcp.rs`
- `lime-rs/crates/app-server/src/runtime/mcp.rs`
- `lime-rs/crates/cli/src/main.rs`
- `lime-rs/crates/cli/src/mcp_cmd.rs`
- `lime-rs/crates/cli/src/plugin_cmd.rs`
- `lime-rs/crates/core/src/config/mod.rs`
- `lime-rs/crates/core/src/config/tui_keymap.rs`
- `lime-rs/crates/mcp/src/manager.rs`
- `lime-rs/crates/mcp/src/oauth.rs`
- `lime-rs/crates/mcp/src/oauth_tests.rs`
- `lime-rs/crates/tui/src/app.rs`
- `lime-rs/crates/tui/src/app/agent_center/hints.rs`
- `lime-rs/crates/tui/src/app/agent_center/input.rs`
- `lime-rs/crates/tui/src/app/agent_center/mod.rs`
- `lime-rs/crates/tui/src/app/agent_center/navigation.rs`
- `lime-rs/crates/tui/src/app/agent_center/render.rs`
- `lime-rs/crates/tui/src/app/agent_center/rows.rs`
- `lime-rs/crates/tui/src/app/agent_center_tests.rs`
- `lime-rs/crates/tui/src/app/agents_overview.rs`
- `lime-rs/crates/tui/src/app/agents_overview_grouping.rs`
- `lime-rs/crates/tui/src/app/agents_overview_render.rs`
- `lime-rs/crates/tui/src/app/agents_overview_tests.rs`
- `lime-rs/crates/tui/src/app/agents_overview_threads.rs`
- `lime-rs/crates/tui/src/app/agents_overview_view.rs`
- `lime-rs/crates/tui/src/app/app_server_events.rs`
- `lime-rs/crates/tui/src/app/event_dispatch.rs`
- `lime-rs/crates/tui/src/app/history_ui.rs`
- `lime-rs/crates/tui/src/app/history_ui_tests.rs`
- `lime-rs/crates/tui/src/app/input_flow.rs`
- `lime-rs/crates/tui/src/app/input_submission.rs`
- `lime-rs/crates/tui/src/app/interaction.rs`
- `lime-rs/crates/tui/src/app/mcp_login.rs`
- `lime-rs/crates/tui/src/app/reconnect.rs`
- `lime-rs/crates/tui/src/app/right_click_paste.rs`
- `lime-rs/crates/tui/src/app/startup.rs`
- `lime-rs/crates/tui/src/app/tests.rs`
- `lime-rs/crates/tui/src/app/thread_events.rs`
- `lime-rs/crates/tui/src/app/thread_settings.rs`
- `lime-rs/crates/tui/src/app/transcript_presentation.rs`
- `lime-rs/crates/tui/src/app/transcript_presentation_tests.rs`
- `lime-rs/crates/tui/src/app_server_session.rs`
- `lime-rs/crates/tui/src/bottom_pane/approval_render.rs`
- `lime-rs/crates/tui/src/bottom_pane/approval_render_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/agents_navigation.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/draft_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/file_search_popup.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/footer_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/footer_state_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/layout.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/mouse.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/paste_input.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/skill_popup.rs`
- `lime-rs/crates/tui/src/bottom_pane/chat_composer/vim_search.rs`
- `lime-rs/crates/tui/src/bottom_pane/command_popup.rs`
- `lime-rs/crates/tui/src/bottom_pane/footer.rs`
- `lime-rs/crates/tui/src/bottom_pane/mod.rs`
- `lime-rs/crates/tui/src/bottom_pane/paste_burst.rs`
- `lime-rs/crates/tui/src/bottom_pane/picker_rows.rs`
- `lime-rs/crates/tui/src/bottom_pane/render.rs`
- `lime-rs/crates/tui/src/bottom_pane/scroll_state.rs`
- `lime-rs/crates/tui/src/bottom_pane/selection_popup_common.rs`
- `lime-rs/crates/tui/src/bottom_pane/selection_popup_common_tests.rs`
- `lime-rs/crates/tui/src/bottom_pane/selection_row_layout.rs`
- `lime-rs/crates/tui/src/bottom_pane/selection_tabs.rs`
- `lime-rs/crates/tui/src/bottom_pane/shortcut_overlay.rs`
- `lime-rs/crates/tui/src/bottom_pane/shortcut_overlay_tests.rs`
- `lime-rs/crates/tui/src/clipboard_copy.rs`
- `lime-rs/crates/tui/src/clipboard_copy/worker.rs`
- `lime-rs/crates/tui/src/clipboard_paste.rs`
- `lime-rs/crates/tui/src/clipboard_paste/worker.rs`
- `lime-rs/crates/tui/src/fuzzy_match.rs`
- `lime-rs/crates/tui/src/history_cell/activity_preview.rs`
- `lime-rs/crates/tui/src/history_cell/mod.rs`
- `lime-rs/crates/tui/src/history_cell/separators.rs`
- `lime-rs/crates/tui/src/history_cell/session.rs`
- `lime-rs/crates/tui/src/keymap.rs`
- `lime-rs/crates/tui/src/keymap/hints.rs`
- `lime-rs/crates/tui/src/keymap/tests.rs`
- `lime-rs/crates/tui/src/lib.rs`
- `lime-rs/crates/tui/src/local_settings.rs`
- `lime-rs/crates/tui/src/locale.rs`
- `lime-rs/crates/tui/src/locale/agents.rs`
- `lime-rs/crates/tui/src/locale/pickers.rs`
- `lime-rs/crates/tui/src/locale/shortcuts.rs`
- `lime-rs/crates/tui/src/markdown.rs`
- `lime-rs/crates/tui/src/markdown_render.rs`
- `lime-rs/crates/tui/src/model_picker.rs`
- `lime-rs/crates/tui/src/model_picker/render.rs`
- `lime-rs/crates/tui/src/model_picker/render_tests.rs`
- `lime-rs/crates/tui/src/pager_overlay.rs`
- `lime-rs/crates/tui/src/pager_overlay/disclosure_tests.rs`
- `lime-rs/crates/tui/src/projection.rs`
- `lime-rs/crates/tui/src/resume_picker.rs`
- `lime-rs/crates/tui/src/runtime.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/approval.rs`
- `lime-rs/crates/tui/src/runtime_pty_tests/suggestions.rs`
- `lime-rs/crates/tui/src/shortcut_help.rs`
- `lime-rs/crates/tui/src/status/format.rs`
- `lime-rs/crates/tui/src/status/mod.rs`
- `lime-rs/crates/tui/src/status_indicator_widget.rs`
- `lime-rs/crates/tui/src/status_indicator_widget/summary_shimmer.rs`
- `lime-rs/crates/tui/src/style.rs`
- `lime-rs/crates/tui/src/style/selection.rs`
- `lime-rs/crates/tui/src/terminal_palette.rs`
- `lime-rs/crates/tui/src/transcript_view.rs`
- `lime-rs/crates/tui/src/transcript_view/bookmark.rs`
- `lime-rs/crates/tui/src/transcript_view/bookmark_tests.rs`
- `lime-rs/crates/tui/src/transcript_view/disclosure.rs`
- `lime-rs/crates/tui/src/transcript_view/prompt_header.rs`
- `lime-rs/crates/tui/src/transcript_view/prompt_header_tests.rs`
- `lime-rs/crates/tui/src/transcript_view/selection.rs`
- `lime-rs/crates/tui/src/transcript_view/selection_tests.rs`
- `lime-rs/crates/tui/src/tui.rs`
- `lime-rs/crates/tui/src/view.rs`
- `lime-rs/crates/tui/src/view/tests.rs`
- `lime-rs/crates/tui/src/view/tests/composer.rs`
- `lime-rs/crates/tui/src/view/tests/interaction.rs`
- `lime-rs/crates/tui/src/view/tests/navigation.rs`
- `lime-rs/crates/tui/src/view/tests/presentation.rs`
- `lime-rs/crates/tui/src/view/tests/suggestions.rs`
- `lime-rs/crates/tui/tests/suite/reconnect.rs`
- `packages/app-server-client/src/connection-methods.ts`
- `packages/app-server-client/src/generated/protocol-types.ts`
- `packages/app-server-client/src/protocol.ts`
- `packages/app-server-client/src/request-client-methods.ts`
- `packages/app-server-client/src/request-client.ts`
- `packages/app-server-client/src/server-notifications.ts`
- `packages/app-server-client/tests/client.test.mjs`
- `packages/app-server-client/tests/direct-notifications.test.mjs`
- `packages/cli/README.md`
- `scripts/README.md`
- `scripts/app-server/cli-gate-b.mjs`
- `scripts/app-server/cli-surface-gate-b.mjs`
- `scripts/app-server/cli-surface-gate-b.test.mjs`
- `scripts/app-server/terminal-gate-fixture.mjs`
- `scripts/app-server/tui-gate-b.mjs`
- `scripts/app-server/tui-gate-b.test.mjs`
- `scripts/app-server/tui-structure-inventory.test.mjs`
- `scripts/electron/lib/release-workflow-candidate-guard.mjs`
- `scripts/electron/release-workflow-guard.test.mjs`
- `scripts/mcp/current-smoke.test.mjs`
- `scripts/mcp/lib/contract-guards.mjs`
- `scripts/mcp/lib/current-smoke-core.mjs`
- `scripts/mcp/oauth-fixture-smoke.mjs`
