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
同理，聊天运行时初始化的 `aster_agent_init` 在浏览器 DevBridge 模式下也不能再被放进 `mockPriorityCommands`。只要桥接在线，它就必须优先读取后端真实 `provider_name / model_name`，让聊天入口拿到当前运行时模型。
进一步地，围绕运行时模型解析的真相命令：`aster_agent_init`、`get_default_provider`、`get_provider_pool_overview`、`get_api_key_providers`、`get_model_registry`、`get_provider_alias_config`、`fetch_provider_models_auto`、`get_model_registry_provider_ids`，在浏览器 DevBridge 模式下如果桥接失败，必须直接抛错，不能再通过 `safeInvoke` 静默退回 mock；否则前端会把“后端未连上 / 命令失败”误显示成假的 Provider / 模型列表。
同时要明确，`aster_agent_init` 只负责初始化 Agent，并不保证已经完成 Provider 配置；当它未返回 `provider_name / model_name` 时，前端不得把本地硬编码默认值当作真实模型，而应继续回退到 `get_default_provider` + 已配置 Provider/模型注册表解析链，拿到当前工作区真正可用的 `provider/model`。
同一条约束也适用于 Prompt Cache 能力判断：运行时与前端都不得因为某个自定义 Provider “长得像 Anthropic 协议”就推断它支持官方 Anthropic Automatic Prompt Caching。当前事实源必须继续按 ProviderType 判断：`anthropic` 走自动缓存能力，`anthropic-compatible` 只保留显式 `cache_control` 语义；若上游没有实现 Automatic Prompt Cache，`cached_input_tokens` 为空不能直接归因到 Lime 没发字段。

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
- 客户端必须保留 seeded fallback，不能因为服务端暂时不可用就让 `@配图`、`@海报`、`@配音`、`@浏览器`、`@PPT`、`@表单`、`@网页`、`@代码`、`@渠道预览`、`@上传`、`@发布`、`@发布合规`、`@搜索`、`@深搜`、`@研报`、`@站点搜索`、`@读PDF`、`@总结`、`@翻译`、`@分析`、`@转写` 这类主链入口失能
- `src/components/agent/chat/commands/catalog.ts` 只继续承接 Lime 本地 / Codex 原生命令；产品型 `/` 场景不应再长期硬编码在这里
- 若服务端下发的 `renderContract` 超出 Lime 当前支持范围，优先由服务端回退到已支持类型，客户端也必须退化到通用 timeline / artifact 展示
- `scene` 的展示命名、推荐文案和补参标题应继续围绕创作生产语义收敛；`@发布合规` 只是发布前风控检查，不应被产品文案扩写成独立“法务场景”，也不要在目录里长出“建立”这类脱离创作目标的泛入口

`SceneApp` 的统一目录与运行前规划命令同样只允许走单一网关。当前前端主入口为 `src/lib/api/sceneapp.ts`，统一承接：

- `sceneapp_list_catalog`
- `sceneapp_get_descriptor`
- `sceneapp_plan_launch`
- `sceneapp_create_automation_job`
- `sceneapp_list_runs`
- `sceneapp_get_run_summary`
- `sceneapp_get_scorecard`

固定约束：

- `SceneApp` 命令当前属于目录查询、运行前规划与治理摘要主链，不应在页面组件里直接裸 `invoke`
- 新的 SceneApp UI 先消费 `SceneAppDescriptor / SceneAppPlanResult / SceneAppScorecard`，不要重新从 `serviceSkills.ts`、`skillCatalog.ts`、卡片配置和 selector 里各自拼语义
- 真正的执行仍应通过 runtime adapter 继续挂回现有 `agent turn / browser_assist / automation_job / cloud_scene` 主链；`sceneapp_*` 不用于重新发明第二套 runtime taxonomy

技能脚手架创建同样只允许走当前命令网关主链：

- 前端统一经由 `src/lib/api/skills.ts -> create_skill_scaffold_for_app`
- 参数统一放在嵌套 `request` 对象里，不要再散落平铺字段
- 当前允许的结构化骨架字段除了 `target / directory / name / description` 之外，还包括：
  - `whenToUse`
  - `inputs`
  - `outputs`
  - `steps`
  - `fallbackStrategy`
- 聊天结果沉淀为技能时，只能继续扩这组说明型字段，不要再平行发明第二套“技能草稿协议”

当前 `/scene-key` 的发送主链也已经固定：

- 发送前由 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 统一拦截 slash 场景
- 运行时只从统一 catalog 解析 `scene -> linkedSkillId -> ServiceSkillHomeItem`，并把结构化上下文写入 `request_metadata.harness.service_scene_launch`
- Rust 侧 `runtime_turn` 会把这类 turn 统一切到 `workbench`，并通过 `prompt_context` 强约束首刀优先调用 `lime_run_service_skill`
- `lime_run_service_skill` 负责基于当前 session / turn 上下文读取已绑定的 `serviceSkillId + OEM runtime`，再向 OEM Scene Runtime 发起 run / poll
- slash scene 不应再在前端直接调用 `createServiceSkillRun(...)` 或其它云端 run API；客户端当前职责只剩 catalog 解析、metadata 注入与 seeded/fallback 托底
- 未命中统一 scene 目录的 slash 文本必须继续回到普通 slash / Codex 命令流，不能误报本地 Skill 不存在
- `/scene` 的长期产品真相应落在 `Scene Skill`；`site_adapter` 只是 step provider，不是 scene runtime 本体
- 如果 scene 缺少 URL、项目等必填输入，前端不应只 toast 结束；应打开统一 `scene gate`，由 `slotSchema` / `readinessRequirements` 驱动补参
- 如果某个 scene 背后绑定的是 `site_adapter / browser_assist` 型技能，前端可以继续只暴露 `scene`，不必把底层 site skill 再平铺成首页目录项；但运行时解析 `scene -> linkedSkillId` 时必须能回退完整 `ServiceSkill` 目录，而不是只看首页可见 skill 列表，否则会出现目录可见但执行找不到 skill 的协议漂移
- 如果某个 `site_adapter / browser_assist` scene 还声明了 `readinessRequirements.requiresProject=true`，或 `saveMode=project_resource` 需要真实项目目录，输入框 slash 发送时必须沿用当前选中的项目；若当前没有项目，前端必须通过 `scene gate` 收集项目，不能静默 `getOrCreateDefaultProject()` 把结果写进 default 项目
- scene 或技能补参继续只声明 `slotSchema`；若后续要在 GUI 里补 `a2ui` 表单，也只能作为渲染层实现细节，不能把 `a2ui` 类型耦合进 `SkillCatalog`、`request_metadata.harness` 或 Tauri 命令契约

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

