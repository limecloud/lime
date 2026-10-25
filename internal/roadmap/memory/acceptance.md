# Lime 记忆与上下文治理验收标准
> 2026-10-25：本文件仅保留历史实施证据，不再约束产品。旧 Soul、风格包及创作声线已删除；现役边界以 [记忆与上下文](../../aiprompts/memory-compaction.md) 和 [执行计划](../../exec-plans/browser-runtime-right-surface-plan.md) 为准。下文原有保留要求和未完成清单均已失效。

> 状态：historical / superseded
> 更新时间：2026-06-19
> 目标：定义 memory store、summary 注入、上下文防腐、上下文压缩、多模型预算、工具读取、Soul 保留、写入整理、旧路径清理和派生索引的可验证标准。

## 1. Store 验收

必须满足：

1. memory root 通过统一路径 resolver 获取。
2. 工具输出只使用相对路径。
3. `memory_summary.md`、`MEMORY.md`、`extensions/ad_hoc/notes/` 结构稳定。
4. hidden path、symlink、path traversal 默认拒绝。
5. 非 UTF-8 文件不会导致 search/list 整体失败。
6. reset 能清空 memory folder 和 index。

不通过：

1. 代码里硬编码 macOS / Windows 用户目录。
2. 工具返回绝对路径。
3. 前端组件绕过 backend 直接扫描文件。

## 2. Prompt 注入验收

必须满足：

1. 每轮默认只读 `memory_summary.md`。
2. summary 为空时不注入。
3. summary 超预算时截断。
4. 注入块明确标识为 memory，不是用户本轮输入。
5. summary 读取失败不阻塞 turn。
6. summary 不包含未脱敏凭证或敏感原文。
7. Soul 片段来自保存后的 `memory.soul`，并受开关和范围控制。
8. summary / Soul / project context / compaction summary 都必须先形成 `ContextPacket`，再由 `ContextAssembler` 注入。
9. packet 必须记录 source、scope、trustLevel、tokenBudget、actualTokens、truncated、cacheKey 和 citation。

不通过：

1. 自动读取 `MEMORY.md` 全文注入。
2. 每轮自动搜索所有 rollout summaries。
3. 注入内容随历史线性增长。
4. 把 `SOUL.md` 文件路径当运行时事实源。
5. feature 代码直接 append 原始字符串到 provider message。
6. provider adapter 直接读取 memory store、Soul 或 session DB。

## 3. 上下文防腐验收

必须满足：

1. 所有模型可见外部片段都有 typed `ContextPacket`。
2. packet admission 由 `ContextAssembler` 统一执行，不能在 feature 层分散拼接。
3. 单 packet 默认硬上限不超过 1k token；超过 1k token 的新增 packet 必须有专项人工评审记录和 E2E。
4. 单 packet 不允许超过 10k token；超出必须转文件引用或工具读取。
5. secret-like、prompt injection、local path 泄露、未审计外部文本必须被拒绝、脱敏或送 review。
6. rejected / truncated packet 有机器可读原因和 telemetry。
7. cacheKey 和 invalidation policy 稳定，避免无意义频繁变更导致缓存失效。
8. GUI 或诊断证据能展示 packet 来源、截断和拒绝摘要，不泄露敏感原文。

不通过：

1. 任意生产路径绕过 `ContextAssembler` 拼 provider messages。
2. 用自动截断替代 secret-like 拒绝。
3. diagnostic / raw tool output 默认进入 prompt。
4. provider-specific prompt builder 持有业务上下文选择逻辑。

## 4. 上下文压缩验收

必须满足：

1. 手动压缩和自动溢出压缩走同一 App Server current session compact 边界。
2. 压缩生成 compaction artifact，不重写历史消息。
3. compaction artifact 记录 `contextEpoch`、`tailStartId`、summary token 数、触发原因、使用模型和生成时间。
4. 下一轮注入 compaction packet 时保留最近 tail history。
5. compaction artifact 不进入 memory search / derived index canonical source。
6. 压缩摘要如需长期保存，只能先生成 rollout candidate，再通过显式 consolidation 进入 memory store。
7. 压缩失败不删除 thread / turn 状态，不阻断 memory tools。
8. E2E 能证明长会话压缩后可以继续对话，且原始历史仍可读。

不通过：

1. 压缩通过重写历史消息实现。
2. 压缩摘要自动写入 `MEMORY.md`、`memory_summary.md` 或 ad-hoc note。
3. 压缩逻辑散落在 provider adapter 或 GUI。
4. 只靠拉长 timeout 或隐藏历史来证明长对话可继续。

