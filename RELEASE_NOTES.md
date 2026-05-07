## Lime v1.30.0

发布日期：`2026-05-08`

### 发布概览

- 本次发布按当前准备递交的完整暂存内容编写，范围包括版本发布、Skill Forge 主线、只读 HTTP/API 能力草案、Agent Runtime / Evidence Pack、Knowledge v2、AI 图层化设计、GUI 页面与质量脚本；机密执行计划不进入发布提交。
- 应用版本从 `1.29.0` 升级到 `1.30.0`，同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`、`packages/lime-cli-npm/package.json` 与 `@limecloud/lime-cli` 发布示例。
- `CREAOAI` 相关 research、roadmap 与 exec plan 已收口为 `Skill Forge` 命名，并同步导航、路线图、执行计划和治理文档，减少旧命名与 current 主线并存。
- 本版继续坚持 current-first：capability draft、registered skill、runtime binding、Query Loop metadata、runtime enable、Evidence Pack、Knowledge 与 Layered Design 都回到仓库内单一事实源，不新增 legacy / compat 平行执行入口。

### 用户可见更新

#### 1. Skill Forge 与能力沉淀闭环

- 新增并落地 `Skill Forge` 研究、路线图、架构图与产品原型入口，替换旧 `docs/research/creaoai` 与 `docs/roadmap/creaoai` 命名。
- Capability Draft 主线从 authoring、verification、registration、registered discovery、runtime binding、Query Loop metadata、runtime enable 延伸到 managed agent envelope 与 prompt-to-artifact smoke。
- Skills 工作台与 Workspace Registered Skills 面板展示更完整的 registered skill provenance、binding readiness、Agent envelope draft、automation draft、approval request 与 session gate 状态。
- “本回合启用”继续只走 `agent_runtime_submit_turn` metadata + SkillTool allowlist，不创建 marketplace、scheduler 或平行 runtime command。
- Managed Job / Agent Envelope 草案只在 evidence 与 owner audit 满足条件时进入可转化语义，避免把“已注册 / 已发现 / 已校验”误读成“已自动执行”。

#### 2. 只读 HTTP/API 能力草案

- Capability Draft verification 增加只读 HTTP/API gate：fixture input、fixture 文件、expected output、dry-run 入口、expected-output binding、offline dry-run、no-credentials、session authorization policy、credential reference 与 execution preflight。
- 新增只读 HTTP/API authoring 模板与 smoke：`scripts/lib/readonly-http-api-draft-template.mjs`、`scripts/readonly-http-api-smoke.mjs`，统一正向样例和负向 gate 样例。
- 注册摘要新增 `verification_gates` 与 `approval_requests`，把 passed preflight provenance 投影到 registered discovery 与 Workspace 面板，而不是发起真实 HTTP。
- Approval artifact 新增 consumption gate、credential resolver、consumption input schema、session input intake、submission contract、dry preflight plan 与 controlled GET preflight。
- 新增 session 输入提交与受控 GET 执行命令：`capability_draft_submit_approval_session_inputs`、`capability_draft_execute_controlled_get`；受控 GET 仅允许一次性 session 输入、GET 方法、非敏感 evidence 与 request / response hash。
- loopback / localhost 受控 GET 测试绕过系统代理，避免本地 fixture 被代理环境污染。

#### 3. Prompt-to-Artifact 与证据闭环

- 新增 `scripts/prompt-to-artifact-smoke.mjs`，通过 DevBridge 串联 `create -> verify -> register -> list_registered_skills -> list_workspace_skill_bindings`，输出结构化 smoke summary。
- Prompt-to-Artifact smoke 记录结构化样例证据，明确 demo / smoke / evidence 不扩展 P4 runtime，也不打开 scheduler、queue 或 Marketplace。
- Evidence Pack completion audit 纳入受控 GET evidence 计数、执行状态分布、owner run、Workspace Skill ToolCall 与 artifact evidence；单一成功 run 不再被当成 completed。
- Runtime evidence summary、`runtime.json`、`artifacts.json`、`summary.md` 与前端 normalizer 消费同一份 completion audit 结构。

#### 4. Agent Runtime、聊天与执行可靠性

- Agent Chat 补齐 session state、history、timeline、thread reliability、stream runtime handler、text delta controller、action request A2UI、internal artifact visibility 与 task runtime 回归。
- 新增 `runtimeActionConfirmation` 与更稳定的 runtime action / permission confirmation 展示，避免把被拒绝的权限确认误写成成功证据。
- Agent thread timeline、reliability panel、ChatSidebar、Inputbar runtime status line 与 MessageList 对排队任务、内部 artifact、action request 和线程读模型状态的展示更一致。
- Execution run command、agent run DAO、execution tracker 与 runtime evidence service 补齐 owner metadata、status history 和 review / analysis handoff 证据链。
- `agent_runtime_export_evidence_pack`、analysis handoff、review decision template、review decision save 与 replay case 的前端 API 回归继续走统一 `agent_runtime_*` 命令面。

#### 5. Knowledge、Memory 与工作区页面

- 新增 `docs/roadmap/knowledge/prd-v2.md` 与可视化图，明确 Knowledge v2 采用 Skills-first、persona / data 双族、Builder Skill、KnowledgePack resolver 与 context run 证据链。
- 新增 `docs/knowledge/skills/personal-ip-knowledge-builder` 内置 Builder Skill 包，包含 `SKILL.md`、OpenAI agent 配置、个人 IP 知识骨架、访谈问题、模板、质量清单与 `docx_to_markdown.py` 转换脚本。
- Knowledge Rust crate 与前端 API 扩展 pack metadata、primary document、compile run、runtime mode、fenced context、source anchors、context resolver warning 与 context run validation。
- Knowledge GUI smoke 与 DevBridge mock 对齐 `knowledge_*` current 命令，页面回归覆盖 pack label、visibility 与默认工作区准备态。
- Memory 页面更新任务建议、灵感投影、工作区入口和状态文案；Scene Apps 页面、详情、运行列表、scorecard、governance 与 project pack runtime 面板做了大范围结构整理和回归。
- Sidebar、Skills Workspace、Workspace Canvas 与 Scene Apps 测试补齐导航、页面状态和主路径可见性断言。

#### 6. AI 图层化设计与 Design Canvas

- Layered Design 新增 structured analyzer、native analysis API、model slot config/runtime/transport、provider capability gate 与 worker-first analyzer 组合能力。
- 新增 subject matting、clean plate、text OCR、structured analyzer worker、worker client、heuristic worker seam 与 deterministic fallback，支持 mask、clean plate、TextLayer 与候选层质量评估。
- Design Canvas 增加扁平图拆层、候选确认、extraction quality、PSD / zip export、artifact 写回、worker 状态、model slot readiness 与 native analyzer fallback 的可见主路径。
- Tauri `layered_design_*` 命令、前端 `layeredDesignAnalysis` API、browser mock、`DesignCanvas.test.tsx` 与 `design-canvas-smoke` 同步更新，减少 UI、mock 与 Rust command 漂移。
- `src-tauri/Cargo.toml` / `Cargo.lock` 同步 `image` 相关依赖，用于图层分析与导出链路。

### 开发者与治理更新

#### 1. 命令边界、Mock 与 Contract

- Capability Draft、Agent Runtime、Knowledge、Layered Design、DevBridge dispatcher、`mockPriorityCommands`、`defaultMocks` 与 `agentCommandCatalog` 按本轮新增命令和返回结构同步。
- `src/lib/api/capabilityDrafts.ts` 扩展大量 snake_case / camelCase normalizer，覆盖 verification evidence、approval requests、session input、dry preflight、controlled GET preflight 与执行结果。
- `src/lib/tauri-mock/core.ts` 和相关测试对齐无后端 GUI 预览，避免浏览器模式把未满足 gate 的能力显示为假通过。
- `src/lib/base-setup` 的 service skill catalog projection / seeded package / adapter 更新 Skill Forge 与 Service Skill 口径。

#### 2. 质量脚本与发布管线

- `scripts/check-app-version-consistency.mjs` 已把 `packages/lime-cli-npm/package.json` 纳入版本一致性检查，防止 npm wrapper 版本再次落后于应用版本。
- `scripts/quality-task-planner.mjs` 把 npm wrapper package 纳入 integrity 文件；版本、配置或依赖变化会触发对应本地质量任务。
- `scripts/run-vitest-smart.mjs`、GUI smoke 脚本、Knowledge smoke、Agent runtime tool surface smoke 与 Design Canvas smoke 更新，覆盖本轮新增 GUI / command 风险。
- `AGENTS.md`、`docs/aiprompts/commands.md`、`docs/aiprompts/quality-workflow.md`、`docs/aiprompts/skill-standard.md` 与文档索引同步 Skill Forge、只读 HTTP/API、Knowledge v2 和 Layered Design 的 current 边界。

### 已知边界

- Workspace skill binding readiness 仍不等于自动注入 tool surface；只有显式 runtime enable 且通过 allowlist 的 binding 才能进入当前 session 的 SkillTool gate。
- 只读 HTTP/API 草案仍是受控能力：verification / registration / approval artifact / session input / controlled GET evidence 不保存 endpoint、token 或 response preview，也不代表技能已进入自动运行面。
- Session credential resolver 只声明 session scope 与引用边界，不读取、不存储、不注入 secret material。
- AI 图层化设计仍以本地图层文档、worker 处理、候选层复核、导出和 artifact 写回为主；provider-backed PSD / mask / inpaint 能力仍受 model slot readiness 与 capability gate 约束。

### 校验状态

- 已完成校验：
  - `npm run verify:app-version`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `npm run lint:rust`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"`
  - `npm run lint`
  - `npm test`
  - `npm run test:contracts`
  - `npm run verify:local`
  - `git diff --check`
- 结果说明：
  - 版本一致性检查通过：`1.30.0`，包含 npm wrapper 版本一致性。
  - Rust fmt 通过。
  - Rust clippy 通过；当前仍有 `lime-knowledge` 的 `clippy::too_many_arguments` 既有警告，但脚本退出码为 0。
  - Rust 测试通过：`1273` 个 lib 测试通过，`deepseek_reasoner_output_schema_runtime` 2 个集成测试通过，2 个真实联网测试按环境变量门禁保持 ignored。
  - 前端 lint、typecheck 与 Vitest smart suite 通过，`npm test` 共 51 批通过。
  - 命令契约、Harness 契约、modality runtime contract 与 cleanup report contract 通过。
  - `npm run verify:gui-smoke` 通过：复用 headless Tauri / DevBridge，覆盖 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface、Knowledge GUI 与 Design Canvas smoke。

---

**完整变更**: `v1.29.0` -> `v1.30.0`
