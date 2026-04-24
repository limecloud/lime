## Lime v1.18.0

发布日期：`2026-04-24`

### 发布概览

- 本次发布目标 tag 为 `v1.18.0`。
- 本说明按当前待递交工作树重新整理，覆盖这次准备一起递交的版本同步、Rust/runtime、前端工作台、SceneApp、Memory、automation、bridge、roadmap 文档与 Playwright 复盘材料，不再沿用旧版“只写版本号”的简化摘要。
- 本次重新发布还补充纳入了聊天空态、技能入口、图片预览容错，以及 macOS release workflow 诊断文案修正，确保 `v1.18.0` 对外指向的是当前完整提交状态。

### 递交范围

- 已跟踪改动主要分布在：`src/` `94` 个文件、`src-tauri/` `42` 个文件、`docs/` `6` 个文件，以及根目录/版本与打包文件。
- 未跟踪新增项共 `27` 个，包含：
  - `docs/roadmap/task/` 任务层/模型层/经济调度路线图整套专题文档
  - `18` 份 Playwright 现场记录与 `playwright-network-after-image.json` 抓包结果
  - `src-tauri/src/dev_bridge/dispatcher/files.rs`
  - `src/components/agent/chat/hooks/agentSilentTurnRecovery.{ts,test.ts}`
  - `src/components/agent/chat/utils/saveSceneAppExecutionAsInspiration.{ts,test.ts}`
  - `src/components/agent/chat/utils/sceneAppExecutionInspirationDraft.{ts,test.ts}`
  - `src/components/memory/MemoryCuratedTaskSuggestionPanel.tsx`
- 本次 release note 以“整批递交”视角书写，默认上述内容均属于本轮提交范围。

### 重点更新

#### 0. 补充收口：发布前端构建阻断与 release 诊断信息校正

- `src/components/agent/chat/components/{EmptyState,ImageTaskViewer}.tsx`、`src/components/agent/chat/skill-selection/{CharacterMentionPanel,inputCapabilitySections}.ts` 与配套测试继续收口聊天空态、技能入口和图片预览体验。
- `src/components/provider-pool/api-key/ProviderModelList.tsx` 修正 provider 模型来源判断的类型收窄问题，避免 release 构建因前端 TypeScript 报错提前中断。
- `ImageTaskViewer.tsx` 为补图预览和弹窗预览统一补齐 `RenderableTaskImage` 的 fallback 渲染，避免新 props 约束下的构建失败。
- `.github/workflows/release.yml` 将原先误导性的 “macOS notarization failed twice” 兜底报错改成“release build failed before notarized artifact became available”，方便后续直接定位真实前序构建错误，而不是被公证文案误导。

#### 1. Agent runtime、任务层与模型层主线继续 current 化

- `src-tauri/crates/agent/src/session_execution_runtime.rs`、`protocol.rs`、`provider_safety.rs`、`credential_bridge.rs`，以及 `src-tauri/src/commands/aster_agent_cmd/{request_model_resolution,runtime_turn,dto,subagent_runtime}.rs` 继续扩展 runtime 路由、任务画像、provider 安全边界、会话上下文与事件投影。
- `src-tauri/crates/aster-rust/crates/aster/src/{agents/agent.rs,skills/tool.rs}` 与 `src-tauri/src/agent/{aster_agent.rs,mod.rs}` 同步收敛 current runtime surface，减少 compat 语义继续回流。
- 新增 `docs/roadmap/task/README.md` 及 `overview.md`、`architecture.md`、`task-taxonomy.md`、`model-routing.md`、`oem-and-local-policy.md`、`cost-limit-events.md`、`event-chain.md`、`runtime-integration.md`、`diagrams.md`、`rollout-plan.md`、`acceptance.md`，把任务层、模型层、成本/限额事件与 OEM/本地协同沉淀为专题路线图。

#### 2. 模型路由、媒体运行时与图片任务协议升级

- `src-tauri/crates/services/src/model_registry_service.rs`、`src-tauri/crates/core/src/api_host_utils.rs`、`src-tauri/src/commands/auxiliary_model_selection.rs` 持续补齐模型 taxonomy、host 归一化与服务模型选择主链。
- `src-tauri/crates/media-runtime/src/lib.rs`、`src-tauri/crates/server/src/handlers/image_api_provider.rs`、`src-tauri/src/commands/media_task_cmd.rs`、`src-tauri/src/commands/aster_agent_cmd/tool_runtime/{creation_tools,media_cli_bridge}.rs` 继续收敛图片任务创建、artifact、执行与桥接协议。
- 本轮额外修正两处图片任务契约漂移：
  - 图片任务 tool schema 不再公开 `outputPath`，但仍保留 `output_path` 兼容解析。
  - 图片任务 artifact 内的 `storyboard_slots` 逐格字段统一按 snake_case 写回，避免 current 文件协议和测试断言继续分叉。
