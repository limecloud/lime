# Lime 高配版 Artifacts 路线图

> 状态：进行中，P1 / P2 已落地，P3 已闭环，rewrite typed patch 与 current incremental 合同已落地  
> 更新时间：2026-03-31  
> 运行时边界：发送边界、runtime metadata、Team 委派、协议瘦身以 `docs/roadmap/lime-conversation-execution-efficiency-roadmap.md` 为准；本文只定义 Artifact 产品层与 Workbench 主线  
> 目标：把 Lime 从“能显示文件/画布的聊天工作台”升级为“交付物优先的 Artifact Workbench”，让回复不再只是普通 Markdown，而是可扫描、可编辑、可版本化、可复用的正式产物
>
> 配套文档：
> - `docs/roadmap/artifacts/architecture-blueprint.md`
> - `docs/roadmap/artifacts/artifact-document-v1.md`
> - `docs/roadmap/artifacts/framework-boundary.md`
> - `docs/roadmap/artifacts/system-prompt-and-schema-contract.md`

## 1. 文档依据

本文不是从抽象概念反推，而是基于当前仓库现役实现与设计约束编写。

关键事实源：

- `docs/aiprompts/overview.md`
- `docs/aiprompts/design-language.md`
- `src/lib/artifact/types.ts`
- `src/lib/artifact/parser.ts`
- `src/components/artifact/ArtifactRenderer.tsx`
- `src/components/artifact/ArtifactToolbar.tsx`
- `src/components/agent/chat/components/MarkdownRenderer.tsx`
- `src/components/agent/chat/hooks/useArtifactDisplayState.ts`
- `src/components/agent/chat/components/AgentThreadTimeline.tsx`
- `src/components/agent/chat/workspace/workbenchPreview.tsx`
- `src/components/agent/chat/workspace/WorkspaceCanvasContent.tsx`
- `src/lib/workspace/workbenchCanvas.ts`
- `src/components/workspace/document/DocumentRenderer.tsx`
- `src/components/workspace/document/editor/NotionEditor.tsx`
- `src-tauri/src/services/agent_timeline_service.rs`

从这些事实源可以确认：

1. Lime 已经是 `Artifact First` 方向，而不是纯聊天产品。
2. 当前前端已经具备 `ArtifactRenderer + CanvasWorkbench + Timeline + Tiptap 编辑器` 这四块关键底座。
3. 当前 Artifact 系统仍以“文件快照/Markdown 内容”作为主要载体，还不是“结构化交付物协议”。
4. 当前回复的美观度问题，本质不是“模型不会写”，而是“产物协议、渲染层、交互层还没有真正收敛成一个系统”。

## 1.1 当前已落地能力

以下链路已经在当前仓库进入实现态：

1. `runtime_turn` 已接入 Artifact 专属 prompt 组装服务。
2. Artifact 回合已支持 turn-level `output_schema` 注入，不再只依赖 prompt hint。
3. 后端已具备 `ArtifactDocument v1` 的 validator / repair / fallback / workspace 落盘能力。
4. Timeline snapshot metadata 已可回灌 `artifactDocument`，前端在 `content` 为空时也能直接渲染结构化文档。
5. 前端已落地最小 `artifact-protocol` 壳层，用于统一 runtime metadata 中的 `artifactDocument` 与 `artifact_path(s)` 读取合同。
6. 后端已支持最小 current-first 增量应用链，并兼容 ingest `artifact_ops`；可把 `artifact.upsert_block / attach_source / finalize_version` 等操作应用到已有 `ArtifactDocument` 并生成新版本。
7. 右侧已接入最小 `ArtifactWorkbenchShell`，包含阅读面与 `概览 / 来源 / 版本 / 差异` inspector。
8. 当前版本已支持最小 block diff 摘要，以及来源项 / 差异项到文档 block 的 Workbench 内跳转。
9. `rewrite` 已把 `artifact_target_block_id` 贯通到 prompt / output schema / ops apply / persist 链路，非目标 block 的 op 会在运行时被忽略并记录 issue。
10. `rewrite` 现已支持专用 `artifact_rewrite_patch` envelope，并接受正式单条 incremental op；`artifact_ops` 只保留兼容回退，用于逐步收紧模型输出合同。
11. 前端 `src/lib/artifact-document/*` 已补齐 current-first operation candidate 读取边界，可统一识别正式单条 incremental op、`artifact_rewrite_patch` 与 `artifact_ops` compat 回退。
12. Rust `artifact_ops_service` 内部 apply 已切到 normalized action 列表；`current incremental` 与 `artifact_rewrite_patch` 不再先包成 `artifact_ops`，后者只保留 compat 输入壳。
13. Artifact Workbench 的 Markdown / HTML / Artifact JSON 导出已接入统一桌面导出链，复用保存对话框与 `save_exported_document` 主路径，不再走浏览器下载旁路。

