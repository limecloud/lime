# Lime 记忆与上下文治理实施计划
> 2026-10-25：本文件仅保留历史实施证据，不再约束产品。旧 Soul、风格包及创作声线已删除；现役边界以 [记忆与上下文](../../aiprompts/memory-compaction.md) 和 [执行计划](../../exec-plans/browser-runtime-right-surface-plan.md) 为准。下文原有保留要求和未完成清单均已失效。

> 状态：historical / superseded
> 更新时间：2026-06-19
> 目标：用小步交付把 Lime 记忆主线收敛到文件化 memory store，把上下文防腐、压缩续接和多模型预算纳入 App Server current 主链，清理旧记忆 / 旧灵感库 surface，并保留 Soul 交互配置。

## 1. 实施原则

1. 先定 store 和 backend 合同，再删除旧入口。
2. 先让 summary 注入稳定，再开放工具读取。
3. 先文本搜索和 citation，再考虑派生索引。
4. 旧记忆和旧灵感库数据不批量导入为新事实源。
5. Soul 保留在 `memory.soul` 配置层，不并入长期记忆文件。
6. 派生索引损坏时必须可降级。
7. 不在本路线图继续扩展旧灵感库、active recall、external provider。
8. 所有模型可见上下文先 packet 化，再由 `ContextAssembler` 统一预算、防腐和 provider 渲染。
9. 压缩只处理 session context，不改写历史，不自动写长期记忆。
10. 多模型差异只进入 `ProviderContextProfile` 与 provider adapter，不在 memory / Soul / GUI 分叉。

## 2. Phase 0：文档和事实源收口

目标：

1. 删除旧“更像我 / companion / taste layer”扩展路线。
2. 把 memory roadmap 改成文件化记忆单主线。
3. 把上下文防腐、上下文压缩和多模型预算纳入 memory / compaction current 主链。
4. 明确 `unified_memory_*` / `memory_runtime_*` / 旧灵感库为 dead / cleanup surface。
5. 明确 Soul 是 current 交互配置，不是旧 companion 桌宠。
6. 明确向量数据库只是未来派生索引候选。

主产物：

1. `README.md`
2. `prd.md`
3. `architecture.md`
4. `diagrams.md`
5. `rollout-plan.md`
6. `acceptance.md`

验证：

```bash
rg -n "make-next-generation-more-like-me|active memory|external memory provider|lime-rs/src" "internal/roadmap/memory"
rg -n "Soul|SOUL|soul|companion" "internal/roadmap/memory"
```

预期：

1. 不出现外部项目名或旧数据搬入口径。
2. 旧主线词只出现在 dead / 非目标 / 清理说明中。
3. Soul 出现在 current 和验收边界中；`companion_*` 只作为 dead 出现。
4. 上下文防腐、压缩和多模型预算都有 current owner 和验收标准。

## 3. Phase 1：Memory Store、Backend 合同与 Soul 保留

目标：

1. 定义 memory folder layout。
2. 定义 `MemoryBackend` request / response。
3. 实现本地文件系统 backend。
4. 建立 path traversal、symlink、hidden path 防护。
5. 保持 `memory.soul` 配置读写、模板、`SOUL.md` 导入 / 复制能力。

建议落点：

1. App Server / RuntimeCore current 主链。
2. 新增领域模块命名用 `memory_store` / `memory_tools`，不新增品牌前缀。
3. 路径解析复用统一 app path / workspace path 边界。
4. Soul 复用现有 `MemorySoulConfig` 和 `src/lib/soul/soulConfig.ts` 契约。

最小测试：

1. list/read/search/add note 单元测试。
2. symlink / traversal / hidden path 拒绝测试。
3. 非 UTF-8 文件跳过测试。
4. `SOUL.md` 导入预览、warning、应用草稿、复制输出测试。
5. artifact voice brief 不写长期记忆测试。

## 4. Phase 2：Summary 注入与 Memory Tools

当前进度：

