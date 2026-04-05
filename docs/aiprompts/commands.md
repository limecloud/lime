# Tauri 命令边界

## 这份文档回答什么

本文件用于说明 Lime 中 Tauri 命令的工程边界，主要回答：

- 命令改动应该从哪里进入，而不是到处直接 `invoke`
- 哪些文件共同构成命令契约的事实源
- 新增、迁移、下线命令时，最低要同步哪些位置
- 怎样避免 compat / deprecated 路径重新长出新表面

如果本轮改动不仅涉及 Tauri 命令边界，还涉及 `@` / 产品型 `/`、聊天轻卡、右侧 viewer、`ServiceSkill` 场景或命令恢复主链，请同时阅读：

- `docs/aiprompts/command-runtime.md`

## 推荐调用路径

前端业务代码**不应直接散落 `invoke`**。

推荐路径是：

`组件 / Hook -> src/lib/api/* 网关 -> safeInvoke -> Rust command`

这样做的目的不是“多包一层”，而是为了保证：

- 前端只有一个可治理的调用出口
- Rust 命令可以按 `current / compat / deprecated / dead-candidate` 演进
- 新旧命令并存时，迁移边界清晰，不会继续扩散
- 契约检查脚本能稳定扫描并阻止回流

浏览器连接器设置页同样遵循这条路径。当前主入口为 `src/lib/webview-api.ts` 中的浏览器连接器网关，统一承接：

- `get_browser_connector_settings_cmd`
- `set_browser_connector_install_root_cmd`
- `set_browser_connector_enabled_cmd`
- `set_system_connector_enabled_cmd`
- `set_browser_action_capability_enabled_cmd`
- `get_browser_connector_install_status_cmd`
- `install_browser_connector_extension_cmd`
- `open_browser_extensions_page_cmd`
- `open_browser_remote_debugging_page_cmd`
- `disconnect_browser_connector_session`

这些命令属于当前设置主路径，不应再在页面组件里散落裸 `invoke`。

旧设置页里“安全与性能 / 容错配置”那组命令已经下线。`get_retry_config`、`update_retry_config`、`get_failover_config`、`update_failover_config`、`get_switch_log`、`clear_switch_log`、`get_rate_limit_config`、`update_rate_limit_config`、`get_conversation_config`、`update_conversation_config`、`update_hint_routes`、`get_pairing_config`、`update_pairing_config` 都应视为 `dead`，不允许重新接回前端网关、Rust 注册或 mock。提示路由当前只保留只读的 `get_hint_routes` 读取面；如果未来确实要恢复编辑入口，必须重新定义 `current` 主链，而不是直接复活旧设置页命令。

旧 onboarding 插件安装流与 Provider Switch 命令链也已经下线。`get_switch_providers`、`get_current_switch_provider`、`add_switch_provider`、`update_switch_provider`、`delete_switch_provider`、`switch_provider`、`import_default_config`、`read_live_provider_settings`、`check_config_sync_status`、`sync_from_external_config` 都应视为 `dead`；初装引导当前只保留语音体验流程，不再允许通过 `config-switch`、插件推荐或配置切换 UI 重新接回这条旧链。

图库素材链路也遵循同一原则。当前主入口为 `src/lib/api/galleryMaterials.ts`，统一承接：

- `create_gallery_material_metadata`
- `get_gallery_material_metadata`
- `get_gallery_material`
- `list_gallery_materials_by_image_category`
- `list_gallery_materials_by_layout_category`
- `list_gallery_materials_by_mood`
- `update_gallery_material_metadata`
- `delete_gallery_material_metadata`

旧 `poster_material_*` 命名只允许停留在 schema 迁移与治理守卫中，不应重新出现在前端网关、Rust 命令模块或运行时代码里。

模型 Provider 真相集同样遵循单一事实源。当前前端入口为 `src/lib/api/modelRegistry.ts` 中的：

- `get_model_registry_provider_ids`

