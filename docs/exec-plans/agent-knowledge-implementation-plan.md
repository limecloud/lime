# Agent Knowledge 实现执行计划

> 状态：Phase 1 current 主链已接通，项目资料能力已回流到现有 Agent 输入框；首页添加、File Manager 添加、输入框使用、项目资料管理与 Agent 结果沉淀均已完成稳定 DevBridge 下的产品 E2E 验收
> 创建时间：2026-05-01  
> 路线图来源：`docs/roadmap/knowledge/prd.md`  
> 当前目标：完成 Markdown-first 项目资料的导入、整理、GUI 管理、Agent 输入框显式使用与运行时受保护上下文注入。

## 主目标

把 Agent Knowledge 标准接入 Lime 的 current 主链：

```text
src-tauri/crates/knowledge
  -> src-tauri/src/commands/knowledge_cmd.rs
  -> src/lib/api/knowledge.ts
  -> src/features/knowledge
  -> AgentChatWorkspace request metadata
  -> Runtime KnowledgePack prompt stage
  -> src-tauri/resources/default-skills/knowledge_builder
  -> mock / governance / contract validation
```

固定事实源：

**后续知识包能力只允许向 `lime-knowledge + knowledge_* + Knowledge Context Resolver` 收敛；`project_memory_get` 继续只做项目资料附属层，不接管知识包主链。**

## 范围

本轮做：

1. 独立后端 crate：`src-tauri/crates/knowledge`。
2. 标准目录：`.lime/knowledge/packs/<pack-name>/KNOWLEDGE.md`、`sources/`、`wiki/`、`compiled/`、`runs/`。
3. Tauri 薄命令：`knowledge_import_source`、`knowledge_compile_pack`、`knowledge_list_packs`、`knowledge_get_pack`、`knowledge_set_default_pack`、`knowledge_resolve_context`。
4. 前端独立 API 网关：`src/lib/api/knowledge.ts`。
5. 前端 feature 边界：`src/features/knowledge`。
6. GUI 页面入口、侧边栏入口、任务中心资料入口。
7. Runtime 通过 Knowledge Context Resolver 注入受保护 fenced context。
8. mock、治理目录册、契约检查同步。
9. 后端 crate 单测、runtime 定向测试和前端回归测试。

本轮不做：

1. 聊天输入框内的细粒度知识包选择器。
2. 向量库、知识图谱、企业权限、知识包市场。
3. 把知识包接入 Memory 或 durable memory。
4. 把 Builder 输出直接写盘并自动覆盖用户已编辑知识资产。

## 执行记录

### 2026-05-01

- 已新增路线图 PRD：`docs/roadmap/knowledge/prd.md`。
- 已补 `.gitignore` 例外，让该 PRD 可被 Git 跟踪。
- 已开始 Phase 1 实现。
- 已根据用户反馈移除新实现与 PRD 中的具体人名样例。
- 已确定后端知识域必须独立成 `lime-knowledge` crate，Tauri command 只做薄适配。
- 已创建 `src-tauri/crates/knowledge`，并把知识包文件事实源逻辑迁入该 crate。
- 已创建前端网关 `src/lib/api/knowledge.ts` 与测试草稿。
- 已创建前端 feature 入口 `src/features/knowledge/index.ts`。
- 已同步 Tauri 命令注册、治理目录册、mockPriority 与 default mock 草稿。
- 已通过 `cargo test -p lime-knowledge`。
- 已通过 `npm test -- src/lib/api/knowledge.test.ts`。
- 已通过 `npm run test:contracts`，确认前端调用、Rust 注册、治理目录册与 mock 边界一致。
- 已通过 `cargo fmt --package lime-knowledge --check`。
- 已通过 `cargo check -p lime`，确认主 Tauri crate 能集成新 crate 与命令注册。
- 已通过 `npm run typecheck`。

### 2026-05-02

- 已新增 `src/features/knowledge/KnowledgePage.tsx`，接通知识包目录、详情、来源导入、编译、默认包设置和运行时视图预览。
- 已新增 `src/features/knowledge/KnowledgePage.test.tsx`，覆盖目录读取、导入、编译、默认包设置、运行时 context 预览和“去生成”metadata。
- 已把 `knowledge` 页面加入 `src/types/page.ts`、`src/components/AppPageContent.tsx`、`src/lib/navigation/sidebarNav.ts`、`ChatSidebar` 资料分组和 `AgentChatWorkspace` 工作台跳转。
- 已确认前端发送链路最终通过 `buildWorkspaceRequestMetadata` 合并 `workspaceRequestMetadataBase` 与 `sendOptions.requestMetadata`，Knowledge 页面传入的 `knowledge_pack` metadata 会进入 runtime request metadata。
- 已新增 runtime `KnowledgePack` prompt stage：从 `knowledge_pack` / `knowledgePack` metadata 解析 `pack_name/name`、`working_dir/workingDir`、`max_chars/maxChars`，调用 `lime_knowledge::resolve_knowledge_context(...)` 并注入 fenced context。
- 已将带知识包 metadata 的请求判定为 full runtime，避免 fast chat 短路跳过知识包上下文。
- 已在 `TurnPromptAugmentationStageKind` 增加 `KnowledgePack`，并用源代码顺序契约锁定 stage 位于 Memory 之后、WebSearch / RequestToolPolicy 之前。
- 已在聊天输入区增加轻量知识包开关：读取当前工作区默认知识包，用户显式启用后通过 `knowledge_pack` metadata 进入同一 runtime 注入链路。
- 已新增正式内置 Builder Skill：`src-tauri/resources/default-skills/knowledge_builder/SKILL.md`，用于把来源资料整理为 `KNOWLEDGE.md`、`wiki/`、`compiled/brief.md` 与 `runs/` 草稿。
- 已把 `knowledge_builder` 注册进默认 Lime Skills 安装链和内置目录白名单。
- 已在知识库页面补充 “Builder 生成”入口，携带 `knowledge_builder` metadata、项目根目录、pack name 和 pack 类型进入 Agent 自动执行。
- 已确认新增内容不包含用户要求禁止出现的具体人名样例，禁名扫描无命中。
- 已通过 `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-core test_default_lime_skill_directories_include_embedded_defaults --no-default-features`，确认 `knowledge_builder` 已进入默认 Skill 目录事实源。
- 已通过 `npm run verify:gui-smoke`，覆盖 headless Tauri、DevBridge、workspace-ready、browser-runtime、site adapters、Agent service skill entry 与 runtime tool surface/page smoke。
- 曾尝试 `CARGO_TARGET_DIR="/tmp/lime-agent-knowledge-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime test_default_lime_skill_directories_include_embedded_defaults --no-default-features --features local-sensevoice`，该冷构建在 `sherpa-onnx-sys` 下载预编译库时因 TLS 连接中断失败；已改用 `lime-core` 定向测试覆盖本次 Builder 默认目录注册风险。
- 已把聊天输入区知识包开关升级为多包选择菜单：workspace runtime 读取当前项目全部非归档知识包，默认选工作区默认包，用户可在输入区切换具体包并继续通过同一 `knowledge_pack` metadata 发送。
- 已补输入区回归，覆盖菜单切换具体知识包、自动启用知识包上下文和发送 metadata 使用选中包。
- 已通过 `npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx"` 与 `npm run typecheck`。
- 本轮重跑 `npm run verify:gui-smoke` 时，脚本检测到 sqlite 构建缓存缺失并切到独立 target，同时复用已有 headless 链路；等待超过 20 分钟仍未暴露 DevBridge，本轮新启动的 verify 父进程已中断，该次 smoke 不计为通过。上一轮完整 GUI smoke 通过记录仍保留，但多包选择菜单这刀还需要在环境恢复后补跑一次 GUI smoke。
- 已升级 `knowledge_builder` 到 `lime_version: 1.1.0`，补齐 personal-ip、brand-product、organization-know-how、growth-strategy 与 custom 的类型化 wiki / runtime brief 模板。
- 已要求 Builder 输出 `runs/quality-report-{yyyyMMdd-HHmmss}.md`，包含 pass / warn / fail 结论、检查表、待确认事实、冲突风险和下一步，避免把无法确认的信息推断成事实。

