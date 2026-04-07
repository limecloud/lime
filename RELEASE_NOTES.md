## Lime v1.5.0

### ✨ 主要更新

- **创建型工作台技能继续扩容**：在现有 `analysis / summary / translation / pdf_read / report_generate / research / site_search / image / cover / video / broadcast / url_parse / typesetting` 主链基础上，新增并收口 `form_generate`、`presentation_generate`、`webpage_generate`；前后端围绕 `*_skill_launch`、tool runtime、artifact 输出、任务预览和权限边界继续统一到当前 harness 主路径
- **Agent 聊天工作台进一步收口到当前主链**：`AgentChatWorkspace`、`MessageList`、`EmptyState`、`Inputbar`、`CharacterMention`、`WorkspaceConversationScene`、`useWorkspaceSendActions`、`useAsterAgentChat`、`serviceSkillSceneLaunch` 等界面与运行时继续围绕通用工作台和服务技能入口收拢；消息预览、任务时间线、视频工作台、Token 使用展示与 slash / mention 入口同步增强
- **站点适配器与浏览器运行时增强**：bundled site adapter 目录新增 `x/article-export`，站点能力选择、现有浏览器会话复用、保存到当前内容/项目、导入外部 YAML 适配器、server-synced catalog 回落策略与推荐链路进一步完善；扩展侧同步新增 site adapter runner 生成入口
- **运行时状态与协议事实源继续收敛**：Agent session store、turn input envelope、tool io offload、runtime turn metadata、team / subagent 偏好、site capability、chat history、service skill catalog、artifact protocol 与 DevBridge HTTP client 一批边界继续补齐 current 语义和回归测试
- **文档与治理目录同步更新**：`docs/aiprompts/command-runtime.md`、`commands.md`、`playwright-e2e.md`、`quality-workflow.md` 等工程文档已围绕当前服务技能、site adapter、GUI smoke 与运行时事实源刷新；默认技能目录同步纳入 `form / presentation / webpage / x article export` 相关说明

### ⚠️ 发布与兼容性说明

- 本次发布 tag 为 `v1.5.0`，应用内版本号保持为 `1.5.0`
- `@limecloud/lime-cli@1.5.0` 要求 `Node >= 18`，支持 `darwin / linux / win32` 与 `x64 / arm64`
- 当前 Agent GUI 主路径继续以 `GeneralWorkbench*` 与服务技能启动边界为准；旧表面不应再作为 current surface 扩展
- 当前默认技能目录已覆盖 `analysis`、`broadcast_generate`、`form_generate`、`image_generate`、`modal_resource_search`、`pdf_read`、`presentation_generate`、`report_generate`、`research`、`site_search`、`summary`、`translation`、`typesetting`、`url_parse`、`video_generate`、`webpage_generate`
- `aster-rust` 依赖已固定到远程 tag `v0.27.1`；本地 `.cargo/config.toml` patch override 仍仅用于开发联调，不属于发布事实源

### 🔗 依赖与版本同步

- 应用版本已同步提升到 `1.5.0`，覆盖 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`
- `packages/lime-cli-npm/package.json` 与 README 发布示例已同步更新到 `1.5.0`
- `src-tauri/Cargo.lock` 已刷新：工作区内部 crate 版本快照已对齐到 `1.5.0`，`aster-core` / `aster-models` 已对齐到 `0.27.1`

### 🧪 发布前校验

- `npm run verify:app-version`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all`
- `CARGO_TARGET_DIR=src-tauri/target/codex-v1_5_0 cargo test --manifest-path src-tauri/Cargo.toml`
- `CARGO_TARGET_DIR=src-tauri/target/codex-v1_5_0 cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- `npm run lint`
- `npm run test:contracts`
- `CARGO_TARGET_DIR=src-tauri/target/codex-v1_5_0 npm run verify:gui-smoke`
- 当前结果：
  - `npm run verify:app-version`：通过
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --all`：通过
  - `cargo test --manifest-path src-tauri/Cargo.toml`：通过，`852` 个单测全部通过，2 个真实联网 smoke 用例按预期忽略
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：通过
  - `npm run lint`：通过
  - `npm run test:contracts`：通过
  - `npm run verify:gui-smoke`：通过
  - 说明：首次复用现有 headless 环境时，`browser-runtime` smoke 出现一次 CDP 标签页读取瞬时失败；单独重跑 `smoke:browser-runtime` 后通过，随后整条 `verify:gui-smoke` 复跑通过，未见持续性故障

### 📝 文档同步

- 发布说明已切换到当前这次 `v1.5.0` 稳定版发布内容，可直接作为 GitHub Release note 使用
- 默认技能目录、site adapter catalog 与运行时事实源文档已同步到当前实现
- 服务技能主链、站点能力主链、GUI smoke 与契约边界文档均已围绕当前实现刷新

---

**完整变更**: `v1.4.0` -> `v1.5.0`