它只允许读取 `src-tauri/resources/models/index.json` 的 `providers` 列表。无论是正式 Tauri 命令还是 DevBridge 开发链路，都不应再回退数据库或其它运行态缓存去“猜” provider 集合；资源异常时必须直接暴露错误，避免把索引损坏伪装成“只是没有模型”。

文档导出链路同样遵循这条路径。当前主入口为 `src/lib/api/document-export.ts`，统一承接：

- `save_exported_document`

`Artifact Workbench`、文档工作台与其他导出入口如需把内容落到用户选择的本地路径，应继续复用这条主链，不要在业务组件里重新扩散 `Blob + a.download` 式浏览器旁路。

命令目录与输入补全链路同样需要单一事实源。当前前端主入口为 `src/lib/api/skillCatalog.ts`，统一承接：

- `bootstrap.skillCatalog`
- `GET /v1/public/tenants/{tenantId}/client/skills`
- 本地 seeded `SkillCatalog`

当前目录协议固定收敛到 `SkillCatalog.entries`：

- `entries.kind=command` 用于 `@` 原子命令
- `entries.kind=scene` 用于产品型 `/` 场景命令
- `entries.kind=skill` 用于首页与技能入口

固定约束：

- `CharacterMention`、`builtinCommands`、场景 slash 补全不得再各自维护一套业务命令静态常量
- 服务端尚未返回 `entries` 时，允许网关层从 legacy `items` 兼容投影出 `entries`
- 客户端必须保留 seeded fallback，不能因为服务端暂时不可用就让 `@配图`、`@转写` 这类主链入口失能
- `src/components/agent/chat/commands/catalog.ts` 只继续承接 Lime 本地 / Codex 原生命令；产品型 `/` 场景不应再长期硬编码在这里
- 若服务端下发的 `renderContract` 超出 Lime 当前支持范围，优先由服务端回退到已支持类型，客户端也必须退化到通用 timeline / artifact 展示

当前 `/scene-key` 的发送主链也已经固定：

- 发送前由 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 统一拦截 slash 场景
- 再委托 `src/components/agent/chat/workspace/useWorkspaceServiceSkillEntryActions.ts` 的 `handleRuntimeSceneLaunch(...)`
- 运行时只从统一 catalog 解析 `scene -> linkedSkillId -> ServiceSkillHomeItem`
- 对 `cloud_scene`，优先复用现有 `createServiceSkillRun(...)` 云端运行链
- 若云端 run 在创建前就失败，客户端必须自动回退到本地工作区 prompt 主链，不能把 slash scene 直接判死
- 未命中统一 scene 目录的 slash 文本必须继续回到普通 slash / Codex 命令流，不能误报本地 Skill 不存在

如果这轮改动触达了 `client/skills` 协议，不仅要改 Lime 前端 selector，还要同步检查 `limecore` 的：

- OpenAPI source fragments
- `packages/types`
- `packages/api-client`
- `control-plane-svc` skill catalog service 与路由测试

媒体生成任务链路同样需要单一事实源。当前对外公开契约应优先收敛到 `lime media ... generate --json` 这条 CLI 主链，至少覆盖：

- `lime media image generate`
- `lime media cover generate`
- `lime media video generate`

这些命令统一产出 `.lime/tasks/<task_type>/*.json` artifact 与稳定 JSON 输出。仓库内现有 `lime_create_*_generation_task`、`social_generate_cover_image` 与相关 Tauri / agent tool 入口在兼容期内允许保留，但应继续委托同一套任务文件与输出契约，不要再长出第三套“媒体任务协议”。

`Claw` 的图片任务当前需要分成两条已收敛主链：

- Agent 驱动的图片命令：`@配图` / `@修图` / `@重绘` / `@image` / `/image` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送，不再预翻译为 `/image_generate ...`。聊天发送边界会把结构化 `image_task` 写入 `request_metadata.harness.image_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/image_skill_launch.rs` 会物化 `skill-input-image://N` 引用，并给当前 turn 注入只允许首刀优先调用 `Skill(image_generate)` 的系统提示。后续默认 skill 继续优先走 `Bash -> lime media image generate --json`，CLI 不可用时再回退 `lime_create_image_generation_task`，最终仍只落到标准 task file。
- 显式 task 动作：文稿 inline 配图、封面位、图片工作台编辑/变体、带引用图或带参考图的动作，继续通过 `src/lib/api/mediaTasks.ts` 承接：

