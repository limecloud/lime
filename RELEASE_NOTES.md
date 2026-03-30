## Lime v0.99.0

### ✨ 主要更新

- **共享网关控制面继续收口**：移除了遗留 `api-server` / `route` 相关前端页面、命令与后端路由表残面，server 侧进一步收敛到当前主路径，托盘与运行时状态同步逻辑也同步减面
- **Browser Connector / Chrome Relay 主链继续稳定化**：浏览器连接器、扩展安装状态、目录展示、调试面板与设置页联动进一步补齐，Chrome 扩展端清单、弹窗与后台脚本同步更新
- **Agent Chat 与 Service Skill 工作台继续加固**：`AgentChatHomeShell`、`AgentChatWorkspace`、`useWorkspaceSendActions`、`siteCapabilityBinding`、`Browser Assist` 等链路继续收敛，Service Skill 启动、自动匹配、浏览器预检与制品预览主链一致性更高
- **设置与导航表面继续收口**：系统设置分组、渠道配置工作台、外观入口、侧边栏能力分组与创作主题默认显示策略完成新一轮整理，减少未开放或遗留入口的默认暴露
- **工程验证与文档同步**：命令边界、Playwright / GUI smoke、质量工作流与 Chrome 扩展说明同步更新，为 `v0.99.0` 发布提供统一事实源

### ⚠️ 兼容性说明

- 正式发布由 `v0.99.0` tag 触发 `.github/workflows/release.yml`；`RELEASE_NOTES.md` 会直接作为 GitHub Release 正文
- GUI 冒烟依赖本机可启动 headless Tauri、`DevBridge`、默认 workspace 和系统 Chrome；若目标环境缺少对应条件，Browser Runtime / 站点适配器相关能力会降级或无法完成验证
- 本地如果启用了 `.cargo/config.toml` 的 Aster 覆盖，请确认它指向干净的 `v0.23.0` 仓库；GitHub Release runner 不会带本地绝对路径覆盖

### 🔗 依赖同步

- 应用版本已同步提升到 `v0.99.0`，覆盖 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json` 与 `src-tauri/Cargo.lock`
- 当前仓库声明的 `aster-rust` 依赖保持在 `v0.23.0`
- `src-tauri/Cargo.lock` 会随本次 Rust 校验刷新，确保工作区 crate 的版本快照与 `0.99.0` 对齐

### 🧪 测试

- 发布前执行：`cargo fmt --manifest-path src-tauri/Cargo.toml --all`
- 发布前执行：`cargo test --manifest-path src-tauri/Cargo.toml`
- 发布前执行：`cargo clippy --manifest-path src-tauri/Cargo.toml`
- 发布前执行：`npm run lint`
- 发布前执行：`npm run verify:app-version`
- 验证结果：以本次实际执行结果为准；如果当前工作区包含未收口的并行改动，需要在发布前重新确认 Rust / 前端校验与 GUI 冒烟结论

### 📝 文档

- 发布说明已切换到当前这次 `v0.99.0` 正式发布内容，供 GitHub Release 直接读取
- 工程质量、命令边界、Playwright / GUI 冒烟与扩展说明已围绕当前实现持续同步

---

**完整变更**: `v0.98.0` -> `v0.99.0`
