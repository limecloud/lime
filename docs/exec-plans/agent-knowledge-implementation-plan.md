# Agent Knowledge 实现执行计划

> 状态：Phase 1 current 主链已接通，项目资料能力已回流到现有 Agent 输入框；最新 GUI 最小冒烟待补跑
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

## 待完成清单

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
- [ ] 在稳定 headless 环境补跑 `npm run verify:gui-smoke` 或至少补跑 `smoke:knowledge-gui`。

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
```

## 后续切片

1. 在稳定 headless 环境补跑 GUI 主路径冒烟：启动 Lime，确认 Agent 输入框“整理成项目资料”、项目资料选择、“用于生成”回到 Agent、手动导入和全部资料列表可用。
2. 继续收口普通用户语言：管理页只展示资料名称、状态、风险提醒、引用摘要和确认动作；内部文件名、Skill 名称、目录结构只保留在开发文档和测试 mock 中。
3. 为运行时 Knowledge Context Resolver 增加更细的章节选择和成本控制，但只在开发者诊断或高级设置中展示，不进入普通用户默认路径。
4. 为 `knowledge_builder` 增加示例输入 / 输出快照测试，锁定不同 `pack_type` 的生成结构。