`Claw` 的图片任务当前已经收敛到同一条 current 主链：

- Agent 驱动的图片命令与显式图片动作：`@配图` / `@修图` / `@重绘` / `@image` / `/image`，以及文稿 inline 配图、封面位、图片工作台编辑/变体、带引用图或带参考图的动作，都必须先进入 Agent turn。纯文本入口由 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 保留原始用户文本发送；显式动作则由 `src/components/agent/chat/workspace/useWorkspaceImageWorkbenchActionRuntime.ts` 组装同构的 `image_task` 上下文后，再复用统一发送主线。两类入口都会把结构化 `image_task` 写入 `request_metadata.harness.image_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/image_skill_launch.rs` 会物化 `skill-input-image://N` 引用，并给当前 turn 注入只允许首刀优先调用 `Skill(image_generate)` 的系统提示。当前图片 launch 还会在 session permission 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类偏航工具，并在当前 session registry 中直接移除这些 detour tools，避免模型把 `@配图` 卡死在“先搜工具目录”或把权限报错直接暴露给用户。后续默认 skill 继续优先走 `Bash -> lime media image generate --json`；该 CLI 当前主链必须创建 task artifact 后同步推进到 `queued/running/succeeded|partial|failed`，而不是停在 `pending_submit`。兼容入口 `lime task create image --json` 也必须委托同一条执行链，不能再只写 task file 不执行。CLI 不可用时再回退 `lime_create_image_generation_task`，但 compat tool 也必须复用同一个 `image_generate` task artifact + worker 执行链，且忽略 `outputPath` 这类非标准落盘出口，最终仍只落到标准 task file。
- 显式图片动作如果先在前端补好了 `image_skill_launch` metadata，也必须继续复用统一发送边界去绑定真实 `session_id`。不要在图片动作侧为了拿 `session_id` 再额外 `createFreshSession(...)`，否则一次 `@配图` 会被拆成两个对话；当前正确做法是允许 metadata 先带本地 draft key，再在发送前统一替换成真实会话 ID。
- 图片结果展示固定继续走 `聊天轻卡 -> 图片工作台` 主链：通用 `tool_result` 只保留 timeline 与轻卡，不应把空内容的 `.jpg/.png/.webp` 二进制结果再镜像成通用 artifact 卡片；否则会出现重复 `output_image.jpg`、路径不一致导致去重失败、以及点击后无法在文本 workbench 打开的错误体验。
- 通用 artifact 层对同一路径必须做等价归一：`basename / 相对路径 / 绝对路径` 在前端应视作同一文件；`tool_result` 来源的产物默认后台更新，不自动选中、不自动展开工作台，避免命令执行过程中抢焦点。
- 图片 task 控制面：`src/lib/api/mediaTasks.ts` 继续承接 task control / replay / recovery，而不是首发入口：

- `create_image_generation_task_artifact`
- `get_media_task_artifact`
- `list_media_task_artifacts`
- `cancel_media_task_artifact`

无论入口来自纯文本命令、slash scene 组合还是显式图片动作，最终都只允许写入当前项目根目录下的标准 `image_generate` task file，并写入 `session_id / project_id / content_id / entry_source / mode` 等上下文。若当前来源是文稿 inline 配图，还会继续写入 `usage=document-inline`，并以 `relationships.slot_id` 作为正文占位块与后续任务回填的正式绑定字段；payload 中的 `slot_id` 仅保留兼容读取。若前端已经能推断目标小节，还应继续把 `anchor_section_title` 写入 task payload；若还能识别用户当前选中的具体段落，还应继续把裁剪后的 `anchor_text` 一并写入，用于正文占位图与最终图片的 paragraph 级原位落位。聊天区动态占位、正文占位替换、结果回填、刷新恢复都必须继续以 `.lime/tasks` 为唯一事实源，不允许重新回到前端直连图片服务。

- `.lime/tasks/**/*.json` 本身是内部任务状态快照，不是面向用户的正式产物。聊天区 artifact 卡片、时间线 file artifact 与默认文件面板都应把这类 JSON 隐藏掉；它们只服务恢复、轮询、取消、重试和诊断，真正给用户看的应该是轻量结果卡、tool timeline 与右侧 viewer。

Workspace `Bash` 运行时在当前主链中应优先解析同名 `lime` 入口：开发态优先回落到 `cargo run -p lime-cli`，打包态优先使用随应用提供的 CLI 二进制。默认 skill 若已经切到 `Bash -> lime media ...`，仍应保留 compat tool 作为兜底，避免在 CLI 暂不可用时把用户流量打断。

Skill 执行链路同样遵循单一命令边界。当前前端入口为 `src/lib/api/skill-execution.ts`，统一承接：

- `execute_skill`
- `list_executable_skills`
- `get_skill_detail`