1. 已完成 `memory_summary.md` prompt contributor：`RuntimeCore` 在 turn start 前通过 `MemoryAppDataSource::read_memory_store` 读取 summary，写入 `runtime_options.metadata.memory_store_prompt_context`，`runtime_backend` 在合成 system prompt 时追加受控 memory block。
2. 已覆盖空 summary 不注入、读取失败不阻塞、workspace scope 优先、summary block 标识为长期记忆且不是用户本轮输入。
3. 已完成 Soul 交互 contributor：运行时读取保存后的 `memory.soul` 配置，注入受控交互片段；不读取、不引用 `SOUL.md` 路径。
4. 已完成 dedicated memory tools 注册：`RuntimeBackend` 通过 App Server current `AppDataSource / MemoryAppDataSource` 注入 `memory_list`、`memory_read`、`memory_search`、`memory_add_note` native tools，避免只存在 catalog 的假入口。
5. 2026-06-19：已补聊天工具卡记忆使用证据展示，`memory_read` 可见 path / scope / citation，`memory_search` 可见 hit count / truncated / nextCursor 状态，`memory_add_note` 可见保存位置；五语言资源和 `InlineToolProcessStep` 回归已覆盖。tool telemetry 持久化仍不作为 P0 交付门槛，后续如需跨会话审计再进入 evidence 主线。

目标：

1. thread start / turn start 注入截断后的 `memory_summary.md`。
2. 注册 dedicated memory tools。
3. 工具输出带 citation 字段。
4. prompt 指令约束 quick memory pass，避免无界搜索。
5. Soul 作为交互 contributor 注入受控片段。

建议改动：

1. Prompt contributor 只读 summary。
2. Tool contributor 挂到 App Server current runtime。
3. Tool telemetry 记录 tool name、path scope、truncated。
4. 前端或 GUI 只展示工具结果，不自行读取 memory folder。
5. 专家 persona 只继承 Soul 的 `communication_rhythm`，不回写全局 Soul。

最小测试：

1. 空 summary 不注入。
2. 长 summary 截断。
3. `memory_search` 分页和 `matchMode`。
4. `memory_read` 的 `lineOffset / maxLines / maxTokens`。
5. Soul 关闭时不注入交互片段。
6. expert persona metadata 不包含 `SOUL.md` 文件路径。

如涉及 App Server JSON-RPC 或前端 API 网关，补：

```bash
npm run test:contracts
```

## 5. Phase 3：Context Packet、防腐层与多模型预算

目标：

1. 定义 `ContextPacket`、`ContextContributor`、`ContextAssembler`、`ContextBudgetPlanner` 和 `ProviderContextProfile` 合同。
2. 将 memory summary、Soul、project context、compaction artifact、tool schema、tail history 纳入 packet admission。
3. 建立 source / scope / trustLevel / sensitivity / tokenBudget / cacheKey / invalidation / citation 字段。
4. 建立单 packet 硬上限、总预算硬上限、secret-like / prompt injection / local path 泄露扫描。
5. provider adapter 只渲染 `AssembledContext`，不再拥有业务上下文选择权。

建议落点：

1. App Server / RuntimeCore context 子模块，避免继续膨胀中心 runtime 文件。
2. provider profile resolver 读取模型目录和用户配置，输出统一 profile。
3. 前端只读取 packet telemetry 摘要，不直接拼 prompt 或读取 memory folder。
4. 新增 governance guard：生产路径不得直接 append 未标记上下文片段。

最小测试：

1. memory summary / Soul / project context 都以 packet 进入 assembler。
2. 单 packet 超预算被截断或拒绝，并记录原因。
3. secret-like packet 被拒绝或送 review，不进入 provider messages。
4. 小窗口 provider profile 触发 admission 降级；大窗口 profile 不无界增加注入。
5. provider adapter 不读取 memory store 或 session DB。
6. `npm run test:contracts` 覆盖相关 App Server JSON-RPC / client / frontend gateway 变更。

GUI / E2E：

