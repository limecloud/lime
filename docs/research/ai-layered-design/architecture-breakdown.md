# AI 图层化设计架构拆解

> 状态：current research reference  
> 更新时间：2026-05-05  
> 目标：解释 Lovart 类产品如何把 AI 生成图或上传图片变成可移动、可缩放、可重排和可导出的图层工程。

## 1. 总判断

这类产品不是靠某个模型直接吐出完整 PSD。

更准确的系统形态是：

```text
图像生成 / 上传图片
  -> 语义理解
  -> 实例分割 / mask
  -> RGBA 图层提取
  -> 边缘精修 / matting
  -> 背景 clean plate 修补
  -> 文字 OCR 与 TextLayer 重建
  -> Canvas 图层状态管理
  -> PNG / JSON / PSD-like 导出
```

其中最关键的不是“生成图”，而是 **layer decomposition + clean plate reconstruction + non-destructive canvas editing**。

## 2. 两条技术路线

### 2.1 原生分层生成

用户一开始就让系统做海报、封面、商品图或游戏视觉时，最稳的路线是先规划图层，再分别生成资产：

```text
用户目标
  -> Layer Planner
  -> 背景层 prompt
  -> 主体层 prompt
  -> 特效层 prompt
  -> Logo / 标题层 prompt
  -> 真实 TextLayer 文案
  -> Canvas 合成
```

优点：

1. 每个元素天然是独立资产。
2. 单层可重生成，不必整体重做。
3. 文字可以直接成为 TextLayer。
4. 更容易保持设计工程的可解释性。

缺点：

1. 图层之间的光影、遮挡和风格一致性需要额外协调。
2. Logo、人物、背景等资产可能需要多次生成和筛选。
3. 不适合直接还原用户已有的扁平图。

### 2.2 扁平图后处理拆层

用户上传已有图片或系统只有最终海报图时，需要从扁平图反推出主要图层：

```text
flat.png
  -> VLM / OCR 识别对象和文字
  -> SAM / RMBG 生成 mask
  -> 原图乘 mask 得到 RGBA 图层
  -> 原图擦除对象区域
  -> inpainting 生成 clean background
  -> Canvas 里恢复图层对象
```

优点：

1. 可以编辑已有图、竞品图、旧海报或模型一次性生成结果。
2. 更接近 Lovart “Edit Elements” 这类用户体验。

缺点：

1. 原图没有真实被遮挡背景，只能靠修补猜。
2. 头发、烟雾、透明材质和复杂 Logo 容易出边缘问题。
3. 艺术字通常难以变成真实可编辑字体。

## 3. 关键子系统

### 3.1 Layer Planner

Planner 不是普通 prompt 改写器，而是把设计任务拆成可编辑对象：

```text
背景层：暗黑冥界场景，无文字，无人物
主体层：白发女巫，透明背景或可抠图纯色背景
特效层：绿色魔法烟雾，可半透明叠加
Logo 层：HADES II 风格标题，可作为 raster logo
正文层：真实 TextLayer
按钮层：ShapeLayer + TextLayer
```

Planner 输出应包含：

1. 图层名称。
2. 图层类型。
3. prompt / 文案。
4. 推荐位置和尺寸。
5. zIndex。
6. 是否需要透明通道。
7. 是否允许单层重生成。

### 3.2 Mask 与 RGBA 图层

mask 是从扁平图进入图层系统的桥：

```text
layer.rgb = original.rgb
layer.alpha = mask
```

基础 mask 还不够，商业可用需要继续处理：

1. alpha matting。
2. 边缘羽化。
3. 白边/黑边去污染。
4. 小碎片删除。
5. mask 洞填充。
6. 半透明烟雾 soft alpha。

### 3.3 Clean Plate

能“随意移动图层”的前提，是背景层已经补齐被主体挡住的区域：

```text
原图 + 主体 mask
  -> 移除主体
  -> inpainting 补背景
  -> clean background layer
```

没有 clean plate，用户移动人物后会看到原位置的空洞或残影。

### 3.4 TextLayer 重建

普通文本不应该默认烘焙成图片层：

```text
OCR 检测文字区域
  -> 识别文本内容
  -> 估计字号、颜色、对齐、阴影
  -> 生成 Canvas TextLayer
  -> 原图文字区域可选 inpaint
```

边界：

1. 普通标题、正文、按钮文案应重建为 TextLayer。
2. 艺术 Logo、复杂金属字、游戏标题首期可保留为 ImageLayer。
3. 字体精确匹配不是 P0 目标。

### 3.5 Canvas 状态管理

真正承载可编辑性的不是模型，而是 Canvas 文档：

```text
LayeredDesignDocument
  -> canvas
  -> layers[]
  -> assets[]
  -> preview
  -> editHistory
```

用户拖动、缩放和排序时，本质只是更新图层 transform，不重新调用模型。

## 4. ControlNet Seg 的位置

ControlNet Seg 是构图控制工具，不是图层系统。

它适合解决：

1. 人物大概放在哪里。
2. 背景、天空、建筑、产品区域如何分布。
3. 生成模型按 segmentation map 遵守布局。

它不能直接解决：

1. 输出可编辑图层。
2. 背景 clean plate。
3. TextLayer 重建。
4. PSD 导出。

因此在 Lime 里，ControlNet Seg 只能作为可选上游生成约束：

```text
Layout / Seg Map
  -> 图像生成
  -> 图层规划或拆层
  -> Lime Canvas 文档
```

## 5. `gpt-image-2` 的位置

`gpt-image-2` 适合做三类事：

1. 生成背景、主体、特效、Logo 等 bitmap 资产。
2. 对已有图做局部编辑、风格统一和背景修补。
3. 作为高保真图片输入编辑器，辅助单层重生成。

它不应承担：

1. Lime 图层协议定义。
2. Canvas 状态管理。
3. PSD 兼容语义。
4. 设计项目版本历史。

固定判断：

**模型输出是资产，`LayeredDesignDocument` 才是设计工程事实源。**

## 6. 对 Lime 的启发

1. 先做“生成时保留图层”，再做“已有图自动拆层”。
2. 首期把普通文字变成 TextLayer，把艺术 Logo 保留为 ImageLayer。
3. 背景修补是移动图层体验的硬门槛。
4. 图层 JSON 和资源目录必须成为持久化对象，不能只存在前端状态。
5. 单层重生成比整图重生成更符合设计师细调习惯。