其中 `execute_skill` 当前除了 `skillName / userInput`，也允许继续携带 `images` 与 `requestContext`。这条扩展仍服务带图片输入、显式 skill 执行或 compat 续接场景，但它已经不是 `Claw @配图` 纯文本命令的 current 主链。当前主链必须优先让 Agent 在原始用户消息上做分析，再由模型首刀调用 `Skill(image_generate)`，不要重新回到前端预翻 slash skill、前端直建图片任务或其它并行入口。

`Claw` 的纯文本封面命令也应沿同一条 current 主链收敛：

- Agent 驱动的封面命令：`@封面` / `@cover` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `cover_task` 写入 `request_metadata.harness.cover_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/cover_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(cover_generate)` 的系统提示；当前封面 launch 还会在 session permission 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类偏航工具，并在当前 session registry 中直接移除这些 detour tools，避免模型在 `@封面` 首刀前先去搜索工具目录。后续默认 skill 继续优先走 `social_generate_cover_image + Bash -> lime task create cover --json`，CLI 不可用时再回退 `lime_create_cover_generation_task`，最终仍只允许落到标准 `cover_generate` task file。

`Claw` 的纯文本海报命令也应沿同一条 current 主链收敛：

- Agent 驱动的海报命令：`@海报` / `@poster` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把解析后的平台、风格、尺寸 / 比例重新组装进 `request_metadata.harness.image_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`；它不是新的 `poster_task` 协议，而是继续委托 `Skill(image_generate)`。当前 `@海报` 会默认补齐“海报设计”语义，并将默认尺寸收敛为 `4:5 -> 864x1152`，同时把 `entry_source` 写为 `at_poster_command`。Rust 侧仍复用 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/image_skill_launch.rs`，继续压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类偏航工具。后续默认 skill 继续优先走 `Bash -> lime media image generate --json`，CLI 不可用时再回退 `lime_create_image_generation_task`，最终仍只允许落到标准 `image_generate` task file。

`Claw` 的纯文本视频命令也应沿相同心智收敛：

- Agent 驱动的视频命令：`@视频` / `@video` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `video_task` 写入 `request_metadata.harness.video_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/video_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(video_generate)` 的系统提示；当前视频 launch 还会在 session permission 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类偏航工具，并在当前 session registry 中直接移除这些 detour tools，避免模型在 `@视频` 首刀前先去搜索工具目录。后续默认 skill 继续优先走 `Bash -> lime media video generate --json`，CLI 不可用时再回退 `lime_create_video_generation_task` / `create_video_generation_task`，最终仍只允许落到标准 `video_generate` 任务主链。
- 前端消费层不再把 `@视频` 当成图片任务特判。当前聊天区通过统一 `taskPreview` 消费 `video_generate` 任务摘要，点击结果卡后直接复用现有 `VideoCanvas / VideoWorkspace` 打开右侧 viewer；运行中的视频任务则由 `useWorkspaceVideoTaskPreviewRuntime` 基于 `videoGenerationApi.getTask(...)` 轮询回流状态与结果 URL。

`Claw` 的纯文本播报命令也应沿同一条 current 主链收敛：

- Agent 驱动的播报命令：`@播报` / `@播客` / `@broadcast` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `broadcast_task` 写入 `request_metadata.harness.broadcast_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/broadcast_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(broadcast_generate)` 的系统提示；当前播报 launch 还会在 session permission 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类偏航工具，并在当前 session registry 中直接移除这些 detour tools，避免模型在 `@播报` 首刀前先去搜索工具目录。后续默认 skill 继续优先走 `Bash -> lime task create broadcast --json`，CLI 不可用时再回退 `lime_create_broadcast_generation_task`，最终仍只允许落到标准 `broadcast_generate` task file；若当前上下文缺少待整理原文，允许 Agent 最多追问 1 个关键问题，但不能伪造“播报已完成”。

`Claw` 的纯文本素材命令也应沿同一条 current 主链收敛：

- Agent 驱动的素材命令：`@素材` / `@资源` / `@resource` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `resource_search_task` 写入 `request_metadata.harness.resource_search_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/resource_search_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(modal_resource_search)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类 detour tools，避免模型卡在“先搜技能/工具目录”而不是立刻进素材技能主链。若 `resource_type=image` 且 query 明确，默认 skill 必须优先调用 `lime_search_web_images`，直接复用现有“设置 -> 系统 -> 网络搜索 -> Pexels API Key”返回候选，并保留真实 tool timeline；只有 `Pexels API Key` 未配置、无结果，或用户明确要求继续异步追踪时，才回退 `Bash -> lime task create resource-search --json`。对 `bgm / sfx / video` 等非图片素材，仍优先走 `Bash -> lime task create resource-search --json`，CLI 不可用时再回退 `lime_create_modal_resource_search_task`，最终落到标准 `modal_resource_search` task file；若当前上下文缺少明确资源类型或检索关键词，允许 Agent 最多追问 1 个关键问题，但不能伪造“素材已检索完成”。

`Claw` 的纯文本搜索命令也应沿同一条 current 主链收敛：

- Agent 驱动的搜索命令：`@搜索` / `@search` / `@research` / `@调研` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `research_request` 写入 `request_metadata.harness.research_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/research_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(research)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / Read / Glob / Grep` 这类“工具目录发现/本地文件偏航”工具，避免模型在 `@搜索` 首刀前先去查工具名或误读本地文件，但会保留真实联网检索主链。后续默认 skill 必须沿 `research` prompt skill -> `search_query` / `WebSearch` 主链先真实联网检索，再输出结论、来源与建议；当前上下文缺少明确搜索主题时，允许 Agent 最多追问 1 个关键问题，但不能伪造“已完成搜索”，也不能直接凭记忆跳过检索。

