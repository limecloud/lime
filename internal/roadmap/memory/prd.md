# Lime 记忆与上下文治理系统 PRD
> 2026-10-25：本文件仅保留历史实施证据，不再约束产品。旧 Soul、风格包及创作声线已删除；现役边界以 [记忆与上下文](../../aiprompts/memory-compaction.md) 和 [执行计划](../../exec-plans/browser-runtime-right-surface-plan.md) 为准。下文原有保留要求和未完成清单均已失效。

> 状态：historical / superseded
> 更新时间：2026-06-19
> 产品口径：普通用户不需要理解记忆系统或上下文压缩；Agent 通过受控工具使用文件化记忆；运行时通过结构化上下文防腐层和多模型预算使用上下文；Soul 继续承接用户可编辑的交互身份和沟通节奏。

## 1. 背景

Lime 当前已有 SQLite / `unified_memory_*` / `memory_runtime_*` 等记忆相关能力，但路线图继续沿这些对象扩展，会把长期资产、运行时召回、诊断、灵感库和语义检索混在一起。

本次裁决改为文件化记忆主线：

```text
memory folder
  -> memory_summary.md 默认注入
  -> MEMORY.md 作为登记册
  -> memory tools 按需 list/read/search/add note
  -> ContextPacket / ContextAssembler 管理所有模型可见片段
  -> ContextCompaction 处理 session 历史压缩续接
  -> ProviderContextProfile 支持多模型预算和能力差异
  -> backend trait 隔离本地文件系统和未来索引
  -> memory.soul 保存交互身份和沟通节奏
  -> SQLite 只保存线程 / turn 状态、压缩 checkpoint、清理标记、reset / rebuild 记录和非语义派生索引元数据
```

旧记忆实现不做数据导入。旧数据只作为删除前的历史状态，不进入新的 canonical store。
上下文压缩不做历史改写，也不自动进入长期记忆。

## 2. 用户与场景

### 2.1 普通用户

普通用户只关心 Lime 是否能保持一致，不需要管理数据库或索引。

必须支持：

1. 清楚知道“Lime 可能使用已保存记忆帮助保持一致”。
2. 可以关闭或清空某个 workspace / 全局记忆。
3. 可以查看和删除可读的记忆文件或条目。
4. 记忆错误时，有明确入口添加修正备注。
5. 可以继续编辑 Soul，或通过 `SOUL.md` 导入 / 复制交互身份快照。
6. 长对话变长时，Lime 能自动或手动压缩上下文，并清楚标识当前对话仍可继续。
7. 切换不同模型时，不会因为上下文窗口不同导致无界注入、历史丢失或记忆污染。

### 2.2 Agent / 运行时

Agent 需要轻量、可审计地读取记忆。

必须支持：

1. 每轮自动收到截断后的 `memory_summary.md`。
2. 只有在任务相关时才搜索 `MEMORY.md` 和被指向的明细文件。
3. 读取结果必须包含 path、line range、content、truncated。
4. 最终回答如使用记忆，必须能生成引用数据。
5. 聊天工具卡必须能展示记忆工具使用证据，普通用户不需要展开原始 JSON 才知道是否读取或写入了记忆。
6. Soul 只作为交互节奏和 artifact voice generation brief 参与，不替代 memory tools。
7. 所有外部上下文都必须通过 typed packet 注入，带来源、信任级别、预算、截断和 citation。
8. 上下文压缩摘要只能作为 session context packet 使用，不替代 memory store，也不覆盖原始历史。
9. 工具 schema、memory summary、Soul、项目上下文、压缩摘要和历史尾部必须按模型 profile 分配预算。

### 2.3 开发者 / 诊断用户

开发者需要解释记忆是否被使用、用了什么、为什么没有命中。

必须支持：

