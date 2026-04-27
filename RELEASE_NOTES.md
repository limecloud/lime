## Lime v1.20.0

发布日期：`2026-04-27`

### 发布概览

- 本次发布目标 tag 为 `v1.20.0`。
- 本次发布聚焦工作台（Workbench）入口上线、任务中心切换收口、会话与线程运行时增强、图片工作台状态恢复、技能选择器优化、数据库性能提升，以及大量测试覆盖补充。
- 本轮待递交内容覆盖 Rust 后端、DevBridge、前端 Workspace / Task Center、研究文档、版本锁文件与验证产物清理。

### 重点更新

#### 1. 工作台（Workbench）入口上线

- 侧边栏新增「工作台」导航项，支持通过 `buildClawAgentParams` 进入 Claw Agent 工作台模式 (`sidebarNav.ts`, `AppSidebar.tsx`)
- 新增 `sessionIdentity.ts`，提供辅助 Agent 会话识别能力 (`sessionIdentity.ts`)
- WorkspaceShellScene 支持归档会话打开回调 (`WorkspaceShellScene.tsx`)

#### 2. 新增 Workbench 技能命令

- 新增文件阅读工作台命令：`fileReadWorkbenchCommand` (`fileReadWorkbenchCommand.ts`)
- 新增增长分析工作台命令：`growthWorkbenchCommand` (`growthWorkbenchCommand.ts`)
- 新增 Logo 分解工作台命令：`logoDecompositionWorkbenchCommand` (`logoDecompositionWorkbenchCommand.ts`)
- 新增写作工作台命令：`writingWorkbenchCommand` (`writingWorkbenchCommand.ts`)

#### 3. 会话管理增强

- 会话列表支持归档筛选、工作目录过滤与分页加载 (`session_runtime.rs`, `agent.rs`)
- 新增 `SessionArchiveFilter` 枚举，支持灵活的归档会话查询 (`agent.rs`)
- `AsterAgentWrapper::list_sessions_sync` 支持 `archive_filter`、`workspace_id`、`limit` 参数 (`session_runtime.rs`)
- 侧边栏会话列表实现分页加载与"加载更多"机制 (`AppSidebar.tsx`)
- 会话状态管理支持 `allowDetachedCandidate` 选项，允许恢复已断开的候选会话 (`agentSessionState.ts`)
- 初始会话导航支持去重，防止重复导航 (`useWorkspaceInitialSessionNavigation.ts`)

#### 4. Chat 侧栏归档会话支持

- ChatSidebar 新增 `onOpenArchivedTopic` 回调，支持在 Task Center 打开归档会话 (`ChatSidebar.tsx`)
- `handleOpenTaskItem` 根据 section 类型自动路由到归档或常规会话打开逻辑

#### 5. 技能选择器优化

- 优化输入能力分区逻辑 (`inputCapabilitySections.ts`)
- 改进技能选择绑定配置 (`skillSelectionBindings.ts`)

#### 6. 数据库性能优化

- 新增 `idx_agent_sessions_working_dir_archived_updated_at` 复合索引，优化按工作目录和归档状态查询 (`schema.rs`)
- 新增 `idx_agent_sessions_session_type_updated_at` 索引，优化按会话类型查询 (`schema.rs`)
- Agent 会话仓储支持新的查询参数 (`agent_session_repository.rs`)

#### 7. 测试覆盖大幅补充

- 新增/更新 42 个测试文件，约 3185 行测试代码
- 覆盖工作台命令、会话状态、侧栏导航、技能选择、Workspace 导航等核心模块
- `seededCommandPackage.test.ts` 大幅扩展测试用例

#### 8. 其他改进

- 导航偏好配置更新 (`preferences.ts`)
- 命令清单 schema 同步更新 (`agentRuntimeCommandSchema.json`)
- 会话客户端与类型定义完善 (`sessionClient.ts`, `types.ts`)
- Agent API 测试补充 (`agent.test.ts`)
- `limenext-progress.md` 进度日志同步更新

#### 9. 测试修复

