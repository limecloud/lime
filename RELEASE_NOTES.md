## Lime v1.12.3

### 主要更新

- 将 macOS 应用 Bundle Identifier 从 `com.lime.app` 切换为 `com.limecloud.lime`，与 Apple Developer 后台新注册的 App ID 对齐
- 同步更新 Homebrew Cask 的 macOS 清理路径，避免卸载逻辑继续引用旧的 `com.lime.app`
- 统一同步应用、Rust workspace、Tauri 配置和 CLI npm wrapper 版本到 `1.12.3`

### 版本与发布同步

- 应用版本入口已对齐到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- CLI npm wrapper 版本与 README 发布示例已同步到 `1.12.3`
- macOS Bundle Identifier 已切换为 `com.limecloud.lime`
- 本次发布目标 tag 为 `v1.12.3`

### 计划执行校验

- `npm run verify:app-version`
- `npm run verify:gui-smoke`

### 发布说明

- 这是一次以 macOS 应用身份对齐为主的补丁版本，目标是让仓库配置、Apple Developer App ID 和发布产物使用同一 Bundle Identifier
- 若 Apple Developer 协议已完成更新，本次 Release 可用于验证 notarization 是否恢复正常

---

**完整变更**: `v1.12.2` -> `v1.12.3`
