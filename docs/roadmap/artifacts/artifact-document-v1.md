# ArtifactDocument v1 协议草案

> 状态：进行中，block renderer 映射、current-first 协议读取、Markdown / HTML / JSON 桌面导出主链已落地，完整导出态仍未完成  
> 更新时间：2026-03-31  
> 运行时边界：turn metadata、prompt 组装入口、runtime output schema 注入链以 `docs/aiprompts/query-loop.md`、`docs/aiprompts/state-history-telemetry.md` 与 `docs/exec-plans/upstream-runtime-alignment-plan.md` 为准；本文只定义 `ArtifactDocument v1` 的产品层协议与校验映射  
> 依赖文档：`docs/roadmap/artifacts/roadmap.md`  
> 架构蓝图：`docs/roadmap/artifacts/architecture-blueprint.md`  
> 分层边界：`docs/roadmap/artifacts/framework-boundary.md`  
> Prompt 合同：`docs/roadmap/artifacts/system-prompt-and-schema-contract.md`  
> 目标：定义 Lime 高配版 Artifact Workbench 的第一版正式协议，包括产品层对象模型、模型输出契约、校验修复规则与渲染映射

## 1. 结论先行

本协议锁定以下架构决策：

1. `ArtifactDocument JSON` 是产品层长期事实源。
2. `Tiptap / ProseMirror JSON` 只作为编辑器层载荷，主要存在于 `rich_text` block 内。
3. 模型不负责视觉样式，只负责语义结构。
4. 前端不直接渲染“任意 Markdown 长文”为最终交付面，而是渲染语义 block。
5. validator / repair 是主链路必备组件，不允许把模型原始输出直接当成可靠协议。

一句话概括：

**模型输出结构，系统校验结构，渲染器呈现结构。**

这里还要补一句边界声明：

**`ArtifactDocument v1` 是产品层 persisted snapshot，不是 Aster runtime 的 thread/turn/item 协议。**

## 2. 适用范围

`ArtifactDocument v1` 适用于以下高价值输出：

- 报告
- 研究总结
- roadmap
- PRD
- 方案对比
- 执行摘要
- 调研表格
- 多来源整合文档

不适用于：

- 纯聊天短答
- 普通代码片段
- 单张图片生成结果
- 浏览器实时会话帧流本身

这些内容仍可通过现有 `Artifact` 兼容层或其他工作台承载。

## 3. 设计原则

## 3.1 语义优先

协议描述“这是什么内容”，而不是“它长什么样”。

允许：

- `hero_summary`
- `table`
- `callout`
- `citation_list`

不允许：

- 自定义颜色值
- 自定义边距
- 自定义字体大小
- 自定义 CSS class

## 3.2 产品对象优先于编辑器对象

产品层要能表达：

- 版本
- 来源
- 执行绑定
- block 语义
- 导出

这些不应被编辑器内部树结构主导。

## 3.3 Flat But Typed

`v1` 采用**扁平有序 block 列表**，不做复杂嵌套布局系统。

原因：

1. 降低模型输出难度。
2. 降低 validator / repair 复杂度。
3. 降低 renderer 实现成本。
4. 足够支持 80% 的报告类场景。

## 3.4 可降级

任何 block 在渲染失败、校验失败或组件不存在时，都必须可降级到：

- `rich_text`
- 或纯文本 fallback

## 4. 顶层对象模型

## 4.1 ArtifactDocumentV1

```ts
export type ArtifactKind =
  | "report"
  | "roadmap"
  | "prd"
  | "brief"
  | "analysis"
  | "comparison"
  | "plan"
  | "table_report";

export type ArtifactStatus =
  | "draft"
  | "streaming"
  | "ready"
  | "failed"
  | "archived";

export interface ArtifactDocumentV1 {
  schemaVersion: "artifact_document.v1";
  artifactId: string;
  workspaceId?: string;
  threadId?: string;
  turnId?: string;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
  language: "zh-CN";
  summary?: string;
  blocks: ArtifactBlockV1[];
  sources: ArtifactSourceV1[];
  metadata: ArtifactDocumentMetaV1;
}

export interface ArtifactDocumentMetaV1 {
  theme?: "general";
  audience?: string;
  intent?: string;
  generatedBy?: "agent" | "user" | "automation";
  rendererHints?: {
    density?: "comfortable" | "compact";
    defaultExpandedSections?: string[];
  };
  sourceRunBinding?: {
    threadId?: string;
    turnId?: string;
    itemIds?: string[];
  };
  exportHints?: {
    preferredFormats?: Array<"md" | "html" | "pdf" | "json">;
  };
}
```

## 4.2 顶层约束

