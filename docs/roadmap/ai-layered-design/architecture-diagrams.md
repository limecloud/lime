# AI 图层化设计架构图

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：把 `LayeredDesignDocument`、Canvas Editor、媒体任务、provider seam、asset store、artifact/evidence 的边界画清楚，防止后续实现变成单图输出旁路。

## 1. 总体系统分层图

```mermaid
flowchart TB
  subgraph Entry[入口层]
    Chat[生成主舞台 / @海报 / @配图]
    Upload[上传扁平图]
    Gallery[历史图片 / 设计项目]
  end

  subgraph Planning[规划层]
    Intent[Intent Normalizer]
    Planner[Layer Planner]
    Plan[Layer Plan]
  end

  subgraph Generation[资产生成与处理层]
    Provider["Image Provider Adapter<br/>gpt-image-2 / Gemini / Local"]
    Matting[Matting / RMBG / SAM]
    Inpaint[Inpaint / Clean Plate]
    OCR[OCR / Text Reconstruction]
  end

  subgraph Document[设计工程事实源]
    DesignDoc[LayeredDesignDocument]
    AssetStore[Design Asset Store]
    Preview[Preview Renderer]
  end

  subgraph UI[编辑与交付层]
    Canvas[Canvas Editor]
    Inspector[Layer Inspector]
    Exporter["Exporter<br/>PNG / JSON / PSD-like"]
  end

  subgraph Runtime[运行治理层]
    Task[Media Task / Artifact]
    Evidence[Evidence Pack]
    Routing[Provider / Model Routing]
  end

  Chat --> Intent
  Upload --> Intent
  Gallery --> DesignDoc
  Intent --> Planner
  Planner --> Plan
  Plan --> Provider
  Plan --> OCR
  Provider --> Matting
  Provider --> Inpaint
  Matting --> AssetStore
  Inpaint --> AssetStore
  OCR --> DesignDoc
  AssetStore --> DesignDoc
  DesignDoc --> Preview
  DesignDoc --> Canvas
  Canvas --> Inspector
  Canvas --> DesignDoc
  DesignDoc --> Exporter
  Routing --> Provider
  Provider --> Evidence
  DesignDoc --> Task
  Exporter --> Task
  Task --> Evidence
```

固定判断：

1. `LayeredDesignDocument` 是 current 事实源。
2. provider 输出只进入 `AssetStore`，不能直接成为最终产品状态。
3. Canvas 的每次用户编辑都必须回写设计文档。
4. artifact / evidence 记录生成与导出事实，不定义新的图层协议。

## 2. 前端工作台架构图

```mermaid
flowchart LR
  subgraph Workspace[Layered Design Workspace]
    Topbar["顶部工具栏<br/>返回 / 保存 / 导出"]
    Stage["中央画布<br/>缩放 / 拖拽 / 对齐"]
    LayerRail["左侧图层栏<br/>缩略图 / 可见 / 锁定 / 顺序"]
    Inspector["右侧属性栏<br/>位置 / 尺寸 / 透明度 / prompt"]
    Timeline["底部轻量历史<br/>生成 / 替换 / 导出"]
  end

  LayerRail -->|选中 layerId| Stage
  Stage -->|transform update| Inspector
  Inspector -->|属性修改| Stage
  Stage -->|保存 patch| DocAPI[Design Document API]
  Inspector -->|单层重生成| Regen[Layer Regenerate Action]
  Topbar -->|导出| Export[Export Action]
  Regen --> DocAPI
  Export --> DocAPI
  DocAPI --> Stage
  DocAPI --> LayerRail
  DocAPI --> Timeline
```

页面类型：这是**宽内容区工作台**，不是窄表单页。视觉应遵守 Lime 现有设计语言：主表面实体底色、浅边框、信息优先、低干扰背景。

## 3. 后端服务边界图

