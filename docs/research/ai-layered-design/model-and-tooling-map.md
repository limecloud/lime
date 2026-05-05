# AI 图层化设计模型与工具地图

> 状态：current research reference  
> 更新时间：2026-05-05  
> 目标：把可用于 Lime 图层化设计的现成模型、API、开源库和工程组件按能力分层，避免把“是否训练模型”误判成首要问题。

## 1. 总结论

Lime 首期不需要自训模型。

更现实的组合是：

```text
LLM / VLM 做规划和识别
GPT Image / Gemini / Flux 做生成与编辑
SAM / RMBG 做 mask 和抠图
inpainting 做 clean plate
OCR 做文字重建
Canvas 做图层编辑
导出器做 PNG / JSON / PSD-like 交付
```

核心壁垒在 **图层协议、工作流编排、编辑体验和可验证交付**，不在单个模型。

## 2. 能力地图

| 能力 | 首期推荐 | 后续可选 | Lime 责任 |
| --- | --- | --- | --- |
| 图层规划 | 通用 LLM | 多模态 VLM + layout scorer | 定义图层计划 schema |
| 图片生成 | `gpt-image-2` 或现有 provider seam | Gemini / Flux / SDXL | 按层生成资产并记录 provenance |
| 图片编辑 | `gpt-image-2` edit / Gemini edit | Flux inpaint / SD inpaint | 保持单层替换不破坏文档 |
| 实例分割 | SAM / SAM2 | GroundingDINO + SAM | 把 mask 转成 ImageLayer |
| 背景移除 | RMBG / rembg / BiRefNet | 专用 matting 服务 | 输出 RGBA 和 alpha 质量标记 |
| 边缘精修 | alpha matting | Matting Anything | 消除白边、断发、脏边 |
| 背景修补 | 图像编辑模型 inpaint | LaMa / IOPaint | 生成 clean plate 背景层 |
| OCR | PaddleOCR / 系统 OCR / VLM | 字体识别模型 | 普通文本转 TextLayer |
| Canvas | Konva / Fabric / Pixi | 自研渲染器 | 管理 transform、zIndex、选中态 |
| 导出 | PNG + JSON | PSD writer / ag-psd / psd-tools | 保留图层语义和资源引用 |

## 3. `gpt-image-2` 接入判断

根据 2026-05-05 可见的 OpenAI 模型页，`gpt-image-2` 定位为图像生成与编辑模型，支持 Image generation 和 Image edit 端点。

Lime 使用时应遵守三条规则：

1. **通过 provider capability 管理能力**
   - 不在业务代码里假设所有模型都支持相同 size、quality、background、mask 或多图输入能力。

2. **透明通道走双路径**
   - 如果当前 provider/model 明确支持 `background=transparent`，可以直接请求透明输出。
   - 如果不支持或效果不稳定，使用 RMBG/SAM/matting 后处理得到 RGBA。

3. **局部编辑不等于图层编辑**
   - edit endpoint 只负责像素重绘，成功后仍要把结果写回 `LayeredDesignDocument` 的某个图层或 clean plate。

## 4. 推荐首期 provider contract

图像 provider 返回结果不应只是图片 URL，而应包含可追踪上下文：

```ts
type GeneratedAsset = {
  id: string
  kind: "background" | "subject" | "effect" | "logo" | "texture" | "clean_plate"
  src: string
  maskSrc?: string
  prompt: string
  modelId: string
  provider: "openai" | "gemini" | "local" | "other"
  width: number
  height: number
  hasAlpha: boolean
  generationParams: Record<string, unknown>
}
```

这能支持：

1. 单层重生成。
2. 失败重试。
3. 设计过程回放。
4. 成本和 provider 追踪。
5. 后续 evidence pack 接入。

## 5. 分割与抠图组合

首期建议按场景选择：

1. **生成时主体层**
   - 让模型生成纯色或简单背景主体图。
   - 用 RMBG 抠成 RGBA。
   - 用 matting 修边。

2. **上传扁平图主要对象**
   - 用 VLM 识别对象清单。
   - 用 SAM 根据 box / point / text prompt 生成 mask。
   - 对每个 mask 输出候选 ImageLayer。

3. **烟雾、光效、粒子**
   - 优先生成黑底或透明输出。
   - 黑底素材可用 screen/lighten blend mode，或按亮度转 alpha。

## 6. 背景修补组合

移动图层前必须有 clean plate。

首期可以直接用图像编辑模型：

```text
输入：原图 + 被移除对象 alpha mask
prompt：移除 mask 区域对象，并保持周围背景、光影、材质和风格一致
输出：clean_background.png
```

后续再引入专用 inpainting：

1. LaMa / IOPaint：快，适合本地对象移除。
2. SD / Flux inpaint：适合风格化或复杂幻想背景。
3. provider edit：适合高质量但成本更高的修补。

## 7. OCR 与文字重建

文字处理分两档：

1. **普通文案**
   - OCR 识别文字。
   - 估计字号、颜色、位置。
   - 生成真实 TextLayer。

2. **艺术字 / Logo**
   - 首期作为 ImageLayer。
   - 允许用户替换或单层重生成。
   - 不承诺可编辑每个字符。

这条边界能避免首期陷入字体识别和矢量化黑洞。

## 8. Canvas 和导出

Canvas 侧首期需要：

1. 图层列表。
2. 选中框和 transform。
3. 显示/隐藏/锁定。
4. zIndex 重排。
5. 单层替换。
6. 导出 PNG。
7. 保存/恢复项目 JSON。

PSD 后续再做，首期只需要保证 JSON 中的图层语义足够稳定，后续可映射到 PSD 图层。

## 9. 参考链接

1. OpenAI `gpt-image-2` 模型页：https://developers.openai.com/api/docs/models/gpt-image-2
2. OpenAI image generation guide：https://platform.openai.com/docs/guides/image-generation
3. OpenAI Images API reference：https://platform.openai.com/docs/api-reference/images
4. Segment Anything paper：https://arxiv.org/abs/2304.02643
5. LaMa object removal 介绍：https://research.samsung.com/blog/LaMa-New-Photo-Editing-Technology-that-Helps-Removing-Objects-from-Images-Seamlessly
