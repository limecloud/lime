# AI 图层化设计研究总入口

> 状态：current research reference  
> 更新时间：2026-05-05  
> 目标：把 Lovart 类 AI 设计产品、语义分割、抠图、背景修补与 PSD-like 图层工程拆成可持续对照的研究事实源，供 Lime 后续规划“生成可编辑设计工程”时校准方向。

## 1. 目录定位

`docs/research/ai-layered-design/` 只回答两类问题：

1. Lovart 这类产品为什么能把 AI 图片变成可调整图层。
2. Lime 应该学习哪一层，不应该照搬哪一层。

这里是**研究目录**，不是 Lime 的产品决策目录。

固定分工：

1. `docs/research/ai-layered-design/` 负责外部案例拆解、技术路线识别和风险判断。
2. `docs/roadmap/ai-layered-design/` 负责 Lime 自己的开发计划。
3. 代码实现必须回到 Lime current 主链：`生成` 主舞台、媒体任务、Workspace、artifact / evidence 与后续 Canvas 编辑器。

## 2. 为什么单独建立这一层

AI 生成图片已经不是稀缺能力，真正的设计交付缺口是：

**从一张死图升级为可编辑、可复用、可交付给设计师继续调整的图层工程。**

如果不单独建立研究事实源，后续容易出现三种跑偏：

1. 把 `gpt-image-2`、Gemini、Flux 等生成模型误认为完整解决方案。
2. 直接追求自训 image-to-PSD 大模型，忽略 Lime 当前可以先做的工程编排闭环。
3. 把图层化做成纯前端画布玩具，没有 clean plate、TextLayer、单层重生成和导出事实源。

## 3. 固定研究结论

1. **图像模型不是图层系统**
   - `gpt-image-2` / Gemini / Flux 负责生成和编辑像素，不负责输出 Lime 的设计工程协议。

2. **图层化首先是工程编排**
   - 可行主链是：图层规划、分层生成、抠图/透明通道、背景修补、文字重建、Canvas 状态和导出。

3. **原生分层生成优先于任意图拆层**
   - 生成时保留背景、主体、特效、Logo、文字等中间资产，比从扁平图反推 PSD 稳定得多。

4. **扁平图拆层是后续增强**
   - 上传海报后拆出主要元素，需要 SAM/RMBG、matting、OCR 和 inpainting 组合，首期不承诺完美。

5. **设计师真正要的是非破坏性编辑**
   - 移动、缩放、隐藏、重排、单层重生成、改文案、换背景和导出，才是产品价值。

## 4. 固定不照搬的东西

以下内容默认不直接搬进 Lime：

1. Lovart 的品牌表达、交互动效和商业叙事。
2. “一次生成完整 PSD”的大模型路线作为首期目标。
3. 完整 Photoshop / Figma 替代品定位。
4. 把所有 AI 图像编辑都塞进聊天，不沉淀设计工程状态。
5. 为了显得强大而暴露分割、抠图、修补、OCR 等底层模型名。

Lime 真正要学的是：

1. 生成过程保留中间资产。
2. 扁平图可被语义拆成主要图层。
3. 背景 clean plate 让对象移动后不露洞。
4. 普通文案变成真实 TextLayer。
5. 画布项目文件成为唯一可编辑事实源。
6. 单层可重生成，整体不必重做。

## 5. 建议阅读顺序

1. [architecture-breakdown.md](./architecture-breakdown.md)
2. [model-and-tooling-map.md](./model-and-tooling-map.md)
3. [lime-gap-analysis.md](./lime-gap-analysis.md)
4. [../../roadmap/ai-layered-design/README.md](../../roadmap/ai-layered-design/README.md)
5. [../../roadmap/ai-layered-design/architecture.md](../../roadmap/ai-layered-design/architecture.md)
6. [../../roadmap/ai-layered-design/implementation-plan.md](../../roadmap/ai-layered-design/implementation-plan.md)
7. [../../roadmap/ai-layered-design/architecture-diagrams.md](../../roadmap/ai-layered-design/architecture-diagrams.md)
8. [../../roadmap/ai-layered-design/prototype.md](../../roadmap/ai-layered-design/prototype.md)
9. [../../roadmap/ai-layered-design/sequences.md](../../roadmap/ai-layered-design/sequences.md)
10. [../../roadmap/ai-layered-design/flowcharts.md](../../roadmap/ai-layered-design/flowcharts.md)

## 6. 参考事实源

外部资料只作为研究参考，Lime 的实现决策以后续 roadmap 为准：

1. Lovart Edit Element / Canvas 相关公开文档：用于理解 flat image 到 editable layers 的产品表达。
2. OpenAI `gpt-image-2` 模型页：确认其定位是高质量图像生成与编辑模型，并支持 Image generation / Image edit 端点。
3. OpenAI image generation guide：确认 GPT Image 系列的生成、编辑、透明背景、尺寸、质量、格式与限制口径。
4. Segment Anything / SAM：用于理解提示式实例分割和 mask 生成。
5. LaMa / inpainting 类方法：用于理解对象移除后的背景修补。
6. PSD / Canvas 开源生态：用于理解图层协议和导出边界。

## 7. 与 Lime 路线图的关系

后续所有实现建议默认遵守以下顺序：

1. 先读本目录，确认“外部产品到底实现了哪类能力”。
2. 再读 [../../roadmap/ai-layered-design/README.md](../../roadmap/ai-layered-design/README.md)，确认“Lime 决定怎么做”。
3. 涉及 `@配图`、`@海报`、图片任务或媒体 artifact 时，回看 [../../aiprompts/command-runtime.md](../../aiprompts/command-runtime.md) 与相关媒体任务事实源。

一句话：

**`research/ai-layered-design` 负责防止把模型当产品，`roadmap/ai-layered-design` 负责把启发收敛成 Lime current 主线。**
