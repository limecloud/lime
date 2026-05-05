# Lime AI 图层化设计架构

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：定义 Lime AI 图层化设计的文档协议、数据流、图层类型、编辑行为和 provider 边界，让后续实现不落成单图输出旁路。

## 1. 架构原则

1. **文档优先**
   - `LayeredDesignDocument` 是唯一 current 事实源。

2. **资产可替换**
   - 每个 ImageLayer 绑定 asset，单层重生成只替换该 asset 或生成新版本。

3. **文字可编辑**
   - 普通文案必须是 TextLayer，不默认烘焙成图片。

4. **导出是投影**
   - PNG / PSD / zip 都从同一文档导出，不反向成为事实源。

5. **模型在边界外**
   - `gpt-image-2`、Gemini、Flux 等只通过 provider adapter 进入 Asset Generator。

## 2. 核心文档协议

首期建议协议：

```ts
type LayeredDesignDocument = {
  id: string
  title: string
  status: "draft" | "ready" | "exported"
  canvas: DesignCanvas
  layers: DesignLayer[]
  assets: GeneratedAsset[]
  preview?: DesignPreview
  editHistory: LayerEditRecord[]
  createdAt: string
  updatedAt: string
}

type DesignCanvas = {
  width: number
  height: number
  backgroundColor?: string
  safeArea?: Rect
}

type DesignLayer = ImageLayer | TextLayer | ShapeLayer | GroupLayer

type BaseLayer = {
  id: string
  name: string
  visible: boolean
  locked: boolean
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  zIndex: number
  blendMode?: "normal" | "multiply" | "screen" | "overlay" | "lighten"
  source: "planned" | "generated" | "extracted" | "user_added"
}

type ImageLayer = BaseLayer & {
  type: "image" | "effect"
  assetId: string
  maskAssetId?: string
  alphaMode: "embedded" | "mask" | "blend" | "none"
  prompt?: string
}

type TextLayer = BaseLayer & {
  type: "text"
  text: string
  fontFamily?: string
  fontSize: number
  color: string
  align: "left" | "center" | "right"
  lineHeight?: number
  letterSpacing?: number
}

type ShapeLayer = BaseLayer & {
  type: "shape"
  shape: "rect" | "round_rect" | "line" | "ellipse"
  fill?: string
  stroke?: string
  strokeWidth?: number
}

type GroupLayer = BaseLayer & {
  type: "group"
  children: string[]
}
```

首期不需要把协议设计成完整 PSD schema，只要稳定支持 Canvas 编辑和后续映射即可。

## 3. 资产协议

```ts
type GeneratedAsset = {
  id: string
  kind:
    | "background"
    | "subject"
    | "effect"
    | "logo"
    | "text_raster"
    | "mask"
    | "clean_plate"
    | "preview"
  src: string
  width: number
  height: number
  hasAlpha: boolean
  provider?: string
  modelId?: string
  prompt?: string
  params?: Record<string, unknown>
  parentAssetId?: string
  createdAt: string
}
```

要求：

1. 每个生成资产都可追踪 provider、model、prompt 和参数。
2. mask、clean plate 和 preview 都是资产，但只有 layer 引用的资产才出现在图层栏。
3. 替换资产不应改变 layer id、transform 和 zIndex。

## 4. 原生分层生成数据流

```text
用户 prompt
  -> Layer Planner 输出 layer plan
  -> Asset Generator 分层生成 bitmap
  -> Matting Processor 产出 RGBA / mask
  -> Layout Normalizer 估算位置和尺寸
  -> Composer 生成 preview
  -> 持久化 LayeredDesignDocument
```

关键规则：

1. 背景 prompt 必须显式要求“无文字、无人物、无 Logo”。
2. 主体 prompt 优先要求“干净背景”或透明输出；透明不稳定时走抠图。
3. 烟雾、光效可使用 alpha 或 blend mode。
4. 普通文案由 Lime 自己创建 TextLayer。
5. 最终预览图只是 `preview` asset。

## 5. 扁平图拆层数据流

```text
flat image
  -> VLM / OCR 识别对象和文字
  -> SAM/RMBG 输出候选 masks
  -> mask -> RGBA ImageLayer
  -> mask 合并 -> background removal mask
  -> provider edit / inpaint 生成 clean plate
  -> OCR 文字转 TextLayer
  -> 生成 LayeredDesignDocument
```

关键规则：

1. 自动拆层结果必须标记 `source="extracted"`。
2. 低置信度 mask 只能作为候选层，不能静默覆盖原图。
3. 艺术 Logo 首期保留为 ImageLayer。
4. clean plate 失败时仍可编辑图层，但 UI 必须提示移动可能露出修补痕迹。

## 6. 单层重生成数据流

```text
用户选中 layer
  -> 读取 layer prompt / style / bbox / context
  -> 调用 provider 生成替代资产
  -> 必要时抠图和修边
  -> 写入新 asset
  -> layer.assetId 指向新 asset
  -> editHistory 记录替换
  -> Composer 更新 preview
```

关键规则：

1. 保留原 layer id。
2. 保留 transform、zIndex、visible、locked。
3. edit history 记录旧 asset 和新 asset。
4. 失败时不破坏旧 asset。

## 7. Provider 边界

Provider adapter 只提供能力，不定义产品语义：

```ts
type ImageProviderCapabilities = {
  modelId: string
  supportsGeneration: boolean
  supportsEdit: boolean
  supportsTransparentBackground?: boolean
  supportsMaskEdit?: boolean
  supportedSizes: string[]
  supportedQualities: string[]
  maxInputImages?: number
}
```

`gpt-image-2` 接入时：

1. 通过 capability matrix 决定是否可用于生成、编辑、透明输出和 mask。
2. 不在 UI 文案中承诺模型级能力，UI 只表达“生成 / 编辑 / 抠图 / 修补”。
3. 如果官方能力变化，只更新 provider capability，不改图层协议。

## 8. 持久化与 artifact

首期保存建议：

```text
.lime/designs/<design_id>/design.json
.lime/designs/<design_id>/assets/<asset_id>.png
.lime/designs/<design_id>/previews/latest.png
```

后续接入 artifact / evidence 时：

1. `design.json` 是 design artifact。
2. `latest.png` 是 preview artifact。
3. 每次 provider 调用写入 evidence event。
4. export 结果写入 export artifact。

## 9. GUI 边界

Canvas Editor 首期必须支持：

1. 图层列表。
2. 画布渲染。
3. 选中图层。
4. 拖拽移动。
5. 缩放。
6. 显示/隐藏。
7. 锁定。
8. zIndex 重排。
9. 单层重生成。
10. 导出 PNG。

不在首期承诺：

1. 曲线钢笔工具。
2. 完整蒙版编辑器。
3. 复杂图层样式。
4. 高级字体匹配。
5. 完整 PSD 互操作。
