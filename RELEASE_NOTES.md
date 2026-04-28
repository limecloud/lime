## Lime v1.21.0

发布日期：`2026-04-28`

### 发布概览

- 本次发布目标 tag 为 `v1.21.0`。
- 本次发布聚焦稳定版自动更新与 R2 分发链路、OEM 云端商业闭环、工作台首页与侧栏体验、资源管理器、Provider 模型管理收口、主题外观与设置页更新。
- 本轮待递交内容覆盖 Rust 后端、Tauri update command、DevBridge / mock、发布工作流、前端 Workspace / Settings / Provider Pool / Resource Manager、测试覆盖、版本锁文件与临时产物清理。

### 重点更新

#### 1. 稳定版更新与 R2 发布链路

- `.github/workflows/release.yml` 补齐稳定版 updater 发布门禁，要求签名密钥与更新地址就绪后再生成 updater artifacts。
- 发布流程会规范化 Tauri updater 公钥，并在仅产出 sidecar `.sig` 时由发布脚本生成稳定版 `latest.json`。
- 新增 `scripts/release-updater-manifest.mjs`，聚合各平台 `latest.json`，生成统一 `latest.json`、版本化清单、R2 上传计划与 manifest metadata。
- 新增 `scripts/plan-r2-release-cleanup.mjs`，按稳定版本窗口规划旧 R2 updater 产物清理，避免发布桶无限增长。
- `scripts/release-updater-manifest.test.mjs` 覆盖平台缺失、版本不匹配、同名跨平台 artifact 与旧版本清理保护逻辑。
- `src-tauri/src/commands/update_cmd.rs` 与 `src-tauri/crates/services/src/update_check_service.rs` 切到静态清单检查 + Tauri updater 安装主链，并补齐 semver 比较与缓存兜底。

#### 2. 版本号同步到 v1.21.0

- 应用版本已同步为 `1.21.0`：
  - `package.json`
  - `package-lock.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.conf.headless.json`
- `packages/lime-cli-npm/package.json` 与 `packages/lime-cli-npm/README.md` 已同步到 `1.21.0`，保持 CLI wrapper 与桌面 release 版本一致。
- 浏览器模式默认 mock 的 update current version 已同步为 `1.21.0`。

#### 3. OEM 云端商业闭环

- 新增 `src/lib/oemCloudPaymentReturn.ts`，统一生成、解析、暂存并分发 `lime://payment/return` 支付回跳事件。
- `useDeepLink` 识别支付回跳 deep link，直接分发云端商业刷新事件，不再走旧 `handle_deep_link` 命令分支。
- `useOemCloudAccess` 接入云端激活、支付配置、套餐订单、充值订单、账本、积分余额与访问令牌刷新主链。
- 套餐购买和积分充值 checkout 支持 HTTPS bridge 回跳 URL，支付完成后自动刷新云端权益、积分余额与订单 watcher。
- `docs/exec-plans/oem-cloud-commerce-loop-progress.md` 记录当前阶段、已清退的旧支付配置入口与下一轮真实渠道沙箱验证计划。

#### 4. 工作台首页、侧栏与导航体验

- `AppSidebar` 增加最近对话 / 归档会话架、分页加载、归档切换、外观切换、账户菜单与折叠态细节。
- 新增 `src/components/app-sidebar/AppSidebarConversationShelf.tsx`，把会话架从侧栏主体中拆出，降低侧栏单体复杂度。
- 工作台首页空态升级为“先开始这一轮 / 继续这轮 / 直接开工”入口，强化任务起手、推荐模板与继续上下文。
- Workspace / Task Center / ChatNavbar / Inputbar / EmptyState / Team Workspace 等主路径继续收口视觉状态、运行时状态与回归断言。
- `src/lib/windowControls.ts`、窗口 chrome 与主窗口启动链路继续补齐 macOS / headless 场景下的窗口控制一致性。

#### 5. 资源管理器