- `create_image_generation_task_artifact`
- `get_media_task_artifact`
- `list_media_task_artifacts`
- `cancel_media_task_artifact`

无论入口来自 slash skill 还是显式 task action，最终都只允许写入当前项目根目录下的标准 `image_generate` task file，并写入 `session_id / project_id / content_id / entry_source / mode` 等上下文。若当前来源是文稿 inline 配图，还会继续写入 `usage=document-inline`，并以 `relationships.slot_id` 作为正文占位块与后续任务回填的正式绑定字段；payload 中的 `slot_id` 仅保留兼容读取。若前端已经能推断目标小节，还应继续把 `anchor_section_title` 写入 task payload；若还能识别用户当前选中的具体段落，还应继续把裁剪后的 `anchor_text` 一并写入，用于正文占位图与最终图片的 paragraph 级原位落位。聊天区动态占位、正文占位替换、结果回填、刷新恢复都必须继续以 `.lime/tasks` 为唯一事实源，不允许重新回到前端直连图片服务。

Workspace `Bash` 运行时在当前主链中应优先解析同名 `lime` 入口：开发态优先回落到 `cargo run -p lime-cli`，打包态优先使用随应用提供的 CLI 二进制。默认 skill 若已经切到 `Bash -> lime media ...`，仍应保留 compat tool 作为兜底，避免在 CLI 暂不可用时把用户流量打断。

Skill 执行链路同样遵循单一命令边界。当前前端入口为 `src/lib/api/skill-execution.ts`，统一承接：

- `execute_skill`
- `list_executable_skills`
- `get_skill_detail`

其中 `execute_skill` 当前除了 `skillName / userInput`，也允许继续携带 `images` 与 `requestContext`。这条扩展仍服务带图片输入、显式 skill 执行或 compat 续接场景，但它已经不是 `Claw @配图` 纯文本命令的 current 主链。当前主链必须优先让 Agent 在原始用户消息上做分析，再由模型首刀调用 `Skill(image_generate)`，不要重新回到前端预翻 slash skill、前端直建图片任务或其它并行入口。

`Claw` 的纯文本封面命令也应沿同一条 current 主链收敛：

- Agent 驱动的封面命令：`@封面` / `@cover` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `cover_task` 写入 `request_metadata.harness.cover_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/cover_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(cover_generate)` 的系统提示。后续默认 skill 继续优先走 `social_generate_cover_image + Bash -> lime task create cover --json`，CLI 不可用时再回退 `lime_create_cover_generation_task`，最终仍只允许落到标准 `cover_generate` task file。

`Claw` 的纯文本视频命令也应沿相同心智收敛：

- Agent 驱动的视频命令：`@视频` / `@video` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `video_task` 写入 `request_metadata.harness.video_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/video_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(video_generate)` 的系统提示。后续默认 skill 继续优先走 `Bash -> lime media video generate --json`，CLI 不可用时再回退 `lime_create_video_generation_task` / `create_video_generation_task`，最终仍只允许落到标准 `video_generate` 任务主链。

`Claw` 的纯文本转写命令也应沿同一条 current 主链收敛：

- Agent 驱动的转写命令：`@转写` / `@transcribe` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `transcription_task` 写入 `request_metadata.harness.transcription_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/transcription_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(transcription_generate)` 的系统提示。后续默认 skill 继续优先走 `Bash -> lime task create transcription --json`，CLI 不可用时再回退 `lime_create_transcription_task`，最终仍只允许落到标准 `transcription_generate` task file；若当前上下文缺少 `source_url` / `source_path`，允许 Agent 最多追问 1 个关键问题，但不能伪造“已完成转写”。