- 修复 `runtime_project_hooks` 中 `persist_session_access_mode` 测试用例，解决测试 DB 与全局 LimeSessionStore DB 不一致导致 `recent_access_mode` 无法正确读取的问题 (`runtime_project_hooks.rs`)
- 测试修复后直接写入 extension_data 和测试消息到测试 DB，确保 `get_runtime_session_detail` 能正常构建 `execution_runtime`
- 修复 `useAgentSession.ts` 在 scoped session 恢复、手动切换 topic、跨工作区恢复失败与 detail mock 污染场景下的 sessionId / topicId 回写问题，避免发送、压缩和 confirmAction 落到空会话
- 修复 `http-client.test.ts` 中预期 reject 被 Vitest 识别为 unhandled rejection 的问题
- 修复 `chrome-relay` 消息自动清除定时器在测试环境 teardown 后仍触发 `window is not defined` 的问题 (`src/components/settings-v2/system/chrome-relay/index.tsx`)
- 修复 `agent-runtime-tool-surface-page-smoke.mjs` 在真实页面刷新后 composer 尚未挂载就写入 prompt 的竞态，GUI smoke 现在会先等待输入框与发送按钮就绪

#### 10. 任务中心与工作区切换收口

- 修复同一 `claw` 页面内从左侧“最近对话 / 归档”切换会话时，旧会话 Tab 被重新回灌到任务中心顶部的问题 (`AgentChatWorkspace.tsx`, `index.test.tsx`)
- 任务中心在路由切换中会先锁定目标会话预览态，避免“只打开一个会话却出现多个任务 Tab”的视觉错觉
- `ChatNavbar`、`TaskCenterTabStrip`、`WorkspaceMainArea`、`WorkspaceStyles` 与 `taskCenterChromeTokens.ts` 继续收口任务中心 chrome、标签栏和工作区视觉状态
- `SplashScreen`、`ProjectSelector`、`SceneAppsPage`、开发者设置页和侧边栏导航补齐对应入口状态与回归断言

#### 11. Harness Engine 与会话运行时

- 会话存储、DAO 与 timeline 查询补齐 thread / turn / item 级状态合并，减少重复 upsert 和过期 pending 状态残留 (`session_store.rs`, `agent.rs`, `agent_timeline.rs`, `agentThreadState.ts`)
- `agent_runtime_submit_turn` / runtime turn 链路继续补充真实 `session/thread/turn` 关联，让 evidence / telemetry / replay / review 能消费同一导出事实源 (`runtime_api.rs`, `runtime_turn.rs`, `dto.rs`)
- `AgentThreadTimelineArtifactCard`、`MessageList`、`useAgentRuntimeSyncEffects`、`useAsterAgentChat` 和相关测试覆盖工具时间线、轻卡与运行时同步回归
- `agentSessionScopedStorage` 增加按工作区 / 会话作用域的 transient 与 persisted 存储封装，避免跨会话状态串扰

#### 12. 图片工作台状态恢复

- 新增 `imageWorkbenchStateCache.ts`，为图片工作台 tail 状态提供同标签页缓存、持久化回退、TTL / stale grace 和 LRU 裁剪
- `useWorkspaceImageTaskPreviewRuntime.ts` 支持只恢复近期活跃的非终态图片任务，避免旧 running / queued 任务长期误回灌
- 图片工作台恢复逻辑支持从消息里的 `imageWorkbenchPreview` 重建状态，并通过 `imageWorkbenchStateCache.test.ts` 与 `useWorkspaceImageTaskPreviewRuntime.test.tsx` 覆盖缓存、过期和消息回放路径

#### 13. DevBridge、模型命令与窗口 chrome

- DevBridge 模型分发补齐 `get_provider_alias_config`、`get_all_models_by_provider`、`get_all_available_models`、`get_default_models_for_provider`，避免浏览器模式初始化模型时继续落入 unknown command (`dispatcher/models.rs`)
- `agent-runtime-tool-surface-page-smoke.mjs` 同步工具面页面冒烟逻辑，覆盖真实页面输入、发送、Harness 打开与 Runtime 能力摘要检查
- 新增 `window_chrome.rs` 并在启动链路应用主窗口 macOS overlay 标题栏兜底，避免 headless/dev 配置绕过主窗口 chrome (`mod.rs`, `runner.rs`, `tauri.conf*.json`)
- `deepseek.json`、命令 manifest 与 runtime schema 同步模型 / 命令边界事实源

#### 14. 文档、研究资料与验证产物治理