1. 查看 memory store 路径和健康状态。
2. 查看 summary 注入预算与截断状态。
3. 查看 memory tools 的调用记录和 citation。
4. 查看派生索引状态。
5. 查看 Soul 当前是否启用、来自手工配置还是 `SOUL.md` 导入快照。
6. 查看本轮 context packet admission / rejection / truncation 摘要。
7. 查看上下文压缩触发原因、压缩摘要 token 数、保留尾部范围和 provider profile。
8. 区分 provider 限制、上下文预算不足、记忆工具未命中和安全防腐拒绝。

## 3. P0 目标

1. 定义 `MemoryBackend` 合同：`list` / `read` / `search` / `add_ad_hoc_note`。
2. 定义平台无关 memory store 布局，不硬编码 macOS / Windows 路径。
3. 默认只注入 `memory_summary.md` 的截断内容。
4. 提供本地文件系统 backend。
5. 提供 dedicated memory tools。
6. 搜索先使用文本匹配和行窗口，不引入向量数据库。
7. 新写入只进入 ad-hoc note 或待整理区，不直接改 summary。
8. 保留 SQLite 作为线程 / turn 状态、清理状态和非语义派生索引元数据存储，不作为语义检索主线。
9. 保留 `memory.soul`、`SOUL.md` 导入 / 复制、模板和导入 warning。
10. 定义 `ContextPacket`、`ContextContributor`、`ContextAssembler` 和 `ContextBudgetPlanner` 合同。
11. 定义上下文防腐规则：source、scope、trustLevel、sensitivity、citation、cacheKey、invalidation、tokenBudget。
12. 定义 `ProviderContextProfile`，支持不同 provider / model 的 context window、output reserve、tool schema 限制和自动压缩阈值。
13. 手动压缩继续走 App Server current session compact 边界，并生成 session compaction artifact。
14. 所有模型可见单项片段必须有硬上限；超过阈值的新增片段必须有专项测试和人工评审入口。

## 4. P1 目标

1. 增加 memory reset：清空 memory folder 和派生 index，不迁移、不读取、不重置旧 SQLite 语义记忆数据。
2. 增加 citation 输出合同，支持最终回答回挂记忆来源。
3. 增加显式 consolidation：把 ad-hoc notes 和 rollout summaries 整理进 `MEMORY.md` / `memory_summary.md`。
4. 删除旧 `unified_memory_*` / `memory_runtime_*` 的产品入口、写入入口和默认召回入口。
5. 给暂未物理删除的旧命令名补 fail-fast / retired guard。
6. 专家 persona 仅继承 Soul 的 `communication_rhythm`，不得回写全局 Soul。
7. 增加自动溢出压缩：当 next turn 预算超过 provider profile 阈值时生成 compaction artifact，并保留最近尾部消息。
8. 增加 context packet telemetry 和 GUI 证据，让 E2E 能判断真实注入、截断、拒绝和压缩状态。
9. 增加多模型上下文预算回归：小窗口模型触发压缩或降级，大窗口模型不无界增加注入。

## 5. P2 目标

1. 增加可选派生索引，用于大 memory folder 的快速检索。
2. 派生索引必须可删除、可重建、可降级到文本扫描。
3. 派生索引可以是内嵌全文索引、嵌入式搜索索引、可选向量索引或远端索引适配，但不得成为 canonical store。
4. 增加索引健康检查和 rebuild 入口。
5. 增加可选远端 provider context profile 动态刷新，但 profile 输出仍必须归一到统一合同。
6. 增加更细的 packet cache 策略，减少稳定上下文变动导致的缓存失效。

## 6. 非目标

本 PRD 不做：

1. 不新增或保留 `inspiration_*` 长期表。
2. 不把 `unified_memory_*` 继续作为下一代记忆事实源。
3. 不把 `memory_runtime_*` 继续作为默认召回主线。
4. 不把旧记忆或旧灵感库数据批量导入为新事实源。
5. 不默认引入向量数据库。
6. 不实现 external memory provider。
7. 不实现 active recall / dreaming / auto organization。
8. 不把普通用户主导航做成记忆诊断工作台。
9. 不把 Soul 当作旧 `companion_*` 桌宠链路。
10. 不恢复任何 `lime-rs/src/**` 旧路径。
11. 不允许 feature 代码绕过 `ContextAssembler` 自行拼接模型上下文。
12. 不做历史消息重写式压缩。
13. 不把压缩摘要自动写入长期记忆。
14. 不为每个 provider 复制一套记忆、Soul 或压缩逻辑。