这意味着当前主线已经从“只有路线图”推进到“结构合同 + 版本快照 + Workbench inspector 闭环”。当前仍然属于后续阶段的，主要是编辑态 / 展示态 / 导出态的进一步同源、更完整的导出格式与分享链，以及在模型稳定后进一步收紧 rewrite 的 `artifact_ops` compat 分支。

## 2. 现状判断

## 2.1 Lime 已经具备的能力

- 有聊天主入口与工作台分栏能力，支持右侧预览区。
- 有 Artifact 类型系统、解析器、统一渲染入口、工具栏与列表。
- 有 Document Canvas 与 Tiptap 编辑器，可承载更高级的文档编辑体验。
- 有 Agent Timeline，可记录 turn、item、artifact snapshot、warning、error。
- 有 Workspace 概念，可作为 Artifact 的上下文边界与持久化边界。

这说明 Lime 不需要再造第二套“文档产品”，而是要把现有能力从“散件”收敛成“Artifact Workbench”。

## 2.2 当前短板

当前体验之所以还不够像 Ribbi / Manus / Claude Artifacts 的高配版本，主要有五个结构性问题：

### 1) 回复仍以消息文本为主，Artifact 只是附属物

`MarkdownRenderer.tsx` 负责把 assistant 文本渲染成较好的 Markdown，但主心智仍然是“消息正文”。  
这会导致：

- 模型把重要内容写在消息里，而不是交付区
- 视觉上仍然像聊天气泡，而不是正式报告
- 后续编辑、复用、导出、版本比较都不自然

### 2) Artifact 模型还是“文件/片段导向”，不是“结构化文档导向”

当前 `Artifact` 的核心字段是：

- `type`
- `title`
- `content`
- `meta`

这对代码块、HTML、Mermaid 足够，但对高质量报告类交付物不够。  
缺的是：

- section / block 层级
- citations / references
- summary / scorecard / callout / table / checklist 等语义块
- 版本差异与局部 patch

### 3) Timeline、Canvas、Document Editor 还没有同源

当前：

- Timeline 记录的是过程事件
- Canvas 展示的是当前 artifact 预览
- DocumentCanvas 编辑的是内容画布

三者都与 Artifact 相关，但还没有统一到同一个交付物主模型。

### 4) 当前 parser 仍以 fence/markdown 提取为主

`src/lib/artifact/parser.ts` 现在主要做：