- `docs/research/ribbi/` 新增 Ribbi 研究事实源，拆分产品意图、架构图、流程图、命令清单、Agent/tool 编排、Taste/Memory 演进与 Lime 差距分析
- `.gitignore` 调整为允许递交 `docs/research/`，让研究资料成为 versioned artifact
- `docs/aiprompts/overview.md` 更新开发者中心 Harness 开关语义：关闭时仍保留 Harness 入口，但不采集工具库存与额外环境摘要
- `docs/exec-plans/limenext-progress.md` 记录任务中心切换、DevBridge 模型命令补齐、GUI smoke 与定向测试结果
- 根目录旧 Playwright 截图、网络日志和控制台快照已从发布递交面清理，包括 `advanced-settings-open.png`、`current-lime-page.png`、`typed-message.png`、`mimo-openai-doc.png`、`console-current.txt`、`network-3030.txt` 与 `playwright-*` 快照
- 当前工作区仍包含 `network-before.md`、`patch_dark.js`、`patch_flare.js`、`patch_navbar.js` 与 `tmp-e2e-home.png` 这类临时调试辅助产物；如果按“全部递交”处理，这些也纳入本 Release Notes 的待递交范围

### 待递交范围确认

- 版本同步与锁文件：`package.json`、`src-tauri/Cargo.toml` 已确认是 `1.20.0`；本轮待递交包含 `package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json` 的同步更新
- Rust 主链：Agent session store、session/runtime command API、timeline DAO、数据库 schema、DevBridge dispatcher、模型 dispatcher、主窗口 chrome 与 DeepSeek provider 元数据
- 前端主链：Workspace / Task Center / ChatNavbar / EmptyState / MessageList / AgentThreadTimelineArtifactCard / AppSidebar / Splash / ProjectSelector / SceneApps / developer settings
- 会话与运行时状态：`agentSessionScopedStorage`、`agentSessionState`、`agentThreadState`、`useAgentSession`、`useAsterAgentChat`、runtime sync / stream handler / turn event binding
- 图片工作台：`imageWorkbenchStateCache.ts`、`useWorkspaceImageTaskPreviewRuntime.ts` 及对应缓存、过期、消息回放测试
- 命令与契约事实源：`commandManifest.generated.ts`、`agentRuntimeCommandSchema.json`、DevBridge mock / HTTP client 测试与 runtime tool surface 页面 smoke
- 文档与研究资料：`docs/aiprompts/overview.md`、`docs/exec-plans/limenext-progress.md`、`docs/research/ribbi/*`
- 发布产物治理：删除根目录旧 Playwright / 网络 / 控制台临时快照，并显式标记当前仍保留的临时调试辅助文件

### 版本同步

- 应用版本已同步为 `1.20.0`：
  - `package.json`
  - `package-lock.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.conf.headless.json`

### 校验状态

- 本会话已实际执行并通过：
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"` — 1102 passed / 0 failed / 2 ignored
  - `cargo clippy --manifest-path "src-tauri/Cargo.toml" --all-targets --all-features`
  - `npm run verify:app-version`
  - `npm run lint`
  - `npm test`
  - `npm run test:contracts`
  - `node --check "scripts/agent-runtime-tool-surface-page-smoke.mjs"`
  - `npm run smoke:agent-runtime-tool-surface-page`
  - `npm run verify:gui-smoke`
  - `git diff --check`
- 本会话定向补测已通过：
  - `npm test -- "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx"` — 149 tests
  - `npm test -- "src/lib/dev-bridge/http-client.test.ts"` — 11 tests
  - `npm test -- "src/components/settings-v2/system/chrome-relay/index.test.tsx"` — 12 tests
- `cargo test` 通过，当前存在 1 条预存 warning：
  - `write_auxiliary_runtime_projection_fixture` 的 `dead_code`
- `cargo clippy` 通过，当前存在 4 条预存 warning：
  - `crates/services/src/aster_session_store.rs` 的 `manual_repeat_n`
  - `crates/skills/src/lime_llm_provider.rs` 的 `too_many_arguments`
  - `crates/agent/src/session_execution_runtime.rs` 的 `needless_lifetimes`
  - `src/services/runtime_evidence_pack_service.rs` 的 `dead_code`
- GUI 主路径已验证：`DevBridge` 健康检查、默认 workspace 准备态、browser runtime、site adapters、service skill entry、runtime tool surface 与真实页面 Harness summary smoke 均通过

---

**完整变更**: `v1.19.0` -> `v1.20.0`
