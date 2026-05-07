# AI Agent 指南

本文件只用于 **开发 Lime 源码仓库本身**。根 `AGENTS.md` 只保留仓库级约束、导航和统一入口；模块细节与长流程统一下沉到 `docs/`。

## 原则

1. **代码仓库是唯一的记录系统** - 不在 repo 里的知识对智能体不存在；凡影响开发的讨论、决策、外部资料，都必须落成 repo 内的 versioned artifact
2. **本文件是地图，不是百科全书** - 保持约 `100` 行，只暴露本层信息和下一步导航
3. **把品味编码为规则** - 优先用 linter、结构测试、CI 检查约束质量；可机械验证优先于散文指南
4. **计划是一等工件** - 执行计划带进度日志，集中存放于 `docs/exec-plans/`
5. **持续垃圾回收** - 技术债按小额、持续方式偿还；差距追踪见 `docs/exec-plans/tech-debt-tracker.md`
6. **卡住时修环境，不是更用力** - 先补上下文、工具、约束，再继续实现；缺口也要写回 repo

## 工程协作方式

1. **默认以完整交付为单位** - 不把可自行判断的实现细节、下一步动作或可逆选择转嫁给用户；读代码、做判断、完成闭环后再报告结果
2. **少问但不越权** - 只有真实需求歧义、不可逆 / 高风险操作、生产环境影响、凭证缺失，或继续会明显偏离用户意图时才停下来询问
3. **结果汇报优先** - 收尾说明做了什么、为什么这样做、验证了什么、还剩什么缺口；避免过程性礼貌汇报
4. **任务完成标准优先** - 以可编译、类型正确、测试通过、功能真实可用作为完成依据；实现细节服从项目既有模式和当前主线目标
5. **不主动扩大承诺** - 不在完成后追问“要不要继续做 X/Y/Z”；如存在自然下一刀，只简短列出建议，等待用户明确要求

## 基础约束

1. **始终使用中文** - 回复、文档、代码注释默认使用中文；若文件已有其他注释语言，保持与现有代码库一致
2. **先读后写** - 修改文件前先读现状和相邻边界
3. **避免无关变更** - 不顺手重构、不扩大范围、不主动做 git 提交或分支操作
4. **默认双平台** - 新增功能、脚本、路径处理默认同时考虑 macOS 与 Windows
5. **禁止硬编码平台路径** - 用户数据、日志、缓存、凭证等目录必须走系统 API 或统一封装
6. **优先平台无关入口** - 优先复用 `npm`、`cargo`、Tauri 命令和仓库脚本，不新增只适用于 Bash/zsh 的流程
7. **未验证的平台假设要显式说明** - 涉及文件系统、进程、终端、快捷键、窗口、托盘、权限时尤其如此
8. **不要继续扩展 compat / deprecated 路径** - 新 API、新命令、新前端入口默认落在当前 `current` 主路径
9. **规划改了且明确无需兼容时，优先删旧实现** - 如果用户已明确“上一版无人使用 / 不用兼容 / 旧实现阻碍主线”，旧实现默认按 `dead` 或带退出条件的 `deprecated` 处理，不要继续修补、包裹或平移
10. **`legacy current reference` 不是续命许可** - 旧路线图、旧实现锚点只用于理解现状与迁移，不等于允许继续往旧页面、旧命令、旧协议上加功能

## 工程硬规则