1. `schemaVersion` 必须固定为 `artifact_document.v1`。
2. `title` 必须为非空字符串。
3. `blocks` 至少 1 个，建议不超过 40 个。
4. `sources` 可以为空，但如果文档声称“基于搜索/网页/文件”，则不应为空。
5. `language` 在 `v1` 固定为 `zh-CN`，避免多语言排版漂移。

## 5. Block 模型

## 5.1 通用字段

```ts
export interface ArtifactBlockBase {
  id: string;
  type: ArtifactBlockType;
  sectionId?: string;
  hidden?: boolean;
  sourceIds?: string[];
}

export type ArtifactBlockType =
  | "section_header"
  | "hero_summary"
  | "key_points"
  | "rich_text"
  | "callout"
  | "table"
  | "checklist"
  | "metric_grid"
  | "quote"
  | "citation_list"
  | "image"
  | "code_block"
  | "divider";
```

规则：

1. `id` 在同一文档内必须唯一。
2. `sourceIds` 只能引用 `sources[]` 中已存在的 id。
3. `sectionId` 只作归组标记，不引入嵌套 DOM 协议。

## 5.2 Block 定义

### A. `section_header`

用于开始一个新章节。

```ts
export interface SectionHeaderBlock extends ArtifactBlockBase {
  type: "section_header";
  title: string;
  description?: string;
}
```

约束：

1. `title` 必填。
2. 文档首块不强制必须是 `section_header`。

### B. `hero_summary`

用于顶部摘要卡。

```ts
export interface HeroSummaryBlock extends ArtifactBlockBase {
  type: "hero_summary";
  eyebrow?: string;
  title?: string;
  summary: string;
  highlights?: string[];
}
```

约束：

1. `summary` 必填，建议 60 到 220 字。
2. `highlights` 建议 2 到 5 项。

### C. `key_points`

用于快速结论列表。

```ts
export interface KeyPointsBlock extends ArtifactBlockBase {
  type: "key_points";
  title?: string;
  items: string[];
}
```

约束：

1. `items` 至少 2 项，建议不超过 7 项。

### D. `rich_text`

通用正文块。

```ts
export interface RichTextBlock extends ArtifactBlockBase {
  type: "rich_text";
  contentFormat: "prosemirror_json" | "markdown";
  content: unknown;
}
```

规则：

1. 长期建议以 `prosemirror_json` 为主。
2. `markdown` 只作为兼容输入与 repair fallback。
3. `rich_text` 是唯一允许承载大段连续正文的 block。

### E. `callout`

用于提醒、结论、风险、建议。

```ts
export interface CalloutBlock extends ArtifactBlockBase {
  type: "callout";
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  title?: string;
  body: string;
}
```

### F. `table`

```ts
export interface TableBlock extends ArtifactBlockBase {
  type: "table";
  title?: string;
  columns: string[];
  rows: string[][];
}
```

约束：

1. `columns` 至少 2 列。
2. 每行单元格数量应与列数一致。
3. 单元格内容必须是字符串，`v1` 不支持复杂嵌套对象。

### G. `checklist`

```ts
export interface ChecklistBlock extends ArtifactBlockBase {
  type: "checklist";
  title?: string;
  items: Array<{
    id: string;
    text: string;
    state: "todo" | "doing" | "done";
  }>;
}
```

### H. `metric_grid`

```ts
export interface MetricGridBlock extends ArtifactBlockBase {
  type: "metric_grid";
  title?: string;
  metrics: Array<{
    id: string;
    label: string;
    value: string;
    note?: string;
    tone?: "neutral" | "success" | "warning" | "danger";
  }>;
}
```

约束：

1. 建议 2 到 8 个 metric。
2. `value` 一律字符串化，避免渲染层处理 number/date 混乱。

### I. `quote`

```ts
export interface QuoteBlock extends ArtifactBlockBase {
  type: "quote";
  text: string;
  attribution?: string;
}
```

### J. `citation_list`

```ts
export interface CitationListBlock extends ArtifactBlockBase {
  type: "citation_list";
  title?: string;
  items: Array<{
    sourceId: string;
    note?: string;
  }>;
}
```

### K. `image`

```ts
export interface ImageBlock extends ArtifactBlockBase {
  type: "image";
  url: string;
  alt?: string;
  caption?: string;
}
```

### L. `code_block`

```ts
export interface CodeBlock extends ArtifactBlockBase {
  type: "code_block";
  language?: string;
  title?: string;
  code: string;
}
```

### M. `divider`

```ts
export interface DividerBlock extends ArtifactBlockBase {
  type: "divider";
}
```

## 5.3 Block 联合类型

```ts
export type ArtifactBlockV1 =
  | SectionHeaderBlock
  | HeroSummaryBlock
  | KeyPointsBlock
  | RichTextBlock
  | CalloutBlock
  | TableBlock
  | ChecklistBlock
  | MetricGridBlock
  | QuoteBlock
  | CitationListBlock
  | ImageBlock
  | CodeBlock
  | DividerBlock;
```

