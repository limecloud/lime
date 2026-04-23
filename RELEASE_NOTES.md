## Lime v1.17.0

发布日期：`2026-04-23`

### 发布概览

- 本次发布目标 tag 为 `v1.17.0`。
- 当前待发布工作树已扩大到 `257` 个已跟踪文件改动，并继续新增一批未跟踪模块；本版重点已经从单纯版本同步扩展为 agent/runtime current 化、模型 taxonomy 与服务模型配置升级、工作台推荐链路重构、自动化 follow-up 收口，以及语音设置主链整理。
- 本说明按当前工作树事实源重新整理，覆盖本轮新增的 runtime、settings、automation 与 docs/aiprompts 变化，不再沿用上一轮的简化摘要。

### 重点更新

#### 1. Agent runtime、skills 与会话路由继续 current 化

- `runtime_project_hooks`、`subagent_runtime`、`runtime_turn`、`request_model_resolution`、`session_api`、`dto` 与 `skill_execution` 继续增强，补齐 hook 生命周期、会话 provider 路由持久化、子代理工具边界、skill allowed-tools 下传和运行期上下文装配。
- `aster` 侧同步更新 `agent`、`reply_parts`、`subagent_tool`、`session_manager`、`session/store`、`skills/tool`、`skills/executor`、`team_tools` 等实现，并新增 `session/plan.rs`、`tools/peer_address_surface.rs` 等 current surface，继续减少 compat 语义回流。
- 前台新增 `RuntimePeerMessageCards` 及其配套解析/测试，把计划审批、任务分配、任务完成、结束请求等跨代理消息改为结构化卡片表达；协作状态与 runtime message surface 比上一轮更清晰。

#### 2. 模型 taxonomy、Provider 元数据与服务模型配置升级

- `model_registry_service`、`request_model_resolution` 与 `lime_core::model_registry` 继续扩展，显式建模 `task family`、`input/output modality`、`runtime feature`、`deployment source`、`management plane`、`alias source`，并补齐 canonical model / provider model 映射、host 归一化和 provider alias 推断。
- `ProviderModelList` 新增能力筛选、模态与来源徽标、代理别名映射提示；`inferModelCapabilities`、`providerModelsCatalog`、`oemCloudModelMetadata`、`serviceModels`、`useServiceModelsConfig` 一起补齐前端能力推断与服务模型偏好整理。
- 新增 `SettingModelSelectorField`、`auxiliary_model_selection.rs`、`api_host_utils.rs`，把图片、视频、语音等服务模型选择尽量收敛成统一配置方式；`openai.json`、`xiaomi.json`、`index.json`、`host_aliases.json` 与 app config 类型也同步更新。

#### 3. 工作台入口、推荐链路与 SceneApp follow-up 继续重构

- `EmptyState`、`SkillsWorkspacePage`、`GeneralWorkbenchSidebar`、`CharacterMentionPanel`、`inputCapabilitySections`、`CuratedTaskLauncherDialog` 等前台组件继续围绕“最近继续、推荐理由、结果预览、复盘反馈”重写，减少冷启动与切换场景时的信息断层。
- 推荐任务、做法复用与创建回放链路继续增强：`CreationReplaySurfaceBanner`、`CuratedTaskBadge`、`reviewFeedbackProjection`、`processDisplayText`、`searchResultPreview`、`runtimePeerMessageDisplay`、`imageTaskLocator` 等模块一起补齐上下文说明与任务定位。
- `SceneAppsPage`、`SceneAppExecutionSummaryCard`、`SceneAppReviewFeedbackBanner`、`sceneAppExecutionFollowupDestinations` 以及 `workspace` 侧的发送、图片预览、workbench action runtime 一起调整，发送后结果定位、SceneApp 复盘和 follow-up 导航链路更顺。

#### 4. 自动化、媒体设置与语音主链继续收口

- `settings-v2/system/automation` 新增 `AutomationJobFocusStrip`、`AutomationOverviewFocusCard`，`AutomationJobDetailsDialog` 也补上 scorecard aggregate、follow-up destination action 与 SceneApp 后续动作映射，持续流程的“现在该看什么、下一步去哪”比之前明确很多。
- `settings-v2` 下的 `image-gen`、`media-services`、`video-gen`、`voice` 页面继续大幅整理，媒体偏好区、provider 偏好与模型选择逻辑统一回收到现有设置框架。
- 语音链路继续收口到 current 主路径：`voice_config_service` 现在会在删除指令后自动回补默认/翻译指令，`voice_processor_service` 与 `voice-core/text_polish.rs` 补上 provider 透传，前台 `InstructionEditor`、`MicrophoneTest`、`ShortcutSettings` 一起接回新的设置页；旧的 `VoiceSettings.tsx` 与 `PolishModelSelector.tsx` 已继续退出主路径。

#### 5. 文档、治理与工程支撑同步

- `docs/aiprompts/overview.md`、`command-runtime.md`、`commands.md`、`governance.md`、`quality-workflow.md`、`playwright-e2e.md` 与 `docs/roadmap/lime-service-skill-cloud-config-prd.md` 已同步更新，明确了结构化 binding、`typed local_cli`、compat CLI 之间的 current/compat 边界，以及主线执行期间避免治理偏航的规则。
- `docs/exec-plans/limenext-progress.md`、`upstream-runtime-alignment-progress.md`、`tech-debt-tracker.md`、`docs/exec-plans/README.md` 等执行计划与治理文档已继续更新；新增 `docs/exec-plans/provider-model-taxonomy-progress.md`，把模型 taxonomy / provider metadata 收口过程单独落成可追踪工件。
- `eslint.config.js`、`agentRuntimeCommandSchema.json`、`commandManifest.generated.ts`、默认 skill 资源与相关测试一起更新，保证工程入口、运行时口径与默认 skill 约束保持一致。

### 已同步的发布项

- 应用版本入口已对齐到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`。
- CLI npm wrapper 与发布示例已同步到 `1.17.0`。
- `package-lock.json`、`src-tauri/Cargo.lock` 与 aster MCP replay fixture 中的应用版本串已同步到 `1.17.0`。

### 校验状态

- 当前在本会话内实际确认并通过：`npm run verify:app-version`
- 本轮 release note 更新没有额外重跑 `npm run verify:local`、`npm run test:contracts`、`npm run verify:gui-smoke`、`cargo test --manifest-path "src-tauri/Cargo.toml"`；当前 release note 不再复用旧版“已执行校验”结论来冒充这轮结果。
- 按 Lime 当前规则，这次变更同时覆盖 Rust、命令/runtime 边界和用户可见 GUI，发布前最少建议补跑：
  - `npm run verify:local`
  - `npm run test:contracts`
  - `npm run verify:gui-smoke`

---

**完整变更**: `v1.16.0` -> `v1.17.0`