1. **默认统一校验入口** - 提交前默认执行 `npm run verify:local`
2. **版本改动必须校验一致性** - 改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf*.json` 时执行 `npm run verify:app-version`
3. **协议改动必须同步四侧** - `safeInvoke(...)` / `invoke(...)`、`tauri::generate_handler!`、`agentCommandCatalog`、`mockPriorityCommands` / `defaultMocks` 必须保持一致，并执行 `npm run test:contracts`
4. **Lime 是 GUI 桌面产品** - 不能只以 `lint`、`typecheck`、单测通过作为“可交付”判断
5. **高风险 GUI 改动必须做最小冒烟** - 涉及 GUI 壳、DevBridge、Workspace、主路径时执行 `npm run verify:gui-smoke`
6. **Playwright 续测优先稳定桌面 Chrome 会话** - 真实交互验证优先复用已有 Lime 页签；需要新启浏览器时走持久化 Chrome 上下文，避免本地桌面出现自动化横幅或 `--no-sandbox` 安全横幅，细则见 `docs/aiprompts/playwright-e2e.md`
7. **用户可见 UI 改动必须补稳定回归** - 优先补现有 `*.test.tsx` 或 snapshot 断言
8. **配置与依赖改动要成组更新** - schema、校验器、消费者、文档、锁文件保持同步
9. **Rust 变更先小测后全量** - 先跑受影响 crate / 模块 / 定向测试；新增模块尽量控制在 `500 LoC` 内，文件接近 `800 LoC` 时优先拆新模块
10. **Harness Engine 只认单一事实源** - handoff / evidence / replay / analysis / review / GUI 统一消费 `agent_runtime_export_evidence_pack`；`requestTelemetry` 需要按 `session/thread/turn` 真实关联导出，无匹配请求时输出空摘要，不再保留伪 `unlinked`

## 执行与路线图

1. **主线任务先重述目标** - 用户要求“对齐路线图 / 继续主线”时，先说明当前主目标、阶段和下一刀
2. **先补主缺口再磨细节** - 多阶段主线未到可用闭环前，优先做直接提高整体完成度的缺口；协议 polish、错误分类、额外 seam、边缘校验、文案润色、内部抽象等梢枝末节，只有在阻塞主路径、会造成假入口/假配置，或用户明确要求时才做
3. **下一刀必须按目标增量排序** - 选择下一步前先列出 1-3 个未完成主问题，并优先选“对整体目标完成度提升最大”的一项；不要因为当前文件顺手、测试容易、局部更完整，就继续做低杠杆小项
4. **每一刀都要可追踪** - 改动要么回挂到 `docs/roadmap/`，要么登记到 `docs/exec-plans/` 或技术债追踪
5. **清理不能替代交付** - 连续两轮主要在做治理减法后，下一轮优先回到未完成主线
6. **长任务必须落计划** - 超过一轮的实现、迁移、清理，写入 `docs/exec-plans/` 并持续更新进度日志
7. **主线冲突先清障，不保旧面** - current 规划与旧实现直接冲突时，先删或下线阻碍主线的旧页面、旧命名、旧命令、旧文档，再继续实现；不要为了“看起来兼容”保留双轨
8. **默认不为顺手问题偏航** - 已经选定本轮主线后，除非该问题直接阻塞当前交付、会让新改动变假配置/假入口，或用户明确要求，否则不要切去处理旁支优化、额外治理、零引用清理或“顺手再修一个”
9. **清理必须有主线收益句** - 任何治理/重构/删除动作，动手前都要能用一句话说明“它如何直接帮助当前主线交付”；如果说不出来，就记录为后续项而不是立即执行
10. **顺手项一次只收一刀** - 实现主线时即使发现多个周边问题，默认只处理其中最直接阻塞的一项；其余登记后立即回到主线，不串行深挖
11. **完成判定先看主线，再看周边** - 用户问“完成了么”时，先回答主线目标是否完成；周边清理、额外校验、可选优化必须单独标为“已做 / 未做”，不能混成“还差一点边角所以整体未完成”
12. **验证以证明交付为上限** - 校验应先覆盖当前改动的真实风险；在已经证明主线可交付后，不要因为还能继续跑更重检查，就无限追加验证并拖延收口
13. **开发任务结束必须给完成度百分比** - 非纯问答的开发任务收尾时，必须给“本轮完成度：X%”，并说明主线目标是否完成、验证情况、剩余缺口和下一刀；路线图 / 长任务 / 多阶段主线还要额外给“整体目标完成度：Y%”，并说明百分比口径

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
- **文件持久化主链**：`docs/aiprompts/persistence-map.md`
- **状态 / 历史 / 遥测主链**：`docs/aiprompts/state-history-telemetry.md`
- **任务分层 / 模型经济调度路线图**：`docs/roadmap/task/README.md`
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
