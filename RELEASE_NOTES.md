## Lime v1.27.0

发布日期：`2026-05-05`

### 发布概览

- 本次发布目标 tag 为 `v1.27.0`，重点把 Agent Knowledge 从方案文档推进到 current 主链，同时继续收紧 Agent runtime、Skill 工具门禁、模型解析和 GUI 入口的一致性。
- 版本文件、Tauri 配置、headless 配置、CLI wrapper、release updater 测试样例与发布说明已同步到 `1.27.0`。
- 该版本继续坚持“一个事实源”：知识包、运行时上下文、命令契约、mock、GUI 页面和输入区发送 metadata 都收敛到同一条可验证链路。
- 本次重新覆盖 `v1.27.0` tag 前，补入会话恢复、消息投影、Harness 审核导出、Knowledge GUI 冒烟和 release build 稳定性修复。

### 用户可见更新

#### 1. Agent Knowledge 知识库主链

- 新增 `知识库` 页面入口，支持查看知识包目录、知识包详情、来源导入、编译、默认包设置和运行时 context 预览。
- 新增 Markdown-first 知识包标准目录：`.lime/knowledge/packs/<pack-name>/KNOWLEDGE.md`、`sources/`、`wiki/`、`compiled/`、`runs/`。
- 新增知识包导入、编译、列表、详情、默认包和运行时上下文解析能力；GUI 与聊天发送链路都消费同一组 `knowledge_*` 命令。
- 聊天输入区新增轻量知识包选择菜单：可读取当前工作区知识包，默认选中项目默认包，也可手动切换具体知识包后发送。
- Agent runtime 新增 `KnowledgePack` prompt stage：从请求 metadata 解析知识包选择，调用 Knowledge Context Resolver，并以 fenced context 注入模型。
- 带知识包 metadata 的请求会强制进入 full runtime，避免 fast route 跳过知识上下文。
- 新增内置 `knowledge_builder` Skill，帮助把来源资料整理为 `KNOWLEDGE.md`、`wiki/`、`compiled/brief.md` 和 `runs/` 草稿。
- 知识库页面提供 `Builder 生成` 入口，可把项目根目录、pack name、pack 类型和 builder metadata 带入 Agent 执行。

#### 2. Agent runtime、模型解析与工具门禁

- 运行时模型解析继续向后端事实源收敛，增强默认 provider、模型候选、辅助模型和请求级模型能力解析。
- Skill 工具门禁增强：模型首刀 Skill、服务技能、浏览器工具、知识包上下文和 detour tool 抑制逻辑更明确，减少任务跑偏到工具目录发现或本地文件误读。
- Agent turn 输入、队列、session runtime 和 stream submit 链路补齐 request metadata、workspace context、team/runtime state 的传递与测试。
- `fastResponseModel` 与 full runtime 判定补齐知识包、媒体任务、显式 Skill 和运行时需求判断，避免该走主链的任务被短路。

#### 3. 工作区、任务轻卡与图片任务恢复

- 图片任务 viewer 和 workspace 预览继续向统一 media task artifact 事实源收敛，补齐完成态、失败态、工作台展示和恢复路径。
- Inputbar、workspace send actions、message preview 和 task policy evaluation 增强多模态任务 metadata 传递，减少显式动作与纯文本命令之间的协议漂移。
- Agent UI 性能指标继续补充旧会话打开、消息列表首帧和 runtime session 读取的采集点与回归。

#### 4. 导航、侧栏与本地化

- 侧栏、任务中心资料分组和页面内容区新增知识库入口，并补齐路由、页面类型和导航测试。
- 中英文 patch 增加知识库相关文案，翻译覆盖测试同步更新。
- 旧的 Agent Knowledge 探索文档收敛到 `docs/roadmap/knowledge/prd.md` 与执行计划，不再保留平行旧文档入口。

#### 5. 会话恢复、消息投影与性能稳定性

- 新增会话详情拉取、hydration、retry、metadata sync、finalize、post-finalize persistence 和切换快照控制器，把 `useAgentSession` 中的会话恢复逻辑拆成可测边界，降低切换历史会话时的竞态风险。
- 新增 conversation projection store、历史消息 hydration、消息渲染窗口、timeline render 和 thread timeline window 投影，减少长历史消息列表渲染和恢复路径漂移。
- 旧会话切换失败时增加可重试/可跳过分类， transient 失败不再直接破坏当前快照；不可恢复错误仍按原错误路径处理。
- MessageList 和 Agent UI 性能指标补齐旧历史内容扫描、markdown 延迟渲染、线程 item 扫描和首帧 paint 的采集与回归。
- 语音设置页滚动聚焦修复 release build 测试环境下的 `scrollIntoView` mock 污染，移除 release 环境缺失的 `@testing-library/react` 测试依赖。