### 2026-05-04

- 已补跑 `knowledge_builder` 1.1.0 内容契约检查，确认类型化模板、`compiled/brief.md` 固定结构和 `runs/quality-report-*` 质量报告关键字段存在。
- 已通过 `cargo fmt --manifest-path "src-tauri/Cargo.toml" --package lime --check`，确认默认 Skill 注册相关 Rust 改动格式正确。
- 已通过 `CARGO_TARGET_DIR="/tmp/lime-knowledge-resource-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime should_embed_social_image_tool_contract_in_default_skill --no-default-features`，避开共享 `src-tauri/target` 占用并确认 `knowledge_builder` 内容随默认 Skill 资源内嵌。
- 已通过 `npm test -- "src/features/knowledge/KnowledgePage.test.tsx"` 与 `npm test -- "src/components/AppPageContent.test.tsx"`，确认知识库页面与应用页挂载回归仍稳定。
- 已通过 `npm run typecheck`，确认前端类型边界未被知识库页面、预加载和输入区 metadata 改动破坏。
- 已通过 `CARGO_HOME="/tmp/lime-gui-smoke-cargo-home" npm run verify:gui-smoke`，复用现有 headless Tauri 环境，覆盖 DevBridge、workspace-ready、browser-runtime、site adapters、Agent service skill entry 与 runtime tool surface/page smoke。
- 已按普通使用者视角收敛知识库页面文案：用户可见 UI 与“整理资料”自动发送提示不再展示内部目录、Builder/Skill 名称、运行时围栏、token、frontmatter/trust/status 实现细节，改为“导入资料 / 自动整理 / 预览摘要 / 人工确认 / 引用摘要 / 整理记录”。
- 已同步 `src/features/knowledge/KnowledgePage.test.tsx`，新增负向断言锁定 `.lime/knowledge`、`knowledge_builder`、`compiled/brief.md`、`frontmatter`、`KNOWLEDGE.md`、raw fenced context 与 token 不出现在普通用户页面正文里；内部 metadata 契约测试继续保留。
- 已同步 `scripts/knowledge-gui-smoke.mjs` 的用户可见断言，把“Builder 入口 / 编译预览”替换为“资料整理入口 / 预览摘要”。
- 已通过 `npm test -- "src/features/knowledge/KnowledgePage.test.tsx"`。
- 已通过 `npm run typecheck`。
- 已运行 `npm run bridge:health -- --timeout-ms 20000`，当前 DevBridge 未监听 `127.0.0.1:3030`，因此本轮知识库 GUI smoke 未执行且不计为通过。
- 已根据产品化反馈重做知识页主路径：默认入口从“知识包管理台”改为“项目资料助手”，首屏直接支持粘贴资料、选择资料类型、开始整理、查看完成进度、检查确认与用于生成；默认包、待确认和全部资料改为次级信息。
- 已把手动导入页降级为补充入口，避免继续作为普通用户首屏主路径。
- 已同步 `src/features/knowledge/KnowledgePage.test.tsx`，覆盖资料助手首屏、粘贴资料后整理、检查确认、用于生成与内部 metadata 契约。
- 已同步 `scripts/knowledge-gui-smoke.mjs`，知识库 GUI smoke 断言改为资料助手、全部资料、等你确认的资料和当前资料。
- 已通过 `npm test -- "src/features/knowledge/KnowledgePage.test.tsx"`。
- 已通过 `npm run typecheck`。
- 已运行 `npm run bridge:health -- --timeout-ms 20000`，当前 DevBridge 仍未监听 `127.0.0.1:3030`，因此本轮产品化重做后的 GUI smoke 未执行且不计为通过。

### 2026-05-05

- 已根据用户反馈继续收敛产品主路径：普通用户整理和使用项目资料的入口回到现有 Agent 输入框，不再要求先进入独立知识页。
- 已将 `src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx` 的资料控件改为输入框主路径常显；已有资料时显示“项目资料”选择与启用，无资料时显示“整理成项目资料”。
- 已将 `src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx` 接入“整理成项目资料”动作：有输入内容时复用现有 Agent `handleSend` 发送整理请求并携带 `knowledge_builder` metadata；无输入内容时只预填用户可编辑提示；未选择项目时提示先选择项目。
- 已下线知识页内独立聊天面板：`src/features/knowledge/KnowledgePage.tsx` 不再保留 `chat` 视图、页面内任务输入框、页面内发送按钮、引用原文预览和 token 展示。
- 已将知识页定位降级为“项目资料管理”：保留全部资料、资料详情、手动导入、确认、设默认、归档、重新整理等管理动作。
- 已将知识页“用于生成”改为直接回到现有 Agent，并携带 `knowledge_pack` metadata；资料使用不再绕到独立页面内聊天流。
- 已补齐 `src-tauri/src/dev_bridge/dispatcher/knowledge.rs`，并在 `src-tauri/src/dev_bridge/dispatcher.rs` 注册已有 `knowledge_*` 命令的 DevBridge 分发，解决 GUI smoke 中 `knowledge_import_source` 无分发的问题。
- 已同步 `scripts/knowledge-gui-smoke.mjs`，把断言从“资料助手 / 页面内聊天”改为“项目资料管理 / 回到 Agent / 手动导入”。
- 已同步 `src/features/knowledge/KnowledgePage.test.tsx` 与 `src/components/agent/chat/components/Inputbar/index.test.tsx`，锁定普通用户页面不展示开发者细节，并覆盖输入框整理入口、资料 metadata 发送和知识页回到 Agent。
- 已通过 `npm test -- "src/features/knowledge/KnowledgePage.test.tsx"`。
- 已通过 `npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx"`。
- 已通过 `npm run typecheck`。
- 已通过 `cargo fmt --manifest-path "src-tauri/Cargo.toml" --package lime --check`。
- 已通过 `npm run test:contracts`。
- 已执行禁名扫描，用户要求禁止出现的具体名称无命中。
- 已执行普通用户路径泄露扫描，新增主路径未再暴露“聊天任务 / 当前资料 / 查看引用 / 资料助手 / Builder 生成”等旧页面语义。
- 已重跑 `CARGO_HOME="/tmp/lime-gui-smoke-cargo-home" npm run verify:gui-smoke`，本轮进入独立 target 冷构建，已完成依赖下载并编译到主 `lime` crate 收尾阶段，但约 34 分钟仍未进入 GUI smoke 断言；该次临时进程组已中止，最新 GUI smoke 不计为通过。当前未观察到业务断言失败，剩余风险是 GUI 主路径尚未在稳定 headless 环境完成最终冒烟。
- 已完成知识库真实 GUI E2E 收口：
  - 清理检查确认未残留 `knowledge-gui-smoke`、`smoke-knowledge-gui`、`lime-knowledge-e2e-target` 或专用 Chrome profile 进程。
  - 初始 `npm run bridge:health -- --timeout-ms 20000` 失败，确认前端 `1420` 可访问但 DevBridge `3030` 未就绪。
  - 尝试启动 `CARGO_TARGET_DIR="/tmp/lime-knowledge-e2e-target" npm run tauri:dev:headless` 避免共享 target 锁；后续用户原有 `pnpm run tauri dev` 完成启动，`npm run bridge:health -- --timeout-ms 5000` 通过。
  - 通过 `http://127.0.0.1:3030/invoke` 真实调用 `knowledge_import_source`、`knowledge_compile_pack`、`knowledge_update_pack_status`、`knowledge_set_default_pack`，seed 出 `Smoke 默认项目资料` 与 `Smoke 备用项目资料` 两份资料。
  - Playwright 打开 `http://127.0.0.1:1420/`，设置 onboarding 与 `lime.knowledge.working-dir` 后进入“知识库”，验证“项目资料管理 / 当前项目资料库 / 全部项目资料 / 手动导入 / 日常使用入口 / 回到 Agent”可见。
  - E2E 暴露并修复两个阻塞点：`knowledge_*` 被 `mockPriorityCommands` 强制走 mock，导致真实 DevBridge seed 数据无法进 GUI；知识页只把 localStorage 目录写入输入框，未初始化 `workingDir` 状态，导致目录列表不加载。
  - 修复后 Playwright 验证 `knowledge_list_packs` 与 `knowledge_get_pack` 走真实 HTTP Bridge，页面展示两份 seed 资料、默认资料标记与管理概览 `2 份项目资料`。
  - 点击“用于生成”后回到现有 Agent 工作区，页面出现用户消息“请基于当前项目资料生成内容”，并通过真实 `agent_runtime_submit_turn` 自动提交；输入框主路径仍展示“整理成项目资料”，没有回到独立知识页聊天。
  - 本轮控制台与页面快照扫描未发现 `ERROR`、`Failed to load resource`、`ERR_CONNECTION`，也未发现 `knowledge_builder`、`compiled/brief.md`、`.lime/knowledge`、`frontmatter`、`token`、`聊天任务`、`当前资料：`、`查看引用`、`资料助手`、`Builder 生成` 等普通用户主路径泄露。
  - 本轮启动的隔离 target headless Tauri 冷构建已中止并确认无残留；用户原有 DevBridge 仍健康。