## 5. 多模型预算验收

必须满足：

1. provider / model 能力只通过 `ProviderContextProfile` 暴露。
2. profile 至少包含 context window、max output、output reserve、tool schema 限制、reasoning / summary 支持、cache 支持和 auto compact threshold。
3. `ContextBudgetPlanner` 为 memory、Soul、project context、tool schema、compaction summary、tail history 和 diagnostics 分配预算。
4. 切换模型只改变 packet admission / truncation / compaction 策略，不改变 memory store、Soul 或 session history。
5. 小窗口 profile 触发压缩或降级，大窗口 profile 不能无界注入更多内容。
6. provider adapter 只做消息格式和 tool schema 转换。
7. E2E 至少覆盖一个小窗口 profile 和一个大窗口 profile 的预算差异。

不通过：

1. 每个 provider 复制一套 memory / Soul / compaction prompt。
2. provider-specific 字段泄露到普通 memory tool 响应。
3. 切模型导致长期记忆文件、Soul 配置或 session history 分叉。
4. 上下文预算只存在配置，没有运行时硬上限。

## 6. Tool 验收

### 6.1 `memory_list`

必须满足：

1. 支持 `path`、`cursor`、`maxResults`。
2. 返回 file / directory 类型。
3. 支持 `truncated / nextCursor`。

### 6.2 `memory_read`

必须满足：

1. 支持 `path`、`lineOffset`、`maxLines`、`maxTokens`。
2. 返回 `startLineNumber`、`content`、`truncated`。
3. 行号为 1-indexed。
4. 超范围有明确错误。

### 6.3 `memory_search`

必须满足：

1. 支持多 query。
2. 支持 `any`、`allOnSameLine`、`allWithinLines`。
3. 支持 `caseSensitive`、`normalized`、`contextLines`、`cursor`。
4. 返回 `matchedQueries`、`matchLineNumber`、`contentStartLineNumber`。
5. 空 query 被拒绝。

### 6.4 `memory_add_note`

必须满足：

1. 只写 `extensions/ad_hoc/notes/`。
2. 文件名经过校验。
3. 空 note 被拒绝。
4. 不直接修改 `MEMORY.md` 或 `memory_summary.md`。

### 6.5 GUI 证据

必须满足：

1. 聊天工具卡能展示记忆工具使用证据。
2. `memory_read` 至少展示 path / scope / citation。
3. `memory_search` 至少展示 hit count / truncated 或 nextCursor 状态。
4. `memory_add_note` 至少展示保存位置或记忆库默认位置。
5. 证据展示走五语言资源，不硬编码单一语言文案。

不通过：

1. 用户只能展开原始 JSON 才知道是否读取了记忆。
2. 记忆证据把原始 Markdown 全量铺到工具卡。
3. 前端为了展示证据直接读取 memory folder。

## 7. Soul 验收

必须满足：

1. `memory.soul` / `MemorySoulConfig` 保持 current。
2. `SOUL.md` 导入必须先预览，再应用到草稿并保存。
3. `SOUL.md` 导入 warning 至少覆盖 `project_rules`、`local_path`、`secret_like`、`too_long`。
4. `SOUL.md` 复制输出只是快照；运行时读取保存后的 app config。
5. balanced / direct / creator 模板仍能写入 `memory.soul`。
6. `buildSoulArtifactVoiceGenerationBrief` 只生成 `generation_brief_only`。
7. artifact voice brief 不写 `MEMORY.md`、`memory_summary.md` 或 ad-hoc note。
8. expert persona 只继承 `communication_rhythm`，并且 `writes_back_to_global_soul` 为 false。

不通过：

1. 把 Soul 判成旧 `companion_*` 桌宠链路并删除。
2. `SOUL.md` 导入绕过 warning 直接保存。
3. artifact voice 进入长期记忆。
4. expert persona 覆盖全局 Soul。

## 8. Citation 验收

必须满足：

1. 任何被最终回答使用的 memory hit 都能产生 path / line range。
2. citation 指向 memory folder 内实际读取的文件。
3. 不引用空行。
4. 不把 workspace 普通文件伪装成 memory citation。
5. 回答里不把未验证旧记忆当成当前事实。

## 9. 写入与整理验收

必须满足：

