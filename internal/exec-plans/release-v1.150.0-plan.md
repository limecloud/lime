# Lime v1.150.0 发布执行计划

状态：进行中
日期：2026-10-04
基线：`v1.149.0` / `2adeff44f`
目标：将当前工作树中 v1.149.0 之后的 TUI/CLI ChatWidget、历史、交互、结构守卫、架构和执行计划改动作为 v1.150.0 release candidate，完成版本同步、发布说明、质量门禁和远端发布。

## Release candidate

- release metadata：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、`RELEASE_NOTES.md`、`RELEASE_NOTES.en.md`。
- candidate changes：当前工作树中全部已跟踪与未跟踪改动（TUI ChatWidget 拆分、历史分页/恢复、交互与输入生命周期、结构守卫、架构和执行计划），共 110 个已跟踪文件与 6 个未跟踪文件（含本发布计划与 5 个 ChatWidget 模块）；无排除项。
- excluded changes：无。工作区未发现可从本次发布自动排除的个人临时文件。

## 退出条件

- [x] 版本事实源统一为 `1.150.0`，`npm run verify:app-version` 通过。
- [x] 中文 primary 与英文 companion 仅保留 v1.150.0 内容。
- [x] `npm run typecheck` 通过。
- [x] `npm run test:contracts` 通过。
- [x] TUI 全目标测试、strict Clippy、结构守卫、TUI Gate B 与 CLI Gate B 通过；`npm run verify:gui-smoke` 构建通过但 Electron smoke 因缺少结构化 `summary.json` 失败，已记录为 harness-blocked。
- [ ] release candidate staged 摘要复核，取得 git 写操作确认。
- [ ] 创建 `Release v1.150.0` commit、`v1.150.0` tag，推送 `main` 与 tag，并复核远端 SHA。

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

远端只读检查 `git ls-remote` 因本机 Git 用户映射/凭据失败（`No user exists for uid 501`），待发布写操作时复核并记录。GUI smoke 的结构化 summary 缺失也需发布流水线或 harness 修复后补证据。