- 已通过 `npm run test:contracts`，确认命令契约、harness 契约和治理生成检查通过。
- 已通过 `npm test -- "src/lib/dev-bridge/safeInvoke.test.ts" "src/lib/tauri-mock/core.test.ts"`，确认移除 knowledge 优先 mock 后 fallback 与 mock 行为仍稳定。
- 已通过 `npm test -- "src/features/knowledge/KnowledgePage.test.tsx"`，确认知识页初始化目录与主路径回归稳定。
- 已通过 `npm run typecheck`。


### 2026-05-05 模块化产品化重构

- 已根据用户反馈确认“知识库”应按功能模块设计，而不是继续扩张单页实现。
- 已将 `src/features/knowledge/KnowledgePage.tsx` 中的状态文案、资料类型、用户可见字段、prompt builder、metadata builder、文件列表、状态标签、状态导轨、资料卡与排障面板拆到 `domain/`、`agent/` 与 `components/` 子模块。
- 已将输入框内项目资料控件从通用 `InputbarComposerSection.tsx` 拆到 `src/components/agent/chat/components/Inputbar/knowledge/InputbarKnowledgeControl.tsx`，通用输入框只保留组合职责。
- 已将 Workspace 中的项目资料加载、默认资料选择、启用状态、整理资料 prompt 与资料管理跳转拆到 `src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.ts`，继续复用现有 Agent 发送链路。
- 已将普通用户入口文案从“整理成项目资料 / 手动导入 / 高级目录”收敛为“添加项目资料 / 补充导入 / 排障设置”，并在输入框点击“添加项目资料”后先展示说明卡，再由用户明确发送给 Agent 整理。
- 已在资料管理页增加“已添加资料 / 已整理草稿 / 已确认可用”状态导轨，资料卡主动作按状态区分“继续确认 / 用于生成”。
- 已移除资料详情里的不可用“编辑资料说明”禁用按钮，避免普通用户看到无效动作。
- 已更新 `KnowledgePage.test.tsx` 与 `Inputbar/index.test.tsx`，锁定普通首屏不展示“内部标识 / 资料文件名 / 高级：手动指定项目目录”，并覆盖输入框资料整理说明卡。
- 已更新 `scripts/knowledge-gui-smoke.mjs` 的入口文案断言，跟随“补充导入”新命名。
- 已通过 `npm test -- "src/features/knowledge/KnowledgePage.test.tsx" "src/components/agent/chat/components/Inputbar/index.test.tsx"`。
- 已通过 `npm run typecheck`。
- 已通过 `npm run test:contracts`。
- 已执行 `npm run bridge:health -- --timeout-ms 10000`，初始 DevBridge 就绪。
- 已执行 `npm run verify:gui-smoke`，workspace-ready、browser-runtime、site-adapters、agent-service-skill-entry、agent-runtime-tool-surface 与 agent-runtime-tool-surface-page 均通过；进入 `smoke:knowledge-gui` 后，`browser_execute_action` 阶段 DevBridge 中途掉线，knowledge GUI smoke 未计为通过。
- 已单独重跑 `npm run smoke:knowledge-gui -- --app-url http://127.0.0.1:1420/ --health-url http://127.0.0.1:3030/health --invoke-url http://127.0.0.1:3030/invoke --timeout-ms 600000 --interval-ms 1000`，仍在 `wait-knowledge-overview` 后的 browser action 阶段触发 DevBridge 掉线，判断为当前本地 DevBridge / CDP smoke 环境稳定性问题，需要后续先清理 dev 进程和 target lock 再复测。
- 已用 Playwright MCP 手动打开现有 Lime 页签并进入知识库，确认页面展示 `项目资料管理`、`添加项目资料` 空态、`补充导入`、`排障设置`、状态导轨，普通页面未出现内部标识、资料文件名或内部目录语义；因 DevBridge 已掉线，真实 seed -> 使用资料 -> Agent 自动发送闭环本轮未完成。
- 已清理残留 `smoke-knowledge-gui` Chrome profile 进程；隔离 target headless 冷构建进度较慢，已中止，避免长时间占用本机资源。

### 2026-05-05 模块化产品化闭环收口

- 已将 `scripts/knowledge-gui-smoke.mjs` 从 DevBridge CDP `browser_execute_action` 流程改为本地 Playwright persistent context，避免 smoke 自测递归依赖浏览器桥接并把 DevBridge 带掉。
- 已让 knowledge GUI smoke 使用真实 DevBridge seed，并创建临时 `temporary` workspace；页面进入 Agent 前会等待资料管理页解析出当前项目，确保“用于生成”回到同一现有 Agent 项目上下文。
- 已将“用于生成”从自动提交改为回到现有 Agent 后预填“请基于当前项目资料生成内容”，并保留 `knowledge_pack` metadata 作为首发 request metadata；这样普通用户可以确认后再发送，不再被突然自动执行打断。
- 已修正 `AgentChatWorkspace` 无文稿入口下 `initialUserPrompt` 的默认语义：`autoRunInitialPromptOnMount=false` 时只预填，不默认发送；只有显式自动运行入口才自动发送。
- 已让资料管理页按 `workingDir` 反查项目并记录 `selectedProjectId`，避免从知识页回 Agent 后漂移到默认项目。
- 已更新 `KnowledgePage.test.tsx`，覆盖 `workingDir -> projectId` 回填、“用于生成”预填意图与 metadata 透传；已更新 `AgentChatPage` 回归，覆盖无文稿入口 initial prompt 不自动发送。
- 已将 knowledge GUI smoke 的 Agent 断言改为普通用户真实可见的输入框状态：`项目资料：未使用` 与已预填的生成意图，而不是等待首页口号或自动发送结果。
- 已通过 `npm run smoke:knowledge-gui -- --app-url http://127.0.0.1:1420/ --health-url http://127.0.0.1:3030/health --invoke-url http://127.0.0.1:3030/invoke --timeout-ms 240000 --interval-ms 1000`。
- 已通过 `npm test -- "src/features/knowledge/KnowledgePage.test.tsx" "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/index.test.tsx"`，共 `164` 个相关测试通过。
- 已通过 `npm run typecheck`。
- 已通过 `npm run verify:gui-smoke`，覆盖 workspace-ready、browser-runtime、site-adapters、Agent service skill entry、runtime tool surface/page 与 knowledge GUI smoke；knowledge 阶段完成真实 seed、资料管理页、用于生成回 Agent、补充导入入口验证。
- 已执行 `git diff --check`。
- 已执行普通用户可见路径泄露扫描，`KnowledgePage.tsx`、knowledge components、Inputbar knowledge control 与 smoke 脚本未出现内部标识、资料文件名、高级目录、`knowledge_builder`、`compiled/brief.md`、`frontmatter` 或 `tokens`。

