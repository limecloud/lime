## Lime v1.0.0-beta

### ✨ 主要更新

- **首个 1.0 Beta 节点**：这是 Lime 在连续近 100 个迭代版本后的第一个 `1.0 beta` 发布，标志产品主线从 `0.x` 的快速试验期转入以主路径收敛、体验统一和可交付发布为目标的 Beta 阶段
- **创作主题类分支集中清理**：海报工作流、模板、品牌人设、风格库、创作主题孤岛与相关前后端接口继续成片收口，减少并行分支与历史包袱，让工作台能力重新回到当前主链
- **`Claw` 成为 Lime 的主方向**：首页、工作区、Agent Chat、Service Skill、Browser Assist / OpenClaw 相关链路继续统一，`Claw` 被明确收敛为 Lime 的主要入口与默认协作方向
- **导航与设置继续重构**：侧边栏、主导航、设置分组、开发者工具与系统能力入口完成新一轮整理，旧主题/旧分支入口进一步下沉或移除，整体信息架构更聚焦
- **工程与发布边界同步补强**：版本一致性、发布说明、契约文档、Playwright / GUI smoke 与 Release 工作流同步更新，确保 `v1.0.0-beta` 能按 Beta 语义发布而不是误标成正式版

### ⚠️ 兼容性说明

- 本次发布 tag 为 `v1.0.0-beta`，应用内版本号保持为 `1.0.0-beta`；`.github/workflows/release.yml` 会按 prerelease 语义创建 GitHub Release，并直接使用 `RELEASE_NOTES.md` 作为正文
- Homebrew Tap 工作流会跳过 prerelease，避免把这次 Beta 版本误推到稳定通道
- GUI 冒烟依赖本机可启动 headless Tauri、`DevBridge`、默认 workspace 和系统 Chrome；若目标环境缺少对应条件，Browser Runtime / 站点适配器相关能力会降级或无法完成验证
- 本地如果启用了 `.cargo/config.toml` 的 Aster 覆盖，请确认它指向干净的 `v0.23.0` 仓库；GitHub Release runner 不会带本地绝对路径覆盖

### 🔗 依赖同步

- 应用版本已同步提升到 `1.0.0-beta`，覆盖 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json` 与 `src-tauri/Cargo.lock`
- 当前仓库前端锁文件仍以受控的 `pnpm-lock.yaml` 为准；本次发布未引入新的前端依赖升级
- 当前仓库声明的 `aster-rust` 依赖保持在 `v0.23.0`
- `src-tauri/Cargo.lock` 会随本次 Rust 校验刷新，确保工作区 crate 的版本快照与 `1.0.0-beta` 对齐

### 🧪 测试

- 发布前执行：`cargo fmt --manifest-path src-tauri/Cargo.toml --all`
- 发布前执行：`cargo test --manifest-path src-tauri/Cargo.toml`
- 发布前执行：`cargo clippy --manifest-path src-tauri/Cargo.toml`
- 发布前执行：`npm run lint`
- 发布前执行：`npm run verify:app-version`
- 当前结果：`cargo test` 已通过（723 个 Rust 单测通过，2 个集成测试通过，另有 2 个真实联网测试保持忽略），`cargo clippy` 已完成但仍提示少量既有 warning，`npm run lint` 与 `npm run verify:app-version` 已通过

### 📝 文档

- 发布说明已切换到当前这次 `v1.0.0-beta` Beta 发布内容，供 GitHub Release 直接读取
- 工程质量、命令边界、Playwright / GUI 冒烟与扩展说明已围绕当前 Beta 主路径持续同步

---

**完整变更**: `v0.99.0` -> `v1.0.0-beta`
