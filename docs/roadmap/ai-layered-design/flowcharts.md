# AI 图层化设计流程图

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：固定入口分流、图层计划、mask 质量、Canvas 编辑和导出决策流程，避免实现时混成单条不可维护长链。

## 1. 入口分流流程

```mermaid
flowchart TD
  Start[用户请求] --> HasImage{是否上传已有图片?}
  HasImage -->|否| Native[原生分层生成]
  HasImage -->|是| WantsEdit{是否要求编辑已有图?}
  WantsEdit -->|是| Split[扁平图拆层]
  WantsEdit -->|否| Ref[作为参考图生成新设计]

  Native --> Plan[Layer Planner]
  Ref --> Plan
  Split --> Analyze[VLM / OCR / Segment]

  Plan --> CreateDoc[创建 LayeredDesignDocument]
  Analyze --> Confirm[候选图层确认]
  Confirm --> CreateDoc
  CreateDoc --> Editor[Canvas Editor]
```

## 2. Layer Planner 决策流程

```mermaid
flowchart TD
  Prompt[用户目标] --> Intent[提取设计意图]
  Intent --> Format[确定画布尺寸和用途]
  Format --> Layers[生成图层列表]
  Layers --> TextCheck{是否包含普通文案?}
  TextCheck -->|是| TextLayer[创建 TextLayer]
  TextCheck -->|否| SkipText[跳过文本层]
  Layers --> Bitmap[创建 bitmap asset 请求]
  Bitmap --> NeedAlpha{是否需要透明?}
  NeedAlpha -->|是| AlphaPlan[标记 alphaMode 需求]
  NeedAlpha -->|否| OpaquePlan[普通图层]
  TextLayer --> Validate[计划校验]
  SkipText --> Validate
  AlphaPlan --> Validate
  OpaquePlan --> Validate
  Validate --> Ready[Layer Plan Ready]
```

计划校验至少检查：

1. 背景层存在。
2. 普通文案不是 ImageLayer。
3. 每个 ImageLayer 有 asset 生成或提取来源。
4. zIndex 不冲突。
5. 画布尺寸合法。

## 3. Mask 质量门禁流程

```mermaid
flowchart TD
  Mask[候选 mask] --> Score[质量评分]
  Score --> Edge{边缘是否稳定?}
  Edge -->|否| Refine[Matting / Feather 修边]
  Edge -->|是| Area{面积是否合理?}
  Refine --> Area
  Area -->|过小/过碎| Low[低置信度候选]
  Area -->|合理| Alpha{是否需要半透明?}
  Alpha -->|是| Soft[Soft alpha 处理]
  Alpha -->|否| Rgba[RGBA 图层]
  Soft --> Rgba
  Low --> UserConfirm[用户确认是否保留]
  UserConfirm -->|保留| Rgba
  UserConfirm -->|丢弃| Drop[丢弃候选]
```

门禁原则：

1. 不把低质量 mask 静默变成正式图层。
2. 烟雾、头发、玻璃等半透明元素走 soft alpha。
3. mask 失败时保留原图备份层。

## 4. Clean Plate 流程

```mermaid
flowchart TD
  Extracted[已提取对象层] --> MergeMask[合并对象移除 mask]
  MergeMask --> Inpaint[请求背景修补]
  Inpaint --> Check{修补是否可信?}
  Check -->|是| Clean[创建 clean background layer]
  Check -->|否| Warn[创建背景层并标记修补风险]
  Warn --> Manual[允许用户手动重试或保留原图]
  Clean --> Editor[进入 Canvas]
  Manual --> Editor
```

移动图层体验是否可信，取决于 clean plate 是否可用。

## 5. Canvas 编辑状态机

```mermaid
stateDiagram-v2
  [*] --> Loading
  Loading --> Ready: document loaded
  Ready --> Dirty: transform / visibility / zIndex changed
  Dirty --> Saving: debounce save
  Saving --> Ready: save success
  Saving --> SaveFailed: save failed
  SaveFailed --> Dirty: retry / edit again
  Ready --> Regenerating: regenerate layer
  Regenerating --> PreviewCandidate: provider success
  Regenerating --> Ready: provider failed, keep old asset
  PreviewCandidate --> Ready: accept candidate
  PreviewCandidate --> Ready: discard candidate
  Ready --> Exporting: export
  Exporting --> Ready: export success/fail handled
```

状态规则：

1. `Dirty` 状态离开页面要提示。
2. `Regenerating` 不锁死整个画布，只锁当前层和相关操作。
3. provider 失败必须回到旧 asset。

## 6. 导出决策流程

```mermaid
flowchart TD
  Export[用户点击导出] --> Dirty{是否有未保存修改?}
  Dirty -->|是| Save[先保存 document]
  Dirty -->|否| Snapshot[生成 document snapshot]
  Save --> SaveOk{保存成功?}
  SaveOk -->|否| Stop[停止导出并提示]
  SaveOk -->|是| Snapshot
  Snapshot --> PNG[渲染 PNG]
  Snapshot --> JSON[打包 JSON + assets]
  Snapshot --> PSD{是否启用 PSD 试点?}
  PSD -->|是| PSDMap[映射 PSD 图层]
  PSD -->|否| SkipPSD[跳过 PSD]
  PNG --> Artifact[写入 export artifact]
  JSON --> Artifact
  PSDMap --> Artifact
  SkipPSD --> Artifact
  Artifact --> Done[导出完成]
```

## 7. 分阶段推进流程

```mermaid
flowchart LR
  P0[P0 文档与边界] --> P1[P1 原生分层生成]
  P1 --> Gate1{可重新打开编辑?}
  Gate1 -->|否| P1
  Gate1 -->|是| P2[P2 Canvas 编辑]
  P2 --> Gate2{单层重生成不破坏其他层?}
  Gate2 -->|否| P2
  Gate2 -->|是| P3[P3 扁平图拆层]
  P3 --> Gate3{主要对象和 clean plate 可用?}
  Gate3 -->|否| P3
  Gate3 -->|是| P4[P4 专业导出]
```

阶段门禁：

1. P1 不通过，不做复杂 Canvas。
2. P2 不通过，不做任意图拆层。
3. P3 不通过，不承诺 PSD-like 专业交付。