1. 设置页或诊断证据能看到本轮 packet admission / truncation / rejection 摘要。
2. Playwright / Electron E2E 必须验证真实 Desktop Host + App Server 链路下切换模型后预算行为可见。
3. 控制台不得出现 provider-specific prompt builder 或 mock fallback 作为生产路径。

## 6. Phase 4：Context Compaction 主链

目标：

1. 手动压缩和自动溢出压缩都走 App Server current session compact 边界。
2. 压缩只生成 session compaction artifact，不重写历史消息。
3. compaction artifact 记录 `contextEpoch`、`tailStartId`、summary token 数、触发原因、使用模型和生成时间。
4. 下轮注入压缩摘要时保留最近 tail history。
5. 压缩摘要不会自动写 `MEMORY.md`、`memory_summary.md` 或 ad-hoc note。

建议落点：

1. RuntimeCore session context / compaction 子模块。
2. Session store 保存 compaction checkpoint 和 context epoch。
3. memory rollout candidate 只在显式 export / handoff 时生成。

最小测试：

1. 手动 compact 写入 compaction artifact 和 context epoch。
2. overflow compact 由小窗口 provider profile 触发。
3. compaction 后下一轮包含 compaction packet 和 tail history。
4. 原始历史没有被重写，session read/list 仍能看到原始消息。
5. compaction artifact 不进入 memory search / index source。
6. 压缩失败不阻断下一轮 memory tools。

GUI / E2E：

1. Electron GUI smoke 或 Playwright 验证长对话触发压缩后仍能继续发起下一轮。
2. E2E 记录当前页面、URL、控制台 error、bridge / mock 状态和 compaction telemetry。
3. 生产路径不能依赖 renderer mock fallback 或 mock backend。

## 7. Phase 5：旧记忆与旧灵感库清理

当前进度：

1. 旧 `src/components/memory/**` 混合 MemoryPage、旧灵感保存 helper、旧 `unifiedMemory` / `memoryRuntime` 前端网关、旧 memory feedback 前端侧链已删除。
   - 2026-06-19：已删除残留空目录 `src/components/memory`，守卫收紧为旧目录本身不得恢复。
   - 2026-06-19：旧 `src/lib/api/memory.ts` 聚合网关和角色 / 世界观 / 大纲 CRUD 壳已删除，项目上下文读取收敛到 `src/lib/api/projectMemory.ts -> projectMemory/read`。
2. 旧 `lime-rs/crates/memory/**` SQLite memory crate、App Server 旧 `local_data_source/unified_memory.rs` 和旧 `processor/unified.rs` 已删除。
3. 旧 `project_memory_get` 已从 Electron Host command 白名单、truth bridge 和 DevBridge truth policy 中删除；只允许作为 retired guard、负向测试或 smoke 旧命令观察项出现。
4. `legacySurfaceCatalog` 与 `memoryStore.current-boundary.test.ts` 已把上述路径标记为 `dead / forbidden-to-restore`。
5. 旧 MemoryPage 的 `memoryLibrary.*` 多语言资源已删除，并由 `memoryStore.current-boundary.test.ts` 防回流。
6. 旧数据不迁移，不批量导入 memory store canonical content。
7. 2026-06-19：开发守卫和续测指南已清理旧入口指引；ESLint 不再提示恢复旧 `memory.ts` / `memoryRuntime.ts` / `memoryFeedback.ts` / `contextMemory.ts` 网关，Playwright 续测入口改为 `设置 -> 记忆` 的文件化 memory store / Soul current 路径。

目标：

1. 删除 `unified_memory_*` 产品入口和新增写入入口。
2. 删除 `memory_runtime_*` 默认 recall 入口。
3. 删除旧 MemoryPage 灵感库 / 高级诊断混合入口。
4. 为暂未物理删除的旧命令名、旧 UI 入口和旧 provider 口径补负向守卫。

建议改动：

1. 旧入口 fail-fast，而不是继续做数据导入或只读续命。
2. 旧 embedding 只保留到物理删除窗口，不进入 canonical file。
3. 删除前保留必要 retired guard。
4. 清理报告记录 remaining references、owner 和删除条件。

