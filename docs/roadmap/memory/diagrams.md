# 灵感库 / 记忆系统图谱

> 状态：current diagrams  
> 更新时间：2026-05-01  
> 目标：用架构图、时序图和流程图固定普通用户灵感库与底层记忆主链的边界。

## 1. 总体架构图

```mermaid
flowchart TB
  User[普通创作者] --> UI[灵感库前台]
  Creator[进阶创作者] --> UI
  Dev[开发者 / 内测诊断] --> DevPanel[开发者面板 / 高级设置]
  DevPanel --> Gate{记忆高级开关}
  Gate -- 开启 --> Diagnostics[高级记忆诊断]
  Gate -- 关闭 --> NoDiag[只关闭增强 / 诊断]

  UI --> Projection[Inspiration Projection Layer]
  UI --> Actions[Action Orchestration Layer]

  Projection --> UnifiedApi[unified_memory_* API]
  Actions --> UnifiedApi
  Actions --> Recommendation[推荐信号 / creation replay]
  Actions --> Launcher[Curated Task Launcher]

  UnifiedApi --> UnifiedStore[(Unified Memory Store)]
  UnifiedStore --> RuntimeRecall[durable recall]
  RuntimeRecall --> BaselinePack[常开 baseline brief]

  Launcher --> RuntimeTurn[agent_runtime_submit_turn]
  RuntimeTurn --> Prefetch[memory_runtime_prefetch_for_turn]
  Prefetch --> RuntimeSources[来源链 / working / durable / team / compaction]
  RuntimeSources --> PromptAug[Prompt Augmentation]
  BaselinePack --> PromptAug
  PromptAug --> AgentLoop[Agent Query Loop]

  Diagnostics --> RuntimeApi[memory_runtime_* stable read model]
  Diagnostics --> ActiveRecall[active recall / external provider trace]
  ActiveRecall --> Fenced[untrusted fenced context]
  RuntimeApi --> RuntimeSources

  AgentLoop --> Result[生成结果 / artifact]
  Result --> Save[保存到灵感库]
  Save --> Actions

  classDef user fill:#E8FFF6,stroke:#10B981,color:#064E3B;
  classDef product fill:#EFF6FF,stroke:#3B82F6,color:#1E3A8A;
  classDef runtime fill:#FFF7ED,stroke:#F97316,color:#7C2D12;
  classDef store fill:#F8FAFC,stroke:#64748B,color:#0F172A;

  class User,Creator,Dev user;
  class UI,Projection,Actions,Recommendation,Launcher product;
  class RuntimeTurn,Prefetch,RuntimeSources,PromptAug,AgentLoop,Diagnostics,RuntimeApi,ActiveRecall,Fenced,BaselinePack runtime;
  class DevPanel,Gate,NoDiag product;
  class UnifiedStore,UnifiedApi store;
```

固定判断：

- `灵感库前台` 只接 projection 和 action orchestration。
- `高级记忆诊断` 只读 `memory_runtime_*`，并受开发者面板开关控制。
- 两者共享底层事实源，但不共享前台语言。
- 开发者开关关闭时只关闭增强 / 诊断，不关闭常开 baseline。

## 1.1 Memory Baseline / Enhancement 成本流

```mermaid
flowchart TD
  Request[生成请求] --> Budget[确定预算档位]
  Budget --> Baseline[读取常开 baseline]
  Baseline --> SmallPack[禁用列表 / 已确认偏好 / taste voice summary / evidence id]
  SmallPack --> Brief[编译短 Generation Brief]
  Budget --> EnhancedGate{增强开关 + 预算允许?}
  EnhancedGate -- 否 --> Brief
  EnhancedGate -- 是 --> Enhanced[active recall / deep extraction / external provider]
  Enhanced --> Safe{是否安全影响本轮?}
  Safe -- 是 --> Brief
  Safe -- 否 --> Queue[异步待确认 / 后台整理]
  Queue --> NextTurn[下一轮或用户确认后生效]
  Brief --> Model[用户选择或模型路由决定的生成模型]

  classDef baseline fill:#E8FFF6,stroke:#10B981,color:#064E3B;
  classDef enhanced fill:#FFF7ED,stroke:#F97316,color:#7C2D12;
  classDef product fill:#EFF6FF,stroke:#3B82F6,color:#1E3A8A;

  class Baseline,SmallPack baseline;
  class EnhancedGate,Enhanced,Safe,Queue enhanced;
  class Request,Budget,Brief,NextTurn,Model product;
```

成本降级顺序：

1. 保留 baseline。
2. 降低 durable memory top-k。
3. 去掉原文，只保留 summary / evidence id。
4. 跳过 active recall / deep extraction / external provider。
5. 延迟到后台整理或用户确认，不阻塞本轮生成。

## 2. 产品分层图

