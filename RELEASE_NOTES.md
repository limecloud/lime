## Lime v1.31.0

发布日期：`2026-05-08`

> 发布说明：GitHub 上一版为 `Lime v1.30.0` Release（tag `v1.30.0` 指向 `28b2a751104a3aa982fdca50f5058aed7db9fee1`）。本版按完整 worktree 递交范围整理 `v1.31.0` release notes，并与 `v1.31.0` tag / GitHub Release 口径保持一致。

### 发布概览

- 本次发布按当前准备递交的完整 worktree 编写，范围包括版本发布、Skill Forge 主线、只读 HTTP/API 能力草案、Agent Runtime / Evidence Pack、Knowledge v2、AI 图层化设计、GUI 页面与质量脚本；机密执行计划不进入发布提交。
- 应用版本从 `1.30.0` 升级到 `1.31.0`，同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`、`packages/lime-cli-npm/package.json` 与 `@limecloud/lime-cli` 发布示例。
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
- `docs/knowledge/谢晶_个人IP知识库v1.0_深澜智能.md` 已作为个人 IP golden sample 完成本地质量基线审计，覆盖 999 行、19 个章节与 15 项质量关键词，用于后续真实 Provider 输出人审对照。
- 新增内置 `src-tauri/resources/default-skills/personal-ip-knowledge-builder` Builder Skill 包，包含 `SKILL.md`、OpenAI agent 配置、个人 IP 知识骨架、访谈问题、模板、质量清单与 `docx_to_markdown.py` 转换脚本。
- `personal-ip-knowledge-builder` 模板根据 golden sample 审计补充“平台迁移与新赛道判断”“技术、AI 与效率判断”和 AI / 自动化 / 智能体效率能力，避免真实成品只停留在履历流水账。
- 新增内置 `src-tauri/resources/default-skills/brand-persona-knowledge-builder` Builder Skill 包，包含 `SKILL.md`、`agents/openai.yaml`、品牌人设模板、访谈问题和质量检查表，补齐 persona 族的品牌人设知识库生产工艺。
- 新增内置 data Builder Skill：`brand-product-knowledge-builder`、`organization-knowhow-knowledge-builder`、`growth-strategy-knowledge-builder`、`content-operations-knowledge-builder`、`private-domain-operations-knowledge-builder`、`live-commerce-operations-knowledge-builder`、`campaign-operations-knowledge-builder`，每个包都包含 `SKILL.md`、`agents/openai.yaml`、章节模板和质量检查表。
- `knowledge_compile_pack` 对个人 IP、品牌人设与七类 data pack 已接入 Runtime Binding seam：命令层按 metadata 生成 Builder Skill 运行计划并调用 `execute_named_skill`，成功时写回 `KnowledgeBuilderSkillOutput` 与 `runtimeBinding.executed=true`，失败时记录真实 `attempted/status/error` 并回退 deterministic adapter；未知或历史 pack 才继续保持 `knowledge_builder` compat provenance。
- Knowledge v2 已完成一次真实 Provider E2E：DevBridge 通过 `custom-da3283c4-8405-45e9-81cd-12991ffdf41c` / `claude-sonnet-4-6` 调用 `personal-ip-knowledge-builder`，产出 `documents/`、`compiled/index.json`、25 个 document-first splits 和 persona fenced context；同时修复模型返回不严格 JSON fence 时把 wrapper 写入主文档的问题，改为宽容提取 `primaryDocument.content`。
- 新增 `npm run knowledge:provider-e2e`，把真实 Provider E2E 固化为可复用脚本；脚本支持 `--list-providers` 输出脱敏摘要，且必须显式传 `--allow-external-provider` 才会调用外部模型。
- 新增 `npm run knowledge:release-scope-report`，以只读方式报告 dirty worktree 中 Knowledge-only 候选、明确非 Knowledge 改动和未知项，并把本次审计结果保存到 `docs/roadmap/knowledge/evidence/release-scope-report-20260508.json`。
- `knowledge_compile_pack` 现在会从 `documents/<doc>.md` 派生 `compiled/splits/<doc>/` 与 `compiled/index.json`，Resolver 与 API `compiledView` 优先消费 document-first splits；前端回归、DevBridge mock 和 Knowledge GUI smoke 已退出 `compiled/brief.md` current 路径，新 pack 不再写入 `compiled/brief.md`，旧 `compiled/brief.md` 仅保留为历史 pack fallback，命中时会产生迁移 warning，重新整理后会删除旧 brief 并回到 splits。
- 新增 `npm run knowledge:legacy-fallback-report`，可扫描指定 workspace 的 `.lime/knowledge/packs`，列出仍依赖旧 `compiled/brief.md` fallback 或同时残留 stale brief 的历史 pack，为最终删除 fallback 提供清单。
- `knowledge_resolve_context` 增加 persona/data 与多 pack 运行时语义：persona pack 优先注入应用指南、金句、性格、价值观等核心人设切片；`1 persona + N data` 会按 persona 先、data 后合并 fenced wrapper，并在 context run 记录多个 `activated_packs`。
- 知识页和输入框的整理请求 metadata 已按 pack type 选择 Builder Skill：个人 IP、品牌人设与七类 data pack 指向内置 `agent-skill`，未知 pack 才保留 deprecated `knowledge_builder` compat。
- Knowledge GUI 补齐初始 pack 选择、输入框资料中枢、File Manager 资料导入和 Agent 结果回填路径，`knowledge_compile_pack` 在 DevBridge 下保留 Builder Skill 长请求窗口，避免真实整理任务被短超时误杀。
- Deprecated `knowledge_builder` 已收口为 v1.2.0 compat delegate：标准 pack 类型只提示委托专用 Builder Skill，未知 / 历史 pack 只允许输出最小 document-first `KnowledgeBuilderSkillOutput`，不再维护 `wiki/` 或 `compiled/brief.md` 模板；frontmatter 同步补齐 `license: Apache-2.0` 与 `compatibility.agentKnowledge: ">=0.6.0"`。
- 项目资料类型选择和文本资料推断新增运营类知识库：`content-operations`、`private-domain-operations`、`live-commerce-operations`、`campaign-operations`；data pack 用于生成时会自动携带一个 ready persona pack，输入框资料中枢和 KnowledgePage chooser 都可显式追加 N 个 ready data pack，支持 `1 persona + N data` 的可见 metadata 闭环。
- Knowledge Rust crate 与前端 API 扩展 pack metadata、primary document、compile run、Builder runtime options、runtime mode、fenced context、source anchors、context resolver warning 与 context run validation。
- Knowledge GUI smoke 与 DevBridge mock 对齐 `knowledge_*` current 命令，页面回归覆盖 pack label、visibility 与默认工作区准备态。
- Memory 页面更新任务建议、灵感投影、工作区入口和状态文案；Scene Apps 页面、详情、运行列表、scorecard、governance 与 project pack runtime 面板做了大范围结构整理和回归。
- Sidebar、Skills Workspace、Workspace Canvas 与 Scene Apps 测试补齐导航、页面状态和主路径可见性断言。

#### 6. AI 图层化设计与 Design Canvas

- Layered Design 新增 structured analyzer、native analysis API、model slot config/runtime/transport、provider capability gate 与 worker-first analyzer 组合能力。
- 新增 subject matting、clean plate、text OCR、structured analyzer worker、worker client、heuristic worker seam 与 deterministic fallback，支持 mask、clean plate、TextLayer 与候选层质量评估。
- Design Canvas 增加扁平图拆层、候选确认、extraction quality、PSD / zip export、artifact 写回、worker 状态、model slot readiness 与 native analyzer fallback 的可见主路径。
- 图像任务与画布主链新增 agent protocol / preview metadata 贯通：图片生成 Skill、media task 命令、CanvasFactory、Workspace Canvas 与 layered-design image task 可共享更稳定的来源、预览和交付状态。
- Tauri `layered_design_*` 命令、前端 `layeredDesignAnalysis` API、browser mock、`DesignCanvas.test.tsx` 与 `design-canvas-smoke` 同步更新，减少 UI、mock 与 Rust command 漂移。
- 新增 AI 图层化设计真实样张、benchmark、PSD / Photopea 互通证据、completion evidence 与人工 review rubric；本地 smoke 可验证真实工程导出、质量报告和设计工具打开链路。
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
- 新增 `docs/aiprompts/agent-protocol-standards-map.md`，把 Agent Protocol / A2UI / runtime metadata / artifact evidence 的 current 事实源集中映射，降低 GUI、Tauri 命令和 mock 漂移风险。
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
  - 版本一致性检查通过：`1.31.0`，包含 npm wrapper 版本一致性。
  - Rust fmt 通过。
  - Rust clippy 通过；当前仍有 `lime-media-runtime` 的 `clippy::result_large_err` 警告，但脚本退出码为 0。
  - Rust 测试通过：`1277` 个 lib 测试通过，`deepseek_reasoner_output_schema_runtime` 2 个集成测试通过，2 个真实联网测试按环境变量门禁保持 ignored。
  - 前端 lint、typecheck 与 Vitest smart suite 通过，`npm test` 共 51 批通过。
  - 命令契约、Harness 契约、modality runtime contract 与 cleanup report contract 通过。
  - `npm run verify:gui-smoke` 通过：复用 headless Tauri / DevBridge，覆盖 workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface、Knowledge GUI 与 Design Canvas smoke。

---

**完整变更**: `v1.30.0` -> `v1.31.0`
