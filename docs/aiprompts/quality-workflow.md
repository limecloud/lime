# Lime 工程质量工作流

## 这份文档回答什么

本文件定义 Lime 仓库的工程质量入口，主要回答四个问题：

- 不同改动，提交前默认该跑什么
- 为什么 Lime 作为 GUI 桌面产品，不能只看 `lint` / `typecheck` / 单测
- `verify:local`、`verify:gui-smoke`、`test:contracts`、Playwright E2E 分别覆盖什么风险
- `.github/workflows/quality.yml` 与本地校验如何保持一条主线

它是 **工程入口文档**，不是某个模块的实现设计文档。

## 什么时候先读

遇到以下任一情况时，先读本文件：

- 不确定本次改动最少该跑哪些校验
- 修改了 GUI 壳、DevBridge、Workspace、Tauri 命令、前端主路径
- 需要判断跑最小 smoke 还是交互型 E2E
- 需要理解 `quality.yml` 为什么触发某些 CI 任务

如果改动属于 `@` / 产品型 `/` / 轻卡 / viewer / `ServiceSkill` 场景主链，先补读：

- `docs/aiprompts/command-runtime.md`

## 交付定义

对 Lime 来说，“代码通过检查” 不等于 “产品可以交付”。

一次可交付的改动，至少要满足：

1. **静态与定向校验通过** - 对应范围的 lint、类型检查、单测、Rust 定向测试通过
2. **边界变更已同步** - 命令、桥接、配置、版本等结构性改动完成成组更新
3. **GUI 主路径可运行** - 涉及 GUI 壳、Bridge、Workspace、主页面路径时，最小冒烟通过
4. **用户可见回归已补齐** - 用户可见 UI 改动有稳定断言或既有 snapshot 回归
5. **文档与锁文件不掉队** - 相关文档、schema、锁文件与实际实现保持一致

## 路线图任务防跑偏

如果任务明确绑定路线图主线，质量校验除了回答“是否通过”，还必须回答“这次改动是否真的推进了路线图目标”。

执行时额外遵守：

1. 校验前先确认本轮改动对应路线图哪一项
2. 如果本轮改动只是清理 dead surface、补 README 或局部整理，但没有直接推进主链，不能把“校验通过”当作完成目标
3. 汇报时必须同时给出：
   - 本轮改动对应的路线图节点
   - 本轮校验覆盖了哪条主线风险
   - 当前距离该路线图阶段完成还差什么

## 执行硬规则

### 1. 不要继续扩展 compat / deprecated 路径

- 新 API、新 Tauri 命令、新前端入口默认落在当前 `current` 主路径
- 不要继续给 legacy / compat 网关长新表面
- 如果发现能力已经存在多条路径，先读 `docs/aiprompts/governance.md`

### 2. 协议改动必须同步四侧

涉及命令或桥接协议时，至少检查：

- 前端 `safeInvoke(...)` / `invoke(...)` 的实际调用
- Rust `tauri::generate_handler!` 的实际注册
- `src/lib/governance/agentCommandCatalog.json` 的治理口径
- `mockPriorityCommands` 与 `defaultMocks` 的同步状态

只改其中一侧，不算完成。

如果本轮是在下线共享网关控制面，`start_server`、`stop_server`、`get_server_status`、`get_available_routes`、`get_route_curl_examples`、`test_api`、`get_network_info`，以及托盘残留 `sync_tray_state`、`update_tray_server_status`、`update_tray_credential_status`、`get_tray_state`、`refresh_tray_menu`、`refresh_tray_with_stats` 必须同步从前端网关、Rust 注册、DevBridge 和 mock 中撤掉；server 兼容面 `/v1/routes`、`/{selector}/v1/messages`、`/{selector}/v1/chat/completions` 也必须同步从 server 路由表与 services/core 模型中撤掉；开发者诊断只保留 `get_server_diagnostics`，托盘只保留 `sync_tray_model_shortcuts`，server 只保留标准 `/v1/messages` 与 `/v1/chat/completions`。

如果本轮是在下线项目默认风格旧链路，`style_guide_get` / `style_guide_update` 与 `ProjectMemory.style_guide` 也必须同步从前端 API、Rust 注册、数据库 schema、默认 mock 和 GUI 入口中撤掉。

如果本轮是在下线项目模板或品牌人设扩展旧链路，`create_template` / `list_templates` / `get_template` / `update_template` / `delete_template` / `set_default_template` / `get_default_template`，以及 `get_brand_persona` / `get_brand_extension` / `save_brand_extension` / `update_brand_extension` / `delete_brand_extension` / `list_brand_persona_templates` 也必须同步从前端 API、Rust 注册、services/core 模型、默认 mock 和 GUI 入口中撤掉。

如果本轮是在清退旧图库素材命名，`create_poster_metadata` / `get_poster_metadata` / `get_poster_material` / `update_poster_metadata` / `delete_poster_metadata` / `list_by_*`，以及 `PosterMaterial*` / `poster_material_*` 表名与模块名也必须同步从前端网关、Rust 注册、DAO 与治理目录册中撤掉；如需保留历史数据，只允许在 schema 迁移中短暂停留旧表名。最低校验至少包含 `npm run test:contracts` 与 `npm run governance:legacy-report`。

如果本轮是在清退旧设置页的“安全与性能 / 容错配置”命令面，`get_retry_config`、`update_retry_config`、`get_failover_config`、`update_failover_config`、`get_switch_log`、`clear_switch_log`、`get_rate_limit_config`、`update_rate_limit_config`、`get_conversation_config`、`update_conversation_config`、`update_hint_routes`、`get_pairing_config`、`update_pairing_config` 也必须同步从前端网关、Rust 注册和默认 mock 中撤掉；若当前输入框提示仍依赖 `get_hint_routes`，则只保留该只读读取面。最低校验至少包含 `npm run test:contracts` 与 `npm run governance:legacy-report`。

如果本轮是在清退旧 onboarding 插件安装流或 Provider Switch 命令面，`get_switch_providers`、`get_current_switch_provider`、`add_switch_provider`、`update_switch_provider`、`delete_switch_provider`、`switch_provider`、`import_default_config`、`read_live_provider_settings`、`check_config_sync_status`、`sync_from_external_config` 也必须同步从前端常量、Rust 注册、services、默认 mock 与 GUI 入口中撤掉；当前 onboarding 只允许保留语音体验链，不再保留 `config-switch` 推荐安装面。最低校验至少包含 `npm run test:contracts` 与 `npm run governance:legacy-report`。

如果本轮涉及 `companion_*` 桌宠命令族，还要同步检查本地 companion `WebSocket` 入口、前端 `src/lib/api/companion.ts` 网关、Rust 注册、治理目录册以及浏览器模式 mock 返回形态；浏览器模式下这组命令默认也要保持可 mock，不要让桌宠接入把默认页面渲染链路卡死。

如果本轮涉及 team runtime 工具面或主线程用户消息工具，还要同步检查 Rust catalog / inventory、runtime 注册、浏览器 fallback mock 与前端 tool display；`Agent / TeamCreate / TeamDelete / SendMessage / ListPeers` 必须保持同一组 current surface，`SendUserMessage` 也必须继续停留在 current 主线程工具面，不要把已删除的 `SubAgentTask` compat 工具重新接回 Rust catalog、runtime 注册、mock 或前端 tool display。