## 7. 功能需求

### 7.1 Memory Store

目标布局：

```text
memories/
  memory_summary.md
  MEMORY.md
  rollout_summaries/
  skills/
  extensions/
    ad_hoc/
      notes/
  index/
```

要求：

1. 根路径必须通过统一 app path / workspace path resolver 取得。
2. 所有工具返回相对路径。
3. 默认跳过隐藏文件、symlink 和越界路径。
4. 非 UTF-8 文件不报错扩散，按不可读跳过。

### 7.2 Prompt 注入

要求：

1. 只读取 `memory_summary.md`。
2. 空文件不注入。
3. 超预算必须截断。
4. 注入内容标明它是记忆摘要，不是用户本轮输入。
5. summary 不得包含凭证、完整密钥、未脱敏个人敏感信息。
6. 注入必须先形成 memory summary context packet，再由 assembler 统一 admission。
7. summary packet 必须记录 citation、tokenBudget、actualTokens、truncated 和 cacheKey。

### 7.3 Memory Tools

P0 工具：

1. `memory_list`
2. `memory_read`
3. `memory_search`
4. `memory_add_note`

要求：

1. `memory_search` 支持多 query、match mode、case sensitive、normalized、cursor、context lines。
2. `memory_read` 支持 line offset、max lines、max tokens。
3. `memory_add_note` 只写 ad-hoc note，不直接改 `MEMORY.md`。
4. 所有工具输出 JSON，并保留 citation 所需字段。

### 7.4 Soul

要求：

1. `memory.soul` 继续保存 `MemorySoulConfig`。
2. `SOUL.md` 导入必须先预览，再应用到草稿并保存。
3. `SOUL.md` 导入保留 `project_rules`、`local_path`、`secret_like`、`too_long` warning。
4. `SOUL.md` 复制输出只是快照；运行时使用保存后的 app config。
5. `artifact_voice` 只生成 `generation_brief_only`，不得写入 `MEMORY.md` 或 `memory_summary.md`。
6. 专家 persona 可以继承全局 Soul 的沟通节奏，但不得回写全局 Soul。

### 7.5 写入与整理

要求：

1. 用户显式要求“记住”时，写入 ad-hoc note。
2. 会话结束或空闲时可生成 rollout summary。
3. consolidation 只能通过明确操作或后续受控调度更新 `MEMORY.md` / `memory_summary.md`。
4. 自动候选或受控调度也必须经过 secret / injection scan、review 队列和审计日志。
5. 写入当前 turn 后不应立即改写同一 turn 的 prompt。
6. 运行导出只能先写入 `rollout_summaries/*.md` 候选，必须等显式 consolidation 才进入长期记忆正文。

### 7.6 上下文防腐

要求：

1. 新增模型可见内容必须实现 typed context contributor。
2. packet 必须包含 source、scope、role、trustLevel、sensitivity、tokenBudget、cacheKey、invalidation 和 citation。
3. 单 packet 默认硬上限不超过 1k token；确需超过时必须在路线图或执行计划记录原因、风险和专项 E2E。
4. 单 packet 不允许超过 10k token；超出只能转文件引用或工具读取。
5. secret-like、prompt injection、local path 泄露和未审计外部内容必须被拒绝、脱敏或送 review。
6. provider adapter 不得接收未经过 `ContextAssembler` 的业务上下文。

### 7.7 上下文压缩

要求：