- 新增 `src/features/resource-manager/`，提供资源管理器页面、侧栏、工具栏、预览面板、Inspector、搜索与导航意图。
- 支持图片、文本、Markdown、PDF、Office、音视频、数据文件、压缩包与系统委托类型的分层预览渲染。
- 支持资源下载、复制、系统打开、Finder 揭示、聊天位置与项目资源上下文回跳。
- 补齐 `ResourceManagerPage`、资源预览搜索、会话状态和导航意图测试。

#### 6. Provider Pool 与设置页收口

- Provider 模型管理改为“启用的模型”左侧列表 + 添加模型面板，删除旧 API Key 列表 / Provider 表单 / 模型列表拆分组件。
- 新增 `ModelProviderList`、`ModelAddPanel`、`providerConfigUtils` 与连接测试类型，统一 Provider 配置工具函数与 UI 入口。
- 设置页 Provider、About、Developer、Experimental、Appearance、Channels 与 Automation 页面继续收口布局、状态展示和回归断言。
- Prompt Cache 与 Anthropic-compatible 能力口径更新，避免把显式 `cache_control` 能力误显示为自动缓存。

#### 7. App Update 前端与 mock

- `src/lib/api/appUpdate.ts` 扩展 release notes URL / pubDate / 错误信息字段。
- `src/lib/tauri-mock/core.ts` 补齐 `check_update`、`check_for_updates` 与下载无更新态 mock，浏览器模式不再落入 unknown command。
- About 设置页更新检查、下载失败、诊断错误和版本展示补齐测试覆盖。

#### 8. 文档、治理与临时产物

- `README.md` 更新产品定位文案：从“本地优先的 AI API Proxy 桌面应用”收敛为 AI Agent 创作工作台。
- `src/lib/governance/legacySurfaceCatalog.json` 与测试补充新的 legacy surface 口径。
- 删除根目录临时调试产物：`monitor.sh`、`network-before.md`、`post-hmr-state.png`、`tmp-e2e-home.png`、`knip.governance.json`。
- 新增 `theme-scope-messages-ocean.png` 作为本轮主题视觉验证产物。

### 待递交范围确认

- 版本与发布：版本文件、lockfile、CLI wrapper、release workflow、R2 updater manifest / cleanup 脚本与测试。
- Rust 主链：update command、update service、window chrome、runner/app 模块、DevBridge dispatcher、tray 事件与菜单处理。
- 前端主链：AppSidebar、Workspace、Task Center、EmptyState、Inputbar、Team Workspace、Settings、Provider Pool、Resource Manager、MCP、Memory、SceneApps、Resources。
- 商业闭环：OEM cloud control plane API、支付回跳 deep link、权益 / 积分 / 账本刷新、订单 watcher 与执行计划文档。
- 验证与治理：新增/更新测试、legacy catalog、release updater contract、删除临时调试文件与旧 Provider Pool 组件。

### 校验状态

- 已通过：
  - `npm run verify:app-version`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"` — 1112 passed / 0 failed / 2 ignored
  - `cargo clippy --manifest-path "src-tauri/Cargo.toml" --all-targets --all-features`
  - `npm run lint`
  - `npm test` — 44 个 Vitest smart 批次通过
  - `npm run test:contracts`
  - `npm run smoke:agent-runtime-tool-surface`
  - `npm run smoke:agent-runtime-tool-surface-page`
  - `git diff --check`
- `cargo test` 通过，当前存在 1 条预存 warning：
  - `write_auxiliary_runtime_projection_fixture` 的 `dead_code`
- `cargo clippy` 通过，当前存在 4 条预存 warning：
  - `crates/services/src/aster_session_store.rs` 的 `manual_repeat_n`
  - `crates/skills/src/lime_llm_provider.rs` 的 `too_many_arguments`
  - `crates/agent/src/session_execution_runtime.rs` 的 `needless_lifetimes`
  - `src/services/runtime_evidence_pack_service.rs` 的 `dead_code`
- GUI 主路径补充复测已通过：`smoke:agent-runtime-tool-surface` 与 `smoke:agent-runtime-tool-surface-page` 均确认 Harness 入口在执行态可见，修复此前等待 Harness 按钮超时的问题。

---

**完整变更**: `v1.20.0` -> `v1.21.0`