如果本轮涉及 MCP bridge runtime tool surface、inventory 或 ToolSearch，还要同步检查 Rust extension 注入、inventory 快照、浏览器 fallback mock 与 GUI 面板命名；当前唯一命名事实源是 `mcp__<server>__<tool>`，对应 extension surface key 为 `mcp__<server>`，不要让 mock 或 UI 退回裸 `server__tool`。同时，Lime runtime 里的 `ToolSearch` 当前事实源必须是 `ToolSearchBridgeTool`；`aster-rust` 自带 `ToolSearchTool` 只能停留在 compat 存量，不允许再抢占当前 runtime surface。
如果本轮还需要对子工作区单独跑 Rust 定向测试，例如 `src-tauri/crates/aster-rust`，必须确认产物仍落在统一的 `src-tauri/target`，不要重新写回子目录自己的 `target/`；否则 `tauri dev` 会把构建产物当成源码变化，反复触发重编译。

如果本轮涉及 `create_skill_scaffold_for_app`、`SkillsPage / SkillScaffoldDialog`，或“聊天结果 -> Skill 脚手架”沉淀闭环，还要同步检查前端网关、Rust 模板、DevBridge 分发与默认 mock 是否仍保持同一条主链；若新增了结构化骨架字段，至少要确认 `何时使用 / 输入 / 执行步骤 / 输出 / 失败回退` 能真实落进生成后的 `SKILL.md`。

如果本轮涉及记忆主链，还要同步检查 `src/lib/api/memoryRuntime.ts`、`src-tauri/src/commands/memory_management_cmd.rs`、`runner.rs`、DevBridge dispatcher 与默认 mock 是否仍保持同一条 current surface；`rules / working / durable / team / compaction` 的产品分层可以在页面上拆开，但底层命令边界仍必须继续收敛到 `memory_runtime_*` 与 `unified_memory_*`。

### 3. 用户可见 UI 改动必须补稳定回归

- 优先补现有 `*.test.tsx` 的关键文案、状态与交互断言
- 如果目标区域已有 snapshot / 结构化快照机制，沿用现有机制
- 不要因为“只是 UI”就跳过回归
- 如果改动涉及 Provider 类型切换、Prompt Cache 提示或模型/协议能力认知，至少补到“列表扫描态、详情头部、创建/编辑入口、聊天发送前或结果解释”中的实际受影响落点，避免同一语义只在单点出现

### 4. 配置与依赖改动必须成组提交

- 改配置结构时，要同步更新 schema、校验器、消费者与文档
- 改版本结构时，要执行 `npm run verify:app-version`
- 改依赖时，要同步提交对应锁文件，如 `package-lock.json`、`src-tauri/Cargo.lock`
- 本仓库没有 Bazel，不适用 Bazel lockfile 规则

### 5. Rust 校验先小后大

- 默认先跑受影响 crate、模块或定向测试
- 再根据边界扩散决定是否执行全量 `cargo test`
- 目标是尽快暴露问题，而不是一上来把所有测试都跑满
- 如果定向测试来自 `src-tauri/crates/aster-rust` 这类被 Tauri watch 覆盖的子工作区，先确认其 Cargo `target-dir` 已统一回 `src-tauri/target`，避免 watch 风暴导致 dev 无法启动

## 质量分层

### Layer 0：快速提醒

入口：

- `.husky/pre-commit`
- `npm run ai-verify`

作用：

- 做提交前的快速卫生检查
- 暴露明显问题与风险

边界：

- **不替代** 编译、测试、契约检查、GUI smoke

### Layer 1：本地统一入口

入口：

```bash
npm run verify:local
npm run verify:local:full
```

作用：

- 根据改动范围自动选择前端、Rust、Bridge、GUI smoke 等检查
- 让开发者在发起 PR 前有一个统一入口

适用建议：

- 普通功能改动：默认执行 `npm run verify:local`
- 跨前后端、大范围重构、发布前自检：执行 `npm run verify:local:full`

### Layer 2：GUI 最小冒烟

入口：

```bash
npm run verify:gui-smoke
```

作用：

- 启动或复用 `headless Tauri`
- 等待 `DevBridge` 健康检查通过
- 验证默认 workspace 的准备态可用
- 验证 `browser runtime` 的启动、状态读取与审计主链可用
- 其中 `browser runtime smoke` 默认以无界面浏览器会话执行，避免额外弹出仅用于校验的空白 Chrome
- 验证 `site adapter catalog` 的状态、列表与推荐主链可读

它解决的是 GUI 产品特有风险：

- 前端壳能不能真正起来
- `DevBridge` 是否就绪
- 默认 workspace / 本地工作目录能力是否可用

这类问题 **单靠** `lint`、`typecheck`、`vitest` 无法覆盖。

### Layer 3：契约与桥接边界

入口：

```bash
npm run test:contracts
npm run test:bridge
npm run bridge:health -- --timeout-ms 120000
```

如果本轮改动落在 harness cleanup / dashboard 推荐动作契约，还应补：

```bash
npm run harness:cleanup-report:check
```

这条校验已经进入 `npm run test:contracts` 默认门禁；如果你要点检某个指定产物，再显式执行：

```bash
node scripts/check-generated-slop-report.mjs --input "<cleanup-json>"
```

同时，`scripts/report-generated-slop.mjs`、`scripts/check-generated-slop-report.mjs`、`scripts/harness-eval-history-record.mjs`、`scripts/harness-eval-trend-report.mjs`、`scripts/lib/generated-slop-report-core.mjs`、`scripts/lib/harness-dashboard-core.mjs` 这条 harness cleanup/report 主链，在 `verify:local` 的 smart 模式里默认也按 bridge/contracts 风险处理。
本地 `verify:local` 输出里如果看到 `bridge 校验（harness cleanup contract）`，说明命中的就是这条 cleanup/report 契约门禁，而不是普通 DevBridge 变更。
CI 里的 `.github/workflows/quality.yml` 结果摘要现在也会透出 `bridge_reasons`，并写入 `GITHUB_STEP_SUMMARY`，用于区分这次是 `harness_cleanup_contract`、`bridge_runtime`，还是 `workflow_full_suite` / `fallback_full_suite` 这类全量触发。
结果摘要默认按 `Scope / Required Gates / Notes / Recommended Next Action / Failure` 分段，优先让人一眼看清“为什么触发”“哪些门禁必跑”“最终为什么失败”，以及失败后本地最应该先跑哪条命令。
如果命中的是 `harness_cleanup_contract`，推荐动作应优先指向 `npm run harness:cleanup-report:check`，而不是只给一条泛化的 bridge 校验建议。

作用：