```mermaid
flowchart TB
  Frontend[Frontend Canvas / Workspace] --> Gateway[Design Runtime API Gateway]

  Gateway --> DocSvc[Design Document Service]
  Gateway --> PlanSvc[Layer Planning Service]
  Gateway --> AssetSvc[Design Asset Service]
  Gateway --> ExportSvc[Design Export Service]

  PlanSvc --> ModelRouter[Provider / Model Routing]
  ModelRouter --> ImageProvider[Image Provider Adapter]
  ImageProvider --> AssetSvc

  AssetSvc --> Matting[Matting Processor]
  AssetSvc --> Inpaint[Inpaint Processor]
  AssetSvc --> OCR[OCR Processor]

  DocSvc --> Store[(Workspace Design Store)]
  AssetSvc --> Files[(Assets / Masks / Previews)]
  ExportSvc --> Files

  DocSvc --> Artifact[Artifact Projection]
  ExportSvc --> Artifact
  ImageProvider --> Evidence[Evidence Event]
  Matting --> Evidence
  Inpaint --> Evidence
```

实现约束：

1. 不新增平行图片 runtime；服务必须挂回现有媒体任务、Workspace 与 artifact 主链。
2. 如果未来新增 Tauri 命令，必须同步前端调用、Rust 注册、治理目录册和 mock。
3. provider adapter 只暴露能力和结果，不暴露产品层“图层”语义。

## 4. 数据与存储架构图

```mermaid
flowchart TD
  subgraph DesignFolder[.lime/designs/design_id]
    JSON["design.json<br/>LayeredDesignDocument"]
    Assets["assets/*.png<br/>source / rgba / mask / clean_plate"]
    Preview[previews/latest.png]
    Export[exports/*.png / *.zip / *.psd]
  end

  JSON --> Layers["layers list"]
  JSON --> AssetRefs["assets refs"]
  JSON --> History["editHistory list"]
  AssetRefs --> Assets
  Layers --> AssetRefs
  Preview --> Export

  JSON --> ArtifactDoc[Design Artifact]
  Preview --> PreviewArtifact[Preview Artifact]
  Export --> ExportArtifact[Export Artifact]
  History --> Evidence[Evidence Pack]
```

最低持久化原则：

1. `design.json` 可单独解释工程结构。
2. `assets/` 可被重新绑定到图层。
3. `previews/latest.png` 只做加速显示和分享预览。
4. `exports/` 是投影结果，不能反向成为事实源。

## 5. Provider 能力边界图

```mermaid
flowchart LR
  Request[Asset Request] --> Capability[Capability Resolver]
  Capability -->|supportsGeneration| Generate[generate image]
  Capability -->|supportsEdit| Edit[edit / inpaint]
  Capability -->|supportsTransparentBackground| Transparent[transparent output]
  Capability -->|no transparent| PostAlpha[RMBG / SAM / Matting]

  Generate --> RawAsset[Raw Asset]
  Edit --> EditedAsset[Edited Asset]
  Transparent --> RgbaAsset[RGBA Asset]
  RawAsset --> PostAlpha
  PostAlpha --> RgbaAsset
  RgbaAsset --> Layer[ImageLayer assetId]
  EditedAsset --> Clean[Clean Plate / Replacement Asset]
```

核心规则：

1. `gpt-image-2`、Gemini、Flux 的差异只停留在 capability 层。
2. 图层协议不依赖某个模型是否支持透明背景。
3. 透明输出失败时可以回退到后处理，但必须记录 `alphaMode`。

## 6. Artifact / Evidence 分层图

```mermaid
flowchart TB
  UserAction[用户动作] --> DocPatch[Document Patch]
  ProviderCall[Provider 调用] --> EvidenceEvent[Evidence Event]
  DocPatch --> DesignArtifact[Design Artifact]
  ExportAction[导出动作] --> ExportArtifact[Export Artifact]
  PreviewRender[预览渲染] --> PreviewArtifact[Preview Artifact]

  DesignArtifact --> ThreadRead[Thread / Workspace Projection]
  ExportArtifact --> ThreadRead
  PreviewArtifact --> ThreadRead
  EvidenceEvent --> EvidencePack[Evidence Pack]

  EvidencePack --> Review[Review / Replay]
  ThreadRead --> UI[Workspace UI]
```

这层的目标不是让 evidence 接管设计文档，而是让后续 review / replay 能解释：

1. 哪个模型生成了哪个 asset。
2. 用户什么时候替换了哪个 layer。
3. 导出结果来自哪个 document 版本。