退出条件：

1. `unified_memory_*` 不再作为产品入口、写入入口或旁路事实源。
2. runtime 不再依赖 `memory_runtime_*` 做默认 recall。
3. 旧灵感库页面、旧 API 和旧 provider 口径不再服务业务流程，也不保留空目录作为未来落点。
4. `companion_*` 不再出现在 current 文档、命令目录或 GUI 主路径中。
5. `npm run governance:legacy-report` 中 memory 相关条目只允许表现为已删除、零引用或显式 retired guard；若出现 production 引用，必须先处理再继续 memory tools / Soul 注入。

## 8. Phase 6：用户控制与 Reset

目标：

1. 用户能查看 memory store 摘要状态。
2. 用户能清空全局或 workspace memory。
3. 用户能添加修正 note。
4. 用户能看到记忆是否参与当前 turn。
5. 当前默认 reset 明确保留 Soul；如后续增加 Soul reset，必须作为显式 scope 入口。

建议改动：

1. 设置页提供 memory summary、store health、reset。
   - 2026-06-19：已补 `memoryStore/health` / `memoryStore/reset` App Server current 方法、Rust / npm client、前端 `memoryStore` 网关和设置页日常记忆状态面板。
   - reset 当前默认只清文件化 memory store root 下的 `MEMORY.md`、`memory_summary.md`、notes、index 与稳定目录内容；执行后重建空布局。
   - reset 默认保留 `memory.soul`，设置页确认文案明确 AI 个性不会被清理。
   - 2026-06-19：日常记忆面板已补“添加记忆修正”入口，走 `memoryStore/addNote` 写入 ad-hoc note，保存后刷新 health；不会恢复旧灵感库入口。
   - 2026-06-19：`memory_list` / `memory_read` / `memory_search` / `memory_add_note` 工具卡已展示本轮记忆使用证据，默认可见 path、scope、citation、hit / entry count、truncated 状态；原始 tool output 不再作为记忆证据的主要 GUI 呈现。
2. reset 清 memory folder、index；旧 SQLite stage data 已随旧 memory crate / unified memory 删除，不再作为 current reset 对象。
3. reset 不删除 thread history。
4. 使用记忆的回答可展示 citation。
   - 2026-06-19：已在聊天工具卡中展示 `memory_read` citation 和 `memory_search` 命中 / 截断状态，用户无需展开原始 JSON 即可确认本轮是否读取或搜索过记忆。
5. Soul reset 不属于当前默认入口；后续如需要，必须定义显式参数和 UI，且不能被 memory folder 清空隐式触发。

最小测试：

1. reset 后 summary 不再注入。
   - 已覆盖后端 reset 会清空并重建 `memory_summary.md`。
2. reset 不删除 thread history。
   - 2026-06-19：已补 App Server JSON-RPC 集成验证，seed persisted session projection / event log 后调用 `memoryStore/reset`，确认 session list/read 和 event log 仍保留。
3. add note 后 note 文件存在且不会立即改 summary。
   - Phase 2 已覆盖 add note 写入 `extensions/ad_hoc/notes`；设置页已补用户可操作入口，summary 合并仍是后续 consolidation 入口。
4. 不含 Soul scope 的 reset 保留 `memory.soul`。
   - 已覆盖后端返回 `preserved_soul: true`，设置页确认文案和回归测试确认 reset 只调 `memoryStore/reset`。
5. 后续如果实现 Soul reset scope，必须覆盖恢复默认 Soul 配置。
   - 该项不作为 Phase 6 current 验收门槛；当前默认 reset 不包含 Soul，避免把交互配置误当长期记忆本体。
6. memory tools 证据在工具卡可见。
   - 已覆盖 `memory_read` 展示 path / citation 且不铺开原始 Markdown，`memory_search` 在英文环境展示命中数和截断状态。

## 9. Phase 7：派生索引

目标：

