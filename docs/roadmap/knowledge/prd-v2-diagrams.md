# Lime Agent Knowledge PRD v2 - 可视化设计文档

> 状态：current / 与 `prd-v2.md` 配套使用
> 更新时间：2026-05-08
> 关系：本文是 `prd-v2.md` 的可视化补充。所有图表、UI 原型、时序与流程严格对齐 Agent Knowledge v0.6.0 的 `document-first` / `runtime.mode` / `metadata.producedBy`，以及 v2 PRD 的 §2A persona/data 区分、§2B Skills-first、§5 Builder Skill 薄适配、§6 Builder Skill 清单、§7 Resolver、§9 命令面、§10.4 用户故事。

## 0. 文档目录

1. [§1 总体架构图](#1-总体架构图) — Skill Bundle / KnowledgePack / Runtime Binding 分层
2. [§2 核心流程图](#2-核心流程图) — Builder Skill 整理 / Resolver 决策 / 状态机
3. [§3 关键时序图](#3-关键时序图) — persona 整理、运行时调用、双产出
4. [§4 UI 原型](#4-ui-原型) — 5 个核心界面线框图
5. [§5 用户故事可视化](#5-用户故事可视化) — 5 个业务场景的端到端走查

## 1. 总体架构图

### 1.1 Skills-first 系统层次架构

```mermaid
flowchart TB
  subgraph U[用户层]
    U1[创作者 / 操盘手 / CEO]
  end

  subgraph E[入口层]
    E1[输入框资料图标]
    E2[场景命令<br/>/IP文案 /内容运营 /私域运营 /产品文案]
    E3[Agent 输出沉淀]
    E4[直接编辑 documents/.md]
  end

  subgraph P[产品投影层]
    P1[资料管理页<br/>章节列表 + 状态]
    P2[整理面板<br/>accept/edit/rewrite]
    P3[沉淀面板<br/>新建 / 补充]
    P4[高级视图<br/>Builder Skill provenance]
  end

  subgraph C[Skill 目录层]
    C1[SkillCatalog.entries<br/>kind=skill - current]
    C2[serviceSkillCatalog<br/>compat 产品投影]
    C3[Builder Skill Bundle<br/>SKILL.md + references/ + scripts/]
  end

  subgraph S[服务层]
    S1[knowledge_compile_pack<br/>薄适配: 选 Skill + 调 binding]
    S2[Runtime Binding<br/>agent_turn / native_skill]
    S3[knowledge_split_document<br/>自动切片]
    S4[knowledge_resolve_context<br/>persona/data 分支]
  end

  subgraph D[KnowledgePack 数据层]
    D1[KNOWLEDGE.md<br/>profile=document-first<br/>runtime.mode + producedBy]
    D2[documents/<br/>成品文档 - v0.6 主事实源]
    D3[sources/<br/>原始材料]
    D4[compiled/splits/<br/>派生切片]
    D5[runs/<br/>compile/context 审计记录]
  end

  subgraph R[Agent 运行时层]
    R1[Fenced Wrapper<br/>mode=persona / data]
    R2[agent_runtime_submit_turn]
    R3[Model]
  end

  U1 --> E1
  U1 --> E2
  U1 --> E3
  U1 --> E4

  E1 --> P1
  E3 --> P3
  E4 --> D2
  P1 --> P2
  P2 --> S1
  P3 --> S1

  C1 --> S1
  C2 -.compat 只委托.-> C1
  C1 --> C3
  S1 --> S2
  S2 --> C3
  C3 --> S1

  D3 --> S1
  D1 --> S1
  S1 --> D2
  S1 --> D5
  D2 --> S3
  S3 --> D4

  E1 --> S4
  E2 --> S4
  D1 --> S4
  D4 --> S4
  S4 --> R1
  R1 --> R2
  R2 --> R3
  R3 -.输出.-> U1
  R3 -.可沉淀.-> E3

  P4 --> D5

  classDef user fill:#FEF3C7,stroke:#F59E0B,color:#78350F;
  classDef entry fill:#EFF6FF,stroke:#3B82F6,color:#1E3A8A;
  classDef product fill:#ECFDF5,stroke:#10B981,color:#064E3B;
  classDef skill fill:#EDE9FE,stroke:#8B5CF6,color:#4C1D95;
  classDef service fill:#FDF4FF,stroke:#A855F7,color:#581C87;
  classDef data fill:#F8FAFC,stroke:#64748B,color:#0F172A;
  classDef runtime fill:#FFF7ED,stroke:#F97316,color:#7C2D12;

  class U1 user;
  class E1,E2,E3,E4 entry;
  class P1,P2,P3,P4 product;
  class C1,C2,C3,S2 skill;
  class S1,S3,S4 service;
  class D1,D2,D3,D4,D5 data;
  class R1,R2,R3 runtime;
```

**架构关键判断**：

1. `Builder Skill Bundle` 是生产工艺事实源，`KnowledgePack documents/` 是产物事实源。
2. `knowledge_compile_pack` 不拥有模板和章节生成逻辑，只做 Skill 选择、runtime binding 调用和文件写回。
3. `SkillCatalog.entries(kind=skill)` 是 current 目录投影；`serviceSkillCatalog` 只允许 compat 委托。
4. `documents/` 是 Agent Knowledge v0.6.0 `document-first` 数据层中心；`compiled/splits/`、`runs/` 都是派生 / 审计层。
5. 运行时层的 wrapper 只消费 `runtime.mode=persona|data`，决定 persona 还是 data 语义；它不执行 Builder Skill。

### 1.2 Skill Bundle 与 KnowledgePack 边界

```mermaid
flowchart LR
  subgraph SB[Builder Skill Bundle - how]
    SB1[SKILL.md<br/>工作流]
    SB2[references/template.md<br/>章节骨架]
    SB3[references/interview-questions.md<br/>缺口问题]
    SB4[references/quality-checklist.md<br/>质量自检]
    SB5[scripts/*.py<br/>格式转换]
    SB6[agents/*.yaml<br/>模型适配]
  end

  subgraph KP[KnowledgePack - what]
    KP1[KNOWLEDGE.md<br/>profile + runtime.mode<br/>primaryDocument + producedBy]
    KP2[sources/<br/>原始资料]
    KP3[documents/<doc>.md<br/>成品文档]
    KP4[compiled/splits/<br/>派生切片]
    KP5[runs/compile-*.json<br/>Skill provenance + 章节状态]
  end

  SB1 --> BIND[Runtime Binding]
  SB2 --> BIND
  SB3 --> BIND
  SB4 --> BIND
  SB5 --> BIND
  SB6 --> BIND
  KP1 --> BIND
  KP2 --> BIND
  BIND --> KP3
  BIND --> KP5
  KP3 --> SPLIT[knowledge_split_document]
  SPLIT --> KP4

  classDef skill fill:#EDE9FE,stroke:#8B5CF6,color:#4C1D95;
  classDef pack fill:#ECFDF5,stroke:#10B981,color:#064E3B;
  classDef service fill:#FDF4FF,stroke:#A855F7,color:#581C87;
  class SB1,SB2,SB3,SB4,SB5,SB6 skill;
  class KP1,KP2,KP3,KP4,KP5 pack;
  class BIND,SPLIT service;
```

**边界规则**：

1. Skill 不复制进 pack；pack 只记录 `metadata.producedBy`、版本、digest 和 run 记录。
2. `references/` 是模板事实源；PRD 和 Lime 代码不再维护平行模板。
3. Skill 内部脚本只做转换或辅助处理，不直接写 pack；最终写入由 Lime 完成。
4. Knowledge runtime 消费 pack 时只读取 `KNOWLEDGE.md`、`documents/`、`compiled/` 和 `runs/context-*`；不得为了回答用户问题而执行 Builder Skill。

### 1.3 persona / data 双族架构

```mermaid
flowchart LR
  subgraph PF[persona 族 pack]
    PF1[personal-profile<br/>个人 IP]
    PF2[brand-persona<br/>品牌人设]
    PF_SKILL[persona Builder Skills<br/>personal-ip / brand-persona]
    PF_CORE[核心人设章节<br/>voice / 性格 / 金句 / 禁忌 / 应用指南]
    PF_FACT[事实章节<br/>履历 / 案例 / 数据]
  end

  subgraph DF[data 族 pack]
    DF1[brand-product<br/>产品事实]
    DF2[organization-knowhow<br/>组织 SOP]
    DF3[growth-strategy<br/>增长策略]
    DF4[content-operations<br/>内容运营]
    DF5[private-domain-operations<br/>私域/社群运营]
    DF6[live-commerce-operations<br/>直播运营]
    DF7[campaign-operations<br/>活动运营]
    DF_SKILL[data Builder Skills<br/>product / knowhow / growth / ops]
    DF_FACT[事实与 playbook 章节<br/>参数 / 流程 / 节奏 / 指标 / 合规]
  end

  subgraph RT[运行时 Resolver]
    RT_PERSONA[persona 分支<br/>核心人设无条件先注入]
    RT_DATA[data 分支<br/>按任务命中章节]
    RT_COMBINE[多 pack 协同<br/>1 persona + N data]
  end

  PF_SKILL --> PF_CORE
  PF_SKILL --> PF_FACT
  DF_SKILL --> DF_FACT
  PF_CORE --> RT_PERSONA
  PF_FACT --> RT_PERSONA
  DF_FACT --> RT_DATA
  RT_PERSONA --> RT_COMBINE
  RT_DATA --> RT_COMBINE

  RT_COMBINE --> WRAP[Fenced Wrapper<br/>顺序: persona 先, data 后]
  WRAP --> MODEL[Model 输出]

  classDef persona fill:#FEF3C7,stroke:#F59E0B,color:#78350F;
  classDef data fill:#DBEAFE,stroke:#3B82F6,color:#1E3A8A;
  classDef skill fill:#EDE9FE,stroke:#8B5CF6,color:#4C1D95;
  classDef runtime fill:#FFF7ED,stroke:#F97316,color:#7C2D12;

  class PF1,PF2,PF_CORE,PF_FACT persona;
  class DF1,DF2,DF3,DF4,DF5,DF6,DF7,DF_FACT data;
  class PF_SKILL,DF_SKILL skill;
  class RT_PERSONA,RT_DATA,RT_COMBINE,WRAP,MODEL runtime;
```

**协同判断**：

1. persona pack 提供"怎么说"；data pack 提供"说什么"。
2. 同一品牌可同时存在 brand-persona + brand-product + content-operations 等多个独立 pack。
3. 运营类知识库仍属于 data family，提供节奏、SOP、指标和复盘，不新增第三族。
4. wrapper 顺序固定：persona 先建立表达语境，data 再加载具体事实和运营 playbook。
5. 最多 1 个 persona + N 个 data；两个 persona 同时启用会让模型扮演冲突。

## 2. 核心流程图

### 2.1 Builder Skill 整理流程（对应 v2 §5）

```mermaid
flowchart TD
  Start([用户导入访谈稿/资料]) --> Import[knowledge_import_source]
  Import --> PackMeta[读取 KNOWLEDGE.md<br/>profile / runtime.mode / type / producedBy / limeTemplate]
  PackMeta --> SkillPick{能否找到<br/>Builder Skill?}
  SkillPick -->|显式选择或 producedBy 默认建议| SkillRef[skillBundleRef]
  SkillPick -->|SkillCatalog 命中| SkillRef
  SkillPick -->|serviceSkillCatalog compat| SkillRef
  SkillPick -->|找不到| Block[阻断: 选择或安装 Skill]

  SkillRef --> Binding[Runtime Binding]
  Binding --> SkillFlow[执行 Builder Skill 工作流<br/>SKILL.md + references/ + scripts/]
  SkillFlow --> Coverage{章节覆盖判定<br/>由 Skill 返回}
  Coverage -->|full / partial| DocOut[primaryDocument]
  Coverage -->|missing| Missing[文档中显式待补充]
  Coverage -->|conflict| Conflict[冲突摘要 + disputed]

  DocOut --> Output[KnowledgeBuilderSkillOutput]
  Missing --> Output
  Conflict --> Output
  Output --> WriteMeta[写入 metadata.producedBy]
  Output --> WriteRun[写入 runs/compile-*.json<br/>builder_skill + chapters[]]
  WriteMeta --> WriteDoc
  WriteRun --> WriteDoc[写入 documents/<doc>.md]
  WriteDoc --> Split[knowledge_split_document]
  Split --> ReviewPanel[资料管理页章节列表]
  ReviewPanel --> UserAction{用户操作}
  UserAction -->|accept| ReadyCheck
  UserAction -->|edit| EditChapter[编辑 documents 或章节]
  UserAction -->|rewrite| Binding
  EditChapter --> Split

  ReadyCheck{所有章节<br/>accepted/missing?}
  ReadyCheck -->|是| StatusReady([pack: ready])
  ReadyCheck -->|否| StatusReview([pack: needs-review])
  Block --> StatusReview

  classDef start fill:#FEF3C7,stroke:#F59E0B,color:#78350F;
  classDef skill fill:#EDE9FE,stroke:#8B5CF6,color:#4C1D95;
  classDef data fill:#F8FAFC,stroke:#64748B,color:#0F172A;
  classDef status fill:#ECFDF5,stroke:#10B981,color:#064E3B;
  classDef warn fill:#FEE2E2,stroke:#EF4444,color:#7F1D1D;

  class Start,Import start;
  class SkillRef,Binding,SkillFlow skill;
  class PackMeta,DocOut,Output,WriteDoc,WriteRun,Split,ReviewPanel,EditChapter data;
  class StatusReady status;
  class Missing,Conflict,Block,StatusReview warn;
```

**关键控制点**：

1. 先选 Builder Skill，再整理；没有 Skill 不允许 LLM 直生成。
2. 章节级生成、回退、质量检查属于 Skill 工作流；Lime 只校验输出契约。
3. `runs/compile-*.json` 必须记录 Skill provenance，方便后续复现和审计。
4. `documents/<doc>.md` 写入后统一由 `knowledge_split_document` 派生切片。

### 2.2 Resolver 决策流程（对应 v2 §7.2）

```mermaid
flowchart TD
  Req([用户请求 + 当前 pack]) --> PackType{pack family?}

  PackType -->|persona| PersonaBranch[persona 分支]
  PackType -->|data| DataBranch[data 分支]

  PersonaBranch --> CoreInject[核心人设章节无条件注入<br/>voice + 性格 + 金句 + 禁忌 + 应用指南]
  CoreInject --> CheckBudget1{persona token<br/>≤ personaCoreBudget 3500?}
  CheckBudget1 -->|超| BlockPersona[阻断<br/>提示用户精简文档]
  CheckBudget1 -->|未超| AddFactPersona[按任务追加事实章节<br/>履历/案例]

  DataBranch --> EstimateTokens[主文档 token 估算]
  EstimateTokens --> SizeCheck{size?}
  SizeCheck -->|≤ smallBudget| Full[完整注入主文档]
  SizeCheck -->|≤ midBudget| BriefAndPick[brief + 应用指南 + 任务相关章节]
  SizeCheck -->|≤ hardCap| StrictPick[brief + 1-3 最相关章节]
  SizeCheck -->|> hardCap| BlockData[阻断<br/>要求拆分文档]

  AddFactPersona --> WrapPersona[persona wrapper<br/>mode=persona]
  Full --> WrapData[data wrapper<br/>mode=data]
  BriefAndPick --> WrapData
  StrictPick --> WrapData

  WrapPersona --> MultiPack{是否启用了<br/>多个 pack?}
  WrapData --> MultiPack
  MultiPack -->|是| OrderCheck[wrapper 顺序<br/>persona 先 / data 后]
  MultiPack -->|否| Single[单 pack 注入]

  OrderCheck --> WriteRun[runs/context-*.json]
  Single --> WriteRun
  WriteRun --> Inject[注入 Agent Runtime]
  Inject --> Model([Model 输出])

  BlockPersona --> UserNotify[提示用户操作]
  BlockData --> UserNotify

  classDef start fill:#FEF3C7,stroke:#F59E0B,color:#78350F;
  classDef persona fill:#FEF3C7,stroke:#F59E0B,color:#78350F;
  classDef data fill:#DBEAFE,stroke:#3B82F6,color:#1E3A8A;
  classDef wrap fill:#FFF7ED,stroke:#F97316,color:#7C2D12;
  classDef warn fill:#FEE2E2,stroke:#EF4444,color:#7F1D1D;

  class Req,Model start;
  class PersonaBranch,CoreInject,AddFactPersona,WrapPersona persona;
  class DataBranch,EstimateTokens,Full,BriefAndPick,StrictPick,WrapData data;
  class MultiPack,OrderCheck,Single,WriteRun,Inject wrap;
  class BlockPersona,BlockData,UserNotify warn;
```

**Resolver 关键判断**：

1. `family` 决定走 persona 或 data 分支，不混用。
2. persona 分支不做"按 token 大小四档决策"，因为核心人设章节必须无条件注入。
3. data 分支才走 v2 §7.2 的 full / brief+sections / strict-pick / block 四档。
4. 多 pack 协同时 wrapper 顺序固定：persona wrapper 永远在 data wrapper 之前。

### 2.3 状态流转流程（对应 v2 §12）

```mermaid
stateDiagram-v2
  [*] --> draft: 创建 pack

  draft --> needs_review: Builder Skill 返回章节状态
  needs_review --> ready: 全部章节 accepted/missing
  needs_review --> disputed: 有 conflict 章节

  ready --> stale: N 天未更新 + sources 新增
  ready --> disputed: 检测到冲突

  stale --> needs_review: 重新整理
  disputed --> needs_review: 解决冲突

  ready --> archived: 用户归档
  stale --> archived: 用户归档
  needs_review --> archived: 用户归档

  archived --> [*]: 删除

  note right of draft
    不进入运行时
  end note

  note right of needs_review
    不进入运行时
    UI 显示徽章
  end note

  note right of ready
    可进入运行时
    默认候选
  end note

  note right of stale
    使用时提示过期
  end note

  note right of disputed
    默认阻断
    需用户确认
  end note
```

**状态判定规则**：

1. 触发器是 Skill 返回的**章节级**判定。
2. 全部章节 accepted 或显式 missing → 整 pack ready。
3. 任意章节 needs-review → 整 pack needs-review。
4. coverage: conflict → 整 pack disputed。
5. UI 不暴露章节状态机给普通用户；只在高级模式显示。

## 3. 关键时序图

### 3.1 P1：个人 IP Builder Skill 整理时序

```mermaid
sequenceDiagram
  autonumber
  actor User as 用户
  participant UI as 资料管理页
  participant API as knowledge_compile_pack
  participant Catalog as SkillCatalog
  participant Binding as Runtime Binding
  participant Skill as personal-ip-knowledge-builder
  participant Pack as KnowledgePack
  participant Split as knowledge_split_document

  User->>UI: 导入访谈稿 / 点击整理
  UI->>API: packPath + sources + profile=document-first + runtime.mode=persona + limeTemplate=personal-ip
  API->>Catalog: 查找 personal-ip-knowledge-builder
  Catalog-->>API: skillBundleRef + digest + resources
  API->>Binding: 输入 KnowledgeBuilderSkillInput
  Binding->>Skill: 加载 SKILL.md / references / scripts
  Skill-->>Binding: KnowledgeBuilderSkillOutput
  Binding-->>API: primaryDocument + chapters[] + issues
  API->>Pack: 写 KNOWLEDGE.md metadata.producedBy
  API->>Pack: 写 documents/<doc>.md
  API->>Pack: 写 runs/compile-*.json.builder_skill
  API->>Split: 对 primaryDocument 切片
  Split->>Pack: 写 compiled/splits + index.json
  API-->>UI: pack status + chapters[]
  UI-->>User: 显示完整文档 / 章节审阅 / Skill provenance
```

### 3.2 运行时调用时序：persona + data 协同

```mermaid
sequenceDiagram
  autonumber
  actor User as 用户
  participant Input as 输入框 / 场景命令
  participant Resolver as knowledge_resolve_context
  participant Pack as KnowledgePack Index
  participant Runtime as agent_runtime_submit_turn
  participant Model as Model

  User->>Input: /IP文案 以谢晶口吻介绍金花黑茶
  Input->>Resolver: request + active packs
  Resolver->>Pack: 读取 profile / runtime.mode / status / primaryDocument
  Resolver->>Pack: 读取 persona compiled/index.json
  Resolver->>Pack: 读取 data compiled/index.json
  Resolver->>Resolver: persona 核心章节先选
  Resolver->>Resolver: data 事实章节按任务命中
  Resolver->>Runtime: fenced persona wrapper + data wrapper
  Runtime->>Model: 提交带上下文的 turn
  Model-->>Runtime: 输出文案
  Runtime-->>Input: 返回结果 + context run id
  Input-->>User: 展示输出，可沉淀为 sources
```

### 3.3 Agent 输出沉淀为资料时序

```mermaid
sequenceDiagram
  autonumber
  actor User as 用户
  participant Chat as Agent 输出
  participant Panel as 沉淀面板
  participant Pack as KnowledgePack
  participant API as knowledge_compile_pack
  participant Skill as Builder Skill

  Chat-->>User: 生成一段可复用内容
  User->>Panel: 点击"沉淀到资料"
  Panel->>Pack: 写入 sources/agent-output-*.md
  Panel->>User: 选择补充已有 pack 或新建 pack
  User->>Panel: 选择 personal-profile pack
  Panel->>API: 重新整理 pack
  API->>Skill: 调用同一 Builder Skill，传 acceptedChapters
  Skill-->>API: 返回增量后的 primaryDocument + chapters[]
  API->>Pack: 更新 metadata.producedBy / documents/ 与 runs/
  Panel-->>User: 显示新增资料影响的章节
```

## 4. UI 原型

### 4.1 创建资料：用户看到模板，系统绑定 Skill

```text
┌──────────────────────────────────────────────────────────────┐
│ 新建项目资料                                                  │
├──────────────────────────────────────────────────────────────┤
│ 资料类型                                                     │
│  [个人 IP] [品牌人设] [品牌产品] [组织 Know-how] [运营类]     │
│  标准形态：Agent Knowledge v0.6 document-first / persona      │
│                                                              │
│ 上传资料                                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 拖入访谈稿、DOCX、聊天记录、公开资料                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│ 高级信息                                                     │
│  使用 Builder Skill: personal-ip-knowledge-builder v1.0.0    │
│  来源: SkillCatalog / seeded                                 │
│  写入: metadata.producedBy + runs/compile.builder_skill       │
│                                                              │
│ [取消]                                      [开始整理]        │
└──────────────────────────────────────────────────────────────┘
```

说明：普通用户看到"资料类型"；高级信息才暴露 Builder Skill，不把工程概念推给普通用户。

### 4.2 整理进度：显示 Skill 阶段而不是 Lime 自建步骤

```text
┌──────────────────────────────────────────────────────────────┐
│ 正在整理：谢晶个人 IP                                         │
├──────────────────────────────────────────────────────────────┤
│ Builder Skill                                                 │
│  personal-ip-knowledge-builder                                │
│                                                              │
│ 进度                                                         │
│  ✓ 读取 sources/访谈稿_20260201.docx                          │
│  ✓ 使用 scripts/docx_to_markdown.py 转换为 Markdown           │
│  ✓ 按 references/personal-ip-template.md 生成章节              │
│  ! 金句语录来源不足，建议补充访谈                              │
│  ✓ references/quality-checklist.md 自检完成                   │
│                                                              │
│ 预计产物                                                     │
│  documents/谢晶_个人IP知识库v1.0.md                            │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 资料详情：成品文档优先

```text
┌──────────────────────────────────────────────────────────────┐
│ 谢晶 个人 IP 知识库                               ready       │
├──────────────────────────────────────────────────────────────┤
│ 主文档                                                       │
│  documents/谢晶_个人IP知识库v1.0.md      [打开完整文档] [导出] │
│                                                              │
│ 最近整理                                                     │
│  producedBy: personal-ip-knowledge-builder v1.0.0             │
│  Run: compile-20260207T103000Z.json                           │
│  profile: document-first       runtime.mode: persona           │
│                                                              │
│ 章节审阅                                                     │
│  [✓] 人物档案与基本信息                  full                 │
│  [✓] 个人简介与核心定位                  full                 │
│  [!] 金句语录与思想精华                  partial              │
│  [-] 未来愿景与发展规划                  missing              │
│                                                              │
│ [重新整理] [补充资料] [高级：查看 Skill provenance]            │
└──────────────────────────────────────────────────────────────┘
```

### 4.4 输入框资料选择：persona / data 可见

```text
┌──────────────────────────────────────────────────────────────┐
│ 选择本轮资料                                                  │
├──────────────────────────────────────────────────────────────┤
│ Persona                                                       │
│  (●) 谢晶个人 IP                    ready   personal-profile  │
│  ( ) 品牌官方口吻                    draft   brand-persona     │
│                                                              │
│ Data                                                          │
│  [✓] 金花黑茶产品事实                ready   brand-product     │
│  [✓] 本月内容运营日历                  ready   content-ops       │
│  [ ] 私域社群转化 SOP                  stale   private-domain    │
│  [ ] 客服 SOP                         stale   organization     │
│                                                              │
│ 规则：最多 1 个 persona + N 个 data                           │
│ [取消]                                           [确认启用]    │
└──────────────────────────────────────────────────────────────┘
```

### 4.5 运行时证据：context run 可追踪

```text
┌──────────────────────────────────────────────────────────────┐
│ 本轮使用资料                                                  │
├──────────────────────────────────────────────────────────────┤
│ Wrapper 顺序                                                  │
│  1. 谢晶个人 IP        mode=persona  selected=5 sections       │
│  2. 金花黑茶产品事实   mode=data     selected=3 sections       │
│  规则：persona/data 均为受保护数据，不执行 Builder Skill       │
│                                                              │
│ Context Run                                                   │
│  runs/context-20260207T104500Z.json                           │
│                                                              │
│ 选中的切片                                                   │
│  compiled/splits/谢晶/.../金句语录.md                          │
│  compiled/splits/金花黑茶/.../合规边界.md                      │
└──────────────────────────────────────────────────────────────┘
```

## 5. 用户故事可视化

### 5.1 MCN 机构：统一博主人设，团队协作不漂移

```mermaid
journey
  title MCN 内容总监用个人 IP Builder Skill 统一博主人设
  section 建库
    导入博主访谈和历史爆款: 4: 内容总监
    选择个人 IP 模板: 5: 内容总监
    Lime 绑定 personal-ip-knowledge-builder: 5: Lime
  section 审阅
    打开完整 Markdown 文档: 5: 内容总监
    接受核心人设章节: 4: 内容总监
    标记缺失案例为待补充: 4: 内容总监
  section 使用
    团队用 /IP文案 写短视频脚本: 5: 编导
    Resolver 注入 persona 核心章节: 5: Lime
    输出风格稳定: 5: 博主
```

验收重点：同一个 persona pack 让不同编导、不同模型输出都不漂。

### 5.2 品牌操盘手：创始人 IP + 产品事实双包协同

```mermaid
flowchart LR
  A[创始人访谈] --> B[personal-ip-knowledge-builder]
  B --> C[创始人 persona pack]
  D[产品资料 / FAQ / 合规] --> E[brand-product-knowledge-builder]
  E --> F[产品 data pack]
  C --> G[Resolver<br/>persona first]
  F --> G
  G --> H[以创始人口吻介绍产品]
  H --> I[有风格 + 有准确事实 + 不越过合规]
```

验收重点：persona 只决定表达方式，产品事实和合规边界来自 data pack。

### 5.3 企业服务商：客户 SOP 知识库，新人快速上手

```mermaid
flowchart TD
  A[客户交付文档 / 会议纪要 / FAQ] --> B[organization-knowhow-knowledge-builder]
  B --> C[organization-knowhow pack]
  C --> D[新员工提问]
  D --> E[Resolver 选 SOP / 失败案例 / FAQ]
  E --> F[Agent 输出下一步操作]
  F --> G[新人按 SOP 执行]
```

验收重点：输出必须是可执行步骤，不只是概念说明；不可回答边界必须能被单独注入。

### 5.4 创业公司 CEO：增长策略从资料沉淀到行动计划

```mermaid
flowchart TD
  A[商业计划 / 指标 / 渠道复盘] --> B[growth-strategy-knowledge-builder]
  B --> C[growth-strategy pack]
  C --> D[/增长策略 生成 30/60/90 天计划]
  D --> E[Resolver 选择指标 / 渠道 / 假设章节]
  E --> F[Agent 输出带指标的行动计划]
  F --> G[执行结果再沉淀为 sources]
  G --> B
```

验收重点：增长策略必须能闭环到下一轮 sources，而不是一次性报告。

### 5.5 运营负责人：内容、私域、直播和活动 playbook

```mermaid
flowchart TD
  A[内容日历 / 选题库 / 爆款复盘] --> B[content-operations-knowledge-builder]
  C[用户分层 / 社群 SOP / 转化话术] --> D[private-domain-operations-knowledge-builder]
  E[货盘 / 直播脚本 / 场控节奏] --> F[live-commerce-operations-knowledge-builder]
  G[活动目标 / 渠道 / 素材 / 预算] --> H[campaign-operations-knowledge-builder]
  B --> I[content-operations pack]
  D --> J[private-domain-operations pack]
  F --> K[live-commerce-operations pack]
  H --> L[campaign-operations pack]
  I --> M[Resolver data wrappers]
  J --> M
  K --> M
  L --> M
  M --> N[运营执行输出<br/>内容日历 / 触达节奏 / 直播脚本 / 活动清单]
  N --> O[执行结果沉淀回 sources]
  O --> B
  O --> D
  O --> F
  O --> H
```

验收重点：运营类 pack 必须输出可执行动作、负责人、节奏、指标和复盘口径；不能只生成“建议多做内容和私域”这种泛泛建议。

## 6. 与 PRD 的一致性检查

| PRD 章节 | 本文图表 | 一致性要求 |
| --- | --- | --- |
| §11 Agent Knowledge v0.6.0 | §1.1 / §1.2 / §3.1 / §4.3 | pack 必须显式使用 `profile=document-first`、`runtime.mode`、`metadata.producedBy` |
| §2B Skills-first | §1.1 / §1.2 / §2.1 | Builder Skill 是工艺事实源，Lime 不自建整理引擎 |
| §5 整理契约 | §2.1 / §3.1 | `knowledge_compile_pack` 只做 Skill 选择、binding、写回 |
| §6 Skill 清单 | §1.3 / §4.1 / §5.5 | UI 模板来自 SkillCatalog 投影，不来自 Lime 内置模板目录；运营类也是 data family |
| §7 Resolver | §2.2 / §3.2 / §4.4 | persona / data 分支和 wrapper 顺序一致 |
| §9 命令面 | §4.5 | context run 与 command / scene 入口可追踪 |
| §10.4 用户故事 | §5.1-§5.5 | 每个业务故事都能回到一个 Builder Skill 或 pack 协同 |