1. 手动压缩和自动溢出压缩使用同一 App Server current session compact 边界。
2. 压缩只生成 session compaction artifact，不重写历史消息。
3. compaction artifact 记录 `contextEpoch`、`tailStartId`、summary token 数、触发原因、使用模型和生成时间。
4. 下轮注入压缩摘要时必须保留最近 tail history 预算，避免摘要覆盖最新事实。
5. 压缩摘要不会自动写入 `MEMORY.md`、`memory_summary.md` 或 ad-hoc note。
6. 压缩失败不阻断 memory tools，不删除 thread / turn 状态。

### 7.8 多模型预算

要求：

1. provider / model 只通过 `ProviderContextProfile` 暴露能力。
2. profile 至少包含 context window、max output、output reserve、tool schema 限制、reasoning / summary 支持、cache 支持和 auto compact threshold。
3. `ContextBudgetPlanner` 必须按 profile 为 memory、Soul、project context、tool schema、compaction summary、tail history 和 diagnostics 分配预算。
4. 切换模型只影响 packet admission / truncation / compaction 策略，不改变 memory store、Soul 或 session history。
5. provider adapter 只做消息格式和 tool schema 转换，不拥有业务上下文选择权。

### 7.9 旧实现清理

要求：

1. 删除旧 `unified_memory_*` 新增写入入口。
2. 删除旧 `memory_runtime_*` 默认 recall 入口。
3. 删除旧 MemoryPage 灵感库 / 高级诊断混合视图入口。
4. 旧 embedding BLOB 不成为新事实源。
5. 清理状态可以记录到 SQLite，但不能把 SQLite 变回语义记忆 store。
6. 旧入口被删除前只允许 fail-fast / retired guard，不允许新增兼容业务逻辑。
7. 旧压缩命令或旧 runtime recall 不能被改造成 context 防腐入口。

## 8. 成功指标

1. 每轮默认注入 token 稳定，不随历史线性增长。
2. 记忆工具读取结果都能追溯到 path / line。
3. 关闭或清空 memory store 后，不再读取旧记忆。
4. 旧记忆和旧灵感库入口被删除或 retired guard 封住。
5. Soul 导入 / 复制、模板、warning 和 artifact voice brief 仍可用。
6. 派生索引损坏时，系统能降级到文本扫描。
7. 普通用户无需理解向量库、provider、hit layer 或 runtime prefetch。
8. 任意 turn 的模型可见上下文都能解释 packet 来源、预算、截断和拒绝原因。
9. 长对话在小窗口模型下能完成手动或自动压缩续接，不重写历史、不污染长期记忆。
10. 多模型切换不会产生 provider-specific 记忆副本或 prompt 分叉。
11. E2E 能证明设置页记忆、工具证据、压缩续接和 provider profile 预算使用真实 App Server / Desktop Host 链路。

## 9. 风险

1. 文本搜索召回不如向量搜索。
   缓解：P0 先保证可审计；P2 再加可重建派生索引。

2. 文件化记忆被误写敏感内容。
   缓解：写入前扫描；summary 生成前二次脱敏；用户可清空。

3. 旧记忆系统与新 memory folder 并存过久。
   缓解：旧实现只允许删除或 retired guard，不提供兼容续命。

4. Agent 过度搜索记忆。
   缓解：prompt 中设置 quick pass 预算；工具层限制分页和结果数。

5. Soul 被误归为旧桌宠链路。
   缓解：文档和验收明确 `memory.soul` 是 current 交互配置，`companion_*` 才是 dead。

6. 业务代码绕过防腐层直接拼上下文。
   缓解：所有新增上下文入口必须通过 `ContextContributor`；补契约守卫和 E2E packet telemetry 断言。

7. 多模型支持变成多套 prompt 分支。
   缓解：provider 差异只进入 `ProviderContextProfile` 和 adapter；memory / Soul / compaction 不写 provider 专属逻辑。

8. 压缩摘要丢失关键事实。
   缓解：保留 tail window、记录 context epoch、允许手动查看压缩证据，并通过 E2E 验证压缩后继续对话。