`Claw` 的纯文本链接解析命令也应沿同一条 current 主链收敛：

- Agent 驱动的链接解析命令：`@链接解析` / `@链接` / `@url_parse` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `url_parse_task` 写入 `request_metadata.harness.url_parse_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/url_parse_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(url_parse)` 的系统提示。后续默认 skill 继续优先走 `Bash -> lime task create url-parse --json`，CLI 不可用时再回退 `lime_create_url_parse_task`，最终仍只允许落到标准 `url_parse` task file；若当前上下文缺少 URL，允许 Agent 最多追问 1 个关键问题，但不能伪造“链接已解析完成”。

这五条命令除了 Tauri `generate_handler!` 之外，也必须继续保持 DevBridge dispatcher 已桥接，避免浏览器模式、headless smoke 或 Playwright 续测时回退成 unknown command。

自动化设置链路同样遵循这条路径。当前主入口为 `src/lib/api/automation.ts`，统一承接：

- `get_automation_scheduler_config`
- `update_automation_scheduler_config`
- `get_automation_status`
- `get_automation_jobs`
- `get_automation_job`
- `create_automation_job`
- `update_automation_job`
- `delete_automation_job`
- `run_automation_job_now`
- `get_automation_health`
- `get_automation_run_history`
- `preview_automation_schedule`
- `validate_automation_schedule`

这些命令属于当前 `设置 -> 系统 -> 自动化` 主路径。浏览器模式下如已接通 DevBridge，应优先走真实后端；不要因为 dispatcher 漏接而长期依赖 mock 掩盖设置页报错。

Companion 桌宠链路同样遵循这条路径。当前主入口为 `src/lib/api/companion.ts`，统一承接：

- `companion_get_pet_status`
- `companion_launch_pet`
- `companion_send_pet_command`

Lime 主应用会在本地维护 `ws://127.0.0.1:45554/companion/pet` 的桌宠 companion 入口。前端如需感知桌宠连接状态，应继续通过 `companion-pet-status` 事件监听统一状态，不要在页面或 Hook 里自行直连本地 `WebSocket`。

如果 companion 协议继续扩展，也应优先延续“Lime 做宿主、桌宠只收脱敏派生状态”的边界。例如 provider 凭证池相关能力，允许 Lime 通过 `companion_send_pet_command` 下发诸如 `pet.provider_overview` 这类脱敏摘要，并允许桌宠通过 `pet.open_provider_settings` 请求 Lime 聚焦主窗口并跳到 `设置 -> AI 服务商`，或通过 `pet.request_provider_overview_sync` 请求 Lime 立即重发最新的脱敏摘要；桌宠交互增强能力也应继续走这条主链，例如双击 / 三击桌宠后发出 `pet.request_pet_cheer`、`pet.request_pet_next_step`，或通过 `pet.request_chat_reply` 携带用户输入文本，请求 Lime 代为调用当前可聊天模型，再统一回写 `pet.show_bubble`；但不允许桌宠直接读取凭证文件、数据库或内部 `/v1/credentials/*` 完整凭证接口。

## 命令契约的五个事实源

命令边界不是单文件事实，至少要同时看下面五处：

1. **前端实际调用**  
   `src/` 下运行时代码里的 `safeInvoke(...)` / `invoke(...)`

2. **Rust 实际注册**  
   `src-tauri/src/app/runner.rs` 中的 `tauri::generate_handler![...]`

3. **治理目录册**  
   `src/lib/governance/agentCommandCatalog.json`

4. **Bridge mock 优先集合**  
   `src/lib/dev-bridge/mockPriorityCommands.ts`

5. **默认 mock 实现**  
   `src/lib/tauri-mock/core.ts` 中的 `defaultMocks`

只看其中一侧都不够。只要能力仍然依赖命令边界，就至少要同时核对前端调用、Rust 注册、治理目录册、mock 集合这几面。

## MCP 工具命名主链

MCP bridge 当前唯一继续演进的工具命名事实源是：

