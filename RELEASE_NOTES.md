## Lime v1.23.0

发布日期：`2026-04-29`

### 发布概览

- 本次发布目标 tag 为 `v1.23.0`。
- 本次发布聚焦稳定版 GitHub Release / R2 分发链路收口、lime-cli 独立产物发布、Provider / Credential 旧路径清退、云端用户中心商业边界收口，以及 Agent 会话恢复与模型选择体验稳定性。
- 本轮待递交内容覆盖 Rust 后端、Tauri 配置、发布工作流、release asset 脚本、Provider / Model / Credential 治理、前端 Workspace / Settings / Provider API Key 主路径、测试覆盖、版本锁文件与执行计划文档。

### 重点更新

#### 1. 版本号同步到 v1.23.0

- 应用版本已同步为 `1.23.0`：
  - `package.json`
  - `package-lock.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.conf.headless.json`
- `packages/lime-cli-npm/package.json` 与 `packages/lime-cli-npm/README.md` 已同步到 `1.23.0`，保持 CLI wrapper 与桌面 release 版本一致。
- 浏览器模式默认 mock 的 update current version 已同步为 `1.23.0`。
- GitHub release asset staging 测试中的当前发布样例已同步到 `v1.23.0`。

#### 2. 稳定版发布与 R2 分发链路

- `.github/workflows/release.yml` 将桌面应用构建、GitHub Release 资产发布、R2 updater 发布和 lime-cli 资产发布拆成更清晰的阶段。
- 新增 `scripts/prepare-github-release-assets.mjs`，在上传 GitHub Release 前统一整理资产名，避免 macOS `Lime.app.tar.gz` / `.sig` 同名跨架构冲突。
- GitHub Release 上传改为使用 `release-github-assets` 暂存目录，并在资产上传后显式发布 release、标记 latest。
- R2 updater 发布改为独立 job，从 GitHub Release 或 `RELEASE_NOTES.md` 准备 updater release notes，再生成稳定版 manifest。
- Cloudflare R2 上传 / 列表 / 删除命令补齐 `--remote`，并在 wrangler 不支持 `r2 object list` 时跳过旧版本清理而不是阻塞发布。
- lime-cli release binary 与 npm wrapper 资产改为独立矩阵 job 发布，保留 macOS / Windows / Linux CLI 产物，不再耦合桌面安装包矩阵。

#### 3. Provider / Credential 旧路径清退

- 清退旧 Provider Pool 页面、凭证卡片、Credential 表单、OAuth / Kiro / Antigravity / Claude OAuth / usage 等旧命令与服务路径。
- Rust 后端删除旧 credential crate、provider pool DAO / service、Kiro credential handler、旧 provider converter / translator / fingerprint 模型等 dead surface。
- 前端保留当前 API Key Provider 设置主路径，并继续收口模型启用、模型能力、Prompt Cache 与 companion provider 概览口径。
- `agentCommandCatalog`、`legacySurfaceCatalog`、DevBridge mock 与相关测试同步更新，避免已删除命令继续作为 current surface 出现。
- 模型资源索引删除旧 Antigravity / Kiro / Codex alias/provider 静态入口，减少 provider 真相源分叉。

#### 4. Agent 会话恢复与工作台稳定性

- 会话切换 / 恢复详情默认按 `historyLimit: 40` 拉取近期历史，完整历史加载仍通过显式 `historyLimit: 0` 入口完成。
- `useAsterAgentChat` 回归断言已同步新的 session detail 拉取参数，覆盖 stop refresh、timeline cache hydrate、workspace guard 与 stale 快照刷新路径。
- 工作台消息流、模型选择、Provider selector、Team Workspace、artifact / saved content 展示继续保持与 runtime execution metadata 对齐。
- `ModelSelector`、`useConfiguredProviders`、`useProviderModels`、Prompt Cache 支持判断与 companion provider overview 补齐回归覆盖。

#### 5. 云端用户中心与商业边界

- 新增 `docs/exec-plans/cloud-commerce-user-center-boundary.md`，明确套餐购买、支付、账单、用量明细统一收敛到 `limecore` 用户中心网页。
- Lime 客户端云端服务设置面继续收口为会话状态、当前套餐、积分余额、待支付提醒与用户中心跳转入口。
- 客户端移除直接创建套餐 / 充值订单的旧处理面，避免本地商业工作台与用户中心形成双轨。
- `useOemCloudAccess` 与 OEM cloud / LimeHub provider 同步测试继续覆盖登录态、权益摘要、API Key 与回跳刷新路径。

#### 6. 文档、治理与回归

- `docs/aiprompts/` 下 Provider、Credential Pool、Services、Hooks、Components、Overview 等导航文档同步当前 provider / credential / model registry 事实源。
- `docs/content/03.providers/1.overview.md` 与 `src/components/api-key-provider/README.md` 更新当前 Provider 配置入口说明。
- `scripts/release-updater-manifest.test.mjs` 增加 GitHub release asset staging 覆盖，保护 macOS 同名 updater bundle 重命名逻辑。
- `src-tauri/proptest-regressions/` 已纳入本轮待递交范围，保留 property test 回归种子。

### 待递交范围确认

- 版本与发布：版本文件、lockfile、Tauri 配置、CLI wrapper、release workflow、GitHub release asset staging 脚本与测试。
- Rust 主链：Provider / Credential / Server / Services / Agent / DevBridge / model registry / router / websocket 相关 current surface 收口。
- 前端主链：Agent Chat Workspace、MessageList、ModelSelector、Settings Provider、API Key Provider、Provider hooks、mock 与治理目录册。
- 商业边界：云端用户中心执行计划、OEM cloud access / LimeHub provider sync、设置页云端服务入口。
- 验证与治理：新增/更新测试、legacy catalog、release updater contract、删除旧 Provider Pool / credential / Kiro / Antigravity 等 dead surface。

### 校验状态

- 已通过：
  - `npm run verify:app-version`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `cargo test --manifest-path "src-tauri/Cargo.toml" --target-dir "src-tauri/target/codex-release-v123"` — 1085 passed / 0 failed / 2 ignored
  - `cargo clippy --manifest-path "src-tauri/Cargo.toml" --target-dir "src-tauri/target/codex-release-v123" --all-targets --all-features`
  - `npm run lint`
  - `npm test` — 43 个 Vitest smart 批次通过
  - `npm run test:contracts`
  - `git diff --check`
- `cargo clippy` 通过，当前存在 5 条预存 warning：
  - `crates/services/src/aster_session_store.rs` 的 `manual_repeat_n`
  - `crates/skills/src/lime_llm_provider.rs` 的 2 处 `too_many_arguments`
  - `crates/agent/src/request_tool_policy.rs` 的 `too_many_arguments`
  - `crates/agent/src/session_execution_runtime.rs` 的 `needless_lifetimes`
- GUI 主路径未额外执行 `npm run verify:gui-smoke`；本轮发布收口以版本、发布链路、Provider / Credential 治理和前端 / Rust 回归为主要风险覆盖。

---

**完整变更**: `v1.22.0` -> `v1.23.0`
