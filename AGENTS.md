# AI Agent 指南

本文件只用于 **开发 Lime 源码仓库本身**。根 `AGENTS.md` 只保留仓库级约束、导航和统一入口；模块细节与长流程统一下沉到 `docs/`。

## 原则

1. **代码仓库是唯一的记录系统** - 不在 repo 里的知识对智能体不存在；凡影响开发的讨论、决策、外部资料，都必须落成 repo 内的 versioned artifact
2. **本文件是地图，不是百科全书** - 保持约 `100` 行，只暴露本层信息和下一步导航
3. **把品味编码为规则** - 优先用 linter、结构测试、CI 检查约束质量；可机械验证优先于散文指南
4. **计划是一等工件** - 执行计划带进度日志，集中存放于 `docs/exec-plans/`
5. **持续垃圾回收** - 技术债按小额、持续方式偿还；差距追踪见 `docs/exec-plans/tech-debt-tracker.md`
6. **卡住时修环境，不是更用力** - 先补上下文、工具、约束，再继续实现；缺口也要写回 repo

## 基础约束

1. **始终使用中文** - 回复、文档、代码注释默认使用中文；若文件已有其他注释语言，保持与现有代码库一致
2. **先读后写** - 修改文件前先读现状和相邻边界
3. **避免无关变更** - 不顺手重构、不扩大范围、不主动做 git 提交或分支操作
4. **默认双平台** - 新增功能、脚本、路径处理默认同时考虑 macOS 与 Windows
5. **禁止硬编码平台路径** - 用户数据、日志、缓存、凭证等目录必须走系统 API 或统一封装
6. **优先平台无关入口** - 优先复用 `npm`、`cargo`、Tauri 命令和仓库脚本，不新增只适用于 Bash/zsh 的流程
7. **未验证的平台假设要显式说明** - 涉及文件系统、进程、终端、快捷键、窗口、托盘、权限时尤其如此
8. **不要继续扩展 compat / deprecated 路径** - 新 API、新命令、新前端入口默认落在当前 `current` 主路径

## 工程硬规则

1. **默认统一校验入口** - 提交前默认执行 `npm run verify:local`
2. **版本改动必须校验一致性** - 改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf*.json` 时执行 `npm run verify:app-version`
3. **协议改动必须同步四侧** - `safeInvoke(...)` / `invoke(...)`、`tauri::generate_handler!`、`agentCommandCatalog`、`mockPriorityCommands` / `defaultMocks` 必须保持一致，并执行 `npm run test:contracts`
4. **Lime 是 GUI 桌面产品** - 不能只以 `lint`、`typecheck`、单测通过作为“可交付”判断
5. **高风险 GUI 改动必须做最小冒烟** - 涉及 GUI 壳、DevBridge、Workspace、主路径时执行 `npm run verify:gui-smoke`
6. **用户可见 UI 改动必须补稳定回归** - 优先补现有 `*.test.tsx` 或 snapshot 断言
7. **配置与依赖改动要成组更新** - schema、校验器、消费者、文档、锁文件保持同步
8. **Rust 变更先小测后全量** - 先跑受影响 crate / 模块 / 定向测试；新增模块尽量控制在 `500 LoC` 内，文件接近 `800 LoC` 时优先拆新模块
9. **Harness Engine 只认单一事实源** - handoff / evidence / replay / analysis / review / GUI 统一消费 `agent_runtime_export_evidence_pack`；`requestTelemetry` 需要按 `session/thread/turn` 真实关联导出，无匹配请求时输出空摘要，不再保留伪 `unlinked`

## 执行与路线图

1. **主线任务先重述目标** - 用户要求“对齐路线图 / 继续主线”时，先说明当前主目标、阶段和下一刀
2. **每一刀都要可追踪** - 改动要么回挂到 `docs/roadmap/`，要么登记到 `docs/exec-plans/` 或技术债追踪
3. **清理不能替代交付** - 连续两轮主要在做治理减法后，下一轮优先回到未完成主线
4. **长任务必须落计划** - 超过一轮的实现、迁移、清理，写入 `docs/exec-plans/` 并持续更新进度日志

## 文档导航

- **文档中心**：`docs/README.md`
- **模块级工程导航**：`docs/aiprompts/README.md`
- **架构概览**：`docs/aiprompts/overview.md`
- **工程质量 / 校验**：`docs/aiprompts/quality-workflow.md`
- **UI 规范**：`docs/aiprompts/design-language.md`
- **Tauri 命令边界**：`docs/aiprompts/commands.md`
- **命令运行时**：`docs/aiprompts/command-runtime.md`
- **任务 / 子代理 taxonomy**：`docs/aiprompts/task-agent-taxonomy.md`
- **远程运行时**：`docs/aiprompts/remote-runtime.md`
- **记忆 / 压缩主链**：`docs/aiprompts/memory-compaction.md`
- **状态 / 历史 / 遥测主链**：`docs/aiprompts/state-history-telemetry.md`
- **治理与收口**：`docs/aiprompts/governance.md`
- **Harness Engine 治理**：`docs/aiprompts/harness-engine-governance.md`
- **Playwright / GUI 续测**：`docs/aiprompts/playwright-e2e.md`
- **计划与进度**：`docs/exec-plans/README.md`
- **技术债追踪**：`docs/exec-plans/tech-debt-tracker.md`
- **路线图**：`docs/roadmap/`
- **Codex Skills 索引**：`.codex/skills/README.md`

## 高频命令

```bash
npm run verify:local
npm run verify:local:full
npm run verify:gui-smoke
npm run bridge:health -- --timeout-ms 120000
npm run test:contracts
npm run governance:legacy-report
npm run tauri:dev:headless
cd src-tauri && cargo test
```

## 维护规则

1. 改仓库级规则时，同时更新本文件和对应 `docs/` 入口
2. 新增长期流程优先落到 `docs/`；高频复用后再沉淀为 `.codex/skills/`
3. 如果某条规则已经能被 linter、结构测试或 CI 机械约束，就把约束写进工具链，而不是继续往本文件堆说明