- 工具全名：`mcp__<server>__<tool>`
- extension surface key：`mcp__<server>`
- UI 展示名：继续优先显示 server 原名，例如 `lime-browser`

不要再新增或恢复以下旧命名心智：

- 裸 `server__tool`
- 只在重名时才临时拼 `server_tool`
- inventory / mock / GUI 面板里 extension key 与工具前缀各自一套

## 命令分类语言

命令治理统一沿用 `governance.md` 的分类语言：

- `current`：当前主路径，后续能力继续向这里收敛
- `compat`：兼容层，只允许委托、适配、告警，不允许长新逻辑
- `deprecated`：废弃层，只允许迁移与下线，不允许新增依赖
- `dead`：已停用或确认无入口，优先删除

脚本或治理报告里还可能看到：

- `dead-candidate`

它表示“删除候选信号”，不是自动等于 `dead`。

如果本次改动说不清自己属于哪一类，先不要写代码，先读 `docs/aiprompts/governance.md`。

## 新增或改命令的标准步骤

### 1. 先判断是不是应该新增命令

先问三个问题：

- 当前需求能不能落到已有 `current` 主链？
- 这次是补能力，还是只是在给 compat 层续命？
- 有没有已经存在但尚未收口的旧入口？

如果答案是“已有主链可承接”，优先补现有主链，不再新开平级命令。

### 2. 前端只从 API 网关进入

- 在 `src/lib/api/*` 下新增或扩展对应网关
- 页面、组件、普通 Hook 不要直接调用裸 `invoke`
- 尽量把命令名、参数整理、返回类型都收在网关层

推荐写法：

```typescript
// src/lib/api/serverRuntime.ts
import { safeInvoke } from "@/lib/dev-bridge";

export async function getServerDiagnostics() {
  return safeInvoke<ServerDiagnostics>("get_server_diagnostics");
}
```

业务层只消费网关：

```typescript
import { getServerDiagnostics } from "@/lib/api/serverRuntime";

const diagnostics = await getServerDiagnostics();
```

共享网关控制面已下线后，`start_server`、`stop_server`、`get_server_status`、`get_available_routes`、`get_route_curl_examples`、`test_api`、`get_network_info`，以及托盘残留 `sync_tray_state`、`update_tray_server_status`、`update_tray_credential_status`、`get_tray_state`、`refresh_tray_menu`、`refresh_tray_with_stats` 都应视为 `dead` 候选，不应重新接回前端主路径；server 兼容面 `/v1/routes`、`/{selector}/v1/messages`、`/{selector}/v1/chat/completions` 也应视为 `dead` 候选，不应重新接回本地共享网关主链；开发者诊断统一继续走 `get_server_diagnostics`，托盘只保留 `sync_tray_model_shortcuts`，server 只保留标准 `/v1/messages` 与 `/v1/chat/completions`。

### 3. Rust 命令与注册表同步

- 在 `src-tauri/src/commands/` 下落到对应模块
- 在 `src-tauri/src/app/runner.rs` 的 `tauri::generate_handler!` 中注册
- 不要只写命令实现，不补注册

### 4. 治理目录册与 mock 同步

命令边界发生变化时，按需同步：

- `src/lib/governance/agentCommandCatalog.json`
- `src/lib/dev-bridge/mockPriorityCommands.ts`
- `src/lib/tauri-mock/core.ts`

尤其是以下场景：

- 新命令属于 runtime gateway
- 旧命令进入 `deprecated`
- 旧 helper 被替换
- Bridge 优先命令需要本地 mock

### 5. 文档同步

至少同步更新：

- 本文档 `docs/aiprompts/commands.md`
- `docs/aiprompts/quality-workflow.md`
- 如涉及 GUI 续测，再看 `docs/aiprompts/playwright-e2e.md`

### 6. 跑最低校验

至少运行：

```bash
npm run test:contracts
```

必要时补：

```bash
npm run governance:legacy-report
npm run verify:local
```

如果命令边界改动影响会话运行时恢复语义，例如：

