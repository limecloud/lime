## Lime v1.12.2

### 主要更新

- 扩展 SceneApp 上下文主链：新增持久化 context store、context compiler 与启动时的 overlay 合并能力
- 补齐 SceneApp 详情页、运行详情页、评分卡和产品层类型，让上下文与治理信息在桌面端可见
- 同步补齐 SceneApp API、Tauri mock、回归测试，并修复 `clawWorkspaceProviderSelection` 的 provider 回退断言

### 版本与发布同步

- 应用版本入口已对齐到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- CLI npm wrapper 版本与 README 发布示例已同步到 `1.12.2`
- 本次发布目标 tag 为 `v1.12.2`

### 计划执行校验

- `npm run verify:app-version`
- GitHub Actions `CI` / `Quality` / `Deploy Docs to Pages` 已基于 `b98578c7` 通过

### 发布说明

- 这是一次承接 `sceneapp context surfaces` 主线能力的补丁版本，目标是把 SceneApp 的上下文、运行态和治理信息完整带入正式发版
- macOS notarization 仍依赖 Apple Developer 协议状态；若团队协议未补齐，Release 工作流仍会在 notarization 阶段阻断

---

**完整变更**: `v1.12.1` -> `v1.12.2`