`Claw` 的纯文本深搜命令也应沿同一条 current 主链收敛：

- Agent 驱动的深搜命令：`@深搜` / `@deep` / `@deepsearch` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `deep_search_request` 写入 `request_metadata.harness.deep_search_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/deep_search_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(research)`、且至少执行多轮扩搜的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / Read / Glob / Grep` 这类“工具目录发现/本地文件偏航”工具，避免模型在 `@深搜` 首刀前先去查工具名或误读本地文件，但会保留真实联网检索主链。后续默认 skill 仍必须沿 `research` prompt skill -> `search_query` / `WebSearch` 主链先真实联网检索，再输出事实、推断与待确认项；当前上下文缺少明确搜索主题时，允许 Agent 最多追问 1 个关键问题，但不能伪造“已完成深搜”，也不能退化成只搜一次的普通搜索。

`Claw` 的纯文本研报命令也应沿同一条 current 主链收敛：

- Agent 驱动的研报命令：`@研报` / `@report` / `@research_report` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `report_request` 写入 `request_metadata.harness.report_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/report_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(report_generate)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / Read / Glob / Grep` 这类“工具目录发现/本地文件偏航”工具，避免模型在 `@研报` 首刀前先去查工具名或误读本地文件，但会保留真实联网检索主链。后续默认 skill 必须沿 `report_generate` prompt skill -> `search_query` / `WebSearch` 主链先真实联网检索，再写出结构化研究报告；当前上下文缺少明确研报主题时，允许 Agent 最多追问 1 个关键问题，但不能伪造“研报已完成”，也不能直接退回普通聊天长文。

`Claw` 的纯文本竞品命令也应沿同一条 current 主链收敛：

- Agent 驱动的竞品命令：`@竞品` / `@competitor` / `@competitive` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `report_request` 写入 `request_metadata.harness.report_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧仍复用 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/report_skill_launch.rs`，强约束首刀优先调用 `Skill(report_generate)`，并继续压制 `ToolSearch / Read / Glob / Grep` 这类本地偏航工具，保留真实联网检索主链。与 `@研报` 的差异只在用户侧语义层：`@竞品` 会默认补齐竞品分析的 `focus` 与 `output_format`，并将 `entry_source` 写为 `at_competitor_command`；它不是新的协议，也不能绕开 `report_generate -> search_query / WebSearch` 主链直接凭记忆生成所谓“竞品结论”。

`Claw` 的纯文本站点搜索命令也应沿同一条 current 主链收敛：

- Agent 驱动的站点搜索命令：`@站点搜索` / `@站点` / `@site_search` / `@site` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `site_search_request` 写入 `request_metadata.harness.site_search_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/site_search_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(site_search)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类通用搜索/本地文件偏航工具，同时拦住 `mcp__lime-browser__* / browser_* / mcp__playwright__*` 这类底层浏览器兼容面，避免模型在 `@站点搜索` 首刀前先去搜工具目录或退回浏览器底层执行。后续默认 skill 必须沿 `site_search` prompt skill -> `lime_site_info / lime_site_run / lime_site_search` 主链先执行真实站点适配器，再输出摘要与来源；当前上下文缺少明确站点或检索关键词时，允许 Agent 最多追问 1 个关键问题，但不能伪造“已完成站点搜索”，也不能先退回 `research / WebSearch`。

`Claw` 的纯文本读 PDF 命令也应沿同一条 current 主链收敛：

- Agent 驱动的读 PDF 命令：`@读PDF` / `@pdf` / `@read_pdf` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `pdf_read_request` 写入 `request_metadata.harness.pdf_read_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/pdf_read_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(pdf_read)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Grep` 这类工具目录发现、联网搜索或内容检索偏航工具，但会保留 `Read / Glob` 这类本地 PDF 读取主链能力。后续默认 skill 必须沿 `pdf_read` prompt skill -> `list_directory / read_file` 主链先真实读取本地或工作区 PDF，再输出结构化解读结果；当前上下文只有远程 PDF URL 或缺少明确 PDF 来源时，允许 Agent 最多追问 1 个关键问题请求本地路径或导入路径，但不能伪造“PDF 已读完”，也不能退回普通聊天总结。

`Claw` 的纯文本总结命令也应沿同一条 current 主链收敛：

- Agent 驱动的总结命令：`@总结` / `@summary` / `@summarize` / `@摘要` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `summary_request` 写入 `request_metadata.harness.summary_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/summary_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(summary)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Grep` 这类工具目录发现、联网检索或内容检索 detour tools，但会保留 `Read / Glob` 这类显式路径读取主链能力。后续默认 skill 必须沿 `summary` prompt skill 主链先总结显式正文或当前对话相关上下文；只有当用户显式给出本地路径或目录时，才允许最小化使用 `list_directory / read_file` 读取必要内容并保留真实 tool timeline。当前上下文缺少显式正文时，允许 Agent 优先总结当前对话；只有在显式正文和对话上下文都不足时，才最多追问 1 个关键问题，但不能伪造“已完成总结”，也不能在前端直接生成摘要绕过 skill。

`Claw` 的纯文本翻译命令也应沿同一条 current 主链收敛：

- Agent 驱动的翻译命令：`@翻译` / `@translate` / `@translation` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `translation_request` 写入 `request_metadata.harness.translation_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/translation_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(translation)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Grep` 这类工具目录发现、联网检索或内容检索 detour tools，但会保留 `Read / Glob` 这类显式路径读取主链能力。后续默认 skill 必须沿 `translation` prompt skill 主链先翻译显式正文或当前对话相关上下文；只有当用户显式给出本地路径或目录时，才允许最小化使用 `list_directory / read_file` 读取必要内容并保留真实 tool timeline。当前上下文缺少显式正文时，允许 Agent 优先翻译当前对话；只有在显式正文和对话上下文都不足时，才最多追问 1 个关键问题，但不能伪造“已完成翻译”，也不能在前端直接生成译文绕过 skill。

