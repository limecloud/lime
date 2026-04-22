## Lime v1.16.0

### 发布概览

- 本次版本基于当前整批待发布工作树整理，覆盖 `225` 个文件，包含运行时 current 对齐、`@命令 / ServiceSkill / SkillCatalog / SceneApp` 本地执行面收口、工作台 IA 与多页面重构、自动化与资料库体验整理、开发脚本与工程文档同步，以及版本入口统一升级。
- 本次发布目标 tag 为 `v1.16.0`。

### 运行时、hooks 与宿主能力推进

- `runtime_project_hooks` 已真正接入当前 runtime 主链，补齐 `UserPromptSubmit`、`SessionStart(startup / compact)`、stop、permission request 等 hook 生命周期，不再停留在“存在 loader / executor、但主提交链没用上”的半接线状态。
- `subagent_runtime`、`tool_runtime`、`runtime_turn`、`session_runtime` 与 `prompt_context` 同步推进，补上子代理自定义、frontmatter hooks、`allowed_tools` / `disallowed_tools`、会话级工具 allow/deny 与警告链，统一多代理与工具调用边界。
- `aster` 侧继续向参考运行时 current 口径对齐：`skills/loader.rs`、`skills/registry.rs`、`skills/tool.rs`、`agents/tool_execution.rs`、`agents/subagent_tool.rs`、hooks registry / executor / types、permission inspector 与 workflow tool 全面更新，补齐 plugin skill reload、skill frontmatter hooks、permission hook current、subagent tool scope current。
- session store、subagent profile、API key provider、agent runtime DTO / types、配置类型与 catalog 同步收口，宿主配置、权限与会话状态更加统一。

### ServiceSkill、SkillCatalog、SceneApp 本地执行面收口

- `src/lib/api/serviceSkills.ts`、`skillCatalog.ts`、`sceneapp.ts`、seeded package、compat projection 与 Tauri mock 已统一改成“目录控制面 + 本地执行面”模型：`cloud_required`、`cloud_scene` 只再作为历史输入解析，不再冒充当前执行真相。
- `SceneApp` 前后端协议继续收口到 `agent_turn / browser_assist / automation_job / native_skill / cloud_scene(compat)` 同一套 current 分层；planner、launch、presentation、catalog、review、run-entry navigation 与 Rust `sceneapp/*` runtime / governance / dto / adapters 一并对齐。
- `serviceSkillRuns.ts` 与 `cloudRunStorage.ts` 已移除，`useWorkspaceServiceSkillEntryActions.ts` 不再依赖云端 run/poll 主链；`service-skills/storage.ts`、`mentionEntryUsage.ts` 改为带 changed event / subscribe 的最近使用与实时回流，避免“执行完成但入口状态不刷新”的断层。
- `@命令`、`ServiceSkill`、`SceneApp` 与 seeded base-setup 包的兼容投影继续减少双轨：旧云会话命名仅保留 compat 入口，当前前台与执行链统一表达为本地即时执行或可恢复的真实业务入口。

### 工作台 IA、页面与桌面壳更新

- 侧边栏、导航与首页信息架构已重组为 `任务 / 能力 / 资料 / 系统` 主分区，`生成 / 我的方法 / 创作场景 / 持续流程 / 资料库 / 灵感库` 等工作台入口重新编排；插件中心、OpenClaw、桌宠等历史系统入口改为可配置隐藏而非默认暴露。
- `SkillsWorkspacePage`、聊天空状态、聊天侧栏、卡片区和输入区围绕“最近继续、推荐理由、输出去向、下一步动作、结果复盘”重写前台文案与布局，技能启动、精选任务与最近入口更贴近当前产品语义。
- `SceneAppsPage`、`SceneAppsCatalogPanel`、`SceneAppDetailPanel`、`SceneAppRunDetailPanel`、scorecard / governance / workflow rail 继续产品化，前台口径改成 `做法目录 / 生成准备 / 做法复盘`，同时补齐最近访问、一键继续、运行复盘与回到真实业务入口的链路。
- `ResourcesPage` 从“管理式资料页”收口到“浏览 / 打开 / 切换”主链，查询逻辑抽到 `services/resourceQueries.ts`，去掉 store selectors 和创建文件夹/文档主路径，补上分类、分页、排序、面包屑与空态表达。
- `MemoryPage`、`ImageGallery`、`VideoWorkspace`、`StartupLoadingScreen`、`main.tsx`、`index.html`、i18n patch 与 `Appearance` 设置页一并更新，启动壳、轻量 renderer 注册与首屏体验更统一。