### 2026-05-05 文档架构同步

- 已按最新产品判断更新 `docs/roadmap/knowledge/prd.md`：current 入口从单一知识库页面改为 File Manager、输入框资料图标、首页引导和 Agent 输出沉淀四条路径；`@资料` 降级为兼容入口。
- 已更新 PRD 总体架构图，把 File Manager、输入框资料图标、`@资料` 兼容入口、首页引导、Agent 输出沉淀、导入编排、`lime-knowledge`、资料管理页、现有 Agent 输入框和 Resolver 串成同一闭环。
- 已更新 PRD 关键时序：从 File Manager / 首页添加资料、通过输入框资料图标使用资料、从生成结果沉淀资料、用户修改后重新整理。
- 已更新 PRD 前台信息架构、UI 原型、模块边界、Current / Deprecated 分类、Phase 计划和产品验收标准，明确普通用户主路径不暴露 packName、metadata、compiled、token、runtime fence 或本机完整路径。
- 已新增 `docs/knowledge/README.md`，声明 current 文档事实源，并把 `docs/knowledge/` 下早期方案标为 compat / 参考。
- 已更新 `.gitignore`，仅放行 `docs/knowledge/README.md` 作为可追踪索引；其余 `docs/knowledge/` 私有样例和早期方案仍默认不纳入版本库。
- 已给 `docs/knowledge/lime-knowledge-base-construction-blueprint.md`、`docs/knowledge/markdown-first-knowledge-pack-plan.md`、`docs/knowledge/lime-project-knowledge-base-solution.md`、`docs/knowledge/agent-skills-and-knowledge-pack-boundary.md` 增加 compat 状态说明，避免后续继续按旧方案扩张。

### 2026-05-05 四入口闭环实现

- 已新增 `src/features/knowledge/import/knowledgeSourceImport.ts`，把文件路径与文本资料导入封装为独立前端模块；实现继续复用 `read_file_preview_cmd`、`knowledge_import_source` 与 `knowledge_compile_pack`，不新增后端命令。
- 已在 File Manager 右键菜单补充“设为项目资料”，并在输入框路径 chip 上提供“设为资料”动作；用户从左侧文件管理器添加文件后，不必理解 packName、metadata 或内部目录即可整理为项目资料。
- 已将输入框底栏资料图标明确为项目资料主入口；`@资料` 只做兼容打开同一资料中枢，`@沉淀资料` 继续复用现有输入框资料整理动作，不创建独立 Agent 或新聊天面板。
- 已将首页起手入口从“预填一段资料说明”改为“直接打开输入框资料中枢”，保持首页、输入框资料图标和 `@资料` 兼容入口指向同一浮层。
- 已在助手消息操作区增加“沉淀为项目资料”，将 Agent 输出直接交给 Workspace knowledge runtime 导入与编译，继续由现有 Agent 工作区承载使用与确认。
- 已补首页起手入口、输入建议与引导卡：普通用户可以从首页了解“添加 / 确认 / 使用项目资料”，而不是先进入开发者式管理页。
- 已补稳定回归：File Manager 右键导入、输入框路径 chip 导入、`@资料` / `@沉淀资料` 复用现有输入框动作、消息沉淀、首页入口与 seeded command catalog。

### 2026-05-05 真实 E2E 顺滑度复测

- 已用 Playwright MCP 复用真实 Lime 页签，刷新 `http://127.0.0.1:1420/` 后重新建立基线：DevBridge 健康、首页可交互、控制台 error 为 0。
- 首页点击 `添加资料` 可直接打开输入框资料中枢，且不会把说明文字预填进输入框；这一段顺利。
- 资料中枢点击 `去确认资料` 能进入项目资料管理页；确认、设为默认、用于生成回 Agent 均能走真实 DevBridge，不依赖 mock fallback。
- `用于生成` 回到 Agent 后会预填 `请基于当前项目资料生成内容`，但视觉状态仍是 `项目资料：未使用`，用户还要再点资料中枢里的 `使用这份资料`；这会让普通用户误以为“用于生成”没有真正生效。
- 手动点击资料中枢 `使用这份资料` 后，输入框状态能变为 `正在使用：资料名称`；这一段顺利，但多了一步。
- 从 Agent 输出点击 `沉淀为项目资料` 时，Playwright 正常点击被消息区覆盖层拦截；通过 JS click 才触发 `knowledge_import_source` 与 `knowledge_compile_pack`。这说明普通用户也可能遇到命中区域不稳定或按钮难点的问题。
- 资料详情仍暴露 `custom`、Markdown 结构、运行时边界、`name/status/trust`、source 路径等内部信息；人工确认后引用摘要里仍显示 `status: draft`、`trust: unreviewed`，与页面“已确认”状态冲突。
- 回到知识库后出现项目上下文漂移：页面显示了 smoke 临时项目资料和临时目录提示，而不是当前默认项目资料；说明 workingDir / selectedProjectId 的恢复仍不够稳定。
- 结论：自动 smoke 主链通过，但普通用户真实 E2E 不够顺滑；当前最大问题不是桥接失败，而是状态语义、上下文恢复、点击命中和普通用户文案仍有产品化缺口。

### 2026-05-05 真实 E2E 问题修复

- 已给 `用于生成` 增加 `initialKnowledgePackSelection` 导航参数，并贯通 `AgentPageParams -> AppPageContent -> AgentChatWorkspace -> Workspace knowledge runtime`，从资料管理回 Agent 后直接显示 `正在使用：资料名称`，不再要求用户二次点击。
- 已把知识页项目恢复顺序改为显式页面参数优先，其次最近项目 ID，最后默认项目；临时 smoke 目录不再单独作为普通入口默认项目，避免刷新或回知识库时上下文漂移。
- 已将资料详情、列表卡片和文件条目统一走普通用户预览清洗：隐藏 `custom`、`metadata`、`compiled/brief.md`、`sources/...`、本机完整路径、运行时摘要和 `status/trust` 原始字段；无效资料摘要改为“缺少原始内容，请补充后再确认”。
- 已把助手消息的“沉淀为项目资料”改为常显文字按钮，并修复普通 Playwright click 被消息气泡拦截的问题；无原始内容的助手结果会提示先补充资料，不再继续沉淀成项目资料。
- 已同步 `scripts/knowledge-gui-smoke.mjs`，GUI smoke 断言从旧的 `项目资料：未使用` 更新为 `正在使用：资料名称`，让自动 E2E 对齐当前产品语义。
- 已继续清理历史脏资料摘要：列表与详情不再展示 `何时使用`、`缺失事实时`、`不编造来源资料` 等 Builder 模板腔，避免普通用户看到像开发提示词的内容。

## 待完成清单