- 检查前端命令调用与 Rust 注册表是否一致
- 检查 harness metadata / execution runtime / 后端 request metadata 的关键字段是否漂移
- 检查浏览器桥接 / mock 优先路径是否同步
- 检查 `DevBridge` 是否可用
- 检查纯文本 `Claw @配图` 是否已经走 `原始用户消息 -> harness.image_skill_launch -> Agent 首刀 Skill(image_generate) -> Bash/lime media image generate --json 或 lime_create_image_generation_task -> task/timeline` 主链，以及显式图片动作是否也已经走 `synthetic user message / displayContent -> harness.image_skill_launch -> Agent 首刀 Skill(image_generate) -> task/timeline`，而不是回流前端直连图片服务、卡在 `ToolSearch / WebSearch / Read / Glob / Grep`，或让 `lime media image generate --json` / `lime task create image --json` 只停在 `pending_submit`
- 检查纯文本 `Claw @封面` 是否已经走 `原始用户消息 -> harness.cover_skill_launch -> Agent 首刀 Skill(cover_generate) -> task file` 主链，而不是回流成普通图片命令、卡在 `ToolSearch / WebSearch / Read / Glob / Grep`，或前端本地伪造结果
- 检查纯文本 `Claw @海报` 是否已经走 `原始用户消息 -> harness.image_skill_launch -> Agent 首刀 Skill(image_generate) -> Bash/lime media image generate --json 或 lime_create_image_generation_task -> task/timeline` 主链，而不是回流成普通聊天或另一套海报协议、卡在 `ToolSearch / WebSearch / Read / Glob / Grep`，或前端本地伪造结果；同时确认默认 `entry_source=at_poster_command`、默认尺寸 `4:5 -> 864x1152` 与“海报设计”语义补齐仍然成立
- 检查纯文本 `Claw @视频` 是否已经走 `原始用户消息 -> harness.video_skill_launch -> Agent 首刀 Skill(video_generate) -> Bash/lime media video generate --json 或 create_video_generation_task -> task/timeline` 主链，而不是卡在 `ToolSearch / WebSearch / Read / Glob / Grep`，或前端本地伪造结果
- 检查纯文本 `Claw @播报` 是否已经走 `原始用户消息 -> harness.broadcast_skill_launch -> Agent 首刀 Skill(broadcast_generate) -> task file` 主链，而不是退回普通聊天改写、卡在 `ToolSearch / WebSearch / Read / Glob / Grep`，或前端本地伪造结果
- 检查纯文本 `Claw @素材` 是否已经走 `原始用户消息 -> harness.resource_search_skill_launch -> Agent 首刀 Skill(modal_resource_search) -> 图片直搜时优先 lime_search_web_images / 其余情况走 task file` 主链，而不是回流到前端本地素材页逻辑、卡在 `ToolSearch / WebSearch / Read / Glob / Grep`，或把 session permission 拒绝直接暴露给用户
- 检查纯文本 `Claw @搜索` 是否已经走 `原始用户消息 -> harness.research_skill_launch -> Agent 首刀 Skill(research) -> search_query / tool timeline` 主链，而不是直接凭模型记忆回答、卡在 `ToolSearch / Read / Glob / Grep` 这类工具目录/本地文件偏航，或把 session permission 拒绝直接暴露给用户
- 检查纯文本 `Claw @深搜` 是否已经走 `原始用户消息 -> harness.deep_search_skill_launch -> Agent 首刀 Skill(research) -> 多轮 search_query / tool timeline` 主链，而不是退化成一次普通搜索、卡在 `ToolSearch / Read / Glob / Grep` 这类工具目录/本地文件偏航，或把 session permission 拒绝直接暴露给用户
- 检查纯文本 `Claw @研报` 是否已经走 `原始用户消息 -> harness.report_skill_launch -> Agent 首刀 Skill(report_generate) -> search_query / tool timeline` 主链，而不是直接退回普通聊天长文、卡在 `ToolSearch / Read / Glob / Grep` 这类工具目录/本地文件偏航，或把 session permission 拒绝直接暴露给用户
- 检查纯文本 `Claw @竞品` 是否已经走 `原始用户消息 -> harness.report_skill_launch -> Agent 首刀 Skill(report_generate) -> search_query / tool timeline` 主链，而不是退回普通聊天口头对比、卡在 `ToolSearch / Read / Glob / Grep` 这类工具目录/本地文件偏航，或把 session permission 拒绝直接暴露给用户；同时确认默认 `focus` / `output_format` 已按竞品分析语义补齐
- 检查纯文本 `Claw @站点搜索` 是否已经走 `原始用户消息 -> harness.site_search_skill_launch -> Agent 首刀 Skill(site_search) -> lime_site_* / tool timeline` 主链，而不是先退回 `research / WebSearch`、卡在 `ToolSearch / WebSearch / Read / Glob / Grep` 这类通用搜索/本地文件偏航，或把浏览器兼容工具权限拒绝直接暴露给用户
- 检查纯文本 `Claw @读PDF` 是否已经走 `原始用户消息 -> harness.pdf_read_skill_launch -> Agent 首刀 Skill(pdf_read) -> list_directory / read_file / tool timeline` 主链，而不是退回普通聊天总结或前端本地解析、卡在 `ToolSearch / WebSearch / Grep` 这类工具目录/联网检索偏航，或把 session permission 拒绝直接暴露给用户
- 检查纯文本 `Claw @总结` 是否已经走 `原始用户消息 -> harness.summary_skill_launch -> Agent 首刀 Skill(summary) -> 可选 list_directory / read_file / tool timeline` 主链，而不是退回普通聊天总结、卡在 `ToolSearch / WebSearch / Grep` 这类工具目录/联网检索偏航，或把 session permission 拒绝直接暴露给用户；同时确认 `Read / Glob` 仍保留给显式路径场景
- 检查纯文本 `Claw @翻译` 是否已经走 `原始用户消息 -> harness.translation_skill_launch -> Agent 首刀 Skill(translation) -> 可选 list_directory / read_file / tool timeline` 主链，而不是退回普通聊天翻译、卡在 `ToolSearch / WebSearch / Grep` 这类工具目录/联网检索偏航，或把 session permission 拒绝直接暴露给用户；同时确认 `Read / Glob` 仍保留给显式路径场景
- 检查纯文本 `Claw @分析` 是否已经走 `原始用户消息 -> harness.analysis_skill_launch -> Agent 首刀 Skill(analysis) -> 可选 list_directory / read_file / tool timeline` 主链，而不是退回普通聊天分析、卡在 `ToolSearch / WebSearch / Grep` 这类工具目录/联网检索偏航，或把 session permission 拒绝直接暴露给用户；同时确认 `Read / Glob` 仍保留给显式路径场景
- 检查纯文本 `Claw @发布合规` 是否已经走 `原始用户消息 -> harness.analysis_skill_launch -> Agent 首刀 Skill(analysis) -> 可选 list_directory / read_file / tool timeline` 主链，而不是退回普通聊天判断、重新长出另一套法务协议，或把 session permission 拒绝直接暴露给用户；同时确认默认 `focus/style/output_format` 与 `entry_source=at_publish_compliance_command` 已按创作风控语义补齐
- 检查纯文本 `Claw @转写` 是否已经走 `原始用户消息 -> harness.transcription_skill_launch -> Agent 首刀 Skill(transcription_generate) -> task file` 主链，而不是回流到前端直连旧 ASR 接口、卡在 `ToolSearch / WebSearch / Read / Glob / Grep` 这类通用工具偏航，或把 session permission 拒绝直接暴露给用户
- 检查纯文本 `Claw @链接解析 / @抓取 / @网页读取` 是否已经走 `原始用户消息 -> harness.url_parse_skill_launch -> Agent 首刀 Skill(url_parse) -> task file` 主链，而不是退回普通聊天总结、卡在 `ToolSearch / WebSearch / Read / Glob / Grep` 这类通用工具偏航，或把 session permission 拒绝直接暴露给用户；同时确认 `@抓取` 默认会把 `extract_goal` 收敛到 `full_text`，`@网页读取` 默认会把 `extract_goal` 收敛到 `summary`
- 检查纯文本 `Claw @排版` 是否已经走 `原始用户消息 -> harness.typesetting_skill_launch -> Agent 首刀 Skill(typesetting) -> task file` 主链，而不是退回普通聊天润色、卡在 `ToolSearch / WebSearch / Read / Glob / Grep` 这类通用工具偏航，或把 session permission 拒绝直接暴露给用户
- 检查纯文本 `Claw @网页` 是否已经走 `原始用户消息 -> harness.webpage_skill_launch -> Agent 首刀 Skill(webpage_generate) -> write_file HTML artifact` 主链，而不是退回普通聊天口头方案、卡在 `ToolSearch / WebSearch / Read / Glob / Grep` 这类通用工具偏航，或没有真实 `.html` 文件就宣布完成
- 检查纯文本 `Claw @PPT` 是否已经走 `原始用户消息 -> harness.presentation_skill_launch -> Agent 首刀 Skill(presentation_generate) -> write_file Markdown artifact` 主链，而不是退回普通聊天口头提纲、卡在 `ToolSearch / WebSearch / Read / Glob / Grep` 这类通用工具偏航，或没有真实演示稿文件就宣布完成
- 检查纯文本 `Claw @表单` 是否已经走 `原始用户消息 -> harness.form_skill_launch -> Agent 首刀 Skill(form_generate) -> ```a2ui simple form JSON` 主链，而不是退回普通聊天字段建议、卡在 `ToolSearch / WebSearch / Read / Glob / Grep` 这类通用工具偏航，或回流成单文件 HTML 表单原型；同时确认 render contract 已收敛为 `form + json`
- 检查纯文本 `Claw @代码` 是否已经走 `原始用户消息 -> harness.code_command + preferred_team_preset_id -> code_orchestrated -> code_execution / tools / team runtime` 主链，而不是继续停留在普通聊天、没有打开 `task/subagent` 偏好，或把代码任务改写成另一套 prompt / workflow 旁路
- 检查纯文本 `Claw @渠道预览` 是否已经走 `原始用户消息 -> displayContent 保留 -> /content_post_with_cover -> artifact` 主链，而不是退回普通聊天解释、重新长出另一套 `channel_preview_task` 协议，或静默混成正式 `@发布`；同时确认 `publish_command.intent=preview`、`entry_source=at_channel_preview_command` 与预览稿意图补齐仍然成立
- 检查纯文本 `Claw @上传` 是否已经走 `原始用户消息 -> displayContent 保留 -> /content_post_with_cover -> artifact` 主链，而不是退回普通聊天解释、重新长出另一套 `upload_task` 协议，或静默混成正式 `@发布`；同时确认 `publish_command.intent=upload`、`entry_source=at_upload_command` 与上传稿意图补齐仍然成立；若命中平台后台，也要确认浏览器门禁继续生效
- 检查纯文本 `Claw @发布` 是否已经走 `原始用户消息 -> displayContent 保留 -> dispatch /content_post_with_cover -> content_post workflow` 主链，而不是直接把 `@发布` 文本原样当普通聊天发送，或重新造一套 `publish_task` 协议；同时确认平台后台类输入会继续触发 `browser_requirement`
- 检查纯文本 `Claw @配音` 是否已经走 `原始用户消息 -> harness.service_scene_launch(scene_key=voice_runtime) -> Agent 基于本地 service-scene 上下文直接执行 -> 本地 ServiceSkill / tool timeline` 主链，而不是退回普通聊天解释、误走站点型 `service_skill_launch`，或重新回流旧的本地 TTS 测试命令；同时确认 `skill_id` 与最近使用记录都能写回，且不会再注入 `scene_base_url / session_token` 一类旧云运行上下文
- 检查纯文本 `Claw @浏览器` 是否已经走 `原始用户消息 -> harness.browser_requirement/browser_launch_url -> Browser Assist / mcp__lime-browser__* timeline` 主链，而不是退回 WebSearch、普通聊天解释，或错误伪装成站点型 `service_skill_launch`；同时确认前端本轮 `webSearch` 已关闭
- 检查产品型 `/scene-key` 是否已经走 `原始用户消息 -> harness.service_scene_launch -> Agent 基于本地 service-scene 上下文直接执行 -> 本地 ServiceSkill / tool timeline` 主链，而不是前端直接调用云端 run API 或在 Rust 侧重新长出云执行分支
- 如果某个 `/scene-key` 绑定的是 `site_adapter` 型技能，还要额外检查 `scene -> linkedSkillId -> 完整 ServiceSkill 目录 -> harness.service_skill_launch` 这条绑定链是否仍然成立，避免首页隐藏 site skill 后 slash scene 变成“目录可见但执行找不到 skill”
- 如果某个 `site_adapter` 结果开始返回 `markdown_bundle`，还要确认保存链会把 Markdown、图片和 `meta.json` 一起落到项目导出目录，并把重写后的相对图片路径写回内容 metadata；同时确认聊天轻卡或 tool timeline 能显示项目目录、Markdown 路径和图片数量，不能只把远程图片 URL 或临时 DOM 文本留在聊天结果里；进入工作区后还要实际打开项目里的真实 `index.md`，确认正文不是运行摘要副本，且相对图片已经在预览里渲染出来

高频场景：

- 修改 `safeInvoke` / `invoke`
- 修改 `execute_skill`、`list_executable_skills`、`get_skill_detail` 或它们在 DevBridge / mock 中的分流
- 修改 `create_skill_scaffold_for_app`、技能草稿透传字段，或“聊天结果 -> Skill 脚手架”主链
- 修改 `src/lib/api/document-export.ts`、`save_exported_document`，或把新的 GUI 导出入口接到本地文件保存主链
- 修改 `agent_runtime_submit_turn.turn_config.approval_policy / sandbox_policy`
- 修改 `agent_runtime_submit_turn.turn_config.provider_config.model_capabilities / tool_call_strategy / toolshim_model`
- 修改 `agent_runtime_submit_turn.request_metadata.harness.team_memory_shadow`
- 修改 `agent_runtime_spawn_subagent` 的 `name / teamName / cwd`、spawn 后 Team 成员写回，或 child `working_dir` / 父子上下文投影语义
- 修改 team runtime tool surface、tool inventory、主线程用户消息工具或协作工具展示，例如 `SendUserMessage`、`Agent / TeamCreate / TeamDelete / SendMessage / ListPeers`
- 修改 `agent_runtime_update_session` 或会话 provider/model / recent_access_mode / recent_preferences / recent_team_selection 恢复语义
- 修改 `execution_runtime.recent_access_mode / recent_theme / recent_session_mode / recent_gate_key / recent_run_title / recent_content_id` 恢复语义，或前端 `harness.access_mode / harness.theme / harness.session_mode / harness.gate_key / harness.run_title / harness.content_id` steady-state 去重逻辑
- 修改首页 / 工作区进入 `Claw` 时的首条自动发送上下文，例如 `initialUserPrompt`、`initialAutoSendRequestMetadata`、`harness.service_skill_launch`
- 修改 `site_*` 站点适配器命令族，例如 `site_recommend_adapters`、`site_get_adapter_launch_readiness`、`site_import_adapter_yaml_bundle`、`site_run_adapter`
- 修改 `companion_get_pet_status`、`companion_launch_pet`、`companion_send_pet_command`，或调整 Lime 与独立桌宠之间的本地 companion 协议（例如 `pet.provider_overview`、`pet.open_provider_settings`、`pet.request_provider_overview_sync`、`pet.request_pet_cheer`、`pet.request_pet_next_step`、`pet.request_chat_reply`）
- 修改自动化设置命令族，例如 `get_automation_jobs`、`create_automation_job`、`update_automation_job`、`get_automation_health` 或 `get_automation_run_history`，尤其是它们在浏览器模式 DevBridge 与 mock 间的分流
- 修改浏览器资料 / 环境预设命令族，或调整它们在 `mockPriorityCommands` 里的优先级
- 修改浏览器连接器命令族，例如安装目录、启用状态、系统连接器、浏览器动作配置、扩展安装状态、打开 Chrome 扩展 / 远程调试页，或主动断开扩展连接
- 修改 `get_model_registry_provider_ids`、Provider 模型映射或 `src-tauri/resources/models/index.json` 真相源读取语义
- 修改 `create_image_generation_task_artifact`、`get_media_task_artifact`、`list_media_task_artifacts`、`cancel_media_task_artifact`、`src/lib/api/mediaTasks.ts`、`src/lib/api/skill-execution.ts`、`useWorkspaceSendActions`、`useWorkspaceImageWorkbenchActionRuntime`、`runtime_turn`，或调整 `Claw @配图 -> harness.image_skill_launch -> Agent 首刀 Skill(image_generate) -> task/timeline` 的异步图片任务主链
- 修改 `@封面` parser、`useWorkspaceSendActions`、`runtime_turn`、`cover_skill_launch`、`lime task create cover`、`cover_generate` skill 或 `lime_create_cover_generation_task`，尤其是调整 `Claw @封面 -> harness.cover_skill_launch -> Agent 首刀 Skill(cover_generate) -> task file` 主链
- 修改 `@海报` parser、`useWorkspaceSendActions`、`runtime_turn`、`image_skill_launch`、`lime media image generate --json`、`image_generate` skill 或相关图片 timeline 展示，尤其是调整 `Claw @海报 -> harness.image_skill_launch -> Agent 首刀 Skill(image_generate) -> task/timeline` 主链
- 修改 `@播报` parser、`useWorkspaceSendActions`、`runtime_turn`、`broadcast_skill_launch`、`lime task create broadcast`、`broadcast_generate` skill 或 `lime_create_broadcast_generation_task`，尤其是调整 `Claw @播报 -> harness.broadcast_skill_launch -> Agent 首刀 Skill(broadcast_generate) -> task file` 主链
- 修改 `@素材` parser、`useWorkspaceSendActions`、`runtime_turn`、`resource_search_skill_launch`、`lime task create resource-search`、`modal_resource_search` skill 或 `lime_create_modal_resource_search_task`，尤其是调整 `Claw @素材 -> harness.resource_search_skill_launch -> Agent 首刀 Skill(modal_resource_search) -> task file` 主链
- 修改 `@搜索` parser、`useWorkspaceSendActions`、`runtime_turn`、`research_skill_launch`、`research` 默认 skill 或相关 tool timeline 展示，尤其是调整 `Claw @搜索 -> harness.research_skill_launch -> Agent 首刀 Skill(research) -> search_query / timeline` 主链
- 修改 `@深搜` parser、`useWorkspaceSendActions`、`runtime_turn`、`deep_search_skill_launch`、`research` 默认 skill 或相关 tool timeline 展示，尤其是调整 `Claw @深搜 -> harness.deep_search_skill_launch -> Agent 首刀 Skill(research) -> 多轮 search_query / timeline` 主链
- 修改 `@研报` parser、`useWorkspaceSendActions`、`runtime_turn`、`report_skill_launch`、`report_generate` 默认 skill 或相关 tool timeline 展示，尤其是调整 `Claw @研报 -> harness.report_skill_launch -> Agent 首刀 Skill(report_generate) -> search_query / timeline` 主链
- 修改 `@竞品` parser、`useWorkspaceSendActions`、`runtime_turn`、`report_skill_launch`、`report_generate` 默认 skill 或相关 tool timeline 展示，尤其是调整 `Claw @竞品 -> harness.report_skill_launch -> Agent 首刀 Skill(report_generate) -> search_query / timeline` 主链
- 修改 `@站点搜索` parser、`useWorkspaceSendActions`、`runtime_turn`、`site_search_skill_launch`、`site_search` 默认 skill 或相关 `lime_site_*` timeline 展示，尤其是调整 `Claw @站点搜索 -> harness.site_search_skill_launch -> Agent 首刀 Skill(site_search) -> lime_site_* / timeline` 主链
- 修改 `@读PDF` parser、`useWorkspaceSendActions`、`runtime_turn`、`pdf_read_skill_launch`、`pdf_read` 默认 skill 或相关 `list_directory / read_file` timeline 展示，尤其是调整 `Claw @读PDF -> harness.pdf_read_skill_launch -> Agent 首刀 Skill(pdf_read) -> list_directory / read_file / timeline` 主链
- 修改 `@总结` parser、`useWorkspaceSendActions`、`runtime_turn`、`summary_skill_launch`、`summary` 默认 skill 或相关 skill / tool timeline 展示，尤其是调整 `Claw @总结 -> harness.summary_skill_launch -> Agent 首刀 Skill(summary) -> 可选 list_directory/read_file / timeline` 主链
- 修改 `@翻译` parser、`useWorkspaceSendActions`、`runtime_turn`、`translation_skill_launch`、`translation` 默认 skill 或相关 skill / tool timeline 展示，尤其是调整 `Claw @翻译 -> harness.translation_skill_launch -> Agent 首刀 Skill(translation) -> 可选 list_directory/read_file / timeline` 主链
- 修改 `@分析` parser、`useWorkspaceSendActions`、`runtime_turn`、`analysis_skill_launch`、`analysis` 默认 skill 或相关 skill / tool timeline 展示，尤其是调整 `Claw @分析 -> harness.analysis_skill_launch -> Agent 首刀 Skill(analysis) -> 可选 list_directory/read_file / timeline` 主链
- 修改 `@发布合规` parser、`useWorkspaceSendActions`、`analysis_skill_launch`、`analysis` 默认 skill 或相关 skill / tool timeline 展示，尤其是调整 `Claw @发布合规 -> harness.analysis_skill_launch -> Agent 首刀 Skill(analysis) -> 风控结论 / timeline` 主链
- 修改 `@转写` parser、`useWorkspaceSendActions`、`runtime_turn`、`transcription_skill_launch`、`lime task create transcription`、`transcription_generate` skill 或 `lime_create_transcription_task`，尤其是调整 `Claw @转写 -> harness.transcription_skill_launch -> Agent 首刀 Skill(transcription_generate) -> task file` 主链
- 修改 `@链接解析` / `@抓取` / `@网页读取` parser、`useWorkspaceSendActions`、`runtime_turn`、`url_parse_skill_launch`、`lime task create url-parse`、`url_parse` skill 或 `lime_create_url_parse_task`，尤其是调整 `Claw @链接解析 / @抓取 / @网页读取 -> harness.url_parse_skill_launch -> Agent 首刀 Skill(url_parse) -> task file` 主链
- 修改 `@排版` parser、`useWorkspaceSendActions`、`runtime_turn`、`typesetting_skill_launch`、`lime task create typesetting`、`typesetting` skill 或 `lime_create_typesetting_task`，尤其是调整 `Claw @排版 -> harness.typesetting_skill_launch -> Agent 首刀 Skill(typesetting) -> task file` 主链
- 修改 `@网页` parser、`useWorkspaceSendActions`、`runtime_turn`、`webpage_skill_launch`、`webpage_generate` skill 或 HTML artifact 预览链路，尤其是调整 `Claw @网页 -> harness.webpage_skill_launch -> Agent 首刀 Skill(webpage_generate) -> write_file HTML artifact` 主链
- 修改 `@PPT` parser、`useWorkspaceSendActions`、`runtime_turn`、`presentation_skill_launch`、`presentation_generate` skill 或演示稿 artifact 预览链路，尤其是调整 `Claw @PPT -> harness.presentation_skill_launch -> Agent 首刀 Skill(presentation_generate) -> write_file Markdown artifact` 主链
- 修改 `@代码` parser、`useWorkspaceSendActions`、mention builtin command 或 `code_orchestrated` 发送边界，尤其是调整 `Claw @代码 -> harness.code_command -> code_orchestrated -> tools / team runtime` 主链
- 修改 `@渠道预览` parser、`useWorkspaceSendActions`、`publish_command` metadata 或 `content_post_with_cover` 预览意图编排，尤其是调整 `Claw @渠道预览 -> publish_command.intent=preview -> /content_post_with_cover -> artifact` 主链
- 修改 `@上传` parser、`useWorkspaceSendActions`、`publish_command` metadata、浏览器门禁推导或 `content_post_with_cover` 上传意图编排，尤其是调整 `Claw @上传 -> publish_command.intent=upload -> /content_post_with_cover -> artifact` 主链
- 修改 `@发布` parser、`useWorkspaceSendActions`、content post workflow 入口或浏览器门禁推导，尤其是调整 `Claw @发布 -> displayContent/raw -> /content_post_with_cover -> publish workflow` 主链
- 修改 `@配音` parser、`useWorkspaceSendActions`、`service_scene_launch` 组装或 compat `lime_run_service_skill` 护栏，尤其是调整 `Claw @配音 -> harness.service_scene_launch(scene_key=voice_runtime) -> 本地 service-scene 直驱执行 -> 本地 ServiceSkill / tool timeline` 主链
- 修改 `@浏览器` parser、`useWorkspaceSendActions`、Browser Assist 直发策略、`browser_requirement` 推导或 `mcp__lime-browser__*` 浏览器工具接线，尤其是调整 `Claw @浏览器 -> harness.browser_requirement/browser_launch_url -> Browser Assist timeline` 主链
- 修改 `/scene-key` 解析、`serviceSkillSceneLaunch`、`useWorkspaceSendActions`、`runtime_turn`、`prompt_context`、compat `lime_run_service_skill` 或 `client/skills` scene 目录协议，尤其是调整 `Claw /scene-key -> harness.service_scene_launch -> 本地 service-scene 直驱执行 -> 本地 ServiceSkill / tool timeline` 主链
- 修改 `src/lib/dev-bridge/`
- 修改 `src/lib/tauri-mock/`
- 修改 `src-tauri/src/app/runner.rs`
- 修改 `src-tauri/src/dev_bridge/`

如果本轮修改了 `Claw @配图` 或图片任务 artifact 回填语义，最低校验至少包含：

- `npm run test:contracts`
- `cd src-tauri && cargo test test_merge_system_prompt_with_image_skill_launch_appends_prompt`
- `cd src-tauri && cargo test test_append_image_skill_launch_session_permissions_blocks_detour_tools`
- `imageWorkbenchCommand`、`useWorkspaceSendActions`、受影响 skill / image task Hook 单测，以及 `aster_agent_cmd` 图片主链定向测试
- 如果本轮还改了显式图片动作入口，例如文稿 inline 配图、封面位或图片工作台编辑/重绘，额外覆盖 `useWorkspaceImageWorkbenchActionRuntime` 或对应发送桥接回归
- 若本轮还改了显式 `execute_skill` 的 `images / requestContext` 透传或 compat 续接，额外覆盖 `skillCommand` 回归
- 受影响的 `image task` / `image workbench` Hook 单测
- `npm run verify:gui-smoke`

如果本轮还修改了文稿 inline 配图占位逻辑，例如 `usage=document-inline`、`relationships.slot_id`、payload compat `slot_id`、`anchor_section_title`、`anchor_text`、正文占位块原位替换或文稿画布图片占位渲染，受影响回归至少要额外覆盖：

- 文稿占位块插入
- `relationships.slot_id` 绑定的原位替换
- `anchor_section_title` 驱动的小节级插入
- `anchor_text` 驱动的段落级插入
- 失败 / 取消状态不误替换成成功图片

如果本轮修改了 `Claw @封面` 或封面任务协议，最低校验至少包含：

- `coverWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 封面主链 / detour tool 限制定向测试
- `lime-cli` 封面任务创建回归、受影响的默认 skill / tool catalog 测试
- `npm run test:contracts`
- `npm run verify:gui-smoke`