1. 显式“记住”写入 ad-hoc note。
2. 只有显式 consolidation 才能更新 `MEMORY.md` / `memory_summary.md`。
3. consolidation 有安全扫描。
4. 敏感或冲突条目进入待审或跳过。
5. consolidation 失败不让当前 turn 失败。
6. 写入当前 turn 后不立即改写当前 prompt。
7. handoff / replay / analysis / review decision save 只能写 `rollout_summaries/*.md` 候选，不能直接更新长期记忆正文。
8. rollout summary candidate 必须记录 source、exportedAt、export root 或可追踪 artifact 线索。

不通过：

1. 用户一句话被无审计地写进 summary。
2. 自动候选或定时整理绕过显式 consolidation 并马上影响当前生成。
3. secret-like 内容进入 `memory_summary.md`。
4. 导出 evidence 时绕过 `MemoryBackend` 直接从前端扫描或写 memory folder。

## 10. 旧记忆与旧灵感库清理验收

必须满足：

1. `unified_memory_*` 不再作为产品入口、写入入口或旁路事实源。
2. `memory_runtime_*` 不再决定默认 recall。
3. 旧 MemoryPage 灵感库 / 高级诊断混合视图被删除或 retired guard 封住。
4. `inspiration_*` 不再作为长期事实源出现。
5. embedding BLOB 不成为新事实源。
6. 旧入口删除前只允许 fail-fast / retired guard。
7. 不把旧数据批量导入为 memory store canonical content。
8. 旧 `companion_*` 桌宠命令链路只作为 dead / forbidden-to-restore 出现。
9. 旧 runtime recall 或旧压缩命令不得作为 context 防腐 / compaction current 入口出现。

不通过：

1. 同一条记忆同时在文件和数据库里双写为 current。
2. 旧 `memory_runtime_*` 继续决定默认 recall。
3. 旧路径为了兼容继续新增业务逻辑。
4. 旧灵感库继续作为 GUI 或旁路入口。
5. 清理失败无报告或无 owner。
6. 旧入口被改名后继续承接新上下文治理能力。

## 11. 派生索引验收

必须满足：

1. index 可删除。
2. index 可完整重建。
3. index 损坏时降级文本扫描。
4. index manifest 记录 schema version、source checksum 或更新时间。
5. index 不保存 canonical content。
6. 向量库或 FTS 库不影响 memory store 读写。

不通过：

1. 没有索引就不能搜索。
2. 索引成为唯一存储。
3. 向量库动态库加载失败导致 memory tools 全部不可用。

## 12. E2E 验收

必须满足：

1. 真实 Electron Desktop Host + App Server bridge 启动并健康。
2. `npm run verify:gui-smoke` 覆盖设置页 `设置 -> 记忆` 主路径。
3. Playwright 真实交互覆盖：进入设置页记忆、查看 health、添加修正、刷新候选、审阅、整理、重建索引、Soul 导入 / 复制入口。
4. 上下文治理阶段覆盖 packet admission / truncation / rejection GUI 或 telemetry 证据。
5. 压缩阶段覆盖长会话压缩后继续对话，并确认原始历史仍可读。
6. 多模型阶段覆盖小窗口 profile 与大窗口 profile 的预算差异。
7. 控制台 error 基线、当前 URL、页面状态、bridge / mock 分类写入 `internal/exec-plans/`。
8. 生产路径不得依赖 renderer mock fallback、mock backend 或旧命令作为通过证据。

不通过：

1. 只跑单测、typecheck 或 Rust crate 测试就宣称 GUI 可交付。
2. 只验证浏览器镜像，不验证 Electron Desktop Host + App Server bridge。
3. 发现 bridge / mock 缺口后仍把 E2E 判为通过。
4. 没有记录控制台 error 和当前页面状态。

## 13. Governance 验收

必须满足：

1. `internal/roadmap/memory` 不再把旧灵感库路线当 current。
2. 不再引用 `lime-rs/src/**` 作为新实现落点。
3. 不再把 active recall、external provider、Dreaming 作为默认主线。
4. 不再把任何具体外部索引库作为 P0 current。
5. 不出现外部项目名作为路线图标题或主线口径。
6. 不出现旧数据搬入口径。
7. `make-next-generation-more-like-me.md` 已删除。
8. 不出现 provider-specific prompt builder 作为 current 业务上下文入口。
9. 不出现压缩摘要自动入长期记忆口径。

建议检查：

```bash
rg -n "make-next-generation-more-like-me|active memory|external memory provider|lime-rs/src" "internal/roadmap/memory"
rg -ni "具体外部索引库|外部向量数据库" "internal/roadmap/memory"
rg -n "Soul|SOUL|soul|companion" "internal/roadmap/memory"
rg -n "ContextPacket|ContextAssembler|ProviderContextProfile|ContextCompaction" "internal/roadmap/memory"
```