- `agent_runtime_submit_turn.turn_config` 新增或调整 `approval_policy / sandbox_policy`
- `agent_runtime_submit_turn.request_metadata.harness.team_memory_shadow` 新增或调整 repo-scoped Team 协作记忆注入
- `agent_runtime_spawn_subagent` 的 current request 字段新增或调整 `name / teamName / runInBackground / mode / isolation / cwd`，或修改 spawn 后的 Team 成员写回、child `working_dir` 与父子会话上下文投影
- `agent_runtime_update_session` 新增或调整 `provider_name / model_name / execution_strategy / recent_access_mode / recent_preferences / recent_team_selection`
- `getSession/listSessions` 的 `execution_runtime` 新增或调整 `recent_access_mode / recent_theme / recent_session_mode / recent_gate_key / recent_run_title / recent_content_id`
- 话题切换时的 provider/model、权限 accessMode、工具偏好、Team 选择，或 `theme / session_mode / gate_key / run_title / content_id` 恢复从本地 fallback 向 `execution_runtime` 收敛

除了契约检查，还应补对应 Hook / UI 稳定回归，确认切换话题后模型选择器恢复的是会话 runtime，而不是陈旧本地缓存。

## 变更完成定义

一次命令边界改动，至少满足以下条件才算完成：

1. 前端调用已经收口到 `src/lib/api/*`
2. Rust 命令已在 `runner.rs` 注册
3. `agentCommandCatalog.json` 中的治理口径已同步
4. `mockPriorityCommands` 与 `defaultMocks` 没有漂移
5. `npm run test:contracts` 通过
6. 涉及 compat / deprecated 的改动，已补 `governance:legacy-report` 或明确说明不需要

## 自动化 `agent_turn` 负载补充约定

当 `create_automation_job` / `update_automation_job` 的 `payload.kind = "agent_turn"` 用于持续产出交付物时，允许并推荐透传以下字段：

- `content_id`：绑定长期内容主线，供自动化版本持续沉淀到同一交付链
- `request_metadata`：与运行时 turn 保持同合同，至少可包含 `artifact` 与 `harness` 两层

推荐形态：

- `request_metadata.artifact`：`artifact_mode / artifact_kind / artifact_stage / workbench_surface`
- `request_metadata.harness`：`theme / session_mode / content_id`

这样做的目的不是给自动化新增第二套协议，而是让自动化直接复用现有 runtime turn 的 Artifact 主链。

## 明确禁止

- 在页面、组件、普通 Hook 中直接散落 `invoke`
- 给 `compat` 路径继续长新业务逻辑
- 把已经进入 `deprecated` / `dead-candidate` / `dead` 的命令重新接回主链
- 只改前端或只改 Rust，一侧通过就宣布完成
- 用“先兼容一下”作为长期保留第二套入口的理由

## 当前主链示例

以下是仓库当前已经明确收敛的几个方向：