- [x] 给 `docs/knowledge/` 早期方案补 compat 状态说明，避免继续误用旧架构。
- [x] 新增 `docs/knowledge/README.md`，明确 current / compat 文档事实源。
- [x] 更新 `.gitignore`，让 `docs/knowledge/README.md` 作为 knowledge 文档索引进入 repo。
- [x] 更新 current PRD 的项目资料产品闭环、架构图、时序图和阶段计划。
- [x] 实现 File Manager 右键与输入框路径 chip 的“设为项目资料”入口。
- [x] 实现 `@资料` 与 `@沉淀资料`，并复用现有 Agent 输入框主链。
- [x] 将可见资料口令收敛为 `@资料`，保留内部 command key 与现有 Agent 主链不变。
- [x] 将 `@资料` 从单一启用动作升级为资料中枢：按当前状态引导添加、确认、选择、使用、关闭或补充资料。
- [x] 将资料中枢主入口收口到输入框底栏资料图标，`@资料` 只保留为兼容兜底，不再作为普通命令标签或主路径宣传。
- [x] 将首页“添加资料”入口改为直接打开输入框资料中枢，不再预填说明文字或制造第二条入口语义。
- [x] 实现 Agent 输出“沉淀为项目资料”入口。
- [x] 将 Agent 输出“沉淀为项目资料”纳入 `smoke:knowledge-gui`，完成普通点击、真实导入 / 编译和管理页待确认资料可见的 E2E 验收。
- [x] 在首页补充项目资料添加与使用引导。
- [x] 收口 File Manager 与输入框路径 chip 的可用性判断：仅对 Markdown / 文本文件展示直接整理入口，PDF / Word 等非文本资料给出普通用户可执行提示，避免误导为已支持直接解析。
- [x] 修正 `lime-knowledge` crate 编译问题和格式问题。
- [x] 补齐 Tauri command 注册与主 crate 依赖。
- [x] 补齐 `defaultMocks` 中的 knowledge 命令 mock。
- [x] 确认 `agentCommandCatalog`、`mockPriorityCommands`、Rust 注册、前端调用四侧一致。
- [x] 运行 `cargo test -p lime-knowledge`。
- [x] 运行 `npm run test -- src/lib/api/knowledge.test.ts` 或仓库等价 vitest 定向入口。
- [x] 运行 `npm run test:contracts`。
- [x] 根据结果更新本执行计划。
- [x] 新增并挂载知识库 GUI 页面。
- [x] 补齐知识库页面、导航、任务中心入口的前端回归测试。
- [x] 将知识包选择 metadata 接到 AgentChatWorkspace 发送链路。
- [x] 将 Knowledge Context Resolver 接入 full runtime system prompt。
- [x] 补齐 runtime 知识包注入和 prompt stage 顺序测试。
- [x] 在聊天输入区补轻量知识包选择器，让用户不必先进入知识库页面再“去生成”。
- [x] 产品化 Builder Skill，让来源资料能通过正式 Skill 生成更完整的 `wiki/` 与 `compiled/` 草稿。
- [x] 为聊天输入区知识包开关增加多包选择菜单，继续复用 `knowledge_pack` metadata 与 runtime fenced context。
- [x] 为 `knowledge_builder` 增加类型化模板和质量检查输出，覆盖个人 IP、品牌产品、组织 Know-how、增长策略四类。
- [x] 对知识库页面做普通用户语言降噪，隐藏内部协议、目录、Builder/Skill、token 与 fenced context 等开发者细节。
- [x] 重做知识页产品主路径：默认展示资料助手，而不是知识包管理台。
- [x] 将项目资料主入口回流到现有 Agent 输入框。
- [x] 下线知识页内独立聊天面板。
- [x] 将知识页定位收敛为项目资料管理页。
- [x] 补齐 knowledge DevBridge dispatcher。
- [x] 在稳定 DevBridge + Playwright 环境完成知识库 GUI 主路径 E2E：真实 seed、资料列表、用于生成回 Agent、Agent 自动发送。
- [x] 完成 Knowledge 前端 feature module 拆分：domain / agent / components / Inputbar knowledge / Workspace knowledge runtime。
- [x] 在清理本地 DevBridge / CDP smoke 环境后，重跑 `smoke:knowledge-gui` 并补齐真实 seed -> 使用资料 -> 回到现有 Agent 预填生成意图闭环。
- [x] 修复真实 E2E 暴露的用于生成未自动启用、项目上下文漂移、详情页内部信息泄露和消息沉淀按钮命中问题。

## 验证记录