允许出现的情况：

1. 旧主线词只在 `dead` / `非目标` / `清理` 段落中出现。
2. `Soul` / `SOUL` / `soul` 出现在 current、功能需求、图谱和验收边界中。
3. `companion_*` 只在 dead / 不通过判定中出现。

## 14. 当前验收证据

截至 2026-06-19，本路线图 P0 / current 主链已用下列证据收口：

1. GUI 主路径：`npm run verify:gui-smoke` 通过，覆盖设置页 `设置 -> 记忆`、日常记忆面板、运行摘要候选刷新、审阅刷新、重建索引、显式整理、Soul 面板和高级导入 / 复制入口。
2. 命令 / 协议 / mock 边界：`npm run test:contracts` 通过，确认 App Server protocol、npm client、Electron command contract、DevBridge truth、mock priority、脚本治理和 docs boundary 未漂移。
3. Rust current 后端：`cargo test --manifest-path "lime-rs/Cargo.toml" -p app-server memory_store --lib` 通过，覆盖 16 个 memory store 后端测试。
4. 前端 / Electron / DevBridge 记忆边界：`npm test -- --run src/lib/api/memoryStore.test.ts src/lib/api/memoryStore.current-boundary.test.ts src/lib/api/projectMemory.test.ts src/lib/desktop-host/memoryMocks.test.ts src/lib/dev-bridge/commandPolicy.test.ts src/lib/dev-bridge/mockPriorityCommands.test.ts electron/ipcChannels.test.ts` 通过，覆盖 47 个测试。
5. App Server client / memoryStore 网关：`npm test -- --run packages/app-server-client/tests/client.test.mjs src/lib/api/memoryStore.test.ts` 通过，覆盖 63 个测试。
6. 聊天工具卡记忆证据：`npm test -- --run src/components/agent/chat/utils/memoryToolEvidence.unit.test.ts src/components/agent/chat/components/InlineToolProcessStep.test.tsx src/i18n/__tests__/loadNamespace.test.ts src/i18n/__tests__/types.test.ts` 通过，覆盖 39 个测试。
7. i18n 完整性：`npm run detect-translations -- --verbose` 通过，五语言资源覆盖 100%；`npm run i18n:unused -- --format json` 通过，unused 为 0。
8. 代码样式与静态边界：记忆工具证据相关文件的 ESLint、Prettier check 和 `git diff --check` 已通过。
9. 路线图禁词与外部主线扫描：外部项目名扫描无命中；路线图不以具体外部项目或外部索引库作为 P0 current。
10. 旧入口治理状态：旧 MemoryPage 灵感库、旧 `src/lib/api/memory.ts`、旧 `unified_memory_*`、旧 `memory_runtime_*`、旧 SQLite 语义记忆路线只允许出现在 dead / cleanup / retired guard 语境，不作为产品入口、写入入口或旁路事实源。
11. 文档层上下文治理口径：`ContextPacket`、`ContextAssembler`、`ContextCompaction` 和 `ProviderContextProfile` 已进入路线图 current 边界；实现和 E2E 证据仍按后续 Phase 3 / Phase 4 补齐，不能用当前文档变更替代产品通过。

未作为通过证据的项：

1. `npm run verify:local` 不能宣称通过；已通过前置 app version、i18n、unused、全量 lint 和变更文件扫描，但卡在全量 `npm run typecheck` 阶段后中断。
2. `npm run governance:legacy-report` 当前仍被非记忆边界阻断；这些阻断不属于 memory store current 交付缺口，后续应回到对应主线处理。
3. 本轮新增的 context packet、防腐层、自动压缩和多模型预算还未实现，不能作为当前产品完成证据。

## 15. 不通过判定

出现任一情况，本路线图阶段不算完成：

1. 新增第二套长期记忆数据库事实源。
2. 默认依赖向量数据库才能检索记忆。
3. summary 注入无预算。
4. 记忆工具不能返回 citation。
5. 前端或 Electron Host 承接记忆业务逻辑。
6. 旧 `unified_memory_*` 继续增长下一代能力。
7. reset 后仍注入旧 summary。
8. 派生索引损坏导致记忆系统不可用。
9. 生产路径依赖 mock memory backend。
10. Soul 功能被旧桌宠治理误删。
11. 模型可见上下文绕过 `ContextAssembler`。
12. 压缩通过重写历史或自动写长期记忆实现。
13. provider / model 分支复制出多套记忆、Soul 或压缩逻辑。
14. 没有真实 Electron + Playwright E2E 就宣称上下文治理可交付。