- **Agent / Codex 主命令**：继续收敛到 `agent_runtime_*`
- **子代理运行时主链**：继续收敛到 `agent_runtime_spawn_subagent`；当前 request surface 使用 `name / teamName / runInBackground / mode / isolation / cwd` 等字段，其中 `teamName` 需要与 `name` 搭配并依附现有 Team 上下文，`cwd` 必须是绝对目录，并稳定投影到 child session 的 `working_dir` 与 Team 成员展示；当前 runtime 仍会明确拒绝非空 `mode / isolation`
- **Team runtime 工具主链**：当前协作工具面继续收敛到 `Agent / TeamCreate / TeamDelete / SendMessage / ListPeers`；`SubAgentTask` 仅保留兼容入口，不再作为新的多代理主路径
- **用户可见消息工具主链**：继续收敛到 `SendUserMessage`，用于把回复、进度同步、主动提醒和附件送到用户主可见消息面；不要再把这类能力拆到其它平行工具名或旁路协议里
- **会话状态回写主链**：继续收敛到 `agent_runtime_update_session`，用于名称、执行策略、session provider/model、`recent_access_mode`、`recent_preferences` 以及 `recent_team_selection` 的轻量持久化回写
- **会话权限主链**：`agent_runtime_submit_turn.turn_config.approval_policy / sandbox_policy` 是正式 turn context 权限协议；`getSession` 返回的 `execution_runtime.recent_access_mode` 负责承接会话最近一次 accessMode。当前端已命中同一 steady-state 权限时，不应继续依赖 `harness.access_mode` 作为唯一事实源
- **运行时交接导出主链**：继续收敛到 `agent_runtime_export_handoff_bundle`；前端统一通过 `src/lib/api/agentRuntime.ts` 网关进入，当前 GUI 入口位于 `HarnessStatusPanel`
- **运行时证据导出主链**：继续收敛到 `agent_runtime_export_evidence_pack`，用于把 runtime / timeline / artifacts 打包成最小问题证据
- **运行时 replay 样本主链**：继续收敛到 `agent_runtime_export_replay_case`，复用 handoff bundle + evidence pack 生成 `input / expected / grader / evidence-links`
- **运行时外部分析交接主链**：继续收敛到 `agent_runtime_export_analysis_handoff`，复用 handoff bundle + evidence pack + replay case 生成 `analysis-brief.md / analysis-context.json / copy_prompt`，供外部诊断代理直接诊断与最小修复；当前 GUI 入口位于 `HarnessStatusPanel`
- **运行时人工审核记录主链**：继续收敛到 `agent_runtime_export_review_decision_template` + `agent_runtime_save_review_decision`；前者复用 `analysis handoff` 生成 `review-decision.md / review-decision.json` 模板，后者把开发者的接受 / 延后 / 拒绝与回归要求回写到同一份工作区制品；当前 GUI 入口位于 `HarnessStatusPanel`
- **会话主题上下文主链**：`getSession` 返回的 `execution_runtime.recent_theme / recent_session_mode` 负责承接最近一次运行态主题上下文；当前端已命中同一 steady-state theme/workbench mode 时，不应继续每回合重复携带 `harness.theme / harness.session_mode`
- **会话运行阶段上下文主链**：`getSession` 返回的 `execution_runtime.recent_gate_key / recent_run_title` 负责承接最近一次 Theme Workbench 运行阶段上下文；当前端已命中同一 steady-state gate/run 时，不应继续每回合重复携带 `harness.gate_key / harness.run_title`
- **会话内容上下文主链**：`getSession` 返回的 `execution_runtime.recent_content_id` 负责承接最近一次运行态 `content_id`；当前端已命中同一 steady-state 内容时，不应继续每回合重复携带 `harness.content_id`
- **运行态摘要主链**：Aster `runtime_status` item -> timeline `turn_summary`
- **上下文压缩策略主链**：`workspace.settings.auto_compact` 是运行时自动压缩的唯一 workspace 级开关；`agent_runtime_submit_turn` 与 `agent_runtime_respond_action` 都会把该设置注入 turn context。值为 `false` 时，Lime 不会做发起前自动压缩，并会显式告诉 Aster 关闭当前回合的内部自动压缩 / overflow recovery 自动压缩；此时只允许用户通过 `agent_runtime_compact_session` 手动压缩。
- **旧 `chat_*` 命令**：已停止注册，不应重新回到 `commands::mod` 或 `generate_handler!`
- **旧 `general_chat_*` 边界**：前端 compat 网关与 Rust 命令都已移除，不应重新接入
- **记忆系统**：统一沉淀优先走 `unified_memory_*`，runtime / 上下文视图优先走 `memory_runtime_*`
- **旧项目风格命令**：`style_guide_get` / `style_guide_update` 已下线，不应再从前端网关、Rust 注册或 mock 中接回
- **旧项目模板命令**：`create_template` / `list_templates` / `get_template` / `update_template` / `delete_template` / `set_default_template` / `get_default_template` 已下线，不应再从前端网关、Rust 注册或 mock 中接回
- **旧品牌人设扩展命令**：`get_brand_persona` / `get_brand_extension` / `save_brand_extension` / `update_brand_extension` / `delete_brand_extension` / `list_brand_persona_templates` 已下线，不应再从前端网关、Rust 注册或 mock 中接回
- **图库素材主链**：继续收敛到 `gallery_material_*` 命令族与 `src/lib/api/galleryMaterials.ts`；旧 `create_poster_metadata` / `get_poster_material` / `list_by_*` 命名已下线，不应重新接回