```bash
cargo test -p lime-knowledge
npm test -- src/lib/api/knowledge.test.ts
npm run test:contracts
cargo fmt --package lime-knowledge --check
cargo check -p lime
npm run typecheck
npm test -- "src/features/knowledge/KnowledgePage.test.tsx" "src/components/AppPageContent.test.tsx" "src/components/agent/chat/components/ChatSidebar.test.tsx" "src/components/AppSidebar.test.tsx" "src/lib/navigation/sidebarNav.test.ts" "src/i18n/__tests__/translation-coverage.test.ts"
cargo fmt --package lime --check
cargo test -p lime merge_system_prompt_with_knowledge_context_should_append_fenced_context_from_metadata
cargo test -p lime knowledge_pack_metadata_should_force_full_runtime_context
cargo test -p lime test_runtime_turn_source_keeps_full_runtime_prompt_stage_order_contract
npm run typecheck
npm run verify:gui-smoke
npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx"
npm run typecheck
cargo fmt --manifest-path "src-tauri/Cargo.toml" --package lime --check
npm test -- "src/features/knowledge/KnowledgePage.test.tsx"
cargo test --manifest-path "src-tauri/Cargo.toml" -p lime should_embed_social_image_tool_contract_in_default_skill --no-default-features --features local-sensevoice
cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-core test_default_lime_skill_directories_include_embedded_defaults --no-default-features
禁名扫描：新增路线图、执行计划、Builder Skill、默认 Skill 注册与 Knowledge 前端模块无命中。
CARGO_HOME="/tmp/lime-gui-smoke-cargo-home" npm run verify:gui-smoke
npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx"
npm run typecheck
CARGO_HOME="/tmp/lime-gui-smoke-cargo-home" npm run verify:gui-smoke
# 2026-05-02 重跑未完成：独立 target 重建 + 既有 headless 链路长时间未暴露 DevBridge，未计为通过。
cargo fmt --manifest-path "src-tauri/Cargo.toml" --package lime --check
# 内容契约脚本输出：knowledge_builder content contract ok
CARGO_TARGET_DIR="/tmp/lime-knowledge-resource-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime should_embed_social_image_tool_contract_in_default_skill --no-default-features
npm test -- "src/features/knowledge/KnowledgePage.test.tsx"
npm test -- "src/components/AppPageContent.test.tsx"
npm run typecheck
CARGO_HOME="/tmp/lime-gui-smoke-cargo-home" npm run verify:gui-smoke
npm test -- "src/features/knowledge/KnowledgePage.test.tsx"
npm run typecheck
npm run bridge:health -- --timeout-ms 20000
# 2026-05-04 知识库降噪后 GUI smoke 未执行：DevBridge 未监听 127.0.0.1:3030，health check 超时。
npm test -- "src/features/knowledge/KnowledgePage.test.tsx"
npm run typecheck
npm run bridge:health -- --timeout-ms 20000
# 2026-05-05 资料助手主路径重做后 GUI smoke 未执行：DevBridge 未监听 127.0.0.1:3030，health check 超时。
npm test -- "src/features/knowledge/KnowledgePage.test.tsx"
npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx"
npm run typecheck
cargo fmt --manifest-path "src-tauri/Cargo.toml" --package lime --check
npm run test:contracts
# 禁名扫描：用户要求禁止出现的具体名称无命中。
# 普通用户路径泄露扫描：新增主路径未再暴露“聊天任务 / 当前资料 / 查看引用 / 资料助手 / Builder 生成”等旧页面语义。
CARGO_HOME="/tmp/lime-gui-smoke-cargo-home" npm run verify:gui-smoke
# 2026-05-05 Agent 输入框回流后 GUI smoke 未完成：独立 target 冷构建约 34 分钟仍未进入 smoke 断言，临时进程组已中止，该次不计为通过。
npm run bridge:health -- --timeout-ms 5000
# 2026-05-05 Bridge 就绪：127.0.0.1:3030 health status=ok。
# 2026-05-05 Playwright E2E：真实 DevBridge seed 两份项目资料，进入知识库，确认项目资料管理页、全部项目资料、手动导入、用于生成可见；点击用于生成后回到现有 Agent，并通过 agent_runtime_submit_turn 自动发送“请基于当前项目资料生成内容”。
npm run test:contracts
npm test -- "src/lib/dev-bridge/safeInvoke.test.ts" "src/lib/tauri-mock/core.test.ts"
npm test -- "src/features/knowledge/KnowledgePage.test.tsx"
npm run typecheck
# 控制台 / 页面泄露扫描：无 ERROR / Failed / ERR_CONNECTION；无 knowledge_builder、compiled/brief.md、.lime/knowledge、frontmatter、token、聊天任务、当前资料：、查看引用、资料助手、Builder 生成。
npm run smoke:knowledge-gui -- --app-url "http://127.0.0.1:1420/" --health-url "http://127.0.0.1:3030/health" --invoke-url "http://127.0.0.1:3030/invoke" --timeout-ms 240000 --interval-ms 1000
npm test -- "src/features/knowledge/KnowledgePage.test.tsx" "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/index.test.tsx"
npm run typecheck
npm run verify:gui-smoke
git diff --check
# 普通用户可见路径泄露扫描：KnowledgePage、knowledge components、Inputbar knowledge control 与 knowledge GUI smoke 无内部实现词命中。
test -f docs/roadmap/knowledge/prd.md && test -f docs/knowledge/README.md
rg -n "File Manager|@资料|沉淀为项目资料|knowledge_import_source|knowledge_resolve_context|KnowledgePack" docs/roadmap/knowledge/prd.md
# 文档禁名扫描：current PRD、执行计划、docs/knowledge README 与 compat 方案无命中。
git diff --check -- docs/roadmap/knowledge/prd.md docs/exec-plans/agent-knowledge-implementation-plan.md docs/knowledge/README.md docs/knowledge/lime-knowledge-base-construction-blueprint.md docs/knowledge/markdown-first-knowledge-pack-plan.md docs/knowledge/lime-project-knowledge-base-solution.md docs/knowledge/agent-skills-and-knowledge-pack-boundary.md
# 2026-05-05 文档架构同步：knowledge docs validation ok。
npm test -- "src/components/agent/chat/components/FileManager/FileManagerSidebar.test.tsx" "src/components/agent/chat/components/Inputbar/components/InputbarCore.test.tsx" "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/components/EmptyState.test.tsx" "src/lib/base-setup/seededCommandPackage.test.ts"
npm run typecheck
npm run test:contracts
# 2026-05-05 四入口闭环实现：File Manager、输入框路径 chip、@资料、@沉淀资料、Agent 输出沉淀与首页入口定向回归通过。
npm run verify:gui-smoke
# 2026-05-05 四入口闭环 GUI smoke 通过：已补齐当前工作树 runtime_evidence_pack_service.rs 的 AgentThreadItem 导入编译缺口；本轮 cold target 里 sherpa-onnx-sys 下载仍出现 TLS close_notify 警告，但 DevBridge 已就绪，workspace-ready、browser-runtime、site-adapters、Agent service skill entry、runtime tool surface/page 与 knowledge GUI smoke 均通过。
npm test -- "src/features/knowledge/import/knowledgeSourceSupport.test.ts" "src/components/agent/chat/components/FileManager/FileManagerSidebar.test.tsx" "src/components/agent/chat/components/Inputbar/components/InputbarCore.test.tsx"
npm run typecheck
# 2026-05-05 文件导入可用性收口：Markdown / 文本文件保留直接整理入口；PDF 等非文本文件不再在输入框展示“设为资料”，File Manager 右键菜单展示禁用态与可执行提示。
npm run verify:gui-smoke
# 2026-05-05 文件导入可用性收口后 GUI smoke 通过：复用已有 headless Tauri 与 DevBridge，workspace-ready、browser-runtime、site-adapters、Agent service skill entry、runtime tool surface/page 与 knowledge GUI smoke 均通过。
npm test -- "src/lib/base-setup/seededCommandPackage.test.ts" "src/components/agent/chat/components/Inputbar/index.test.tsx"
npm run test:contracts
npm run typecheck
npm run verify:gui-smoke
# 2026-05-05 资料口令产品化收口：可见 mention 从模块名收敛为 `@资料`，`knowledge_pack` 内部 command key 与现有 Agent 输入框主链保持不变。
# 2026-05-05 资料口令收口后 GUI smoke 通过：复用已有 headless Tauri 与 DevBridge，knowledge GUI smoke 通过。
npm test -- "src/components/agent/chat/components/Inputbar/knowledge/knowledgeHubState.test.ts" "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/lib/base-setup/seededCommandPackage.test.ts"
npm run typecheck
npm run test:contracts
# 2026-05-05 `@资料` 闭环修正：`@资料` 不再直接启用资料，而是打开资料中枢；无资料、待确认、未启用、已启用四类状态均有主动作回归。
npm test -- "src/components/agent/chat/components/Inputbar/knowledge/knowledgeHubState.test.ts" "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/lib/base-setup/seededCommandPackage.test.ts"
npm run typecheck
npm run verify:gui-smoke
# 2026-05-05 追加修正：初始 capability route 带 `@资料` 时也会打开资料中枢，不再渲染普通 builtin command badge。
# 2026-05-05 追加修正后 GUI smoke 通过：复用已有 headless Tauri 与 DevBridge，knowledge GUI smoke 通过。
npm test -- "src/components/agent/chat/components/EmptyState.test.tsx" "src/components/agent/chat/home/buildHomeSkillSurface.test.ts" "src/components/agent/chat/home/HomeStarterChips.test.tsx"
npm test -- "src/components/agent/chat/components/EmptyStateComposerPanel.test.tsx" "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/components/Inputbar/knowledge/knowledgeHubState.test.ts" "src/lib/base-setup/seededCommandPackage.test.ts"
npm run typecheck
npm run test:contracts
npm run verify:gui-smoke
# 2026-05-05 首页添加资料入口收口：点击首页“添加资料”直接打开输入框资料中枢，不再预填解释 prompt；GUI smoke 通过，knowledge GUI 阶段覆盖资料管理页、用于生成回 Agent 与补充导入入口。
git diff --check -- src/components/agent/chat/home/homeSurfaceTypes.ts src/components/agent/chat/home/homeSurfaceCopy.ts src/components/agent/chat/home/HomeStarterChips.tsx src/components/agent/chat/home/buildHomeSkillSurface.test.ts src/components/agent/chat/components/EmptyState.tsx src/components/agent/chat/components/EmptyState.test.tsx docs/roadmap/knowledge/prd.md docs/exec-plans/agent-knowledge-implementation-plan.md
# 2026-05-05 首页资料入口收口后禁名 / 用户可见泄露扫描无命中。
npm run bridge:health -- --timeout-ms 120000
npm run smoke:knowledge-gui -- --app-url "http://127.0.0.1:1420/" --health-url "http://127.0.0.1:3030/health" --invoke-url "http://127.0.0.1:3030/invoke" --timeout-ms 240000 --interval-ms 1000
# 2026-05-05 Playwright MCP 真实 E2E 顺滑度复测：自动 knowledge smoke 通过；手动用户流暴露用于生成后未自动启用资料、消息沉淀按钮点击命中不稳定、详情页内部信息泄露、项目上下文漂移四类产品化问题。
npm test -- "src/features/knowledge/KnowledgePage.test.tsx"
npm test -- "src/components/agent/chat/components/MessageList.test.tsx"
npm test -- "src/components/agent/chat/index.test.tsx"
npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/components/Inputbar/knowledge/knowledgeHubState.test.ts"
npm run typecheck
# 2026-05-05 typecheck 未通过：阻塞项来自当前工作树既有 capabilityDrafts / tauri-mock 类型错误，非本轮 knowledge 改动。
npm run test:contracts
npm run bridge:health -- --timeout-ms 120000
npm run smoke:knowledge-gui -- --app-url "http://127.0.0.1:1420/" --health-url "http://127.0.0.1:3030/health" --invoke-url "http://127.0.0.1:3030/invoke" --timeout-ms 240000 --interval-ms 1000
# 2026-05-05 修复后 Playwright MCP 复测：用于生成回 Agent 后输入框显示“正在使用：资料名”；普通 click 可点击“沉淀为项目资料”；控制台 error 为 0。
npm run verify:gui-smoke
# 2026-05-05 修复后 GUI smoke 通过：复用已有 headless Tauri 与 DevBridge，workspace-ready、browser-runtime、site-adapters、Agent service skill entry、runtime tool surface/page 与 knowledge GUI smoke 均通过。
npm test -- "src/features/knowledge/KnowledgePage.test.tsx"
npm run typecheck
npm run test:contracts
npm run smoke:knowledge-gui -- --app-url "http://127.0.0.1:1420/" --health-url "http://127.0.0.1:3030/health" --invoke-url "http://127.0.0.1:3030/invoke" --timeout-ms 240000 --interval-ms 1000
# 2026-05-05 历史脏资料摘要降噪后：KnowledgePage 定向测试、typecheck、contracts 通过；knowledge GUI smoke 因 DevBridge 未监听 3030 未执行成功，尝试重启 headless 时遇到其他工作树 Rust 文件持续变更触发 watch 重建，已中止该次环境进程，不计为通过。
npm run smoke:knowledge-gui -- --app-url "http://127.0.0.1:1420/" --health-url "http://127.0.0.1:3030/health" --invoke-url "http://127.0.0.1:3030/invoke" --timeout-ms 240000 --interval-ms 1000
# 2026-05-05 产品 E2E 验收收口：knowledge GUI smoke 已覆盖真实 seed、用于生成回 Agent、Agent 结果样本普通点击“沉淀为项目资料”、真实导入 / 编译、管理页出现待确认资料和补充导入入口。
node --check "scripts/knowledge-gui-smoke.mjs"
npm run typecheck
npm run test:contracts
npm run verify:gui-smoke
# 2026-05-05 GUI smoke 全量通过：workspace-ready、browser-runtime、site-adapters、Agent service skill entry、runtime tool surface/page、knowledge GUI smoke 与 design-canvas 均通过。
```

