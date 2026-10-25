# v1.170.0 发布执行记录

日期：2026-10-25。责任：root。目标：递交当前 release candidate，创建 `v1.170.0` 并推送 GitHub。

## 范围与授权

- 起点：`main` / `d14468ca0a15bdae66988fddb3274ced4c8da3ab`；上一标签 `v1.169.0` / `8e7f654f48049c703b514ca02a9f8aa4679f6148`。
- 用户先要求“发布 v1.170.0”，随后明确要求“先递交打tag 吧”“然后推送到github”；这两条指令授权本次 release commit、创建新标签和推送 main/tag，不再重复请求确认。
- 当前 tracked/untracked 产品、测试、协议、生成客户端、脚本、五语言与文档改动全部属于候选，无主动排除项。已删除路径随候选递交；不恢复旧实现或临时源码镜像。
- 初始盘点：1,095 个改动路径（744 修改、72 删除、279 未跟踪）；最终清单以发布提交的 git tree 为准。初始清单与输入摘要保存于 `.lime/release-v11700/`。

## 本轮写集

- 版本：`package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`（36 个 workspace 包版本）。
- 发布文档：`RELEASE_NOTES.md`、`RELEASE_NOTES.en.md` 和本文件；发布说明采用目标版本单页。
- Forge 和 App Server release manifest 从根 package 读取版本；`pnpm-lock.yaml` 无显式旧应用版本，无需改写。
- 现有产品写集先只读盘点并统一递交，保留各领域 owner；不覆盖浏览器、协议、设置等已有实现，不停止用户正在运行的 Electron/dev 进程。

## 实现与分类

- current：共享 App Server/runtime、浏览器、插件/MCP/Hooks、本地环境与设置等现役 owner 的增量。
- test-only：新增定向回归、真实进程夹具、源码取样收据与验证记录；其存在不等于产品验收通过。
- deleted：本候选既有删除清单中的旧入口及被替代文件；本轮不另建 compat/deprecated 包装。
- KISS/DRY：仅同步现有版本事实源，沿用 Forge 与 App Server 动态版本读取；不增加第二套发布机制。
- 架构：本轮 release metadata 不改变 owner 或依赖方向；候选包含的源码迁移和宿主接线架构确认保留在 `internal/aiprompts/architecture.md` 及对应专项计划。本版不将仍 active/partial 的专项标记完成。

## 验证与发布顺序

- `npm run verify:app-version`：通过，1.170.0。
- `npm run typecheck`：通过，exit 0；完整 Renderer/Node 检查，日志 `.lime/release-v11700/typecheck.log`。
- `npm run typecheck:electron`：通过，exit 0。
- `npm run test:contracts`：通过，exit 0；包括 protocol/client/command/harness、modality、scripts、release workflow、Desktop reference、CLI 与 docs 边界。
- `git diff --check`：原 tracked 改动通过；完整暂存后 `git diff --cached --check` 报三处原始验证日志末尾空行（`execpolicy-tests.txt`、`script-tests.txt`、`string-tests.txt`）。保留证据原件，按用户先递交要求作为非阻断格式提示记录。
- 暂存摘要：1,084 个文件变化（git rename 合并统计），118,234 行新增、25,256 行删除；七个 release metadata/记录文件，其余为完整候选。完整文件清单与 stat 保存于 `.lime/release-v11700/staged-{files,stat}.txt`；暂存后无遗留 tracked/untracked 候选。
- 按用户“先递交打tag”要求，本次不等待新增 GUI smoke、Agent current fixture、Rust 或跨平台打包测试；这些项目未在本轮执行，不能借历史记录声明通过。完整 Computer Use、Chrome/Office、Windows/macOS 权限及独立 CLI/TUI 验收仍以专项计划为准。
- 操作顺序：复核完整候选 -> `git add -A` -> `git commit -m "Release v1.170.0"` -> `git tag v1.170.0` -> 推送 `origin main` -> 显式推送 `origin v1.170.0` -> 比对本地/远端 SHA 与 GitHub Release workflow。
- 不覆盖已有标签、不 force push；遇到远端冲突先依据实际状态处理。

## 退出条件

发布提交包含完整候选，本地标签、远端 main 与远端标签均指向该提交；GitHub Release workflow 已触发并报告实际状态。本文件随发布提交封存，提交 SHA、推送终态及 CI 结果以 git 对象、远端 refs 和 GitHub Actions 为事实源。本地递交推送与远端打包发布分别报告，不把 workflow running 记为安装包发布成功。
