# AI 图层化设计对照 Lime 的偏差分析

> 状态：current research reference  
> 更新时间：2026-05-05  
> 目标：明确 Lime 在 AI 图像设计能力上距离 Lovart 类“可编辑图层工程”还差什么，并为 `docs/roadmap/ai-layered-design/` 提供 current / compat / deprecated / dead 边界。

## 1. 总判断

Lime 不需要先训练模型。

当前真正缺的是：

**把图片生成任务从“返回一张图片”升级为“返回一个可编辑设计工程”。**

这意味着主线不应先追求更换图片模型，而应先建立：

1. 图层文档协议。
2. 分层生成编排。
3. Canvas 编辑状态。
4. 单层重生成。
5. 背景 clean plate。
6. 后续导出链路。

## 2. Lime 已经接近的部分

以下能力已经能作为起点：

1. `@配图` / `@海报` 已有媒体任务语义，可以承载图像生成入口。
2. Workspace 和 artifact / evidence 主链已经适合作为设计项目记录落点。
3. Provider / model routing 已在 Lime 里逐步成为可治理能力，不必为 `gpt-image-2` 单独开旁路。
4. Lime 的 `生成` 主舞台适合作为图层化设计入口，不需要新建平行设计 App。
5. 现有文档体系已经能把外部研究和 Lime roadmap 分层保存。

## 3. 当前主要差距

### 3.1 结果形态仍偏向单图片

现在图片任务通常以单个 output artifact 为中心，缺少：

1. 设计项目 JSON。
2. 图层资产目录。
3. 图层列表和 transform。
4. 单层 provenance。
5. 重新打开后继续编辑的状态。

### 3.2 生成过程没有强制保留中间资产

Lovart 类体验的关键是生成过程中就保留：

1. 背景。
2. 主体。
3. 特效。
4. Logo。
5. 文本。
6. 合成预览。

如果 Lime 只保存最终 PNG，后续只能进入更难的扁平图拆层。

### 3.3 文字仍容易被当作图片

设计师需要改文案，而不是移动一张文字截图。

首期必须把普通文案变成 TextLayer，至少覆盖：

1. 标题。
2. 副标题。
3. 正文。
4. CTA。
5. 按钮文字。

### 3.4 缺少 clean plate 概念

如果从扁平图中抠出主体但不修补背景，用户移动主体后会露出洞。

这会直接破坏“图层可编辑”的可信度。

### 3.5 缺少设计专用 Canvas 工作区

聊天消息里的图片预览不等于图层编辑器。

至少需要：

1. 图层栏。
2. 画布。
3. 选中框。
4. 属性面板。
5. 重生成/替换按钮。
6. 导出入口。

## 4. current / compat / deprecated / dead 分类

### 4.1 current

后续应继续强化的主路径：

1. `生成` 作为 AI 图层化设计入口。
2. `LayeredDesignDocument` 作为设计工程事实源。
3. 原生分层生成作为首期能力。
4. `gpt-image-2` / Gemini / 现有 provider seam 作为资产生成和编辑来源。
5. 普通文案落为真实 TextLayer。
6. Canvas 编辑器管理图层 transform、zIndex、visible、locked。
7. 单层重生成不破坏其他图层状态。

### 4.2 compat

可以过渡保留，但不应作为首期主叙事：

1. 最终 PNG 图片任务。
   - 继续作为预览和导出结果，但不能替代设计工程事实源。
2. 艺术 Logo 的 ImageLayer。
   - 首期可以是 raster 图层，后续再探索矢量化或可编辑文字。
3. 扁平图主要对象拆层。
   - 作为增强能力，不承诺完整 PSD 还原。
4. 黑底特效 + blend mode。
   - 可作为透明特效不稳定时的过渡方案。

### 4.3 deprecated

不应继续扩展成主线的方向：

1. 只优化 prompt，让模型一次性生成更好看的整图。
2. 把图像编辑完全做成聊天指令，不沉淀图层状态。
3. 前端临时保存图层，不落项目文件。
4. 把 `gpt-image-2` 当成图层系统本身。
5. 把普通文案烘焙成不可编辑图片层。

### 4.4 dead

首期明确不做的方向：

1. 自训 image-to-PSD 大模型。
2. 承诺任意图片完美拆成 Photoshop 原始图层。
3. 完整替代 Photoshop / Figma。
4. 新增平行图片设计 runtime，绕过 Lime 媒体任务和 Workspace 主链。
5. 为图层化设计单独创建不可治理 provider 旁路。

## 5. 对 roadmap 的直接要求

后续 `docs/roadmap/ai-layered-design/` 必须做到：

1. 把外部产品参考留在 research 层。
2. 把 Lime 的决定写成独立路线图。
3. 把 `LayeredDesignDocument` 定义成 current 事实源。
4. 首期以原生分层生成为主，不先挑战任意图拆层。
5. 明确图像模型只是资产生成器，Canvas 文档才是工程交付物。
6. 明确 PNG 是导出结果，不是唯一保存事实源。

一句话：

**后续真正需要补的不是更强模型，而是从媒体 artifact 到可编辑设计工程的事实源升级。**