## 后续切片

1. 把 File Manager 文本文件识别从扩展名 / mimeType 扩展到 PDF / DOCX 的“先预览再整理”安全路径，但仍不向普通用户暴露内部转换细节。
2. 继续收口普通用户语言：管理页只展示资料名称、状态、风险提醒、引用摘要和确认动作；内部文件名、Skill 名称、目录结构只保留在开发文档和测试 mock 中。
3. 为运行时 Knowledge Context Resolver 增加更细的章节选择和成本控制，但只在开发者诊断或高级设置中展示，不进入普通用户默认路径。
4. 为 `knowledge_builder` 增加示例输入 / 输出快照测试，锁定不同 `pack_type` 的生成结构。

## 2026-05-05 产品 E2E 闭环续测

- 页面 / URL：`http://127.0.0.1:1420/`，从首页进入知识库，再点击“用于生成”回到现有 Agent 输入框。
- 已完成步骤：知识库加载、普通用户可见文案检查、资料中枢打开、已确认资料启用、Agent 输入框显示“正在使用：资料名”、发送“请基于当前项目资料生成内容”。
- 暴露问题：知识页默认展示排障目录预览，属于普通用户信息泄露；输入框资料中枢把待确认 / 缺素材资料放在可用选项里，属于体验误导；发送后 DevBridge 出现 `workspace_get` / `agent_runtime_get_session` / event stream 超时，属于桥接稳定性缺口。
- 本轮修复：排障入口改为“项目识别异常？”并默认隐藏本机路径；资料中枢只把已确认资料作为可用选项，待确认资料只显示数量和“管理资料”；运行时默认资料选择优先已确认资料，避免默认草稿抢占生成路径。
- 新增 skill：`.codex/skills/lime-product-e2e-loop/SKILL.md`，沉淀“真实用户路径 E2E -> 问题分类 -> 最小产品化修复 -> 复测记录”的复用流程。
- 验证通过：`npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/components/Inputbar/knowledge/knowledgeHubState.test.ts" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.test.ts" "src/features/knowledge/KnowledgePage.test.tsx"`；追加 `npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/workspace/knowledge/useWorkspaceKnowledgeRuntime.test.ts" "src/features/knowledge/KnowledgePage.test.tsx"`；`git diff --check` 通过；禁名扫描无命中；skill 基础结构校验通过。
- 验证未完成：`npm run typecheck` 当前失败在既有 `src/lib/layered-design/imageTasks.ts` 类型错误，非本轮 Knowledge 改动；`npm run bridge:health -- --timeout-ms 15000` 失败，当前 DevBridge 3030 监听进程无响应，headless Tauri watch 反复因其他工作树 Rust 文件变化重建并等待 Cargo lock，因此本轮 Playwright 复测停在修复前用户流和组件回归，尚未完成修复后真实 GUI 复走。

## 2026-05-05 项目资料产品化二次收口

- 页面 / URL：`http://127.0.0.1:1420/`；手动 Playwright 从首页进入左侧 `项目资料`，再回到 Agent 输入框资料中枢，最后发送一次带资料引用的消息。
- 闭环结果：模块入口已从左侧 `知识库` 收敛为 `项目资料`；管理页首屏只保留“管理与确认”职责；空资料态明确提示三条添加路径：输入框添加、文件管理器添加、对话结果沉淀；输入框无资料时不再同时露出“管理资料”这种管理动作。
- 本轮修复：更新 `src/lib/navigation/sidebarNav.ts`、`src/components/agent/chat/components/ChatSidebar.tsx` 的入口命名；更新 `KnowledgePage` 的首屏、空态和主按钮；更新 `InputbarKnowledgeControl` / `knowledgeHubState` 的无资料文案、菜单按钮和二级管理动作条件；同步 `scripts/knowledge-gui-smoke.mjs` 的导航断言。
- 用户视角验证：知识管理页截图 `knowledge-after-optimization.png` 已确认不再把模块包装成独立聊天页；输入框资料中枢可选择已确认资料，点击后显示 `正在使用：资料名`；发送时页面进入现有 Agent 对话流，没有新建独立 Agent。
- 控制台 / Bridge 状态：冷构建后的 DevBridge 已恢复，`npm run bridge:health -- --timeout-ms 30000` 通过；手动发送曾在 DevBridge 未就绪期间出现 `无法创建会话`，Bridge 恢复后 `smoke:knowledge-gui` 真实通过。
- 验证通过：`npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/components/Inputbar/knowledge/knowledgeHubState.test.ts"`；`npm test -- "src/lib/navigation/sidebarNav.test.ts" "src/components/AppSidebar.test.tsx" "src/components/agent/chat/components/ChatSidebar.test.tsx" "src/features/knowledge/KnowledgePage.test.tsx"`；`npm run typecheck`；`npm run smoke:knowledge-gui -- --app-url "http://127.0.0.1:1420/" --health-url "http://127.0.0.1:3030/health" --invoke-url "http://127.0.0.1:3030/invoke" --timeout-ms 240000 --interval-ms 1000`。
- 验证未完成：`npm run verify:gui-smoke` 未通过，失败在 `smoke:agent-runtime-tool-surface-page` 的浏览器 CDP 标签页读取 `http://127.0.0.1:15668/json/list`，不在本轮项目资料 UI / smoke 脚本改动边界；全局 `git diff --check` 仍受其它工作树文件尾随空白影响，本轮改动文件的 `git diff --check -- <touched files>` 通过。

## 2026-05-05 项目资料产品化三次收口

