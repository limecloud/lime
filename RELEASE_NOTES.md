## Lime v1.5.1

### ✨ 主要更新

- `aster-rust` 依赖已从 `v0.27.1` 升级到 `v0.27.2`
- `src-tauri/Cargo.toml` 的远程 git tag 引用已同步到 `v0.27.2`
- 应用与 CLI 发布版本同步提升到 `1.5.1`，用于标记这次依赖补丁发布

### ⚠️ 发布与兼容性说明

- 本次发布 tag 为 `v1.5.1`，应用内版本号保持为 `1.5.1`
- `@limecloud/lime-cli@1.5.1` 要求 `Node >= 18`，支持 `darwin / linux / win32` 与 `x64 / arm64`
- 本次为补丁发布，主要目的是对齐 `aster-rust v0.27.2`，不额外引入新的 Lime 功能面
- 本地 `.cargo/config.toml` patch override 仍仅用于开发联调，不属于发布事实源

### 🔗 依赖与版本同步

- 应用版本已同步提升到 `1.5.1`，覆盖 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `packages/lime-cli-npm/package.json` 与 README 发布示例已同步更新到 `1.5.1`
- 本地 `package-lock.json` 也已同步到 `1.5.1`，用于版本一致性校验
- `src-tauri/Cargo.lock` 已刷新，`aster-core` / `aster-models` 已对齐到 `0.27.2`

### 🧪 发布前校验

- `cargo update --manifest-path src-tauri/Cargo.toml`
- `npm run verify:app-version`

### 📝 文档同步

- 发布说明已切换到当前这次 `v1.5.1` 补丁版内容，可直接作为 GitHub Release note 使用

---

**完整变更**: `v1.5.0` -> `v1.5.1`
