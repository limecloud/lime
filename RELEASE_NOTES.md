## Lime v1.3.0

### ✨ 主要更新

- **命令运行时继续收口到 Agent 主链**：`@封面`、`@视频`、`@转写`、`@链接解析` 统一保留原始用户消息进入 Agent turn，通过 `cover_skill_launch`、`video_skill_launch`、`transcription_skill_launch`、`url_parse_skill_launch` metadata 驱动首刀 `Skill(...)`，CLI / task file / viewer 的状态语义保持一致，避免前端预翻命令或伪造“已完成”结果
- **创作工作台与首页入口重做**：Agent 空态、推荐入口与工作区启动边界继续收口，新增统一 `workspaceEntry` 启动层、独立 `VideoPage` 与 `ImageTaskViewer`，图片任务支持围绕真实任务结果继续 `@修图` / `@重绘`，旧 `Claw Home`、旧首页 prompt composer、旧图片画布壳与一批 Inputbar compat 表面继续退出
- **内容主稿技能标准化**：默认社媒主稿能力统一收口到 `content_post_with_cover`，输出目录固定为 `content-posts/`，运行时会补齐主稿、封面元数据和 publish-pack artifact 事件；旧 `social_post_with_cover` 命名与历史引用继续清退
- **设置中心与治理目录继续瘦身**：设置首页升级为总览入口，渠道能力收口到 `ChannelsDebugWorkbench` / 独立 IM 配置页，旧 `settings-v2` 里的 channels wrapper、proxy 页、chat-appearance 页、通用 header 等兼容入口转入 dead-candidate；命令运行时规则正式沉淀到 `docs/aiprompts/command-runtime.md`
- **版本与发布面同步**：Lime 应用与 `@limecloud/lime-cli` 升级到 `1.3.0`，Rust workspace crate 版本快照、Tauri 配置与 CLI README 示例同步收口

### ⚠️ 发布与兼容性说明

- 本次发布 tag 为 `v1.3.0`，应用内版本号保持为 `1.3.0`
- `@limecloud/lime-cli@1.3.0` 要求 `Node >= 18`，支持 `darwin / linux / win32` 与 `x64 / arm64`
- 当前内置输入命令主链包含 `@配图`、`@封面`、`@修图`、`@重绘`、`@视频`、`@转写`、`@链接解析`
- `content_post_with_cover` 是当前内容主稿 + 封面一体化技能真相；旧 `social_post_with_cover` 不再作为 current surface 继续扩展
- 旧 Claw 首页壳、旧图片工作台壳、旧设置兼容页和一批 Inputbar compat 组件已继续退出 current 主路径，后续交互与回归请以新的工作台入口和治理目录册为准

### 🔗 依赖与版本同步

- 应用版本已同步提升到 `1.3.0`，覆盖 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `packages/lime-cli-npm/package.json` 与 README 发布示例已同步更新到 `1.3.0`
- `src-tauri/Cargo.lock` 已刷新，工作区内部 crate 版本快照已对齐到 `1.3.0`
- 命令运行时文档已新增 `docs/aiprompts/command-runtime.md`，并同步更新命令边界、质量工作流和 Playwright 续测文档

### 🧪 发布前校验

- `npm run verify:app-version`
- `npm run test:contracts`
- `npm run verify:gui-smoke`
- `npm run lint`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- 当前结果：
  - `npm run verify:app-version`：通过
  - 其余发布前校验：本轮尚未执行，正式发版前需要补齐

### 📝 文档同步

- 发布说明已切换到当前这次 `v1.3.0` 稳定版发布内容，供 GitHub Release 直接读取
- 命令运行时、命令边界、工程质量与 GUI 续测文档已围绕当前主链更新
- 内容主稿技能、工作台任务协议与治理目录册的命名事实源已与当前实现对齐

---

**完整变更**: `v1.2.0` -> `v1.3.0`
