# Lime 记忆与上下文治理图谱
> 2026-10-25：本文件仅保留历史实施证据，不再约束产品。旧 Soul、风格包及创作声线已删除；现役边界以 [记忆与上下文](../../aiprompts/memory-compaction.md) 和 [执行计划](../../exec-plans/browser-runtime-right-surface-plan.md) 为准。下文原有保留要求和未完成清单均已失效。

> 状态：historical / superseded
> 更新时间：2026-06-19
> 目标：用图固定文件化记忆、上下文防腐、上下文压缩、多模型预算、summary 注入、工具读取、Soul 配置、显式整理和旧路径清理边界。

## 1. 总体架构

```mermaid
flowchart TB
  User[用户] --> Thread[thread/start 或 turn/start]
  Thread --> Config[读取 memory config]
  Thread --> Profile[ProviderContextProfile]
  Config --> Store[Memory Store Root]
  Config --> Soul[memory.soul]
  Store --> Summary[memory_summary.md]
  Summary --> PacketA[Memory Summary Packet]
  Soul --> PacketB[Soul Packet]
  History[Session History] --> Compact{需要压缩?}
  Compact -- 是 --> CompactJob[ContextCompaction]
  CompactJob --> CompactPacket[Compaction Packet]
  Compact -- 否 --> Tail[Tail History Packet]
  PacketA --> Anti[Context Anticorruption]
  PacketB --> Anti
  CompactPacket --> Anti
  Tail --> Anti
  Project[Project Context] --> Anti
  ToolsSchema[Tool Schema] --> Anti
  Anti --> Assembler[ContextAssembler]
  Profile --> Budget[ContextBudgetPlanner]
  Budget --> Assembler
  Assembler --> Prompt[Assembled Context]
  Prompt --> Adapter[Provider Adapter]
  Adapter --> Agent[Agent Loop]

  Agent --> NeedMemory{需要更多记忆?}
  NeedMemory -- 否 --> Answer[继续生成]
  NeedMemory -- 是 --> Tools[Memory Tools]
  Tools --> Backend[MemoryBackend]
  Backend --> Files[(MEMORY.md / rollout_summaries / notes)]
  Backend --> Index[(Derived Index 可选)]
  Files --> Tools
  Index --> Tools
  Tools --> Agent
  Tools --> Evidence[聊天工具卡证据]

  User --> Note[显式要求记住]
  Note --> AddNote[memory_add_note]
  AddNote --> Adhoc[extensions/ad_hoc/notes]
  Export[handoff / replay / analysis / review decision] --> Rollout[rollout_summaries candidate]
  Adhoc --> Consolidation[显式整理]
  Rollout --> Consolidation
  Consolidation --> Review[extensions/ad_hoc/review]
  Review --> Resolve[review resolve]
  Resolve --> Consolidation
  Consolidation --> MemoryMd[MEMORY.md]
  Consolidation --> Summary
  Consolidation --> Audit[audit/memory_events.jsonl]

  User --> SoulEditor[Soul 编辑 / SOUL.md 导入]
  SoulEditor --> Soul
  Soul --> Brief[artifact voice generation brief]
  Brief --> Anti

  classDef current fill:#E8FFF6,stroke:#10B981,color:#064E3B;
  classDef optional fill:#FFF7ED,stroke:#F97316,color:#7C2D12;
  classDef store fill:#F8FAFC,stroke:#64748B,color:#0F172A;

  class Summary,PacketA,PacketB,Anti,Assembler,Budget,Prompt,Adapter,Tools,Backend,Consolidation,Soul,Brief,Evidence,Resolve,Profile,CompactJob,CompactPacket,Tail current;
  class Index optional;
  class Store,Files,Adhoc,MemoryMd,Rollout,Review,Audit,History store;
```

固定判断：

1. 默认 prompt 只注入经过 packet 化和防腐检查的 summary、Soul、压缩摘要、项目上下文和尾部历史。
2. 原文记忆只通过工具按需读取。
3. Soul 是交互配置，不是 memory store 文件本体。
4. 派生索引可选，不能替代文件事实源。
5. 运行导出只先形成候选，显式整理后才进入长期记忆正文。
6. provider adapter 只渲染 `AssembledContext`，不重新选择业务上下文。

## 2. Read Path

