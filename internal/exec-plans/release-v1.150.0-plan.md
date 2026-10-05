# Lime v1.150.0 发布执行计划

状态：commit / tag 已推送，Windows Squirrel 安装门禁失败，GitHub Release 尚未公开
日期：2026-10-05
基线：`v1.149.0` / `2adeff44f`
目标：将当前工作树中 v1.149.0 之后的 TUI/CLI ChatWidget、历史、交互、结构守卫、架构和执行计划改动作为 v1.150.0 release candidate，完成版本同步、发布说明、质量门禁和远端发布。

## Release candidate

- release metadata：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、`RELEASE_NOTES.md`、`RELEASE_NOTES.en.md`。
- candidate changes：当前工作树中全部已跟踪与未跟踪改动（TUI ChatWidget 拆分、历史分页/恢复、交互与输入生命周期、结构守卫、架构和执行计划），最终 release commit 包含 117 个路径；初始盘点为 110 个已跟踪文件与 6 个未跟踪文件，暂存前又纳入 1 个并行产生的 TUI 改动；无排除项。
- excluded changes：无。工作区未发现可从本次发布自动排除的个人临时文件。

## 退出条件

- [x] 版本事实源统一为 `1.150.0`，`npm run verify:app-version` 通过。
- [x] 中文 primary 与英文 companion 仅保留 v1.150.0 内容。
- [x] `npm run typecheck` 通过。
- [x] `npm run test:contracts` 通过。
- [x] TUI 全目标测试、strict Clippy、结构守卫、TUI Gate B 与 CLI Gate B 通过；`npm run verify:gui-smoke` 构建通过但 Electron smoke 因缺少结构化 `summary.json` 失败，已记录为 harness-blocked。
- [x] release candidate staged 摘要复核，取得 git 写操作确认。
- [x] 已创建并推送 `Release v1.150.0` commit（`b34f89280`）与 `v1.150.0` tag。
- [ ] Release workflow 全部必要 job 通过，公开 GitHub Release 和安装 / CLI 产物。

## 架构确认

主链保持 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item -> GUI/terminal projection`。本候选只收敛 TUI ChatWidget session-local owner、历史 completion/event flow 和交互 presentation，不新增平行 runtime、协议后端、历史存储或兼容层；责任开发者 root，2026-10-04。

## 验证记录

- `npm run verify:app-version`：通过（1.150.0）。
- `npm run typecheck`：通过。
- `npm run test:contracts`：通过（协议、命令、harness、modality、脚本、Electron release workflow、Desktop/CLI 边界、docs boundary）。
- `cargo test --manifest-path "lime-rs/Cargo.toml" -p tui --all-targets --no-default-features`：通过，1465 library + 23 integration + 1 dependency guard。
- `cargo clippy --manifest-path "lime-rs/Cargo.toml" -p tui --all-targets --no-default-features --no-deps -- -D warnings`：通过。
- TUI 结构守卫 Vitest：82/82 通过。
- `npm run governance:legacy-report`：扫描 2068 文件，零引用候选 0、分类漂移 0、边界违规 0。
- `npm run smoke:tui-gate-b`：通过，thread `01a104d9-f748-74e1-bd85-39b1d9b8e44a`，terminal restored。
- `npm run smoke:cli-gate-b`：通过，thread `01a104db-75b9-7e21-8341-388a0547cc88`，JSONL/stdin/error-exit/completion 全部通过。
- `npm run verify:gui-smoke`：renderer、Electron main/preload、App Server sidecar 构建通过；真实 Electron smoke 未生成 `.lime/qc/project-gates/.../shell-01-electron-smoke/summary.json`，退出码 1，Desktop Gate B 为 `unverified / harness-blocked`。

## 当前阻塞

Git 的 `No user exists for uid 501` 已通过临时 libssh2 transport 恢复推送；本机 GitHub API 凭据仍不可用，公开 API 无法读取 Actions 日志或下载 evidence artifact。

- Release run `37180108159` 和同一 tag / SHA 重触发的 run `37182748588` 均失败于 `Smoke installed Windows Squirrel candidate`；两个 macOS 构建均通过，最终 Electron / R2 / CLI 发布被跳过。
- Windows smoke 实现与 workflow 相对 v1.149.0 没有变化，目前只有退出码 1，尚无已证实根因；不得跳过门禁或把重试成功当作根因修复。
- 2026-10-05 创建隔离分支 `release-diagnostics-v1.150.0`，仅新增只读诊断 workflow，run `37253756162` 读取失败 run 的 Squirrel summary artifact，提取 failedStage / error / assertions。此诊断分支不修改 main、版本 tag 或本地工作区。
- Tag 推送后出现的 TUI/MCP/approval 后续改动不属于已冻结的 release candidate，继续避让；恢复发布仅认领 release workflow / Windows smoke owner 与本计划。
- 本地 GUI smoke 缺少结构化 summary，Desktop Gate B 仍需发布流水线补证据。

## Windows 发布恢复（2026-10-05）

- 只读诊断 run `37253756162` 成功读取 artifact，确认 `failedStage=n-minus-one-update`、`error=timed out waiting for N-1 automatic update check`。
- 根因：v1.149.0 的 sidebar 重构移除 `AppUpdateEntry` 挂载，首页不再发起该检查；N-1 smoke 仍假定首页会自动离开 `idle`。当前“设置 → 关于”页面的 `AboutSection` 仍调用 `checkForUpdates({ automatic: true })`，updater owner 与协议未改变。
- 修复：先观察 N-1 会话；仅在 `idle` 时通过 GUI 打开 settings/about。已经检查或下载时继续观察，不直接补发 native check、不合成完成态、不跳过 feed / 下载 / 安装 / SHELL-01 / 版本匹配门禁。同时把 failedStage / error 输出为 Actions annotation，后续无需下载私有日志即可定位失败。
- 恢复写集：Windows smoke 主脚本、既有 N-1 helper、回归测试、release/updater 文档、本计划与双语 release notes。15 个后续 TUI/MCP/approval 文件明确排除，保持原始 release candidate 产品代码。
- 回归：Windows smoke / packaged evidence / workflow guard / docs guard 四个测试文件 `88/88` 通过；`npm run verify:app-version`、`npm run typecheck`、`npm run test:contracts` 均通过。实际 Windows 平台验证由恢复后的 release run 给出，macOS 本地不冒充 Windows evidence。
- 当前分类：Forge Squirrel、Electron built-in updater 与真实 GUI 升级门禁为 `current`；临时诊断 workflow 为诊断分支上的一次性 evidence，不进入 main 或 release tag；未新增 compat / deprecated 入口，未恢复 dead runtime。
- 退出条件：将上述窄写集提交并推送 main，保持版本 `1.150.0` 将尚未公开的 release tag 指向修复提交，release workflow 必要平台门禁和 GitHub / CLI 发布成功，删除临时诊断分支并回写证据。

## 本地发布结果

- commit：`b34f89280`（`Release v1.150.0`）
- tag：本地和远端 `v1.150.0` 均指向 `b34f89280`
- 远端：`origin/main` 指向 `3d3a58b74`；release workflow 尚未通过，GitHub Release 为未公开状态。
