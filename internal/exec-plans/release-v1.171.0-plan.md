# v1.171.0 发布执行记录

日期：2026-10-25。责任：root。目标：递交当前完整候选，创建并推送 `v1.171.0`。

## 范围、授权与写集

- 起点：`main` / `db02cea0093ad6f6d1b5e1526d1cd22d4ac67669`，上一标签 `v1.170.0`；初查远端 main 与本地相同，目标标签本地、远端均不存在。
- 用户要求“发布 v1.171.0”，随后明确要求“马上打tag 推送”，授权本次 release commit、新标签及 main/tag 推送；不重复请求确认。
- 初始候选为 968 个 tracked/untracked 改动路径，包含现有删除项；产品、测试、协议、客户端、资源、脚本、五语言和文档全部纳入，无主动排除项。
- 本轮直接写集仅为 `package.json`、`packages/cli/package.json`、`lime-rs/Cargo.toml`、`lime-rs/Cargo.lock`、两份 `RELEASE_NOTES*.md` 和本文件。
- 已有业务改动只读盘点并随候选递交，不重写领域 owner；不停止用户进程，不创建分支，不覆盖已有标签，不 force push。
- Forge 与 App Server manifest 动态读取根 package 版本；`pnpm-lock.yaml` 不含旧应用版本，无需改写。

## 分类与工程原则

- current：App Server/runtime、Computer Use、浏览器、模型路由、会话及设置的现役 owner。
- test-only：本候选新增或更新的回归与真实进程夹具；文件存在不等于验收通过。
- deleted：候选中被替换的 Chrome 实现、主题/皮肤、首页装饰、个人风格配置和重复 Skills 入口；无新增 compat/deprecated 包装。
- KISS/DRY：仅同步现有版本事实源，沿用动态 manifest 与既有发布流水线；不增加发布机制。
- 架构：本轮 metadata 不改变依赖方向；候选架构变更以现有 `internal/aiprompts/architecture.md` 与专项计划为准，不把 active/partial 专项提升为完成。

## 验证与执行

- `npm run verify:app-version`：通过，1.171.0；36 个 Cargo workspace 包版本已同步。
- `npm run typecheck`：已启动完整 Renderer/Node 检查；发布收口时仍在执行，按用户马上推送要求不阻断，最终结果另行报告。
- `npm run test:contracts`：已启动；收口时 protocol/client、command、harness、modality、scripts、release workflow、Desktop reference 与 CLI 边界已通过，cleanup/docs 阶段仍在执行，最终结果另行报告。
- `git diff --check`：原 tracked 改动通过；完整暂存检查发现既有 `model_registry_service/prompt.md:149` 一处行尾空格，保留候选原文，作为非阻断格式提示。
- 初次暂存：968 个文件变化，20,827 行新增、68,472 行删除（git rename 合并统计）。提交前发现 `extension_host.rs` 和 `chrome-bridge-e2e.mjs` 的并行格式化，复核为格式变化后纳入候选。最终清单以提交 tree 为准。
- 用户要求马上打标签推送：完整 TypeScript 检查可按 release workflow 降为非阻断项；本轮不等待新增 GUI smoke、Agent current fixture、Rust、CLI/TUI 或 macOS/Windows 打包矩阵，不声明其通过。
- 执行顺序：版本与发布说明 -> 必要快速检查 -> 暂存全部候选并复核 -> release commit -> 新建 `v1.171.0` -> 推送 `origin main` -> 显式推送 `origin v1.171.0` -> 比对远端 SHA 和 workflow 状态。

## 退出条件

发布提交包含候选，本地标签、远端 main 与远端标签指向同一提交。提交 SHA、推送终态与 GitHub Actions 为运行事实源；本文件随发布提交封存。本轮递交打标签推送与远端安装包发布分别报告，workflow 已触发不等于安装包已发布。
