## Lime v1.10.0

### ✨ 主要更新

- 本次 `v1.10.0` 重点把 Harness Engine 的验证事实源进一步收口到同一条主链：`evidence / analysis / review / dashboard / cleanup` 现在共享同一套 verification facts 语义，前端 review 与 evidence 展示也开始复用统一的验证结果区块
- Agent 工作台继续围绕 General Workbench、Harness 状态、Tool Search / Tool Call、Inline Process Step、Message List 与 Review Decision 做交互收敛，工作区输入发送与场景运行时同步补齐了一批回归测试
- 资源工作台补上图片资源工作台与分类浏览能力，Provider Pool 同步把 Prompt Cache 认知前置到配置 UI，`anthropic-compatible` 渠道与官方兼容 Host 的展示口径进一步统一
- 仓库治理继续做减法：独立 `terminal / tools / image-gen / video` 页面面已下线，只保留当前主路径需要的运行时与 API 能力，侧边栏与旧页面残留同步清退
- `docs/roadmap/harness-engine/`、`docs/aiprompts/quality-workflow.md`、`docs/aiprompts/terminal.md`、`docs/aiprompts/providers.md` 等文档已按当前实现刷新，长期路线图与工程边界描述同步更新

### 🔗 版本与发布同步

- 应用、Rust workspace 与 CLI npm wrapper 版本已统一提升到 `1.10.0`
- 应用版本入口已对齐到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `package-lock.json`、`src-tauri/Cargo.lock`、`packages/lime-cli-npm/package.json` 与 CLI README 示例已同步到当前版本
- 本次发布目标 tag 为 `v1.10.0`

### 🧪 已执行校验

- `npm run verify:app-version`
- `npm test -- src/components/settings-v2/system/about/index.test.tsx`
- `cargo test --manifest-path "src-tauri/Cargo.toml"`
- `cargo clippy --manifest-path "src-tauri/Cargo.toml"`：通过，当前包含 1 条 `clippy::if_same_then_else` 告警，位置在 `src-tauri/crates/core/src/models/provider_pool_model.rs`
- `npm run lint`

### ⏳ 待执行发布动作

- `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
- 创建并推送 `v1.10.0` tag
- 推送当前分支到 GitHub

### 📝 发布说明

- 本次发布说明按当前工作区完整改动刷新，重点覆盖 Harness Engine 验证闭环、Agent Workspace 交互收口、资源工作台与 Provider 配置体验，以及旧页面面的治理减法
- 由于 `cargo fmt --all` 和 `git tag / git push` 具有批量改写或发布风险，当前 release note 已明确把它们标记为待执行动作；完成后可直接作为 GitHub Release note 使用

---

**完整变更**: `v1.9.0` -> `v1.10.0`
