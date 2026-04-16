## Lime v1.12.1

### 主要更新

- 修复 macOS 发布工作流：notarization 所需 secrets 缺失时直接阻断发布，不再继续产出 signed-only 但未 notarize 的安装包
- 调整 macOS 发布校验顺序：在上传产物前增加 `.app` 的 `spctl` 和 `xcrun stapler validate` 检查，确保发布资产符合签名与公证预期
- 统一同步应用、Rust workspace、Tauri 配置和 CLI npm wrapper 版本到 `1.12.1`

### 版本与发布同步

- 应用版本入口已对齐到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- CLI npm wrapper 版本与 README 发布示例已同步到 `1.12.1`
- 本次发布目标 tag 为 `v1.12.1`

### 计划执行校验

- `npm run verify:app-version`
- `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
- `cargo test --manifest-path "src-tauri/Cargo.toml"`
- `cargo clippy --manifest-path "src-tauri/Cargo.toml"`
- `npm run lint`

### 发布说明

- 这是一次以发布链路修复为主的补丁版本，核心目标是避免类似 `v1.12.0` 那样在 macOS notarization 失败后仍继续对外发布问题包
- 若 macOS notarization 再次失败，CI 现在会直接失败并阻止发布，需要先修复签名或公证环境后再重新发版

---

**完整变更**: `v1.12.0` -> `v1.12.1`
