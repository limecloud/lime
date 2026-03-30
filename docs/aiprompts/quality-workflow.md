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

### 3. 用户可见 UI 改动必须补稳定回归

- 优先补现有 `*.test.tsx` 的关键文案、状态与交互断言
- 如果目标区域已有 snapshot / 结构化快照机制，沿用现有机制
- 不要因为“只是 UI”就跳过回归

### 4. 配置与依赖改动必须成组提交

- 改配置结构时，要同步更新 schema、校验器、消费者与文档
- 改版本结构时，要执行 `npm run verify:app-version`
- 改依赖时，要同步提交对应锁文件，如 `package-lock.json`、`src-tauri/Cargo.lock`
- 本仓库没有 Bazel，不适用 Bazel lockfile 规则

### 5. Rust 校验先小后大

- 默认先跑受影响 crate、模块或定向测试
- 再根据边界扩散决定是否执行全量 `cargo test`
- 目标是尽快暴露问题，而不是一上来把所有测试都跑满

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

作用：

- 检查前端命令调用与 Rust 注册表是否一致
- 检查 harness metadata / execution runtime / 后端 request metadata 的关键字段是否漂移
- 检查浏览器桥接 / mock 优先路径是否同步
- 检查 `DevBridge` 是否可用

高频场景：

- 修改 `safeInvoke` / `invoke`
- 修改 `agent_runtime_submit_turn.turn_config.approval_policy / sandbox_policy`
- 修改 `agent_runtime_update_session` 或会话 provider/model / recent_access_mode / recent_preferences / recent_team_selection 恢复语义
- 修改 `execution_runtime.recent_access_mode / recent_theme / recent_session_mode / recent_gate_key / recent_run_title / recent_content_id` 恢复语义，或前端 `harness.access_mode / harness.theme / harness.session_mode / harness.gate_key / harness.run_title / harness.content_id` steady-state 去重逻辑
- 修改首页 / 工作区进入 `Claw` 时的首条自动发送上下文，例如 `initialUserPrompt`、`initialAutoSendRequestMetadata`、`harness.service_skill_launch`
- 修改 `site_*` 站点适配器命令族，例如 `site_recommend_adapters`、`site_get_adapter_launch_readiness`、`site_import_adapter_yaml_bundle`、`site_run_adapter`
- 修改浏览器资料 / 环境预设命令族，或调整它们在 `mockPriorityCommands` 里的优先级
- 修改浏览器连接器命令族，例如安装目录、启用状态、系统连接器、浏览器动作配置、扩展安装状态、打开 Chrome 扩展 / 远程调试页，或主动断开扩展连接
- 修改 `src/lib/dev-bridge/`
- 修改 `src/lib/tauri-mock/`
- 修改 `src-tauri/src/app/runner.rs`
- 修改 `src-tauri/src/dev_bridge/`

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

- 如果这次改动把 `ServiceSkill -> automation_job -> agent_turn` 接到 Artifact 主线，除了常规 `verify:local` / `test:contracts` 之外，还应至少补一条稳定回归，证明 `content_id + request_metadata.artifact` 没在表单编辑或执行链路里丢失。
- 如果这次改动影响 `Claw` 与站点技能的直跑门禁，还应补回归证明：阻断停留在技能入口层，不再把浏览器准备态注入成对话里的继续执行确认。
- 如果这次改动把 `content_id` steady-state 从“每回合显式提交”后移到 `session/runtime`，除了契约检查之外，还应补 Hook/UI 回归，证明：
  - session 已有 `execution_runtime.recent_content_id` 时，前端不会重复提交相同 `harness.content_id`
  - 切换到新 content 但 runtime 尚未同步时，前端仍会保留显式 `content_id`
- 如果这次改动把 `theme / session_mode` steady-state 从“每回合显式提交”后移到 `session/runtime`，除了契约检查之外，还应补 Hook/UI 回归，证明：
  - session 已有 `execution_runtime.recent_theme / recent_session_mode` 时，前端不会重复提交相同 `harness.theme / harness.session_mode`
  - 切换到新 theme 或 `theme_workbench` 但 runtime 尚未同步时，前端仍会保留显式 `theme / session_mode`
- 如果这次改动把 `accessMode` steady-state 从“只写 harness metadata”收敛到正式 turn context 与 `session/runtime`，除了契约检查之外，还应补 Hook/UI 回归，证明：
  - turn 提交始终携带正式 `approval_policy / sandbox_policy`
  - session 已有 `execution_runtime.recent_access_mode` 时，切换话题会恢复对应 accessMode，而不是回退到工作区默认值
  - execution_runtime 缺失但本地 shadow 已命中时，前端仍会回填 `recent_access_mode` 到 session
- 如果这次改动把 `gate_key / run_title` steady-state 从“每回合显式提交”后移到 `session/runtime`，除了契约检查之外，还应补 Hook/UI 回归，证明：
  - session 已有 `execution_runtime.recent_gate_key / recent_run_title` 时，前端不会重复提交相同 `harness.gate_key / harness.run_title`
  - 切换到新的 Theme Workbench gate 或运行标题、但 runtime 尚未同步时，前端仍会保留显式 `gate_key / run_title`
- 如果这次改动影响浏览器工作台里的站点采集链路，例如推荐区、资料自动选择、`site_get_adapter_launch_readiness` 门禁、`report_hint` 展示、`lime_site_recommend`，或“优先写回当前 `content_id` 而不是新建资源文档”的主线收敛，除了契约检查，还应补对应 `*.test.tsx` 回归并执行 `verify:gui-smoke`。
- 如果这次改动影响浏览器资料 / 环境预设的真实来源，还应补一次浏览器模式实测，确认控制台不再出现 `[Mock] invoke: list_browser_profiles_cmd` 或 `[Mock] invoke: list_browser_environment_presets_cmd`。
- 如果这次改动影响设置页“连接器”主路径或 Chrome 扩展导出链路，除了 `test:contracts`，还应补对应设置页回归，并在 GUI smoke 或 Playwright 续测里确认连接器页能打开、目录可选、扩展状态可读。
- 如果这次改动影响 `agent_runtime_export_handoff_bundle`、`agent_runtime_export_evidence_pack`、`agent_runtime_export_analysis_handoff`、`agent_runtime_export_review_decision_template`、`agent_runtime_save_review_decision` 或 `agent_runtime_export_replay_case` 这条 Harness 导出 / 审核主链，除了契约检查，还应至少补：
  - `src/lib/api/agent.test.ts` 一类的网关回归，确认仍走统一 `agent_runtime_*` 主命令
  - `HarnessStatusPanel.test.tsx` 一类的 UI 回归，确认导出入口、保存弹窗、状态与制品展示正常
  - 受影响 Rust 服务 / 命令的定向测试，确认 `.lime/harness/sessions/<session_id>/...` 一类制品仍能生成

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