如果本轮修改了 `Claw @视频` 或视频任务协议，最低校验至少包含：

- `videoWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 视频主链 / detour tool 限制定向测试
- `lime media video generate` 回归、受影响的默认 skill / tool catalog 测试
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @播报` 或播报任务协议，最低校验至少包含：

- `broadcastWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 播报主链 / detour tool 限制定向测试
- `lime-cli` 播报任务创建测试、受影响的默认 skill / tool catalog 测试
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @素材` 或素材检索任务协议，最低校验至少包含：

- `resourceSearchWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 素材检索主链 / detour tool 限制定向测试
- `lime-cli` 资源检索任务创建测试、受影响的默认 skill / tool catalog 测试
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @搜索` 或搜索 prompt skill 协议，最低校验至少包含：

- `searchWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 搜索主链 / detour tool 限制定向测试
- `research` 默认 skill / tool catalog 相关回归
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @深搜` 或深搜 prompt skill 协议，最低校验至少包含：

- `deepSearchWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 深搜主链 / detour tool 限制定向测试
- `research` 默认 skill / tool catalog 相关回归，且要确认没有退化成只执行一轮浅搜
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @研报` 或研报 prompt skill 协议，最低校验至少包含：

- `reportWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 研报主链 / detour tool 限制定向测试
- `report_generate` 默认 skill / `skillCatalog` 相关回归，且要确认没有退回普通聊天长文或跳过真实 `search_query`
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @站点搜索` 或站点搜索 prompt skill 协议，最低校验至少包含：

