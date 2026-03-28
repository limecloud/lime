## Lime v0.97.0

### ✨ 主要更新

- **Chrome Relay / Browser Connector 进入 current 主线**：新增浏览器连接器命令与后端服务，设置页补齐 Chrome Relay 安装、连接状态和目录展示，扩展弹窗与清单同步更新
- **Agent Chat 工作台与时间线继续收口**：`ArtifactWorkbenchShell`、`AgentThreadTimeline`、`CanvasWorkbenchLayout`、`MessageList` 等核心区域完成进一步瘦身，移除了旧的 `ProjectSelector`、`TaskFiles`、`TimelineInlineItem` 等遗留表面
- **A2UI 与工作台运行时稳定性修复**：修正 legacy 问卷场景下 `useWorkspaceA2UIRuntime` 的自循环更新，补齐 Action Request/A2UI 预览和画布布局回归，减少自动引导与写文件链路的测试噪音
- **测试执行与发布流程显著稳定化**：Vitest 默认切到智能分批 + 单 fork 模式，收敛 mock/info 日志风暴；macOS release workflow 现在会在构建前显式探测 Tauri CLI native binding，缺失时自动清理 `node_modules` 并重装，规避 `@tauri-apps/cli-darwin-*` 丢失导致的发布失败
- **命令边界与文档同步更新**：浏览器连接器命令、GUI smoke 路径与质量流程文档已与当前实现保持一致，避免前端调用、Rust 注册、mock 与文档再度漂移

### ⚠️ 兼容性说明

- 本次仍然使用同一个版本号 `v0.97.0`，但 release/tag 会重指向 `main` 上的最新提交，用于覆盖之前的同版发布
- 正式发布仍由 `v*` tag 触发 `.github/workflows/release.yml`；`RELEASE_NOTES.md` 会直接作为 GitHub Release 正文
- GUI 冒烟依赖本机可启动 headless Tauri、`DevBridge`、默认 workspace 和系统 Chrome；目标环境如果缺少对应条件，Browser Runtime/站点适配器相关能力会被降级
- 本地如果启用了 `.cargo/config.toml` 的 Aster 覆盖，请确认它指向干净的 `v0.22.0` 仓库；GitHub Release runner 不会带本地绝对路径覆盖

### 🔗 依赖同步

- 应用版本已同步提升到 `v0.97.0`，覆盖 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json` 与 `src-tauri/Cargo.lock`
- 当前仓库声明的 `aster-rust` 依赖仍为 `v0.22.0`；本地覆盖仓库已核对为干净 `v0.22.0` 状态
- `src-tauri/Cargo.lock` 已随本次 Rust 校验刷新，确保工作区 crate 的版本快照与 `0.97.0` 对齐

### 🧪 测试

- 发布前执行：`cargo fmt --manifest-path src-tauri/Cargo.toml`
- 发布前执行：`cargo test --manifest-path src-tauri/Cargo.toml`
- 发布前执行：`cargo clippy --manifest-path src-tauri/Cargo.toml`
- 发布前执行：`npm run lint`
- 发布前执行：`npm run typecheck`
- 发布前执行：`npm test`
- 发布前执行：`npm run test:contracts`
- 发布前执行：`npm run verify:app-version`
- 发布前执行：`npm run verify:gui-smoke`
- 验证结果：上述命令已在当前工作区全部通过，`verify:gui-smoke` 已验证 `DevBridge`、默认 workspace、Browser Runtime 与 site adapter catalog 主路径
- 备注：`cargo clippy` 当前通过，但仍保留 3 条既有 warning，未在本次同版发布中额外扩范围消除

### 📝 文档

- 发布说明已切换到当前这次 `v0.97.0` 同版重发内容，供 GitHub Release 直接读取
- 工程质量、命令边界与 Playwright / GUI 冒烟文档已同步更新到最新实现

---

**完整变更**: `v0.97.0` 同版重发，对齐 `main` 最新提交