## 6. Source 模型

```ts
export type ArtifactSourceType =
  | "web"
  | "file"
  | "tool"
  | "message"
  | "search_result";

export interface ArtifactSourceV1 {
  id: string;
  type: ArtifactSourceType;
  label: string;
  locator?: {
    url?: string;
    path?: string;
    lineStart?: number;
    lineEnd?: number;
    toolCallId?: string;
    messageId?: string;
  };
  snippet?: string;
  reliability?: "primary" | "secondary" | "derived";
}
```

规则：

1. `label` 必填。
2. `snippet` 为可选摘录，不是完整内容镜像。
3. `locator` 用于跳转，不要求所有字段齐全。

## 7. Version 模型

`v1` 不要求把版本协议塞进文档正文，但必须预留独立版本对象：

```ts
export interface ArtifactVersionRecordV1 {
  id: string;
  artifactId: string;
  versionNo: number;
  documentSnapshot: ArtifactDocumentV1;
  editorPayloads?: Record<string, unknown>;
  markdownSnapshot?: string;
  summary?: string;
  createdBy: "agent" | "user" | "automation";
  createdAt: string;
}
```

## 8. 模型输出契约

## 8.1 模型不应该直接输出什么

禁止作为正式协议输出：

- 任意 CSS
- 任意 HTML 模板
- 组件名 + 样式参数混合
- 整篇只靠纯自然语言长文承载结构

## 8.2 模型应该输出什么

模型应输出以下两类之一：

### 模式 A：一次性草稿

适用于：

- 首次生成
- 非流式离线生成
- 简单交付物

输出对象：

```ts
export interface ArtifactDraftEnvelope {
  type: "artifact_document_draft";
  document: ArtifactDocumentV1;
}
```

### 模式 B：增量操作

适用于：

- 流式生成
- 多轮修订
- 局部改写

输出对象：

```ts
export type ArtifactOpEnvelope =
  | {
      type: "artifact.begin";
      artifactId: string;
      kind: ArtifactKind;
      title: string;
    }
  | {
      type: "artifact.meta.patch";
      artifactId: string;
      patch: Partial<ArtifactDocumentMetaV1>;
    }
  | {
      type: "artifact.source.upsert";
      artifactId: string;
      source: ArtifactSourceV1;
    }
  | {
      type: "artifact.block.upsert";
      artifactId: string;
      block: ArtifactBlockV1;
    }
  | {
      type: "artifact.block.remove";
      artifactId: string;
      blockId: string;
    }
  | {
      type: "artifact.complete";
      artifactId: string;
      summary?: string;
    }
  | {
      type: "artifact.fail";
      artifactId: string;
      reason: string;
    };
```

## 8.3 推荐生成流程

推荐两段式：

1. `artifact_intent`
   - 判断是否需要 Artifact
   - 判断文档 kind
   - 判断是否需要 sources
2. `artifact_document_draft`、正式单条 incremental op，或兼容态 `artifact_ops`
   - 正式生成结构化内容
   - 运行时内部按 current-first action apply；`artifact_ops` 只保留 compat 输入回退

这样比“一次自然语言长回复”更稳定。

## 8.4 模型约束规则

提示词应明确要求模型：

1. 优先输出有限 block 集，不要发明新 block 类型。
2. 每个 block 只承载单一职责。
3. 所有来源型结论必须绑定 `sourceIds` 或 `citation_list`。
4. 不要重复把整篇文档再输出到聊天消息区。
5. block id 必须稳定且语义化，如 `hero`, `market-table`, `next-steps`。
6. 需要大段正文时，使用 `rich_text` block，而不是拆成很多碎 paragraph block。

## 9. Validator 规则

## 9.1 文档级校验

必须校验：

1. `schemaVersion` 是否匹配。
2. `title` 是否存在。
3. `kind` 是否在白名单中。
4. `blocks` 是否非空。
5. `block.id` 是否唯一。
6. `sourceIds` 是否都可解析。

## 9.2 Block 级校验

### `hero_summary`

- `summary` 必填
- `highlights` 非字符串项直接丢弃

### `table`

- `columns.length >= 2`
- 每行长度与列数对齐

### `checklist`

- item `state` 只能是 `todo / doing / done`
- `text` 为空则删除该项

### `metric_grid`

- `label` 与 `value` 必填
- 超过 8 项时保留前 8 项

### `citation_list`

- `sourceId` 必须存在于 `sources`

### `rich_text`

- `contentFormat` 只能是 `prosemirror_json` 或 `markdown`
- `content` 不能为空

## 9.3 Source 级校验

1. `id` 必须唯一。
2. `label` 必填。
3. `type` 必须在白名单中。
4. `snippet` 超长时截断，不作为正文存档。

## 10. Repair 策略