- `siteSearchWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 站点搜索主链 / detour tool 限制定向测试
- `site_search` 默认 skill / `lime_site_*` tool catalog 相关回归
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @读PDF` 或读 PDF prompt skill 协议，最低校验至少包含：

- `pdfWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 读 PDF 主链 / detour tool 限制定向测试
- `pdf_read` 默认 skill / `skillCatalog` 相关回归；若支持相对路径，还要确认没有跳过真实 `list_directory / read_file` timeline
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @总结` 或总结 prompt skill 协议，最低校验至少包含：

- `summaryWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 总结主链 / detour tool 限制定向测试
- `summary` 默认 skill / `skillCatalog` 相关回归；若支持文件路径总结，还要确认没有跳过真实 `list_directory / read_file` timeline
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @翻译` 或翻译 prompt skill 协议，最低校验至少包含：

- `translationWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 翻译主链 / detour tool 限制定向测试
- `translation` 默认 skill / `skillCatalog` 相关回归；若支持文件路径翻译，还要确认没有跳过真实 `list_directory / read_file` timeline
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @分析` 或分析 prompt skill 协议，最低校验至少包含：

- `analysisWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 分析主链 / detour tool 限制定向测试
- `analysis` 默认 skill / `skillCatalog` 相关回归；若支持文件路径分析，还要确认没有跳过真实 `list_directory / read_file` timeline
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @转写` 或转写任务协议，最低校验至少包含：