```mermaid
sequenceDiagram
  autonumber
  participant Runtime as App Server Runtime
  participant Store as Memory Store
  participant Context as ContextAssembler
  participant Profile as Provider Profile
  participant Soul as Soul Contributor
  participant Agent as Agent Loop
  participant Tools as Memory Tools
  participant Backend as MemoryBackend

  Runtime->>Store: resolve memory root
  Runtime->>Soul: load saved memory.soul
  Runtime->>Profile: resolve model budget
  Context->>Store: collect memory_summary.md packet
  Store-->>Context: summary text + metadata
  Soul-->>Context: interaction rhythm packet
  Context->>Context: anticorruption + budget + truncation
  Context-->>Agent: assembled provider messages
  Agent->>Tools: memory_search({ queries })
  Tools->>Backend: search(request)
  Backend-->>Tools: matches(path,line,content)
  Tools-->>Agent: JSON hits
  Agent->>Tools: memory_read(path,lineOffset)
  Tools->>Backend: read(request)
  Backend-->>Tools: content + citation fields
  Tools-->>Agent: JSON content
```

验收重点：

1. summary 读取失败不阻塞 turn。
2. search/read 输出必须可引用。
3. 工具不能返回绝对路径。
4. Soul 缺失或关闭时不影响 memory tools。
5. packet admission / rejection / truncation 必须可审计。

## 3. Context Assemble Path

```mermaid
sequenceDiagram
  autonumber
  participant Runtime as RuntimeCore
  participant Profile as ProviderContextProfile
  participant Contributors as Context Contributors
  participant Anti as Context Anticorruption
  participant Budget as ContextBudgetPlanner
  participant Adapter as Provider Adapter

  Runtime->>Profile: resolve(provider, model)
  Runtime->>Contributors: collect(turn, thread, workspace)
  Contributors-->>Runtime: ContextPacket[]
  Runtime->>Anti: scan source/trust/sensitivity
  Anti-->>Runtime: accepted + review + rejected
  Runtime->>Budget: reserve output/tools/tail/memory/soul
  Budget-->>Runtime: admission plan
  Runtime->>Adapter: render AssembledContext
  Adapter-->>Runtime: provider messages + tool schema
```

固定规则：

1. contributor 只产出 packet，不拼 provider 消息。
2. 防腐层先于预算 admission，不能用截断掩盖敏感内容。
3. provider adapter 不得读取 memory store 或 session DB。
4. 所有 rejected packet 都必须有机器可读原因。

## 4. Search Path

```mermaid
flowchart TD
  Search[memory_search] --> Validate[参数校验]
  Validate --> Scope[resolve scoped path]
  Scope --> HasIndex{派生索引健康?}
  HasIndex -- 是 --> Indexed[Indexed search]
  HasIndex -- 否 --> Text[Text scan fallback]
  Indexed --> Normalize[排序 / 分页 / 截断]
  Text --> Normalize
  Normalize --> Result[SearchMemoriesResponse]

  Validate --> RejectEmpty[拒绝空 query]
  Scope --> RejectPath[拒绝 symlink / hidden / traversal]
```

P0 固定：

1. 文本扫描是 baseline。
2. 派生索引只是优化。
3. 索引坏了不影响读取记忆。

## 5. Write Path

```mermaid
sequenceDiagram
  autonumber
  participant User as 用户 / Agent
  participant Tool as memory_add_note
  participant Store as Memory Store
  participant Scan as Safety Scan
  participant Queue as Ad-hoc Notes
  participant Rollout as Rollout Candidates
  participant Job as Consolidation Job
  participant Review as Review Queue
  participant Memory as MEMORY.md
  participant Summary as memory_summary.md
  participant Audit as audit/memory_events.jsonl

  User->>Tool: add note(filename,note)
  Tool->>Scan: validate filename and content
  Scan-->>Tool: safe / warning
  Tool->>Queue: write extensions/ad_hoc/notes/file.md
  Queue-->>User: note accepted
  User->>Rollout: export handoff / replay / analysis candidate
  Job->>Queue: read pending notes
  Job->>Rollout: read pending rollout summaries
  Job->>Review: move risky or conflicting content
  Job->>Memory: propose/update entries
  Job->>Summary: refresh compact summary
  Job->>Audit: append operation event
```

固定判断：

1. 写 note 不等于立即改 summary。
2. consolidation 失败不应让当前 turn 失败。
3. 敏感内容必须停在待审状态。
4. review reject 不更新 summary。
5. audit 日志不参与 search / index source。

## 6. Soul Path