1. 当 memory folder 增大后，加入可选索引。
2. 索引只缓存 search projection，不保存 canonical content。
3. 支持 rebuild / health / fallback。

候选类型：

1. 内嵌全文索引。
2. 嵌入式搜索索引。
3. 可选向量索引。
4. 远端索引适配器。

准入条件：

1. 双平台打包验证通过。
2. 索引损坏能自动降级。
3. index 删除后可完整重建。
4. 不要求生产路径加载 mock backend。

当前进度：

1. 2026-06-19：已补 `memoryStore/index/rebuild` App Server current 方法、Rust / npm client、前端 `memoryStore` 网关和设置页“重建索引”入口。
2. 当前索引实现只写 `index/manifest.json` 派生 manifest，记录 `schemaVersion`、`sourceChecksum`、`indexedAt`、源文件数量和总字节数；不写入 canonical content。
3. search 仍以文件扫描为可用基线，`index/manifest.json` 被删除或损坏时不会阻断 `memory_search`。
4. reset 会删除 `index/`，重建入口可按当前 memory folder 完整再生成 manifest。
5. 全文索引库、向量库和远端索引适配器仍是后续可选项，不进入当前 P0 主线，也不得替代 `MEMORY.md` / `memory_summary.md` / notes 的事实源。

最小测试：

1. index 删除后可重建。
   - 已覆盖删除 `index/manifest.json` 后再次调用 rebuild 会重新生成 manifest。
2. index 损坏时 search 降级文本扫描。
   - 已覆盖写入损坏 manifest 后 `memory_search` 仍能命中文件内容。
3. manifest 只保存派生元数据。
   - 已覆盖 manifest schema version / source checksum / indexedAt，并保持搜索读取 canonical 文件。
4. GUI 维护入口走 current 网关。
   - 已覆盖设置页点击“Rebuild index”调用 `memoryStore/index/rebuild` 并刷新 health。

## 10. Phase 8：写入整理与审阅

目标：

1. 显式 consolidation 才能更新 `MEMORY.md` / `memory_summary.md`。
2. `memoryStore/addNote` 只写 `extensions/ad_hoc/notes/`，不立即污染当前 turn prompt。
3. 敏感、冲突或空 note 必须送 review，不进入 summary。
4. accepted / review note 都必须归档，避免同一条 note 重复整理。
5. GUI 只提供显式整理入口，不恢复旧灵感库或旧记忆入口。

当前进度：

1. 2026-06-19：已补 `memoryStore/consolidate` App Server current 方法、Rust / npm client、前端 `memoryStore` 网关和设置页“整理笔记”入口。
2. 当前 consolidation 只扫描 current 文件化 `extensions/ad_hoc/notes/*.md` 与 `rollout_summaries/*.md`；旧记忆、旧灵感库和旧 SQLite 数据不迁移、不读取、不导入。
3. accepted note 会归档到 `extensions/ad_hoc/processed/`，并追加到 `MEMORY.md` 的 `Consolidated notes` 和 `memory_summary.md` 的 `Consolidated memory`。
4. secret-like、冲突意图或空正文 note 会归档到 `extensions/ad_hoc/review/`，返回 warning，不写 summary。
5. 设置页整理入口走 `src/lib/api/memoryStore.ts -> AppServerClient -> memoryStore/consolidate`，不会直接扫描磁盘或调用旧路径。
6. 2026-06-19：已补 `memoryStore/review/list` / `memoryStore/review/resolve` App Server current 方法、Rust / npm client、前端 `memoryStore` 网关和设置页“审阅笔记”入口。
7. review accept 复用 consolidation 写入语义并归档到 `extensions/ad_hoc/processed/`；review reject 归档到 `extensions/ad_hoc/rejected/`，不更新 summary。
8. 2026-06-19：已补文件化审计日志 `audit/memory_events.jsonl`；`memoryStore/consolidate` 与 `memoryStore/review/resolve` 成功后追加 JSONL 事件，记录 operation、source / archived path、action、updated、processed / skipped / archived counts 与 warnings。该日志属于 current evidence / audit，不参与 `memory_search` 或派生索引 source，避免审计记录变成长期语义记忆。
9. 2026-06-19：`rollout_summaries/*.md` 已接入显式 consolidation 候选；accepted rollout summary 归档到 `rollout_summaries/processed/` 并追加 `MEMORY.md` / `memory_summary.md`，secret-like / 冲突内容归档到既有 review 队列，不影响当前 turn。
10. 2026-06-19：handoff bundle、replay case、analysis handoff 与保存后的 review decision 成功后会通过 App Server current `MemoryAppDataSource -> MemoryBackend` 写入 workspace scoped `rollout_summaries/*.md` 自动候选，记录 source、exportedAt、export root 和 referenced artifacts；导出只形成候选，不直接更新长期记忆正文。review decision template 只是空模板，不生成候选，避免噪音进入整理队列。
11. 2026-06-19：设置页日常记忆面板已补默认工作区运行摘要候选区，使用 `getDefaultProject()` 的 `rootPath` 进入 workspace scoped `memoryStore/list` / `memoryStore/read`，展示候选来源、导出时间、导出类型、导出位置和相关交付物；“整理候选”按钮显式调用 workspace scoped `memoryStore/consolidate`，不会直接扫描磁盘或恢复旧记忆入口。

