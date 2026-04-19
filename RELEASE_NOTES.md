## Lime v1.14.0

### 主要更新

- 统一同步应用、Rust workspace、Tauri 配置、锁文件和 CLI npm wrapper 版本到 `1.14.0`
- 更新 GitHub Release 优先读取的 `RELEASE_NOTES.md`，补齐本次版本发布说明入口
- 更新 CLI npm wrapper 的示例版本与发布元信息，保持发布文档和产物命名约定一致
- 本次发布说明仅记录当前已确认的版本同步与校验事实，功能级变更请以最终合入内容为准

### 版本与发布同步

- 应用版本入口已对齐到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `package-lock.json`、`src-tauri/Cargo.lock`、`packages/lime-cli-npm/package.json` 与 `packages/lime-cli-npm/README.md` 已同步到 `1.14.0`
- 本次发布目标 tag 为 `v1.14.0`

### 已执行校验

- `npm run verify:app-version`：通过
- `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`：已执行
- `cargo test --manifest-path "src-tauri/Cargo.toml"`：通过，主测试集 `975` 个测试通过，额外 `2` 个定向集成测试通过；另有 `2` 个真实联网用例按默认配置保持 `ignored`
- `cargo clippy --manifest-path "src-tauri/Cargo.toml"`：通过，当前有 `1` 条非阻塞告警，位于 `src-tauri/crates/skills/src/lime_llm_provider.rs:255`，规则为 `clippy::too_many_arguments`
- `npm run lint`：通过

### 发布说明

- 这是一次以 `v1.14.0` 版本同步和发布元信息收口为主的发布准备更新
- 本轮已完成版本一致性、Rust 格式化、Rust 单测、Rust lint 与前端 lint 校验；用户可见功能变更请以最终合入内容为准

---

**完整变更**: `v1.13.0` -> `v1.14.0`