validator 失败时，不应直接放弃整份文档。  
`v1` 采用保守修复策略：

## 10.1 文档级 repair

1. 缺 `title`
   - 用首个 `section_header.title`
   - 再不行用任务标题
   - 再不行用 `未命名交付物`

2. 缺 `blocks`
   - 将原始文本包成一个 `rich_text(markdown)` block

3. 重复 block id
   - 自动追加稳定后缀，如 `-2`、`-3`

## 10.2 Block 级 repair

1. 不支持的 block type
   - 降级为 `rich_text(markdown)`

2. `table` 行列不齐
   - 自动补空字符串到齐平

3. `citation_list` 引用了不存在的 source
   - 删除非法项
   - 若最终为空，整个 block 删除

4. `metric_grid` 非法 value
   - 强制转字符串

5. `callout.body` 为空
   - 降级为 `rich_text(markdown)`

6. `rich_text.prosemirror_json` 无法解析
   - 降级为 `rich_text(markdown)`

## 10.3 最终 fallback

如果整份文档经过 repair 仍不合法：

1. 保留 `artifactId / kind / title`
2. 将模型原始输出包成单个 `rich_text(markdown)` block
3. 标记 `metadata.rendererHints.density = "comfortable"`
4. 在 telemetry 中记录 repair failure

## 11. Renderer 映射

| Block 类型 | 建议组件 | 失败回退 |
|------|------|------|
| `section_header` | `ArtifactSectionHeader` | `rich_text` |
| `hero_summary` | `ArtifactHeroSummaryCard` | `rich_text` |
| `key_points` | `ArtifactKeyPointsList` | `rich_text` |
| `rich_text` | `ArtifactRichTextRenderer` | 纯文本 |
| `callout` | `ArtifactCallout` | `rich_text` |
| `table` | `ArtifactStructuredTable` | `rich_text` |
| `checklist` | `ArtifactChecklist` | `rich_text` |
| `metric_grid` | `ArtifactMetricGrid` | `rich_text` |
| `quote` | `ArtifactQuote` | `rich_text` |
| `citation_list` | `ArtifactCitationList` | 删除 |
| `image` | `ArtifactImageBlock` | 占位图 |
| `code_block` | 复用现有 `CodeRenderer` | `rich_text` |
| `divider` | `ArtifactDivider` | 删除 |

## 11.1 RichText Renderer 约束

`ArtifactRichTextRenderer` 只负责：

- 解析 `rich_text` 内容
- 渲染内联 mark
- 渲染段落、标题、列表、引用、代码

不负责：

- 指标卡
- 提示框
- 表格型业务块
- 来源列表

这些必须由业务 block 组件承载。

## 12. Prompt 模板约束

本节只定义 `ArtifactDocument v1` 需要的结构约束，不重新定义 runtime prompt 入口。

也就是说：

- “哪些 turn 进入 Artifact 主链”
- “turn metadata 如何归一化”
- “output schema 在哪里注入”

这些执行层问题仍以上述 current 入口为准。

系统提示词应增加以下硬约束：

1. 当用户请求的是报告、roadmap、PRD、比较、研究、整合总结时，优先输出 `ArtifactDocument v1`。
2. 先给 `hero_summary` 或 `key_points`，再给主体 block。
3. 对来源敏感内容必须附带 source。
4. 不要输出 CSS、HTML class、视觉说明。
5. 不要在消息正文里重复完整文档，只输出简短说明和下一步。

## 13. 仓库落地建议

建议新增：

```text
src/lib/artifact-document/schema.ts
src/lib/artifact-document/validator.ts
src/lib/artifact-document/repair.ts
src/lib/artifact-document/adapters/tiptap.ts
src/lib/artifact-document/examples.ts
```

职责建议：

- `schema.ts`：类型与 zod/schema 定义
- `validator.ts`：协议合法性检查
- `repair.ts`：保守修复逻辑
- `adapters/tiptap.ts`：`rich_text` 与 Tiptap 互转
- `examples.ts`：供 prompt / tests / storybook 复用的样例

后端建议新增：

```text
src-tauri/src/services/artifact_document_service.rs
src-tauri/src/services/artifact_document_validator.rs
```

## 14. 本版刻意不做

1. 不做复杂栅格布局协议。
2. 不做任意嵌套 section tree。
3. 不做通用组件 DSL。
4. 不做样式 token 下发。
5. 不做完全开放的自定义 block 注册。

`v1` 的目标是稳定，不是无限灵活。

## 15. 最终建议

如果你们要把“漂亮回复”真正做成产品能力，实施顺序应该是：

1. 先锁定 `ArtifactDocument v1`
2. 再做 validator / repair
3. 再做 renderer registry
4. 再做模型输出约束
5. 最后才是视觉细化

原因很简单：

**没有协议，渲染只是化妆。**