最小测试：

1. accepted note 更新 `MEMORY.md` / `memory_summary.md`，并移动到 processed。
   - 已覆盖 `consolidate_accepts_notes_updates_summary_and_archives_processed_notes`。
2. secret-like 或冲突 note 进入 review，不更新 summary。
   - 已覆盖 `consolidate_reviews_secret_or_conflicting_notes_without_summary_update`。
3. add note 后不会立即改 summary。
   - 已覆盖 `add_note_only_writes_ad_hoc_note`。
4. handoff / replay / analysis / review decision save 会生成 rollout summary candidate，且必须等显式 consolidation 才进入 summary。
   - 已覆盖 `export_handoff_bundle_writes_current_session_bundle_to_workspace` 和 `export_runtime_review_residuals_write_current_session_artifacts`。
5. 前端网关 fail closed。
   - 已覆盖 `memoryStore API` 的 `memoryStore/consolidate` / `memoryStore/review/list` / `memoryStore/review/resolve` 响应形状校验。
6. GUI 维护入口走 current 网关。
   - 已覆盖设置页点击“Consolidate notes”调用 `memoryStore/consolidate` 并刷新 health。
   - 已覆盖设置页展示 review notes，并调用 `resolveMemoryStoreReviewNote` 接受 / 拒绝。
   - 2026-06-19：已补 Electron GUI smoke 覆盖设置页 `设置 -> 记忆` 真实桌面链路，确认日常记忆面板、候选刷新、审阅刷新、重建索引、显式整理、Soul 面板和高级导入 / 复制入口均可达，且不出现旧灵感库 / 旧 MemoryPage。
7. review list / accept / reject 只处理 current review note 文件。
   - 已覆盖 `review_list_reads_only_review_markdown_notes`。
   - 已覆盖 `review_accept_consolidates_review_note_and_archives_processed`。
   - 已覆盖 `review_reject_archives_without_summary_update`。
8. consolidation / review resolve 写入文件化审计日志，且 audit 不进入搜索或索引事实源。
   - 已覆盖 consolidate accepted / review / review accept / review reject 的 `audit/memory_events.jsonl` 追加断言。
   - 已覆盖 `audit_events_are_file_backed_but_excluded_from_search_and_index_sources`。
9. rollout summaries 作为显式 consolidation 候选接入，不自动污染当前 turn。
   - 已覆盖 `consolidate_accepts_rollout_summaries_only_on_explicit_consolidate`。
   - 已覆盖 `consolidate_reviews_sensitive_rollout_summaries_without_summary_update`。
