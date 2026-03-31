## Lime v1.0.1

### ✨ 主要更新

- **主工作台与 Agent Chat 持续收敛**：Home Shell、Workspace、Decision Panel、Markdown 渲染、Service Skill 入口与 Workbench 交互继续围绕当前主链统一，减少入口分叉与状态散落
- **Artifact Document 与工作区运行时继续加固**：Artifact 文档渲染、校验、输出 schema、操作服务、Canvas / A2UI / Preview / Workflow 链路同步整理，让文档型产物、工作台画布和会话侧的连接更稳定
- **Team / Subagent / MCP 协作链路补强**：Aster Agent 命令运行时、请求元数据、子代理工具、MCP 命令面板与相关测试继续补齐，围绕团队协作和工具编排做进一步收口
- **历史创作分支继续清退**：`content-creator`、`novel`、`poster`、`music` 等旧主题、旧命令、旧资源与相关接口进一步删除或下沉，治理目录、命令文档与路线图同步更新，减少长期并行 surface

### ⚠️ 发布与兼容性说明

- 本次发布 tag 为 `v1.0.1`，应用内版本号保持为 `1.0.1`；`.github/workflows/release.yml` 会按稳定版语义创建 GitHub Release
- Homebrew Tap 更新工作流不会再把本次发布视为 prerelease；Release 发布后会继续走稳定通道同步
- 当前仓库声明的 `aster-rust` 依赖已提升到 `v0.24.0`
- 本地如果启用了 `.cargo/config.toml` 的 Aster 覆盖，请确认它指向干净的 `v0.24.0` 仓库；GitHub Release runner 不会带本地绝对路径覆盖

### 🔗 依赖与版本同步

- 应用版本已同步提升到 `1.0.1`，覆盖 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `src-tauri/Cargo.lock` 会随本次 Rust 校验刷新，确保工作区 crate 的版本快照与 `1.0.1` 对齐
- `aster-core` / `aster-models` 的 git tag 已同步切换到 `v0.24.0`

### 🧪 发布前校验

- `cargo fmt --manifest-path src-tauri/Cargo.toml --all`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml`
- `npm run lint`
- `npm run verify:app-version`
- 当前结果：`npm run verify:app-version` 与 `npm run lint` 已通过；`cargo test` 已通过（`739` 个单测通过，`2` 个集成测试通过，另有 `2` 个真实联网测试保持 `ignored`）；`cargo clippy` 已完成，但仍有若干既有 warning（如 `lime-browser-runtime` 的 `unnecessary_map_or`、`lime-agent` 的 `large_enum_variant` / `too_many_arguments`、主 crate 的未使用常量）

### 📝 文档同步

- 发布说明已切换到当前这次 `v1.0.1` 稳定版发布内容，供 GitHub Release 直接读取
- 命令边界、质量流程、路线图与工作区相关文档会随当前主线收敛继续同步

---

**完整变更**: `v1.0.0-beta` -> `v1.0.1`