```mermaid
flowchart TD
  Settings[settings.memory.soul] --> Config[MemorySoulConfig]
  Import[SOUL.md import] --> Preview[parse + warnings + preview]
  Preview --> Apply[apply draft and save]
  Apply --> Config
  Config --> Interaction[interaction identity / communication rhythm]
  Config --> ArtifactVoice{artifact_voice enabled?}
  ArtifactVoice -- 是 --> Brief[generation_brief_only]
  ArtifactVoice -- 否 --> NoBrief[no artifact voice brief]
  Interaction --> Runtime[Runtime prompt contributor]
  Brief --> Runtime
  Expert[Expert persona] --> Scope[inherit communication_rhythm only]
  Scope --> Runtime
```

固定判断：

1. `SOUL.md` 是导入 / 复制快照，运行时事实源是保存后的 `memory.soul`。
2. 导入 warning 不能被跳过。
3. artifact voice 只进入 generation brief，不写 `MEMORY.md` / `memory_summary.md`。
4. expert persona 不回写全局 Soul。

## 7. Context Compaction Path

```mermaid
sequenceDiagram
  autonumber
  participant Runtime as RuntimeCore
  participant Budget as ContextBudgetPlanner
  participant History as Session History
  participant Compact as ContextCompaction
  participant Store as Session Store
  participant Context as ContextAssembler

  Runtime->>Budget: estimate next turn tokens
  Budget-->>Runtime: under budget / needs compact
  Runtime->>Compact: manual compact or overflow compact
  Compact->>History: read durable history
  Compact->>Compact: summarize older window
  Compact->>Store: write compaction artifact + contextEpoch
  Runtime->>Context: next turn collect compaction packet + tail history
  Context-->>Runtime: assembled context
```

固定判断：

1. 压缩生成 artifact，不改写历史消息。
2. 压缩摘要只作为 session context packet 注入。
3. 最近 tail history 保留原文窗口。
4. 压缩摘要如要长期保存，必须先转 rollout candidate，再显式 consolidation。

## 8. Multi-Model Budget Path

```mermaid
flowchart TD
  Model[provider + model] --> Profile[ProviderContextProfile]
  Profile --> Window[context window]
  Profile --> Output[output reserve]
  Profile --> ToolSchema[tool schema budget]
  Profile --> Reasoning[reasoning / summary support]
  Profile --> Cache[cache policy]
  Window --> Planner[ContextBudgetPlanner]
  Output --> Planner
  ToolSchema --> Planner
  Reasoning --> Planner
  Cache --> Planner
  Planner --> Admit[packet admission]
  Planner --> Compact[auto compact threshold]
  Admit --> Adapter[provider adapter]
  Compact --> ContextCompaction[ContextCompaction]
```

固定判断：

1. 切模型只改变 profile 和 admission 计划。
2. memory store、Soul 和 session history 不随 provider 分叉。
3. 小窗口模型触发压缩或降级，大窗口模型也不能无界注入。

## 9. Old Path Shutdown

```mermaid
flowchart LR
  OldUnified[unified_memory_*] --> RemoveUnified[remove entrypoints]
  OldRuntime[memory_runtime_*] --> RemoveRuntime[remove default recall]
  OldPage[old mixed MemoryPage / inspiration library] --> RemovePage[remove page and routes]
  OldInspiration[inspiration_*] --> RemoveInspiration[forbidden to restore]
  RemoveUnified --> Guard[fail-fast / retired guard / negative tests]
  RemoveRuntime --> Guard
  RemovePage --> Guard
  RemoveInspiration --> Guard
  Guard --> Current[Memory Store + Tools + Soul]
```

清理规则：

1. 旧数据不批量导入为 canonical truth。
2. 旧 embedding 不进入 canonical truth。
3. 旧入口只允许删除、fail-fast 或 retired guard，不允许只读续命。
4. 旧灵感库不再作为产品入口或旁路事实源。

## 10. Reset Path

```mermaid
flowchart TD
  Reset[memory/reset] --> Confirm[确认范围]
  Confirm --> ClearStore[清空 memory folder]
  Confirm --> ClearIndex[删除 index]
  Confirm --> KeepThread[保留 thread / turn 状态]
  Confirm --> KeepSoul[默认保留 memory.soul]
  Confirm --> SoulFuture[后续显式 Soul scope]
  SoulFuture -.可选.-> ResetSoul[重置 memory.soul]
  ClearStore --> Done[返回成功]
  ClearIndex --> Done
  KeepThread --> Done
  ResetSoul --> Done
  KeepSoul --> Done
```

要求：

1. reset 必须明确全局 / workspace 范围。
2. reset 不应误删线程历史。
3. reset 后下一轮不再注入旧 summary。
4. 当前默认 reset 保留 Soul；如后续增加 Soul reset，必须由用户显式选择范围，不能被 memory folder 清空隐式删除。
