## Lime v1.27.0

发布日期：`2026-05-02`

### 发布概览

- 本次发布目标 tag 为 `v1.27.0`，重点把 Agent Knowledge 从方案文档推进到 current 主链，同时继续收紧 Agent runtime、Skill 工具门禁、模型解析和 GUI 入口的一致性。
- 版本文件、Tauri 配置、headless 配置、CLI wrapper、release updater 测试样例与发布说明已同步到 `1.27.0`。
- 该版本继续坚持“一个事实源”：知识包、运行时上下文、命令契约、mock、GUI 页面和输入区发送 metadata 都收敛到同一条可验证链路。

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

### 已知说明

- 首版 Knowledge 仍坚持 Markdown-first，不做向量库、知识图谱、企业权限或知识包市场。
- `knowledge_builder` 当前生成草稿，不会自动覆盖用户已确认的知识资产；用户仍需人工确认关键事实。
- 知识包章节级 token 成本提示、细粒度章节选择和更完整 provenance / citation anchors 留在后续切片。

### 校验状态

- 已完成：
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `npm run format`
  - `npm run verify:app-version`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:contracts`
- 已做补充检查：
  - `npm test -- src/lib/governance/legacyToolPermissionGuard.test.ts`
- 待补跑：
  - `npm test`
  - `cargo clippy --manifest-path "src-tauri/Cargo.toml"`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"`
  - `npm run verify:gui-smoke`
- 说明：
  - 本次按发布优先先行提交 `v1.27.0`，剩余全量测试与 GUI 冒烟待事后补跑。
  - 全量 `npm test` 上一轮遇到 Vitest worker `onTaskUpdate` timeout；`verify:gui-smoke` 上一轮遇到临时 Cargo target 目录失效，已确认属于执行环境问题，未作为本次提交阻塞项继续追查。

---

**完整变更**: `v1.26.0` -> `v1.27.0`