- `transcriptionWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 转写主链 / detour tool 限制定向测试
- `lime-cli` 转写任务创建测试、`media-runtime` 任务类型回归、受影响的默认 skill / tool catalog 测试
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @链接解析` 或链接解析任务协议，最低校验至少包含：

- `urlParseWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 链接解析主链 / detour tool 限制定向测试
- `lime-cli` 链接解析任务创建测试、受影响的默认 skill / tool catalog 测试
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @排版` 或排版任务协议，最低校验至少包含：

- `typesettingWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 排版主链 / detour tool 限制定向测试
- `lime-cli` 排版任务创建测试、受影响的默认 skill / tool catalog 测试
- `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @网页` 或网页生成协议，最低校验至少包含：

- `webpageWorkbenchCommand`、`useWorkspaceSendActions`、提及面板 builtin command 回归，以及 `aster_agent_cmd` 网页主链 / detour tool 限制定向测试
- `webpage_generate` 默认 skill、默认 skill 安装或 `lime-cli skill show webpage_generate` 相关回归

如果本轮修改了 `Claw @PPT` 或演示稿生成协议，最低校验至少包含：

- `npx vitest run "src/components/agent/chat/utils/presentationWorkbenchCommand.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx" "src/components/agent/chat/skill-selection/CharacterMention.test.tsx"`
- `cargo test presentation_skill_launch`
- `cargo test -p lime-cli skill_show_presentation_generate_returns_builtin_skill`
- `presentation_generate` 默认 skill、默认 skill 安装或 `lime-cli skill show presentation_generate` 相关回归
- `npm run test:contracts`
- 若 HTML artifact 预览主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @代码` 或代码编排发送协议，最低校验至少包含：

