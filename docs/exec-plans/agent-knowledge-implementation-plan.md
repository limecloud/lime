# Agent Knowledge 实现执行计划

> 状态：Phase 1 current 主链已接通，正式 Builder Skill 已进入默认 Skills 安装链  
> 创建时间：2026-05-01  
> 路线图来源：`docs/roadmap/knowledge/prd.md`  
> 当前目标：完成 Markdown-first 知识包的导入、编译、GUI 管理、显式选择与运行时 fenced context 注入。

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
```

## 后续切片

1. 为 `knowledge_builder` 增加类型化模板和质量检查输出，覆盖个人 IP、品牌产品、组织 Know-how、增长策略四类。
2. 为 GUI 主路径补专门的知识库交互 smoke：启动 Lime，确认知识库页面入口、默认包开关、多包选择、“去生成”和“Builder 生成”跳转可用。
3. 为运行时 Knowledge Context Resolver 增加更细的章节选择和 token 成本提示。