### 自动化、开发脚本与工程支撑同步

- `settings-v2/system/automation`、`serviceSkillContext`、`useAutomationSceneAppRuntime` 与相关测试同步更新，把自动化详情、SceneApp runtime 引用和 ServiceSkill 语义进一步接回同一条主链。
- 开发与启动脚本已补齐新的本地壳流程：新增 `scripts/start-tauri-dev-server.mjs`、`scripts/lib/vite-dev-server-bootstrap.mjs`，并更新 `start-web-bridge-dev.mjs` 与 `vite.config.ts`，让 Tauri 壳与 Web bridge 共用更稳定的 dev server bootstrap。
- 前后端回归与契约测试同步扩充，`AppSidebar`、`EmptyState`、`SkillsWorkspacePage`、`SceneAppsPage`、`ResourcesPage`、`serviceSkillContext`、`resourceQueries`、`agentChatWorkspaceLoader` 等相关测试文件一起更新，保证页面重构和执行语义调整有稳定断言。

### 文档、路线图与治理同步

- 工程文档、执行计划与路线图已整体更新到最新事实源：`command-runtime`、`commands`、`quality-workflow`、`playwright-e2e`、`skill-standard`、`limecore-collaboration-entry`、`limenext-progress`、`upstream-runtime-alignment-progress`、`tech-debt-tracker`、`exec-plans/README`、`lime-service-skill-cloud-config-prd` 等文件已同步收口。
- 新增 `docs/exec-plans/at-command-local-execution-alignment-plan.md`，把 `@命令` 本地执行面纠偏明确落为可追踪计划；现有文档口径统一强调“目录控制面 + 本地执行面”，并继续追踪 compat 旧命名与历史锚点的退出路径。

### 版本、发布物与同步项

- 应用版本入口已对齐到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`。
- CLI npm wrapper 与发布示例已同步到 `1.16.0`。
- `package-lock.json`、`src-tauri/Cargo.lock` 与校验结果以本次最终验证通过的状态为准。
- 本说明按当前整批待提交文件重新整理，覆盖运行时、前台、脚本、文档与版本同步内容，而不是仅记录版本号变更。



### 已执行校验

- `npm run verify:app-version`：通过
- `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`：已执行
- `env CARGO_TARGET_DIR="/tmp/lime-release-1.16.0-test" cargo test --manifest-path "src-tauri/Cargo.toml"`：通过，主库 `1010` 条单测通过，额外 `2` 条集成测试通过；另有 `2` 条真实联网用例按默认配置保持 `ignored`
- `env CARGO_TARGET_DIR="/tmp/lime-release-1.16.0-test" cargo clippy --manifest-path "src-tauri/Cargo.toml"`：通过，当前保留 `1` 条 clippy 告警，位于 `src-tauri/crates/skills/src/lime_llm_provider.rs:255`（`clippy::too_many_arguments`）
- `npm run lint`：通过

---

**完整变更**: `v1.15.0` -> `v1.16.0`

### v1.16.0 同版重发补充（2026-04-22）

- 修复 macOS 发布包在 `tauri://localhost` 协议下首屏样式注入不稳定的问题，避免 `styled-components` 运行时触发 `#17` 崩溃并导致窗口样式错乱。
- `index.html` 现在会在应用脚本加载前显式设置 `SC_DISABLE_SPEEDY`；`src/lib/styledRuntime.ts` 新增运行时诊断与 fallback stylesheet 同步逻辑，在 Tauri 发布包里改走稳定的 `data:` stylesheet 回退，而不是继续依赖失效的动态 `<style>` 注入。
- `src-tauri/tauri.conf.json` 与 `src-tauri/tauri.conf.headless.json` 已补齐 `style-src` 对 `data:` / `blob:` 的允许项，保证 fallback 样式表可在发布构建中加载。
- 本地已重新验证安装包覆盖后的 `Lime.app` 可正常打开，之前出现的“窗口打开后布局完全错乱/无样式”问题已消失。
- 本轮同版重发前额外复核：
  - `npm run verify:app-version`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"`
  - `cargo clippy --manifest-path "src-tauri/Cargo.toml"`
  - `npm run lint`
  - `npm run verify:gui-smoke`