`Claw` 的纯文本分析命令也应沿同一条 current 主链收敛：

- Agent 驱动的分析命令：`@分析` / `@analysis` / `@analyze` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `analysis_request` 写入 `request_metadata.harness.analysis_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/analysis_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(analysis)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Grep` 这类工具目录发现、联网检索或内容检索 detour tools，但会保留 `Read / Glob` 这类显式路径读取主链能力。后续默认 skill 必须沿 `analysis` prompt skill 主链先分析显式正文或当前对话相关上下文；只有当用户显式给出本地路径或目录时，才允许最小化使用 `list_directory / read_file` 读取必要内容并保留真实 tool timeline。当前上下文缺少显式正文时，允许 Agent 优先分析当前对话；只有在显式正文和对话上下文都不足时，才最多追问 1 个关键问题，但不能伪造“已完成分析”，也不能在前端直接生成分析结论绕过 skill。

`Claw` 的纯文本发布合规命令也应沿同一条分析主链收敛：

- Agent 驱动的发布合规命令：`@发布合规` / `@合规` / `@compliance` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会继续把结构化 `analysis_request` 写入 `request_metadata.harness.analysis_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。与 `@分析` 的区别只在用户侧语义层：`@发布合规` 会默认补齐 `focus=广告法、版权、平台发布风险`、`style=合规审校`、`output_format=风险等级、风险点、修改建议、待确认项`，并把 `entry_source` 写为 `at_publish_compliance_command`；它不是新的协议，也不能绕开 `analysis` 主链直接在前端拼一段所谓“合规结论”。

`Claw` 的纯文本转写命令也应沿同一条 current 主链收敛：

- Agent 驱动的转写命令：`@转写` / `@transcribe` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `transcription_task` 写入 `request_metadata.harness.transcription_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/transcription_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(transcription_generate)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类 detour tools，避免模型在 `@转写` 首刀前先去搜工具目录、联网检索或误读本地文件。后续默认 skill 继续优先走 `Bash -> lime task create transcription --json`，CLI 不可用时再回退 `lime_create_transcription_task`，最终仍只允许落到标准 `transcription_generate` task file；若当前上下文缺少 `source_url` / `source_path`，允许 Agent 最多追问 1 个关键问题，但不能伪造“已完成转写”。

`Claw` 的纯文本链接解析/网页抓取命令也应沿同一条 current 主链收敛：

- Agent 驱动的链接解析/抓取/网页读取命令：`@链接解析` / `@链接` / `@url_parse` / `@抓取` / `@网页读取` / `@web_scrape` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `url_parse_task` 写入 `request_metadata.harness.url_parse_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/url_parse_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(url_parse)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类 detour tools，避免模型在 `@链接解析` / `@抓取` / `@网页读取` 首刀前先去搜工具目录、联网检索或误读本地文件。后续默认 skill 继续优先走 `Bash -> lime task create url-parse --json`，CLI 不可用时再回退 `lime_create_url_parse_task`，最终仍只允许落到标准 `url_parse` task file；其中 `@抓取` 只是用户侧更偏正文抓取的入口，默认 `extract_goal = full_text`；`@网页读取` 是用户侧更偏阅读总结的入口，默认 `extract_goal = summary`；它们都不是新的 task 协议。若当前上下文缺少 URL，允许 Agent 最多追问 1 个关键问题，但不能伪造“链接已解析完成”“网页已抓取完成”或“网页已读取完成”。

`Claw` 的纯文本排版命令也应沿同一条 current 主链收敛：

- Agent 驱动的排版命令：`@排版` / `@typesetting` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `typesetting_task` 写入 `request_metadata.harness.typesetting_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/typesetting_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(typesetting)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类 detour tools，避免模型在 `@排版` 首刀前先去搜工具目录、联网检索或误读本地文件。后续默认 skill 继续优先走 `Bash -> lime task create typesetting --json`，CLI 不可用时再回退 `lime_create_typesetting_task`，最终仍只允许落到标准 `typesetting` task file；若当前上下文缺少待排版正文，允许 Agent 最多追问 1 个关键问题，但不能伪造“排版已完成”。

`Claw` 的纯文本网页命令也应沿同一条 current 主链收敛：

- Agent 驱动的网页命令：`@网页` / `@webpage` / `@landing` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `webpage_request` 写入 `request_metadata.harness.webpage_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/webpage_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(webpage_generate)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类 detour tools，避免模型在 `@网页` 首刀前先去搜工具目录、联网检索或误读本地文件。后续默认 skill 必须沿 `webpage_generate` prompt skill 主链直接产出单文件 HTML artifact，并通过 `<write_file>` 落到工作区；当前上下文缺少明确网页目标时，允许 Agent 最多追问 1 个关键问题，但不能只给口头方案、不能伪造“网页已生成”却没有真实 `.html` 文件。

`Claw` 的纯文本 PPT 命令也应沿同一条 current 主链收敛：

- Agent 驱动的演示稿命令：`@PPT` / `@ppt` / `@slides` / `@演示` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `presentation_request` 写入 `request_metadata.harness.presentation_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/presentation_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(presentation_generate)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类 detour tools，避免模型在 `@PPT` 首刀前先去搜工具目录、联网检索或误读本地文件。后续默认 skill 必须沿 `presentation_generate` prompt skill 主链直接产出单文件 Markdown 演示稿 artifact，并通过 `<write_file>` 落到工作区；当前上下文缺少明确演示目标时，允许 Agent 最多追问 1 个关键问题，但不能只给口头提纲、不能伪造“PPT 已生成”却没有真实演示稿文件。

