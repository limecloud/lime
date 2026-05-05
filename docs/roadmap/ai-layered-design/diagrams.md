# AI 图层化设计图纸

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：用图示固定原生分层生成、扁平图拆层、单层重生成和导出链路，避免后续实现回退成单图输出。

## 0. 图纸索引

本文件保留早期总览图。后续具体设计优先阅读：

1. [architecture-diagrams.md](./architecture-diagrams.md)
2. [prototype.md](./prototype.md)
3. [sequences.md](./sequences.md)
4. [flowcharts.md](./flowcharts.md)

## 1. 原生分层生成流程

```mermaid
flowchart TD
  U[用户目标 / @海报] --> P[Layer Planner]
  P --> LP[Layer Plan]
  LP --> BG[背景资产生成]
  LP --> SUB[主体资产生成]
  LP --> FX[特效资产生成]
  LP --> LOGO[Logo 资产生成]
  LP --> TXT[TextLayer 创建]
  SUB --> MAT[抠图 / Matting]
  FX --> ALPHA[Alpha / Blend 处理]
  BG --> DOC[LayeredDesignDocument]
  MAT --> DOC
  ALPHA --> DOC
  LOGO --> DOC
  TXT --> DOC
  DOC --> PRE[Composer 预览 PNG]
  DOC --> CANVAS[Canvas Editor]
```

## 2. 扁平图拆层流程

```mermaid
flowchart TD
  F[flat.png] --> VLM[VLM / OCR 识别]
  VLM --> OBJ[对象清单]
  OBJ --> SAM[SAM / RMBG 生成 mask]
  SAM --> RGBA[RGBA 图层]
  SAM --> MERGE[移除区域 mask 合并]
  MERGE --> INP[Inpaint / Edit 修补背景]
  INP --> CLEAN[Clean Plate 背景层]
  VLM --> TEXT[普通文字识别]
  TEXT --> TL[TextLayer]
  RGBA --> DOC[LayeredDesignDocument]
  CLEAN --> DOC
  TL --> DOC
  F --> ORIG[原始图备份层]
  ORIG --> DOC
```

## 3. 单层重生成时序

```mermaid
sequenceDiagram
  participant User as 用户
  participant Canvas as Canvas Editor
  participant Doc as LayeredDesignDocument
  participant Gen as Asset Generator
  participant Mat as Matting Processor
  participant Store as Asset Store

  User->>Canvas: 选择角色层并点击重生成
  Canvas->>Doc: 读取 layer prompt / bbox / style
  Doc->>Gen: 请求替代资产
  Gen-->>Doc: 返回 generated asset draft
  Doc->>Mat: 需要透明通道时抠图修边
  Mat-->>Store: 写入新 RGBA asset
  Store-->>Doc: 返回 newAssetId
  Doc->>Doc: layer.assetId = newAssetId
  Doc->>Doc: 记录 editHistory
  Doc-->>Canvas: 更新图层和预览
  Canvas-->>User: 展示新角色层
```

## 4. 图层文档对象关系

```mermaid
classDiagram
  class LayeredDesignDocument {
    id
    title
    status
    canvas
    layers[]
    assets[]
    preview
    editHistory[]
  }

  class DesignCanvas {
    width
    height
    backgroundColor
    safeArea
  }

  class DesignLayer {
    id
    name
    visible
    locked
    x
    y
    width
    height
    rotation
    opacity
    zIndex
  }

  class ImageLayer {
    assetId
    maskAssetId
    alphaMode
    prompt
  }

  class TextLayer {
    text
    fontFamily
    fontSize
    color
    align
  }

  class ShapeLayer {
    shape
    fill
    stroke
    strokeWidth
  }

  class GeneratedAsset {
    id
    kind
    src
    width
    height
    hasAlpha
    provider
    modelId
    prompt
  }

  class LayerEditRecord {
    id
    kind
    layerId
    before
    after
    createdAt
  }

  LayeredDesignDocument --> DesignCanvas
  LayeredDesignDocument --> DesignLayer
  LayeredDesignDocument --> GeneratedAsset
  LayeredDesignDocument --> LayerEditRecord
  DesignLayer <|-- ImageLayer
  DesignLayer <|-- TextLayer
  DesignLayer <|-- ShapeLayer
  ImageLayer --> GeneratedAsset
```

## 5. 导出链路

```mermaid
flowchart LR
  DOC[LayeredDesignDocument] --> RENDER[Canvas Renderer]
  RENDER --> PNG[PNG Export]
  DOC --> ZIP[JSON + assets zip]
  DOC --> PSDMAP[PSD Mapper]
  PSDMAP --> PSD[PSD-like Export]
  DOC --> EVID[Evidence / Artifact]
  PNG --> EVID
  ZIP --> EVID
  PSD --> EVID
```

## 6. Provider 能力分流

```mermaid
flowchart TD
  REQ[资产请求] --> CAP[Provider Capability Matrix]
  CAP -->|支持透明输出| TRANSPARENT[直接请求透明背景]
  CAP -->|不支持或不稳定| OPAQUE[生成普通图片]
  OPAQUE --> RMBG[RMBG / SAM / Matting]
  TRANSPARENT --> ASSET[RGBA Asset]
  RMBG --> ASSET
  CAP -->|支持 edit / mask| EDIT[局部编辑 / clean plate]
  CAP -->|不支持 edit| ALT[备用 inpainting provider]
  EDIT --> CLEAN[Clean Plate Asset]
  ALT --> CLEAN
```