- `npx vitest run "src/components/agent/chat/utils/codeWorkbenchCommand.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx" "src/components/agent/chat/skill-selection/CharacterMention.test.tsx" "src/lib/api/skillCatalog.test.ts"`
- 如有改动扩散到 runtime/team/tool 协议，再补对应 `agentStream*` / runtime team / tool display 定向回归
- 若命令边界或 harness 协议继续扩散，再补 `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @发布` 或发布工作流接线，最低校验至少包含：

- `npx vitest run "src/components/agent/chat/utils/publishWorkbenchCommand.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx" "src/components/agent/chat/skill-selection/CharacterMention.test.tsx" "src/lib/api/skillCatalog.test.ts"`
- 如有改动扩散到 `content_post_with_cover` slash skill 或写文件回流，再补 `skillCommand` / `MessageList` / general workbench 相关定向回归
- 若浏览器门禁或 harness 协议继续扩散，再补 `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @配音` 或配音服务型技能接线，最低校验至少包含：

- `npx vitest run "src/components/agent/chat/utils/voiceWorkbenchCommand.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx" "src/components/agent/chat/skill-selection/CharacterMention.test.tsx" "src/lib/api/skillCatalog.test.ts" "src/lib/api/serviceSkills.test.ts"`
- 如有改动扩散到 `service_scene_launch` runtime、`lime_run_service_skill`、本地 service-scene 执行桥或 compat 结果回流，再补对应 `runtime_turn` / `prompt_context` / `tool_runtime/service_skill_tools` 定向测试
- 若 `service_scene_launch` / harness 协议继续扩散，再补 `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 `Claw @浏览器` 或显式浏览器任务接线，最低校验至少包含：

- `npx vitest run "src/components/agent/chat/utils/browserWorkbenchCommand.test.ts" "src/components/agent/chat/workspace/useWorkspaceSendActions.test.tsx" "src/components/agent/chat/skill-selection/CharacterMention.test.tsx" "src/lib/api/skillCatalog.test.ts"`
- 如有改动扩散到 Browser Assist 自动拉起、画布附着或浏览器工具结果回流，再补 `index.test.tsx`、`useWorkspaceBrowserAssistRuntime` 或相关 artifact/runtime 定向回归
- 若 `browser_requirement` / harness 协议继续扩散，再补 `npm run test:contracts`
- 若 GUI 主路径受影响，再补 `npm run verify:gui-smoke`

如果本轮修改了 Provider 模型真相源或设置页中的“支持的模型”展示逻辑，还应额外确认：

- 资源索引损坏时，GUI 会明确提示“模型真相源异常”
- 不会再静默回退数据库或把错误伪装成空模型列表

如果本轮修改了 Provider 类型与 Prompt Cache 能力边界，还应额外确认：

- `anthropic-compatible` 不会再被 UI 或运行时误显示成“自动 Prompt Cache”
- Provider Pool 的列表、详情、创建和编辑入口中，受影响落点会继续提示“显式 cache_control”
- 聊天侧 `ModelSelector / Inputbar / MessageList / TokenUsageDisplay` 与 Provider Pool 的口径保持一致

### Layer 4：交互型 E2E

入口：

- `docs/aiprompts/playwright-e2e.md`

作用：

- 用 Playwright MCP 做真实页面交互验证
- 检查控制台错误、主导航、关键业务工作流

注意：

- 不要把所有页面默认都推进到重型 E2E
- 先跑最小 smoke，再决定是否需要完整交互验证

## 改动类型与最低门槛

| 改动类型                            | 至少运行                                               | 额外要求                                    |
| ----------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| 普通前端改动                        | `npm run verify:local`                                 | 如有用户可见变化，补稳定回归                |
| Tauri 命令 / Bridge / mock 改动     | `npm run verify:local`、`npm run test:contracts`       | 必要时补 `npm run governance:legacy-report` |
| GUI 壳 / Workspace / 页面主路径改动 | `npm run verify:local`、`npm run verify:gui-smoke`     | 必须补对应 UI 回归                          |
| 运行时 handoff / 证据包导出改动     | `npm run test:contracts`、相关 `vitest`、Rust 定向测试 | 如入口落在工作台 UI，再补最小 GUI 续测      |
| 配置结构改动                        | `npm run verify:local`                                 | 同步 schema、消费者、文档                   |
| 版本相关改动                        | `npm run verify:app-version`                           | 与发布配置一起核对                          |
| Rust 模块改动                       | 受影响 crate / 模块定向测试                            | 再决定是否跑全量 `cargo test`               |
| 真实页面交互验证                    | 先跑 `npm run verify:gui-smoke`                        | 再进入 `playwright-e2e.md`                  |

补充说明：

- 如果这次改动新增或调整公开 CLI（例如 `@lime/cli`、`lime media ...`），至少补受影响 crate 的定向测试；媒体 CLI 主链当前最低建议为 `cargo test --manifest-path src-tauri/Cargo.toml -p lime-media-runtime -p lime-cli`。如果 CLI 结果会回流 Workbench/Agent，再补对应 Rust 或前端定向回归。
- 如果这次改动把 `ServiceSkill -> automation_job -> agent_turn` 接到 Artifact 主线，除了常规 `verify:local` / `test:contracts` 之外，还应至少补一条稳定回归，证明 `content_id + request_metadata.artifact` 没在表单编辑或执行链路里丢失。
- 如果这次改动影响 `Claw` 与站点技能的直跑门禁，还应补回归证明：阻断停留在技能入口层，不再把浏览器准备态注入成对话里的继续执行确认。
- 如果这次改动把 `content_id` steady-state 从“每回合显式提交”后移到 `session/runtime`，除了契约检查之外，还应补 Hook/UI 回归，证明：
  - session 已有 `execution_runtime.recent_content_id` 时，前端不会重复提交相同 `harness.content_id`
- 如果这次改动涉及上下文压缩语义，至少要同时验证两条运行时链路：
  - 普通 `agent_runtime_submit_turn` 发消息链路
  - `agent_runtime_respond_action` 的 ask-user / elicitation 恢复链路
    二者在 `workspace.settings.auto_compact=false` 时都不应再偷偷触发自动压缩，而应把“请手动压缩或新建会话”的错误显式投影到前端。
  - 切换到新 content 但 runtime 尚未同步时，前端仍会保留显式 `content_id`
- 如果这次改动把 `theme / session_mode` steady-state 从“每回合显式提交”后移到 `session/runtime`，除了契约检查之外，还应补 Hook/UI 回归，证明：
  - session 已有 `execution_runtime.recent_theme / recent_session_mode` 时，前端不会重复提交相同 `harness.theme / harness.session_mode`
  - 切换到新 theme 或 `general_workbench` 但 runtime 尚未同步时，前端仍会保留显式 `theme / session_mode`
- 如果这次改动影响 `harness.team_memory_shadow` 这类 repo-scoped Team 协作上下文，除了契约检查之外，还应补：
  - 前端发送边界回归，确认 `team_memory_shadow` 能随当前请求进入 `agent_runtime_submit_turn`
  - Rust `prompt_context` 定向测试，确认 shadow 只作为低优先级协作参考，不覆盖显式 `selected_team_*` 或 `recent_team_selection`
- 如果这次改动影响 `agent_runtime_spawn_subagent` 的 current request surface，除了契约检查之外，还应补：
  - Rust 定向测试，确认显式 `name` 会覆盖 child session 展示名 / role hint 的 fallback
  - Rust 或前端回归，确认 `teamName` 必须与 `name` 搭配，并且只在现有 Team 上下文内写回成员关系
  - Rust 定向测试，确认当前 runtime 对非空 `mode / isolation` 会返回明确 unsupported，而不是静默忽略
  - 定向验证，确认绝对 `cwd` 会投影到 child `working_dir`，相对路径会在边界被拒绝
- 如果这次改动把 `accessMode` steady-state 从“只写 harness metadata”收敛到正式 turn context 与 `session/runtime`，除了契约检查之外，还应补 Hook/UI 回归，证明：
  - turn 提交始终携带正式 `approval_policy / sandbox_policy`
  - session 已有 `execution_runtime.recent_access_mode` 时，切换话题会恢复对应 accessMode，而不是回退到工作区默认值
  - execution_runtime 缺失但本地 shadow 已命中时，前端仍会回填 `recent_access_mode` 到 session
- 如果这次改动把 `gate_key / run_title` steady-state 从“每回合显式提交”后移到 `session/runtime`，除了契约检查之外，还应补 Hook/UI 回归，证明：
  - session 已有 `execution_runtime.recent_gate_key / recent_run_title` 时，前端不会重复提交相同 `harness.gate_key / harness.run_title`
  - 切换到新的通用工作区 gate 或运行标题、但 runtime 尚未同步时，前端仍会保留显式 `gate_key / run_title`
- 如果这次改动影响浏览器工作台里的站点采集链路，例如推荐区、资料自动选择、`site_get_adapter_launch_readiness` 门禁、`report_hint` 展示、`lime_site_recommend`，或“优先写回当前 `content_id` 而不是新建资源文档”的主线收敛，除了契约检查，还应补对应 `*.test.tsx` 回归并执行 `verify:gui-smoke`。
- 如果这次改动影响浏览器资料 / 环境预设的真实来源，还应补一次浏览器模式实测，确认控制台不再出现 `[Mock] invoke: list_browser_profiles_cmd` 或 `[Mock] invoke: list_browser_environment_presets_cmd`。
- 如果这次改动影响设置页“连接器”主路径或 Chrome 扩展导出链路，除了 `test:contracts`，还应补对应设置页回归，并在 GUI smoke 或 Playwright 续测里确认连接器页能打开、目录可选、扩展状态可读。
- 如果这次改动影响 `agent_runtime_export_handoff_bundle`、`agent_runtime_export_evidence_pack`、`agent_runtime_export_analysis_handoff`、`agent_runtime_export_review_decision_template`、`agent_runtime_save_review_decision` 或 `agent_runtime_export_replay_case` 这条 Harness 导出 / 审核主链，除了契约检查，还应至少补：
  - `src/lib/api/agent.test.ts` 一类的网关回归，确认仍走统一 `agent_runtime_*` 主命令
  - `HarnessStatusPanel.test.tsx` 一类的 UI 回归，确认导出入口、保存弹窗、状态与制品展示正常
  - 受影响 Rust 服务 / 命令的定向测试，确认 `.lime/harness/sessions/<session_id>/...` 一类制品仍能生成
- 如果这次改动影响 `src/lib/api/agentRuntime/` 的 current 目录结构，例如 `types.ts`、分域 client、`commandManifest.generated.ts` 或 compat 根入口 `agentRuntime.ts`，最低应补：
  - `npm run typecheck`
  - `npx eslint "src/lib/api/agentRuntime.ts" "src/lib/api/agentRuntime/*.ts" --max-warnings 0`
  - `npm test -- src/lib/api/agent.test.ts src/components/agent/chat/hooks/agentRuntimeAdapter.test.ts`
  - `npm run test:contracts`
    同时确认目录内实现没有再从 `../agentRuntime` 或 `@/lib/api/agentRuntime` 回绕 compat barrel 取类型。

## CI 事实源

主工作流：

- `.github/workflows/quality.yml`

关键事实源：

- `scripts/quality-task-planner.mjs`
- `scripts/quality-task-selector.mjs`
- `scripts/local-ci.mjs`

要求：

- 本地 `verify:local` 与 CI 使用同一套 changed-path 分类逻辑
- 最终由 `results` job 聚合为统一质量信号
- 对 GUI 产品来说，PR 门禁不能只覆盖静态检查，还必须覆盖 `Bridge & Contracts` 与 `GUI Smoke`

## PR 前最小清单

发起 PR 前，至少自问这五件事：

1. 这次改动属于普通逻辑、协议边界、GUI 主路径还是治理收口？
2. 我是不是已经走过对应的最低校验？
3. 如果改了命令、配置或版本，相关文档与锁文件是否同步？
4. 如果改了用户可见 UI，是否补了稳定回归？
5. 如果改了 GUI 壳、Bridge、Workspace，是否真的跑过最小 smoke？

## 常用命令

```bash
# 本地统一校验
npm run verify:local
npm run verify:local:full

# GUI 最小冒烟
npm run verify:gui-smoke
npm run smoke:workspace-ready
npm run smoke:browser-runtime
npm run smoke:site-adapters
npm run smoke:agent-service-skill-entry

# 前端 / 桥接 / 契约
npm test
npm run test:bridge
npm run test:contracts
npm run bridge:health -- --timeout-ms 120000

# GUI / headless 调试
npm run tauri:dev:headless
```

## 相关文档

- `docs/aiprompts/commands.md`
- `docs/aiprompts/governance.md`
- `docs/aiprompts/playwright-e2e.md`

## 决策原则

只有一句话：

**Lime 是 GUI 桌面产品，工程质量不能只验证“代码能编译”，还要验证“应用壳、桥接、工作区主路径能运行”。**
