# Tauri 命令边界

## 这份文档回答什么

本文件用于说明 Lime 中 Tauri 命令的工程边界，主要回答：

- 命令改动应该从哪里进入，而不是到处直接 `invoke`
- 哪些文件共同构成命令契约的事实源
- 新增、迁移、下线命令时，最低要同步哪些位置
- 怎样避免 compat / deprecated 路径重新长出新表面

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
- **会话状态回写主链**：继续收敛到 `agent_runtime_update_session`，用于名称、执行策略、session provider/model、`recent_access_mode`、`recent_preferences` 以及 `recent_team_selection` 的轻量持久化回写
- **会话权限主链**：`agent_runtime_submit_turn.turn_config.approval_policy / sandbox_policy` 是正式 turn context 权限协议；`getSession` 返回的 `execution_runtime.recent_access_mode` 负责承接会话最近一次 accessMode。当前端已命中同一 steady-state 权限时，不应继续依赖 `harness.access_mode` 作为唯一事实源
- **运行时交接导出主链**：继续收敛到 `agent_runtime_export_handoff_bundle`；前端统一通过 `src/lib/api/agentRuntime.ts` 网关进入，当前 GUI 入口位于 `HarnessStatusPanel`
- **运行时证据导出主链**：继续收敛到 `agent_runtime_export_evidence_pack`，用于把 runtime / timeline / artifacts 打包成最小问题证据
- **运行时 replay 样本主链**：继续收敛到 `agent_runtime_export_replay_case`，复用 handoff bundle + evidence pack 生成 `input / expected / grader / evidence-links`
- **运行时外部分析交接主链**：继续收敛到 `agent_runtime_export_analysis_handoff`，复用 handoff bundle + evidence pack + replay case 生成 `analysis-brief.md / analysis-context.json / copy_prompt`，供外部 Claude Code / Codex 直接诊断与最小修复；当前 GUI 入口位于 `HarnessStatusPanel`
- **运行时人工审核记录主链**：继续收敛到 `agent_runtime_export_review_decision_template` + `agent_runtime_save_review_decision`；前者复用 `analysis handoff` 生成 `review-decision.md / review-decision.json` 模板，后者把开发者的接受 / 延后 / 拒绝与回归要求回写到同一份工作区制品；当前 GUI 入口位于 `HarnessStatusPanel`
- **会话主题上下文主链**：`getSession` 返回的 `execution_runtime.recent_theme / recent_session_mode` 负责承接最近一次运行态主题上下文；当前端已命中同一 steady-state theme/workbench mode 时，不应继续每回合重复携带 `harness.theme / harness.session_mode`
- **会话运行阶段上下文主链**：`getSession` 返回的 `execution_runtime.recent_gate_key / recent_run_title` 负责承接最近一次 Theme Workbench 运行阶段上下文；当前端已命中同一 steady-state gate/run 时，不应继续每回合重复携带 `harness.gate_key / harness.run_title`
- **会话内容上下文主链**：`getSession` 返回的 `execution_runtime.recent_content_id` 负责承接最近一次运行态 `content_id`；当前端已命中同一 steady-state 内容时，不应继续每回合重复携带 `harness.content_id`
- **运行态摘要主链**：Aster `runtime_status` item -> timeline `turn_summary`
- **旧 `chat_*` 命令**：已停止注册，不应重新回到 `commands::mod` 或 `generate_handler!`
- **旧 `general_chat_*` 边界**：前端 compat 网关与 Rust 命令都已移除，不应重新接入
- **记忆系统**：统一沉淀优先走 `unified_memory_*`，runtime / 上下文视图优先走 `memory_runtime_*`
- **旧项目风格命令**：`style_guide_get` / `style_guide_update` 已下线，不应再从前端网关、Rust 注册或 mock 中接回
- **旧项目模板命令**：`create_template` / `list_templates` / `get_template` / `update_template` / `delete_template` / `set_default_template` / `get_default_template` 已下线，不应再从前端网关、Rust 注册或 mock 中接回
- **旧品牌人设扩展命令**：`get_brand_persona` / `get_brand_extension` / `save_brand_extension` / `update_brand_extension` / `delete_brand_extension` / `list_brand_persona_templates` 已下线，不应再从前端网关、Rust 注册或 mock 中接回

这些示例的意义不是列清单，而是提醒：

**不要再造第三套入口，优先继续把能力收敛到已存在的主链。**

补充约定：

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
