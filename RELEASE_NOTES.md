## Lime v1.2.0

### ✨ 主要更新

- **Team Runtime 与 Agent 工具面继续收敛**：`Agent / SendMessage / TeamCreate / TeamDelete / ListPeers` 继续作为 current 协作主链，Team 选择、角色信息、蓝图角色锚点与子代理结构化字段说明保持一致，Tool inventory / ToolSearch / MCP runtime 可审计性进一步补强
- **Lime CLI 与媒体任务主链落地**：新增 `lime-cli` Rust crate 与 `@limecloud/lime-cli` npm 包，统一图片、封面、视频、播报、链接解析、排版、素材检索等任务的创建、状态、attempts 与 retry 语义，`.lime/tasks` 与任务日志协议同步进入文档
- **GUI 主路径与旧表面继续清理**：Agent Chat Workspace、Empty State、Workbench 画布和 MCP tools browser 按当前主路径整理，旧 `Claw Home / Claw Solutions` 表面继续退出，Provider / companion 偏好入口与工作台状态保持一致
- **版本与依赖对齐**：Lime 应用版本升级到 `1.2.0`，`aster-core` / `aster-models` 依赖 tag 对齐到 `v0.26.0`，发布工作流、Tauri 配置和 npm 包版本一起收口

### ⚠️ 发布与兼容性说明

- 本次发布 tag 为 `v1.2.0`，应用内版本号保持为 `1.2.0`
- `@limecloud/lime-cli@1.2.0` 要求 `Node >= 18`，支持 `darwin / linux / win32` 与 `x64 / arm64`
- 当前仓库声明的 `aster-rust` 依赖已提升到 `v0.26.0`
- 本地若启用了 `.cargo/config.toml` 的 Aster 覆盖，请确认它指向干净的 `v0.26.0` 仓库；GitHub Release runner 不会携带本地绝对路径覆盖
- `SubAgentTask` 仍只保留 compat 读取边界；当前协作主链是 `Agent` tool 配合 Team runtime

### 🔗 依赖与版本同步

- 应用版本已同步提升到 `1.2.0`，覆盖 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `packages/lime-cli-npm/package.json` 与配套 README 示例已同步更新到 `1.2.0`
- `src-tauri/Cargo.lock` 会随本次 Rust 校验刷新，确保工作区 crate 版本快照与 `1.2.0` 对齐
- `aster-core` / `aster-models` 的 git tag 已同步切换到 `v0.26.0`

### 🧪 发布前校验

- `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`
- `CARGO_TARGET_DIR=target-release-1.2.0 cargo test --manifest-path src-tauri/Cargo.toml`
- `CARGO_TARGET_DIR=target-release-1.2.0 cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- `npm run lint`
- `npm run verify:app-version`
- `npm run test:contracts`
- `npm run verify:gui-smoke`
- 当前结果：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`：通过
  - `CARGO_TARGET_DIR=target-release-1.2.0 cargo test --manifest-path src-tauri/Cargo.toml`：通过，`758 passed`，额外集成测试 `2 passed`，真实联网测试 `2 ignored`
  - `CARGO_TARGET_DIR=target-release-1.2.0 cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：通过
  - `npm run lint`：通过
  - `npm run verify:app-version`：通过
  - `npm run test:contracts`：通过
  - `npm run verify:gui-smoke`：通过

### 📝 文档同步

- 发布说明已切换到当前这次 `v1.2.0` 稳定版发布内容，供 GitHub Release 直接读取
- 工具治理、质量流程、命令边界与任务协议文档已随当前主线更新，和本次发布版本保持一致

---

**完整变更**: `v1.1.0` -> `v1.2.0`