```mermaid
flowchart LR
  subgraph Frontstage[普通用户默认层]
    A1[灵感总览]
    A2[风格线索]
    A3[参考素材]
    A4[成果打法]
    A5[偏好约束]
    A6[收藏备选]
    A7[待整理]
  end

  subgraph Control[进阶控制层]
    B1[编辑]
    B2[删除]
    B3[禁用]
    B4[合并]
    B5[影响解释]
    B6[自动整理建议]
  end

  subgraph Advanced[高级诊断层]
    C1[来源链]
    C2[会话工作记忆]
    C3[持久记忆命中]
    C4[Team Memory]
    C5[压缩摘要]
    C6[命中历史]
    C7[memdir 整理]
  end

  Frontstage --> Control
  Control -.高级展开.-> Gate{开发者开关}
  Gate -- on --> Advanced
  Gate -- off --> Hidden[保持隐藏]
```

固定判断：

- 普通用户默认只进入 `Frontstage`。
- `Control` 可以逐步开放，但必须使用创作者语言。
- `Advanced` 只能通过开发者面板 / 高级入口进入，默认 off。

## 3. 保存结果到灵感库时序图

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant Result as 结果工作台 / 消息卡
  participant Draft as Inspiration Draft Builder
  participant API as unified_memory_*
  participant Signal as Recommendation Signal
  participant Page as 灵感库 Projection

  U->>Result: 点击“保存到灵感库”
  Result->>Draft: buildSceneAppExecutionInspirationDraft
  Draft-->>Result: category / title / summary / tags
  Result->>API: createUnifiedMemory(draft.request)
  API-->>Result: UnifiedMemory
  Result->>Signal: recordCuratedTaskRecommendationSignalFromMemory
  Signal-->>Page: signals changed
  Page->>API: listUnifiedMemories / stats
  API-->>Page: 最新灵感对象
  Page-->>U: 显示“已收进灵感库 / 去灵感库继续”
```

验收重点：

- 保存入口统一。
- 重复保存有稳定状态。
- 推荐信号刷新后，灵感库首页推荐同步更新。

## 4. 围绕灵感继续生成时序图

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant Page as 灵感库
  participant Projection as Projection Layer
  participant Launcher as CuratedTaskLauncher
  participant Metadata as Request Metadata
  participant Runtime as Agent Runtime
  participant Prefetch as memory_runtime_prefetch_for_turn
  participant Agent as Agent Loop

  U->>Page: 点击“围绕这条灵感继续”
  Page->>Projection: buildScenePrefillFromInspiration
  Projection-->>Page: prefill / reference entries
  Page->>Launcher: 打开共享 launcher
  U->>Launcher: 确认任务模板与输入
  Launcher->>Metadata: build creation_replay + curated_task metadata
  Metadata->>Runtime: submit turn
  Runtime->>Prefetch: 获取来源链 / working / durable / compaction
  Prefetch-->>Runtime: TurnMemoryPrefetchResult
  Runtime->>Agent: 注入 prompt augmentation
  Agent-->>U: 生成结果
```

验收重点：

- 不退回裸 prompt。
- 灵感条目通过 reference selection 进入 request metadata。
- runtime recall 仍走 `memory_runtime_prefetch_for_turn`。

## 5. 自动整理候选流程图

```mermaid
flowchart TD
  Start[会话结束 / 结果生成 / 用户反馈] --> Extract[后台抽取候选]
  Extract --> Classify{可复用吗?}
  Classify -- 否 --> Drop[忽略临时流水账]
  Classify -- 是 --> Sensitive{含敏感信息?}
  Sensitive -- 是 --> ReviewSensitive[进入待整理并标记敏感]
  Sensitive -- 否 --> Dedup{已有相似灵感?}
  Dedup -- 是 --> MergeSuggestion[合并 / 更新建议]
  Dedup -- 否 --> NewSuggestion[新建建议]
  ReviewSensitive --> Queue[待整理队列]
  MergeSuggestion --> Queue
  NewSuggestion --> Queue
  Queue --> UserDecision{用户处理}
  UserDecision -- 确认 --> Write[create/update UnifiedMemory]
  UserDecision -- 合并 --> Merge[更新既有 UnifiedMemory]
  UserDecision -- 忽略 --> Ignore[不影响生成]
  UserDecision -- 删除 --> Delete[移除候选]
  Write --> Projection[刷新灵感库]
  Merge --> Projection
```

固定判断：

- 自动候选未确认前不影响默认生成。
- 临时流水账不进入灵感库。
- 敏感候选必须优先进入审核状态。

## 6. 普通入口与高级入口判定流程

```mermaid
flowchart TD
  Entry[用户打开灵感相关页面] --> Mode{入口来源}
  Mode -- 主导航 / 首页卡片 --> Normal[普通灵感库]
  Mode -- 开发者面板 / 设置高级 / dev flag / 线程可靠性 --> Gate{高级开关开启?}
  Mode -- 结果页“去灵感库继续” --> Focus[普通灵感库 + 成果聚焦]
  Gate -- 是 --> Advanced[高级记忆诊断]
  Gate -- 否 --> Normal

  Normal --> ShowUserObjects[展示风格 / 参考 / 成果 / 偏好 / 收藏]
  Focus --> ShowFocusedOutcome[聚焦对应成果并显示继续动作]
  Advanced --> ShowRuntime[展示来源链 / working / durable / compaction]

  ShowUserObjects --> HideRuntime[隐藏 runtime 术语]
  ShowFocusedOutcome --> HideRuntime
  ShowRuntime --> ExplainRuntime[允许显示 source bucket / hit layer / memdir]
```

