# Lime v1.149.0 发布执行计划

状态：已发布
日期：2026-10-02
基线：`v1.148.0` / `dd9a851a0`
目标：将当前工作树中的 TUI/GUI/脚本与文档改动作为 v1.149.0 release candidate，完成版本同步、发布说明、质量门禁和远端发布。

## Release candidate

- release metadata：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、`RELEASE_NOTES.md`、`RELEASE_NOTES.en.md`。
- candidate changes：v1.148.0 之后工作树中全部已跟踪与未跟踪产品、测试、脚本、i18n、架构、执行计划和 smoke 同步改动（最终原始清单由 `git diff --name-only` 与 `git ls-files --others --exclude-standard` 生成），包含定时任务编辑器/列表重构与 rail 设置入口的真实 Electron smoke 适配。
- excluded changes：无。工作区未发现可从本次发布自动排除的个人临时文件。

## 退出条件

- [x] 版本事实源统一为 `1.149.0`，`npm run verify:app-version` 通过。
- [x] 中文 primary 与英文 companion 仅保留 v1.149.0 内容。
- [x] `npm run typecheck` 通过。
- [x] `npm run test:contracts` 通过。
- [x] `npm run verify:gui-smoke` 通过；真实 Electron/preload/IPC、App Server JSON-RPC 及三尺寸布局 smoke 证据已记录。
- [x] release candidate staged 摘要复核，取得 git 写操作确认。
- [x] 创建 `Release v1.149.0` commit、`v1.149.0` tag，推送 `main` 与 tag，并复核远端 SHA。

## 架构确认

主链保持 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> canonical Thread/Turn/Item -> GUI/terminal projection`。本候选的 TUI ChatWidget owner 收敛与 GUI 侧栏拆分未新增平行 runtime、协议后端或兼容层；责任开发者 root，2026-10-02。