`Claw` 的纯文本表单命令也应沿同一条 current 主链收敛：

- Agent 驱动的表单命令：`@表单` / `@form` / `@survey` / `@问卷` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `form_request` 写入 `request_metadata.harness.form_skill_launch`，同时打开 `request_metadata.harness.allow_model_skills = true`。Rust 侧 `src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs` 与 `src-tauri/src/commands/aster_agent_cmd/form_skill_launch.rs` 会给当前 turn 注入只允许首刀优先调用 `Skill(form_generate)` 的系统提示，并在当前 session permission 与 registry 中显式压制 `ToolSearch / WebSearch / Read / Glob / Grep` 这类 detour tools，避免模型在 `@表单` 首刀前先去搜工具目录、联网检索或误读本地文件。后续默认 skill 必须沿 `form_generate` prompt skill 主链直接产出一份可被现有 A2UI parser 识别的 simple form JSON，并以 ` ```a2ui ` 代码块回到聊天流；current render contract 必须是 `form + json`，不能回退成单文件 HTML artifact，也不能再发明另一套表单 DSL。当前上下文缺少明确表单目标时，允许 Agent 最多追问 1 个关键问题，但不能只给口头字段建议、不能伪造“表单已生成”却没有真实 A2UI 表单结果。

`Claw` 的纯文本代码命令也应沿同一条 current 主链收敛：

- Agent 驱动的代码命令：`@代码` / `@code` / `@coding` / `@开发` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会把结构化 `code_command` 写入 `request_metadata.harness.code_command`，并把本次发送的 `execution_strategy` 强制切到 `code_orchestrated`，同时把 `request_metadata.harness.preferred_team_preset_id` 设为 `code-triage-team`，且把 `harness.preferences.task/subagent` 打开。当前主链不新增 prompt skill，也不新增 HTML / artifact 协议，而是直接复用现有 `code_orchestrated -> code_execution / tools / team runtime`。这意味着 `@代码` 首刀应优先进入真实代码工具与协作编排，而不是退回普通聊天、先做 `ToolSearch` 目录探索，或把代码任务伪装成一段口头建议；若当前上下文只够做解释或评审，允许 Agent 在同一主链中按 `code_command.kind` 调整策略，但不能绕回另一套命令体系。

`Claw` 的纯文本发布命令当前应收敛到现有发布工作流，而不是新开一条平行 runtime：

- 工作流入口型命令：`@发布` / `@publish` / `@发文` / `@投稿` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本展示，但把实际 dispatch 改写到现有 `/content_post_with_cover ...` 主链，并把结构化 `publish_command` 写入 `request_metadata.harness.publish_command`。当前实现优先复用已有 `content_post_with_cover` 发布工作流、`content-posts/*.md` / `*.publish-pack.json` 产物链，以及 `detectBrowserTaskRequirement(...)` 推导出的浏览器门禁，而不是再发明新的 `publish_task` 协议。若输入里已明确平台后台，如微信公众号后台，必须继续写入 `browser_requirement=required_with_user_step` 与平台 launch URL；若只是整理发布稿而未指定平台，则允许先在同一工作流里生成发布稿与发布前检查，不强行要求浏览器。后续若统一 agent/workflow runtime 成熟，可以把 `@发布` 从当前 slash workflow 迁走，但在那之前不得同时维护第二套发布入口真相。

`Claw` 的纯文本渠道预览命令应复用同一条发布工作流主链：

- 工作流入口型命令：`@渠道预览` / `@预览` / `@preview` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本展示，但把实际 dispatch 改写到现有 `/content_post_with_cover ...` 主链，并继续把结构化信息写入 `request_metadata.harness.publish_command`。与 `@发布` 的区别只在语义层：`@渠道预览` 会额外写入 `publish_command.intent=preview`，同时在 dispatch body 中明确要求生成“渠道预览稿”，重点突出标题、首屏摘要、排版层级和封面建议，而不是直接走浏览器后台发布动作。当前实现不新建 `channel_preview_task` 协议、不新建 viewer，也不要求真实浏览器门禁；后续若要做平台级 UI 仿真，也必须继续在现有内容交付主链上演进，而不是重新分叉。

`Claw` 的纯文本上传命令也应复用同一条发布工作流主链：

- 工作流入口型命令：`@上传` / `@upload` / `@上架` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本展示，但把实际 dispatch 改写到现有 `/content_post_with_cover ...` 主链，并继续把结构化信息写入 `request_metadata.harness.publish_command`。与 `@渠道预览`、`@发布` 的区别在于语义层：`@上传` 会额外写入 `publish_command.intent=upload`，同时在 dispatch body 中明确要求生成“上传稿与素材清单”，重点突出标题、正文、封面说明、标签建议和上传前检查。若输入里已明确平台后台，如微信公众号后台，必须继续写入 `browser_requirement=required_with_user_step` 与平台 launch URL；若只是整理上传稿而未指定后台，则允许先在同一工作流里生成上传包，不强行要求浏览器。当前实现不新建 `upload_task` 协议，也不新建 viewer。

同时要明确，`publish_command` 不能只停留在发送态 metadata。当前 slash skill 执行层必须继续透传这份 request metadata，把 `preview / upload / publish` 语义写进 `content-posts/*.md` 产物 meta，并由聊天区产物卡片与右侧工作台优先显示“渠道预览稿 / 上传稿 / 发布稿”这类用户语义标题；否则一旦进入 artifact 恢复或历史回访，三类结果又会重新混成同一种普通文稿。会话文件恢复链也必须保留嵌套相对路径与这份产物 metadata，不能只把 `content-posts/...` 当普通文件名恢复，否则右侧工作台仍会退回成普通文稿标题。

`Claw` 的纯文本配音命令也应沿同一条服务型技能主链收敛：

- Agent 驱动的配音命令：`@配音` / `@voice` / `@dubbing` / `@dub` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界会优先从当前 `serviceSkills` / seeded fallback 中解析配音能力（当前兜底为 `cloud-video-dubbing`），并把结构化 `service_scene_launch` 写入 `request_metadata.harness.service_scene_launch`，其中固定 `scene_key=voice_runtime`、`entry_source=at_voice_command`，同时注入 OEM `scene_base_url / tenant_id / session_token` 运行时上下文。Rust 侧 `runtime_turn.rs`、`prompt_context.rs` 与 `tool_runtime/service_skill_tools.rs` 会把当前 turn 切到 `workbench`，并强约束首刀优先调用 `lime_run_service_skill`，由 OEM scene runtime 负责 run / poll。当前上下文缺少明确配音要求时，允许 Agent 最多追问 1 个关键问题；但不能退回普通聊天解释、不能伪造“配音已完成”，也不能重新回流到旧的本地 TTS 测试命令。

`Claw` 的纯文本浏览器命令也应沿同一条真实浏览器工具主链收敛：

- Agent 驱动的浏览器命令：`@浏览器` / `@browser` / `@browse` 在 `src/components/agent/chat/workspace/useWorkspaceSendActions.ts` 中保留原始用户文本发送。聊天发送边界不会再改写成另一套 skill 或 scene，而是显式把 `browser_requirement`、`browser_requirement_reason` 与 `browser_launch_url` 写入 `request_metadata.harness`，同时关闭前端本轮 `webSearch` 偏好，确保后续请求优先走 Lime Browser Assist 与 `mcp__lime-browser__*` 工具，而不是退回 WebSearch 或普通聊天。若正文里出现平台后台、登录、扫码等受保护网页步骤，则继续沿用 `required_with_user_step`；否则默认要求 `required`，并把显式 URL 或搜索入口写入 launch URL。当前命令不应伪装成站点型 `service_skill_launch`，也不应重新造一套 browser task 协议。

这些命令除了 Tauri `generate_handler!` 之外，也必须继续保持 DevBridge dispatcher 已桥接，避免浏览器模式、headless smoke 或 Playwright 续测时回退成 unknown command。

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

对于 `agent_runtime_*` 这一组运行时主命令，当前还额外有一份结构合同事实源：

- `src/lib/governance/agentRuntimeCommandSchema.json`

它负责定义 domain、lifecycle、mock 策略与文档归属，再由 `scripts/generate-agent-runtime-clients.mjs` 生成前端命令 manifest，并在 `npm run test:contracts` 中通过 `--check` 口径校验 schema、治理目录与生成产物没有漂移。

当前前端 runtime client 目录也已经固定为：

- `current`：`src/lib/api/agentRuntime/types.ts`、`src/lib/api/agentRuntime/index.ts` 与各分域 client
- `compat`：`src/lib/api/agentRuntime.ts`

固定约束：

- `src/lib/api/agentRuntime/**/*.ts` 内部类型依赖只允许从 `./types` 读取，不要再回绕 `../agentRuntime`
- 外部业务模块继续从 `@/lib/api/agentRuntime` 进入 compat barrel，不要直接跳进分域 client
- `commandManifest.generated.ts` 只由生成器产出，不手工改命令名字符串
- 新的 `agent_runtime_*` 命令如需落前端主链，优先补 schema / generator / 分域 client，而不是先往 compat 根文件里堆实现

## MCP 工具命名主链

MCP bridge 当前唯一继续演进的工具命名事实源是：

- 工具全名：`mcp__<server>__<tool>`
- extension surface key：`mcp__<server>`
- UI 展示名：继续优先显示 server 原名，例如 `lime-browser`
- deferred 工具需要通过 `ToolSearch` 拉起时，优先使用精确 `select:mcp__<server>__<tool>`；如 `select:mcp__playwright__browser_click`
- `ToolSearch` 空结果后不要继续改写成 `playwright_browser_click`、`read_file`、`system` 之类同义词重试；原生工具直接调用当前可见的 `Read / Write / Edit / Glob / Grep / Bash / WebFetch / WebSearch`

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
- **Team runtime 工具主链**：当前协作工具面继续收敛到 `Agent / TeamCreate / TeamDelete / SendMessage / ListPeers`；不要把已删除的 `SubAgentTask` compat 工具重新接回新的多代理主路径
- **用户可见消息工具主链**：继续收敛到 `SendUserMessage`，用于把回复、进度同步、主动提醒和附件送到用户主可见消息面；不要再把这类能力拆到其它平行工具名或旁路协议里
- **会话状态回写主链**：继续收敛到 `agent_runtime_update_session`，用于名称、执行策略、session provider/model、`recent_access_mode`、`recent_preferences` 以及 `recent_team_selection` 的轻量持久化回写
- **会话权限主链**：`agent_runtime_submit_turn.turn_config.approval_policy / sandbox_policy` 是正式 turn context 权限协议；`getSession` 返回的 `execution_runtime.recent_access_mode` 负责承接会话最近一次 accessMode。当前端已命中同一 steady-state 权限时，不应继续依赖 `harness.access_mode` 作为唯一事实源
- **运行时 Provider 能力快照主链**：`agent_runtime_submit_turn.turn_config.provider_config` 允许携带 `model_capabilities / tool_call_strategy / toolshim_model` 这组三个运行时字段；后端会在真正发起 turn 前刷新它们，尤其是 `ollama` 会根据当前模型真实能力在原生 tools 与 `tool_shim` 之间做最终决策。前端不得把模型目录里的静态 tools 标记当作唯一真相
- **运行时交接导出主链**：继续收敛到 `agent_runtime_export_handoff_bundle`；前端统一通过 `src/lib/api/agentRuntime.ts` 网关进入，当前 GUI 入口位于 `HarnessStatusPanel`
- **运行时证据导出主链**：继续收敛到 `agent_runtime_export_evidence_pack`，用于把 runtime / timeline / artifacts 打包成最小问题证据
- **运行时 replay 样本主链**：继续收敛到 `agent_runtime_export_replay_case`，复用 handoff bundle + evidence pack 生成 `input / expected / grader / evidence-links`
- **运行时外部分析交接主链**：继续收敛到 `agent_runtime_export_analysis_handoff`，复用 handoff bundle + evidence pack + replay case 生成 `analysis-brief.md / analysis-context.json / copy_prompt`，供外部诊断代理直接诊断与最小修复；当前 GUI 入口位于 `HarnessStatusPanel`
- **运行时人工审核记录主链**：继续收敛到 `agent_runtime_export_review_decision_template` + `agent_runtime_save_review_decision`；前者复用 `analysis handoff` 生成 `review-decision.md / review-decision.json` 模板，后者把开发者的接受 / 延后 / 拒绝与回归要求回写到同一份工作区制品；当前 GUI 入口位于 `HarnessStatusPanel`
- **会话主题上下文主链**：`getSession` 返回的 `execution_runtime.recent_theme / recent_session_mode` 负责承接最近一次运行态主题上下文；当前端已命中同一 steady-state theme/workbench mode 时，不应继续每回合重复携带 `harness.theme / harness.session_mode`
- **会话运行阶段上下文主链**：`getSession` 返回的 `execution_runtime.recent_gate_key / recent_run_title` 负责承接最近一次通用工作区运行阶段上下文；当前端已命中同一 steady-state gate/run 时，不应继续每回合重复携带 `harness.gate_key / harness.run_title`
- **会话内容上下文主链**：`getSession` 返回的 `execution_runtime.recent_content_id` 负责承接最近一次运行态 `content_id`；当前端已命中同一 steady-state 内容时，不应继续每回合重复携带 `harness.content_id`
- **运行态摘要主链**：Aster `runtime_status` item -> timeline `turn_summary`
- **上下文压缩策略主链**：`workspace.settings.auto_compact` 是运行时自动压缩的唯一 workspace 级开关；`agent_runtime_submit_turn` 与 `agent_runtime_respond_action` 都会把该设置注入 turn context。值为 `false` 时，Lime 不会做发起前自动压缩，并会显式告诉 Aster 关闭当前回合的内部自动压缩 / overflow recovery 自动压缩；此时只允许用户通过 `agent_runtime_compact_session` 手动压缩。
- **旧 `chat_*` 命令**：已停止注册，不应重新回到 `commands::mod` 或 `generate_handler!`
- **旧 `general_chat_*` 边界**：前端 compat 网关与 Rust 命令都已移除，不应重新接入
- **记忆系统**：统一沉淀优先走 `unified_memory_*`，runtime / 上下文视图优先走 `memory_runtime_*`
- **工作记忆主链**：会话级计划 / 发现 / 进度 / 错误文件继续收敛到 `memory_runtime_get_working_memory`；不要让页面、Hook 或运行时各自重新扫描 `.lime/memory`
- **记忆抽取状态主链**：记忆抽取与上下文压缩状态继续收敛到 `memory_runtime_get_extraction_status`；Memory 页面、诊断视图和后续 GUI 提示都不应各自拼凑“最近是否压缩过”
- **单回合记忆预取主链**：运行时 working / durable / compaction recall 继续收敛到 `memory_runtime_prefetch_for_turn`；不要把 working memory、统一记忆检索或压缩摘要再拆成第二套 prompt 拼装边界
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
- **站点技能首页入口主链**：`Claw` 首页、空态推荐和技能选择入口只负责选技能、在当前对话输入区上方挂起 A2UI 补参卡、组装 `initialUserPrompt + harness.service_skill_launch` 上下文并进入 `Claw`；真正执行统一收口到 `Claw` 首回合，不再由首页弹窗、工作区挂载副作用或前端直跑逻辑直接调用 `site_run_adapter`
- **站点结果沉淀主线**：`site_run_adapter` / `lime_site_run` 优先透传 `content_id` 写回当前主稿；只有缺少 `content_id` 时，才回退到 `project_id` 新建结果文档
- **`markdown_bundle` 落盘回传主线**：当站点结果是 `markdown_bundle` 时，`saved_content` 除了 `content_id / project_id / title`，还应继续回传 `project_root_path / markdown_relative_path / images_relative_dir / meta_relative_path / image_count`，让聊天轻卡与 tool timeline 都能直接说明 Markdown 和图片实际保存到哪里
- **`markdown_bundle` 消费主线**：当前端拿到 `saved_content.markdown_relative_path` 后，聊天轻卡、工具结果卡和站点工作台应优先导航到项目内真实 Markdown 文件，而不是继续打开一份运行摘要 artifact；后续 viewer 渲染相对图片时，也必须以该 Markdown 文件路径作为 base 解析本地资源
- **`markdown_bundle + target_language` 后处理主线**：如果站点技能请求参数显式带了 `target_language`，则 preload 成功后应进入统一“已保存 Markdown 后处理”阶段，由 Agent 使用 `Read / Write / Edit` 直接读取并覆写项目里的真实 Markdown 文件；翻译只作用于正文，代码块、内联代码、URL、相对图片路径、文件路径和 Markdown 结构必须保持原样，禁止再次回退到 `lime_site_run`、`webReader`、`WebFetch`、`WebSearch` 或新建第二份摘要 artifact
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
