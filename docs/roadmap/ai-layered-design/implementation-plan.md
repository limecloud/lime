# AI 图层化设计实施计划

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：把 `LayeredDesignDocument`、原生分层生成、Canvas 编辑、扁平图拆层和导出能力拆成可执行阶段，确保实现持续回到 Lime current 主链。

## 1. 实施总原则

1. **先原生分层，后扁平拆层**
   - 先让新生成结果天然有图层，再处理已有图片的反推问题。

2. **先 JSON + PNG，后 PSD**
   - 首期先保证项目 JSON 可恢复、PNG 可导出，PSD 后续作为投影。

3. **先普通文本可编辑**
   - 标题、正文、按钮文案必须是 TextLayer；艺术 Logo 可暂为 ImageLayer。

4. **先 provider seam，后模型优化**
   - `gpt-image-2`、Gemini、Flux 等都必须通过统一 provider capability 进入，不写死到产品协议。

5. **先可验证体验，后模型微调**
   - 当前不训练模型，不新增自研 image-to-PSD 路线。

## 2. P0：文档与边界落盘

目标：让后续实现有稳定事实源。

任务：

1. 新增 `docs/research/ai-layered-design/` 研究拆解。
2. 新增 `docs/roadmap/ai-layered-design/` 路线图、架构、实施计划和图纸。
3. 固定 `LayeredDesignDocument` 是 current 设计工程事实源。
4. 固定 `gpt-image-2` / Gemini 等模型只是 Asset Generator。
5. 固定首期不自训模型、不承诺完整 PSD。

完成标准：

1. 文档能解释 Lovart 类体验的技术链路。
2. 文档能解释 Lime 为什么不需要先训练模型。
3. 文档能给出 P1-P4 的实现顺序。

## 3. P1：原生分层生成 draft

目标：从用户 prompt 生成一个可恢复的多图层设计文档。

### 3.1 用户流

```text
用户：做一张暗黑冥界女巫游戏海报
  -> Lime 生成 layer plan
  -> 分别生成背景、人物、烟雾、Logo
  -> 创建真实标题/正文 TextLayer
  -> 合成 preview
  -> 保存 design.json + assets
```

### 3.2 最小能力

1. Layer Planner 输出 5-8 个图层。
2. Asset Generator 支持背景、主体、特效、Logo 四类 bitmap。
3. 主体层能通过透明输出或抠图得到 RGBA。
4. 普通文案作为 TextLayer。
5. Composer 生成预览 PNG。
6. 保存 `LayeredDesignDocument`。

### 3.3 完成标准

1. 同一设计重新打开后图层顺序、位置、可见性一致。
2. preview 与 Canvas 渲染一致。
3. 每个 ImageLayer 都能追踪 asset、prompt、provider 和 model。
4. 不存在只保存最终 PNG 的设计项目。

## 4. P2：Canvas 图层编辑与单层重生成

目标：让用户能像设计工具一样调整图层。

### 4.1 用户流

```text
用户打开设计项目
  -> 选择角色层
  -> 拖动、缩放、隐藏或上移层级
  -> 点击“重生成此层”
  -> Lime 替换角色 asset
  -> 其他图层保持不变
```

### 4.2 最小能力

1. 图层栏展示名称、缩略图、可见性、锁定态。
2. Canvas 支持选中、拖拽、缩放。
3. 属性面板展示位置、尺寸、透明度。
4. 支持 zIndex 重排。
5. 支持单层重生成。
6. 编辑后保存到 `design.json`。

### 4.3 完成标准

1. 移动图层后刷新页面不丢失位置。
2. 隐藏图层后导出 PNG 与 Canvas 一致。
3. 单层重生成失败不会破坏旧图层。
4. 单层重生成不会改变其他图层的 transform。
5. 用户可导出当前预览 PNG。

## 5. P3：扁平图主要对象拆层

目标：用户上传已有图片后，Lime 能拆出主要对象并建立可编辑工程。

### 5.1 用户流

```text
用户上传海报 flat.png
  -> Lime 识别人像、Logo、烟雾、文字和背景
  -> 生成主要对象 mask
  -> 抠出 RGBA 图层
  -> 修补 clean background
  -> 普通文字转 TextLayer
  -> 进入 Canvas 编辑
```

### 5.2 最小能力

1. 自动识别 3-8 个候选对象。
2. 支持用户选择要保留的候选层。
3. 输出主体 RGBA 图层。
4. 输出 clean background。
5. OCR 普通文案并生成 TextLayer。
6. 标记低置信度图层。

### 5.3 完成标准

1. 主体移动后原位置没有明显空洞；若修补失败，UI 明确提示。
2. 普通文本可以编辑内容。
3. 艺术 Logo 作为 ImageLayer 可移动和替换。
4. 用户可以回退到原始扁平图。

## 6. P4：专业交付与 PSD-like 导出

目标：让设计师能把 Lime 生成结果带到专业工具继续修。

### 6.1 最小能力

1. 导出 PNG。
2. 导出项目 JSON + assets zip。
3. 试点导出 PSD：ImageLayer、TextLayer、GroupLayer。
4. 导出时保留图层名称、顺序、可见性和基础 transform。

### 6.2 完成标准

1. 导出的 PNG 与 Canvas 当前显示一致。
2. JSON + assets 能完整恢复设计。
3. PSD 试点文件能在主流设计工具打开并看到图层列表。
4. TextLayer 在 PSD 中尽量保留文本语义；无法保留时必须降级为命名清晰的 raster layer。

## 7. 验证策略

### 7.1 文档阶段

P0 只改文档，最低校验：

```bash
rg -n "ai-layered-design|LayeredDesignDocument|gpt-image-2" docs
```

### 7.2 类型与协议阶段

实现 `LayeredDesignDocument` 类型后：

1. 增加类型单测或 schema 校验。
2. 验证旧 PNG 输出路径仍可作为导出投影。
3. 若接入媒体任务 artifact，补对应 runtime / artifact 测试。

### 7.3 GUI 阶段

实现 Canvas Editor 后：

1. 补 `*.test.tsx` 验证图层栏、选中、隐藏、锁定和导出按钮。
2. 执行 `npm run verify:local`。
3. 涉及 Workspace 主路径时执行 `npm run verify:gui-smoke`。

### 7.4 命令与 provider 阶段

如果新增 Tauri 命令、Bridge 或 mock：

1. 同步前端调用、Rust 注册、治理目录册和 mock。
2. 执行 `npm run test:contracts`。
3. 执行 `npm run governance:legacy-report`。

## 8. 退出条件

以下情况出现时，不继续推进下一阶段：

1. 设计项目不能重新打开继续编辑。
2. 图层编辑只存在前端内存，不落文档。
3. 普通文案仍默认作为图片烘焙。
4. 单层重生成会破坏其他图层状态。
5. Provider 能力被硬编码到产品协议，无法替换模型。

一句话：

**每个阶段都要证明 Lime 正在获得“设计工程能力”，而不是只多了一种图片生成方式。**
