## Lime v1.1.0

### ✨ 主要更新

- **Lime 版本切换到 `v1.1.0` 稳定版**：应用版本与发布说明统一升级，发布产物、Tauri 配置和前端包版本保持一致
- **Aster Agent Framework 对齐 `aster-rust v0.25.0`**：Lime 声明的远端 `aster-core` / `aster-models` 依赖 tag 已同步提升，和当前本地联调的 `aster-rust` 版本保持一致
- **设置页与 Provider Pool 体验收口**：设置页重复标题移除，背景氛围层与小屏 Provider 排版整理，让设置主路径更接近当前设计语言
- **运行时与桥接稳定性补强**：补了浏览器运行时审计测试隔离、图片资源入库测试边界和相关工作台发送/模型列表回归，减少统一校验里的不稳定因素

### ⚠️ 发布与兼容性说明

- 本次发布 tag 为 `v1.1.0`，应用内版本号保持为 `1.1.0`；`.github/workflows/release.yml` 会按稳定版语义创建 GitHub Release
- Homebrew Tap 更新工作流不会再把本次发布视为 prerelease；Release 发布后会继续走稳定通道同步
- 当前仓库声明的 `aster-rust` 依赖已提升到 `v0.25.0`
- 本地如果启用了 `.cargo/config.toml` 的 Aster 覆盖，请确认它指向干净的 `v0.25.0` 仓库；GitHub Release runner 不会带本地绝对路径覆盖

### 🔗 依赖与版本同步

- 应用版本已同步提升到 `1.1.0`，覆盖 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `src-tauri/Cargo.lock` 会随本次 Rust 校验刷新，确保工作区 crate 的版本快照与 `1.1.0` 对齐
- `aster-core` / `aster-models` 的 git tag 已同步切换到 `v0.25.0`

### 🧪 发布前校验

- `cargo fmt --manifest-path src-tauri/Cargo.toml --all`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- `npm run lint`
- `npm run verify:app-version`
- `npm run test:contracts`
- `npm run verify:gui-smoke -- --reuse-running`
- 当前结果：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --all`：通过
  - `CARGO_TARGET_DIR=target-version-check cargo test --manifest-path src-tauri/Cargo.toml`：通过，`745 passed`，额外集成测试 `2 passed`，真实联网测试 `2 ignored`
  - `CARGO_TARGET_DIR=target-version-check cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：通过
  - `npm run lint`：通过
  - `npm run verify:app-version`：通过
  - `npm run test:contracts`：通过
  - `npm run verify:gui-smoke -- --reuse-running`：通过

### 📝 文档同步

- 发布说明已切换到当前这次 `v1.1.0` 稳定版发布内容，供 GitHub Release 直接读取
- 命令边界、质量流程、路线图与工作区相关文档会随当前主线收敛继续同步

---

**完整变更**: `v1.0.1` -> `v1.1.0`