10. GUI 可见性走 current 网关：已覆盖设置页读取默认工作区 `rollout_summaries/` 时调用 `memoryStore/list` / `memoryStore/read`，过滤 processed 候选并展示 source / export root / referenced artifacts；已覆盖设置页“整理候选”调用 workspace scoped `memoryStore/consolidate`；已覆盖候选加载失败时不阻断主面板。
11. Rust memory store current 后端验证：2026-06-19，`cargo test --manifest-path "lime-rs/Cargo.toml" -p app-server memory_store --lib` 通过，覆盖 16 个 memory store 后端测试。
12. 命令 / 协议 / mock 边界验证：2026-06-19，`npm run test:contracts` 通过，确认 App Server protocol、npm client、Electron command contract、DevBridge truth、mock priority、脚本治理和 docs boundary 均未漂移；`npm test -- --run "src/lib/api/memoryStore.test.ts" "src/lib/api/memoryStore.current-boundary.test.ts" "src/lib/api/projectMemory.test.ts" "src/lib/desktop-host/memoryMocks.test.ts" "src/lib/dev-bridge/commandPolicy.test.ts" "src/lib/dev-bridge/mockPriorityCommands.test.ts" "electron/ipcChannels.test.ts"` 通过，覆盖 47 个前端 / Electron / DevBridge 记忆边界守卫；`packages/app-server-client/tests/client.test.mjs` 与 `src/lib/api/memoryStore.test.ts` 通过，覆盖 63 个 client / memoryStore 网关测试。
13. legacy governance 状态：2026-06-19，`npm run governance:legacy-report` 当前仍被非记忆边界阻断：`rust-agent-thread-items-payload-json-truth-leak` 和 `rust-runtime-store-hardcoded-platform-path-leak`；本轮记忆相关旧入口扫描只命中 retired guard、负向测试或文档 dead/cleanup 说明，未发现 production 回流。

剩余：

1. Phase 8 当前功能闭环已完成；后续只剩更多 export 类型接入候选策略时继续补对应写入测试和 GUI 可见性回归。
2. 全仓 `governance:legacy-report` 的剩余阻断属于非记忆边界，另行回到对应主线处理，不作为 memory store current 交付缺口。

## 11. E2E 完整测试门槛

每个触及记忆 / 上下文 / 压缩 / 多模型预算的阶段，不能只以单测或 typecheck 作为可交付结论。最低 E2E 标准：

1. 真实 Electron Desktop Host + App Server bridge 已启动并健康。
2. `npm run verify:gui-smoke` 覆盖设置页 `设置 -> 记忆` 主路径。
3. Playwright 复走真实 GUI：进入设置页记忆、查看 health、添加修正、刷新候选、审阅、整理、重建索引、Soul 导入 / 复制入口。
4. 上下文治理阶段必须额外验证 packet admission / truncation / rejection 证据。
5. 压缩阶段必须额外验证长会话压缩后继续对话，且原始历史仍可读。
6. 多模型阶段必须额外验证至少一个小窗口 profile 与一个大窗口 profile 的预算差异。
7. 控制台 error 基线、bridge / mock 分类、当前 URL、可见页面状态必须记录到 `internal/exec-plans/`。
8. 如发现产品阻塞、桥接缺口或测试缺口，先做最小修复并复测，不把环境噪音误报为通过。

## 12. 每轮完成定义

每个阶段收尾必须回答：

1. 当前唯一记忆事实源是否仍是 memory store。
2. Soul 是否仍在 `memory.soul` 配置层，而不是长期记忆文件。
3. 旧 `unified_memory_*` / `memory_runtime_*` 是否只在 dead / cleanup 范围。
4. 是否新增了平行记忆事实源。
5. summary 注入是否有预算和空态处理。
6. 工具结果是否可 citation。
7. 派生索引是否可删除、可重建、可降级。
8. 所有模型可见上下文是否都经过 `ContextAssembler`。
9. compaction 是否只作为 session context artifact，而不是长期记忆事实源。
10. provider / model 差异是否只存在于 `ProviderContextProfile` 和 adapter。
11. GUI / E2E 是否覆盖真实 Desktop Host + App Server 链路。
