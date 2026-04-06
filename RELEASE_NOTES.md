## Lime v1.4.0

### ✨ 主要更新

- **通用工作台成为当前主壳**：Agent 聊天工作区继续从旧 `ThemeWorkbench*` 表面收口到 `GeneralWorkbench*` 主链，侧边栏、上下文面板、执行日志、工作流面板、输入区启动边界与任务预览统一落到新的通用工作台运行时；一批旧 `ThemeWorkbench` 组件、hook 与 compat 状态层退出 current 主路径
- **服务技能与命令运行时扩容**：前后端围绕 `analysis`、`summary`、`translation`、`pdf_read`、`report_generate`、`research`、`site_search`、`broadcast_generate`、`typesetting`、`modal_resource_search` 等技能补齐 `*_skill_launch` 主链，原始用户输入继续保留进入 Agent turn，启动 metadata、prompt context、runtime turn 和 tool runtime 的事实源进一步收口
- **站点技能与工作台协议继续收敛**：`service_skill_launch` 继续统一站点技能启动语义，站点技能预执行结果、站点适配器上下文、Team 运行时偏好、artifact metadata 与工作台上下文同步链路一起补齐；浏览器 compat 工具前缀在相关场景下继续被隔离，避免回流旧边界
- **文档与治理目录同步更新**：`docs/aiprompts/command-runtime.md`、`commands.md`、`quality-workflow.md`、`playwright-e2e.md`、`overview.md` 等工程文档已围绕当前服务技能主链与通用工作台事实源完成更新，默认技能目录新增并收口 `analysis / pdf_read / report_generate / summary / translation`
- **版本与依赖面同步发版**：Lime 应用与 `@limecloud/lime-cli` 升级到 `1.4.0`，Rust workspace crate 版本快照、Tauri 配置与 CLI README 示例同步更新；`aster-rust` Git tag 升级到 `v0.27.0`

### ⚠️ 发布与兼容性说明

- 本次发布 tag 为 `v1.4.0`，应用内版本号保持为 `1.4.0`
- `@limecloud/lime-cli@1.4.0` 要求 `Node >= 18`，支持 `darwin / linux / win32` 与 `x64 / arm64`
- 当前 Agent GUI 主路径以 `GeneralWorkbench*` 为准；旧 `ThemeWorkbench*` 相关组件、壳层和一批 compat hook 已继续退出，不应再作为 current surface 扩展
- 当前默认技能目录已包含 `analysis`、`broadcast_generate`、`modal_resource_search`、`pdf_read`、`report_generate`、`research`、`site_search`、`summary`、`translation`、`typesetting` 等服务技能主链
- `aster-rust` 依赖已固定到远程 tag `v0.27.0`；本地 `.cargo/config.toml` patch override 仍仅作为开发联调手段，不属于发布事实源

### 🔗 依赖与版本同步

- 应用版本已同步提升到 `1.4.0`，覆盖 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `packages/lime-cli-npm/package.json` 与 README 发布示例已同步更新到 `1.4.0`
- `src-tauri/Cargo.lock` 已刷新：工作区内部 crate 版本快照已对齐到 `1.4.0`，`aster-core` / `aster-models` 已对齐到 `0.27.0`
- `package-lock.json` 已同步根应用版本号到 `1.4.0`

### 🧪 发布前校验

- `npm run verify:app-version`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all`
- `npm run lint`
- `npm run test:contracts`
- `CARGO_TARGET_DIR=src-tauri/target/codex-verify CARGO_INCREMENTAL=0 cargo test --manifest-path src-tauri/Cargo.toml`
- `CARGO_TARGET_DIR=src-tauri/target/codex-verify CARGO_INCREMENTAL=0 cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- `CARGO_TARGET_DIR=src-tauri/target/codex-verify npm run verify:gui-smoke`
- 当前结果：
  - `npm run verify:app-version`：通过
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --all`：通过
  - `npm run lint`：通过
  - `npm run test:contracts`：通过
  - `cargo test --manifest-path src-tauri/Cargo.toml`：通过
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：通过
  - `npm run verify:gui-smoke`：通过

### 📝 文档同步

- 发布说明已切换到当前这次 `v1.4.0` 稳定版发布内容，可直接作为 GitHub Release note 使用
- 服务技能主链、命令运行时、GUI 续测与工程质量文档已与当前实现同步
- 通用工作台命名、默认技能目录与命令运行时事实源已围绕当前实现完成收口

---

**完整变更**: `v1.3.0` -> `v1.4.0`