- `src-tauri/resources/default-skills/image_generate/SKILL.md` 与相关 command/runtime 也同步更新，保持默认技能与当前运行时口径一致。

#### 3. 聊天工作台、图片工作流、SceneApp 与 Memory 继续重构

- `src/components/agent/chat/` 大范围更新，涉及 `AgentChatWorkspace.tsx`、`EmptyState.tsx`、`CuratedTaskLauncherDialog.tsx`、`CharacterMention{,Panel}.tsx`、`CuratedTaskBadge.tsx`、`ImageTaskViewer.tsx`、`ImageWorkbenchMessagePreview.tsx`、`useWorkspaceImageTaskPreviewRuntime.ts`、`useWorkspaceImageWorkbenchActionRuntime.ts`、`useWorkspaceSendActions.ts`、`workspaceSendHelpers.ts` 等主链文件及配套测试。
- 新增 `agentSilentTurnRecovery`，用于处理用户发送后出现“静默 turn”时的恢复判定，减少聊天面板看起来“没发出去”但后台其实已入队的错觉。
- 新增 `saveSceneAppExecutionAsInspiration` 与 `sceneAppExecutionInspirationDraft`，支持把 SceneApp 执行结果沉淀到灵感库，并与精选任务推荐信号联动。
- `src/components/memory/MemoryPage.tsx` 与新增的 `MemoryCuratedTaskSuggestionPanel.tsx` 把 Memory 页面从“看数据”继续推进到“基于记忆继续下一步任务”。
- `src/components/sceneapps/{SceneAppsPage,SceneAppRunDetailPanel,useSceneAppsPageRuntime}.tsx` 与 `SceneAppExecutionSummaryCard.tsx` 继续补齐 follow-up、复盘和结果去向表达。

#### 4. Provider 设置、服务模型偏好与自动化页面整理

- `src/components/provider-pool/api-key/{ProviderSetting,ProviderModelList}.tsx` 及测试继续增强 provider 设置、模型推荐、默认图片服务偏好与 UI 反馈。
- `src/lib/mediaGeneration.ts`、`src/components/image-gen/useImageGen.ts`、`src/components/workspace/video/VideoCanvas.tsx` 与媒体相关前端状态同步更新，进一步对齐媒体默认配置与工作台行为。
- `src/components/settings-v2/system/automation/` 下的 `AutomationJobDetailsDialog`、`AutomationJobFocusStrip`、`AutomationOverviewFocusCard`、`index.tsx` 继续围绕自动化任务焦点、结果复盘与下一步动作整理 UI。

#### 5. Bridge、API、mock、文档与证据材料同步补齐

- 新增 `src-tauri/src/dev_bridge/dispatcher/files.rs`，补上会话文件保存、路径解析与文件预览桥接分发。
- `src-tauri/src/dev_bridge/dispatcher/{app_runtime,providers,project_resources,agent_sessions}.rs`、`src/lib/api/{agentProtocol,agentExecutionRuntime}.ts`、`src/lib/api/agentRuntime/{agentClient,types}.ts`、`src/lib/dev-bridge/mockPriorityCommands.ts`、`src/lib/tauri-mock/core.ts` 同步更新，确保 bridge、mock、前端协议和 runtime 消费者保持同一组 current surface。
- `docs/README.md`、`docs/aiprompts/{command-runtime,providers,query-loop,task-agent-taxonomy}.md`、`docs/exec-plans/limenext-progress.md` 同步刷新；未跟踪的 Playwright 记录与抓包文件一并纳入本轮递交说明，作为这批图片/工作台链路调整的现场证据。

### 版本同步

- 应用版本事实源已同步为 `1.18.0`：
  - `package.json`
  - `package-lock.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.conf.headless.json`
- 发布与分发相关版本串已同步为 `1.18.0`：
  - `packages/lime-cli-npm/package.json`
  - `packages/lime-cli-npm/README.md`
  - `src-tauri/Cargo.lock`
  - `src-tauri/crates/aster-rust/Cargo.lock`
  - `src-tauri/crates/aster-rust/crates/aster/tests/mcp_replays/cargorun--quiet-paster-server--binasterd--mcpdeveloper`

### 校验状态

- 本会话已实际通过：
  - `npm run verify:app-version`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `npm run lint`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"`
  - `cargo clippy --manifest-path "src-tauri/Cargo.toml"`


---

**完整变更**: `v1.17.0` -> `v1.18.0`