这些示例的意义不是列清单，而是提醒：

**不要再造第三套入口，优先继续把能力收敛到已存在的主链。**

补充说明：

- `execution_runtime.recent_team_selection` 继续承接 steady-state 的 Team 选择恢复
- `agent_runtime_submit_turn.request_metadata.harness.team_memory_shadow` 只承接当前请求的 repo-scoped Team 协作记忆，例如最近一次 Team 选择、子代理状态与父会话上下文；它是低优先级协作参考，不替代显式 `selected_team_*` 或 session runtime

- **站点能力主链**：继续收敛到 `site_list_adapters / site_recommend_adapters / site_search_adapters / site_get_adapter_info / site_get_adapter_launch_readiness / site_get_adapter_catalog_status / site_import_adapter_yaml_bundle / site_run_adapter`
- **站点适配器导入主链**：`site_import_adapter_yaml_bundle` 只负责把外部 YAML 来源编译为 Lime 标准并写入 `imported` 目录，不允许带入第二套 runtime、daemon 或自动唤醒浏览器链路
- **站点 Agent 工具主链**：继续收敛到 `lime_site_list / lime_site_recommend / lime_site_search / lime_site_info / lime_site_run`
- **站点技能首页入口主链**：首页 / 工作区弹窗只负责补参数、组装 `initialUserPrompt + harness.service_skill_launch` 上下文并进入 `Claw`；真正执行统一收口到 `Claw` 首回合，不再由首页弹窗或工作区挂载副作用直接调用 `site_run_adapter`
- **站点结果沉淀主线**：`site_run_adapter` / `lime_site_run` 优先透传 `content_id` 写回当前主稿；只有缺少 `content_id` 时，才回退到 `project_id` 新建结果文档
- **Claw 站点直跑门禁主链**：`site_get_adapter_launch_readiness` 只负责检测“是否存在已附着的真实浏览器会话 + 目标站点上下文”；`site_run_adapter.require_attached_session = true` 时，后端必须拒绝 managed/default fallback，不能后台偷偷起 Chrome
- **attached-session 执行主链**：真实浏览器附着场景下，Bridge `run_adapter` 只允许下发 `adapter_name + args`，禁止继续透传原始脚本文本到扩展 content script，以免触发站点 CSP 的 `unsafe-eval`
- **站点运行失败语义**：`SiteAdapterRunResult` 至少统一输出 `auth_required / no_matching_context / adapter_runtime_error`，并在前端与 Agent 结果里保留 `report_hint`
- **浏览器资料 / 环境预设主链**：`list/save/archive/restore_browser_profile_cmd` 与 `list/save/archive/restore_browser_environment_preset_cmd` 已进入真实 DevBridge 主路径；浏览器模式下不应再默认放进 `mockPriorityCommands`，仅在 DevBridge 不可用时才允许回落 `defaultMocks`
- **浏览器运行时启动主链**：`launch_browser_session` / `launch_browser_runtime_assist` 支持显式 `headless` 启动参数；仅用于 `verify:gui-smoke` 一类自动化校验避免弹出空白 Chrome，正常用户态调用默认仍保持有界面浏览器

## 相关检查脚本

```bash
# 命令契约检查
npm run test:contracts

# 旧边界与死链收口
npm run governance:legacy-report

# 本地统一校验
npm run verify:local
```

## 相关文档

- `docs/aiprompts/governance.md`
- `docs/aiprompts/quality-workflow.md`
- `docs/aiprompts/credential-pool.md`
- `src/lib/governance/agentCommandCatalog.json`
- `src/lib/governance/legacySurfaceCatalog.json`