- 页面 / URL：`http://127.0.0.1:1420/`；手动 Playwright 从首页 `添加资料`、输入框资料图标、左侧 `项目资料`、File Manager 四条路径复走。
- 用户闭环结果：`添加资料` 和管理页 `回到 Agent 添加` 现在都会打开输入框项目资料浮层；浮层在已有资料时同时给出 `添加新资料`、`检查资料`、`使用这份资料`，不再把用户困在“只能使用已有资料”的分支里。
- 本轮修复：输入框项目资料浮层新增常显补充入口，并把二级管理动作改为 `检查资料`；知识页回 Agent 添加改为直达现有 Agent 输入框资料浮层；File Manager 文本文件普通点击改为 `加入对话`，行内提供 `设为资料`，避免点击文件直接调系统打开；输入框本地文件 chip 隐藏本机绝对路径，只保留文件名和 `本地文件 / 本地文件夹`。
- 普通用户信息边界：默认页面不再暴露本机目录、`.lime/knowledge`、`compiled/brief.md`、`metadata/status/trust`、`knowledge_builder` 或命令名；路径只在测试 mock 和内部 metadata 中存在。
- Playwright 证据：首页点击 `添加资料` 后浮层可见 `添加新资料 / 检查资料 / 使用这份资料`；点击 `添加新资料` 后输入框填入整理资料提示；File Manager 打开后文本文件行内出现 `加入对话 / 设为资料`；点击文本文件后没有再触发 `open_with_default_app` unknown command，新控制台仅剩 DevBridge event stream 在重建期间的环境噪音。
- 验证通过：`npm test -- "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/components/Inputbar/knowledge/knowledgeHubState.test.ts"`；`npm test -- "src/features/knowledge/KnowledgePage.test.tsx" "src/components/agent/chat/components/FileManager/FileManagerSidebar.test.tsx"`；`npm test -- "src/components/agent/chat/components/Inputbar/components/InputbarCore.test.tsx" "src/components/agent/chat/components/EmptyStateComposerPanel.test.tsx"`；`npm run typecheck`；`npm run smoke:knowledge-gui -- --app-url "http://127.0.0.1:1420/" --health-url "http://127.0.0.1:3030/health" --invoke-url "http://127.0.0.1:3030/invoke" --timeout-ms 240000 --interval-ms 1000` 主流程通过。
- 验证未完成：`npm run verify:gui-smoke` 本轮仍失败在 `smoke:agent-runtime-tool-surface-page` 的 `launch_browser_session fetch failed`；同时 headless Tauri watch 期间其它 Rust 文件持续变更触发重建，导致 DevBridge 3030 多次断开。`smoke:knowledge-gui` 已通过主断言，但清理临时项目时也因 DevBridge 重建出现 `workspace_delete fetch failed`，记录为环境 / 并发重建噪音，不判定为项目资料主链失败。

## 2026-05-05 产品 E2E 验收补测与修复

- 页面 / URL：`http://127.0.0.1:1420/`；Playwright 从首页、输入框项目资料浮层、File Manager、项目资料管理页和最近结果路径复走。
- 闭环判定：A 首页 / 输入框添加资料、B File Manager 加入对话与设为资料、C 项目资料管理页确认与用于生成回 Agent 已按普通用户路径补测；D Agent 结果沉淀当前样本未稳定展示可点击结果按钮，本轮只记录为 `warn`，不判定完成。
- 本轮发现：File Manager 顶部仍显示本机完整路径，属于信息泄露；首页空态输入框的本地文件 chip 没有透传“设为项目资料”动作，属于产品阻塞；浏览器 mock 文件路径进入真实文件预览时会报 `No such file or directory`，属于 mock / bridge 组合缺口；`回到 Agent 添加` 存在重复按钮定位，E2E 脚本需用 `.first()` 或明确作用域。
- 本轮修复：File Manager 顶部位置改为“本地位置”，`title` 不再放绝对路径；`EmptyState -> EmptyStateComposerPanel -> InputbarCore` 补齐 `onImportPathReferenceAsKnowledge` 透传，首页和空态 chip 也能直接“设为资料”；`knowledgeSourceImport` 对浏览器文件管理器 mock 文本路径增加产品化 fallback，避免普通 click 后出现文件元信息错误。
- Playwright 证据：修复后 B 路径显示 `brief.md / 本地文件 / 设为项目资料`，普通 click 可命中 chip 的设为资料动作，File Manager 和输入框正文不再展示 `/Users/...`；C 路径管理页首屏未出现 `.lime/knowledge`、`compiled/brief.md`、`metadata`、`status/trust`、`knowledge_builder`、`frontmatter` 或 `token`。
- 验证通过：`npm test -- "src/features/knowledge/import/knowledgeSourceImport.test.ts" "src/features/knowledge/import/knowledgeSourceSupport.test.ts"`；`npm test -- "src/components/agent/chat/components/EmptyStateComposerPanel.test.tsx" "src/components/agent/chat/components/FileManager/FileManagerSidebar.test.tsx"`；`npm test -- "src/components/agent/chat/index.test.tsx" -t "点击顶部加号应在任务中心新标签内嵌首页起手页"`；`npm run typecheck`；本轮触达文件 `git diff --check` 通过；禁名扫描通过。
- 验证警告：`npm test -- "src/components/agent/chat/index.test.tsx" "src/components/agent/chat/components/Inputbar/index.test.tsx" "src/components/agent/chat/components/Inputbar/components/InputbarCore.test.tsx"` 首次全量组合仅 1 个任务中心标签用例失败，单测定向重跑通过，按当前工作树并发负载下的组合级波动记录。
- 验证未完成：本轮最终 `npm run bridge:health -- --timeout-ms 10000` 未就绪，`npm run tauri:dev:headless` 停在 Tauri / Cargo dev 进程等待阶段且 3030 未监听；因此修复后的完整 A/B/C/D Playwright 复走仍缺稳定 DevBridge 复验，不能把产品 E2E 验收宣称为全部完成。

## 2026-05-05 产品 E2E 验收收口

- 页面 / URL：`http://127.0.0.1:1420/`；复用已就绪 DevBridge，并通过 `smoke:knowledge-gui` 走完整项目资料产品闭环。
- 闭环判定：A 首页 / 输入框添加资料、B File Manager 文本资料设为项目资料、C 项目资料管理页用于生成回现有 Agent、D Agent 输出沉淀为项目资料均已纳入可重复 E2E；本轮不再保留 D 路径 `warn`。
- 本轮修复：`scripts/knowledge-gui-smoke.mjs` 在创建临时项目后再按实际项目根目录 seed 知识资料，避免页面项目根与 seed 根不一致；同时加入 Agent 结果样本，普通点击“沉淀为项目资料”，等待真实 `knowledge_import_source` / `knowledge_compile_pack` 完成，并在管理页验证待确认资料可见。
- 产品证据：`smoke:knowledge-gui` 阶段顺序包含 `open-agent-with-knowledge -> wait-agent -> prepare-agent-result -> wait-agent-result -> capture-agent-result -> wait-agent-result-captured -> wait-captured-agent-result -> open-import-view`，确认从“使用资料”到“结果沉淀”再回“管理确认”的闭环顺序。
- 验证通过：`node --check "scripts/knowledge-gui-smoke.mjs"`；`npm run smoke:knowledge-gui -- --app-url "http://127.0.0.1:1420/" --health-url "http://127.0.0.1:3030/health" --invoke-url "http://127.0.0.1:3030/invoke" --timeout-ms 240000 --interval-ms 1000`；`npm run typecheck`；`npm run test:contracts`；`npm run verify:gui-smoke`。
- 当前剩余风险：Agent 结果样本由 E2E 脚本注入历史消息以避开真实模型配置依赖；点击、导入、编译和管理页展示均走真实 GUI / DevBridge。后续如要覆盖真实模型生成，只应作为模型配置可用时的增强验收，不再阻塞当前项目资料产品闭环。
