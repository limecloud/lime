## Lime v1.20.0

发布日期：`2026-04-26`

### 发布概览

- 本次发布目标 tag 为 `v1.20.0`。
- 本次发布聚焦工作台（Workbench）入口上线、会话管理增强、技能选择器优化、数据库性能提升，以及大量测试覆盖补充。
- 涉及 106+ 文件变更，约 7800 行新增，覆盖 Rust 后端、前端组件、工具函数与测试。

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

### 版本同步

- 应用版本已同步为 `1.20.0`：
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.conf.headless.json`

### 校验状态

- 本会话已实际执行并通过：
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"` — 1089 passed / 0 failed / 0 ignored
  - `cargo clippy --manifest-path "src-tauri/Cargo.toml" --all-targets --all-features`
  - `npm run lint`
- `cargo clippy` 通过，当前存在 2 条预存 warning：
  - `crates/skills/src/lime_llm_provider.rs` 的 `too_many_arguments`
  - `src/services/runtime_evidence_pack_service.rs` 的 `dead_code`

---

**完整变更**: `v1.19.0` -> `v1.20.0`