- ` ```artifact ... ` 提取
- 普通代码块推断
- plainText 与 artifact 分离

这适合兼容模式，不适合作为高配版的长期事实源。  
高配版必须从“解析文本里有什么 artifact”升级为“运行时明确产出什么 artifact block”。

### 5) 编辑态与展示态还不是一个产品闭环

当前有 Tiptap 编辑器，但它主要存在于 `document canvas` 内。  
高配版需要的是：

- 先生成
- 再预览
- 再局部重写
- 再比对版本
- 再导出/复用

这些动作要围绕同一个 Artifact Document 完成，而不是在聊天、画布、文件之间来回切换。

## 3. 核心决策

## 3.1 产品主张

Lime 的高配版 Artifacts 应该明确采用：

**Chat for reasoning, Artifact for delivery。**

含义：

- 聊天区负责目标澄清、任务推进、过程解释、追问与协作
- Artifact Workbench 负责正式产物的创建、阅读、编辑、对比、导出与沉淀
- Timeline 负责过程透明，而不是承担最终阅读面

换句话说：

**消息区不是最终作品区。**

## 3.2 长期事实源

长期统一到：

**结构化 Artifact Document + 版本化 Block Tree + 可编辑 Workbench**

而不是：

- 普通 Markdown 长文
- 单个大字符串 HTML
- 临时 artifact fence 解析结果

## 3.3 技术主栈决策

高配版建议采用：

**Tiptap / ProseMirror 作为主编辑引擎，但不作为顶层长期 canonical model。**

更准确地说：

- `ArtifactDocument JSON` 才是产品层长期事实源
- `Tiptap / ProseMirror JSON` 是编辑器层载荷与 rich_text block 的工作表示
- `Markdown / HTML / PDF` 是导出与分发表达

理由：

1. Tiptap / ProseMirror 非常适合富文本编辑、schema 约束、节点扩展、局部事务与协同增强。
2. 但它的 JSON 结构本质上贴近编辑器内部 schema，不适合作为整个平台的顶层产品对象。
3. Lime 的 Artifact 不只是富文本，还包括来源、评分块、表格块、执行绑定、浏览器会话引用、导出记录等领域对象。
4. 如果把这些全部硬塞进 ProseMirror 节点树，未来的迁移、查询、导出、跨端实现和协议演进成本会被放大。

因此建议采用四层模型：

- 兼容输入层：Markdown / artifact fence / 文件快照
- 运行时协议层：Artifact Parts / Block Ops
- 产品持久化层：ArtifactDocument JSON
- 编辑器载荷层：RichText Block 内可使用 Tiptap / ProseMirror JSON

## 3.4 框架层决策

在重新评估 `aster-rust blueprint` 与 `codex-rs` 之后，路线图增加一条硬决策：

**不要把 Artifact Workbench 直接建立在 Blueprint 抽象之上。**

更合适的长期分层是：

- Lime：产品层交付物与工作台
- Aster Runtime：通用 `thread / turn / item / event / output schema`
- Blueprint：可选的长周期 planning module

判断依据见：

- `docs/roadmap/artifacts/framework-boundary.md`

这条决策很关键，因为一旦把文档交付协议和任务树执行框架混在一起，后面每扩一种 Artifact 类型，都会反向污染 runtime。

## 4. 目标与非目标

## 4.1 总目标

为 Lime 建立一套统一的 Artifact Workbench，让高价值回复默认沉淀为：

`结构化交付物 -> 专用阅读面 -> 局部可编辑 -> 可版本比较 -> 可导出复用`

## 4.2 子目标

1. 让“报告、方案、规划、研究、执行摘要、表格型结论”默认进入 Artifact Workbench，而不是只停留在消息正文。
2. 让回复具备更强的视觉层级：摘要卡、提示框、表格、评分块、引用块、来源区、版本条。
3. 让 Artifact 在会话中持续增量更新，而不是每轮都生成一个新的孤岛文件。
4. 让编辑态、展示态、导出态围绕同一份 Artifact Document 运转。
5. 让 Service Skill、Automation、Browser Assist、Theme Workbench 的产物最终都能落到同一套 Artifact Workbench。

## 4.3 非目标

1. 不做通用网页搭建器。
2. 不在第一阶段做任意 React 组件执行沙箱。
3. 不让模型直接输出大量不受控 HTML 作为主协议。
4. 不重写现有全部 Canvas，只做收敛与增量替换。
5. 不把所有回复都强制转成 Artifact，短问答仍可保持轻量聊天。

## 5. 目标产品形态

## 5.1 三栏心智

高配版建议把主界面稳定为三种职责：

| 区域 | 主职责 | 说明 |
|------|------|------|
| Conversation | 对话、追问、任务推进 | 保留聊天心智，但弱化“大段正式正文” |
| Artifact Workbench | 阅读、编辑、比对、导出 | 正式交付面 |
| Timeline / Inspector | 过程、工具、来源、状态 | 可折叠的执行与证据面 |

这与当前 Lime 的工作台分栏方向一致，不需要推翻现有 UI 模式。

## 5.2 Artifact Workbench 的核心视图

每个 Artifact Document 至少支持五种视图：

1. `阅读视图`
   - 报告式排版
   - 强层级和可扫描性
2. `源码视图`
   - Markdown / JSON / 原始块数据
3. `编辑视图`
   - Tiptap 可编辑文档
4. `版本对比视图`
   - 上一版本与当前版本差异
5. `来源视图`
   - citations、搜索结果、文件引用、工具产物引用

## 5.3 回复升级规则

不是所有回复都进入高配 Artifact。

建议由运行时按任务意图决定：

| 场景 | 默认形态 |
|------|------|
| 简短问答 | 普通消息 |
| 研究、汇总、总结、方案、PRD、roadmap | Artifact Document |
| 表格、评分、对比、清单 | Artifact 内语义块 |
| 浏览器实时会话 | Browser Assist Artifact |
| 图片/海报/文档主题工作台 | Theme Canvas / Artifact Workbench |

判断原则：

- 有明确交付物时，Artifact 优先
- 需要多轮持续改写时，Artifact 优先
- 只是即时回答问题时，消息优先

## 6. 信息架构

## 6.1 核心对象模型

建议新增或收敛为以下产品对象：

### ArtifactDocument

正式交付物实体。

建议字段：

| 字段 | 说明 |
|------|------|
| `id` | Artifact 文档 ID |
| `threadId` | 所属 thread |
| `workspaceId` | 所属 workspace |
| `theme` | 主题域，当前统一为 general |
| `kind` | `report / plan / brief / table / dashboard / canvas` |
| `title` | 标题 |
| `status` | `draft / streaming / ready / failed / archived` |
| `currentVersionId` | 当前版本 |
| `sourceRunId` | 来源 turn/run |
| `deliveryMode` | `inline / docked / fullscreen / exported` |

### ArtifactVersion

文档版本实体。

建议字段：

| 字段 | 说明 |
|------|------|
| `id` | 版本 ID |
| `artifactId` | 所属文档 |
| `versionNo` | 递增版本号 |
| `documentSnapshot` | ArtifactDocument JSON 快照 |
| `editorPayloads` | 可选的编辑器层载荷快照，如 rich_text block 的 Tiptap JSON |
| `markdownSnapshot` | 兼容导出快照 |
| `summary` | 版本摘要 |
| `createdBy` | `agent / user / automation` |
| `createdAt` | 创建时间 |

### ArtifactBlock

文档内部结构块。

建议首批支持：

- `heading`
- `paragraph`
- `summary_card`
- `key_points`
- `callout`
- `table`
- `checklist`
- `score_grid`
- `quote`
- `citation_list`
- `image`
- `code_block`
- `divider`

### ArtifactSourceLink

来源绑定。

建议字段：

| 字段 | 说明 |
|------|------|
| `artifactId` | 文档 ID |
| `blockId` | 对应 block |
| `sourceType` | `web / file / tool / message / search_result` |
| `sourceRef` | 来源引用 |
| `label` | 显示名称 |
| `locator` | 行号、URL、toolCallId 等定位信息 |

### ArtifactRunBinding

交付物与执行过程的绑定关系。

建议字段：

| 字段 | 说明 |
|------|------|
| `artifactId` | 文档 ID |
| `threadId` | thread |
| `turnId` | turn |
| `itemId` | timeline item |
| `bindingType` | `primary_output / intermediate / exported` |

## 6.2 与现有 `Artifact` 的关系

当前 `src/lib/artifact/types.ts` 不应直接废弃，而应定位为：

- 兼容层 Artifact
- 流式展示与轻量渲染容器

高配版建议新增一层更长期的 `ArtifactDocument` 模型。  
关系如下：

- `Artifact`：运行时 UI 容器
- `ArtifactDocument`：产品层正式交付物
- `ArtifactVersion`：持久化版本
- `ArtifactBlock`：结构化文档语义块

## 7. 协议设计

## 7.1 为什么要引入协议层

如果继续让模型只输出普通 Markdown，前端只能“尽量渲染好看”。  
高配版需要的是：

- 模型明确声明自己在生成什么类型的交付物
- 前端知道哪些内容属于摘要卡、表格、结论、提醒、引用
- 后端能在流式过程中做版本记录与落盘

因此需要从“文本解析”升级为“结构化产物协议”。

但这里要注意：

**结构化产物协议属于 Lime 产品层，不等于 runtime 协议。**

runtime 协议更接近 `codex` 的做法：

- turn 级 `outputSchema`
- item lifecycle
- approval / elicitation / interrupt
- event stream

Artifact Workbench 应建立在这层稳定 runtime substrate 之上，而不是反过来把产品协议塞进框架层。

## 7.2 三层协议

### A. Message Parts 协议

用于聊天流中的即时显示。

建议 part 类型：

- `text`
- `reasoning_summary`
- `tool_call`
- `tool_result`
- `artifact_intent`
- `artifact_progress`
- `artifact_block`
- `citation`

这层用于：

- 消息区轻量回显
- Timeline 过程展示
- Workbench 流式创建状态

### B. Artifact Ops 协议

用于构建正式交付物。

建议操作：

- `artifact.create`
- `artifact.set_meta`
- `artifact.upsert_block`
- `artifact.reorder_blocks`
- `artifact.remove_block`
- `artifact.attach_source`
- `artifact.finalize_version`
- `artifact.fail`

每个 block 必须有稳定 `blockId`，这样才支持：

- 流式增量更新
- 局部重写
- 版本 diff
- 引用与块绑定

### C. Persisted Snapshot 协议

最终持久化为：

- `artifact_document_json`
- `editor_payload_snapshot`
- `markdown_snapshot`
- `render_manifest`

其中：

- `artifact_document_json` 是长期事实源
- `editor_payload_snapshot` 是编辑器层快照，不是产品层 canonical
- `markdown_snapshot` 负责兼容导出
- `render_manifest` 负责阅读态性能与缓存

## 7.3 与当前 parser 的关系

`src/lib/artifact/parser.ts` 应保留，但角色需要降级为：

### current

- 兼容旧模型输出
- 解析 fence/code block
- 在没有结构化协议时尽量抽出 artifact

### future

- 仅作为 fallback ingest
- 不再承担高配版主生成链路

## 8. 前端架构

## 8.1 Workbench Shell

建议新增统一的 `ArtifactWorkbenchShell`，作为右侧或全屏交付物容器。

应复用：

- `workbenchPreview.tsx`
- `WorkspaceCanvasContent.tsx`
- `ArtifactToolbar`
- `ArtifactRenderer`

但职责要更清晰：

- Shell 负责布局、视图切换、侧栏、版本条、来源抽屉
- Renderer 负责块渲染
- Editor 负责编辑
- Timeline/Inspector 负责过程与证据

## 8.2 阅读态渲染器

阅读态不建议继续只靠通用 Markdown CSS。  
应改为：

**Artifact Block Renderer Registry -> 自定义 React 组件**

其中：

- 语义块直接走业务组件渲染
- rich_text block 可选使用 Tiptap Static Renderer

每个语义块对应稳定组件：

- 摘要卡
- 指标卡
- 对比表
- 提示框
- 评分矩阵
- 来源列表

这样才能做到：

- 风格稳定
- 留白稳定
- 层级稳定
- 多次生成看起来像同一产品，而不是不同模型的随机输出

## 8.3 编辑态

编辑态建议直接复用并扩展现有 `NotionEditor.tsx`：

- 支持块级选中
- 支持局部 AI 改写
- 支持引用插入
- 支持固定模板块
- 支持 slash command 插入语义块

不建议新起第二套富文本编辑器。

## 8.4 版本比较

高配版必须把“上一版/最新版”作为一等能力。

当前 `useArtifactDisplayState.ts` 已经有“上一版本占位”思路。  
下一步应该升级为真正的版本系统：

- block diff
- 章节级变化高亮
- 用户确认采纳/回退

## 8.5 来源与证据层

漂亮的回复如果没有证据层，会变成只是“看起来专业”。

因此 Workbench 需要固定的来源面：

- 本地文件引用
- 搜索结果引用
- 网页来源
- tool 输出来源
- timeline item 引用

阅读态中可用上标或尾注形式呈现，点击后跳到右侧来源抽屉。

## 8.6 UI / UX 原则

遵守 `docs/aiprompts/design-language.md`，并针对 Artifact Workbench 补充以下原则：

1. 主表面使用实体白底，不用半透明磨砂主容器。
2. 正文排版优先中文阅读节奏，避免文档像英文博客模板。
3. 强调色只用于：
   - 状态
   - 关键结论
   - 引导操作
4. 表格、提示框、指标卡必须来自统一组件，不允许模型自由拼样式。
5. 右侧阅读面优先长时间可读，不做营销风大横幅。

## 9. 后端与持久化

## 9.1 数据库建议

建议新增以下表：

### `artifact_documents`

- 文档主表
- 归属 workspace / thread / theme

### `artifact_versions`

- 版本表
- 保存 `artifact_document_json`、可选 `editor_payload_snapshot`、`markdown_snapshot` 与版本摘要

### `artifact_sources`

- block 到 source 的映射

### `artifact_exports`

- 导出记录
- 记录导出格式、路径、时间

### `artifact_run_bindings`

- 连接 timeline turn/item 与 artifact

## 9.2 文件系统策略

Lime 是本地优先产品，Artifact 应支持落盘，但不能写死平台路径。

要求：

1. 落盘路径通过 Workspace 或应用目录 API 解析。
2. 导出格式首期支持：
   - Markdown
   - HTML
   - PDF
   - JSON
3. 自动保存使用原子写入策略，避免写入中断造成损坏。
4. Windows/macOS 都走统一目录解析，不写死 `~/Library/...`。

## 9.3 与 Timeline 的关系

`src-tauri/src/services/agent_timeline_service.rs` 当前已能投影 `ArtifactSnapshot`。  
高配版建议扩展为：

- timeline 记录过程
- artifact document 记录产物
- 两者通过 `artifact_run_bindings` 连接

原则：

- Timeline 不直接承担正式阅读面
- Artifact 不丢失来源过程

## 10. Agent 与编排策略

## 10.1 产物生成策略

高配版不建议一开始就拆成很多 formatter 子 agent。  
首期先统一协议，再逐步增强编排。

建议顺序：

1. 先让主 agent 明确输出 `artifact_intent`
2. 再通过 `artifact ops` 生成结构化块
3. 最后可选地引入 `formatter/refiner` 子阶段

## 10.2 Prompt 约束

系统提示词需要明确：

1. 当任务目标是报告、方案、roadmap、总结、研究时，优先生成 Artifact Document。
2. 消息区只保留：
   - 简短说明
   - 进度
   - 下一步
3. 不把完整长文再次重复贴回聊天区。
4. 优先使用 block 语义，而不是自由拼 HTML。

## 10.3 与 Service Skills 的关系

当前正在推进 `ServiceSkill`。  
高配版 Artifact Workbench 可以成为 ServiceSkill 的统一交付面：

- `instant`：生成一份 Artifact Document
- `scheduled`：定期生成新版本
- `managed`：持续维护同一文档或同一档案集

这会让 ServiceSkill 从“启动器”真正闭环到“交付物系统”。

## 11. 分阶段路线图

## Phase 0：协议与壳层对齐

目标：

- 明确长期对象模型与协议边界
- 不大改 UI，只先收口事实源

交付：

1. 定义 `ArtifactDocument / ArtifactVersion / ArtifactSourceLink` 类型
2. 明确 `Artifact` 兼容层与 `ArtifactDocument` 长期层的关系
3. 定义 `artifact ops` 事件协议
4. 新增 Workbench Shell 设计稿与组件边界

不做：

- 大规模 UI 改版
- 完整编辑器改造

## Phase 1：高质量阅读态 Workbench

目标：

- 先把“看起来高级”做出来
- 回复从普通 Markdown 升级为报告式交付物

交付：

1. 新增 `ArtifactWorkbenchShell`
2. 新增首批语义块：
   - `summary_card`
   - `callout`
   - `table`
   - `checklist`
   - `score_grid`
   - `citation_list`
3. 消息区与 Artifact Workbench 分工明确
4. 高价值回复默认进入右侧交付面

验收：

- 用户不打开源码，也能一眼扫读主要结论
- 报告类回复在视觉上明显区别于普通消息

## Phase 2：可编辑 Artifact Document

目标：

- 让 Artifact 不只是预览面，而是正式编辑面

交付：

1. 以 `ArtifactDocument JSON` 作为正式持久化模型
2. 在 `rich_text` block 内引入 Tiptap / ProseMirror 编辑载荷
3. 将现有 `NotionEditor` 融入 Artifact Workbench
4. 支持局部块编辑、局部 AI 改写、块插入
5. 支持自动保存与版本生成

验收：

- 用户能直接在 Workbench 上编辑，而不是跳回消息区重来
- 编辑后的结果不会丢失结构与样式

## Phase 3：版本、差异与来源闭环

目标：

- 让 Artifact 成为长期资产，而不是一次性结果

交付：

1. 版本列表与版本摘要（已落地）
2. block diff（最小闭环已落地）
3. source drawer / citations（已落地，支持来源项 -> block 跳转）
4. timeline item 与 artifact block 双向跳转（已落地）

验收：

- 用户能知道“新版本改了什么”
- 用户能知道“这段内容从哪里来”

## Phase 4：Artifact First 产品化

目标：

- 让 Artifact Workbench 成为 Lime 的统一交付层

交付：

1. ServiceSkill 默认输出 Artifact
2. Automation 定时生成 Artifact 版本
3. Browser Assist / Search / File 结果可沉淀到同一文档
4. 支持导出、分享、归档、项目复用

验收：

- 用户可以把 Lime 当作持续生成与维护交付物的工作台
- 交付物在会话结束后仍具备长期价值

## 12. 仓库落地建议

## 12.1 建议优先复用的现有模块

| 现有模块 | 建议角色 |
|------|------|
| `src/components/artifact/*` | 保留为渲染与工具栏底座 |
| `src/lib/artifact/*` | 保留为兼容层与基础状态层 |
| `workbenchPreview.tsx` | 升级为 Artifact Workbench 入口壳 |
| `WorkspaceCanvasContent.tsx` | 继续承载右侧主预览容器 |
| `NotionEditor.tsx` | 作为编辑态主内核 |
| `AgentThreadTimeline.tsx` | 作为过程层和来源层入口 |
| `workbenchCanvas.ts + CanvasFactory.tsx` | 继续承接主题类 Canvas 共享网关与渲染分发 |

## 12.2 建议新增的目录

建议新增：

```text
src/components/artifact-workbench/
src/lib/artifact-document/
src/lib/artifact-protocol/
src-tauri/src/services/artifact_document_service.rs
```

职责建议：

- `artifact-workbench/`：壳层、视图切换、侧栏、版本条、来源抽屉
- `artifact-document/`：对象模型、版本管理、diff、序列化
- `artifact-protocol/`：artifact ops、part 映射、兼容层；当前已先落地 metadata/path 读取壳层，后续继续向完整协议边界收敛
- `artifact_document_service.rs`：持久化与查询

如果后续同步推进 `aster-rust`，则建议新增独立 runtime 模块，而不是继续堆进 `blueprint/`：

```text
/Users/coso/Documents/dev/ai/astercloud/aster-rust/crates/aster/src/runtime/
```

这部分是框架层远期方向，不覆盖 Lime 当前仓库已确定的运行时收口主计划。

建议职责：

- `thread / turn / item`
- `event bus`
- `prompt composer`
- `output schema`
- `approval / elicitation / interrupt`
- `state persistence`

## 12.3 迁移原则

1. 不直接删除旧 Artifact 系统，先把它降级成兼容层。
2. 不直接替换所有 Canvas，只先把通用报告类产物接到新 Workbench。
3. 优先打通 `general` 主链下的高价值文本产物。
4. 在协议稳定前，不急着让所有模型都严格产出结构化块。
5. 不让 `blueprint` 直接接管 Artifact 主链，Blueprint 只作为可选 planning capability 接入。

## 12.4 运行时迁移原则

本节只表达 Artifact 产品侧对 runtime 的依赖顺序，不替代 `docs/roadmap/lime-conversation-execution-efficiency-roadmap.md` 已锁定的 P1 / P2 / P3 / P4 执行顺序。

1. 先把 `system prompt + output schema + validator` 的控制链建立起来。
2. 再把 Stage 1 / Stage 2 生成链升级为标准 turn。
3. 再定义 item / delta / version / diff 事件。
4. 最后才考虑把 Blueprint 接入某些“复杂规划型 Artifact”场景。

## 13. 成功指标

上线后建议重点观察：

1. 报告类任务中，Artifact 打开率与停留时长。
2. 用户对同一 Artifact 的二次编辑率。
3. 版本比较的使用率。
4. 导出率与复制率。
5. 消息区长文占比是否下降。
6. 用户是否更少要求“帮我重新整理得更清晰一点”。

## 14. 风险与约束

## 14.1 主要风险

1. 同时维护产品层 JSON、编辑器载荷和导出快照，容易漂移。
2. 过早做成任意页面搭建器，会把范围做爆。
3. 语义块过多、过复杂，会压垮 prompt 与 renderer。
4. 如果没有来源层，最终只会变成“更好看的幻觉输出”。

## 14.2 控制原则

1. `ArtifactDocument JSON` 是正式事实源；Tiptap / ProseMirror JSON 只存在于编辑器层或 rich_text block 内。
2. 首批只做有限 block 集，不追求无限扩展。
3. 先把阅读态与编辑态打通，再做复杂自动排版。
4. 任何导出与落盘都必须通过 workspace / 应用目录 API 解析路径。
5. system prompt 不是唯一控制点，必须叠加 turn 级 schema 与 validator。

## 15. 最终结论

Lime 不缺“漂亮回复”的单点技巧，缺的是：

**统一的 Artifact Product Model。**

你们现有代码已经具备高配版所需的 70% 基础设施：

- 有工作台
- 有 artifact
- 有 timeline
- 有 canvas
- 有 Tiptap

真正要补的是剩下这 30%：

- 正式交付物对象
- 结构化协议
- 报告式阅读面
- 版本与来源闭环

因此最优路径不是“继续调 Markdown 样式”，而是：

**把 Artifact 从“聊天的附件”升级为“Lime 的正式交付层”。**