#### 6. Harness 导出、审核与权限确认状态

- Evidence Pack、Handoff bundle、Analysis handoff、Replay case 和 Review decision 统一导出 `permissionState`，能区分 `not_requested`、`requested`、`resolved` 和 `denied`。
- Review decision GUI、前端 API、Rust save API 和浏览器 mock 增加 denied 权限确认保护，阻止把带拒绝权限确认的运行误保存为 `accepted`。
- Harness 状态面板和人工审核弹窗补齐权限确认状态、verification outcomes、copy prompt 和保存路径回归。
- `agent_runtime_*` 网关、runtime thread read 和 mock 读取面继续保持同一 facts source，避免 Evidence / Replay / Review 各自解释权限状态。

#### 7. Release build 与本地开发 fallback

- `scripts/lib/harness-eval-history-record.test.ts` 改为异步执行外部命令，避免 Vitest worker 在 release 校验中触发 `onTaskUpdate` timeout。
- 本地浏览器开发模式下 Provider 读取失败时继续提供 Lime Hub mock，并用显式 `hasTauriRuntimeMarkers=false` 测试保护该 fallback。
- `knowledge-gui-smoke` 更新为覆盖知识库入口、Agent 知识包上下文跳转和导入视图组织入口，纳入 GUI smoke 主链。
- Warp modality runtime contract 守卫补齐 entry binding inventory 与 task index inventory 文档锚点，`npm run test:contracts` 继续覆盖治理文档缺失。

### 开发者与治理更新

#### 1. 命令边界与 mock 同步

- 新增 `lime-knowledge` Rust crate，Tauri command 只做薄适配，知识包文件事实源集中在后端 crate。
- 新增前端网关 `src/lib/api/knowledge.ts` 与 feature 边界 `src/features/knowledge`，页面和 Hook 不直接散落裸 `invoke`。
- 同步 `tauri::generate_handler!` 注册、`agentCommandCatalog`、`mockPriorityCommands` 和浏览器默认 mock，知识包命令纳入契约检查。
- `npm run test:contracts` 覆盖新增知识包命令的前端调用、Rust 注册、治理目录册与 mock 边界。

#### 2. 文档与路线图

- 新增 `docs/roadmap/knowledge/prd.md`，明确 KnowledgePack / Skill / Memory / Inspiration 边界和 P0/P1/P2 目标。
- 新增 `docs/exec-plans/agent-knowledge-implementation-plan.md`，记录 Phase 1 current 主链、验证记录与后续切片。
- Warp 和多模态运行合同文档补齐 Knowledge Context Resolver、runtime prompt stage 和执行 profile 说明。
- 新增 AgentUI conversation projection 架构、fact map、实现计划与验收文档，把消息投影和会话恢复性能治理落到 repo 内 versioned artifact。
- 新增 Warp entry binding inventory 与 task index inventory，明确 `@` / button / scene 入口只能绑定底层 runtime contract，任务索引不能反向依赖 UI 临时状态。

### 已知说明

- 首版 Knowledge 仍坚持 Markdown-first，不做向量库、知识图谱、企业权限或知识包市场。
- `knowledge_builder` 当前生成草稿，不会自动覆盖用户已确认的知识资产；用户仍需人工确认关键事实。
- 知识包章节级 token 成本提示、细粒度章节选择和更完整 provenance / citation anchors 留在后续切片。

### 校验状态

- 本次重新覆盖 `v1.27.0` tag 前已完成：
  - `npm run build`
  - `npm run lint`
  - `npm test`
  - `npm run test:contracts`
  - `npm run verify:gui-smoke`
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `CARGO_TARGET_DIR="/tmp/lime-release-verify-target" cargo clippy --manifest-path "src-tauri/Cargo.toml" --all-targets --all-features`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"`
  - `git diff --check`
- 结果说明：
  - 前端全量 Vitest smart suite 46 批通过。
  - Rust 单测与集成测试通过；真实联网 web search 测试保持 ignored，需要 `LIME_REAL_API_TEST=1` 时单独执行。
  - GUI smoke 已复用 headless Tauri 环境完成 DevBridge、workspace ready、browser runtime、site adapters、service skill entry、runtime tool surface 和 Knowledge GUI 主路径验证。

---

**完整变更**: `v1.26.0` -> `v1.27.0`
