## Lime v1.19.0

发布日期：`2026-04-25`

### 发布概览

- 本次发布目标 tag 为 `v1.19.0`。
- 本说明按当前待递交工作树重新整理，覆盖这次准备一起递交的版本同步、Agent runtime/current surface、聊天工作台布局、Task Center、SceneApp、Memory、automation、bridge、roadmap 文档与现场材料，不再沿用旧版“只写版本号”的简化摘要。
- 本次发布额外吸纳了近期关于人物切换、最新对话容器高度、导航层级精简与工作台展示密度的一组 UI 收口，确保 `v1.19.0` 对外指向的是当前完整提交状态。

### 递交范围

- 已跟踪改动主要覆盖：`src/` 工作台与业务页面、`src-tauri/` runtime 与命令面、`docs/` 路线图与执行文档，以及根目录版本/打包文件。
- 未跟踪新增项主要包含：
  - 工作台布局与任务中心相关新文件：`TaskCenterTabStrip`、`chatLayoutVisibility`、`taskCenterTabs`、`chatSurfaceProps.test.ts`
  - Rust 侧新增服务实现：`src-tauri/src/services/runtime_auxiliary_projection_service.rs`
  - 一组 Playwright/截图/控制台现场材料，用于保留这批 GUI 调整与回归排查证据
- 本次 release note 继续以“整批递交”视角书写，默认当前工作树中的这些版本、代码、文档和现场材料都属于本轮提交范围。

### 重点更新

#### 0. 发布同步与提交口径收口

- 根目录应用版本、Tauri 配置、CLI wrapper、Cargo 版本与 release note 统一提升到 `1.19.0`，避免发布 tag、桌面端版本、npm wrapper 和分发说明继续错位。
- 本说明继续按“当前完整工作树一起递交”的口径整理，明确这次不是单点补版本，而是把当前待提交的 runtime、前端、文档和证据材料统一归档到同一个发布切片。
- 校验章节会同步记录这次实际跑过的 `verify:app-version`、Rust 校验和前端 lint，方便后续直接作为发布前检查清单引用。

#### 1. Agent runtime、任务层与模型层继续 current 化

- `src-tauri/crates/agent/`、`src-tauri/src/commands/aster_agent_cmd/`、`src-tauri/src/services/` 与 `src/lib/api/agentRuntime/` 继续围绕 session runtime、tool policy、handoff/evidence/replay/review 以及请求模型解析收敛 current surface。
- `src-tauri/crates/core/` 与 `src-tauri/crates/services/` 继续补齐 agent session 数据层、schema、模型注册和 provider 归一化，减少运行时事实源分叉。
- `docs/roadmap/task/`、`docs/exec-plans/limenext-progress.md` 与相关 acceptance/runtime-integration 文档同步更新，把任务层、模型层和交付验收条件继续沉淀为可追踪路线图。

#### 2. 工作台、导航层级与布局展示继续整理

- `src/components/agent/chat/components/`、`workspace/`、`hooks/` 与 `utils/` 大范围调整聊天工作台、导航栏、侧栏、对话区和画布区的布局关系，重点围绕一级导航收敛、人物切换稳定性、最新对话容器高度和页面可视区域利用率继续修正。
- 新增 `TaskCenterTabStrip`、`chatLayoutVisibility`、`taskCenterTabs` 等文件，把任务中心与聊天主视图的布局控制收成更清晰的 current 结构，减少 UI 逻辑散落在多个组件里。
- `MessageList`、`ChatSidebar`、`ChatNavbar`、`WorkspaceConversationScene`、`WorkspaceMainArea`、`WorkspaceShellScene` 及其测试一并更新，确保工作台密度调整不会把最新对话区域挤空、重载或遮挡。

#### 3. SceneApp、Memory、Resources 与设置页继续并行收口

- `src/components/sceneapps/`、`src/components/memory/`、`src/components/resources/`、`src/components/skills/`、`src/components/settings-v2/` 继续同步调整页面结构、结果展示和 follow-up 入口，让工作台新布局和周边页面表达保持一致。
- `useSceneAppsPageRuntime.ts`、`sceneAppExecutionFollowupDestinations.ts`、`SceneAppExecutionSummaryCard.tsx` 与相关测试持续补齐 SceneApp 结果去向、复盘和后续动作表达。
- `MemoryPage.tsx`、`ResourcesPage.tsx`、`AutomationHealthPanel.tsx`、`AutomationJob*`、`ChannelsDebugWorkbench.tsx` 等页面也同步纳入这轮整理，避免只有聊天主路径更新、外围页面仍停留在旧密度和旧结构。

#### 4. Bridge、API、mock 与前端事实源同步补齐

- `src/lib/dev-bridge/`、`src/lib/api/`、`src/lib/governance/`、`src/lib/tauri-mock/` 与 `src-tauri/src/dev_bridge/dispatcher/agent_sessions.rs` 等文件继续同步命令契约、前端客户端、mock 与治理目录册，减少 runtime surface 在桌面端和浏览器 fallback 之间继续漂移。
- `src/lib/navigation/sidebarNav.ts`、`src/components/AppSidebar.tsx`、`src/RootRouter.tsx` 等导航事实源同步更新，配合这轮“只保留一级导航”的整理口径。
- `src/hooks/useConfiguredProviders.ts`、`src/lib/serviceModels.ts`、`src/components/provider-pool/api-key/ProviderConfigForm.tsx` 及测试也随之刷新，保证 provider/model 配置与工作台入口描述保持一致。

#### 5. 文档、测试与现场材料继续跟上

- 相关 `*.test.tsx` / `*.test.ts` 随工作台、导航、runtime、provider、SceneApp、settings 调整一并更新，保证这批用户可见改动有稳定回归。
- `docs/roadmap/task/acceptance.md`、`runtime-integration.md` 与 `docs/exec-plans/limenext-progress.md` 继续同步当前主线进度和验收口径。
- 截图、快照、console/network 导出等现场材料保留在工作树中，作为这批 GUI 调整和问题复盘的直接证据。

### 版本同步

- 应用版本事实源已同步为 `1.19.0`：
  - `package.json`
  - `package-lock.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.conf.headless.json`
- 发布与分发相关版本串已同步为 `1.19.0`：
  - `packages/lime-cli-npm/package.json`
  - `packages/lime-cli-npm/README.md`
  - `src-tauri/Cargo.lock`
  - `src-tauri/crates/aster-rust/Cargo.lock`
  - `src-tauri/crates/aster-rust/crates/aster/tests/mcp_replays/cargorun--quiet-paster-server--binasterd--mcpdeveloper`

### 校验状态

- 本会话已实际执行并通过：
  - `npm run verify:app-version`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"`
  - `cargo clippy --manifest-path "src-tauri/Cargo.toml" --all-targets --all-features`
  - `npm run lint`
- `cargo test` 实际结果为 `1087 passed / 0 failed / 2 ignored`；ignored 用例是显式依赖真实联网环境的 `real_web_search_*`。
- `cargo clippy` 通过，但当前工作树仍存在 3 条 warning：
  - `crates/skills/src/lime_llm_provider.rs` 的 `too_many_arguments`
  - `crates/agent/src/session_execution_runtime.rs` 的 `needless_lifetimes`
  - `src/services/runtime_evidence_pack_service.rs` 的 `dead_code`


---

**完整变更**: `v1.18.0` -> `v1.19.0`