验收重点：

- 主导航进入时不显示高级诊断分区。
- 线程可靠性或设置高级入口可以进入诊断层。
- 结果页跳转必须聚焦成果，而不是泛化首页。

## 7. 状态机

```mermaid
stateDiagram-v2
  [*] --> PendingReview: 自动抽取候选
  [*] --> Active: 用户显式保存

  PendingReview --> Active: 用户确认
  PendingReview --> Deleted: 用户删除候选
  PendingReview --> Archived: 用户忽略但保留

  Active --> Disabled: 用户禁用
  Disabled --> Active: 用户重新启用
  Active --> Archived: 用户归档
  Archived --> Active: 用户恢复
  Active --> Deleted: 用户删除
  Disabled --> Deleted: 用户删除
  Archived --> Deleted: 用户删除

  Deleted --> [*]
```

固定判断：

- 只有 `Active` 默认影响生成。
- `PendingReview` 不默认影响生成。
- `Disabled` 保留展示，但不进入默认 reference selection。

## 8. 诊断数据读取图

```mermaid
flowchart TB
  Diagnostics[高级记忆诊断 UI] --> RuntimeApi[memory_runtime_*]
  RuntimeApi --> Sources[resolve_effective_sources]
  RuntimeApi --> Working[collect_working_memory_view]
  RuntimeApi --> Durable[resolve_durable_memory_recall]
  RuntimeApi --> Extraction[memory_runtime_get_extraction_status]
  RuntimeApi --> PrefetchHistory[Runtime prefetch history]
  RuntimeApi --> Compaction[latest / recent compactions]

  Sources --> View[诊断视图]
  Working --> View
  Durable --> View
  Extraction --> View
  PrefetchHistory --> View
  Compaction --> View

  View -.只读.-> User[开发者 / 内测 / 客服]
```

固定判断：

- 诊断 UI 不扫描磁盘。
- 诊断 UI 不自己拼 prompt。
- 诊断 UI 只解释 current read model。

## 9. 开发者面板记忆开关流程

```mermaid
flowchart TD
  Start[打开开发者面板 / 高级设置] --> Toggles[Memory Advanced Toggles]
  Toggles --> Diagnostics{memory diagnostics?}
  Toggles --> Active{active memory recall preview?}
  Toggles --> AutoOrg{auto organization experiments?}
  Toggles --> Raw{raw source / hit layer?}
  Toggles --> Provider{external memory provider?}

  Diagnostics -- off --> HideDiag[隐藏诊断分区]
  Diagnostics -- on --> ShowDiag[显示来源链 / working / durable / compaction]

  Active -- off --> NoActive[不运行 hidden active recall]
  Active -- on --> Eligibility[检查 agent / session eligibility]
  Eligibility --> Prefetch[active recall prefetch]
  Prefetch --> Fence[包进 untrusted fenced context]
  Fence --> Trace[trace / debug 仅诊断层可见]

  AutoOrg -- off --> NoDream[不运行 dreaming / auto organize]
  AutoOrg -- on --> Candidate[生成待整理候选]
  Candidate --> Scan[secret / injection scan]
  Scan --> Pending[进入待整理队列]

  Raw -- off --> HideRaw[隐藏 provider / hit layer]
  Raw -- on --> ShowRaw[诊断层显示 raw metadata]

  Provider -- off --> Builtin[只用 current 主链]
  Provider -- on --> One{已有 external provider?}
  One -- 否 --> EnableOne[启用一个 provider]
  One -- 是 --> RejectSecond[拒绝第二个 provider]
```

固定判断：开关只放大可观察性和实验能力，不改变 `unified_memory_*` / `memory_runtime_*` 的事实源地位。

## 10. Active Memory 默认关闭流程

```mermaid
sequenceDiagram
  autonumber
  participant U as 普通用户
  participant Gate as Feature Gate
  participant Runtime as Agent Runtime
  participant Provider as Active Recall / External Provider
  participant Fence as Fenced Context
  participant Trace as Developer Trace

  U->>Runtime: 发起生成
  Runtime->>Gate: 读取 active memory recall preview
  alt 开关关闭
    Gate-->>Runtime: disabled
    Runtime->>Runtime: 仅使用 current memory_runtime_prefetch_for_turn
    Runtime-->>U: 正常生成，无 hidden active recall
  else 开关开启
    Gate-->>Runtime: enabled
    Runtime->>Runtime: eligibility check
    Runtime->>Provider: prefetch relevant memory
    Provider-->>Fence: recalled context
    Fence-->>Runtime: untrusted context block
    Runtime->>Trace: 写入诊断 trace
    Runtime-->>U: 正常生成，普通前台不显示 raw tags
  end
```

验收重点：默认关闭时不产生 hidden recall；开启后也不把 recalled context 当用户新输入。
