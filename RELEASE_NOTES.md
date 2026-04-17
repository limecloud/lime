## Lime v1.13.0

### 主要更新

- 收口 `SceneApp / Context Layer` 当前 latest-only 产品面，`detail / scorecard / run detail / governance` 统一改为消费同一份 `planResult / contextBaseline` 事实源
- SceneApp planning、runtime、Tauri mock 与前端运行时已补齐显式灵感引用、项目级 Context Snapshot 基线、人工复核与轻量反馈沉淀链路
- 修复 macOS 发布工作流：notarization 所需 secrets 缺失时直接阻断发布，不再继续产出 signed-only 但未 notarize 的安装包
- 调整 macOS 发布校验顺序：在上传产物前增加 `.app` 的 `spctl` 和 `xcrun stapler validate` 检查，确保发布资产符合签名与公证预期
- 统一同步应用、Rust workspace、Tauri 配置、锁文件和 CLI npm wrapper 版本到 `1.13.0`

### 版本与发布同步

- 应用版本入口已对齐到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `package-lock.json`、`src-tauri/Cargo.lock`、`packages/lime-cli-npm/package.json` 与 `packages/lime-cli-npm/README.md` 已同步到 `1.13.0`
- 本次发布目标 tag 为 `v1.13.0`

### 已执行校验

- `npm run verify:app-version`：通过
- `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`：已执行
- `cargo test --manifest-path "src-tauri/Cargo.toml"`：通过，主测试集 `975` 个测试通过，额外 `2` 个定向集成测试通过；另有 `2` 个真实联网用例按默认配置保持 `ignored`
- `cargo clippy --manifest-path "src-tauri/Cargo.toml"`：通过，当前有 `1` 条非阻塞告警，位于 `src-tauri/crates/skills/src/lime_llm_provider.rs:255`，规则为 `clippy::too_many_arguments`
- `npm run lint`：通过

### 发布说明

- 这是一次以 `SceneApp / Context Layer` 主线收口和发布链路修复为主的小版本发布，既覆盖场景规划与复盘事实源统一，也继续补齐 macOS 发版门禁
- 若 macOS notarization 再次失败，CI 现在会直接失败并阻止发布，需要先修复签名或公证环境后再重新发版

---

**完整变更**: `v1.12.3` -> `v1.13.0`
